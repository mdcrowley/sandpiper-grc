import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { loadOrganizationRules, RULES } from './defaults.ts';
import mod from './index.ts';

// Invented data only. Run alone with GRC_MODULES=secincidents.

/** An invented organization's notification rules, in the shape of the organization profile. */
const ORG_RULES = [
  { key: 'test_agency_a', trigger: 'is_cyber_incident', party: 'Agency A', hours: 24, required: false, active: true, guidance: 'Invented: recommended within 24 hours.' },
  { key: 'test_agency_b', trigger: 'is_cyber_incident', party: 'Agency B', hours: 168, required: true, active: true, guidance: 'Invented: required within 7 days.' },
  { key: 'test_agency_c', trigger: 'is_cyber_incident', party: 'Agency C', hours: 720, required: true, active: true, guidance: 'Invented: required within 30 days.' },
  { key: 'test_partner_d', trigger: 'kind:special_records', party: 'Partner D', hours: 72, required: true, active: true, guidance: 'Invented: required within 3 days.' },
  { key: 'test_acquirer_e', trigger: 'kind:card_payments', party: 'Acquirer E', hours: 0, required: true, active: true, guidance: 'Invented: immediately.' },
  { key: 'test_insurer_f', trigger: 'any', party: 'Insurer F', hours: null, required: true, active: false, guidance: 'Invented: no deadline set.' },
  { key: 'test_individuals_g', trigger: 'personal_info_involved', party: 'Individuals G', hours: null, required: true, active: false, guidance: 'Invented: no deadline set.' },
];
const DEFAULT_PARTIES = RULES.map((r) => r.party);

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
  // Kinds of data that this invented organization holds; in an installation they come from the organization profile.
  await t.ctx.lookups.ensure('incident_data_kind', [
    { value: 'special_records', label: 'Special records', meta: { hint: 'Invented kind.' } },
    { value: 'card_payments', label: 'Card payments' },
  ], { module: 'security' });
});
afterAll(async () => { await t.close(); });

const HOUR = 3_600_000;
const DISCOVERED = new Date(Date.now() - 2 * HOUR);
const plus = (hours: number) => new Date(DISCOVERED.getTime() + hours * HOUR).toISOString();
const iso = (v: unknown) => new Date(v as string).toISOString();

async function tasksOf(id: string) {
  return (await t.api.get(`/api/notification-tasks?f.incident_id=${id}&pageSize=100`)).body.rows as any[];
}

async function declare(extra: Record<string, unknown> = {}) {
  const made = await t.api.post('/api/security-incidents', {
    title: 'Test incident: invented scheduling outage', scenario: 'ransomware', severity: 'high',
    discovered_at: DISCOVERED.toISOString(), ...extra,
  });
  expect(made.status).toBe(201);
  const declared = await t.api.patch(`/api/security-incidents/${made.body.id}`, { status: 'declared' });
  expect(declared.status).toBe(200);
  return declared.body;
}

