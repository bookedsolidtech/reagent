import fs from 'node:fs';
import path from 'node:path';
import { PKG_ROOT, getPkgVersion } from '../../utils.js';
import type { InstallResult, ClaudeMdConfig } from './types.js';

export function installClaudeMd(
  targetDir: string,
  claudeMdConfig: ClaudeMdConfig,
  dryRun: boolean
): InstallResult[] {
  const PKG_VERSION = getPkgVersion();
  const claudeMdPath = path.join(targetDir, 'CLAUDE.md');
  const templatePath = path.join(PKG_ROOT, 'templates', 'CLAUDE.md');

  if (!fs.existsSync(templatePath)) {
    console.error('  ERROR: templates/CLAUDE.md not found in package.');
    return [{ file: 'CLAUDE.md', status: 'warn' }];
  }

  let template = fs.readFileSync(templatePath, 'utf8');
  const safe = (val: string) => String(val).replace(/\{\{[^}]*\}\}/g, '');

  template = template
    .replace(/\{\{VERSION\}\}/g, PKG_VERSION)
    .replace(/\{\{PREFLIGHT_CMD\}\}/g, safe(claudeMdConfig.preflightCmd || 'pnpm preflight'))
    .replace(
      /\{\{ATTRIBUTION_RULE\}\}/g,
      safe(
        claudeMdConfig.attributionRule || 'Do not include AI attribution in client-facing content.'
      )
    );

  const MARKER_START = '<!-- reagent-managed:start -->';
  const MARKER_END = '<!-- reagent-managed:end -->';

  const existingContent = fs.existsSync(claudeMdPath) ? fs.readFileSync(claudeMdPath, 'utf8') : '';
  const hasBlock = existingContent.includes(MARKER_START);

  let newContent: string;
  if (hasBlock) {
    const startIdx = existingContent.indexOf(MARKER_START);
    const endIdx = existingContent.indexOf(MARKER_END);
    if (endIdx === -1) {
      const stripped = (
        existingContent.slice(0, startIdx) + existingContent.slice(startIdx + MARKER_START.length)
      ).trim();
      newContent = stripped ? template.trimEnd() + '\n\n' + stripped.trimStart() : template;
    } else {
      const endAfter = endIdx + MARKER_END.length;
      const withoutBlock = (
        existingContent.slice(0, startIdx) + existingContent.slice(endAfter)
      ).trim();
      newContent = withoutBlock ? template.trimEnd() + '\n\n' + withoutBlock.trimStart() : template;
    }
  } else {
    newContent = existingContent
      ? template.trimEnd() + '\n\n' + existingContent.trimStart()
      : template;
  }

  const same = existingContent === newContent;
  if (!same && !dryRun) {
    fs.writeFileSync(claudeMdPath, newContent, 'utf8');
  }

  return [
    {
      file: 'CLAUDE.md',
      status: same ? 'skipped' : existingContent ? 'updated' : 'installed',
    },
  ];
}
