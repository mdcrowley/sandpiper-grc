// Behavior tests for POST /api/auth/sso/:key/reauth [signed-in] and POST /api/auth/sso/pending/cancel
// [public] (E40-05), against the stand-in OpenID Connect provider running in this process. Kept apart
// from sso.test.ts. Invented people and addresses only.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSession, hashPassword, SESSION_COOKIE } from '../../core/auth.ts';
import { startFakeProvider, type FakeProvider } from '../../core/identity/fake-provider.ts';
import { testApp } from '../../test/helpers.ts';

let t: Awaited<ReturnType<typeof testApp>>;
let idp: FakeProvider;
let providerId = '';
const KEY = 'rb-idp';

beforeAll(async () => {
  t = await testApp();
  idp = await startFakeProvider();
  await t.db.query(`insert into settings (key, value) values ('integrations.allowed_hosts', '["127.0.0.1"]'::jsonb)
    on conflict (key) do update set value = excluded.value`);
  const res = await t.api.post('/api/admin/identity-providers', {
    key: KEY, name: 'Invented directory', type: 'oidc', enabled: true,
    config: { issuer: idp.issuer, clientId: idp.clientId }, secret: idp.clientSecret,
  });
  expect(res.status).toBe(201);
  providerId = res.body.id;
}, 60_000);
afterAll(async () => { await t?.close(); await idp?.close(); });
beforeEach(async () => { await t.db.query('delete from rate_limit_hits'); });

async function inject(method: 'GET' | 'POST', url: string, cookies: Record<string, string> = {}, payload?: unknown) {
  const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  return t.app.inject({ method, url, headers: { 'x-grc-csrf': '1', ...(cookie ? { cookie } : {}) }, ...(payload !== undefined ? { payload: payload as object } : {}) });
}
const cookieOf = (res: { cookies: { name: string; value: string }[] }, name: string) => res.cookies.find((c) => c.name === name && c.value)?.value;
async function atProvider(redirectUrl: string): Promise<string> {
  const res = await fetch(redirectUrl, { redirect: 'manual' });
  expect(res.status).toBe(302);
  const back = new URL(res.headers.get('location')!);
  return `${back.pathname}${back.search}`;
}
async function makeUser(username: string, email: string) {
  return (await t.db.one<{ id: string }>(
    `insert into users (username, email, display_name, status, password_hash) values ($1,$2,$3,'active',$4) returning id`,
    [username, email, `Person ${username}`, await hashPassword('a long invented passphrase 7')]))!.id;
}
const link = (userId: string, subject: string) =>
  t.db.query(`insert into user_identities (user_id, provider_id, subject, email, link_method) values ($1,$2,$3,$4,'self')`, [userId, providerId, subject, `${subject}@example.test`]);