describe('regulatory clocks', () => {
  let incident: any;

  it('ships only generic starter rules, all switched off and without a deadline', async () => {
    const rules = (await t.api.get('/api/security-notification-rules')).body as any[];
    expect(rules.length).toBe(RULES.length);
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.every((r) => r.active === false && r.deadline_hours === null)).toBe(true);
    expect(rules.map((r) => r.party).sort()).toEqual([...DEFAULT_PARTIES].sort());
    expect(new Set(rules.map((r) => r.trigger_attribute))).toEqual(
      new Set(['any', 'is_cyber_incident', 'personal_info_involved']));
    // No built-in rule, question or list value names a kind of data that only some organizations hold.
    const builtIn = JSON.stringify([RULES, (await import('./defaults.ts')).LOOKUPS]).toLowerCase();
    expect(builtIn).not.toMatch(/health|card|patient|student/);

    // With nothing switched on, declaring an incident starts no clocks.
    const quiet = await declare({ title: 'Test incident: before any rule is set up', data_kinds: ['special_records', 'card_payments'] });
    expect(await tasksOf(quiet.id)).toEqual([]);
    await t.api.patch(`/api/security-incidents/${quiet.id}`, { status: 'closed' });
  });

  it('loads the organization\'s own rules from its profile', async () => {
    expect(await loadOrganizationRules(t.ctx, ORG_RULES)).toBe(ORG_RULES.length);
    const rules = (await t.api.get('/api/security-notification-rules')).body as any[];
    expect(rules.length).toBe(RULES.length + ORG_RULES.length);
    const by = (party: string) => rules.find((r) => r.party === party);
    expect(by('Agency A')).toMatchObject({ deadline_hours: 24, required: false, active: true, trigger_attribute: 'is_cyber_incident' });
    expect(by('Agency B')).toMatchObject({ deadline_hours: 168, required: true, active: true });
    expect(by('Agency C')).toMatchObject({ deadline_hours: 720, required: true, active: true });
    expect(by('Partner D')).toMatchObject({ deadline_hours: 72, trigger_attribute: 'kind:special_records' });
    expect(by('Acquirer E')).toMatchObject({ deadline_hours: 0, trigger_attribute: 'kind:card_payments', active: true });
    expect(by('Insurer F')).toMatchObject({ deadline_hours: null, active: false });
    expect(by('Individuals G')).toMatchObject({ deadline_hours: null, active: false });
    // The starter rules stay off.
    expect(rules.filter((r) => DEFAULT_PARTIES.includes(r.party)).every((r) => !r.active)).toBe(true);
  });

  it('refuses a profile rule that could not work', async () => {
    const base = { key: 'test_bad', trigger: 'any', party: 'Nobody', hours: 1, required: true, active: true, guidance: '' };
    await expect(loadOrganizationRules(t.ctx, [{ ...base, trigger: 'no_such_flag' }])).rejects.toThrow(/trigger/);
    await expect(loadOrganizationRules(t.ctx, [{ ...base, trigger: 'kind:no_such_kind' }])).rejects.toThrow(/trigger/);
    await expect(loadOrganizationRules(t.ctx, [{ ...base, hours: null }])).rejects.toThrow(/deadline/);
    await expect(loadOrganizationRules(t.ctx, [{ ...base, key: '' }])).rejects.toThrow(/key/);
    await expect(loadOrganizationRules(t.ctx, { not: 'a list' })).rejects.toThrow(/list/);
    expect(await loadOrganizationRules(t.ctx, undefined)).toBe(0);
    expect(((await t.api.get('/api/security-notification-rules')).body as any[]).some((r) => r.party === 'Nobody')).toBe(false);
  });

  it('creates no tasks before the incident is declared', async () => {
    const made = await t.api.post('/api/security-incidents', { title: 'Test incident: only reported', data_kinds: ['special_records'] });
    expect(made.body.ref).toMatch(/^SEC-\d{5}$/);
    expect(made.body.declared_at).toBeNull();
    expect(await tasksOf(made.body.id)).toEqual([]);
  });

  it('declaring an incident with a configured kind of data creates exactly four tasks with deadlines from discovery', async () => {
    incident = await declare({ data_kinds: ['special_records'] });
    expect(incident.status).toBe('declared');
    expect(incident.declared_at).toBeTruthy();
    const tasks = await tasksOf(incident.id);
    expect(tasks.length).toBe(4);
    const due = Object.fromEntries(tasks.map((x) => [x.party, iso(x.due_at)]));
    expect(due).toEqual({
      'Agency A': plus(24),
      'Agency B': plus(7 * 24),
      'Agency C': plus(30 * 24),
      'Partner D': plus(3 * 24),
    });
    expect(tasks.every((x) => x.status === 'pending' && /^NOT-\d{5}$/.test(x.ref))).toBe(true);
    expect(tasks.find((x) => x.party === 'Agency A').required).toBe(false);
  });

  it('adds an immediate task when another kind of data is flagged, without duplicating the others', async () => {
    const res = await t.api.patch(`/api/security-incidents/${incident.id}`, { data_kinds: ['special_records', 'card_payments'] });
    expect(res.status).toBe(200);
    let tasks = await tasksOf(incident.id);
    expect(tasks.length).toBe(5);
    const card = tasks.find((x) => x.party === 'Acquirer E');
    expect(iso(card.due_at)).toBe(DISCOVERED.toISOString());
    // An unrelated edit and a repeat of the same flag change nothing.
    await t.api.patch(`/api/security-incidents/${incident.id}`, { summary: 'Edited', data_kinds: ['card_payments', 'special_records'] });
    tasks = await tasksOf(incident.id);
    expect(tasks.length).toBe(5);
    expect(new Set(tasks.map((x) => x.rule_id)).size).toBe(5);
  });

  it('reports clocks as green, amber and red with seconds remaining', async () => {
    const res = await t.api.get(`/api/security-incidents/${incident.id}/clocks`);
    expect(res.status).toBe(200);
    const by = (party: string) => res.body.clocks.find((c: any) => c.party === party);
    expect(by('Acquirer E')).toMatchObject({ state: 'red', overdue: true });
    expect(by('Agency A').state).toBe('green');
    expect(by('Agency A').seconds_remaining).toBeGreaterThan(21 * 3600);
    expect(by('Agency A').seconds_remaining).toBeLessThanOrEqual(22 * 3600);
    expect(res.body.clocks[0].party).toBe('Acquirer E');

    // Discovered 20 hours ago: 4 of Agency A's 24 hours remain (under a quarter), so amber.
    const late = await declare({ discovered_at: new Date(Date.now() - 20 * HOUR).toISOString() });
    const clocks = (await t.api.get(`/api/security-incidents/${late.id}/clocks`)).body.clocks;
    expect(clocks.length).toBe(3);
    expect(clocks.find((c: any) => c.party === 'Agency A').state).toBe('amber');
    expect(clocks.find((c: any) => c.party === 'Agency B').state).toBe('green');

    const all = await t.api.get('/api/security-incidents/clocks');
    expect(all.body.summary.red).toBe(1);
    expect(all.body.summary.amber).toBe(1);
    expect(all.body.clocks[0].incident.ref).toBe(incident.ref);
  });

  it('records who, how, when and the reference when a task is completed', async () => {
    const lead = await t.as('security_lead');
    const task = (await tasksOf(incident.id)).find((x) => x.party === 'Agency A');
    const missing = await lead.patch(`/api/notification-tasks/${task.id}`, { status: 'done' });
    expect(missing.status).toBe(400);
    expect(Object.keys(missing.body.error.fields).sort()).toEqual(['notified_how', 'notified_who']);

    const when = new Date(Date.now() - 30 * 60_000).toISOString();
    const done = await lead.patch(`/api/notification-tasks/${task.id}`, {
      status: 'done', notified_who: 'Duty officer (invented)', notified_how: 'Web form', notified_at: when, reference_received: 'TEST-REF-001',
    });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: 'done', notified_who: 'Duty officer (invented)', notified_how: 'Web form', reference_received: 'TEST-REF-001', completed_by: lead.userId });
    expect(iso(done.body.notified_at)).toBe(when);
    expect(done.body.completed_at).toBeTruthy();

    const clock = (await t.api.get(`/api/security-incidents/${incident.id}/clocks`)).body.clocks.find((c: any) => c.party === 'Agency A');
    expect(clock).toMatchObject({ state: 'met', late: false, seconds_remaining: null, reference_received: 'TEST-REF-001' });
    const log = (await t.api.get(`/api/security-incidents/${incident.id}/log`)).body as any[];
    expect(log.some((e) => e.kind === 'communication' && e.entry.includes('TEST-REF-001'))).toBe(true);
    expect((await t.api.del(`/api/notification-tasks/${task.id}`)).status).toBe(409);
  });

  it('recomputes open tasks when the discovery time changes and leaves completed tasks alone', async () => {
    const earlier = new Date(DISCOVERED.getTime() - 5 * HOUR);
    await t.api.patch(`/api/security-incidents/${incident.id}`, { discovered_at: earlier.toISOString() });
    const tasks = await tasksOf(incident.id);
    expect(tasks.length).toBe(5);
    expect(iso(tasks.find((x) => x.party === 'Agency B').due_at)).toBe(new Date(earlier.getTime() + 168 * HOUR).toISOString());
    const first = tasks.find((x) => x.party === 'Agency A');
    expect(first.status).toBe('done');
    expect(iso(first.due_at)).toBe(plus(24));
  });

  it('marks an open task not required when its trigger is cleared, and reopens it if set again', async () => {
    await t.api.patch(`/api/security-incidents/${incident.id}`, { data_kinds: ['special_records'] });
    const card = async () => (await tasksOf(incident.id)).find((x) => x.party === 'Acquirer E');
    expect((await card()).status).toBe('not_required');
    await t.api.patch(`/api/security-incidents/${incident.id}`, { data_kinds: ['special_records', 'card_payments'] });
    expect((await card()).status).toBe('pending');
    expect((await tasksOf(incident.id)).length).toBe(5);
  });

  it('lets an administrator switch on a rule by setting its deadline, and open incidents pick it up', async () => {
    const rules = (await t.api.get('/api/security-notification-rules')).body as any[];
    const insurer = rules.find((r) => r.party === 'Insurer F');
    const noDeadline = await t.api.patch(`/api/security-notification-rules/${insurer.id}`, { active: true });
    expect(noDeadline.status).toBe(400);
    expect(noDeadline.body.error.fields.deadline_hours).toMatch(/deadline/i);
    expect((await t.api.patch(`/api/security-notification-rules/${insurer.id}`, { active: true, deadline_hours: 48 })).status).toBe(200);
    const tasks = await tasksOf(incident.id);
    expect(tasks.length).toBe(6);
    expect(tasks.filter((x) => x.party === 'Insurer F').length).toBe(1);
    await t.api.patch(`/api/security-notification-rules/${insurer.id}`, { active: false });
  });

  it('previews the notifications for a set of answers without saving anything', async () => {
    const before = (await t.api.get('/api/security-incidents')).body.total;
    const res = await t.api.post('/api/security-incidents/notification-preview', {
      discovered_at: DISCOVERED.toISOString(), is_cyber_incident: true, data_kinds: ['special_records'], personal_info_involved: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.notifications.map((n: any) => n.party).sort()).toEqual(['Agency A', 'Agency B', 'Agency C', 'Partner D']);
    expect(res.body.notifications.find((n: any) => n.party === 'Agency A').due_at).toBe(plus(24));
    // Rules that apply but are switched off: the organization's two, and every starter rule.
    expect(res.body.not_configured.map((n: any) => n.party).sort()).toEqual(
      ['Individuals G', 'Insurer F', ...RULES.map((r) => r.party)].sort());
    expect((await t.api.get('/api/security-incidents')).body.total).toBe(before);
  });

  it('asks one question per built-in flag and per configured kind of data, and offers each as a rule trigger', async () => {
    const res = await t.api.get('/api/security-incidents/questions');
    expect(res.status).toBe(200);
    expect(res.body.questions.filter((q: any) => q.kind === 'flag').map((q: any) => q.key)).toEqual(['is_cyber_incident', 'personal_info_involved']);
    expect(res.body.questions.find((q: any) => q.key === 'kind:special_records')).toMatchObject({
      kind: 'data_kind', value: 'special_records', question: 'Could special records be involved?', hint: 'Invented kind.',
    });
    expect(res.body.triggers.map((x: any) => x.value)).toEqual(expect.arrayContaining(['any', 'is_cyber_incident', 'kind:card_payments']));

    // A kind an administrator adds to the list is asked about and can trigger a rule straight away.
    await t.api.post('/api/lookups', { list_key: 'incident_data_kind', value: 'test_kind', label: 'Test kind' });
    const rule = await t.api.post('/api/security-notification-rules', { trigger_attribute: 'kind:test_kind', party: 'Party T', deadline_hours: 12 });
    expect(rule.status).toBe(201);
    expect((await t.api.post('/api/security-notification-rules', { trigger_attribute: 'kind:nope', party: 'Nobody', deadline_hours: 1 })).status).toBe(400);
    expect((await t.api.post('/api/security-notification-rules', { trigger_attribute: 'health_data_involved', party: 'Nobody', deadline_hours: 1 })).status).toBe(400);
    const preview = await t.api.post('/api/security-incidents/notification-preview', { data_kinds: ['test_kind'] });
    expect(preview.body.notifications.map((n: any) => n.party)).toEqual(['Party T']);
    expect((await t.api.del(`/api/security-notification-rules/${rule.body.id}`)).status).toBe(200);
  });

  it('refuses a kind of data that is not on the list', async () => {
    const bad = await t.api.post('/api/security-incidents', { title: 'Test incident: bad kind', data_kinds: ['no_such_kind'] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.data_kinds).toBeTruthy();
    expect((await t.api.patch(`/api/security-incidents/${incident.id}`, { data_kinds: 'special_records' })).status).toBe(400);
  });

  it('maps the former built-in triggers of an older profile to kinds of data', async () => {
    expect(await loadOrganizationRules(t.ctx, [
      { key: 'test_legacy_x', trigger: 'card_data_involved', party: 'Legacy X', hours: 2, required: true, active: false, guidance: '' },
    ])).toBe(1);
    const rule = ((await t.api.get('/api/security-notification-rules')).body as any[]).find((r) => r.party === 'Legacy X');
    expect(rule.trigger_attribute).toBe('kind:payment_card_data');
    expect((await t.ctx.lookups.values('incident_data_kind')).map((k) => k.value)).toContain('payment_card_data');
    await t.api.del(`/api/security-notification-rules/${rule.id}`);
  });
});

