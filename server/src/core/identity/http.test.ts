import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchJson, fetchText, setProviderAllowList } from './http.ts';

// W17-6: calls to sign-in providers are fenced like webhooks: a private, loopback or reserved address
// is reached only when that exact address is on the allowed hosts. Local server only; no network.
let server: Server;
let base = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/moved') { res.writeHead(302, { location: 'http://127.0.0.1/' }); res.end(); return; }
    if (req.url === '/big') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('x'.repeat(2048)); return; }
    if (req.url === '/form' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ got: body })); });
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ issuer: 'sample' }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  setProviderAllowList(async () => []);
  await new Promise<void>((r) => server.close(() => r()));
});

describe('sign-in provider calls (W17-6)', () => {
  it('refuses a loopback or private address that is not listed exactly, before connecting', async () => {
    setProviderAllowList(async () => []);
    await expect(fetchJson(`${base}/.well-known/openid-configuration`, 'discovery document')).rejects.toMatchObject({ message: expect.stringContaining('allowed hosts') });
    await expect(fetchText('https://10.20.0.5/metadata', 'metadata address')).rejects.toMatchObject({ message: expect.stringContaining('private') });
    await expect(fetchJson('https://[::ffff:169.254.169.254]/latest', 'key set')).rejects.toMatchObject({ message: expect.stringContaining('private') });
    // A host name is not enough: the address it resolves to must be listed.
    setProviderAllowList(async () => ['*.example.test']);
    await expect(fetchJson(`${base}/x`, 'discovery document')).rejects.toMatchObject({ message: expect.stringContaining('allowed hosts') });
  });

  it('reaches it once the exact address is listed, with or without its port', async () => {
    setProviderAllowList(async () => ['127.0.0.1']);
    expect((await fetchJson(`${base}/.well-known/openid-configuration`, 'discovery document')).json).toEqual({ issuer: 'sample' });
    setProviderAllowList(async () => [`127.0.0.1:${new URL(base).port}`]);
    expect((await fetchJson(`${base}/form`, 'token endpoint', { method: 'POST', form: { a: '1', b: 'two' } })).json).toEqual({ got: 'a=1&b=two' });
    setProviderAllowList(async () => ['127.0.0.1:1']);
    await expect(fetchJson(`${base}/x`, 'discovery document')).rejects.toMatchObject({ message: expect.stringContaining('allowed hosts') });
  });

  it('still never follows a redirect and limits the answer', async () => {
    setProviderAllowList(async () => ['127.0.0.1']);
    await expect(fetchJson(`${base}/moved`, 'discovery document')).rejects.toMatchObject({ message: expect.stringContaining('redirect') });
    await expect(fetchText(`${base}/big`, 'metadata address', 1024)).rejects.toMatchObject({ message: expect.stringContaining('larger than') });
    expect(await fetchText(`${base}/big`, 'metadata address', 4096)).toHaveLength(2048);
  });
});
