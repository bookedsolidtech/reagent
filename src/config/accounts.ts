import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import type { AccountsConfig, Account } from '../types/accounts.js';

const TOKEN_PATTERN = /sk-ant-/;

const AccountBudgetSchema = z.object({
  warn_usd: z.number().optional(),
  halt_usd: z.number().optional(),
  period: z.enum(['monthly', 'weekly', 'daily']).optional(),
});

const AccountSchema = z.object({
  description: z.string().optional(),
  credential_store: z.literal('keychain'),
  keychain_service: z.string(),
  budget: AccountBudgetSchema.optional(),
});

const AccountsConfigSchema = z.object({
  version: z.string(),
  accounts: z.record(AccountSchema),
});

function getAccountsPath(): string {
  return path.join(os.homedir(), '.reagent', 'accounts.yaml');
}

/**
 * Validate that no field in the YAML contains an actual token value.
 */
function validateNoInlineTokens(raw: string): void {
  if (TOKEN_PATTERN.test(raw)) {
    throw new Error(
      'accounts.yaml contains what appears to be an inline token (sk-ant-*). ' +
        'Tokens must be stored in Keychain, never in config files.'
    );
  }
}

/**
 * Load and validate ~/.reagent/accounts.yaml.
 */
export function loadAccounts(): AccountsConfig {
  const configPath = getAccountsPath();
  if (!fs.existsSync(configPath)) {
    return { version: '1', accounts: {} };
  }

  const raw = fs.readFileSync(configPath, 'utf8');
  validateNoInlineTokens(raw);

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse accounts YAML at ${configPath}: ${err instanceof Error ? err.message : err}`
    );
  }

  try {
    return AccountsConfigSchema.parse(parsed);
  } catch (err) {
    throw new Error(
      `Invalid accounts config at ${configPath}: ${err instanceof Error ? err.message : err}`
    );
  }
}

/**
 * Save accounts config to ~/.reagent/accounts.yaml.
 */
export function saveAccounts(config: AccountsConfig): void {
  const configPath = getAccountsPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const yaml = stringifyYaml(config, { lineWidth: 120 });
  validateNoInlineTokens(yaml);
  fs.writeFileSync(configPath, yaml, 'utf8');
}

/**
 * Get a single account by name.
 */
export function getAccount(name: string): Account | undefined {
  const config = loadAccounts();
  return config.accounts[name];
}

/**
 * Add or update an account in the config.
 */
export function upsertAccount(name: string, account: Account): void {
  const config = loadAccounts();
  config.accounts[name] = account;
  saveAccounts(config);
}

/**
 * Remove an account from the config.
 */
export function removeAccount(name: string): boolean {
  const config = loadAccounts();
  if (!(name in config.accounts)) return false;
  delete config.accounts[name];
  saveAccounts(config);
  return true;
}

/**
 * List all account names.
 */
export function listAccountNames(): string[] {
  const config = loadAccounts();
  return Object.keys(config.accounts);
}
