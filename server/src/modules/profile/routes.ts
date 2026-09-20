import { randomUUID } from 'node:crypto';
import express, { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { ApiError } from '../../middleware/errors.js';
import { avatarLimiter } from '../../middleware/security.js';
import { parse } from '../../middleware/validate.js';
import { User } from '../../models/index.js';
import { AVATAR_CONTENT_TYPE, AVATAR_INPUT_TYPES, AVATAR_MAX_BYTES, processAvatar } from '../../services/avatar.js';
import { getStorage } from '../../services/storage.js';
import { publicUser } from '../auth/routes.js';

export const profileRouter = Router();

/** The photo arrives as the raw request body (Content-Type: image/jpeg | png | webp), so no multipart library is needed. */
const readImageBody: RequestHandler = (req, res, next) => {
  express.raw({ type: AVATAR_INPUT_TYPES, limit: AVATAR_MAX_BYTES })(req, res, (err?: unknown) => {
    if ((err as { status?: number } | undefined)?.status === 413) {
      return next(new ApiError(413, 'That photo is too large. Choose one under 2 MB.', 'TOO_LARGE'));
    }
    next(err);
  });
};

/** Letters, digits and the usual separators: +91 98765 43210, (011) 2345-6789. */
const phoneSchema = z.string().trim().max(20).refine((v) => v === '' || (/^\+?[0-9][0-9 ()-]{5,18}[0-9]$/.test(v) && v.replace(/\D/g, '').length >= 7), 'Enter a valid phone number');

const profileBody = z
  .object({
    name: z.string().trim().min(1, 'Enter your name').max(80, 'Keep your name under 80 characters'),
    phone: phoneSchema,
    gender: z.enum(['female', 'male', 'other', 'prefer-not-to-say', '']),
    bio: z.string().trim().max(200, 'Keep your bio under 200 characters'),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update');

/** Any of the fields can be sent on its own. An empty phone, gender or bio clears it. */
profileRouter.patch('/me/profile', async (req, res) => {
  const b = parse(profileBody, req.body);
  const set: Record<string, unknown> = {};
  const unset: Record<string, 1> = {};
  if (b.name !== undefined) {
    set.name = b.name;
    set.nameCustomised = true;
  }
  for (const field of ['phone', 'gender', 'bio'] as const) {
    if (b[field] === undefined) continue;
    if (b[field] === '') unset[field] = 1;
    else set[field] = b[field];
  }
  const user = await User.findByIdAndUpdate(req.user!.id, { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { returnDocument: 'after', runValidators: true });
  if (!user) throw ApiError.notFound('Account not found');
  res.json({ user: publicUser(user) });
});

profileRouter.put('/me/avatar', avatarLimiter, readImageBody, async (req, res) => {
  const storage = getStorage();
  if (!storage) throw new ApiError(503, 'Photo uploads are not set up on this server yet.', 'UPLOADS_DISABLED');
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    throw new ApiError(415, 'Send the photo as a JPG, PNG or WebP file.', 'UNSUPPORTED_MEDIA');
  }
  const image = await processAvatar(req.body);

  const user = await User.findById(req.user!.id);
  if (!user) throw ApiError.notFound('Account not found');
  const previous = user.avatarKey;
  const key = `avatars/${user.id}/${randomUUID()}.webp`;

  await storage.put(key, image, AVATAR_CONTENT_TYPE);
  try {
    user.avatarKey = key;
    await user.save();
  } catch (err) {
    await storage.remove(key).catch(() => undefined);
    throw err;
  }
  // The old copy is no longer referenced. A failed clean-up is only logged; it must not fail the upload.
  if (previous) await storage.remove(previous).catch((e: unknown) => req.log?.warn({ err: e, key: previous }, 'could not delete the previous avatar'));
  res.json({ user: publicUser(user) });
});
