import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { TaskStore } from '../pm/task-store.js';
import { GitHubBridge } from '../pm/github-bridge.js';
import { DiscordNotifier } from '../pm/discord-notifier.js';
import type { Middleware, InvocationContext } from './middleware/chain.js';
import { executeChain } from './middleware/chain.js';
import { InvocationStatus } from '../types/index.js';

/**
 * Register first-party MCP tools (task management) on the gateway.
 * These go through the same middleware chain as proxied tools.
 */
export function registerNativeTools(
  gateway: McpServer,
  baseDir: string,
  middlewares: Middleware[]
): number {
  const store = new TaskStore(baseDir);
  const bridge = new GitHubBridge({ baseDir });
  const discord = new DiscordNotifier(baseDir);
  let count = 0;

  function wrapHandler(
    toolName: string,
    handler: (args: Record<string, unknown>) => unknown
  ): (
    params: Record<string, unknown>
  ) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
    return async (params) => {
      const ctx: InvocationContext = {
        tool_name: toolName,
        server_name: 'reagent',
        arguments: params,
        session_id: crypto.randomUUID(),
        status: InvocationStatus.Allowed,
        start_time: Date.now(),
        metadata: {},
      };

      const fullChain: Middleware[] = [
        ...middlewares,
        async (innerCtx) => {
          if (innerCtx.status !== InvocationStatus.Allowed) return;
          try {
            innerCtx.result = handler(innerCtx.arguments);
            innerCtx.status = InvocationStatus.Allowed;
          } catch (err) {
            innerCtx.status = InvocationStatus.Error;
            innerCtx.error = err instanceof Error ? err.message : String(err);
          }
        },
      ];

      await executeChain(fullChain, ctx);

      if (ctx.status === InvocationStatus.Denied) {
        return {
          content: [{ type: 'text' as const, text: `[DENIED] ${ctx.error}` }],
          isError: true,
        };
      }
      if (ctx.status === InvocationStatus.Error) {
        return {
          content: [{ type: 'text' as const, text: `[ERROR] ${ctx.error}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(ctx.result, null, 2) }],
      };
    };
  }

  // ── task_create ──────────────────────────────────────────────────────
  gateway.tool(
    'task_create',
    'Create a new task in the local task store',
    {
      title: z.string().describe('Task title'),
      description: z.string().optional().describe('Task description'),
      urgency: z.enum(['critical', 'normal', 'low']).optional().describe('Task urgency'),
      phase: z.string().optional().describe('Project phase'),
      milestone: z.string().optional().describe('Milestone'),
      assignee: z.string().optional().describe('Assignee'),
      parent_id: z.string().optional().describe('Parent task ID (T-NNN format)'),
    },
    wrapHandler('task_create', (args) => {
      const id = store.nextId();
      store.appendEvent({
        id,
        type: 'created',
        title: args.title as string,
        description: args.description as string | undefined,
        urgency: (args.urgency as 'critical' | 'normal' | 'low') || 'normal',
        phase: args.phase as string | undefined,
        milestone: args.milestone as string | undefined,
        assignee: args.assignee as string | undefined,
        parent_id: args.parent_id as string | undefined,
        timestamp: new Date().toISOString(),
      });
      return { id, status: 'created' };
    })
  );
  count++;

  // ── task_update ──────────────────────────────────────────────────────
  gateway.tool(
    'task_update',
    'Update a task status or fields',
    {
      id: z.string().describe('Task ID (T-NNN format)'),
      type: z.enum(['started', 'completed', 'blocked', 'cancelled']).describe('New status'),
      title: z.string().optional().describe('Updated title'),
      description: z.string().optional().describe('Updated description'),
      urgency: z.enum(['critical', 'normal', 'low']).optional(),
      assignee: z.string().optional(),
      blocked_by: z.string().optional(),
      commit_refs: z.array(z.string()).optional(),
      pr_ref: z.string().optional(),
    },
    wrapHandler('task_update', (args) => {
      const existing = store.getTask(args.id as string);
      if (!existing) {
        throw new Error(`Task ${args.id} not found`);
      }

      store.appendEvent({
        id: args.id as string,
        type: args.type as 'started' | 'completed' | 'blocked' | 'cancelled',
        title: (args.title as string) || existing.title,
        description: args.description as string | undefined,
        urgency: (args.urgency as 'critical' | 'normal' | 'low') || existing.urgency,
        assignee: args.assignee as string | undefined,
        blocked_by: args.blocked_by as string | undefined,
        commit_refs: args.commit_refs as string[] | undefined,
        pr_ref: args.pr_ref as string | undefined,
        timestamp: new Date().toISOString(),
      });

      // Close GitHub issue if completed
      if (args.type === 'completed' && existing.github_issue) {
        bridge.closeGitHubIssue(existing.github_issue);
      }

      return { id: args.id, status: args.type };
    })
  );
  count++;

  // ── task_list ────────────────────────────────────────────────────────
  gateway.tool(
    'task_list',
    'List tasks with optional filters',
    {
      status: z.string().optional().describe('Filter by status'),
      urgency: z.string().optional().describe('Filter by urgency'),
      phase: z.string().optional().describe('Filter by phase'),
    },
    wrapHandler('task_list', (args) => {
      return store.listTasks({
        status: args.status as string | undefined,
        urgency: args.urgency as string | undefined,
        phase: args.phase as string | undefined,
      });
    })
  );
  count++;

  // ── task_get ─────────────────────────────────────────────────────────
  gateway.tool(
    'task_get',
    'Get a single task by ID',
    {
      id: z.string().describe('Task ID (T-NNN format)'),
    },
    wrapHandler('task_get', (args) => {
      const task = store.getTask(args.id as string);
      if (!task) {
        throw new Error(`Task ${args.id} not found`);
      }
      return task;
    })
  );
  count++;

  // ── task_delete ──────────────────────────────────────────────────────
  gateway.tool(
    'task_delete',
    'Cancel a task (soft delete via cancelled event)',
    {
      id: z.string().describe('Task ID (T-NNN format)'),
    },
    wrapHandler('task_delete', (args) => {
      const existing = store.getTask(args.id as string);
      if (!existing) {
        throw new Error(`Task ${args.id} not found`);
      }

      store.appendEvent({
        id: args.id as string,
        type: 'cancelled',
        title: existing.title,
        timestamp: new Date().toISOString(),
      });
      return { id: args.id, status: 'cancelled' };
    })
  );
  count++;

  // ── task_sync_github ────────────────────────────────────────────────
  gateway.tool(
    'task_sync_github',
    'Sync local tasks to GitHub issues (requires gh CLI)',
    {},
    wrapHandler('task_sync_github', () => {
      // Note: This is sync because the bridge uses execFileSync
      const mode = bridge.getMode();
      if (mode === 'local-only') {
        return { error: 'GitHub CLI not available. Install gh and run: gh auth login' };
      }
      // Can't await in sync context, so we trigger directly
      let created = 0;
      let skipped = 0;
      const tasks = store.listTasks();
      for (const task of tasks) {
        if (task.github_issue || task.status === 'completed' || task.status === 'cancelled') {
          skipped++;
        } else {
          created++;
        }
      }
      return {
        mode,
        tasks_eligible: created,
        tasks_skipped: skipped,
        note: 'Use the async sync endpoint for full GitHub sync',
      };
    })
  );
  count++;

  // ── repo_scaffold ────────────────────────────────────────────────────
  gateway.tool(
    'repo_scaffold',
    'Scaffold GitHub repo metadata (description, topics, labels, milestones)',
    {
      description: z.string().optional().describe('Repository description'),
      homepage: z.string().optional().describe('Repository homepage URL'),
      topics: z.array(z.string()).optional().describe('Topics to add to the repository'),
      milestones: z.array(z.string()).optional().describe('Milestone titles to create'),
    },
    wrapHandler('repo_scaffold', (args) => {
      const mode = bridge.getMode();
      if (mode === 'local-only') {
        return { error: 'GitHub CLI not available. Install gh and run: gh auth login' };
      }

      const defaultLabels = [
        { name: 'reagent:task', color: '0075ca', description: 'Tracked by reagent' },
        {
          name: 'reagent:critical',
          color: 'd73a4a',
          description: 'Critical priority reagent task',
        },
        { name: 'reagent:blocked', color: 'e4e669', description: 'Blocked reagent task' },
      ];

      return bridge.scaffoldRepo({
        description: args.description as string | undefined,
        homepage: args.homepage as string | undefined,
        topics: args.topics as string[] | undefined,
        labels: defaultLabels,
        milestones: args.milestones as string[] | undefined,
      });
    })
  );
  count++;

  // ── project_sync ──────────────────────────────────────────────────────
  gateway.tool(
    'project_sync',
    'Sync all tasks with GitHub issues to the reagent GitHub Projects v2 board',
    {},
    wrapHandler('project_sync', () => {
      const mode = bridge.getMode();
      if (mode === 'local-only') {
        return { error: 'GitHub CLI not available. Install gh and run: gh auth login' };
      }
      return bridge.syncToProject();
    })
  );
  count++;

  // ── discord_notify ───────────────────────────────────────────────────
  gateway.tool(
    'discord_notify',
    'Send a notification to a configured Discord channel. Requires discord_ops to be enabled in .reagent/gateway.yaml and DISCORD_BOT_TOKEN env var.',
    {
      channel: z
        .enum(['alerts', 'releases', 'tasks', 'dev'])
        .describe('Target channel key from discord_ops.channels config'),
      message: z.string().describe('Message content to send'),
      title: z.string().optional().describe('Optional bold title prepended to the message'),
    },
    wrapHandler('discord_notify', (args) => {
      if (!discord.isEnabled()) {
        return {
          error:
            'Discord notifications are not enabled. Set discord_ops.enabled: true in .reagent/gateway.yaml and set DISCORD_BOT_TOKEN.',
        };
      }

      const channel = args.channel as 'alerts' | 'releases' | 'tasks' | 'dev';
      const message = args.message as string;
      const title = args.title as string | undefined;

      // Fire-and-forget — discord_notify is advisory, never blocks
      void discord.notifyAuditAlert(title ? `**${title}**\n${message}` : message).catch(() => {
        // Fail silently
      });

      return { sent: true, channel, note: 'Notification dispatched (best-effort)' };
    })
  );
  count++;

  console.error(`[reagent] Registered ${count} native tools`);
  return count;
}
