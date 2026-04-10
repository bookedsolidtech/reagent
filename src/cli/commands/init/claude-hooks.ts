import fs from 'node:fs';
import path from 'node:path';
import { PKG_ROOT } from '../../utils.js';
import type { InstallResult, HooksConfig, HookEntry } from './types.js';

export function installClaudeHooks(
  targetDir: string,
  hooksConfig: HooksConfig,
  dryRun: boolean
): InstallResult[] {
  const claudeHooksDir = path.join(targetDir, '.claude', 'hooks');
  if (!dryRun) {
    // If a stale symlink exists (e.g. from a retired .clarity submodule), remove it first.
    // mkdirSync with recursive:true cannot replace a symlink — it will throw ENOENT.
    try {
      const stat = fs.lstatSync(claudeHooksDir);
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(claudeHooksDir);
      }
    } catch {
      // Path doesn't exist yet — that's fine, mkdirSync will create it
    }
    fs.mkdirSync(claudeHooksDir, { recursive: true });
  }

  const results: InstallResult[] = [];
  const installedHookNames = new Set<string>();

  const allHookEntries = [...(hooksConfig.PreToolUse || []), ...(hooksConfig.PostToolUse || [])];
  for (const entry of allHookEntries) {
    for (const hookName of entry.hooks || []) {
      const srcFile = path.join(PKG_ROOT, 'hooks', `${hookName}.sh`);

      if (!fs.existsSync(srcFile)) {
        console.error(
          `  ERROR: Hook '${hookName}' referenced in profile but not found in package.`
        );
        results.push({
          file: `.claude/hooks/${hookName}.sh (MISSING — not installed)`,
          status: 'warn',
        });
        continue;
      }

      installedHookNames.add(hookName);

      const srcContent = fs.readFileSync(srcFile, 'utf8');
      const destFile = path.join(claudeHooksDir, `${hookName}.sh`);
      const exists = fs.existsSync(destFile);
      const same = exists && fs.readFileSync(destFile, 'utf8') === srcContent;

      if (!same && !dryRun) {
        fs.writeFileSync(destFile, srcContent, { mode: 0o755 });
      }

      results.push({
        file: `.claude/hooks/${hookName}.sh`,
        status: same ? 'skipped' : exists ? 'updated' : 'installed',
      });
    }
  }

  // Write settings.json
  const settingsPath = path.join(targetDir, '.claude', 'settings.json');
  const settings = buildSettingsJson(hooksConfig, installedHookNames);
  const settingsContent = JSON.stringify(settings, null, 2) + '\n';

  const settingsExists = fs.existsSync(settingsPath);
  const settingsSame = settingsExists && fs.readFileSync(settingsPath, 'utf8') === settingsContent;

  if (!settingsSame && !dryRun) {
    fs.writeFileSync(settingsPath, settingsContent);
  }

  results.push({
    file: '.claude/settings.json',
    status: settingsSame ? 'skipped' : settingsExists ? 'updated' : 'installed',
  });

  return results;
}

function buildSettingsJson(
  hooksConfig: HooksConfig,
  installedHookNames: Set<string>
): Record<string, unknown> {
  const settings: Record<string, unknown> = {
    env: { ENABLE_TOOL_SEARCH: 'auto:5' },
    hooks: {} as Record<string, unknown>,
  };

  function buildHookEntries(entries: HookEntry[]) {
    const result = [];
    for (const entry of entries) {
      const availableHooks = entry.hooks.filter((h) => installedHookNames.has(h));
      if (!availableHooks.length) continue;

      result.push({
        matcher: entry.matcher,
        hooks: availableHooks.map((hookName) => ({
          type: 'command',
          command: `"$CLAUDE_PROJECT_DIR"/.claude/hooks/${hookName}.sh`,
          timeout: getHookTimeout(hookName),
          statusMessage: getHookStatusMessage(hookName),
        })),
      });
    }
    return result;
  }

  const hooks = settings.hooks as Record<string, unknown>;

  if (hooksConfig.PreToolUse?.length) {
    const merged = mergeByMatcher(hooksConfig.PreToolUse);
    const entries = buildHookEntries(merged);
    if (entries.length) hooks.PreToolUse = entries;
  }

  if (hooksConfig.PostToolUse?.length) {
    const merged = mergeByMatcher(hooksConfig.PostToolUse);
    const entries = buildHookEntries(merged);
    if (entries.length) hooks.PostToolUse = entries;
  }

  return settings;
}

function mergeByMatcher(entries: HookEntry[]): HookEntry[] {
  const map = new Map<string, HookEntry>();
  for (const entry of entries) {
    if (map.has(entry.matcher)) {
      map.get(entry.matcher)!.hooks.push(...entry.hooks);
    } else {
      map.set(entry.matcher, { matcher: entry.matcher, hooks: [...entry.hooks] });
    }
  }
  return Array.from(map.values());
}

function getHookTimeout(hookName: string): number {
  const timeouts: Record<string, number> = {
    'secret-scanner': 15000,
    'dangerous-bash-interceptor': 10000,
    'env-file-protection': 5000,
    'attribution-advisory': 5000,
    'settings-protection': 5000,
    'blocked-paths-enforcer': 5000,
    'dependency-audit-gate': 15000,
    'commit-review-gate': 30000,
    'push-review-gate': 30000,
    'architecture-review-gate': 10000,
    'task-link-gate': 5000,
    'output-validation': 10000,
    'file-size-guard': 5000,
    'symlink-guard': 5000,
    'ci-config-protection': 5000,
    'git-config-guard': 5000,
    'import-guard': 5000,
    'network-exfil-guard': 10000,
    'rate-limit-guard': 5000,
    'security-disclosure-gate': 5000,
  };
  return timeouts[hookName] || 10000;
}

function getHookStatusMessage(hookName: string): string {
  const messages: Record<string, string> = {
    'dangerous-bash-interceptor': 'Checking command safety...',
    'env-file-protection': 'Checking for .env file reads...',
    'secret-scanner': 'Scanning for credentials...',
    'attribution-advisory': 'Checking for AI attribution...',
    'settings-protection': 'Checking settings protection...',
    'blocked-paths-enforcer': 'Checking blocked paths...',
    'dependency-audit-gate': 'Verifying package exists...',
    'commit-review-gate': 'Checking commit review status...',
    'push-review-gate': 'Running push review gate...',
    'architecture-review-gate': 'Checking architecture impact...',
    'task-link-gate': 'Checking task reference...',
    'output-validation': 'Scanning output for credentials...',
    'file-size-guard': 'Checking file size...',
    'symlink-guard': 'Checking for symlink traversal...',
    'ci-config-protection': 'Checking CI workflow safety...',
    'git-config-guard': 'Checking git config safety...',
    'import-guard': 'Checking for dangerous imports...',
    'network-exfil-guard': 'Checking network destinations...',
    'rate-limit-guard': 'Checking rate limits...',
    'security-disclosure-gate': 'Checking disclosure policy...',
  };
  return messages[hookName] || `Running ${hookName}...`;
}
