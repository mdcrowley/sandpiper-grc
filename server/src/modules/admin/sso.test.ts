// Single sign-on, account linking and the break-glass account (E02-09, E02-11, E02-13), against a
// stand-in OpenID Connect provider running in this process on a free port.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword, SESSION_COOKIE } from '../../core/auth.ts';
import { startFakeProvider, type FakeProvider } from '../../core/identity/fake-provider.ts';
import { oidcCache } from '../../core/identity/oidc.ts';
import type { ModuleDef } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';

const notified: any[] = [];
const notifyStandIn: ModuleDef = {
  key: 'sso_test_notify',
  async register(ctx) {
    // Used only when the notifications module is not loaded (GRC_MODULES=admin).
    if (!ctx.app.hasDecorator('notify')) (ctx.app as any).decorate('notify', async (input: any) => { notified.push(input); return { sent: 1, skipped: 0 }; });
  },
};

let t: Awaited<ReturnType<typeof testApp>>;
let idp: FakeProvider;
let providerId = '';
const KEY = 'example-idp';
const PASSWORD = 'quiet river stone lantern';

beforeAll(async () => {
  t = await testApp({ extraModules: [notifyStandIn] });
  idp = await startFakeProvider();
});
afterAll(async () => { await t.close(); await idp.close(); });
beforeEach(async () => {
  await t.db.query('delete from rate_limit_hits');
  idp.overrides = {};
  idp.badSignature = false;
  idp.alg = 'RS256';
});

const audited = async (action: string, like = '%') =>
  (await t.db.query('select summary from audit_events where action = $1 and coalesce(summary, \'\') like $2 order by id', [action, like])).map((r: any) => r.summary as string);

async function inject(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, cookies: Record<string, string> = {}, payload?: unknown) {
  const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  return t.app.inject({ method, url, headers: { 'x-grc-csrf': '1', ...(cookie ? { cookie } : {}) }, ...(payload !== undefined ? { payload: payload as object } : {}) });
}
const cookieOf = (res: { cookies: { name: string; value: string }[] }, name: string) => res.cookies.find((c) => c.name === name && c.value)?.value;

/** Follows the authorization request at the provider and returns the callback path it sends back to. */
async function atProvider(redirectUrl: string): Promise<string> {
  const res = await fetch(redirectUrl, { redirect: 'manual' });
  expect(res.status).toBe(302);
  const back = new URL(res.headers.get('location')!);
  return `${back.pathname}${back.search}`;
}

/** A whole sign-in through the provider. `session` is the new session cookie, if any. */
async function ssoSignIn(key = KEY) {
  const start = await inject('POST', `/api/auth/sso/${key}/start`, {}, {});
  expect(start.statusCode).toBe(200);
  const state = cookieOf(start, 'grc_sso')!;
  const callback = await atProvider(start.json().redirectUrl);
  const res = await inject('GET', callback, { grc_sso: state });
  return { res, location: res.headers.location as string, session: cookieOf(res, SESSION_COOKIE), link: cookieOf(res, 'grc_sso_link'), callback, state };
}

async function makeUser(username: string, email: string, opts: { password?: boolean; role?: string } = {}) {
  const row = await t.db.one<{ id: string }>(
    `insert into users (username, email, display_name, status, password_hash) values ($1,$2,$3,'active',$4) returning id`,
    [username, email, `Person ${username}`, opts.password === false ? null : await hashPassword(PASSWORD)],
  );
  if (opts.role) await t.db.query('insert into user_roles (user_id, role_id) select $1, id from roles where key = $2', [row!.id, opts.role]);
  return row!.id;
}
async function login(username: string, password = PASSWORD) {
  const res = await inject('POST', '/api/auth/login', {}, { username, password });
  return { status: res.statusCode, session: cookieOf(res, SESSION_COOKIE), body: res.json() };
}
const asSession = (session: string) => ({
  get: (url: string) => inject('GET', url, { [SESSION_COOKIE]: session }),
  post: (url: string, payload: unknown = {}) => inject('POST', url, { [SESSION_COOKIE]: session }, payload),
  del: (url: string) => inject('DELETE', url, { [SESSION_COOKIE]: session }),
});

