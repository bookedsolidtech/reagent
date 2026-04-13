import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// --- Mock dependencies ---

const mockLoadAccounts = vi.fn();
const mockUpsertAccount = vi.fn();
const mockRemoveAccountConfig = vi.fn();

vi.mock('../../config/accounts.js', () => ({
  loadAccounts: (...args: unknown[]) => mockLoadAccounts(...args),
  upsertAccount: (...args: unknown[]) => mockUpsertAccount(...args),
  removeAccount: (...args: unknown[]) => mockRemoveAccountConfig(...args),
}));

const mockKeychainSet = vi.fn();
const mockKeychainGet = vi.fn();
const mockKeychainDelete = vi.fn();
const mockKeychainExists = vi.fn();
const mockReadClaudeCodeCredential = vi.fn();
const mockWriteClaudeCodeCredential = vi.fn();

vi.mock('../../platform/keychain.js', () => ({
  keychainSet: (...args: unknown[]) => mockKeychainSet(...args),
  keychainGet: (...args: unknown[]) => mockKeychainGet(...args),
  keychainDelete: (...args: unknown[]) => mockKeychainDelete(...args),
  keychainExists: (...args: unknown[]) => mockKeychainExists(...args),
  readClaudeCodeCredential: (...args: unknown[]) => mockReadClaudeCodeCredential(...args),
  writeClaudeCodeCredential: (...args: unknown[]) => mockWriteClaudeCodeCredential(...args),
}));

// Mock execFileSync and spawnSync (used directly by accountAdd/accountRotate)
const mockExecFileSync = vi.fn();
const mockSpawnSync = vi.fn();

vi.mock('node:child_process', () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
  spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
}));

const { runAccount } = await import('../../cli/commands/account.js');