describe('incident workspace', () => {
  let id: string;

  it('copies the scenario checklist and the standing roles onto a new incident', async () => {
    const made = await t.api.post('/api/security-incidents', { title: 'Test incident: lost tablet', scenario: 'lost_device' });
    id = made.body.id;
    const items = (await t.api.get(`/api/security-incidents/${id}/checklist`)).body as any[];
    expect(items.length).toBeGreaterThan(5);
    expect(new Set(items.map((i) => i.phase))).toEqual(new Set(['containment', 'recovery']));
    expect(items.every((i) => i.scenario === 'lost_device' && i.done === false)).toBe(true);
    const roles = (await t.api.get(`/api/security-incidents/${id}/roles`)).body as any[];
    expect(roles.map((r) => r.role)).toContain('Incident lead');
    expect(roles.map((r) => r.role)).toContain('Scribe');
    const history = (await t.api.get(`/api/history?record_type=security_incident&record_id=${id}`)).body as any[];
    expect(history.map((h) => h.action)).toEqual(expect.arrayContaining(['security_incident.roles_copied', 'security_incident.checklist_copied']));
  });

  it('ticks checklist steps with who and when, and keeps ticked steps when the scenario changes', async () => {
    const lead = await t.as('security_lead');
    const items = (await t.api.get(`/api/security-incidents/${id}/checklist`)).body as any[];
    const ticked = await lead.patch(`/api/security-incidents/${id}/checklist/${items[0].id}`, { done: true });
    expect(ticked.body).toMatchObject({ done: true, done_by: lead.userId });
    expect(ticked.body.done_at).toBeTruthy();
    expect(ticked.body.done_by_name).toMatch(/security_lead/);

    await t.api.patch(`/api/security-incidents/${id}`, { scenario: 'account_compromise' });
    const after = (await t.api.get(`/api/security-incidents/${id}/checklist`)).body as any[];
    expect(after.filter((i) => i.scenario === 'lost_device').map((i) => i.id)).toEqual([items[0].id]);
    expect(after.filter((i) => i.scenario === 'account_compromise').length).toBeGreaterThan(5);
    const cleared = await t.db.query(`select 1 from audit_events where action = 'security_incident.checklist_cleared' and record_id = $1`, [id]);
    expect(cleared.length).toBe(1);

    const custom = await t.api.post(`/api/security-incidents/${id}/checklist`, { phase: 'recovery', step: 'Invented extra step' });
    expect(custom.status).toBe(201);
    expect((await t.api.post(`/api/security-incidents/${id}/checklist`, { phase: 'nonsense', step: 'x' })).status).toBe(400);
  });

  it('lets an administrator edit checklist templates as data', async () => {
    const add = await t.api.post('/api/security-checklist-templates', { scenario: 'other', phase: 'containment', step: 'Invented template step' });
    expect(add.status).toBe(201);
    const made = await t.api.post('/api/security-incidents', { title: 'Test incident: something else', scenario: 'other' });
    const items = (await t.api.get(`/api/security-incidents/${made.body.id}/checklist`)).body as any[];
    expect(items.map((i) => i.step)).toEqual(['Invented template step']);
    expect((await t.api.patch(`/api/security-checklist-templates/${add.body.id}`, { step: 'Reworded step' })).body.step).toBe('Reworded step');
    expect((await t.api.del(`/api/security-checklist-templates/${add.body.id}`)).status).toBe(200);
    expect(((await t.api.get('/api/security-checklist-templates?scenario=other')).body as any[]).length).toBe(0);
  });

  it('keeps roles and an evidence register', async () => {
    const role = await t.api.post(`/api/security-incidents/${id}/roles`, { role: 'Forensics liaison', person_name: 'Pat Example', contact: '555-0100' });
    expect(role.status).toBe(201);
    expect((await t.api.patch(`/api/security-incidents/${id}/roles/${role.body.id}`, { contact: '555-0101' })).body.contact).toBe('555-0101');
    expect((await t.api.del(`/api/security-incidents/${id}/roles/${role.body.id}`)).status).toBe(200);

    expect((await t.api.post(`/api/security-incidents/${id}/evidence`, {})).body.error.fields.item).toBeTruthy();
    const ev = await t.api.post(`/api/security-incidents/${id}/evidence`, {
      item: 'Disk image of test tablet', where_held: 'Locked cabinet (invented)', collected_by: 'Pat Example',
      collected_at: new Date().toISOString(), hash_ref: 'sha256:0000-invented',
    });
    expect(ev.status).toBe(201);
    expect(((await t.api.get(`/api/security-incidents/${id}/evidence`)).body as any[])[0].hash_ref).toBe('sha256:0000-invented');
    const history = (await t.api.get(`/api/history?record_type=security_incident&record_id=${id}`)).body as any[];
    expect(history.map((h) => h.action)).toContain('security_incident.evidence_add');
  });

  it('keeps an append-only log: entries can be added but never changed or removed', async () => {
    const add = await t.api.post(`/api/security-incidents/${id}/log`, { entry: 'Invented log entry', kind: 'action' });
    expect(add.status).toBe(201);
    expect(add.body).toMatchObject({ entry: 'Invented log entry', kind: 'action', author_name: 'Test Admin' });
    expect((await t.api.post(`/api/security-incidents/${id}/log`, { entry: '   ' })).status).toBe(400);
    expect((await t.api.post(`/api/security-incidents/${id}/log`, { entry: 'x', at: new Date(Date.now() + 2 * HOUR).toISOString() })).status).toBe(400);

    const log = (await t.api.get(`/api/security-incidents/${id}/log`)).body as any[];
    expect(log.map((e) => e.entry)).toContain('Invented log entry');

    // The database refuses changes...
    await expect(t.db.query(`update incident_log_entries set entry = 'tampered' where id = $1`, [add.body.id])).rejects.toThrow(/append-only/);
    await expect(t.db.query(`delete from incident_log_entries where id = $1`, [add.body.id])).rejects.toThrow(/append-only/);
    // ...and there is no route to try.
    expect((await t.api.patch(`/api/security-incidents/${id}/log/${add.body.id}`, { entry: 'tampered' })).status).toBe(404);
    expect((await t.api.del(`/api/security-incidents/${id}/log/${add.body.id}`)).status).toBe(404);
    expect((await t.api.patch(`/api/security-incidents/${id}/log`, { entry: 'tampered' })).status).toBe(404);
    expect((await t.api.del(`/api/security-incidents/${id}/log`)).status).toBe(404);
  });

  it('blocks ransom approval without a payment approval reference, and audits the decision', async () => {
    const blocked = await t.api.patch(`/api/security-incidents/${id}`, { ransom_payment_status: 'approved' });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.fields.board_resolution_ref).toMatch(/payment approval reference/);
    expect((await t.api.patch(`/api/security-incidents/${id}`, { ransom_payment_status: 'approved', board_resolution_ref: '   ' })).status).toBe(400);
    expect((await t.api.post('/api/security-incidents', { title: 'Test incident: approve at once', ransom_payment_status: 'approved' })).status).toBe(400);

    expect((await t.api.patch(`/api/security-incidents/${id}`, { ransom_payment_status: 'under_consideration' })).status).toBe(200);
    const ok = await t.api.patch(`/api/security-incidents/${id}`, { ransom_payment_status: 'approved', board_resolution_ref: 'TEST-RES-2026-01' });
    expect(ok.body.ransom_payment_status).toBe('approved');
    // The reference cannot be removed while the payment stays approved.
    expect((await t.api.patch(`/api/security-incidents/${id}`, { board_resolution_ref: '' })).status).toBe(400);

    const events = await t.db.query<any>(
      `select after from audit_events where action = 'security_incident.ransom_decision' and record_id = $1 order by id`, [id]);
    expect(events.length).toBe(2);
    expect(events[1].after).toEqual({ ransom_payment_status: 'approved', board_resolution_ref: 'TEST-RES-2026-01' });
  });

  it('stamps the lifecycle times as the status moves on', async () => {
    const closed = await t.api.patch(`/api/security-incidents/${id}`, { status: 'closed' });
    expect(closed.body.declared_at).toBeTruthy();
    expect(closed.body.contained_at).toBeTruthy();
    expect(closed.body.closed_at).toBeTruthy();
  });

  it('bundles rules, contacts and checklists into the offline kit', async () => {
    const kit = await t.api.get('/api/security-incidents/kit');
    expect(kit.status).toBe(200);
    expect(kit.body.rules.length).toBe(RULES.length + ORG_RULES.length);
    expect(kit.body.questions.map((q: any) => q.key)).toEqual(expect.arrayContaining(['is_cyber_incident', 'kind:special_records']));
    expect(kit.body.rules.find((r: any) => r.party === 'Partner D').trigger_label).toBe('Special records involved');
    expect(kit.body.rules[0].trigger_label).toBeTruthy();
    expect(kit.body.contacts.map((c: any) => c.role)).toContain('Executive sponsor');
    expect(kit.body.checklists.map((c: any) => c.scenario).sort()).toEqual(
      ['account_compromise', 'dispatch_outage', 'fare_system_compromise', 'lost_device', 'onboard_network_compromise',
        'payment_fraud', 'ransomware', 'vendor_compromise']);
    expect(kit.body.checklists.every((c: any) => c.containment.length > 3 && c.recovery.length > 3)).toBe(true);
  });
});