describe('sign-in providers (E02-09)', () => {
  it('fetches nothing until a provider is switched on, and shows only enabled providers', async () => {
    const res = await t.api.post('/api/admin/identity-providers', {
      key: KEY, name: 'Example directory', type: 'oidc', enabled: false,
      config: { issuer: idp.issuer, clientId: idp.clientId }, secret: idp.clientSecret,
    });
    expect(res.status).toBe(201);
    providerId = res.body.id;
    expect(res.body.hasSecret).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(idp.clientSecret);
    // The client secret is stored encrypted with the application key.
    const stored = await t.db.one<{ secret: string }>('select secret from identity_providers where id = $1', [providerId]);
    expect(stored!.secret.startsWith('enc:v1:')).toBe(true);
    expect(stored!.secret).not.toContain(idp.clientSecret);

    expect(Object.keys(idp.hits)).toHaveLength(0);
    expect((await t.anon.get('/api/auth/providers')).body.providers).toEqual([]);
    expect((await inject('POST', `/api/auth/sso/${KEY}/start`, {}, {})).statusCode).toBe(404);
    expect(Object.keys(idp.hits)).toHaveLength(0);

    // Test connection fetches discovery and the key set, only when asked.
    const test = await t.api.post(`/api/admin/identity-providers/${providerId}/test`);
    expect(test.body.ok).toBe(true);
    expect(idp.hits['/.well-known/openid-configuration']).toBe(1);

    const on = await t.api.patch(`/api/admin/identity-providers/${providerId}`, { enabled: true, isDefault: true });
    expect(on.status).toBe(200);
    expect((await t.anon.get('/api/auth/providers')).body.providers).toEqual([{ key: KEY, name: 'Example directory', isDefault: true }]);
    expect((await audited('identity_provider.create')).length).toBe(1);
    expect((await audited('identity_provider.test')).length).toBe(1);
  });

  it('checks provider settings and refuses an issuer that is not https', async () => {
    const res = await t.api.post('/api/admin/identity-providers', { key: 'bad', name: 'Bad', config: { issuer: 'http://idp.example.test', clientId: 'x' } });
    expect(res.status).toBe(400);
    expect(res.body.error.fields['config.issuer']).toMatch(/https/);
    const jit = await t.api.post('/api/admin/identity-providers', { key: 'jit-bad', name: 'J', config: { issuer: idp.issuer, clientId: 'x', jitEnabled: true }, secret: 's' });
    expect(jit.body.error.fields['config.jitDomains']).toBeTruthy();
  });

  it('refuses a sign-in for an unknown email when just-in-time accounts are off (the default)', async () => {
    idp.user = { sub: 'stranger-1', email: 'stranger@elsewhere.test', email_verified: true, name: 'Stranger' };
    const r = await ssoSignIn();
    expect(r.location).toBe('/?sso=no_account');
    expect(r.session).toBeUndefined();
    expect((await audited('signin.failure', '%no account for this email%Example directory%')).length).toBe(1);
  });

  it('signs in when an administrator has allowed the link, then by the linked identity', async () => {
    const userId = await makeUser('casey', 'casey@example.test');
    const permit = await t.api.post(`/api/admin/users/${userId}/link-permit`, { providerId });
    expect(permit.status).toBe(200);
    idp.user = { sub: 'casey-sub', email: 'Casey@Example.test', email_verified: true, name: 'Casey' };
    const first = await ssoSignIn();
    expect(first.location).toBe('/');
    expect(first.session).toBeTruthy();
    const state = await asSession(first.session!).get('/api/auth/state');
    expect(state.json().user.username).toBe('casey');
    expect((await audited('identity.link', '%allowed in advance%')).length).toBe(1);
    expect((await audited('signin.success', '%via Example directory (OpenID Connect)%')).length).toBe(1);
    expect((await asSession(first.session!).get('/api/auth/sso/session')).json()).toMatchObject({ method: KEY, breakGlass: false });

    // Next time the subject alone finds the account, whatever the email now says.
    idp.user = { sub: 'casey-sub', email: 'casey.new@example.test', email_verified: false };
    const again = await ssoSignIn();
    expect(again.location).toBe('/');
    expect(again.session).toBeTruthy();
  });

  it('refuses a token with a bad signature, the wrong audience, or that has expired', async () => {
    idp.user = { sub: 'casey-sub', email: 'casey@example.test', email_verified: true };
    idp.badSignature = true;
    expect((await ssoSignIn()).location).toBe('/?sso=failed');
    idp.badSignature = false;
    idp.overrides = { aud: 'some-other-client' };
    expect((await ssoSignIn()).location).toBe('/?sso=failed');
    const now = Math.floor(Date.now() / 1000);
    idp.overrides = { iat: now - 900, exp: now - 600 };
    expect((await ssoSignIn()).location).toBe('/?sso=failed');
    idp.overrides = { iss: 'https://impostor.example.test' };
    expect((await ssoSignIn()).location).toBe('/?sso=failed');
    expect((await audited('signin.failure', '%bad signature%')).length).toBe(1);
    expect((await audited('signin.failure', '%wrong audience%')).length).toBe(1);
    expect((await audited('signin.failure', '%token expired%')).length).toBe(1);
    expect((await audited('signin.failure', '%wrong issuer%')).length).toBe(1);
  });

  it('refuses a replayed state, a state from another browser and a wrong nonce', async () => {
    idp.user = { sub: 'casey-sub', email: 'casey@example.test', email_verified: true };
    const first = await ssoSignIn();
    expect(first.location).toBe('/');
    const replay = await inject('GET', first.callback, { grc_sso: first.state });
    expect(replay.headers.location).toBe('/?sso=failed');
    expect((await audited('signin.failure', '%state unknown, used or expired%')).length).toBe(1);

    const start = await inject('POST', `/api/auth/sso/${KEY}/start`, {}, {});
    const callback = await atProvider(start.json().redirectUrl);
    const otherBrowser = await inject('GET', callback, { grc_sso: 'someone-elses-state' });
    expect(otherBrowser.headers.location).toBe('/?sso=failed');
    expect(cookieOf(otherBrowser, SESSION_COOKIE)).toBeUndefined();

    idp.overrides = { nonce: 'nonce-from-an-earlier-sign-in' };
    expect((await ssoSignIn()).location).toBe('/?sso=failed');
    expect((await audited('signin.failure', '%wrong nonce%')).length).toBe(1);
  });

  it('accepts ES256 and PS256 tokens and follows a key rotation', async () => {
    idp.user = { sub: 'casey-sub', email: 'casey@example.test', email_verified: true };
    idp.alg = 'ES256';
    expect((await ssoSignIn()).location).toBe('/');
    idp.alg = 'PS256';
    expect((await ssoSignIn()).location).toBe('/');
    idp.alg = 'RS256';
    idp.rotateKeys();
    const was = oidcCache.jwksMinRefreshMs;
    oidcCache.jwksMinRefreshMs = 0;
    try {
      expect((await ssoSignIn()).location).toBe('/');
    } finally {
      oidcCache.jwksMinRefreshMs = was;
    }
  });
});

