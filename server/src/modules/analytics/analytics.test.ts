import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Attempt } from '../../models/index.js';
import { clearTestData, createDictation, loginAs, SAMPLE_TEXT, startTestDb, stopTestDb, testApp } from '../../test/helpers.js';
import { currentStreak } from './routes.js';

const app = testApp();
beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearTestData);

describe('currentStreak', () => {
  it('counts consecutive days ending today or yesterday', () => {
    expect(currentStreak([], '2026-09-19')).toBe(0);
    expect(currentStreak(['2026-09-19', '2026-09-18', '2026-09-17'], '2026-09-19')).toBe(3);
    expect(currentStreak(['2026-09-18', '2026-09-17'], '2026-09-19')).toBe(2);
    expect(currentStreak(['2026-09-17', '2026-09-16'], '2026-09-19')).toBe(0);
    expect(currentStreak(['2026-09-19', '2026-09-17'], '2026-09-19')).toBe(1);
    expect(currentStreak(['2026-09-01', '2026-08-31', '2026-08-30'], '2026-09-01')).toBe(3);
  });
});

async function submit(agent: Awaited<ReturnType<typeof loginAs>>['agent'], dictationId: string, typed: string, daysAgo = 0) {
  const a = (await agent.post(`/api/v1/dictations/${dictationId}/attempts`).send({})).body.attempt;
  await agent.post(`/api/v1/attempts/${a.id}/submit`).send({ typedText: typed });
  if (daysAgo) await Attempt.updateOne({ _id: a.id }, { $set: { submittedAt: new Date(Date.now() - daysAgo * 86_400_000) } });
  return a.id as string;
}

describe('analytics', () => {
  it('is empty but valid for a new student', async () => {
    const { agent } = await loginAs(app, 'a@test.com');
    const s = await agent.get('/api/v1/analytics/summary');
    expect(s.body).toMatchObject({ attempts: 0, avgErrorPct: null, streakDays: 0 });
    expect(s.body).not.toHaveProperty('passRatePct');
    expect((await agent.get('/api/v1/analytics/trend')).body.items).toEqual([]);
    expect((await agent.get('/api/v1/analytics/mistakes')).body).toEqual({ items: [], total: 0 });
    expect((await agent.get('/api/v1/analytics/weak-words')).body.items).toEqual([]);
  });

  it('summarises attempts, trend, mistake mix and weak words', async () => {
    const { dictation } = await createDictation();
    const id = String(dictation._id);
    const { agent } = await loginAs(app, 'a@test.com');
    await submit(agent, id, SAMPLE_TEXT, 2); // 0%
    await submit(agent, id, SAMPLE_TEXT.replace('Kindly ', ''), 1); // one omission
    await submit(agent, id, SAMPLE_TEXT.replace('Government', 'Goverment').replace('now.', 'now'), 0); // spelling + full stop

    const s = (await agent.get('/api/v1/analytics/summary')).body;
    expect(s.attempts).toBe(3);
    expect(s.dictationsAttempted).toBe(1);
    expect(s.bestErrorPct).toBe(0);
    expect(s).not.toHaveProperty('passRatePct');
    expect(s.streakDays).toBe(3);
    expect(s.last7Days.attempts).toBe(3);

    const trend = (await agent.get('/api/v1/analytics/trend?days=7')).body.items;
    expect(trend).toHaveLength(3);
    expect(trend[0].avgErrorPct).toBe(0);
    expect(trend[2].avgErrorPct).toBeGreaterThan(0);

    const mistakes = (await agent.get('/api/v1/analytics/mistakes')).body;
    const kinds = Object.fromEntries(mistakes.items.map((i: { kind: string; count: number }) => [i.kind, i.count]));
    expect(kinds).toMatchObject({ omission: 1, spelling: 1, full_stop: 1 });
    expect(mistakes.items.find((i: { kind: string }) => i.kind === 'omission').weight).toBe(1);
    expect(mistakes.items.find((i: { kind: string }) => i.kind === 'spelling').weight).toBe(0.5);

    const weak = (await agent.get('/api/v1/analytics/weak-words?limit=3')).body.items;
    expect(weak.length).toBeGreaterThan(0);
    expect(weak[0].weightedMisses).toBeGreaterThanOrEqual(weak[weak.length - 1].weightedMisses);

    const per = (await agent.get(`/api/v1/analytics/dictations/${id}`)).body;
    expect(per.attempts).toHaveLength(3);
    expect(per.attempts[0].errorPct).toBe(0);
    expect(per.bestErrorPct).toBe(0);
  });

  it("never mixes in another student's data; validates query params", async () => {
    const { dictation } = await createDictation();
    const a = await loginAs(app, 'a@test.com');
    await submit(a.agent, String(dictation._id), SAMPLE_TEXT);
    const b = await loginAs(app, 'b@test.com');
    expect((await b.agent.get('/api/v1/analytics/summary')).body.attempts).toBe(0);
    expect((await a.agent.get('/api/v1/analytics/summary?tz=Nowhere/Land')).status).toBe(400);
    expect((await a.agent.get('/api/v1/analytics/trend?days=9999')).status).toBe(400);
    expect((await b.agent.get(`/api/v1/analytics/dictations/${dictation._id}`)).body.attempts).toEqual([]);
  });
});
