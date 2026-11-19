import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE, sha256 } from '../../core/auth.ts';
import { totpCode } from '../../core/totp.ts';
import { DEFAULT_ROLES } from '../../core/services.ts';
import { ADMIN, testApp } from '../../test/helpers.ts';
import { ADMIN_ROUTES } from './shared.ts';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

const PASSWORD = 'quiet river stone lantern';

/** How many audit events exist for an action (optionally about one record). */
async function audited(action: string, recordId?: string): Promise<number> {
  const rows = await t.db.query(
    'select 1 from audit_events where action = $1 and ($2::text is null or record_id = $2)', [action, recordId ?? null],
  );
  return rows.length;
}

/** A request carrying a given session cookie. */
async function call(cookie: string | undefined, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) {
  const res = await t.app.inject({
    method, url,
    headers: { ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}), 'x-grc-csrf': '1' },
    ...(method === 'GET' || method === 'DELETE' ? {} : { payload: payload ?? {} }),
  });
  let parsed: any = null;
  try { parsed = res.json(); } catch { /* not JSON */ }
  return { status: res.statusCode, body: parsed, cookie: res.cookies.find((c) => c.name === SESSION_COOKIE)?.value };
}
const signIn = (username: string, password: string, extra: object = {}) =>
  call(undefined, 'POST', '/api/auth/login', { username, password, ...extra });

/**
 * A current authenticator code for a user. Each code is accepted once only, so tests that need
 * several codes inside one 30-second step first forget the last accepted step.
 */
async function freshCode(userId: string, secret: string): Promise<string> {
  await t.db.query('update users set totp_last_step = null where id = $1', [userId]);
  return totpCode(secret);
}

const tokenOf = (link: string) => new URL(link, 'http://x').searchParams.get('token')!;

/** Creates a user through the API and redeems the setup link. */
async function makeUser(username: string, roles: string[] = ['agent'], password = PASSWORD) {
  const made = await t.api.post('/api/admin/users', { username, email: `${username}@example.test`, displayName: `Person ${username}`, roles });
  expect(made.status).toBe(201);
  const done = await t.anon.post('/api/auth/redeem', { token: tokenOf(made.body.setupLink), password });
  expect(done.status).toBe(200);
  return { id: made.body.user.id as string, link: made.body.setupLink as string };
}

