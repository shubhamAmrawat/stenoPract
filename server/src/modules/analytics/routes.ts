import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { roundTo2, type MistakeKind } from '../../evaluator/index.js';
import { ApiError } from '../../middleware/errors.js';
import { idParam, parse } from '../../middleware/validate.js';
import { Attempt, Dictation, UserWordStats } from '../../models/index.js';

export const analyticsRouter = Router();

const FULL_KINDS = new Set<MistakeKind>(['omission', 'addition', 'repetition', 'substitution', 'incomplete_word', 'abbreviation', 'all_caps']);

const validTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const rangeQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  tz: z.string().max(60).refine(validTimeZone, 'Unknown time zone').default('Asia/Kolkata'),
});

const dayMs = 24 * 60 * 60 * 1000;
const since = (days: number) => new Date(Date.now() - days * dayMs);
const uid = (req: { user?: { id: string } }) => new Types.ObjectId(req.user!.id);

/** Consecutive days (ending today or yesterday) with at least one submitted attempt. */
export function currentStreak(daysDesc: string[], today: string): number {
  if (daysDesc.length === 0) return 0;
  const toNum = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / dayMs);
  const t = toNum(today);
  let expected = toNum(daysDesc[0]!) === t ? t : t - 1;
  if (toNum(daysDesc[0]!) !== expected) return 0;
  let streak = 0;
  for (const d of daysDesc) {
    const n = toNum(d);
    if (n === expected) { streak++; expected--; }
    else if (n < expected) break;
  }
  return streak;
}

analyticsRouter.get('/analytics/summary', async (req, res) => {
  const { tz } = parse(rangeQuery, req.query);
  const userId = uid(req);
  const match = { userId, status: 'submitted' };

  const [totals, recent, dayRows] = await Promise.all([
    Attempt.aggregate<{
      attempts: number; avg: number; best: number; judged: number; passed: number; dictations: string[];
    }>([
      { $match: match },
      {
        $group: {
          _id: null,
          attempts: { $sum: 1 },
          avg: { $avg: '$result.errorPct' },
          best: { $min: '$result.errorPct' },
          judged: { $sum: { $cond: [{ $isNumber: '$result.limitPct' }, 1, 0] } },
          passed: { $sum: { $cond: [{ $eq: ['$result.passed', true] }, 1, 0] } },
          dictations: { $addToSet: '$dictationId' },
        },
      },
    ]),
    Attempt.aggregate<{ attempts: number; avg: number }>([
      { $match: { ...match, submittedAt: { $gte: since(7) } } },
      { $group: { _id: null, attempts: { $sum: 1 }, avg: { $avg: '$result.errorPct' } } },
    ]),
    Attempt.aggregate<{ _id: string }>([
      { $match: match },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$submittedAt', timezone: tz } } } },
      { $sort: { _id: -1 } },
      { $limit: 400 },
    ]),
  ]);

  const t = totals[0];
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  res.json({
    attempts: t?.attempts ?? 0,
    dictationsAttempted: t?.dictations.length ?? 0,
    avgErrorPct: t ? roundTo2(t.avg) : null,
    bestErrorPct: t ? t.best : null,
    passRatePct: t && t.judged > 0 ? roundTo2((t.passed / t.judged) * 100) : null,
    last7Days: { attempts: recent[0]?.attempts ?? 0, avgErrorPct: recent[0] ? roundTo2(recent[0].avg) : null },
    streakDays: currentStreak(dayRows.map((d) => d._id), todayStr),
  });
});

analyticsRouter.get('/analytics/trend', async (req, res) => {
  const { days, tz } = parse(rangeQuery, req.query);
  const rows = await Attempt.aggregate<{ _id: string; attempts: number; avg: number; full: number; half: number; best: number }>([
    { $match: { userId: uid(req), status: 'submitted', submittedAt: { $gte: since(days) } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$submittedAt', timezone: tz } },
        attempts: { $sum: 1 },
        avg: { $avg: '$result.errorPct' },
        best: { $min: '$result.errorPct' },
        full: { $avg: '$result.full' },
        half: { $avg: '$result.half' },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  res.json({
    items: rows.map((r) => ({
      date: r._id,
      attempts: r.attempts,
      avgErrorPct: roundTo2(r.avg),
      bestErrorPct: r.best,
      avgFull: roundTo2(r.full),
      avgHalf: roundTo2(r.half),
    })),
  });
});

analyticsRouter.get('/analytics/mistakes', async (req, res) => {
  const { days } = parse(rangeQuery, req.query);
  const rows = await Attempt.aggregate<{ _id: MistakeKind; count: number }>([
    { $match: { userId: uid(req), status: 'submitted', submittedAt: { $gte: since(days) } } },
    { $project: { kv: { $objectToArray: { $ifNull: ['$result.breakdown', {}] } } } },
    { $unwind: '$kv' },
    { $group: { _id: '$kv.k', count: { $sum: '$kv.v' } } },
    { $sort: { count: -1 } },
  ]);
  const items = rows.map((r) => ({ kind: r._id, count: r.count, weight: FULL_KINDS.has(r._id) ? 1 : 0.5 }));
  res.json({ items, total: items.reduce((n, i) => n + i.count, 0) });
});

analyticsRouter.get('/analytics/weak-words', async (req, res) => {
  const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }), req.query);
  const rows = await UserWordStats.find({ userId: req.user!.id }).sort({ weightedMisses: -1, word: 1 }).limit(limit).lean();
  res.json({
    items: rows.map((w) => ({
      word: w.word,
      misses: w.misses,
      weightedMisses: w.weightedMisses,
      kinds: w.kinds ?? {},
      lastMissedAt: w.lastMissedAt ?? null,
    })),
  });
});

// Progress on one dictation: every submitted attempt, oldest first.
analyticsRouter.get('/analytics/dictations/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const dictation = await Dictation.findOne({ _id: id, published: true }, { title: 1, exerciseNo: 1 }).lean();
  if (!dictation) throw ApiError.notFound('Dictation not found');
  const attempts = await Attempt.find(
    { userId: req.user!.id, dictationId: id, status: 'submitted' },
    { submittedAt: 1, 'result.errorPct': 1, 'result.full': 1, 'result.half': 1, 'result.passed': 1, timeTakenSec: 1 },
  ).sort({ submittedAt: 1 }).lean();
  const errs = attempts.map((a) => a.result?.errorPct).filter((n): n is number => typeof n === 'number');
  res.json({
    dictation: { id: String(dictation._id), title: dictation.title, exerciseNo: dictation.exerciseNo },
    attempts: attempts.map((a) => ({
      id: String(a._id),
      submittedAt: a.submittedAt,
      errorPct: a.result?.errorPct ?? null,
      full: a.result?.full ?? null,
      half: a.result?.half ?? null,
      passed: a.result?.passed ?? null,
      timeTakenSec: a.timeTakenSec ?? null,
    })),
    bestErrorPct: errs.length ? Math.min(...errs) : null,
    avgErrorPct: errs.length ? roundTo2(errs.reduce((a, b) => a + b, 0) / errs.length) : null,
  });
});
