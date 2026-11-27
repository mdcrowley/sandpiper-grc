import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkPdfUa } from '../../core/export/pdfua.ts';
import { pdfText } from '../../core/export/testing.ts';
import type { ModuleDef } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { addDays } from '../../../../shared/dates.ts';
import { testApp } from '../../test/helpers.ts';
import { reviewStage, runDocumentDailyChecks } from './lifecycle.ts';
import { formatNumber, patternProblem } from './numbering.ts';
import { plainText, setSearchTextFromFile } from './search.ts';

// Document control (E43): distribution (who may read), figures, numbering, hierarchy, versions and
// their dates, reviews, groups, printing and data load. Invented data only.

const notified: any[] = [];
const standIn: ModuleDef = {
  key: 'docstandins',
  async register(ctx) {
    if (!ctx.app.hasDecorator('notify')) (ctx.app as any).decorate('notify', async (input: any) => { notified.push(input); return { sent: 1, skipped: 0 }; });
  },
};

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let controller: Client;  // policies.* (document controller)
let approver: Client;    // policies.* too: approves what the controller writes
let itEditor: Client;    // policies.view/create/edit, member of the IT department (scoped role)
let itReader: Client;    // policies.view, in the network team (below IT)
let hrReader: Client;    // policies.view, in HR
let groupie: Client;     // policies.view, member of a distribution group
let roleReader: Client;  // holds the role named in an access list
let plain: Client;       // signed in, no policy permission (a library reader)
let itDept: string; let net: string; let hr: string;
let sopId: string;

const loadMode = (on: boolean) => (on
  ? t.db.query(`insert into settings (key, value) values ('data_load.mode', $1::jsonb) on conflict (key) do update set value = excluded.value`,
    [JSON.stringify({ until: new Date(Date.now() + 86_400_000).toISOString() })])
  : t.db.query(`delete from settings where key = 'data_load.mode'`));

async function role(key: string, perms: string[], scopes: Record<string, string> = {}) {
  const r = await t.db.one<{ id: string }>(`insert into roles (key, name, enabled, scopes) values ($1, $2, true, $3::jsonb) returning id`, [key, `Invented ${key}`, JSON.stringify(scopes)]);
  for (const p of perms) await t.db.query('insert into role_permissions (role_id, permission) values ($1, $2)', [r!.id, p]);
}
const inDept = (c: Client, d: string) => t.db.query('update users set department_id = $1 where id = $2', [d, c.userId]);

/** Creates, approves and publishes a version (written by the controller, approved by the approver). */
async function publish(id: string, body = 'Invented text.', extra: Record<string, unknown> = {}) {
  const v = await controller.post(`/api/policies/${id}/versions`, { body, ...extra });
  expect(v.status, JSON.stringify(v.body)).toBe(201);
  expect((await approver.post(`/api/policies/${id}/versions/${v.body.id}/approve`, {})).status).toBe(200);
  const p = await approver.post(`/api/policies/${id}/versions/${v.body.id}/publish`, {});
  expect(p.status, JSON.stringify(p.body)).toBe(200);
  return { versionId: v.body.id as string, result: p.body };
}

beforeAll(async () => {
  process.env.GRC_MODULES = 'people,policies,attachments';
  t = await testApp({ extraModules: [standIn] });
  await role('doc_editor_it', ['policies.view', 'policies.create', 'policies.edit'], { policies: 'department' });
  await role('doc_reader', ['policies.view']);
  await role('night_shift', ['policies.view']);
  await role('no_docs', ['tickets.view']);
  controller = await t.as('security_lead');
  approver = await t.as('security_lead');
  itEditor = await t.as('doc_editor_it');
  itReader = await t.as('doc_reader');
  hrReader = await t.as('doc_reader');
  groupie = await t.as('doc_reader');
  roleReader = await t.as('night_shift');
  plain = await t.as('no_docs');
  itDept = (await t.db.one<{ id: string }>(`insert into departments (name) values ('Invented IT') returning id`))!.id;
  net = (await t.db.one<{ id: string }>(`insert into departments (name, parent_id) values ('Invented network team', $1) returning id`, [itDept]))!.id;
  hr = (await t.db.one<{ id: string }>(`insert into departments (name) values ('Invented HR') returning id`))!.id;
  await inDept(itEditor, itDept); await inDept(itReader, net); await inDept(hrReader, hr);
});
afterAll(async () => { delete process.env.GRC_MODULES; await t?.close(); });

