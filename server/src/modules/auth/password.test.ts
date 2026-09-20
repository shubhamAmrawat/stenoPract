import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { User } from '../../models/index.js';
import { hashPassword, passwordProblem, verifyPassword } from '../../services/password.js';
import { clearTestData, loginAs, startTestDb, stopTestDb, testApp } from '../../test/helpers.js';

const app = testApp();

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearTestData);

const GOOD = 'a-long-enough-pass';
const signup = (over: Record<string, unknown> = {}) =>
  request(app).post('/api/v1/auth/signup').send({ name: 'Riya', email: 'riya@test.com', password: GOOD, ...over });
const login = (email: string, password: string) => request(app).post('/api/v1/auth/login').send({ email, password });

describe('password hashing', () => {
  it('verifies the right password only, and never stores it in plain text', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(hash).not.toContain('correct horse');
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('correct horse batterx', hash)).toBe(false);
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
  });

  it('gives a different hash each time (random salt)', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('rejects short, common and email-like passwords', () => {
    expect(passwordProblem('short')).toMatch(/at least 8/);
    expect(passwordProblem('password123')).toMatch(/too common/);
    expect(passwordProblem('riya@test.com', 'riya@test.com')).toMatch(/email/);
    expect(passwordProblem('aaaaaaaaaa')).toMatch(/repeated/);
    expect(passwordProblem('x'.repeat(129))).toMatch(/at most 128/);
    expect(passwordProblem(GOOD)).toBeNull();
  });
});