describe('runAccount', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: any;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as any);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    vi.resetAllMocks();
    process.env = { ...originalEnv };
  });

  // --- help ---

  describe('help', () => {
    it('prints help with no subcommand', () => {
      runAccount([]);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('reagent account'));
    });

    it('prints help with --help flag', () => {
      runAccount(['--help']);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Subcommands:'));
    });

    it('prints help with help subcommand', () => {
      runAccount(['help']);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('reagent account'));
    });
  });

  // --- unknown subcommand ---

  describe('unknown subcommand', () => {
    it('prints error and exits for unknown subcommand', () => {
      expect(() => runAccount(['bogus'])).toThrow('process.exit(1)');
      expect(errorSpy).toHaveBeenCalledWith('Unknown account subcommand: bogus');
    });
  });

  // --- env ---

  describe('env', () => {
    it('outputs export statements for a valid account', () => {
      mockLoadAccounts.mockReturnValue({
        version: '1',
        accounts: {
          'my-acct': {
            credential_store: 'keychain',
            keychain_service: 'reagent-my-acct',
          },
        },
      });
      mockKeychainGet.mockReturnValue({
        accessToken: 'tok-abc-123',
        refreshToken: 'ref-xyz',
      });

      runAccount(['env', 'my-acct']);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain("export CLAUDE_CODE_OAUTH_TOKEN='tok-abc-123'");
      expect(output).toContain("export CLAUDE_CODE_OAUTH_REFRESH_TOKEN='ref-xyz'");
      expect(output).toContain("export REAGENT_ACCOUNT='my-acct'");
    });

    it('omits refresh token export when not present', () => {
      mockLoadAccounts.mockReturnValue({
        version: '1',
        accounts: {
          'no-ref': {
            credential_store: 'keychain',
            keychain_service: 'reagent-no-ref',
          },
        },
      });
      mockKeychainGet.mockReturnValue({
        accessToken: 'tok-only',
      });

      runAccount(['env', 'no-ref']);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).not.toContain('CLAUDE_CODE_OAUTH_REFRESH_TOKEN');
    });

    it('outputs unset commands with --clear flag', () => {
      runAccount(['env', '--clear']);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('unset CLAUDE_CODE_OAUTH_TOKEN');
      expect(output).toContain('unset CLAUDE_CODE_OAUTH_REFRESH_TOKEN');
      expect(output).toContain('unset REAGENT_ACCOUNT');
    });

    it('exits with error when no account name provided', () => {
      expect(() => runAccount(['env'])).toThrow('process.exit(1)');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    });

    it('exits with error when account not found', () => {
      mockLoadAccounts.mockReturnValue({ version: '1', accounts: {} });

      expect(() => runAccount(['env', 'missing'])).toThrow('process.exit(1)');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });

    it('exits with error when keychain credential is missing', () => {
      mockLoadAccounts.mockReturnValue({
        version: '1',
        accounts: {
          broken: {
            credential_store: 'keychain',
            keychain_service: 'reagent-broken',
          },
        },
      });
      mockKeychainGet.mockReturnValue(null);

      expect(() => runAccount(['env', 'broken'])).toThrow('process.exit(1)');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('No credential found'));
    });

    it('escapes single quotes in token values', () => {
      mockLoadAccounts.mockReturnValue({
        version: '1',
        accounts: {
          quoted: {
            credential_store: 'keychain',
            keychain_service: 'reagent-quoted',
          },
        },
      });
      mockKeychainGet.mockReturnValue({
        accessToken: "tok'with'quotes",
      });

      runAccount(['env', 'quoted']);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain("tok'\\''with'\\''quotes");
    });
  });

  // --- list ---

  describe('list', () => {
    it('shows empty state when no accounts registered', () => {
      mockLoadAccounts.mockReturnValue({ version: '1', accounts: {} });

      runAccount(['list']);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No accounts registered');
    });

    it('lists accounts with keychain status', () => {
      mockLoadAccounts.mockReturnValue({
        version: '1',
        accounts: {
          'clarity-house': {
            description: 'Clarity House',
            credential_store: 'keychain',
            keychain_service: 'reagent-clarity-house',
          },
          personal: {
            credential_store: 'keychain',
            keychain_service: 'reagent-personal',
          },
        },
      });
      mockKeychainExists.mockReturnValue(true);

      runAccount(['list']);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('clarity-house');
      expect(output).toContain('personal');
      expect(output).toContain('keychain ok');
    });

    it('shows active indicator for REAGENT_ACCOUNT', () => {
      process.env.REAGENT_ACCOUNT = 'personal';
      mockLoadAccounts.mockReturnValue({
        version: '1',
        accounts: {
          personal: {
            credential_store: 'keychain',
            keychain_service: 'reagent-personal',
          },
        },
      });
      mockKeychainExists.mockReturnValue(true);

      runAccount(['list']);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('* personal');
      expect(output).toContain('(active)');
    });

    it('shows missing keychain status', () => {
      mockLoadAccounts.mockReturnValue({
        version: '1',
        accounts: {
          broken: {
            credential_store: 'keychain',
            keychain_service: 'reagent-broken',
          },
        },
      });
      mockKeychainExists.mockReturnValue(false);

      runAccount(['list']);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('keychain MISSING');
    });

    it('shows no active account message when REAGENT_ACCOUNT is unset', () => {
      delete process.env.REAGENT_ACCOUNT;
      mockLoadAccounts.mockReturnValue({
        version: '1',
        accounts: {
          personal: {
            credential_store: 'keychain',
            keychain_service: 'reagent-personal',
          },
        },
      });
      mockKeychainExists.mockReturnValue(true);

      runAccount(['list']);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No account active');
    });

    it('shows description when provided', () => {
      mockLoadAccounts.mockReturnValue({
        version: '1',
        accounts: {
          'my-acct': {
            description: 'My test description',
            credential_store: 'keychain',
            keychain_service: 'reagent-my',
          },
        },
      });
      mockKeychainExists.mockReturnValue(true);

      runAccount(['list']);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('My test description');
    });
  });

  // --- whoami ---

  describe('whoami', () => {
    it('shows no active account when neither env var is set', () => {
      delete process.env.REAGENT_ACCOUNT;
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN;

      runAccount(['whoami']);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No reagent account active');
      expect(output).toContain('Claude Code default');
    });

    it('shows active account details with token preview', () => {
      process.env.REAGENT_ACCOUNT = 'clarity-house';
      process.env.CLAUDE_CODE_OAUTH_TOKEN = 'abcdefghijklmnop1234';
      mockLoadAccounts.mockReturnValue({
        version: '1',
        accounts: {
          'clarity-house': {
            description: 'Clarity House org',
            credential_store: 'keychain',
            keychain_service: 'reagent-clarity-house',
          },
        },
      });

      runAccount(['whoami']);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Account:  clarity-house');
      expect(output).toContain('Billing:  Clarity House org');
      expect(output).toContain('abcdefghijkl...1234');
      expect(output).toContain('Active');
    });

    it('shows unknown account when only CLAUDE_CODE_OAUTH_TOKEN is set', () => {
      delete process.env.REAGENT_ACCOUNT;
      process.env.CLAUDE_CODE_OAUTH_TOKEN = 'some-token-value';

      runAccount(['whoami']);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('REAGENT_ACCOUNT is not');
      expect(output).toContain('unknown account');
    });

    it('shows no description placeholder when account has none', () => {
      process.env.REAGENT_ACCOUNT = 'no-desc';
      process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok-1234567890abcdef';
      mockLoadAccounts.mockReturnValue({
        version: '1',
        accounts: {
          'no-desc': {
            credential_store: 'keychain',
            keychain_service: 'reagent-no-desc',
          },
        },
      });

      runAccount(['whoami']);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('(no description)');
    });
  });

  // --- check ---

  describe('check', () => {
    it('shows no accounts when --all and none registered', () => {
      mockLoadAccounts.mockReturnValue({ version: '1', accounts: {} });

      runAccount(['check', '--all']);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No accounts registered');
    });

    it('shows no active account when not using --all and no REAGENT_ACCOUNT', () => {
      delete process.env.REAGENT_ACCOUNT;
      mockLoadAccounts.mockReturnValue({
        version: '1',
        accounts: { x: { credential_store: 'keychain', keychain_service: 's' } },
      });

      runAccount(['check']);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No active account');
    });

    it('reports ok status for valid non-expired token', () => {
      process.env.REAGENT_ACCOUNT = 'good';
      mockLoadAccounts.mockReturnValue({
        version: '1',
        accounts: {
          good: {
            credential_store: 'keychain',
            keychain_service: 'reagent-good',
          },
        },
      });
      mockKeychainGet.mockReturnValue({
        accessToken: 'abcdefghijklmnop1234',
        refreshToken: 'ref-tok',
        expiresAt: '2099-12-31T00:00:00Z',
      });

      runAccount(['check']);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('+ good: ok');
      expect(output).toContain('Refresh: present');
    });

    it('reports EXPIRED for expired token', () => {
      process.env.REAGENT_ACCOUNT = 'expired';
      mockLoadAccounts.mockReturnValue({
        version: '1',
        accounts: {
          expired: {
            credential_store: 'keychain',
            keychain_service: 'reagent-expired',
          },
        },
      });
      mockKeychainGet.mockReturnValue({
        accessToken: 'abcdefghijklmnop1234',
        expiresAt: '2020-01-01T00:00:00Z',
      });

      runAccount(['check']);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('! expired: EXPIRED');
      expect(output).toContain('(EXPIRED)');
    });

    it('reports MISSING when keychain entry is gone', () => {
      process.env.REAGENT_ACCOUNT = 'gone';
      mockLoadAccounts.mockReturnValue({
        version: '1',
        accounts: {
          gone: {
            credential_store: 'keychain',
            keychain_service: 'reagent-gone',
          },
        },
      });
      mockKeychainGet.mockReturnValue(null);

      runAccount(['check']);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('! gone: keychain entry MISSING');
    });

    it('checks all accounts with --all flag', () => {
      mockLoadAccounts.mockReturnValue({
        version: '1',
        accounts: {
          alpha: {
            credential_store: 'keychain',
            keychain_service: 'reagent-alpha',
          },
          beta: {
            credential_store: 'keychain',
            keychain_service: 'reagent-beta',
          },
        },
      });
      mockKeychainGet.mockReturnValue({
        accessToken: 'abcdefghijklmnop1234',
        refreshToken: 'ref',
        expiresAt: '2099-12-31T00:00:00Z',
      });

      runAccount(['check', '--all']);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('alpha');
      expect(output).toContain('beta');
    });

    it('reports not found for account in name list but not in config', () => {
      process.env.REAGENT_ACCOUNT = 'phantom';
      mockLoadAccounts.mockReturnValue({ version: '1', accounts: {} });

      runAccount(['check']);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('! phantom: not found in accounts.yaml');
    });

    it('reports NO TOKEN when accessToken is empty', () => {
      process.env.REAGENT_ACCOUNT = 'empty-tok';
      mockLoadAccounts.mockReturnValue({
        version: '1',
        accounts: {
          'empty-tok': {
            credential_store: 'keychain',
            keychain_service: 'reagent-empty-tok',
          },
        },
      });
      mockKeychainGet.mockReturnValue({
        accessToken: '',
      });

      runAccount(['check']);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('! empty-tok: NO TOKEN');
    });

    it('shows Refresh: none when no refresh token', () => {
      process.env.REAGENT_ACCOUNT = 'no-ref';
      mockLoadAccounts.mockReturnValue({
        version: '1',
        accounts: {
          'no-ref': {
            credential_store: 'keychain',
            keychain_service: 'reagent-no-ref',
          },
        },
      });
      mockKeychainGet.mockReturnValue({
        accessToken: 'abcdefghijklmnop1234',
      });

      runAccount(['check']);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Refresh: none');
    });
  });

  // --- remove ---

  describe('remove', () => {
    it('exits with error when no name provided', () => {
      expect(() => runAccount(['remove'])).toThrow('process.exit(1)');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    });

    it('exits with error when account not found', () => {
      mockLoadAccounts.mockReturnValue({ version: '1', accounts: {} });

      expect(() => runAccount(['remove', 'ghost'])).toThrow('process.exit(1)');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });

    it('deletes keychain entry and removes config', () => {
      mockLoadAccounts.mockReturnValue({
        version: '1',
        accounts: {
          target: {
            credential_store: 'keychain',
            keychain_service: 'reagent-target',
          },
        },
      });
      mockKeychainDelete.mockReturnValue(true);

      runAccount(['remove', 'target']);

      expect(mockKeychainDelete).toHaveBeenCalledWith('reagent-target');
      expect(mockRemoveAccountConfig).toHaveBeenCalledWith('target');
      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Deleted keychain entry');
      expect(output).toContain('Removed "target"');
    });

    it('handles missing keychain entry gracefully', () => {
      mockLoadAccounts.mockReturnValue({
        version: '1',
        accounts: {
          target: {
            credential_store: 'keychain',
            keychain_service: 'reagent-target',
          },
        },
      });
      mockKeychainDelete.mockReturnValue(false);

      runAccount(['remove', 'target']);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No keychain entry found');
    });

    it('warns when removing the currently active account', () => {
      process.env.REAGENT_ACCOUNT = 'active-one';
      mockLoadAccounts.mockReturnValue({
        version: '1',
        accounts: {
          'active-one': {
            credential_store: 'keychain',
            keychain_service: 'reagent-active-one',
          },
        },
      });
      mockKeychainDelete.mockReturnValue(true);

      runAccount(['remove', 'active-one']);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('currently active');
      expect(output).toContain('env --clear');
    });
  });

  // --- setup-shell ---

  describe('setup-shell', () => {
    it('outputs zsh/bash setup by default', () => {
      runAccount(['setup-shell']);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('rswitch()');
      expect(output).toContain('~/.zshrc');
    });

    it('outputs zsh/bash setup with --shell zsh', () => {
      runAccount(['setup-shell', '--shell', 'zsh']);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('rswitch()');
    });

    it('outputs bash setup with --shell bash', () => {
      runAccount(['setup-shell', '--shell', 'bash']);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('rswitch()');
      expect(output).toContain('BASH_VERSION');
    });

    it('outputs fish setup with --shell fish', () => {
      runAccount(['setup-shell', '--shell', 'fish']);

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('function rswitch');
      expect(output).toContain('config.fish');
    });

    it('exits with error for unsupported shell', () => {
      expect(() => runAccount(['setup-shell', '--shell', 'powershell'])).toThrow('process.exit(1)');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Unsupported shell'));
    });
  });

  // --- add (input validation only, full flow requires interactive stdin) ---

  describe('add', () => {
    it('exits with error when no name provided', () => {
      expect(() => runAccount(['add'])).toThrow('process.exit(1)');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    });

    it('exits with error for invalid account name (uppercase)', () => {
      expect(() => runAccount(['add', 'MyAccount'])).toThrow('process.exit(1)');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('lowercase alphanumeric'));
    });

    it('exits with error for invalid account name (starts with hyphen)', () => {
      expect(() => runAccount(['add', '-bad-name'])).toThrow('process.exit(1)');
    });

    it('exits with error for invalid account name (special chars)', () => {
      expect(() => runAccount(['add', 'bad_name'])).toThrow('process.exit(1)');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('lowercase alphanumeric'));
    });

    it('exits with error if account already exists', () => {
      mockLoadAccounts.mockReturnValue({
        version: '1',
        accounts: {
          existing: {
            credential_store: 'keychain',
            keychain_service: 'reagent-existing',
          },
        },
      });

      expect(() => runAccount(['add', 'existing'])).toThrow('process.exit(1)');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('already exists'));
    });
  });

  // --- rotate (input validation) ---

  describe('rotate', () => {
    it('exits with error when no name provided', () => {
      expect(() => runAccount(['rotate'])).toThrow('process.exit(1)');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    });

    it('exits with error when account not found', () => {
      mockLoadAccounts.mockReturnValue({ version: '1', accounts: {} });

      expect(() => runAccount(['rotate', 'ghost'])).toThrow('process.exit(1)');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });
  });
});
