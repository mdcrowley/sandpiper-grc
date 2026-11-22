import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { issueToken, tokenHash } from '../../core/tokens.ts';
import { testApp } from '../../test/helpers.ts';

// E36-01: user provisioning over SCIM 2.0. Its own scoped token (hashed, revocable, audited), off by
// default, never an administrator role, deprovisioning ends every way in, never a hard delete.

let t: Awaited<ReturnType<typeof testApp>>;
let token = '';
let tokenId = '';
const B = '/api/scim/v2';

type Res = { status: number; body: any; headers: Record<string, unknown> };
async function scim(method: string, url: string, body?: unknown, bearer: string | null = token, extra: Record<string, string> = {}): Promise<Res> {
  const res = await t.app.inject({
    method: method as 'GET', url,
    headers: { ...(bearer !== null ? { authorization: `Bearer ${bearer}` } : {}), ...(body !== undefined ? { 'content-type': 'application/scim+json' } : {}), ...extra },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
  let parsed: any = null;
  try { parsed = res.json(); } catch { /* 204 */ }
  return { status: res.statusCode, body: parsed, headers: res.headers };
}
const user = (userName: string, extra: Row = {}) => ({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName, name: { givenName: 'Sam', familyName: 'Sample' }, emails: [{ value: userName.includes('@') ? userName : `${userName}@example.test`, primary: true }], active: true, ...extra });
const clearLimits = () => t.db.query(`delete from rate_limit_hits where bucket in ('scim_auth', 'scim_calls')`);

beforeAll(async () => {
  t = await testApp();
  const made = await t.api.post('/api/admin/scim/tokens', { name: 'Directory (sample)' });
  expect(made.status).toBe(201);
  token = made.body.token;
  tokenId = made.body.id;
});
afterAll(async () => { await t.close(); });

describe('provisioning tokens and the switch', () => {
  it('shows a token once, keeps only its hash, and is off by default', async () => {
    expect(token).toMatch(/^grc_scim_[A-Za-z0-9_-]{40,}$/);
    const stored = (await t.db.one<Row>('select token_hash, prefix from scim_tokens where id = $1', [tokenId]))!;
    expect(stored.token_hash).toBe(tokenHash(token));
    const list = (await t.api.get('/api/admin/scim/tokens')).body.tokens;
    expect(JSON.stringify(list)).not.toContain(token);
    expect(list[0]).not.toHaveProperty('token_hash');
    expect((await t.api.get('/api/admin/scim/settings')).body.enabled).toBe(false);
    // Off: a good token gets the same answer as a wrong one.
    const off = await scim('GET', `${B}/Users`);
    const wrong = await scim('GET', `${B}/Users`, undefined, 'grc_scim_wrong');
    expect(off.status).toBe(401);
    expect(off.body).toEqual(wrong.body);
    expect(off.body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error']);
    expect(String(off.headers['content-type'])).toContain('application/scim+json');
    await clearLimits();
  });

  it('is managed by administrators only', async () => {
    const agent = await t.as('agent');
    expect((await agent.get('/api/admin/scim/tokens')).status).toBe(403);
    expect((await agent.post('/api/admin/scim/tokens', { name: 'Sneaky' })).status).toBe(403);
    expect((await agent.put('/api/admin/scim/settings', { enabled: true })).status).toBe(403);
    expect((await t.api.post('/api/admin/scim/tokens', { name: '' })).body.error.fields.name).toBeTruthy();
    const on = await t.api.put('/api/admin/scim/settings', { enabled: true });
    expect(on.status).toBe(200);
    expect(on.body.enabled).toBe(true);
  });

  it('refuses a session, a personal access token, a revoked token and a disallowed address alike, and audits it', async () => {
    const admin = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!;
    const pat = await issueToken(t.db, { userId: admin.id, name: 'Not for provisioning', scopes: ['*'], expires: new Date(Date.now() + 86_400_000) });
    const bySession = await t.api.get(`${B}/Users`); // the admin's cookie, no bearer
    const byPat = await scim('GET', `${B}/Users`, undefined, pat.token);
    const second = await t.api.post('/api/admin/scim/tokens', { name: 'Second', allowedAddresses: ['203.0.113.7'] });
    const fromElsewhere = await scim('GET', `${B}/Users`, undefined, second.body.token);
    const third = await t.api.post('/api/admin/scim/tokens', { name: 'Third' });
    expect((await t.api.del(`/api/admin/scim/tokens/${third.body.id}`)).status).toBe(200);
    const revoked = await scim('GET', `${B}/Users`, undefined, third.body.token);
    for (const r of [bySession, byPat, fromElsewhere, revoked]) {
      expect(r.status).toBe(401);
      expect(r.body.detail).toBe(revoked.body.detail);
    }
    const refused = await t.db.query<Row>(`select summary from audit_events where action = 'scim.refused'`);
    expect(refused.length).toBeGreaterThanOrEqual(4);
    expect(refused.map((r) => r.summary).join(' ')).not.toContain(third.body.token);
    await clearLimits();
  });

  it('limits refused calls by address, claimed before the check (take)', async () => {
    await clearLimits();
    const answers = await Promise.all(Array.from({ length: 25 }, () => scim('GET', `${B}/Users`, undefined, 'grc_scim_guess')));
    expect(answers.filter((a) => a.status === 401).length).toBeLessThanOrEqual(20);
    // (A burst may be refused whole: claimed first, counted after.) Then one at a time up to the limit.
    for (let i = 0; i < 20; i++) await scim("GET", `${B}/Users`, undefined, "grc_scim_guess");
    expect((await scim('GET', `${B}/Users`)).status).toBe(429); // even the right token, from this address, for a while
    await clearLimits();
    expect((await scim('GET', `${B}/Users`)).status).toBe(200);
  });
});

describe('accounts', () => {
  let samId = '';

  it('creates an account with no password and no roles, audited as provisioning', async () => {
    const res = await scim('POST', `${B}/Users`, user('sam.sample@example.test', { externalId: 'ext-1' }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ userName: 'sam.sample@example.test', externalId: 'ext-1', active: true, displayName: 'Sam Sample' });
    expect(String(res.headers.location)).toBe(`${B}/Users/${res.body.id}`);
    samId = res.body.id;
    const row = (await t.db.one<Row>('select username, password_hash, status from users where id = $1', [samId]))!;
    expect(row).toMatchObject({ username: 'sam.sample', password_hash: null, status: 'active' });
    expect((await t.db.query('select 1 from user_roles where user_id = $1', [samId])).length).toBe(0);
    const ev = (await t.db.one<Row>(`select actor_id, actor_name from audit_events where action = 'user.create' and record_id = $1`, [samId]))!;
    expect(ev).toEqual({ actor_id: null, actor_name: 'Provisioning (Directory (sample))' });
    // The same userName, email or externalId again: 409 uniqueness.
    const again = await scim('POST', `${B}/Users`, user('SAM.SAMPLE@example.test'));
    expect(again.status).toBe(409);
    expect(again.body.scimType).toBe('uniqueness');
  });

  it('finds accounts by filter, pages, and answers on the versioned path too', async () => {
    const found = await scim('GET', `${B}/Users?filter=${encodeURIComponent('userName eq "sam.sample@example.test"')}`);
    expect(found.body).toMatchObject({ totalResults: 1, startIndex: 1, itemsPerPage: 1 });
    expect(found.body.Resources[0].id).toBe(samId);
    expect((await scim('GET', `${B}/Users?filter=${encodeURIComponent('externalId eq "ext-1"')}`)).body.totalResults).toBe(1);
    expect((await scim('GET', `${B}/Users?filter=${encodeURIComponent('title co "x"')}`)).body.scimType).toBe('invalidFilter');
    const page = await scim('GET', `${B}/Users?startIndex=1&count=1`);
    expect(page.body.itemsPerPage).toBe(1);
    expect(page.body.totalResults).toBeGreaterThanOrEqual(2);
    expect((await scim('GET', `/api/v1/scim/v2/Users/${samId}`)).body.meta.location).toBe(`/api/v1/scim/v2/Users/${samId}`);
    expect((await scim('GET', `${B}/Users/00000000-0000-0000-0000-000000000000`)).status).toBe(404);
    expect((await scim('GET', `${B}/ServiceProviderConfig`)).body.patch.supported).toBe(true);
    expect((await scim('GET', `${B}/ResourceTypes`)).body.totalResults).toBe(2);
    expect((await scim('GET', `${B}/Schemas`)).body.Resources.map((s: Row) => s.name)).toEqual(['User', 'Group']);
  });

  it('changes an account with PATCH and PUT', async () => {
    const patched = await scim('PATCH', `${B}/Users/${samId}`, { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'replace', path: 'displayName', value: 'Samantha Sample' }] });
    expect(patched.status).toBe(200);
    expect(patched.body.displayName).toBe('Samantha Sample');
    const put = await scim('PUT', `${B}/Users/${samId}`, user('sam.sample@example.test', { displayName: 'Sam Sample', externalId: 'ext-1' }));
    expect(put.body.displayName).toBe('Sam Sample');
  });

  it('deactivates without deleting: sessions, tokens and assistant connections end; enabling again restores the account only', async () => {
    const { createSession } = await import('../../core/auth.ts');
    await createSession(t.db, samId);
    const pat = await issueToken(t.db, { userId: samId, name: 'Sam token', scopes: ['tickets.view'], expires: new Date(Date.now() + 86_400_000) });
    const off = await scim('PATCH', `${B}/Users/${samId}`, { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'replace', value: { active: false } }] });
    expect(off.body.active).toBe(false);
    expect((await t.db.one<Row>('select status, deleted_at from users where id = $1', [samId]))).toEqual({ status: 'disabled', deleted_at: null });
    expect((await t.db.query('select 1 from sessions where user_id = $1', [samId])).length).toBe(0);
    expect((await t.db.one<Row>('select revoked_at from api_tokens where id = $1', [pat.row.id]))!.revoked_at).not.toBeNull();
    expect((await t.db.one<Row>(`select summary from audit_events where action = 'user.deactivate' and record_id = $1`, [samId]))!.summary).toMatch(/1 session\(s\) ended; 1 API token/);

    const on = await scim('PATCH', `${B}/Users/${samId}`, { Operations: [{ op: 'replace', path: 'active', value: true }] });
    expect(on.body.active).toBe(true);
    expect((await t.db.one<Row>('select revoked_at from api_tokens where id = $1', [pat.row.id]))!.revoked_at).not.toBeNull();

    // DELETE deactivates too, and the account stays.
    expect((await scim('DELETE', `${B}/Users/${samId}`)).status).toBe(204);
    expect((await t.db.one<Row>('select status, deleted_at from users where id = $1', [samId]))).toEqual({ status: 'disabled', deleted_at: null });
    expect((await scim('GET', `${B}/Users/${samId}`)).body.active).toBe(false);
  });

  it('never enables an account an administrator disabled', async () => {
    const res = await scim('POST', `${B}/Users`, user('kept.out@example.test'));
    await t.api.post(`/api/admin/users/${res.body.id}/disable`);
    const back = await scim('PATCH', `${B}/Users/${res.body.id}`, { Operations: [{ op: 'replace', path: 'active', value: true }] });
    expect(back.body.active).toBe(false);
    expect((await t.db.one<Row>('select status from users where id = $1', [res.body.id]))!.status).toBe('disabled');
  });

  it('refuses to deactivate the last administrator, and never sees the break-glass account', async () => {
    const admin = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!;
    const refused = await scim('PATCH', `${B}/Users/${admin.id}`, { Operations: [{ op: 'replace', path: 'active', value: false }] });
    expect(refused.status).toBe(409);
    expect(refused.body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error']);
    expect((await t.db.one<Row>('select status from users where id = $1', [admin.id]))!.status).toBe('active');

    const bg = (await t.db.one<{ id: string }>(`insert into users (username, email, display_name, status) values ('breakglass', 'bg@example.test', 'Break glass', 'active') returning id`))!;
    await t.db.query('insert into identity_user_settings (user_id, break_glass) values ($1, true)', [bg.id]);
    expect((await scim('GET', `${B}/Users/${bg.id}`)).status).toBe(404);
    expect((await scim('DELETE', `${B}/Users/${bg.id}`)).status).toBe(404);
    const all = await scim('GET', `${B}/Users?count=200`);
    expect(all.body.Resources.some((u: Row) => u.id === bg.id)).toBe(false);
  });
});

