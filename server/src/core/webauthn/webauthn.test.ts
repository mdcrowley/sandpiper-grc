import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.ts';
import { ADMIN, testApp } from '../../test/helpers.ts';
import { SESSION_COOKIE } from '../auth.ts';
import { WEBAUTHN_DOCS } from './apidocs.ts';
import { CborError, decodeCbor, encodeCbor, type CborValue } from './cbor.ts';
import { EDDSA, ES256, RS256 } from './cose.ts';
import { SoftAuthenticator } from './softauthn.ts';

// app.inject sends "Host: localhost:80", so the expected origin is http://localhost:80 and the RP ID localhost.
const ORIGIN = 'http://localhost:80';

type App = Awaited<ReturnType<typeof testApp>>;

async function raw(t: { app: App['app'] }, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown, cookie?: string, host?: string) {
  const res = await t.app.inject({
    method, url,
    headers: { 'x-grc-csrf': '1', ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}), ...(host ? { host } : {}) },
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  let parsed: any = null;
  try { parsed = res.json(); } catch { /* empty */ }
  return { status: res.statusCode, body: parsed, cookie: res.cookies.find((c) => c.name === SESSION_COOKIE)?.value };
}

/** Registers a key for the admin through the API with the software authenticator. */
async function register(t: App, auth: SoftAuthenticator, name: string) {
  const opts = await t.api.post('/api/auth/webauthn/register/options');
  expect(opts.status).toBe(200);
  const res = await t.api.post('/api/auth/webauthn/register', { name, credential: auth.create(opts.body.publicKey) });
  expect(res.status).toBe(200);
  return res.body.credential as { id: string; name: string };
}

async function passwordlessOptions(t: App) {
  const res = await raw(t, 'POST', '/api/auth/webauthn/login/options', {});
  expect(res.status).toBe(200);
  return res.body.publicKey;
}

const auditCount = async (t: App, action: string) =>
  (await t.db.one<{ c: number }>('select count(*)::int c from audit_events where action = $1', [action]))!.c;

describe('CBOR', () => {
  it('round-trips the values WebAuthn uses and refuses malformed input', () => {
    const value = new Map<CborValue, CborValue>([
      ['fmt', 'none'], [1, -7], [-1, 1], ['n', Uint8Array.from([1, 2, 3])], ['list', [true, false, null, 500, 70000]],
    ]);
    const decoded = decodeCbor(encodeCbor(value)) as Map<CborValue, CborValue>;
    expect(decoded.get('fmt')).toBe('none');
    expect(decoded.get(1)).toBe(-7);
    expect(Array.from(decoded.get('n') as Uint8Array)).toEqual([1, 2, 3]);
    expect(decoded.get('list')).toEqual([true, false, null, 500, 70000]);
    expect(() => decodeCbor(Uint8Array.from([0x5a, 0xff, 0xff, 0xff, 0xff]))).toThrow(CborError); // byte string longer than the data
    expect(() => decodeCbor(Uint8Array.from([0xa1, 0x01]))).toThrow(CborError); // map missing its value
    expect(() => decodeCbor(Uint8Array.from([0x01, 0x02]))).toThrow(CborError); // trailing bytes
    expect(() => decodeCbor(Uint8Array.from([0xa2, 0x01, 0x01, 0x01, 0x02]))).toThrow(CborError); // duplicate key
    expect(decodeCbor(Uint8Array.from([0xf9, 0x3c, 0x00]))).toBe(1); // half-precision float
  });
});

