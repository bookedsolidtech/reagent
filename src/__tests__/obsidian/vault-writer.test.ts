import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { VaultWriter } from '../../obsidian/vault-writer.js';

describe('VaultWriter', () => {
  let tmpDir: string;
  let vaultDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reagent-obsidian-test-'));
    vaultDir = path.join(tmpDir, 'vault');
    fs.mkdirSync(path.join(tmpDir, '.reagent'), { recursive: true });
    fs.mkdirSync(vaultDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env['REAGENT_OBSIDIAN_VAULT'];
  });

  function writeGatewayConfig(overrides: Record<string, unknown> = {}): void {
    const config = {
      enabled: true,
      vault_path: vaultDir,
      paths: {
        root: 'Projects/Reagent',
        kanban: 'Projects/Reagent/Kanban.md',
        sources: 'Projects/Reagent/Sources',
        wiki: 'Projects/Reagent/Auto',
      },
      sync: {
        kanban: true,
        context_dump: false,
        wiki_refresh: false,
      },
      ...overrides,
    };

    // Build YAML manually for test simplicity
    const yaml = [
      'version: "1"',
      'servers: {}',
      'obsidian_vault:',
      `  enabled: ${config.enabled}`,
      `  vault_path: '${config.vault_path}'`,
      '  paths:',
      `    root: '${config.paths.root}'`,
      `    kanban: '${config.paths.kanban}'`,
      `    sources: '${config.paths.sources}'`,
      `    wiki: '${config.paths.wiki}'`,
      '  sync:',
      `    kanban: ${config.sync.kanban}`,
      `    context_dump: ${config.sync.context_dump}`,
      `    wiki_refresh: ${config.sync.wiki_refresh}`,
    ].join('\n');

    fs.writeFileSync(path.join(tmpDir, '.reagent', 'gateway.yaml'), yaml);
  }

  function writeTasks(tasks: Array<Record<string, unknown>>): void {
    const lines = tasks
      .map((t) =>
        JSON.stringify({
          id: 'T-001',
          type: 'created',
          title: 'Test task',
          urgency: 'normal',
          timestamp: '2026-04-12T00:00:00.000Z',
          ...t,
        })
      )
      .join('\n');
    fs.writeFileSync(path.join(tmpDir, '.reagent', 'tasks.jsonl'), lines + '\n');
  }

  // ── isEnabled ──────────────────────────────────────────────────────

  it('isEnabled() returns false when no gateway.yaml', () => {
    const writer = new VaultWriter(tmpDir);
    expect(writer.isEnabled()).toBe(false);
  });

  it('isEnabled() returns false when obsidian_vault.enabled is false', () => {
    writeGatewayConfig({ enabled: false });
    const writer = new VaultWriter(tmpDir);
    expect(writer.isEnabled()).toBe(false);
  });

  it('isEnabled() returns true when properly configured', () => {
    writeGatewayConfig();
    const writer = new VaultWriter(tmpDir);
    expect(writer.isEnabled()).toBe(true);
  });

  // ── env var override ───────────────────────────────────────────────

  it('uses REAGENT_OBSIDIAN_VAULT env var over config vault_path', () => {
    const altVaultDir = path.join(tmpDir, 'alt-vault');
    fs.mkdirSync(altVaultDir, { recursive: true });
    process.env['REAGENT_OBSIDIAN_VAULT'] = altVaultDir;

    writeGatewayConfig();
    const writer = new VaultWriter(tmpDir);
    expect(writer.isEnabled()).toBe(true);
    expect(writer.getConfig()?.vault_path).toBe(altVaultDir);
  });

  // ── syncKanban ─────────────────────────────────────────────────────

  it('syncKanban writes kanban markdown to vault', () => {
    writeGatewayConfig();
    writeTasks([
      { id: 'T-001', type: 'created', title: 'First task' },
      { id: 'T-002', type: 'created', title: 'Second task' },
    ]);

    const writer = new VaultWriter(tmpDir);
    const result = writer.syncKanban();

    expect(result.written).toBe(true);
    expect(result.target).toBe('kanban');
    expect(result.path).toBeDefined();

    const content = fs.readFileSync(result.path!, 'utf8');
    expect(content).toContain('kanban-plugin: basic');
    expect(content).toContain('reagent_managed: true');
    expect(content).toContain('**T-001**');
    expect(content).toContain('**T-002**');
  });

  it('syncKanban dry-run does not write files', () => {
    writeGatewayConfig();
    writeTasks([{ id: 'T-001', type: 'created', title: 'Test' }]);

    const writer = new VaultWriter(tmpDir);
    const result = writer.syncKanban(true);

    expect(result.written).toBe(false);
    expect(result.path).toBeDefined();
    // File should not exist
    expect(fs.existsSync(result.path!)).toBe(false);
  });

  it('syncKanban returns not written when kanban sync disabled', () => {
    writeGatewayConfig({ sync: { kanban: false, context_dump: false, wiki_refresh: false } });
    const writer = new VaultWriter(tmpDir);
    const result = writer.syncKanban();
    expect(result.written).toBe(false);
  });

  it('syncKanban returns not written when not configured', () => {
    const writer = new VaultWriter(tmpDir);
    const result = writer.syncKanban();
    expect(result.written).toBe(false);
  });

  // ── syncAll ────────────────────────────────────────────────────────

  it('syncAll returns results for all targets', () => {
    writeGatewayConfig();
    writeTasks([]);

    const writer = new VaultWriter(tmpDir);
    const results = writer.syncAll();

    expect(results).toHaveLength(3);
    expect(results.map((r) => r.target)).toEqual(['kanban', 'context', 'wiki']);
  });

  // ── graceful degradation ───────────────────────────────────────────

  it('handles non-existent vault path gracefully', () => {
    writeGatewayConfig({ vault_path: '/nonexistent/path/to/vault' });
    const writer = new VaultWriter(tmpDir);
    // Config loader returns null for non-existent vault
    expect(writer.isEnabled()).toBe(false);
  });

  it('handles missing tasks.jsonl gracefully', () => {
    writeGatewayConfig();
    // No tasks.jsonl written
    const writer = new VaultWriter(tmpDir);
    const result = writer.syncKanban();
    expect(result.written).toBe(true);

    const content = fs.readFileSync(result.path!, 'utf8');
    // Should render empty columns
    expect(content).toContain('## Backlog');
    expect(content).toContain('## Done');
  });

  // ── frontmatter validation ─────────────────────────────────────────

  it('written kanban files contain correct frontmatter', () => {
    writeGatewayConfig();
    writeTasks([{ id: 'T-001', type: 'created', title: 'Check frontmatter' }]);

    const writer = new VaultWriter(tmpDir);
    const result = writer.syncKanban();

    const content = fs.readFileSync(result.path!, 'utf8');
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    expect(frontmatterMatch).not.toBeNull();

    const frontmatter = frontmatterMatch![1];
    expect(frontmatter).toContain('kanban-plugin: basic');
    expect(frontmatter).toContain('reagent_managed: true');
    expect(frontmatter).toContain('reagent_synced_at:');
  });
});
