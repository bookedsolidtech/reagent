import { execFileSync, spawnSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  openSync,
  closeSync,
  unlinkSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseFlag } from '../utils.js';
import {
  loadAccounts,
  upsertAccount,
  removeAccount as removeAccountConfig,
} from '../../config/accounts.js';
import {
  keychainSet,
  keychainGet,
  keychainDelete,
  keychainExists,
  readClaudeCodeCredential,
  writeClaudeCodeCredential as writeClaudeCredential,
} from '../../platform/keychain.js';
import type { AccountCredential } from '../../types/accounts.js';

export function runAccount(args: string[]): void | Promise<void> {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === 'help' || subcommand === '--help') {
    printAccountHelp();
    return;
  }

  switch (subcommand) {
    case 'add':
      accountAdd(rest);
      break;
    case 'list':
      accountList();
      break;
    case 'env':
      accountEnv(rest);
      break;
    case 'check':
      accountCheck(rest);
      break;
    case 'verify':
      return accountVerify(rest);
    case 'whoami':
      accountWhoami();
      break;
    case 'rotate':
      accountRotate(rest);
      break;
    case 'remove':
      accountRemove(rest);
      break;
    case 'switch':
      accountSwitch(rest);
      break;
    case 'setup-shell':
      accountSetupShell(rest);
      break;
    default:
      console.error(`Unknown account subcommand: ${subcommand}`);
      printAccountHelp();
      process.exit(1);
  }
}

function printAccountHelp(): void {
  console.log(`
reagent account — Multi-credential management

Subcommands:
  add <name>          Register new account (OAuth login + keychain store)
  list                Show all accounts + which is active
  switch <name>       Write account credential into Claude Code keychain slot (survives overnight)
  switch --clear      Restore original Claude Code credential
  env <name>          Output shell export commands (env var path — expires in ~1h, no refresh)
  env --clear         Output shell unset commands
  check [--all]       Validate token health (expiry, keychain access)
  verify [--all]      Verify account identity via Anthropic API (proves billing)
  whoami              Show active account details
  rotate <name>       Re-authenticate and store new token
  remove <name>       Delete keychain entry + remove from accounts.yaml
  setup-shell         Print shell function + completions to add to ~/.zshrc

Options for setup-shell:
  --shell <zsh|bash|fish>   Target shell (default: zsh)

Examples:
  npx @bookedsolid/reagent@latest account add clarity-house
  npx @bookedsolid/reagent@latest account list
  eval "$(npx @bookedsolid/reagent@latest account env clarity-house)"
  eval "$(npx @bookedsolid/reagent@latest account env --clear)"
  npx @bookedsolid/reagent@latest account whoami
  npx @bookedsolid/reagent@latest account check --all
  npx @bookedsolid/reagent@latest account verify --all
  npx @bookedsolid/reagent@latest account rotate personal
  npx @bookedsolid/reagent@latest account remove huge-inc
  npx @bookedsolid/reagent@latest account setup-shell >> ~/.zshrc
`);
}

// --- add ---

