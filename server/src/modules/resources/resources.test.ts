import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedReferenceData } from '../../db/seed.js';
import { ResourceGroup } from '../../models/index.js';
import { setStorageForTests } from '../../services/storage.js';
import { env } from '../../config/env.js';
import { parseDriveFolderId } from '../../services/drive.js';
import { clearTestData, createDictation, fakeStorage, loginAs, startTestDb, stopTestDb, testApp } from '../../test/helpers.js';

const app = testApp();
beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearTestData);

const adminAgent = () => loginAs(app, 'admin@test.com');

const addGroup = async (agent: Awaited<ReturnType<typeof adminAgent>>['agent'], title: string, extra: Record<string, unknown> = {}) => {
  const r = await agent.post('/api/v1/admin/resource-groups').send({ title, ...extra });
  expect(r.status).toBe(201);
  return r.body.item as { id: string; group: string; title: string };
};

afterEach(() => setStorageForTests(undefined));

describe('resources', () => {
  it('lets an admin add links, and students see only published ones in a sensible order', async () => {
    const { agent } = await adminAgent();
    const kc = await addGroup(agent, 'KC Magazines PDF');
    await addGroup(agent, 'Syllabus');
    const bulk = await agent.post('/api/v1/admin/resources/bulk').send({
      group: kc.group,
      text: ['Volume 10 | https://example.com/v10.pdf', 'Volume 2 | https://example.com/v2.pdf', 'no link here', 'Bad | ftp://x'].join('\n'),
    });
    expect(bulk.status).toBe(200);
    expect(bulk.body.created).toHaveLength(2);
    expect(bulk.body.skipped).toHaveLength(2);

    const hidden = await agent.post('/api/v1/admin/resources').send({ group: kc.group, title: 'Volume 3', url: 'https://example.com/v3.pdf', published: false });
    expect(hidden.status).toBe(201);
    expect((await agent.post('/api/v1/admin/resources').send({ group: kc.group, title: 'x', url: 'javascript:alert(1)' })).status).toBe(400);
    expect((await agent.post('/api/v1/admin/resources').send({ group: 'no-such-group', title: 'x', url: 'https://x.com/a.pdf' })).status).toBe(400);

    const student = await loginAs(app, 'student@test.com');
    const list = await student.agent.get(`/api/v1/resources/${kc.group}`);
    expect(list.body.group).toMatchObject({ group: 'kc-magazines-pdf', title: 'KC Magazines PDF' });
    expect(list.body.items.map((i: { title: string }) => i.title)).toEqual(['Volume 10', 'Volume 2']); // admin's order, not alphabetical
    expect((await student.agent.get('/api/v1/resources/nope')).status).toBe(404);
    const groups = await student.agent.get('/api/v1/resources');
    expect(groups.body.groups.map((g: { group: string; count: number }) => [g.group, g.count])).toEqual([['kc-magazines-pdf', 2], ['syllabus', 0]]);

    const id = list.body.items[0].id;
    expect((await agent.patch(`/api/v1/admin/resources/${id}`).send({ published: false })).status).toBe(200);
    expect((await student.agent.get(`/api/v1/resources/${kc.group}`)).body.items).toHaveLength(1);
    expect((await agent.delete(`/api/v1/admin/resources/${id}`)).status).toBe(200);
    expect((await agent.delete(`/api/v1/admin/resources/${id}`)).status).toBe(404);
  });

  it('keeps admin routes away from students and resources behind sign-in', async () => {
    const s = await loginAs(app, 'student@test.com');
    expect((await s.agent.post('/api/v1/admin/resources').send({ group: 'kc-magazines', title: 'x', url: 'https://x.com/a.pdf' })).status).toBe(403);
    expect((await s.agent.post('/api/v1/admin/resource-groups').send({ title: 'Nope' })).status).toBe(403);
    expect((await s.agent.post('/api/v1/admin/resources/uploads').send({ group: 'x', files: [{ name: 'a.pdf', size: 5 }] })).status).toBe(403);
    await s.agent.post('/api/v1/auth/logout');
    expect((await s.agent.get('/api/v1/resources')).status).toBe(401);
  });
});

