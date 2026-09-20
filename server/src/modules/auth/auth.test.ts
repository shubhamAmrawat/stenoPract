import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearTestData, loginAs, startTestDb, stopTestDb, testApp } from '../../test/helpers.js';

const app = testApp();

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearTestData);

describe('auth', () => {
  it('health is public', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.db).toBe('connected');
  });

  it('protected routes need a session', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('dev login creates a session cookie that is httpOnly', async () => {
    const res = await request(app).post('/api/v1/auth/dev-login').send({ email: 'Friend@Test.com' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: 'friend@test.com', role: 'user' });
    const cookie = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(cookie).toContain('steno.sid=');
    expect(cookie.toLowerCase()).toContain('httponly');
  });

  it('me returns the signed-in user; logout ends the session', async () => {
    const { agent } = await loginAs(app, 'a@test.com');
    expect((await agent.get('/api/v1/auth/me')).body.user.email).toBe('a@test.com');
    expect((await agent.post('/api/v1/auth/logout')).status).toBe(200);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('emails listed in ADMIN_EMAILS become admins', async () => {
    const { user } = await loginAs(app, 'admin@test.com');
    expect(user.role).toBe('admin');
  });

  it('updates exam settings and rejects unknown profiles', async () => {
    const { agent } = await loginAs(app, 'a@test.com');
    const ok = await agent.patch('/api/v1/me/settings').send({ examProfile: 'ssc_d', category: 'reserved' });
    expect(ok.body.user.settings).toEqual({ examProfile: 'SSC_D', category: 'reserved' });
    expect((await agent.patch('/api/v1/me/settings').send({ examProfile: 'NOPE' })).status).toBe(400);
    expect((await agent.patch('/api/v1/me/settings').send({ category: 'other' })).status).toBe(400);
  });

  it('google sign-in is refused when not configured / token invalid', async () => {
    const res = await request(app).post('/api/v1/auth/google').send({ credential: 'x'.repeat(30) });
    expect(res.status).toBe(503);
    const bad = await request(app).post('/api/v1/auth/google').send({});
    expect(bad.status).toBe(400);
  });

  it('blocks state-changing requests from a foreign Origin', async () => {
    const res = await request(app).post('/api/v1/auth/logout').set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
    const ok = await request(app).post('/api/v1/auth/logout').set('Origin', 'http://localhost:5173');
    expect(ok.status).toBe(200);
  });

  it('unknown routes return a JSON 404', async () => {
    const { agent } = await loginAs(app, 'a@test.com');
    const res = await agent.get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
