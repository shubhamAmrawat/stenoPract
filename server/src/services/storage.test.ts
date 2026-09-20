import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { R2Storage, r2IsConfigured } from './storage.js';

interface Seen { method: string; url: string; headers: IncomingMessage['headers']; body: Buffer }

const seen: Seen[] = [];
const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    seen.push({ method: req.method!, url: req.url!.split('?')[0]!, headers: req.headers, body: Buffer.concat(chunks) });
    if (req.method === 'HEAD') {
      const missing = req.url!.includes('missing');
      res.statusCode = missing ? 404 : 200;
      if (!missing) res.setHeader('Content-Length', '1234');
      res.end();
      return;
    }
    res.statusCode = req.method === 'DELETE' ? 204 : 200;
    res.end();
  });
});
let cfg: ConstructorParameters<typeof R2Storage>[0];

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  cfg = {
    endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    bucket: 'steno-files',
    accessKeyId: 'AKID',
    secretAccessKey: 'SECRET',
    publicUrl: 'https://cdn.example.com',
    keyPrefix: '',
  };
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('R2 storage', () => {
  it('uploads with the right key, type and long-lived cache header', async () => {
    const storage = new R2Storage(cfg);
    await storage.put('avatars/u1/a.webp', Buffer.from('hello'), 'image/webp');
    const req = seen.at(-1)!;
    expect(req.method).toBe('PUT');
    expect(req.url).toBe('/steno-files/avatars/u1/a.webp');
    expect(req.headers['content-type']).toBe('image/webp');
    expect(req.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(req.headers.authorization).toContain('AWS4-HMAC-SHA256');
    expect(req.body.toString()).toBe('hello');
  });

  it('deletes by key', async () => {
    await new R2Storage(cfg).remove('avatars/u1/a.webp');
    const req = seen.at(-1)!;
    expect([req.method, req.url]).toEqual(['DELETE', '/steno-files/avatars/u1/a.webp']);
  });

  it('reads the size of a stored file, and returns null when there is none', async () => {
    const storage = new R2Storage(cfg);
    expect(await storage.head('resources/x/a.pdf')).toEqual({ size: 1234 });
    expect(await storage.head('resources/x/missing.pdf')).toBeNull();
  });

  it('makes a private upload address a browser can use with a plain PUT', async () => {
    const storage = new R2Storage({ ...cfg, keyPrefix: 'steno' });
    const url = new URL(await storage.presignPut('resources/g/u/a.pdf', 'application/pdf', 900));
    expect(url.origin + url.pathname).toBe(`${cfg.endpoint}/steno-files/steno/resources/g/u/a.pdf`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host');
    expect([...url.searchParams.keys()].some((k) => k.toLowerCase().includes('checksum'))).toBe(false); // extra checksum fields would break a browser upload
    // What the browser does: a PUT with that content type and nothing else special.
    const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: 'hello' });
    expect(res.status).toBe(200);
    expect(seen.at(-1)!.body.toString()).toBe('hello');
  });

  it('builds public addresses from the public URL', () => {
    expect(new R2Storage(cfg).urlFor('avatars/u1/a.webp')).toBe('https://cdn.example.com/avatars/u1/a.webp');
  });

  it('keeps everything inside its own folder when a prefix is set', async () => {
    const storage = new R2Storage({ ...cfg, keyPrefix: 'steno' });
    await storage.put('avatars/u1/a.webp', Buffer.from('x'), 'image/webp');
    expect(seen.at(-1)!.url).toBe('/steno-files/steno/avatars/u1/a.webp');
    await storage.remove('avatars/u1/a.webp');
    expect(seen.at(-1)!.url).toBe('/steno-files/steno/avatars/u1/a.webp');
    expect(storage.urlFor('avatars/u1/a.webp')).toBe('https://cdn.example.com/steno/avatars/u1/a.webp');
  });

  it('is only "configured" when every setting is present', () => {
    expect(r2IsConfigured(cfg)).toBe(true);
    expect(r2IsConfigured({ ...cfg, publicUrl: '' })).toBe(false);
    expect(r2IsConfigured({ ...cfg, endpoint: '' })).toBe(false);
  });
});
