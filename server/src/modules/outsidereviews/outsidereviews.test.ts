import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, SESSION_COOKIE } from '../../core/auth.ts';
import { AREAS } from '../../core/features.ts';
import { startSmtpSink, type SmtpSink } from '../../core/mail/smtp-sink.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { REVIEWER_GRANT, REVIEWER_ROUTES } from './gate.ts';

// E41-09: outside reviewers. Invited by email to one audit engagement or funder compliance review,
// until an end date; their account reaches nothing else in the application.

type T = Awaited<ReturnType<typeof testApp>>;
let t: T;
let sink: SmtpSink;
let auditId = '';
let otherAuditId = '';
let reviewId = '';
let requestId = '';
let requestFile = '';
let auditEvidence = '';
let auditPlainFile = '';
let otherFile = '';
let reviewEvidence = '';
let reviewerId = '';
let grantId = '';
let reviewer = '';

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj\n<< /Type /Catalog >>\nendobj\n', 'latin1'), Buffer.alloc(300, 0x20)]);
const ID = '00000000-0000-4000-8000-0000000000a1';

async function call(method: string, url: string, cookie: string, body?: unknown) {
  const res = await t.app.inject({
    method: method as 'GET', url,
    headers: { cookie: `${SESSION_COOKIE}=${cookie}`, 'x-grc-csrf': '1' },
    ...(body !== undefined ? { payload: body as object } : method === 'GET' || method === 'DELETE' ? {} : { payload: {} }),
  });
  let json: any = null;
  try { json = res.json(); } catch { /* a file */ }
  return { status: res.statusCode, body: json, raw: res.rawPayload };
}

