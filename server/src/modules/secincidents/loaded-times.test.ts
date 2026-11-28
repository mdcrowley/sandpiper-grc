import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';

// Wave 26 data load follow-ups (E45-53, E45-54, E45-55): in data load mode the time a checklist step,
// fulfillment task, control test step or post-implementation review was done is the time the load
// gives, and the inspector, finding owner and evidence author follow the person named. Outside a load
// the time is now and the caller is recorded. Invented records and people only.

let t: Awaited<ReturnType<typeof testApp>>;
let former = '';
const confirm = () => t.db.query('update sessions set confirmed_at = now()');
const AT = '2023-04-05T10:30:00.000Z';

beforeAll(async () => {
  t = await testApp();
  former = (await t.db.one<{ id: string }>(
    `insert into users (username, email, display_name, status) values ('rclerk', 'r.clerk@example.test', 'Robin Clerk', 'disabled') returning id`))!.id;
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('in data load mode', () => {
  const ids: Row = {};
  beforeAll(async () => {
    // Made before the load: an incident with a checklist step, a ticket with a task, a control test with a step,
    // an inspection with a checklist, a framework outcome.
    const inc = await t.api.post('/api/security-incidents', { title: 'Invented timetable outage', scenario: 'ransomware', severity: 'high', discovered_at: '2023-04-01T08:00:00Z' });
    expect(inc.status, JSON.stringify(inc.body)).toBe(201);
    ids.incident = inc.body.id;
    ids.step = (await t.api.post(`/api/security-incidents/${ids.incident}/checklist`, { phase: 'recovery', step: 'Invented restore check' })).body.id;
    ids.ticket = (await t.api.post('/api/tickets', { title: 'Invented badge request', type: 'request', fulfilment_tasks: [{ title: 'Print the badge', done: false }] })).body.id;
    const control = (await t.api.post('/api/controls', { title: 'Invented yard gate check', control_type: 'preventive', domain: 'safety', status: 'active' })).body;
    await t.api.post(`/api/controls/${control.id}/steps`, { step: 'Look at the gate log.' });
    ids.test = (await t.api.post('/api/control-tests', { control_id: control.id, test_type: 'operating', status: 'in_progress' })).body.id;
    const tpl = (await t.api.post('/api/checklist-templates', { name: 'Invented loaded inspection', kind: 'inspection' })).body;
    const items = (await t.api.put(`/api/checklist-templates/${tpl.id}/items`, { items: [{ prompt: 'Exits clear' }] })).body.items;
    ids.item = items[0].id;
    ids.inspection = (await t.api.post('/api/inspections', { template_id: tpl.id, target_type: 'none', due_on: dayInZone() })).body.id;
    const fw = await t.db.one<{ id: string }>(`insert into frameworks (key, name) values ('tst-load', 'Invented load framework') returning id`);
    ids.outcome = (await t.db.one<{ id: string }>(`insert into framework_outcomes (framework_id, code, title) values ($1, 'TST.LD-1', 'Invented outcome') returning id`, [fw!.id]))!.id;
    await confirm();
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
  });
  afterAll(async () => { await confirm(); await t.api.post('/api/admin/data-load', { on: false }); });

  it('keeps the time an incident checklist step was ticked (E45-55)', async () => {
    const res = await t.api.patch(`/api/security-incidents/${ids.incident}/checklist/${ids.step}`, { done: true, done_at: AT, on_behalf_of: 'rclerk' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = (await t.db.one<Row>('select done_at, done_by from incident_checklist_items where id = $1', [ids.step]))!;
    expect([new Date(row.done_at).toISOString(), row.done_by]).toEqual([AT, former]);
  });

  it('keeps the time a fulfillment task was done (E45-55)', async () => {
    const res = await t.api.patch(`/api/tickets/${ids.ticket}`, { fulfilment_tasks: [{ title: 'Print the badge', done: true, done_at: AT }], on_behalf_of: 'rclerk' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.fulfilment_tasks[0]).toMatchObject({ done_at: AT, done_by_name: 'Robin Clerk' });
  });

  it('keeps the time a control test step was done (E45-55)', async () => {
    const step = (await t.api.get(`/api/control-tests/${ids.test}/steps`)).body.rows[0];
    const res = await t.api.patch(`/api/control-tests/${ids.test}/steps/${step.id}`, { result: 'pass', done_at: AT, on_behalf_of: 'rclerk' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = (await t.db.one<Row>('select done_at, done_by from control_test_steps where id = $1', [step.id]))!;
    expect([new Date(row.done_at).toISOString(), row.done_by]).toEqual([AT, former]);
  });

  it('keeps the time a post-implementation review was recorded (E45-55)', async () => {
    const made = await t.api.post('/api/changes', {
      title: 'Invented loaded change', description: 'x', reason: 'y', implementation_plan: 'a', test_plan: 'b', backout_plan: 'c',
      status: 'completed', outcome: 'successful', planned_start: '2023-04-01T18:00:00Z', planned_end: '2023-04-01T20:00:00Z', actual_end: '2023-04-01T20:00:00Z',
      pir_required: true,
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const res = await t.api.post(`/api/changes/${made.body.id}/review`, { what_happened: 'Restored.', cause: 'A disk.', pir_completed_at: AT });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    expect(new Date((await t.db.one<Row>('select pir_completed_at from changes where id = $1', [made.body.id]))!.pir_completed_at).toISOString()).toBe(AT);
  });

  it('makes the person named the inspector of an inspection they answer (E45-53)', async () => {
    const res = await t.api.put(`/api/inspections/${ids.inspection}/responses`, { item_id: ids.item, answer: 'yes', on_behalf_of: 'rclerk' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await t.db.one<Row>('select inspector_id from inspections where id = $1', [ids.inspection]))!.inspector_id).toBe(former);
  });

  it('records the person named as the author of outcome evidence (E45-54)', async () => {
    const res = await t.api.post(`/api/framework-outcomes/${ids.outcome}/evidence`, { title: 'Invented drill log', on_behalf_of: 'rclerk' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await t.db.one<Row>('select created_by from outcome_evidence where id = $1', [res.body.id]))!.created_by).toBe(former);
  });
});

describe('outside data load mode', () => {
  it('stamps now and ignores a given time', async () => {
    const inc = (await t.api.post('/api/security-incidents', { title: 'Invented second outage', scenario: 'ransomware', severity: 'low', discovered_at: '2023-04-01T08:00:00Z' })).body;
    const step = (await t.api.post(`/api/security-incidents/${inc.id}/checklist`, { phase: 'recovery', step: 'Invented step' })).body.id;
    await t.api.patch(`/api/security-incidents/${inc.id}/checklist/${step}`, { done: true, done_at: AT });
    const row = (await t.db.one<Row>('select done_at from incident_checklist_items where id = $1', [step]))!;
    expect(Date.now() - new Date(row.done_at).getTime()).toBeLessThan(60_000);
  });
});