describe('users and one-time links', () => {
  let id: string;
  let link: string;

  it('creates a pending user with a setup link, stores only its hash, and the user can then sign in', async () => {
    const bad = await t.api.post('/api/admin/users', { username: 'x', email: 'nope', displayName: '', roles: ['nonsense'] });
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['displayName', 'email', 'roles', 'username']);

    const made = await t.api.post('/api/admin/users', { username: 'jsmith', email: 'jsmith@example.test', displayName: 'Jo Smith', roles: ['agent'] });
    expect(made.status).toBe(201);
    id = made.body.user.id;
    link = made.body.setupLink;
    expect(link).toMatch(/^\/redeem\?token=[\w-]{40,}$/);
    expect(made.body.user.status).toBe('pending');
    expect(made.body.user.roles.map((r: any) => r.key)).toEqual(['agent']);
    expect(JSON.stringify(made.body)).not.toMatch(/password_hash|totp_secret|recovery_codes/);
    const stored = await t.db.query<{ token_hash: string }>('select token_hash from one_time_tokens where user_id = $1', [id]);
    expect(stored.map((s) => s.token_hash)).toEqual([sha256(tokenOf(link))]);
    expect(await audited('user.create', id)).toBe(1);

    expect((await signIn('jsmith', PASSWORD)).status).toBe(401); // no password yet
    const check = await t.anon.get(`/api/auth/redeem?token=${tokenOf(link)}`);
    expect(check.body).toMatchObject({ valid: true, username: 'jsmith', purpose: 'setup' });

    const weak = await t.anon.post('/api/auth/redeem', { token: tokenOf(link), password: 'too short' });
    expect(weak.body.error.fields.password).toMatch(/at least 14/);
    expect((await t.anon.post('/api/auth/redeem', { token: tokenOf(link), password: PASSWORD })).status).toBe(200);
    expect((await t.api.get(`/api/admin/users/${id}`)).body.status).toBe('active');
    expect(await audited('password.setup', id)).toBe(1);
    expect((await signIn('jsmith', PASSWORD)).status).toBe(200);
  });

  it('gives a new user no role unless the administrator picks one', async () => {
    const made = await t.api.post('/api/admin/users', { username: 'norole', email: 'norole@example.test', displayName: 'No Role' });
    expect(made.body.user.roles).toEqual([]);
  });

  it('rejects used, expired and unknown links with the same generic error', async () => {
    const reused = await t.anon.post('/api/auth/redeem', { token: tokenOf(link), password: 'another long passphrase 9' });
    expect(reused.status).toBe(400);
    expect((await t.anon.get(`/api/auth/redeem?token=${tokenOf(link)}`)).body.valid).toBe(false);

    const issued = await t.api.post(`/api/admin/users/${id}/reset-link`);
    await t.db.query(`update one_time_tokens set expires_at = now() - interval '1 minute' where token_hash = $1`, [sha256(tokenOf(issued.body.link))]);
    const expired = await t.anon.post('/api/auth/redeem', { token: tokenOf(issued.body.link), password: 'another long passphrase 9' });
    const unknown = await t.anon.post('/api/auth/redeem', { token: 'made-up', password: 'another long passphrase 9' });
    expect(expired.status).toBe(400);
    expect(expired.body).toEqual(reused.body);
    expect(unknown.body).toEqual(reused.body);
    expect(await audited('link.redeem_failure')).toBe(3);
    expect((await signIn('jsmith', PASSWORD)).status).toBe(200); // password unchanged
  });

  it('resets a password by link, ending sessions and refusing a reused password', async () => {
    const session = (await signIn('jsmith', PASSWORD)).cookie;
    expect((await call(session, 'GET', '/api/meta')).status).toBe(200);
    const first = await t.api.post(`/api/admin/users/${id}/reset-link`);
    const second = await t.api.post(`/api/admin/users/${id}/reset-link`);
    expect(second.body.purpose).toBe('reset');
    expect(await audited('user.reset_link', id)).toBe(3);
    // Issuing a new link cancels the earlier one.
    expect((await t.anon.post('/api/auth/redeem', { token: tokenOf(first.body.link), password: 'brand new passphrase 77' })).status).toBe(400);
    const same = await t.anon.post('/api/auth/redeem', { token: tokenOf(second.body.link), password: PASSWORD });
    expect(same.body.error.fields.password).toMatch(/reuse/);
    expect((await t.anon.post('/api/auth/redeem', { token: tokenOf(second.body.link), password: 'brand new passphrase 77' })).status).toBe(200);
    expect(await audited('password.reset', id)).toBe(1);
    expect((await call(session, 'GET', '/api/meta')).status).toBe(401);
    expect((await signIn('jsmith', PASSWORD)).status).toBe(401);
    expect((await signIn('jsmith', 'brand new passphrase 77')).status).toBe(200);
  });

  it('lists with search and filters, and updates a profile with an audit entry', async () => {
    expect((await t.api.get('/api/admin/users?q=smith')).body.total).toBe(1);
    expect((await t.api.get('/api/admin/users?status=pending')).body.rows.map((r: any) => r.username)).toEqual(['norole']);
    expect((await t.api.get('/api/admin/users?role=administrator')).body.total).toBe(1);
    const dup = await t.api.patch(`/api/admin/users/${id}`, { username: 'ADMIN' });
    expect(dup.body.error.fields.username).toMatch(/already/);
    const res = await t.api.patch(`/api/admin/users/${id}`, { displayName: 'Jo Smith-Jones', roles: ['agent', 'project_manager'] });
    expect(res.body.display_name).toBe('Jo Smith-Jones');
    expect(res.body.roles.map((r: any) => r.key).sort()).toEqual(['agent', 'project_manager']);
    const ev = await t.db.one<any>(`select before, after, ip from audit_events where action = 'user.update' and record_id = $1`, [id]);
    expect(ev.before).toEqual({ display_name: 'Jo Smith', roles: ['agent'] });
    expect(ev.after.roles).toEqual(['agent', 'project_manager']);
    expect(ev.ip).toBeTruthy();
  });

  it('unlocks a locked account', async () => {
    await makeUser('locky');
    for (let i = 0; i < 5; i++) await signIn('locky', 'wrong wrong wrong wrong');
    expect((await signIn('locky', PASSWORD)).status).toBe(401);
    const row = (await t.api.get('/api/admin/users?status=locked')).body.rows[0];
    expect(row.username).toBe('locky');
    const unlocked = await t.api.post(`/api/admin/users/${row.id}/unlock`);
    expect(unlocked.body.locked).toBe(false);
    expect(await audited('user.unlock', row.id)).toBe(1);
    expect((await signIn('locky', PASSWORD)).status).toBe(200);
  });

  it('disables (ending sessions), enables, and ends sessions on request', async () => {
    const u = await makeUser('dana');
    const session = (await signIn('dana', PASSWORD)).cookie;
    expect((await t.api.post(`/api/admin/users/${u.id}/end-sessions`)).body.ended).toBe(1);
    expect((await call(session, 'GET', '/api/meta')).status).toBe(401);
    expect(await audited('user.end_sessions', u.id)).toBe(1);

    const again = (await signIn('dana', PASSWORD)).cookie;
    expect((await t.api.post(`/api/admin/users/${u.id}/disable`)).body.status).toBe('disabled');
    expect((await call(again, 'GET', '/api/meta')).status).toBe(401);
    expect((await signIn('dana', PASSWORD)).status).toBe(401);
    expect((await t.api.post(`/api/admin/users/${u.id}/reset-link`)).status).toBe(409);
    expect((await t.api.post(`/api/admin/users/${u.id}/enable`)).body.status).toBe('active');
    expect((await signIn('dana', PASSWORD)).status).toBe(200);
    expect(await audited('user.disable', u.id)).toBe(1);
    expect(await audited('user.enable', u.id)).toBe(1);
  });

  it('stops an administrator locking everyone or themself out', async () => {
    const me = (await t.api.get('/api/auth/state')).body.user.id;
    // Only administrator: removing or disabling them would leave none.
    expect((await t.api.patch(`/api/admin/users/${me}`, { roles: [] })).body.error.code).toBe('last_administrator');
    expect((await t.api.post(`/api/admin/users/${me}/disable`)).body.error.code).toBe('last_administrator');

    const other = await t.as('administrator');
    expect((await t.api.patch(`/api/admin/users/${me}`, { roles: ['agent'] })).body.error.code).toBe('self_lockout');
    expect((await t.api.post(`/api/admin/users/${me}/disable`)).body.error.code).toBe('self_lockout');
    expect((await t.api.get(`/api/admin/users/${me}`)).body.roles.map((r: any) => r.key)).toEqual(['administrator']); // rolled back
    // Another administrator may be demoted while one remains.
    expect((await t.api.patch(`/api/admin/users/${other.userId}`, { roles: ['agent'] })).status).toBe(200);
    expect(await audited('user.roles', other.userId)).toBe(1);
    expect((await other.get('/api/admin/users')).status).toBe(403);
  });
});

