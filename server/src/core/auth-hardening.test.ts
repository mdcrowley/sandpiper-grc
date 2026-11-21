import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { ADMIN, testApp } from '../test/helpers.ts';
import { createSession, hashPassword, SESSION_COOKIE, storeTotpSecret } from './auth.ts';
import { generateTotpSecret } from './totp.ts';

// Wave 9 security fixes to sign-in and account security (review sec-auth SA-1..SA-10).

let t: Awaited<ReturnType<typeof testApp>>;
const PASSWORD = 'tram depot lantern 42';
let ipSeq = 10;
const freshIp = () => `10.9.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;

async function person(username: string, opts: { roles?: string[] } = {}) {
  const u = await t.db.one<{ id: string }>(
    `insert into users (username, email, display_name, status, password_hash) values ($1, $2, $3, 'active', $4) returning id`,
    [username, `${username}@example.test`, `Person ${username}`, await hashPassword(PASSWORD)]);
  for (const r of opts.roles ?? ['agent']) {
    await t.db.query('insert into user_roles (user_id, role_id) select $1, id from roles where key = $2', [u!.id, r]);
  }
  return u!.id;
}

async function send(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, opts: { body?: unknown; ip?: string; cookie?: string; token?: string } = {}) {
  const res = await t.app.inject({
    method, url, remoteAddress: opts.ip ?? '127.0.0.1',
    headers: {
      'x-grc-csrf': '1',
      ...(opts.cookie ? { cookie: `${SESSION_COOKIE}=${opts.cookie}` } : {}),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    ...(opts.body !== undefined ? { payload: opts.body as object } : method === 'POST' || method === 'PATCH' ? { payload: {} } : {}),
  });
  let body: any = null;
  try { body = res.json(); } catch { /* not JSON */ }
  return { status: res.statusCode, body, cookies: res.cookies };
}
const login = (username: string, password: string, ip: string, extra: Record<string, unknown> = {}) =>
  send('POST', '/api/auth/login', { body: { username, password, ...extra }, ip });
const account = (id: string) => t.db.one<{ failed_attempts: number; locked: boolean }>(
  'select failed_attempts, (locked_until is not null and locked_until > now()) as locked from users where id = $1', [id]);

async function tokenFor(userId: string, scopes = ['tickets.view']) {
  const cookie = await createSession(t.db, userId);
  const made = await send('POST', '/api/me/tokens', { cookie, body: { name: `Token ${Math.random()}`, scopes, expiresInDays: 30 } });
  expect(made.status).toBe(201);
  return made.body.token as string;
}

beforeAll(async () => { t = await testApp(); }, 120_000);
afterAll(async () => { await t.close(); });

describe('encoded paths (SA-1, SA-2)', () => {
  it('refuses /%61pi/... instead of answering it without a sign-in', async () => {
    expect((await send('GET', '/api/users/options')).status).toBe(401);
    const encoded = await send('GET', '/%61pi/users/options?q=adm');
    expect([encoded.status, encoded.body.error.code]).toEqual([400, 'bad_path']);
    for (const url of ['/%61pi/openapi.json', '/%61pi/meta', '/%61pi/version', '/%61pi/search?q=a', '/api/%73earch?q=a']) {
      expect([url, (await send('GET', url)).status]).toEqual([url, 400]);
    }
  });

  it('keeps a narrow token away from account security however the path is spelled', async () => {
    const owner = await person('token_owner');
    const token = await tokenFor(owner);
    expect((await send('POST', '/api/auth/totp/begin', { token })).body.error.code).toBe('token_not_allowed');
    expect((await send('POST', '/api/v1/auth/totp/begin', { token })).body.error.code).toBe('token_not_allowed');
    expect((await send('POST', '/api/%61uth/totp/begin', { token })).body.error.code).toBe('bad_path');
    expect((await send('GET', '/api/me/tok%65ns', { token })).body.error.code).toBe('bad_path');
    expect((await send('GET', '/api/v1/auth/sessions', { token })).body.error.code).toBe('token_not_allowed');
    expect((await t.db.one<{ s: string | null }>('select totp_secret as s from users where id = $1', [owner]))!.s).toBeNull();
  });
});

describe('sign-in limits under parallel attempts (SA-3)', () => {
  it('counts every one of many simultaneous wrong passwords against the account', async () => {
    const id = await person('parallel_target');
    const answers = await Promise.all(Array.from({ length: 12 }, (_v, i) => login('parallel_target', `wrong guess number ${i}`, freshIp())));
    expect(answers.every((a) => a.status === 401)).toBe(true);
    // At most five guesses were checked; the rest met the lock the fifth set.
    const checked = await t.db.query(`select 1 from audit_events where record_id = $1 and summary like 'Sign-in failed (wrong password)%'`, [id]);
    expect(checked.length).toBeLessThanOrEqual(5);
    expect(await account(id)).toMatchObject({ locked: true });
    expect((await account(id))!.failed_attempts).toBeGreaterThanOrEqual(5);
    // Locked: even the right password is refused, the same way.
    expect((await login('parallel_target', PASSWORD, freshIp())).body.error.code).toBe('invalid_credentials');
  });

  it('counts every one of many simultaneous attempts from one address', async () => {
    const ip = freshIp();
    const answers = await Promise.all(Array.from({ length: 30 }, (_v, i) => login(`nobody_${i}`, 'not a real password at all', ip)));
    // Never more than the limit (20) checked. On a database server, attempts that arrive together
    // may see each other's claims and all be refused: refusing more is safe, letting more through is not.
    const checked = answers.filter((a) => a.status === 401).length;
    expect(answers.every((a) => a.status === 401 || a.status === 429)).toBe(true);
    // The embedded database runs one statement at a time: exactly the limit is checked there.
    if (!process.env.GRC_TEST_DATABASE && !process.env.GRC_TEST_DATABASE_URL) expect(checked).toBe(20);
    expect(checked).toBeLessThanOrEqual(20);
  });

  it('does not count a right password that is waiting for its second factor', async () => {
    const id = await person('waits_for_code');
    await storeTotpSecret(t.db, id, generateTotpSecret());
    await t.db.query('update users set totp_enabled = true where id = $1', [id]);
    for (let i = 0; i < 7; i++) expect((await login('waits_for_code', PASSWORD, freshIp())).body.error.code).toBe('mfa_required');
    expect(await account(id)).toEqual({ failed_attempts: 0, locked: false });
    // Wrong codes still count.
    for (let i = 0; i < 5; i++) await login('waits_for_code', PASSWORD, freshIp(), { totp: '000000' });
    expect(await account(id)).toMatchObject({ locked: true });
  });

  it('gives back a successful sign-in, so only failures fill the address limit', async () => {
    await person('often_in');
    const ip = freshIp();
    for (let i = 0; i < 25; i++) expect((await login('often_in', PASSWORD, ip)).status).toBe(200);
  });
});

describe('passkey sign-in step (SA-4, SA-6)', () => {
  it('counts wrong passwords towards the lockout and answers a right one with no key like a wrong one', async () => {
    const id = await person('no_keys_here');
    const right = await send('POST', '/api/auth/webauthn/login/options', { body: { username: 'no_keys_here', password: PASSWORD }, ip: freshIp() });
    const wrong = await send('POST', '/api/auth/webauthn/login/options', { body: { username: 'no_keys_here', password: 'wrong password here' }, ip: freshIp() });
    expect([right.status, right.body]).toEqual([wrong.status, wrong.body]);
    expect(right.body.error.code).toBe('invalid_credentials');
    expect((await account(id))!.failed_attempts).toBe(1);
    for (let i = 0; i < 4; i++) {
      await send('POST', '/api/auth/webauthn/login/options', { body: { username: 'no_keys_here', password: `wrong ${i}` }, ip: freshIp() });
    }
    expect(await account(id)).toMatchObject({ failed_attempts: 5, locked: true });
    expect((await login('no_keys_here', PASSWORD, freshIp())).body.error.code).toBe('invalid_credentials');
  });

  it('spends the same work on a locked or unknown account as on a wrong password', async () => {
    const id = await person('timing_locked');
    await t.db.query(`update users set failed_attempts = 9, locked_until = now() + interval '1 hour' where id = $1`, [id]);
    await person('timing_open');
    const median = async (fn: () => Promise<unknown>) => {
      const ms: number[] = [];
      for (let i = 0; i < 5; i++) {
        const s = performance.now();
        await fn();
        ms.push(performance.now() - s);
      }
      return ms.sort((a, b) => a - b)[2];
    };
    const wrong = await median(() => login('timing_open', 'a wrong password here', freshIp()));
    await t.db.query('update users set failed_attempts = 0, locked_until = null where username = $1', ['timing_open']);
    const locked = await median(() => login('timing_locked', 'a wrong password here', freshIp()));
    const unknown = await median(() => login('timing_nobody', 'a wrong password here', freshIp()));
    const options = await median(() => send('POST', '/api/auth/webauthn/login/options', { body: { username: 'timing_nobody', password: 'x' }, ip: freshIp() }));
    // Before the fix a locked account answered about seven times faster, and the passkey step skipped the hash.
    expect(locked).toBeGreaterThan(wrong * 0.5);
    expect(unknown).toBeGreaterThan(wrong * 0.5);
    expect(options).toBeGreaterThan(wrong * 0.5);
  });
});

describe('account security changes', () => {
  it('needs a recent password confirmation to start an authenticator app (SA-7)', async () => {
    const id = await person('stale_session');
    const cookie = await createSession(t.db, id);
    await t.db.query(`update sessions set confirmed_at = now() - interval '1 hour' where user_id = $1`, [id]);
    const refused = await send('POST', '/api/auth/totp/begin', { cookie });
    expect([refused.status, refused.body.error.code]).toEqual([403, 'reauth_required']);
    expect((await send('POST', '/api/auth/confirm', { cookie, body: { password: PASSWORD } })).status).toBe(200);
    expect((await send('POST', '/api/auth/totp/begin', { cookie })).status).toBe(200);
  });

  it('limits and audits wrong current passwords when changing a password (SA-10)', async () => {
    const id = await person('guessing_session');
    const cookie = await createSession(t.db, id);
    const answers = [];
    for (let i = 0; i < 9; i++) answers.push((await send('POST', '/api/auth/change-password', { cookie, body: { currentPassword: `guess ${i}`, newPassword: 'another long passphrase 7' } })).status);
    expect(answers.slice(0, 8)).toEqual(Array(8).fill(400));
    expect(answers[8]).toBe(429);
    const refused = await t.db.query(`select 1 from audit_events where record_id = $1 and action = 'password.change_refused'`, [id]);
    expect(refused.length).toBe(8);
  });

  it('revokes API tokens and assistant connections on a password change, a reset and a second-factor reset (SA-8)', async () => {
    const grant = async (userId: string) => {
      if (!(await t.db.one<{ t: string | null }>(`select to_regclass('public.mcp_oauth_grants')::text as t`))?.t) return null;
      return (await t.db.one<{ id: string }>(
        `insert into mcp_oauth_grants (client_id, user_id, name, scope, permissions, expires_at)
         values ('invented-client', $1, 'Invented assistant', 'mcp', '[]'::jsonb, now() + interval '30 days') returning id`, [userId]))!.id;
    };
    const live = async (token: string) => Boolean((await send('GET', '/api/auth/state', { token })).body?.user);
    const grantRevoked = async (gid: string | null) => gid === null
      || Boolean((await t.db.one<{ r: string | null }>('select revoked_at as r from mcp_oauth_grants where id = $1', [gid]))!.r);

    // 1. The person changes their own password.
    const a = await person('changes_password');
    const tokenA = await tokenFor(a);
    const grantA = await grant(a);
    expect(await live(tokenA)).toBe(true);
    const cookie = await createSession(t.db, a);
    const changed = await send('POST', '/api/auth/change-password', { cookie, body: { currentPassword: PASSWORD, newPassword: 'a brand new passphrase 9' } });
    expect(changed.status).toBe(200);
    expect(changed.body.revoked.tokens).toBe(1);
    expect(await live(tokenA)).toBe(false);
    expect(await grantRevoked(grantA)).toBe(true);

    // 2. A reset link is redeemed.
    const b = await person('resets_password');
    const tokenB = await tokenFor(b);
    const grantB = await grant(b);
    const link = await t.api.post(`/api/admin/users/${b}/reset-link`);
    expect(link.status).toBe(200);
    const raw = new URL(link.body.link ?? link.body.resetLink, 'http://x').searchParams.get('token');
    expect((await send('POST', '/api/auth/redeem', { body: { token: raw, password: 'reset passphrase for rail 3' } })).status).toBe(200);
    expect(await live(tokenB)).toBe(false);
    expect(await grantRevoked(grantB)).toBe(true);

    // 3. An administrator resets the second factor.
    const c = await person('loses_factor');
    const tokenC = await tokenFor(c);
    const grantC = await grant(c);
    expect((await t.api.post(`/api/admin/users/${c}/reset-mfa`)).status).toBe(200);
    expect(await live(tokenC)).toBe(false);
    expect(await grantRevoked(grantC)).toBe(true);
    const audit = await t.db.one<{ summary: string }>(`select summary from audit_events where record_id = $1 and action = 'mfa.reset'`, [c]);
    expect(audit!.summary).toContain('1 API token(s)');

    // Someone else's tokens are untouched.
    const d = await person('bystander');
    const tokenD = await tokenFor(d);
    await t.api.post(`/api/admin/users/${c}/reset-mfa`);
    expect(await live(tokenD)).toBe(true);
  });
});

describe('first-run setup (SA-9)', () => {
  // Not over the test wire-protocol bridge (GRC_TEST_DATABASE=pg), which mixes up the messages of
  // overlapping transactions; the embedded database and real PostgreSQL run it.
  it.skipIf(String(process.env.GRC_TEST_DATABASE ?? '').toLowerCase() === 'pg')('creates exactly one administrator when setup requests race', async () => {
    const fresh = await buildApp({ dataDir: 'memory', serveWeb: false });
    try {
      const answers = await Promise.all(Array.from({ length: 5 }, (_v, i) => fresh.app.inject({
        method: 'POST', url: '/api/setup', headers: { 'x-grc-csrf': '1' },
        payload: { ...ADMIN, username: `first_admin_${i}`, email: `first${i}@example.test` },
      })));
      expect(answers.map((a) => a.statusCode).sort()).toEqual([200, 409, 409, 409, 409]);
      const admins = await fresh.db.query(
        `select u.username from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id where r.key = 'administrator'`);
      expect(admins.length).toBe(1);
    } finally {
      await fresh.close();
    }
  }, 120_000);
});
