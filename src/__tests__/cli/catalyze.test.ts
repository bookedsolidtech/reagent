import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { analyzeStack } from '../../cli/commands/catalyze/stack-analyzer.js';
import { detectGaps } from '../../cli/commands/catalyze/gap-detector.js';
import {
  generateMarkdownReport,
  generateHtmlReport,
  writeReports,
} from '../../cli/commands/catalyze/report-generator.js';

describe('stack-analyzer', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reagent-catalyze-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('analyzeStack', () => {
    it('detects unknown for empty directory', () => {
      const result = analyzeStack(tmpDir);
      expect(result.detectedTypes).toContain('unknown');
    });

    it('detects project name from package.json', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'my-project', version: '1.2.3' })
      );
      const result = analyzeStack(tmpDir);
      expect(result.projectName).toBe('my-project');
      expect(result.projectVersion).toBe('1.2.3');
    });

    it('detects astro from astro.config.mjs', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'test', version: '1.0.0' })
      );
      fs.writeFileSync(path.join(tmpDir, 'astro.config.mjs'), 'export default {}');
      const result = analyzeStack(tmpDir);
      expect(result.detectedTypes).toContain('astro');
    });

    it('detects astro from package.json dependency', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'test', version: '1.0.0', dependencies: { astro: '^5.0.0' } })
      );
      const result = analyzeStack(tmpDir);
      expect(result.detectedTypes).toContain('astro');
    });

    it('detects nextjs from next.config.js', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'test', version: '1.0.0' })
      );
      fs.writeFileSync(path.join(tmpDir, 'next.config.js'), 'module.exports = {}');
      const result = analyzeStack(tmpDir);
      expect(result.detectedTypes).toContain('nextjs');
    });

    it('detects nextjs from package.json dependency', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'test',
          version: '1.0.0',
          dependencies: { next: '^14.0.0', react: '^18.0.0', 'react-dom': '^18.0.0' },
        })
      );
      const result = analyzeStack(tmpDir);
      expect(result.detectedTypes).toContain('nextjs');
    });

    it('detects lit-wc from lit dependency', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'test', version: '1.0.0', dependencies: { lit: '^3.0.0' } })
      );
      const result = analyzeStack(tmpDir);
      expect(result.detectedTypes).toContain('lit-wc');
    });

    it('detects monorepo from pnpm-workspace.yaml', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'test', version: '1.0.0' })
      );
      fs.writeFileSync(path.join(tmpDir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
      const result = analyzeStack(tmpDir);
      expect(result.detectedTypes).toContain('monorepo');
    });

    it('detects node-api from express dependency', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'test', version: '1.0.0', dependencies: { express: '^4.0.0' } })
      );
      const result = analyzeStack(tmpDir);
      expect(result.detectedTypes).toContain('node-api');
    });

    it('detects installed hooks from .claude/hooks/', () => {
      fs.mkdirSync(path.join(tmpDir, '.claude', 'hooks'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.claude', 'hooks', 'secret-scanner.sh'), '#!/bin/bash');
      fs.writeFileSync(
        path.join(tmpDir, '.claude', 'hooks', 'env-file-protection.sh'),
        '#!/bin/bash'
      );
      const result = analyzeStack(tmpDir);
      expect(result.installedHooks).toContain('secret-scanner');
      expect(result.installedHooks).toContain('env-file-protection');
    });

    it('detects test files in src/', () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'foo.test.ts'), 'it("works", () => {})');
      const result = analyzeStack(tmpDir);
      expect(result.testFiles.length).toBeGreaterThan(0);
    });

    it('detects vitest test runner', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'test', version: '1.0.0', devDependencies: { vitest: '^3.0.0' } })
      );
      const result = analyzeStack(tmpDir);
      expect(result.testRunner).toContain('vitest');
    });

    it('reads autonomy level from .reagent/policy.yaml', () => {
      fs.mkdirSync(path.join(tmpDir, '.reagent'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, '.reagent', 'policy.yaml'),
        'version: "1"\nautonomy_level: L2\nprofile: "bst-internal"\n'
      );
      const result = analyzeStack(tmpDir);
      expect(result.autonomyLevel).toBe('L2');
      expect(result.profile).toBe('bst-internal');
    });

    it('detects OpenAPI spec', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'test', version: '1.0.0' })
      );
      fs.writeFileSync(path.join(tmpDir, 'openapi.yaml'), 'openapi: "3.0.0"');
      const result = analyzeStack(tmpDir);
      expect(result.hasOpenApi).toBe(true);
    });

    it('handles malformed package.json gracefully', () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), 'NOT VALID JSON {{{');
      // Should not throw — falls back to defaults
      const result = analyzeStack(tmpDir);
      expect(result.projectName).toBe(path.basename(tmpDir));
    });

    it('can detect multiple project types simultaneously', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'test',
          version: '1.0.0',
          dependencies: { astro: '^5.0.0', lit: '^3.0.0' },
        })
      );
      const result = analyzeStack(tmpDir);
      expect(result.detectedTypes).toContain('astro');
      expect(result.detectedTypes).toContain('lit-wc');
    });
  });
});