describe('second factor', () => {
  let id: string;
  let secret: string;
  let codes: string[];

  it('enrolls with an authenticator code and returns recovery codes once, stored as hashes', async () => {
    id = (await makeUser('tess')).id;
    const session = (await signIn('tess', PASSWORD)).cookie;
    const begin = await call(session, 'POST', '/api/auth/totp/begin');
    secret = begin.body.secret;
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(begin.body.uri).toContain(`otpauth://totp/Sandpiper%20GRC:tess?secret=${secret}`);
    expect((await signIn('tess', PASSWORD)).status).toBe(200); // pending secret is not yet enforced

    const wrong = await call(session, 'POST', '/api/auth/totp/confirm', { code: '000000' });
    expect(wrong.status).toBe(400);
    const ok = await call(session, 'POST', '/api/auth/totp/confirm', { code: totpCode(secret) });
    codes = ok.body.recoveryCodes;
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    const row = await t.db.one<{ recovery_codes: string[] }>('select recovery_codes from users where id = $1', [id]);
    expect(row!.recovery_codes).toHaveLength(10);
    expect(JSON.stringify(row!.recovery_codes)).not.toContain(codes[0].replace('-', ''));
    expect(await audited('mfa.enable', id)).toBe(1);

    const security = await call(session, 'GET', '/api/auth/security');
    expect(security.body).toMatchObject({ totpEnabled: true, recoveryCodesLeft: 10 });
    expect(JSON.stringify((await t.api.get(`/api/admin/users/${id}`)).body)).not.toContain(secret);
    expect((await call(session, 'POST', '/api/auth/totp/begin')).status).toBe(409);
  });

  it('then requires a code at sign-in, and accepts each recovery code once', async () => {
    const none = await signIn('tess', PASSWORD);
    expect(none.status).toBe(401);
    expect(none.body.error.code).toBe('mfa_required');
    expect((await signIn('tess', PASSWORD, { totp: await freshCode(id, secret) })).status).toBe(200);

    expect((await signIn('tess', PASSWORD, { totp: codes[0].toLowerCase() })).status).toBe(200);
    expect((await signIn('tess', PASSWORD, { totp: codes[0] })).status).toBe(401);
    expect((await signIn('tess', PASSWORD, { recoveryCode: codes[1] })).status).toBe(200);
    expect(await audited('mfa.recovery_code_used', id)).toBe(2);
    const ev = await t.db.one<any>(`select summary, ip from audit_events where action = 'mfa.recovery_code_used' order by id desc limit 1`);
    expect(ev.summary).toMatch(/8 left/);
    expect(ev.ip).toBeTruthy();
  });

  it('regenerates recovery codes and turns off only with the password and a valid code', async () => {
    const session = (await signIn('tess', PASSWORD, { totp: await freshCode(id, secret) })).cookie;
    expect((await call(session, 'POST', '/api/auth/totp/recovery-codes', { password: 'not my password at all' })).status).toBe(400);
    const fresh = await call(session, 'POST', '/api/auth/totp/recovery-codes', { password: PASSWORD });
    expect(fresh.body.recoveryCodes).toHaveLength(10);
    expect((await signIn('tess', PASSWORD, { totp: codes[2] })).status).toBe(401); // old codes are dead
    expect(await audited('mfa.recovery_codes', id)).toBe(1);

    expect((await call(session, 'POST', '/api/auth/totp/disable', { password: 'not my password at all', code: totpCode(secret) })).status).toBe(400);
    expect((await call(session, 'POST', '/api/auth/totp/disable', { password: PASSWORD, code: '000000' })).status).toBe(400);
    expect(await audited('mfa.change_refused', id)).toBe(3);
    expect((await call(session, 'POST', '/api/auth/totp/disable', { password: PASSWORD, code: fresh.body.recoveryCodes[0] })).status).toBe(200);
    expect(await audited('mfa.disable', id)).toBe(1);
    expect((await signIn('tess', PASSWORD)).status).toBe(200);
  });

  it('lets an administrator reset a second factor', async () => {
    const session = (await signIn('tess', PASSWORD)).cookie;
    const begin = await call(session, 'POST', '/api/auth/totp/begin');
    await call(session, 'POST', '/api/auth/totp/confirm', { code: totpCode(begin.body.secret) });
    expect((await signIn('tess', PASSWORD)).body.error.code).toBe('mfa_required');
    expect((await t.api.post(`/api/admin/users/${id}/reset-mfa`)).body.totp_enabled).toBe(false);
    expect(await audited('mfa.reset', id)).toBe(1);
    expect((await signIn('tess', PASSWORD)).status).toBe(200);
  });

  it('reports when a second factor is expected but not set up', async () => {
    expect((await t.api.get('/api/auth/state')).body.mfaEnrollmentRequired).toBe(true); // administrator role
    expect((await t.anon.get('/api/auth/state')).body.mfaEnrollmentRequired).toBe(false);
    const agent = await t.as('agent');
    expect((await agent.get('/api/auth/state')).body.mfaEnrollmentRequired).toBe(false);
    expect((await (await t.as('security_lead')).get('/api/auth/state')).body.mfaEnrollmentRequired).toBe(true);
    await t.api.patch('/api/admin/settings', { 'auth.mfa_required_for_all': true });
    expect((await agent.get('/api/auth/state')).body.mfaEnrollmentRequired).toBe(true);
    await t.api.patch('/api/admin/settings', { 'auth.mfa_required_for_all': false });

    const session = (await signIn('tess', PASSWORD)).cookie; // agent with the setting off
    await t.api.patch(`/api/admin/users/${id}`, { roles: ['security_lead'] });
    expect((await call(session, 'GET', '/api/auth/state')).body.mfaEnrollmentRequired).toBe(true);
    const begin = await call(session, 'POST', '/api/auth/totp/begin');
    await call(session, 'POST', '/api/auth/totp/confirm', { code: totpCode(begin.body.secret) });
    expect((await call(session, 'GET', '/api/auth/state')).body.mfaEnrollmentRequired).toBe(false);
  });
});

