/**
 * Loads a content pack (a set + its exercises with transcripts) into MongoDB.
 *
 *   npm run content:load                                  -> content/kailash-chandra-vol-24.json
 *   npm run content:load -- content/other-pack.json
 *   npm run content:load -- --no-verify                   -> keep transcripts as drafts
 *
 * Safe to run again: the set is upserted, unchanged transcripts are skipped, changed ones become a new version.
 * A dictation is published only when it has a verified transcript AND a video; add videos afterwards with the
 * Admin page ("Paste video links") or with `videos` inside the JSON file.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { z } from 'zod';
import { connectDb } from '../db/connect.js';
import { ensureIndexes } from '../db/indexes.js';
import { DictationSet } from '../models/index.js';
import { importDictations } from '../services/contentImport.js';

const pack = z.object({
  set: z.object({
    slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    title: z.string().min(1),
    description: z.string().optional(),
    source: z.string().optional(),
    youtubePlaylistId: z.string().optional(),
    order: z.number().int().optional(),
  }),
  items: z.array(
    z.object({
      exerciseNo: z.number().int(),
      title: z.string().optional(),
      videos: z.array(z.object({ youtubeVideoId: z.string().length(11), baseWpm: z.number().int(), title: z.string().optional() })).optional(),
      masterText: z.string().optional(),
      checkpoints: z.array(z.number().int()).optional(),
      tags: z.array(z.string()).optional(),
      source: z.enum(['book', 'asr', 'manual']).optional(),
    }),
  ),
});

async function main() {
  const args = process.argv.slice(2);
  const verify = !args.includes('--no-verify');
  const file = args.find((a) => !a.startsWith('--')) ?? 'content/kailash-chandra-vol-24.json';
  const data = pack.parse(JSON.parse(await readFile(path.resolve(file), 'utf8')));

  await connectDb();
  await ensureIndexes();

  const set = await DictationSet.findOneAndUpdate(
    { slug: data.set.slug },
    { $set: { ...data.set, published: true } },
    { upsert: true, returnDocument: 'after' },
  );
  console.log(`\nSet: ${set.title} (${set.slug})`);

  const results = await importDictations(set._id, data.items, { publish: true, verify });
  for (const r of results) {
    const note = r.warnings.length ? `  (${r.warnings.join('; ')})` : '';
    console.log(`  Exercise ${r.exerciseNo}: ${r.action}, transcript ${r.transcript}${r.version ? ` v${r.version}` : ''}, ${r.published ? 'PUBLISHED' : 'not published'}${note}`);
  }
  const published = results.filter((r) => r.published).length;
  console.log(`\nDone: ${results.length} exercises, ${published} published.`);
  if (published < results.length) console.log('Next: open the Admin page in the app and use "Paste video links" to attach the YouTube videos.');
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