async function attach(type: string, id: string, name: string, kind: 'evidence' | 'file') {
  const admin = await createSession(t.db, (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id);
  const res = await t.app.inject({
    method: 'PUT', url: `/api/attachments/upload?${new URLSearchParams({ record_type: type, record_id: id, name, kind })}`,
    headers: { cookie: `${SESSION_COOKIE}=${admin}`, 'x-grc-csrf': '1', 'content-type': 'application/octet-stream' },
    payload: PDF,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

/** Every session counts as having confirmed its password just now (inviting asks for it). */
const confirmAll = () => t.db.query('update sessions set confirmed_at = now()');
const runMail = () => t.app.jobs.runDue({ types: ['mail.send'] });

beforeAll(async () => {
  sink = await startSmtpSink();
  t = await testApp();
  await confirmAll();
  auditId = (await t.api.post('/api/audits', { title: 'Invented depot safety audit', audit_type: 'internal_audit', scope: 'Invented scope text' })).body.id;
  otherAuditId = (await t.api.post('/api/audits', { title: 'Invented audit nobody outside sees', audit_type: 'internal_audit' })).body.id;
  requestId = (await t.api.post('/api/audit-requests', { audit_id: auditId, request: 'Invented request: the depot inspection log' })).body.id;
  expect((await t.api.post('/api/audit-findings', { title: 'Invented finding on the log', source_type: 'audit_engagement', source_id: auditId, rating: 'observation' })).status).toBe(201);
  requestFile = await attach('audit_request', requestId, 'Inspection log.pdf', 'file');
  auditEvidence = await attach('audit_engagement', auditId, 'Walkthrough notes.pdf', 'evidence');
  auditPlainFile = await attach('audit_engagement', auditId, 'Internal working paper.pdf', 'file');
  otherFile = await attach('audit_engagement', otherAuditId, 'Other evidence.pdf', 'evidence');
  reviewId = (await t.api.post('/api/compliance-reviews', { title: 'Invented funder review', funder_name: 'Invented funder' })).body.id;
  expect((await t.api.post(`/api/compliance-reviews/${reviewId}/requests`, { request: 'Invented request: procurement files' })).status).toBe(201);
  expect((await t.api.post('/api/review-deficiencies', { title: 'Invented deficiency', review_id: reviewId })).status).toBe(201);
  reviewEvidence = await attach('compliance_review', reviewId, 'Procurement sample.pdf', 'evidence');
}, 120_000);
afterAll(async () => { await t?.close(); await sink?.close(); });

describe('inviting an outside reviewer (E41-09)', () => {
  it('needs email, a recent password confirmation and the edit permission', async () => {
    const off = await t.api.post(`/api/audits/${auditId}/outside-reviewers`, { email: 'reviewer@outside.example', name: 'Invented Reviewer', expires_on: dayInZone(30) });
    expect(off.status).toBe(409);
    expect(off.body.error.code).toBe('email_off');
    const mail = await t.api.put('/api/admin/mail/settings', {
      host: '127.0.0.1', port: sink.port, tlsMode: 'none', fromAddress: 'grc@example.test', baseUrl: 'https://grc.example.test', enabled: true,
    });
    expect(mail.status, JSON.stringify(mail.body)).toBe(200);

    const viewer = await t.as('auditor');
    expect((await viewer.get(`/api/audits/${auditId}/outside-reviewers`)).status).toBe(200);
    expect((await viewer.post(`/api/audits/${auditId}/outside-reviewers`, { email: 'x@outside.example', name: 'X', expires_on: dayInZone(5) })).status).toBe(403);
    const lead = await t.as('audit_lead');
    await t.db.query(`update sessions set confirmed_at = now() - interval '1 day' where user_id = $1`, [lead.userId]);
    const stale =await lead.post(`/api/audits/${auditId}/outside-reviewers`, { email: 'x@outside.example', name: 'X', expires_on: dayInZone(5) });
    expect(stale.status).toBe(403);
    expect(stale.body.error.code).toBe('reauth_required');
  });

  it('checks the address and the end date', async () => {
    await confirmAll();
    const bad = await t.api.post(`/api/audits/${auditId}/outside-reviewers`, { email: 'not an address', name: '', expires_on: dayInZone(-1) });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['email', 'name']);
    expect((await t.api.post(`/api/audits/${auditId}/outside-reviewers`, { email: 'r@outside.example', name: 'R', expires_on: dayInZone(-1) })).body.error.fields.expires_on).toBeTruthy();
    expect((await t.api.post(`/api/audits/${auditId}/outside-reviewers`, { email: 'r@outside.example', name: 'R', expires_on: dayInZone(400) })).body.error.fields.expires_on).toBeTruthy();
    const staff = await t.api.post(`/api/audits/${auditId}/outside-reviewers`, { email: 'admin@example.test', name: 'Staff', expires_on: dayInZone(5) });
    expect(staff.status).toBe(409);
    expect(staff.body.error.code).toBe('staff_account');
  });

  it('makes an account with no roles and emails a sealed set-up link', async () => {
    await confirmAll();
    const made = await t.api.post(`/api/audits/${auditId}/outside-reviewers`, {
      email: 'Jordan.Reviewer@outside.example', name: 'Invented Jordan Reviewer', organization: 'Invented audit firm', expires_on: dayInZone(30),
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body).toMatchObject({ state: 'active', email: 'jordan.reviewer@outside.example', waiting_for_setup: true, organization: 'Invented audit firm' });
    expect(JSON.stringify(made.body)).not.toMatch(/redeem|token/);
    grantId = made.body.id;
    reviewerId = made.body.user_id;
    const user = await t.db.one<any>('select username, status, (select count(*)::int from user_roles where user_id = users.id) as roles from users where id = $1', [reviewerId]);
    expect(user).toEqual({ username: 'jordan.reviewer', status: 'pending', roles: 0 });
    expect((await t.api.post(`/api/audits/${auditId}/outside-reviewers`, { email: 'jordan.reviewer@outside.example', name: 'Again', expires_on: dayInZone(3) })).body.error.code).toBe('already_invited');

    await runMail();
    const m = sink.messages.at(-1)!;
    expect(m.to).toEqual(['jordan.reviewer@outside.example']);
    expect(m.subject).toContain('you are invited to review audit engagement AUD-');
    expect(m.body).not.toContain('Invented depot safety audit'); // the title is not in the email
    const token = /https:\/\/grc\.example\.test\/redeem\?token=([A-Za-z0-9_-]+)/.exec(m.body)?.[1];
    expect(token).toBeTruthy();
    const stored = await t.db.query<{ p: string }>(`select payload::text as p from jobs where type = 'mail.send'`);
    expect(stored.some((r) => r.p.includes(token!))).toBe(false);
    expect((await t.anon.post('/api/auth/redeem', { token, password: 'an outside reviewer passphrase 4' })).status).toBe(200);
    const login = await t.app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-grc-csrf': '1' }, payload: { username: 'jordan.reviewer', password: 'an outside reviewer passphrase 4' } });
    expect(login.statusCode, login.body).toBe(200);
    reviewer = login.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
    expect((await t.db.query(`select 1 from audit_events where action = 'outside_review.invite' and record_id = $1`, [auditId])).length).toBe(1);
  });

  it('asks for a second factor before anything else (outsidereviews.require_2fa, on by default)', async () => {
    // The site-wide enforcement is only a reminder here, but a reviewer is blocked until they enroll.
    const blocked = await call('GET', '/api/outside-review', reviewer);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('mfa_enrolment_required');
    expect((await call('GET', '/api/auth/state', reviewer)).body).toMatchObject({ mfaEnrollmentRequired: true, mfaEnrollmentBlocked: true });
    // The enrollment routes stay open.
    expect((await call('GET', '/api/auth/security', reviewer)).status).toBe(200);
    expect((await call('POST', '/api/auth/totp/begin', reviewer)).status).toBeLessThan(300);
    // With the setting off it is not asked for.
    await confirmAll();
    expect((await t.api.patch('/api/admin/settings', { 'outsidereviews.require_2fa': false })).status).toBe(200);
    expect((await call('GET', '/api/outside-review', reviewer)).status).toBe(200);
    expect((await t.api.patch('/api/admin/settings', { 'outsidereviews.require_2fa': true })).status).toBe(200);
    expect((await call('GET', '/api/outside-review', reviewer)).status).toBe(403);
    // Once enrolled (an authenticator here), the workspace opens.
    await t.db.query('update users set totp_enabled = true where id = $1', [reviewerId]);
    expect((await call('GET', '/api/outside-review', reviewer)).status).toBe(200);
    expect((await call('GET', '/api/auth/state', reviewer)).body.mfaEnrollmentBlocked).toBe(false);
    // Staff are not affected.
    expect((await t.api.get('/api/auth/state')).body.mfaEnrollmentBlocked).toBe(false);
  });
});

describe('roles and permissions of a reviewer account (wave 23 A3)', () => {
  it('cannot be given a role by an administrator, single sign-on or provisioning', async () => {
    await confirmAll();
    const refused = await t.api.patch(`/api/admin/users/${reviewerId}`, { roles: ['auditor'] });
    expect(refused.status).toBe(400);
    expect(refused.body.error.fields.roles).toMatch(/outside reviewer/);
    expect((await t.api.patch(`/api/admin/users/${reviewerId}`, { roles: [] })).status).toBe(200);
    // Sign-in provider role mapping.
    const { syncMappedRoles } = await import('../../core/identity/accounts.ts');
    const provider = { key: 'invented-idp', name: 'Invented provider', config: { mappingEnabled: true, mappings: [{ value: 'auditors', role: 'auditor' }] } };
    const mapped = await syncMappedRoles({ db: t.db, audit: async () => {} } as never, null, reviewerId, provider as never, ['auditors']);
    expect(mapped).toEqual({ added: [], removed: [] });
    // Provisioning (SCIM) group sync.
    if ((await t.db.one(`select to_regclass('scim_group_roles')::text as t`))?.t) {
      const { syncProvisionedRoles } = await import('../integrations/shared.ts');
      const g = await t.db.one<{ id: string }>(`insert into scim_group_roles (display_name, role_keys) values ('Invented auditors', '["auditor"]') returning id`);
      await t.db.query('insert into scim_group_members (group_id, user_id) values ($1, $2)', [g!.id, reviewerId]);
      expect(await t.db.tx((tx) => syncProvisionedRoles(t.ctx, tx, reviewerId))).toEqual({ added: [], removed: [] });
    }
    expect((await t.db.query('select 1 from user_roles where user_id = $1', [reviewerId])).length).toBe(0);
  });

  it('holds no permission outside a request either, and is never offered in a staff picker', async () => {
    // A role that got there another way (before the sweep takes it off) gives nothing.
    await t.db.query(`insert into user_roles (user_id, role_id) select $1, id from roles where key = 'auditor'`, [reviewerId]);
    try {
      const { loadUser } = await import('../../core/auth.ts');
      expect((await loadUser(t.db, reviewerId))!.permissions).toEqual([]);
      const { activeUsers } = await import('../notifications/service.ts');
      expect((await activeUsers(t.ctx)).find((u) => u.id === reviewerId)!.permissions).toEqual([]);
      const before = (await t.db.one<{ n: number }>('select count(*)::int as n from notifications where user_id = $1', [reviewerId]))!.n;
      await t.ctx.app.notify({ permission: 'audits.view', kind: 'general', title: 'Invented broadcast to auditors' });
      expect((await t.db.one<{ n: number }>('select count(*)::int as n from notifications where user_id = $1', [reviewerId]))!.n).toBe(before);
      const sent = await t.ctx.app.sendMail({ permission: 'audits.view', template: 'message', purpose: 'other', data: { subject: 'Invented mail to auditors', body: 'x' } });
      expect(sent.queued).toBeGreaterThanOrEqual(0);
      expect((await t.db.query(`select 1 from mail_log where user_id = $1 and subject = 'Invented mail to auditors'`, [reviewerId])).length).toBe(0);
    } finally {
      await t.db.query('delete from user_roles where user_id = $1', [reviewerId]);
    }
    const picker = (await t.api.get('/api/users/options?q=jordan')).body.map((u: any) => u.id);
    expect(picker).not.toContain(reviewerId);
    // A picker showing a value already chosen still names it.
    expect((await t.api.get(`/api/users/options?ids=${reviewerId}`)).body.map((u: any) => u.id)).toEqual([reviewerId]);
  });
});

describe('the reviewer workspace', () => {
  it('lists the reviews and shows one with its requests, evidence and findings', async () => {
    const state = await call('GET', '/api/auth/state', reviewer);
    expect(state.body.permissions).toEqual([REVIEWER_GRANT]);
    const mine = await call('GET', '/api/outside-review', reviewer);
    expect(mine.body.reviewer).toBe(true);
    expect(mine.body.reviews).toEqual([expect.objectContaining({ id: grantId, state: 'active', title: 'Invented depot safety audit', days_left: 30 })]);
    const ws = await call('GET', `/api/outside-review/${grantId}`, reviewer);
    expect(ws.status).toBe(200);
    expect(ws.body.subject).toMatchObject({ kind: 'Audit engagement', title: 'Invented depot safety audit' });
    expect(ws.body.subject.sections).toEqual([{ label: 'Scope', text: 'Invented scope text' }]);
    expect(ws.body.requests).toHaveLength(1);
    expect(ws.body.requests[0].files.map((f: any) => f.id)).toEqual([requestFile]);
    expect(ws.body.findings.map((f: any) => f.title)).toEqual(['Invented finding on the log']);
    // Evidence files on the audit itself, not its other files.
    expect(ws.body.files.map((f: any) => f.id)).toEqual([auditEvidence]);
    expect((await call('GET', `/api/outside-review/${grantId}/files/${requestFile}`, reviewer)).raw.equals(PDF)).toBe(true);
    expect((await call('GET', `/api/outside-review/${grantId}/files/${auditEvidence}`, reviewer)).status).toBe(200);
    expect((await call('GET', `/api/outside-review/${grantId}/files/${auditPlainFile}`, reviewer)).status).toBe(404);
    expect((await call('GET', `/api/outside-review/${grantId}/files/${otherFile}`, reviewer)).status).toBe(404);
    expect((await t.db.query(`select 1 from audit_events where action = 'outside_review.download' and record_id = $1`, [auditId])).length).toBe(2);
    expect((await t.db.query(`select 1 from audit_events where action = 'outside_review.open' and record_id = $1`, [auditId])).length).toBe(1);
  });

  it('is someone else\'s for staff: their own list is empty and a reviewer\'s grant answers 404', async () => {
    expect((await t.api.get('/api/outside-review')).body).toMatchObject({ reviewer: false, reviews: [] });
    expect((await t.api.get(`/api/outside-review/${grantId}`)).status).toBe(404);
    expect((await t.api.get(`/api/outside-review/${grantId}/files/${requestFile}`)).status).toBe(404);
  });
});

describe('nothing else is reachable for a reviewer account', () => {
  it('answers 404 on every other route, even when the account is given a role', async () => {
    // An administrator's role makes no difference: the account stays confined.
    await t.db.query(`insert into user_roles (user_id, role_id) select $1, id from roles where key = 'administrator'`, [reviewerId]);
    const routes = t.core.openapi.routes();
    const fill = (url: string) => url.replace(/:[A-Za-z0-9_]+/g, ID).replace(/\*/g, 'x');
    const reached: string[] = [];
    let checked = 0;
    for (const r of routes) {
      if (r.public || REVIEWER_ROUTES.has(r.url) || r.url.startsWith('/api/auth/') && r.method === 'POST' && /logout|sessions\/end-others/.test(r.url)) continue;
      const res = await call(r.method, fill(r.url), reviewer);
      checked += 1;
      if (res.status !== 404 || res.body?.error?.code !== 'not_found') reached.push(`${r.method} ${r.url} -> ${res.status}`);
    }
    expect(reached).toEqual([]);
    expect(checked).toBeGreaterThan(500);
    // With real values too: search, pickers, the record, its files, exports, the assistant, My work, the app.
    for (const url of [
      `/api/search?q=Invented`, '/api/users/options', '/api/records/lookup?type=audit_engagement&q=Invented', `/api/audits/${auditId}`,
      '/api/audits', '/api/audits?format=csv', `/api/records/audit_engagement/${auditId}/pdf`, `/api/attachments?record_type=audit_engagement&record_id=${auditId}`,
      `/api/attachments/${auditEvidence}/download`, '/api/work/mine', '/api/mcp/session', '/api/meta', `/api/audits/${auditId}/report.pdf`,
      `/api/v1/audits/${auditId}`, '/api/audit-requests/mine', '/api/me/tokens', `/api/history?record_type=audit_engagement&record_id=${auditId}`,
    ]) {
      const res = await call('GET', url, reviewer);
      expect(res.status, url).toBe(404);
    }
    expect((await call('POST', '/api/me/tokens', reviewer, { name: 'x' })).status).toBe(404);
    expect((await call('POST', '/api/mcp/oauth/authorize', reviewer, {})).status).toBe(404);
    // Its own sign-in security still works, as for anyone.
    expect((await call('GET', '/api/auth/security', reviewer)).status).toBe(200);
    expect((await call('PUT', '/api/me/preferences/theme', reviewer, { value: 'dark' })).status).toBeLessThan(300);
    // The account holds no permission, and the next sweep takes the role off again.
    expect((await call('GET', '/api/auth/state', reviewer)).body).toMatchObject({ permissions: [REVIEWER_GRANT], user: { roles: [] } });
    const swept = await (await import('./access.ts')).makeAccess(t.ctx).sweep();
    expect(swept).toEqual({ disabled: 0, rolesRemoved: 1 });
    expect((await t.db.query('select 1 from user_roles where user_id = $1', [reviewerId])).length).toBe(0);
  }, 300_000);
});

describe('the end of access', () => {
  it('changes the end date with a version check, and ends with it', async () => {
    const lead = await t.as('audit_lead');
    const list = await lead.get(`/api/audits/${auditId}/outside-reviewers`);
    expect(list.body.rows).toEqual([expect.objectContaining({ id: grantId, state: 'active', waiting_for_setup: false, last_opened_at: expect.any(String) })]);
    const stale = await lead.patch(`/api/audits/${auditId}/outside-reviewers/${grantId}`, { expires_on: dayInZone(10), updated_at: '2000-01-01T00:00:00.000Z' });
    expect(stale.status).toBe(409);
    const ok = await lead.patch(`/api/audits/${auditId}/outside-reviewers/${grantId}`, { expires_on: dayInZone(10), updated_at: list.body.rows[0].updated_at });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.expires_on).toBe(dayInZone(10));
    // Past its end date the review is closed to the reviewer, and the sweep disables the account.
    await t.db.query(`update outside_review_grants set expires_on = $2 where id = $1`, [grantId, dayInZone(-1)]);
    expect((await call('GET', `/api/outside-review/${grantId}`, reviewer)).status).toBe(404);
    const mine = await call('GET', '/api/outside-review', reviewer);
    expect(mine.body.reviews).toEqual([expect.objectContaining({ state: 'expired', title: null })]);
  });

  it('disables the account and ends its sessions when its last review ends, and a new invitation turns it back on', async () => {
    const ran = await (await import('./access.ts')).makeAccess(t.ctx).sweep();
    expect(ran.disabled).toBe(1);
    expect((await t.db.one<any>('select status from users where id = $1', [reviewerId])).status).toBe('disabled');
    expect((await t.db.query('select 1 from sessions where user_id = $1', [reviewerId])).length).toBe(0);
    expect((await call('GET', '/api/outside-review', reviewer)).status).toBe(401);

    await confirmAll();
    const again = await t.api.post(`/api/compliance-reviews/${reviewId}/outside-reviewers`, { email: 'jordan.reviewer@outside.example', name: 'Invented Jordan Reviewer', expires_on: dayInZone(14) });
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect((await t.db.one<any>('select status from users where id = $1', [reviewerId])).status).toBe('active');
    await runMail();
    expect(sink.messages.at(-1)!.subject).toContain('funder compliance review CRV-');
    expect(sink.messages.at(-1)!.body).not.toMatch(/redeem\?token/); // they have a password: no new link
    reviewer = await createSession(t.db, reviewerId);
    const ws = await call('GET', `/api/outside-review/${again.body.id}`, reviewer);
    expect(ws.status).toBe(200);
    expect(ws.body.labels).toEqual({ requests: 'Document requests', findings: 'Deficiencies' });
    expect(ws.body.requests.map((r: any) => r.request)).toEqual(['Invented request: procurement files']);
    expect(ws.body.findings.map((f: any) => f.title)).toEqual(['Invented deficiency']);
    expect(ws.body.files.map((f: any) => f.id)).toEqual([reviewEvidence]);
    // The old audit grant stays closed.
    expect((await call('GET', `/api/outside-review/${grantId}`, reviewer)).status).toBe(404);

    // Revoking ends it at once: the account is disabled and signed out.
    const officer = await t.as('compliance_officer');
    const revoked = await officer.post(`/api/compliance-reviews/${reviewId}/outside-reviewers/${again.body.id}/revoke`);
    expect(revoked.status).toBe(200);
    expect(revoked.body.state).toBe('revoked');
    expect((await t.db.one<any>('select status from users where id = $1', [reviewerId])).status).toBe('disabled');
    expect((await call('GET', '/api/outside-review', reviewer)).status).toBe(401);
  });

  it('keeps an account an administrator disabled off', async () => {
    await t.db.query(`update outside_reviewers set ended_at = null where user_id = $1`, [reviewerId]);
    await confirmAll();
    const refused = await t.api.post(`/api/audits/${auditId}/outside-reviewers`, { email: 'jordan.reviewer@outside.example', name: 'X', expires_on: dayInZone(3) });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('account_disabled');
  });
});

describe('switched-off areas', () => {
  it('leaves audit invitations out and closed while Audits is off', async () => {
    await t.db.query(`update users set status = 'active' where id = $1`, [reviewerId]);
    await t.db.query(`update outside_reviewers set ended_at = null where user_id = $1`, [reviewerId]);
    const g = await t.db.one<{ id: string }>(
      `insert into outside_review_grants (user_id, subject_type, subject_id, expires_on) values ($1, 'audit_engagement', $2, $3) returning id`,
      [reviewerId, auditId, dayInZone(5)]);
    reviewer = await createSession(t.db, reviewerId);
    expect((await call('GET', `/api/outside-review/${g!.id}`, reviewer)).status).toBe(200);
    const off = await t.api.patch('/api/admin/features', { features: { audits: false } });
    expect(off.status).toBe(200);
    try {
      await t.core.features.state();
      expect((await call('GET', `/api/outside-review/${g!.id}`, reviewer)).status).toBe(404);
      expect((await call('GET', '/api/outside-review', reviewer)).body.reviews.some((r: any) => r.kind === 'Audit engagement')).toBe(false);
      expect((await t.api.get('/api/admin/outside-reviewers')).body.rows.some((r: any) => r.subject_type === 'audit_engagement')).toBe(false);
      const staff = await t.api.get(`/api/audits/${auditId}/outside-reviewers`);
      expect(staff.status).toBe(404);
      expect(staff.body.error.code).toBe('switched_off');
    } finally {
      await t.api.patch('/api/admin/features', { features: Object.fromEntries(AREAS.map((a) => [a.key, true])) });
    }
  });
});