describe('restricted behavior', () => {
  it('hides the whole module from an ordinary agent, including the hand-written routes', async () => {
    const agent = await t.as('agent');
    const incident = (await t.api.get('/api/security-incidents?q=invented scheduling')).body.rows[0];
    const task = (await tasksOf(incident.id))[0];
    const rule = ((await t.api.get('/api/security-notification-rules')).body as any[])[0];
    const item = ((await t.api.get(`/api/security-incidents/${incident.id}/checklist`)).body as any[])[0];
    const i = `/api/security-incidents/${incident.id}`;
    const refused = (status: number) => status === 403 || status === 404;

    const calls: [string, Promise<{ status: number }>][] = [
      ['list', agent.get('/api/security-incidents')],
      ['csv', agent.get('/api/security-incidents?format=csv')],
      ['stats', agent.get('/api/security-incidents/stats?group=status')],
      ['get', agent.get(i)],
      ['create', agent.post('/api/security-incidents', { title: 'Nope' })],
      ['update', agent.patch(i, { title: 'Nope' })],
      ['delete', agent.del(i)],
      ['clocks', agent.get(`${i}/clocks`)],
      ['all clocks', agent.get('/api/security-incidents/clocks')],
      ['kit', agent.get('/api/security-incidents/kit')],
      ['questions', agent.get('/api/security-incidents/questions')],
      ['preview', agent.post('/api/security-incidents/notification-preview', { is_cyber_incident: true })],
      ['log list', agent.get(`${i}/log`)],
      ['log add', agent.post(`${i}/log`, { entry: 'Nope' })],
      ['checklist list', agent.get(`${i}/checklist`)],
      ['checklist add', agent.post(`${i}/checklist`, { phase: 'recovery', step: 'Nope' })],
      ['checklist tick', agent.patch(`${i}/checklist/${item.id}`, { done: true })],
      ['roles list', agent.get(`${i}/roles`)],
      ['roles add', agent.post(`${i}/roles`, { role: 'Nope' })],
      ['evidence list', agent.get(`${i}/evidence`)],
      ['evidence add', agent.post(`${i}/evidence`, { item: 'Nope' })],
      ['tasks list', agent.get('/api/notification-tasks')],
      ['task get', agent.get(`/api/notification-tasks/${task.id}`)],
      ['task update', agent.patch(`/api/notification-tasks/${task.id}`, { status: 'not_required' })],
      ['task delete', agent.del(`/api/notification-tasks/${task.id}`)],
      ['rules list', agent.get('/api/security-notification-rules')],
      ['rules add', agent.post('/api/security-notification-rules', { trigger_attribute: 'any', party: 'Nope', deadline_hours: 1 })],
      ['rules update', agent.patch(`/api/security-notification-rules/${rule.id}`, { active: false })],
      ['rules delete', agent.del(`/api/security-notification-rules/${rule.id}`)],
      ['templates list', agent.get('/api/security-checklist-templates')],
      ['templates add', agent.post('/api/security-checklist-templates', { scenario: 'other', phase: 'recovery', step: 'Nope' })],
      ['contacts list', agent.get('/api/security-incident-contacts')],
      ['contacts add', agent.post('/api/security-incident-contacts', { role: 'Nope' })],
      ['history', agent.get(`/api/history?record_type=security_incident&record_id=${incident.id}`)],
      ['links', agent.get(`/api/links?record_type=security_incident&record_id=${incident.id}`)],
    ];
    for (const [name, call] of calls) {
      const res = await call;
      expect(refused(res.status), `${name} returned ${res.status}`).toBe(true);
    }

    expect((await agent.get('/api/search?q=invented')).body).toEqual([]);
    // Other modules (obligations, for example) may legitimately match; nothing from this module may.
    const hits = (await agent.get('/api/search?q=Agency A')).body as { type: string }[];
    expect(hits.filter((h) => ['security_incident', 'notification_task'].includes(h.type))).toEqual([]);
    expect((await agent.get('/api/records/lookup?type=security_incident&q=Test')).body).toEqual([]);
    const meta = (await agent.get('/api/meta')).body;
    expect(meta.resources.security_incident).toBeUndefined();
    expect(meta.resources.notification_task).toBeUndefined();
    // Nothing the agent tried left a mark.
    expect((await t.api.get(i)).body.title).toBe(incident.title);
    expect((await t.anon.get('/api/security-incidents/clocks')).status).toBe(401);
  });

  it('lets the security lead work an incident but keeps configuration for administrators', async () => {
    const lead = await t.as('security_lead');
    const made = await lead.post('/api/security-incidents', { title: 'Test incident: worked by the lead', scenario: 'payment_fraud', data_kinds: ['card_payments'] });
    expect(made.status).toBe(201);
    const i = `/api/security-incidents/${made.body.id}`;
    expect((await lead.patch(i, { status: 'declared' })).body.declared_at).toBeTruthy();
    expect((await lead.get(`${i}/clocks`)).body.clocks.length).toBe(4);
    expect((await lead.post(`${i}/log`, { entry: 'Lead entry' })).status).toBe(201);
    expect((await lead.get('/api/security-incidents/kit')).status).toBe(200);
    expect((await lead.get('/api/search?q=worked by the lead')).body[0]).toMatchObject({ type: 'security_incident' });
    expect((await lead.get('/api/meta')).body.resources.security_incident).toBeDefined();
    // security_lead holds security.*, which includes administer.
    expect((await lead.get('/api/security-notification-rules')).status).toBe(200);
  });
});

