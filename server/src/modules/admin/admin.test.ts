import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Attempt, Dictation, DictationText } from '../../models/index.js';
import { clearTestData, createDictation, loginAs, SAMPLE_TEXT, startTestDb, stopTestDb, testApp } from '../../test/helpers.js';

const app = testApp();
beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearTestData);
afterEach(() => vi.unstubAllGlobals());

const admin = () => loginAs(app, 'admin@test.com');

describe('admin access', () => {
  it('rejects anonymous and non-admin users', async () => {
    const anon = await import('supertest').then((m) => m.default(app).get('/api/v1/admin/sets'));
    expect(anon.status).toBe(401);
    const { agent } = await loginAs(app, 'student@test.com');
    expect((await agent.get('/api/v1/admin/sets')).status).toBe(403);
    expect((await agent.put('/api/v1/admin/exam-profiles/SSC_C').send({})).status).toBe(403);
  });
});

describe('sets and dictations', () => {
  it('creates a set, rejects duplicate slugs, and edits it', async () => {
    const { agent } = await admin();
    const created = await agent.post('/api/v1/admin/sets').send({ slug: 'kc-24', title: 'Kailash Chandra Vol 24', published: true });
    expect(created.status).toBe(201);
    expect((await agent.post('/api/v1/admin/sets').send({ slug: 'kc-24', title: 'Dup' })).status).toBe(409);
    expect((await agent.post('/api/v1/admin/sets').send({ slug: 'Bad Slug!', title: 'x' })).status).toBe(400);
    const patched = await agent.patch(`/api/v1/admin/sets/${created.body.set.id}`).send({ title: 'KC Vol 24' });
    expect(patched.body.set.title).toBe('KC Vol 24');
  });

  it('imports a playlist: creates dictations, attaches videos, skips odd titles', async () => {
    const { agent } = await admin();
    const set = (await agent.post('/api/v1/admin/sets').send({ slug: 'kc-24', title: 'KC 24' })).body.set;

    const items = [
      ['vid00000001', '100 WPM | Exercise 507 | Kailash Chandra Vol 24'],
      ['vid00000002', '100 WPM | Exercise 508 | Kailash Chandra Vol 24'],
      ['vid00000003', 'Private video'],
      ['vid00000004', 'Channel trailer'],
    ].map(([videoId, title], position) => ({ snippet: { title, position, resourceId: { videoId } } }));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ items }) });
    vi.stubGlobal('fetch', fetchMock);

    const res = await agent.post(`/api/v1/admin/sets/${set.id}/import-playlist`).send({ playlist: 'https://youtube.com/playlist?list=PLabcdefghij12345' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ playlistId: 'PLabcdefghij12345', found: 3, created: 2, updated: 0 });
    expect(res.body.skipped).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain('playlistId=PLabcdefghij12345');

    // Running it again updates instead of duplicating; a second speed for the same exercise is added.
    items.push({ snippet: { title: '80 WPM | Exercise 507 | KC', position: 9, resourceId: { videoId: 'vid00000009' } } });
    const again = await agent.post(`/api/v1/admin/sets/${set.id}/import-playlist`).send({});
    expect(again.body).toMatchObject({ created: 0, updated: 3 });
    const list = (await agent.get(`/api/v1/admin/dictations?setId=${set.id}`)).body.items;
    expect(list).toHaveLength(2);
    expect(list[0].videos.map((v: { baseWpm: number }) => v.baseWpm).sort()).toEqual([100, 80].sort());
    expect(list[0].published).toBe(false);
    expect(list[0].activeTextVersion).toBeNull();
  });

  it('imports "Transcription No. N" titles that carry no speed, using the default speed the admin types', async () => {
    const { agent } = await admin();
    const set = (await agent.post('/api/v1/admin/sets').send({ slug: 'kc-23', title: 'KC 23' })).body.set;
    const items = [
      ['vid00000001', 'Transcription No. 485 | Kailash Chandra Shorthand Dictation | Shorthand'],
      ['vid00000002', 'Transcription No. 486 | Kailash Chandra Shorthand Dictation | 90 WPM'],
      ['vid00000003', 'Channel trailer'],
    ].map(([videoId, title], position) => ({ snippet: { title, position, resourceId: { videoId } } }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ items }) }));
    const url = `/api/v1/admin/sets/${set.id}/import-playlist`;

    // Without a default speed the video with no speed in its title is skipped, with a reason that says what to do.
    const first = await agent.post(url).send({ playlist: 'PLabcdefghij12345' });
    expect(first.body).toMatchObject({ found: 3, created: 1, updated: 0, usedDefault: 0, exercises: [486] });
    expect(first.body.skipped).toHaveLength(2);
    expect(first.body.skipped[0].reason).toContain('no speed');
    expect(first.body.skipped[1].reason).toContain('No exercise number');

    // Typing a speed and importing again picks the rest up without duplicating anything.
    const second = await agent.post(url).send({ defaultWpm: 100 });
    expect(second.body).toMatchObject({ created: 1, updated: 1, usedDefault: 1, exercises: [485, 486] });
    const list = (await agent.get(`/api/v1/admin/dictations?setId=${set.id}`)).body.items;
    expect(list).toHaveLength(2);
    const byNo = Object.fromEntries(list.map((d: { exerciseNo: number; videos: { baseWpm: number }[] }) => [d.exerciseNo, d.videos.map((v) => v.baseWpm)]));
    expect(byNo).toEqual({ 485: [100], 486: [90] });

    expect((await agent.post(url).send({ defaultWpm: 10 })).status).toBe(400);
  });

  it('a YouTube failure is reported, not crashed on', async () => {
    const { agent } = await admin();
    const set = (await agent.post('/api/v1/admin/sets').send({ slug: 's', title: 'S' })).body.set;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: { message: 'quota exceeded' } }) }));
    const res = await agent.post(`/api/v1/admin/sets/${set.id}/import-playlist`).send({ playlist: 'PLabcdefghij12345' });
    expect(res.status).toBe(502);
    expect(res.body.error.message).toContain('quota exceeded');
    expect((await agent.post(`/api/v1/admin/sets/${set.id}/import-playlist`).send({})).status).toBe(400);
  });

  it('manual create + edit; cannot publish without a verified transcript', async () => {
    const { agent } = await admin();
    const set = (await agent.post('/api/v1/admin/sets').send({ slug: 's', title: 'S' })).body.set;
    const d = await agent.post('/api/v1/admin/dictations').send({ setId: set.id, exerciseNo: 507, title: 'Exercise 507', videos: [{ youtubeVideoId: 'abc123DEF45', baseWpm: 100 }] });
    expect(d.status).toBe(201);
    expect((await agent.post('/api/v1/admin/dictations').send({ setId: set.id, exerciseNo: 507, title: 'dup' })).status).toBe(409);
    expect((await agent.patch(`/api/v1/admin/dictations/${d.body.dictation.id}`).send({ published: true })).status).toBe(409);
    expect((await agent.patch(`/api/v1/admin/dictations/${d.body.dictation.id}`).send({ videos: [{ youtubeVideoId: 'short', baseWpm: 100 }] })).status).toBe(400);
  });
});

