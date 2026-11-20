// Directory (LDAP) sign-in (E02-26) through the application: the provider's settings and secret,
// the sign-in route with accounts, linking, role mapping, the second factor, failures, rate limits
// and lockout, against a stand-in directory on this machine. The protocol pieces are tested in
// server/src/core/identity/ldap.test.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { recoveryCodeHash, SESSION_COOKIE, storeTotpSecret } from '../../core/auth.ts';
import { startFakeLdap, type FakeLdap } from '../../core/identity/ldap-fake-server.ts';
import { generateTotpSecret, totpCode } from '../../core/totp.ts';
import { testApp } from '../../test/helpers.ts';

const BASE = 'dc=example,dc=org';
const SERVICE = { dn: `cn=grc-service,ou=services,${BASE}`, password: 'service-pass-31337' };
const DANA = { user: 'dana', password: 'route-14-depot', dn: `cn=Dana Driver,ou=people,${BASE}` };
const KEY = 'example-directory';

let t: Awaited<ReturnType<typeof testApp>>;
let ldap: FakeLdap;
let providerId = '';

beforeAll(async () => {
  t = await testApp();
  ldap = await startFakeLdap({
    mode: 'ldaps',
    entries: [
      { dn: BASE, attributes: { objectClass: ['domain'] } },
      { dn: SERVICE.dn, password: SERVICE.password, attributes: { objectClass: ['person'] } },
      {
        dn: DANA.dn, password: DANA.password,
        attributes: {
          objectClass: ['person', 'user'], objectCategory: ['person'], sAMAccountName: ['dana'], mail: ['dana.driver@example.org'], displayName: ['Dana Driver'],
          objectGUID: [Buffer.from('0102030405060708090a0b0c0d0e0f10', 'hex')], userAccountControl: ['512'], memberOf: [`cn=Dispatch,ou=groups,${BASE}`],
        },
      },
      {
        dn: `cn=Rail Planner,ou=people,${BASE}`, password: 'timetable-rail-9',
        attributes: { objectClass: ['person', 'user'], objectCategory: ['person'], sAMAccountName: ['rail'], mail: ['rail.planner@example.org'], objectGUID: [Buffer.alloc(16, 2)] },
      },
      {
        dn: `cn=Off Duty,ou=people,${BASE}`, password: 'off-duty-pass',
        attributes: { objectClass: ['person', 'user'], objectCategory: ['person'], sAMAccountName: ['offduty'], mail: ['off.duty@example.org'], objectGUID: [Buffer.alloc(16, 3)], userAccountControl: ['514'] },
      },
      { dn: `cn=Dispatch,ou=groups,${BASE}`, attributes: { objectClass: ['group'], member: [DANA.dn] } },
    ],
  });
});
afterAll(async () => { await t.close(); await ldap.close(); });
beforeEach(async () => { await t.db.query('delete from rate_limit_hits'); });

const login = (body: Record<string, unknown>, key = KEY) =>
  t.app.inject({ method: 'POST', url: `/api/auth/sso/${key}/login`, headers: { 'x-grc-csrf': '1' }, payload: body });
const audited = async (action: string) =>
  (await t.db.query<{ summary: string }>('select summary from audit_events where action = $1 order by id', [action])).map((r) => r.summary);
const allAudit = async () => JSON.stringify(await t.db.query('select summary, before_data, after_data from audit_events').catch(() => t.db.query('select summary from audit_events')));

const config = (extra: Record<string, unknown> = {}) => ({
  directory: 'ad', url: ldap.url, startTls: false, caCert: ldap.cert, bindDn: SERVICE.dn, baseDn: BASE, trustEmail: true, ...extra,
});

