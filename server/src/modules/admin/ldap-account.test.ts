// Directory (LDAP) sign-in on Account security (E02-29): a passkey as the second step after a
// directory password, confirming one's identity with the directory password (for a person with no
// password here), and linking a directory from Account security. Against the stand-in directory
// (core/identity/ldap-fake-server.ts) and the software authenticator (core/webauthn/softauthn.ts).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../../core/auth.ts';
import { startFakeLdap, type FakeLdap } from '../../core/identity/ldap-fake-server.ts';
import { SoftAuthenticator } from '../../core/webauthn/softauthn.ts';
import { ADMIN, testApp } from '../../test/helpers.ts';

const BASE = 'dc=example,dc=org';
const SERVICE = { dn: `cn=grc-service,ou=services,${BASE}`, password: 'service-pass-31337' };
const DANA = { user: 'dana', password: 'route-14-depot' };
const KEY = 'example-directory';
// app.inject sends "Host: localhost:80": the relying party is localhost.
const ORIGIN = 'http://localhost:80';

let t: Awaited<ReturnType<typeof testApp>>;
let ldap: FakeLdap;
let dana = ''; // her session cookie
let danaId = '';
const auth = new SoftAuthenticator({ origin: ORIGIN });

const person = (cn: string, sam: string, password: string, mail: string, guid: number) => ({
  dn: `cn=${cn},ou=people,${BASE}`, password,
  attributes: { objectClass: ['person', 'user'], objectCategory: ['person'], sAMAccountName: [sam], mail: [mail], displayName: [cn], objectGUID: [Buffer.alloc(16, guid)], userAccountControl: ['512'] },
});

async function call(method: 'GET' | 'POST', url: string, body?: unknown, cookie?: string) {
  const res = await t.app.inject({
    method, url, headers: { 'x-grc-csrf': '1', ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}) },
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  let parsed: any = null;
  try { parsed = res.json(); } catch { /* empty */ }
  return { status: res.statusCode, body: parsed, cookie: res.cookies.find((c) => c.name === SESSION_COOKIE)?.value };
}
const audited = async (action: string) =>
  (await t.db.query<{ summary: string }>('select summary from audit_events where action = $1 order by id', [action])).map((r) => r.summary);
const login = (body: Record<string, unknown>) => call('POST', `/api/auth/sso/${KEY}/login`, body);

