import { Router } from 'express';
import type { Types } from 'mongoose';
import { z } from 'zod';
import { roundTo2 } from '../../evaluator/index.js';
import { ApiError } from '../../middleware/errors.js';
import { submitLimiter } from '../../middleware/security.js';
import { idParam, objectId, parse } from '../../middleware/validate.js';
import { Attempt, Dictation, DictationText, ExamProfile, User, UserDictationState } from '../../models/index.js';
import { reevaluateAttempt, submitAttempt } from '../../services/attempts.js';
import { attemptSummary, publicAttempt } from './serialize.js';

export const attemptsRouter = Router();

const MAX_TEXT = 30_000;

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

// Start ("Transcribe Now") - or resume the open draft, so a refresh never loses the timer or the text.
attemptsRouter.post('/dictations/:id/attempts', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const body = parse(
    z.object({
      examProfile: z.string().min(1).max(20).optional(),
      listenedWpm: z.number().min(20).max(400).optional(),
    }),
    req.body ?? {},
  );
  const user = req.user!;

  const dictation = await Dictation.findOne({ _id: id, published: true }).lean();
  if (!dictation) throw ApiError.notFound('Dictation not found');
  if (dictation.activeTextVersion == null) throw new ApiError(409, 'This dictation is not ready yet', 'NOT_READY');

  const existing = await Attempt.findOne({ userId: user.id, dictationId: id, status: 'draft' }).lean();
  if (existing) return void res.json({ attempt: publicAttempt(existing), resumed: true });

  const code = (body.examProfile ?? user.settings.examProfile).toUpperCase();
  const profile = await ExamProfile.findOne({ code, active: true }).lean();
  if (!profile) throw ApiError.badRequest('Unknown exam profile');

  const startedAt = new Date();
  try {
    const attempt = await Attempt.create({
      userId: user.id,
      dictationId: id,
      textVersion: dictation.activeTextVersion,
      examProfile: profile.code,
      listenedWpm: body.listenedWpm,
      startedAt,
      deadlineAt: new Date(startedAt.getTime() + profile.durationMin * 60_000),
    });
    await UserDictationState.updateOne({ userId: user.id, dictationId: id }, { $set: { seen: true } }, { upsert: true });
    res.status(201).json({ attempt: publicAttempt(attempt.toObject()), resumed: false });
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    // Two "Transcribe Now" clicks raced: hand back the draft the other request created.
    const raced = await Attempt.findOne({ userId: user.id, dictationId: id, status: 'draft' }).lean();
    if (!raced) throw err;
    res.json({ attempt: publicAttempt(raced), resumed: true });
  }
});

// Autosave while typing.
attemptsRouter.patch('/attempts/:id/draft', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const { typedText } = parse(z.object({ typedText: z.string().max(MAX_TEXT) }), req.body);
  const r = await Attempt.updateOne({ _id: id, userId: req.user!.id, status: 'draft' }, { $set: { typedText } });
  if (r.matchedCount === 0) throw new ApiError(409, 'This attempt is already submitted or does not exist', 'NOT_DRAFT');
  res.json({ ok: true, savedAt: new Date() });
});

// Submit -> evaluate -> analysis. Safe to call twice (auto-submit + button): the second call returns the same result.
attemptsRouter.post('/attempts/:id/submit', submitLimiter, async (req, res) => {
  const { id } = parse(idParam, req.params);
  const body = parse(z.object({ typedText: z.string().max(MAX_TEXT).optional(), auto: z.boolean().optional() }), req.body ?? {});
  const { attempt, justSubmitted } = await submitAttempt({ attemptId: id, userId: req.user!.id, typedText: body.typedText, auto: body.auto });
  const text = await DictationText.findOne({ dictationId: attempt.dictationId, version: attempt.textVersion }).lean();
  res.json({ attempt: publicAttempt(attempt, { masterText: text?.masterText }), alreadySubmitted: !justSubmitted });
});

attemptsRouter.get('/attempts/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const attempt = await Attempt.findOne({ _id: id, userId: req.user!.id }).lean();
  if (!attempt) throw ApiError.notFound('Attempt not found');
  const text =
    attempt.status === 'submitted'
      ? await DictationText.findOne({ dictationId: attempt.dictationId, version: attempt.textVersion }).lean()
      : null;
  res.json({ attempt: publicAttempt(attempt, { masterText: text?.masterText }) });
});

