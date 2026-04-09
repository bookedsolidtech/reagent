import fs from 'node:fs';
import path from 'node:path';
import type { GapAnalysis, Gap, GapSeverity } from './types.js';

function severityLabel(s: GapSeverity): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function categoryIcon(category: Gap['category']): string {
  switch (category) {
    case 'hook':
      return '[hook]';
    case 'gate':
      return '[gate]';
    case 'agent':
      return '[agent]';
    case 'test':
      return '[test]';
  }
}

/**
 * Generate the Markdown report content.
 */
export function generateMarkdownReport(analysis: GapAnalysis, generatedAt: string): string {
  const { stack, gaps, totalRecommendedHooks, installedHookCount } = analysis;

  const critical = gaps.filter((g) => g.severity === 'critical');
  const high = gaps.filter((g) => g.severity === 'high');
  const normal = gaps.filter((g) => g.severity === 'normal');

  const hookCoverage = `${installedHookCount}/${totalRecommendedHooks}`;

  let md = `# reagent catalyze report
_Generated: ${generatedAt}_
_Project: ${stack.projectName} v${stack.projectVersion}_

## Stack detected

- **Types:** ${stack.detectedTypes.join(', ')}
- **Framework:** ${stack.framework || 'not detected'}
- **Test runner:** ${stack.testRunner || 'none detected'}
- **Autonomy level:** ${stack.autonomyLevel || 'not configured'}
- **Profile:** ${stack.profile || 'none'}
- **Existing hooks:** ${hookCoverage} recommended base hooks installed
- **Test files found:** ${stack.testFiles.length}

## Summary

| Severity | Count |
|----------|-------|
| Critical | ${critical.length} |
| High | ${high.length} |
| Normal | ${normal.length} |
| **Total gaps** | **${gaps.length}** |

`;

  if (gaps.length === 0) {
    md += `## No gaps detected\n\nAll recommended hooks, gates, and agents appear to be in place for the detected stack.\n`;
    return md;
  }

  md += `## Gaps found (ranked by impact)\n\n`;

  function renderGaps(sectionGaps: Gap[], severity: GapSeverity): string {
    if (sectionGaps.length === 0) return '';
    let section = `### ${severityLabel(severity)}\n\n`;
    for (const gap of sectionGaps) {
      section += `- [ ] ${categoryIcon(gap.category)} **${gap.title}** — ${gap.description}`;
      if (gap.suggestion) {
        section += `\n  _Suggestion: ${gap.suggestion}_`;
      }
      section += '\n';
    }
    return section + '\n';
  }

  md += renderGaps(critical, 'critical');
  md += renderGaps(high, 'high');
  md += renderGaps(normal, 'normal');

  // Recommended next steps
  md += `## Recommended next steps\n\n`;
  md += `1. Run \`reagent init\` to install missing base hooks\n`;

  const profileMap: Record<string, string> = {
    astro: 'astro',
    nextjs: 'nextjs',
    'lit-wc': 'lit-wc',
    drupal: 'drupal',
  };
  for (const pType of stack.detectedTypes) {
    const profileName = profileMap[pType];
    if (profileName) {
      md += `2. Run \`reagent init --profile ${profileName}\` to install ${pType} profile hooks and agents\n`;
    }
  }
  md += `3. Review the gaps above and address Critical items first\n`;
  md += `4. Re-run \`reagent catalyze --audit\` after changes to track progress\n`;

  // Hook templates section for project-specific hooks
  const hasLitWc = stack.detectedTypes.includes('lit-wc');
  const hasDrupal = stack.detectedTypes.includes('drupal');
  const hasAstro = stack.detectedTypes.includes('astro');
  const hasNextjs = stack.detectedTypes.includes('nextjs');

  if (hasLitWc || hasDrupal || hasAstro || hasNextjs) {
    md += `\n## Profile-specific hook templates\n\n`;
    md += `Install profile-specific hooks using:\n\n`;
    for (const pType of stack.detectedTypes) {
      const profileName = profileMap[pType];
      if (profileName) {
        md += `\`\`\`bash\nreagent init --profile ${profileName}\n\`\`\`\n\n`;
      }
    }
  }

  return md;
}

/**
 * Generate the HTML report content (inline CSS, dark mode, no external deps).
 */