describe('types, numbering and hierarchy', () => {
  it('offers the document types with tiers, prefixes and acknowledgment defaults', async () => {
    const list = (await t.api.get('/api/lookups/policy_document_type')).body as any[];
    expect(list.find((v) => v.value === 'sop').meta).toMatchObject({ tier: 3, prefix: 'SOP' });
    expect(list.find((v) => v.value === 'policy').meta).toMatchObject({ ack_default: true });
    expect(list.find((v) => v.value === 'reference').meta).toMatchObject({ uncontrolled: true });
  });

  it('checks and fills numbering patterns', () => {
    expect(patternProblem('{prefix}-{dept}-{seq:3}')).toBeNull();
    expect(patternProblem('{prefix}-{dept}')).toMatch(/seq/);
    expect(patternProblem('{prefix}-{bogus}-{seq}')).toBeTruthy();
    expect(formatNumber('{prefix}-{dept}-{seq:3}', { prefix: 'SOP', dept: 'IT', year: '2026', seq: 14 })).toBe('SOP-IT-014');
    expect(formatNumber('{prefix}-{dept}-{seq:3}', { prefix: 'POL', dept: '', year: '2026', seq: 2 })).toBe('POL-002');
  });

  it('numbers new documents by type and department code; only a controller sets a number by hand', async () => {
    const codes = await controller.put('/api/documents/department-codes', { codes: [{ department_id: itDept, code: 'it' }, { department_id: hr, code: 'HR' }] });
    expect(codes.status, JSON.stringify(codes.body)).toBe(200);
    expect(codes.body.find((c: any) => c.department_id === itDept).code).toBe('IT');
    expect((await controller.put('/api/documents/department-codes', { codes: [{ department_id: itDept, code: 'X X' }] })).status).toBe(400);
    const a = await controller.post('/api/policies', { title: 'Invented backup SOP', document_type: 'sop', owning_department_id: itDept });
    const b = await controller.post('/api/policies', { title: 'Invented restore SOP', document_type: 'sop', owning_department_id: itDept });
    expect(a.body.doc_number).toBe('SOP-IT-001');
    expect(b.body.doc_number).toBe('SOP-IT-002');
    expect(a.body.search_text).toBeUndefined(); // never returned
    const c = await controller.post('/api/policies', { title: 'Invented leave policy' });
    expect(c.body.doc_number).toBe('POL-001');
    // Typed by hand: unique, case-insensitive; editors cannot.
    expect((await controller.patch(`/api/policies/${b.body.id}`, { doc_number: 'sop-it-001' })).body.error.fields.doc_number).toMatch(/already/);
    const own = await itEditor.post('/api/policies', { title: 'Invented switch SOP', document_type: 'sop', owning_department_id: itDept, doc_number: 'SOP-IT-900' });
    expect(own.status).toBe(400);
    // The next number skips one already taken.
    expect((await controller.patch(`/api/policies/${b.body.id}`, { doc_number: 'SOP-IT-003' })).status).toBe(200);
    const d = await controller.post('/api/policies', { title: 'Invented patch SOP', document_type: 'sop', owning_department_id: itDept });
    expect(d.body.doc_number).toBe('SOP-IT-004');
    // Assign again on request; refused without replace.
    expect((await controller.post(`/api/policies/${d.body.id}/number`, {})).body.error.code).toBe('has_number');
    expect((await controller.post(`/api/policies/${d.body.id}/number`, { replace: true })).body.doc_number).toBe('SOP-IT-005');
    expect((await itEditor.post(`/api/policies/${d.body.id}/number`, { replace: true })).status).toBe(403);
    // Pattern setting.
    expect((await controller.put('/api/documents/numbering', { pattern: 'no seq' })).status).toBe(400);
    expect((await controller.get('/api/documents/numbering')).body.pattern).toBe('{prefix}-{dept}-{seq:3}');
  });

  it('keeps the hierarchy free of cycles and counts children a person cannot read', async () => {
    const pol = (await controller.post('/api/policies', { title: 'Invented information security policy' })).body;
    const std = (await controller.post('/api/policies', { title: 'Invented password standard', document_type: 'standard', parent_id: pol.id })).body;
    const sop = (await controller.post('/api/policies', {
      title: 'Invented account unlock SOP', document_type: 'sop', parent_id: std.id, access: 'restricted', access_departments: [itDept],
    })).body;
    expect((await controller.patch(`/api/policies/${pol.id}`, { parent_id: sop.id })).body.error.fields.parent_id).toMatch(/below/);
    expect((await controller.patch(`/api/policies/${pol.id}`, { parent_id: pol.id })).status).toBe(400);
    await publish(pol.id); await publish(std.id); await publish(sop.id);
    const mine = await itReader.get(`/api/policies/${std.id}/hierarchy`);
    expect(mine.body.ancestors.map((a: any) => a.id)).toEqual([pol.id]);
    expect(mine.body.children.map((c: any) => c.id)).toEqual([sop.id]);
    const theirs = await hrReader.get(`/api/policies/${std.id}/hierarchy`);
    expect(theirs.body.children).toEqual([]);
    expect(theirs.body.hidden_children).toBe(1);
    // A tier above its parent is a warning, not a block.
    const odd = (await controller.post('/api/policies', { title: 'Invented odd policy', parent_id: sop.id })).body;
    expect(odd.id).toBeTruthy();
    expect((await controller.get(`/api/policies/${odd.id}/hierarchy`)).body.tier_warning).toBeTruthy();
  });
});

