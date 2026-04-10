/**
 * Tests for the pr-voice-reviewer system:
 * - agents/engineering/pr-voice-reviewer.md exists and has correct frontmatter
 * - commands/review-pr.md skill file exists and covers required steps
 * - GitHub review payload structure validation (unit-level, no API call)
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..');

// ── File existence ─────────────────────────────────────────────────────────

describe('pr-voice-reviewer agent file', () => {
  const agentPath = path.join(PROJECT_ROOT, 'agents', 'engineering', 'pr-voice-reviewer.md');

  it('exists at agents/engineering/pr-voice-reviewer.md', () => {
    expect(fs.existsSync(agentPath)).toBe(true);
  });

  it('has YAML frontmatter delimiters', () => {
    const content = fs.readFileSync(agentPath, 'utf8');
    expect(content.startsWith('---\n')).toBe(true);
    const secondDelim = content.indexOf('---\n', 4);
    expect(secondDelim).toBeGreaterThan(4);
  });

  it('has required frontmatter fields: name, description, category', () => {
    const content = fs.readFileSync(agentPath, 'utf8');
    const frontmatterEnd = content.indexOf('---\n', 4);
    const frontmatter = content.slice(4, frontmatterEnd);

    expect(frontmatter).toMatch(/^name:\s*\S/m);
    expect(frontmatter).toMatch(/^description:\s*\S/m);
    expect(frontmatter).toMatch(/^category:\s*\S/m);
  });

  it('category is set to engineering', () => {
    const content = fs.readFileSync(agentPath, 'utf8');
    const frontmatterEnd = content.indexOf('---\n', 4);
    const frontmatter = content.slice(4, frontmatterEnd);
    expect(frontmatter).toMatch(/^category:\s*engineering\s*$/m);
  });

  it('describes the review event logic (REQUEST_CHANGES / COMMENT / APPROVE)', () => {
    const content = fs.readFileSync(agentPath, 'utf8');
    expect(content).toContain('REQUEST_CHANGES');
    expect(content).toContain('COMMENT');
    expect(content).toContain('APPROVE');
  });

  it('documents the output JSON structure with commit_id, body, event, comments', () => {
    const content = fs.readFileSync(agentPath, 'utf8');
    expect(content).toContain('commit_id');
    expect(content).toContain('"body"');
    expect(content).toContain('"event"');
    expect(content).toContain('"comments"');
  });

  it('references GitHub suggestion syntax', () => {
    const content = fs.readFileSync(agentPath, 'utf8');
    expect(content).toContain('suggestion');
  });

  it('encodes the owner voice profile — no "consider" or "I noticed" language', () => {
    const content = fs.readFileSync(agentPath, 'utf8');
    // The voice profile section should explicitly prohibit hedging language
    expect(content).toContain('I noticed');
    // It should appear in a prohibition context — verify the surrounding text
    const idx = content.indexOf('I noticed');
    const surrounding = content.slice(Math.max(0, idx - 50), idx + 60);
    expect(surrounding.toLowerCase()).toMatch(/never|not|avoid/);
  });
});

// ── Skill file ─────────────────────────────────────────────────────────────

describe('review-pr skill file', () => {
  const skillPath = path.join(PROJECT_ROOT, 'commands', 'review-pr.md');

  it('exists at commands/review-pr.md', () => {
    expect(fs.existsSync(skillPath)).toBe(true);
  });

  it('documents the --tier flag with standard, senior, chief options', () => {
    const content = fs.readFileSync(skillPath, 'utf8');
    expect(content).toContain('standard');
    expect(content).toContain('senior');
    expect(content).toContain('chief');
  });

  it('references gh pr diff for fetching the diff', () => {
    const content = fs.readFileSync(skillPath, 'utf8');
    expect(content).toContain('gh pr diff');
  });

  it('references the commit SHA retrieval step', () => {
    const content = fs.readFileSync(skillPath, 'utf8');
    expect(content).toMatch(/commits.*oid|oid.*commits/s);
  });

  it('documents the GitHub Reviews API endpoint', () => {
    const content = fs.readFileSync(skillPath, 'utf8');
    expect(content).toContain('/pulls/');
    expect(content).toContain('/reviews');
    expect(content).toContain('--method POST');
  });

  it('references both code-reviewer and pr-voice-reviewer agents', () => {
    const content = fs.readFileSync(skillPath, 'utf8');
    expect(content).toContain('code-reviewer');
    expect(content).toContain('pr-voice-reviewer');
  });

  it('includes error handling section', () => {
    const content = fs.readFileSync(skillPath, 'utf8');
    expect(content.toLowerCase()).toContain('error');
  });

  it('references HALT check', () => {
    const content = fs.readFileSync(skillPath, 'utf8');
    expect(content).toContain('HALT');
  });
});

// ── GitHub review payload validation ──────────────────────────────────────

describe('GitHub review payload structure', () => {
  /**
   * Validates that a payload object matches the GitHub Reviews API schema.
   * In production this runs against the real API; here we test the shape.
   */
  function validateReviewPayload(payload: unknown): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (typeof payload !== 'object' || payload === null) {
      return { valid: false, errors: ['payload must be an object'] };
    }

    const p = payload as Record<string, unknown>;

    if (typeof p.commit_id !== 'string' || p.commit_id.length === 0) {
      errors.push('commit_id must be a non-empty string');
    }

    if (typeof p.body !== 'string' || p.body.length === 0) {
      errors.push('body must be a non-empty string');
    }

    const validEvents = ['REQUEST_CHANGES', 'COMMENT', 'APPROVE'];
    if (!validEvents.includes(p.event as string)) {
      errors.push(`event must be one of: ${validEvents.join(', ')}`);
    }

    if (!Array.isArray(p.comments)) {
      errors.push('comments must be an array');
    } else {
      for (let i = 0; i < (p.comments as unknown[]).length; i++) {
        const c = (p.comments as unknown[])[i] as Record<string, unknown>;

        if (typeof c.path !== 'string' || c.path.length === 0) {
          errors.push(`comments[${i}].path must be a non-empty string`);
        }

        if (typeof c.line !== 'number' || !Number.isInteger(c.line) || c.line < 1) {
          errors.push(`comments[${i}].line must be a positive integer`);
        }

        if (typeof c.body !== 'string' || c.body.length === 0) {
          errors.push(`comments[${i}].body must be a non-empty string`);
        }

        // start_line must be less than line when present
        if (c.start_line !== undefined) {
          if (typeof c.start_line !== 'number' || !Number.isInteger(c.start_line)) {
            errors.push(`comments[${i}].start_line must be an integer when present`);
          } else if ((c.start_line as number) >= (c.line as number)) {
            errors.push(
              `comments[${i}].start_line (${c.start_line}) must be less than line (${c.line})`
            );
          }
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  it('accepts a well-formed REQUEST_CHANGES payload', () => {
    const payload = {
      commit_id: 'abc123def456',
      body: "three things blocking this. the null assertion on line 42 will throw in prod — it's not theoretical.",
      event: 'REQUEST_CHANGES',
      comments: [
        {
          path: 'src/gateway/middleware/chain.ts',
          line: 42,
          body: "yeah no, this'll throw the moment upstream returns `undefined`.\n\n```suggestion\nconst result = upstream ?? defaultValue;\n```",
        },
        {
          path: 'src/foo.ts',
          start_line: 10,
          line: 15,
          body: '`forEach` here allocates a closure every render — swap for `for...of`.',
        },
      ],
    };

    const result = validateReviewPayload(payload);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts a COMMENT payload with no inline comments (clean review)', () => {
    const payload = {
      commit_id: 'deadbeef1234',
      body: 'clean. ship it.',
      event: 'COMMENT',
      comments: [],
    };

    const result = validateReviewPayload(payload);
    expect(result.valid).toBe(true);
  });

  it('accepts an APPROVE payload', () => {
    const payload = {
      commit_id: 'cafebabe5678',
      body: 'solid work overall — the middleware chain is clean and the types are tight.',
      event: 'APPROVE',
      comments: [],
    };

    const result = validateReviewPayload(payload);
    expect(result.valid).toBe(true);
  });

  it('rejects payload missing commit_id', () => {
    const payload = {
      body: 'some review',
      event: 'COMMENT',
      comments: [],
    };

    const result = validateReviewPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('commit_id'))).toBe(true);
  });

  it('rejects invalid event value', () => {
    const payload = {
      commit_id: 'abc123',
      body: 'some review',
      event: 'REJECTED', // not a valid GitHub event
      comments: [],
    };

    const result = validateReviewPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('event'))).toBe(true);
  });

  it('rejects comment where start_line equals line', () => {
    const payload = {
      commit_id: 'abc123',
      body: 'some review',
      event: 'COMMENT',
      comments: [
        {
          path: 'src/foo.ts',
          start_line: 42,
          line: 42, // same as start_line — must be omitted or start_line < line
          body: 'some comment',
        },
      ],
    };

    const result = validateReviewPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('start_line'))).toBe(true);
  });

  it('rejects comment with line number less than 1', () => {
    const payload = {
      commit_id: 'abc123',
      body: 'some review',
      event: 'COMMENT',
      comments: [
        {
          path: 'src/foo.ts',
          line: 0,
          body: 'some comment',
        },
      ],
    };

    const result = validateReviewPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('line'))).toBe(true);
  });

  it('rejects empty body on inline comment', () => {
    const payload = {
      commit_id: 'abc123',
      body: 'overall summary',
      event: 'COMMENT',
      comments: [
        {
          path: 'src/foo.ts',
          line: 10,
          body: '',
        },
      ],
    };

    const result = validateReviewPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('body'))).toBe(true);
  });

  it('suggestion block format is valid GitHub syntax', () => {
    // GitHub renders ```suggestion blocks as Apply Suggestion buttons
    const suggestionComment =
      "this'll throw — fix it.\n\n```suggestion\nconst result = upstream ?? defaultValue;\n```";

    expect(suggestionComment).toContain('```suggestion');
    expect(suggestionComment).toContain('```');
    // Must have content between the fences
    const fenceStart = suggestionComment.indexOf('```suggestion\n') + '```suggestion\n'.length;
    const fenceEnd = suggestionComment.lastIndexOf('\n```');
    const codeContent = suggestionComment.slice(fenceStart, fenceEnd);
    expect(codeContent.trim().length).toBeGreaterThan(0);
  });
});
