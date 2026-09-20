import { Router } from 'express';
import { z } from 'zod';
import { parse } from '../../middleware/validate.js';
import { Resource } from '../../models/index.js';
import { RESOURCE_GROUPS } from '../../models/Resource.js';

export const resourcesRouter = Router();

const groupParam = z.object({ group: z.enum(RESOURCE_GROUPS) });

export const publicResource = (r: { _id: unknown; group: string; title: string; url: string; order?: number | null; published?: boolean | null }) => ({
  id: String(r._id),
  group: r.group,
  title: r.title,
  url: r.url,
  order: r.order ?? 0,
  published: r.published ?? true,
});

/** Counts per group, for the cards on the student home page. */
resourcesRouter.get('/resources', async (_req, res) => {
  const rows = await Resource.aggregate<{ _id: string; count: number }>([{ $match: { published: true } }, { $group: { _id: '$group', count: { $sum: 1 } } }]);
  const counts = new Map(rows.map((r) => [r._id, r.count]));
  res.json({ groups: RESOURCE_GROUPS.map((g) => ({ group: g, count: counts.get(g) ?? 0 })) });
});

resourcesRouter.get('/resources/:group', async (req, res) => {
  const { group } = parse(groupParam, req.params);
  const items = await Resource.find({ group, published: true }).sort({ order: 1, title: 1 }).collation({ locale: 'en', numericOrdering: true }).lean();
  res.json({ group, items: items.map(publicResource) });
});
