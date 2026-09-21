import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Attempt, DictationText, MasterWordStats, UserDictationState, UserWordStats } from '../../models/index.js';
import { clearTestData, createDictation, loginAs, SAMPLE_TEXT, startTestDb, stopTestDb, testApp } from '../../test/helpers.js';

const app = testApp();
beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearTestData);

async function setup() {
  const { dictation } = await createDictation();
  const { agent, user } = await loginAs(app, 'a@test.com');
  return { dictation, agent, user, id: String(dictation._id) };
}

describe('starting an attempt', () => {
  it('starts with a server-side deadline and resumes instead of duplicating', async () => {
    const { agent, id } = await setup();
    const first = await agent.post(`/api/v1/dictations/${id}/attempts`).send({});
    expect(first.status).toBe(201);
    expect(first.body.attempt).toMatchObject({ status: 'draft', examProfile: 'SSC_C', durationSec: 2400 });
    expect(first.body.attempt).not.toHaveProperty('category');
    expect(first.body.attempt.masterText).toBeUndefined();

    const again = await agent.post(`/api/v1/dictations/${id}/attempts`).send({});
    expect(again.status).toBe(200);
    expect(again.body.resumed).toBe(true);
    expect(again.body.attempt.id).toBe(first.body.attempt.id);
    expect(await Attempt.countDocuments()).toBe(1);
  });

  it('two simultaneous starts still create exactly one draft', async () => {
    const { agent, id } = await setup();
    const [a, b] = await Promise.all([
      agent.post(`/api/v1/dictations/${id}/attempts`).send({}),
      agent.post(`/api/v1/dictations/${id}/attempts`).send({}),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.attempt.id).toBe(b.body.attempt.id);
    expect(await Attempt.countDocuments()).toBe(1);
  });

  it('uses the chosen exam profile', async () => {
    const { agent, id } = await setup();
    const res = await agent.post(`/api/v1/dictations/${id}/attempts`).send({ examProfile: 'ssc_d' });
    expect(res.body.attempt).toMatchObject({ examProfile: 'SSC_D', durationSec: 3000 });
  });

  it('refuses dictations that are not ready, unpublished or unknown', async () => {
    const { agent } = await setup();
    const notReady = await createDictation({ exerciseNo: 600, verified: false });
    expect((await agent.post(`/api/v1/dictations/${notReady.dictation._id}/attempts`).send({})).status).toBe(409);
    const hidden = await createDictation({ exerciseNo: 601, published: false });
    expect((await agent.post(`/api/v1/dictations/${hidden.dictation._id}/attempts`).send({})).status).toBe(404);
    expect((await agent.post('/api/v1/dictations/000000000000000000000000/attempts').send({})).status).toBe(404);
  });
});

describe('draft autosave', () => {
  it('saves typed text and it survives a resume', async () => {
    const { agent, id } = await setup();
    const { attempt } = (await agent.post(`/api/v1/dictations/${id}/attempts`).send({})).body;
    expect((await agent.patch(`/api/v1/attempts/${attempt.id}/draft`).send({ typedText: 'Sir, I rise' })).status).toBe(200);
    const resumed = await agent.post(`/api/v1/dictations/${id}/attempts`).send({});
    expect(resumed.body.attempt.typedText).toBe('Sir, I rise');
  });

  it("cannot save into someone else's attempt", async () => {
    const { agent, id } = await setup();
    const { attempt } = (await agent.post(`/api/v1/dictations/${id}/attempts`).send({})).body;
    const other = await loginAs(app, 'b@test.com');
    expect((await other.agent.patch(`/api/v1/attempts/${attempt.id}/draft`).send({ typedText: 'hack' })).status).toBe(409);
    expect((await other.agent.get(`/api/v1/attempts/${attempt.id}`)).status).toBe(404);
    expect((await agent.patch(`/api/v1/attempts/${attempt.id}/draft`).send({ typedText: 'x'.repeat(30_001) })).status).toBe(400);
  });
});

describe('submit & evaluate', () => {
  it('a perfect attempt scores 0%; transcript is revealed only after submit', async () => {
    const { agent, id } = await setup();
    const { attempt } = (await agent.post(`/api/v1/dictations/${id}/attempts`).send({})).body;

    const beforeSubmit = await agent.get(`/api/v1/attempts/${attempt.id}`);
    expect(JSON.stringify(beforeSubmit.body)).not.toContain('Honourable');

    const res = await agent.post(`/api/v1/attempts/${attempt.id}/submit`).send({ typedText: SAMPLE_TEXT });
    expect(res.status).toBe(200);
    expect(res.body.attempt.status).toBe('submitted');
    expect(res.body.attempt.result).toMatchObject({ full: 0, half: 0, errorPct: 0, accuracyPct: 100 });
    expect(res.body.attempt.result).not.toHaveProperty('passed');
    expect(res.body.attempt.result).not.toHaveProperty('limitPct');
    expect(res.body.attempt.masterText).toBe(SAMPLE_TEXT);
  });

  it('scores mistakes, stores diff + mistakes, with no pass/fail verdict', async () => {
    const { agent, id } = await setup();
    // 25 master words; typed text has 1 omission, 1 misspelling, 1 missing full stop.
    const typed = SAMPLE_TEXT.replace('rise ', '').replace('Government', 'Goverment').replace('now.', 'now');
    const { attempt } = (await agent.post(`/api/v1/dictations/${id}/attempts`).send({})).body;
    const res = await agent.post(`/api/v1/attempts/${attempt.id}/submit`).send({ typedText: typed });
    const r = res.body.attempt.result;
    expect(r.full).toBe(1);
    expect(r.half).toBe(2);
    expect(r.limitPct).toBeUndefined();
    expect(r.passed).toBeUndefined();
    expect(r.errorPct).toBeCloseTo(((1 + 1) / 24) * 100, 1);
    expect(r.breakdown).toEqual({ omission: 1, spelling: 1, full_stop: 1 });
    expect(r.diff.length).toBeGreaterThan(20);
    expect(res.body.attempt.mistakes.map((m: { kind: string }) => m.kind).sort()).toEqual(['full_stop', 'omission', 'spelling']);
  });

  it('is idempotent: submitting twice (auto-submit + click) returns the same result and counts stats once', async () => {
    const { agent, id } = await setup();
    const { attempt } = (await agent.post(`/api/v1/dictations/${id}/attempts`).send({})).body;
    const typed = SAMPLE_TEXT.replace('Kindly', '');
    const [a, b] = await Promise.all([
      agent.post(`/api/v1/attempts/${attempt.id}/submit`).send({ typedText: typed }),
      agent.post(`/api/v1/attempts/${attempt.id}/submit`).send({ typedText: typed, auto: true }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.attempt.result.errorPct).toBe(b.body.attempt.result.errorPct);
    expect([a.body.alreadySubmitted, b.body.alreadySubmitted].sort()).toEqual([false, true]);

    const third = await agent.post(`/api/v1/attempts/${attempt.id}/submit`).send({});
    expect(third.body.alreadySubmitted).toBe(true);

    const state = await UserDictationState.findOne().lean();
    expect(state?.attemptsCount).toBe(1);
    const stored = await Attempt.findById(attempt.id).lean();
    expect(stored?.evaluationHistory).toHaveLength(1);
    const text = await DictationText.findOne().lean();
    expect(text?.attemptCount).toBe(1);
  });

  it('submits the autosaved text when none is sent', async () => {
    const { agent, id } = await setup();
    const { attempt } = (await agent.post(`/api/v1/dictations/${id}/attempts`).send({})).body;
    await agent.patch(`/api/v1/attempts/${attempt.id}/draft`).send({ typedText: SAMPLE_TEXT });
    const res = await agent.post(`/api/v1/attempts/${attempt.id}/submit`).send({});
    expect(res.body.attempt.result.errorPct).toBe(0);
  });

  it('an empty submission is 100% error', async () => {
    const { agent, id } = await setup();
    const { attempt } = (await agent.post(`/api/v1/dictations/${id}/attempts`).send({})).body;
    const res = await agent.post(`/api/v1/attempts/${attempt.id}/submit`).send({ typedText: '' });
    expect(res.body.attempt.result).toMatchObject({ errorPct: 100, accuracyPct: 0 });
  });

  it('after submitting, the draft is closed and a new attempt can begin', async () => {
    const { agent, id } = await setup();
    const first = (await agent.post(`/api/v1/dictations/${id}/attempts`).send({})).body.attempt;
    await agent.post(`/api/v1/attempts/${first.id}/submit`).send({ typedText: SAMPLE_TEXT });
    expect((await agent.patch(`/api/v1/attempts/${first.id}/draft`).send({ typedText: 'late' })).status).toBe(409);
    const second = await agent.post(`/api/v1/dictations/${id}/attempts`).send({});
    expect(second.status).toBe(201);
    expect(second.body.attempt.id).not.toBe(first.id);
  });

  it('keeps grading against the transcript version pinned at start', async () => {
    const { agent, id, dictation } = await setup();
    const { attempt } = (await agent.post(`/api/v1/dictations/${id}/attempts`).send({})).body;
    // An admin publishes a corrected v2 while the student is typing.
    await DictationText.create({ dictationId: dictation._id, version: 2, masterText: 'Completely different text.', reviewStatus: 'verified' });
    const res = await agent.post(`/api/v1/attempts/${attempt.id}/submit`).send({ typedText: SAMPLE_TEXT });
    expect(res.body.attempt.textVersion).toBe(1);
    expect(res.body.attempt.result.errorPct).toBe(0);
  });
});

describe('statistics side effects', () => {
  it('updates per-student weak words, global master-word misses and dictation state', async () => {
    const { agent, id, user } = await setup();
    const typed = SAMPLE_TEXT.replace('Honourable Minister', 'Honourable').replace('prices', 'price');
    const { attempt } = (await agent.post(`/api/v1/dictations/${id}/attempts`).send({})).body;
    const res = await agent.post(`/api/v1/attempts/${attempt.id}/submit`).send({ typedText: typed });
    const errorPct = res.body.attempt.result.errorPct;

    const weak = await UserWordStats.find({ userId: user.id }).lean();
    const byWord = Object.fromEntries(weak.map((w) => [w.word, w]));
    expect(byWord.minister).toMatchObject({ misses: 1, weightedMisses: 1 });
    expect(byWord.prices).toMatchObject({ misses: 1, weightedMisses: 0.5 });
    expect((byWord.minister!.kinds as unknown as Record<string, number>).omission).toBe(1);

    const master = await MasterWordStats.find().lean();
    expect(master.map((m) => m.word).sort()).toEqual(['Minister', 'prices.'].sort());

    const state = await UserDictationState.findOne({ userId: user.id }).lean();
    expect(state).toMatchObject({ seen: true, attemptsCount: 1, bestErrorPct: errorPct, lastErrorPct: errorPct });

    // second, better attempt improves best score but not below
    const second = (await agent.post(`/api/v1/dictations/${id}/attempts`).send({})).body.attempt;
    await agent.post(`/api/v1/attempts/${second.id}/submit`).send({ typedText: SAMPLE_TEXT });
    const state2 = await UserDictationState.findOne({ userId: user.id }).lean();
    expect(state2).toMatchObject({ attemptsCount: 2, bestErrorPct: 0, lastErrorPct: 0 });
    expect((await UserWordStats.findOne({ userId: user.id, word: 'minister' }).lean())?.misses).toBe(1);
  });
});

describe('history', () => {
  it('lists submitted attempts newest first without heavy fields', async () => {
    const { agent, id } = await setup();
    for (const t of [SAMPLE_TEXT, SAMPLE_TEXT.replace('now.', 'now')]) {
      const a = (await agent.post(`/api/v1/dictations/${id}/attempts`).send({})).body.attempt;
      await agent.post(`/api/v1/attempts/${a.id}/submit`).send({ typedText: t });
    }
    const open = (await agent.post(`/api/v1/dictations/${id}/attempts`).send({})).body.attempt;

    const list = await agent.get('/api/v1/attempts');
    expect(list.body.total).toBe(2);
    expect(list.body.items[0].errorPct).toBeGreaterThan(0); // newest = the one with a missing full stop
    expect(list.body.items[1].errorPct).toBe(0);
    expect(list.body.items[0]).toMatchObject({ exerciseNo: 507, examProfile: 'SSC_C' });
    expect(JSON.stringify(list.body)).not.toContain('diff');
    expect(JSON.stringify(list.body)).not.toContain('Honourable');

    const drafts = await agent.get('/api/v1/attempts?status=draft');
    expect(drafts.body.items.map((a: { id: string }) => a.id)).toEqual([open.id]);

    expect((await agent.delete(`/api/v1/attempts/${open.id}`)).status).toBe(200);
    expect((await agent.get('/api/v1/attempts?status=draft')).body.total).toBe(0);
  });

  it("does not show another student's attempts", async () => {
    const { agent, id } = await setup();
    const a = (await agent.post(`/api/v1/dictations/${id}/attempts`).send({})).body.attempt;
    await agent.post(`/api/v1/attempts/${a.id}/submit`).send({ typedText: SAMPLE_TEXT });
    const other = await loginAs(app, 'b@test.com');
    expect((await other.agent.get('/api/v1/attempts')).body.total).toBe(0);
    expect((await other.agent.post(`/api/v1/attempts/${a.id}/submit`).send({})).status).toBe(404);
  });
});
