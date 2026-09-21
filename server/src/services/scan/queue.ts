import { Types, type HydratedDocument } from 'mongoose';
import { countWords } from '../../evaluator/index.js';
import { logger } from '../../config/logger.js';
import { Dictation, DictationText, TranscriptScan } from '../../models/index.js';
import type { TranscriptScanDoc } from '../../models/TranscriptScan.js';
import { importDictations } from '../contentImport.js';
import { runChecks } from './checks.js';
import { extractPage, splitMarkers, type Reading, type Usage } from './extract.js';
import { diffWords, words } from './wordDiff.js';

const CONCURRENCY = 2;
const queue: string[] = [];
let active = 0;

const message = (err: unknown) => (err instanceof Error ? err.message : 'Unknown error');

type ScanDoc = HydratedDocument<TranscriptScanDoc>;

const NO_HEADING = 'Could not find the "TRANSCRIPTION NO." heading on this page. Is it a whole exercise page?';
const ORPHAN =
  'This looks like the second half of an exercise (there is no "TRANSCRIPTION NO." heading), but the page before it is not the start of one. Upload the whole PDF so the pages stay together.';

/** Files a finished reading of one exercise (a whole page, or several pages joined): a draft transcript or "identical to live", plus the checks. */
async function fileResult(scan: ScanDoc, reading: Reading, usage: Usage, passes: number): Promise<void> {
  const { masterText, checkpoints } = splitMarkers(reading.text);
  const checks = runChecks(reading, masterText, checkpoints, passes);

  scan.set('reading', { text: reading.text, printedWordCount: reading.printedWordCount, complete: reading.complete, uncertain: reading.uncertain });
  scan.set('checks', checks);
  scan.set('usage', { ...usage, passes });

  if (reading.exerciseNo === null || masterText.length === 0) {
    scan.status = 'failed';
    scan.outcome = 'none';
    scan.error = NO_HEADING;
    await scan.save();
    return;
  }

  scan.exerciseNo = reading.exerciseNo;
  const [result] = await importDictations(scan.setId, [{ exerciseNo: reading.exerciseNo, masterText, checkpoints, source: 'book' }], {
    publish: false,
    verify: false,
    createdBy: scan.createdBy ?? undefined,
  });
  const dictation = await Dictation.findById(result!.dictationId, { activeTextVersion: 1 }).lean();
  scan.dictationId = new Types.ObjectId(result!.dictationId);

  // Compare with the transcript that is live now: on an exercise you already verified this measures the reader's accuracy.
  const live = dictation?.activeTextVersion != null ? await DictationText.findOne({ dictationId: result!.dictationId, version: dictation.activeTextVersion }).lean() : null;
  if (live) {
    const spans = diffWords(words(live.masterText), words(masterText));
    scan.set('compare', {
      liveVersion: live.version,
      liveWords: countWords(live.masterText),
      differences: spans.slice(0, 60).map((s) => ({ index: s.aIndex, live: s.a.join(' '), scan: s.b.join(' ') })),
      differenceCount: spans.length,
    });
  }

  if (result!.transcript === 'new_version') {
    const draft = await DictationText.findOne({ dictationId: result!.dictationId }, { _id: 1 }).sort({ version: -1 }).lean();
    scan.textId = draft?._id;
    scan.outcome = 'draft';
  } else {
    scan.outcome = 'identical';
  }
  scan.status = 'done';
  await scan.save();
}

/** Reads one scanned page and files the result. A page that is only half an exercise waits for its neighbour (see `settle`). */
export async function processScan(id: string): Promise<void> {
  const scan = await TranscriptScan.findById(id);
  if (!scan || !scan.image) return;
  scan.status = 'running';
  scan.error = undefined;
  scan.set('part', undefined);
  scan.set('joinedInto', undefined);
  await scan.save();

  try {
    const { reading, usage, passes } = await extractPage(scan.image);

    if (reading.text.trim().length === 0) {
      scan.set('reading', { text: '', printedWordCount: reading.printedWordCount, complete: reading.complete, uncertain: reading.uncertain });
      scan.status = 'failed';
      scan.outcome = 'none';
      scan.error = 'No text could be read on this page. Is it a page with a dictation passage?';
      await scan.save();
      return;
    }

    if (reading.exerciseNo !== null && reading.complete) {
      scan.part = 'whole';
      await fileResult(scan, reading, usage, passes);
      return;
    }

    // Half an exercise: keep the reading and wait until the neighbouring page is read, then file both together.
    scan.part = reading.exerciseNo === null ? 'continuation' : 'start';
    if (reading.exerciseNo !== null) scan.exerciseNo = reading.exerciseNo;
    scan.set('reading', { text: reading.text, printedWordCount: reading.printedWordCount, complete: reading.complete, uncertain: reading.uncertain, exerciseNo: reading.exerciseNo });
    scan.set('usage', { ...usage, passes });
    scan.status = 'waiting';
    await scan.save();
    await settle(id);
  } catch (err) {
    logger.warn({ err, scanId: id }, 'scan failed');
    scan.status = 'failed';
    scan.error = message(err);
    await scan.save();
  }
}

interface StoredReading {
  text: string;
  printedWordCount: number | null;
  complete: boolean;
  uncertain: Reading['uncertain'];
  exerciseNo?: number | null;
}
interface StoredUsage {
  inputTokens: number;
  outputTokens: number;
  passes: number;
}