function accountAdd(args: string[]): void {
  const name = args.find((a) => !a.startsWith('--'));
  if (!name) {
    console.error('Usage: reagent account add <name>');
    process.exit(1);
  }

  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    console.error('Account name must be lowercase alphanumeric with hyphens (e.g., clarity-house)');
    process.exit(1);
  }

  const keychainService = `reagent-${name}`;
  const config = loadAccounts();

  if (config.accounts[name]) {
    console.error(
      `Account "${name}" already exists. Use 'reagent account rotate ${name}' to re-authenticate.`
    );
    process.exit(1);
  }

  console.log(`\nRegistering account: ${name}`);
  console.log('Step 1: Backing up current Claude Code credential...');

  // Back up current Claude Code keychain credential
  let backupRaw: string | null = null;
  try {
    backupRaw = execFileSync(
      'security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' }
    ).trim();
    console.log('  Backup saved.');
  } catch {
    console.log('  No existing Claude Code credential found (first-time setup).');
  }

  console.log('\nStep 2: Opening browser for OAuth login...');
  console.log(`  Log in with the account you want to register as "${name}".`);
  console.log('  Press Enter when ready, or Ctrl+C to cancel.');

  // Wait for user confirmation
  const buf = Buffer.alloc(1);
  try {
    const fd = require('node:fs').openSync('/dev/tty', 'r');
    require('node:fs').readSync(fd, buf, 0, 1, null);
    require('node:fs').closeSync(fd);
  } catch {
    // Non-interactive — proceed anyway
  }

  // Run claude auth login with a clean env (no stale OAuth vars)
  const loginResult = spawnSync('claude', ['auth', 'login'], {
    stdio: 'inherit',
    env: buildLoginEnv(),
  });

  if (loginResult.status !== 0) {
    console.error('\nOAuth login failed or was cancelled.');
    if (backupRaw) {
      console.log('Restoring original credential...');
      writeClaudeCredential(backupRaw);
    }
    process.exit(1);
  }

  console.log('\nStep 3: Reading new credential from keychain...');
  const newCredential = readClaudeCodeCredential();
  if (!newCredential || !newCredential.accessToken) {
    console.error('Failed to read new credential from Claude Code keychain entry.');
    if (backupRaw) {
      console.log('Restoring original credential...');
      writeClaudeCredential(backupRaw);
    }
    process.exit(1);
  }

  console.log('Step 4: Storing under reagent keychain entry...');
  keychainSet(keychainService, newCredential);

  console.log('Step 5: Restoring original Claude Code credential...');
  if (backupRaw) {
    writeClaudeCredential(backupRaw);
    console.log('  Original credential restored.');
  } else {
    console.log('  No original credential to restore.');
  }

  console.log('Step 6: Updating accounts.yaml...');
  upsertAccount(name, {
    credential_store: 'keychain',
    keychain_service: keychainService,
  });

  console.log(`\nAccount "${name}" registered successfully.`);
  console.log(`\nTo switch: eval "$(npx @bookedsolid/reagent@latest account env ${name})"`);
  console.log(`Or use:    rswitch ${name}  (after running 'reagent account setup-shell')\n`);
}

// --- list ---

function accountList(): void {
  const config = loadAccounts();
  const names = Object.keys(config.accounts);
  const activeAccount = process.env.REAGENT_ACCOUNT;

  if (names.length === 0) {
    console.log('\nNo accounts registered. Run: reagent account add <name>\n');
    return;
  }

  console.log('\nRegistered accounts:\n');

  for (const name of names) {
    const acct = config.accounts[name];
    const isActive = activeAccount === name;
    const marker = isActive ? ' (active)' : '';
    const desc = acct.description ? ` — ${acct.description}` : '';
    const hasToken = keychainExists(acct.keychain_service) ? 'keychain ok' : 'keychain MISSING';

    console.log(`  ${isActive ? '*' : ' '} ${name}${marker}${desc}`);
    console.log(`    Store: ${hasToken} (${acct.keychain_service})`);
  }

  if (!activeAccount) {
    console.log('\n  No account active (using keychain default)');
  }
  console.log('');
}

// --- switch ---

