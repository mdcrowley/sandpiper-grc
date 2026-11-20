// Vendors answering an assessment through a link (E06-21) and one expiry date for an evidence
// item and its files (E06-20). Invented data only.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, testApp } from '../../test/helpers.ts';
import { DEFAULT_QUESTIONS } from './assessments.ts';

let t: Awaited<ReturnType<typeof testApp>>;
const before = process.env.GRC_MODULES;
beforeAll(async () => {
  process.env.GRC_MODULES = 'vendors,attachments';
  t = await testApp();
});
afterAll(async () => {
  await t.close();
  if (before === undefined) delete process.env.GRC_MODULES; else process.env.GRC_MODULES = before;
});

const vendor = async (name: string) => (await t.api.post('/api/vendors', { name })).body.id as string;
const anonPut = (path: string, body: unknown) => t.app.inject({ method: 'PUT', url: path, headers: { 'x-grc-csrf': '1', 'x-forwarded-for': '203.0.113.9' }, payload: body as object });

describe('vendor response links (E06-21)', () => {
  it('are off by default and switched on by an administrator of vendors', async () => {
    expect((await t.api.get('/api/vendors/response-links/settings')).body).toMatchObject({ enabled: false, default_days: 14 });
    const v = await vendor('Harbor Ticketing');
    const a = (await t.api.post(`/api/vendors/${v}/assessments`, {})).body;
    expect((await t.api.post(`/api/vendor-assessments/${a.id}/links`, {})).status).toBe(409);
    const agent = await t.as('agent');
    expect((await agent.put('/api/vendors/response-links/settings', { enabled: true })).status).toBe(403);
    expect((await t.api.put('/api/vendors/response-links/settings', { enabled: true, default_days: 7 })).body).toMatchObject({ enabled: true, default_days: 7 });
  });

  it('asks to confirm your identity before switching links on, never after a token (E01-34)', async () => {
    const token = (await t.api.post('/api/me/tokens', { name: 'Vendor script', scopes: ['*'], expiresInDays: 1 })).body.token;
    expect((await t.api.put('/api/vendors/response-links/settings', { enabled: false })).body.enabled).toBe(false);
    await t.db.query(`update sessions set confirmed_at = now() - interval '1 day'`);
    const refused = await t.api.put('/api/vendors/response-links/settings', { enabled: true });
    expect([refused.status, refused.body.error.code]).toEqual([403, 'reauth_required']);
    // Other settings, and switching off, do not ask.
    expect((await t.api.put('/api/vendors/response-links/settings', { default_days: 7 })).status).toBe(200);
    const viaToken = await t.app.inject({ method: 'PUT', url: '/api/vendors/response-links/settings', headers: { authorization: `Bearer ${token}` }, payload: { enabled: true } });
    expect([viaToken.statusCode, viaToken.json().error.code]).toEqual([403, 'reauth_required']);
    expect((await t.api.post('/api/auth/confirm', { password: ADMIN.password })).status).toBe(200);
    expect((await t.api.put('/api/vendors/response-links/settings', { enabled: true })).body.enabled).toBe(true);
  });

  it('lets a vendor answer without an account, and staff take the answers over', async () => {
    const v = await vendor('Pier Cloud Services');
    const a = (await t.api.post(`/api/vendors/${v}/assessments`, {})).body;
    const made = await t.api.post(`/api/vendor-assessments/${a.id}/links`, { recipient: 'Security desk', days: 3 });
    expect(made.status).toBe(201);
    expect(made.body.path).toBe(`/vendor-response/${made.body.token}`);
    // Only a hash is stored.
    expect(await t.db.one('select 1 from vendor_assessment_links where token_hash = $1', [made.body.token])).toBeUndefined();

    const url = `/api/vendor-response/${made.body.token}`;
    const opened = await t.anon.get(url);
    expect(opened.status).toBe(200);
    expect(opened.body).toMatchObject({ vendor_name: 'Pier Cloud Services', submitted_at: null });
    expect(opened.body.questions).toHaveLength(DEFAULT_QUESTIONS.length);
    expect(opened.body.questions[0].weight).toBeUndefined();

    const [first, second] = DEFAULT_QUESTIONS;
    const saved = await t.anon.put(url, { answers: { [first.key]: { answer: 'yes' }, [second.key]: { answer: 'partial', note: 'Being arranged' } } });
    expect(saved.status).toBe(200);
    expect(saved.body.answers[second.key]).toEqual({ answer: 'partial', note: 'Being arranged' });
    expect((await t.anon.put(url, { answers: { nope: { answer: 'yes' } } })).status).toBe(400);
    expect((await t.anon.put(url, { submit: true, responder_name: 'R. Vendor' })).body.error.code).toBe('incomplete');

    const all = Object.fromEntries(DEFAULT_QUESTIONS.map((q) => [q.key, { answer: q.key === first.key ? 'yes' : 'na' }]));
    expect((await t.anon.put(url, { answers: all, submit: true })).body.error.fields.responder_name).toBeDefined();
    const sent = await t.anon.put(url, { answers: { ...all, [second.key]: { answer: 'partial', note: 'Being arranged' } }, submit: true, responder_name: 'R. Vendor' });
    expect(sent.status).toBe(200);
    expect(sent.body.submitted_at).toBeTruthy();
    expect((await t.anon.put(url, { answers: all })).status).toBe(409);
    expect((await t.anon.get(url)).status).toBe(200); // still readable until it expires

    // Nothing reaches the assessment until staff take it over.
    expect((await t.api.get(`/api/vendor-assessments/${a.id}`)).body.answered).toBe(0);
    const links = (await t.api.get(`/api/vendor-assessments/${a.id}/links`)).body.rows;
    expect(links[0]).toMatchObject({ state: 'submitted', responder_name: 'R. Vendor', answered: DEFAULT_QUESTIONS.length });
    expect(links[0].token).toBeUndefined();
    const one = await t.api.post(`/api/vendor-assessments/${a.id}/links/${links[0].id}/accept`, { keys: [second.key] });
    expect(one.body.accepted).toEqual([second.key]);
    expect((await t.api.get(`/api/vendor-assessments/${a.id}`)).body.answers[second.key]).toMatchObject({ answer: 'partial', note: 'Being arranged' });
    await t.api.post(`/api/vendor-assessments/${a.id}/links/${links[0].id}/accept`, {});
    // Staff may still change an answer before completing.
    await t.api.patch(`/api/vendor-assessments/${a.id}`, { answers: { [first.key]: { answer: 'no' } } });
    const done = await t.api.post(`/api/vendor-assessments/${a.id}/complete`, {});
    expect(done.status).toBe(200);
    expect(done.body.answers[first.key].answer).toBe('no');
    // A completed assessment closes its link.
    expect((await t.anon.get(url)).status).toBe(404);
    const audit = (await t.api.get(`/api/history?record_type=vendor&record_id=${v}`)).body.map((h: any) => h.action);
    expect(audit).toEqual(expect.arrayContaining(['vendor.response_link_create', 'vendor.response_link_open', 'vendor.response_submit']));
  });

  it('refuses unknown, revoked and expired links alike, and when switched off', async () => {
    const v = await vendor('Quay Data Centers');
    const a = (await t.api.post(`/api/vendors/${v}/assessments`, {})).body;
    const first = (await t.api.post(`/api/vendor-assessments/${a.id}/links`, {})).body;
    const second = (await t.api.post(`/api/vendor-assessments/${a.id}/links`, {})).body;
    // A new link replaces the open one.
    expect((await t.anon.get(`/api/vendor-response/${first.token}`)).status).toBe(404);
    expect((await t.anon.get(`/api/vendor-response/${second.token}`)).status).toBe(200);
    expect((await t.anon.get(`/api/vendor-response/${'x'.repeat(43)}`)).body.error.message).toMatch(/not valid/);
    await t.db.query(`update vendor_assessment_links set expires_at = now() - interval '1 minute' where id = $1`, [second.id]);
    expect((await t.anon.get(`/api/vendor-response/${second.token}`)).status).toBe(404);
    const third = (await t.api.post(`/api/vendor-assessments/${a.id}/links`, {})).body;
    expect((await t.api.del(`/api/vendor-assessments/${a.id}/links/${third.id}`)).status).toBe(200);
    expect((await t.anon.get(`/api/vendor-response/${third.token}`)).status).toBe(404);
    const fourth = (await t.api.post(`/api/vendor-assessments/${a.id}/links`, {})).body;
    await t.api.put('/api/vendors/response-links/settings', { enabled: false });
    expect((await t.anon.get(`/api/vendor-response/${fourth.token}`)).status).toBe(404);
    await t.api.put('/api/vendors/response-links/settings', { enabled: true });
    // Switching off revoked it for good.
    expect((await t.anon.get(`/api/vendor-response/${fourth.token}`)).status).toBe(404);
  });

  it('limits how often one address may try', async () => {
    let last = 0;
    for (let i = 0; i < 22; i++) last = (await anonPut(`/api/vendor-response/${'y'.repeat(43)}`, {})).statusCode;
    expect(last).toBe(429);
  });
});