describe('seed', () => {
  it('creates no sample incident in the pilot profile (E18-69)', async () => {
    expect(await mod.seed!(t.ctx, { profile: 'pilot', seedDir: 'unused', organization: {} })).toMatch(/no sample incident/);
    expect(await t.db.query(`select 1 from security_incidents where title like '[Sample]%'`)).toHaveLength(0);
  });

  it('creates one declared sample incident with live clocks, and only once', async () => {
    const opts = { profile: 'dev' as const, seedDir: 'unused' };
    await mod.seed!(t.ctx, opts);
    await mod.seed!(t.ctx, opts);
    const rows = (await t.api.get('/api/security-incidents?q=[Sample]')).body.rows as any[];
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ status: 'declared', personal_info_involved: true });
    const clocks = (await t.api.get(`/api/security-incidents/${rows[0].id}/clocks`)).body.clocks as any[];
    expect(clocks.length).toBe(3);
    expect(clocks.find((c) => c.party === 'Agency A').state).toBe('amber');
    const items = (await t.api.get(`/api/security-incidents/${rows[0].id}/checklist`)).body as any[];
    expect(items.filter((x) => x.done).length).toBe(3);
    expect(((await t.api.get(`/api/security-incidents/${rows[0].id}/log`)).body as any[]).length).toBeGreaterThanOrEqual(5);
  });

  it('loads notification rules from the organization profile once and never overwrites an existing rule', async () => {
    const list = async () => (await t.api.get('/api/security-notification-rules')).body as any[];
    const before = await list();
    // An administrator has changed one of the organization's rules.
    const agencyB = before.find((r) => r.party === 'Agency B');
    expect((await t.api.patch(`/api/security-notification-rules/${agencyB.id}`, { deadline_hours: 96, guidance: 'Edited by an administrator' })).status).toBe(200);

    const organization = {
      notificationRules: [
        ...ORG_RULES,
        { key: 'test_regulator_h', trigger: 'personal_info_involved', party: 'Regulator H', hours: 48, required: true, active: true, guidance: 'Invented: 48 hours.' },
      ],
    };
    const opts = { profile: 'dev' as const, seedDir: 'unused', organization };
    await mod.seed!(t.ctx, opts);
    await mod.seed!(t.ctx, opts);

    const after = await list();
    expect(after.length).toBe(before.length + 1);
    expect(after.filter((r) => r.party === 'Regulator H').length).toBe(1);
    expect(after.find((r) => r.party === 'Regulator H')).toMatchObject({ deadline_hours: 48, active: true, trigger_attribute: 'personal_info_involved' });
    expect(after.find((r) => r.id === agencyB.id)).toMatchObject({ party: 'Agency B', deadline_hours: 96, guidance: 'Edited by an administrator' });
    const audit = await t.db.query<any>(
      `select 1 from audit_events where action = 'notification_rule.create' and summary like '%organization profile: Regulator H'`);
    expect(audit.length).toBe(1);

    // A rule the administrator removed is not brought back by the seed.
    expect((await t.api.del(`/api/security-notification-rules/${agencyB.id}`)).status).toBe(200);
    await mod.seed!(t.ctx, opts);
    expect((await list()).some((r) => r.party === 'Agency B')).toBe(false);
  });
});

