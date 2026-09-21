import { describe, expect, it } from 'vitest';
import { runChecks, unknownWords } from './checks.js';
import type { Reading } from './extract.js';

const reading = (over: Partial<Reading> = {}): Reading => ({ exerciseNo: 5, printedWordCount: 300, complete: true, text: '', uncertain: [], ...over });
const text = (n: number, extra = '') => `${Array.from({ length: n }, () => 'government').join(' ')} ${extra}`.trim();

describe('unknownWords', () => {
  it('accepts -ize spellings, allow-listed terms and capitalised names', () => {
    expect(unknownWords('The Government recognized despatches and the hon\'ble Members of Lakshmi Bank')).toEqual([]);
  });
  it('reports words the dictionary does not know', () => {
    expect(unknownWords('The government praktised zorbing')).toEqual(['praktised', 'zorbing']);
  });
});

describe('runChecks spelling tolerance', () => {
  const body = text(296, 'zzqa');
  it('stays green with a few unfamiliar words', () => {
    const c = runChecks(reading(), body, [100, 200], 2);
    expect(c.spelling.unknown).toEqual(['zzqa']);
    expect(c.spelling.ok).toBe(true);
    expect(c.green).toBe(true);
  });
  it('is not green with many unfamiliar words', () => {
    const c = runChecks(reading(), text(290, 'zzqa zzqb zzqc zzqd'), [100, 200], 2);
    expect(c.spelling.ok).toBe(false);
    expect(c.green).toBe(false);
  });
});
