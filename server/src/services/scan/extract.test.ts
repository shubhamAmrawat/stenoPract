import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env.js';
import { runChecks } from './checks.js';
import { disagreements, extractPage, readPage, splitMarkers, type Reading } from './extract.js';

const reading = (over: Partial<Reading> = {}): Reading => ({ exerciseNo: 485, printedWordCount: 840, complete: true, text: 'Sir, I thank you. [[100]] Next.', uncertain: [], ...over });
const okResponse = (input: unknown, usage = { input_tokens: 2800, output_tokens: 1500 }) => ({
  ok: true,
  status: 200,
  json: async () => ({ content: [{ type: 'tool_use', name: 'record_transcription', input }], stop_reason: 'tool_use', usage }),
});

beforeEach(() => {
  env.anthropic.apiKey = 'test-key';
});
afterEach(() => {
  vi.unstubAllGlobals();
  env.anthropic.apiKey = '';
});

describe('splitMarkers', () => {
  it('turns [[100]] markers into word positions and keeps paragraphs', () => {
    const r = splitMarkers('One two three.[[3]] Four five.\n\nSix [[100]] seven.');
    expect(r.masterText).toBe('One two three. Four five.\n\nSix seven.');
    expect(r.checkpoints).toEqual([3, 6]);
  });
  it('ignores a marker at the very start', () => {
    expect(splitMarkers('[[100]] a b').checkpoints).toEqual([]);
  });
});

describe('disagreements', () => {
  it('lists only the words that differ, ignoring markers', () => {
    expect(disagreements('the farmers are here [[100]] now', 'the farmer are here now')).toEqual([
      { text: 'farmers', kind: 'reads_differ', note: 'Two readings of the page disagree here.', suggestion: 'farmer' },
    ]);
  });
});

describe('readPage', () => {
  it('sends the image with a forced tool call and returns the reading and token usage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ exerciseNo: 485, printedWordCount: 840, complete: true, text: 'Hello.[[100]]World', uncertain: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await readPage(Buffer.from('jpegbytes'));
    expect(out.reading.text).toBe('Hello. [[100]] World');
    expect(out.usage).toEqual({ inputTokens: 2800, outputTokens: 1500 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('test-key');
    const body = JSON.parse(init.body as string);
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'record_transcription' });
    expect(body.messages[0].content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from('jpegbytes').toString('base64') } });
  });

  it('reports an API error message, and asks for a key when none is set', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { message: 'model: not found' } }) }));
    await expect(readPage(Buffer.from('x'))).rejects.toMatchObject({ status: 502, message: 'Claude API error: model: not found' });
    env.anthropic.apiKey = '';
    await expect(readPage(Buffer.from('x'))).rejects.toMatchObject({ status: 503, code: 'ANTHROPIC_NOT_CONFIGURED' });
  });

  it('retries once when the API is busy', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 529, json: async () => ({}) })
      .mockResolvedValueOnce(okResponse({ exerciseNo: 1, printedWordCount: null, complete: false, text: 'a', uncertain: [] }));
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
    const p = readPage(Buffer.from('x'));
    await vi.advanceTimersByTimeAsync(2500);
    await expect(p).resolves.toBeTruthy();
    vi.useRealTimers();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('extractPage (two readings)', () => {
  it('keeps the first reading, flags every disagreement, and adds up the tokens', async () => {
    const a = { exerciseNo: 485, printedWordCount: 840, complete: true, text: 'the farmers are here', uncertain: [{ text: 'farmers', kind: 'printing_error', note: 'smudged' }] };
    const b = { ...a, text: 'the farmer are here', uncertain: [] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(okResponse(a)).mockResolvedValueOnce(okResponse(b)));
    const out = await extractPage(Buffer.from('x'), 2);
    expect(out.reading.text).toBe('the farmers are here');
    expect(out.reading.uncertain.map((u) => u.kind).sort()).toEqual(['printing_error', 'reads_differ']);
    expect(out.usage).toEqual({ inputTokens: 5600, outputTokens: 3000 });
    expect(out.passes).toBe(2);
  });

  it('flags different exercise numbers', async () => {
    const base = { printedWordCount: 840, complete: true, text: 'a b', uncertain: [] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(okResponse({ ...base, exerciseNo: 485 })).mockResolvedValueOnce(okResponse({ ...base, exerciseNo: 486 })));
    const out = await extractPage(Buffer.from('x'), 2);
    expect(out.reading.uncertain.some((u) => u.kind === 'reads_differ' && u.note.includes('exercise numbers'))).toBe(true);
  });
});

describe('runChecks', () => {
  const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');
  const good = { masterText: words(830), checkpoints: [98, 197, 296, 395, 494, 593, 692, 791] };

  it('is green when everything lines up', () => {
    const c = runChecks(reading({ printedWordCount: 840 }), good.masterText, good.checkpoints, 2);
    expect(c).toMatchObject({ green: true, markers: { found: 8, expected: 8, ok: true }, wordCount: { words: 830, printed: 840, ok: true }, spelling: { ok: true } });
  });

  it('is not green when a marker is missing, the count is off, a word is unknown, or anything was flagged', () => {
    expect(runChecks(reading(), good.masterText, good.checkpoints.slice(0, 7), 2).green).toBe(false);
    expect(runChecks(reading(), words(700), good.checkpoints, 2).wordCount.ok).toBe(false);
    expect(runChecks(reading(), `${words(829)} qwzxv`, good.checkpoints, 2).spelling.unknown).toEqual(['qwzxv']);
    expect(runChecks(reading({ uncertain: [{ text: 'x', kind: 'illegible', note: 'n' }] }), good.masterText, good.checkpoints, 2).green).toBe(false);
    expect(runChecks(reading({ complete: false }), good.masterText, good.checkpoints, 2).green).toBe(false);
    expect(runChecks(reading({ exerciseNo: null }), good.masterText, good.checkpoints, 2).green).toBe(false);
  });

  it('accepts names, Indian units and hyphenated words, but not a misspelling', () => {
    const c = runChecks(reading(), 'Shri Narasimha Rao gave Rs. 90 crores, 6 lakhs and co-operation. The farmres asked.', [], 1);
    expect(c.spelling.unknown).toEqual(['farmres']);
  });
});

describe('spelling of plural possessives', () => {
  it("does not flag farmers' or the book's own compounds", () => {
    const c = runChecks(reading(), "the farmers' sentiments, single-handedly, foodgrains and quintal", [], 1);
    expect(c.spelling.unknown).toEqual([]);
  });
});
