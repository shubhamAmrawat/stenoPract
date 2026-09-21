import express, { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { countWords } from '../../evaluator/index.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../middleware/errors.js';
import { scanUploadLimiter } from '../../middleware/security.js';
import { idParam, parse } from '../../middleware/validate.js';
import { Dictation, DictationSet, DictationText, TranscriptScan } from '../../models/index.js';
import { prepareScanImage, SCAN_INPUT_TYPES, SCAN_MAX_BYTES } from '../../services/scan/image.js';
import { enqueueScan, settle } from '../../services/scan/queue.js';

export const adminScansRouter = Router();

const readImageBody: RequestHandler = (req, res, next) => {
  express.raw({ type: SCAN_INPUT_TYPES, limit: SCAN_MAX_BYTES })(req, res, (err?: unknown) => {
    if ((err as { status?: number } | undefined)?.status === 413) {
      return next(new ApiError(413, 'That page image is too large (over 8 MB). Export it at a smaller size.', 'TOO_LARGE'));
    }
    next(err);
  });
};

interface ScanLike {
  _id: unknown;
  setId: unknown;
  fileName?: string | null;
  pageNo?: number | null;
  status: string;
  error?: string | null;
  exerciseNo?: number | null;
  dictationId?: unknown;
  textId?: unknown;
  outcome?: string | null;
  review?: string | null;
  reading?: { uncertain?: unknown[] } | null;
  checks?: { green?: boolean } | null;
  compare?: { differenceCount?: number } | null;
  usage?: unknown;
  part?: string | null;
  joinedInto?: unknown;
  createdAt?: Date;
}

const publicScan = (s: ScanLike, pageNos?: number[]) => ({
  id: String(s._id),
  setId: String(s.setId),
  fileName: s.fileName ?? '',
  pageNo: s.pageNo ?? 1,
  /** Every page of the file that makes up this exercise (more than one when an exercise runs over two pages). */
  pageNos: pageNos ?? [s.pageNo ?? 1],
  part: s.part ?? null,
  joinedInto: s.joinedInto ? String(s.joinedInto) : null,
  status: s.status,
  error: s.error ?? null,
  exerciseNo: s.exerciseNo ?? null,
  dictationId: s.dictationId ? String(s.dictationId) : null,
  textId: s.textId ? String(s.textId) : null,
  outcome: s.outcome ?? null,
  review: s.review ?? 'pending',
  green: s.checks?.green === true,
  checks: s.checks ?? null,
  uncertainCount: s.reading?.uncertain?.length ?? 0,
  /** How many places the scan differs from the transcript that was live when it ran (null when none was live). */
  differenceCount: s.compare ? (s.compare.differenceCount ?? 0) : null,
  usage: s.usage ?? null,
  createdAt: s.createdAt ?? null,
});

/** Is Claude set up? Lets the page explain what to do instead of failing on the first upload. */
adminScansRouter.get('/scans/status', (_req, res) => {
  res.json({ configured: env.anthropic.apiKey !== '', model: env.anthropic.scanModel, passes: env.anthropic.scanPasses });
});

adminScansRouter.get('/sets/:id/scans', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const items = (await TranscriptScan.find({ setId: id }, { image: 0 }).sort({ fileName: 1, pageNo: 1, createdAt: 1 }).lean()) as ScanLike[];
  // Pages joined into an exercise are not listed on their own: the first page stands for the whole exercise.
  const joined = new Map<string, number[]>();
  for (const s of items) if (s.joinedInto) joined.set(String(s.joinedInto), [...(joined.get(String(s.joinedInto)) ?? []), s.pageNo ?? 1]);
  res.json({ items: items.filter((s) => !s.joinedInto).map((s) => publicScan(s, [s.pageNo ?? 1, ...(joined.get(String(s._id)) ?? [])])) });
});

