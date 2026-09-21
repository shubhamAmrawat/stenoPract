import { describe, expect, it } from 'vitest';
import { GROUP_OF_KIND, MISTAKE_GROUPS, kindsInGroup } from './groups.js';

const ALL_KINDS = [
  'omission', 'addition', 'repetition', 'substitution', 'incomplete_word', 'abbreviation', 'all_caps',
  'spelling', 'plural', 'full_stop', 'capitalisation', 'comma',
];

describe('mistake groups', () => {
  it('places every kind in exactly one known group', () => {
    expect(Object.keys(GROUP_OF_KIND).sort()).toEqual([...ALL_KINDS].sort());
    for (const g of Object.values(GROUP_OF_KIND)) expect(MISTAKE_GROUPS).toContain(g);
    const seen = MISTAKE_GROUPS.flatMap((g) => kindsInGroup(g));
    expect(seen.sort()).toEqual([...ALL_KINDS].sort());
  });

  it('has no empty group', () => {
    for (const g of MISTAKE_GROUPS) expect(kindsInGroup(g).length).toBeGreaterThan(0);
  });
});
