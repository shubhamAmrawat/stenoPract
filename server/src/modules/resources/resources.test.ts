import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env.js';
import { parseDriveFolderId } from '../../services/drive.js';
import { clearTestData, createDictation, loginAs, startTestDb, stopTestDb, testApp } from '../../test/helpers.js';

const app = testApp();
beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearTestData);

const adminAgent = () => loginAs(app, 'admin@test.com');

describe('resources', () => {
  it('lets an admin add links, and students see only published ones in a sensible order', async () => {
    const { agent } = await adminAgent();
    const bulk = await agent.post('/api/v1/admin/resources/bulk').send({
      group: 'kc-magazines',
      text: ['Volume 10 | https://example.com/v10.pdf', 'Volume 2 | https://example.com/v2.pdf', 'no link here', 'Bad | ftp://x'].join('\n'),
    });
    expect(bulk.status).toBe(200);
    expect(bulk.body.created).toHaveLength(2);
    expect(bulk.body.skipped).toHaveLength(2);

    const hidden = await agent.post('/api/v1/admin/resources').send({ group: 'kc-magazines', title: 'Volume 3', url: 'https://example.com/v3.pdf', published: false });
    expect(hidden.status).toBe(201);
    expect((await agent.post('/api/v1/admin/resources').send({ group: 'kc-magazines', title: 'x', url: 'javascript:alert(1)' })).status).toBe(400);

    const student = await loginAs(app, 'student@test.com');
    const list = await student.agent.get('/api/v1/resources/kc-magazines');
    expect(list.body.items.map((i: { title: string }) => i.title)).toEqual(['Volume 10', 'Volume 2']); // admin's order, not alphabetical
    expect((await student.agent.get('/api/v1/resources/nope')).status).toBe(400);
    const groups = await student.agent.get('/api/v1/resources');
    expect(groups.body.groups).toEqual([{ group: 'kc-magazines', count: 2 }, { group: 'ssc-previous-years', count: 0 }]);

    const id = list.body.items[0].id;
    expect((await agent.patch(`/api/v1/admin/resources/${id}`).send({ published: false })).status).toBe(200);
    expect((await student.agent.get('/api/v1/resources/kc-magazines')).body.items).toHaveLength(1);
    expect((await agent.delete(`/api/v1/admin/resources/${id}`)).status).toBe(200);
    expect((await agent.delete(`/api/v1/admin/resources/${id}`)).status).toBe(404);
  });

  it('keeps admin routes away from students and resources behind sign-in', async () => {
    const s = await loginAs(app, 'student@test.com');
    expect((await s.agent.post('/api/v1/admin/resources').send({ group: 'kc-magazines', title: 'x', url: 'https://x.com/a.pdf' })).status).toBe(403);
    await s.agent.post('/api/v1/auth/logout');
    expect((await s.agent.get('/api/v1/resources')).status).toBe(401);
  });
});

describe('transcript for students', () => {
  it('returns the verified text in paragraphs, and 404 when not ready or unpublished', async () => {
    const { dictation } = await createDictation({ exerciseNo: 507, text: 'First paragraph here.\n\nSecond paragraph there.' });
    const unready = await createDictation({ exerciseNo: 508, verified: false });
    const hidden = await createDictation({ exerciseNo: 509, published: false });
    const { agent } = await loginAs(app, 'a@test.com');

    const ok = await agent.get(`/api/v1/dictations/${dictation._id}/transcript`);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ exerciseNo: 507, version: 1, paragraphs: ['First paragraph here.', 'Second paragraph there.'] });
    expect((await agent.get(`/api/v1/dictations/${unready.dictation._id}/transcript`)).status).toBe(404);
    expect((await agent.get(`/api/v1/dictations/${hidden.dictation._id}/transcript`)).status).toBe(404);
  });

  it('gives each set a cover video for the home page', async () => {
    await createDictation({ exerciseNo: 507 });
    const { agent } = await loginAs(app, 'a@test.com');
    expect((await agent.get('/api/v1/sets')).body.items[0].coverVideoId).toBe('abc123DEF45');
  });
});

