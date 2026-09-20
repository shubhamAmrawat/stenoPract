import { Types } from 'mongoose';
import type { Mistake } from '../evaluator/index.js';
import { DictationText, MasterWordStats, UserDictationState, UserWordStats } from '../models/index.js';

/** "Minister," -> "minister": the form used to key per-word statistics. */
export function wordKey(raw: string): string {
  return raw.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

interface Applied {
  attemptId: string;
  userId: string;
  dictationId: string;
  textVersion: number;
  errorPct: number;
  submittedAt: Date;
  mistakes: Mistake[];
}

/**
 * Updates the running statistics after an attempt is evaluated:
 *  - userWordStats: which words THIS student keeps getting wrong
 *  - masterWordStats: which words EVERYONE gets wrong (suspect transcript words)
 *  - userDictationState: seen / attempts / best score
 * The caller guarantees this runs at most once per attempt (Attempt.statsApplied).
 */
export async function applyAttemptStats(a: Applied): Promise<void> {
  const userId = new Types.ObjectId(a.userId);
  const dictationId = new Types.ObjectId(a.dictationId);

  // One row per master word, even if it carries several mistakes (e.g. spelling + full stop).
  const byIndex = new Map<number, { word: string; weight: number; kinds: string[] }>();
  for (const m of a.mistakes) {
    if (m.masterIndex === undefined || !m.master) continue;
    const entry = byIndex.get(m.masterIndex) ?? { word: m.master, weight: 0, kinds: [] };
    entry.weight += m.weight;
    entry.kinds.push(m.kind);
    byIndex.set(m.masterIndex, entry);
  }

  const kindIncs = (kinds: string[]) => {
    const inc: Record<string, number> = {};
    for (const k of kinds) inc[`kinds.${k}`] = (inc[`kinds.${k}`] ?? 0) + 1;
    return inc;
  };

  // Per student: merge indices that share the same word first, so one bulk op per distinct word.
  const perWord = new Map<string, { weight: number; misses: number; kinds: string[] }>();
  for (const e of byIndex.values()) {
    const key = wordKey(e.word);
    if (!key) continue;
    const cur = perWord.get(key) ?? { weight: 0, misses: 0, kinds: [] };
    cur.weight += e.weight;
    cur.misses += 1;
    cur.kinds.push(...e.kinds);
    perWord.set(key, cur);
  }

  const ops: Promise<unknown>[] = [];

  if (perWord.size) {
    ops.push(
      UserWordStats.bulkWrite(
        [...perWord].map(([word, v]) => ({
          updateOne: {
            filter: { userId, word },
            update: {
              $inc: { misses: v.misses, weightedMisses: v.weight, ...kindIncs(v.kinds) },
              $set: { lastMissedAt: a.submittedAt },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      ),
    );
  }

  if (byIndex.size) {
    ops.push(
      MasterWordStats.bulkWrite(
        [...byIndex].map(([wordIndex, e]) => ({
          updateOne: {
            filter: { dictationId, textVersion: a.textVersion, wordIndex },
            update: { $inc: { misses: 1, ...kindIncs(e.kinds) }, $setOnInsert: { word: e.word } },
            upsert: true,
          },
        })),
        { ordered: false },
      ),
    );
  }

  ops.push(DictationText.updateOne({ dictationId, version: a.textVersion }, { $inc: { attemptCount: 1 } }));
  ops.push(
    UserDictationState.updateOne(
      { userId, dictationId },
      {
        $set: { seen: true, lastErrorPct: a.errorPct, lastAttemptAt: a.submittedAt },
        $inc: { attemptsCount: 1 },
        $min: { bestErrorPct: a.errorPct },
      },
      { upsert: true },
    ),
  );

  await Promise.all(ops);
}
