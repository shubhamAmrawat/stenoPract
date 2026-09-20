import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { countWords } from '../../evaluator/index.js';
import { ApiError } from '../../middleware/errors.js';
import { idParam, objectId, parse } from '../../middleware/validate.js';
import { Attempt, Dictation, DictationSet, DictationText, MasterWordStats, Report } from '../../models/index.js';
import { evaluateAgainstMaster } from '../../services/attempts.js';
import { importDictations, parseVideoLinks } from '../../services/contentImport.js';
import { extractPlaylistId, fetchPlaylistVideos, parseVideoTitle } from '../../services/youtube.js';

export const adminContentRouter = Router();

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

// ---------- sets ----------

const setBody = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lowercase letters, numbers and dashes only').max(60),
  title: z.string().trim().min(1).max(120),
  description: z.string().max(500).optional(),
  source: z.string().max(120).optional(),
  youtubePlaylistId: z.string().max(80).optional(),
  order: z.number().int().optional(),
  published: z.boolean().optional(),
});

const publicSet = (s: { _id: unknown; slug: string; title: string; description?: string | null; source?: string | null; youtubePlaylistId?: string | null; order?: number | null; published?: boolean | null }) => ({
  id: String(s._id),
  slug: s.slug,
  title: s.title,
  description: s.description ?? null,
  source: s.source ?? null,
  youtubePlaylistId: s.youtubePlaylistId ?? null,
  order: s.order ?? 0,
  published: s.published ?? false,
});

adminContentRouter.get('/sets', async (_req, res) => {
  const sets = await DictationSet.find().sort({ order: 1, title: 1 }).lean();
  res.json({ items: sets.map(publicSet) });
});

adminContentRouter.post('/sets', async (req, res) => {
  const body = parse(setBody, req.body);
  try {
    res.status(201).json({ set: publicSet((await DictationSet.create(body)).toObject()) });
  } catch (err) {
    if (isDuplicateKey(err)) throw ApiError.conflict('A set with that slug already exists');
    throw err;
  }
});

adminContentRouter.patch('/sets/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const body = parse(setBody.partial().refine((b) => Object.keys(b).length > 0, 'Nothing to update'), req.body);
  try {
    const set = await DictationSet.findByIdAndUpdate(id, { $set: body }, { returnDocument: 'after' }).lean();
    if (!set) throw ApiError.notFound('Set not found');
    res.json({ set: publicSet(set) });
  } catch (err) {
    if (isDuplicateKey(err)) throw ApiError.conflict('A set with that slug already exists');
    throw err;
  }
});

/**
 * Reads the set's YouTube playlist and creates/updates one dictation per "Exercise N",
 * attaching each video with its base speed parsed from the title ("100 WPM | Exercise 507 | ...").
 * New dictations start unpublished and without a transcript.
 */
adminContentRouter.post('/sets/:id/import-playlist', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const body = parse(z.object({ playlist: z.string().max(300).optional() }), req.body ?? {});
  const set = await DictationSet.findById(id);
  if (!set) throw ApiError.notFound('Set not found');

  const playlistId = extractPlaylistId(body.playlist ?? set.youtubePlaylistId ?? '');
  if (!playlistId) throw ApiError.badRequest('Provide a playlist id or URL (or save one on the set first)');

  const videos = await fetchPlaylistVideos(playlistId);
  if (!set.youtubePlaylistId) {
    set.youtubePlaylistId = playlistId;
    await set.save();
  }

  let created = 0;
  let updated = 0;
  const skipped: { title: string; reason: string }[] = [];

  for (const v of videos) {
    const parsed = parseVideoTitle(v.title);
    if (!parsed) {
      skipped.push({ title: v.title, reason: 'Could not read speed and exercise number from the title' });
      continue;
    }
    const video = { youtubeVideoId: v.videoId, baseWpm: parsed.baseWpm, title: v.title };
    const existing = await Dictation.findOne({ setId: set._id, exerciseNo: parsed.exerciseNo });
    if (!existing) {
      await Dictation.create({ setId: set._id, exerciseNo: parsed.exerciseNo, title: `Exercise ${parsed.exerciseNo}`, videos: [video] });
      created++;
      continue;
    }
    const videosNow = existing.videos.map((x) => ({ youtubeVideoId: x.youtubeVideoId, baseWpm: x.baseWpm, title: x.title ?? undefined }));
    const idx = videosNow.findIndex((x) => x.youtubeVideoId === v.videoId || x.baseWpm === parsed.baseWpm);
    if (idx >= 0) videosNow[idx] = video;
    else videosNow.push(video);
    existing.set('videos', videosNow);
    await existing.save();
    updated++;
  }
  res.json({ playlistId, found: videos.length, created, updated, skipped });
});