export function generateHtmlReport(analysis: GapAnalysis, generatedAt: string): string {
  const { stack, gaps } = analysis;

  const critical = gaps.filter((g) => g.severity === 'critical');
  const high = gaps.filter((g) => g.severity === 'high');
  const normal = gaps.filter((g) => g.severity === 'normal');

  function escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function severityColor(s: GapSeverity): string {
    switch (s) {
      case 'critical':
        return '#ff4444';
      case 'high':
        return '#ff9944';
      case 'normal':
        return '#4499ff';
    }
  }

  function renderGapsHtml(sectionGaps: Gap[], severity: GapSeverity): string {
    if (sectionGaps.length === 0) return '';
    const color = severityColor(severity);
    let html = `<details open>
      <summary style="color:${color};font-weight:bold;font-size:1.1em;cursor:pointer;padding:8px 0;">
        ${severityLabel(severity)} (${sectionGaps.length})
      </summary>
      <ul style="list-style:none;padding:0;margin:8px 0;">
    `;
    for (const gap of sectionGaps) {
      html += `<li style="padding:10px;margin:6px 0;background:#2a2a2a;border-left:4px solid ${color};border-radius:4px;">
        <span style="background:${color};color:#000;font-size:0.75em;padding:2px 6px;border-radius:3px;font-weight:bold;margin-right:8px;">${gap.category.toUpperCase()}</span>
        <strong>${escapeHtml(gap.title)}</strong>
        <p style="margin:6px 0 4px;color:#ccc;">${escapeHtml(gap.description)}</p>
        ${gap.suggestion ? `<p style="margin:4px 0;color:#888;font-size:0.9em;font-style:italic;">Suggestion: ${escapeHtml(gap.suggestion)}</p>` : ''}
      </li>`;
    }
    html += `</ul></details>`;
    return html;
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>reagent catalyze report — ${escapeHtml(stack.projectName)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
      background: #1a1a1a;
      color: #e0e0e0;
      margin: 0;
      padding: 20px;
      line-height: 1.6;
    }
    .container { max-width: 900px; margin: 0 auto; }
    h1 { color: #fff; border-bottom: 2px solid #333; padding-bottom: 12px; }
    h2 { color: #ddd; margin-top: 32px; }
    .meta { color: #888; font-size: 0.9em; margin-bottom: 24px; }
    .stack-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 12px;
      margin-bottom: 24px;
    }
    .stack-card {
      background: #2a2a2a;
      border: 1px solid #333;
      border-radius: 6px;
      padding: 12px;
    }
    .stack-card dt { color: #888; font-size: 0.8em; margin-bottom: 4px; }
    .stack-card dd { color: #fff; margin: 0; font-weight: 500; }
    .summary-badges { display: flex; gap: 12px; margin: 16px 0; flex-wrap: wrap; }
    .badge {
      padding: 6px 14px;
      border-radius: 20px;
      font-weight: bold;
      font-size: 0.9em;
    }
    .badge-critical { background: #ff4444; color: #000; }
    .badge-high { background: #ff9944; color: #000; }
    .badge-normal { background: #4499ff; color: #000; }
    .badge-ok { background: #44bb44; color: #000; }
    details { margin-bottom: 16px; }
    details summary:hover { opacity: 0.8; }
    .next-steps ol { padding-left: 20px; }
    .next-steps li { margin: 6px 0; }
    code { background: #333; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
    .footer { margin-top: 40px; color: #555; font-size: 0.8em; border-top: 1px solid #333; padding-top: 16px; }
  </style>
</head>
<body>
<div class="container">
  <h1>reagent catalyze report</h1>
  <div class="meta">
    <span>Generated: ${escapeHtml(generatedAt)}</span> &nbsp;|&nbsp;
    <span>Project: ${escapeHtml(stack.projectName)} v${escapeHtml(stack.projectVersion)}</span>
  </div>

  <h2>Stack detected</h2>
  <div class="stack-grid">
    <dl class="stack-card">
      <dt>Project types</dt>
      <dd>${escapeHtml(stack.detectedTypes.join(', '))}</dd>
    </dl>
    <dl class="stack-card">
      <dt>Framework</dt>
      <dd>${escapeHtml(stack.framework || 'not detected')}</dd>
    </dl>
    <dl class="stack-card">
      <dt>Test runner</dt>
      <dd>${escapeHtml(stack.testRunner || 'none detected')}</dd>
    </dl>
    <dl class="stack-card">
      <dt>Autonomy level</dt>
      <dd>${escapeHtml(stack.autonomyLevel || 'not configured')}</dd>
    </dl>
    <dl class="stack-card">
      <dt>Profile</dt>
      <dd>${escapeHtml(stack.profile || 'none')}</dd>
    </dl>
    <dl class="stack-card">
      <dt>Hooks installed</dt>
      <dd>${analysis.installedHookCount}/${analysis.totalRecommendedHooks} base hooks</dd>
    </dl>
  </div>

  <h2>Gap summary</h2>
  <div class="summary-badges">
    ${critical.length > 0 ? `<span class="badge badge-critical">${critical.length} Critical</span>` : ''}
    ${high.length > 0 ? `<span class="badge badge-high">${high.length} High</span>` : ''}
    ${normal.length > 0 ? `<span class="badge badge-normal">${normal.length} Normal</span>` : ''}
    ${gaps.length === 0 ? '<span class="badge badge-ok">No gaps detected</span>' : ''}
  </div>

  <h2>Gaps found (ranked by impact)</h2>
  ${renderGapsHtml(critical, 'critical')}
  ${renderGapsHtml(high, 'high')}
  ${renderGapsHtml(normal, 'normal')}

  <div class="next-steps">
    <h2>Recommended next steps</h2>
    <ol>
      <li>Run <code>reagent init</code> to install missing base hooks</li>
      ${stack.detectedTypes
        .filter((t) => ['astro', 'nextjs', 'lit-wc', 'drupal'].includes(t))
        .map(
          (t) =>
            `<li>Run <code>reagent init --profile ${t}</code> to install ${escapeHtml(t)} profile</li>`
        )
        .join('\n      ')}
      <li>Address all <strong style="color:#ff4444">Critical</strong> gaps first</li>
      <li>Re-run <code>reagent catalyze --audit</code> to track progress</li>
    </ol>
  </div>

  <div class="footer">
    Generated by @bookedsolid/reagent &mdash; <a href="https://github.com/bookedsolidtech/reagent" style="color:#4499ff;">reagent on GitHub</a>
  </div>
</div>
</body>
</html>`;

  return html;
}

/**
 * Write both report files to disk.
 */
export function writeReports(
  analysis: GapAnalysis,
  generatedAt: string,
  outputDir: string,
  dryRun: boolean
): { mdPath: string; htmlPath: string } {
  const mdPath = path.join(outputDir, 'catalyze-report.md');
  const htmlPath = path.join(outputDir, 'catalyze-report.html');

  const mdContent = generateMarkdownReport(analysis, generatedAt);
  const htmlContent = generateHtmlReport(analysis, generatedAt);

  if (!dryRun) {
    fs.writeFileSync(mdPath, mdContent, 'utf8');
    fs.writeFileSync(htmlPath, htmlContent, 'utf8');
  }

  return { mdPath, htmlPath };
}
