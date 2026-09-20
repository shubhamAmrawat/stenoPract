import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../../middleware/errors.js';
import { idParam, parse } from '../../middleware/validate.js';
import { Resource, ResourceGroup } from '../../models/index.js';
import { slugify } from '../../models/ResourceGroup.js';
import { listDriveFolder, parseDriveFolderId } from '../../services/drive.js';
import { getStorage } from '../../services/storage.js';
import { publicGroup, publicResource } from '../resources/routes.js';

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

/** The slug of a shelf. Whether it exists is checked where it is used. */
const groupSlug = z.string().trim().min(1).max(60);

async function requireGroup(slug: string) {
  const g = await ResourceGroup.findOne({ slug }).lean();
  if (!g) throw ApiError.badRequest('That resource group does not exist');
  return g;
}

const body = z.object({
  group: groupSlug,
  title: z.string().trim().min(1).max(160),
  url: httpUrl,
  order: z.number().int().optional(),
  published: z.boolean().optional(),
});

adminResourcesRouter.get('/resources', async (req, res) => {
  const { group } = parse(z.object({ group: groupSlug.optional() }), req.query);
  const items = await Resource.find(group ? { group } : {}).sort({ group: 1, order: 1, title: 1 }).collation({ locale: 'en', numericOrdering: true }).lean();
  res.json({ items: items.map(publicResource) });
});

adminResourcesRouter.post('/resources', async (req, res) => {
  const b = parse(body, req.body);
  await requireGroup(b.group);
  const last = await Resource.findOne({ group: b.group }, { order: 1 }).sort({ order: -1 }).lean();
  const r = await Resource.create({ ...b, order: b.order ?? (last?.order ?? 0) + 1 });
  res.status(201).json({ item: publicResource(r.toObject()) });
});

/** Adds many at once. One per line: `Volume 24 | https://...`. Lines that cannot be read are reported, not guessed. */
adminResourcesRouter.post('/resources/bulk', async (req, res) => {
  const b = parse(z.object({ group: groupSlug, text: z.string().max(100_000) }), req.body);
  await requireGroup(b.group);
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
  const b = parse(z.object({ group: groupSlug, folder: z.string().trim().min(1).max(500) }), req.body);
  await requireGroup(b.group);
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
  if (b.group) await requireGroup(b.group);
  if (b.url !== undefined && (await Resource.exists({ _id: id, fileKey: { $exists: true, $ne: null } }))) {
    throw ApiError.badRequest('An uploaded file has no link to edit. Delete it and upload the new file instead.');
  }
  const r = await Resource.findByIdAndUpdate(id, b, { returnDocument: 'after', runValidators: true }).lean();
  if (!r) throw ApiError.notFound('Resource not found');
  res.json({ item: publicResource(r) });
});

adminResourcesRouter.delete('/resources/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const r = await Resource.findByIdAndDelete(id).lean();
  if (!r) throw ApiError.notFound('Resource not found');
  // An uploaded file leaves our storage too. A failed clean-up is only logged; the resource is already gone.
  if (r.fileKey) await getStorage()?.remove(r.fileKey).catch((e: unknown) => req.log?.warn({ err: e, key: r.fileKey }, 'could not delete the uploaded file'));
  res.json({ ok: true });
});

/* ---------- resource groups (the shelves) ---------- */

const groupBody = z.object({
  title: z.string().trim().min(1, 'Give the group a name').max(80, 'Keep the name under 80 characters'),
  blurb: z.string().trim().max(200, 'Keep the description under 200 characters').optional(),
  published: z.boolean().optional(),
});

async function uniqueSlug(title: string): Promise<string> {
  const base = slugify(title);
  for (let n = 1; n < 500; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (!(await ResourceGroup.exists({ slug }))) return slug;
  }
  return `${base}-${randomUUID().slice(0, 8)}`;
}

adminResourcesRouter.get('/resource-groups', async (_req, res) => {
  const [groups, rows] = await Promise.all([
    ResourceGroup.find().sort({ order: 1, title: 1 }).lean(),
    Resource.aggregate<{ _id: string; count: number }>([{ $group: { _id: '$group', count: { $sum: 1 } } }]),
  ]);
  const counts = new Map(rows.map((r) => [r._id, r.count]));
  res.json({ items: groups.map((g) => publicGroup(g, counts.get(g.slug) ?? 0)) });
});

adminResourcesRouter.post('/resource-groups', async (req, res) => {
  const b = parse(groupBody, req.body);
  const last = await ResourceGroup.findOne({}, { order: 1 }).sort({ order: -1 }).lean();
  let g;
  try {
    g = await ResourceGroup.create({ ...b, slug: await uniqueSlug(b.title), order: (last?.order ?? 0) + 1 });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw ApiError.conflict('A group with a similar name was just created. Try again.');
    throw err;
  }
  res.status(201).json({ item: publicGroup(g.toObject(), 0) });
});

