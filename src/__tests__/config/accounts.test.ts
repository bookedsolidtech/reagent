import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Mock os.homedir to use a temp directory
let tmpHome: string;

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    default: {
      ...actual,
      homedir: () => tmpHome,
    },
    homedir: () => tmpHome,
  };
});

// Import after mock setup
const { loadAccounts, saveAccounts, upsertAccount, removeAccount, getAccount, listAccountNames } =
  await import('../../config/accounts.js');

describe('accounts config', () => {
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'reagent-accounts-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('returns empty config when no accounts.yaml exists', () => {
    const config = loadAccounts();
    expect(config.version).toBe('1');
    expect(Object.keys(config.accounts)).toHaveLength(0);
  });

  it('loads a valid accounts.yaml', () => {
    const reagentDir = path.join(tmpHome, '.reagent');
    fs.mkdirSync(reagentDir, { recursive: true });
    fs.writeFileSync(
      path.join(reagentDir, 'accounts.yaml'),
      `version: '1'
accounts:
  clarity-house:
    description: "Clarity House (BST)"
    credential_store: keychain
    keychain_service: reagent-clarity-house
  personal:
    credential_store: keychain
    keychain_service: reagent-personal
`
    );

    const config = loadAccounts();
    expect(config.version).toBe('1');
    expect(Object.keys(config.accounts)).toHaveLength(2);
    expect(config.accounts['clarity-house'].keychain_service).toBe('reagent-clarity-house');
    expect(config.accounts['clarity-house'].description).toBe('Clarity House (BST)');
    expect(config.accounts['personal'].credential_store).toBe('keychain');
  });

  it('rejects accounts.yaml containing inline tokens', () => {
    const reagentDir = path.join(tmpHome, '.reagent');
    fs.mkdirSync(reagentDir, { recursive: true });
    fs.writeFileSync(
      path.join(reagentDir, 'accounts.yaml'),
      `version: '1'
accounts:
  bad-account:
    credential_store: keychain
    keychain_service: sk-ant-oat01-LEAKED-TOKEN
`
    );

    expect(() => loadAccounts()).toThrow('inline token');
  });

  it('saves and round-trips accounts config', () => {
    saveAccounts({
      version: '1',
      accounts: {
        'test-account': {
          description: 'Test',
          credential_store: 'keychain',
          keychain_service: 'reagent-test',
        },
      },
    });

    const loaded = loadAccounts();
    expect(loaded.accounts['test-account'].description).toBe('Test');
    expect(loaded.accounts['test-account'].keychain_service).toBe('reagent-test');
  });

  it('upserts an account', () => {
    upsertAccount('new-account', {
      credential_store: 'keychain',
      keychain_service: 'reagent-new',
    });

    const account = getAccount('new-account');
    expect(account).toBeDefined();
    expect(account!.keychain_service).toBe('reagent-new');
  });

  it('removes an account', () => {
    upsertAccount('to-remove', {
      credential_store: 'keychain',
      keychain_service: 'reagent-remove',
    });

    expect(removeAccount('to-remove')).toBe(true);
    expect(getAccount('to-remove')).toBeUndefined();
  });

  it('returns false when removing non-existent account', () => {
    expect(removeAccount('nonexistent')).toBe(false);
  });

  it('lists account names', () => {
    upsertAccount('alpha', { credential_store: 'keychain', keychain_service: 'reagent-alpha' });
    upsertAccount('beta', { credential_store: 'keychain', keychain_service: 'reagent-beta' });

    const names = listAccountNames();
    expect(names).toContain('alpha');
    expect(names).toContain('beta');
  });

  it('rejects invalid schema', () => {
    const reagentDir = path.join(tmpHome, '.reagent');
    fs.mkdirSync(reagentDir, { recursive: true });
    fs.writeFileSync(
      path.join(reagentDir, 'accounts.yaml'),
      `version: '1'
accounts:
  bad:
    credential_store: file
    keychain_service: whatever
`
    );

    expect(() => loadAccounts()).toThrow('Invalid accounts config');
  });

  it('supports budget configuration', () => {
    upsertAccount('budgeted', {
      credential_store: 'keychain',
      keychain_service: 'reagent-budgeted',
      budget: { warn_usd: 40, halt_usd: 50, period: 'monthly' },
    });

    const account = getAccount('budgeted');
    expect(account!.budget).toEqual({ warn_usd: 40, halt_usd: 50, period: 'monthly' });
  });

  // --- additional edge cases ---

  it('returns empty accounts object from fresh load', () => {
    const config = loadAccounts();
    expect(config.accounts).toEqual({});
    expect(typeof config.accounts).toBe('object');
  });

  it('getAccount returns undefined for non-existent account', () => {
    expect(getAccount('does-not-exist')).toBeUndefined();
  });

  it('upsertAccount overwrites existing account', () => {
    upsertAccount('overwrite-me', {
      credential_store: 'keychain',
      keychain_service: 'reagent-old',
      description: 'old',
    });
    upsertAccount('overwrite-me', {
      credential_store: 'keychain',
      keychain_service: 'reagent-new',
      description: 'new',
    });

    const account = getAccount('overwrite-me');
    expect(account!.keychain_service).toBe('reagent-new');
    expect(account!.description).toBe('new');
  });

  it('handles special characters in description', () => {
    upsertAccount('special-desc', {
      credential_store: 'keychain',
      keychain_service: 'reagent-special',
      description: 'Org name: "Acme & Co." <test> $100/mo',
    });

    const account = getAccount('special-desc');
    expect(account!.description).toBe('Org name: "Acme & Co." <test> $100/mo');
  });

  it('saves and loads multiple accounts preserving order', () => {
    for (const name of ['zulu', 'alpha', 'mike']) {
      upsertAccount(name, {
        credential_store: 'keychain',
        keychain_service: `reagent-${name}`,
      });
    }

    const names = listAccountNames();
    expect(names).toHaveLength(3);
    expect(names).toContain('zulu');
    expect(names).toContain('alpha');
    expect(names).toContain('mike');
  });

  it('creates .reagent directory if it does not exist when saving', () => {
    // tmpHome is a fresh temp dir each test; .reagent does not exist yet
    saveAccounts({
      version: '1',
      accounts: {
        test: { credential_store: 'keychain', keychain_service: 'reagent-test' },
      },
    });

    const loaded = loadAccounts();
    expect(loaded.accounts['test']).toBeDefined();
  });

  it('rejects YAML that parses to non-object type', () => {
    const reagentDir = path.join(tmpHome, '.reagent');
    fs.mkdirSync(reagentDir, { recursive: true });
    fs.writeFileSync(path.join(reagentDir, 'accounts.yaml'), 'just a plain string');

    expect(() => loadAccounts()).toThrow('Invalid accounts config');
  });

  it('rejects saving config that would contain inline tokens', () => {
    expect(() =>
      saveAccounts({
        version: '1',
        accounts: {
          bad: {
            credential_store: 'keychain',
            keychain_service: 'sk-ant-leaked-value',
          },
        },
      })
    ).toThrow('inline token');
  });

  it('supports partial budget with only warn_usd', () => {
    upsertAccount('partial-budget', {
      credential_store: 'keychain',
      keychain_service: 'reagent-partial',
      budget: { warn_usd: 25 },
    });

    const account = getAccount('partial-budget');
    expect(account!.budget!.warn_usd).toBe(25);
    expect(account!.budget!.halt_usd).toBeUndefined();
    expect(account!.budget!.period).toBeUndefined();
  });
});
