import { createECDH, createHash, createPublicKey, generateKeyPairSync, randomBytes, randomUUID, verify } from 'node:crypto';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createHttp2Server, type Http2Server } from 'node:http2';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { MOBILE_CLIENT_ID, MOBILE_REDIRECT_URI } from '../../../../shared/mobile-api.ts';
import { pushMessageText } from '../../../../shared/push-api.ts';
import { deliverPending } from './deliver.ts';
import { setPushEndpointsForTests } from './endpoints.ts';
import { decryptWebPush, encryptWebPush } from './webpush.ts';

// Push notifications (E38-14): credentials, registration, delivery through fake Apple, Google and
// UnifiedPush services running in this process, the claim, per-person choices and the area switch.

let t: Awaited<ReturnType<typeof testApp>>;

// ---------- fake push services ----------

interface Seen { service: 'apns' | 'fcm' | 'up'; path: string; headers: Record<string, unknown>; body: any }
const seen: Seen[] = [];
let apnsServer: Http2Server;
let googleServer: Server;
let upServer: Server;
let upPort = 0;

const apnsKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const apnsPem = apnsKey.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
const fcmKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
const serviceAccount = JSON.stringify({
  type: 'service_account', project_id: 'grc-push-test', private_key_id: 'abc',
  private_key: fcmKey.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(), client_email: 'push-sender@example.org',
});

/** Checks a compact JWT's signature with a public key (ES256 as IEEE P1363, or RS256). */
function jwtValid(jwt: string, key: ReturnType<typeof createPublicKey>, alg: 'ES256' | 'RS256'): any {
  const [h, c, s] = jwt.split('.');
  const ok = alg === 'ES256'
    ? verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))
    : verify('RSA-SHA256', Buffer.from(`${h}.${c}`), key, Buffer.from(s, 'base64url'));
  return ok ? { header: JSON.parse(Buffer.from(h, 'base64url').toString()), claims: JSON.parse(Buffer.from(c, 'base64url').toString()) } : null;
}

/** Phones that use UnifiedPush in the tests: their key pairs, by endpoint path. */
const upPhones = new Map<string, { priv: Buffer; auth: Buffer }>();
let vapidPublic = '';

const listen = (s: Server | Http2Server) => new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)));
const readBody = (req: NodeJS.ReadableStream) => new Promise<Buffer>((r) => { const parts: Buffer[] = []; req.on('data', (d) => parts.push(Buffer.from(d))); req.on('end', () => r(Buffer.concat(parts))); });

beforeAll(async () => {
  apnsServer = createHttp2Server();
  apnsServer.on('stream', (stream, headers) => {
    void readBody(stream).then((raw) => {
      const path = String(headers[':path']);
      const auth = String(headers.authorization ?? '').replace(/^bearer /, '');
      const jwt = jwtValid(auth, createPublicKey(apnsKey.privateKey), 'ES256');
      seen.push({ service: 'apns', path, headers: { ...headers, jwt }, body: JSON.parse(raw.toString()) });
      const token = path.split('/').pop()!;
      const answer = !jwt ? [403, { reason: 'InvalidProviderToken' }] : token.startsWith('dead') ? [410, { reason: 'Unregistered' }] : [200, null];
      (stream as import('node:http2').ServerHttp2Stream).respond({ ':status': answer[0] as number });
      stream.end(answer[1] ? JSON.stringify(answer[1]) : undefined);
    });
  });
  const apnsPort = await listen(apnsServer);

  googleServer = createHttpServer((req, res) => {
    void readBody(req).then((raw) => {
      if (req.url === '/token') {
        const assertion = new URLSearchParams(raw.toString()).get('assertion') ?? '';
        const jwt = jwtValid(assertion, createPublicKey(fcmKey.privateKey), 'RS256');
        res.writeHead(jwt ? 200 : 400, { 'content-type': 'application/json' });
        res.end(JSON.stringify(jwt ? { access_token: 'fake-access', expires_in: 3600, token_type: 'Bearer' } : { error: 'invalid_grant' }));
        return;
      }
      const body = JSON.parse(raw.toString());
      seen.push({ service: 'fcm', path: req.url!, headers: req.headers, body });
      if (req.headers.authorization !== 'Bearer fake-access') { res.writeHead(401); res.end('{}'); return; }
      if (String(body.message.token).startsWith('gone')) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { status: 'NOT_FOUND', message: 'Requested entity was not found.', details: [{ errorCode: 'UNREGISTERED' }] } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ name: 'projects/grc-push-test/messages/1' }));
    });
  });
  const googlePort = await listen(googleServer);

  upServer = createHttpServer((req, res) => {
    void readBody(req).then((raw) => {
      const phone = upPhones.get(req.url!);
      if (!phone) { res.writeHead(404); res.end(); return; }
      const vapid = /^vapid t=([^,]+), k=(.+)$/.exec(String(req.headers.authorization ?? ''));
      const key = vapid ? createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: Buffer.from(vapid[2], 'base64url').subarray(1, 33).toString('base64url'), y: Buffer.from(vapid[2], 'base64url').subarray(33).toString('base64url') }, format: 'jwk' }) : null;
      const jwt = vapid && key ? jwtValid(vapid[1], key, 'ES256') : null;
      const body = JSON.parse(decryptWebPush(raw, phone.priv, phone.auth).toString());
      seen.push({ service: 'up', path: req.url!, headers: { ...req.headers, jwt, k: vapid?.[2] }, body });
      res.writeHead(jwt && vapid![2] === vapidPublic ? 201 : 403);
      res.end();
    });
  });
  upPort = await listen(upServer);

  setPushEndpointsForTests({
    apns: { production: `http://127.0.0.1:${apnsPort}`, sandbox: `http://127.0.0.1:${apnsPort}` },
    googleToken: `http://127.0.0.1:${googlePort}/token`, fcm: `http://127.0.0.1:${googlePort}`,
    unifiedpushAllowHttp: true, timeoutMs: 5000,
  });
  t = await testApp();
});

