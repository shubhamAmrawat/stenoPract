import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../../middleware/errors.js';
import { idParam, parse } from '../../middleware/validate.js';
import { Report } from '../../models/index.js';

export const adminReportsRouter = Router();

adminReportsRouter.get('/reports', async (req, res) => {
  const q = parse(
    z.object({
      status: z.enum(['open', 'resolved', 'rejected']).default('open'),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(30),
    }),
    req.query,
  );
  const [items, total] = await Promise.all([
    Report.find({ status: q.status }).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).populate('userId', 'name email').populate('dictationId', 'title exerciseNo').lean(),
    Report.countDocuments({ status: q.status }),
  ]);
  res.json({
    total,
    items: items.map((r) => {
      const user = r.userId as unknown as { _id: unknown; name?: string; email?: string } | null;
      const dictation = r.dictationId as unknown as { _id: unknown; title?: string; exerciseNo?: number } | null;
      return {
        id: String(r._id),
        type: r.type,
        message: r.message,
        word: r.word ?? null,
        wordIndex: r.wordIndex ?? null,
        textVersion: r.textVersion ?? null,
        status: r.status,
        resolutionNote: r.resolutionNote ?? null,
        createdAt: r.createdAt,
        user: user ? { id: String(user._id), name: user.name ?? null, email: user.email ?? null } : null,
        dictation: dictation ? { id: String(dictation._id), title: dictation.title ?? null, exerciseNo: dictation.exerciseNo ?? null } : null,
      };
    }),
  });
});

adminReportsRouter.patch('/reports/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const body = parse(z.object({ status: z.enum(['open', 'resolved', 'rejected']), resolutionNote: z.string().max(500).optional() }), req.body);
  const closing = body.status !== 'open';
  const report = await Report.findByIdAndUpdate(
    id,
    {
      $set: { status: body.status, resolutionNote: body.resolutionNote, ...(closing ? { resolvedBy: req.user!.id, resolvedAt: new Date() } : {}) },
      ...(closing ? {} : { $unset: { resolvedBy: 1, resolvedAt: 1 } }),
    },
    { returnDocument: 'after' },
  ).lean();
  if (!report) throw ApiError.notFound('Report not found');
  res.json({ report: { id: String(report._id), status: report.status, resolutionNote: report.resolutionNote ?? null } });
});
