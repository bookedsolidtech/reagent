import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import { ObsidianCli } from '../../obsidian/cli.js';

// We can't test actual CLI execution in unit tests, but we can test
// the static methods and verify the class structure.

describe('ObsidianCli', () => {
  describe('isAvailable', () => {
    it('returns a boolean', () => {
      const result = ObsidianCli.isAvailable();
      expect(typeof result).toBe('boolean');
    });

    it('checks for /usr/local/bin/obsidian', () => {
      const spy = vi.spyOn(fs, 'existsSync');
      ObsidianCli.isAvailable();
      expect(spy).toHaveBeenCalledWith('/usr/local/bin/obsidian');
      spy.mockRestore();
    });
  });

  describe('constructor', () => {
    it('creates an instance with vault name', () => {
      const cli = new ObsidianCli('TestVault');
      expect(cli).toBeInstanceOf(ObsidianCli);
    });
  });

  describe('fail-silent behavior', () => {
    let cli: ObsidianCli;

    beforeEach(() => {
      cli = new ObsidianCli('NonExistentVault__Test');
    });

    it('dailyAppend returns a boolean', () => {
      const result = cli.dailyAppend('test content');
      expect(typeof result).toBe('boolean');
    });

    it('createNote returns a boolean', () => {
      const result = cli.createNote('test', 'content');
      expect(typeof result).toBe('boolean');
    });

    it('readNote returns string or null', () => {
      const result = cli.readNote('nonexistent.md');
      // CLI may return empty string or null depending on availability
      expect(result === null || typeof result === 'string').toBe(true);
    });

    it('search returns an array', () => {
      const result = cli.search('test query');
      expect(Array.isArray(result)).toBe(true);
    });

    it('vaultHealth returns object or null', () => {
      const result = cli.vaultHealth();
      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('setProperty returns a boolean', () => {
      const result = cli.setProperty('file.md', 'key', 'value');
      expect(typeof result).toBe('boolean');
    });
  });
});