afterAll(async () => {
  setPushEndpointsForTests(null);
  await t.close();
  await new Promise((r) => apnsServer.close(r));
  await new Promise((r) => googleServer.close(r));
  await new Promise((r) => upServer.close(r));
});

// ---------- signing the app in (as in modules/mobile/mobile.test.ts) ----------

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

async function signIn(platform: 'ios' | 'android', api = t.api) {
  const installation = randomUUID();
  const { verifier, challenge } = pkce();
  const params = {
    response_type: 'code', client_id: MOBILE_CLIENT_ID, redirect_uri: MOBILE_REDIRECT_URI, scope: 'mobile', state: 'st-1',
    code_challenge: challenge, code_challenge_method: 'S256', installation_id: installation, device_name: `Test ${platform} phone`,
    device_platform: platform, app_version: '0.1.0',
  };
  const decision = await api.post('/api/mobile/oauth/decision', { ...params, approve: true });
  expect(decision.status, JSON.stringify(decision.body)).toBe(200);
  const code = new URL(decision.body.redirect).searchParams.get('code')!;
  const res = await t.app.inject({
    method: 'POST', url: '/oauth/token', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: MOBILE_REDIRECT_URI, client_id: MOBILE_CLIENT_ID, installation_id: installation }).toString(),
  });
  expect(res.statusCode, res.body).toBe(200);
  const body = res.json() as { access_token: string; device_id: string };
  return { token: body.access_token, deviceId: body.device_id };
}

const app = async (token: string, method: 'GET' | 'PUT' | 'DELETE', url: string, payload?: unknown) => {
  const res = await t.app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  let body: any = null;
  try { body = res.json(); } catch { /* empty */ }
  return { status: res.statusCode, body };
};

const setMobile = async (on: boolean) => {
  const res = await t.api.patch('/api/admin/features', { features: { mobile: on } });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  await t.api.get('/api/auth/state');
};

/** What delivery needs: the app, its database and the settings (only app.name is read). */
const deps = () => ({ db: t.db, app: t.app, settings: { get: async (_k: string, f: unknown) => f, set: async () => undefined } }) as any;