describe('controlled distribution', () => {
  let groupId: string;
  it('manages distribution groups (controllers only)', async () => {
    expect((await itEditor.post('/api/documents/groups', { name: 'Invented on-call' })).status).toBe(403);
    const g = await controller.post('/api/documents/groups', { name: 'Invented on-call', members: [groupie.userId], description: 'Network on-call' });
    expect(g.status, JSON.stringify(g.body)).toBe(201);
    expect(g.body.members.map((m: any) => m.user_id)).toEqual([groupie.userId]);
    groupId = g.body.id;
    expect((await controller.post('/api/documents/groups', { name: 'invented ON-CALL' })).status).toBe(400);
    expect((await itEditor.get('/api/documents/groups')).body.map((x: any) => x.name)).toContain('Invented on-call');
    expect((await hrReader.get('/api/documents/groups')).status).toBe(403);
  });

  it('shows a restricted SOP only to its readers, everywhere', async () => {
    const sop = await controller.post('/api/policies', {
      title: 'Invented firewall zebra SOP', document_type: 'sop', owning_department_id: itDept, owner_id: approver.userId,
      access: 'restricted', access_departments: [itDept], access_groups: [groupId], access_roles: ['night_shift'],
    });
    expect(sop.status, JSON.stringify(sop.body)).toBe(201);
    sopId = sop.body.id;
    await publish(sopId, 'Rotate the zebra keys every quarter.');
    for (const c of [itReader, groupie, controller]) {
      expect((await c.get(`/api/policies/${sopId}`)).status).toBe(200);
      expect((await c.get('/api/policies?q=zebra')).body.total).toBe(1);
    }
    expect((await roleReader.get(`/api/policies/${sopId}`)).status).toBe(200);
    expect((await hrReader.get(`/api/policies/${sopId}`)).status).toBe(404);
    expect((await hrReader.get('/api/policies?q=zebra')).body.total).toBe(0);
    expect((await hrReader.get(`/api/policies/${sopId}/versions`)).status).toBe(404);
    expect((await hrReader.get(`/api/policies/${sopId}/hierarchy`)).status).toBe(404);
    // Global search, by title and by words of the text.
    const hits = async (c: Client, q: string) => ((await c.get(`/api/search?q=${q}`)).body as any[]).filter((h) => h.type === 'policy').length;
    expect(await hits(itReader, 'zebra')).toBe(1);
    expect(await hits(hrReader, 'zebra')).toBe(0);
    // The library (every signed-in person, no permission needed).
    expect((await plain.get('/api/documents/library?q=zebra')).body.total).toBe(0);
    expect((await plain.get(`/api/documents/library/${sopId}`)).status).toBe(404);
    const lib = await itReader.get('/api/documents/library?q=quarter');
    expect(lib.body.rows.map((r: any) => r.id)).toEqual([sopId]);
    expect(lib.body.rows[0]).toMatchObject({ restricted: true, doc_number: expect.stringMatching(/^SOP-IT-/) });
    expect(lib.body.rows[0].excerpt).toContain('quarter');
    expect((await itReader.get(`/api/documents/library/${sopId}`)).body.version.body).toContain('zebra');
    // CSV export of the register.
    const csv = await controller.get('/api/policies?format=csv');
    expect(csv.text).toContain('zebra');
    const hrCsv = await t.api.get('/api/policies?format=csv');
    expect(hrCsv.status).toBe(200);
  });

  it('gives the same figures to everyone, masking restricted titles and owners', async () => {
    const a = (await hrReader.get('/api/policies/stats?group=document_type')).body;
    const b = (await itReader.get('/api/policies/stats?group=document_type')).body;
    expect(a.total).toBe(b.total);
    expect(a.groups.find((g: any) => g.value === 'sop').count).toBe(b.groups.find((g: any) => g.value === 'sop').count);
    const owners = (await hrReader.get('/api/policies/stats?group=owner_id')).body;
    expect(owners.groups.some((g: any) => g.restricted)).toBe(true);
    expect(JSON.stringify(owners)).not.toContain(approver.userId);
    const s1 = (await hrReader.get('/api/documents/summary')).body;
    const s2 = (await controller.get('/api/documents/summary')).body;
    expect(s1).toEqual(s2);
  });

  it('limits a department-scoped editor to their department in the register, not in the library', async () => {
    const hrPolicy = (await controller.post('/api/policies', { title: 'Invented leave rules', owning_department_id: hr })).body;
    await publish(hrPolicy.id);
    expect((await itEditor.get(`/api/policies/${hrPolicy.id}`)).status).toBe(404);
    expect((await itEditor.get(`/api/documents/library/${hrPolicy.id}`)).status).toBe(200);
    expect((await itEditor.get(`/api/policies/${sopId}`)).status).toBe(200);
  });

  it('only the owner or a controller changes access; the audience must lie inside; narrowing closes requests', async () => {
    expect((await itEditor.put(`/api/policies/${sopId}/access`, { access: 'organization' })).status).toBe(403);
    const before = await controller.get(`/api/policies/${sopId}/access`);
    expect(before.body.groups.map((g: any) => g.id)).toEqual([groupId]);
    expect(before.body.reader_count).toBeGreaterThanOrEqual(4);
    // Everyone cannot be asked to acknowledge a restricted document; nor a department outside it.
    const bad = await controller.patch(`/api/policies/${sopId}`, { audience_everyone: true, ack_required: true });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('audience_outside');
    expect((await controller.patch(`/api/policies/${sopId}`, { audience_departments: [hr], ack_required: true })).body.error.code).toBe('audience_outside');
    // Inside: the network team sits below IT.
    expect((await controller.patch(`/api/policies/${sopId}`, { audience_departments: [net], audience_roles: ['night_shift'], ack_required: true })).status).toBe(200);
    const { result } = await publish(sopId, 'Rotate the zebra keys every month.');
    expect(result.requested).toBe(2); // the network-team reader and the night-shift role holder
    // A live count while editing.
    expect((await controller.post('/api/documents/readers/count', { access: 'restricted', access_users: [hrReader.userId] })).body.count).toBeGreaterThanOrEqual(2);
    // Narrowing: the role is taken out, so its holder's request closes (and the audience must follow).
    const narrowed = await controller.put(`/api/policies/${sopId}/access`, { access_roles: [] });
    expect(narrowed.body.error?.code).toBe('audience_outside');
    await controller.patch(`/api/policies/${sopId}`, { audience_roles: [] });
    const ok = await controller.put(`/api/policies/${sopId}/access`, { access_roles: [] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.closed).toBe(1);
    expect((await roleReader.get('/api/policies/acknowledgments/mine')).body.awaiting).toEqual([]);
    expect((await itReader.get('/api/policies/acknowledgments/mine')).body.awaiting.length).toBe(1);
    const events = await t.db.query<any>(`select * from audit_events where action = 'policy.access_change' and record_id = $1`, [sopId]);
    expect(events.length).toBe(1);
    // Removing a group member takes their reading away.
    expect((await controller.del(`/api/documents/groups/${groupId}/members/${groupie.userId}`)).status).toBe(200);
    expect((await groupie.get(`/api/policies/${sopId}`)).status).toBe(404);
    expect((await controller.del(`/api/documents/groups/${groupId}`)).body.error.code).toBe('in_use');
  });
});

describe('versions, dates and obsolete documents', () => {
  let docId: string;
  it('switches to a version approved with a future effective date on that date', async () => {
    docId = (await controller.post('/api/policies', { title: 'Invented radio procedure', document_type: 'procedure', audience_everyone: true, ack_required: true })).body.id;
    const first = await publish(docId, 'First text.');
    const v2 = await controller.post(`/api/policies/${docId}/versions`, { body: 'Second text.', version_label: 'Rev. B' });
    await approver.post(`/api/policies/${docId}/versions/${v2.body.id}/approve`, { approval_body: 'Invented board', approval_reference: 'Resolution 01' });
    const later = addDays(dayInZone(), 10);
    const sched = await approver.post(`/api/policies/${docId}/versions/${v2.body.id}/publish`, { effective_on: later });
    expect(sched.body).toMatchObject({ scheduled: true, requested: 0 });
    let versions = (await controller.get(`/api/policies/${docId}/versions`)).body;
    expect(versions.find((v: any) => v.id === first.versionId).status).toBe('published');
    expect((await plain.get(`/api/documents/library/${docId}`)).body.banner.kind).toBe('scheduled');
    // Not yet.
    expect((await runDocumentDailyChecks(ctxOf())).published).toBe(0);
    const run = await runDocumentDailyChecks(ctxOf(), undefined, new Date(Date.now() + 11 * 86_400_000));
    expect(run.published).toBe(1);
    versions = (await controller.get(`/api/policies/${docId}/versions`)).body;
    const old = versions.find((v: any) => v.id === first.versionId);
    expect(old.status).toBe('superseded');
    expect(old.superseded_on).toBe(later);
    const now = versions.find((v: any) => v.id === v2.body.id);
    expect(now).toMatchObject({ status: 'published', version_label: 'Rev. B', approval_body: 'Invented board', approval_reference: 'Resolution 01' });
    expect(now.body_sha256).toMatch(/^[0-9a-f]{64}$/);
    // The superseded version is still readable, with its banner.
    const read = await plain.get(`/api/documents/library/${docId}?version=1`);
    expect(read.body.banner.kind).toBe('superseded');
  });

  it('publishes a minor version without new acknowledgment requests', async () => {
    const asked = (await t.db.one<{ n: number }>('select count(*)::int as n from policy_acknowledgements where policy_id = $1 and superseded_at is null and acknowledged_at is null', [docId]))!.n;
    expect(asked).toBeGreaterThan(0);
    const v = await controller.post(`/api/policies/${docId}/versions`, { body: 'Second text, typo fixed.' });
    await approver.post(`/api/policies/${docId}/versions/${v.body.id}/approve`, {});
    const p = await approver.post(`/api/policies/${docId}/versions/${v.body.id}/publish`, { minor: true });
    expect(p.body.requested).toBe(0);
    const open = await t.db.query<any>('select version_id from policy_acknowledgements where policy_id = $1 and superseded_at is null and acknowledged_at is null', [docId]);
    expect(open.length).toBe(asked);
    expect(open.every((o) => o.version_id === v.body.id)).toBe(true);
  });

  it('keeps a file version with no text, and gives its original only to editors', async () => {
    const att = (await t.db.one<{ id: string }>(
      `insert into attachments (record_type, record_id, file_name, extension, content_type, size_bytes, sha256, storage_key)
       values ('policy', $1, 'invented.pdf', 'pdf', 'application/pdf', 10, 'x', $2) returning id`, [docId, `aa/bb/${'c'.repeat(32)}`]).catch(() => null));
    expect(att).toBeTruthy();
    if (!att) return;
    const v = await controller.post(`/api/policies/${docId}/versions`, { content_kind: 'file', attachment_id: att.id, body: '' });
    expect(v.status, JSON.stringify(v.body)).toBe(201);
    expect(v.body).toMatchObject({ content_kind: 'file', source_attachment_id: att.id });
    // A file version needs its file; a Markdown version needs text.
    expect((await controller.patch(`/api/policies/${docId}/versions/${v.body.id}`, { content_kind: 'markdown' })).status).toBe(400);
    // The original: editors only (a redirect to the file's download), audited.
    const orig = await controller.get(`/api/policies/${docId}/versions/${v.body.id}/original`);
    expect(orig.status).toBe(302);
    expect((await hrReader.get(`/api/policies/${docId}/versions/${v.body.id}/original`)).status).toBe(403);
    expect((await t.db.query(`select 1 from audit_events where action = 'policy.original_download' and record_id = $1`, [docId])).length).toBe(1);
    // Discard the draft so later tests can start versions.
    expect((await controller.del(`/api/policies/${docId}/versions/${v.body.id}`)).status).toBe(200);
  });

  it('prints a controlled copy with the control block, tagged PDF/UA, and audits it', async () => {
    const versions = (await controller.get(`/api/policies/${docId}/versions`)).body;
    const superseded = versions.find((v: any) => v.status === 'superseded');
    const res = await t.app.inject({ method: 'GET', url: `/api/policies/${docId}/versions/${superseded.id}/pdf`, headers: { cookie: '' } });
    expect(res.statusCode).toBe(401);
    const pdf = await plainPdf(`/api/policies/${docId}/versions/${superseded.id}/pdf`);
    const text = pdfText(pdf);
    expect(text).toContain('SUPERSEDED');
    expect(text).toContain('Uncontrolled when printed');
    expect((await checkPdfUa(pdf)).failures).toEqual([]);
    expect((await t.db.query(`select 1 from audit_events where action = 'policy.print' and record_id = $1`, [docId])).length).toBe(1);
    // Drafts are not printed for readers; the restricted SOP not for outsiders.
    expect((await hrReader.get(`/api/policies/${sopId}/versions/${superseded.id}/pdf`)).status).toBe(404);
  });

  it('makes a document obsolete: withdraws the effective version, records reason and replacement, lists children', async () => {
    const parent = (await controller.post('/api/policies', { title: 'Invented old fleet policy' })).body;
    await publish(parent.id);
    const child = (await controller.post('/api/policies', { title: 'Invented old fleet SOP', document_type: 'sop', parent_id: parent.id })).body;
    const replacement = (await controller.post('/api/policies', { title: 'Invented new fleet policy' })).body;
    const r = await approver.post(`/api/policies/${parent.id}/retire`, { reason: 'Replaced by the new policy.', replaced_by_id: replacement.id });
    expect(r.body).toMatchObject({ status: 'retired', children: [{ id: child.id }], hidden_children: 0 });
    const doc = (await controller.get(`/api/policies/${parent.id}`)).body;
    expect(doc).toMatchObject({ status: 'retired', retire_reason: 'Replaced by the new policy.', replaced_by_id: replacement.id, retired_on: dayInZone() });
    const v = (await controller.get(`/api/policies/${parent.id}/versions`)).body[0];
    expect(v).toMatchObject({ status: 'withdrawn', withdrawn_on: dayInZone() });
    expect((await plain.get('/api/documents/library?q=old fleet policy')).body.total).toBe(0);
    expect((await plain.get('/api/documents/library?q=old fleet policy&include_obsolete=1')).body.total).toBe(1);
    expect((await plain.get(`/api/documents/library/${parent.id}`)).body.banner.kind).toBe('obsolete');
  });
});

describe('reviews and reminders', () => {
  it('records a review with no change and moves the next review date', async () => {
    const id = (await controller.post('/api/policies', { title: 'Invented fare policy', review_months: 12 })).body.id;
    await publish(id);
    const today = dayInZone();
    const r = await controller.post(`/api/policies/${id}/reviews`, { result: 'no_change', note: 'Still right.' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.next_review_on.slice(0, 4)).toBe(String(Number(today.slice(0, 4)) + 1));
    const doc = (await controller.get(`/api/policies/${id}`)).body;
    expect(doc.last_reviewed_on).toBe(today);
    expect((await controller.get(`/api/policies/${id}/reviews`)).body[0]).toMatchObject({ kind: 'periodic', result: 'no_change' });
    expect((await controller.get(`/api/policies/${id}/versions`)).body[0].reviewed_no_change_on).toBe(today);
    // Revise opens a draft from the effective text.
    const rev = await controller.post(`/api/policies/${id}/reviews`, { result: 'revise' });
    expect(rev.body.version.status).toBe('draft');
    expect((await hrReader.post(`/api/policies/${id}/reviews`, { result: 'no_change' })).status).toBe(403);
    // A department-scoped editor does not even find a document outside their departments.
    expect((await itEditor.post(`/api/policies/${id}/reviews`, { result: 'retire' })).status).toBe(404);
    const editorOnly = await t.as('doc_reader');
    await t.db.query(`insert into role_permissions (role_id, permission) select id, 'policies.edit' from roles where key = 'doc_reader' on conflict do nothing`);
    expect((await editorOnly.post(`/api/policies/${id}/reviews`, { result: 'retire' })).status).toBe(403);
    await t.db.query(`delete from role_permissions where permission = 'policies.edit' and role_id = (select id from roles where key = 'doc_reader')`);
  });

  it('reminds at 60 and 30 days, on the day, then weekly', async () => {
    expect(reviewStage('2026-03-02', '2026-01-01')).toBe('60');
    expect(reviewStage('2026-01-31', '2026-01-01')).toBe('30');
    expect(reviewStage('2026-01-01', '2026-01-01')).toBe('due');
    expect(reviewStage('2025-12-25', '2026-01-01')).toBe('overdue-7');
    expect(reviewStage('2026-01-02', '2026-01-01')).toBeNull();
    const id = (await controller.post('/api/policies', { title: 'Invented depot procedure', document_type: 'procedure', owner_id: itReader.userId })).body.id;
    await publish(id);
    await t.db.query('update policies set review_date = $2 where id = $1', [id, addDays(dayInZone(), 30)]);
    notified.length = 0;
    await runDocumentDailyChecks(ctxOf());
    const mine = notified.filter((n) => n.recordId === id);
    expect(mine.length).toBe(1);
    expect(mine[0].userIds).toEqual([itReader.userId]);
  });

  it('offers the figures as metrics', async () => {
    const res = await t.api.get(`/api/metrics?month=${dayInZone().slice(0, 7)}`);
    const keys = (res.body.metrics ?? res.body).map((m: any) => m.key);
    expect(keys).toEqual(expect.arrayContaining(['policies.reviews_overdue', 'policies.reviews_due_90', 'policies.ack_completion_pct', 'policies.documents_without_owner']));
  });
});

describe('search text', () => {
  it('reduces Markdown to plain text', () => {
    expect(plainText('## Purpose\n\n**Bold** [link](https://example.test) ![img](x.png)\n\n| a | b |\n|---|---|\n| 1 | 2 |')).toBe('Purpose\nBold link img\na b\n1 2');
  });
  it('refreshes documents whose original is a given file (for the text job)', async () => {
    expect(await setSearchTextFromFile(ctxOf(), '00000000-0000-4000-8000-000000000000')).toBe(0);
  });
});

describe('data load mode', () => {
  it('loads a version history out of order, with its own numbers, statuses and dates, asking nobody', async () => {
    await loadMode(true);
    notified.length = 0;
    const doc = await t.api.post('/api/policies', {
      title: 'Invented historical safety policy', doc_number: 'HIST-7', audience_everyone: true, ack_required: true,
    });
    expect(doc.status, JSON.stringify(doc.body)).toBe(201);
    expect(doc.body.doc_number).toBe('HIST-7');
    const id = doc.body.id;
    const v3 = await t.api.post(`/api/policies/${id}/versions`, { version: 3, version_label: '2021-1', status: 'published', body: 'Third.', approved_on: '2021-02-01', effective_on: '2021-03-01', approved_by_name: 'Invented Board' });
    expect(v3.status, JSON.stringify(v3.body)).toBe(201);
    const v1 = await t.api.post(`/api/policies/${id}/versions`, { version: 1, status: 'superseded', body: 'First.', effective_on: '2015-01-01' });
    const v2 = await t.api.post(`/api/policies/${id}/versions`, { version: 2, status: 'published', body: 'Second.', effective_on: '2018-06-01' });
    expect(v1.status).toBe(201); expect(v2.status).toBe(201);
    const versions = (await t.api.get(`/api/policies/${id}/versions`)).body as any[];
    const by = (n: number) => versions.find((v) => v.version === n);
    expect(by(3)).toMatchObject({ status: 'published', version_label: '2021-1', effective_on: '2021-03-01' });
    expect(by(2)).toMatchObject({ status: 'superseded', superseded_on: '2021-03-01' });
    expect(by(1)).toMatchObject({ status: 'superseded', superseded_on: '2018-06-01' });
    const after = (await t.api.get(`/api/policies/${id}`)).body;
    expect(after).toMatchObject({ status: 'published', current_version: 3 });
    expect((await t.db.one<{ n: number }>('select count(*)::int as n from policy_acknowledgements where policy_id = $1', [id]))!.n).toBe(0);
    expect(notified.length).toBe(0);
    // A reviewed history and a withdrawn newest version make the document obsolete.
    expect((await t.api.post(`/api/policies/${id}/reviews`, { result: 'no_change', reviewed_on: '2022-03-01' })).status).toBe(201);
    const w = await t.api.post(`/api/policies/${id}/versions`, { version: 4, status: 'withdrawn', body: 'Fourth.', effective_on: '2023-01-01', withdrawn_on: '2024-01-01' });
    expect(w.status).toBe(201);
    // The publish route, in a load: no requests.
    const d2 = (await t.api.post('/api/policies', { title: 'Invented loaded bulletin', document_type: 'bulletin', audience_everyone: true })).body;
    const dv = (await t.api.post(`/api/policies/${d2.id}/versions`, { body: 'x', status: 'approved', approved_on: '2020-01-01' })).body;
    const pub = await t.api.post(`/api/policies/${d2.id}/versions/${dv.id}/publish`, { effective_on: '2020-02-01' });
    expect(pub.body).toMatchObject({ requested: 0, status: 'published' });
    expect((await t.db.query('select 1 from data_load_records where record_type = $1 and record_id = $2', ['policy', id])).length).toBe(1);
    await loadMode(false);
    // Outside a load the version number and status cannot be chosen, and history numbers are kept.
    expect((await t.api.post('/api/policies', { title: 'Invented duplicate', doc_number: 'hist-7' })).status).toBe(400);
  });
});

// ---------- helpers ----------

function ctxOf() {
  return t.ctx;
}

async function plainPdf(url: string): Promise<Buffer> {
  const { createSession } = await import('../../core/auth.ts');
  const token = await createSession(t.db, plain.userId);
  const res = await t.app.inject({ method: 'GET', url, headers: { cookie: `grc_session=${token}` } });
  expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
  return res.rawPayload;
}