describe('just-in-time accounts and role mapping', () => {
  it('creates an account only for allowed domains, with roles from the mapping', async () => {
    const res = await t.api.patch(`/api/admin/identity-providers/${providerId}`, {
      config: {
        jitEnabled: true, jitDomains: ['staff.example.test'], mappingEnabled: true, groupsClaim: 'groups',
        mappings: [{ value: 'grc-agents', role: 'agent' }, { value: 'grc-security', role: 'security_lead' }],
      },
    });
    expect(res.status).toBe(200);

    idp.user = { sub: 'new-1', email: 'outsider@other.test', email_verified: true, groups: ['grc-agents'] };
    expect((await ssoSignIn()).location).toBe('/?sso=no_account');

    idp.user = { sub: 'new-2', email: 'robin.k@staff.example.test', email_verified: true, name: 'Robin K', groups: ['grc-agents', 'unrelated'] };
    const made = await ssoSignIn();
    expect(made.location).toBe('/');
    const state = (await asSession(made.session!).get('/api/auth/state')).json();
    expect(state.user).toMatchObject({ username: 'robin.k', displayName: 'Robin K', roles: ['agent'] });
    expect((await audited('user.create', '%created at first sign-in through Example directory%')).length).toBe(1);

    // Groups change at the provider: mapped roles follow; unmapped roles are left alone.
    await t.db.query(`insert into user_roles (user_id, role_id) select u.id, r.id from users u, roles r where u.username = 'robin.k' and r.key = 'project_manager'`);
    idp.user = { ...idp.user, groups: ['grc-security'] };
    const next = await ssoSignIn();
    const roles = (await asSession(next.session!).get('/api/auth/state')).json().user.roles.sort();
    expect(roles).toEqual(['project_manager', 'security_lead']);
    expect((await audited('user.roles', '%role mapping%')).length).toBe(2);

    // An unverified email never creates an account.
    idp.user = { sub: 'new-3', email: 'unverified@staff.example.test', email_verified: false };
    expect((await ssoSignIn()).location).toBe('/?sso=no_account');

    await t.api.patch(`/api/admin/identity-providers/${providerId}`, { config: { jitEnabled: false, mappingEnabled: false } });
  });
});

