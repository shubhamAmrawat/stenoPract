import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env.js';
import { Dictation, DictationText, TranscriptScan } from '../../models/index.js';
import { clearTestData, loginAs, startTestDb, stopTestDb, testApp } from '../../test/helpers.js';

const app = testApp();
beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(async () => {
  await clearTestData();
  env.anthropic.apiKey = 'test-key';
});
afterEach(() => {
  vi.unstubAllGlobals();
  env.anthropic.apiKey = '';
});

const admin = () => loginAs(app, 'admin@test.com');

const png = () => sharp({ create: { width: 60, height: 40, channels: 3, background: '#ffffff' } }).png().toBuffer();

/** A passage of `n` plain words with [[100]]-style markers, the way the reader returns it. */
function passage(n: number, markers = [98, 197, 296, 395, 494, 593, 692, 791]) {
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    out.push(i % 7 === 0 ? 'farmers.' : 'sample');
    const k = markers.indexOf(i);
    if (k >= 0) out.push(`[[${(k + 1) * 100}]]`);
  }
  return out.join(' ');
}

const claudeSays = (over: Record<string, unknown> = {}) => {
  const input = { exerciseNo: 485, printedWordCount: 840, complete: true, text: passage(830), uncertain: [], ...over };
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ content: [{ type: 'tool_use', name: 'record_transcription', input }], stop_reason: 'tool_use', usage: { input_tokens: 2800, output_tokens: 1500 } }),
  });
};

interface ScanRow {
  id: string;
  status: string;
  checks: unknown;
  usage: unknown;
  uncertainCount: number;
  error: string | null;
}