beforeAll(async () => {
  t = await testApp();
  ldap = await startFakeLdap({
    mode: 'ldaps',
    entries: [
      { dn: BASE, attributes: { objectClass: ['domain'] } },
      { dn: SERVICE.dn, password: SERVICE.password, attributes: { objectClass: ['person'] } },
      person('Dana Driver', 'dana', DANA.password, 'dana.driver@example.org', 1),
      person('Rail Planner', 'rail', 'timetable-rail-9', 'rail.planner@example.org', 2),
      person('Test Admin', 'tadmin', 'admin-directory-pass', ADMIN.email, 3),
      person('Other Admin', 'oadmin', 'other-directory-pass', 'someone.else@example.org', 4),
    ],
  });
  const res = await t.api.post('/api/admin/identity-providers', {
    key: KEY, name: 'Example directory', type: 'ldap', enabled: true, secret: SERVICE.password,
    config: { directory: 'ad', url: ldap.url, startTls: false, caCert: ldap.cert, bindDn: SERVICE.dn, baseDn: BASE, trustEmail: true, jitEnabled: true, jitDomains: ['example.org'] },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const first = await login({ username: DANA.user, password: DANA.password });
  expect(first.status).toBe(200);
  dana = first.cookie!;
  danaId = (await t.db.one<{ id: string }>(`select id from users where email = 'dana.driver@example.org'`))!.id;
  await call('POST', `/api/auth/sso/${KEY}/login`, { username: 'rail', password: 'timetable-rail-9' }); // a second directory person
});
afterAll(async () => { await t.close(); await ldap.close(); });
beforeEach(async () => { await t.db.query('delete from rate_limit_hits'); });

describe('confirming with the directory password (E02-29)', () => {
  it('lists the directory as the way to confirm for a person with no password here', async () => {
    const res = await call('GET', '/api/auth/sso/confirm-methods', undefined, dana);
    // E02-30: with the directory user name she signed in with, to fill in; never the password.
    expect(res.body).toEqual({ password: false, directories: [{ key: KEY, name: 'Example directory', username: DANA.user }] });
    const stored = JSON.stringify(await t.db.query('select * from user_identities where user_id = $1', [danaId]));
    expect(stored).not.toContain(DANA.password);
    expect((await call('POST', '/api/auth/confirm', { password: 'anything' }, dana)).status).toBe(400); // no password here
  });

  it('confirms with the linked directory entry only, and audits it', async () => {
    await t.db.query(`update sessions set confirmed_at = now() - interval '1 hour' where user_id = $1`, [danaId]); // sign-in counts as a confirmation
    expect((await call('POST', '/api/auth/webauthn/register/options', undefined, dana)).body.error.code).toBe('reauth_required');
    const wrong = await call('POST', `/api/auth/sso/${KEY}/confirm`, { username: DANA.user, password: 'not-it' }, dana);
    expect([wrong.status, wrong.body.error.code]).toEqual([400, 'validation']);
    expect(wrong.body.error.fields.password).toMatch(/not your Example directory/);
    const someoneElse = await call('POST', `/api/auth/sso/${KEY}/confirm`, { username: 'rail', password: 'timetable-rail-9' }, dana);
    expect(someoneElse.body.error.fields.password).toMatch(/not the Example directory details linked/);
    expect((await audited('reauth.failure')).pop()).toMatch(/different directory entry/);
    const ok = await call('POST', `/api/auth/sso/${KEY}/confirm`, { username: DANA.user, password: DANA.password }, dana);
    expect(ok.status).toBe(200);
    expect(ok.body.minutes).toBeGreaterThan(0);
    expect((await audited('reauth.success')).pop()).toMatch(/Example directory password/);
    // E02-30: the user name that worked is kept (with surrounding spaces trimmed), a wrong one is not.
    await t.db.query(`update user_identities set login_name = null where user_id = $1`, [danaId]);
    await call('POST', `/api/auth/sso/${KEY}/confirm`, { username: ' rail ', password: 'timetable-rail-9' }, dana);
    expect((await t.db.one<{ n: string | null }>('select login_name as n from user_identities where user_id = $1', [danaId]))!.n).toBeNull();
    await t.db.query(`update sessions set confirmed_at = null where user_id = $1`, [danaId]);
    expect((await call('POST', `/api/auth/sso/${KEY}/confirm`, { username: ` ${DANA.user} `, password: DANA.password }, dana)).status).toBe(200);
    expect((await call('GET', '/api/auth/sso/confirm-methods', undefined, dana)).body.directories[0].username).toBe(DANA.user);
    // Now she can add a passkey, which needs a recent confirmation.
    const opts = await call('POST', '/api/auth/webauthn/register/options', undefined, dana);
    expect(opts.status).toBe(200);
    const reg = await call('POST', '/api/auth/webauthn/register', { name: 'Depot laptop', credential: auth.create(opts.body.publicKey) }, dana);
    expect(reg.status, JSON.stringify(reg.body)).toBe(200);
  });

  it('refuses a directory the person is not linked to, and limits attempts as a password confirmation', async () => {
    const admin = await t.db.one<{ id: string }>(`select id from users where username = 'admin'`);
    expect((await t.api.post(`/api/auth/sso/${KEY}/confirm`, { username: 'tadmin', password: 'admin-directory-pass' })).body.error.code).toBe('not_linked');
    expect(admin).toBeTruthy();
    for (let i = 0; i < 8; i += 1) await call('POST', `/api/auth/sso/${KEY}/confirm`, { username: DANA.user, password: `nope-${i}` }, dana);
    expect((await call('POST', `/api/auth/sso/${KEY}/confirm`, { username: DANA.user, password: DANA.password }, dana)).status).toBe(429);
    await t.db.query('delete from rate_limit_hits');
    await t.db.query('update users set failed_attempts = 0, locked_until = null where id = $1', [danaId]);
  });
});

describe('a passkey as the second step after a directory password (E02-29)', () => {
  it('asks for the passkey, hands out the options only for the right directory password, and signs in with it', async () => {
    const ask = await login({ username: DANA.user, password: DANA.password });
    expect([ask.status, ask.body.error.code]).toEqual([401, 'mfa_required']);
    expect(ask.body.error.fields).toEqual({ passkey: 'required', recovery: 'available' });
    expect(ask.cookie).toBeUndefined();

    const refused = await call('POST', `/api/auth/sso/${KEY}/passkey-options`, { username: DANA.user, password: 'wrong' });
    expect(refused.status).toBe(401);
    expect(refused.body.publicKey).toBeUndefined();
    const options = await call('POST', `/api/auth/sso/${KEY}/passkey-options`, { username: DANA.user, password: DANA.password });
    expect(options.status).toBe(200);
    expect(options.body.publicKey.allowCredentials).toHaveLength(1);
    // Another directory person with no key gets no options.
    expect((await call('POST', `/api/auth/sso/${KEY}/passkey-options`, { username: 'rail', password: 'timetable-rail-9' })).body.error.code).toBe('no_passkeys');

    const assertion = auth.get(options.body.publicKey);
    const ok = await login({ username: DANA.user, password: DANA.password, webauthn: assertion });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.cookie).toBeTruthy();
    expect((await audited('signin.success')).pop()).toMatch(/Example directory.*with a passkey/);
    expect((await audited('passkey.used')).pop()).toMatch(/Depot laptop/);

    // The same answer twice is refused (its challenge is used up), audited and counted toward lockout.
    const replay = await login({ username: DANA.user, password: DANA.password, webauthn: assertion });
    expect(replay.status).toBe(401);
    expect((await audited('signin.failure')).pop()).toMatch(/passkey or security key not accepted/);
    expect((await t.db.one<{ n: number }>('select failed_attempts as n from users where id = $1', [danaId]))!.n).toBe(1);
    await t.db.query('update users set failed_attempts = 0 where id = $1', [danaId]);
  });

  it('keeps the existing limits: wrong directory passwords at the passkey step count as at sign-in', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await call('POST', `/api/auth/sso/${KEY}/passkey-options`, { username: DANA.user, password: `wrong-${i}` })).status).toBe(401);
    }
    expect((await call('POST', `/api/auth/sso/${KEY}/passkey-options`, { username: DANA.user, password: DANA.password })).status).toBe(401);
    expect((await audited('signin.failure')).pop()).toMatch(/too many failed directory sign-ins/);
    expect((await t.db.one<{ locked: boolean }>('select locked_until > now() as locked from users where id = $1', [danaId]))!.locked).toBe(true);
    await t.db.query('update users set failed_attempts = 0, locked_until = null where id = $1', [danaId]);
  });

  it('asks a person with a passkey for it when confirming with the directory password', async () => {
    await t.db.query(`update sessions set confirmed_at = null where user_id = $1`, [danaId]);
    const first = await call('POST', `/api/auth/sso/${KEY}/confirm`, { username: DANA.user, password: DANA.password }, dana);
    expect([first.status, first.body.error.code]).toEqual([400, 'second_factor_required']);
    expect(first.body.error.fields.passkey).toBe('available');
    const options = await call('POST', '/api/auth/webauthn/confirm/options', undefined, dana);
    const done = await call('POST', `/api/auth/sso/${KEY}/confirm`, { username: DANA.user, password: DANA.password, webauthn: auth.get(options.body.publicKey) }, dana);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect((await audited('reauth.success')).pop()).toMatch(/Example directory password and passkey/);
  });
});

