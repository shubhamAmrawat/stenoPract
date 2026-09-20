import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../../middleware/errors.js';
import { reportLimiter } from '../../middleware/security.js';
import { objectId, parse } from '../../middleware/validate.js';
import { Attempt, Dictation, Report } from '../../models/index.js';

export const reportsRouter = Router();

// A student flags a suspicious transcript word / broken video.
reportsRouter.post('/reports', reportLimiter, async (req, res) => {
  const body = parse(
    z.object({
      dictationId: objectId,
      attemptId: objectId.optional(),
      wordIndex: z.number().int().min(0).max(100_000).optional(),
      word: z.string().max(80).optional(),
      type: z.enum(['transcript_error', 'video_issue', 'other']).default('transcript_error'),
      message: z.string().trim().min(3).max(1000),
    }),
    req.body,
  );
  if (!(await Dictation.exists({ _id: body.dictationId, published: true }))) throw ApiError.notFound('Dictation not found');

  let textVersion: number | undefined;
  if (body.attemptId) {
    const attempt = await Attempt.findOne({ _id: body.attemptId, userId: req.user!.id, dictationId: body.dictationId }, { textVersion: 1 }).lean();
    if (!attempt) throw ApiError.badRequest('That attempt does not belong to you');
    textVersion = attempt.textVersion;
  }
  const report = await Report.create({ ...body, textVersion, userId: req.user!.id });
  res.status(201).json({ report: { id: String(report._id), status: report.status } });
});

reportsRouter.get('/reports', async (req, res) => {
  const items = await Report.find({ userId: req.user!.id }).sort({ createdAt: -1 }).limit(50).lean();
  res.json({
    items: items.map((r) => ({
      id: String(r._id),
      dictationId: String(r.dictationId),
      type: r.type,
      message: r.message,
      word: r.word ?? null,
      status: r.status,
      resolutionNote: r.resolutionNote ?? null,
      createdAt: r.createdAt,
    })),
  });
});