// ---------- bulk import (JSON file / pasted video links) ----------

const importItem = z.object({
  exerciseNo: z.number().int().min(0).max(100_000),
  title: z.string().trim().min(1).max(150).optional(),
  videos: z
    .array(z.object({ youtubeVideoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/, 'Not a YouTube video id'), baseWpm: z.number().int().min(40).max(200), title: z.string().max(200).optional() }))
    .max(10)
    .optional(),
  masterText: z.string().trim().min(1).max(60_000).optional(),
  checkpoints: z.array(z.number().int().min(1)).max(100).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
  source: z.enum(['book', 'asr', 'manual']).optional(),
});

/** Create/update many dictations at once (videos, transcripts). Transcripts are verified unless `verify:false`. */
adminContentRouter.post('/sets/:id/bulk-import', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const body = parse(
    z.object({ items: z.array(importItem).min(1).max(200), publish: z.boolean().default(false), verify: z.boolean().default(true) }),
    req.body,
  );
  if (!(await DictationSet.exists({ _id: id }))) throw ApiError.notFound('Set not found');
  const results = await importDictations(id, body.items, { publish: body.publish, verify: body.verify, createdBy: req.user!.id });
  res.json({ results });
});

/** Paste YouTube links (one per line) - no API key needed. Publishes dictations that become ready. */
adminContentRouter.post('/sets/:id/import-video-links', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const body = parse(z.object({ text: z.string().min(1).max(50_000), publish: z.boolean().default(true) }), req.body);
  if (!(await DictationSet.exists({ _id: id }))) throw ApiError.notFound('Set not found');
  const parsed = parseVideoLinks(body.text);
  const results = parsed.items.length ? await importDictations(id, parsed.items, { publish: body.publish, verify: true, createdBy: req.user!.id }) : [];
  res.json({ results, skipped: parsed.skipped });
});

// ---------- dictations ----------

const videoBody = z.object({
  youtubeVideoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/, 'Not a YouTube video id'),
  baseWpm: z.number().int().min(40).max(200),
  title: z.string().max(200).optional(),
});

const dictationBody = z.object({
  setId: objectId,
  exerciseNo: z.number().int().min(0).max(100_000),
  title: z.string().trim().min(1).max(150),
  videos: z.array(videoBody).max(10),
  tags: z.array(z.string().trim().min(1).max(30)).max(20),
  published: z.boolean(),
});

const publicDictationAdmin = (d: {
  _id: unknown; setId: unknown; exerciseNo: number; title: string;
  videos?: { youtubeVideoId: string; baseWpm: number; title?: string | null }[] | null;
  tags?: string[] | null; masterWordCount?: number | null; activeTextVersion?: number | null; published?: boolean | null;
}) => ({
  id: String(d._id),
  setId: String(d.setId),
  exerciseNo: d.exerciseNo,
  title: d.title,
  videos: (d.videos ?? []).map((v) => ({ youtubeVideoId: v.youtubeVideoId, baseWpm: v.baseWpm, title: v.title ?? null })),
  tags: d.tags ?? [],
  masterWordCount: d.masterWordCount ?? 0,
  activeTextVersion: d.activeTextVersion ?? null,
  published: d.published ?? false,
});

