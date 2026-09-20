import { Types } from 'mongoose';
import { countWords } from '../evaluator/index.js';
import { Dictation, DictationText } from '../models/index.js';
import { parseVideoTitle } from './youtube.js';

export interface ImportVideo {
  youtubeVideoId: string;
  baseWpm: number;
  title?: string;
}

export interface ImportItem {
  exerciseNo: number;
  title?: string;
  videos?: ImportVideo[];
  masterText?: string;
  checkpoints?: number[];
  tags?: string[];
  source?: 'book' | 'asr' | 'manual';
}

export interface ImportOptions {
  /** Publish dictations that end up with a verified transcript and at least one video. */
  publish: boolean;
  /** Mark a newly added transcript version as verified (= live for students). */
  verify: boolean;
  createdBy?: Types.ObjectId | string;
}

export interface ImportResult {
  exerciseNo: number;
  dictationId: string;
  action: 'created' | 'updated';
  transcript: 'none' | 'unchanged' | 'new_version';
  version: number | null;
  published: boolean;
  warnings: string[];
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Creates or updates dictations of one set: merges videos, adds a transcript version, verifies and publishes. */
export async function importDictations(setId: Types.ObjectId | string, items: ImportItem[], opts: ImportOptions): Promise<ImportResult[]> {
  const results: ImportResult[] = [];

  for (const item of items) {
    const warnings: string[] = [];
    let dictation = await Dictation.findOne({ setId, exerciseNo: item.exerciseNo });
    const action: ImportResult['action'] = dictation ? 'updated' : 'created';
    if (!dictation) {
      dictation = new Dictation({ setId, exerciseNo: item.exerciseNo, title: item.title ?? `Exercise ${item.exerciseNo}`, videos: [], tags: item.tags ?? [] });
    } else {
      if (item.title) dictation.title = item.title;
      if (item.tags) dictation.set('tags', item.tags);
    }

    // videos: same video id or same speed replaces, otherwise appended
    if (item.videos?.length) {
      const next: ImportVideo[] = dictation.videos.map((v) => ({ youtubeVideoId: v.youtubeVideoId, baseWpm: v.baseWpm, title: v.title ?? undefined }));
      for (const v of item.videos) {
        const i = next.findIndex((x) => x.youtubeVideoId === v.youtubeVideoId || x.baseWpm === v.baseWpm);
        if (i >= 0) next[i] = v;
        else next.push(v);
      }
      next.sort((a, b) => a.baseWpm - b.baseWpm);
      dictation.set('videos', next);
    }
    await dictation.save();

    // transcript
    let transcript: ImportResult['transcript'] = 'none';
    if (item.masterText?.trim()) {
      const text = item.masterText.trim();
      const active =
        dictation.activeTextVersion != null ? await DictationText.findOne({ dictationId: dictation._id, version: dictation.activeTextVersion }).lean() : null;
      if (active && squash(active.masterText) === squash(text)) {
        transcript = 'unchanged';
      } else {
        const n = countWords(text);
        let checkpoints = item.checkpoints ?? [];
        if (checkpoints.some((c) => c > n)) {
          warnings.push(`Some 100-word checkpoints are beyond the end of the text (${n} words) and were dropped`);
          checkpoints = checkpoints.filter((c) => c <= n);
        }
        const last = await DictationText.findOne({ dictationId: dictation._id }, { version: 1 }).sort({ version: -1 }).lean();
        const created = await DictationText.create({
          dictationId: dictation._id,
          version: (last?.version ?? 0) + 1,
          masterText: text,
          checkpoints,
          source: item.source ?? 'book',
          reviewStatus: opts.verify ? 'verified' : 'draft',
          createdBy: opts.createdBy,
        });
        transcript = 'new_version';
        if (opts.verify) {
          dictation.activeTextVersion = created.version;
          dictation.masterWordCount = n;
          await dictation.save();
        }
      }
    }

    // publish
    if (opts.publish) {
      if (dictation.activeTextVersion == null) warnings.push('Not published: no verified transcript yet');
      else if (dictation.videos.length === 0) warnings.push('Not published: no video attached yet');
      else if (!dictation.published) {
        dictation.published = true;
        await dictation.save();
      }
    }

    results.push({
      exerciseNo: item.exerciseNo,
      dictationId: String(dictation._id),
      action,
      transcript,
      version: dictation.activeTextVersion ?? null,
      published: dictation.published,
      warnings,
    });
  }
  return results;
}

// ---------- pasted video links ----------

const VIDEO_ID = /(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/;

export interface ParsedLinks {
  items: ImportItem[];
  skipped: { line: string; reason: string }[];
}

/**
 * Reads pasted video lines. Two shapes work (one video per line):
 *   "100 WPM | Exercise 507 | Kailash Chandra Vol 24 <TAB> https://www.youtube.com/watch?v=XXXXXXXXXXX"
 *   "507 100 https://youtu.be/XXXXXXXXXXX"   (exercise number, speed, link)
 */
export function parseVideoLinks(text: string): ParsedLinks {
  const items = new Map<number, ImportItem>();
  const skipped: ParsedLinks['skipped'] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const id = line.match(VIDEO_ID)?.[1];
    if (!id) {
      skipped.push({ line, reason: 'No YouTube video link found' });
      continue;
    }
    const rest = line.replace(/https?:\/\/\S+/g, ' ').trim();
    let exerciseNo: number | undefined;
    let baseWpm: number | undefined;
    const fromTitle = parseVideoTitle(rest);
    if (fromTitle?.baseWpm) {
      exerciseNo = fromTitle.exerciseNo;
      baseWpm = fromTitle.baseWpm;
    } else {
      const m = rest.match(/^(?:ex(?:ercise)?\.?\s*(?:no\.?)?\s*)?(\d{1,5})[\s,|:-]+(\d{2,3})\s*(?:wpm)?$/i);
      if (m) {
        exerciseNo = Number(m[1]);
        baseWpm = Number(m[2]);
      }
    }
    if (exerciseNo === undefined || baseWpm === undefined || baseWpm < 40 || baseWpm > 200) {
      skipped.push({ line, reason: 'Could not read the exercise number and speed (expected "100 WPM | Exercise 507" or "507 100 <link>")' });
      continue;
    }
    const item = items.get(exerciseNo) ?? { exerciseNo, videos: [] };
    item.videos!.push({ youtubeVideoId: id, baseWpm, title: rest.length > 0 ? rest.slice(0, 200) : undefined });
    items.set(exerciseNo, item);
  }
  return { items: [...items.values()], skipped };
}
