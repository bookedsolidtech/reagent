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
  [key: string]: unknown;
}
