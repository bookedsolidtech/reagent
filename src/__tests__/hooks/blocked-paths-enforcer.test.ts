import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import {
  runHook,
  writePayload,
  createTempProjectDir,
  cleanupTempProjectDir,
} from './test-utils.js';

describe('blocked-paths-enforcer', () => {
  const hook = 'blocked-paths-enforcer';
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempProjectDir();
    fs.writeFileSync(
      `${tmpDir}/.reagent/policy.yaml`,
      [
        'version: "1"',
        'blocked_paths:',
        '  - ".reagent/"',
        '  - ".github/workflows/"',
        '  - ".env"',
        '  - ".env.*"',
      ].join('\n') + '\n'
    );
  });

  afterEach(() => {
    cleanupTempProjectDir(tmpDir);
  });

  describe('blocks paths from policy', () => {
    it('blocks writes to .reagent/ directory', () => {
      const result = runHook(hook, writePayload('.reagent/foo.yaml', 'bar'), {
        CLAUDE_PROJECT_DIR: tmpDir,
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('BLOCKED PATH');
    });

    it('blocks writes to .github/workflows/', () => {
      const result = runHook(hook, writePayload('.github/workflows/ci.yml', 'name: ci'), {
        CLAUDE_PROJECT_DIR: tmpDir,
      });
      expect(result.exitCode).toBe(2);
    });

    it('blocks writes to .env (exact match)', () => {
      const result = runHook(hook, writePayload('.env', 'SECRET=val'), {
        CLAUDE_PROJECT_DIR: tmpDir,
      });
      expect(result.exitCode).toBe(2);
    });

    it('blocks writes to .env.* (glob match)', () => {
      const result = runHook(hook, writePayload('.env.local', 'SECRET=val'), {
        CLAUDE_PROJECT_DIR: tmpDir,
      });
      expect(result.exitCode).toBe(2);
    });

    it('blocks case-manipulated paths', () => {
      const result = runHook(hook, writePayload('.Reagent/foo.yaml', 'bar'), {
        CLAUDE_PROJECT_DIR: tmpDir,
      });
      expect(result.exitCode).toBe(2);
    });

    it('blocks URL-encoded paths', () => {
      const result = runHook(hook, writePayload('.reagent%2Ffoo.yaml', 'bar'), {
        CLAUDE_PROJECT_DIR: tmpDir,
      });
      expect(result.exitCode).toBe(2);
    });
  });

  describe('allows non-blocked paths', () => {
    it('allows src/ files', () => {
      const result = runHook(hook, writePayload('src/index.ts', 'export {};'), {
        CLAUDE_PROJECT_DIR: tmpDir,
      });
      expect(result.exitCode).toBe(0);
    });

    it('allows CLAUDE.md', () => {
      const result = runHook(hook, writePayload('CLAUDE.md', '# Rules'), {
        CLAUDE_PROJECT_DIR: tmpDir,
      });
      expect(result.exitCode).toBe(0);
    });

    it('allows when no policy file exists', () => {
      fs.unlinkSync(`${tmpDir}/.reagent/policy.yaml`);
      const result = runHook(hook, writePayload('.reagent/foo', 'bar'), {
        CLAUDE_PROJECT_DIR: tmpDir,
      });
      expect(result.exitCode).toBe(0);
    });

    it('allows when blocked_paths is empty', () => {
      fs.writeFileSync(`${tmpDir}/.reagent/policy.yaml`, 'version: "1"\nblocked_paths: []\n');
      const result = runHook(hook, writePayload('.reagent/foo', 'bar'), {
        CLAUDE_PROJECT_DIR: tmpDir,
      });
      expect(result.exitCode).toBe(0);
    });
  });
});
