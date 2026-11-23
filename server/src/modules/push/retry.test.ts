import { createECDH, createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createHttp2Server, type Http2Server, type ServerHttp2Stream } from 'node:http2';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { MOBILE_CLIENT_ID, MOBILE_REDIRECT_URI } from '../../../../shared/mobile-api.ts';
import { deliverPending } from './deliver.ts';
import { setPushEndpointsForTests } from './endpoints.ts';
import { MAX_RETRIES, parseRetryAfter, retryDelaySeconds, temporaryStatus } from './retry.ts';
import { decryptWebPush } from './webpush.ts';

// Retrying pushes that failed for a while only (E38-14, wave 15): 5xx, no answer in time and 429
// (honoring Retry-After) are tried again with a back-off and a cap, a waiting retry is claimed so it is
// sent once, and permanent rejections are never retried. Fake Apple, Google and UnifiedPush services
// in this process answer as each test scripts them.

describe('the retry rules', () => {
  it('reads Retry-After as seconds or as a date', () => {
    const now = Date.parse('2026-11-22T10:00:00Z');
    expect(parseRetryAfter('120', now)).toBe(120);
    expect(parseRetryAfter(['30'], now)).toBe(30);
    expect(parseRetryAfter('Sun, 22 Nov 2026 10:01:30 GMT', now)).toBe(90);
    expect(parseRetryAfter('Sun, 22 Nov 2026 09:00:00 GMT', now)).toBe(0);
    for (const v of [undefined, null, '', 'soon', '-5', '1.5']) expect(parseRetryAfter(v, now)).toBeNull();
  });

  it('backs off, honors the wait a service asks for, and gives up', () => {
    expect([1, 2, 3, 4, 5].map((n) => retryDelaySeconds(n))).toEqual([30, 120, 600, 1800, 3600]);
    expect(retryDelaySeconds(MAX_RETRIES + 1)).toBeNull();
    expect(retryDelaySeconds(0)).toBeNull();
    expect(retryDelaySeconds(1, 300)).toBe(300);
    expect(retryDelaySeconds(4, 45)).toBe(45);
    expect(retryDelaySeconds(1, 0)).toBe(5);
    expect(retryDelaySeconds(1, 7 * 3600)).toBeNull();
  });

  it('treats 429 and 5xx as temporary, nothing else', () => {
    for (const s of [429, 500, 502, 503, 504]) expect(temporaryStatus(s)).toBe(true);
    for (const s of [200, 400, 401, 403, 404, 410, 413, 501]) expect(temporaryStatus(s)).toBe(false);
  });
});

// ---------- scripted fake services ----------

type Answer = { status: number; headers?: Record<string, string>; hang?: boolean };
const script: Record<'apns' | 'fcm' | 'up', Answer[]> = { apns: [], fcm: [], up: [] };
const calls: { service: 'apns' | 'fcm' | 'up'; path: string; count?: number }[] = [];
const next = (s: 'apns' | 'fcm' | 'up'): Answer => script[s].shift() ?? { status: s === 'up' ? 201 : 200 };

let apnsServer: Http2Server;
let googleServer: Server;
let upServer: Server;
let upPort = 0;
const upPhones = new Map<string, { priv: Buffer; auth: Buffer }>();
const hanging: (ServerResponse | ServerHttp2Stream)[] = [];

const listen = (s: Server | Http2Server) => new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)));
const readBody = (req: NodeJS.ReadableStream) => new Promise<Buffer>((r) => { const parts: Buffer[] = []; req.on('data', (d) => parts.push(Buffer.from(d))); req.on('end', () => r(Buffer.concat(parts))); });

function answer(res: ServerResponse, a: Answer, body = '') {
  if (a.hang) { hanging.push(res); return; }
  res.writeHead(a.status, { 'content-type': 'application/json', ...(a.headers ?? {}) });
  res.end(body);
}

let t: Awaited<ReturnType<typeof testApp>>;
const apnsKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const fcmKey = generateKeyPairSync('rsa', { modulusLength: 2048 });

