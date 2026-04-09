import { describe, it, expect } from 'vitest';
import { runHook, writePayload } from './test-utils.js';

describe('import-guard', () => {
  const hook = 'import-guard';

  // ── Should WARN (exit 0 with stderr) ──────────────────────────────

  describe('warns on dangerous import patterns', () => {
    it('warns on require child_process (single quotes)', () => {
      const result = runHook(
        hook,
        writePayload('/repo/src/tool.ts', "const cp = require('child_process');")
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('IMPORT-GUARD');
      expect(result.stderr).toContain('child_process');
    });

    it('warns on require child_process (double quotes)', () => {
      const result = runHook(
        hook,
        writePayload('/repo/src/tool.js', 'const cp = require("child_process");')
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('IMPORT-GUARD');
    });

    it('warns on require vm', () => {
      const result = runHook(
        hook,
        writePayload('/repo/src/sandbox.ts', "const vm = require('vm');")
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('IMPORT-GUARD');
      expect(result.stderr).toContain('vm');
    });

    it('warns on eval(', () => {
      const result = runHook(
        hook,
        writePayload('/repo/src/exec.ts', 'const result = eval(userInput);')
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('IMPORT-GUARD');
      expect(result.stderr).toContain('eval');
    });

    it('warns on new Function(', () => {
      const result = runHook(
        hook,
        writePayload('/repo/src/exec.js', 'const fn = new Function("return 1");')
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('IMPORT-GUARD');
      expect(result.stderr).toContain('Function');
    });

    it('warns on dynamic require with variable', () => {
      const result = runHook(
        hook,
        writePayload('/repo/src/loader.ts', 'const mod = require(moduleName);')
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('IMPORT-GUARD');
    });
  });

  // ── Should ALLOW silently (exit 0 no stderr) ──────────────────────

  describe('allows safe code', () => {
    it('allows normal imports', () => {
      const result = runHook(
        hook,
        writePayload('/repo/src/index.ts', "import fs from 'node:fs';\nexport const x = 1;")
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
    });

    it('ignores non-JS/TS files', () => {
      const result = runHook(
        hook,
        writePayload('/repo/README.md', "require('child_process')\neval(x)\nnew Function()")
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
    });

    it('ignores .sh files', () => {
      const result = runHook(hook, writePayload('/repo/hooks/test.sh', 'eval "$CMD"'));
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
    });

    it('allows empty TS file', () => {
      const result = runHook(hook, {
        tool_name: 'Write',
        tool_input: { file_path: '/repo/src/empty.ts' },
      });
      expect(result.exitCode).toBe(0);
    });

    it('allows standard TS code', () => {
      const result = runHook(
        hook,
        writePayload(
          '/repo/src/utils.ts',
          'export function greet(name: string): string { return `Hello, ${name}`; }'
        )
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
    });
  });
});
