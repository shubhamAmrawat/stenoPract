import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { env } from '../config/env.js';
import { testApp } from '../test/helpers.js';
import { originCheck } from './security.js';

const app = testApp();
const savedOrigins = env.clientOrigins;
afterEach(() => {
  env.clientOrigins = savedOrigins;
});

/** Runs originCheck for a fake request and returns what it did. */
function check(method: string, origin?: string): 'allowed' | 'blocked' {
  const req = { method, get: (h: string) => (h.toLowerCase() === 'origin' ? origin : undefined) } as unknown as Request;
  let outcome: 'allowed' | 'blocked' = 'allowed';
  try {
    originCheck(req, {} as Response, (() => undefined) as NextFunction);
  } catch {
    outcome = 'blocked';
  }
  return outcome;
}

describe('originCheck', () => {
  it('lets state-changing requests through from every configured origin', () => {
    env.clientOrigins = ['https://app.vercel.app', 'https://steno.example.com'];
    expect(check('POST', 'https://app.vercel.app')).toBe('allowed');
    expect(check('DELETE', 'https://steno.example.com')).toBe('allowed');
  });

  it('blocks state-changing requests from any other origin', () => {
    env.clientOrigins = ['https://app.vercel.app'];
    expect(check('POST', 'https://evil.example.com')).toBe('blocked');
    expect(check('PATCH', 'https://app.vercel.app.evil.com')).toBe('blocked');
  });

  it('ignores safe methods and requests without an Origin header', () => {
    env.clientOrigins = ['https://app.vercel.app'];
    expect(check('GET', 'https://evil.example.com')).toBe('allowed');
    expect(check('POST', undefined)).toBe('allowed');
  });
});

describe('CORS', () => {
  it('echoes an allowed origin with credentials and nothing for others', async () => {
    const ok = await request(app).get('/api/v1/health').set('Origin', env.clientOrigins[0]!);
    expect(ok.headers['access-control-allow-origin']).toBe(env.clientOrigins[0]);
    expect(ok.headers['access-control-allow-credentials']).toBe('true');

    const other = await request(app).get('/api/v1/health').set('Origin', 'https://evil.example.com');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });
});
