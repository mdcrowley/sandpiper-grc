import { request as httpsRequest } from 'node:https';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { ADMIN } from '../test/helpers.ts';
import { SESSION_COOKIE } from './auth.ts';
import { defaultCookieSecure, hstsValue, isLoopback, ListenError, parseTrustProxy, planListen } from './http.ts';
import { makeSelfSigned } from './tls-selfsigned.ts';

// Core only: these tests are about the web server, not the modules.
const savedModules = process.env.GRC_MODULES;
beforeAll(() => { process.env.GRC_MODULES = '_none'; });
afterAll(() => { if (savedModules === undefined) delete process.env.GRC_MODULES; else process.env.GRC_MODULES = savedModules; });

const withEnv = async <T>(env: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> => {
  const before = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
};

const pair = makeSelfSigned(['localhost', '127.0.0.1']);
const files: Record<string, Buffer> = { '/c.pem': Buffer.from(pair.cert), '/k.pem': Buffer.from(pair.key), '/x.pem': Buffer.from('not a pem file') };
const read = (p: string) => { if (!files[p]) throw new Error('no such file'); return files[p]; };

describe('listen address and HTTPS (E16-07, E02-14)', () => {
  it('serves plain HTTP on the loopback address by default', () => {
    expect(planListen({}, read)).toMatchObject({ host: '127.0.0.1', port: 8080, tls: undefined, url: 'http://127.0.0.1:8080' });
    expect(planListen({ GRC_HOST: '::1', GRC_PORT: '9000' }, read).url).toBe('http://[::1]:9000');
    expect(planListen({ GRC_HOST: 'localhost' }, read).tls).toBeUndefined();
  });

  it('refuses plain HTTP on an address other machines can reach', () => {
    for (const host of ['0.0.0.0', '::', '192.0.2.10', 'grc.example.test']) {
      expect(() => planListen({ GRC_HOST: host }, read)).toThrow(ListenError);
      expect(() => planListen({ GRC_HOST: host }, read)).toThrow(/Refusing to serve plain HTTP/);
    }
  });

  it('allows it when a TLS proxy is declared in front, or when serving HTTPS itself', () => {
    expect(planListen({ GRC_HOST: '0.0.0.0', GRC_ALLOW_INSECURE: '1' }, read).url).toBe('http://localhost:8080');
    const tls = planListen({ GRC_HOST: '0.0.0.0', GRC_TLS_CERT: '/c.pem', GRC_TLS_KEY: '/k.pem', GRC_PORT: '8443' }, read);
    expect(tls.url).toBe('https://localhost:8443');
    expect(tls.tls?.cert.toString()).toBe(pair.cert);
  });

  it('explains a half-configured or unreadable certificate', () => {
    expect(() => planListen({ GRC_TLS_CERT: '/c.pem' }, read)).toThrow(/both GRC_TLS_CERT and GRC_TLS_KEY/);
    expect(() => planListen({ GRC_TLS_CERT: '/missing.pem', GRC_TLS_KEY: '/k.pem' }, read)).toThrow(/Cannot read the TLS certificate/);
    expect(() => planListen({ GRC_TLS_CERT: '/x.pem', GRC_TLS_KEY: '/k.pem' }, read)).toThrow(/not a PEM certificate/);
    expect(() => planListen({ GRC_TLS_CERT: '/c.pem', GRC_TLS_KEY: '/c.pem' }, read)).toThrow(/not a PEM private key/);
    expect(() => planListen({ GRC_PORT: 'http' }, read)).toThrow(/GRC_PORT/);
  });

  it('knows which addresses are loopback', () => {
    for (const h of ['127.0.0.1', '127.1.2.3', '::1', '[::1]', 'localhost', '::ffff:127.0.0.1']) expect(isLoopback(h)).toBe(true);
    for (const h of ['0.0.0.0', '::', '10.0.0.1', '::ffff:10.0.0.1', 'example.test']) expect(isLoopback(h)).toBe(false);
  });

  it('defaults the secure cookie to auto on HTTPS or behind a trusted proxy, and leaves an explicit choice alone', () => {
    expect(defaultCookieSecure({ tls: undefined }, {})).toBeUndefined();
    expect(defaultCookieSecure({ tls: {} as any }, {})).toBe('auto');
    expect(defaultCookieSecure({ tls: undefined }, { GRC_TRUST_PROXY: 'loopback' })).toBe('auto');
    expect(defaultCookieSecure({ tls: {} as any }, { GRC_COOKIE_SECURE: 'off' })).toBeUndefined();
  });

  it('builds the strict-transport-security value', () => {
    expect(hstsValue({})).toBe('max-age=31536000');
    expect(hstsValue({ GRC_HSTS_MAX_AGE: '600', GRC_HSTS_INCLUDE_SUBDOMAINS: '1' })).toBe('max-age=600; includeSubDomains');
    expect(hstsValue({ GRC_HSTS_MAX_AGE: '0' })).toBeNull();
  });
});

describe('trusted proxies (E01-31)', () => {
  it('trusts nobody by default', () => {
    expect(parseTrustProxy(undefined)('127.0.0.1', 0)).toBe(false);
    expect(parseTrustProxy('off')('10.0.0.1', 0)).toBe(false);
  });

  it('trusts a number of hops whatever their address', () => {
    expect(parseTrustProxy('1')('203.0.113.1', 0)).toBe(true);
    expect(parseTrustProxy('1')('203.0.113.1', 1)).toBe(false);
    expect(parseTrustProxy('2')('203.0.113.1', 1)).toBe(true);
  });

  it('trusts listed addresses, ranges and keywords only', () => {
    const t = parseTrustProxy('192.0.2.7, 10.20.0.0/16, loopback, fd00::/8');
    for (const a of ['192.0.2.7', '10.20.3.4', '127.0.0.1', '::1', '::ffff:10.20.9.9', 'fd00::5']) expect(t(a, 0)).toBe(true);
    for (const a of ['192.0.2.8', '10.21.0.1', '203.0.113.1', 'fe80::1', '']) expect(t(a, 0)).toBe(false);
    expect(parseTrustProxy('private')('172.16.5.5', 3)).toBe(true);
    expect(() => parseTrustProxy('proxy.example.test')).toThrow(/not an address/);
    expect(() => parseTrustProxy('10.0.0.0/40')).toThrow(/prefix/);
  });
});

describe('the web server behind a proxy (E01-31, E16-07)', () => {
  let built: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => {
    built = await buildApp({ dataDir: 'memory', serveWeb: false });
    const setup = await built.app.inject({ method: 'POST', url: '/api/setup', headers: { 'x-grc-csrf': '1' }, payload: ADMIN });
    expect(setup.statusCode).toBe(200);
  });
  afterAll(async () => { await built?.close(); });

  const login = (remoteAddress: string, headers: Record<string, string> = {}, password = ADMIN.password) =>
    built.app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress, headers: { 'x-grc-csrf': '1', ...headers }, payload: { username: ADMIN.username, password } });
  const lastSessionIp = async () => (await built.db.one<{ ip: string }>('select ip from sessions order by created_at desc limit 1'))!.ip;
  const forwarded = { 'x-forwarded-for': '198.51.100.1, 198.51.100.7', 'x-forwarded-proto': 'https' };

  it('believes X-Forwarded-For and -Proto from a listed proxy: client address, HSTS and a secure cookie', async () => {
    await withEnv({ GRC_TRUST_PROXY: '10.0.0.0/8', GRC_COOKIE_SECURE: 'auto' }, async () => {
      const res = await login('10.1.2.3', forwarded);
      expect(res.statusCode).toBe(200);
      expect(await lastSessionIp()).toBe('198.51.100.7');
      expect(res.headers['strict-transport-security']).toBe('max-age=31536000');
      expect(res.cookies.find((c) => c.name === SESSION_COOKIE)!.secure).toBe(true);
    });
  });

  it('ignores the same headers from any other address', async () => {
    await withEnv({ GRC_TRUST_PROXY: '10.0.0.0/8', GRC_COOKIE_SECURE: 'auto' }, async () => {
      const res = await login('203.0.113.5', forwarded);
      expect(res.statusCode).toBe(200);
      expect(await lastSessionIp()).toBe('203.0.113.5');
      expect(res.headers['strict-transport-security']).toBeUndefined();
      expect(res.cookies.find((c) => c.name === SESSION_COOKIE)!.secure).toBeFalsy();
    });
  });

  it('records failed sign-ins (and so rate limits) against the real client, not the proxy', async () => {
    await withEnv({ GRC_TRUST_PROXY: '10.0.0.0/8' }, async () => {
      expect((await login('10.9.9.9', { 'x-forwarded-for': '198.51.100.44' }, 'wrong password')).statusCode).toBe(401);
      expect((await built.db.one<{ ip: string }>(`select ip from audit_events where action = 'signin.failure' order by id desc limit 1`))!.ip).toBe('198.51.100.44');
      expect((await login('203.0.113.9', { 'x-forwarded-for': '198.51.100.45' }, 'wrong password')).statusCode).toBe(401);
      expect((await built.db.one<{ ip: string }>(`select ip from audit_events where action = 'signin.failure' order by id desc limit 1`))!.ip).toBe('203.0.113.9');
    });
  });

  it('sends no HSTS over plain HTTP', async () => {
    const res = await built.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });
});

