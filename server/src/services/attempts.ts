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
  category: 'general' | 'reserved';
  typedText: string;
}

/** Runs the evaluator for one attempt against its pinned transcript version and the profile's limit. */
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
    limitPct: profile?.limits?.[inputs.category] ?? undefined,
  });
  return { result, masterText: text.masterText, rulesVersion: profile?.rulesVersion ?? 1 };
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
    category: draft.category,
    typedText,
  });

  const now = new Date();
  const { mistakes, ...summary } = result;
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

export function toObjectId(id: string): Types.ObjectId {
  return new Types.ObjectId(id);
}
