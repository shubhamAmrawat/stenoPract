import request from 'supertest';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setStorageForTests } from '../../services/storage.js';
import { clearTestData, fakeStorage, loginAs, startTestDb, stopTestDb, testApp } from '../../test/helpers.js';

const app = testApp();

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearTestData);
afterEach(() => setStorageForTests(undefined));

const photo = (w = 900, h = 600) => sharp({ create: { width: w, height: h, channels: 3, background: '#d33' } }).jpeg().toBuffer();
const upload = (agent: ReturnType<typeof request.agent>, body: Buffer | string, type = 'image/jpeg') =>
  agent.put('/api/v1/me/avatar').set('Content-Type', type).send(body);

describe('colour theme', () => {
  it('is unset until the student picks one', async () => {
    const { agent } = await loginAs(app, 't@test.com');
    expect((await agent.get('/api/v1/auth/me')).body.user.theme).toBeNull();
  });

  it('saves the chosen theme and returns it on the next visit', async () => {
    const { agent } = await loginAs(app, 't@test.com');
    const res = await agent.patch('/api/v1/me/profile').send({ theme: 'forest' });
    expect(res.status).toBe(200);
    expect(res.body.user.theme).toBe('forest');
    expect((await agent.get('/api/v1/auth/me')).body.user.theme).toBe('forest');
    const again = await loginAs(app, 't@test.com');
    expect((await again.agent.get('/api/v1/auth/me')).body.user.theme).toBe('forest');
  });

  it('can be changed without touching anything else', async () => {
    const { agent } = await loginAs(app, 't@test.com', 'Asha');
    await agent.patch('/api/v1/me/profile').send({ name: 'Asha Verma', bio: 'Hello' });
    const res = await agent.patch('/api/v1/me/profile').send({ theme: 'plum' });
    expect(res.body.user).toMatchObject({ theme: 'plum', name: 'Asha Verma', bio: 'Hello' });
  });

  it('is kept per student', async () => {
    const a = await loginAs(app, 'a@test.com');
    const b = await loginAs(app, 'b@test.com');
    await a.agent.patch('/api/v1/me/profile').send({ theme: 'slate' });
    expect((await b.agent.get('/api/v1/auth/me')).body.user.theme).toBeNull();
  });

  it('rejects a theme that does not exist', async () => {
    const { agent } = await loginAs(app, 't@test.com');
    expect((await agent.patch('/api/v1/me/profile').send({ theme: 'neon' })).status).toBe(400);
    expect((await agent.patch('/api/v1/me/profile').send({ theme: '' })).status).toBe(400);
    expect((await agent.get('/api/v1/auth/me')).body.user.theme).toBeNull();
  });
});

