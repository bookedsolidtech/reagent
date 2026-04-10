export interface InstallResult {
  file: string;
  status: 'installed' | 'updated' | 'skipped' | 'warn';
}

export interface HookEntry {
  matcher: string;
  hooks: string[];
}

export interface HooksConfig {
  PreToolUse?: HookEntry[];
  PostToolUse?: HookEntry[];
}

export interface ClaudeMdConfig {
  preflightCmd?: string;
  attributionRule?: string;
}

export interface SecurityConfig {
  /** Controls how security findings are disclosed. Default: 'advisory'.
   *  advisory — public OSS repos: redirect to GitHub Security Advisories
   *  issues   — private repos: redirect to labeled internal issue queue
   *  disabled — no gate (not recommended)
   */
  disclosureMode?: 'advisory' | 'issues' | 'disabled';
}

export interface ProfileConfig {
  blockAiAttribution?: boolean;
  blockedPaths?: string[];
  gitignoreEntries?: string[];
  cursorRules?: string[];
  huskyCommitMsg?: boolean;
  huskyPreCommit?: boolean;
  huskyPrePush?: boolean;
  claudeHooks?: HooksConfig;
  claudeMd?: ClaudeMdConfig;
  security?: SecurityConfig;
  [key: string]: unknown;
}
