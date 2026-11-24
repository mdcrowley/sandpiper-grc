import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// Behavior tests for hand-written safety routes no other test named (E40-05): the clock sweep, changing
// and removing reporting rules, changing and removing statements, and the safety events of one vehicle
// or service. Everything is invented.

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let team: Client; // safety.view, create, edit; no security.view
let lead: Client; // the same and security.view
const MISSING = '00000000-0000-4000-8000-0000000000bb';
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const audits = (action: string, id: string) =>
  t.db.query<any>('select * from audit_events where action = $1 and record_id = $2 order by id', [action, id]);

async function withGrants(key: string, grants: string[]) {
  const role = await t.db.one<{ id: string }>(`insert into roles (key, name, description, enabled) values ($1,$1,'test',true) returning id`, [key]);
  for (const g of grants) await t.db.query('insert into role_permissions (role_id, permission) values ($1,$2)', [role!.id, g]);
  return t.as(key);
}

beforeAll(async () => {
  t = await testApp();
  team = await withGrants('rb_safety_team', ['safety.view', 'safety.create', 'safety.edit']);
  lead = await withGrants('rb_safety_lead', ['safety.view', 'safety.create', 'safety.edit', 'security.view', 'fleet.view']);
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('POST /api/safety/clocks/sweep', () => {
  it('raises the red alert once for an overdue clock and the amber alert once for a close one', async () => {
    const rule = (await t.api.post('/api/safety/report-rules', {
      name: 'Invented sweep rule', party: 'Invented sweep body', deadline_hours: 4, active: true,
      conditions: [{ field: 'damage_estimate', op: 'gte', value: 90000 }],
    })).body;
    const late = (await lead.post('/api/safety-events', { title: 'Sweep late', occurred_at: hoursAgo(0.1), event_type: 'collision', severity: 'major', damage_estimate: 95000 })).body;
    const close = (await lead.post('/api/safety-events', { title: 'Sweep close', occurred_at: hoursAgo(0.1), event_type: 'collision', severity: 'major', damage_estimate: 95000 })).body;
    expect(late.reportable).toBe(true);

    // Move the clocks: one past its deadline, one with less than a quarter of its window left.
    await t.db.query(`update safety_events set occurred_at = now() - interval '5 hours' where id = $1`, [late.id]);
    await t.db.query(`update safety_notifications set due_at = now() - interval '1 hour' where event_id = $1`, [late.id]);
    await t.db.query(`update safety_events set occurred_at = now() - interval '210 minutes' where id = $1`, [close.id]);
    await t.db.query(`update safety_notifications set due_at = now() + interval '30 minutes' where event_id = $1`, [close.id]);

    const res = await t.api.post('/api/safety/clocks/sweep');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ amber: 1, red: 1 });
    const lateRow = await t.db.one<any>('select * from safety_notifications where event_id = $1', [late.id]);
    expect(lateRow.alerted_red_at).not.toBeNull();
    const closeRow = await t.db.one<any>('select * from safety_notifications where event_id = $1', [close.id]);
    expect(closeRow.alerted_amber_at).not.toBeNull();
    expect(closeRow.alerted_red_at).toBeNull();
    expect(await audits('safety_notification.alert_red', late.id)).toHaveLength(1);
    expect(await audits('safety_notification.alert_amber', close.id)).toHaveLength(1);
    const timeline = (await lead.get(`/api/safety-events/${late.id}/timeline`)).body;
    expect(timeline.some((e: any) => /deadline to notify Invented sweep body has passed/.test(e.entry))).toBe(true);

    // Each alert is raised once only.
    expect((await t.api.post('/api/safety/clocks/sweep')).body).toEqual({ amber: 0, red: 0 });
    await t.api.del(`/api/safety/report-rules/${rule.id}`);
  });

  it('needs safety.administer', async () => {
    expect((await team.post('/api/safety/clocks/sweep')).status).toBe(403);
    expect((await (await t.as('agent')).post('/api/safety/clocks/sweep')).status).toBe(403);
    expect((await (await t.as('safety_manager')).post('/api/safety/clocks/sweep')).status).toBe(200);
  });
});

