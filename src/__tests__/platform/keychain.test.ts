import { describe, it, expect, afterEach, vi } from 'vitest';

// Mock child_process.execFileSync before importing the module under test
const mockExecFileSync = vi.fn();
vi.mock('node:child_process', () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));

const {
  keychainSet,
  keychainGet,
  keychainDelete,
  keychainExists,
  readClaudeCodeCredential,
  writeClaudeCodeCredential,
} = await import('../../platform/keychain.js');

describe('keychain', () => {
  afterEach(() => {
    mockExecFileSync.mockReset();
  });

  // --- keychainSet ---

  describe('keychainSet', () => {
    it('deletes existing entry then adds new one with correct args', () => {
      mockExecFileSync.mockReturnValue('');

      const credential = {
        accessToken: 'tok-abc',
        refreshToken: 'ref-xyz',
        expiresAt: '2026-12-31T00:00:00Z',
      };
      keychainSet('reagent-test', credential);

      // First call: delete existing
      expect(mockExecFileSync).toHaveBeenNthCalledWith(
        1,
        'security',
        ['delete-generic-password', '-s', 'reagent-test', '-a', 'reagent'],
        { stdio: 'pipe' }
      );

      // Second call: add new
      expect(mockExecFileSync).toHaveBeenNthCalledWith(
        2,
        'security',
        [
          'add-generic-password',
          '-s',
          'reagent-test',
          '-a',
          'reagent',
          '-w',
          JSON.stringify(credential),
          '-U',
        ],
        { stdio: 'pipe' }
      );
    });

    it('ignores error when deleting non-existent entry', () => {
      mockExecFileSync
        .mockImplementationOnce(() => {
          throw new Error(
            'security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.'
          );
        })
        .mockReturnValueOnce('');

      const credential = { accessToken: 'tok-abc' };
      expect(() => keychainSet('reagent-new', credential)).not.toThrow();
      expect(mockExecFileSync).toHaveBeenCalledTimes(2);
    });

    it('throws when add-generic-password fails', () => {
      mockExecFileSync
        .mockReturnValueOnce('') // delete succeeds
        .mockImplementationOnce(() => {
          throw new Error('security: add failed');
        });

      expect(() => keychainSet('reagent-test', { accessToken: 'tok' })).toThrow(
        'security: add failed'
      );
    });
  });

  // --- keychainGet ---

  describe('keychainGet', () => {
    it('returns parsed credential from keychain', () => {
      const stored = {
        accessToken: 'tok-abc',
        refreshToken: 'ref-xyz',
        expiresAt: '2026-12-31T00:00:00Z',
      };
      mockExecFileSync.mockReturnValue(JSON.stringify(stored) + '\n');

      const result = keychainGet('reagent-test');
      expect(result).toEqual(stored);

      expect(mockExecFileSync).toHaveBeenCalledWith(
        'security',
        ['find-generic-password', '-s', 'reagent-test', '-a', 'reagent', '-w'],
        { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' }
      );
    });

    it('returns null when entry does not exist', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('security: SecKeychainSearchCopyNext');
      });

      expect(keychainGet('reagent-missing')).toBeNull();
    });

    it('returns null when stored data is not valid JSON', () => {
      mockExecFileSync.mockReturnValue('not-json');

      expect(keychainGet('reagent-bad')).toBeNull();
    });

    it('trims whitespace from raw output before parsing', () => {
      const stored = { accessToken: 'tok' };
      mockExecFileSync.mockReturnValue('  ' + JSON.stringify(stored) + '  \n');

      expect(keychainGet('reagent-ws')).toEqual(stored);
    });
  });

  // --- keychainDelete ---

  describe('keychainDelete', () => {
    it('returns true when deletion succeeds', () => {
      mockExecFileSync.mockReturnValue('');

      expect(keychainDelete('reagent-test')).toBe(true);
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'security',
        ['delete-generic-password', '-s', 'reagent-test', '-a', 'reagent'],
        { stdio: 'pipe' }
      );
    });

    it('returns false when entry does not exist', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('not found');
      });

      expect(keychainDelete('reagent-missing')).toBe(false);
    });
  });

  // --- keychainExists ---

  describe('keychainExists', () => {
    it('returns true when entry exists', () => {
      mockExecFileSync.mockReturnValue('');

      expect(keychainExists('reagent-test')).toBe(true);
      // Should NOT include -w flag (just checks existence)
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'security',
        ['find-generic-password', '-s', 'reagent-test', '-a', 'reagent'],
        { stdio: 'pipe' }
      );
    });

    it('returns false when entry does not exist', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('not found');
      });

      expect(keychainExists('reagent-missing')).toBe(false);
    });
  });

  // --- readClaudeCodeCredential ---

  describe('readClaudeCodeCredential', () => {
    it('unwraps claudeAiOauth envelope (real Claude Code format)', () => {
      const claudeStored = {
        claudeAiOauth: {
          accessToken: 'sk-ant-oat01-real-token',
          refreshToken: 'sk-ant-ort01-real-refresh',
          expiresAt: 1776151881800,
          scopes: ['user:inference', 'user:profile'],
        },
      };
      mockExecFileSync.mockReturnValue(JSON.stringify(claudeStored));

      const result = readClaudeCodeCredential();
      expect(result).toEqual({
        accessToken: 'sk-ant-oat01-real-token',
        refreshToken: 'sk-ant-ort01-real-refresh',
        expiresAt: 1776151881800,
        scopes: ['user:inference', 'user:profile'],
      });

      expect(mockExecFileSync).toHaveBeenCalledWith(
        'security',
        ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
        { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' }
      );
    });

    it('falls back to legacy flat format with oauth_token fields', () => {
      const claudeStored = {
        oauth_token: 'oauth-tok',
        refresh_token: 'oauth-ref',
        expiry: '2026-12-31T00:00:00Z',
        scopes: ['user'],
      };
      mockExecFileSync.mockReturnValue(JSON.stringify(claudeStored));

      const result = readClaudeCodeCredential();
      expect(result).toEqual({
        accessToken: 'oauth-tok',
        refreshToken: 'oauth-ref',
        expiresAt: '2026-12-31T00:00:00Z',
        scopes: ['user'],
      });
    });

    it('handles flat format with reagent-style field names', () => {
      const stored = {
        accessToken: 'tok-abc',
        refreshToken: 'ref-xyz',
        expiresAt: '2026-06-01T00:00:00Z',
      };
      mockExecFileSync.mockReturnValue(JSON.stringify(stored));

      const result = readClaudeCodeCredential();
      expect(result).toEqual({
        accessToken: 'tok-abc',
        refreshToken: 'ref-xyz',
        expiresAt: '2026-06-01T00:00:00Z',
        scopes: undefined,
      });
    });

    it('returns null when keychain entry does not exist', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('not found');
      });

      expect(readClaudeCodeCredential()).toBeNull();
    });

    it('returns null when stored data is invalid JSON', () => {
      mockExecFileSync.mockReturnValue('{{bad-json');

      expect(readClaudeCodeCredential()).toBeNull();
    });

    it('does not include -a flag (Claude Code uses default account)', () => {
      mockExecFileSync.mockReturnValue(JSON.stringify({ oauth_token: 'x' }));
      readClaudeCodeCredential();

      const args = mockExecFileSync.mock.calls[0][1] as string[];
      expect(args).not.toContain('-a');
    });
  });

  // --- writeClaudeCodeCredential ---

  describe('writeClaudeCodeCredential', () => {
    it('deletes existing and writes new entry', () => {
      mockExecFileSync.mockReturnValue('');

      writeClaudeCodeCredential('{"oauth_token":"new"}');

      expect(mockExecFileSync).toHaveBeenNthCalledWith(
        1,
        'security',
        ['delete-generic-password', '-s', 'Claude Code-credentials'],
        { stdio: 'pipe' }
      );

      expect(mockExecFileSync).toHaveBeenNthCalledWith(
        2,
        'security',
        [
          'add-generic-password',
          '-s',
          'Claude Code-credentials',
          '-w',
          '{"oauth_token":"new"}',
          '-U',
        ],
        { stdio: 'pipe' }
      );
    });

    it('proceeds when delete fails (entry did not exist)', () => {
      mockExecFileSync
        .mockImplementationOnce(() => {
          throw new Error('not found');
        })
        .mockReturnValueOnce('');

      expect(() => writeClaudeCodeCredential('data')).not.toThrow();
      expect(mockExecFileSync).toHaveBeenCalledTimes(2);
    });

    it('throws when add-generic-password fails', () => {
      mockExecFileSync
        .mockReturnValueOnce('') // delete ok
        .mockImplementationOnce(() => {
          throw new Error('write failed');
        });

      expect(() => writeClaudeCodeCredential('data')).toThrow('write failed');
    });
  });
});