describe('sessions', () => {
  it('lists and ends your own sessions without exposing token hashes', async () => {
    await makeUser('sess');
    const a = (await signIn('sess', PASSWORD)).cookie!;
    const b = (await signIn('sess', PASSWORD)).cookie!;
    const list = await call(a, 'GET', '/api/auth/sessions');
    expect(list.body).toHaveLength(2);
    expect(list.body.filter((s: any) => s.current)).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(sha256(a));
    const other = list.body.find((s: any) => !s.current);
    expect((await call(a, 'DELETE', `/api/auth/sessions/${other.id}`)).status).toBe(200);
    expect((await call(b, 'GET', '/api/meta')).status).toBe(401);
    await signIn('sess', PASSWORD);
    expect((await call(a, 'POST', '/api/auth/sessions/end-others')).body.ended).toBe(1);
    expect((await call(a, 'GET', '/api/auth/sessions')).body).toHaveLength(1);
    expect(await audited('session.end')).toBe(2);
  });
});

describe('roles', () => {
  it('lists roles with grants and member counts', async () => {
    const res = await t.api.get('/api/admin/roles');
    const admin = res.body.roles.find((r: any) => r.key === 'administrator');
    expect(admin.grants).toEqual(['*']);
    expect(admin.members).toBe(1);
    expect(res.body.actions).toContain('administer');
  });

  it('switching a role off removes its permissions at once, and on restores them', async () => {
    const auditor = await t.as('auditor');
    const role = (await t.api.get('/api/admin/roles')).body.roles.find((r: any) => r.key === 'auditor');
    expect((await auditor.get('/api/audit')).status).toBe(200);
    expect((await t.api.post(`/api/admin/roles/${role.id}/disable`)).body.enabled).toBe(false);
    expect((await auditor.get('/api/audit')).status).toBe(403);
    expect((await auditor.get('/api/auth/state')).body.permissions).toEqual([]);
    expect((await t.api.patch(`/api/admin/roles/${role.id}`, { enabled: true })).body.enabled).toBe(true);
    expect((await auditor.get('/api/audit')).status).toBe(200);
    expect(await audited('role.disable', role.id)).toBe(1);
    expect(await audited('role.enable', role.id)).toBe(1);
  });

  it('creates a custom role and edits its grants, with validation and audit', async () => {
    expect((await t.api.post('/api/admin/roles', { name: 'Records clerk', grants: ['nonsense.fly'] })).body.error.fields.grants).toMatch(/Unknown/);
    expect((await t.api.post('/api/admin/roles', { name: 'Super', grants: ['*'] })).status).toBe(400);
    const made = await t.api.post('/api/admin/roles', { name: 'Records clerk', description: 'Reads the audit log', grants: ['audit.view'] });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ key: 'records_clerk', enabled: true, grants: ['audit.view'] });
    expect((await t.api.post('/api/admin/roles', { name: 'records clerk' })).status).toBe(400);

    const clerk = await t.as('records_clerk');
    expect((await clerk.get('/api/audit')).status).toBe(200);
    const upd = await t.api.patch(`/api/admin/roles/${made.body.id}`, { grants: ['tickets.*', 'reports.view'], requiresMfa: true });
    expect(upd.body.grants).toEqual(['reports.view', 'tickets.*']);
    expect(upd.body.requires_mfa).toBe(true);
    expect((await clerk.get('/api/audit')).status).toBe(403);
    const ev = await t.db.one<any>(`select before, after from audit_events where action = 'role.update' and record_id = $1`, [made.body.id]);
    expect(ev.before.grants).toEqual(['audit.view']);
    expect(ev.after.grants).toEqual(['reports.view', 'tickets.*']);
    expect(await audited('role.create', made.body.id)).toBe(1);
    expect((await t.api.get(`/api/admin/roles/${made.body.id}`)).body.users).toHaveLength(1);
  });

  it('protects the administrator role', async () => {
    const role = (await t.api.get('/api/admin/roles')).body.roles.find((r: any) => r.key === 'administrator');
    expect((await t.api.patch(`/api/admin/roles/${role.id}`, { grants: ['tickets.view'] })).body.error.fields.grants).toBeTruthy();
    expect((await t.api.post(`/api/admin/roles/${role.id}/disable`)).body.error.fields.enabled).toBeTruthy();
    expect((await t.api.get('/api/admin/users')).status).toBe(200);
  });
});