describe('PATCH and DELETE /api/safety/report-rules/:id', () => {
  it('changes a rule, validates the change, and audits it', async () => {
    const rule = (await t.api.post('/api/safety/report-rules', {
      name: 'Invented rule to change', party: 'Invented regulator', deadline_hours: 24,
      conditions: [{ field: 'fatalities', op: 'gte', value: 1 }],
    })).body;
    expect(rule.active).toBe(false);

    const res = await t.api.patch(`/api/safety/report-rules/${rule.id}`, { deadline_hours: 12, active: true, conditions: [{ field: 'evacuation', op: 'is', value: true }] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: rule.id, name: 'Invented rule to change', deadline_hours: 12, active: true, conditions: [{ field: 'evacuation', op: 'is', value: true }] });
    const listed = (await t.api.get('/api/safety/report-rules')).body.rules.find((r: any) => r.id === rule.id);
    expect(listed).toMatchObject({ deadline_hours: 12, active: true });
    const ev = await audits('safety_report_rule.update', rule.id);
    expect(ev).toHaveLength(1);
    expect(ev[0].before.deadline_hours).toBe(24);

    // Validation: nothing is written.
    const bad = await t.api.patch(`/api/safety/report-rules/${rule.id}`, { deadline_hours: 0, party: '', conditions: [{ field: 'severity', op: 'gte', value: 1 }] });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['conditions.0', 'deadline_hours', 'party']);
    expect((await t.db.one<any>('select deadline_hours from safety_report_rules where id = $1', [rule.id])).deadline_hours).toBe(12);

    // An empty change answers the rule unchanged and writes no audit event.
    expect((await t.api.patch(`/api/safety/report-rules/${rule.id}`, {})).body.id).toBe(rule.id);
    expect(await audits('safety_report_rule.update', rule.id)).toHaveLength(1);

    expect((await t.api.patch(`/api/safety/report-rules/${MISSING}`, { name: 'x' })).status).toBe(404);
    expect((await t.api.patch('/api/safety/report-rules/not-a-uuid', { name: 'x' })).status).toBe(404);
    expect((await team.patch(`/api/safety/report-rules/${rule.id}`, { name: 'Changed by the team' })).status).toBe(403);
    expect((await t.db.one<any>('select name from safety_report_rules where id = $1', [rule.id])).name).toBe('Invented rule to change');
  });

  it('removes a rule, keeps the clocks it started on their events, and audits it', async () => {
    const rule = (await t.api.post('/api/safety/report-rules', {
      name: 'Invented rule to remove', party: 'Invented removal body', deadline_hours: 48, active: true,
      conditions: [{ field: 'damage_estimate', op: 'gte', value: 777000 }],
    })).body;
    const ev = (await lead.post('/api/safety-events', { title: 'Removal event', occurred_at: hoursAgo(1), event_type: 'collision', severity: 'major', damage_estimate: 800000 })).body;
    expect((await lead.get(`/api/safety-events/${ev.id}/clocks`)).body.clocks).toHaveLength(1);

    expect((await team.del(`/api/safety/report-rules/${rule.id}`)).status).toBe(403);
    const res = await t.api.del(`/api/safety/report-rules/${rule.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect((await t.api.get('/api/safety/report-rules')).body.rules.some((r: any) => r.id === rule.id)).toBe(false);
    const clocks = (await lead.get(`/api/safety-events/${ev.id}/clocks`)).body.clocks;
    expect(clocks).toHaveLength(1);
    expect(clocks[0].party).toBe('Invented removal body');
    expect(await audits('safety_report_rule.delete', rule.id)).toHaveLength(1);
    expect((await t.api.del(`/api/safety/report-rules/${rule.id}`)).status).toBe(404);
  });
});

describe('PATCH and DELETE /api/safety-events/:id/statements/:childId', () => {
  it('changes and removes a statement with safety.edit and security.view, auditing without the words', async () => {
    const ev = (await lead.post('/api/safety-events', { title: 'Statement event', occurred_at: hoursAgo(3), event_type: 'collision', severity: 'minor' })).body;
    const st = await lead.post(`/api/safety-events/${ev.id}/statements`, { statement_type: 'witness', given_by: 'Invented witness', given_on: '2026-01-05', text: 'Saw the invented collision.' });
    expect(st.status).toBe(201);

    const res = await lead.patch(`/api/safety-events/${ev.id}/statements/${st.body.id}`, { text: 'Corrected invented account.', statement_type: 'employee' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: st.body.id, text: 'Corrected invented account.', statement_type: 'employee', given_by: 'Invented witness' });
    const listed = (await lead.get(`/api/safety-events/${ev.id}/statements`)).body;
    expect(listed).toHaveLength(1);
    expect(listed[0].text).toBe('Corrected invented account.');
    const changed = await audits('safety_event.statements_update', ev.id);
    expect(changed).toHaveLength(1);
    expect(changed[0].summary).not.toContain('Corrected');
    expect(changed[0].after.changed.sort()).toEqual(['statement_type', 'text']);

    // Validation and not-found.
    expect((await lead.patch(`/api/safety-events/${ev.id}/statements/${st.body.id}`, { statement_type: 'nonsense' })).status).toBe(400);
    expect((await lead.patch(`/api/safety-events/${ev.id}/statements/${st.body.id}`, { text: '' })).status).toBe(400);
    expect((await lead.patch(`/api/safety-events/${ev.id}/statements/${MISSING}`, { text: 'x' })).status).toBe(404);
    const other = (await lead.post('/api/safety-events', { title: 'Other event', occurred_at: hoursAgo(3), event_type: 'collision', severity: 'minor' })).body;
    expect((await lead.patch(`/api/safety-events/${other.id}/statements/${st.body.id}`, { text: 'x' })).status).toBe(404);

    // Statements name people: safety.edit alone is not enough, nor is security.view without safety.edit.
    expect((await team.patch(`/api/safety-events/${ev.id}/statements/${st.body.id}`, { text: 'x' })).status).toBe(403);
    expect((await team.del(`/api/safety-events/${ev.id}/statements/${st.body.id}`)).status).toBe(403);
    const security = await t.as('security_lead'); // safety.view and security.view, no safety.edit
    expect((await security.del(`/api/safety-events/${ev.id}/statements/${st.body.id}`)).status).toBe(403);

    const gone = await lead.del(`/api/safety-events/${ev.id}/statements/${st.body.id}`);
    expect(gone.status).toBe(200);
    expect(gone.body).toEqual({ ok: true });
    expect((await lead.get(`/api/safety-events/${ev.id}/statements`)).body).toEqual([]);
    expect(await audits('safety_event.statements_remove', ev.id)).toHaveLength(1);
    expect((await lead.del(`/api/safety-events/${ev.id}/statements/${st.body.id}`)).status).toBe(404);
  });
});

describe('GET /api/vehicles/:id/safety-events and /api/services/:id/safety-events', () => {
  it('lists the events on one vehicle or service, hiding restricted ones without security.view', async () => {
    const bus = (await t.api.post('/api/vehicles', { fleet_number: 'RB-7001', mode: 'bus' })).body;
    const route = (await t.api.post('/api/services', { route_code: 'RB9', name: 'Invented crosstown route' })).body;
    const open = (await lead.post('/api/safety-events', { title: 'Mirror strike', occurred_at: hoursAgo(5), event_type: 'collision', severity: 'minor', vehicle_id: bus.id, service_id: route.id })).body;
    const hidden = (await lead.post('/api/safety-events', { title: 'Restricted injury on board', occurred_at: hoursAgo(4), event_type: 'passenger_injury', severity: 'minor', vehicle_id: bus.id, service_id: route.id })).body;
    expect(hidden.restricted).toBe(true);
    await lead.post('/api/safety-events', { title: 'Elsewhere', occurred_at: hoursAgo(4), event_type: 'collision', severity: 'minor' });

    for (const path of [`/api/vehicles/${bus.id}/safety-events`, `/api/services/${route.id}/safety-events`]) {
      const all = await lead.get(path);
      expect(all.status).toBe(200);
      expect(all.body.map((e: any) => e.id)).toEqual([hidden.id, open.id]); // newest first
      expect(Object.keys(all.body[0]).sort()).toEqual(['event_type', 'id', 'occurred_at', 'ref', 'severity', 'status', 'title']);
      expect((await team.get(path)).body.map((e: any) => e.id)).toEqual([open.id]);
      expect((await (await t.as('agent')).get(path)).status).toBe(403); // fleet.*, no safety.view
    }
    expect((await lead.get('/api/vehicles/not-a-uuid/safety-events')).status).toBe(404);
    expect((await lead.get(`/api/vehicles/${MISSING}/safety-events`)).body).toEqual([]);

    // A deleted event is left out.
    expect((await t.api.del(`/api/safety-events/${open.id}`)).status).toBe(200);
    expect((await lead.get(`/api/vehicles/${bus.id}/safety-events`)).body.map((e: any) => e.id)).toEqual([hidden.id]);
  });
});