describe('passkeys and security keys (E02-08)', () => {
  let t: App;
  beforeAll(async () => { t = await testApp(); });
  afterAll(async () => { await t.close(); });

  it('registers, lists, renames and signs in with a passkey alone and as the second factor', async () => {
    const auth = new SoftAuthenticator({ origin: ORIGIN });
    const options = await t.api.post('/api/auth/webauthn/register/options');
    expect(options.body.publicKey).toMatchObject({ rp: { id: 'localhost' }, attestation: 'none', user: { name: ADMIN.username } });
    expect(options.body.publicKey.pubKeyCredParams.map((p: { alg: number }) => p.alg)).toEqual([ES256, EDDSA, RS256]);
    const key = await register(t, auth, 'Office laptop');
    expect(key.name).toBe('Office laptop');
    const list = await t.api.get('/api/auth/webauthn/credentials');
    expect(list.body.credentials).toHaveLength(1);
    expect(list.body.credentials[0]).not.toHaveProperty('public_key');
    expect(await auditCount(t, 'passkey.register')).toBe(1);

    // The same name twice is refused; renaming works and is audited.
    const again = await t.api.post('/api/auth/webauthn/register/options');
    const dup = await t.api.post('/api/auth/webauthn/register', { name: 'office LAPTOP', credential: auth.create(again.body.publicKey) });
    expect(dup.body.error.fields.name).toMatch(/already/);
    auth.credentials.pop();
    expect((await t.api.patch(`/api/auth/webauthn/credentials/${key.id}`, { name: 'Work laptop' })).status).toBe(200);
    expect((await t.api.get('/api/auth/webauthn/credentials')).body.credentials[0].name).toBe('Work laptop');

    // A passkey alone.
    const signin = await raw(t, 'POST', '/api/auth/webauthn/login', { credential: auth.get(await passwordlessOptions(t)) });
    expect(signin.status).toBe(200);
    expect(signin.cookie).toBeTruthy();
    const state = await raw(t, 'GET', '/api/auth/state', undefined, signin.cookie);
    expect(state.body.user.username).toBe(ADMIN.username);
    const used = await t.db.one<{ last_used_at: string | null; sign_count: number }>('select last_used_at, sign_count from webauthn_credentials where id = $1', [key.id]);
    expect(used!.last_used_at).toBeTruthy();
    expect(used!.sign_count).toBe(1);

    // Password sign-in now needs the key; the key's step lists only this person's keys.
    const noKey = await raw(t, 'POST', '/api/auth/login', { username: ADMIN.username, password: ADMIN.password });
    expect(noKey.status).toBe(401);
    expect(noKey.body.error).toMatchObject({ code: 'mfa_required', fields: { passkey: 'required' } });
    const wrong = await raw(t, 'POST', '/api/auth/webauthn/login/options', { username: ADMIN.username, password: 'not the password at all' });
    expect(wrong.status).toBe(401);
    const second = await raw(t, 'POST', '/api/auth/webauthn/login/options', { username: ADMIN.username, password: ADMIN.password });
    expect(second.body.publicKey.allowCredentials).toHaveLength(1);
    const withKey = await raw(t, 'POST', '/api/auth/login', { username: ADMIN.username, password: ADMIN.password, webauthn: auth.get(second.body.publicKey) });
    expect(withKey.status).toBe(200);
    expect(await auditCount(t, 'passkey.used')).toBe(1);
  });

  it('accepts RS256 and EdDSA keys', async () => {
    for (const alg of [RS256, EDDSA]) {
      const auth = new SoftAuthenticator({ origin: ORIGIN, alg });
      await register(t, auth, `Key ${alg}`);
      const res = await raw(t, 'POST', '/api/auth/webauthn/login', { credential: auth.get(await passwordlessOptions(t)) });
      expect(res.status, `alg ${alg}`).toBe(200);
    }
  });

  it('refuses a wrong origin, a wrong RP ID and a replayed challenge', async () => {
    const auth = new SoftAuthenticator({ origin: ORIGIN });
    // Registration from another origin, and for another RP ID.
    let opts = await t.api.post('/api/auth/webauthn/register/options');
    let res = await t.api.post('/api/auth/webauthn/register', { name: 'Phished', credential: auth.create(opts.body.publicKey, { origin: 'https://grc.example.net' }) });
    expect(res.body.error.code).toBe('passkey_wrong_origin');
    opts = await t.api.post('/api/auth/webauthn/register/options');
    res = await t.api.post('/api/auth/webauthn/register', { name: 'Other site', credential: auth.create(opts.body.publicKey, { rpId: 'example.net' }) });
    expect(res.body.error.code).toBe('passkey_wrong_rp');
    auth.credentials.length = 0;
    await register(t, auth, 'Replay test');

    // Sign-in from another origin; with authenticator data for another RP ID.
    let login = await raw(t, 'POST', '/api/auth/webauthn/login', { credential: auth.get(await passwordlessOptions(t), { origin: 'https://grc.example.net' }) });
    expect(login.body.error.code).toBe('passkey_wrong_origin');
    login = await raw(t, 'POST', '/api/auth/webauthn/login', { credential: auth.get(await passwordlessOptions(t), { rpId: 'example.net' }) });
    expect(login.body.error.code).toBe('passkey_wrong_rp');

    // A good assertion works once; the same answer again (its challenge used up) is refused.
    const assertion = auth.get(await passwordlessOptions(t));
    expect((await raw(t, 'POST', '/api/auth/webauthn/login', { credential: assertion })).status).toBe(200);
    const replay = await raw(t, 'POST', '/api/auth/webauthn/login', { credential: assertion });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('passkey_challenge');
    // A challenge nobody issued.
    const made = auth.get(await passwordlessOptions(t), { challenge: 'bm90LWlzc3VlZC1ieS10aGUtc2VydmVyLWF0LWFsbC0xMjM' });
    expect((await raw(t, 'POST', '/api/auth/webauthn/login', { credential: made })).body.error.code).toBe('passkey_challenge');
    // A registration challenge cannot be used to sign in.
    const reg = await t.api.post('/api/auth/webauthn/register/options');
    const cross = auth.get({ ...reg.body.publicKey, rpId: 'localhost', allowCredentials: [] });
    expect((await raw(t, 'POST', '/api/auth/webauthn/login', { credential: cross })).body.error.code).toBe('passkey_challenge');
    expect(await auditCount(t, 'passkey.refused')).toBeGreaterThanOrEqual(4);
  });

  it('refuses a key whose counter goes backwards, and audits it as a possible copy', async () => {
    const auth = new SoftAuthenticator({ origin: ORIGIN });
    await register(t, auth, 'Counter test');
    expect((await raw(t, 'POST', '/api/auth/webauthn/login', { credential: auth.get(await passwordlessOptions(t), { signCount: 10 }) })).status).toBe(200);
    const back = await raw(t, 'POST', '/api/auth/webauthn/login', { credential: auth.get(await passwordlessOptions(t), { signCount: 5 }) });
    expect(back.body.error.code).toBe('passkey_sign_count');
    const same = await raw(t, 'POST', '/api/auth/webauthn/login', { credential: auth.get(await passwordlessOptions(t), { signCount: 10 }) });
    expect(same.body.error.code).toBe('passkey_sign_count');
    expect(await auditCount(t, 'passkey.sign_count_regression')).toBe(2);
    // A key without a counter (always 0) is fine.
    const synced = new SoftAuthenticator({ origin: ORIGIN, counterStep: 0 });
    await register(t, synced, 'Synced passkey');
    for (let i = 0; i < 2; i++) {
      expect((await raw(t, 'POST', '/api/auth/webauthn/login', { credential: synced.get(await passwordlessOptions(t)) })).status).toBe(200);
    }
  });

  it('refuses a removed key, and needs user verification to sign in with a key alone', async () => {
    const auth = new SoftAuthenticator({ origin: ORIGIN });
    const key = await register(t, auth, 'To remove');
    expect((await t.api.del(`/api/auth/webauthn/credentials/${key.id}`)).status).toBe(200);
    expect(await auditCount(t, 'passkey.revoke')).toBe(1);
    const res = await raw(t, 'POST', '/api/auth/webauthn/login', { credential: auth.get(await passwordlessOptions(t)) });
    expect(res.body.error.code).toBe('passkey_revoked');
    expect((await t.api.get('/api/auth/webauthn/credentials')).body.credentials.some((c: { id: string }) => c.id === key.id)).toBe(false);

    const plain = new SoftAuthenticator({ origin: ORIGIN, userVerified: false });
    await register(t, plain, 'Basic security key'); // allowed as a second factor (policy "preferred")
    const alone = await raw(t, 'POST', '/api/auth/webauthn/login', { credential: plain.get(await passwordlessOptions(t)) });
    expect(alone.body.error.code).toBe('passkey_no_verification');
    // With the password it is a second factor.
    const step = await raw(t, 'POST', '/api/auth/webauthn/login/options', { username: ADMIN.username, password: ADMIN.password });
    const both = await raw(t, 'POST', '/api/auth/login', {
      username: ADMIN.username, password: ADMIN.password, webauthn: plain.get(step.body.publicKey, { credentialId: plain.credentials[0].id.toString('base64url') }),
    });
    expect(both.status).toBe(200);
    // Policy "required": every key must verify the person.
    await t.db.query(`insert into settings (key, value) values ('auth.passkey_user_verification', '"required"')`);
    const step2 = await raw(t, 'POST', '/api/auth/webauthn/login/options', { username: ADMIN.username, password: ADMIN.password });
    const refused = await raw(t, 'POST', '/api/auth/login', {
      username: ADMIN.username, password: ADMIN.password, webauthn: plain.get(step2.body.publicKey, { credentialId: plain.credentials[0].id.toString('base64url') }),
    });
    expect(refused.status).toBe(401);
    await t.db.query(`delete from settings where key = 'auth.passkey_user_verification'`);
  });

  it('lets an administrator list and remove another person\'s keys, and nobody else', async () => {
    const lead = await t.as('security_lead');
    const auth = new SoftAuthenticator({ origin: ORIGIN });
    const opts = await lead.post('/api/auth/webauthn/register/options');
    const reg = await lead.post('/api/auth/webauthn/register', { name: 'Lead key', credential: auth.create(opts.body.publicKey) });
    expect(reg.status).toBe(200);
    expect((await lead.get(`/api/admin/users/${lead.userId}/passkeys`)).status).toBe(403);
    const listed = await t.api.get(`/api/admin/users/${lead.userId}/passkeys`);
    expect(listed.body.credentials.map((c: { name: string }) => c.name)).toEqual(['Lead key']);
    // Another person's key cannot be renamed or removed through the owner routes.
    expect((await t.api.patch(`/api/auth/webauthn/credentials/${reg.body.credential.id}`, { name: 'Mine now' })).status).toBe(404);
    expect((await t.api.del(`/api/admin/users/${lead.userId}/passkeys/${reg.body.credential.id}`)).status).toBe(200);
    expect((await t.api.get(`/api/admin/users/${lead.userId}/passkeys`)).body.credentials).toEqual([]);
  });

  it('counts a passkey as a second factor when one is required, and lets a blocked person register one', async () => {
    const lead = await t.as('security_lead');
    await t.db.query(`insert into settings (key, value) values ('auth.mfa_enforcement', '"required"') on conflict (key) do update set value = excluded.value`);
    try {
      expect((await lead.get('/api/auth/state')).body.mfaEnrollmentBlocked).toBe(true);
      expect((await lead.get('/api/meta')).status).toBe(403);
      expect((await lead.get('/api/auth/webauthn/credentials')).status).toBe(200);
      const auth = new SoftAuthenticator({ origin: ORIGIN });
      const opts = await lead.post('/api/auth/webauthn/register/options');
      expect(opts.status).toBe(200);
      expect((await lead.post('/api/auth/webauthn/register', { name: 'Phone', credential: auth.create(opts.body.publicKey) })).status).toBe(200);
      const state = (await lead.get('/api/auth/state')).body;
      expect(state.mfaEnrollmentBlocked).toBe(false);
      expect(state.mfaEnrollmentRequired).toBe(false);
    } finally {
      await t.db.query(`delete from settings where key = 'auth.mfa_enforcement'`);
    }
  });

  it('has an API description for every passkey route', () => {
    const mine = t.core.openapi.routes()
      .filter((r) => r.url.startsWith('/api/auth/webauthn/') || r.url.includes('/passkeys'))
      .map((r) => `${r.method} ${r.url}`).sort();
    expect(mine.length).toBe(10);
    expect(WEBAUTHN_DOCS.map((d) => `${d.method} ${d.path}`).sort()).toEqual(mine);
  });

  it('needs a recent password confirmation to add or remove a key, and a host name rather than an IP address', async () => {
    const stale = await t.as('security_lead');
    await t.db.query(`update sessions set confirmed_at = now() - interval '1 hour' where user_id = $1`, [stale.userId]);
    expect((await stale.post('/api/auth/webauthn/register/options')).body.error.code).toBe('reauth_required');
    const ip = await raw(t, 'POST', '/api/auth/webauthn/login/options', {}, undefined, '127.0.0.1:8142');
    expect(ip.status).toBe(400);
    expect(ip.body.error.code).toBe('passkeys_unavailable');
    expect(ip.body.error.message).toMatch(/localhost/);
  });
});