adminContentRouter.get('/dictations', async (req, res) => {
  const q = parse(z.object({ setId: objectId.optional() }), req.query);
  const items = await Dictation.find(q.setId ? { setId: q.setId } : {}).sort({ setId: 1, exerciseNo: 1 }).lean();
  const open = await Report.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { status: 'open', dictationId: { $in: items.map((d) => d._id) } } },
    { $group: { _id: '$dictationId', n: { $sum: 1 } } },
  ]);
  const openMap = new Map(open.map((o) => [String(o._id), o.n]));
  res.json({ items: items.map((d) => ({ ...publicDictationAdmin(d), openReports: openMap.get(String(d._id)) ?? 0 })) });
});

adminContentRouter.get('/dictations/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const d = await Dictation.findById(id).lean();
  if (!d) throw ApiError.notFound('Dictation not found');
  res.json({ dictation: publicDictationAdmin(d) });
});

adminContentRouter.post('/dictations', async (req, res) => {
  const body = parse(dictationBody.partial({ videos: true, tags: true, published: true }).omit({ published: true }), req.body);
  if (!(await DictationSet.exists({ _id: body.setId }))) throw ApiError.badRequest('Unknown set');
  try {
    const d = await Dictation.create(body);
    res.status(201).json({ dictation: publicDictationAdmin(d.toObject()) });
  } catch (err) {
    if (isDuplicateKey(err)) throw ApiError.conflict('That exercise number already exists in this set');
    throw err;
  }
});

adminContentRouter.patch('/dictations/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const body = parse(dictationBody.omit({ setId: true }).partial().refine((b) => Object.keys(b).length > 0, 'Nothing to update'), req.body);
  const current = await Dictation.findById(id).lean();
  if (!current) throw ApiError.notFound('Dictation not found');
  if (body.published && current.activeTextVersion == null) {
    throw new ApiError(409, 'Verify a transcript before publishing this dictation', 'NOT_READY');
  }
  try {
    const d = await Dictation.findByIdAndUpdate(id, { $set: body }, { returnDocument: 'after' }).lean();
    res.json({ dictation: publicDictationAdmin(d!) });
  } catch (err) {
    if (isDuplicateKey(err)) throw ApiError.conflict('That exercise number already exists in this set');
    throw err;
  }
});

// ---------- transcripts (versioned) ----------

const textFields = z.object({
  masterText: z.string().trim().min(1).max(60_000),
  source: z.enum(['book', 'asr', 'manual']),
  checkpoints: z.array(z.number().int().min(1)).max(100),
  notes: z.string().max(1000),
});

const publicText = (t: {
  _id: unknown; dictationId: unknown; version: number; masterText: string; source?: string | null;
  reviewStatus?: string | null; checkpoints?: number[] | null; notes?: string | null; attemptCount?: number | null; createdAt?: Date;
}, withText = true) => ({
  id: String(t._id),
  dictationId: String(t.dictationId),
  version: t.version,
  ...(withText ? { masterText: t.masterText } : {}),
  wordCount: countWords(t.masterText),
  source: t.source ?? 'manual',
  reviewStatus: t.reviewStatus ?? 'draft',
  checkpoints: t.checkpoints ?? [],
  notes: t.notes ?? null,
  attemptCount: t.attemptCount ?? 0,
  createdAt: t.createdAt ?? null,
});

function checkCheckpoints(text: string, checkpoints: number[] | undefined) {
  if (!checkpoints) return;
  const n = countWords(text);
  const bad = checkpoints.filter((c) => c > n);
  if (bad.length) throw ApiError.badRequest(`Checkpoints beyond the end of the text (${n} words): ${bad.join(', ')}`);
}

