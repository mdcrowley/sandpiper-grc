import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, SESSION_COOKIE } from './auth.ts';
import type { ModuleDef } from './module.ts';
import { ANONYMIZED_TEXT, isPersonal, onAnonymize, personalFields } from './retention.ts';
import { testApp } from '../test/helpers.ts';

// Anonymizing a record at the end of its retention period (E14-19), with an invented record type.
const fixtures: ModuleDef = {
  key: 'testretention',
  async seedDefaults(ctx) {
    await ctx.db.exec(`
      create table if not exists test_visits (
        id uuid primary key default gen_random_uuid(), ref text, title text not null, notes text,
        visitor_name text, visitor_email text, host_name text, badge_number text, passengers int,
        owner_id uuid, status text, restricted boolean not null default false,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
  },
  async register(ctx) {
    if (!ctx.app.hasDecorator('notify')) (ctx.app as any).decorate('notify', async () => ({ sent: 1, skipped: 0 }));
    ctx.defineResource({
      type: 'visit', table: 'test_visits', module: 'tickets', label: 'Visit', plural: 'Visits',
      path: '/api/visits', route: '/visits', titleField: 'title', ref: { field: 'ref', prefix: 'V-' }, restricted: 'flag',
      searchable: ['title', 'notes', 'visitor_name'],
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true },
        title: { label: 'Title', type: 'text', required: true },
        notes: { label: 'Notes', type: 'longtext' },
        visitor_name: { label: 'Visitor', type: 'text' },
        visitor_email: { label: 'Visitor email', type: 'text' },
        host_name: { label: 'Host computer', type: 'text' },
        badge_number: { label: 'Badge', type: 'text', personal: true },
        passengers: { label: 'Passengers', type: 'number' },
        owner_id: { label: 'Owner', type: 'user' },
        status: { label: 'Status', type: 'text', personal: false },
        restricted: { label: 'Restricted', type: 'boolean', default: false },
      },
    });
  },
};

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj\n<< /Type /Catalog >>\nendobj\n', 'latin1'), Buffer.alloc(300, 0x20)]);

let t: Awaited<ReturnType<typeof testApp>>;
let adminId = '';
// A module's own tables about a record are cleared in the same transaction (E25-15).
const hooked: string[] = [];
onAnonymize('visit', async (tx, id) => { await tx.query('select 1'); hooked.push(id); });
const audited = async (action: string) => t.db.query<any>('select * from audit_events where action = $1 order by id', [action]);
const confirmNow = () => t.db.query(`update sessions set confirmed_at = now() where user_id = $1`, [adminId]);

beforeAll(async () => {
  t = await testApp({ extraModules: [fixtures] });
  adminId = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
});
afterAll(async () => { await t.close(); });

describe('personal fields', () => {
  it('defaults to people, long text and contact details, and follows the flag', () => {
    const def = t.core.resources.registry.get('visit')!;
    expect(personalFields(def).sort()).toEqual(['badge_number', 'notes', 'owner_id', 'visitor_email', 'visitor_name']);
    expect(isPersonal('requester_phone', { label: 'x', type: 'text' })).toBe(true);
    expect(isPersonal('vendor_name', { label: 'x', type: 'text' })).toBe(false);
    expect(isPersonal('notes', { label: 'x', type: 'longtext', personal: false })).toBe(false);
  });
});

describe('anonymizing at the end of the retention period', () => {
  let visit = '';
  let other = '';
  let review: any;
  beforeAll(async () => {
    visit = (await t.api.post('/api/visits', {
      title: 'Depot tour', notes: 'Visitor asked about step-free access', visitor_name: 'Pat Example', visitor_email: 'pat@example.test',
      host_name: 'depot-kiosk-01', badge_number: 'B-1234', passengers: 12, owner_id: adminId, status: 'closed',
    })).body.id;
    other = (await t.api.post('/api/visits', { title: 'Garage visit', visitor_name: 'Sam Sample', passengers: 3 })).body.id;
    await t.db.query(`update test_visits set updated_at = now() - interval '40 months' where id = any($1::uuid[])`, [[visit, other]]);
    await t.api.post('/api/comments', { record_type: 'visit', record_id: visit, body: 'Pat called back on 555-0100.' });
    await t.db.query(`insert into notifications (user_id, kind, title, body, record_type, record_id) values ($1, 'general', 'Pat Example is waiting at the gate', 'Badge B-1234', 'visit', $2)`, [adminId, visit]);
    const token = await createSession(t.db, adminId);
    const up = await t.app.inject({
      method: 'PUT', url: `/api/attachments/upload?${new URLSearchParams({ record_type: 'visit', record_id: visit, name: 'Pat Example consent.pdf', description: 'Signed by Pat' })}`,
      headers: { cookie: `${SESSION_COOKIE}=${token}`, 'x-grc-csrf': '1', 'content-type': 'application/octet-stream' }, payload: PDF,
    });
    expect(up.statusCode).toBe(201);
    expect((await t.api.put('/api/admin/retention/visit', { periodMonths: 24, disposal: 'keep' })).status).toBe(200);
    await t.core.retention.sweep();
    review = (await t.api.get('/api/admin/retention/reviews?record_type=visit')).body.rows.find((r: any) => r.record_id === visit);
    expect(review).toBeTruthy();
  });

  it('holds what the review may do per record type', async () => {
    const types = (await t.api.get('/api/admin/retention')).body;
    expect(types.disposals).toEqual(['keep', 'anonymize', 'delete']);
    const v = types.types.find((x: any) => x.type === 'visit');
    expect(v).toMatchObject({ disposal: 'keep' });
    expect(v.personalFields).toContain('Visitor email');
    expect((await t.api.put('/api/admin/retention/visit', { periodMonths: 24, disposal: 'shred' })).body.error.fields.disposal).toBeTruthy();
    expect((await audited('retention.policy')).at(-1).summary).toMatch(/only keeping longer/);
  });

  it('refuses what the policy does not allow', async () => {
    const url = `/api/admin/retention/reviews/${review.id}/anonymize`;
    await confirmNow();
    expect((await t.api.post(url, { reason: 'End of schedule.', confirm: true })).body.error.code).toBe('not_allowed');
    await t.api.put('/api/admin/retention/visit', { periodMonths: 24, disposal: 'anonymize' });
    expect((await t.api.post(`/api/admin/retention/reviews/${review.id}/delete`, { reason: 'End of schedule.', confirm: true })).body.error.code).toBe('not_allowed');
  });

  it('asks for a reason, a confirmation and a recent identity confirmation', async () => {
    const url = `/api/admin/retention/reviews/${review.id}/anonymize`;
    expect((await (await t.as('agent')).post(url, { reason: 'End of schedule.', confirm: true })).status).toBe(403);
    expect((await t.api.post(url, { reason: 'End of schedule.' })).body.error.fields.confirm).toBeTruthy();
    expect((await t.api.post(url, { confirm: true })).body.error.fields.reason).toBeTruthy();
    await t.db.query(`update sessions set confirmed_at = now() - interval '11 minutes' where user_id = $1`, [adminId]);
    expect((await t.api.post(url, { reason: 'End of schedule.', confirm: true })).body.error.code).toBe('reauth_required');
  });

  it('replaces the personal details and keeps the shape and figures', async () => {
    const statsBefore = (await t.api.get('/api/visits/stats?group=status')).body;
    const auditBefore = (await t.db.one<{ c: number }>('select count(*)::int c from audit_events where record_id = $1', [visit]))!.c;
    const oldSummaries = (await t.db.query<any>('select summary, after from audit_events where record_id = $1 order by id', [visit])).map((e) => JSON.stringify(e));
    await confirmNow();
    const done = await t.api.post(`/api/admin/retention/reviews/${review.id}/anonymize`, { reason: 'Schedule item 4.2 allows disposal.', confirm: true });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: 'anonymized', anonymized: { comments: 1, files: 1 } });
    expect(hooked).toContain(visit);

    const row = await t.db.one<any>('select * from test_visits where id = $1', [visit]);
    expect(row).toMatchObject({
      title: 'Depot tour', notes: ANONYMIZED_TEXT, visitor_name: ANONYMIZED_TEXT, visitor_email: ANONYMIZED_TEXT, badge_number: ANONYMIZED_TEXT,
      host_name: 'depot-kiosk-01', passengers: 12, status: 'closed', owner_id: null, created_by: null, updated_by: null,
    });
    expect(row.ref).toMatch(/^V-/);
    // The record is still there, counted the same way.
    expect((await t.api.get('/api/visits/stats?group=status')).body.total).toBe(statsBefore.total);
    expect((await t.api.get(`/api/visits/${visit}`)).status).toBe(200);

    const comments = await t.db.query<any>(`select * from comments where record_type = 'visit' and record_id = $1`, [visit]);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ body: ANONYMIZED_TEXT, author_id: null, author_name: null });

    const files = await t.db.query<any>(`select * from attachments where record_type = 'visit' and record_id = $1`, [visit]);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ file_name: 'Removed file.pdf', description: null, uploaded_by_name: null, removed_reason: 'anonymized' });
    expect(files[0].purged_at).toBeTruthy();
    const note = await t.db.one<any>(`select title, body from notifications where record_type = 'visit' and record_id = $1`, [visit]);
    expect(note).toMatchObject({ title: 'Visit (details removed at the end of its retention period)', body: null });

    // Search no longer finds the person, in the record or its comments.
    expect((await t.api.get('/api/visits?q=Pat')).body.rows.map((r: any) => r.id)).not.toContain(visit);
    expect((await t.api.get('/api/visits?q=Depot')).body.rows.map((r: any) => r.id)).toContain(visit);

    // The audit log is append-only: what was there stays, and one event is added.
    const after = await t.db.query<any>('select summary, after from audit_events where record_id = $1 order by id', [visit]);
    expect(after.slice(0, oldSummaries.length).map((e) => JSON.stringify(e))).toEqual(oldSummaries);
    expect(after.length).toBeGreaterThan(auditBefore);
    const ev = (await audited('retention.anonymize')).at(-1);
    expect(ev).toMatchObject({ record_type: 'visit', record_id: visit, actor_name: 'Test Admin' });
    expect(ev.summary).toMatch(new RegExp(`${row.ref} anonymized.*1 comment, 1 file.*Schedule item 4.2`));
    expect(ev.summary).not.toMatch(/Pat/);

    // Decided once; listed under its own status; the other record is untouched.
    expect((await t.api.post(`/api/admin/retention/reviews/${review.id}/anonymize`, { reason: 'Again, please.', confirm: true })).status).toBe(404);
    expect((await t.api.get('/api/admin/retention/reviews?status=anonymized')).body.rows[0]).toMatchObject({ record_id: visit, status: 'anonymized', label: 'Depot tour' });
    expect((await t.db.one<any>('select visitor_name from test_visits where id = $1', [other])).visitor_name).toBe('Sam Sample');
    expect((await t.core.retention.sweep()).byType.visit).toBeUndefined();
  });
});

describe('evidence links (E36-05)', () => {
  it('anonymizing blanks a link\'s address, title and checker, and deletes no stored bytes', async () => {
    const visit = (await t.api.post('/api/visits', { title: 'Linked visit', visitor_name: 'Lee Example' })).body.id;
    const link = await t.api.post('/api/attachments/link', { record_type: 'visit', record_id: visit, url: 'https://docs.example.test/lee-statement', title: 'Statement by Lee Example' });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    await t.db.query('update attachments set checked_by = $2, last_checked_on = current_date where id = $1', [link.body.id, adminId]);
    await t.core.retention.anonymize(t.core.resources.registry.get('visit')!, visit);
    const row = await t.db.one<any>('select link_url, link_title, checked_by, storage_driver, removed_reason from attachments where id = $1', [link.body.id]);
    expect(row).toMatchObject({ link_url: null, link_title: null, checked_by: null, storage_driver: 'link', removed_reason: 'anonymized' });
  });
});
