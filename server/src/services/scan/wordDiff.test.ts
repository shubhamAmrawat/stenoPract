import { describe, expect, it } from 'vitest';
import { diffWords, words } from './wordDiff.js';
describe('diffWords', () => {
  it('finds nothing in identical text', () => { expect(diffWords(words('a b c'), words('a b c'))).toEqual([]); });
  it('finds substitution, insertion and deletion', () => {
    const s = diffWords(words('the farmers are here today'), words('the farmer are very here'));
    expect(s.map((x) => [x.a.join(' '), x.b.join(' '), x.aIndex])).toEqual([['farmers', 'farmer', 1], ['', 'very', 3], ['today', '', 4]]);
  });
  it('handles empty input', () => { expect(diffWords([], words('x y'))).toEqual([{ a: [], b: ['x', 'y'], aIndex: 0 }]); });
});
