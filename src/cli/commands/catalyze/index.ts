import fs from 'node:fs';
import path from 'node:path';
import { analyzeStack } from './stack-analyzer.js';
import { detectGaps } from './gap-detector.js';
import { writeReports } from './report-generator.js';

export interface CatalyzeOptions {
  plan: boolean;
  audit: boolean;
  dryRun: boolean;
  targetDir: string;
}

/**
 * Parse catalyze CLI args.
 */
export function parseCatalyzeArgs(args: string[]): CatalyzeOptions {
  const dryRun = args.includes('--dry-run');
  const auditMode = args.includes('--audit');
  const planMode = args.includes('--plan');

  // targetDir is the first non-flag arg, or cwd
  const targetDirArg = args.find((a) => !a.startsWith('--'));
  const targetDir = targetDirArg ? path.resolve(targetDirArg) : process.cwd();

  return {
    plan: !auditMode || planMode, // default to plan if neither flag set
    audit: auditMode,
    dryRun,
    targetDir,
  };
}

/**
 * Run audit mode: compare current state against last catalyze-report.md.
 */
function runAuditMode(targetDir: string, dryRun: boolean): void {
  console.log('\nreagent catalyze --audit');
  console.log(`  Target: ${targetDir}`);
  if (dryRun) console.log('  Mode: dry-run');
  console.log('');

  const reportPath = path.join(targetDir, 'catalyze-report.md');
  if (!fs.existsSync(reportPath)) {
    console.log('No previous catalyze-report.md found. Run `reagent catalyze --plan` first.');
    return;
  }

  // Re-run analysis
  const analysis = analyzeStack(targetDir);
  const gapAnalysis = detectGaps(analysis);

  // Read previous report to count checkboxes
  const prevReport = fs.readFileSync(reportPath, 'utf8');
  const prevGapMatches = prevReport.match(/^- \[[ x]\]/gm) || [];
  const prevChecked = prevReport.match(/^- \[x\]/gm) || [];
  const prevTotal = prevGapMatches.length;
  const prevImplemented = prevChecked.length;
  const prevOutstanding = prevTotal - prevImplemented;

  const currentTotal = gapAnalysis.gaps.length;
  const implemented = Math.max(0, prevTotal - currentTotal);
  const newGaps = Math.max(0, currentTotal - prevOutstanding);
  const outstanding = currentTotal;

  console.log('DRIFT REPORT');
  console.log(`  Implemented since last catalyze: ${implemented} gaps closed`);
  console.log(`  New gaps detected: ${newGaps}`);
  console.log(`  Outstanding: ${outstanding} gaps remain`);
  console.log('');

  // Show current critical count
  const critical = gapAnalysis.gaps.filter((g) => g.severity === 'critical');
  if (critical.length > 0) {
    console.log(`  CRITICAL gaps outstanding (${critical.length}):`);
    for (const gap of critical) {
      console.log(`    - ${gap.title}`);
    }
    console.log('');
  }

  if (!dryRun) {
    const generatedAt = new Date().toISOString();
    const { mdPath, htmlPath } = writeReports(gapAnalysis, generatedAt, targetDir, false);
    console.log(`Reports updated:`);
    console.log(`  ${mdPath}`);
    console.log(`  ${htmlPath}`);
  }
}

/**
 * Run plan mode: full analysis, write tasks, generate reports.
 */
function runPlanMode(targetDir: string, dryRun: boolean): void {
  console.log('\nreagent catalyze --plan');
  console.log(`  Target: ${targetDir}`);
  if (dryRun) console.log('  Mode: dry-run (no files written)');
  console.log('');

  // Analyze stack
  process.stdout.write('Analyzing stack...');
  const analysis = analyzeStack(targetDir);
  console.log(' done.');

  // Detect gaps
  process.stdout.write('Detecting gaps...');
  const gapAnalysis = detectGaps(analysis);
  console.log(' done.');

  // Print summary
  const { stack, gaps } = gapAnalysis;
  console.log('');
  console.log('Stack detected:');
  console.log(`  Types:        ${stack.detectedTypes.join(', ')}`);
  console.log(`  Framework:    ${stack.framework || 'not detected'}`);
  console.log(`  Test runner:  ${stack.testRunner || 'none detected'}`);
  console.log(
    `  Hooks:        ${gapAnalysis.installedHookCount}/${gapAnalysis.totalRecommendedHooks} base hooks installed`
  );
  console.log(`  Test files:   ${stack.testFiles.length}`);
  console.log('');

  const critical = gaps.filter((g) => g.severity === 'critical');
  const high = gaps.filter((g) => g.severity === 'high');
  const normal = gaps.filter((g) => g.severity === 'normal');

  console.log(`Gaps found: ${gaps.length} total`);
  console.log(`  Critical: ${critical.length}`);
  console.log(`  High:     ${high.length}`);
  console.log(`  Normal:   ${normal.length}`);

  if (critical.length > 0) {
    console.log('');
    console.log('Critical gaps:');
    for (const gap of critical) {
      console.log(`  - [${gap.category}] ${gap.title}`);
    }
  }

  if (!dryRun) {
    const generatedAt = new Date().toISOString();
    const { mdPath, htmlPath } = writeReports(gapAnalysis, generatedAt, targetDir, false);
    console.log('');
    console.log('Reports written:');
    console.log(`  ${mdPath}`);
    console.log(`  ${htmlPath}`);
    console.log('');
    console.log('Next steps:');
    console.log('  1. Review catalyze-report.md for the full gap list');
    console.log('  2. Run `reagent init` to install missing base hooks');
    for (const pType of stack.detectedTypes) {
      if (['astro', 'nextjs', 'lit-wc', 'drupal'].includes(pType)) {
        console.log(`  3. Run \`reagent init --profile ${pType}\` to install ${pType} profile`);
      }
    }
    console.log('  4. Re-run `reagent catalyze --audit` to track progress');
  } else {
    console.log('');
    console.log('(dry-run: no files written)');
  }
}

/**
 * Main catalyze command runner.
 */
export function runCatalyze(args: string[]): void {
  const opts = parseCatalyzeArgs(args);

  if (opts.audit) {
    runAuditMode(opts.targetDir, opts.dryRun);
  } else {
    runPlanMode(opts.targetDir, opts.dryRun);
  }
}
