import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../../middleware/errors.js';
import { parse } from '../../middleware/validate.js';
import { Resource, ResourceGroup } from '../../models/index.js';
import { getStorage } from '../../services/storage.js';

export const resourcesRouter = Router();

const groupParam = z.object({ group: z.string().trim().min(1).max(60) });

interface ResourceLike {
  _id: unknown;
  group: string;
  title: string;
  url?: string | null;
  fileKey?: string | null;
  fileSize?: number | null;
  order?: number | null;
  published?: boolean | null;
}

export const publicResource = (r: ResourceLike) => ({
  id: String(r._id),
  group: r.group,
  title: r.title,
  // An uploaded file's address is built from its key, so moving the bucket to a custom domain later needs no data change.
  url: (r.fileKey ? getStorage()?.urlFor(r.fileKey) : undefined) ?? r.url ?? '',
  uploaded: Boolean(r.fileKey),
  size: r.fileSize ?? null,
  order: r.order ?? 0,
  published: r.published ?? true,
});

export const publicGroup = (g: { _id: unknown; slug: string; title: string; blurb?: string | null; order?: number | null; published?: boolean | null }, count?: number) => ({
  id: String(g._id),
  group: g.slug,
  title: g.title,
  blurb: g.blurb ?? '',
  order: g.order ?? 0,
  published: g.published ?? true,
  ...(count === undefined ? {} : { count }),
});

/** The shelves students can open, with how many files each holds (for the cards on the home page). */
resourcesRouter.get('/resources', async (_req, res) => {
  const [groups, rows] = await Promise.all([
    ResourceGroup.find({ published: true }).sort({ order: 1, title: 1 }).lean(),
    Resource.aggregate<{ _id: string; count: number }>([{ $match: { published: true } }, { $group: { _id: '$group', count: { $sum: 1 } } }]),
  ]);
  const counts = new Map(rows.map((r) => [r._id, r.count]));
  res.json({ groups: groups.map((g) => publicGroup(g, counts.get(g.slug) ?? 0)) });
});

resourcesRouter.get('/resources/:group', async (req, res) => {
  const { group } = parse(groupParam, req.params);
  const meta = await ResourceGroup.findOne({ slug: group, published: true }).lean();
  if (!meta) throw ApiError.notFound('We could not find that page');
  const items = await Resource.find({ group, published: true }).sort({ order: 1, title: 1 }).collation({ locale: 'en', numericOrdering: true }).lean();
  res.json({ group: publicGroup(meta), items: items.map(publicResource) });
});
