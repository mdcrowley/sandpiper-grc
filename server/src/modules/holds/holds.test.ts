import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, SESSION_COOKIE } from '../../core/auth.ts';
import { approvalEngine } from '../../core/approval-kinds.ts';
import { holdsOn } from '../../core/holds.ts';
import { ADMIN, testApp } from '../../test/helpers.ts';
import { purgeRemoved } from '../attachments/housekeeping.ts';
import { RELEASE_KIND } from './index.ts';
import { placeHold } from './service.ts';

// Legal holds (E34-01, E34-02): every destructive path that core and the modules wired in step 0 of
// wave 11 refuses a held record, one test per path; holds survive any area being switched off; a
// saved query holds restricted records too; release goes through approval or legal.approve.

let t: Awaited<ReturnType<typeof testApp>>;
let adminId = '';
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj\n<< /Type /Catalog >>\nendobj\n', 'latin1'), Buffer.alloc(300, 0x20)]);
const confirm = () => t.api.post('/api/auth/confirm', { password: ADMIN.password });
const hold = async (matter: string) => (await t.api.post('/api/legal-holds', { matter })).body;
const system = async (name: string) => (await t.api.post('/api/systems', { name })).body;
const place = async (holdId: string, type: string, id: string) => t.api.post(`/api/legal-holds/${holdId}/records`, { records: [{ type, id }] });
const onHold = (res: { status: number; body: any }) => [res.status, res.body?.error?.code];

async function upload(recordType: string, recordId: string, name: string) {
  const token = await createSession(t.db, adminId);
  const res = await t.app.inject({
    method: 'PUT', url: `/api/attachments/upload?${new URLSearchParams({ record_type: recordType, record_id: recordId, name })}`,
    headers: { cookie: `${SESSION_COOKIE}=${token}`, 'x-grc-csrf': '1', 'content-type': 'application/octet-stream' }, payload: PDF,
  });
  return res.json();
}

/** A retention policy of one month on a type, with the record made old enough to be flagged. */
async function flag(type: string, table: string, id: string, disposal = 'delete') {
  await t.api.put(`/api/admin/retention/${type}`, { periodMonths: 1, disposal });
  await t.db.query(`update ${table} set updated_at = now() - interval '3 months' where id = $1`, [id]);
}
const reviewOf = async (type: string, id: string) =>
  t.db.one<any>('select * from retention_reviews where record_type = $1 and record_id = $2', [type, id]);

