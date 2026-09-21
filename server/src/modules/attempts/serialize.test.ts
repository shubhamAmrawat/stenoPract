import { describe, expect, it } from 'vitest';
import { publicAttempt } from './serialize.js';

const base = {
  _id: 'a1',
  dictationId: 'd1',
  textVersion: 1,
  examProfile: 'SSC_C',
  status: 'submitted',
  typedText: 'hello world',
  startedAt: new Date('2026-01-01T10:00:00Z'),
  deadlineAt: new Date('2026-01-01T10:50:00Z'),
  submittedAt: new Date('2026-01-01T10:20:00Z'),
};

describe('publicAttempt', () => {
  it('always sends a breakdown: a perfect attempt is stored without one (Mongoose drops empty objects)', () => {
    const perfect = { full: 0, half: 0, masterWords: 2, attemptWords: 2, errorPct: 0, limitPct: 5, passed: true };
    const out = publicAttempt({ ...base, result: perfect, mistakes: [] }, { masterText: 'hello world' });
    expect(out.result?.breakdown).toEqual({});
    expect(out.result?.accuracyPct).toBe(100);
    expect(out.mistakes).toEqual([]);
  });

  it('hides the pass limit and verdict that older attempts stored', () => {
    const legacy = { full: 1, half: 0, masterWords: 2, attemptWords: 2, errorPct: 50, limitPct: 5, passed: false, breakdown: { substitution: 1 } };
    const out = publicAttempt({ ...base, category: 'general', result: legacy, mistakes: [] });
    expect(out.result).not.toHaveProperty('limitPct');
    expect(out.result).not.toHaveProperty('passed');
    expect(out).not.toHaveProperty('category');
    expect((out.result as Record<string, unknown>).errorPct).toBe(50);
  });

  it('keeps a stored breakdown as it is', () => {
    const result = { full: 1, half: 0, masterWords: 2, attemptWords: 2, errorPct: 50, limitPct: 5, passed: false, breakdown: { substitution: 1 } };
    const out = publicAttempt({ ...base, result, mistakes: [] });
    expect(out.result?.breakdown).toEqual({ substitution: 1 });
  });

  it('sends no result for a draft', () => {
    const out = publicAttempt({ ...base, status: 'draft', submittedAt: null });
    expect('result' in out).toBe(false);
  });
});
