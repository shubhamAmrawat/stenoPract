import { DEFAULT_LEXICON_INPUT } from '../evaluator/index.js';
import { logger } from '../config/logger.js';
import { Abbreviation, AlternateForm, ExamProfile, ResourceGroup } from '../models/index.js';

/**
 * Starting values only. Inserted if missing and NEVER overwritten afterwards,
 * so anything an admin edits stays edited.
 *
 * SSC_C and SSC_D word counts and transcription times were checked against SSC's own documents
 * (recruitment notice: Grade C 100 wpm and 40 min, Grade D 80 wpm and 50 min, English;
 * evaluation guidelines: 1000 / 800 word master passages). Attempts show raw statistics, so no pass limits are seeded.
 * COMMON is our own practice profile, so it stays unverified.
 */
const EXAM_PROFILES = [
  { code: 'SSC_C', name: 'SSC Stenographer Grade C', wpm: 100, durationMin: 40, words: 1000, verifiedAgainstNotice: true },
  { code: 'SSC_D', name: 'SSC Stenographer Grade D', wpm: 80, durationMin: 50, words: 800, verifiedAgainstNotice: true },
  { code: 'COMMON', name: 'Common practice', wpm: 100, durationMin: 45, words: 1000 },
];

/** The two shelves the app started with. Only created on a database that has none, so a shelf an admin renames or deletes stays that way. */
const DEFAULT_RESOURCE_GROUPS = [
  { slug: 'kc-magazines', title: 'KC Magazines PDF', blurb: 'Kailash Chandra dictation books, volume by volume.', order: 1 },
  { slug: 'ssc-previous-years', title: 'SSC Steno previous years skill test matter', blurb: 'Past skill-test dictation matter for offline practice.', order: 2 },
];

export async function seedReferenceData(): Promise<void> {
  await Promise.all([ExamProfile.init(), AlternateForm.init(), Abbreviation.init(), ResourceGroup.init()]);
  if ((await ResourceGroup.estimatedDocumentCount()) === 0) await ResourceGroup.insertMany(DEFAULT_RESOURCE_GROUPS);

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