describe('linking a directory from Account security (E02-29)', () => {
  it('offers the directory, links it with the directory password after a recent confirmation, and audits it', async () => {
    const mine = await t.api.get('/api/auth/identities');
    expect(mine.body.available).toContainEqual({ key: KEY, name: 'Example directory', style: 'credentials' });
    await t.db.query(`update sessions set confirmed_at = now() - interval '1 hour'`);
    expect((await t.api.post(`/api/auth/sso/${KEY}/link-directory`, { username: 'tadmin', password: 'admin-directory-pass' })).body.error.code).toBe('reauth_required');
    await t.db.query(`update sessions set confirmed_at = now()`);
    expect((await t.api.post(`/api/auth/sso/${KEY}/link-directory`, { username: 'tadmin', password: 'wrong' })).status).toBe(401);
    expect((await audited('identity.failure')).pop()).toMatch(/Linking failed.*wrong directory password/);
    const other = await t.api.post(`/api/auth/sso/${KEY}/link-directory`, { username: 'oadmin', password: 'other-directory-pass' });
    expect([other.status, other.body.error.code]).toEqual([409, 'email']);
    const taken = await t.api.post(`/api/auth/sso/${KEY}/link-directory`, { username: DANA.user, password: DANA.password });
    expect(taken.body.error.code).toBe('taken');
    const ok = await t.api.post(`/api/auth/sso/${KEY}/link-directory`, { username: 'tadmin', password: 'admin-directory-pass' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await audited('identity.link')).pop()).toMatch(/Example directory identity linked by the person/);
    const after = await t.api.get('/api/auth/identities');
    expect(after.body.identities.map((i: any) => i.provider_key)).toContain(KEY);
    expect(after.body.available.map((p: any) => p.key)).not.toContain(KEY);
    expect((await t.api.post(`/api/auth/sso/${KEY}/link-directory`, { username: 'tadmin', password: 'admin-directory-pass' })).body.error.code).toBe('already_linked');
    // The administrator can now sign in with the directory too, and confirm with it.
    expect((await login({ username: 'tadmin', password: 'admin-directory-pass' })).status).toBe(200);
    expect((await t.api.get('/api/auth/sso/confirm-methods')).body).toEqual({ password: true, directories: [{ key: KEY, name: 'Example directory', username: 'tadmin' }] });
  });
});