describe('create account', () => {
  it('creates the account, signs the person in, and hides the hash', async () => {
    const res = await signup();
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'riya@test.com', name: 'Riya', role: 'user' });
    expect(JSON.stringify(res.body)).not.toContain('scrypt');
    const cookie = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(cookie).toContain('steno.sid=');
    const stored = await User.findOne({ email: 'riya@test.com' }).lean();
    expect(stored?.passwordHash?.startsWith('scrypt$')).toBe(true);
    expect(stored?.googleId).toBeUndefined();
  });

  it('several password accounts can exist side by side (no Google id needed)', async () => {
    expect((await signup({ email: 'a@test.com' })).status).toBe(201);
    expect((await signup({ email: 'b@test.com' })).status).toBe(201);
  });

  it('keeps the session: /me works after sign-up', async () => {
    const agent = request.agent(app);
    await agent.post('/api/v1/auth/signup').send({ name: 'Riya', email: 'riya@test.com', password: GOOD });
    expect((await agent.get('/api/v1/auth/me')).body.user.email).toBe('riya@test.com');
  });

  it('normalises the email and refuses a second account with it', async () => {
    expect((await signup({ email: 'Riya@Test.com' })).body.user.email).toBe('riya@test.com');
    const again = await signup({ email: 'RIYA@test.com' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('points Google accounts to the Google button', async () => {
    await loginAs(app, 'goog@test.com');
    const res = await signup({ email: 'goog@test.com' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/Google/);
  });

  it('validates name, email and password', async () => {
    expect((await signup({ name: '  ' })).status).toBe(400);
    expect((await signup({ email: 'nope' })).status).toBe(400);
    const weak = await signup({ password: 'short' });
    expect(weak.status).toBe(400);
    expect(weak.body.error.message).toMatch(/at least 8/);
  });

  it('is refused for the owner emails: they must use Google', async () => {
    const res = await signup({ email: 'admin@test.com' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('USE_GOOGLE');
    expect(await User.countDocuments({ email: 'admin@test.com' })).toBe(0);
  });

  it('respects the invite-only switch', async () => {
    const { agent } = await loginAs(app, 'admin@test.com');
    await agent.put('/api/v1/admin/access/settings').send({ signupOpen: false });
    const res = await signup();
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_INVITED');
    await agent.post('/api/v1/admin/access').send({ emails: ['riya@test.com'] });
    expect((await signup()).status).toBe(201);
  });
});

describe('sign in with email and password', () => {
  beforeEach(async () => {
    await signup();
  });

  it('signs in with the right password, any email casing', async () => {
    const agent = request.agent(app);
    const res = await agent.post('/api/v1/auth/login').send({ email: 'RIYA@test.com', password: GOOD });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('riya@test.com');
    expect((await agent.get('/api/v1/auth/me')).status).toBe(200);
  });

  it('gives the same answer for a wrong password, an unknown email and a Google-only account', async () => {
    await loginAs(app, 'goog@test.com');
    const answers = await Promise.all([login('riya@test.com', 'wrong-password-1'), login('nobody@test.com', GOOD), login('goog@test.com', GOOD)]);
    for (const r of answers) {
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe('INVALID_CREDENTIALS');
    }
    expect(new Set(answers.map((r) => r.body.error.message)).size).toBe(1);
  });

  it('locks the account for a while after too many wrong passwords, then a right one still waits', async () => {
    for (let i = 0; i < 8; i++) expect((await login('riya@test.com', `wrong-${i}-password`)).status).toBe(401);
    const locked = await login('riya@test.com', GOOD);
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
    await User.updateOne({ email: 'riya@test.com' }, { $set: { lockedUntil: new Date(Date.now() - 1000) } });
    expect((await login('riya@test.com', GOOD)).status).toBe(200);
  });

  it('a right password resets the wrong-password counter', async () => {
    for (let i = 0; i < 5; i++) await login('riya@test.com', `wrong-${i}-password`);
    expect((await login('riya@test.com', GOOD)).status).toBe(200);
    expect((await User.findOne({ email: 'riya@test.com' }).lean())?.failedLogins).toBe(0);
    for (let i = 0; i < 5; i++) await login('riya@test.com', `wrong-${i}-password`);
    expect((await login('riya@test.com', GOOD)).status).toBe(200);
  });

  it('refuses a removed account with a clear message', async () => {
    const { agent } = await loginAs(app, 'admin@test.com');
    await agent.delete('/api/v1/admin/access/riya%40test.com');
    const res = await login('riya@test.com', GOOD);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('a wrong password never changes the session of someone already signed in', async () => {
    const agent = request.agent(app);
    await agent.post('/api/v1/auth/login').send({ email: 'riya@test.com', password: GOOD });
    await agent.post('/api/v1/auth/login').send({ email: 'riya@test.com', password: 'nope-nope-nope' });
    expect((await agent.get('/api/v1/auth/me')).status).toBe(200);
  });
});

describe('Google and password accounts for the same email', () => {
  it('Google sign-in takes over a password account: the old password stops working and its sessions end', async () => {
    const attacker = request.agent(app);
    await attacker.post('/api/v1/auth/signup').send({ name: 'Not Riya', email: 'riya@test.com', password: GOOD });
    expect((await attacker.get('/api/v1/auth/me')).status).toBe(200);

    // The real owner of the address signs in with Google (dev-login stands in for the verified Google identity).
    const { user } = await loginAs(app, 'riya@test.com', 'Riya');
    expect(user.email).toBe('riya@test.com');

    expect((await attacker.get('/api/v1/auth/me')).status).toBe(401);
    expect((await login('riya@test.com', GOOD)).status).toBe(401);
    const stored = await User.findOne({ email: 'riya@test.com' }).lean();
    expect(stored?.googleId).toBe('dev:riya@test.com');
    expect(stored?.passwordHash).toBeUndefined();
    expect(await User.countDocuments({ email: 'riya@test.com' })).toBe(1);
  });

  it('a password account can never become an admin', async () => {
    // Even if the email is later added to ADMIN_EMAILS, only a Google sign-in promotes it. Simulate by role check on login.
    await signup({ email: 'someone@test.com' });
    await User.updateOne({ email: 'someone@test.com' }, { $set: { role: 'admin' } });
    const res = await login('someone@test.com', GOOD);
    expect(res.status).toBe(401);
  });
});