describe('transcript versions', () => {
  async function fresh() {
    const { agent } = await admin();
    const set = (await agent.post('/api/v1/admin/sets').send({ slug: 's', title: 'S', published: true })).body.set;
    const d = (await agent.post('/api/v1/admin/dictations').send({ setId: set.id, exerciseNo: 1, title: 'Ex 1', videos: [{ youtubeVideoId: 'abc123DEF45', baseWpm: 100 }] })).body.dictation;
    return { agent, d };
  }

  it('versions increment; verify activates + counts words; verified text is frozen; publish then allowed', async () => {
    const { agent, d } = await fresh();
    const v1 = await agent.post(`/api/v1/admin/dictations/${d.id}/texts`).send({ masterText: SAMPLE_TEXT, source: 'book', checkpoints: [10, 20] });
    expect(v1.body.text).toMatchObject({ version: 1, reviewStatus: 'draft', wordCount: 24 });

    expect((await agent.patch(`/api/v1/admin/texts/${v1.body.text.id}`).send({ checkpoints: [999] })).status).toBe(400);
    const edited = await agent.patch(`/api/v1/admin/texts/${v1.body.text.id}`).send({ masterText: SAMPLE_TEXT + ' Thank you.' });
    expect(edited.body.text.wordCount).toBe(26);

    const verified = await agent.post(`/api/v1/admin/texts/${v1.body.text.id}/verify`).send({});
    expect(verified.body.activeTextVersion).toBe(1);
    expect((await Dictation.findById(d.id).lean())?.masterWordCount).toBe(26);
    expect((await agent.patch(`/api/v1/admin/texts/${v1.body.text.id}`).send({ notes: 'x' })).status).toBe(409);

    const v2 = await agent.post(`/api/v1/admin/dictations/${d.id}/texts`).send({ masterText: 'A corrected text.' });
    expect(v2.body.text.version).toBe(2);
    const listing = (await agent.get(`/api/v1/admin/dictations/${d.id}/texts`)).body;
    expect(listing.activeTextVersion).toBe(1);
    expect(listing.items.map((t: { version: number }) => t.version)).toEqual([2, 1]);

    expect((await agent.patch(`/api/v1/admin/dictations/${d.id}`).send({ published: true })).status).toBe(200);
  });

  it('full flow: admin publishes -> student practises -> suspect words -> fixed version -> re-evaluate', async () => {
    const { agent, d } = await fresh();
    const v1 = (await agent.post(`/api/v1/admin/dictations/${d.id}/texts`).send({ masterText: 'The Minister spoke about Sahay today. We agree.' })).body.text;
    await agent.post(`/api/v1/admin/texts/${v1.id}/verify`).send({});
    await agent.patch(`/api/v1/admin/dictations/${d.id}`).send({ published: true });

    // Three students all type "Sahai": the master text may be wrong (the speaker actually says "Sahai").
    const attemptIds: string[] = [];
    for (const email of ['s1@test.com', 's2@test.com', 's3@test.com']) {
      const s = await loginAs(app, email);
      const a = (await s.agent.post(`/api/v1/dictations/${d.id}/attempts`).send({})).body.attempt;
      const r = await s.agent.post(`/api/v1/attempts/${a.id}/submit`).send({ typedText: 'The Minister spoke about Sahai today. We agree.' });
      expect(r.body.attempt.result.half).toBe(1);
      attemptIds.push(a.id);
    }

    const suspects = (await agent.get(`/api/v1/admin/dictations/${d.id}/suspect-words`)).body;
    expect(suspects.attempts).toBe(3);
    expect(suspects.items).toHaveLength(1);
    expect(suspects.items[0]).toMatchObject({ word: 'Sahay', misses: 3, ratio: 1 });
    expect((await agent.get(`/api/v1/admin/dictations/${d.id}/suspect-words?minAttempts=5`)).body.items).toEqual([]);

    // Admin publishes a corrected version; old attempts stay on v1 until re-evaluated.
    const v2 = (await agent.post(`/api/v1/admin/dictations/${d.id}/texts`).send({ masterText: 'The Minister spoke about Sahai today. We agree.' })).body.text;
    await agent.post(`/api/v1/admin/texts/${v2.id}/verify`).send({});

    const before = await Attempt.findById(attemptIds[0]).lean();
    expect(before?.textVersion).toBe(1);
    const one = await agent.post(`/api/v1/admin/attempts/${attemptIds[0]}/reevaluate`).send({});
    expect(one.body).toMatchObject({ before: 6.25, after: 0, textVersion: 2, statsRecounted: false });

    const bulk = await agent.post(`/api/v1/admin/dictations/${d.id}/reevaluate`).send({ limit: 1 });
    expect(bulk.body).toMatchObject({ processed: 1, remaining: 1 });
    const bulk2 = await agent.post(`/api/v1/admin/dictations/${d.id}/reevaluate`).send({});
    expect(bulk2.body).toMatchObject({ processed: 1, remaining: 0 });

    const after = await Attempt.findById(attemptIds[1]).lean();
    expect(after).toMatchObject({ textVersion: 2 });
    expect(after?.result?.errorPct).toBe(0);
    expect(after?.evaluationHistory).toHaveLength(2);
  });
});

