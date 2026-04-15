import { execFileSync } from 'node:child_process';
import { userInfo } from 'node:os';
import type { AccountCredential } from '../types/accounts.js';

const KEYCHAIN_ACCOUNT = 'reagent';

/**
 * Store a credential blob in macOS Keychain under a reagent-namespaced service.
 */
export function keychainSet(service: string, credential: AccountCredential): void {
  keychainSetRaw(service, JSON.stringify(credential));
}

/**
 * Store a raw JSON string in macOS Keychain under a reagent-namespaced service.
 * Use this to preserve the full credential blob (including fields beyond AccountCredential)
 * so that Claude Code's token refresh flow continues to work.
 */
export function keychainSetRaw(service: string, data: string): void {
  // -U provides atomic upsert — no need to delete first (avoids race window)
  execFileSync(
    'security',
    ['add-generic-password', '-s', service, '-a', KEYCHAIN_ACCOUNT, '-w', data, '-U'],
    { stdio: 'pipe' }
  );
}

/**
 * Retrieve a credential blob from macOS Keychain.
 * Returns the normalized AccountCredential (6 known fields only).
 * For the full blob, use keychainGetRaw().
 */
export function keychainGet(service: string): AccountCredential | null {
  const raw = keychainGetRaw(service);
  if (!raw) return null;
  try {
    return normalizeCredential(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Retrieve the raw JSON string from macOS Keychain.
 * Preserves all fields, including those needed for OAuth refresh.
 */
export function keychainGetRaw(service: string): string | null {
  try {
    const raw = execFileSync(
      'security',
      ['find-generic-password', '-s', service, '-a', KEYCHAIN_ACCOUNT, '-w'],
      { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' }
    );
    return raw.trim();
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
    execFileSync('security', ['find-generic-password', '-s', service, '-a', KEYCHAIN_ACCOUNT], {
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Read Claude Code's own keychain credential as a normalized AccountCredential.
 * This extracts only the 6 known fields — suitable for display and health checks.
 * For storing/switching, use readClaudeCodeCredentialRaw() to preserve all fields.
 */
export function readClaudeCodeCredential(): AccountCredential | null {
  try {
    const raw = readClaudeCodeCredentialRaw();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const inner = parsed.claudeAiOauth || parsed;
    return normalizeCredential(inner);
  } catch {
    return null;
  }
}

/**
 * Read the raw JSON string from Claude Code's keychain entry.
 * Returns the full blob (e.g., `{"claudeAiOauth": {...all fields...}}`)
 * so that token refresh metadata (tokenEndpoint, clientId, etc.) is preserved.
 */
export function readClaudeCodeCredentialRaw(): string | null {
  try {
    const raw = execFileSync(
      'security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-a', userInfo().username, '-w'],
      { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' }
    );
    return raw.trim();
  } catch {
    return null;
  }
}

/**
 * Extract the claudeAiOauth inner object from a raw Claude Code credential string.
 * Returns the full inner object as a JSON string, preserving all fields.
 *
 * @deprecated Use the raw blob directly — extracting strips sibling fields.
 */
export function extractOAuthBlob(rawCredential: string): string | null {
  try {
    const parsed = JSON.parse(rawCredential);
    const inner = parsed.claudeAiOauth || parsed;
    if (!inner || typeof inner !== 'object') return null;
    // Verify it has at least an access token
    if (!inner.accessToken && !inner.oauth_token) return null;
    return JSON.stringify(inner);
  } catch {
    return null;
  }
}

/**
 * Parse a raw credential string (which may be a full Claude Code blob
 * like `{ claudeAiOauth: { ... } }` or a bare inner object) into an
 * AccountCredential suitable for display, health checks, and env output.
 *
 * Returns null if the string cannot be parsed or lacks an access token.
 */
export function parseCredentialForDisplay(raw: string): AccountCredential | null {
  try {
    const parsed = JSON.parse(raw);
    const inner = parsed.claudeAiOauth || parsed;
    if (!inner || typeof inner !== 'object') return null;
    const cred = normalizeCredential(inner as Record<string, unknown>);
    if (!cred.accessToken) return null;
    return cred;
  } catch {
    return null;
  }
}

/**
 * Validate that a raw credential string contains an access token.
 * Does not extract or transform — just confirms viability.
 */
export function rawCredentialHasToken(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw);
    const inner = parsed.claudeAiOauth || parsed;
    return !!(inner?.accessToken || inner?.oauth_token);
  } catch {
    return false;
  }
}

/**
 * Ensure a raw credential string has the `claudeAiOauth` wrapper that
 * Claude Code expects. Pre-fix keychain entries may store the bare inner
 * object — this re-wraps them so token refresh works.
 */
export function ensureClaudeCodeWrapper(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (parsed.claudeAiOauth) return raw;
    if (parsed.accessToken || parsed.oauth_token) {
      return JSON.stringify({ claudeAiOauth: parsed });
    }
    return raw;
  } catch {
    return raw;
  }
}

/**
 * Normalize any credential-like object into the known AccountCredential fields.
 * Used for display, health checks, and env output — NOT for storage.
 */
function normalizeCredential(inner: Record<string, unknown>): AccountCredential {
  return {
    accessToken: (inner.accessToken || inner.oauth_token) as string,
    refreshToken: (inner.refreshToken || inner.refresh_token) as string | undefined,
    expiresAt: (inner.expiresAt || inner.expiry) as string | number | undefined,
    scopes: inner.scopes as string[] | undefined,
    subscriptionType: inner.subscriptionType as string | undefined,
    rateLimitTier: inner.rateLimitTier as string | undefined,
  };
}

/**
 * Write back a credential to Claude Code's own keychain entry.
 *
 * Claude Code stores its credential with `-a <os-username>`.
 * macOS `security add-generic-password` requires `-a`, so we
 * use the current OS username to match Claude Code's convention.
 */
export function writeClaudeCodeCredential(data: string): void {
  const account = userInfo().username;
  // -U provides atomic upsert — no need to delete first (avoids race window)
  execFileSync(
    'security',
    ['add-generic-password', '-s', 'Claude Code-credentials', '-a', account, '-w', data, '-U'],
    { stdio: 'pipe' }
  );
}
