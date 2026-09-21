import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearTestData, createDictation, loginAs, SAMPLE_TEXT, startTestDb, stopTestDb, testApp } from '../../test/helpers.js';

const app = testApp();
beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearTestData);

type Agent = Awaited<ReturnType<typeof loginAs>>['agent'];
async function submit(agent: Agent, dictationId: string, typed: string) {
  const a = (await agent.post(`/api/v1/dictations/${dictationId}/attempts`).send({})).body.attempt;
  await agent.post(`/api/v1/attempts/${a.id}/submit`).send({ typedText: typed });
}

describe('GET /analytics/my-mistakes', () => {
  it('is empty for a new student, with all six groups present', async () => {
    const { agent } = await loginAs(app, 'a@test.com');
    const res = await agent.get('/api/v1/analytics/my-mistakes');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.items).toEqual([]);
    expect(res.body.groups.map((g: { group: string }) => g.group)).toEqual(['additions', 'omissions', 'spelling', 'capitalisation', 'punctuation', 'replacements']);
  });

  it('counts mistakes by group, collapses repeats and filters by group', async () => {
    const { dictation } = await createDictation();
    const id = String(dictation._id);
    const { agent } = await loginAs(app, 'a@test.com');
    // Each try: one spelling slip on Government, and a missing full stop after "now".
    await submit(agent, id, SAMPLE_TEXT.replace('Government', 'Goverment').replace('now.', 'now'));
    await submit(agent, id, SAMPLE_TEXT.replace('Government', 'Goverment').replace('Kindly ', ''));

    const all = (await agent.get('/api/v1/analytics/my-mistakes')).body;
    const count = (g: string) => all.groups.find((x: { group: string }) => x.group === g).count;
    expect(count('spelling')).toBe(2);
    expect(count('omissions')).toBe(1);
    expect(count('punctuation')).toBe(1);
    expect(all.total).toBe(4);
    expect(all.totalItems).toBe(3); // the two identical spelling slips are one row
    expect(all.items[0]).toMatchObject({ kind: 'spelling', group: 'spelling', master: 'Government', attempt: 'Goverment', count: 2 });

    const spelling = (await agent.get('/api/v1/analytics/my-mistakes?group=spelling')).body;
    expect(spelling.items).toHaveLength(1);
    expect(spelling.totalItems).toBe(1);
    // Group counts stay for every group even when one is selected.
    expect(spelling.total).toBe(4);
  });

  it('leaves out attempts where less than half of the dictation was typed', async () => {
    const { dictation } = await createDictation();
    const id = String(dictation._id);
    const { agent } = await loginAs(app, 'a@test.com');
    await submit(agent, id, ''); // an accidental blank submit: dozens of omissions that say nothing about the student
    await submit(agent, id, 'Sir');
    expect((await agent.get('/api/v1/analytics/my-mistakes')).body.total).toBe(0);
    await submit(agent, id, SAMPLE_TEXT.replace('Kindly ', ''));
    expect((await agent.get('/api/v1/analytics/my-mistakes')).body.total).toBe(1);
  });

  it('pages, validates, and never includes another student', async () => {
    const { dictation } = await createDictation();
    const id = String(dictation._id);
    const a = await loginAs(app, 'a@test.com');
    await submit(a.agent, id, SAMPLE_TEXT.replace('Kindly ', '').replace('Government', 'Goverment'));
    const page2 = (await a.agent.get('/api/v1/analytics/my-mistakes?limit=1&page=2')).body;
    expect(page2.items).toHaveLength(1);
    expect(page2.totalItems).toBe(2);
    expect((await a.agent.get('/api/v1/analytics/my-mistakes?group=nope')).status).toBe(400);
    expect((await a.agent.get('/api/v1/analytics/my-mistakes?limit=9999')).status).toBe(400);

    const b = await loginAs(app, 'b@test.com');
    expect((await b.agent.get('/api/v1/analytics/my-mistakes')).body.total).toBe(0);
  });
});