beforeAll(async () => {
  apnsServer = createHttp2Server();
  apnsServer.on('stream', (s, headers) => {
    const stream = s as ServerHttp2Stream;
    void readBody(stream).then((raw) => {
      calls.push({ service: 'apns', path: String(headers[':path']), count: JSON.parse(raw.toString()).aps?.badge });
      const a = next('apns');
      if (a.hang) { hanging.push(stream); return; }
      stream.respond({ ':status': a.status, ...(a.headers ?? {}) });
      stream.end(a.status === 200 ? undefined : JSON.stringify({ reason: a.status === 429 ? 'TooManyRequests' : 'ServiceUnavailable' }));
    });
  });
  const apnsPort = await listen(apnsServer);

  googleServer = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    void readBody(req).then((raw) => {
      if (req.url === '/token') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ access_token: 'fake-access', expires_in: 3600, token_type: 'Bearer' }));
        return;
      }
      const body = JSON.parse(raw.toString());
      calls.push({ service: 'fcm', path: String(body.message.token), count: Number(body.message.data.count) });
      const a = next('fcm');
      answer(res, a, a.status === 200 ? JSON.stringify({ name: 'projects/p/messages/1' })
        : JSON.stringify({ error: { status: a.status === 429 ? 'RESOURCE_EXHAUSTED' : a.status === 400 ? 'INVALID_ARGUMENT' : 'UNAVAILABLE', message: 'Fake.', details: [{ errorCode: a.status === 429 ? 'QUOTA_EXCEEDED' : a.status === 400 ? 'INVALID_ARGUMENT' : 'UNAVAILABLE' }] } }));
    });
  });
  const googlePort = await listen(googleServer);

  upServer = createHttpServer((req, res) => {
    void readBody(req).then((raw) => {
      const phone = upPhones.get(req.url!);
      const body = phone ? JSON.parse(decryptWebPush(raw, phone.priv, phone.auth).toString()) : null;
      calls.push({ service: 'up', path: req.url!, count: body?.count });
      answer(res, next('up'));
    });
  });
  upPort = await listen(upServer);

  setPushEndpointsForTests({
    apns: { production: `http://127.0.0.1:${apnsPort}`, sandbox: `http://127.0.0.1:${apnsPort}` },
    googleToken: `http://127.0.0.1:${googlePort}/token`, fcm: `http://127.0.0.1:${googlePort}`,
    unifiedpushAllowHttp: true, timeoutMs: 400,
  });
  t = await testApp();
  expect((await t.api.patch('/api/admin/features', { features: { mobile: true } })).status).toBe(200);
  const res = await t.api.put('/api/push/admin/config', {
    apns: { enabled: true, keyId: 'ABC123DEFG', teamId: 'TEAM123456', key: apnsKey.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString() },
    fcm: {
      enabled: true,
      serviceAccount: JSON.stringify({ type: 'service_account', project_id: 'grc-retry-test', private_key: fcmKey.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(), client_email: 'retry@example.org' }),
    },
    unifiedpush: { enabled: true, allowedHosts: [`127.0.0.1:${upPort}`] },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
});

afterAll(async () => {
  setPushEndpointsForTests(null);
  for (const h of hanging) { try { 'destroy' in h ? h.destroy() : null; } catch { /* closed */ } }
  await t.close();
  await new Promise((r) => apnsServer.close(r));
  googleServer.closeAllConnections();
  upServer.closeAllConnections();
  await new Promise((r) => googleServer.close(r));
  await new Promise((r) => upServer.close(r));
});

// ---------- helpers ----------

async function signIn(platform: 'ios' | 'android') {
  const installation = randomUUID();
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const params = {
    response_type: 'code', client_id: MOBILE_CLIENT_ID, redirect_uri: MOBILE_REDIRECT_URI, scope: 'mobile', state: 'st-1',
    code_challenge: challenge, code_challenge_method: 'S256', installation_id: installation, device_name: `Retry ${platform} phone`,
    device_platform: platform, app_version: '0.1.0',
  };
  const decision = await t.api.post('/api/mobile/oauth/decision', { ...params, approve: true });
  const code = new URL(decision.body.redirect).searchParams.get('code')!;
  const res = await t.app.inject({
    method: 'POST', url: '/oauth/token', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: MOBILE_REDIRECT_URI, client_id: MOBILE_CLIENT_ID, installation_id: installation }).toString(),
  });
  return (res.json() as { access_token: string }).access_token;
}

const putPush = async (token: string, payload: object) => {
  const res = await t.app.inject({ method: 'PUT', url: '/api/me/push', headers: { authorization: `Bearer ${token}` }, payload });
  expect(res.statusCode, res.body).toBe(200);
};