/** One page image as the raw request body. Answers at once; the page is read in the background. */
adminScansRouter.post('/sets/:id/scans', scanUploadLimiter, readImageBody, async (req, res) => {
  const { id } = parse(idParam, req.params);
  const q = parse(
    z.object({
      name: z.string().max(200).optional(),
      page: z.coerce.number().int().min(1).max(10_000).optional(),
      /** Pages of one PDF carry the same upload id and the PDF's page count, so an exercise over two pages can be joined. */
      upload: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
      pages: z.coerce.number().int().min(1).max(10_000).optional(),
    }),
    req.query,
  );
  if (!env.anthropic.apiKey) {
    throw new ApiError(503, 'Add ANTHROPIC_API_KEY to the server settings first, then try again.', 'ANTHROPIC_NOT_CONFIGURED');
  }
  if (!(await DictationSet.exists({ _id: id }))) throw ApiError.notFound('Set not found');
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw ApiError.badRequest('Send the page as a JPG, PNG or WebP image');

  const image = await prepareScanImage(req.body);
  const scan = await TranscriptScan.create({ setId: id, fileName: q.name ?? '', pageNo: q.page ?? 1, uploadId: q.upload ?? '', pages: q.pages ?? 1, image, createdBy: req.user!.id });
  enqueueScan(String(scan._id));
  res.status(202).json({ scan: publicScan(scan.toObject() as ScanLike) });
});

adminScansRouter.get('/scans/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const scan = await TranscriptScan.findById(id, { image: 0 }).lean();
  if (!scan) throw ApiError.notFound('Scan not found');
  const [text, dictation] = await Promise.all([
    scan.textId ? DictationText.findById(scan.textId).lean() : null,
    scan.dictationId ? Dictation.findById(scan.dictationId, { videos: 1, published: 1, title: 1, activeTextVersion: 1 }).lean() : null,
  ]);
  // The scan's own page first, then the pages that were joined to it. Only pages whose picture is still stored are listed.
  const pageDocs = await TranscriptScan.find({ $or: [{ _id: id }, { joinedInto: id }] }, { pageNo: 1 }).sort({ pageNo: 1 }).lean();
  const withImage = new Set((await TranscriptScan.find({ _id: { $in: pageDocs.map((p) => p._id) }, image: { $exists: true, $ne: null } }, { _id: 1 }).lean()).map((p) => String(p._id)));
  const parts = pageDocs.map((p) => ({ id: String(p._id), pageNo: p.pageNo ?? 1, hasImage: withImage.has(String(p._id)) }));
  res.json({
    scan: publicScan(scan as ScanLike, pageDocs.map((p) => p.pageNo ?? 1)),
    hasImage: parts.some((p) => p.hasImage),
    parts,
    reading: scan.reading ?? null,
    compare: scan.compare ?? null,
    draft: text
      ? { id: String(text._id), version: text.version, masterText: text.masterText, checkpoints: text.checkpoints ?? [], reviewStatus: text.reviewStatus ?? 'draft', wordCount: countWords(text.masterText) }
      : null,
    dictation: dictation
      ? { id: String(dictation._id), title: dictation.title, videoCount: dictation.videos?.length ?? 0, published: dictation.published ?? false, activeTextVersion: dictation.activeTextVersion ?? null }
      : null,
  });
});

adminScansRouter.get('/scans/:id/image', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const scan = await TranscriptScan.findById(id, { image: 1 });
  if (!scan?.image) throw ApiError.notFound('The page image is no longer stored');
  res.set('Cache-Control', 'private, max-age=3600').type('image/jpeg').send(Buffer.from(scan.image));
});

