import { align } from './align.js';
import type { CompareContext } from './compare.js';
import { buildLexicon, type Lexicon } from './lexicon.js';
import { isDictionaryWord } from './spell.js';
import { countWords, tokenize } from './tokenize.js';
import {
  DEFAULT_RULES,
  type DiffOp,
  type EvaluationResult,
  type Mistake,
  type MistakeKind,
  type RuleSet,
} from './types.js';

export * from './types.js';
export { buildLexicon, DEFAULT_LEXICON_INPUT, type Lexicon, type LexiconInput } from './lexicon.js';
export { countWords } from './tokenize.js';

export interface EvaluateOptions {
  rules?: Partial<RuleSet>;
  lexicon?: Lexicon;
  /** Maximum error % allowed to pass. Omit to skip the pass/fail verdict. */
  limitPct?: number;
  /** Override the dictionary check (used in tests). */
  isKnownWord?: (lowerCasedWord: string) => boolean;
}

const defaultLexicon = buildLexicon();

export function roundTo2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Compare a student's transcription with the master transcript.
 * Pure function: no I/O, same input -> same output.
 */
export function evaluate(masterText: string, attemptText: string, options: EvaluateOptions = {}): EvaluationResult {
  const rules: RuleSet = { ...DEFAULT_RULES, ...options.rules };
  const lexicon = options.lexicon ?? defaultLexicon;
  const dictionaryCheck = options.isKnownWord ?? isDictionaryWord;

  const masterTokens = tokenize(masterText, lexicon);
  const attemptTokens = tokenize(attemptText, lexicon);

  // A word that appears in the master text is a real word even if the dictionary has never seen it
  // (names, places), so typing it in the wrong slot is a substitution, not a spelling slip.
  const masterCores = new Set(masterTokens.map((t) => t.core));
  const ctx: CompareContext = {
    rules,
    lexicon,
    isKnownWord: (w) => masterCores.has(w) || dictionaryCheck(w),
  };

  const ops = align(masterTokens, attemptTokens, ctx);

  const diff: DiffOp[] = [];
  const mistakes: Mistake[] = [];
  const breakdown: Partial<Record<MistakeKind, number>> = {};
  let full = 0;
  let half = 0;

  const record = (m: Mistake) => {
    mistakes.push(m);
    breakdown[m.kind] = (breakdown[m.kind] ?? 0) + 1;
    if (m.weight === 1) full++;
    else half++;
  };

  for (const step of ops) {
    const pos = diff.length;
    if (step.op === 'del') {
      const m = masterTokens[step.mi]!;
      diff.push({ t: 'd', m: m.raw, k: ['omission'] });
      record({ kind: 'omission', weight: 1, pos, masterIndex: step.mi, master: m.raw });
    } else if (step.op === 'ins') {
      const a = attemptTokens[step.ai]!;
      const prev = attemptTokens[step.ai - 1];
      const next = attemptTokens[step.ai + 1];
      const repeated = (prev && prev.key === a.key) || (next && next.key === a.key);
      const kind: MistakeKind = repeated ? 'repetition' : 'addition';
      diff.push({ t: 'i', a: a.raw, k: [kind] });
      record({ kind, weight: 1, pos, attempt: a.raw });
    } else {
      const m = masterTokens[step.mi]!;
      const a = attemptTokens[step.ai]!;
      const r = step.result;
      if (r.kind === 'sub') {
        const kind = r.subKind ?? 'substitution';
        diff.push({ t: 's', m: m.raw, a: a.raw, k: [kind] });
        record({ kind, weight: 1, pos, masterIndex: step.mi, master: m.raw, attempt: a.raw });
      } else {
        const op: DiffOp = { t: 'm', m: m.raw, a: a.raw };
        if (r.issues.length) op.k = r.issues.map((i) => i.kind);
        diff.push(op);
        for (const issue of r.issues) {
          record({ kind: issue.kind, weight: issue.weight, pos, masterIndex: step.mi, master: m.raw, attempt: a.raw });
        }
      }
    }
  }

  const masterWords = countWords(masterText);
  const errorPct = masterWords === 0 ? 0 : roundTo2(((full + half / 2) / masterWords) * 100);
  const limitPct = options.limitPct ?? null;

  return {
    full,
    half,
    masterWords,
    attemptWords: countWords(attemptText),
    errorPct,
    limitPct,
    passed: limitPct === null ? null : errorPct <= limitPct,
    breakdown,
    mistakes,
    diff,
  };
}