describe('one expiry date for evidence (E06-20)', () => {
  it('shows when the item and its files disagree and copies one date onto the other', async () => {
    const v = await vendor('Lantern Assurance');
    const item = (await t.api.post('/api/evidence', { title: 'Assurance report', vendor_id: v, expires_on: '2031-06-30' })).body;
    const file = async (expires: string | null) => (await t.db.one<{ id: string }>(
      `insert into attachments (record_type, record_id, file_name, size_bytes, sha256, storage_key, kind, expires_on)
       values ('evidence_item', $1, $2, 10, 'x', $3, 'evidence', $4) returning id`, [item.id, `report-${expires}.pdf`, randomUUID(), expires]))!.id;
    const same = await file('2031-06-30');
    expect((await t.api.get(`/api/evidence/${item.id}/expiry`)).body).toMatchObject({ differs: false, files_available: true });
    const later = await file('2032-01-31');
    const report = (await t.api.get(`/api/evidence/${item.id}/expiry`)).body;
    expect(report.differs).toBe(true);
    expect(report.files.find((f: any) => f.id === later)).toMatchObject({ expires_on: '2032-01-31', differs: true });
    expect(report.files.find((f: any) => f.id === same).differs).toBe(false);

    const fromFile = await t.api.post(`/api/evidence/${item.id}/expiry/align`, { use: 'file', attachment_id: later });
    expect(fromFile.body.item.expires_on).toBe('2032-01-31');
    expect((await t.api.get(`/api/evidence/${item.id}`)).body.expires_on).toBe('2032-01-31');
    const fromItem = await t.api.post(`/api/evidence/${item.id}/expiry/align`, { use: 'item' });
    expect(fromItem.body.differs).toBe(false);
    expect(fromItem.body.files.map((f: any) => f.expires_on)).toEqual(['2032-01-31', '2032-01-31']);
    const actions = (await t.api.get(`/api/history?record_type=evidence_item&record_id=${item.id}`)).body.map((h: any) => h.action);
    expect(actions).toContain('evidence_item.file_expiry_align');

    expect((await t.api.post(`/api/evidence/${item.id}/expiry/align`, { use: 'file', attachment_id: randomUUID() })).status).toBe(400);
    expect((await (await t.as('agent')).post(`/api/evidence/${item.id}/expiry/align`, { use: 'item' })).status).toBe(403);
  });
});