describe('resource groups', () => {
  it('starts with the two default groups on a fresh database', async () => {
    await ResourceGroup.deleteMany({});
    await seedReferenceData();
    expect((await ResourceGroup.find().sort({ order: 1 }).lean()).map((g) => g.slug)).toEqual(['kc-magazines', 'ssc-previous-years']);
    await ResourceGroup.updateOne({ slug: 'kc-magazines' }, { title: 'Renamed' });
    await seedReferenceData(); // never overwrites what an admin changed
    expect((await ResourceGroup.findOne({ slug: 'kc-magazines' }).lean())?.title).toBe('Renamed');
  });

  it('creates a group with a clean address, even when names repeat', async () => {
    const { agent } = await adminAgent();
    const a = await addGroup(agent, "Previous Years' Papers!", { blurb: 'Old papers' });
    const b = await addGroup(agent, "Previous Years' Papers!");
    expect([a.group, b.group]).toEqual(['previous-years-papers', 'previous-years-papers-2']);
    expect((await addGroup(agent, '!!!')).group).toBe('group');
    expect((await agent.post('/api/v1/admin/resource-groups').send({ title: '   ' })).status).toBe(400);
    expect((await agent.post('/api/v1/admin/resource-groups').send({ title: 'x'.repeat(81) })).status).toBe(400);
  });

  it('renames, hides and deletes a group, but never one that still holds files', async () => {
    const { agent } = await adminAgent();
    const g = await addGroup(agent, 'Announcements');
    await agent.post('/api/v1/admin/resources').send({ group: g.group, title: 'Notice', url: 'https://example.com/n.pdf' });

    const renamed = await agent.patch(`/api/v1/admin/resource-groups/${g.id}`).send({ title: 'News', blurb: 'Latest notices' });
    expect(renamed.body.item).toMatchObject({ group: 'announcements', title: 'News', blurb: 'Latest notices', count: 1 }); // the address stays

    const student = await loginAs(app, 'student@test.com');
    await agent.patch(`/api/v1/admin/resource-groups/${g.id}`).send({ published: false });
    expect((await student.agent.get('/api/v1/resources')).body.groups).toEqual([]);
    expect((await student.agent.get('/api/v1/resources/announcements')).status).toBe(404);

    const blocked = await agent.delete(`/api/v1/admin/resource-groups/${g.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toContain('1 file');
    const file = (await agent.get('/api/v1/admin/resources?group=announcements')).body.items[0];
    await agent.delete(`/api/v1/admin/resources/${file.id}`);
    expect((await agent.delete(`/api/v1/admin/resource-groups/${g.id}`)).status).toBe(200);
    expect((await agent.delete(`/api/v1/admin/resource-groups/${g.id}`)).status).toBe(404);
    expect((await agent.get('/api/v1/admin/resource-groups')).body.items).toEqual([]);
  });
});

describe('uploading PDFs', () => {
  const start = async (agent: Awaited<ReturnType<typeof adminAgent>>['agent'], group: string, files: { name: string; size: number }[]) =>
    agent.post('/api/v1/admin/resources/uploads').send({ group, files });

  it('is refused with a clear message when storage is not set up', async () => {
    setStorageForTests(null);
    const { agent } = await adminAgent();
    const g = await addGroup(agent, 'Syllabus');
    const r = await start(agent, g.group, [{ name: 'a.pdf', size: 10 }]);
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('UPLOADS_DISABLED');
  });

  it('hands out upload addresses, then adds the finished files in the order given', async () => {
    const { storage, browserUpload, files } = fakeStorage();
    setStorageForTests(storage);
    const { agent } = await adminAgent();
    const g = await addGroup(agent, 'Syllabus');

    const r = await start(agent, g.group, [{ name: 'Volume 2 (final).pdf', size: 100 }, { name: 'Volume 10.PDF', size: 200 }]);
    expect(r.status).toBe(200);
    const [v2, v10] = r.body.uploads as { name: string; key: string; uploadUrl: string; contentType: string }[];
    expect(v2!.key).toMatch(/^resources\/syllabus\/[0-9a-f-]{36}\/Volume-2-final.pdf$/);
    expect(v10!.key).toMatch(/\/Volume-10\.pdf$/);
    expect(v2).toMatchObject({ contentType: 'application/pdf' });
    expect(v2!.uploadUrl).toContain('upload.test');

    browserUpload(v2!.key);
    browserUpload(v10!.key, 'x'.repeat(50));
    const done = await agent.post('/api/v1/admin/resources/uploads/complete').send({ group: g.group, files: [{ key: v2!.key, title: 'Volume 2' }, { key: v10!.key, title: 'Volume 10' }] });
    expect(done.status).toBe(200);
    expect(done.body.failed).toEqual([]);
    expect(done.body.created.map((c: { title: string; uploaded: boolean; size: number; url: string }) => [c.title, c.uploaded, c.size, c.url])).toEqual([
      ['Volume 2', true, 13, `https://files.test/${v2!.key}`],
      ['Volume 10', true, 50, `https://files.test/${v10!.key}`],
    ]);

    const student = await loginAs(app, 's@test.com');
    const list = await student.agent.get('/api/v1/resources/syllabus');
    expect(list.body.items.map((i: { title: string }) => i.title)).toEqual(['Volume 2', 'Volume 10']);

    // Deleting the resource deletes the stored file too.
    await agent.delete(`/api/v1/admin/resources/${list.body.items[0].id}`);
    expect(files.has(v2!.key)).toBe(false);
    expect(files.has(v10!.key)).toBe(true);
  });

  it('refuses non-PDFs, oversized files and unknown groups before handing out anything', async () => {
    setStorageForTests(fakeStorage().storage);
    const { agent } = await adminAgent();
    const g = await addGroup(agent, 'Syllabus');
    const notPdf = await start(agent, g.group, [{ name: 'notes.docx', size: 10 }]);
    expect(notPdf.status).toBe(400);
    expect(notPdf.body.error.message).toContain('not a PDF');
    expect((await start(agent, g.group, [{ name: 'big.pdf', size: 201 * 1024 * 1024 }])).status).toBe(400);
    expect((await start(agent, g.group, [{ name: 'empty.pdf', size: 0 }])).status).toBe(400);
    expect((await start(agent, g.group, [])).status).toBe(400);
    expect((await start(agent, 'nope', [{ name: 'a.pdf', size: 5 }])).status).toBe(400);
  });

  it('does not add a file that never arrived, was already added, or was not issued by us', async () => {
    const { storage, browserUpload } = fakeStorage();
    setStorageForTests(storage);
    const { agent } = await adminAgent();
    const g = await addGroup(agent, 'Syllabus');
    const other = await addGroup(agent, 'Other');
    const [u] = (await start(agent, g.group, [{ name: 'a.pdf', size: 5 }])).body.uploads as { key: string }[];

    const missing = await agent.post('/api/v1/admin/resources/uploads/complete').send({ group: g.group, files: [{ key: u!.key }] });
    expect(missing.body.created).toEqual([]);
    expect(missing.body.failed[0].reason).toContain('did not finish');

    browserUpload(u!.key);
    expect((await agent.post('/api/v1/admin/resources/uploads/complete').send({ group: g.group, files: [{ key: u!.key }] })).body.created).toHaveLength(1);
    const again = await agent.post('/api/v1/admin/resources/uploads/complete').send({ group: g.group, files: [{ key: u!.key }] });
    expect(again.body.failed[0].reason).toBe('Already added');

    // A key from another group, or one made up, is not accepted.
    const wrong = await agent.post('/api/v1/admin/resources/uploads/complete').send({ group: other.group, files: [{ key: u!.key }, { key: 'avatars/x/y.webp' }, { key: '../../etc/passwd' }] });
    expect(wrong.body.created).toEqual([]);
    expect(wrong.body.failed).toHaveLength(3);
  });

  it('removes an oversized object that got through, and gives an uploaded file no link to edit', async () => {
    const { storage, browserUpload, files } = fakeStorage();
    setStorageForTests(storage);
    const { agent } = await adminAgent();
    const g = await addGroup(agent, 'Syllabus');
    const [u] = (await start(agent, g.group, [{ name: 'a.pdf', size: 5 }])).body.uploads as { key: string }[];
    browserUpload(u!.key, Buffer.alloc(1)); // pretend it is small
    const ok = await agent.post('/api/v1/admin/resources/uploads/complete').send({ group: g.group, files: [{ key: u!.key }] });
    const id = ok.body.created[0].id;
    expect((await agent.patch(`/api/v1/admin/resources/${id}`).send({ url: 'https://evil.example/x.pdf' })).status).toBe(400);
    expect((await agent.patch(`/api/v1/admin/resources/${id}`).send({ title: 'Renamed' })).status).toBe(200);

    const [big] = (await start(agent, g.group, [{ name: 'b.pdf', size: 5 }])).body.uploads as { key: string }[];
    files.set(big!.key, { body: { length: 201 * 1024 * 1024 } as unknown as Buffer, type: 'application/pdf' });
    const r = await agent.post('/api/v1/admin/resources/uploads/complete').send({ group: g.group, files: [{ key: big!.key }] });
    expect(r.body.failed[0].reason).toBe('Over 200 MB');
    expect(files.has(big!.key)).toBe(false);
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

  beforeEach(async () => {
    mutableEnv.googleDriveApiKey = 'test-key';
    await ResourceGroup.create({ slug: 'kc-magazines', title: 'KC Magazines PDF' });
  });
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
