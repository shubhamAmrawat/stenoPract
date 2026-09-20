import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearTestData, createDictation, loginAs, startTestDb, stopTestDb, testApp, SAMPLE_TEXT } from '../../test/helpers.js';

const app = testApp();
beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearTestData);

describe('catalog', () => {
  it('requires sign-in', async () => {
    const { agent } = await loginAs(app, 'a@test.com');
    await agent.post('/api/v1/auth/logout');
    expect((await agent.get('/api/v1/sets')).status).toBe(401);
    expect((await agent.get('/api/v1/dictations')).status).toBe(401);
  });

  it('lists exam profiles', async () => {
    const { agent } = await loginAs(app, 'a@test.com');
    const res = await agent.get('/api/v1/exam-profiles');
    expect(res.body.items.map((p: { code: string }) => p.code)).toEqual(['COMMON', 'SSC_C', 'SSC_D']);
  });

  it('lists only published sets/dictations and never leaks the transcript', async () => {
    const { dictation } = await createDictation({ exerciseNo: 507 });
    await createDictation({ exerciseNo: 508, published: false });
    await createDictation({ exerciseNo: 509, verified: false });
    const { agent } = await loginAs(app, 'a@test.com');

    const sets = await agent.get('/api/v1/sets');
    expect(sets.body.items).toHaveLength(1);
    expect(sets.body.items[0]).toMatchObject({ slug: 'kc-24', dictationCount: 2, readyCount: 1 });

    const list = await agent.get('/api/v1/dictations');
    expect(list.body.total).toBe(2);
    expect(list.body.items.map((d: { exerciseNo: number }) => d.exerciseNo)).toEqual([507, 509]);
    expect(list.body.items[1].ready).toBe(false);
    expect(JSON.stringify(list.body)).not.toContain('Honourable');
    expect(JSON.stringify(list.body)).not.toContain('masterText');

    const one = await agent.get(`/api/v1/dictations/${dictation._id}`);
    expect(one.status).toBe(200);
    expect(one.body.dictation.videos[0]).toMatchObject({ youtubeVideoId: 'abc123DEF45', baseWpm: 100 });
    expect(JSON.stringify(one.body)).not.toContain(SAMPLE_TEXT.slice(0, 20));
  });

  it('hides unpublished dictations and rejects bad ids', async () => {
    const { dictation } = await createDictation({ published: false });
    const { agent } = await loginAs(app, 'a@test.com');
    expect((await agent.get(`/api/v1/dictations/${dictation._id}`)).status).toBe(404);
    expect((await agent.get('/api/v1/dictations/not-an-id')).status).toBe(400);
  });

  it('searches by title / exercise number and paginates', async () => {
    for (const n of [507, 508, 509]) await createDictation({ exerciseNo: n });
    const { agent } = await loginAs(app, 'a@test.com');
    expect((await agent.get('/api/v1/dictations?q=508')).body.items).toHaveLength(1);
    expect((await agent.get('/api/v1/dictations?q=exercise')).body.total).toBe(3);
    const page2 = await agent.get('/api/v1/dictations?limit=2&page=2');
    expect(page2.body.items).toHaveLength(1);
    expect((await agent.get('/api/v1/dictations?limit=1000')).status).toBe(400);
  });
});

describe('library: seen / favourite / folders', () => {
  it('marks seen and favourite, and filters by them per user', async () => {
    const a = await createDictation({ exerciseNo: 507 });
    await createDictation({ exerciseNo: 508 });
    const { agent } = await loginAs(app, 'a@test.com');
    const other = await loginAs(app, 'b@test.com');

    const put = await agent.put(`/api/v1/dictations/${a.dictation._id}/state`).send({ favourite: true, seen: true });
    expect(put.body.state).toMatchObject({ favourite: true, seen: true });
    expect((await agent.get('/api/v1/dictations?favourite=true')).body.items).toHaveLength(1);
    expect((await agent.get('/api/v1/dictations?seen=false')).body.items.map((d: { exerciseNo: number }) => d.exerciseNo)).toEqual([508]);
    // another student sees nothing marked
    expect((await other.agent.get('/api/v1/dictations?favourite=true')).body.items).toHaveLength(0);
    expect((await agent.put(`/api/v1/dictations/${a.dictation._id}/state`).send({})).status).toBe(400);
  });

  it('folders: create, duplicate name, assign, list counts, filter, delete', async () => {
    const a = await createDictation({ exerciseNo: 507 });
    const { agent } = await loginAs(app, 'a@test.com');

    const created = await agent.post('/api/v1/folders').send({ name: 'Weak ones' });
    expect(created.status).toBe(201);
    const folderId = created.body.folder.id as string;
    expect((await agent.post('/api/v1/folders').send({ name: 'Weak ones' })).status).toBe(409);

    const assign = await agent.put(`/api/v1/dictations/${a.dictation._id}/folders`).send({ folderIds: [folderId] });
    expect(assign.body.state.folderIds).toEqual([folderId]);
    expect((await agent.get('/api/v1/folders')).body.items[0]).toMatchObject({ name: 'Weak ones', count: 1 });
    expect((await agent.get(`/api/v1/dictations?folderId=${folderId}`)).body.items).toHaveLength(1);

    // someone else's folder cannot be used
    const other = await loginAs(app, 'b@test.com');
    expect((await other.agent.put(`/api/v1/dictations/${a.dictation._id}/folders`).send({ folderIds: [folderId] })).status).toBe(400);
    expect((await other.agent.delete(`/api/v1/folders/${folderId}`)).status).toBe(404);

    expect((await agent.patch(`/api/v1/folders/${folderId}`).send({ name: 'Renamed' })).body.folder.name).toBe('Renamed');
    expect((await agent.delete(`/api/v1/folders/${folderId}`)).status).toBe(200);
    expect((await agent.get(`/api/v1/dictations/${a.dictation._id}`)).body.dictation.state.folderIds).toEqual([]);
  });
});
