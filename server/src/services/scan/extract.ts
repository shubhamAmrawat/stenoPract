import { z } from 'zod';
import { env } from '../../config/env.js';
import { ApiError } from '../../middleware/errors.js';
import { diffWords, words } from './wordDiff.js';

/** What one reading of a page gives back. `text` carries [[100]]-style tokens where the book prints (100), (200) ... */
export interface Reading {
  exerciseNo: number | null;
  printedWordCount: number | null;
  /** True when both the "TRANSCRIPTION NO." heading and the "(840 words)" footer are on the image(s). */
  complete: boolean;
  text: string;
  uncertain: Uncertain[];
}

export type UncertainKind = 'illegible' | 'printing_error' | 'punctuation' | 'reads_differ' | 'other';

export interface Uncertain {
  /** The word or few words concerned, as read. */
  text: string;
  kind: UncertainKind;
  note: string;
  /** What the other reading (or the model) thinks it might be. */
  suggestion?: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

const TOOL_NAME = 'record_transcription';

const TOOL_SCHEMA = {
  type: 'object',
  properties: {
    exerciseNo: { type: ['integer', 'null'], description: 'The number in the "TRANSCRIPTION NO. n" heading, or null if the heading is not on the image (also null on the continuation page of an exercise, even if a running head such as "(back of 494)" shows a number).' },
    printedWordCount: { type: ['integer', 'null'], description: 'The number in the "(840 words)" footer, or null if the footer is not on the image.' },
    complete: { type: 'boolean', description: 'True only if both the heading and the words-count footer are visible, so the whole passage is on the image.' },
    text: { type: 'string', description: 'The passage exactly as printed, with [[100]], [[200]] ... where the book prints (100), (200) ... Paragraphs are separated by a blank line.' },
    uncertain: {
      type: 'array',
      description: 'Every place a careful reader should double-check against the page. Empty only if you are certain of every word.',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The word or short phrase concerned, as you wrote it in `text`.' },
          kind: { type: 'string', enum: ['illegible', 'printing_error', 'punctuation', 'other'] },
          note: { type: 'string', description: 'One short sentence: what is unclear or looks wrong.' },
          suggestion: { type: 'string', description: 'What it may say instead, if you have a guess.' },
        },
        required: ['text', 'kind', 'note'],
      },
    },
  },
  required: ['exerciseNo', 'printedWordCount', 'complete', 'text', 'uncertain'],
} as const;

const SYSTEM_PROMPT = `You transcribe scanned pages of a printed English shorthand-dictation book (SSC stenographer practice). An image is either a whole exercise (often a two-page spread) or ONE PAGE of an exercise that continues on the next page.

Layout: the printed English passage is headed "TRANSCRIPTION NO. n" and ends with a footer like "(840 words)". It is set in one or two text columns. Handwritten-looking shorthand outlines fill the margins or sit beside the text. IGNORE the shorthand completely. Also ignore underlining, circles and ink marks around words, bold emphasis, page numbers, running heads such as "Sir Kailash Chandra's SHORTHAND TRANSCRIPTIONS" and "(back of 494)", the small topic label beside the heading such as "(rural credit)", boxed remarks in the margin such as "What a pleasure of writing brewed in this passage!", the italic speech-attribution line above the heading (for example "Speech of hon. ... in the Lok Sabha on ..."), and any handwritten notes.

Copy the printed English EXACTLY as printed:
- Do not correct, modernise or "fix" anything: keep the book's spelling (British and American), punctuation, capital letters, hyphens, numerals, and any typo. If something looks like a printing mistake, keep it as printed and list it in \`uncertain\` with kind "printing_error" and your suggestion.
- The book prints a "/" mark inside lines every few words to show dictation pauses. Remove every "/" and join the words normally. Where a slash sits next to a comma or full stop and you cannot tell whether that mark is real punctuation or part of the slash, keep your best reading and list it with kind "punctuation".
- Join a word that is split across two lines by a hyphen at the line end ("self-" / "employment" becomes "self-employment") only when the hyphen is a line-break hyphen; keep real hyphens ("co-operation", "coal-mining").
- Replace each printed word-count marker such as (100), (200), ... (800) with [[100]], [[200]], ... [[800]] at exactly the place it is printed, with a space on each side. Do not include the "(840 words)" footer or the heading in \`text\`.
- Keep paragraph breaks as one blank line. In a two-column layout read the left column top to bottom, then the right column.
- Read every word. Never skip, summarise or invent text. If a word is hard to read, give your best reading and list it in \`uncertain\` with kind "illegible".

One page of a longer exercise: if the "TRANSCRIPTION NO." heading is on the image but the "(840 words)" footer is not, transcribe what is there, give the heading number and set printedWordCount to null and complete to false. If the footer is on the image but the heading is not (the page after), transcribe the whole page, set exerciseNo to null (a running head like "(back of 494)" is NOT the heading) and give the footer number as printedWordCount. Always answer by calling the ${TOOL_NAME} tool.`;

const responseSchema = z.object({
  content: z.array(z.object({ type: z.string(), name: z.string().optional(), input: z.unknown().optional() })),
  stop_reason: z.string().nullish(),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).partial().optional(),
});

const readingSchema = z.object({
  exerciseNo: z.number().int().nullable(),
  printedWordCount: z.number().int().nullable(),
  complete: z.boolean(),
  text: z.string(),
  uncertain: z
    .array(
      z.object({
        text: z.string(),
        kind: z.enum(['illegible', 'printing_error', 'punctuation', 'other']),
        note: z.string(),
        suggestion: z.string().optional(),
      }),
    )
    .default([]),
});

