import { DEFAULT_LEXICON_INPUT } from '../evaluator/index.js';
import { logger } from '../config/logger.js';
import { Abbreviation, AlternateForm, ExamProfile } from '../models/index.js';

/**
 * Starting values only. Inserted if missing and NEVER overwritten afterwards,
 * so anything an admin edits stays edited.
 *
 * SSC_C and SSC_D limits, word counts and transcription times were checked against SSC's own documents
 * (skill-test result write-up: Grade C 5% general / 7% reserved, Grade D 7% / 10%; recruitment notice: Grade C
 * 100 wpm and 40 min, Grade D 80 wpm and 50 min, English; evaluation guidelines: 1000 / 800 word master passages).
 * COMMON is our own practice profile, so it stays unverified.
 */
const EXAM_PROFILES = [
  { code: 'SSC_C', name: 'SSC Stenographer Grade C', wpm: 100, durationMin: 40, words: 1000, limits: { general: 5, reserved: 7 }, verifiedAgainstNotice: true },
  { code: 'SSC_D', name: 'SSC Stenographer Grade D', wpm: 80, durationMin: 50, words: 800, limits: { general: 7, reserved: 10 }, verifiedAgainstNotice: true },
  { code: 'COMMON', name: 'Common practice', wpm: 100, durationMin: 45, words: 1000, limits: { general: 5, reserved: 7 } },
];

export async function seedReferenceData(): Promise<void> {
  await Promise.all([ExamProfile.init(), AlternateForm.init(), Abbreviation.init()]);

  await ExamProfile.bulkWrite(
    EXAM_PROFILES.map((p) => ({
      updateOne: { filter: { code: p.code }, update: { $setOnInsert: p }, upsert: true },
    })),
  );

  await AlternateForm.bulkWrite(
    DEFAULT_LEXICON_INPUT.alternates.map((group) => ({
      updateOne: {
        filter: { canonical: group[0]!.toLowerCase() },
        update: { $setOnInsert: { canonical: group[0]!.toLowerCase(), variants: group } },
        upsert: true,
      },
    })),
  );

  const dotted = new Set(DEFAULT_LEXICON_INPUT.dotAbbreviations);
  const abbrs = new Map<string, { expansions: string[]; dotted: boolean }>();
  for (const [abbr, expansions] of Object.entries(DEFAULT_LEXICON_INPUT.abbreviations)) {
    abbrs.set(abbr, { expansions, dotted: dotted.has(abbr) });
  }
  for (const d of dotted) if (!abbrs.has(d)) abbrs.set(d, { expansions: [], dotted: true });

  await Abbreviation.bulkWrite(
    [...abbrs].map(([abbr, v]) => ({
      updateOne: { filter: { abbr }, update: { $setOnInsert: { abbr, ...v } }, upsert: true },
    })),
  );

  logger.info('Reference data ready (exam profiles, alternate forms, abbreviations)');
}