describe('serving HTTPS directly (E16-07)', () => {
  let built: Awaited<ReturnType<typeof buildApp>>;
  let port = 0;
  beforeAll(async () => {
    built = await buildApp({ dataDir: 'memory', serveWeb: false, https: { cert: pair.cert, key: pair.key } });
    await built.app.listen({ host: '127.0.0.1', port: 0 });
    port = (built.app.server.address() as AddressInfo).port;
  });
  afterAll(async () => { await built?.close(); });

  const get = (path: string, method = 'GET', body?: object) =>
    new Promise<{ status: number; headers: Record<string, any>; body: string }>((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : undefined;
      const req = httpsRequest(
        { host: '127.0.0.1', port, path, method, ca: pair.cert, servername: 'localhost',
          headers: { 'x-grc-csrf': '1', ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}) } },
        (res) => {
          let text = '';
          res.on('data', (d) => (text += d));
          res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: text }));
        },
      );
      req.on('error', reject);
      req.end(payload);
    });

  it('answers over TLS with the supplied certificate, and sends HSTS', async () => {
    const res = await get('/api/health');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(res.headers['strict-transport-security']).toBe('max-age=31536000');
  });

  it('marks the session cookie secure under the HTTPS default (auto)', async () => {
    await withEnv({ GRC_COOKIE_SECURE: 'auto' }, async () => {
      const res = await get('/api/setup', 'POST', ADMIN);
      expect(res.status).toBe(200);
      const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!;
      expect(cookie).toMatch(/;\s*Secure/i);
    });
  });
});
