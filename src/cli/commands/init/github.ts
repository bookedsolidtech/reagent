import { execFileSync } from 'node:child_process';
import { GitHubBridge } from '../../../pm/github-bridge.js';
import type { InstallResult } from './types.js';

const DEFAULT_LABELS = [
  { name: 'reagent:task', color: '0075ca', description: 'Tracked by reagent' },
  { name: 'reagent:critical', color: 'd73a4a', description: 'Critical priority reagent task' },
  { name: 'reagent:blocked', color: 'e4e669', description: 'Blocked reagent task' },
];

const DEFAULT_TOPICS = ['reagent', 'ai-governance', 'claude-code'];

/**
 * Check whether gh auth is available and authenticated.
 */
function isGhAvailable(): boolean {
  try {
    execFileSync('gh', ['auth', 'status'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

export interface GitHubInitOptions {
  targetDir: string;
  description?: string;
  topics?: string[];
  dryRun?: boolean;
}

/**
 * Install GitHub repo scaffolding: labels, topics, description.
 * Skips gracefully if gh CLI is not available or not authenticated.
 */
export function installGitHub(options: GitHubInitOptions): InstallResult[] {
  const { targetDir, description, topics, dryRun = false } = options;
  const results: InstallResult[] = [];

  // Graceful skip if gh CLI not available
  if (!isGhAvailable()) {
    results.push({
      file: 'GitHub repo scaffold (gh CLI not available — skipped)',
      status: 'skipped',
    });
    return results;
  }

  if (dryRun) {
    results.push({
      file: 'GitHub: labels (reagent:task, reagent:critical, reagent:blocked)',
      status: 'installed',
    });
    results.push({
      file: 'GitHub: topics (reagent, ai-governance, claude-code)',
      status: 'installed',
    });
    if (description) {
      results.push({ file: 'GitHub: description', status: 'installed' });
    }
    return results;
  }

  const bridge = new GitHubBridge({ baseDir: targetDir });
  const allTopics = [...DEFAULT_TOPICS, ...(topics ?? [])];

  const scaffoldResult = bridge.scaffoldRepo({
    description,
    topics: allTopics,
    labels: DEFAULT_LABELS,
  });

  // Report label results
  for (const label of scaffoldResult.labels_created) {
    results.push({ file: `GitHub label: ${label}`, status: 'installed' });
  }
  for (const label of scaffoldResult.labels_skipped) {
    results.push({ file: `GitHub label: ${label}`, status: 'skipped' });
  }

  // Report topic results
  for (const topic of scaffoldResult.topics_added) {
    results.push({ file: `GitHub topic: ${topic}`, status: 'installed' });
  }

  // Report description
  if (scaffoldResult.description_set) {
    results.push({ file: 'GitHub: description set', status: 'installed' });
  }

  if (results.length === 0) {
    results.push({ file: 'GitHub repo scaffold (nothing to change)', status: 'skipped' });
  }

  return results;
}