describe('profile name', () => {
  it('needs a session', async () => {
    expect((await request(app).patch('/api/v1/me/profile').send({ name: 'X' })).status).toBe(401);
  });

  it('changes the name and trims it', async () => {
    const { agent } = await loginAs(app, 'n@test.com', 'Google Name');
    const res = await agent.patch('/api/v1/me/profile').send({ name: '  Asha Verma  ' });
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe('Asha Verma');
    expect((await agent.get('/api/v1/auth/me')).body.user.name).toBe('Asha Verma');
  });

  it('rejects an empty or very long name', async () => {
    const { agent } = await loginAs(app, 'n@test.com');
    expect((await agent.patch('/api/v1/me/profile').send({ name: '   ' })).status).toBe(400);
    expect((await agent.patch('/api/v1/me/profile').send({ name: 'x'.repeat(81) })).status).toBe(400);
    expect((await agent.patch('/api/v1/me/profile').send({})).status).toBe(400);
  });

  it('a later Google sign-in does not undo a name the student chose', async () => {
    const first = await loginAs(app, 'n@test.com', 'Google Name');
    await first.agent.patch('/api/v1/me/profile').send({ name: 'My Own Name' });
    const again = await loginAs(app, 'n@test.com', 'Google Name Again');
    expect((await again.agent.get('/api/v1/auth/me')).body.user.name).toBe('My Own Name');
  });

  it('still follows Google until the student edits it', async () => {
    await loginAs(app, 'n@test.com', 'Old Google Name');
    const again = await loginAs(app, 'n@test.com', 'New Google Name');
    expect((await again.agent.get('/api/v1/auth/me')).body.user.name).toBe('New Google Name');
  });

  it('saves phone, gender and bio, and clears them when sent empty', async () => {
    const { agent } = await loginAs(app, 'n@test.com');
    const ok = await agent.patch('/api/v1/me/profile').send({ phone: ' +91 98765 43210 ', gender: 'female', bio: '  Preparing for SSC Steno.  ' });
    expect(ok.status).toBe(200);
    expect(ok.body.user).toMatchObject({ phone: '+91 98765 43210', gender: 'female', bio: 'Preparing for SSC Steno.' });
    expect(ok.body.user.name).toBe('n'); // untouched, and still follows Google
    const part = await agent.patch('/api/v1/me/profile').send({ bio: 'Only the bio changed' });
    expect(part.body.user).toMatchObject({ phone: '+91 98765 43210', gender: 'female', bio: 'Only the bio changed' });
    const cleared = await agent.patch('/api/v1/me/profile').send({ phone: '', gender: '', bio: '' });
    expect(cleared.body.user).toMatchObject({ phone: null, gender: null, bio: null });
  });

  it('rejects a bad phone number, gender or long bio', async () => {
    const { agent } = await loginAs(app, 'n@test.com');
    for (const bad of [{ phone: 'abc' }, { phone: '12' }, { phone: '1'.repeat(30) }, { gender: 'robot' }, { bio: 'x'.repeat(201) }]) {
      expect((await agent.patch('/api/v1/me/profile').send(bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it('shows account details', async () => {
    const { agent } = await loginAs(app, 'n@test.com');
    const { user } = (await agent.get('/api/v1/auth/me')).body;
    expect(user.signInMethod).toBe('google');
    expect(new Date(user.memberSince).getTime()).toBeLessThanOrEqual(Date.now());
    expect(user.hasCustomPhoto).toBe(false);
  });
});

describe('profile photo', () => {
  it('is refused with a clear message when uploads are not set up', async () => {
    setStorageForTests(null);
    const { agent } = await loginAs(app, 'p@test.com');
    expect((await agent.get('/api/v1/auth/me')).body.user.canUploadPhoto).toBe(false);
    const res = await upload(agent, await photo());
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('UPLOADS_DISABLED');
  });

  it('stores a 512 px square WebP and shows it as the picture', async () => {
    const { files, storage } = fakeStorage();
    setStorageForTests(storage);
    const { agent, user } = await loginAs(app, 'p@test.com');
    const res = await upload(agent, await photo(900, 600));
    expect(res.status).toBe(200);
    expect(res.body.user.hasCustomPhoto).toBe(true);
    expect(res.body.user.canUploadPhoto).toBe(true);
    expect(res.body.user.picture).toMatch(new RegExp(`^https://files\\.test/avatars/${user.id}/[0-9a-f-]{36}\\.webp$`));

    expect(files.size).toBe(1);
    const [stored] = [...files.values()];
    expect(stored!.type).toBe('image/webp');
    const meta = await sharp(stored!.body).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 512, 512]);
    expect((await agent.get('/api/v1/auth/me')).body.user.picture).toBe(res.body.user.picture);
  });

  it('a new photo replaces the old one and the old file is deleted', async () => {
    const { files, storage } = fakeStorage();
    setStorageForTests(storage);
    const { agent } = await loginAs(app, 'p@test.com');
    const a = await upload(agent, await photo());
    const b = await upload(agent, await photo(300, 300));
    expect(a.body.user.picture).not.toBe(b.body.user.picture);
    expect(files.size).toBe(1);
    expect([...files.keys()][0]).toBe(new URL(b.body.user.picture).pathname.slice(1));
  });

  it('refuses things that are not a photo', async () => {
    const { files, storage } = fakeStorage();
    setStorageForTests(storage);
    const { agent } = await loginAs(app, 'p@test.com');
    // Claims to be a JPEG but is text; and an SVG (can carry scripts); and a wrong content type; and nothing at all.
    expect((await upload(agent, 'not an image at all')).body.error.code).toBe('INVALID_IMAGE');
    expect((await upload(agent, '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>', 'image/png')).status).toBe(400);
    expect((await upload(agent, await photo(), 'application/pdf')).status).toBe(415);
    expect((await upload(agent, '')).status).toBe(415);
    expect(files.size).toBe(0);
  });

  it('refuses an oversized upload', async () => {
    const { storage } = fakeStorage();
    setStorageForTests(storage);
    const { agent } = await loginAs(app, 'p@test.com');
    const res = await upload(agent, Buffer.alloc(2 * 1024 * 1024 + 10, 1));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('TOO_LARGE');
  });

  it('needs a session', async () => {
    setStorageForTests(fakeStorage().storage);
    const res = await request(app).put('/api/v1/me/avatar').set('Content-Type', 'image/jpeg').send(await photo());
    expect(res.status).toBe(401);
  });

  it('each student has a photo of their own', async () => {
    const { files, storage } = fakeStorage();
    setStorageForTests(storage);
    const a = await loginAs(app, 'a@test.com');
    const b = await loginAs(app, 'b@test.com');
    await upload(a.agent, await photo());
    await upload(b.agent, await photo(400, 400));
    expect(files.size).toBe(2);
    expect((await a.agent.get('/api/v1/auth/me')).body.user.picture).not.toBe((await b.agent.get('/api/v1/auth/me')).body.user.picture);
  });
});
