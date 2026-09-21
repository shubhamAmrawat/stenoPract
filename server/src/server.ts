import MongoStore from 'connect-mongo';
import mongoose from 'mongoose';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDb } from './db/connect.js';
import { ensureIndexes } from './db/indexes.js';
import { seedReferenceData } from './db/seed.js';
import { resumePendingScans } from './services/scan/queue.js';

async function main(): Promise<void> {
  await connectDb();
  await ensureIndexes();
  await seedReferenceData();

  const app = createApp({
    sessionStore: MongoStore.create({
      client: mongoose.connection.getClient(),
      dbName: mongoose.connection.name,
      collectionName: 'sessions',
      ttl: 30 * 24 * 60 * 60,
    }),
  });

  await resumePendingScans();

  const server = app.listen(env.port, () => {
    logger.info(`Server listening on http://localhost:${env.port} (${env.nodeEnv})`);
  });

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    server.close(async () => {
      await mongoose.disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
