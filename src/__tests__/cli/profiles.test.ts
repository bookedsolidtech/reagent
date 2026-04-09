import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  installProfile,
  listTechProfiles,
  readProfileGates,
  readProfileAgents,
} from '../../cli/commands/init/profiles.js';

describe('profiles', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reagent-profiles-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('listTechProfiles', () => {
    it('returns an array of profile names', () => {
      const profiles = listTechProfiles();
      expect(Array.isArray(profiles)).toBe(true);
    });

    it('includes known tech profiles', () => {
      const profiles = listTechProfiles();
      // At minimum these four should be present
      expect(profiles).toContain('lit-wc');
      expect(profiles).toContain('drupal');
      expect(profiles).toContain('astro');
      expect(profiles).toContain('nextjs');
    });
  });

  describe('readProfileGates', () => {
    it('returns gates for lit-wc profile', () => {
      const gates = readProfileGates('lit-wc');
      expect(Array.isArray(gates)).toBe(true);
      expect(gates.length).toBeGreaterThan(0);
      expect(gates.every((g) => g.name && g.command && g.on_failure)).toBe(true);
    });

    it('returns gates for drupal profile', () => {
      const gates = readProfileGates('drupal');
      expect(gates.length).toBeGreaterThan(0);
      const phpcs = gates.find((g) => g.name === 'phpcs-drupal');
      expect(phpcs).toBeDefined();
      expect(phpcs?.on_failure).toBe('block');
    });

    it('returns gates for astro profile', () => {
      const gates = readProfileGates('astro');
      expect(gates.length).toBeGreaterThan(0);
      const astroCheck = gates.find((g) => g.name === 'astro-check');
      expect(astroCheck).toBeDefined();
    });

    it('returns gates for nextjs profile', () => {
      const gates = readProfileGates('nextjs');
      const nextBuild = gates.find((g) => g.name === 'next-build');
      expect(nextBuild).toBeDefined();
      expect(nextBuild?.on_failure).toBe('block');
    });

    it('returns empty array for unknown profile', () => {
      const gates = readProfileGates('nonexistent-profile-xyz');
      expect(gates).toEqual([]);
    });

    it('returns empty array for path traversal attempt', () => {
      const gates = readProfileGates('../etc/passwd');
      expect(gates).toEqual([]);
    });
  });

  describe('readProfileAgents', () => {
    it('returns agents for lit-wc profile', () => {
      const agents = readProfileAgents('lit-wc');
      expect(Array.isArray(agents)).toBe(true);
      expect(agents.length).toBeGreaterThan(0);
      expect(agents.some((a) => a.includes('lit-specialist'))).toBe(true);
    });

    it('returns agents for drupal profile', () => {
      const agents = readProfileAgents('drupal');
      expect(agents.some((a) => a.includes('drupal'))).toBe(true);
    });

    it('returns empty array for unknown profile', () => {
      const agents = readProfileAgents('nonexistent-profile-xyz');
      expect(agents).toEqual([]);
    });
  });

  describe('installProfile', () => {
    it('rejects path traversal in profile name', () => {
      const result = installProfile('../etc/passwd', tmpDir, false);
      expect(result.results.some((r) => r.status === 'warn')).toBe(true);
      expect(result.gatesInstalled).toEqual([]);
    });

    it('returns warn for unknown profile', () => {
      const result = installProfile('nonexistent-xyz', tmpDir, false);
      expect(result.results.some((r) => r.status === 'warn')).toBe(true);
    });

    it('installs lit-wc hooks to .claude/hooks/', () => {
      const result = installProfile('lit-wc', tmpDir, false);
      expect(result.results.length).toBeGreaterThan(0);
      const installedHooks = result.results.filter(
        (r) => r.status === 'installed' && r.file.includes('.claude/hooks/')
      );
      expect(installedHooks.length).toBeGreaterThan(0);

      // Verify hooks exist on disk
      const hooksDir = path.join(tmpDir, '.claude', 'hooks');
      expect(fs.existsSync(hooksDir)).toBe(true);
      const hookFiles = fs.readdirSync(hooksDir);
      expect(hookFiles.some((f) => f.endsWith('.sh'))).toBe(true);
    });

    it('sets executable permissions on installed hook scripts', () => {
      installProfile('lit-wc', tmpDir, false);
      const hooksDir = path.join(tmpDir, '.claude', 'hooks');
      if (fs.existsSync(hooksDir)) {
        const hookFiles = fs.readdirSync(hooksDir).filter((f) => f.endsWith('.sh'));
        for (const hookFile of hookFiles) {
          const stat = fs.statSync(path.join(hooksDir, hookFile));
          // Check owner executable bit
          expect(stat.mode & 0o100).toBeTruthy();
        }
      }
    });

    it('installs astro hooks', () => {
      const result = installProfile('astro', tmpDir, false);
      const installed = result.results.filter((r) => r.status === 'installed');
      expect(installed.length).toBeGreaterThan(0);
    });

    it('installs nextjs hooks', () => {
      const result = installProfile('nextjs', tmpDir, false);
      const installed = result.results.filter((r) => r.status === 'installed');
      expect(installed.length).toBeGreaterThan(0);
    });

    it('installs drupal hooks', () => {
      const result = installProfile('drupal', tmpDir, false);
      const installed = result.results.filter((r) => r.status === 'installed');
      expect(installed.length).toBeGreaterThan(0);
    });

    it('returns gates from gates.yaml', () => {
      const result = installProfile('lit-wc', tmpDir, false);
      expect(result.gatesInstalled.length).toBeGreaterThan(0);
      expect(result.gatesInstalled.every((g) => g.name && g.command)).toBe(true);
    });

    it('returns agents from agents.txt', () => {
      const result = installProfile('lit-wc', tmpDir, false);
      expect(result.agentsInstalled.length).toBeGreaterThan(0);
    });

    it('is idempotent — second install reports skipped', () => {
      installProfile('lit-wc', tmpDir, false);
      const secondResult = installProfile('lit-wc', tmpDir, false);
      const installed = secondResult.results.filter((r) => r.status === 'installed');
      expect(installed.length).toBe(0);
      const skipped = secondResult.results.filter((r) => r.status === 'skipped');
      expect(skipped.length).toBeGreaterThan(0);
    });

    it('does not write files in dry-run mode', () => {
      const result = installProfile('lit-wc', tmpDir, true);
      // Results should show installed but no files should exist
      expect(result.results.length).toBeGreaterThan(0);
      const hooksDir = path.join(tmpDir, '.claude', 'hooks');
      expect(fs.existsSync(hooksDir)).toBe(false);
    });
  });
});
