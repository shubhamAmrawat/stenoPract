import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 180_000, // first run may download a MongoDB binary for the in-memory server
    env: {
      NODE_ENV: 'test',
      DB_URL: 'mongodb://unused-in-tests',
      LOG_LEVEL: 'silent',
      AUTH_DEV_LOGIN: 'true',
      ADMIN_EMAILS: 'admin@test.com',
      CLIENT_ORIGIN: 'http://localhost:5173',
      YOUTUBE_API_KEY: 'test-key',
    },
  },
});
