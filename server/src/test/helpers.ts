import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { createApp } from '../app.js';
import { ensureIndexes } from '../db/indexes.js';
import { seedReferenceData } from '../db/seed.js';
import { invalidateLexicon } from '../services/lexicon.js';
import type { ObjectStorage } from '../services/storage.js';

let mongod: MongoMemoryServer | undefined;

/** Starts a throw-away in-memory MongoDB, connects mongoose to it and seeds reference data. */
export async function startTestDb(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'steno_test' });
  await ensureIndexes();
  await seedReferenceData();
}

export async function stopTestDb(): Promise<void> {
  await mongoose.disconnect();
  await mongod?.stop();
}

/** Empties every collection except the seeded reference data. */
export async function clearTestData(): Promise<void> {
  const keep = new Set(['examprofiles', 'alternateforms', 'abbreviations']);
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.filter((c) => !keep.has(c.collectionName)).map((c) => c.deleteMany({})));
  invalidateLexicon();
}

export function testApp() {
  return createApp();
}

/** A supertest agent that keeps its session cookie, already signed in via the dev-login route. */
export async function loginAs(app: ReturnType<typeof testApp>, email: string, name?: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/dev-login').send({ email, name });
  if (res.status !== 200) throw new Error(`dev-login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, user: res.body.user as { id: string; email: string; role: string } };
}

import { Dictation, DictationSet, DictationText } from '../models/index.js';

export const SAMPLE_TEXT =
  'Sir, I rise to draw the attention of the Honourable Minister to the rising prices. The Government should act now. Kindly inform the House.';

/** Creates a published set + dictation with a verified, active transcript. */
export async function createDictation(
  opts: { slug?: string; exerciseNo?: number; text?: string; published?: boolean; verified?: boolean; setTitle?: string } = {},
) {
  const slug = opts.slug ?? 'kc-24';
  const set =
    (await DictationSet.findOne({ slug })) ??
    (await DictationSet.create({ slug, title: opts.setTitle ?? 'Kailash Chandra Vol 24', published: true }));
  const text = opts.text ?? SAMPLE_TEXT;
  const verified = opts.verified ?? true;
  const dictation = await Dictation.create({
    setId: set._id,
    exerciseNo: opts.exerciseNo ?? 507,
    title: `Exercise ${opts.exerciseNo ?? 507}`,
    videos: [{ youtubeVideoId: 'abc123DEF45', baseWpm: 100, title: '100 WPM | Exercise 507' }],
    masterWordCount: text.split(/\s+/).length,
    activeTextVersion: verified ? 1 : null,
    published: opts.published ?? true,
  });
  await DictationText.create({
    dictationId: dictation._id,
    version: 1,
    masterText: text,
    reviewStatus: verified ? 'verified' : 'draft',
    source: 'book',
  });
  return { set, dictation, text };
}

/** A storage that keeps files in memory, so no network and no Cloudflare account are needed. `browserUpload` plays the part of the browser sending a file to its presigned address. */
export function fakeStorage() {
  const files = new Map<string, { body: Buffer; type: string }>();
  const storage: ObjectStorage = {
    async put(key, body, type) { files.set(key, { body, type }); },
    async remove(key) { files.delete(key); },
    async presignPut(key, type, seconds) { return `https://upload.test/${key}?type=${encodeURIComponent(type)}&expires=${seconds}`; },
    async head(key) { const f = files.get(key); return f ? { size: f.body.length } : null; },
    urlFor: (key) => `https://files.test/${key}`,
  };
  const browserUpload = (key: string, body: Buffer | string = '%PDF-1.4 test') => { files.set(key, { body: Buffer.from(body), type: 'application/pdf' }); };
  return { files, storage, browserUpload };
}
