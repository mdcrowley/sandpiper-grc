import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cacheControlFor, chooseEncoding, IMMUTABLE, registerWebAssets, REVALIDATE, sendIndex } from './webassets.ts';

// OP-11: the web build went out uncompressed with max-age=0, so every page load fetched or
// revalidated about 1.2 MB of scripts and styles.
const SCRIPT = `export const rows = [${Array.from({ length: 400 }, (_, i) => `{ id: ${i}, name: "row ${i}" }`).join(', ')}];\n`;
let dir: string;
let app: FastifyInstance;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'grc-web-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>App</title><script type="module" src="/assets/index-AbCd1234.js"></script>');
  writeFileSync(join(dir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  writeFileSync(join(dir, 'assets', 'index-AbCd1234.js'), SCRIPT);
  writeFileSync(join(dir, 'assets', 'tiny-ZyXw9876.css'), 'a{color:red}');
  writeFileSync(join(dir, 'outside.txt'), 'not an asset');
  app = Fastify();
  await registerWebAssets(app, dir);
  app.setNotFoundHandler((req, reply) =>
    (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/assets/') ? sendIndex(reply, dir) : reply.code(404).send({ error: 'not_found' })));
  await app.ready();
});
afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: 'GET', url, headers });

describe('web assets (OP-11)', () => {
  it('sends hashed bundles compressed (Brotli first, then gzip) and cacheable for a year', async () => {
    const br = await get('/assets/index-AbCd1234.js', { 'accept-encoding': 'gzip, deflate, br' });
    expect(br.statusCode).toBe(200);
    expect(br.headers['content-encoding']).toBe('br');
    expect(br.headers['cache-control']).toBe(IMMUTABLE);
    expect(br.headers.vary).toMatch(/accept-encoding/i);
    expect(br.headers['content-type']).toMatch(/javascript/);
    expect(br.rawPayload.length).toBeLessThan(SCRIPT.length / 3);
    expect(brotliDecompressSync(br.rawPayload).toString()).toBe(SCRIPT);

    const gz = await get('/assets/index-AbCd1234.js', { 'accept-encoding': 'gzip' });
    expect(gz.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(gz.rawPayload).toString()).toBe(SCRIPT);

    const plain = await get('/assets/index-AbCd1234.js');
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.body).toBe(SCRIPT);
    expect(plain.headers.etag).not.toBe(br.headers.etag);
  });

  it('answers 304 to a matching If-None-Match', async () => {
    const first = await get('/assets/index-AbCd1234.js', { 'accept-encoding': 'br' });
    const again = await get('/assets/index-AbCd1234.js', { 'accept-encoding': 'br', 'if-none-match': String(first.headers.etag) });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe('');
  });

  it('does not compress tiny files', async () => {
    const res = await get('/assets/tiny-ZyXw9876.css', { 'accept-encoding': 'br' });
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.body).toBe('a{color:red}');
    expect(res.headers['cache-control']).toBe(IMMUTABLE);
  });

  it('asks the browser to check index.html and the other top-level files on every load', async () => {
    for (const url of ['/', '/index.html', '/favicon.svg', '/tickets/123']) {
      const res = await get(url);
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['cache-control'], url).toBe(REVALIDATE);
    }
  });

  it('says 404 for a missing asset and for paths outside the folder, never the page', async () => {
    expect((await get('/assets/missing-AbCd1234.js')).statusCode).toBe(404);
    expect((await get('/assets/..%2foutside.txt')).statusCode).toBe(404);
  });

  it('answers the application page for an asset record address loaded directly (/assets/:id)', async () => {
    const res = await get('/assets/0b9f3c1e-2a4d-4f6b-9c8e-1d2e3f4a5b6c');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('<title>App</title>');
  });

  it('chooses the encoding from Accept-Encoding', () => {
    expect(chooseEncoding('gzip, deflate, br, zstd')).toBe('br');
    expect(chooseEncoding('br;q=0, gzip')).toBe('gzip');
    expect(chooseEncoding('identity')).toBeNull();
    expect(chooseEncoding('*')).toBe('br');
    expect(chooseEncoding(undefined)).toBeNull();
  });

  it('caches for a year only names that carry a content hash', () => {
    expect(cacheControlFor('assets/index-AbCd1234.js')).toBe(IMMUTABLE);
    expect(cacheControlFor('assets/logo.svg')).toBe(REVALIDATE);
    expect(cacheControlFor('index.html')).toBe(REVALIDATE);
  });
});
