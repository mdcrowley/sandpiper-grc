import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// Behavior tests for GET /api/reports/departments [reports.view or dashboards.view] and
// POST /api/report-schedules/run-due [admin.administer] (E40-05). Invented data only.

let t: Awaited<ReturnType<typeof testApp>>;

beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(async () => { await t?.close(); });

const values = async (c: { get: (u: string) => Promise<{ body: any }> }) => (await c.get('/api/reports/departments')).body.map((d: any) => d.value) as string[];

describe('GET /api/reports/departments', () => {
  it('offers the organization\'s departments and those recorded on records the caller may view, never a restricted record\'s', async () => {
    await t.db.query(`insert into departments (name) values ('Invented Rail Operations'), ('Invented Closed Unit')`);
    await t.db.query(`update departments set deleted_at = now() where name = 'Invented Closed Unit'`);
    expect((await t.api.post('/api/actions', { title: 'Invented open action', status: 'open', department: 'Invented Bus Maintenance' })).status).toBe(201);
    const risk = (await t.api.post('/api/risks', { title: 'Invented restricted risk' })).body;
    const hidden = await t.api.post('/api/actions', { title: 'Invented restricted action', status: 'open', department: 'Invented Secret Unit', source: 'risk', source_type: 'risk', source_id: risk.id });
    expect(hidden.body.restricted).toBe(true);

    const res = await t.api.get('/api/reports/departments');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.arrayContaining([
      { value: 'Invented Rail Operations', label: 'Invented Rail Operations' },
      { value: 'Invented Bus Maintenance', label: 'Invented Bus Maintenance' },
      { value: 'Invented Secret Unit', label: 'Invented Secret Unit' },
    ]));
    const sorted = [...res.body.map((d: any) => d.value)].sort((a, b) => a.localeCompare(b));
    expect(res.body.map((d: any) => d.value)).toEqual(sorted);
    expect(res.body.some((d: any) => d.value === 'Invented Closed Unit')).toBe(false);

    const agent = await values(await t.as('agent')); // actions.*, reports.view, no security.view
    expect(agent).toEqual(expect.arrayContaining(['Invented Rail Operations', 'Invented Bus Maintenance']));
    expect(agent).not.toContain('Invented Secret Unit');
    expect(await values(await t.as('security_lead'))).toContain('Invented Secret Unit');
    // Without actions.view, the actions' departments are not offered; the organization's list is.
    const exec = await values(await t.as('executive_viewer'));
    expect(exec).toContain('Invented Rail Operations');
    expect(exec).not.toContain('Invented Bus Maintenance');
  });

  it('needs reports.view or dashboards.view', async () => {
    expect((await (await t.as('training_coordinator')).get('/api/reports/departments')).status).toBe(403);
    expect((await (await t.as('requester')).get('/api/reports/departments')).status).toBe(403);
    expect((await (await t.as('asset_manager')).get('/api/reports/departments')).status).toBe(200);
  });
});

describe('POST /api/report-schedules/run-due', () => {
  it('needs admin.administer; runs each due schedule once and moves it on', async () => {
    const report = (await t.api.post('/api/reports', { name: 'Invented actions by status', spec: { type: 'action', groupBy: [{ field: 'status' }] }, sharing: 'everyone' })).body;
    expect(report.id).toBeTruthy();
    const made = await t.api.post('/api/report-schedules', { name: 'Invented daily actions', target_type: 'report', target_id: report.id, cadence: 'daily', hour: 6, recipient_roles: ['administrator'] });
    expect(made.status).toBe(201);
    await t.db.query(`update report_schedules set next_run_at = now() - interval '1 minute' where id = $1`, [made.body.id]);

    expect((await (await t.as('security_lead')).post('/api/report-schedules/run-due')).status).toBe(403); // reports.*, no admin
    expect(await t.db.query('select 1 from report_deliveries where schedule_id = $1', [made.body.id])).toHaveLength(0);

    const res = await t.api.post('/api/report-schedules/run-due');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ scheduleId: made.body.id, delivered: expect.any(Number), skipped: expect.any(Number), failed: 0, snapshots: expect.any(Array) }]);
    expect(res.body[0].delivered).toBeGreaterThanOrEqual(1);
    expect(res.body[0].snapshots).toHaveLength(res.body[0].delivered);
    const after = await t.db.one<any>('select next_run_at, last_run_at from report_schedules where id = $1', [made.body.id]);
    expect(new Date(after.next_run_at).getTime()).toBeGreaterThan(Date.now());
    expect(after.last_run_at).not.toBeNull();
    expect(await t.db.query(`select 1 from audit_events where action = 'report_schedule.run' and record_id = $1`, [made.body.id])).toHaveLength(1);

    // Nothing more is due.
    expect((await t.api.post('/api/report-schedules/run-due')).body).toEqual([]);
  });
});
