import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const HOOKS_DIR = path.join(PROJECT_ROOT, 'hooks');

export interface HookResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface HookPayload {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Run a hook script with a JSON payload piped to stdin.
 * Returns exit code, stdout, and stderr.
 */
export function runHook(
  hookName: string,
  payload: HookPayload,
  env?: Record<string, string>
): HookResult {
  const hookPath = path.join(HOOKS_DIR, `${hookName}.sh`);

  if (!fs.existsSync(hookPath)) {
    throw new Error(`Hook not found: ${hookPath}`);
  }

  const input = JSON.stringify(payload);
  const mergedEnv = {
    ...process.env,
    // Provide a project dir that has a .reagent/ directory
    CLAUDE_PROJECT_DIR: PROJECT_ROOT,
    ...env,
  };

  const result = spawnSync('bash', [hookPath], {
    input,
    encoding: 'utf8',
    timeout: 10_000,
    env: mergedEnv,
  });

  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/**
 * Create a temporary directory with a .reagent/ subdirectory for testing hooks
 * that need a clean project dir.
 */
export function createTempProjectDir(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reagent-hook-test-'));
  fs.mkdirSync(path.join(tmpDir, '.reagent'), { recursive: true });
  return tmpDir;
}

/**
 * Clean up a temp project dir.
 */
export function cleanupTempProjectDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Build a standard Bash tool payload.
 */
export function bashPayload(command: string): HookPayload {
  return {
    tool_name: 'Bash',
    tool_input: { command },
  };
}

/**
 * Build a standard Write tool payload.
 */
export function writePayload(filePath: string, content: string): HookPayload {
  return {
    tool_name: 'Write',
    tool_input: { file_path: filePath, content },
  };
}

/**
 * Build a standard Edit tool payload.
 */
export function editPayload(filePath: string, oldString: string, newString: string): HookPayload {
  return {
    tool_name: 'Edit',
    tool_input: { file_path: filePath, old_string: oldString, new_string: newString },
  };
}
