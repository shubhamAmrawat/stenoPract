import mongoose from 'mongoose';
import { User } from '../models/index.js';

/**
 * Older databases have a plain unique index on users.googleId. Password accounts have no Google id, so that index would
 * reject the second one. Drop it once; the schema then builds the partial version.
 */
export async function dropLegacyUserIndex(): Promise<void> {
  const users = mongoose.connection.collection('users');
  const indexes = await users.indexes().catch(() => []); // the collection does not exist yet on a fresh database
  const legacy = indexes.find((i) => i.name === 'googleId_1' && !i.partialFilterExpression);
  if (legacy) await users.dropIndex('googleId_1');
}

/**
 * Builds every index declared on the schemas and waits for them.
 * Some indexes are safety nets, not just speed-ups (e.g. the "one open draft per student per dictation"
 * unique index), so the server must not accept traffic before they exist.
 */
export async function ensureIndexes(): Promise<void> {
  await dropLegacyUserIndex();
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  // The User schema has autoIndex off (see models/User.ts), so its indexes are built here, once the old one is gone.
  await User.createIndexes();
}
