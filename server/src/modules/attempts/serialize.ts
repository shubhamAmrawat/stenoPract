import { roundTo2 } from '../../evaluator/index.js';

interface AttemptLike {
  _id: unknown;
  dictationId: unknown;
  textVersion: number;
  examProfile: string;
  category: string;
  status: string;
  typedText?: string | null;
  listenedWpm?: number | null;
  startedAt: Date;
  deadlineAt: Date;
  submittedAt?: Date | null;
  timeTakenSec?: number | null;
  autoSubmitted?: boolean | null;
  result?: Record<string, unknown> | null;
  mistakes?: unknown[] | null;
}

export function publicAttempt(a: AttemptLike, opts: { masterText?: string } = {}) {
  const durationSec = Math.round((a.deadlineAt.getTime() - a.startedAt.getTime()) / 1000);
  const errorPct = typeof a.result?.errorPct === 'number' ? a.result.errorPct : null;
  return {
    id: String(a._id),
    dictationId: String(a.dictationId),
    textVersion: a.textVersion,
    examProfile: a.examProfile,
    category: a.category,
    status: a.status,
    typedText: a.typedText ?? '',
    listenedWpm: a.listenedWpm ?? null,
    startedAt: a.startedAt,
    deadlineAt: a.deadlineAt,
    durationSec,
    submittedAt: a.submittedAt ?? null,
    timeTakenSec: a.timeTakenSec ?? null,
    overtimeSec: a.submittedAt ? Math.max(0, Math.round((a.submittedAt.getTime() - a.deadlineAt.getTime()) / 1000)) : null,
    autoSubmitted: a.autoSubmitted ?? false,
    serverNow: new Date(),
    ...(a.status === 'submitted' && a.result
      ? {
          // Mongoose drops an empty object on save, so a perfect attempt (no mistakes) is stored without a breakdown: always send one.
          result: { ...a.result, breakdown: a.result.breakdown ?? {}, accuracyPct: errorPct === null ? null : roundTo2(Math.max(0, 100 - errorPct)) },
          mistakes: a.mistakes ?? [],
          // The master transcript is only ever revealed after the attempt is submitted.
          masterText: opts.masterText ?? null,
        }
      : {}),
  };
}

/** Compact row for history lists (no diff, no transcript). */
export function attemptSummary(
  a: AttemptLike,
  dictation?: { title: string; exerciseNo: number } | null,
) {
  const r = (a.result ?? {}) as Record<string, unknown>;
  return {
    id: String(a._id),
    dictationId: String(a.dictationId),
    dictationTitle: dictation?.title ?? null,
    exerciseNo: dictation?.exerciseNo ?? null,
    examProfile: a.examProfile,
    category: a.category,
    status: a.status,
    startedAt: a.startedAt,
    submittedAt: a.submittedAt ?? null,
    timeTakenSec: a.timeTakenSec ?? null,
    full: r.full ?? null,
    half: r.half ?? null,
    errorPct: r.errorPct ?? null,
    limitPct: r.limitPct ?? null,
    passed: r.passed ?? null,
  };
}
