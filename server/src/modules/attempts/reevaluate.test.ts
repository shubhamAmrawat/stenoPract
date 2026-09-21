import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Attempt, Dictation, DictationText, UserWordStats } from '../../models/index.js';
import { clearTestData, createDictation, loginAs, SAMPLE_TEXT, startTestDb, stopTestDb, testApp } from '../../test/helpers.js';

const app = testApp();
beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearTestData);

async function setup() {
  const { dictation } = await createDictation();
  const { agent, user } = await loginAs(app, 'a@test.com');
  const id = String(dictation._id);
  const a = (await agent.post(`/api/v1/dictations/${id}/attempts`).send({})).body.attempt;
  await agent.post(`/api/v1/attempts/${a.id}/submit`).send({ typedText: SAMPLE_TEXT.replace('Kindly ', '') });
  return { dictation, agent, user, id, attemptId: a.id as string };
}

describe('POST /attempts/:id/reevaluate', () => {
  it('changes nothing, and writes nothing, when the analysis is already up to date', async () => {
    const { agent, attemptId } = await setup();
    const before = await Attempt.findById(attemptId).lean();
    const res = await agent.post(`/api/v1/attempts/${attemptId}/reevaluate`).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ changed: false, before: before!.result!.errorPct, after: before!.result!.errorPct });
    expect(res.body.attempt.result.errorPct).toBe(before!.result!.errorPct);
    const after = await Attempt.findById(attemptId).lean();
    expect(after!.evaluationHistory).toHaveLength(1);
    expect(String(after!.updatedAt)).toBe(String(before!.updatedAt));
  });

  it('re-grades against the corrected transcript, keeps history, and does not double-count word statistics', async () => {
    const { agent, attemptId, dictation, user } = await setup();
    const statsBefore = await UserWordStats.countDocuments({ userId: user.id });
    // The admin fixes the transcript: the word the student left out was never dictated.
    await DictationText.create({
      dictationId: dictation._id, version: 2, reviewStatus: 'verified',
      masterText: SAMPLE_TEXT.replace('Kindly ', ''),
    });
    await Dictation.updateOne({ _id: dictation._id }, { $set: { activeTextVersion: 2 } });

    const res = await agent.post(`/api/v1/attempts/${attemptId}/reevaluate`).send({});
    expect(res.body).toMatchObject({ changed: true, after: 0 });
    expect(res.body.before).toBeGreaterThan(0);
    expect(res.body.attempt).toMatchObject({ textVersion: 2 });
    expect(res.body.attempt.result).toMatchObject({ errorPct: 0, accuracyPct: 100 });
    expect(res.body.attempt.mistakes).toEqual([]);
    expect(res.body.attempt.masterText).toContain('Honourable');

    const stored = await Attempt.findById(attemptId).lean();
    expect(stored!.evaluationHistory).toHaveLength(2);
    expect(await UserWordStats.countDocuments({ userId: user.id })).toBe(statsBefore);

    // A second press is a no-op.
    expect((await agent.post(`/api/v1/attempts/${attemptId}/reevaluate`).send({})).body.changed).toBe(false);
  });

  it('only works on your own submitted attempts', async () => {
    const { attemptId, agent, id } = await setup();
    const other = await loginAs(app, 'b@test.com');
    expect((await other.agent.post(`/api/v1/attempts/${attemptId}/reevaluate`).send({})).status).toBe(404);

    const draft = (await other.agent.post(`/api/v1/dictations/${id}/attempts`).send({})).body.attempt;
    expect((await other.agent.post(`/api/v1/attempts/${draft.id}/reevaluate`).send({})).status).toBe(404);
    expect((await agent.post('/api/v1/attempts/not-an-id/reevaluate').send({})).status).toBe(400);
  });
});