/** Puts a space on both sides of every [[100]] marker, whatever the model glued them to. */
const spaceMarkers = (text: string) => text.replace(/\s*\[\[(\d+)\]\]\s*/g, ' [[$1]] ');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One call to Claude: image in, structured reading out. Retries a couple of times on rate limits and overload. */
export async function readPage(image: Buffer, mediaType = 'image/jpeg'): Promise<{ reading: Reading; usage: Usage }> {
  if (!env.anthropic.apiKey) throw new ApiError(503, 'ANTHROPIC_API_KEY is not configured on the server', 'ANTHROPIC_NOT_CONFIGURED');

  const body = {
    model: env.anthropic.scanModel,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    tools: [{ name: TOOL_NAME, description: 'Record the transcription of the page.', input_schema: TOOL_SCHEMA }],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image.toString('base64') } },
          { type: 'text', text: 'Transcribe this page.' },
        ],
      },
    ],
  };

  let lastError = 'unknown error';
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${env.anthropic.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': env.anthropic.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'network error';
      await sleep(1500 * (attempt + 1));
      continue;
    }
    const raw: unknown = await res.json().catch(() => null);
    if (res.status === 429 || res.status === 529 || res.status >= 500) {
      lastError = `Claude API busy (${res.status})`;
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (!res.ok) {
      const message = (raw as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${res.status}`;
      throw new ApiError(502, `Claude API error: ${message}`, 'CLAUDE_ERROR');
    }
    const parsed = responseSchema.safeParse(raw);
    if (!parsed.success) throw new ApiError(502, 'Claude API returned an unexpected response', 'CLAUDE_ERROR');
    if (parsed.data.stop_reason === 'max_tokens') throw new ApiError(502, 'The page was too long for one reading. Try a smaller image.', 'CLAUDE_TOO_LONG');
    const block = parsed.data.content.find((c) => c.type === 'tool_use' && c.name === TOOL_NAME);
    const reading = readingSchema.safeParse(block?.input);
    if (!reading.success) throw new ApiError(502, 'Claude did not return a transcription for this page', 'CLAUDE_ERROR');
    return {
      reading: { ...reading.data, text: spaceMarkers(reading.data.text.replace(/\r/g, '')).replace(/[ \t]+\n/g, '\n').trim() },
      usage: { inputTokens: parsed.data.usage?.input_tokens ?? 0, outputTokens: parsed.data.usage?.output_tokens ?? 0 },
    };
  }
  throw new ApiError(502, `Claude API did not answer (${lastError}). Try again in a minute.`, 'CLAUDE_BUSY');
}

const MARKER = /^\[\[\d+\]\]$/;
/** Words of a reading without the [[100]] markers, for comparing two readings. */
const plainWords = (text: string) => words(text).filter((w) => !MARKER.test(w));

/** Where two readings disagree, as `uncertain` entries (the first reading's words, with the second's as the suggestion). */
export function disagreements(first: string, second: string): Uncertain[] {
  return diffWords(plainWords(first), plainWords(second)).map((s) => ({
    text: s.a.join(' ') || `(nothing before "${plainWords(first)[s.aIndex] ?? 'the end'}")`,
    kind: 'reads_differ' as const,
    note: 'Two readings of the page disagree here.',
    suggestion: s.b.join(' ') || '(nothing)',
  }));
}

const dedupe = (items: Uncertain[]) => {
  const seen = new Set<string>();
  return items.filter((u) => {
    const key = `${u.kind}|${u.text.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export interface PageResult {
  reading: Reading;
  usage: Usage;
  passes: number;
}

/** Reads a page once or twice (SCAN_PASSES). With two passes the first is kept and every disagreement is flagged for review. */
export async function extractPage(image: Buffer, passes: number = env.anthropic.scanPasses): Promise<PageResult> {
  const runs = await Promise.all(Array.from({ length: passes }, () => readPage(image)));
  const first = runs[0]!;
  let uncertain = [...first.reading.uncertain];
  let complete = first.reading.complete;
  if (runs.length > 1) {
    const second = runs[1]!;
    uncertain = [...uncertain, ...second.reading.uncertain, ...disagreements(first.reading.text, second.reading.text)];
    if (first.reading.exerciseNo !== second.reading.exerciseNo) {
      uncertain.push({
        text: `No. ${first.reading.exerciseNo ?? '?'} / ${second.reading.exerciseNo ?? '?'}`,
        kind: 'reads_differ',
        note: 'The two readings found different exercise numbers in the heading.',
      });
    }
    complete = complete && second.reading.complete;
  }
  return {
    reading: { ...first.reading, complete, uncertain: dedupe(uncertain) },
    usage: {
      inputTokens: runs.reduce((n, r) => n + r.usage.inputTokens, 0),
      outputTokens: runs.reduce((n, r) => n + r.usage.outputTokens, 0),
    },
    passes: runs.length,
  };
}

/** Turns [[100]] markers into the positions the app stores: the number of words before each marker. */
export function splitMarkers(input: string): { masterText: string; checkpoints: number[] } {
  const text = spaceMarkers(input);
  let count = 0;
  const checkpoints: number[] = [];
  const paragraphs = text.split(/\n{2,}/).map((p) => {
    const kept: string[] = [];
    for (const w of words(p)) {
      if (MARKER.test(w)) {
        if (count > 0) checkpoints.push(count);
      } else {
        kept.push(w);
        count++;
      }
    }
    return kept.join(' ');
  });
  return { masterText: paragraphs.filter(Boolean).join('\n\n'), checkpoints };
}