describe('drive folder import', () => {
  const file = (n: number, extra: Partial<{ name: string; mimeType: string }> = {}) => ({ id: `1AbCdEfGhIjKlMnOpQrStUvWx${String(n).padStart(3, '0')}`, name: `Volume ${n}.pdf`, mimeType: 'application/pdf', ...extra });
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const mutableEnv = env as { googleDriveApiKey: string };
  const original = mutableEnv.googleDriveApiKey;

  beforeEach(() => { mutableEnv.googleDriveApiKey = 'test-key'; });
  afterEach(() => { mutableEnv.googleDriveApiKey = original; vi.unstubAllGlobals(); });

  it('reads folder ids from the usual link shapes', () => {
    const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz';
    expect(parseDriveFolderId(`https://drive.google.com/drive/folders/${id}?usp=sharing`)).toBe(id);
    expect(parseDriveFolderId(`https://drive.google.com/drive/u/1/folders/${id}`)).toBe(id);
    expect(parseDriveFolderId(`https://drive.google.com/open?id=${id}`)).toBe(id);
    expect(parseDriveFolderId(id)).toBe(id);
    expect(parseDriveFolderId('https://example.com/nope')).toBeNull();
    expect(parseDriveFolderId('hello world')).toBeNull();
  });

  it('adds every PDF in natural order across pages, skips others, and is safe to run twice', async () => {
    const calls: URL[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: URL) => {
      calls.push(input);
      if (!input.searchParams.get('pageToken')) return json(200, { nextPageToken: 'p2', files: [file(10), file(2), { id: 'folderid00000000000000001', name: 'Old', mimeType: 'application/vnd.google-apps.folder' }] });
      return json(200, { files: [file(1), { id: 'docid000000000000000000001', name: 'Notes', mimeType: 'application/vnd.google-apps.document' }] });
    }));
    const { agent } = await adminAgent();
    const folder = 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz?usp=sharing';

    const first = await agent.post('/api/v1/admin/resources/import-drive-folder').send({ group: 'kc-magazines', folder });
    expect(first.status).toBe(200);
    expect(first.body.created.map((r: { title: string }) => r.title)).toEqual(['Volume 1', 'Volume 2', 'Volume 10']);
    expect(first.body).toMatchObject({ alreadyAdded: 0, skippedNonPdf: 1, subfolders: 1, totalPdfs: 3 });
    expect(first.body.created[0].url).toBe(`https://drive.google.com/file/d/${file(1).id}/view`);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.searchParams.get('q')).toBe("'1AbCdEfGhIjKlMnOpQrStUvWxYz' in parents and trashed = false");
    expect(calls[0]!.searchParams.get('key')).toBe('test-key');

    const again = await agent.post('/api/v1/admin/resources/import-drive-folder').send({ group: 'kc-magazines', folder });
    expect(again.body).toMatchObject({ alreadyAdded: 3, totalPdfs: 3 });
    expect(again.body.created).toHaveLength(0);

    const student = await loginAs(app, 'student@test.com');
    const list = await student.agent.get('/api/v1/resources/kc-magazines');
    expect(list.body.items.map((r: { title: string }) => r.title)).toEqual(['Volume 1', 'Volume 2', 'Volume 10']);
  });

  it('gives clear errors for a missing key, a bad link, an unshared folder and a disabled API', async () => {
    const { agent } = await adminAgent();
    const send = (folder: string) => agent.post('/api/v1/admin/resources/import-drive-folder').send({ group: 'kc-magazines', folder });
    const good = 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz';

    expect((await send('not a link')).status).toBe(400);

    vi.stubGlobal('fetch', vi.fn(async () => json(404, { error: { code: 404, message: 'File not found' } })));
    const notFound = await send(good);
    expect(notFound.status).toBe(400);
    expect(notFound.body.error.message).toContain('Anyone with the link');

    vi.stubGlobal('fetch', vi.fn(async () => json(403, { error: { code: 403, message: 'Google Drive API has not been used in project 123 before or it is disabled.', errors: [{ reason: 'accessNotConfigured' }] } })));
    const disabled = await send(good);
    expect(disabled.status).toBe(502);
    expect(disabled.body.error.message).toContain('Enable');

    vi.stubGlobal('fetch', vi.fn(async () => json(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } })));
    expect((await send(good)).body.error.message).toContain('not valid');

    mutableEnv.googleDriveApiKey = '';
    expect((await send(good)).status).toBe(503);
  });
});
