import { countWords } from '../../evaluator/index.js';
import { isDictionaryWord } from '../../evaluator/spell.js';
import type { Reading } from './extract.js';

export interface ScanChecks {
  /** The heading number was read. */
  exerciseFound: boolean;
  /** Heading and footer were both on the image. */
  complete: boolean;
  markers: { found: number; expected: number | null; ok: boolean };
  wordCount: { words: number; printed: number | null; ok: boolean };
  spelling: { unknown: string[]; ok: boolean };
  reads: { passes: number; agree: boolean };
  /** Every check passed and nothing was flagged: safe to approve in one click. */
  green: boolean;
}

/**
 * Words a British-English dictionary does not know but that are normal in these books
 * (Indian units, Parliament terms, common variant spellings). Lower case.
 */
const KNOWN = new Set([
  'lakh', 'lakhs', 'crore', 'crores', 'godown', 'godowns', 'hon', 'ble', "hon'ble", 'hon’ble', 'govt', 'sic', 'panchayat', 'panchayats', 'gram', 'sabha', 'lok', 'rajya',
  'kharif', 'rabi', 'jawan', 'jawans', 'sepoy', 'subedar', 'agmark', 'unesco', 'unicef', 'ex', 'non', 'infra', 'structure', 'co', 'operative',
  'floatation', 'unfavorably', 'favorably', 'centers', 'center', 'program', 'programs', 'organization', 'organizations', 'organized', 'labor',
  'oilseeds', 'despatch', 'despatches', 'despatched', 'hydel', 'gobar', 'upliftment', 'condemnable', 'promotees', 'goondas', 'pilferages', 'ticketless', 'unpunctuality', 'bidis', 'motorable', 'foodgrain', 'foodgrains', 'handedly', 'quintal', 'quintals', 'preposition', 'gradation', 'standardization', 'assignation', 'reciprocated', 'vicissitudes', 'insuperable',
]);

/** The books print -ize/-ise both ways and the dictionary is British: try the -ise form of an -ize word. */
const ise = (w: string) => w.replace(/iz(e|es|ed|ing|er|ers|ation|ations)$/, 'is$1');

/** Lower-case words of the transcript that the dictionary and the allow-list both do not know. */
export function unknownWords(text: string): string[] {
  const out = new Set<string>();
  for (const chunk of text.split(/\s+/)) {
    for (const part of chunk.split(/[-–—/]/)) {
      const w = part.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '').replace(/['’]s$/i, '');
      if (w.length < 3 || /\d/.test(w) || /^\p{Lu}/u.test(w) || /[^\p{L}']/u.test(w)) continue; // short, numbers, Capitalised (names, sentence starts)
      const lower = w.toLowerCase();
      if (KNOWN.has(lower) || isDictionaryWord(lower) || (ise(lower) !== lower && isDictionaryWord(ise(lower)))) continue;
      out.add(lower);
    }
  }
  return [...out].sort();
}

/** Offsets seen in the printed books: the book's own count runs 0-45 words ahead of a plain word count, and never behind by more than a few. */
const MARKER_BEHIND = 10;
const MARKER_AHEAD = 50;
/** A few unfamiliar words are normal (names, Indian-English terms); this many or more looks like a misread page. */
const SPELLING_LIMIT = 4;

export function runChecks(reading: Reading, masterText: string, checkpoints: number[], passes: number): ScanChecks {
  const words = countWords(masterText);
  const printed = reading.printedWordCount;

  const expectedMarkers = printed ? Math.floor((printed - 1) / 100) : null;
  const markersInPlace =
    expectedMarkers !== null &&
    checkpoints.length === expectedMarkers &&
    checkpoints.every((c, i) => c >= (i + 1) * 100 - MARKER_AHEAD && c <= (i + 1) * 100 + MARKER_BEHIND) &&
    checkpoints.every((c, i) => i === 0 || c > checkpoints[i - 1]!);

  const wordCountOk = printed ? words >= printed * 0.92 && words <= printed * 1.05 : false;
  const unknown = unknownWords(masterText);
  const agree = !reading.uncertain.some((u) => u.kind === 'reads_differ');

  const exerciseFound = reading.exerciseNo !== null;
  const spellingOk = unknown.length < SPELLING_LIMIT;
  const green =
    exerciseFound && reading.complete && markersInPlace && wordCountOk && spellingOk && agree && reading.uncertain.length === 0 && masterText.length > 0;

  return {
    exerciseFound,
    complete: reading.complete,
    markers: { found: checkpoints.length, expected: expectedMarkers, ok: markersInPlace },
    wordCount: { words, printed, ok: wordCountOk },
    spelling: { unknown, ok: spellingOk },
    reads: { passes, agree },
    green,
  };
}