describe('reports', () => {
  it('student reports a word, admin triages it', async () => {
    const { dictation } = await createDictation();
    const s = await loginAs(app, 'student@test.com');
    const created = await s.agent.post('/api/v1/reports').send({ dictationId: String(dictation._id), word: 'Honourable', message: 'The speaker says "Hon\'ble" here' });
    expect(created.status).toBe(201);
    expect((await s.agent.post('/api/v1/reports').send({ dictationId: String(dictation._id), message: 'x' })).status).toBe(400);
    expect((await s.agent.post('/api/v1/reports').send({ dictationId: String(dictation._id), attemptId: '000000000000000000000000', message: 'hello there' })).status).toBe(400);
    expect((await s.agent.get('/api/v1/reports')).body.items).toHaveLength(1);

    const { agent } = await admin();
    const inbox = (await agent.get('/api/v1/admin/reports')).body;
    expect(inbox.total).toBe(1);
    expect(inbox.items[0]).toMatchObject({ word: 'Honourable', user: { email: 'student@test.com' }, dictation: { exerciseNo: 507 } });
    expect((await agent.get('/api/v1/admin/dictations')).body.items[0].openReports).toBe(1);

    const resolved = await agent.patch(`/api/v1/admin/reports/${created.body.report.id}`).send({ status: 'resolved', resolutionNote: 'Added as an alternate form' });
    expect(resolved.body.report.status).toBe('resolved');
    expect((await agent.get('/api/v1/admin/reports')).body.total).toBe(0);
    expect((await s.agent.get('/api/v1/reports')).body.items[0]).toMatchObject({ status: 'resolved', resolutionNote: 'Added as an alternate form' });
  });
});