describe('configurable lists', () => {
  it('ties every security incident list to the security module (E01-23)', async () => {
    const { LOOKUPS } = await import('./defaults.ts');
    const rows = await t.db.query<{ list_key: string; module: string }>(
      'select list_key, module from lookup_lists where list_key = any($1::text[])', [Object.keys(LOOKUPS)]);
    expect(rows.length).toBe(Object.keys(LOOKUPS).length);
    expect(rows.every((r) => r.module === 'security')).toBe(true);
  });
});

describe('list metadata (E01-23)', () => {
  it('keeps the names and labels of the security incident lists from people without security.view', async () => {
    const own = await testApp();
    try {
      const agent = await own.as('agent');
      const SECURITY_LISTS = ['security_incident_scenario', 'security_incident_severity', 'security_incident_status', 'notification_trigger',
        'incident_data_kind', 'incident_log_kind', 'incident_checklist_phase', 'ransom_payment_status', 'notification_task_status'];
      const meta = (await agent.get('/api/meta')).body.lookups;
      for (const list of SECURITY_LISTS) {
        expect([list, meta[list]]).toEqual([list, undefined]);
        expect([list, (await agent.get(`/api/lookups/${list}`)).status]).toEqual([list, 403]);
      }
      const lead = await own.as('security_lead');
      const theirs = (await lead.get('/api/meta')).body.lookups;
      for (const list of SECURITY_LISTS) expect([list, Array.isArray(theirs[list])]).toEqual([list, true]);
      expect((await lead.get('/api/lookups/security_incident_scenario')).status).toBe(200);
    } finally {
      await own.close();
    }
  });
});