function accountSwitch(args: string[]): void {
  const clearFlag = args.includes('--clear');

  // Acquire advisory lock to prevent concurrent switches from corrupting
  // credential entries (two terminals running rswitch at the same time).
  const releaseLock = acquireSwitchLock();
  if (!releaseLock) {
    console.error('Another account switch is in progress. Try again in a moment.');
    process.exit(1);
  }

  try {
    if (clearFlag) {
      const syncResult = syncBackActiveCredential();
      if (syncResult === 'skipped') {
        console.error('Warning: could not sync credential for previously active account.');
      }
      setActiveAccount(null);

      const defaultCred = keychainGet('reagent-__default__');
      if (!defaultCred) {
        console.error('No saved default credential found.');
        console.error('Run: claude auth login  to establish a default session.');
        process.exit(1);
      }
      writeClaudeCredential(JSON.stringify({ claudeAiOauth: defaultCred }));
      console.log('Restored default Claude Code credential.');
      console.log('Restart any active Claude Code sessions to pick up the change.');
      return;
    }

    const name = args.find((a) => !a.startsWith('--'));
    if (!name) {
      console.error(
        'Usage: npx @bookedsolid/reagent@latest account switch <name> | account switch --clear'
      );
      process.exit(1);
    }

    const config = loadAccounts();
    const account = config.accounts[name];
    if (!account) {
      console.error(
        `Account "${name}" not found. Run: npx @bookedsolid/reagent@latest account list`
      );
      process.exit(1);
    }

    // Sync any refreshed tokens back to the previously active account
    // before we read or overwrite anything.  This ensures that if Claude Code
    // refreshed the token since the last switch, our stored copy is up-to-date.
    const syncResult = syncBackActiveCredential();
    if (syncResult === 'skipped') {
      console.error('Warning: could not sync credential for previously active account.');
    }

    const credential = keychainGet(account.keychain_service);
    if (!credential) {
      console.error(
        `No credential found for "${name}". Run: npx @bookedsolid/reagent@latest account rotate ${name}`
      );
      process.exit(1);
    }

    if (credential.expiresAt) {
      const expiresAt =
        typeof credential.expiresAt === 'number'
          ? credential.expiresAt
          : Date.parse(String(credential.expiresAt));
      if (expiresAt < Date.now()) {
        console.error(
          `\u26A0 Token for "${name}" is EXPIRED. Run: npx @bookedsolid/reagent@latest account rotate ${name}`
        );
        process.exit(1);
      }
    }

    // Save current Claude Code credential as default — but only when we're
    // not already switched (i.e. REAGENT_ACCOUNT is unset in the shell).
    // This ensures --clear always restores the real original, not an intermediate.
    if (!process.env.REAGENT_ACCOUNT) {
      try {
        const currentRaw = execFileSync(
          'security',
          ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
          { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' }
        ).trim();
        const parsed = JSON.parse(currentRaw) as Record<string, unknown>;
        const inner =
          (parsed.claudeAiOauth as AccountCredential) ?? (parsed as unknown as AccountCredential);
        keychainSet('reagent-__default__', inner);
      } catch {
        // No existing Claude Code credential — nothing to save
      }
    }

    // Write target credential into Claude Code's keychain slot.
    // Claude Code reads from here with its normal refresh path — sessions survive overnight.
    writeClaudeCredential(JSON.stringify({ claudeAiOauth: credential }));

    setActiveAccount(name);

    console.log(`Switched to account: ${name}`);
    console.log('Restart any active Claude Code sessions to pick up the change.');
  } finally {
    releaseLock();
  }
}

// --- env ---

function accountEnv(args: string[]): void {
  const clearFlag = args.includes('--clear');

  if (clearFlag) {
    // Output unset commands
    console.log('unset CLAUDE_CODE_OAUTH_TOKEN');
    console.log('unset REAGENT_ACCOUNT');
    return;
  }

  const name = args.find((a) => !a.startsWith('--'));
  if (!name) {
    console.error(
      'Usage: npx @bookedsolid/reagent@latest account env <name> | npx @bookedsolid/reagent@latest account env --clear'
    );
    process.exit(1);
  }

  const config = loadAccounts();
  const account = config.accounts[name];
  if (!account) {
    console.error(`Account "${name}" not found. Run: npx @bookedsolid/reagent@latest account list`);
    process.exit(1);
  }

  const credential = keychainGet(account.keychain_service);
  if (!credential) {
    console.error(
      `No credential found in keychain for "${name}" (service: ${account.keychain_service})`
    );
    console.error(`Run: reagent account rotate ${name}`);
    process.exit(1);
  }

  // Output shell export commands — safe for eval
  // Note: CLAUDE_CODE_OAUTH_REFRESH_TOKEN is intentionally NOT exported.
  // Claude Code ignores it when CLAUDE_CODE_OAUTH_TOKEN is set via env var.
  console.log(`export CLAUDE_CODE_OAUTH_TOKEN='${escapeShellSingleQuote(credential.accessToken)}'`);
  console.log(`export REAGENT_ACCOUNT='${escapeShellSingleQuote(name)}'`);

  // Warn on stderr (not stdout — stdout is for eval) if token is near expiry
  if (credential.expiresAt) {
    const expiresAt =
      typeof credential.expiresAt === 'number'
        ? credential.expiresAt
        : Date.parse(credential.expiresAt);
    const minutesLeft = Math.floor((expiresAt - Date.now()) / 60000);
    if (minutesLeft < 0) {
      console.error(
        `\u26A0 Token for "${name}" is EXPIRED. Run: npx @bookedsolid/reagent@latest account rotate ${name}`
      );
    } else if (minutesLeft < 30) {
      console.error(
        `\u26A0 Token for "${name}" expires in ${minutesLeft}m. Refresh not supported via env var.`
      );
    }
  }
}

// --- check ---

function accountCheck(args: string[]): void {
  const allFlag = args.includes('--all');
  const config = loadAccounts();
  const activeAccount = process.env.REAGENT_ACCOUNT;

  const names = allFlag ? Object.keys(config.accounts) : activeAccount ? [activeAccount] : [];

  if (names.length === 0) {
    if (allFlag) {
      console.log('\nNo accounts registered.\n');
    } else {
      console.log('\nNo active account. Use --all to check all accounts.\n');
    }
    return;
  }

  console.log('\nAccount health check:\n');

  for (const name of names) {
    const account = config.accounts[name];
    if (!account) {
      console.log(`  ! ${name}: not found in accounts.yaml`);
      continue;
    }

    const credential = keychainGet(account.keychain_service);
    if (!credential) {
      console.log(`  ! ${name}: keychain entry MISSING (${account.keychain_service})`);
      continue;
    }

    const hasAccess = !!credential.accessToken;
    const hasRefresh = !!credential.refreshToken;
    const expiry = credential.expiresAt ? new Date(credential.expiresAt) : null;
    const isExpired = expiry ? expiry < new Date() : false;
    const tokenPreview = credential.accessToken
      ? `sk-ant-...${credential.accessToken.slice(-4)}`
      : 'none';

    const status = !hasAccess ? 'NO TOKEN' : isExpired ? 'EXPIRED' : 'ok';

    console.log(`  ${status === 'ok' ? '+' : '!'} ${name}: ${status}`);
    console.log(`    Token:   ${tokenPreview}`);
    console.log(`    Refresh: ${hasRefresh ? 'present' : 'none'}`);
    if (expiry) {
      console.log(`    Expires: ${expiry.toISOString()}${isExpired ? ' (EXPIRED)' : ''}`);
    }
    if (credential.subscriptionType) {
      console.log(
        `    Plan:    ${credential.subscriptionType}${credential.rateLimitTier ? ` (${credential.rateLimitTier})` : ''}`
      );
    }
  }
  console.log('');
}

// --- whoami ---

function accountWhoami(): void {
  const activeAccount = process.env.REAGENT_ACCOUNT;
  const hasEnvToken = !!process.env.CLAUDE_CODE_OAUTH_TOKEN;

  if (!activeAccount && !hasEnvToken) {
    console.log('\nNo reagent account active.');
    console.log('Using Claude Code default (keychain credential).\n');
    return;
  }

  console.log('');
  if (activeAccount) {
    const config = loadAccounts();
    const account = config.accounts[activeAccount];
    const desc = account?.description || '(no description)';

    console.log(`Account:  ${activeAccount}`);
    console.log(`Billing:  ${desc}`);

    if (hasEnvToken) {
      const token = process.env.CLAUDE_CODE_OAUTH_TOKEN!;
      const preview = `sk-ant-...${token.slice(-4)}`;
      console.log(`Token:    ${preview}`);
    }

    console.log(`Status:   Active (keychain swap via account switch)`);
  } else {
    console.log(`Token:    CLAUDE_CODE_OAUTH_TOKEN is set but REAGENT_ACCOUNT is not.`);
    console.log(`Status:   Using env var override (unknown account — token expires in ~1h)`);
  }
  console.log('');
}

// --- rotate ---

function accountRotate(args: string[]): void {
  const name = args.find((a) => !a.startsWith('--'));
  if (!name) {
    console.error('Usage: reagent account rotate <name>');
    process.exit(1);
  }

  const config = loadAccounts();
  const account = config.accounts[name];
  if (!account) {
    console.error(`Account "${name}" not found. Run: npx @bookedsolid/reagent@latest account list`);
    process.exit(1);
  }

  console.log(`\nRotating credential for: ${name}`);
  console.log('Step 1: Backing up current Claude Code credential...');

  let backupRaw: string | null = null;
  try {
    backupRaw = execFileSync(
      'security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' }
    ).trim();
  } catch {
    // No existing credential
  }

  console.log('Step 2: Opening browser for OAuth login...');
  console.log(`  Log in with the account for "${name}".`);

  const loginResult = spawnSync('claude', ['auth', 'login'], {
    stdio: 'inherit',
    env: buildLoginEnv(),
  });

  if (loginResult.status !== 0) {
    console.error('\nOAuth login failed.');
    if (backupRaw) writeClaudeCredential(backupRaw);
    process.exit(1);
  }

  const newCredential = readClaudeCodeCredential();
  if (!newCredential || !newCredential.accessToken) {
    console.error('Failed to read new credential.');
    if (backupRaw) writeClaudeCredential(backupRaw);
    process.exit(1);
  }

  console.log('Step 3: Updating keychain entry...');
  keychainSet(account.keychain_service, newCredential);

  if (backupRaw) {
    console.log('Step 4: Restoring original credential...');
    writeClaudeCredential(backupRaw);
  }

  console.log(`\nCredential for "${name}" rotated successfully.\n`);
}

