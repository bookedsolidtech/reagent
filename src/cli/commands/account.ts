import { execFileSync, spawnSync } from 'node:child_process';
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

export function runAccount(args: string[]): void {
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
    case 'whoami':
      accountWhoami();
      break;
    case 'rotate':
      accountRotate(rest);
      break;
    case 'remove':
      accountRemove(rest);
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
  env <name>          Output shell export commands (for rswitch/eval)
  env --clear         Output shell unset commands
  check [--all]       Validate token health (expiry, keychain access)
  whoami              Show active account details
  rotate <name>       Re-authenticate and store new token
  remove <name>       Delete keychain entry + remove from accounts.yaml
  setup-shell         Print shell function + completions to add to ~/.zshrc

Options for setup-shell:
  --shell <zsh|bash|fish>   Target shell (default: zsh)

Examples:
  reagent account add clarity-house
  reagent account list
  eval "$(reagent account env clarity-house)"
  eval "$(reagent account env --clear)"
  reagent account whoami
  reagent account check --all
  reagent account rotate personal
  reagent account remove huge-inc
  reagent account setup-shell >> ~/.zshrc
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

  // Run claude auth login
  const loginResult = spawnSync('claude', ['auth', 'login'], {
    stdio: 'inherit',
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
  console.log(`\nTo switch: eval "$(reagent account env ${name})"`);
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

// --- env ---

function accountEnv(args: string[]): void {
  const clearFlag = args.includes('--clear');

  if (clearFlag) {
    // Output unset commands
    console.log('unset CLAUDE_CODE_OAUTH_TOKEN');
    console.log('unset CLAUDE_CODE_OAUTH_REFRESH_TOKEN');
    console.log('unset REAGENT_ACCOUNT');
    return;
  }

  const name = args.find((a) => !a.startsWith('--'));
  if (!name) {
    console.error('Usage: reagent account env <name> | reagent account env --clear');
    process.exit(1);
  }

  const config = loadAccounts();
  const account = config.accounts[name];
  if (!account) {
    console.error(`Account "${name}" not found. Run: reagent account list`);
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
  console.log(`export CLAUDE_CODE_OAUTH_TOKEN='${escapeShellSingleQuote(credential.accessToken)}'`);
  if (credential.refreshToken) {
    console.log(
      `export CLAUDE_CODE_OAUTH_REFRESH_TOKEN='${escapeShellSingleQuote(credential.refreshToken)}'`
    );
  }
  console.log(`export REAGENT_ACCOUNT='${escapeShellSingleQuote(name)}'`);
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

    console.log(`Status:   Active (via CLAUDE_CODE_OAUTH_TOKEN env var)`);
  } else {
    console.log(`Token:    CLAUDE_CODE_OAUTH_TOKEN is set but REAGENT_ACCOUNT is not.`);
    console.log(`Status:   Using env var override (unknown account)`);
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
    console.error(`Account "${name}" not found. Run: reagent account list`);
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
    console.log(`Run: eval "$(reagent account env --clear)"\n`);
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
    reagent account list
    return
  fi
  if [ "$1" = "--clear" ]; then
    eval "$(reagent account env --clear)"
    printf 'Cleared reagent account override.\\n' >&2
    return
  fi
  local output
  output="$(reagent account env "$1" 2>/dev/null)"
  if [[ $? -ne 0 || -z "$output" ]]; then
    printf 'rswitch: failed to load account "%s"\\n' "$1" >&2
    return 1
  fi
  eval "$output"
  printf 'Switched to: %s\\n' "$REAGENT_ACCOUNT" >&2
}

# Tab completion
if [ -n "$ZSH_VERSION" ]; then
  _rswitch() {
    local accounts
    accounts=(\${(f)"$(reagent account list 2>/dev/null | grep '^ ' | sed 's/^[* ] //' | awk '{print $1}')"})
    compadd -- "\${accounts[@]}" --clear
  }
  compdef _rswitch rswitch
elif [ -n "$BASH_VERSION" ]; then
  _rswitch() {
    local accounts
    accounts=$(reagent account list 2>/dev/null | grep '^ ' | sed 's/^[* ] //' | awk '{print $1}')
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
    reagent account list
    return
  end
  if test "$argv[1]" = "--clear"
    eval (reagent account env --clear)
    echo "Cleared reagent account override." >&2
    return
  end
  set -l output (reagent account env $argv[1] 2>/dev/null)
  if test $status -ne 0; or test -z "$output"
    echo "rswitch: failed to load account \\"$argv[1]\\"" >&2
    return 1
  end
  eval $output
  echo "Switched to: $REAGENT_ACCOUNT" >&2
end

# Tab completion
complete -c rswitch -f -a '(reagent account list 2>/dev/null | grep "^ " | sed "s/^[* ] //" | awk "{print \\$1}")'
complete -c rswitch -f -a '--clear'
`);
}

// --- helpers ---

function escapeShellSingleQuote(s: string): string {
  return s.replace(/'/g, "'\\''");
}