const adminId = async () => (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
const notify = async (userId: string, kind = 'assignment', title = 'Ticket TKT-00042 assigned to you: Depot gate camera offline') =>
  t.app.notify({ userIds: [userId], kind, title });
const readAll = (userId: string) => t.db.query('update notifications set read_at = now() where user_id = $1', [userId]);
/** Every notification older than now looks older, so the next one is newer than the cursor. */
const tick = () => new Promise((r) => setTimeout(r, 15));

// ---------- tests ----------

describe('message encryption (RFC 8291)', () => {
  it('matches the RFC\'s example and opens on the phone\'s side', () => {
    const b = (s: string) => Buffer.from(s, 'base64url');
    const out = encryptWebPush(
      Buffer.from('When I grow up, I want to be a watermelon'),
      b('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'), b('BTBZMqHH6r4Tts7J_aSIgg'),
      { asPrivate: b('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'), salt: b('DGv6ra1nlYgDCS1FRnbzlw') },
    );
    expect(out.toString('base64url')).toBe('DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
    expect(decryptWebPush(out, b('q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94'), b('BTBZMqHH6r4Tts7J_aSIgg')).toString()).toBe('When I grow up, I want to be a watermelon');
  });

  it('says only how many notifications are new', () => {
    expect(pushMessageText(1)).toBe('You have 1 new notification');
    expect(pushMessageText(7)).toBe('You have 7 new notifications');
  });
});

describe('switched off (the default)', () => {
  it('has no push routes while the Mobile app area is off', async () => {
    expect((await t.api.get('/api/push/admin/config')).body.error.code).toBe('switched_off');
    expect((await t.api.get('/api/me/push')).status).toBe(404);
  });
});

describe('with the Mobile app on', () => {
  let ios: { token: string; deviceId: string };
  let android: { token: string; deviceId: string };
  let upPhone: { token: string; deviceId: string };
  let me: string;

  beforeAll(async () => {
    await setMobile(true);
    me = await adminId();
    ios = await signIn('ios');
    android = await signIn('android');
    upPhone = await signIn('android');
  });

  it('keeps the credentials sealed and never shows them back', async () => {
    const empty = await t.api.get('/api/push/admin/config');
    expect(empty.status).toBe(200);
    expect(empty.body.config).toMatchObject({ apns: { enabled: false, keySet: false, bundleId: 'com.sandpipergrc' }, fcm: { enabled: false, keySet: false } });

    const bad = await t.api.put('/api/push/admin/config', { apns: { enabled: true, keyId: 'short' }, fcm: { serviceAccount: '{"type":"user"}' } });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields)).toEqual(expect.arrayContaining(['apns.keyId', 'apns.key', 'fcm.serviceAccount']));

    const res = await t.api.put('/api/push/admin/config', {
      apns: { enabled: true, keyId: 'ABC123DEFG', teamId: 'TEAM123456', key: apnsPem },
      fcm: { enabled: true, serviceAccount },
      unifiedpush: { enabled: true, allowedHosts: [`127.0.0.1:${upPort}`] },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.config.apns).toMatchObject({ enabled: true, keySet: true, keyId: 'ABC123DEFG', teamId: 'TEAM123456' });
    expect(res.body.config.fcm).toMatchObject({ enabled: true, keySet: true, projectId: 'grc-push-test', clientEmail: 'push-sender@example.org' });
    expect(res.body.config.unifiedpush.vapidPublicKey).toMatch(/^B[A-Za-z0-9_-]{86}$/);
    vapidPublic = res.body.config.unifiedpush.vapidPublicKey;
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('PRIVATE KEY');

    // Stored sealed; the audit entry names what changed, never a key.
    const row = await t.db.one<any>('select apns_key_sealed, fcm_key_sealed, vapid_private_sealed from push_config');
    for (const v of Object.values(row)) expect(String(v)).toMatch(/^enc:v1:/);
    const audit = await t.db.query<any>(`select summary, before, after from audit_events where action = 'push.settings'`);
    expect(audit.length).toBe(1);
    expect(audit[0].summary).toContain('Apple key');
    expect(JSON.stringify(audit)).not.toContain('PRIVATE KEY');
  });

  it('lets only the app register a phone, checking what it sends', async () => {
    expect((await t.api.get('/api/me/push')).body.error.code).toBe('mobile_only');
    const status = await app(ios.token, 'GET', '/api/me/push');
    expect(status.body).toMatchObject({ available: true, providers: { apns: true, fcm: false, unifiedpush: false }, registered: false, vapidPublicKey: null });
    const androidStatus = await app(android.token, 'GET', '/api/me/push');
    expect(androidStatus.body).toMatchObject({ providers: { apns: false, fcm: true, unifiedpush: true }, vapidPublicKey: vapidPublic });

    expect((await app(ios.token, 'PUT', '/api/me/push', { provider: 'fcm', token: 'x'.repeat(40) })).status).toBe(409);
    expect((await app(ios.token, 'PUT', '/api/me/push', { provider: 'apns', token: 'not-hex' })).status).toBe(400);
    const okIos = await app(ios.token, 'PUT', '/api/me/push', { provider: 'apns', token: 'ab'.repeat(32), environment: 'sandbox' });
    expect(okIos.status, JSON.stringify(okIos.body)).toBe(200);
    expect(okIos.body).toMatchObject({ registered: true, provider: 'apns' });
    expect((await app(android.token, 'PUT', '/api/me/push', { provider: 'fcm', token: 'fcm-token-for-a-test-phone:APA91b' })).status).toBe(200);

    // UnifiedPush: only listed push servers, and real keys.
    const phone = createECDH('prime256v1');
    phone.generateKeys();
    const authSecret = randomBytes(16);
    upPhones.set('/up/phone-1', { priv: phone.getPrivateKey(), auth: authSecret });
    const keys = { p256dh: phone.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') };
    const elsewhere = await app(upPhone.token, 'PUT', '/api/me/push', { provider: 'unifiedpush', endpoint: 'https://push.example.net/up/1', ...keys });
    expect(elsewhere.status).toBe(400);
    expect(elsewhere.body.error.message).toContain('not on this server\'s list');
    const up = await app(upPhone.token, 'PUT', '/api/me/push', { provider: 'unifiedpush', endpoint: `http://127.0.0.1:${upPort}/up/phone-1`, ...keys });
    expect(up.status, JSON.stringify(up.body)).toBe(200);

    const stored = await t.db.query<any>('select target_sealed from push_registrations');
    expect(stored.length).toBe(3);
    for (const r of stored) expect(r.target_sealed).toMatch(/^enc:v1:/);
    expect((await t.db.query(`select 1 from audit_events where action = 'push.register'`)).length).toBe(3);
  });

  it('pushes only the number of new notifications to every service, once', async () => {
    seen.length = 0;
    await tick();
    await notify(me);
    await notify(me, 'approval', 'Change CHG-00007 waits for your approval');
    // The hook queued one delivery; two runs at the same moment send once.
    expect((await t.db.query(`select 1 from jobs where type = 'push.deliver' and status = 'queued'`)).length).toBe(1);
    const [a, b] = await Promise.all([deliverPending(deps()), deliverPending(deps())]);
    expect(a.sent + b.sent).toBe(3);
    expect(a.people + b.people).toBe(1);
    expect(seen.map((s) => s.service).sort()).toEqual(['apns', 'fcm', 'up']);

    const apns = seen.find((s) => s.service === 'apns')!;
    expect(apns.path).toBe(`/3/device/${'ab'.repeat(32)}`);
    expect(apns.headers).toMatchObject({ 'apns-topic': 'com.sandpipergrc', 'apns-push-type': 'alert', 'apns-collapse-id': 'grcunread' });
    expect((apns.headers.jwt as any)).toMatchObject({ header: { alg: 'ES256', kid: 'ABC123DEFG' }, claims: { iss: 'TEAM123456' } });
    expect(apns.body.aps).toEqual({ alert: { title: 'Sandpiper GRC', body: 'You have 2 new notifications' }, badge: 2, sound: 'default' });

    const fcm = seen.find((s) => s.service === 'fcm')!;
    expect(fcm.path).toBe('/v1/projects/grc-push-test/messages:send');
    expect(fcm.body.message).toMatchObject({ notification: { body: 'You have 2 new notifications' }, data: { count: '2', route: '/notifications' } });

    const up = seen.find((s) => s.service === 'up')!;
    expect(up.body).toEqual({ title: 'Sandpiper GRC', body: 'You have 2 new notifications', kind: 'unread', count: 2, route: '/notifications' });
    expect((up.headers.jwt as any).claims.aud).toBe(`http://127.0.0.1:${upPort}`);
    expect(up.headers).toMatchObject({ 'content-encoding': 'aes128gcm', urgency: 'high', topic: 'grcunread' });

    // Never a title, a reference or a record.
    const all = JSON.stringify(seen.map((s) => s.body));
    for (const word of ['TKT-', 'CHG-', 'Depot', 'approval']) expect(all).not.toContain(word);

    // Nothing new: nothing sent.
    seen.length = 0;
    expect((await deliverPending(deps())).sent).toBe(0);
    expect(seen.length).toBe(0);
    await readAll(me);
  });

  it('follows each person\'s choices: muted and email-only kinds are not pushed', async () => {
    await t.db.query(
      `insert into notification_preferences (user_id, muted_kinds, channels) values ($1, '["watch"]', '{"watch":"none","due":"email"}')
       on conflict (user_id) do update set muted_kinds = excluded.muted_kinds, channels = excluded.channels`, [me],
    );
    seen.length = 0;
    await tick();
    await notify(me, 'watch', 'A record you watch changed');
    expect((await deliverPending(deps())).people).toBe(0);
    // Email-only reaches the bell only while email is not set up, so set it up for this check.
    const mailOn = t.app.mailEnabled;
    (t.app as any).mailEnabled = async () => true;
    try {
      await notify(me, 'due', 'An action is due');
    } finally {
      (t.app as any).mailEnabled = mailOn;
    }
    expect((await deliverPending(deps())).people).toBe(0);
    expect(seen.length).toBe(0);
    await t.db.query('delete from notification_preferences where user_id = $1', [me]);
  });

  it('removes registrations the services no longer accept, and those of signed-out phones', async () => {
    await app(ios.token, 'PUT', '/api/me/push', { provider: 'apns', token: `dead${'0'.repeat(60)}` });
    await app(android.token, 'PUT', '/api/me/push', { provider: 'fcm', token: 'gone-token-of-a-test-phone' });
    await tick();
    await notify(me);
    const r = await deliverPending(deps());
    expect(r).toMatchObject({ sent: 1, removed: 2 });
    expect((await t.db.query('select provider from push_registrations')).map((x: any) => x.provider)).toEqual(['unifiedpush']);
    await readAll(me);

    // Signing the phone out removes its registration at once.
    await app(android.token, 'PUT', '/api/me/push', { provider: 'fcm', token: 'fcm-token-for-a-test-phone:APA91b' });
    expect((await t.db.query('select 1 from push_registrations where device_id = $1', [android.deviceId])).length).toBe(1);
    expect((await app(android.token, 'DELETE', `/api/me/devices/${android.deviceId}`)).status).toBe(200);
    expect((await t.db.query('select 1 from push_registrations where device_id = $1', [android.deviceId])).length).toBe(0);

    // The app switching push off.
    const off = await app(upPhone.token, 'DELETE', '/api/me/push');
    expect(off.body).toEqual({ ok: true, removed: true });
    expect((await t.db.query('select 1 from push_registrations')).length).toBe(0);
  });

  it('sends a test push to the administrator\'s own phones', async () => {
    const phone = await signIn('ios');
    await app(phone.token, 'PUT', '/api/me/push', { provider: 'apns', token: 'cd'.repeat(32) });
    seen.length = 0;
    const res = await t.api.post('/api/push/admin/test', {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ sent: 1, failed: 0 });
    expect(seen[0].body.aps.alert.body).toContain('test notification');
    const stats = (await t.api.get('/api/push/admin/config')).body.stats;
    expect(stats.registrations).toEqual({ apns: 1, fcm: 0, unifiedpush: 0 });
  });

  it('replacing the UnifiedPush key removes UnifiedPush registrations', async () => {
    const phone = await signIn('android');
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    upPhones.set('/up/phone-2', { priv: ecdh.getPrivateKey(), auth: randomBytes(16) });
    await app(phone.token, 'PUT', '/api/me/push', { provider: 'unifiedpush', endpoint: `http://127.0.0.1:${upPort}/up/phone-2`, p256dh: ecdh.getPublicKey().toString('base64url'), auth: upPhones.get('/up/phone-2')!.auth.toString('base64url') });
    const res = await t.api.post('/api/push/admin/vapid', {});
    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(1);
    expect(res.body.config.unifiedpush.vapidPublicKey).not.toBe(vapidPublic);
  });

  it('sends nothing at all once the Mobile app area is off', async () => {
    await tick();
    await notify(me);
    await setMobile(false);
    seen.length = 0;
    expect(await deliverPending(deps())).toMatchObject({ sent: 0, people: 0 });
    expect(seen.length).toBe(0);
    expect((await t.api.post('/api/push/admin/test', {})).status).toBe(404);
  });
});
