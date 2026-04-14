import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const CLI_ENTRY = path.join(PROJECT_ROOT, 'dist', 'cli', 'index.js');

/**
 * Comprehensive tests for `reagent init` command.
 *
 * Tests cover:
 * - Fresh install (all artifacts created)
 * - Idempotency (running init twice produces no changes)
 * - Individual install step verification
 * - Gateway config generation
 * - Policy generation
 * - Profile validation
 * - Dry-run mode
 */
describe('reagent init', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reagent-init-test-'));
    // Create minimal .gitignore so append works
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), '# test\n');
    // Create a minimal package.json
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test-project', version: '1.0.0' }, null, 2) + '\n'
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function runInit(
    extraArgs: string[] = [],
    opts: { expectError?: boolean; noDefaultProfile?: boolean } = {}
  ): { stdout: string; stderr: string; exitCode: number } {
    const profileArgs = opts.noDefaultProfile ? [] : ['--profile', 'client-engagement'];
    try {
      const stdout = execFileSync(
        process.execPath,
        [CLI_ENTRY, 'init', ...profileArgs, ...extraArgs],
        {
          encoding: 'utf8',
          timeout: 15_000,
          cwd: tmpDir,
        }
      );
      return { stdout, stderr: '', exitCode: 0 };
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; status?: number };
      if (!opts.expectError) throw e;
      return {
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? '',
        exitCode: err.status ?? 1,
      };
    }
  }

  // ── Fresh install ──────────────────────────────────────────────────

  describe('fresh install', () => {
    it(
      'creates all expected artifacts',
      () => {
        runInit();

        // Policy
        expect(fs.existsSync(path.join(tmpDir, '.reagent', 'policy.yaml'))).toBe(true);

        // Gateway config
        expect(fs.existsSync(path.join(tmpDir, '.reagent', 'gateway.yaml'))).toBe(true);

        // CLAUDE.md
        expect(fs.existsSync(path.join(tmpDir, 'CLAUDE.md'))).toBe(true);

        // Claude hooks directory
        expect(fs.existsSync(path.join(tmpDir, '.claude', 'hooks'))).toBe(true);

        // Claude settings
        expect(fs.existsSync(path.join(tmpDir, '.claude', 'settings.json'))).toBe(true);

        // Husky hooks
        expect(fs.existsSync(path.join(tmpDir, '.husky', 'commit-msg'))).toBe(true);
        expect(fs.existsSync(path.join(tmpDir, '.husky', 'pre-commit'))).toBe(true);
        expect(fs.existsSync(path.join(tmpDir, '.husky', 'pre-push'))).toBe(true);

        // Cursor rules
        expect(fs.existsSync(path.join(tmpDir, '.cursor', 'rules'))).toBe(true);

        // Agents
        expect(fs.existsSync(path.join(tmpDir, '.claude', 'agents'))).toBe(true);

        // Commands
        expect(fs.existsSync(path.join(tmpDir, '.claude', 'commands'))).toBe(true);
      },
      16_000
    );

    it('prints "reagent init complete" on success', () => {
      const { stdout } = runInit();
      expect(stdout).toContain('reagent init complete');
    });

    it('reports installed files in output', () => {
      const { stdout } = runInit();
      expect(stdout).toContain('Installed:');
      expect(stdout).toContain('.reagent/policy.yaml');
      expect(stdout).toContain('.reagent/gateway.yaml');
    });
  });

  // ── Idempotency ────────────────────────────────────────────────────

  describe('idempotency', () => {
    it('running init twice reports everything as skipped or up-to-date', () => {
      runInit();
      const { stdout: secondRun } = runInit();

      // Second run should not install anything new
      expect(secondRun).not.toContain('Installed:');
      // Everything should be skipped
      expect(secondRun).toContain('Already up-to-date:');
    });

    it('does not overwrite existing policy.yaml', () => {
      runInit();
      const policyPath = path.join(tmpDir, '.reagent', 'policy.yaml');
      const originalContent = fs.readFileSync(policyPath, 'utf8');

      // Modify policy
      fs.writeFileSync(policyPath, originalContent + '\n# user modification\n');

      runInit();
      const afterSecondRun = fs.readFileSync(policyPath, 'utf8');
      expect(afterSecondRun).toContain('# user modification');
    });

    it('does not overwrite existing gateway.yaml', () => {
      runInit();
      const gatewayPath = path.join(tmpDir, '.reagent', 'gateway.yaml');
      const originalContent = fs.readFileSync(gatewayPath, 'utf8');

      // Modify gateway config
      fs.writeFileSync(gatewayPath, originalContent + '\n# user modification\n');

      runInit();
      const afterSecondRun = fs.readFileSync(gatewayPath, 'utf8');
      expect(afterSecondRun).toContain('# user modification');
    });

    it('updates changed hook files but preserves user policy/gateway', () => {
      runInit();

      // Tamper with a hook file
      const hookPath = path.join(tmpDir, '.claude', 'hooks', 'secret-scanner.sh');
      if (fs.existsSync(hookPath)) {
        fs.writeFileSync(hookPath, '#!/bin/bash\n# tampered\n');
      }

      const { stdout } = runInit();

      // Hook should be updated (it changed), but policy/gateway skipped
      if (fs.existsSync(hookPath)) {
        expect(stdout).toContain('Updated:');
      }
      // Policy and gateway should NOT appear in installed list
      expect(stdout).not.toMatch(/Installed:[\s\S]*.reagent\/policy\.yaml/);
      expect(stdout).not.toMatch(/Installed:[\s\S]*.reagent\/gateway\.yaml/);
    });
  });

  // ── Gateway config ─────────────────────────────────────────────────

  describe('gateway.yaml generation', () => {
    it('generates a valid YAML gateway config', () => {
      runInit();
      const gatewayPath = path.join(tmpDir, '.reagent', 'gateway.yaml');
      const content = fs.readFileSync(gatewayPath, 'utf8');

      expect(content).toContain('version: "1"');
      expect(content).toContain('servers:');
    });

    it('gateway.yaml contains helpful comments', () => {
      runInit();
      const content = fs.readFileSync(path.join(tmpDir, '.reagent', 'gateway.yaml'), 'utf8');

      expect(content).toContain('reagent serve');
      expect(content).toContain('tool_overrides');
      expect(content).toContain('tier:');
    });

    it('gateway.yaml contains tier classification reference', () => {
      runInit();
      const content = fs.readFileSync(path.join(tmpDir, '.reagent', 'gateway.yaml'), 'utf8');

      expect(content).toContain('read:');
      expect(content).toContain('destructive:');
      expect(content).toContain('write:');
    });

    it('gateway.yaml has empty servers block (not null)', () => {
      runInit();
      const content = fs.readFileSync(path.join(tmpDir, '.reagent', 'gateway.yaml'), 'utf8');

      // Should have `servers: {}` not `servers:` (which parses as null)
      expect(content).toContain('servers: {}');
    });

    it('pre-existing gateway.yaml with real servers is preserved', () => {
      // Create a real gateway config before init
      fs.mkdirSync(path.join(tmpDir, '.reagent'), { recursive: true });
      const customGateway = `version: "1"
servers:
  my-server:
    command: node
    args: ['./server.js']
`;
      fs.writeFileSync(path.join(tmpDir, '.reagent', 'gateway.yaml'), customGateway);

      runInit();
      const content = fs.readFileSync(path.join(tmpDir, '.reagent', 'gateway.yaml'), 'utf8');

      expect(content).toBe(customGateway);
      expect(content).toContain('my-server');
    });
  });

  // ── Policy generation ──────────────────────────────────────────────

  describe('policy.yaml generation', () => {
    it('generates policy with correct profile name', () => {
      runInit();
      const content = fs.readFileSync(path.join(tmpDir, '.reagent', 'policy.yaml'), 'utf8');

      expect(content).toContain('profile: "client-engagement"');
    });

    it('sets default autonomy to L1 with max L2', () => {
      runInit();
      const content = fs.readFileSync(path.join(tmpDir, '.reagent', 'policy.yaml'), 'utf8');

      expect(content).toContain('autonomy_level: L1');
      expect(content).toContain('max_autonomy_level: L2');
    });

    it('includes blocked_paths from profile', () => {
      runInit();
      const content = fs.readFileSync(path.join(tmpDir, '.reagent', 'policy.yaml'), 'utf8');

      expect(content).toContain('.reagent/policy.yaml');
      expect(content).toContain('.env');
    });

    it('sets promotion_requires_human_approval to true', () => {
      runInit();
      const content = fs.readFileSync(path.join(tmpDir, '.reagent', 'policy.yaml'), 'utf8');

      expect(content).toContain('promotion_requires_human_approval: true');
    });

    it('pre-existing policy.yaml is preserved', () => {
      fs.mkdirSync(path.join(tmpDir, '.reagent'), { recursive: true });
      const customPolicy = 'version: "1"\nautonomy_level: L3\n';
      fs.writeFileSync(path.join(tmpDir, '.reagent', 'policy.yaml'), customPolicy);

      runInit();
      const content = fs.readFileSync(path.join(tmpDir, '.reagent', 'policy.yaml'), 'utf8');

      expect(content).toBe(customPolicy);
    });
  });

  // ── Dry-run mode ───────────────────────────────────────────────────

  describe('dry-run mode', () => {
    it('does not create any files', () => {
      runInit(['--dry-run']);

      expect(fs.existsSync(path.join(tmpDir, '.reagent'))).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, 'CLAUDE.md'))).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, '.claude'))).toBe(false);
    });

    it('still prints profile and target info', () => {
      const { stdout } = runInit(['--dry-run']);

      expect(stdout).toContain('Profile: client-engagement');
      expect(stdout).toContain('dry-run');
    });

    it('does not modify .gitignore', () => {
      const originalGitignore = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
      runInit(['--dry-run']);
      const afterGitignore = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');

      expect(afterGitignore).toBe(originalGitignore);
    });

    it('does not modify package.json', () => {
      const originalPkg = fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf8');
      runInit(['--dry-run']);
      const afterPkg = fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf8');

      expect(afterPkg).toBe(originalPkg);
    });
  });

  // ── Profile validation ─────────────────────────────────────────────

  describe('profile validation', () => {
    it('rejects invalid profile names (path traversal)', () => {
      const { exitCode, stderr, stdout } = runInit(['--profile', '../etc/passwd'], {
        expectError: true,
        noDefaultProfile: true,
      });

      expect(exitCode).not.toBe(0);
      const output = stdout + stderr;
      expect(output).toContain('Invalid profile name');
    });

    it('rejects non-existent profile', () => {
      const { exitCode, stderr, stdout } = runInit(['--profile', 'nonexistent-profile'], {
        expectError: true,
        noDefaultProfile: true,
      });

      expect(exitCode).not.toBe(0);
      const output = stdout + stderr;
      expect(output).toContain('Profile not found');
      // Message now distinguishes base profiles from tech profiles
      expect(output).toMatch(/Available (base )?profiles/);
    });

    it('accepts valid profile names', () => {
      const { exitCode } = runInit(['--profile', 'bst-internal'], { noDefaultProfile: true });
      expect(exitCode).toBe(0);
    });
  });

  // ── .gitignore management ──────────────────────────────────────────

  describe('.gitignore management', () => {
    it('adds reagent entries to .gitignore', () => {
      runInit();
      const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');

      // .claude/agents/ is intentionally NOT gitignored — agents are project config and should be committed
      expect(content).not.toContain('.claude/agents/');
      expect(content).toContain('.claude/hooks/');
      expect(content).toContain('.claude/settings.json');
    });

    it('does not duplicate entries on second run', () => {
      runInit();
      runInit();
      const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');

      // Count occurrences of .claude/hooks/ (agents are no longer gitignored)
      const matches = content.match(/\.claude\/hooks\//g);
      expect(matches?.length).toBe(1);
    });

    it('preserves existing .gitignore content', () => {
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules/\ndist/\n');
      runInit();
      const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');

      expect(content).toContain('node_modules/');
      expect(content).toContain('dist/');
    });
  });

  // ── CLAUDE.md management ───────────────────────────────────────────

  describe('CLAUDE.md management', () => {
    it('generates CLAUDE.md with reagent managed markers', () => {
      runInit();
      const content = fs.readFileSync(path.join(tmpDir, 'CLAUDE.md'), 'utf8');

      expect(content).toContain('reagent-managed:start');
      expect(content).toContain('reagent-managed:end');
    });

    it('preserves user content in CLAUDE.md on re-init', () => {
      runInit();
      const claudeMdPath = path.join(tmpDir, 'CLAUDE.md');
      const original = fs.readFileSync(claudeMdPath, 'utf8');

      // Append user content after managed block
      fs.writeFileSync(claudeMdPath, original + '\n# My Custom Rules\n\nDo something special.\n');

      runInit();
      const updated = fs.readFileSync(claudeMdPath, 'utf8');

      expect(updated).toContain('My Custom Rules');
      expect(updated).toContain('Do something special.');
    });
  });

  // ── Husky hooks ────────────────────────────────────────────────────

  describe('husky hooks', () => {
    it('installs commit-msg hook with executable permissions', () => {
      runInit();
      const hookPath = path.join(tmpDir, '.husky', 'commit-msg');

      expect(fs.existsSync(hookPath)).toBe(true);
      const stat = fs.statSync(hookPath);
      // Check executable bit (owner)
      expect(stat.mode & 0o100).toBeTruthy();
    });

    it('adds husky to package.json devDependencies', () => {
      runInit();
      const pkg = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf8'));

      expect(pkg.devDependencies?.husky).toBeDefined();
    });

    it('adds prepare script to package.json', () => {
      runInit();
      const pkg = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf8'));

      expect(pkg.scripts?.prepare).toContain('husky');
    });

    it('does not duplicate prepare script on second run', () => {
      runInit();
      runInit();
      const pkg = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf8'));

      const huskyCount = (pkg.scripts.prepare.match(/husky/g) || []).length;
      expect(huskyCount).toBe(1);
    });
  });

  // ── Claude hooks & settings ────────────────────────────────────────

  describe('claude hooks and settings', () => {
    it('installs hook shell scripts', () => {
      runInit();
      const hooksDir = path.join(tmpDir, '.claude', 'hooks');

      expect(fs.existsSync(hooksDir)).toBe(true);
      const hookFiles = fs.readdirSync(hooksDir);
      expect(hookFiles.length).toBeGreaterThan(0);
      expect(hookFiles.some((f) => f.endsWith('.sh'))).toBe(true);
    });

    it('generates settings.json with hook configuration', () => {
      runInit();
      const settings = JSON.parse(
        fs.readFileSync(path.join(tmpDir, '.claude', 'settings.json'), 'utf8')
      );

      expect(settings.hooks).toBeDefined();
      expect(settings.hooks.PreToolUse).toBeDefined();
      expect(Array.isArray(settings.hooks.PreToolUse)).toBe(true);
    });

    it('settings.json hook paths reference .claude/hooks/', () => {
      runInit();
      const settings = JSON.parse(
        fs.readFileSync(path.join(tmpDir, '.claude', 'settings.json'), 'utf8')
      );

      for (const entry of settings.hooks.PreToolUse || []) {
        for (const hook of entry.hooks || []) {
          expect(hook.command).toContain('.claude/hooks/');
          expect(hook.command).toContain('.sh');
        }
      }
    });
  });

  // ── Agent installation ─────────────────────────────────────────────

  describe('agent installation', () => {
    it('copies agent .md files to .claude/agents/', () => {
      runInit();
      const agentsDir = path.join(tmpDir, '.claude', 'agents');

      expect(fs.existsSync(agentsDir)).toBe(true);
      // Should have at least the orchestrator
      const allFiles = getAllFiles(agentsDir);
      expect(allFiles.some((f) => f.endsWith('.md'))).toBe(true);
    });

    it('preserves agent directory structure', () => {
      runInit();
      const agentsDir = path.join(tmpDir, '.claude', 'agents');

      // Check that subdirectories exist (e.g., ai-platforms/)
      const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
      const dirs = entries.filter((e) => e.isDirectory());
      expect(dirs.length).toBeGreaterThan(0);
    });
  });

  // ── Commands installation ──────────────────────────────────────────

  describe('commands installation', () => {
    it('copies command .md files to .claude/commands/', () => {
      runInit();
      const commandsDir = path.join(tmpDir, '.claude', 'commands');

      if (fs.existsSync(path.join(PROJECT_ROOT, 'commands'))) {
        expect(fs.existsSync(commandsDir)).toBe(true);
        const files = fs.readdirSync(commandsDir);
        expect(files.some((f) => f.endsWith('.md'))).toBe(true);
      }
    });
  });

  // ── BST internal profile ──────────────────────────────────────────

  describe('bst-internal profile', () => {
    it('installs with block_ai_attribution: true', () => {
      runInit(['--profile', 'bst-internal']);
      const content = fs.readFileSync(path.join(tmpDir, '.reagent', 'policy.yaml'), 'utf8');

      expect(content).toContain('block_ai_attribution: true');
    });

    it('includes .env in blocked_paths', () => {
      runInit(['--profile', 'bst-internal']);
      const content = fs.readFileSync(path.join(tmpDir, '.reagent', 'policy.yaml'), 'utf8');

      expect(content).toContain('.reagent/policy.yaml');
      expect(content).toContain('.reagent/HALT');
      expect(content).toContain('.env');
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles missing .gitignore gracefully', () => {
      fs.unlinkSync(path.join(tmpDir, '.gitignore'));
      // Should not throw — appendFileSync creates the file
      runInit();
      expect(fs.existsSync(path.join(tmpDir, '.gitignore'))).toBe(true);
    });

    it('handles pre-existing .reagent directory', () => {
      fs.mkdirSync(path.join(tmpDir, '.reagent'), { recursive: true });
      runInit();

      expect(fs.existsSync(path.join(tmpDir, '.reagent', 'policy.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.reagent', 'gateway.yaml'))).toBe(true);
    });

    it('handles pre-existing .claude directory', () => {
      fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
      runInit();

      expect(fs.existsSync(path.join(tmpDir, '.claude', 'hooks'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.claude', 'settings.json'))).toBe(true);
    });

    it('final output mentions gateway.yaml in commit instructions', () => {
      const { stdout } = runInit();
      expect(stdout).toContain('.reagent/gateway.yaml');
    });
  });
});

// Helper: recursively get all files under a directory
function getAllFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllFiles(full));
    } else {
      results.push(full);
    }
  }
  return results;
}
