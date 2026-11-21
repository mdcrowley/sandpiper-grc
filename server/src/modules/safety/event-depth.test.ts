import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANONYMIZED_TEXT } from '../../core/retention.ts';
import { testApp } from '../../test/helpers.ts';
import { anonymizeEventDetails } from './event-detail.ts';
import { ruleMatches } from './reporting.ts';

// E25-01 to E25-06: the people involved, conditions, timeline and statements of a safety event, the
// organization's own reporting rules and the notification clocks they start. Everything is invented.
// GRC_MODULES=safety,risks,notifications (or all).

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let team: Client; // safety.* without security.view
let lead: Client; // safety.* and security.view

async function withGrants(key: string, grants: string[]) {
  const role = await t.db.one<{ id: string }>(`insert into roles (key, name, description, enabled) values ($1,$1,'test',true) returning id`, [key]);
  for (const g of grants) await t.db.query('insert into role_permissions (role_id, permission) values ($1,$2)', [role!.id, g]);
  return t.as(key);
}
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

beforeAll(async () => {
  t = await testApp();
  team = await withGrants('e25_team', ['safety.view', 'safety.create', 'safety.edit']);
  lead = await withGrants('e25_lead', ['safety.view', 'safety.create', 'safety.edit', 'security.view']);
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('event figures and conditions', () => {
  it('validates the new figures, coordinates and contributing factors', async () => {
    const bad = await t.api.post('/api/safety-events', {
      title: 'Test figures', occurred_at: hoursAgo(1), event_type: 'collision', severity: 'minor',
      fatalities: -1, damage_estimate: -5, latitude: 95, contributing_factors: ['made_up'],
    });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['contributing_factors', 'damage_estimate', 'fatalities', 'latitude', 'longitude']);
    expect((await t.api.post('/api/safety-events', { title: 'x', occurred_at: hoursAgo(1), event_type: 'collision', severity: 'minor', latitude: 40 })).body.error.fields.longitude).toMatch(/both/);
    const ok = await t.api.post('/api/safety-events', {
      title: 'Test conditions', occurred_at: hoursAgo(1), event_type: 'collision', severity: 'minor', weather: 'rain', lighting: 'dark_lit', surface: 'wet',
      latitude: 40.1, longitude: -75.2, contributing_factors: ['human', 'environment', 'human'], post_event_testing_required: true, evacuation: false, damage_estimate: 1200,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body).toMatchObject({ weather: 'rain', contributing_factors: ['human', 'environment'], post_event_testing_required: true, reportable: false });
  });
});

describe('people involved, timeline and statements', () => {
  let eventId = '';
  beforeAll(async () => {
    eventId = (await lead.post('/api/safety-events', { title: 'Test platform fall', occurred_at: hoursAgo(2), event_type: 'collision', severity: 'serious', restricted: false })).body.id;
  });

  it('needs security.view for people involved and statements, even on an event that is not restricted', async () => {
    expect((await team.get(`/api/safety-events/${eventId}`)).status).toBe(200);
    expect((await team.get(`/api/safety-events/${eventId}/people`)).status).toBe(403);
    expect((await team.post(`/api/safety-events/${eventId}/people`, { role: 'passenger' })).status).toBe(403);
    expect((await team.get(`/api/safety-events/${eventId}/statements`)).status).toBe(403);
    expect((await team.get(`/api/safety-events/${eventId}/timeline`)).status).toBe(200);
    expect((await lead.get(`/api/safety-events/${eventId}/people`)).status).toBe(200);
  });

  it('keeps fatalities and people taken for treatment in step with the people involved', async () => {
    expect((await lead.post(`/api/safety-events/${eventId}/people`, { role: 'astronaut' })).body.error.fields.role).toBeDefined();
    const a = await lead.post(`/api/safety-events/${eventId}/people`, { role: 'passenger', name: 'Invented Person A', injury_severity: 'hospital', transported: true });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    await lead.post(`/api/safety-events/${eventId}/people`, { role: 'public', injury_severity: 'medical', transported: true });
    let ev = (await lead.get(`/api/safety-events/${eventId}`)).body;
    expect(ev).toMatchObject({ fatalities: 0, people_transported: 2 });
    // Typed counts give way to the people recorded.
    ev = (await lead.patch(`/api/safety-events/${eventId}`, { people_transported: 9 })).body;
    expect(ev.people_transported).toBe(2);
    await lead.patch(`/api/safety-events/${eventId}/people/${a.body.id}`, { transported: false });
    expect((await lead.get(`/api/safety-events/${eventId}`)).body.people_transported).toBe(1);
    // The audit names the role, never the person.
    const history = (await t.api.get(`/api/history?record_type=safety_event&record_id=${eventId}`)).body;
    expect(JSON.stringify(history)).not.toContain('Invented Person A');
  });

  it('records the timeline and statements, and the person link only when the roster is there', async () => {
    const entry = await team.post(`/api/safety-events/${eventId}/timeline`, { at: hoursAgo(1.5), entry: 'Control room informed.' });
    expect(entry.status).toBe(201);
    expect(entry.body.by_id).toBe(team.userId);
    expect((await team.post(`/api/safety-events/${eventId}/timeline`, { at: new Date(Date.now() + 86_400_000).toISOString(), entry: 'x' })).body.error.fields.at).toMatch(/future/);
    const st = await lead.post(`/api/safety-events/${eventId}/statements`, { statement_type: 'witness', given_by: 'Invented Witness', given_on: '2026-01-05', text: 'I saw it.' });
    expect(st.status).toBe(201);
    const p = await lead.post(`/api/safety-events/${eventId}/people`, { role: 'employee', person_id: '00000000-0000-4000-8000-000000000001' });
    if (t.ctx.resources.get('person')) expect(p.status).toBe(400);
    else expect(p.body.person_id).toBeNull();
  });

  it('anonymizes the investigation record at the end of retention', async () => {
    const done = await anonymizeEventDetails(t.db, eventId);
    expect(done.people).toBeGreaterThan(0);
    expect(done.statements).toBe(1);
    const people = (await lead.get(`/api/safety-events/${eventId}/people`)).body;
    expect(people.find((x: any) => x.role === 'passenger').name).toBe(ANONYMIZED_TEXT);
    expect(people.find((x: any) => x.role === 'public').name).toBeNull();
    const st = (await lead.get(`/api/safety-events/${eventId}/statements`)).body[0];
    expect(st).toMatchObject({ given_by: ANONYMIZED_TEXT, text: ANONYMIZED_TEXT, statement_type: 'witness' });
  });
});

describe('reporting rules and clocks', () => {
  it('matches conditions', () => {
    const ev = { fatalities: 1, people_transported: 0, damage_estimate: 500, evacuation: true, event_type: 'collision', severity: 'serious' };
    expect(ruleMatches([{ field: 'fatalities', op: 'gte', value: 1 }], ev)).toBe(true);
    expect(ruleMatches([{ field: 'fatalities', op: 'gte', value: 1 }, { field: 'event_type', op: 'in', value: ['fire'] }], ev)).toBe(false);
    expect(ruleMatches([{ field: 'evacuation', op: 'is', value: true }, { field: 'damage_estimate', op: 'gt', value: 499 }], ev)).toBe(true);
    expect(ruleMatches([], ev)).toBe(false);
  });

  it('lets only safety administrators keep the rules, and validates them', async () => {
    expect((await team.post('/api/safety/report-rules', { name: 'x' })).status).toBe(403);
    expect((await team.get('/api/safety/report-rules')).status).toBe(200);
    const bad = await t.api.post('/api/safety/report-rules', { name: 'Bad', party: '', deadline_hours: -1, conditions: [{ field: 'fatalities', op: 'in', value: 1 }] });
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['conditions.0', 'deadline_hours', 'party']);
    expect((await t.api.post('/api/safety/report-rules', { name: 'None', party: 'Invented body', deadline_hours: 2, conditions: [] })).body.error.fields.conditions).toBeDefined();
  });

  let fatal = ''; let damage = '';
  it('starts a clock when a rule newly applies, and sets it aside when it no longer does', async () => {
    fatal = (await t.api.post('/api/safety/report-rules', {
      name: 'Invented example: any fatality', party: 'Invented oversight body', deadline_hours: 2, active: true,
      conditions: [{ field: 'fatalities', op: 'gte', value: 1 }],
    })).body.id;
    damage = (await t.api.post('/api/safety/report-rules', {
      name: 'Invented example: damage', party: 'Invented insurer', deadline_hours: 72, required: false,
      conditions: [{ field: 'damage_estimate', op: 'gte', value: 25000 }],
    })).body.id;
    expect((await t.api.get('/api/safety/report-rules')).body.rules.find((r: any) => r.id === damage).active).toBe(false);

    const ev = (await lead.post('/api/safety-events', { title: 'Test reportable', occurred_at: hoursAgo(1), event_type: 'collision', severity: 'major', damage_estimate: 30000 })).body;
    expect(ev.reportable).toBe(false); // the damage rule is switched off; no fatality yet
    await lead.post(`/api/safety-events/${ev.id}/people`, { role: 'public', fatality: true, injury_severity: 'fatal' });
    let clocks = (await lead.get(`/api/safety-events/${ev.id}/clocks`)).body;
    expect(clocks.reportable).toBe(true);
    expect(clocks.reasons.map((r: any) => r.rule_id)).toEqual([fatal]);
    expect(clocks.clocks).toHaveLength(1);
    // Two hours from an event an hour ago: half the window left, so green.
    expect(clocks.clocks[0]).toMatchObject({ party: 'Invented oversight body', status: 'pending', state: 'green' });
    const timeline = (await lead.get(`/api/safety-events/${ev.id}/timeline`)).body;
    expect(timeline.some((e: any) => /Invented oversight body/.test(e.entry) && e.by_id === null)).toBe(true);
    // Application entries cannot be changed.
    const auto = timeline.find((e: any) => e.by_id === null);
    expect((await lead.patch(`/api/safety-events/${ev.id}/timeline/${auto.id}`, { entry: 'changed' })).status).toBe(409);

    // Saving again does not start a second clock; correcting the time moves the deadline and turns it red.
    await lead.patch(`/api/safety-events/${ev.id}`, { occurred_at: hoursAgo(3) });
    clocks = (await lead.get(`/api/safety-events/${ev.id}/clocks`)).body;
    expect(clocks.clocks).toHaveLength(1);
    expect(clocks.clocks[0].state).toBe('red');
    const audit = await t.db.query(`select action from audit_events where record_id = $1 and action like 'safety_notification.alert_%'`, [ev.id]);
    expect(audit.map((a: any) => a.action)).toContain('safety_notification.alert_red');

    // The person turns out not to have died: the rule no longer applies.
    const person = (await lead.get(`/api/safety-events/${ev.id}/people`)).body[0];
    await lead.patch(`/api/safety-events/${ev.id}/people/${person.id}`, { fatality: false, injury_severity: 'hospital' });
    clocks = (await lead.get(`/api/safety-events/${ev.id}/clocks`)).body;
    expect(clocks.reportable).toBe(false);
    expect(clocks.clocks[0]).toMatchObject({ status: 'not_required', state: 'not_required' });
    // ...and applies again when corrected back.
    await lead.patch(`/api/safety-events/${ev.id}/people/${person.id}`, { fatality: true });
    expect((await lead.get(`/api/safety-events/${ev.id}/clocks`)).body.clocks[0].status).toBe('pending');

    // Recording the notification.
    const c = (await lead.get(`/api/safety-events/${ev.id}/clocks`)).body.clocks[0];
    expect((await lead.post(`/api/safety-notifications/${c.id}/complete`, {})).body.error.fields).toMatchObject({ notified_who: expect.any(String), notified_how: expect.any(String) });
    const done = await lead.post(`/api/safety-notifications/${c.id}/complete`, { notified_who: 'Invented duty officer', notified_how: 'Phone', reference_received: 'INV-1' });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body).toMatchObject({ status: 'done', state: 'met', late: true });
    expect((await lead.post(`/api/safety-notifications/${c.id}/complete`, { notified_who: 'x', notified_how: 'y' })).status).toBe(409);
  });

  it('hides clocks of restricted events from people without security.view, but counts them for everyone', async () => {
    const ev = (await lead.post('/api/safety-events', { title: 'Test restricted fatal', occurred_at: hoursAgo(0.5), event_type: 'passenger_injury', severity: 'major', fatalities: 1 })).body;
    expect(ev.restricted).toBe(true);
    expect(ev.reportable).toBe(true);
    const mine = (await lead.get('/api/safety/clocks')).body;
    const theirs = (await team.get('/api/safety/clocks')).body;
    expect(mine.summary).toEqual(theirs.summary);
    expect(mine.clocks.some((c: any) => c.event.id === ev.id)).toBe(true);
    expect(theirs.clocks.some((c: any) => c.event.id === ev.id)).toBe(false);
    const clock = mine.clocks.find((c: any) => c.event.id === ev.id);
    expect((await team.post(`/api/safety-notifications/${clock.id}/complete`, { status: 'not_required', note: 'x' })).status).toBe(404);
    expect((await lead.post(`/api/safety-notifications/${clock.id}/complete`, { status: 'not_required' })).body.error.fields.note).toBeDefined();
    expect((await lead.post(`/api/safety-notifications/${clock.id}/complete`, { status: 'not_required', note: 'Invented: reported by another operator' })).body.status).toBe('not_required');
  });

  it('removes an event for good with its investigation record', async () => {
    const ev = (await lead.post('/api/safety-events', { title: 'Test purge', occurred_at: hoursAgo(1), event_type: 'collision', severity: 'minor', fatalities: 1 })).body;
    await lead.post(`/api/safety-events/${ev.id}/statements`, { statement_type: 'other', text: 'Invented.' });
    await t.db.query('delete from safety_events where id = $1', [ev.id]); // what a retention purge does
    expect(await t.db.query('select 1 from safety_notifications where event_id = $1', [ev.id])).toHaveLength(0);
    expect(await t.db.query('select 1 from safety_event_statements where event_id = $1', [ev.id])).toHaveLength(0);
  });
});
