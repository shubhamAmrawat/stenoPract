import MongoStore from 'connect-mongo';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { startTestDb, stopTestDb } from '../test/helpers.js';

beforeAll(startTestDb);
afterAll(stopTestDb);

describe('MongoDB session store (as used by server.ts)', () => {
  it('persists sessions in the sessions collection and survives an app restart', async () => {
    const makeApp = () =>
      createApp({
        sessionStore: MongoStore.create({ client: mongoose.connection.getClient(), dbName: mongoose.connection.name, collectionName: 'sessions' }),
      });

    const login = await request(makeApp()).post('/api/v1/auth/dev-login').send({ email: 'a@test.com' });
    expect(login.status).toBe(200);
    const cookie = (login.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    expect(await mongoose.connection.db!.collection('sessions').countDocuments()).toBe(1);

    // "Restart": a brand-new app + store instance still recognises the cookie.
    const res = await request(makeApp()).get('/api/v1/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('a@test.com');
  });
});