describe('groups and roles', () => {
  it('grants nothing until mapped, never an administrator role, and takes away only what it gave', async () => {
    const a = (await scim('POST', `${B}/Users`, user('ann.group@example.test'))).body.id;
    const b = (await scim('POST', `${B}/Users`, user('ben.group@example.test'))).body.id;
    const g = await scim('POST', `${B}/Groups`, { schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'], displayName: 'Dispatch (sample)', members: [{ value: a }] });
    expect(g.status).toBe(201);
    expect(g.body.members.map((m: Row) => m.value)).toEqual([a]);
    const roles = async (id: string) => (await t.db.query<{ key: string }>('select r.key from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = $1 order by 1', [id])).map((r) => r.key);
    expect(await roles(a)).toEqual([]);

    // An administrator maps it; an administrator role is refused.
    const bad = await t.api.put(`/api/admin/scim/groups/${g.body.id}/roles`, { roleKeys: ['administrator'] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.roleKeys).toMatch(/administer/);
    const mapped = await t.api.put(`/api/admin/scim/groups/${g.body.id}/roles`, { roleKeys: ['agent'] });
    expect(mapped.status).toBe(200);
    expect(await roles(a)).toEqual(['agent']);
    const listed = (await t.api.get('/api/admin/scim/groups')).body;
    expect(listed.roles.find((r: Row) => r.key === 'administrator').administers).toBe(true);

    // Membership changes follow; a role given by hand is never taken away.
    await scim('PATCH', `${B}/Groups/${g.body.id}`, { Operations: [{ op: 'add', path: 'members', value: [{ value: b }] }] });
    expect(await roles(b)).toEqual(['agent']);
    const auditor = (await t.db.one<{ id: string }>(`select id from roles where key = 'auditor'`))!;
    await t.db.query('insert into user_roles (user_id, role_id) values ($1, $2)', [b, auditor.id]);
    await scim('PATCH', `${B}/Groups/${g.body.id}`, { Operations: [{ op: 'remove', path: `members[value eq "${b}"]` }] });
    expect(await roles(b)).toEqual(['auditor']);

    // Even if the mapped role later gains administration, provisioning takes it back rather than keep it.
    const agentRole = (await t.db.one<{ id: string }>(`select id from roles where key = 'agent'`))!;
    await t.db.query(`insert into role_permissions (role_id, permission) values ($1, 'admin.administer')`, [agentRole.id]);
    await scim('PATCH', `${B}/Groups/${g.body.id}`, { Operations: [{ op: 'replace', path: 'displayName', value: 'Dispatch team (sample)' }] });
    await scim('PUT', `${B}/Groups/${g.body.id}`, { displayName: 'Dispatch team (sample)', members: [{ value: a }] });
    expect(await roles(a)).toEqual([]);
    await t.db.query(`delete from role_permissions where role_id = $1 and permission = 'admin.administer'`, [agentRole.id]);

    expect((await scim('GET', `${B}/Groups?filter=${encodeURIComponent('displayName eq "Dispatch team (sample)"')}&excludedAttributes=members`)).body.Resources[0]).not.toHaveProperty('members');
    expect((await scim('DELETE', `${B}/Groups/${g.body.id}`)).status).toBe(204);
    expect((await scim('GET', `${B}/Groups/${g.body.id}`)).status).toBe(404);
    const audit = await t.db.query<Row>(`select action, actor_name from audit_events where action like 'scim.group%' order by id`);
    expect(audit.map((r) => r.action)).toEqual(expect.arrayContaining(['scim.group_create', 'scim.group_members', 'scim.group_roles', 'scim.group_update', 'scim.group_delete']));
  });

  it('lists recent provisioning activity for administrators', async () => {
    const rows = (await t.api.get('/api/admin/scim/activity')).body;
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.some((r: Row) => r.actor_name === 'Provisioning (Directory (sample))')).toBe(true);
  });
});