beforeAll(async () => {
  t = await testApp();
  adminId = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('placing records under a hold', () => {
  it('opens a hold, adds records by hand, and shows it on the record for legal.view holders only', async () => {
    const h = await hold('Invented matter: depot gate claim');
    expect(h).toMatchObject({ status: 'active', ref: expect.stringMatching(/^LGH-/) });
    const sys = await system('Held gate controller');
    expect((await place(h.id, 'system', sys.id)).status).toBe(201);
    expect(await holdsOn(t.db, 'system', sys.id)).toEqual([{ holdId: h.id, ref: h.ref, matter: 'Invented matter: depot gate claim' }]);

    expect((await t.api.get(`/api/systems/${sys.id}`)).body._holds).toEqual([{ id: h.id, ref: h.ref }]);
    const viewer = await t.as('agent'); // systems.view, no legal.view
    const seen = await viewer.get(`/api/systems/${sys.id}`);
    expect(seen.status).toBe(200);
    expect(seen.body._holds).toBeUndefined();
    expect((await viewer.get(`/api/legal-holds/on?type=system&id=${sys.id}`)).status).toBe(403);
    expect((await t.api.get(`/api/legal-holds/on?type=system&id=${sys.id}`)).body).toHaveLength(1);

    const listed = (await t.api.get(`/api/legal-holds/${h.id}/records`)).body;
    expect(listed).toMatchObject({ total: 1, hidden: 0 });
    expect(listed.rows[0]).toMatchObject({ record_type: 'system', record_id: sys.id, via: 'hand', label: 'Held gate controller' });

    // Taking it off keeps the history and frees the record.
    expect((await t.api.del(`/api/legal-holds/${h.id}/records?record_type=system&record_id=${sys.id}`)).status).toBe(200);
    expect(await holdsOn(t.db, 'system', sys.id)).toEqual([]);
    expect((await t.api.get(`/api/legal-holds/${h.id}/records`)).body).toMatchObject({ total: 0, released: 1 });
  });

  it('only records the person can see may be chosen by hand', async () => {
    const h = await hold('Invented matter: visibility');
    const officer = await t.as('records_privacy_officer'); // legal.*, no security.view
    const secret = (await t.api.post('/api/risks', { title: 'Restricted invented risk' })).body;
    if (secret?.id) {
      const res = await officer.post(`/api/legal-holds/${h.id}/records`, { records: [{ type: 'risk', id: secret.id }] });
      expect(res.status).toBe(400);
    }
    const res = await officer.post(`/api/legal-holds/${h.id}/records`, { records: [{ type: 'system', id: '00000000-0000-4000-8000-000000000009' }] });
    expect(res.status).toBe(400);
  });

  it('placeHold opens a new hold for a matter (contract C1)', async () => {
    const sys = await system('Preserved timetable server');
    const placed = await placeHold(t.ctx, { matter: 'Invented preservation', records: [{ type: 'system', id: sys.id }] }, null);
    expect(placed).toMatchObject({ ref: expect.stringMatching(/^LGH-/), added: 1 });
    expect((await holdsOn(t.db, 'system', sys.id)).map((x) => x.ref)).toEqual([placed.ref]);
  });
});

describe('every destructive path refuses a held record (one test each)', () => {
  let h: any;
  beforeAll(async () => { h = await hold('Invented matter: destructive paths'); });

  it('generic DELETE (and so bulk delete, which calls it per row)', async () => {
    const sys = await system('Held for delete');
    await place(h.id, 'system', sys.id);
    const res = await t.api.del(`/api/systems/${sys.id}`);
    expect(onHold(res)).toEqual([409, 'on_hold']);
    expect(res.body.error.message).toContain(h.ref);
    expect(res.body.error.message).not.toContain('destructive paths'); // the matter is never named
    expect((await t.api.get(`/api/systems/${sys.id}`)).status).toBe(200);
  });

  it('retention review: anonymize', async () => {
    const sys = await system('Held for anonymize');
    await place(h.id, 'system', sys.id);
    await t.db.query('insert into retention_reviews (record_type, record_id, basis_at) values ($1, $2, now())', ['system', sys.id]);
    await t.api.put('/api/admin/retention/system', { periodMonths: 1, disposal: 'delete' });
    await confirm();
    const review = await reviewOf('system', sys.id);
    const res = await t.api.post(`/api/admin/retention/reviews/${review.id}/anonymize`, { reason: 'End of period', confirm: true });
    expect(onHold(res)).toEqual([409, 'on_hold']);
    expect((await reviewOf('system', sys.id)).status).toBe('pending');
  });

  it('retention review: remove for good', async () => {
    const sys = await system('Held for removal');
    await place(h.id, 'system', sys.id);
    await t.db.query('insert into retention_reviews (record_type, record_id, basis_at) values ($1, $2, now())', ['system', sys.id]);
    await confirm();
    const review = await reviewOf('system', sys.id);
    const res = await t.api.post(`/api/admin/retention/reviews/${review.id}/delete`, { reason: 'End of period', confirm: true });
    expect(onHold(res)).toEqual([409, 'on_hold']);
    expect(await t.db.one('select 1 from systems where id = $1', [sys.id])).toBeTruthy();
  });

  it('the anonymize function itself, whoever calls it', async () => {
    const sys = await system('Held for direct anonymize');
    await place(h.id, 'system', sys.id);
    const def = t.core.resources.registry.get('system')!;
    await expect(t.core.retention.anonymize(def, sys.id)).rejects.toMatchObject({ code: 'on_hold' });
  });

  it('resources.purge (remove for good)', async () => {
    const sys = await system('Held for purge');
    await place(h.id, 'system', sys.id);
    await expect(t.core.resources.purge('system', sys.id, null)).rejects.toMatchObject({ code: 'on_hold' });
    expect(await t.db.one('select 1 from systems where id = $1', [sys.id])).toBeTruthy();
  });

  it('removing a file from a held record', async () => {
    const sys = await system('Held with a file');
    const file = await upload('system', sys.id, 'Signed statement.pdf');
    expect(file.id).toBeTruthy();
    await place(h.id, 'system', sys.id);
    const res = await t.api.del(`/api/attachments/${file.id}`);
    expect(onHold(res)).toEqual([409, 'on_hold']);
    expect(res.body.error.message).toContain('have its files removed');
  });

  it('the purge of removed files skips a held record\'s files', async () => {
    const sys = await system('Held after its file was removed');
    const file = await upload('system', sys.id, 'Earlier statement.pdf');
    expect((await t.api.del(`/api/attachments/${file.id}`)).status).toBe(200);
    await place(h.id, 'system', sys.id);
    await t.db.query(`update attachments set deleted_at = now() - interval '400 days' where id = $1`, [file.id]);
    await purgeRemoved(t.ctx, new Date(Date.now() + 1000 * 86_400_000));
    expect((await t.db.one<any>('select purged_at from attachments where id = $1', [file.id])).purged_at).toBeNull();
  });

  it('merging a held duplicate vulnerability away', async () => {
    const make = async (extra: Record<string, unknown>) => (await t.api.post('/api/vulnerabilities', { title: 'Invented weak cipher', severity: 'high', plugin_id: '930001', ...extra })).body;
    const keep = await make({ host_name: 'held-gw-01', port: '443/tcp' });
    const dup = await make({ host_ip: '10.77.0.1', port: '443' });
    await t.db.query(`update vulnerabilities set host_key = 'held-gw-01', port_key = '443/tcp' where id = any($1::uuid[])`, [[keep.id, dup.id]]);
    await place(h.id, 'vulnerability', dup.id);
    await confirm();
    const res = await t.api.post('/api/vulnerabilities/duplicates/merge', { keep_id: keep.id, merge_ids: [dup.id] });
    expect(onHold(res)).toEqual([409, 'on_hold']);
    expect((await t.api.get(`/api/vulnerabilities/${dup.id}`)).status).toBe(200);
  });

  it('the retention sweep leaves held records unflagged and counts them; the review list shows a held record flagged before', async () => {
    const before = await system('Flagged before the hold');
    const held = await system('Held before the sweep');
    await flag('system', 'systems', before.id);
    await flag('system', 'systems', held.id);
    await place(h.id, 'system', held.id);
    const sweep = await t.api.post('/api/admin/retention/sweep');
    expect(sweep.body.held).toBeGreaterThanOrEqual(1);
    expect(await reviewOf('system', held.id)).toBeUndefined();
    expect(await reviewOf('system', before.id)).toBeTruthy();
    await place(h.id, 'system', before.id);
    const list = (await t.api.get('/api/admin/retention/reviews?record_type=system&held=only&pageSize=200')).body.rows;
    expect(list.find((r: any) => r.record_id === before.id)).toMatchObject({ held: true, holds: [h.ref] });
    const others = (await t.api.get('/api/admin/retention/reviews?record_type=system&held=none&pageSize=200')).body.rows;
    expect(others.some((r: any) => r.record_id === before.id)).toBe(false);
  });

  it('an active hold cannot itself be deleted; a released one can', async () => {
    const own = await hold('Invented matter: self');
    const res = await t.api.del(`/api/legal-holds/${own.id}`);
    expect(onHold(res)).toEqual([409, 'on_hold']);
    expect(res.body.error.message).toContain('Release it first');
  });
});

describe('holds never lapse when an area is switched off', () => {
  it('keeps refusing while the records area (and the record\'s own area) is off', async () => {
    const h = await hold('Invented matter: switched off');
    const risk = (await t.api.post('/api/risks', { title: 'Held invented risk' })).body;
    const sys = await system('Held while records is off');
    await place(h.id, 'system', sys.id);
    await place(h.id, 'risk', risk.id);
    await confirm();
    expect((await t.api.patch('/api/admin/features', { features: { records: false, risks: false } })).status).toBe(200);
    try {
      expect(onHold(await t.api.del(`/api/systems/${sys.id}`))).toEqual([409, 'on_hold']);
      // The risk's own area is off: its routes are gone, and core still refuses it.
      await expect(t.core.resources.purge('risk', risk.id, null)).rejects.toMatchObject({ code: 'on_hold' });
      expect((await t.api.get(`/api/legal-holds/${h.id}/records`)).body.total).toBe(2);
    } finally {
      expect((await t.api.patch('/api/admin/features', { features: { records: true, risks: true } })).status).toBe(200);
    }
  });
});

describe('saved queries', () => {
  it('holds every matching record as system work, restricted ones included; lists only what the reader may see', async () => {
    const h = await hold('Invented matter: query');
    const open = await system('Query match: open record');
    // A restricted record (risks need security.view) held by a query on its own type.
    const flagged = (await t.api.post('/api/risks', { title: 'Query match: restricted risk' })).body;
    const res = await t.api.post(`/api/legal-holds/${h.id}/queries`, { record_type: 'system', q: 'Query match' });
    expect(res.status).toBe(201);
    expect(res.body.added).toBe(1);
    const restricted = await t.api.post(`/api/legal-holds/${h.id}/queries`, { record_type: 'risk', q: 'Query match' });
    expect(restricted.body).toMatchObject({ matched: 1, added: 1 });
    expect((await holdsOn(t.db, 'risk', flagged.id)).length).toBe(1);

    // Re-run nightly: adds new matches, never removes.
    const later = await system('Query match: added later');
    await t.api.del(`/api/legal-holds/${h.id}/records?record_type=system&record_id=${open.id}`);
    const run = await t.api.post(`/api/legal-holds/${h.id}/queries/${res.body.id}/run`);
    expect(run.body.added).toBe(1);
    expect((await holdsOn(t.db, 'system', later.id)).length).toBe(1);
    expect((await holdsOn(t.db, 'system', open.id)).length).toBe(0); // taken off by hand stays off

    const officer = await t.as('records_privacy_officer');
    const seen = (await officer.get(`/api/legal-holds/${h.id}/records`)).body;
    expect(seen).toMatchObject({ total: 2, hidden: 1 });
    expect(seen.rows.some((r: any) => r.record_id === flagged.id)).toBe(false);
    // The query on a type the officer may not see is counted, never described.
    const queries = (await officer.get(`/api/legal-holds/${h.id}/queries`)).body;
    const hiddenQuery = queries.find((q: any) => q.hidden);
    expect(hiddenQuery).toMatchObject({ matched: 1 });
    expect(hiddenQuery.q).toBeUndefined();
    expect(hiddenQuery.record_type).toBeUndefined();
  });

  it('refuses a query that would search restricted words for someone without security.view, and an empty one', async () => {
    const h = await hold('Invented matter: query rules');
    const officer = await t.as('records_privacy_officer');
    // Actions may be restricted (inherited from their source): searching their words needs security.view.
    expect((await officer.post(`/api/legal-holds/${h.id}/queries`, { record_type: 'action', q: 'secret' })).status).toBe(400);
    expect((await officer.post(`/api/legal-holds/${h.id}/queries`, { record_type: 'action', filters: { 'f.status': 'canceled' } })).status).toBe(201);
    expect((await officer.post(`/api/legal-holds/${h.id}/queries`, { record_type: 'system', q: 'gate' })).status).toBe(201);
    expect((await t.api.post(`/api/legal-holds/${h.id}/queries`, { record_type: 'system' })).status).toBe(400);
    expect((await t.api.post(`/api/legal-holds/${h.id}/queries`, { record_type: 'system', filters: { 'f.nonsense': 'x' } })).status).toBe(400);
  });
});

describe('release', () => {
  it('goes through the Legal hold release approval, then the record is free again', async () => {
    const h = await hold('Invented matter: release by approval');
    const sys = await system('Held until release');
    await place(h.id, 'system', sys.id);
    const approver = await t.as('records_privacy_officer');
    const asked = await t.api.post(`/api/legal-holds/${h.id}/release`, { reason: 'Claim settled (invented)' });
    expect(asked.status).toBe(202);
    expect((await t.api.post(`/api/legal-holds/${h.id}/release`, { reason: 'Again please' })).body.error.code).toBe('already_requested');
    expect((await t.api.get(`/api/legal-holds/${h.id}`)).body.status).toBe('active');
    const eng = approvalEngine(t.app)!;
    await eng.decide(RELEASE_KIND, h.id, null, 'approved', 'Settled', { userId: approver.userId });
    const now = (await t.api.get(`/api/legal-holds/${h.id}`)).body;
    expect(now).toMatchObject({ status: 'released', release_reason: 'Claim settled (invented)' });
    expect(await holdsOn(t.db, 'system', sys.id)).toEqual([]);
    expect((await t.api.del(`/api/systems/${sys.id}`)).status).toBe(200);
    expect((await t.api.del(`/api/legal-holds/${h.id}`)).status).toBe(200);
  });

  it('with no workflow, only someone holding legal.approve releases directly (audited)', async () => {
    await t.db.query(`update workflow_definitions set active = false where kind = $1`, [RELEASE_KIND]);
    try {
      const h = await hold('Invented matter: direct release');
      const clerk = await t.as('compliance_officer'); // legal.view only
      expect((await clerk.post(`/api/legal-holds/${h.id}/release`, { reason: 'Done here' })).status).toBe(403);
      const res = await t.api.post(`/api/legal-holds/${h.id}/release`, { reason: 'Matter closed (invented)' });
      expect(res.body.status).toBe('released');
      const audit = await t.db.one<any>(`select summary from audit_events where action = 'legal_hold.release' and record_id = $1`, [h.id]);
      expect(audit.summary).toContain('Matter closed');
      expect((await t.api.post(`/api/legal-holds/${h.id}/records`, { record_type: 'system', record_id: (await system('Late')).id })).body.error.code).toBe('released');
    } finally {
      await t.db.query(`update workflow_definitions set active = true where kind = $1`, [RELEASE_KIND]);
    }
  });
});
