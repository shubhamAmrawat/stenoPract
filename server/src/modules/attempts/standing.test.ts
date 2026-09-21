import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Attempt } from '../../models/index.js';
import { clearTestData, createDictation, loginAs, SAMPLE_TEXT, startTestDb, stopTestDb, testApp } from '../../test/helpers.js';

const app = testApp();
beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearTestData);

type Agent = Awaited<ReturnType<typeof loginAs>>['agent'];

async function submit(agent: Agent, dictationId: string, typed: string): Promise<string> {
  const a = (await agent.post(`/api/v1/dictations/${dictationId}/attempts`).send({})).body.attempt;
  await agent.post(`/api/v1/attempts/${a.id}/submit`).send({ typedText: typed });
  return a.id as string;
}

// 24 master words: one omission is about 4.17% error, two are about 8.33%.
const perfect = SAMPLE_TEXT;
const oneOff = SAMPLE_TEXT.replace('Kindly ', '');
const twoOff = SAMPLE_TEXT.replace('Kindly ', '').replace('Honourable ', '');

describe('GET /attempts/:id/standing', () => {
  it('shows nothing until enough students have tried the exercise', async () => {
    const { dictation } = await createDictation();
    const id = String(dictation._id);
    const a = await loginAs(app, 'a@test.com', 'Asha Rao');
    const attempt = await submit(a.agent, id, perfect);
    expect((await a.agent.get(`/api/v1/attempts/${attempt}/standing`)).body).toEqual({ ready: false, students: 1, minStudents: 3 });

    const b = await loginAs(app, 'b@test.com', 'Bala K');
    await submit(b.agent, id, oneOff);
    const res = await a.agent.get(`/api/v1/attempts/${attempt}/standing`);
    expect(res.body).toEqual({ ready: false, students: 2, minStudents: 3 });
  });

  it('ranks against the other students, names only a first name, and never reveals the average of fewer than three', async () => {
    const { dictation } = await createDictation();
    const id = String(dictation._id);
    const a = await loginAs(app, 'a@test.com', 'Asha Rao');
    const b = await loginAs(app, 'b@test.com', 'Bala Krishnan');
    const c = await loginAs(app, 'c@test.com', 'Chitra Devi');
    await submit(b.agent, id, perfect);
    await submit(c.agent, id, twoOff);
    const mine = await submit(a.agent, id, oneOff);

    const s = (await a.agent.get(`/api/v1/attempts/${mine}/standing`)).body;
    expect(s).toMatchObject({ ready: true, students: 3, rank: 2, betterThanPct: 50, topperName: 'Bala', topperIsYou: false, topperAccuracyPct: 100 });
    expect(s.yourAccuracyPct).toBeCloseTo(100 - (1 / 24) * 100, 1);
    expect(s.averageAccuracyPct).toBeCloseTo(100 - ((0 + 1 / 24 + 2 / 24) / 3) * 100, 1);
    expect(JSON.stringify(s)).not.toContain('Krishnan');
    expect(JSON.stringify(s)).not.toContain('@');
  });

  it('counts each student once, by their best attempt, and says "you" when you are the topper', async () => {
    const { dictation } = await createDictation();
    const id = String(dictation._id);
    const a = await loginAs(app, 'a@test.com', 'Asha');
    const b = await loginAs(app, 'b@test.com', 'Bala');
    const c = await loginAs(app, 'c@test.com', 'Chitra');
    await submit(b.agent, id, oneOff);
    await submit(b.agent, id, twoOff); // a worse second try must not lower Bala's standing
    await submit(c.agent, id, twoOff);
    const mine = await submit(a.agent, id, perfect);

    const s = (await a.agent.get(`/api/v1/attempts/${mine}/standing`)).body;
    expect(s).toMatchObject({ ready: true, students: 3, rank: 1, betterThanPct: 100, topperIsYou: true, topperName: null });
  });

  it('ignores near-empty attempts, other transcript versions, and other students\' privacy', async () => {
    const { dictation } = await createDictation();
    const id = String(dictation._id);
    const a = await loginAs(app, 'a@test.com', 'Asha');
    const b = await loginAs(app, 'b@test.com', 'Bala');
    const c = await loginAs(app, 'c@test.com', 'Chitra');
    const mine = await submit(a.agent, id, oneOff);
    await submit(b.agent, id, 'Sir'); // far under half the words: not counted
    await submit(c.agent, id, oneOff);
    expect((await a.agent.get(`/api/v1/attempts/${mine}/standing`)).body).toMatchObject({ ready: false, students: 2 });

    // Someone else's attempt is not mine to look up.
    const theirs = await submit(c.agent, id, perfect);
    expect((await a.agent.get(`/api/v1/attempts/${theirs}/standing`)).status).toBe(404);
  });

  it('needs a submitted attempt', async () => {
    const { dictation } = await createDictation();
    const a = await loginAs(app, 'a@test.com');
    const draft = (await a.agent.post(`/api/v1/dictations/${dictation._id}/attempts`).send({})).body.attempt;
    const res = await a.agent.get(`/api/v1/attempts/${draft.id}/standing`);
    expect(res.status).toBe(409);
    expect(res.body.error?.code ?? res.body.code).toBe('NOT_SUBMITTED');
  });

  it('only compares attempts on the same transcript version', async () => {
    const { dictation } = await createDictation();
    const id = String(dictation._id);
    const a = await loginAs(app, 'a@test.com', 'Asha');
    const b = await loginAs(app, 'b@test.com', 'Bala');
    const c = await loginAs(app, 'c@test.com', 'Chitra');
    await submit(b.agent, id, perfect);
    const cAttempt = await submit(c.agent, id, perfect);
    await Attempt.updateOne({ _id: cAttempt }, { $set: { textVersion: 2 } });
    const mine = await submit(a.agent, id, oneOff);
    expect((await a.agent.get(`/api/v1/attempts/${mine}/standing`)).body).toMatchObject({ ready: false, students: 2 });
  });
});
