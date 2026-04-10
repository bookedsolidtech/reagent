import { describe, it, expect } from 'vitest';
import { runHook, bashPayload } from './test-utils.js';

describe('security-disclosure-gate', () => {
  const hook = 'security-disclosure-gate';

  // ── ADVISORY MODE (default) — should BLOCK ────────────────────────

  describe('advisory mode (default)', () => {
    it('blocks gh issue create with "bypass" keyword', () => {
      const result = runHook(hook, bashPayload('gh issue create --title "bypass the auth hook"'));
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('SECURITY DISCLOSURE GATE');
      expect(result.stderr).toContain('Security Advisories');
    });

    it('blocks on "exploit" keyword', () => {
      const result = runHook(hook, bashPayload('gh issue create --title "exploit in middleware"'));
      expect(result.exitCode).toBe(2);
    });

    it('blocks on "injection" keyword', () => {
      const result = runHook(
        hook,
        bashPayload('gh issue create --title "prompt injection detection gap"')
      );
      expect(result.exitCode).toBe(2);
    });

    it('blocks on "CVE-" reference', () => {
      const result = runHook(hook, bashPayload('gh issue create --title "CVE-2026-1234 in dep"'));
      expect(result.exitCode).toBe(2);
    });

    it('blocks on "GHSA-" reference', () => {
      const result = runHook(
        hook,
        bashPayload('gh issue create --title "track GHSA-3w3m-7gg4-f82g"')
      );
      expect(result.exitCode).toBe(2);
    });

    it('blocks on "jailbreak" keyword', () => {
      const result = runHook(
        hook,
        bashPayload('gh issue create --body "jailbreak technique found"')
      );
      expect(result.exitCode).toBe(2);
    });

    it('blocks on "exfiltrat" keyword in body', () => {
      const result = runHook(
        hook,
        bashPayload('gh issue create --title "data issue" --body "can exfiltrate secrets"')
      );
      expect(result.exitCode).toBe(2);
    });

    it('is case-insensitive', () => {
      const result = runHook(hook, bashPayload('gh issue create --title "BYPASS the gate"'));
      expect(result.exitCode).toBe(2);
    });
  });

  // ── ISSUES MODE ───────────────────────────────────────────────────

  describe('issues mode (REAGENT_DISCLOSURE_MODE=issues)', () => {
    const env = { REAGENT_DISCLOSURE_MODE: 'issues' };

    it('blocks and redirects to internal labeled issue', () => {
      const result = runHook(
        hook,
        bashPayload('gh issue create --title "bypass the auth hook"'),
        env
      );
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('PRIVATE disclosure');
      expect(result.stderr).toContain('security,internal');
    });

    it('does not mention GitHub Security Advisories in issues mode', () => {
      const result = runHook(
        hook,
        bashPayload('gh issue create --title "bypass the auth hook"'),
        env
      );
      expect(result.stderr).not.toContain('Security Advisories');
    });
  });

  // ── DISABLED MODE ─────────────────────────────────────────────────

  describe('disabled mode (REAGENT_DISCLOSURE_MODE=disabled)', () => {
    it('passes through without blocking', () => {
      const result = runHook(hook, bashPayload('gh issue create --title "bypass the auth hook"'), {
        REAGENT_DISCLOSURE_MODE: 'disabled',
      });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
    });
  });

  // ── SHOULD PASS ───────────────────────────────────────────────────

  describe('passes clean issue titles', () => {
    it('passes a normal feature request', () => {
      const result = runHook(
        hook,
        bashPayload('gh issue create --title "add dark mode support" --body "Users want dark mode"')
      );
      expect(result.exitCode).toBe(0);
    });

    it('passes a performance issue', () => {
      const result = runHook(
        hook,
        bashPayload('gh issue create --title "slow startup time on large repos"')
      );
      expect(result.exitCode).toBe(0);
    });

    it('passes non-gh-issue-create bash commands', () => {
      const result = runHook(hook, bashPayload('git push origin staging'));
      expect(result.exitCode).toBe(0);
    });

    it('passes gh issue list', () => {
      const result = runHook(hook, bashPayload('gh issue list --label p1-high'));
      expect(result.exitCode).toBe(0);
    });

    it('ignores non-Bash tools', () => {
      const result = runHook(hook, {
        tool_name: 'Write',
        tool_input: { file_path: '/foo/bar.md', content: 'bypass the hook with exploit' },
      });
      expect(result.exitCode).toBe(0);
    });
  });
});