/** Removes an exercise that nobody has attempted yet (for example one created by mistake from a pasted link). */
adminContentRouter.delete('/dictations/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  if (!(await Dictation.exists({ _id: id }))) throw ApiError.notFound('Dictation not found');
  if (await Attempt.exists({ dictationId: id })) {
    throw ApiError.conflict('Students have already attempted this exercise, so it cannot be deleted. Unpublish it instead.');
  }
  await Promise.all([
    DictationText.deleteMany({ dictationId: id }),
    MasterWordStats.deleteMany({ dictationId: id }),
    Report.deleteMany({ dictationId: id }),
  ]);
  await Dictation.deleteOne({ _id: id });
  res.json({ ok: true });
});

adminContentRouter.get('/dictations/:id/texts', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const dictation = await Dictation.findById(id, { activeTextVersion: 1 }).lean();
  if (!dictation) throw ApiError.notFound('Dictation not found');
  const texts = await DictationText.find({ dictationId: id }).sort({ version: -1 }).lean();
  res.json({ activeTextVersion: dictation.activeTextVersion ?? null, items: texts.map((t) => publicText(t, false)) });
});

adminContentRouter.post('/dictations/:id/texts', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const body = parse(textFields.partial({ source: true, checkpoints: true, notes: true }), req.body);
  if (!(await Dictation.exists({ _id: id }))) throw ApiError.notFound('Dictation not found');
  checkCheckpoints(body.masterText, body.checkpoints);

  // version = last + 1; the unique (dictationId, version) index makes a race fail loudly instead of duplicating.
  for (let attempt = 0; attempt < 3; attempt++) {
    const last = await DictationText.findOne({ dictationId: id }, { version: 1 }).sort({ version: -1 }).lean();
    try {
      const t = await DictationText.create({ ...body, dictationId: id, version: (last?.version ?? 0) + 1, createdBy: req.user!.id });
      return void res.status(201).json({ text: publicText(t.toObject()) });
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
    }
  }
  throw ApiError.conflict('Could not allocate a version number, please retry');
});

adminContentRouter.get('/texts/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const t = await DictationText.findById(id).lean();
  if (!t) throw ApiError.notFound('Transcript not found');
  res.json({ text: publicText(t) });
});

adminContentRouter.patch('/texts/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const body = parse(
    textFields.partial().extend({ reviewStatus: z.enum(['draft', 'in_review']).optional() }).refine((b) => Object.keys(b).length > 0, 'Nothing to update'),
    req.body,
  );
  const t = await DictationText.findById(id);
  if (!t) throw ApiError.notFound('Transcript not found');
  // A verified version is what past attempts were graded against: never edit it, publish a new version instead.
  if (t.reviewStatus === 'verified') throw new ApiError(409, 'Verified transcripts are frozen. Create a new version instead.', 'FROZEN');
  checkCheckpoints(body.masterText ?? t.masterText, body.checkpoints ?? t.checkpoints);
  t.set(body);
  await t.save();
  res.json({ text: publicText(t.toObject()) });
});

/** Makes this version the one students are graded against. */
adminContentRouter.post('/texts/:id/verify', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const t = await DictationText.findById(id);
  if (!t) throw ApiError.notFound('Transcript not found');
  t.reviewStatus = 'verified';
  await t.save();
  await Dictation.updateOne({ _id: t.dictationId }, { $set: { activeTextVersion: t.version, masterWordCount: countWords(t.masterText) } });
  res.json({ text: publicText(t.toObject(), false), activeTextVersion: t.version });
});

