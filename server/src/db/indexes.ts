import mongoose from 'mongoose';
import '../models/index.js';

/**
 * Builds every index declared on the schemas and waits for them.
 * Some indexes are safety nets, not just speed-ups (e.g. the "one open draft per student per dictation"
 * unique index), so the server must not accept traffic before they exist.
 */
export async function ensureIndexes(): Promise<void> {
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
}