adminResourcesRouter.patch('/resource-groups/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const b = parse(groupBody.partial().refine((x) => Object.keys(x).length > 0, 'Nothing to update'), req.body);
  const g = await ResourceGroup.findByIdAndUpdate(id, b, { returnDocument: 'after', runValidators: true }).lean();
  if (!g) throw ApiError.notFound('Group not found');
  res.json({ item: publicGroup(g, await Resource.countDocuments({ group: g.slug })) });
});

/** A group with files in it is not deleted: that would hide them by accident. Move or delete the files first. */
adminResourcesRouter.delete('/resource-groups/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const g = await ResourceGroup.findById(id).lean();
  if (!g) throw ApiError.notFound('Group not found');
  const files = await Resource.countDocuments({ group: g.slug });
  if (files > 0) throw ApiError.conflict(`This group still has ${files} file${files === 1 ? '' : 's'}. Delete them first, then delete the group.`);
  await ResourceGroup.deleteOne({ _id: id });
  res.json({ ok: true });
});

/* ---------- uploading PDFs from the admin's computer ---------- */

export const RESOURCE_MAX_BYTES = 200 * 1024 * 1024;
const UPLOAD_URL_SECONDS = 15 * 60;

/** A name that is safe inside a storage key and a web address: letters, digits, dot, dash, underscore. Always ends in .pdf. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const stem = base
    .replace(/\.pdf$/i, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 100);
  return `${stem || 'file'}.pdf`;
}

const requireStorage = () => {
  const storage = getStorage();
  if (!storage) throw new ApiError(503, 'File uploads are not set up on this server yet. Add the R2 settings to server/.env and restart.', 'UPLOADS_DISABLED');
  return storage;
};

/** Step 1 of an upload: for each file, hand back a private address the browser can send the file to directly. */
adminResourcesRouter.post('/resources/uploads', async (req, res) => {
  const b = parse(
    z.object({
      group: groupSlug,
      files: z
        .array(z.object({ name: z.string().trim().min(1).max(255), size: z.number().int().positive().max(RESOURCE_MAX_BYTES, 'That file is over 200 MB') }))
        .min(1)
        .max(50),
    }),
    req.body,
  );
  const storage = requireStorage();
  await requireGroup(b.group);
  const bad = b.files.find((f) => !/\.pdf$/i.test(f.name));
  if (bad) throw ApiError.badRequest(`“${bad.name}” is not a PDF. Only PDF files can be uploaded.`);

  const uploads = await Promise.all(
    b.files.map(async (f) => {
      const key = `resources/${b.group}/${randomUUID()}/${safeFileName(f.name)}`;
      return { name: f.name, key, uploadUrl: await storage.presignPut(key, 'application/pdf', UPLOAD_URL_SECONDS), contentType: 'application/pdf' };
    }),
  );
  res.json({ uploads });
});

/** Step 2: once the browser has sent the files, check each really arrived and add it to the group, in the order given. */
adminResourcesRouter.post('/resources/uploads/complete', async (req, res) => {
  const b = parse(
    z.object({
      group: groupSlug,
      files: z.array(z.object({ key: z.string().max(400), title: z.string().trim().max(160).optional() })).min(1).max(50),
    }),
    req.body,
  );
  const storage = requireStorage();
  await requireGroup(b.group);
  const keyShape = new RegExp(`^resources/${b.group}/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,104}\\.pdf$`);

  const last = await Resource.findOne({ group: b.group }, { order: 1 }).sort({ order: -1 }).lean();
  let order = last?.order ?? 0;
  const created: ReturnType<typeof publicResource>[] = [];
  const failed: { key: string; reason: string }[] = [];
  for (const f of b.files) {
    if (!keyShape.test(f.key)) {
      failed.push({ key: f.key, reason: 'Not a file from this upload' });
      continue;
    }
    if (await Resource.exists({ fileKey: f.key })) {
      failed.push({ key: f.key, reason: 'Already added' });
      continue;
    }
    const stored = await storage.head(f.key);
    if (!stored) {
      failed.push({ key: f.key, reason: 'The upload did not finish' });
      continue;
    }
    if (stored.size > RESOURCE_MAX_BYTES) {
      await storage.remove(f.key).catch(() => undefined);
      failed.push({ key: f.key, reason: 'Over 200 MB' });
      continue;
    }
    const title = (f.title || f.key.split('/').pop()!.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ')).trim().slice(0, 160);
    order += 1;
    created.push(publicResource((await Resource.create({ group: b.group, title, fileKey: f.key, fileSize: stored.size, order })).toObject()));
  }
  res.json({ created, failed });
});
