import { Types } from 'mongoose';
import { evaluate, type EvaluationResult } from '../evaluator/index.js';
import { ApiError } from '../middleware/errors.js';
import { Attempt, DictationText, ExamProfile } from '../models/index.js';
import { getLexicon } from './lexicon.js';
import { applyAttemptStats } from './stats.js';

export interface EvaluationInputs {
  textVersion: number;
  dictationId: Types.ObjectId | string;
  examProfile: string;
  typedText: string;
}

/** Runs the evaluator for one attempt against its pinned transcript version. Results are raw statistics: no pass/fail limit is applied. */
export async function evaluateAgainstMaster(inputs: EvaluationInputs): Promise<{ result: EvaluationResult; masterText: string; rulesVersion: number }> {
  const [text, profile, lexicon] = await Promise.all([
    DictationText.findOne({ dictationId: inputs.dictationId, version: inputs.textVersion }).lean(),
    ExamProfile.findOne({ code: inputs.examProfile }).lean(),
    getLexicon(),
  ]);
  if (!text) throw new ApiError(500, 'Master transcript is missing', 'TRANSCRIPT_MISSING');

  const result = evaluate(text.masterText, inputs.typedText, {
    lexicon,
    rules: { commas: profile?.rules?.commas === 'half' ? 'half' : 'ignore' },
  });
  return { result, masterText: text.masterText, rulesVersion: profile?.rulesVersion ?? 1 };
}

/** Splits an evaluation into the summary that is stored on the attempt (without the unused pass/fail fields) and its mistakes. */
export function storableResult(result: EvaluationResult) {
  const { limitPct: _limitPct, passed: _passed, ...rest } = result;
  return rest;
}

/**
 * Evaluates and stores a draft attempt exactly once.
 * Returns the stored attempt and whether THIS call was the one that submitted it.
 */
export async function submitAttempt(params: { attemptId: string; userId: string; typedText?: string; auto?: boolean }) {
  const draft = await Attempt.findOne({ _id: params.attemptId, userId: params.userId });
  if (!draft) throw ApiError.notFound('Attempt not found');
  if (draft.status === 'submitted') return { attempt: draft.toObject(), justSubmitted: false };

  const typedText = params.typedText ?? draft.typedText ?? '';
  const { result, rulesVersion } = await evaluateAgainstMaster({
    textVersion: draft.textVersion,
    dictationId: draft.dictationId,
    examProfile: draft.examProfile,
    typedText,
  });

  const now = new Date();
  const { mistakes, ...summary } = storableResult(result);
  // Atomic claim: only one concurrent request can flip draft -> submitted.
  const claimed = await Attempt.findOneAndUpdate(
    { _id: draft._id, userId: params.userId, status: 'draft' },
    {
      $set: {
        status: 'submitted',
        typedText,
        submittedAt: now,
        timeTakenSec: Math.max(0, Math.round((now.getTime() - draft.startedAt.getTime()) / 1000)),
        autoSubmitted: params.auto ?? false,
        result: summary,
        mistakes,
      },
      $push: {
        evaluationHistory: {
          at: now,
          textVersion: draft.textVersion,
          rulesVersion,
          full: result.full,
          half: result.half,
          errorPct: result.errorPct,
        },
      },
    },
    { returnDocument: 'after' },
  );

  if (!claimed) {
    const current = await Attempt.findById(draft._id);
    return { attempt: current!.toObject(), justSubmitted: false };
  }

  // Run the stats update once. Claim first so a crash can only under-count, never double-count.
  const statsClaim = await Attempt.updateOne({ _id: claimed._id, statsApplied: false }, { $set: { statsApplied: true } });
  if (statsClaim.modifiedCount === 1) {
    await applyAttemptStats({
      attemptId: String(claimed._id),
      userId: params.userId,
      dictationId: String(claimed.dictationId),
      textVersion: claimed.textVersion,
      errorPct: result.errorPct,
      submittedAt: now,
      mistakes,
    });
  }
  return { attempt: claimed.toObject(), justSubmitted: true };
}

export interface ReevaluateOutcome {
  id: string;
  before: number | null;
  after: number;
  /** False when the stored analysis was already up to date, so nothing was written. */
  changed: boolean;
  textVersion: number;
}

/**
 * Re-grades one submitted attempt against `targetVersion` of its transcript, using the current profile rules.
 * Only writes when the outcome differs from what is stored. Running word statistics are NOT re-counted.
 * Pass `userId` to restrict it to that student's own attempt.
 */
export async function reevaluateAttempt(attemptId: string, targetVersion: number, userId?: string): Promise<ReevaluateOutcome> {
  const attempt = await Attempt.findOne(userId ? { _id: attemptId, userId } : { _id: attemptId });
  if (!attempt || attempt.status !== 'submitted') throw ApiError.notFound('Submitted attempt not found');
  const before = attempt.result?.errorPct ?? null;
  const { result, rulesVersion } = await evaluateAgainstMaster({
    textVersion: targetVersion,
    dictationId: attempt.dictationId,
    examProfile: attempt.examProfile,
    typedText: attempt.typedText ?? '',
  });
  const { mistakes, ...summary } = storableResult(result);

  const stored = attempt.result;
  const same =
    attempt.textVersion === targetVersion &&
    stored?.full === summary.full &&
    stored?.half === summary.half &&
    stored?.masterWords === summary.masterWords &&
    stored?.attemptWords === summary.attemptWords &&
    stored?.errorPct === summary.errorPct &&
    JSON.stringify(stored?.breakdown ?? {}) === JSON.stringify(summary.breakdown ?? {});
  if (same) return { id: String(attempt._id), before, after: result.errorPct, changed: false, textVersion: targetVersion };

  attempt.textVersion = targetVersion;
  attempt.set('result', summary);
  attempt.set('mistakes', mistakes);
  attempt.evaluationHistory.push({ at: new Date(), textVersion: targetVersion, rulesVersion, full: result.full, half: result.half, errorPct: result.errorPct });
  await attempt.save();
  return { id: String(attempt._id), before, after: result.errorPct, changed: true, textVersion: targetVersion };
}

export function toObjectId(id: string): Types.ObjectId {
  return new Types.ObjectId(id);
}