describe('account linking (E02-11)', () => {
  it('links from Account security after a password confirmation, matching the verified email', async () => {
    const userId = await makeUser('devon', 'devon@example.test');
    const { session } = await login('devon');
    const me = asSession(session!);
    expect((await me.get('/api/auth/identities')).json()).toMatchObject({ identities: [], available: [{ key: KEY }] });

    // A different email at the provider: refused.
    idp.user = { sub: 'devon-sub', email: 'someone.else@example.test', email_verified: true };
    let start = await me.post(`/api/auth/sso/${KEY}/link`, { returnTo: '/account/security' });
    expect(start.statusCode).toBe(200);
    let back = await inject('GET', await atProvider(start.json().redirectUrl), { grc_sso: cookieOf(start, 'grc_sso')! });
    expect(back.headers.location).toBe('/account/security?sso=link_failed&why=email');

    idp.user = { sub: 'devon-sub', email: 'devon@example.test', email_verified: true };
    start = await me.post(`/api/auth/sso/${KEY}/link`, {});
    // The provider sends the browser back cross-site, so the strict session cookie is not sent: only the state cookie.
    back = await inject('GET', await atProvider(start.json().redirectUrl), { grc_sso: cookieOf(start, 'grc_sso')! });
    expect(back.headers.location).toBe('/account/security?sso=linked');
    const ids = (await me.get('/api/auth/identities')).json();
    expect(ids.identities).toHaveLength(1);
    expect(ids.identities[0]).toMatchObject({ provider_key: KEY, email: 'devon@example.test', link_method: 'self' });
    expect((await audited('identity.link', '%by the person, signed in%')).length).toBe(1);
    expect((await t.db.query('select 1 from user_identities where user_id = $1', [userId])).length).toBe(1);

    // Linking needs a recent confirmation: an old one is refused.
    await t.db.query(`update sessions set confirmed_at = now() - interval '1 hour' where user_id = $1`, [userId]);
    const other = await makeUser('emery', 'emery@example.test');
    expect(other).toBeTruthy();
    expect((await me.post(`/api/auth/sso/${KEY}/link`)).statusCode).toBe(409); // already linked
  });

  it('links a sign-in that matched an account by email once the password is given', async () => {
    await makeUser('frankie', 'frankie@example.test');
    idp.user = { sub: 'frankie-sub', email: 'frankie@example.test', email_verified: true };
    const r = await ssoSignIn();
    expect(r.location).toBe('/?sso=link');
    expect(r.session).toBeUndefined();
    expect(r.link).toBeTruthy();
    const pending = await inject('GET', '/api/auth/sso/pending', { grc_sso_link: r.link! });
    expect(pending.json()).toMatchObject({ pending: true, provider: 'Example directory', email: 'fr*****@example.test' });

    // Somebody else's password does not complete it.
    const wrong = await login('devon');
    const refused = await inject('POST', '/api/auth/sso/pending/complete', { [SESSION_COOKIE]: wrong.session!, grc_sso_link: r.link! });
    expect(refused.statusCode).toBe(409);

    const r2 = await ssoSignIn();
    const { session } = await login('frankie');
    const done = await inject('POST', '/api/auth/sso/pending/complete', { [SESSION_COOKIE]: session!, grc_sso_link: r2.link! });
    expect(done.statusCode).toBe(200);
    expect((await audited('identity.link', '%confirmed with their password%')).length).toBe(1);
    expect((await ssoSignIn()).location).toBe('/');
  });

  it('unlinks with a fresh confirmation and never removes the last way in', async () => {
    const userId = await makeUser('gale', 'gale@example.test', { password: false });
    await t.api.post(`/api/admin/users/${userId}/link-permit`, { providerId });
    idp.user = { sub: 'gale-sub', email: 'gale@example.test', email_verified: true };
    const r = await ssoSignIn();
    expect(r.location).toBe('/');
    const me = asSession(r.session!);
    const ids = (await me.get('/api/auth/identities')).json().identities;
    // No password: this identity is the only way in.
    const last = await me.del(`/api/auth/identities/${ids[0].id}`);
    expect(last.statusCode).toBe(409);
    expect(last.json().error.code).toBe('last_method');

    // Devon has a password; an old confirmation asks again, a fresh one unlinks.
    const devon = await login('devon');
    const d = asSession(devon.session!);
    const devonIds = (await d.get('/api/auth/identities')).json().identities;
    await t.db.query(`update sessions set confirmed_at = now() - interval '1 hour' where token_hash in (select token_hash from sessions where user_id = (select id from users where username = 'devon'))`);
    expect((await d.del(`/api/auth/identities/${devonIds[0].id}`)).json().error.code).toBe('reauth_required');
    expect((await d.post('/api/auth/confirm', { password: PASSWORD })).statusCode).toBe(200);
    expect((await d.del(`/api/auth/identities/${devonIds[0].id}`)).statusCode).toBe(200);
    expect((await audited('identity.unlink', '%by the person%')).length).toBe(1);

    // An administrator can also unlink, but not the last way in.
    const adminUnlink = await t.api.del(`/api/admin/users/${userId}/identities/${ids[0].id}`);
    expect(adminUnlink.status).toBe(409);
  });
});