describe('gap-detector', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reagent-gap-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects missing base hooks as gaps', () => {
    const analysis = analyzeStack(tmpDir);
    const gapAnalysis = detectGaps(analysis);
    const hookGaps = gapAnalysis.gaps.filter((g) => g.category === 'hook');
    expect(hookGaps.length).toBeGreaterThan(0);
  });

  it('marks secret-scanner as critical when missing', () => {
    const analysis = analyzeStack(tmpDir);
    const gapAnalysis = detectGaps(analysis);
    const secretGap = gapAnalysis.gaps.find((g) => g.title.includes('secret-scanner'));
    expect(secretGap).toBeDefined();
    expect(secretGap?.severity).toBe('critical');
  });

  it('does not report gap for installed hooks', () => {
    fs.mkdirSync(path.join(tmpDir, '.claude', 'hooks'), { recursive: true });
    // Install all base hooks
    const baseHooks = [
      'secret-scanner',
      'dangerous-bash-interceptor',
      'env-file-protection',
      'blocked-paths-enforcer',
      'dependency-audit-gate',
      'attribution-advisory',
      'commit-review-gate',
      'push-review-gate',
      'settings-protection',
      'output-validation',
      'file-size-guard',
      'symlink-guard',
      'git-config-guard',
      'network-exfil-guard',
      'rate-limit-guard',
      'ci-config-protection',
      'import-guard',
    ];
    for (const hook of baseHooks) {
      fs.writeFileSync(path.join(tmpDir, '.claude', 'hooks', `${hook}.sh`), '#!/bin/bash');
    }
    const analysis = analyzeStack(tmpDir);
    const gapAnalysis = detectGaps(analysis);
    const hookGaps = gapAnalysis.gaps.filter(
      (g) => g.category === 'hook' && !g.projectTypes?.length
    );
    expect(hookGaps.length).toBe(0);
  });

  it('detects astro-specific gaps when astro detected', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test', version: '1.0.0', dependencies: { astro: '^5.0.0' } })
    );
    const analysis = analyzeStack(tmpDir);
    const gapAnalysis = detectGaps(analysis);
    const astroGaps = gapAnalysis.gaps.filter((g) => g.projectTypes?.includes('astro'));
    expect(astroGaps.length).toBeGreaterThan(0);
  });

  it('detects nextjs-specific gaps when nextjs detected', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test', version: '1.0.0', dependencies: { next: '^14.0.0' } })
    );
    const analysis = analyzeStack(tmpDir);
    const gapAnalysis = detectGaps(analysis);
    const nextGaps = gapAnalysis.gaps.filter((g) => g.projectTypes?.includes('nextjs'));
    expect(nextGaps.length).toBeGreaterThan(0);
  });

  it('detects lit-wc-specific gaps when lit detected', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test', version: '1.0.0', dependencies: { lit: '^3.0.0' } })
    );
    const analysis = analyzeStack(tmpDir);
    const gapAnalysis = detectGaps(analysis);
    const litGaps = gapAnalysis.gaps.filter((g) => g.projectTypes?.includes('lit-wc'));
    expect(litGaps.length).toBeGreaterThan(0);
  });

  it('sorts gaps with critical first', () => {
    const analysis = analyzeStack(tmpDir);
    const gapAnalysis = detectGaps(analysis);
    const severities = gapAnalysis.gaps.map((g) => g.severity);
    const criticalIdx = severities.lastIndexOf('critical');
    const highIdx = severities.indexOf('high');
    // All criticals should come before any high
    if (criticalIdx !== -1 && highIdx !== -1) {
      expect(criticalIdx).toBeLessThan(highIdx);
    }
  });

  it('returns installedHookCount correctly', () => {
    fs.mkdirSync(path.join(tmpDir, '.claude', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.claude', 'hooks', 'secret-scanner.sh'), '#!/bin/bash');
    const analysis = analyzeStack(tmpDir);
    const gapAnalysis = detectGaps(analysis);
    expect(gapAnalysis.installedHookCount).toBe(1);
  });
});

