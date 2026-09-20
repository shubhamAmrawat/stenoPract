import { describe, expect, it } from 'vitest';
import { parseOrigins, parseTrustProxy } from './parsers.js';

const FALLBACK = 'http://localhost:5173';

describe('parseOrigins', () => {
  it('uses the fallback when unset or blank', () => {
    expect(parseOrigins(undefined, FALLBACK)).toEqual([FALLBACK]);
    expect(parseOrigins('  ', FALLBACK)).toEqual([FALLBACK]);
  });

  it('accepts several comma-separated origins', () => {
    expect(parseOrigins('https://app.vercel.app, https://steno.example.com', FALLBACK)).toEqual(['https://app.vercel.app', 'https://steno.example.com']);
  });

  it('drops trailing slashes and paths, lowercases the host, and removes duplicates', () => {
    expect(parseOrigins('https://App.Vercel.app/, https://app.vercel.app/login', FALLBACK)).toEqual(['https://app.vercel.app']);
  });

  it('keeps ports', () => {
    expect(parseOrigins('http://localhost:5173,http://localhost:4173', FALLBACK)).toEqual(['http://localhost:5173', 'http://localhost:4173']);
  });

  it('rejects entries that are not http(s) URLs', () => {
    expect(() => parseOrigins('app.example.com', FALLBACK)).toThrow(/invalid URL/);
    expect(() => parseOrigins('ftp://example.com', FALLBACK)).toThrow(/http/);
  });
});

describe('parseTrustProxy', () => {
  it('defaults to one proxy in production and none locally', () => {
    expect(parseTrustProxy(undefined, true)).toBe(1);
    expect(parseTrustProxy('', false)).toBe(false);
  });

  it('accepts a hop count or false', () => {
    expect(parseTrustProxy('2', true)).toBe(2);
    expect(parseTrustProxy(' 1 ', false)).toBe(1);
    expect(parseTrustProxy('0', true)).toBe(false);
    expect(parseTrustProxy('FALSE', true)).toBe(false);
  });

  it('refuses "true" and other values, which would trust every proxy', () => {
    expect(() => parseTrustProxy('true', true)).toThrow(/TRUST_PROXY/);
    expect(() => parseTrustProxy('loopback', true)).toThrow(/TRUST_PROXY/);
    expect(() => parseTrustProxy('-1', true)).toThrow(/TRUST_PROXY/);
  });
});
