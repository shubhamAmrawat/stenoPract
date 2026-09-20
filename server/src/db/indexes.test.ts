import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { User } from '../models/index.js';
import { startTestDb, stopTestDb } from '../test/helpers.js';
import { dropLegacyUserIndex, ensureIndexes } from './indexes.js';

beforeAll(startTestDb);
afterAll(stopTestDb);

describe('user indexes', () => {
  it('replaces the old unique googleId index so accounts without a Google id can be created', async () => {
    const users = mongoose.connection.collection('users');
    await users.drop().catch(() => undefined);
    await users.createIndex({ googleId: 1 }, { unique: true }); // what an older database has
    await users.insertOne({ email: 'old@test.com', name: 'Old', googleId: 'g-1' });
    await expect(users.insertMany([{ email: 'a@test.com', name: 'A' }, { email: 'b@test.com', name: 'B' }])).rejects.toThrow(); // the problem

    await users.deleteMany({ email: { $in: ['a@test.com', 'b@test.com'] } });
    await ensureIndexes(); // what the server runs at startup
    const index = (await users.indexes()).find((i) => i.name === 'googleId_1');
    expect(index?.partialFilterExpression).toBeTruthy();

    await User.create({ email: 'a@test.com', name: 'A' });
    await User.create({ email: 'b@test.com', name: 'B' });
    await expect(User.create({ email: 'c@test.com', name: 'C', googleId: 'g-1' })).rejects.toThrow(); // Google ids stay unique
    await dropLegacyUserIndex(); // running it again does nothing
    expect((await users.indexes()).some((i) => i.name === 'googleId_1')).toBe(true);
  });
});
