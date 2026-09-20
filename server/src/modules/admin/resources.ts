import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../../middleware/errors.js';
import { idParam, parse } from '../../middleware/validate.js';
import { Resource } from '../../models/index.js';
import { RESOURCE_GROUPS } from '../../models/Resource.js';
import { listDriveFolder, parseDriveFolderId } from '../../services/drive.js';
import { publicResource } from '../resources/routes.js';

export const adminResourcesRouter = Router();

const httpUrl = z
  .string()
  .trim()
  .max(1000)
  .refine((u) => {
    try {
      const p = new URL(u);
      return p.protocol === 'https:' || p.protocol === 'http:';
    } catch {
      return false;
    }
  }, 'Enter a full link starting with https://');

const body = z.object({
  group: z.enum(RESOURCE_GROUPS),
  title: z.string().trim().min(1).max(160),
  url: httpUrl,
  order: z.number().int().optional(),
  published: z.boolean().optional(),
});

adminResourcesRouter.get('/resources', async (req, res) => {
  const { group } = parse(z.object({ group: z.enum(RESOURCE_GROUPS).optional() }), req.query);
  const items = await Resource.find(group ? { group } : {}).sort({ group: 1, order: 1, title: 1 }).collation({ locale: 'en', numericOrdering: true }).lean();
  res.json({ items: items.map(publicResource) });
});

adminResourcesRouter.post('/resources', async (req, res) => {
  const b = parse(body, req.body);
  const last = await Resource.findOne({ group: b.group }, { order: 1 }).sort({ order: -1 }).lean();
  const r = await Resource.create({ ...b, order: b.order ?? (last?.order ?? 0) + 1 });
  res.status(201).json({ item: publicResource(r.toObject()) });
});

/** Adds many at once. One per line: `Volume 24 | https://...`. Lines that cannot be read are reported, not guessed. */
adminResourcesRouter.post('/resources/bulk', async (req, res) => {
  const b = parse(z.object({ group: z.enum(RESOURCE_GROUPS), text: z.string().max(100_000) }), req.body);
  const last = await Resource.findOne({ group: b.group }, { order: 1 }).sort({ order: -1 }).lean();
  let order = last?.order ?? 0;
  const created: ReturnType<typeof publicResource>[] = [];
  const skipped: { line: string; reason: string }[] = [];
  for (const raw of b.text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const url = line.match(/https?:\/\/\S+/)?.[0];
    const title = line.replace(/https?:\/\/\S+/, '').replace(/[|\t,–—-]+\s*$/, '').replace(/^\s*[|\t,–—-]+/, '').trim();
    if (!url || !title) {
      skipped.push({ line, reason: 'Expected "Title | https://link"' });
      continue;
    }
    const parsed = httpUrl.safeParse(url);
    if (!parsed.success) {
      skipped.push({ line, reason: 'That link is not valid' });
      continue;
    }
    order += 1;
    created.push(publicResource((await Resource.create({ group: b.group, title: title.slice(0, 160), url: parsed.data, order })).toObject()));
  }
  res.json({ created, skipped });
});

/**
 * Reads a shared Drive folder and adds every PDF in it as a resource, in natural name order
 * ("Volume 2" before "Volume 10"). Files already added (same Drive file) are skipped, so it is safe to run again.
 */
adminResourcesRouter.post('/resources/import-drive-folder', async (req, res) => {
  const b = parse(z.object({ group: z.enum(RESOURCE_GROUPS), folder: z.string().trim().min(1).max(500) }), req.body);
  const folderId = parseDriveFolderId(b.folder);
  if (!folderId) throw ApiError.badRequest('That does not look like a Google Drive folder link');

  const listing = await listDriveFolder(folderId);
  const pdfs = [...listing.pdfs].sort((x, y) => x.name.localeCompare(y.name, 'en', { numeric: true, sensitivity: 'base' }));

  const existing = await Resource.find({ group: b.group }, { url: 1 }).lean();
  const known = new Set(existing.flatMap((r) => r.url.match(/[\w-]{20,}/g) ?? []));
  const last = await Resource.findOne({ group: b.group }, { order: 1 }).sort({ order: -1 }).lean();
  let order = last?.order ?? 0;

  const created: ReturnType<typeof publicResource>[] = [];
  let alreadyAdded = 0;
  for (const f of pdfs) {
    if (known.has(f.id)) {
      alreadyAdded += 1;
      continue;
    }
    order += 1;
    const title = f.name.replace(/\.pdf$/i, '').trim().slice(0, 160) || f.name.slice(0, 160);
    created.push(publicResource((await Resource.create({ group: b.group, title, url: `https://drive.google.com/file/d/${f.id}/view`, order })).toObject()));
  }
  res.json({ created, alreadyAdded, skippedNonPdf: listing.otherFiles, subfolders: listing.subfolders, totalPdfs: pdfs.length });
});

adminResourcesRouter.patch('/resources/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const b = parse(body.partial().refine((x) => Object.keys(x).length > 0, 'Nothing to update'), req.body);
  const r = await Resource.findByIdAndUpdate(id, b, { returnDocument: 'after', runValidators: true }).lean();
  if (!r) throw ApiError.notFound('Resource not found');
  res.json({ item: publicResource(r) });
});

adminResourcesRouter.delete('/resources/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const r = await Resource.findByIdAndDelete(id).lean();
  if (!r) throw ApiError.notFound('Resource not found');
  res.json({ ok: true });
});