// --- remove ---

function accountRemove(args: string[]): void {
  const name = args.find((a) => !a.startsWith('--'));
  if (!name) {
    console.error('Usage: reagent account remove <name>');
    process.exit(1);
  }

  const config = loadAccounts();
  const account = config.accounts[name];

  if (!account) {
    console.error(`Account "${name}" not found.`);
    process.exit(1);
  }

  // Delete keychain entry
  const deleted = keychainDelete(account.keychain_service);
  if (deleted) {
    console.log(`Deleted keychain entry: ${account.keychain_service}`);
  } else {
    console.log(`No keychain entry found for: ${account.keychain_service}`);
  }

  // Remove from config
  removeAccountConfig(name);
  console.log(`Removed "${name}" from accounts.yaml.`);

  if (process.env.REAGENT_ACCOUNT === name) {
    console.log(`\nNote: "${name}" is currently active in this shell.`);
    console.log(`Run: eval "$(npx @bookedsolid/reagent@latest account env --clear)"\n`);
  }
}

// --- setup-shell ---

function accountSetupShell(args: string[]): void {
  const shell = parseFlag(args, '--shell') || 'zsh';

  switch (shell) {
    case 'zsh':
    case 'bash':
      printBashZshSetup();
      break;
    case 'fish':
      printFishSetup();
      break;
    default:
      console.error(`Unsupported shell: ${shell}. Use zsh, bash, or fish.`);
      process.exit(1);
  }
}

