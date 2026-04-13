import { execFileSync } from 'node:child_process';
import type { AccountCredential } from '../types/accounts.js';

const KEYCHAIN_ACCOUNT = 'reagent';

/**
 * Store a credential blob in macOS Keychain under a reagent-namespaced service.
 */
export function keychainSet(service: string, credential: AccountCredential): void {
  const data = JSON.stringify(credential);

  // Delete existing entry first (ignore errors if it doesn't exist)
  try {
    execFileSync('security', ['delete-generic-password', '-s', service, '-a', KEYCHAIN_ACCOUNT], {
      stdio: 'pipe',
    });
  } catch {
    // Entry doesn't exist yet — that's fine
  }

  execFileSync(
    'security',
    ['add-generic-password', '-s', service, '-a', KEYCHAIN_ACCOUNT, '-w', data, '-U'],
    { stdio: 'pipe' }
  );
}

/**
 * Retrieve a credential blob from macOS Keychain.
 */
export function keychainGet(service: string): AccountCredential | null {
  try {
    const raw = execFileSync(
      'security',
      ['find-generic-password', '-s', service, '-a', KEYCHAIN_ACCOUNT, '-w'],
      { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' }
    );
    return JSON.parse(raw.trim()) as AccountCredential;
  } catch {
    return null;
  }
}

/**
 * Delete a credential from macOS Keychain.
 */
export function keychainDelete(service: string): boolean {
  try {
    execFileSync('security', ['delete-generic-password', '-s', service, '-a', KEYCHAIN_ACCOUNT], {
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a credential exists in macOS Keychain.
 */
export function keychainExists(service: string): boolean {
  try {
    execFileSync(
      'security',
      ['find-generic-password', '-s', service, '-a', KEYCHAIN_ACCOUNT],
      { stdio: 'pipe' }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Read Claude Code's own keychain credential.
 */
export function readClaudeCodeCredential(): AccountCredential | null {
  try {
    const raw = execFileSync(
      'security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' }
    );
    const parsed = JSON.parse(raw.trim());
    // Claude Code stores {oauth_token, refresh_token, expiry, ...} — normalize to our shape
    return {
      accessToken: parsed.oauth_token || parsed.accessToken,
      refreshToken: parsed.refresh_token || parsed.refreshToken,
      expiresAt: parsed.expiry || parsed.expiresAt,
      scopes: parsed.scopes,
    };
  } catch {
    return null;
  }
}

/**
 * Write back a credential to Claude Code's own keychain entry.
 */
export function writeClaudeCodeCredential(data: string): void {
  try {
    execFileSync(
      'security',
      ['delete-generic-password', '-s', 'Claude Code-credentials'],
      { stdio: 'pipe' }
    );
  } catch {
    // Doesn't exist yet
  }
  execFileSync(
    'security',
    ['add-generic-password', '-s', 'Claude Code-credentials', '-w', data, '-U'],
    { stdio: 'pipe' }
  );
}