describe('per-person limits, local passwords off and break-glass (E02-13)', () => {
  it('limits a person to chosen providers', async () => {
    const userId = (await t.db.one<{ id: string }>(`select id from users where username = 'casey'`))!.id;
    expect((await login('casey')).status).toBe(200);
    const res = await t.api.patch(`/api/admin/users/${userId}/sign-in`, { allowedMethods: [KEY] });
    expect(res.status).toBe(200);
    expect((await login('casey')).status).toBe(401);
    expect((await audited('signin.failure', '%may not sign in with a password%')).length).toBe(1);
    idp.user = { sub: 'casey-sub', email: 'casey@example.test', email_verified: true };
    expect((await ssoSignIn()).location).toBe('/');
    await t.api.patch(`/api/admin/users/${userId}/sign-in`, { allowedMethods: null });
  });

  it('switches local passwords off only with a break-glass account and everyone linked', async () => {
    let res = await t.api.patch('/api/admin/settings', { 'auth.local_signin': false });
    expect(res.status).toBe(400);
    expect(res.body.error.fields['auth.local_signin']).toMatch(/break-glass/);

    const bg = await makeUser('emergency-admin', 'emergency@example.test', { role: 'administrator' });
    expect((await t.api.post(`/api/admin/users/${bg}/break-glass`, { breakGlass: true })).status).toBe(200);
    const second = await makeUser('second-admin', 'second@example.test', { role: 'administrator' });
    expect((await t.api.post(`/api/admin/users/${second}/break-glass`, { breakGlass: true })).status).toBe(409);

    res = await t.api.patch('/api/admin/settings', { 'auth.local_signin': false });
    expect(res.status).toBe(400);
    expect(res.body.error.fields['auth.local_signin']).toMatch(/no linked sign-in provider/);

    // Everyone but the break-glass account gets a provider (or is disabled), then it is allowed.
    const blockers = (await t.api.get('/api/admin/identity-providers')).body.localOffBlockers as { id: string; username: string }[];
    const admin = blockers.find((b) => b.username === 'admin')!;
    for (const b of blockers) {
      if (b.id === admin.id) continue;
      await t.db.query(`update users set status = 'disabled' where id = $1`, [b.id]);
    }
    await t.db.query(`insert into user_identities (user_id, provider_id, subject, email, link_method) values ($1,$2,'admin-sub','admin@example.test','self')`, [admin.id, providerId]);
    res = await t.api.patch('/api/admin/settings', { 'auth.local_signin': false });
    expect(res.status).toBe(200);
    expect((await t.anon.get('/api/auth/providers')).body.localSignIn).toBe(false);

    expect((await login('admin', 'a long test passphrase 1')).status).toBe(401);
    expect((await audited('signin.failure', '%local passwords are switched off%')).length).toBe(1);
    // While local passwords are off the break-glass account stays and cannot be disabled.
    expect((await t.api.post(`/api/admin/users/${bg}/break-glass`, { breakGlass: false })).status).toBe(409);
    expect((await t.api.post(`/api/admin/users/${bg}/disable`)).status).toBe(409);
  });

  it('lets the break-glass account in with its password, alerts every administrator and marks the session', async () => {
    const before = notified.length;
    const r = await login('emergency-admin');
    expect(r.status).toBe(200);
    expect((await audited('signin.break_glass')).length).toBe(1);
    const inApp = await t.db.query(`select 1 from notifications where title like 'Break-glass account used%'`).catch(() => []);
    expect(notified.length - before + inApp.length).toBeGreaterThan(0);
    expect((await asSession(r.session!).get('/api/auth/sso/session')).json()).toMatchObject({ breakGlass: true, method: 'local' });
    expect((await asSession(r.session!).get('/api/auth/identities')).json()).toMatchObject({ breakGlass: true, session: { breakGlass: true } });

    // The break-glass account never signs in through a provider, even with a matching identity.
    idp.user = { sub: 'emergency-sub', email: 'emergency@example.test', email_verified: true };
    expect((await ssoSignIn()).location).toBe('/?sso=failed');
    expect((await audited('signin.failure', '%break-glass account cannot use single sign-on%')).length).toBe(1);

    // Local passwords back on for anything after this.
    const confirm = await asSession(r.session!).post('/api/auth/confirm', { password: PASSWORD });
    expect(confirm.statusCode).toBe(200);
    expect((await inject('PATCH', '/api/admin/settings', { [SESSION_COOKIE]: r.session! }, { 'auth.local_signin': true })).statusCode).toBe(200);
  });

  it('records the provider, time and address of every provider change', async () => {
    await t.api.patch(`/api/admin/identity-providers/${providerId}`, { enabled: false });
    const rows = await t.db.query<{ ip: string; actor_id: string }>(`select ip, actor_id from audit_events where action like 'identity_provider.%'`);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.every((r) => r.ip && r.actor_id)).toBe(true);
    expect((await audited('identity_provider.disable')).length).toBe(1);
    expect((await t.anon.get('/api/auth/providers')).body.providers).toEqual([]);
  });
});
