import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export async function connectDb(): Promise<void> {
  mongoose.connection.on('error', (err: Error) => {
    logger.error({ err }, 'MongoDB error');
  });
  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
  });

  await mongoose.connect(env.dbUrl, {
    dbName: 'steno',
    serverSelectionTimeoutMS: 10_000,
  });
  logger.info(`MongoDB connected (db: ${mongoose.connection.name})`);
}
