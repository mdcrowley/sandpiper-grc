import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testApp } from '../test/helpers.ts';
import { dayInZone } from './timezone.ts';

// E40-09: busy pages read related rows once per kind, not once per row, and the long lists come a page
// at a time. Each statement count is taken with few rows and with more: it must not grow with them.

type T = Awaited<ReturnType<typeof testApp>>;
type Row = Record<string, any>;
let t: T;

/** The statements run while `fn` runs (the handle's methods are wrapped for the duration). */
async function statements(fn: () => Promise<unknown>): Promise<number> {
  let n = 0;
  const db = t.db as any;
  const saved = { one: db.one, query: db.query };
  db.one = async (sql: string, params?: unknown[]) => { n += 1; return saved.one(sql, params); };
  db.query = async (sql: string, params?: unknown[]) => { n += 1; return saved.query(sql, params); };
  try { await fn(); } finally { db.one = saved.one; db.query = saved.query; }
  return n;
}

const ok = (res: { status: number; body: any }, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body;
};
let n = 0;
const system = async (name = 'Invented system') => ok(await t.api.post('/api/systems', { name: `${name} ${(n += 1)}` }), 201) as Row;

beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(async () => { await t?.close(); });

describe('one query per kind (E40-09)', () => {
  it('the approvals inbox reads the records, decisions and names once for every waiting step', async () => {
    const approver = await t.as('administrator');
    const wf = ok(await t.api.post('/api/workflows/definitions', {
      record_type: 'system', name: 'Invented system review', trigger: 'manual',
      steps: [{ name: 'Review', approvers: { kind: 'users', users: [approver.userId] } }],
    }), 201);
    const start = async () => ok(await t.api.post(`/api/workflows/records/system/${(await system()).id}/start`, { workflow_id: wf.id }), 201);
    for (let i = 0; i < 2; i += 1) await start();
    await approver.get('/api/workflows/approvals'); // warm: feature switches, last-seen
    let rows: Row[] = [];
    const few = await statements(async () => { rows = (await approver.get('/api/workflows/approvals')).body.rows; });
    expect(rows).toHaveLength(2);
    for (let i = 0; i < 5; i += 1) await start();
    const many = await statements(async () => { rows = (await approver.get('/api/workflows/approvals')).body.rows; });
    expect(rows).toHaveLength(7);
    expect(rows[0]).toMatchObject({ workflow: 'Invented system review', step: 'Review', record_type: 'system' });
    expect(rows[0].record_title).toMatch(/^Invented system/);
    expect(many).toBe(few);
  });

  it('expiring evidence reads each kind of parent record once', async () => {
    const today = dayInZone();
    const evidence = async () => {
      const s = await system('Evidence holder');
      await t.db.query(
        `insert into attachments (record_type, record_id, file_name, size_bytes, sha256, storage_key, kind, expires_on)
         values ('system', $1, 'invented-evidence.pdf', 10, 'x', $2, 'evidence', $3::date)`, [s.id, randomUUID(), today]);
    };
    for (let i = 0; i < 2; i += 1) await evidence();
    let rows: Row[] = [];
    const few = await statements(async () => { rows = (await t.api.get('/api/attachments/evidence-expiring?days=30')).body.rows; });
    expect(rows).toHaveLength(2);
    for (let i = 0; i < 6; i += 1) await evidence();
    const many = await statements(async () => { rows = (await t.api.get('/api/attachments/evidence-expiring?days=30')).body.rows; });
    expect(rows).toHaveLength(8);
    expect(rows[0]).toMatchObject({ record_type_label: 'System', record_route: expect.stringMatching(/^\/systems\//) });
    expect(many).toBe(few);
  });

  it('a meeting\'s decisions read the records decided once per kind', async () => {
    const committee = ok(await t.api.post('/api/committees', { name: 'Invented review board', kind: 'other' }), 201);
    const meeting = ok(await t.api.post('/api/meetings', {
      committee_id: committee.id, title: 'Invented meeting', scheduled_at: new Date(Date.now() - 3_600_000).toISOString(), status: 'held',
    }), 201);
    const decide = async () => ok(await t.api.post('/api/meeting-decisions', {
      meeting_id: meeting.id, title: 'Invented decision', outcome: 'noted', record_type: 'system', record_id: (await system('Decided')).id,
    }), 201);
    for (let i = 0; i < 2; i += 1) await decide();
    let rows: Row[] = [];
    const few = await statements(async () => { rows = (await t.api.get(`/api/meetings/${meeting.id}/decisions`)).body; });
    expect(rows).toHaveLength(2);
    for (let i = 0; i < 5; i += 1) await decide();
    const many = await statements(async () => { rows = (await t.api.get(`/api/meetings/${meeting.id}/decisions`)).body; });
    expect(rows).toHaveLength(7);
    expect(rows[0].record).toMatchObject({ type: 'system', label: expect.stringMatching(/^Decided/) });
    expect(many).toBe(few);
  });

  it('a business process reads its dependencies once per kind', async () => {
    const proc = ok(await t.api.post('/api/business-processes', { name: 'Invented dispatch process', status: 'active', criticality: 'vital' }), 201);
    const put = async (count: number) => {
      const ids: string[] = [];
      for (let i = 0; i < count; i += 1) ids.push((await system('Depended on')).id);
      return ok(await t.api.put(`/api/business-processes/${proc.id}/dependencies`, { dependencies: ids.map((id) => ({ dep_type: 'system', dep_id: id })) }));
    };
    await put(2);
    let deps: Row[] = [];
    const few = await statements(async () => { deps = (await t.api.get(`/api/business-processes/${proc.id}/dependencies`)).body.dependencies ?? (await t.api.get(`/api/business-processes/${proc.id}/dependencies`)).body; });
    await put(7);
    const many = await statements(async () => { deps = (await t.api.get(`/api/business-processes/${proc.id}/dependencies`)).body.dependencies ?? []; });
    expect(deps).toHaveLength(7);
    expect(deps[0]).toMatchObject({ dep_type: 'system', hidden: false, label: expect.stringMatching(/^Depended on/) });
    // One extra read is allowed: a cache (features, role scopes) may refresh during either window. Reading per
    // dependency would add five.
    expect(many).toBeLessThanOrEqual(few + 1);
  });
});

describe('long lists a page at a time (E40-09)', () => {
  it('pages a legal hold\'s records, keeping the counts whole', async () => {
    const hold = ok(await t.api.post('/api/legal-holds', { matter: 'Invented matter for paging' }), 201);
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) ids.push((await system('Held')).id);
    ok(await t.api.post(`/api/legal-holds/${hold.id}/records`, { records: ids.map((id) => ({ type: 'system', id })) }), 201);
    ok(await t.api.del(`/api/legal-holds/${hold.id}/records?record_type=system&record_id=${ids[0]}`));
    const first = ok(await t.api.get(`/api/legal-holds/${hold.id}/records?state=current&pageSize=2`));
    expect(first).toMatchObject({ total: 4, released: 1, hidden: 0, shown: 4, page: 1, pageSize: 2 });
    expect(first.rows).toHaveLength(2);
    const second = ok(await t.api.get(`/api/legal-holds/${hold.id}/records?state=current&pageSize=2&page=2`));
    expect(second.rows).toHaveLength(2);
    expect(new Set([...first.rows, ...second.rows].map((r: Row) => r.record_id)).size).toBe(4);
    const off = ok(await t.api.get(`/api/legal-holds/${hold.id}/records?state=released`));
    expect(off.rows.map((r: Row) => r.record_id)).toEqual([ids[0]]);
    const all = ok(await t.api.get(`/api/legal-holds/${hold.id}/records`));
    expect(all.rows).toHaveLength(5);
    expect(all.rows[4].released_at).toBeTruthy(); // current first
    // A reader who may not see systems: the counts stay, the rows go.
    await t.db.query(`insert into roles (key, name, enabled) values ('legal_reader', 'Invented legal reader', true)`);
    await t.db.query(`insert into role_permissions (role_id, permission) select id, 'legal.view' from roles where key = 'legal_reader'`);
    const reader = await t.as('legal_reader');
    expect((await reader.get('/api/systems')).status).toBe(403);
    expect(ok(await reader.get(`/api/legal-holds/${hold.id}/records`))).toMatchObject({ total: 4, hidden: 4, released: 1, shown: 0, rows: [] });
    // The page size is capped.
    expect(ok(await t.api.get(`/api/legal-holds/${hold.id}/records?pageSize=100000`)).pageSize).toBe(500);
  });

  it('pages the control coverage matrix and filters it on the server', async () => {
    const control = ok(await t.api.post('/api/controls', { title: 'Invented control' }), 201);
    for (let i = 0; i < 3; i += 1) {
      const risk = ok(await t.api.post('/api/risks', { title: `Invented risk ${i}` }), 201);
      ok(await t.api.post(`/api/controls/${control.id}/coverage`), 400);
      ok(await t.api.post(`/api/controls/${control.id}/coverage`, { type: 'risk', id: risk.id }), 201);
    }
    const page = ok(await t.api.get('/api/controls/coverage-matrix?pageSize=2'));
    expect(page).toMatchObject({ all: 3, total: 3, page: 1, pageSize: 2 });
    expect(page.rows).toHaveLength(2);
    expect(Object.values(page.counts as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(3);
    expect(ok(await t.api.get('/api/controls/coverage-matrix?pageSize=2&page=2')).rows).toHaveLength(1);
    expect(ok(await t.api.get('/api/controls/coverage-matrix?type=policy'))).toMatchObject({ all: 3, total: 0, rows: [] });
    const state = page.rows[0].state;
    expect(ok(await t.api.get(`/api/controls/coverage-matrix?state=${state}`)).rows.every((r: Row) => r.state === state)).toBe(true);
  });

  it('limits what is affected and pages equipment coverage, with whole counts', async () => {
    const s = await system('Onboard');
    const mode = (await t.ctx.lookups.values('vehicle_mode'))[0].value;
    for (let i = 0; i < 3; i += 1) {
      const v = ok(await t.api.post('/api/vehicles', { fleet_number: `INV-${i}${n}`, mode }), 201);
      const a = ok(await t.api.post('/api/assets', { name: `Invented unit ${i}`, system_id: s.id }), 201);
      await t.db.query('insert into vehicle_equipment (vehicle_id, asset_id, installed_on) values ($1, $2, current_date)', [v.id, a.id]);
    }
    const impact = ok(await t.api.get(`/api/fleet/impact?system_id=${s.id}&limit=2`));
    expect(impact.counts.vehicles).toBe(3);
    expect(impact.vehicles).toHaveLength(2);
    expect(impact.limit).toBe(2);
    expect(ok(await t.api.get(`/api/fleet/impact?system_id=${s.id}`)).vehicles).toHaveLength(3);
    const cover = ok(await t.api.get('/api/fleet/coverage?pageSize=2'));
    expect(cover.vehicles).toHaveLength(2);
    expect(cover.total).toBe(cover.summary.vehicles);
    expect(cover.total).toBeGreaterThanOrEqual(3);
  });

  it('pages the audit coverage grid by area and keeps "covered" over all of them', async () => {
    const year = Number(dayInZone().slice(0, 4));
    const areas: Row[] = [];
    for (let i = 0; i < 3; i += 1) areas.push(ok(await t.api.post('/api/audit-areas', { name: `Invented area ${i}`, cycle_months: 12 }), 201));
    const audit = ok(await t.api.post('/api/audits', { title: 'Invented audit', audit_type: (await t.ctx.lookups.values('audit_type'))[0].value, area_id: areas[2].id, plan_year: year }), 201);
    await t.db.query(`update audits set status = 'closed' where id = $1`, [audit.id]);
    const first = ok(await t.api.get('/api/audits/coverage?pageSize=2'));
    expect(first).toMatchObject({ total: 3, page: 1, pageSize: 2, covered: 1 });
    expect(first.areas).toHaveLength(2);
    const second = ok(await t.api.get('/api/audits/coverage?pageSize=2&page=2'));
    expect(second.areas).toHaveLength(1);
    expect(second.covered).toBe(1);
    const area = [...first.areas, ...second.areas].find((a: Row) => a.id === areas[2].id);
    expect(area.audited_in_period).toBe(true);
    expect(area.by_year[year].map((e: Row) => e.id)).toEqual([audit.id]);
  });
});