function printBashZshSetup(): void {
  console.log(`# reagent multi-account switching
# Add this to your ~/.zshrc or ~/.bashrc

rswitch() {
  if [ -z "$1" ]; then
    npx @bookedsolid/reagent@latest account list
    return
  fi
  if [ "$1" = "--clear" ]; then
    npx @bookedsolid/reagent@latest account switch --clear || return 1
    unset REAGENT_ACCOUNT
    printf 'Cleared reagent account override.\\n' >&2
    return
  fi
  if npx @bookedsolid/reagent@latest account switch "$1"; then
    export REAGENT_ACCOUNT="$1"
    printf 'Switched to: %s\\n' "$REAGENT_ACCOUNT" >&2
  else
    printf 'rswitch: failed to switch to account "%s"\\n' "$1" >&2
    return 1
  fi
}

# Tab completion
if [ -n "$ZSH_VERSION" ]; then
  _rswitch() {
    local accounts
    accounts=(\${(f)"$(npx @bookedsolid/reagent@latest account list 2>/dev/null | grep '^ ' | sed 's/^[* ] //' | awk '{print $1}')"})
    compadd -- "\${accounts[@]}" --clear
  }
  compdef _rswitch rswitch
elif [ -n "$BASH_VERSION" ]; then
  _rswitch() {
    local accounts
    accounts=$(npx @bookedsolid/reagent@latest account list 2>/dev/null | grep '^ ' | sed 's/^[* ] //' | awk '{print $1}')
    COMPREPLY=( $(compgen -W "$accounts --clear" -- "\${COMP_WORDS[COMP_CWORD]}") )
  }
  complete -F _rswitch rswitch
fi

# Optional: show active account in prompt
# PROMPT='\${REAGENT_ACCOUNT:+[\\$REAGENT_ACCOUNT] }'"$PROMPT"
`);
}

