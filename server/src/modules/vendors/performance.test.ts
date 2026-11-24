import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { ANONYMIZED_TEXT } from '../../core/retention.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { duePeriod, periodLabel, periodOf, periodRange, trendOf } from './performance.ts';

// Contractor performance reviews (E41-11): measures with targets on a contract, periodic scores with
// comments, whether each met its target and the trend.
let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let viewer: Client;   // contracts.view only
const before = process.env.GRC_MODULES;

beforeAll(async () => {
  process.env.GRC_MODULES = 'vendors,holds,admin';
  t = await testApp();
  const role = (await t.db.one<Row>(`insert into roles (key, name) values ('contract_viewer', 'Contract viewer (test)') returning id`))!;
  await t.db.query('insert into role_permissions (role_id, permission) values ($1, $2)', [role.id, 'contracts.view']);
  viewer = await t.as('contract_viewer');
}, 90_000);
afterAll(async () => {
  await t?.close();
  if (before === undefined) delete process.env.GRC_MODULES; else process.env.GRC_MODULES = before;
});

async function newContract(title: string): Promise<Row> {
  const v = (await t.api.post('/api/vendors', { name: `${title} vendor` })).body;
  const c = await t.api.post('/api/contracts', { title, vendor_id: v.id, status: 'active' });
  expect(c.status).toBe(201);
  return c.body;
}
/** The month `n` months before the current one, as "YYYY-MM". */
const monthsAgo = (n: number) => {
  const d = new Date(`${dayInZone().slice(0, 7)}-15T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 7);
};

describe('periods and trends', () => {
  it('works periods out by frequency', () => {
    expect(periodRange('2026-02', 'monthly')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(periodRange('2026-Q3', 'quarterly')).toEqual({ start: '2026-07-01', end: '2026-09-30' });
    expect(periodRange('2026', 'yearly')).toEqual({ start: '2026-01-01', end: '2026-12-31' });
    expect(periodRange('2026-13', 'monthly')).toBeNull();
    expect(periodRange('2026-10', 'quarterly')).toBeNull();
    expect(periodOf('2026-11-24', 'quarterly')).toBe('2026-Q4');
    expect(duePeriod('2026-11-24', 'monthly')).toBe('2026-10');
    expect(duePeriod('2026-01-05', 'quarterly')).toBe('2025-Q4');
    expect(duePeriod('2026-11-24', 'yearly')).toBe('2025');
    expect(periodLabel('2026-10')).toBe('October 2026');
    expect(periodLabel('2026-Q3')).toBe('Q3 2026');
  });

  it('turns the trend so that improving is always the better way', () => {
    expect(trendOf([90], 95, 'higher')).toBeNull();
    expect(trendOf([90, 92, 97], 95, 'higher')).toBe('improving');
    expect(trendOf([4, 3, 8], 5, 'lower')).toBe('worsening');
    expect(trendOf([95, 95.2], 95, 'higher')).toBe('steady');
    expect(trendOf([99.7, 99.6, 99.4, 99.2, 99.3, 99.1], 99.5, 'higher')).toBe('worsening');
    expect(trendOf([99.95, 99.92, 99.7, 99.85, 99.93, 99.96], 99.9, 'higher')).toBe('steady');
  });
});

describe('measures and scores on a contract', () => {
  it('records scores with comments, shows met or below, the trend and the score due', async () => {
    const c = await newContract('Bus shelter cleaning');
    const bad = await t.api.post(`/api/contracts/${c.id}/measures`, { name: '', target: 'lots' });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['name', 'target']);
    expect((await viewer.post(`/api/contracts/${c.id}/measures`, { name: 'On-time cleaning', target: 95 })).status).toBe(403);

    const m = await t.api.post(`/api/contracts/${c.id}/measures`, { name: 'Shelters cleaned on schedule', target: 95, unit: '%' });
    expect(m.status).toBe(201);
    expect(m.body).toMatchObject({ direction: 'higher', frequency: 'monthly', scores: [], trend: null });
    const lower = (await t.api.post(`/api/contracts/${c.id}/measures`, { name: 'Complaints', target: 5, direction: 'lower', frequency: 'quarterly' })).body;

    const score = (period: string, value: number, comment?: string) => t.api.post(`/api/contracts/${c.id}/measures/${m.body.id}/scores`, { period, value, comment });
    expect((await score(monthsAgo(3), 91, 'Two depots missed in the heat wave.')).status).toBe(201);
    expect((await score(monthsAgo(2), 93)).status).toBe(201);
    const last = await score(monthsAgo(1), 97, 'New crew schedule.');
    expect(last.status).toBe(201);
    expect(last.body.scores.map((s: Row) => s.met)).toEqual([false, false, true]);
    expect(last.body.latest).toMatchObject({ value: 97, met: true, comment: 'New crew schedule.' });
    expect(last.body.trend).toBe('improving');
    expect(last.body.due_period).toBeNull(); // last month is scored

    // One score per period; wrong formats and periods not started are refused.
    const again = await score(monthsAgo(1), 80);
    expect(again.status).toBe(409);
    expect((await score('2026-Q1', 80)).status).toBe(400);
    expect((await score('2999-01', 80)).body.error.fields.period).toMatch(/not started/);

    // A correction is audited; a stale version is refused.
    const latestId = last.body.latest.id;
    const fixed = await t.api.patch(`/api/contracts/${c.id}/scores/${latestId}`, { value: 96, comment: 'Corrected after the audit.', updated_at: last.body.latest.updated_at });
    expect(fixed.status).toBe(200);
    expect(fixed.body.latest).toMatchObject({ value: 96, comment: 'Corrected after the audit.' });
    expect((await t.api.patch(`/api/contracts/${c.id}/scores/${latestId}`, { value: 95, updated_at: last.body.latest.updated_at })).status).toBe(409);

    const perf = (await viewer.get(`/api/contracts/${c.id}/performance`)).body;
    expect(perf.can_edit).toBe(false);
    expect(perf.summary).toMatchObject({ measures: 2, met: 1, below: 0 });
    // The quarterly measure was added today, so no score is due for it yet.
    expect(perf.measures.find((x: Row) => x.id === lower.id).due_period).toBeNull();

    // Across contracts.
    const all = (await viewer.get('/api/contracts/performance')).body.rows.find((r: Row) => r.id === c.id);
    expect(all).toMatchObject({ measures: 2, met: 1, below: 0, not_scored: 1, vendor_name: null });

    const actions = (await t.db.query<Row>(`select action from audit_events where record_id = $1 and action like 'contract.%' order by id`, [c.id])).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['contract.measure_add', 'contract.score', 'contract.score_update']));

    // A measure that has scores keeps its frequency; it can stop being scored instead.
    expect((await t.api.patch(`/api/contracts/${c.id}/measures/${m.body.id}`, { frequency: 'yearly' })).status).toBe(400);
    const stopped = await t.api.patch(`/api/contracts/${c.id}/measures/${m.body.id}`, { active: false, target: 96 });
    expect(stopped.body).toMatchObject({ active: false, target: 96 });
  });

  it('shows a score as due once a period has ended without one', async () => {
    const c = await newContract('Elevator upkeep');
    const m = (await t.api.post(`/api/contracts/${c.id}/measures`, { name: 'Elevators in service', target: 98 })).body;
    await t.db.query(`update contract_measures set created_at = now() - interval '120 days' where id = $1`, [m.id]);
    const perf = (await t.api.get(`/api/contracts/${c.id}/performance`)).body;
    expect(perf.measures[0].due_period).toBe(monthsAgo(1));
    expect(perf.summary.due).toBe(1);
  });

  it('refuses removing scores under a legal hold and anonymizes comments', async () => {
    const c = await newContract('Depot security patrols');
    const m = (await t.api.post(`/api/contracts/${c.id}/measures`, { name: 'Patrols completed', target: 100 })).body;
    const s = (await t.api.post(`/api/contracts/${c.id}/measures/${m.id}/scores`, { period: monthsAgo(1), value: 99, comment: 'One patrol missed (invented).' })).body;
    const h = (await t.api.post('/api/legal-holds', { matter: 'Invented matter: patrol dispute' })).body;
    expect((await t.api.post(`/api/legal-holds/${h.id}/records`, { records: [{ type: 'contract', id: c.id }] })).status).toBe(201);
    expect((await t.api.del(`/api/contracts/${c.id}/scores/${s.latest.id}`)).body.error.code).toBe('on_hold');
    expect((await t.api.del(`/api/contracts/${c.id}/measures/${m.id}`)).body.error.code).toBe('on_hold');

    const other = await newContract('Fare machine servicing');
    const m2 = (await t.api.post(`/api/contracts/${other.id}/measures`, { name: 'Machines working', target: 97 })).body;
    await t.api.post(`/api/contracts/${other.id}/measures/${m2.id}/scores`, { period: monthsAgo(1), value: 95, comment: 'Named a technician (invented).' });
    await t.core.retention.anonymize(t.ctx.resources.get('contract')!, other.id);
    const row = (await t.db.one<Row>('select comment, recorded_by from contract_scores where contract_id = $1', [other.id]))!;
    expect(row).toEqual({ comment: ANONYMIZED_TEXT, recorded_by: null });

    // Removing a measure removes its scores too.
    expect((await t.api.del(`/api/contracts/${other.id}/measures/${m2.id}`)).status).toBe(200);
    expect((await t.api.get(`/api/contracts/${other.id}/performance`)).body.measures).toEqual([]);
  });

  it('is out of reach without contracts.view and when the area is off', async () => {
    const c = await newContract('Hidden performance');
    const agentNoContracts = await t.as('requester');
    expect((await agentNoContracts.get(`/api/contracts/${c.id}/performance`)).status).toBe(403);
    const admin = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
    await t.db.query('update sessions set confirmed_at = now() where user_id = $1', [admin]);
    expect((await t.api.patch('/api/admin/features', { features: { vendors: false } })).status).toBe(200);
    try {
      for (const url of [`/api/contracts/${c.id}/performance`, '/api/contracts/performance']) {
        const r = await t.api.get(url);
        expect(r.status, url).toBe(404);
        expect(r.body.error.code, url).toBe('switched_off');
      }
    } finally {
      await t.api.patch('/api/admin/features', { features: { vendors: true } });
    }
  });
});