describe('grading configuration', () => {
  it('editing exam limits bumps rulesVersion and changes the verdict for new attempts', async () => {
    const { dictation } = await createDictation();
    const { agent } = await admin();
    const before = (await agent.get('/api/v1/admin/exam-profiles')).body.items.find((p: { code: string }) => p.code === 'SSC_C');
    expect(before).toMatchObject({ rulesVersion: 1, verifiedAgainstNotice: true, limits: { general: 5, reserved: 7 } });

    const put = await agent.put('/api/v1/admin/exam-profiles/ssc_c').send({ ...before, limits: { general: 2, reserved: 3 }, verifiedAgainstNotice: false });
    expect(put.status).toBe(200);
    expect(put.body.profile).toMatchObject({ rulesVersion: 2, verifiedAgainstNotice: false, limits: { general: 2, reserved: 3 } });

    // An unchanged re-save does not bump the version.
    const same = await agent.put('/api/v1/admin/exam-profiles/SSC_C').send({ ...put.body.profile });
    expect(same.body.profile.rulesVersion).toBe(2);

    const a = (await agent.post(`/api/v1/dictations/${dictation._id}/attempts`).send({})).body.attempt;
    const r = await agent.post(`/api/v1/attempts/${a.id}/submit`).send({ typedText: SAMPLE_TEXT.replace('now.', 'now').replace('Kindly', 'Kindley').replace('House', 'Hous') });
    expect(r.body.attempt.result).toMatchObject({ limitPct: 2, passed: false });
  });

  it('a new profile can be created', async () => {
    const { agent } = await admin();
    const res = await agent.put('/api/v1/admin/exam-profiles/hc_steno').send({
      name: 'High Court', wpm: 120, durationMin: 30, words: 1200, limits: { general: 4, reserved: 4 },
    });
    expect(res.status).toBe(200);
    expect(res.body.profile).toMatchObject({ code: 'HC_STENO', rulesVersion: 1, active: true });
    expect((await agent.put('/api/v1/admin/exam-profiles/x').send({})).status).toBe(400);
  });

  it('alternate forms and abbreviations take effect immediately in grading', async () => {
    const { dictation } = await createDictation({ text: 'The Chairperson said so. Please see the Annexure.' });
    const { agent } = await admin();
    const grade = async (typed: string) => {
      const a = (await agent.post(`/api/v1/dictations/${dictation._id}/attempts`).send({})).body.attempt;
      return (await agent.post(`/api/v1/attempts/${a.id}/submit`).send({ typedText: typed })).body.attempt.result;
    };
    expect((await grade('The Chairman said so. Please see the Annexure.')).full).toBe(1);

    await agent.put('/api/v1/admin/alternate-forms').send({ canonical: 'chairperson', variants: ['chairman'] });
    expect((await agent.get('/api/v1/admin/alternate-forms')).body.items.some((a: { canonical: string }) => a.canonical === 'chairperson')).toBe(true);
    expect((await grade('The Chairman said so. Please see the Annexure.')).full).toBe(0);

    expect((await agent.delete('/api/v1/admin/alternate-forms/chairperson')).status).toBe(200);
    expect((await agent.delete('/api/v1/admin/alternate-forms/chairperson')).status).toBe(404);
    expect((await grade('The Chairman said so. Please see the Annexure.')).full).toBe(1);

    await agent.put('/api/v1/admin/abbreviations').send({ abbr: 'annex', expansions: ['annexure'] });
    expect((await grade('The Chairperson said so. Please see the annex.')).breakdown).toMatchObject({ abbreviation: 1 });
    expect((await agent.get('/api/v1/admin/abbreviations')).body.items.some((a: { abbr: string }) => a.abbr === 'annex')).toBe(true);
    expect((await agent.delete('/api/v1/admin/abbreviations/annex')).status).toBe(200);
  });
});