describe('directory providers: settings (E02-26)', () => {
  it('refuses plain LDAP, and a switched-on provider without the service account password', async () => {
    const plain = await t.api.post('/api/admin/identity-providers', { key: 'plain-dir', name: 'Plain', type: 'ldap', config: config({ url: 'ldap://dc1.example.org' }) });
    expect(plain.status).toBe(400);
    expect(plain.body.error.fields['config.url']).toMatch(/plain LDAP/);
    const noSecret = await t.api.post('/api/admin/identity-providers', { key: 'no-secret', name: 'No secret', type: 'ldap', enabled: true, config: config() });
    expect(noSecret.status).toBe(400);
    expect(noSecret.body.error.fields.secret).toMatch(/service account password/);
  });

  it('adds a directory; the service account password is stored encrypted and never shown', async () => {
    const res = await t.api.post('/api/admin/identity-providers', {
      key: KEY, name: 'Example directory', type: 'ldap', enabled: true, secret: SERVICE.password,
      config: config({ jitEnabled: true, jitDomains: ['example.org'], mappingEnabled: true, mappings: [{ value: `cn=Dispatch,ou=groups,${BASE}`, role: 'agent' }] }),
    });
    expect(res.status).toBe(201);
    providerId = res.body.id;
    expect(res.body.typeLabel).toBe('Directory (LDAP)');
    expect(res.body.hasSecret).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(SERVICE.password);
    const row = await t.db.one<{ secret: string }>('select secret from identity_providers where id = $1', [providerId]);
    expect(row!.secret.startsWith('enc:v1:')).toBe(true);
    expect(await allAudit()).not.toContain(SERVICE.password);
    // On the sign-in page it is a choice on the password form, not a button.
    expect((await t.anon.get('/api/auth/providers')).body.providers).toEqual([{ key: KEY, name: 'Example directory', isDefault: false, style: 'credentials' }]);
    expect((await t.anon.post(`/api/auth/sso/${KEY}/start`)).status).toBe(404);
  });

  it('tests the connection, and looks a person up', async () => {
    const res = await t.api.post(`/api/admin/identity-providers/${providerId}/test`, { username: 'dana' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.details.groups).toEqual([`cn=Dispatch,ou=groups,${BASE}`]);
    expect((await audited('identity_provider.test')).pop()).toMatch(/looking up "dana"/);
  });
});

describe('directory sign-in (E02-26)', () => {
  it('signs in a new person (just-in-time), with roles from their groups, and audits it', async () => {
    const res = await login({ username: DANA.user, password: DANA.password });
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE)?.value;
    expect(cookie).toBeTruthy();
    const state = await t.app.inject({ method: 'GET', url: '/api/auth/state', headers: { cookie: `${SESSION_COOKIE}=${cookie}` } });
    expect(state.json().user.username).toBe('dana.driver');
    expect(state.json().user.roles).toContain('agent');
    expect((await audited('signin.success')).pop()).toMatch(/via Example directory \(Directory \(LDAP\)\)/);
    const session = await t.app.inject({ method: 'GET', url: '/api/auth/sso/session', headers: { cookie: `${SESSION_COOKIE}=${cookie}` } });
    expect(session.json()).toMatchObject({ method: KEY, provider: 'Example directory' });
    expect(await allAudit()).not.toContain(DANA.password);
    // A second sign-in uses the link, not the email.
    expect((await login({ username: 'DANA', password: DANA.password })).statusCode).toBe(200);
    expect((await t.db.query('select 1 from users where lower(email) = $1', ['dana.driver@example.org'])).length).toBe(1);
  });

  it('asks for the password of a matching local account before linking it', async () => {
    await t.db.query(`insert into users (username, email, display_name, status) values ('rplanner','rail.planner@example.org','Rail Planner','active')`);
    const res = await login({ username: 'rail', password: 'timetable-rail-9' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: false, link: true });
    expect(res.cookies.find((c) => c.name === 'grc_sso_link')?.value).toBeTruthy();
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
  });

  it('refuses wrong passwords with one generic answer, counts them per user name, and locks the linked account', async () => {
    const dana = await t.db.one<{ id: string }>(`select id from users where email = 'dana.driver@example.org'`);
    for (let i = 0; i < 5; i += 1) {
      const res = await login({ username: DANA.user, password: `wrong-${i}` });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.message).toBe('Sign-in failed. Check your details, or wait a few minutes and try again.');
    }
    expect((await audited('signin.failure')).pop()).toMatch(/wrong directory password for "dana"\) via Example directory/);
    const u = await t.db.one<{ failed_attempts: number; locked: boolean }>('select failed_attempts, locked_until > now() as locked from users where id = $1', [dana!.id]);
    expect(u).toMatchObject({ failed_attempts: 5, locked: true });
    expect((await audited('signin.lockout')).pop()).toMatch(/directory sign-in/);
    // Now even the right password is refused for a while.
    expect((await login({ username: DANA.user, password: DANA.password })).statusCode).toBe(401);
    expect((await audited('signin.failure')).pop()).toMatch(/too many failed directory sign-ins/);
    await t.db.query('delete from rate_limit_hits');
    expect((await login({ username: DANA.user, password: DANA.password })).statusCode).toBe(401); // the account itself is locked
    expect((await audited('signin.failure')).pop()).toMatch(/account locked/);
    await t.db.query('update users set failed_attempts = 0, locked_until = null where id = $1', [dana!.id]);
    expect(await allAudit()).not.toMatch(/wrong-[0-4]/);
  });

  it('refuses disabled accounts, unknown names, injection and empty passwords', async () => {
    expect((await login({ username: 'offduty', password: 'off-duty-pass' })).statusCode).toBe(401);
    expect((await audited('signin.failure')).pop()).toMatch(/directory account disabled/);
    expect((await login({ username: '*', password: DANA.password })).statusCode).toBe(401);
    expect((await login({ username: 'dana)(sAMAccountName=*', password: DANA.password })).statusCode).toBe(401);
    expect((await audited('signin.failure')).pop()).toMatch(/no such user in the directory/);
    expect(ldap.log.filter((r) => r.op === 'search').map((r) => r.filter)).toContain('(&(objectCategory=person)(objectClass=user)(sAMAccountName=\\2a))');
    const empty = await login({ username: DANA.user, password: '' });
    expect(empty.statusCode).toBe(400);
  });

  it('still asks for the second factor: a directory password is one factor', async () => {
    const dana = await t.db.one<{ id: string }>(`select id from users where email = 'dana.driver@example.org'`);
    const secret = generateTotpSecret();
    await storeTotpSecret(t.db, dana!.id, secret);
    await t.db.query(`update users set totp_enabled = true, recovery_codes = $2::jsonb where id = $1`, [dana!.id, JSON.stringify([recoveryCodeHash('ABCDE-12345')])]);
    const ask = await login({ username: DANA.user, password: DANA.password });
    expect(ask.statusCode).toBe(401);
    expect(ask.json().error.code).toBe('mfa_required');
    expect(ask.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
    const wrong = await login({ username: DANA.user, password: DANA.password, totp: '000000' === totpCode(secret) ? '111111' : '000000' });
    expect(wrong.statusCode).toBe(401);
    expect((await audited('signin.failure')).pop()).toMatch(/wrong authenticator or recovery code/);
    const ok = await login({ username: DANA.user, password: DANA.password, totp: totpCode(secret) });
    expect(ok.statusCode).toBe(200);
    expect((await audited('signin.success')).pop()).toMatch(/with second factor/);
    const recovery = await login({ username: DANA.user, password: DANA.password, recoveryCode: 'abcde-12345' });
    expect(recovery.statusCode).toBe(200);
    expect((await audited('mfa.recovery_code_used')).length).toBeGreaterThan(0);
    await t.db.query(`update users set totp_enabled = false, totp_secret = null, failed_attempts = 0 where id = $1`, [dana!.id]);
  });

  it('answers 502 when the directory cannot be trusted or reached, and 404 for other kinds of provider', async () => {
    await t.api.patch(`/api/admin/identity-providers/${providerId}`, { config: { caCert: '' } });
    const res = await login({ username: DANA.user, password: DANA.password });
    expect(res.statusCode).toBe(502);
    expect((await audited('signin.failure')).pop()).toMatch(/certificate is not trusted/);
    await t.api.patch(`/api/admin/identity-providers/${providerId}`, { config: { caCert: ldap.cert } });
    expect((await login({ username: DANA.user, password: DANA.password }, 'nobody')).statusCode).toBe(404);
    await t.api.patch(`/api/admin/identity-providers/${providerId}`, { enabled: false });
    expect((await login({ username: DANA.user, password: DANA.password })).statusCode).toBe(404);
  });
});