/** Reads the page again (for example after a failure). Any unreviewed draft it made before is removed first. */
adminScansRouter.post('/scans/:id/retry', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const scan = await TranscriptScan.findById(id);
  if (!scan) throw ApiError.notFound('Scan not found');
  if (!scan.image) throw new ApiError(409, 'The page image is no longer stored, so it cannot be read again. Upload it again.', 'NO_IMAGE');
  if (scan.status === 'queued' || scan.status === 'running') throw new ApiError(409, 'This page is being read right now', 'BUSY');
  if (scan.review === 'approved') throw new ApiError(409, 'This page was already approved', 'APPROVED');
  if (scan.textId) await DictationText.deleteOne({ _id: scan.textId, reviewStatus: { $ne: 'verified' } });
  // Pages that were joined into this exercise are read again together with it.
  const joined = await TranscriptScan.find({ joinedInto: scan._id, image: { $exists: true, $ne: null } }, { _id: 1 }).lean();
  if (joined.length) {
    await TranscriptScan.updateMany(
      { _id: { $in: joined.map((j) => j._id) } },
      { $set: { status: 'queued' }, $unset: { error: 1, joinedInto: 1, part: 1, reading: 1, usage: 1, outcome: 1, exerciseNo: 1 } },
    );
  }
  scan.set({ status: 'queued', error: undefined, textId: undefined, outcome: undefined, reading: undefined, checks: undefined, compare: undefined, usage: undefined, part: undefined, joinedInto: undefined });
  await scan.save();
  for (const j of joined) enqueueScan(String(j._id));
  enqueueScan(String(scan._id));
  res.json({ scan: publicScan(scan.toObject() as ScanLike) });
});

/** Makes the draft the live transcript. With `publish`, the exercise is also shown to students if it has a video. */
adminScansRouter.post('/scans/:id/approve', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const body = parse(z.object({ publish: z.boolean().optional() }), req.body ?? {});
  const scan = await TranscriptScan.findById(id);
  if (!scan) throw ApiError.notFound('Scan not found');
  if (scan.review === 'approved') return void res.json({ scan: publicScan(scan.toObject() as ScanLike), published: false, hasVideo: false });
  if (!scan.textId) throw new ApiError(409, 'There is no draft to approve for this page', 'NO_DRAFT');
  const text = await DictationText.findById(scan.textId);
  if (!text) throw ApiError.notFound('The draft transcript was removed');

  if (text.reviewStatus !== 'verified') {
    text.reviewStatus = 'verified';
    await text.save();
  }
  await Dictation.updateOne({ _id: text.dictationId }, { $set: { activeTextVersion: text.version, masterWordCount: countWords(text.masterText) } });

  const dictation = await Dictation.findById(text.dictationId);
  const hasVideo = (dictation?.videos.length ?? 0) > 0;
  let published = dictation?.published ?? false;
  if (body.publish && dictation && hasVideo && !dictation.published) {
    dictation.published = true;
    await dictation.save();
    published = true;
  }

  scan.review = 'approved';
  scan.set('image', undefined);
  await scan.save();
  await TranscriptScan.updateMany({ joinedInto: scan._id }, { $set: { review: 'approved' }, $unset: { image: 1 } });
  res.json({ scan: publicScan(scan.toObject() as ScanLike), published, hasVideo });
});

/** Throws the scan away, together with its draft transcript if that was never approved. */
adminScansRouter.delete('/scans/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const scan = await TranscriptScan.findById(id, { textId: 1, status: 1, setId: 1, uploadId: 1, pageNo: 1 }).lean();
  if (!scan) throw ApiError.notFound('Scan not found');
  if (scan.textId) await DictationText.deleteOne({ _id: scan.textId, reviewStatus: { $ne: 'verified' } });
  await TranscriptScan.deleteMany({ $or: [{ _id: id }, { joinedInto: id }] });
  // A neighbouring page may have been waiting for this one: let it go on without it.
  if (scan.uploadId) {
    for (const n of [(scan.pageNo ?? 1) - 1, (scan.pageNo ?? 1) + 1]) {
      const waiting = await TranscriptScan.findOne({ setId: scan.setId, uploadId: scan.uploadId, pageNo: n, status: 'waiting' }, { _id: 1 }).lean();
      if (waiting) await settle(String(waiting._id), true);
    }
  }
  res.json({ ok: true });
});
