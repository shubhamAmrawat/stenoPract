import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { ApiError } from '../../middleware/errors.js';
import { idParam, objectId, parse } from '../../middleware/validate.js';
import { Dictation, DictationSet, DictationText, ExamProfile, UserDictationState } from '../../models/index.js';
import { loadStates, publicDictation } from './serialize.js';

export const catalogRouter = Router();

catalogRouter.get('/exam-profiles', async (_req, res) => {
  const profiles = await ExamProfile.find({ active: true }).sort({ code: 1 }).lean();
  res.json({
    items: profiles.map((p) => ({
      code: p.code,
      name: p.name,
      wpm: p.wpm,
      durationMin: p.durationMin,
      words: p.words,
      limits: p.limits,
      verifiedAgainstNotice: p.verifiedAgainstNotice,
    })),
  });
});

catalogRouter.get('/sets', async (req, res) => {
  const sets = await DictationSet.find({ published: true }).sort({ order: 1, title: 1 }).lean();
  const setIds = sets.map((s) => s._id);

  const counts = await Dictation.aggregate<{ _id: unknown; total: number; ready: number }>([
    { $match: { setId: { $in: setIds }, published: true } },
    {
      $group: {
        _id: '$setId',
        total: { $sum: 1 },
        ready: { $sum: { $cond: [{ $ne: ['$activeTextVersion', null] }, 1, 0] } },
      },
    },
  ]);
  const seen = await UserDictationState.aggregate<{ _id: unknown; seen: number; attempted: number }>([
    { $match: { userId: new Types.ObjectId(req.user!.id) } },
    { $lookup: { from: 'dictations', localField: 'dictationId', foreignField: '_id', as: 'd' } },
    { $unwind: '$d' },
    { $match: { 'd.setId': { $in: setIds } } },
    {
      $group: {
        _id: '$d.setId',
        seen: { $sum: { $cond: ['$seen', 1, 0] } },
        attempted: { $sum: { $cond: [{ $gt: ['$attemptsCount', 0] }, 1, 0] } },
      },
    },
  ]);

  // A picture for each set: the first video of its lowest-numbered ready exercise (YouTube thumbnail, nothing stored).
  const covers = await Dictation.aggregate<{ _id: unknown; videoId: string }>([
    { $match: { setId: { $in: setIds }, published: true, activeTextVersion: { $ne: null }, 'videos.0': { $exists: true } } },
    { $sort: { exerciseNo: 1 } },
    { $group: { _id: '$setId', videoId: { $first: { $arrayElemAt: ['$videos.youtubeVideoId', 0] } } } },
  ]);
  const coverMap = new Map(covers.map((c) => [String(c._id), c.videoId]));
  const countMap = new Map(counts.map((c) => [String(c._id), c]));
  const seenMap = new Map(seen.map((c) => [String(c._id), c]));
  res.json({
    items: sets.map((s) => ({
      id: String(s._id),
      slug: s.slug,
      title: s.title,
      description: s.description ?? null,
      source: s.source ?? null,
      coverVideoId: coverMap.get(String(s._id)) ?? null,
      dictationCount: countMap.get(String(s._id))?.total ?? 0,
      readyCount: countMap.get(String(s._id))?.ready ?? 0,
      seenCount: seenMap.get(String(s._id))?.seen ?? 0,
      attemptedCount: seenMap.get(String(s._id))?.attempted ?? 0,
    })),
  });
});

const listQuery = z.object({
  setId: objectId.optional(),
  q: z.string().trim().min(1).max(80).optional(),
  favourite: z.enum(['true', 'false']).optional(),
  seen: z.enum(['true', 'false']).optional(),
  folderId: objectId.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

catalogRouter.get('/dictations', async (req, res) => {
  const q = parse(listQuery, req.query);
  const userId = req.user!.id;
  const filter: Record<string, unknown> = { published: true };
  if (q.setId) filter.setId = q.setId;
  if (q.q) {
    const escaped = q.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const asNumber = Number(q.q);
    filter.$or = [{ title: { $regex: escaped, $options: 'i' } }, ...(Number.isInteger(asNumber) ? [{ exerciseNo: asNumber }] : [])];
  }

  // Filters that depend on the student's own state.
  const stateFilter: Record<string, unknown> = { userId };
  let useStateIds = false;
  if (q.favourite === 'true') { stateFilter.favourite = true; useStateIds = true; }
  if (q.seen === 'true') { stateFilter.seen = true; useStateIds = true; }
  if (q.folderId) { stateFilter.folderIds = q.folderId; useStateIds = true; }
  if (useStateIds) {
    const ids = await UserDictationState.find(stateFilter).distinct('dictationId');
    filter._id = { $in: ids };
  } else if (q.seen === 'false' || q.favourite === 'false') {
    const seenFilter: Record<string, unknown> = { userId };
    if (q.seen === 'false') seenFilter.seen = true;
    if (q.favourite === 'false') seenFilter.favourite = true;
    const ids = await UserDictationState.find(seenFilter).distinct('dictationId');
    filter._id = { $nin: ids };
  }

  const [items, total] = await Promise.all([
    Dictation.find(filter)
      .sort({ setId: 1, exerciseNo: 1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    Dictation.countDocuments(filter),
  ]);
  const states = await loadStates(userId, items.map((d) => d._id));
  res.json({ items: items.map((d) => publicDictation(d, states.get(String(d._id)))), total, page: q.page, limit: q.limit });
});

catalogRouter.get('/dictations/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const dictation = await Dictation.findOne({ _id: id, published: true }).lean();
  if (!dictation) throw ApiError.notFound('Dictation not found');
  const states = await loadStates(req.user!.id, [dictation._id]);
  res.json({ dictation: publicDictation(dictation, states.get(String(dictation._id))) });
});

/** The book transcript of a published exercise, so students can read along or check their notes. */
catalogRouter.get('/dictations/:id/transcript', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const dictation = await Dictation.findOne({ _id: id, published: true }).lean();
  if (!dictation || dictation.activeTextVersion == null) throw ApiError.notFound('Transcript not available');
  const text = await DictationText.findOne({ dictationId: id, version: dictation.activeTextVersion }).lean();
  if (!text) throw ApiError.notFound('Transcript not available');
  res.json({
    exerciseNo: dictation.exerciseNo,
    version: text.version,
    wordCount: dictation.masterWordCount ?? 0,
    paragraphs: text.masterText.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean),
  });
});