/** A phone using UnifiedPush at /up/<name> on the fake push server; returns its registration id. */
async function upPhone(name: string): Promise<string> {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  upPhones.set(`/up/${name}`, { priv: ecdh.getPrivateKey(), auth });
  await putPush(await signIn('android'), { provider: 'unifiedpush', endpoint: `http://127.0.0.1:${upPort}/up/${name}`, p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') });
  return regOf(`/up/${name}`);
}

async function fcmPhone(token: string) {
  await putPush(await signIn('android'), { provider: 'fcm', token });
}

/** The newest registration (each phone registers once per test). */
const regOf = async (_label: string) => (await t.db.one<{ id: string }>('select id from push_registrations order by created_at desc limit 1'))!.id;
const reg = (id: string) => t.db.one<any>(
  `select retry_at, retry_attempts, failures, last_error, extract(epoch from (retry_at - now()))::float as wait from push_registrations where id = $1`, [id],
);
/** Makes every waiting retry due now. */
const makeDue = () => t.db.query(`update push_registrations set retry_at = now() - interval '1 second' where retry_at is not null`);
const deps = () => ({ db: t.db, app: t.app, settings: { get: async (_k: string, f: unknown) => f, set: async () => undefined } }) as any;
const adminId = async () => (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
const tick = () => new Promise((r) => setTimeout(r, 15));
async function notify(n = 1) {
  await tick();
  for (let i = 0; i < n; i += 1) await t.app.notify({ userIds: [await adminId()], kind: 'assignment', title: `Ticket TKT-0004${i} assigned to you` });
}

beforeEach(async () => {
  await t.db.query('delete from push_registrations');
  await t.db.query('update notifications set read_at = now() where read_at is null');
  calls.length = 0;
  script.apns.length = 0;
  script.fcm.length = 0;
  script.up.length = 0;
});

// ---------- tests ----------

describe('retrying pushes that failed for a while', () => {
  it('retries a 5xx after the back-off, once, with the count at that time', async () => {
    const id = await upPhone('a');
    script.up.push({ status: 503 });
    await notify();
    const first = await deliverPending(deps());
    expect(first).toMatchObject({ sent: 0, retrying: 1, failed: 0 });
    let r = await reg(id);
    expect(r).toMatchObject({ retry_attempts: 1, failures: 1 });
    expect(r.last_error).toContain('503');
    expect(r.wait).toBeGreaterThan(25);
    expect(r.wait).toBeLessThanOrEqual(30);
    // A run for when the retry is due is queued (the sweep would find it too).
    expect((await t.db.query(`select 1 from jobs where type = 'push.deliver' and dedupe_key like 'push.retry:%' and status = 'queued'`)).length).toBeGreaterThan(0);

    // Not due yet: nothing is sent, even when something new arrives (the retry will carry it).
    await notify();
    expect(await deliverPending(deps())).toMatchObject({ sent: 0, retried: 0 });
    expect(calls.length).toBe(1);

    // Due: two runs at the same moment send it once, saying how many are unread now.
    await makeDue();
    const [a, b] = await Promise.all([deliverPending(deps()), deliverPending(deps())]);
    expect(a.retried + b.retried).toBe(1);
    expect(a.sent + b.sent).toBe(1);
    expect(calls.map((c) => c.count)).toEqual([1, 2]);
    r = await reg(id);
    expect(r).toMatchObject({ retry_at: null, retry_attempts: 0, failures: 0, last_error: null });
    expect(await deliverPending(deps())).toMatchObject({ sent: 0, retried: 0 });
    expect(calls.length).toBe(2);
  });

  it('honors Retry-After on 429, as seconds or as a date, and gives up on a wait over six hours', async () => {
    const id = await upPhone('b');
    script.up.push({ status: 429, headers: { 'retry-after': '120' } });
    await notify();
    expect((await deliverPending(deps())).retrying).toBe(1);
    let r = await reg(id);
    expect(r.wait).toBeGreaterThan(115);
    expect(r.wait).toBeLessThanOrEqual(120);

    await makeDue();
    script.up.push({ status: 429, headers: { 'retry-after': new Date(Date.now() + 600_000).toUTCString() } });
    expect((await deliverPending(deps())).retrying).toBe(1);
    r = await reg(id);
    expect(r.retry_attempts).toBe(2);
    expect(r.wait).toBeGreaterThan(590);
    expect(r.wait).toBeLessThanOrEqual(601);

    await makeDue();
    script.up.push({ status: 429, headers: { 'retry-after': String(7 * 3600) } });
    expect(await deliverPending(deps())).toMatchObject({ retrying: 0, failed: 1 });
    r = await reg(id);
    expect(r).toMatchObject({ retry_at: null, retry_attempts: 0 });
    expect(r.last_error).toContain('more than 6 hours');
  });

  it('stops after the last retry and records why', async () => {
    const id = await upPhone('c');
    await notify();
    script.up.push({ status: 500 });
    await deliverPending(deps());
    for (let i = 1; i <= MAX_RETRIES; i += 1) {
      script.up.push({ status: 502 });
      await makeDue();
      await deliverPending(deps());
    }
    expect(calls.length).toBe(MAX_RETRIES + 1);
    const r = await reg(id);
    expect(r).toMatchObject({ retry_at: null, retry_attempts: 0, failures: MAX_RETRIES + 1 });
    expect(r.last_error).toContain(`Not tried again after ${MAX_RETRIES + 1} attempts`);
    await makeDue();
    await deliverPending(deps());
    expect(calls.length).toBe(MAX_RETRIES + 1);
    // The administration page shows the problem; nothing waits.
    const stats = (await t.api.get('/api/push/admin/config')).body.stats;
    expect(stats.retrying.unifiedpush).toBe(0);
    expect(stats.failing.unifiedpush).toBe(1);
  });

  it('retries a push server that does not answer in time', async () => {
    const id = await upPhone('d');
    script.up.push({ status: 0, hang: true });
    await notify();
    expect((await deliverPending(deps())).retrying).toBe(1);
    expect((await reg(id)).last_error).toContain('did not answer in time');
  });

  it('leaves a busy service alone for the rest of the run, and every phone waits as asked', async () => {
    const one = await upPhone('e1');
    const two = await upPhone('e2');
    script.up.push({ status: 503, headers: { 'retry-after': '60' } });
    await notify();
    expect((await deliverPending(deps())).retrying).toBe(2);
    expect(calls.length).toBe(1);
    for (const id of [one, two]) expect((await reg(id)).wait).toBeGreaterThan(50);
    const stats = (await t.api.get('/api/push/admin/config')).body.stats;
    expect(stats.retrying.unifiedpush).toBe(2);
  });

  it('retries Firebase 429 and 5xx and Apple 503, but not a rejected request', async () => {
    await fcmPhone('fcm-retry-phone-one:APA91b');
    await fcmPhone('fcm-retry-phone-two:APA91b');
    script.fcm.push({ status: 429, headers: { 'retry-after': '90' } });
    await notify();
    expect((await deliverPending(deps())).retrying).toBe(2);
    expect(calls.length).toBe(1);

    await makeDue();
    script.fcm.push({ status: 400 });
    const r = await deliverPending(deps());
    expect(r).toMatchObject({ retried: 2, failed: 1, sent: 1, retrying: 0 });
    expect((await t.db.query('select 1 from push_registrations where retry_at is not null')).length).toBe(0);

    await t.db.query('delete from push_registrations');
    const ios = await signIn('ios');
    await putPush(ios, { provider: 'apns', token: 'ef'.repeat(32) });
    script.apns.push({ status: 503 });
    await notify();
    expect((await deliverPending(deps())).retrying).toBe(1);
    await makeDue();
    expect(await deliverPending(deps())).toMatchObject({ retried: 1, sent: 1 });
  });

  it('drops a waiting retry when everything has been read meanwhile', async () => {
    const id = await upPhone('f');
    script.up.push({ status: 503 });
    await notify();
    await deliverPending(deps());
    await t.db.query('update notifications set read_at = now() where read_at is null');
    await makeDue();
    expect(await deliverPending(deps())).toMatchObject({ retried: 0, sent: 0 });
    expect(calls.length).toBe(1);
    expect(await reg(id)).toMatchObject({ retry_at: null, retry_attempts: 0 });
  });

  it('never retries the administrator\'s test push', async () => {
    const id = await upPhone('g');
    script.up.push({ status: 503 });
    const res = await t.api.post('/api/push/admin/test', {});
    expect(res.body).toMatchObject({ sent: 0, failed: 1 });
    expect(res.body.errors[0].message).toContain('503');
    expect(await reg(id)).toMatchObject({ retry_at: null });
  });
});
