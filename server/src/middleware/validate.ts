import { Types } from 'mongoose';
import { z, type ZodType } from 'zod';
import { ApiError } from './errors.js';

/** Parse untrusted input with a zod schema; throws a 400 listing every problem. */
export function parse<T extends ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw ApiError.badRequest(
      'Invalid request',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}

/** A 24-character hex Mongo id. */
export const objectId = z.string().refine((v) => Types.ObjectId.isValid(v) && /^[a-f0-9]{24}$/i.test(v), {
  message: 'Invalid id',
});

export const idParam = z.object({ id: objectId });