/** Puts page B after page A: a paragraph break after a finished sentence or a marker, a plain space when a sentence runs over. */
export function joinPages(a: string, b: string): string {
  const left = a.trim();
  const right = b.trim();
  if (!left) return right;
  if (!right) return left;
  return `${left}${/(?:[.!?:;]["'”’)]?|\]\])$/.test(left) ? '\n\n' : ' '}${right}`;
}

/**
 * Joins pages that hold one exercise. A page with the heading but no footer is a "start"; the pages after it that have no heading are
 * its "continuation" (usually one). When the whole chain has been read it is filed as one exercise on the first page's scan.
 * Safe to call any number of times, from either page: it does nothing until every page of the chain is read.
 * `force` files what is there even if the next page never arrived (used after an admin discards it).
 */
export async function settle(id: string, force = false): Promise<void> {
  const scan = await TranscriptScan.findById(id, { image: 0 });
  if (!scan || scan.status !== 'waiting') return;
  const at = (n: number) => TranscriptScan.findOne({ setId: scan.setId, uploadId: scan.uploadId, pageNo: n }, { image: 0 });

  // 1. walk back to the first page of the exercise
  let head = scan;
  while (head.part === 'continuation') {
    const prev = head.uploadId ? await at((head.pageNo ?? 1) - 1) : null;
    if (!prev) return orphan(head);
    if (prev.status === 'queued' || prev.status === 'running' || prev.status === 'failed') return; // it will settle again when it is read
    if (prev.status === 'waiting' && (prev.part === 'start' || prev.part === 'continuation')) {
      head = prev;
      continue;
    }
    return orphan(head);
  }
  if (head.part !== 'start') return;

  // 2. walk forward over the pages that continue it
  const chain = [head];
  let last = head;
  while ((last.reading as StoredReading | null)?.printedWordCount == null) {
    const next = last.uploadId ? await at((last.pageNo ?? 1) + 1) : null;
    if (!next) {
      if (!force && last.uploadId && (last.pageNo ?? 1) < (last.pages ?? 1)) return; // the next page is still being uploaded
      break;
    }
    if (next.status === 'queued' || next.status === 'running') return;
    if (next.status === 'failed') {
      if (!force) return;
      break;
    }
    if (next.part === 'continuation' && next.status === 'waiting') {
      chain.push(next);
      last = next;
      continue;
    }
    break;
  }

  // 3. one caller wins the right to file it
  const claimed = await TranscriptScan.findOneAndUpdate({ _id: head._id, status: 'waiting' }, { $set: { status: 'running' } }, { returnDocument: 'after' });
  if (!claimed) return;
  try {
    const readings = chain.map((s) => s.reading as StoredReading);
    const printed = [...readings].reverse().find((r) => r.printedWordCount != null)?.printedWordCount ?? null;
    const combined: Reading = {
      exerciseNo: readings[0]!.exerciseNo ?? head.exerciseNo ?? null,
      printedWordCount: printed,
      complete: printed !== null,
      text: readings.map((r) => r.text).reduce((acc, t) => joinPages(acc, t), ''),
      uncertain: readings.flatMap((r) => r.uncertain ?? []),
    };
    const usages = chain.map((s) => s.usage as StoredUsage | null);
    const usage: Usage = { inputTokens: usages.reduce((n, u) => n + (u?.inputTokens ?? 0), 0), outputTokens: usages.reduce((n, u) => n + (u?.outputTokens ?? 0), 0) };
    const passes = Math.max(...usages.map((u) => u?.passes ?? 1));

    // Mark the later pages as joined first, so a page finishing at this moment cannot mistake the exercise for an orphan.
    const rest = chain.slice(1).map((s) => s._id);
    if (rest.length) {
      await TranscriptScan.updateMany({ _id: { $in: rest } }, { $set: { status: 'done', joinedInto: head._id, exerciseNo: combined.exerciseNo, outcome: 'none' }, $unset: { error: 1 } });
    }
    await fileResult(claimed, combined, usage, passes);
  } catch (err) {
    logger.warn({ err, scanId: String(head._id) }, 'joining pages failed');
    claimed.status = 'failed';
    claimed.error = message(err);
    await claimed.save();
  }
}

async function orphan(scan: ScanDoc): Promise<void> {
  scan.status = 'failed';
  scan.outcome = 'none';
  scan.error = scan.uploadId && (scan.pageNo ?? 1) > 1 ? ORPHAN : NO_HEADING;
  await scan.save();
}

function pump(): void {
  while (active < CONCURRENCY && queue.length > 0) {
    const id = queue.shift()!;
    active++;
    processScan(id)
      .catch((err: unknown) => logger.error({ err, scanId: id }, 'scan worker crashed'))
      .finally(() => {
        active--;
        pump();
      });
  }
}

export function enqueueScan(id: string): void {
  if (!queue.includes(id)) queue.push(id);
  pump();
}

/** After a restart, pages that were waiting or half-read are put back in the queue (their images are stored). */
export async function resumePendingScans(): Promise<void> {
  const pending = await TranscriptScan.find({ status: { $in: ['queued', 'running'] } }, { _id: 1 }).sort({ createdAt: 1 }).lean();
  for (const s of pending) enqueueScan(String(s._id));
  if (pending.length) logger.info(`Resumed ${pending.length} scanned page(s)`);
  // Pages that were waiting for their neighbour when the server stopped: join them if the neighbour has been read since.
  const waiting = await TranscriptScan.find({ status: 'waiting' }, { _id: 1 }).lean();
  for (const s of waiting) await settle(String(s._id)).catch((err: unknown) => logger.error({ err }, 'settle failed'));
}