describe('settings and departments', () => {
  it('validates settings and audits each change', async () => {
    const before = await t.api.get('/api/admin/settings');
    expect(before.body.values).toMatchObject({ 'app.name': 'Sandpiper GRC', pilot_mode: true, 'auth.password_min_length': 14, features: { portal: false } });
    const bad = await t.api.patch('/api/admin/settings', {
      'auth.password_min_length': 8, 'auth.idle_minutes': 'soon', pilot_mode: 'yes', 'app.name': ' ', features: { rockets: true }, 'made.up': 1,
    });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['app.name', 'auth.idle_minutes', 'auth.password_min_length', 'features', 'made.up', 'pilot_mode']);
    expect((await t.api.get('/api/admin/settings')).body).toEqual(before.body); // nothing applied

    const ok = await t.api.patch('/api/admin/settings', { 'auth.password_min_length': 16, features: { portal: true }, 'app.name': 'Test GRC', pilot_mode: true });
    expect(ok.body.values['auth.password_min_length']).toBe(16);
    const state = await t.anon.get('/api/auth/state');
    expect(state.body).toMatchObject({ appName: 'Test GRC', features: { portal: true } });
    expect(await audited('setting.change', 'auth.password_min_length')).toBe(1);
    expect(await audited('setting.change', 'pilot_mode')).toBe(0); // unchanged values are not rewritten
    const short = await t.api.post('/api/auth/change-password', { currentPassword: ADMIN.password, newPassword: 'fifteen chars..' });
    expect(short.body.error.fields.newPassword).toMatch(/at least 16/);
    await t.api.patch('/api/admin/settings', { 'auth.password_min_length': 14, 'app.name': 'Sandpiper GRC' });
  });

  it('manages departments', async () => {
    const made = await t.api.post('/api/admin/departments', { name: 'Maintenance' });
    expect(made.status).toBe(201);
    expect((await t.api.post('/api/admin/departments', { name: 'maintenance' })).status).toBe(400);
    const user = (await t.api.get('/api/admin/users?q=norole')).body.rows[0];
    expect((await t.api.patch(`/api/admin/users/${user.id}`, { departmentId: made.body.id })).body.department).toBe('Maintenance');
    expect((await t.api.patch(`/api/admin/departments/${made.body.id}`, { name: 'Fleet maintenance' })).body).toMatchObject({ name: 'Fleet maintenance', members: 1 });
    expect((await t.api.del(`/api/admin/departments/${made.body.id}`)).status).toBe(200);
    expect((await t.api.get('/api/admin/departments')).body).toEqual([]);
    expect((await t.api.get(`/api/admin/users/${user.id}`)).body.department_id).toBeNull();
    for (const action of ['department.create', 'department.update', 'department.delete']) expect(await audited(action, made.body.id)).toBe(1);
  });
});

describe('access', () => {
  it('refuses every administration route to a non-administrator and to anonymous callers', async () => {
    expect(ADMIN_ROUTES.length).toBeGreaterThan(20);
    const lead = await t.as('security_lead'); // the widest non-administrator role
    for (const r of ADMIN_ROUTES) {
      const url = r.url.replace(':id', randomUUID());
      const method = ({ GET: 'get', POST: 'post', PATCH: 'patch', DELETE: 'del' } as const)[r.method as 'GET'];
      expect([r.method, r.url, (await lead[method](url)).status]).toEqual([r.method, r.url, 403]);
      expect([r.method, r.url, (await t.anon[method](url)).status]).toEqual([r.method, r.url, 401]);
    }
    for (const url of ['/api/auth/security', '/api/auth/sessions']) expect((await t.anon.get(url)).status).toBe(401);
    expect((await t.anon.post('/api/auth/totp/begin')).status).toBe(401);
  });
});

describe('replay protection (E02-06)', () => {
  it('refuses an authenticator code that has already been used to sign in', async () => {
    const id = (await makeUser('replay')).id;
    const session = (await signIn('replay', PASSWORD)).cookie;
    const secret = (await call(session, 'POST', '/api/auth/totp/begin')).body.secret;
    // The key is not kept in the clear.
    const stored = (await t.db.one<{ totp_secret: string }>('select totp_secret from users where id = $1', [id]))!.totp_secret;
    expect(stored).toMatch(/^enc:v1:/);
    expect(stored).not.toContain(secret);

    const code = totpCode(secret);
    expect((await call(session, 'POST', '/api/auth/totp/confirm', { code })).status).toBe(200);
    // The code that confirmed enrollment cannot also sign in...
    expect((await signIn('replay', PASSWORD, { totp: code })).status).toBe(401);
    // ...and a code accepted at sign-in is refused the second time.
    const next = await freshCode(id, secret);
    expect((await signIn('replay', PASSWORD, { totp: next })).status).toBe(200);
    const again = await signIn('replay', PASSWORD, { totp: next });
    expect(again.status).toBe(401);
    expect(again.body.error.code).toBe('invalid_credentials');
    expect((await t.db.one<{ s: number }>('select totp_last_step as s from users where id = $1', [id]))!.s).toBeGreaterThan(0);
  });
});

