/** Every kind of mistake the evaluator can report. */
export type MistakeKind =
  // full mistakes (weight 1)
  | 'omission'
  | 'addition'
  | 'repetition'
  | 'substitution'
  | 'incomplete_word'
  | 'abbreviation'
  | 'all_caps'
  // half mistakes (weight 0.5)
  | 'spelling'
  | 'plural'
  | 'full_stop'
  | 'capitalisation'
  | 'comma';

export type MistakeWeight = 1 | 0.5;

export interface Mistake {
  kind: MistakeKind;
  weight: MistakeWeight;
  /** Index of the diff op this mistake belongs to (for highlighting in the UI). */
  pos: number;
  /** Position of the master word in the tokenised master text (stable for a given text version). */
  masterIndex?: number;
  /** Word from the master transcript, if any (undefined for additions). */
  master?: string;
  /** Word the student typed, if any (undefined for omissions). */
  attempt?: string;
}

/**
 * One step of the aligned comparison, in reading order.
 *  m = matched (may still carry half/full mistakes in `k`), s = substituted,
 *  d = master word missing from the attempt, i = extra word in the attempt.
 */
export interface DiffOp {
  t: 'm' | 's' | 'd' | 'i';
  m?: string;
  a?: string;
  k?: MistakeKind[];
}

export interface EvaluationResult {
  full: number;
  half: number;
  masterWords: number;
  attemptWords: number;
  /** (full + half/2) / masterWords * 100, rounded to 2 decimals. */
  errorPct: number;
  /** null when no limit was supplied. */
  limitPct: number | null;
  passed: boolean | null;
  breakdown: Partial<Record<MistakeKind, number>>;
  mistakes: Mistake[];
  diff: DiffOp[];
}

export interface RuleSet {
  /** 'ignore' (default): commas are never penalised. 'half': a missing/extra comma is a half mistake. */
  commas: 'ignore' | 'half';
}

export const DEFAULT_RULES: RuleSet = { commas: 'ignore' };

/** A single comparable unit of text (usually one word). */
export interface Token {
  /** As typed, punctuation included, e.g. `Government.` */
  raw: string;
  /** Lower-cased word without surrounding punctuation. */
  core: string;
  /** Canonical comparison key (alternate forms / numbers folded together). */
  key: string;
  sentenceEnd: boolean;
  comma: boolean;
  capitalised: boolean;
  upper: boolean;
  numeric: boolean;
}