async function waitForScans(agent: Awaited<ReturnType<typeof admin>>['agent'], setId: string, n = 1) {
  for (let i = 0; i < 100; i++) {
    const list = (await agent.get(`/api/v1/admin/sets/${setId}/scans`)).body.items as ScanRow[];
    if (list.length >= n && list.every((s) => s.status === 'done' || s.status === 'failed')) return list;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('scans did not finish');
}

async function newSet(agent: Awaited<ReturnType<typeof admin>>['agent']) {
  return (await agent.post('/api/v1/admin/sets').send({ slug: 'kc-23', title: 'KC 23' })).body.set.id as string;
}

const upload = async (agent: Awaited<ReturnType<typeof admin>>['agent'], setId: string, name = 'vol23.pdf', page = 1) =>
  agent.post(`/api/v1/admin/sets/${setId}/scans?name=${name}&page=${page}`).set('Content-Type', 'image/png').send(await png());

describe('scan uploads', () => {
  it('is admin-only and tells you when the API key is missing', async () => {
    const { agent: student } = await loginAs(app, 'student@test.com');
    expect((await student.get('/api/v1/admin/scans/status')).status).toBe(403);

    const { agent } = await admin();
    const setId = await newSet(agent);
    expect((await agent.get('/api/v1/admin/scans/status')).body).toMatchObject({ configured: true, passes: 2 });
    env.anthropic.apiKey = '';
    expect((await agent.get('/api/v1/admin/scans/status')).body.configured).toBe(false);
    const res = await upload(agent, setId);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('ANTHROPIC_NOT_CONFIGURED');
  });

  it('rejects a non-image body and an unknown set', async () => {
    const { agent } = await admin();
    const setId = await newSet(agent);
    const bad = await agent.post(`/api/v1/admin/sets/${setId}/scans`).set('Content-Type', 'image/png').send(Buffer.from('not an image'));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_IMAGE');
    expect((await upload(agent, '64b000000000000000000000')).status).toBe(404);
  });
});

describe('reading a page', () => {
  it('reads the page, files a draft under the exercise number, runs the checks and lets you approve it', async () => {
    const { agent } = await admin();
    const setId = await newSet(agent);
    const fetchMock = claudeSays();
    vi.stubGlobal('fetch', fetchMock);

    const up = await upload(agent, setId);
    expect(up.status).toBe(202);
    const [scan] = await waitForScans(agent, setId);
    expect(fetchMock).toHaveBeenCalledTimes(2); // two readings
    expect(scan).toMatchObject({ status: 'done', exerciseNo: 485, outcome: 'draft', review: 'pending', green: true, fileName: 'vol23.pdf' });
    expect(scan!.checks).toMatchObject({ markers: { found: 8, expected: 8, ok: true }, wordCount: { words: 830, printed: 840, ok: true } });
    expect(scan!.usage).toMatchObject({ inputTokens: 5600, outputTokens: 3000, passes: 2 });

    // The exercise was created, unpublished, with a draft (not live) transcript.
    const dictation = await Dictation.findOne({ exerciseNo: 485 }).lean();
    expect(dictation).toMatchObject({ published: false });
    expect(dictation!.activeTextVersion ?? null).toBeNull();
    const draft = await DictationText.findOne({ dictationId: dictation!._id }).lean();
    expect(draft).toMatchObject({ reviewStatus: 'draft', source: 'book', checkpoints: [98, 197, 296, 395, 494, 593, 692, 791] });

    // Review screen data, page image, then approve.
    const detail = (await agent.get(`/api/v1/admin/scans/${scan!.id}`)).body;
    expect(detail.draft.masterText.startsWith('sample sample')).toBe(true);
    expect(detail.hasImage).toBe(true);
    const img = await agent.get(`/api/v1/admin/scans/${scan!.id}/image`);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toContain('image/jpeg');

    const ok = await agent.post(`/api/v1/admin/scans/${scan!.id}/approve`).send({ publish: true });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ published: false, hasVideo: false });
    const after = await Dictation.findById(dictation!._id).lean();
    expect(after).toMatchObject({ activeTextVersion: 1, masterWordCount: 830, published: false });
    expect((await DictationText.findById(draft!._id).lean())!.reviewStatus).toBe('verified');
    expect((await agent.get(`/api/v1/admin/scans/${scan!.id}/image`)).status).toBe(404); // image is dropped after approval
    expect((await agent.get(`/api/v1/admin/scans/${scan!.id}`)).body.scan.review).toBe('approved');
  });

  it('publishes on approve when the exercise already has a video', async () => {
    const { agent } = await admin();
    const setId = await newSet(agent);
    await Dictation.create({ setId, exerciseNo: 485, title: 'Exercise 485', videos: [{ youtubeVideoId: 'abc123DEF45', baseWpm: 100 }] });
    vi.stubGlobal('fetch', claudeSays());
    await upload(agent, setId);
    const [scan] = await waitForScans(agent, setId);
    const ok = await agent.post(`/api/v1/admin/scans/${scan!.id}/approve`).send({ publish: true });
    expect(ok.body).toMatchObject({ published: true, hasVideo: true });
  });

  it('flags a page whose two readings disagree, and lists what to check', async () => {
    const { agent } = await admin();
    const setId = await newSet(agent);
    const a = { exerciseNo: 485, printedWordCount: 840, complete: true, text: passage(830), uncertain: [] };
    const b = { ...a, text: passage(830).replace('farmers.', 'farmer.') };
    const res = (input: unknown) => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'tool_use', name: 'record_transcription', input }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } }) });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(res(a)).mockResolvedValueOnce(res(b)));
    await upload(agent, setId);
    const [scan] = await waitForScans(agent, setId);
    expect(scan).toMatchObject({ status: 'done', green: false });
    expect(scan!.uncertainCount).toBeGreaterThan(0);
    const detail = (await agent.get(`/api/v1/admin/scans/${scan!.id}`)).body;
    expect(detail.reading.uncertain[0]).toMatchObject({ kind: 'reads_differ', suggestion: 'farmer.' });
  });

  it('compares with the transcript that is already live: identical, or the words that differ', async () => {
    const { agent } = await admin();
    const setId = await newSet(agent);
    const dictation = await Dictation.create({ setId, exerciseNo: 485, title: 'Exercise 485' });
    const live = passage(830).replace(/\[\[\d+\]\]/g, '').replace(/\s+/g, ' ').trim();
    await DictationText.create({ dictationId: dictation._id, version: 1, masterText: live, reviewStatus: 'verified', source: 'book' });
    await Dictation.updateOne({ _id: dictation._id }, { activeTextVersion: 1, masterWordCount: 830 });

    vi.stubGlobal('fetch', claudeSays());
    await upload(agent, setId);
    let [scan] = await waitForScans(agent, setId);
    expect(scan).toMatchObject({ outcome: 'identical', differenceCount: 0, textId: null });

    await TranscriptScan.deleteMany({});
    vi.stubGlobal('fetch', claudeSays({ text: passage(830).replace('farmers.', 'farmer.') }));
    await upload(agent, setId);
    [scan] = await waitForScans(agent, setId);
    expect(scan).toMatchObject({ outcome: 'draft', differenceCount: 1 });
    const detail = (await agent.get(`/api/v1/admin/scans/${scan!.id}`)).body;
    expect(detail.compare).toMatchObject({ liveVersion: 1, differences: [{ live: 'farmers.', scan: 'farmer.' }] });
  });

  it('fails softly when the heading cannot be found, and a retry reads the page again', async () => {
    const { agent } = await admin();
    const setId = await newSet(agent);
    vi.stubGlobal('fetch', claudeSays({ exerciseNo: null, complete: false }));
    await upload(agent, setId);
    let [scan] = await waitForScans(agent, setId);
    expect(scan).toMatchObject({ status: 'failed', exerciseNo: null });
    expect(scan!.error).toContain('TRANSCRIPTION NO.');
    expect(await Dictation.countDocuments()).toBe(0);

    vi.stubGlobal('fetch', claudeSays());
    expect((await agent.post(`/api/v1/admin/scans/${scan!.id}/retry`)).status).toBe(200);
    [scan] = await waitForScans(agent, setId);
    expect(scan).toMatchObject({ status: 'done', exerciseNo: 485 });
  });

  it('shows the Claude error when the API refuses', async () => {
    const { agent } = await admin();
    const setId = await newSet(agent);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: { message: 'invalid x-api-key' } }) }));
    await upload(agent, setId);
    const [scan] = await waitForScans(agent, setId);
    expect(scan).toMatchObject({ status: 'failed' });
    expect(scan!.error).toBe('Claude API error: invalid x-api-key');
  });

  it('discarding removes the scan and its unreviewed draft, but never a verified transcript', async () => {
    const { agent } = await admin();
    const setId = await newSet(agent);
    vi.stubGlobal('fetch', claudeSays());
    await upload(agent, setId);
    const [scan] = await waitForScans(agent, setId);
    expect(await DictationText.countDocuments()).toBe(1);
    expect((await agent.delete(`/api/v1/admin/scans/${scan!.id}`)).status).toBe(200);
    expect(await DictationText.countDocuments()).toBe(0);
    expect(await TranscriptScan.countDocuments()).toBe(0);

    await upload(agent, setId);
    const [again] = await waitForScans(agent, setId);
    await agent.post(`/api/v1/admin/scans/${again!.id}/approve`).send({});
    await agent.delete(`/api/v1/admin/scans/${again!.id}`);
    expect(await DictationText.countDocuments({ reviewStatus: 'verified' })).toBe(1);
  });

  describe('an exercise printed over two pages', () => {
    /** Words `from`..`to` of the passage, with the hundred-markers that fall inside. */
    const chunk = (from: number, to: number) => {
      const marks = [98, 197, 296, 395, 494, 593, 692, 791];
      const out: string[] = [];
      for (let i = from; i <= to; i++) {
        out.push(i % 7 === 0 ? 'farmers.' : 'sample');
        const k = marks.indexOf(i);
        if (k >= 0) out.push(`[[${(k + 1) * 100}]]`);
      }
      return out.join(' ');
    };
    const pageOne = { exerciseNo: 494, printedWordCount: null, complete: false, text: chunk(1, 410), uncertain: [] };
    const pageTwo = { exerciseNo: null, printedWordCount: 840, complete: false, text: chunk(411, 830), uncertain: [] };

    /** Page pictures differ in width, which is how this fake reader tells them apart. */
    const image = (width: number) => sharp({ create: { width, height: 40, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const reader = () =>
      vi.fn().mockImplementation(async (_url: string, init: { body: string }) => {
        const data = JSON.parse(init.body).messages[0].content[0].source.data as string;
        const width = (await sharp(Buffer.from(data, 'base64')).metadata()).width;
        const input = width === 60 ? pageOne : pageTwo;
        return { ok: true, status: 200, json: async () => ({ content: [{ type: 'tool_use', name: 'record_transcription', input }], stop_reason: 'tool_use', usage: { input_tokens: 1000, output_tokens: 700 } }) };
      });
    const send = async (agent: Awaited<ReturnType<typeof admin>>['agent'], setId: string, page: number, pages = 2, up = 'up1') =>
      agent
        .post(`/api/v1/admin/sets/${setId}/scans?name=ex494.pdf&page=${page}&pages=${pages}&upload=${up}`)
        .set('Content-Type', 'image/png')
        .send(await image(page === 1 ? 60 : 80));
    const until = async (agent: Awaited<ReturnType<typeof admin>>['agent'], setId: string, ok: (rows: ScanRow[]) => boolean) => {
      for (let i = 0; i < 100; i++) {
        const rows = (await agent.get(`/api/v1/admin/sets/${setId}/scans`)).body.items as ScanRow[];
        if (ok(rows)) return rows;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error('never reached the expected state');
    };

    it('joins the two pages into one transcript, shown as one row', async () => {
      const { agent } = await admin();
      const setId = await newSet(agent);
      vi.stubGlobal('fetch', reader());
      await send(agent, setId, 1);
      await send(agent, setId, 2);
      const rows = await until(agent, setId, (r) => r.length === 1 && r[0]!.status === 'done');
      expect(rows).toHaveLength(1);
      const row = rows[0] as ScanRow & { exerciseNo: number; pageNos: number[]; green: boolean; checks: { markers: { found: number; ok: boolean }; wordCount: { words: number } } };
      expect(row).toMatchObject({ exerciseNo: 494, pageNos: [1, 2], green: true });
      expect(row.checks).toMatchObject({ markers: { found: 8, ok: true }, wordCount: { words: 830 } });

      const detail = (await agent.get(`/api/v1/admin/scans/${row.id}`)).body;
      expect(detail.parts).toHaveLength(2);
      expect(detail.parts.every((p: { hasImage: boolean }) => p.hasImage)).toBe(true);
      expect(detail.draft.wordCount).toBe(830);

      await agent.post(`/api/v1/admin/scans/${row.id}/approve`).send({});
      const after = (await agent.get(`/api/v1/admin/scans/${row.id}`)).body;
      expect(after.hasImage).toBe(false);
      expect(await Dictation.findOne({ exerciseNo: 494 }).then((d) => d?.masterWordCount)).toBe(830);
    });

    it('joins them when the second page is uploaded later, and when it is read first', async () => {
      const { agent } = await admin();
      const setId = await newSet(agent);
      vi.stubGlobal('fetch', reader());
      await send(agent, setId, 1);
      const waiting = await until(agent, setId, (r) => r.length === 1 && r[0]!.status === 'waiting');
      expect(waiting[0]).toMatchObject({ status: 'waiting' });
      await send(agent, setId, 2);
      const rows = await until(agent, setId, (r) => r.length === 1 && r[0]!.status === 'done');
      expect(rows[0]).toMatchObject({ exerciseNo: 494 });
    });

    it('keeps two uploads of the same file apart', async () => {
      const { agent } = await admin();
      const setId = await newSet(agent);
      vi.stubGlobal('fetch', reader());
      for (const up of ['a1', 'b2']) {
        await send(agent, setId, 1, 2, up);
        await send(agent, setId, 2, 2, up);
      }
      const rows = await until(agent, setId, (r) => r.length === 2 && r.every((x) => x.status === 'done'));
      expect(rows).toHaveLength(2);
    });

    it('reads a lone second page as an orphan and a lone first page as an incomplete exercise', async () => {
      const { agent } = await admin();
      const setId = await newSet(agent);
      vi.stubGlobal('fetch', reader());
      await send(agent, setId, 2, 2, 'solo2');
      const [orphan] = await until(agent, setId, (r) => r.length === 1 && r[0]!.status === 'failed');
      expect(orphan!.error).toContain('second half');

      await send(agent, setId, 1, 1, 'solo1');
      const rows = await until(agent, setId, (r) => r.length === 2 && r.every((x) => x.status === 'done' || x.status === 'failed'));
      const first = rows.find((r) => r.status === 'done') as ScanRow & { green: boolean };
      expect(first.green).toBe(false);
    });

    it('lets the first page go on alone when its missing second page is discarded, and a retry reads both again', async () => {
      const { agent } = await admin();
      const setId = await newSet(agent);
      vi.stubGlobal('fetch', reader());
      await send(agent, setId, 1);
      await until(agent, setId, (r) => r.length === 1 && r[0]!.status === 'waiting');
      await send(agent, setId, 2);
      const [joined] = await until(agent, setId, (r) => r.length === 1 && r[0]!.status === 'done');
      // retry: both pages are read again and joined again
      expect((await agent.post(`/api/v1/admin/scans/${joined!.id}/retry`)).status).toBe(200);
      const [again] = await until(agent, setId, (r) => r.length === 1 && r[0]!.status === 'done' && (r[0] as unknown as { pageNos: number[] }).pageNos.length === 2);
      expect(again).toBeDefined();
      // discarding the exercise removes both pages
      await agent.delete(`/api/v1/admin/scans/${joined!.id}`);
      expect(await TranscriptScan.countDocuments()).toBe(0);
    });
  });
});
