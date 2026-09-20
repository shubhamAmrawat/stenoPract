import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isEmailAllowed } from '../../services/access.js';
import { clearTestData, loginAs, startTestDb, stopTestDb, testApp } from '../../test/helpers.js';

const app = testApp();

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearTestData);

const closeSignup = (agent: ReturnType<typeof request.agent>) => agent.put('/api/v1/admin/access/settings').send({ signupOpen: false });

const cfg = (over: Partial<{ adminEmails: string[]; allowedEmails: string[]; signupOpen: boolean }> = {}) => ({ adminEmails: ['admin@test.com'], allowedEmails: [], ...over });

describe('access control', () => {
  it('when invite-only, only admins, listed emails and invited emails are allowed', async () => {
    expect(await isEmailAllowed('anyone@test.com', cfg())).toBe(false);
    expect(await isEmailAllowed('admin@test.com', cfg())).toBe(true);
    expect(await isEmailAllowed('listed@test.com', cfg({ allowedEmails: ['listed@test.com'] }))).toBe(true);
    const { agent } = await loginAs(app, 'admin@test.com');
    await agent.post('/api/v1/admin/access').send({ emails: ['friend@test.com'] });
    expect(await isEmailAllowed('Friend@Test.com', cfg())).toBe(true);
    expect(await isEmailAllowed('anyone@test.com', cfg())).toBe(false);
  });

  it('when sign-up is open, everyone is allowed', async () => {
    expect(await isEmailAllowed('anyone@test.com', cfg({ signupOpen: true }))).toBe(true);
  });

  it('a non-invited email gets NOT_INVITED, an invited one signs in', async () => {
    const { agent } = await loginAs(app, 'admin@test.com');
    await closeSignup(agent);
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
    await closeSignup(agent);
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

describe('open sign-up and student management', () => {
  it('sign-up is open by default, so anyone can join without an invite', async () => {
    const { agent } = await loginAs(app, 'admin@test.com');
    expect((await agent.get('/api/v1/admin/access')).body).toMatchObject({ signupOpen: true, inviteOnly: false });
    expect((await request(app).post('/api/v1/auth/dev-login').send({ email: 'stranger@test.com' })).status).toBe(200);
      });

  it('an admin can close and reopen sign-up', async () => {
    const { agent } = await loginAs(app, 'admin@test.com');
    expect((await closeSignup(agent)).body).toEqual({ signupOpen: false });
    expect((await agent.get('/api/v1/admin/access')).body.signupOpen).toBe(false);
    expect((await request(app).post('/api/v1/auth/dev-login').send({ email: 'stranger@test.com' })).status).toBe(403);
    await agent.put('/api/v1/admin/access/settings').send({ signupOpen: true });
    expect((await request(app).post('/api/v1/auth/dev-login').send({ email: 'stranger@test.com' })).status).toBe(200);
  });

  it('a removed person stays blocked even while sign-up is open', async () => {
    const { agent: admin } = await loginAs(app, 'admin@test.com');
    const { agent: friend } = await loginAs(app, 'friend@test.com');
    expect((await admin.delete('/api/v1/admin/access/friend%40test.com')).status).toBe(200);
    expect((await friend.get('/api/v1/auth/me')).status).toBe(401);
    const again = await request(app).post('/api/v1/auth/dev-login').send({ email: 'friend@test.com' });
    expect(again.status).toBe(403);
    expect(again.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('signing someone out ends their sessions but lets them sign back in', async () => {
    const { agent: admin } = await loginAs(app, 'admin@test.com');
    const { agent: friend } = await loginAs(app, 'friend@test.com');
    const { agent: friendPhone } = await loginAs(app, 'friend@test.com');
    expect((await admin.post('/api/v1/admin/access/friend%40test.com/signout')).status).toBe(200);
    expect((await friend.get('/api/v1/auth/me')).status).toBe(401);
    expect((await friendPhone.get('/api/v1/auth/me')).status).toBe(401);
    const back = await loginAs(app, 'friend@test.com');
    expect((await back.agent.get('/api/v1/auth/me')).status).toBe(200);
  });

  it('cannot sign yourself out from the list, unknown emails are 404, and only admins may', async () => {
    const { agent } = await loginAs(app, 'admin@test.com');
    expect((await agent.post('/api/v1/admin/access/admin%40test.com/signout')).status).toBe(400);
    expect((await agent.post('/api/v1/admin/access/ghost%40test.com/signout')).status).toBe(404);
    const { agent: plain } = await loginAs(app, 'plain@test.com');
    expect((await plain.post('/api/v1/admin/access/admin%40test.com/signout')).status).toBe(403);
    expect((await plain.put('/api/v1/admin/access/settings').send({ signupOpen: false })).status).toBe(403);
  });

  it('lists how each person signs in', async () => {
    const { agent } = await loginAs(app, 'admin@test.com');
    await request(app).post('/api/v1/auth/signup').send({ name: 'Pass Word', email: 'pw@test.com', password: 'a-long-enough-pass' });
    await agent.post('/api/v1/admin/access').send({ emails: ['pending@test.com'] });
    const by = Object.fromEntries((await agent.get('/api/v1/admin/access')).body.members.map((m: { email: string }) => [m.email, m]));
    expect(by['pw@test.com']).toMatchObject({ method: 'password', status: 'active', name: 'Pass Word' });
    expect(by['admin@test.com'].method).toBe('google');
    expect(by['pending@test.com'].method).toBeNull();
  });
});