describe('POST /api/auth/sso/:key/reauth', () => {
  it('sends a linked person to the provider and, when the same person signs in there, confirms the session again', async () => {
    const userId = await makeUser('rb_reauth', 'rb_reauth@example.test');
    await link(userId, 'rb-reauth-sub');
    const session = await createSession(t.db, userId);
    await t.db.query(`update sessions set confirmed_at = now() - interval '2 hours' where user_id = $1`, [userId]);

    const start = await inject('POST', `/api/auth/sso/${KEY}/reauth`, { [SESSION_COOKIE]: session }, { returnTo: '/account' });
    expect(start.statusCode).toBe(200);
    expect(Object.keys(start.json())).toEqual(['redirectUrl']);
    expect(start.json().redirectUrl.startsWith(idp.issuer)).toBe(true);
    const state = cookieOf(start, 'grc_sso')!;
    expect(state).toBeTruthy();

    idp.user = { sub: 'rb-reauth-sub', email: 'rb_reauth@example.test', email_verified: true };
    const back = await inject('GET', await atProvider(start.json().redirectUrl), { grc_sso: state });
    expect(back.headers.location).toMatch(/sso=confirmed/);
    const fresh = await t.db.one<{ ok: boolean }>(`select confirmed_at > now() - interval '1 minute' as ok from sessions where user_id = $1`, [userId]);
    expect(fresh!.ok).toBe(true);
    const ev = await t.db.query<any>(`select summary from audit_events where action = 'reauth.success' and record_id = $1`, [userId]);
    expect(ev).toEqual([{ summary: 'Identity confirmed again through Invented directory for administrative actions' }]);
  });

  it('does not confirm the session when a different person signs in at the provider', async () => {
    const userId = await makeUser('rb_reauth2', 'rb_reauth2@example.test');
    await link(userId, 'rb-reauth2-sub');
    const session = await createSession(t.db, userId);
    await t.db.query(`update sessions set confirmed_at = now() - interval '2 hours' where user_id = $1`, [userId]);
    const start = await inject('POST', `/api/auth/sso/${KEY}/reauth`, { [SESSION_COOKIE]: session }, {});
    idp.user = { sub: 'someone-else-sub', email: 'someone@example.test', email_verified: true };
    const back = await inject('GET', await atProvider(start.json().redirectUrl), { grc_sso: cookieOf(start, 'grc_sso')! });
    expect(back.headers.location).toMatch(/sso=reauth_failed/);
    const stale = await t.db.one<{ ok: boolean }>(`select confirmed_at < now() - interval '1 hour' as ok from sessions where user_id = $1`, [userId]);
    expect(stale!.ok).toBe(true);
    expect(await t.db.query(`select 1 from audit_events where action = 'reauth.success' and record_id = $1`, [userId])).toHaveLength(0);
  });

  it('needs a session, a linked identity, and a provider that is switched on', async () => {
    expect((await inject('POST', `/api/auth/sso/${KEY}/reauth`, {}, {})).statusCode).toBe(401);
    const userId = await makeUser('rb_unlinked', 'rb_unlinked@example.test');
    const session = await createSession(t.db, userId);
    const notLinked = await inject('POST', `/api/auth/sso/${KEY}/reauth`, { [SESSION_COOKIE]: session }, {});
    expect(notLinked.statusCode).toBe(409);
    expect(notLinked.json().error.code).toBe('not_linked');
    expect(cookieOf(notLinked, 'grc_sso')).toBeUndefined();
    expect((await inject('POST', '/api/auth/sso/no-such-provider/reauth', { [SESSION_COOKIE]: session }, {})).statusCode).toBe(404);

    await link(userId, 'rb-unlinked-sub');
    await t.db.query('update identity_providers set enabled = false where id = $1', [providerId]);
    try {
      expect((await inject('POST', `/api/auth/sso/${KEY}/reauth`, { [SESSION_COOKIE]: session }, {})).statusCode).toBe(404);
    } finally {
      await t.db.query('update identity_providers set enabled = true where id = $1', [providerId]);
    }
  });
});

describe('POST /api/auth/sso/pending/cancel', () => {
  it('drops a sign-in waiting to be linked, so it can no longer be completed', async () => {
    await makeUser('rb_pending', 'rb_pending@example.test');
    idp.user = { sub: 'rb-pending-sub', email: 'rb_pending@example.test', email_verified: true };
    const start = await inject('POST', `/api/auth/sso/${KEY}/start`, {}, {});
    expect(start.statusCode).toBe(200);
    const signedIn = await inject('GET', await atProvider(start.json().redirectUrl), { grc_sso: cookieOf(start, 'grc_sso')! });
    expect(signedIn.headers.location).toBe('/?sso=link');
    const pendingCookie = cookieOf(signedIn, 'grc_sso_link')!;
    expect((await inject('GET', '/api/auth/sso/pending', { grc_sso_link: pendingCookie })).json().pending).toBe(true);

    // Public: no session is needed.
    const res = await inject('POST', '/api/auth/sso/pending/cancel', { grc_sso_link: pendingCookie }, {});
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    const cleared = res.cookies.find((c) => c.name === 'grc_sso_link');
    expect(cleared?.value ?? '').toBe('');
    expect(await t.db.query(`select 1 from identity_flows where purpose = 'pending_link' and used_at is null`)).toHaveLength(0);

    // The same cookie no longer finds a waiting sign-in, nor completes one.
    expect((await inject('GET', '/api/auth/sso/pending', { grc_sso_link: pendingCookie })).json()).toEqual({ pending: false });
    const userId = (await t.db.one<{ id: string }>(`select id from users where username = 'rb_pending'`))!.id;
    const session = await createSession(t.db, userId);
    const complete = await inject('POST', '/api/auth/sso/pending/complete', { [SESSION_COOKIE]: session, grc_sso_link: pendingCookie }, {});
    expect(complete.statusCode).toBe(404);
    expect(await t.db.query('select 1 from user_identities where user_id = $1', [userId])).toHaveLength(0);
  });

  it('answers ok when nothing is waiting', async () => {
    const res = await inject('POST', '/api/auth/sso/pending/cancel', {}, {});
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect((await inject('POST', '/api/auth/sso/pending/cancel', { grc_sso_link: 'not-a-real-token' }, {})).json()).toEqual({ ok: true });
  });
});