describe('second factor on a new installation (E02-17)', () => {
  const fresh = async (secondFactor?: string) => {
    const built = await buildApp({ dataDir: 'memory', serveWeb: false });
    // ADMIN names `notice`; `none` sends a setup body that names no choice at all.
    const { secondFactor: _ignored, ...plain } = ADMIN;
    const body = secondFactor === 'none' ? plain : { ...ADMIN, ...(secondFactor ? { secondFactor } : {}) };
    const setup = await raw(built, 'POST', '/api/setup', body);
    expect(setup.status).toBe(200);
    return { built, cookie: setup.cookie!, setup: setup.body };
  };

  it('the wizard\'s "required" applies at once and leads the administrator to enrollment', async () => {
    const { built, cookie, setup } = await fresh('required');
    try {
      expect(setup.secondFactor).toBe('required');
      const state = await raw(built, 'GET', '/api/auth/state', undefined, cookie);
      expect(state.body).toMatchObject({ mfaEnforcement: 'required', mfaEnrollmentBlocked: true });
      expect((await raw(built, 'GET', '/api/meta', undefined, cookie)).status).toBe(403);
      // A passkey enrolls them.
      const auth = new SoftAuthenticator({ origin: ORIGIN });
      const opts = await raw(built, 'POST', '/api/auth/webauthn/register/options', {}, cookie);
      await raw(built, 'POST', '/api/auth/webauthn/register', { name: 'Admin key', credential: auth.create(opts.body.publicKey) }, cookie);
      expect((await raw(built, 'GET', '/api/meta', undefined, cookie)).status).toBe(200);
      expect((await built.db.query(`select 1 from audit_events where action = 'setup.second_factor'`)).length).toBe(1);
    } finally {
      await built.close();
    }
  });

  it('requires it when setup names no choice (E02-19)', async () => {
    const { built, cookie, setup } = await fresh('none');
    try {
      expect(setup.secondFactor).toBe('required');
      expect((await raw(built, 'GET', '/api/auth/state', undefined, cookie)).body.mfaEnforcement).toBe('required');
    } finally {
      await built.close();
    }
  });

  it('keeps "notice" when setup asks for only a reminder', async () => {
    const { built, cookie, setup } = await fresh('notice');
    try {
      expect(setup.secondFactor).toBe('notice');
      expect((await raw(built, 'GET', '/api/auth/state', undefined, cookie)).body.mfaEnforcement).toBe('notice');
    } finally {
      await built.close();
    }
  });
});