describe('bulk import and pasted video links', () => {
  const text = 'Sir, the Government has received reports. We have taken up this matter with the Secretary of State.';

  it('loads transcripts, verifies them, and publishes only once a video exists', async () => {
    const { agent } = await admin();
    const set = (await agent.post('/api/v1/admin/sets').send({ slug: 'kc-24', title: 'KC 24', published: true })).body.set;

    const first = await agent.post(`/api/v1/admin/sets/${set.id}/bulk-import`).send({ publish: true, items: [{ exerciseNo: 507, masterText: text, checkpoints: [5, 999] }] });
    expect(first.status).toBe(200);
    expect(first.body.results[0]).toMatchObject({ action: 'created', transcript: 'new_version', version: 1, published: false });
    expect(first.body.results[0].warnings.join(' ')).toContain('checkpoints');

    // same text again -> nothing new; changed text -> version 2
    const same = await agent.post(`/api/v1/admin/sets/${set.id}/bulk-import`).send({ items: [{ exerciseNo: 507, masterText: `${text}  ` }] });
    expect(same.body.results[0]).toMatchObject({ action: 'updated', transcript: 'unchanged', version: 1 });
    const changed = await agent.post(`/api/v1/admin/sets/${set.id}/bulk-import`).send({ items: [{ exerciseNo: 507, masterText: `${text} Thank you.` }] });
    expect(changed.body.results[0]).toMatchObject({ transcript: 'new_version', version: 2 });

    // links: title-first lines (as copied from the playlist page) and "507 100 link" lines
    const links = [
      '100 WPM | Exercise 507 | Kailash Chandra Vol 24\thttps://www.youtube.com/watch?v=TKMAnZMQwaM&list=PLyE_bKmpWrl_oo1RJLMNCIfyQOFUw9v68&index=1',
      '508 100 https://youtu.be/abcdefghijk',
      'garbage line',
      '509 https://youtu.be/abcdefghijl',
    ].join('\n');
    const res = await agent.post(`/api/v1/admin/sets/${set.id}/import-video-links`).send({ text: links });
    expect(res.status).toBe(200);
    expect(res.body.skipped).toHaveLength(2);
    const byNo = Object.fromEntries(res.body.results.map((r: { exerciseNo: number }) => [r.exerciseNo, r]));
    expect(byNo[507]).toMatchObject({ published: true, version: 2 });
    expect(byNo[508]).toMatchObject({ action: 'created', published: false });

    const student = await loginAs(app, 'student@test.com');
    const list = await student.agent.get(`/api/v1/dictations?setId=${set.id}`);
    expect(list.body.items.map((d: { exerciseNo: number }) => d.exerciseNo)).toEqual([507]);
  });

  it('deletes an exercise nobody attempted, but refuses once an attempt exists', async () => {
    const { agent } = await admin();
    const set = (await agent.post('/api/v1/admin/sets').send({ slug: 'del', title: 'Del' })).body.set;
    const r = await agent.post(`/api/v1/admin/sets/${set.id}/bulk-import`).send({ items: [{ exerciseNo: 3, masterText: text }, { exerciseNo: 4, masterText: text }] });
    const [a, b] = r.body.results.map((x: { dictationId: string }) => x.dictationId);
    expect(a).toBeTruthy();
    expect((await agent.delete(`/api/v1/admin/dictations/${a}`)).status).toBe(200);
    expect((await agent.get(`/api/v1/admin/dictations/${a}`)).status).toBe(404);
    expect((await DictationText.countDocuments({ dictationId: a }))).toBe(0);
    await agent.post(`/api/v1/admin/sets/${set.id}/import-video-links`).send({ text: '4 100 https://youtu.be/abcdefghijk' });
    const st = await loginAs(app, 'attempter@test.com');
    expect((await st.agent.post(`/api/v1/dictations/${b}/attempts`).send({})).status).toBe(201);
    expect((await agent.delete(`/api/v1/admin/dictations/${b}`)).status).toBe(409);
    expect(await Dictation.exists({ _id: b })).toBeTruthy();
    expect((await agent.delete('/api/v1/admin/dictations/64b000000000000000000009')).status).toBe(404);
  });

  it('rejects unknown sets and non-admins', async () => {
    const { agent } = await admin();
    expect((await agent.post('/api/v1/admin/sets/64b000000000000000000000/import-video-links').send({ text: 'x' })).status).toBe(404);
    const s = await loginAs(app, 'student@test.com');
    expect((await s.agent.post('/api/v1/admin/sets/64b000000000000000000000/bulk-import').send({ items: [] })).status).toBe(403);
  });
});