describe('re-authentication (E01-21)', () => {
  const stale = () => t.db.query(`update sessions set confirmed_at = now() - interval '11 minutes' where user_id = (select id from users where username = 'admin')`);

  it('refuses sensitive administrative actions until the password is confirmed again, and audits the refusal', async () => {
    const target = (await makeUser('reauth')).id;
    const role = (await t.api.post('/api/admin/roles', { name: 'Reauth probe', grants: ['tickets.view'] })).body;
    await stale();
    const before = await audited('reauth.required');

    const sensitive: [string, () => Promise<{ status: number; body: any }>][] = [
      ['role grants', () => t.api.patch(`/api/admin/roles/${role.id}`, { grants: ['tickets.*'] })],
      ['role switch', () => t.api.post(`/api/admin/roles/${role.id}/disable`)],
      ['role second-factor flag', () => t.api.patch(`/api/admin/roles/${role.id}`, { requiresMfa: true })],
      ['new role', () => t.api.post('/api/admin/roles', { name: 'Another probe', grants: ['tickets.view'] })],
      ['default grants', () => t.api.post('/api/admin/roles/sync-default-grants')],
      ['user roles', () => t.api.patch(`/api/admin/users/${target}`, { roles: ['agent', 'project_manager'] })],
      ['new user', () => t.api.post('/api/admin/users', { username: 'reauth2', email: 'reauth2@example.test', displayName: 'Reauth Two', roles: [] })],
      ['second-factor reset', () => t.api.post(`/api/admin/users/${target}/reset-mfa`)],
      ['reset link', () => t.api.post(`/api/admin/users/${target}/reset-link`)],
      ['security setting', () => t.api.patch('/api/admin/settings', { 'auth.idle_minutes': 45 })],
    ];
    for (const [name, attempt] of sensitive) {
      const res = await attempt();
      expect([name, res.status, res.body?.error?.code]).toEqual([name, 403, 'reauth_required']);
    }
    expect(await audited('reauth.required')).toBe(before + sensitive.length);
    // Nothing was changed.
    expect((await t.api.get(`/api/admin/roles/${role.id}`)).body).toMatchObject({ grants: ['tickets.view'], enabled: true, requires_mfa: false });
    expect((await t.api.get(`/api/admin/users/${target}`)).body.roles.map((r: any) => r.key)).toEqual(['agent']);
    expect((await t.api.get('/api/admin/settings')).body.values['auth.idle_minutes']).toBe(30);

    // Ordinary administration is not interrupted: reading, profile edits, non-security settings, renaming a role.
    expect((await t.api.get('/api/admin/users')).status).toBe(200);
    expect((await t.api.patch(`/api/admin/users/${target}`, { displayName: 'Renamed Person', roles: ['agent'] })).status).toBe(200);
    expect((await t.api.patch('/api/admin/settings', { pilot_mode: true, 'auth.idle_minutes': 30 })).status).toBe(200);
    expect((await t.api.patch(`/api/admin/roles/${role.id}`, { description: 'Only a description' })).status).toBe(200);

    // Confirming: a wrong password is refused and audited; the right one opens the window.
    const wrong = await t.api.post('/api/auth/confirm', { password: 'not the password at all' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.fields.password).toBeTruthy();
    expect(await audited('reauth.failure')).toBe(1);
    expect((await t.api.patch(`/api/admin/roles/${role.id}`, { grants: ['tickets.*'] })).status).toBe(403);
    const ok = await t.api.post('/api/auth/confirm', { password: ADMIN.password });
    expect(ok.body).toEqual({ ok: true, minutes: 10 });
    expect(await audited('reauth.success')).toBe(1);
    for (const [name, attempt] of sensitive) {
      const res = await attempt();
      expect([name, res.status < 300]).toEqual([name, true]);
    }
    await t.api.patch('/api/admin/settings', { 'auth.idle_minutes': 30 });
    expect((await t.anon.post('/api/auth/confirm', { password: ADMIN.password })).status).toBe(401);
  });

  it('limits password confirmation attempts, and the window length is a setting', async () => {
    const lead = await t.as('security_lead');
    for (let i = 0; i < 8; i++) expect((await lead.post('/api/auth/confirm', { password: 'wrong wrong wrong' })).status).toBe(400);
    expect((await lead.post('/api/auth/confirm', { password: 'wrong wrong wrong' })).status).toBe(429);

    expect((await t.api.patch('/api/admin/settings', { 'auth.reauth_minutes': 0 })).status).toBe(400);
    await t.api.patch('/api/admin/settings', { 'auth.reauth_minutes': 30 });
    await stale(); // 11 minutes old: inside a 30-minute window
    expect((await t.api.patch('/api/admin/settings', { 'auth.reauth_minutes': 10 })).status).toBe(200);
    await t.api.post('/api/auth/confirm', { password: ADMIN.password });
  });
});

describe('default role grants (E18-21)', () => {
  it('gives the Approver exactly what its description promises', () => {
    const approver = DEFAULT_ROLES.find((r) => r.key === 'approver')!;
    // Each kind of approval named in the description is granted, and nothing is promised that is not.
    for (const [word, grant] of [['changes', 'changes.approve'], ['requests', 'tickets.approve'], ['asset', 'assets.approve'], ['project gates', 'projects.approve']]) {
      expect(approver.description).toContain(word);
      expect(approver.grants).toContain(grant);
      expect(approver.grants).toContain(`${grant.split('.')[0]}.view`);
    }
    expect(approver.description).not.toMatch(/risk/i);
    expect(approver.grants.some((g) => g.startsWith('risks.') || g.startsWith('security.'))).toBe(false);
    // No default description names a job title or a kind of employer.
    for (const r of DEFAULT_ROLES) expect(r.description).not.toMatch(/\b(staff|managers?|executives?|employees?)\b/i);
  });

  it('adds new default grants to an existing database only through an explicit, audited sync that removes nothing', async () => {
    const roles = async () => (await t.api.get('/api/admin/roles')).body.roles as any[];
    const agent = (await roles()).find((r) => r.key === 'agent');
    // A fresh database is already in step.
    expect((await t.api.get('/api/admin/roles/default-grants')).body).toEqual({ roles: [], pending: 0 });

    // An older database: the agent role predates two default grants and still has an earlier description;
    // the administrator has also added a grant of their own.
    await t.db.query(`delete from role_permissions where role_id = $1 and permission in ('frameworks.view', 'policies.view')`, [agent.id]);
    await t.db.query(`delete from role_default_grants where role_key = 'agent' and permission in ('frameworks.view', 'policies.view')`);
    await t.db.query(`update roles set description = 'IT staff: tickets, assets and changes.' where id = $1`, [agent.id]);
    await t.db.query(`insert into role_permissions (role_id, permission) values ($1, 'audit.view')`, [agent.id]);
    const user = await t.as('agent');
    expect((await user.get('/api/audit')).status).toBe(200);

    const preview = (await t.api.get('/api/admin/roles/default-grants')).body;
    expect(preview.pending).toBe(2);
    expect(preview.roles).toEqual([expect.objectContaining({ key: 'agent', missing: ['frameworks.view', 'policies.view'] })]);
    expect(preview.roles[0].description).toMatch(/^Service desk/);
    // Looking changes nothing.
    expect((await roles()).find((r) => r.key === 'agent').grants).not.toContain('frameworks.view');

    const done = await t.api.post('/api/admin/roles/sync-default-grants');
    expect(done.body).toMatchObject({ ok: true, added: 2 });
    const after = (await roles()).find((r) => r.key === 'agent');
    expect(after.grants).toEqual(expect.arrayContaining(['frameworks.view', 'policies.view', 'audit.view', 'tickets.*']));
    expect(after.description).toMatch(/^Service desk/);
    const ev = await t.db.one<any>(`select actor_name, after from audit_events where action = 'role.sync_defaults' and record_id = $1`, [agent.id]);
    expect(ev.actor_name).toBe('Test Admin');
    expect(ev.after.added).toEqual(['frameworks.view', 'policies.view']);

    // A default grant the administrator removes afterwards is not put back, and their wording is kept.
    await t.api.patch(`/api/admin/roles/${agent.id}`, { grants: after.grants.filter((g: string) => g !== 'policies.view'), description: 'Our own words' });
    expect((await t.api.get('/api/admin/roles/default-grants')).body.pending).toBe(0);
    expect((await t.api.post('/api/admin/roles/sync-default-grants')).body.added).toBe(0);
    const kept = (await roles()).find((r) => r.key === 'agent');
    expect(kept.grants).not.toContain('policies.view');
    expect(kept.grants).toContain('audit.view');
    expect(kept.description).toBe('Our own words');
    expect(await audited('role.sync_defaults', agent.id)).toBe(1);
    await t.api.patch(`/api/admin/roles/${agent.id}`, { grants: DEFAULT_ROLES.find((r) => r.key === 'agent')!.grants });
  });
});

describe('enforced second factor (E02-05)', () => {
  it('is a notice by default, and can be switched off', async () => {
    const lead = await t.as('security_lead'); // the role expects a second factor; this user has none
    expect((await t.api.get('/api/admin/settings')).body.values['auth.mfa_enforcement']).toBe('notice');
    expect((await lead.get('/api/auth/state')).body).toMatchObject({ mfaEnrollmentRequired: true, mfaEnrollmentBlocked: false, mfaEnforcement: 'notice' });
    expect((await lead.get('/api/meta')).status).toBe(200);
    expect((await t.api.patch('/api/admin/settings', { 'auth.mfa_enforcement': 'sometimes' })).status).toBe(400);
    await t.api.patch('/api/admin/settings', { 'auth.mfa_enforcement': 'off' });
    expect((await lead.get('/api/auth/state')).body).toMatchObject({ mfaEnrollmentRequired: false, mfaEnrollmentBlocked: false, mfaEnforcement: 'off' });
    await t.api.patch('/api/admin/settings', { 'auth.mfa_enforcement': 'notice' });
  });

  it('when required, limits a person who has not enrolled to enrollment and signing out', async () => {
    // The administrator must enroll first, so that switching it on cannot lock them out.
    const refused = await t.api.patch('/api/admin/settings', { 'auth.mfa_enforcement': 'required' });
    expect(refused.body.error.fields['auth.mfa_enforcement']).toMatch(/your own second factor/);
    const adminSecret = (await t.api.post('/api/auth/totp/begin')).body.secret;
    expect((await t.api.post('/api/auth/totp/confirm', { code: totpCode(adminSecret) })).status).toBe(200);
    expect((await t.api.patch('/api/admin/settings', { 'auth.mfa_enforcement': 'required' })).status).toBe(200);
    try {
      const lead = await t.as('security_lead');
      const agent = await t.as('agent'); // the Agent role does not require a second factor
      expect((await agent.get('/api/meta')).status).toBe(200);
      expect((await t.api.get('/api/meta')).status).toBe(200); // enrolled

      // Blocked: everything that is not enrollment.
      for (const [method, url] of [['get', '/api/meta'], ['get', '/api/tickets'], ['get', '/api/risks'], ['get', '/api/audit'], ['get', '/api/search?q=ab'],
        ['get', '/api/users/options'], ['post', '/api/auth/sessions/end-others'], ['post', '/api/comments'], ['post', '/api/auth/totp/recovery-codes']] as const) {
        const res = await lead[method](url);
        expect([url, res.status, res.body?.error?.code]).toEqual([url, 403, 'mfa_enrolment_required']);
      }
      // Allowed: own state and security page, password change, and enrollment itself.
      const state = (await lead.get('/api/auth/state')).body;
      expect(state).toMatchObject({ mfaEnrollmentRequired: true, mfaEnrollmentBlocked: true, mfaEnforcement: 'required' });
      expect(state.user.id).toBe(lead.userId);
      expect((await lead.get('/api/auth/security')).body).toMatchObject({ totpEnabled: false, mfaEnrollmentRequired: true, mfaEnrollmentBlocked: true });
      expect((await lead.post('/api/auth/change-password', { currentPassword: 'x', newPassword: 'y' })).status).toBe(400); // reached, and refused on its merits
      const secret = (await lead.post('/api/auth/totp/begin')).body.secret;
      expect(secret).toMatch(/^[A-Z2-7]{32}$/);
      expect((await lead.get('/api/meta')).status).toBe(403); // a pending key is not enrollment
      expect((await lead.post('/api/auth/totp/confirm', { code: totpCode(secret) })).status).toBe(200);
      // Enrolled: everything works again.
      expect((await lead.get('/api/meta')).status).toBe(200);
      expect((await lead.get('/api/auth/state')).body).toMatchObject({ mfaEnrollmentRequired: false, mfaEnrollmentBlocked: false });

      // "Everyone" extends the requirement to roles that do not ask for it.
      await t.api.patch('/api/admin/settings', { 'auth.mfa_required_for_all': true });
      expect((await agent.get('/api/meta')).body.error.code).toBe('mfa_enrolment_required');
      // Signing out is always possible.
      expect((await agent.post('/api/auth/logout')).status).toBe(200);
      expect((await agent.get('/api/auth/state')).body.user).toBeNull();
      await t.api.patch('/api/admin/settings', { 'auth.mfa_required_for_all': false });

      // An administrator reset puts the person back to enrollment.
      await t.api.post(`/api/admin/users/${lead.userId}/reset-mfa`);
      expect((await lead.get('/api/meta')).body.error.code).toBe('mfa_enrolment_required');
    } finally {
      await t.api.patch('/api/admin/settings', { 'auth.mfa_enforcement': 'notice', 'auth.mfa_required_for_all': false });
    }
  });

  it('allows a configurable grace period, counted from the first request made while required', async () => {
    expect((await t.api.patch('/api/admin/settings', { 'auth.mfa_grace_days': 31 })).status).toBe(400);
    await t.api.patch('/api/admin/settings', { 'auth.mfa_enforcement': 'required', 'auth.mfa_grace_days': 7 });
    try {
      const lead = await t.as('security_lead');
      expect((await lead.get('/api/meta')).status).toBe(200); // inside the grace period
      const state = (await lead.get('/api/auth/state')).body;
      expect(state).toMatchObject({ mfaEnrollmentRequired: true, mfaEnrollmentBlocked: false });
      expect(new Date(state.mfaGraceEndsAt).getTime()).toBeGreaterThan(Date.now() + 6 * 86400_000);
      await t.db.query(`update users set mfa_required_since = now() - interval '8 days' where id = $1`, [lead.userId]);
      expect((await lead.get('/api/meta')).body.error.code).toBe('mfa_enrolment_required');
      expect((await lead.get('/api/auth/state')).body.mfaEnrollmentBlocked).toBe(true);
    } finally {
      await t.api.patch('/api/admin/settings', { 'auth.mfa_enforcement': 'notice', 'auth.mfa_grace_days': 0 });
    }
  });
});