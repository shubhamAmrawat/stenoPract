import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { ApiError } from '../../middleware/errors.js';
import { idParam, objectId, parse } from '../../middleware/validate.js';
import { Dictation, Folder, UserDictationState } from '../../models/index.js';
import { publicState } from '../catalog/serialize.js';

export const libraryRouter = Router();

async function requirePublishedDictation(id: string) {
  if (!(await Dictation.exists({ _id: id, published: true }))) throw ApiError.notFound('Dictation not found');
}

const publicFolder = (f: { _id: unknown; name: string; color?: string | null }, count = 0) => ({
  id: String(f._id),
  name: f.name,
  color: f.color ?? '#4F46E5',
  count,
});

libraryRouter.put('/dictations/:id/state', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const body = parse(z.object({ seen: z.boolean().optional(), favourite: z.boolean().optional() }).refine((b) => Object.keys(b).length > 0, 'Nothing to update'), req.body);
  await requirePublishedDictation(id);
  const state = await UserDictationState.findOneAndUpdate(
    { userId: req.user!.id, dictationId: id },
    { $set: body },
    { upsert: true, returnDocument: 'after' },
  ).lean();
  res.json({ state: publicState(state) });
});

libraryRouter.put('/dictations/:id/folders', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const { folderIds } = parse(z.object({ folderIds: z.array(objectId).max(50) }), req.body);
  await requirePublishedDictation(id);
  const unique = [...new Set(folderIds)];
  const owned = await Folder.countDocuments({ _id: { $in: unique }, userId: req.user!.id });
  if (owned !== unique.length) throw ApiError.badRequest('One or more folders do not exist');
  const state = await UserDictationState.findOneAndUpdate(
    { userId: req.user!.id, dictationId: id },
    { $set: { folderIds: unique.map((f) => new Types.ObjectId(f)) } },
    { upsert: true, returnDocument: 'after' },
  ).lean();
  res.json({ state: publicState(state) });
});

libraryRouter.get('/folders', async (req, res) => {
  const userId = new Types.ObjectId(req.user!.id);
  const [folders, counts] = await Promise.all([
    Folder.find({ userId }).sort({ name: 1 }).lean(),
    UserDictationState.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { userId } },
      { $unwind: '$folderIds' },
      { $group: { _id: '$folderIds', n: { $sum: 1 } } },
    ]),
  ]);
  const countMap = new Map(counts.map((c) => [String(c._id), c.n]));
  res.json({ items: folders.map((f) => publicFolder(f, countMap.get(String(f._id)) ?? 0)) });
});

const folderBody = z.object({
  name: z.string().trim().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

libraryRouter.post('/folders', async (req, res) => {
  const body = parse(folderBody, req.body);
  try {
    const folder = await Folder.create({ userId: req.user!.id, ...body });
    res.status(201).json({ folder: publicFolder(folder) });
  } catch (err) {
    if (isDuplicateKey(err)) throw ApiError.conflict('You already have a folder with that name');
    throw err;
  }
});

libraryRouter.patch('/folders/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const body = parse(folderBody.partial().refine((b) => Object.keys(b).length > 0, 'Nothing to update'), req.body);
  try {
    const folder = await Folder.findOneAndUpdate({ _id: id, userId: req.user!.id }, { $set: body }, { returnDocument: 'after' }).lean();
    if (!folder) throw ApiError.notFound('Folder not found');
    res.json({ folder: publicFolder(folder) });
  } catch (err) {
    if (isDuplicateKey(err)) throw ApiError.conflict('You already have a folder with that name');
    throw err;
  }
});

libraryRouter.delete('/folders/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const deleted = await Folder.findOneAndDelete({ _id: id, userId: req.user!.id });
  if (!deleted) throw ApiError.notFound('Folder not found');
  await UserDictationState.updateMany({ userId: req.user!.id, folderIds: deleted._id }, { $pull: { folderIds: deleted._id } });
  res.json({ ok: true });
});