/** Words that many students "get wrong" - the transcript itself may be wrong there. */
adminContentRouter.get('/dictations/:id/suspect-words', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const q = parse(
    z.object({
      version: z.coerce.number().int().min(1).optional(),
      minAttempts: z.coerce.number().int().min(1).default(3),
      minRatio: z.coerce.number().min(0).max(1).default(0.3),
    }),
    req.query,
  );
  const dictation = await Dictation.findById(id, { activeTextVersion: 1 }).lean();
  if (!dictation) throw ApiError.notFound('Dictation not found');
  const version = q.version ?? dictation.activeTextVersion;
  if (version == null) return void res.json({ version: null, attempts: 0, items: [] });

  const text = await DictationText.findOne({ dictationId: id, version }, { attemptCount: 1 }).lean();
  const attempts = text?.attemptCount ?? 0;
  if (attempts < q.minAttempts) return void res.json({ version, attempts, items: [] });

  const rows = await MasterWordStats.find({ dictationId: id, textVersion: version, misses: { $gte: Math.ceil(attempts * q.minRatio) } })
    .sort({ misses: -1 })
    .limit(100)
    .lean();
  res.json({
    version,
    attempts,
    items: rows.map((r) => ({ wordIndex: r.wordIndex, word: r.word, misses: r.misses, ratio: Math.round((r.misses / attempts) * 100) / 100, kinds: r.kinds ?? {} })),
  });
});

// ---------- re-evaluation ----------

async function reevaluateOne(attemptId: unknown, targetVersion: number): Promise<{ id: string; before: number | null; after: number }> {
  const attempt = await Attempt.findById(attemptId);
  if (!attempt || attempt.status !== 'submitted') throw ApiError.notFound('Submitted attempt not found');
  const before = attempt.result?.errorPct ?? null;
  const { result, rulesVersion } = await evaluateAgainstMaster({
    textVersion: targetVersion,
    dictationId: attempt.dictationId,
    examProfile: attempt.examProfile,
    category: attempt.category,
    typedText: attempt.typedText ?? '',
  });
  const { mistakes, ...summary } = result;
  attempt.textVersion = targetVersion;
  attempt.set('result', summary);
  attempt.set('mistakes', mistakes);
  attempt.evaluationHistory.push({ at: new Date(), textVersion: targetVersion, rulesVersion, full: result.full, half: result.half, errorPct: result.errorPct });
  await attempt.save();
  return { id: String(attempt._id), before, after: result.errorPct };
}

// Re-grade one attempt (e.g. after fixing a transcript). Running word statistics are NOT re-counted.
adminContentRouter.post('/attempts/:id/reevaluate', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const body = parse(z.object({ textVersion: z.number().int().min(1).optional() }), req.body ?? {});
  const attempt = await Attempt.findById(id, { dictationId: 1 }).lean();
  if (!attempt) throw ApiError.notFound('Attempt not found');
  const version = body.textVersion ?? (await Dictation.findById(attempt.dictationId, { activeTextVersion: 1 }).lean())?.activeTextVersion;
  if (version == null) throw ApiError.badRequest('This dictation has no verified transcript');
  res.json({ ...(await reevaluateOne(id, version)), textVersion: version, statsRecounted: false });
});

// Re-grade a batch of attempts still on an older version. Call repeatedly until `remaining` is 0.
adminContentRouter.post('/dictations/:id/reevaluate', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const body = parse(z.object({ limit: z.number().int().min(1).max(100).default(50) }), req.body ?? {});
  const dictation = await Dictation.findById(id, { activeTextVersion: 1 }).lean();
  if (!dictation) throw ApiError.notFound('Dictation not found');
  if (dictation.activeTextVersion == null) throw ApiError.badRequest('This dictation has no verified transcript');

  const filter = { dictationId: new Types.ObjectId(id), status: 'submitted' as const, textVersion: { $ne: dictation.activeTextVersion } };
  const batch = await Attempt.find(filter, { _id: 1 }).limit(body.limit).lean();
  const changes = [];
  for (const a of batch) changes.push(await reevaluateOne(a._id, dictation.activeTextVersion));
  const remaining = await Attempt.countDocuments(filter);
  res.json({ textVersion: dictation.activeTextVersion, processed: changes.length, remaining, changes, statsRecounted: false });
});