function printFishSetup(): void {
  console.log(`# reagent multi-account switching for fish
# Add this to your ~/.config/fish/config.fish

function rswitch
  if test (count $argv) -eq 0
    npx @bookedsolid/reagent@latest account list
    return
  end
  if test "$argv[1]" = "--clear"
    npx @bookedsolid/reagent@latest account switch --clear; or return 1
    set -e REAGENT_ACCOUNT
    echo "Cleared reagent account override." >&2
    return
  end
  if npx @bookedsolid/reagent@latest account switch $argv[1]
    set -x REAGENT_ACCOUNT $argv[1]
    echo "Switched to: $REAGENT_ACCOUNT" >&2
  else
    echo "rswitch: failed to switch to account \\"$argv[1]\\"" >&2
    return 1
  end
end

# Tab completion
complete -c rswitch -f -a '(npx @bookedsolid/reagent@latest account list 2>/dev/null | grep "^ " | sed "s/^[* ] //" | awk "{print \\$1}")'
complete -c rswitch -f -a '--clear'
`);
}

// --- verify ---

interface OAuthProfile {
  account?: { email?: string; display_name?: string; uuid?: string };
  organization?: {
    uuid?: string;
    organization_type?: string;
    rate_limit_tier?: string;
    billing_type?: string;
    has_extra_usage_enabled?: boolean;
  };
}