// Re-grade my own attempt against the current transcript and rules (e.g. after the transcript was corrected).
attemptsRouter.post('/attempts/:id/reevaluate', submitLimiter, async (req, res) => {
  const { id } = parse(idParam, req.params);
  const userId = req.user!.id;
  const attempt = await Attempt.findOne({ _id: id, userId, status: 'submitted' }, { dictationId: 1, textVersion: 1 }).lean();
  if (!attempt) throw ApiError.notFound('Submitted attempt not found');
  const dictation = await Dictation.findById(attempt.dictationId, { activeTextVersion: 1 }).lean();
  const version = dictation?.activeTextVersion ?? attempt.textVersion;
  const outcome = await reevaluateAttempt(id, version, userId);
  const [fresh, text] = await Promise.all([
    Attempt.findById(id).lean(),
    DictationText.findOne({ dictationId: attempt.dictationId, version }).lean(),
  ]);
  res.json({
    attempt: publicAttempt(fresh!, { masterText: text?.masterText }),
    changed: outcome.changed,
    before: outcome.before,
    after: outcome.after,
  });
});

// "Where you stand": how this attempt compares with the other students on the same transcript.
// Each student counts once, by their best attempt. Only first names are ever shown, and nothing until enough students have tried it.
const MIN_STUDENTS = 3;
attemptsRouter.get('/attempts/:id/standing', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const me = String(req.user!.id);
  const attempt = await Attempt.findOne({ _id: id, userId: me }, { dictationId: 1, textVersion: 1, status: 1, 'result.errorPct': 1 }).lean();
  if (!attempt) throw ApiError.notFound('Attempt not found');
  const myError = attempt.result?.errorPct;
  if (attempt.status !== 'submitted' || typeof myError !== 'number') throw new ApiError(409, 'Submit this attempt first', 'NOT_SUBMITTED');

  // One row per student: their best attempt. Near-empty attempts (under half the words typed) would only skew the picture.
  const rows = await Attempt.aggregate<{ _id: Types.ObjectId; best: number }>([
    { $match: { dictationId: attempt.dictationId, textVersion: attempt.textVersion, status: 'submitted', 'result.errorPct': { $type: 'number' } } },
    { $match: { $expr: { $gte: ['$result.attemptWords', { $multiply: [0.5, '$result.masterWords'] }] } } },
    { $sort: { 'result.errorPct': 1, submittedAt: 1 } },
    { $group: { _id: '$userId', best: { $first: '$result.errorPct' } } },
  ]);

  const others = rows.filter((r) => String(r._id) !== me);
  const students = others.length + 1;
  if (students < MIN_STUDENTS) return void res.json({ ready: false, students, minStudents: MIN_STUDENTS });

  const myRow = rows.find((r) => String(r._id) === me);
  const myBest = Math.min(myError, myRow?.best ?? Infinity);
  const better = others.filter((r) => r.best > myError).length;
  const rank = 1 + others.filter((r) => r.best < myError).length;

  const top = others.reduce<(typeof others)[number] | null>((t, r) => (t === null || r.best < t.best ? r : t), null);
  const topperIsYou = top === null || myBest <= top.best;
  const topperError = topperIsYou ? myBest : top!.best;
  let topperName: string | null = null;
  if (!topperIsYou) {
    const u = await User.findById(top!._id, { name: 1 }).lean();
    topperName = u?.name?.trim().split(/\s+/)[0] || 'A student';
  }
  const accuracy = (err: number) => roundTo2(Math.max(0, 100 - err));
  const avgError = (others.reduce((n, r) => n + r.best, 0) + myBest) / students;

  res.json({
    ready: true,
    students,
    minStudents: MIN_STUDENTS,
    betterThanPct: Math.round((better / others.length) * 100),
    rank,
    yourAccuracyPct: accuracy(myError),
    topperAccuracyPct: accuracy(topperError),
    topperName,
    topperIsYou,
    averageAccuracyPct: accuracy(avgError),
  });
});

// Give up a draft (start over).
attemptsRouter.delete('/attempts/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const r = await Attempt.deleteOne({ _id: id, userId: req.user!.id, status: 'draft' });
  if (r.deletedCount === 0) throw ApiError.notFound('No open attempt to discard');
  res.json({ ok: true });
});

attemptsRouter.get('/attempts', async (req, res) => {
  const q = parse(
    z.object({
      dictationId: objectId.optional(),
      status: z.enum(['draft', 'submitted']).default('submitted'),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
    req.query,
  );
  const filter: Record<string, unknown> = { userId: req.user!.id, status: q.status };
  if (q.dictationId) filter.dictationId = q.dictationId;

  const sortField = q.status === 'submitted' ? 'submittedAt' : 'startedAt';
  const [items, total] = await Promise.all([
    Attempt.find(filter, { typedText: 0, mistakes: 0, 'result.diff': 0, evaluationHistory: 0 })
      .sort({ [sortField]: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    Attempt.countDocuments(filter),
  ]);
  const dictations = await Dictation.find({ _id: { $in: items.map((a) => a.dictationId) } }, { title: 1, exerciseNo: 1 }).lean();
  const dMap = new Map(dictations.map((d) => [String(d._id), d]));
  res.json({ items: items.map((a) => attemptSummary(a, dMap.get(String(a.dictationId)))), total, page: q.page, limit: q.limit });
});
