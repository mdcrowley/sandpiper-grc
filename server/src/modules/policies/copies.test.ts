import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkPdfUa } from '../../core/export/pdfua.ts';
import { PdfBuilder } from '../../core/export/pdf.ts';
import { pdfText } from '../../core/export/testing.ts';
import type { Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';

// E43-14 (register of issued paper copies and their recall), E43-16 (a diagonal status word on printed
// text versions) and E43-18 (loaded versions listed on the Data loads page and undone one at a time).
// Invented documents and people only.

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let writer: Client;
let approver: Client;
let reader: Client;
let readerId = '';

async function publish(id: string, body: string) {
  const v = await writer.post(`/api/policies/${id}/versions`, { body });
  expect(v.status, JSON.stringify(v.body)).toBe(201);
  expect((await approver.post(`/api/policies/${id}/versions/${v.body.id}/approve`, {})).status).toBe(200);
  const p = await approver.post(`/api/policies/${id}/versions/${v.body.id}/publish`, {});
  expect(p.status, JSON.stringify(p.body)).toBe(200);
  return v.body.id as string;
}
const confirm = () => t.db.query('update sessions set confirmed_at = now()');

beforeAll(async () => {
  t = await testApp();
  writer = await t.as('security_lead');
  approver = await t.as('security_lead');
  const r = await t.db.one<{ id: string }>(`insert into roles (key, name, enabled) values ('copy_reader', 'Invented reader', true) returning id`);
  await t.db.query(`insert into role_permissions (role_id, permission) values ($1, 'policies.view')`, [r!.id]);
  reader = await t.as('copy_reader');
  readerId = reader.userId;
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('register of paper copies (E43-14)', () => {
  let doc: Row;
  it('issues numbered copies of the version in force to people and places', async () => {
    doc = (await writer.post('/api/policies', { title: 'Invented depot fueling procedure', document_type: 'sop', owner_id: writer.userId })).body;
    // Nothing in force yet: nothing to issue.
    expect((await writer.post(`/api/policies/${doc.id}/copies`, { holder_name: 'Depot binder' })).body.error.fields.version_id).toBeTruthy();
    await publish(doc.id, 'Version one, invented.');
    const a = await writer.post(`/api/policies/${doc.id}/copies`, { holder_name: 'North depot operations binder', location: 'Dispatch office' });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(a.body).toMatchObject({ copy_number: 1, version: 1, holder_name: 'North depot operations binder', recall_due: false });
    const b = await writer.post(`/api/policies/${doc.id}/copies`, { holder_user_id: readerId });
    expect(b.body.copy_number).toBe(2);
    expect(b.body.holder_name).toBeTruthy();
    // A number twice, a future date and no holder are refused; readers cannot issue.
    expect((await writer.post(`/api/policies/${doc.id}/copies`, { holder_name: 'X', copy_number: 1 })).status).toBe(400);
    expect((await writer.post(`/api/policies/${doc.id}/copies`, { holder_name: 'X', issued_on: '2999-01-01' })).status).toBe(400);
    expect((await writer.post(`/api/policies/${doc.id}/copies`, {})).body.error.fields.holder_name).toBeTruthy();
    expect((await reader.post(`/api/policies/${doc.id}/copies`, { holder_name: 'X' })).status).toBe(403);
    const list = await reader.get(`/api/policies/${doc.id}/copies`);
    expect(list.body).toMatchObject({ out: 2, recall_due: 0, can_edit: false, next_number: 3 });
  });

  it('makes copies of the earlier version due for recall when a new version takes effect, in the owner\'s My work', async () => {
    await publish(doc.id, 'Version two, invented.');
    const list = (await writer.get(`/api/policies/${doc.id}/copies`)).body;
    expect(list.recall_due).toBe(2);
    const mine = await writer.get('/api/work/mine?days=30');
    const section = mine.body.sections.find((s: Row) => s.key === 'policies.copy_recalls');
    expect(section?.count).toBe(2);
    // A new copy of version 2 is not due.
    const c = await writer.post(`/api/policies/${doc.id}/copies`, { holder_name: 'South depot binder' });
    expect(c.body).toMatchObject({ copy_number: 3, version: 2, recall_due: false });
    // Recording a recall takes it off the list.
    const first = list.rows[0];
    expect((await writer.post(`/api/policies/${doc.id}/copies/${first.id}/recall`, { recalled_on: '2999-01-01' })).status).toBe(400);
    const rec = await writer.post(`/api/policies/${doc.id}/copies/${first.id}/recall`, { note: 'Collected and destroyed' });
    expect(rec.status, JSON.stringify(rec.body)).toBe(200);
    expect(rec.body).toMatchObject({ recalled_on: dayInZone(), recall_note: 'Collected and destroyed', recall_due: false });
    expect((await writer.post(`/api/policies/${doc.id}/copies/${first.id}/recall`, {})).status).toBe(409);
    expect((await writer.get(`/api/policies/${doc.id}/copies`)).body.recall_due).toBe(1);
    // A copy entered by mistake is taken out of the register; every step is audited.
    expect((await writer.del(`/api/policies/${doc.id}/copies/${c.body.id}`)).status).toBe(200);
    const actions = (await t.db.query<Row>(`select action from audit_events where record_id = $1 and action like 'policy.copy%'`, [doc.id])).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['policy.copy_issue', 'policy.copy_recall', 'policy.copy_delete']));
  });

  it('makes every copy still out due when the document is made obsolete', async () => {
    expect((await approver.post(`/api/policies/${doc.id}/retire`, { reason: 'Invented: replaced by a new procedure' })).status).toBe(200);
    expect((await writer.get(`/api/policies/${doc.id}/copies`)).body.recall_due).toBe(1);
    expect((await writer.post(`/api/policies/${doc.id}/copies`, { holder_name: 'X' })).status).toBe(409);
  });
});

describe('diagonal status mark (E43-16)', () => {
  it('prints the word diagonally on every page and keeps PDF/UA', async () => {
    const pdf = new PdfBuilder({ title: 'Invented procedure', mark: 'superseded' });
    pdf.paragraph('Invented text of a superseded version.');
    const file = await pdf.finish();
    expect(pdfText(file)).toContain('SUPERSEDED');
    expect((await checkPdfUa(file)).failures).toEqual([]);
    const plain = new PdfBuilder({ title: 'Invented procedure' });
    plain.paragraph('Invented text.');
    expect(pdfText(await plain.finish())).not.toContain('SUPERSEDED');
  });

  it('marks a printed draft text version DRAFT', async () => {
    const d = (await writer.post('/api/policies', { title: 'Invented draft rule' })).body;
    const v = (await writer.post(`/api/policies/${d.id}/versions`, { body: 'Draft text, invented.' })).body;
    const { createSession } = await import('../../core/auth.ts');
    const token = await createSession(t.db, writer.userId);
    const res = await t.app.inject({ method: 'GET', url: `/api/policies/${d.id}/versions/${v.id}/pdf`, headers: { cookie: `grc_session=${token}` } });
    expect(res.statusCode).toBe(200);
    const text = pdfText(res.rawPayload);
    expect(text.match(/DRAFT/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect((await checkPdfUa(res.rawPayload)).failures).toEqual([]);
  });
});

describe('loaded versions and copies on the Data loads page (E43-18)', () => {
  it('lists each loaded version and undoes one alone, putting the version before it back in force', async () => {
    const d = (await writer.post('/api/policies', { title: 'Invented loaded bulletin' })).body;
    await confirm();
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    const v1 = await t.api.post(`/api/policies/${d.id}/versions`, { body: 'One, invented.', status: 'superseded', version: 1, effective_on: '2020-01-01' });
    expect(v1.status, JSON.stringify(v1.body)).toBe(201);
    const v2 = await t.api.post(`/api/policies/${d.id}/versions`, { body: 'Two, invented.', status: 'published', version: 2, effective_on: '2022-01-01' });
    expect(v2.status, JSON.stringify(v2.body)).toBe(201);
    const copy = await t.api.post(`/api/policies/${d.id}/copies`, { holder_name: 'Invented binder', version_id: v1.body.id, issued_on: '2020-02-01', recalled_on: '2022-02-01' });
    expect(copy.status, JSON.stringify(copy.body)).toBe(201);
    expect(copy.body).toMatchObject({ issued_on: '2020-02-01', recalled_on: '2022-02-01' });

    const page = (await t.api.get('/api/admin/data-load')).body;
    const versions = page.loads.find((l: Row) => l.record_type === 'policy_version');
    expect(versions).toMatchObject({ label: 'Document versions', itemized: true, remaining: 2 });
    expect(page.loads.find((l: Row) => l.record_type === 'document_copy')).toMatchObject({ label: 'Paper copies', itemized: true });
    const items = (await t.api.get(`/api/admin/data-load/records?type=policy_version&day=${versions.day}`)).body;
    expect(items.rows).toHaveLength(2);
    expect(items.rows.map((r: Row) => r.label).join(' ')).toMatch(/version 2/);

    await confirm();
    const undo = await t.api.post('/api/admin/data-load/undo-one', { type: 'policy_version', id: v2.body.id });
    expect(undo.status, JSON.stringify(undo.body)).toBe(200);
    const left = (await t.api.get(`/api/policies/${d.id}/versions`)).body;
    expect(left.map((v: Row) => [v.version, v.status])).toEqual([[1, 'published']]);
    expect((await t.api.get(`/api/policies/${d.id}`)).body).toMatchObject({ status: 'published', current_version: 1 });
    // Undone already: 404; the page counts what is left.
    expect((await t.api.post('/api/admin/data-load/undo-one', { type: 'policy_version', id: v2.body.id })).status).toBe(404);
    expect((await t.api.get('/api/admin/data-load')).body.loads.find((l: Row) => l.record_type === 'policy_version').remaining).toBe(1);
    // The whole day of copies undoes through the same route as any load.
    const all = await t.api.post('/api/admin/data-load/undo', { type: 'document_copy', day: versions.day });
    expect(all.body).toEqual({ deleted: 1, held: 0, missing: 0 });
    expect((await t.api.get(`/api/policies/${d.id}/copies`)).body.rows).toEqual([]);
    await t.api.post('/api/admin/data-load', { on: false });
  });
});