async function fetchOAuthProfile(accessToken: string): Promise<OAuthProfile | null> {
  const { request } = await import('node:https');
  return new Promise((resolve) => {
    const req = request(
      'https://api.anthropic.com/api/oauth/profile',
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data) as OAuthProfile);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

function formatOrgType(orgType: string | undefined): string {
  switch (orgType) {
    case 'claude_max':
      return 'Max';
    case 'claude_pro':
      return 'Pro';
    case 'claude_team':
      return 'Team';
    case 'claude_enterprise':
      return 'Enterprise';
    default:
      return orgType || 'unknown';
  }
}

async function accountVerify(args: string[]): Promise<void> {
  const allFlag = args.includes('--all');
  const config = loadAccounts();
  const activeAccount = process.env.REAGENT_ACCOUNT;

  const names = allFlag ? Object.keys(config.accounts) : activeAccount ? [activeAccount] : [];

  if (names.length === 0) {
    if (allFlag) {
      console.log('\nNo accounts registered.\n');
    } else {
      console.log('\nNo active account. Use --all to verify all accounts.\n');
    }
    return;
  }

  console.log('\nAccount verification (via Anthropic API):\n');

  for (const name of names) {
    const account = config.accounts[name];
    if (!account) {
      console.log(`  ! ${name}: not found in accounts.yaml`);
      continue;
    }

    const credential = keychainGet(account.keychain_service);
    if (!credential) {
      console.log(`  ! ${name}: keychain entry MISSING`);
      continue;
    }

    const profile = await fetchOAuthProfile(credential.accessToken);
    if (!profile) {
      console.log(`  ! ${name}: API request failed (token may be expired)`);
      console.log(`    Run: npx @bookedsolid/reagent@latest account rotate ${name}`);
      continue;
    }

    const acct = profile.account || {};
    const org = profile.organization || {};

    console.log(`  + ${name}: VERIFIED`);
    console.log(`    Email:   ${acct.email || '?'}`);
    console.log(`    Name:    ${acct.display_name || '?'}`);
    console.log(`    Plan:    ${formatOrgType(org.organization_type)}`);
    console.log(`    Tier:    ${org.rate_limit_tier || '?'}`);
    console.log(`    Billing: ${org.billing_type || '?'}`);
  }
  console.log('');
}

// --- helpers ---

const REAGENT_DIR = join(homedir(), '.reagent');
const ACTIVE_ACCOUNT_PATH = join(REAGENT_DIR, 'active-account');
const SWITCH_LOCK_PATH = join(REAGENT_DIR, 'account-switch.lock');
const LOCK_STALE_MS = 30_000;

/** Read which account was last activated via `account switch`. */
function getActiveAccount(): string | null {
  try {
    const name = readFileSync(ACTIVE_ACCOUNT_PATH, 'utf8').trim();
    if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) return null;
    return name;
  } catch {
    return null;
  }
}

/**
 * Persist which account is currently active (null to clear).
 * Best-effort — a failure here means the next sync-back will be a no-op,
 * not that the switch itself fails.
 */
function setActiveAccount(name: string | null): void {
  try {
    mkdirSync(REAGENT_DIR, { recursive: true });
    writeFileSync(ACTIVE_ACCOUNT_PATH, name || '', 'utf8');
  } catch {
    // Best-effort — don't block the switch
  }
}

/**
 * Acquire an advisory file lock for the switch operation.
 * Uses O_EXCL (exclusive create) so a second concurrent switch gets EEXIST.
 * Returns a release function, or null if the lock could not be acquired.
 */
function acquireSwitchLock(): (() => void) | null {
  mkdirSync(REAGENT_DIR, { recursive: true });

  // Clean up stale locks from crashed processes
  try {
    const st = statSync(SWITCH_LOCK_PATH);
    if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
      unlinkSync(SWITCH_LOCK_PATH);
    }
  } catch {
    // No lock file or stat failed — fine
  }

  try {
    const fd = openSync(SWITCH_LOCK_PATH, 'wx');
    return () => {
      try {
        closeSync(fd);
      } catch {
        /* already closed */
      }
      try {
        unlinkSync(SWITCH_LOCK_PATH);
      } catch {
        /* already removed */
      }
    };
  } catch {
    return null;
  }
}

/**
 * Sync Claude Code's current keychain credential back to the previously
 * active reagent account.  Claude Code refreshes tokens in-place (new
 * access token + rotated refresh token) but only updates its own keychain
 * slot.  Without this sync, reagent's stored copy goes stale and the next
 * `account switch` writes a dead refresh token.
 *
 * Returns 'synced' if the credential was updated, 'no-op' if no active
 * account or no change detected, or 'skipped' if sync was expected but
 * could not complete (caller should warn).
 */
function syncBackActiveCredential(): 'synced' | 'no-op' | 'skipped' {
  const prevName = getActiveAccount();
  if (!prevName) return 'no-op';

  const config = loadAccounts();
  const prevAccount = config.accounts[prevName];
  if (!prevAccount) return 'skipped';

  const current = readClaudeCodeCredential();
  if (!current?.accessToken) return 'skipped';

  const stored = keychainGet(prevAccount.keychain_service);

  // Sync when Claude Code has a refresh token that differs from (or is absent in) our stored copy.
  const needsSync =
    current.refreshToken && (!stored?.refreshToken || stored.refreshToken !== current.refreshToken);

  if (needsSync) {
    keychainSet(prevAccount.keychain_service, current);
    return 'synced';
  }

  return 'no-op';
}

function escapeShellSingleQuote(s: string): string {
  return s.replace(/'/g, "'\\''");
}

/** Strip inherited OAuth env vars so `claude auth login` always starts a fresh flow. */
function buildLoginEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  delete env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN;
  delete env.CLAUDE_CODE_OAUTH_SCOPES;
  return env;
}
