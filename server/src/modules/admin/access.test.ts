import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isEmailAllowed } from '../../services/access.js';
import { clearTestData, loginAs, startTestDb, stopTestDb, testApp } from '../../test/helpers.js';

const app = testApp();

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearTestData);

const cfg = (over: Partial<{ isProd: boolean; adminEmails: string[]; allowedEmails: string[] }> = {}) => ({ isProd: false, adminEmails: ['admin@test.com'], allowedEmails: [], ...over });

describe('access control', () => {
  it('is open locally until the first invite, then invite-only', async () => {
    expect(await isEmailAllowed('anyone@test.com', cfg())).toBe(true);
    const { agent } = await loginAs(app, 'admin@test.com');
    await agent.post('/api/v1/admin/access').send({ emails: ['friend@test.com'] });
    expect(await isEmailAllowed('anyone@test.com', cfg())).toBe(false);
    expect(await isEmailAllowed('Friend@Test.com', cfg())).toBe(true);
    expect(await isEmailAllowed('admin@test.com', cfg())).toBe(true);
  });

  it('production is closed even with nothing configured', async () => {
    expect(await isEmailAllowed('anyone@test.com', cfg({ isProd: true }))).toBe(false);
    expect(await isEmailAllowed('admin@test.com', cfg({ isProd: true }))).toBe(true);
    expect(await isEmailAllowed('listed@test.com', cfg({ isProd: true, allowedEmails: ['listed@test.com'] }))).toBe(true);
  });

  it('a non-invited email gets NOT_INVITED, an invited one signs in', async () => {
    const { agent } = await loginAs(app, 'admin@test.com');
    await agent.post('/api/v1/admin/access').send({ emails: ['friend@test.com'] });
    const no = await request(app).post('/api/v1/auth/dev-login').send({ email: 'stranger@test.com' });
    expect(no.status).toBe(403);
    expect(no.body.error.code).toBe('NOT_INVITED');
    expect(no.body.error.message).toContain('stranger@test.com');
    expect((await request(app).post('/api/v1/auth/dev-login').send({ email: 'friend@test.com' })).status).toBe(200);
  });

  it('invites several emails, lowercases, and reports duplicates and invalid ones', async () => {
    const { agent } = await loginAs(app, 'admin@test.com');
    const res = await agent.post('/api/v1/admin/access').send({ emails: ['A@Test.com', 'a@test.com', 'b@test.com', 'nope'] });
    expect(res.body).toEqual({ invited: ['a@test.com', 'b@test.com'], already: [], invalid: ['nope'] });
    const again = await agent.post('/api/v1/admin/access').send({ emails: ['a@test.com'] });
    expect(again.body.already).toEqual(['a@test.com']);
  });

  it('lists members with statuses', async () => {
    const { agent } = await loginAs(app, 'admin@test.com');
    await agent.post('/api/v1/admin/access').send({ emails: ['pending@test.com', 'joined@test.com'] });
    await request(app).post('/api/v1/auth/dev-login').send({ email: 'joined@test.com', name: 'Joined' });
    const res = await agent.get('/api/v1/admin/access');
    expect(res.body.inviteOnly).toBe(true);
    const by = Object.fromEntries(res.body.members.map((m: { email: string }) => [m.email, m]));
    expect(by['joined@test.com']).toMatchObject({ status: 'active', name: 'Joined' });
    expect(by['pending@test.com']).toMatchObject({ status: 'invited', name: null });
    expect(by['admin@test.com']).toMatchObject({ role: 'admin', locked: 'admin', status: 'active' });
  });

  it('removing access blocks sign-in and ends an open session; re-inviting restores it', async () => {
    const { agent: admin } = await loginAs(app, 'admin@test.com');
    await admin.post('/api/v1/admin/access').send({ emails: ['friend@test.com'] });
    const { agent: friend } = await loginAs(app, 'friend@test.com');
    expect((await friend.get('/api/v1/auth/me')).status).toBe(200);

    expect((await admin.delete('/api/v1/admin/access/friend%40test.com')).status).toBe(200);
    expect((await friend.get('/api/v1/auth/me')).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/dev-login').send({ email: 'friend@test.com' })).status).toBe(403);
    const listed = await admin.get('/api/v1/admin/access');
    expect(listed.body.members.find((m: { email: string }) => m.email === 'friend@test.com').status).toBe('removed');

    await admin.post('/api/v1/admin/access').send({ emails: ['friend@test.com'] });
    expect((await request(app).post('/api/v1/auth/dev-login').send({ email: 'friend@test.com' })).status).toBe(200);
  });

  it('cannot remove yourself or an admin, and unknown emails are 404', async () => {
    const { agent } = await loginAs(app, 'admin@test.com');
    expect((await agent.delete('/api/v1/admin/access/admin%40test.com')).status).toBe(400);
    expect((await agent.delete('/api/v1/admin/access/ghost%40test.com')).status).toBe(404);
  });

  it('only admins can manage access', async () => {
    const { agent } = await loginAs(app, 'plain@test.com');
    expect((await agent.get('/api/v1/admin/access')).status).toBe(403);
    expect((await agent.post('/api/v1/admin/access').send({ emails: ['x@test.com'] })).status).toBe(403);
    expect((await agent.delete('/api/v1/admin/access/x%40test.com')).status).toBe(403);
  });
});
