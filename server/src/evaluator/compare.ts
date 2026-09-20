import type { Lexicon } from './lexicon.js';
import type { MistakeKind, MistakeWeight, RuleSet, Token } from './types.js';

export interface Issue {
  kind: MistakeKind;
  weight: MistakeWeight;
}

export interface CompareContext {
  rules: RuleSet;
  lexicon: Lexicon;
  /** Is this lower-cased word a real word? (dictionary + anything found in the master text) */
  isKnownWord: (word: string) => boolean;
}

export type PairKind = 'match' | 'sub';

export interface PairResult {
  kind: PairKind;
  /** Cost in half-mistake units (1 = a half mistake, 2 = a full mistake). */
  cost: number;
  /** Issues attached to a matched pair. Empty for a perfect match. */
  issues: Issue[];
  /** For 'sub': what sort of full mistake it is. */
  subKind?: MistakeKind;
}

/** Optimal string alignment distance (Levenshtein + adjacent transposition), with early exit. */
export function osaDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev2: number[] = new Array<number>(lb + 1).fill(0);
  let prev: number[] = Array.from({ length: lb + 1 }, (_, j) => j);
  let cur: number[] = new Array<number>(lb + 1).fill(0);
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = cur[0]!;
    for (let j = 1; j <= lb; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a.charCodeAt(i - 1) === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) {
        v = Math.min(v, prev2[j - 2]! + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    [prev2, prev, cur] = [prev, cur, prev2];
  }
  return prev[lb]!;
}

/** Plurals that are not formed by adding -s/-es. Singular for plural (or the reverse) is a half mistake either way. */
const IRREGULAR_PLURALS: readonly [string, string][] = [
  ['child', 'children'], ['person', 'people'], ['foot', 'feet'], ['tooth', 'teeth'], ['mouse', 'mice'], ['goose', 'geese'], ['ox', 'oxen'],
  ['criterion', 'criteria'], ['phenomenon', 'phenomena'], ['datum', 'data'], ['medium', 'media'], ['curriculum', 'curricula'],
  ['memorandum', 'memoranda'], ['bacterium', 'bacteria'], ['stimulus', 'stimuli'], ['alumnus', 'alumni'], ['formula', 'formulae'],
  ['analysis', 'analyses'], ['basis', 'bases'], ['crisis', 'crises'], ['hypothesis', 'hypotheses'], ['thesis', 'theses'],
  ['index', 'indices'], ['appendix', 'appendices'],
];
const IRREGULAR = new Map<string, string>();
for (const [one, many] of IRREGULAR_PLURALS) {
  IRREGULAR.set(one, many);
  IRREGULAR.set(many, one);
}

/** master = attempt +/- s | es | (y -> ies) | (f/fe -> ves) | (-man -> -men) | a listed irregular pair */
function isPluralPair(m: string, a: string): boolean {
  if (IRREGULAR.get(m) === a) return true;
  if (m.length >= 3 && a.length === m.length && ((m.endsWith('man') && a === m.slice(0, -3) + 'men') || (m.endsWith('men') && a === m.slice(0, -3) + 'man'))) return true;
  const diff = m.length - a.length;
  if (diff === 0 || diff > 3 || diff < -3) return false;
  const [short, long] = diff < 0 ? [m, a] : [a, m];
  if (short.length < 3) return false;
  if (long === short + 's' || long === short + 'es') return true;
  if (short.endsWith('y') && long === short.slice(0, -1) + 'ies') return true;
  return (short.endsWith('f') && long === short.slice(0, -1) + 'ves') || (short.endsWith('fe') && long === short.slice(0, -2) + 'ves');
}

function isNearSpelling(m: string, a: string): boolean {
  if (m.length < 3) return false;
  const max = Math.max(1, Math.floor(m.length * 0.3));
  if (Math.abs(m.length - a.length) > max) return false;
  // Typos almost never hit both the first and the last letter; this skips most pairs cheaply.
  if (m.charCodeAt(0) !== a.charCodeAt(0) && m.charCodeAt(m.length - 1) !== a.charCodeAt(a.length - 1)) return false;
  if (/\d/.test(m) || /\d/.test(a)) return false; // 5th vs 6th is a wrong number, not a typo
  return osaDistance(m, a, max) <= max;
}

const SUB_PLAIN: PairResult = { kind: 'sub', cost: 2, issues: [], subKind: 'substitution' };
const SUB_ABBREV: PairResult = { kind: 'sub', cost: 2, issues: [], subKind: 'abbreviation' };
const SUB_INCOMPLETE: PairResult = { kind: 'sub', cost: 2, issues: [], subKind: 'incomplete_word' };
const NO_ISSUES: Issue[] = [];
const PERFECT: PairResult = { kind: 'match', cost: 0, issues: NO_ISSUES };

function secondaryIssues(m: Token, a: Token, ctx: CompareContext): Issue[] {
  if (
    m.sentenceEnd === a.sentenceEnd &&
    m.upper === a.upper &&
    m.capitalised === a.capitalised &&
    (ctx.rules.commas === 'ignore' || m.comma === a.comma)
  ) {
    return NO_ISSUES;
  }
  const out: Issue[] = [];
  if (a.upper && !m.upper && !a.numeric) {
    out.push({ kind: 'all_caps', weight: 1 });
  } else if (m.capitalised && !a.capitalised && !m.numeric && !a.numeric) {
    out.push({ kind: 'capitalisation', weight: 0.5 });
  }
  if (m.sentenceEnd !== a.sentenceEnd) out.push({ kind: 'full_stop', weight: 0.5 });
  if (ctx.rules.commas === 'half' && m.comma !== a.comma) out.push({ kind: 'comma', weight: 0.5 });
  return out;
}

function issuesCost(issues: Issue[]): number {
  let c = 0;
  for (const i of issues) c += i.weight * 2;
  return c;
}

/** Compare one master token with one attempt token. */
export function comparePair(m: Token, a: Token, ctx: CompareContext): PairResult {
  if (m.key === a.key) {
    const issues = secondaryIssues(m, a, ctx);
    return issues === NO_ISSUES ? PERFECT : { kind: 'match', cost: issuesCost(issues), issues };
  }

  if (!m.numeric && !a.numeric) {
    if (isPluralPair(m.core, a.core)) {
      const issues: Issue[] = [{ kind: 'plural', weight: 0.5 }, ...secondaryIssues(m, a, ctx)];
      return { kind: 'match', cost: issuesCost(issues), issues };
    }
    if (isNearSpelling(m.core, a.core) && !ctx.isKnownWord(a.core)) {
      const issues: Issue[] = [{ kind: 'spelling', weight: 0.5 }, ...secondaryIssues(m, a, ctx)];
      return { kind: 'match', cost: issuesCost(issues), issues };
    }
  }

  const expansions = ctx.lexicon.abbrevMap.get(m.key);
  if (expansions?.has(a.key)) return SUB_ABBREV;

  if (a.core.length >= 2 && a.core.length < m.core.length && m.core.startsWith(a.core)) return SUB_INCOMPLETE;
  return SUB_PLAIN;
}