describe('report-generator', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reagent-report-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeAnalysis(tmpDir: string) {
    const analysis = analyzeStack(tmpDir);
    return detectGaps(analysis);
  }

  describe('generateMarkdownReport', () => {
    it('includes project name and generated date', () => {
      const gapAnalysis = makeAnalysis(tmpDir);
      const date = '2026-04-09T00:00:00.000Z';
      const md = generateMarkdownReport(gapAnalysis, date);
      expect(md).toContain('# reagent catalyze report');
      expect(md).toContain(date);
    });

    it('includes stack section with detected types', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'my-app', version: '2.0.0', dependencies: { astro: '^5.0.0' } })
      );
      const gapAnalysis = makeAnalysis(tmpDir);
      const md = generateMarkdownReport(gapAnalysis, '2026-04-09T00:00:00.000Z');
      expect(md).toContain('astro');
      expect(md).toContain('my-app');
      expect(md).toContain('2.0.0');
    });

    it('includes summary table', () => {
      const gapAnalysis = makeAnalysis(tmpDir);
      const md = generateMarkdownReport(gapAnalysis, '2026-04-09T00:00:00.000Z');
      expect(md).toContain('| Critical |');
      expect(md).toContain('| High |');
    });

    it('includes critical and high sections when gaps present', () => {
      const gapAnalysis = makeAnalysis(tmpDir);
      const md = generateMarkdownReport(gapAnalysis, '2026-04-09T00:00:00.000Z');
      if (gapAnalysis.gaps.some((g) => g.severity === 'critical')) {
        expect(md).toContain('### Critical');
      }
      if (gapAnalysis.gaps.some((g) => g.severity === 'high')) {
        expect(md).toContain('### High');
      }
    });

    it('includes recommended next steps', () => {
      const gapAnalysis = makeAnalysis(tmpDir);
      const md = generateMarkdownReport(gapAnalysis, '2026-04-09T00:00:00.000Z');
      expect(md).toContain('## Recommended next steps');
      expect(md).toContain('reagent init');
    });
  });

  describe('generateHtmlReport', () => {
    it('generates valid HTML with doctype', () => {
      const gapAnalysis = makeAnalysis(tmpDir);
      const html = generateHtmlReport(gapAnalysis, '2026-04-09T00:00:00.000Z');
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html');
      expect(html).toContain('</html>');
    });

    it('includes project name in title', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'cool-project', version: '1.0.0' })
      );
      const gapAnalysis = makeAnalysis(tmpDir);
      const html = generateHtmlReport(gapAnalysis, '2026-04-09T00:00:00.000Z');
      expect(html).toContain('cool-project');
    });

    it('uses inline CSS only (no external stylesheet links)', () => {
      const gapAnalysis = makeAnalysis(tmpDir);
      const html = generateHtmlReport(gapAnalysis, '2026-04-09T00:00:00.000Z');
      expect(html).not.toMatch(/<link\s+rel="stylesheet"/);
      expect(html).toContain('<style>');
    });

    it('escapes HTML special characters in project name', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'project<script>', version: '1.0.0' })
      );
      const gapAnalysis = makeAnalysis(tmpDir);
      const html = generateHtmlReport(gapAnalysis, '2026-04-09T00:00:00.000Z');
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });
  });

  describe('writeReports', () => {
    it('writes both .md and .html files', () => {
      const gapAnalysis = makeAnalysis(tmpDir);
      const { mdPath, htmlPath } = writeReports(
        gapAnalysis,
        '2026-04-09T00:00:00.000Z',
        tmpDir,
        false
      );
      expect(fs.existsSync(mdPath)).toBe(true);
      expect(fs.existsSync(htmlPath)).toBe(true);
    });

    it('does not write files in dry-run mode', () => {
      const gapAnalysis = makeAnalysis(tmpDir);
      const { mdPath, htmlPath } = writeReports(
        gapAnalysis,
        '2026-04-09T00:00:00.000Z',
        tmpDir,
        true
      );
      expect(fs.existsSync(mdPath)).toBe(false);
      expect(fs.existsSync(htmlPath)).toBe(false);
    });

    it('writes valid markdown content', () => {
      const gapAnalysis = makeAnalysis(tmpDir);
      const { mdPath } = writeReports(gapAnalysis, '2026-04-09T00:00:00.000Z', tmpDir, false);
      const content = fs.readFileSync(mdPath, 'utf8');
      expect(content).toContain('# reagent catalyze report');
    });
  });
});
