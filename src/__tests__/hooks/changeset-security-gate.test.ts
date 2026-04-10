import { describe, it, expect } from 'vitest';
import { runHook, writePayload, editPayload } from './test-utils.js';

describe('changeset-security-gate', () => {
  const hook = 'changeset-security-gate';
  const changesetPath = '/project/.changeset/my-fix.md';

  const validChangeset = `---
'@bookedsolid/reagent': patch
---

fix(gateway): policy-loader now uses async I/O with 500ms TTL cache

Closes #34. Previously blocked the event loop on every tool invocation.`;

  // ── SECURITY DISCLOSURE CHECKS ────────────────────────────────────

  describe('blocks security advisory identifiers', () => {
    it('blocks GHSA ID in changeset content', () => {
      const content = `---
'@bookedsolid/reagent': patch
---

fix: patch GHSA-3w3m-7gg4-f82g — symlink-guard Edit tool`;
      const result = runHook(hook, writePayload(changesetPath, content));
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('CHANGESET SECURITY GATE');
      expect(result.stderr).toContain('GHSA');
    });

    it('blocks CVE identifier in changeset content', () => {
      const content = `---
'@bookedsolid/reagent': patch
---

fix: resolve CVE-2026-1234 prompt injection`;
      const result = runHook(hook, writePayload(changesetPath, content));
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('CHANGESET SECURITY GATE');
      expect(result.stderr).toContain('CVE');
    });

    it('blocks GHSA ID added via Edit tool', () => {
      const result = runHook(
        hook,
        editPayload(changesetPath, 'security: harden layer', 'fix: GHSA-xxxx-yyyy-zzzz patch')
      );
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('CHANGESET SECURITY GATE');
    });
  });

  // ── FORMAT VALIDATION ─────────────────────────────────────────────

  describe('validates changeset format', () => {
    it('blocks content with no frontmatter', () => {
      const result = runHook(
        hook,
        writePayload(changesetPath, 'Some description without frontmatter')
      );
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('CHANGESET FORMAT GATE');
      expect(result.stderr).toContain('frontmatter');
    });

    it('blocks frontmatter with no package bump entry', () => {
      const content = `---
not-a-valid-entry
---

Description here`;
      const result = runHook(hook, writePayload(changesetPath, content));
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('CHANGESET FORMAT GATE');
    });

    it('blocks changeset with no description after frontmatter', () => {
      const content = `---
'@bookedsolid/reagent': patch
---

`;
      const result = runHook(hook, writePayload(changesetPath, content));
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('Missing description');
    });
  });

  // ── SHOULD PASS ───────────────────────────────────────────────────

  describe('passes valid changesets', () => {
    it('passes a well-formed patch changeset', () => {
      const result = runHook(hook, writePayload(changesetPath, validChangeset));
      expect(result.exitCode).toBe(0);
    });

    it('passes a minor bump changeset', () => {
      const content = `---
'@bookedsolid/reagent': minor
---

feat(hooks): add changeset-security-gate and pr-issue-link-gate

Closes #29.`;
      const result = runHook(hook, writePayload(changesetPath, content));
      expect(result.exitCode).toBe(0);
    });

    it('passes a vague security fix changeset (no GHSA/CVE)', () => {
      const content = `---
'@bookedsolid/reagent': patch
---

security: extend write-path protection to all write-capable tools`;
      const result = runHook(hook, writePayload(changesetPath, content));
      expect(result.exitCode).toBe(0);
    });

    it('ignores non-changeset files even with GHSA content', () => {
      const result = runHook(
        hook,
        writePayload('/project/src/foo.ts', 'const id = "GHSA-3w3m-7gg4-f82g";')
      );
      expect(result.exitCode).toBe(0);
    });

    it('ignores README.md inside .changeset directory', () => {
      const result = runHook(
        hook,
        writePayload('/project/.changeset/README.md', '# Changesets\nGHSA-xxxx-yyyy-zzzz')
      );
      expect(result.exitCode).toBe(0);
    });

    it('ignores non-Write/Edit tools', () => {
      const result = runHook(hook, {
        tool_name: 'Bash',
        tool_input: { command: 'cat .changeset/fix.md' },
      });
      expect(result.exitCode).toBe(0);
    });
  });
});
