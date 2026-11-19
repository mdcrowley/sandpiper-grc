import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { loadOrganizationRules, RULES } from './defaults.ts';

// Alerts, lifecycle as data, kinds of data, notifications across incidents, the incident
// report and the post-incident review. Invented data only. Runs alone (GRC_MODULES=secincidents)
// and with every module; the notification checks apply when the notifications module is loaded.

const HOUR = 3_600_000;
let t: Awaited<ReturnType<typeof testApp>>;
let lead: Awaited<ReturnType<typeof t.as>>;
let agent: Awaited<ReturnType<typeof t.as>>;

beforeAll(async () => {
  t = await testApp();
  lead = await t.as('security_lead');
  agent = await t.as('agent');
  await loadOrganizationRules(t.ctx, [
    { key: 'wf_agency', trigger: 'is_cyber_incident', party: 'Agency W', hours: 24, required: true, active: true, guidance: 'Invented.' },
    { key: 'wf_partner', trigger: 'personal_info_involved', party: 'Partner X', hours: 72, required: false, active: true, guidance: 'Invented.' },
  ]);
});
afterAll(async () => { await t.close(); });

const hasNotify = () => t.app.hasDecorator('notify');
const notesFor = (userId: string) => t.db.query<any>(
  `select kind, title, body, record_type, record_id from notifications where user_id = $1 order by created_at`, [userId]).catch(() => [] as any[]);
const logOf = async (id: string) => (await t.api.get(`/api/security-incidents/${id}/log`)).body as any[];

async function declare(extra: Record<string, unknown> = {}) {
  const res = await t.api.post('/api/security-incidents', {
    title: 'Workflow test: invented booking outage', severity: 'high', status: 'declared',
    discovered_at: new Date(Date.now() - 2 * HOUR).toISOString(), ...extra,
  });
  expect(res.status).toBe(201);
  return res.body;
}

describe('alerts when an incident is declared and when a clock turns amber or red (E09-17)', () => {
  let incident: any;

  it('tells the people who can see the incident that it was declared, and nobody else', async () => {
    // The lead of this incident is somebody without security.view: they must still hear nothing.
    incident = await declare({ lead_id: agent.userId, discovered_at: new Date(Date.now() - 20 * HOUR).toISOString() });
    if (!hasNotify()) return;
    const theirs = await notesFor(lead.userId);
    const declaredNote = theirs.find((n) => n.record_id === incident.id && n.title.startsWith('Security incident declared'));
    expect(declaredNote).toMatchObject({ kind: 'general', record_type: 'security_incident' });
    expect(declaredNote.title).toContain(incident.ref);
    expect(declaredNote.body).toMatch(/1 notification clock is running/);
    expect(await notesFor(agent.userId)).toEqual([]);
  });

  it('raises the amber alert once, in the log and as a notification', async () => {
    // Discovered 20 hours ago with a 24-hour rule: already amber at declaration.
    const amber = (await logOf(incident.id)).filter((e) => e.entry.startsWith('Alert: the deadline to notify Agency W is close'));
    expect(amber.length).toBe(1);
    expect(amber[0]).toMatchObject({ kind: 'system' });
    const again = await t.api.post('/api/security-incidents/clocks/sweep');
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ amber: 0, red: 0 });
    expect((await logOf(incident.id)).filter((e) => e.entry.startsWith('Alert:')).length).toBe(1);
    const audit = await t.db.query(`select 1 from audit_events where action = 'notification_task.alert_amber'`);
    expect(audit.length).toBe(1);
    if (!hasNotify()) return;
    const clockNotes = (await notesFor(lead.userId)).filter((n) => n.kind === 'clock' && n.record_id === incident.id);
    expect(clockNotes.length).toBe(1);
    expect(clockNotes[0].title).toMatch(/left to notify Agency W/);
  });

  it('raises the red alert when the deadline passes, once', async () => {
    await t.db.query(`update notification_tasks set due_at = now() - interval '5 minutes' where incident_id = $1`, [incident.id]);
    expect((await t.api.post('/api/security-incidents/clocks/sweep')).body).toEqual({ amber: 0, red: 1 });
    expect((await t.api.post('/api/security-incidents/clocks/sweep')).body).toEqual({ amber: 0, red: 0 });
    const alerts = (await logOf(incident.id)).filter((e) => e.entry.startsWith('Alert:'));
    expect(alerts.length).toBe(2);
    expect(alerts.some((e) => e.entry.includes('has passed'))).toBe(true);
    if (!hasNotify()) return;
    const notes = (await notesFor(lead.userId)).filter((n) => n.kind === 'clock' && n.record_id === incident.id);
    expect(notes.map((n) => n.title).some((x) => x.startsWith('Overdue: notify Agency W'))).toBe(true);
    // Still nothing for the person without security.view, although they are the incident lead.
    expect(await notesFor(agent.userId)).toEqual([]);
  });

  it('starts the alerts afresh when the deadline moves, and goes straight to red when declared late', async () => {
    // Correcting the discovery time to an hour ago puts the clock back to green: no new alert...
    await t.api.patch(`/api/security-incidents/${incident.id}`, { discovered_at: new Date(Date.now() - HOUR).toISOString() });
    const task = (await t.db.query<any>(`select alerted_amber_at, alerted_red_at from notification_tasks where incident_id = $1`, [incident.id]))[0];
    expect(task).toMatchObject({ alerted_amber_at: null, alerted_red_at: null });
    expect((await logOf(incident.id)).filter((e) => e.entry.startsWith('Alert:')).length).toBe(2);
    // ...and an incident declared after its deadline gets one red alert, not an amber one too.
    const late = await declare({ discovered_at: new Date(Date.now() - 30 * HOUR).toISOString() });
    const alerts = (await logOf(late.id)).filter((e) => e.entry.startsWith('Alert:'));
    expect(alerts.length).toBe(1);
    expect(alerts[0].entry).toMatch(/has passed/);
  });

  it('does not alert for a notification that is done or not required', async () => {
    const quiet = await declare({ discovered_at: new Date(Date.now() - HOUR).toISOString() });
    const task = (await t.api.get(`/api/notification-tasks?f.incident_id=${quiet.id}`)).body.rows[0];
    await t.api.patch(`/api/notification-tasks/${task.id}`, { status: 'not_required' });
    await t.db.query(`update notification_tasks set due_at = now() - interval '1 hour' where id = $1`, [task.id]);
    expect((await t.api.post('/api/security-incidents/clocks/sweep')).body).toEqual({ amber: 0, red: 0 });
  });
});

describe('the incident lifecycle is lookup data (E09-18)', () => {
  it('describes each status by the stage it stands for', async () => {
    const res = await lead.get('/api/security-incidents/lifecycle');
    expect(res.status).toBe(200);
    expect(res.body.stages.map((s: any) => s.value)).toEqual(['reported', 'declared', 'contained', 'closed']);
    const by = Object.fromEntries(res.body.statuses.map((s: any) => [s.value, s.stage]));
    expect(by).toEqual({ reported: 'reported', declared: 'declared', contained: 'contained', recovering: 'contained', closed: 'closed' });
    expect(res.body.review_statuses.find((s: any) => s.value === 'completed').stage).toBe('completed');
    expect(res.body.phases.map((p: any) => p.value)).toEqual(['containment', 'recovery']);
  });

  it('lets an administrator add a status; reaching it behaves as its stage says', async () => {
    expect((await t.api.post('/api/security-incidents/lists/statuses', { label: 'Eradicating' })).body.error.fields.stage).toBeTruthy();
    const added = await t.api.post('/api/security-incidents/lists/statuses', { label: 'Eradicating', stage: 'declared', color: 'orange', sort: 25 });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ value: 'eradicating', label: 'Eradicating', stage: 'declared', active: true });
    expect((await t.api.post('/api/security-incidents/lists/statuses', { label: 'eradicating', stage: 'closed' })).status).toBe(400);

    const made = await t.api.post('/api/security-incidents', { title: 'Workflow test: custom status' });
    expect(made.body.declared_at).toBeNull();
    const moved = await t.api.patch(`/api/security-incidents/${made.body.id}`, { status: 'eradicating' });
    expect(moved.status).toBe(200);
    expect(moved.body.declared_at).toBeTruthy();
    expect(moved.body.contained_at).toBeNull();
    expect((await t.api.get(`/api/security-incidents/${made.body.id}/clocks`)).body.clocks.length).toBe(1);

    // A status in use cannot be retired.
    const refused = await t.api.del(`/api/security-incidents/lists/statuses/${added.body.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toMatch(/1 incident has this status/);

    // A status added without a stage (under Administration > Lists) takes the stage of the one before it.
    await t.api.post('/api/lookups', { list_key: 'security_incident_status', value: 'monitoring', label: 'Monitoring', sort: 45 });
    const life = (await t.api.get('/api/security-incidents/lifecycle')).body.statuses;
    expect(life.find((s: any) => s.value === 'monitoring').stage).toBe('contained');
    const watched = await t.api.patch(`/api/security-incidents/${made.body.id}`, { status: 'monitoring' });
    expect(watched.body.contained_at).toBeTruthy();
    expect(watched.body.closed_at).toBeNull();

    // Now nothing holds "Eradicating": it can be retired, changed and brought back.
    expect((await t.api.del(`/api/security-incidents/lists/statuses/${added.body.id}`)).status).toBe(200);
    expect((await t.api.get('/api/security-incidents/lifecycle')).body.statuses.some((s: any) => s.value === 'eradicating')).toBe(false);
    const back = await t.api.patch(`/api/security-incidents/lists/statuses/${added.body.id}`, { active: true, label: 'Eradication' });
    expect(back.body).toMatchObject({ active: true, label: 'Eradication', stage: 'declared' });
    const audit = await t.db.query<any>(`select action from audit_events where record_type = 'lookup' and record_id = $1 order by id`, [added.body.id]);
    expect(audit.map((a) => a.action)).toEqual(['lookup.create', 'lookup.retire', 'lookup.restore']);
  });

  it('never leaves the lifecycle without a reported, a declared or a closed status', async () => {
    const rows = (await t.api.get('/api/security-incidents/lists/statuses')).body as any[];
    const closed = rows.find((r) => r.value === 'closed');
    expect((await t.api.del(`/api/security-incidents/lists/statuses/${closed.id}`)).status).toBe(409);
    expect((await t.api.patch(`/api/security-incidents/lists/statuses/${closed.id}`, { stage: 'contained' })).status).toBe(409);
    expect((await t.api.get('/api/security-incidents/lists/nonsense')).status).toBe(404);
  });

  it('keeps open incidents in step with the rules whatever the closed status is called', async () => {
    const open = await declare({ title: 'Workflow test: still open' });
    const shut = await declare({ title: 'Workflow test: shut' });
    await t.api.patch(`/api/security-incidents/${shut.id}`, { status: 'closed' });
    const rule = await t.api.post('/api/security-notification-rules', { trigger_attribute: 'any', party: 'Party Y', deadline_hours: 500 });
    const parties = async (id: string) => ((await t.api.get(`/api/security-incidents/${id}/clocks`)).body.clocks as any[]).map((c) => c.party);
    expect(await parties(open.id)).toContain('Party Y');
    expect(await parties(shut.id)).not.toContain('Party Y');
    await t.api.del(`/api/security-notification-rules/${rule.body.id}`);
  });
});

describe('kinds of data are edited on the rules screen (E09-21)', () => {
  it('adds a kind, which becomes a question and a rule trigger, and protects one that a rule uses', async () => {
    const added = await lead.post('/api/security-incidents/lists/kinds', { label: 'Research records', hint: 'Invented kind of data.' });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ value: 'research_records', label: 'Research records', hint: 'Invented kind of data.', active: true });
    const q = (await t.api.get('/api/security-incidents/questions')).body;
    expect(q.questions.find((x: any) => x.key === 'kind:research_records')).toMatchObject({ question: 'Could research records be involved?', hint: 'Invented kind of data.' });
    expect((await lead.post('/api/security-incidents/lists/kinds', { label: '  ' })).body.error.fields.label).toBeTruthy();
    expect((await lead.post('/api/security-incidents/lists/kinds', { label: 'Research Records' })).status).toBe(400);

    const changed = await lead.patch(`/api/security-incidents/lists/kinds/${added.body.id}`, { label: 'Research data', hint: '' });
    expect(changed.body).toMatchObject({ value: 'research_records', label: 'Research data', hint: '' });

    const rule = await t.api.post('/api/security-notification-rules', { trigger_attribute: 'kind:research_records', party: 'Party R', deadline_hours: 10 });
    expect(rule.status).toBe(201);
    const blocked = await lead.del(`/api/security-incidents/lists/kinds/${added.body.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/Party R/);
    await t.api.patch(`/api/security-notification-rules/${rule.body.id}`, { active: false });
    expect((await lead.del(`/api/security-incidents/lists/kinds/${added.body.id}`)).status).toBe(200);
    expect((await t.api.get('/api/security-incidents/questions')).body.questions.some((x: any) => x.key === 'kind:research_records')).toBe(false);
    const listed = (await lead.get('/api/security-incidents/lists/kinds')).body as any[];
    expect(listed.find((k) => k.value === 'research_records')).toMatchObject({ active: false });
    // Retired, not deleted: the name cannot be added a second time.
    expect((await lead.post('/api/security-incidents/lists/kinds', { label: 'Research data' })).body.error.fields.label).toMatch(/retired/);
    const audit = await t.db.query<any>(`select action from audit_events where record_type = 'lookup' and record_id = $1 order by id`, [added.body.id]);
    expect(audit.map((a) => a.action)).toEqual(['lookup.create', 'lookup.update', 'lookup.retire']);
  });
});

describe('notification tasks across incidents (E09-19)', () => {
  it('lists open, completed and stood-down notifications with their incident, most urgent first', async () => {
    const incident = await declare({ title: 'Workflow test: across incidents', personal_info_involved: true });
    const clocks = (await t.api.get(`/api/security-incidents/${incident.id}/clocks`)).body.clocks as any[];
    const partner = clocks.find((c) => c.party === 'Partner X');
    const done = await lead.patch(`/api/notification-tasks/${partner.task_id}`, { status: 'done', notified_who: 'Desk (invented)', notified_how: 'Phone' });
    expect(done.status).toBe(200);

    const open = (await lead.get('/api/security-incidents/clocks')).body;
    expect(open.clocks.every((c: any) => c.status === 'pending')).toBe(true);
    expect(open.clocks.some((c: any) => c.incident.id === incident.id && c.party === 'Agency W')).toBe(true);
    expect(open.clocks[0].state).toBe('red');
    expect(open.summary.open).toBe(open.clocks.length);
    expect(open.summary.open_incidents).toBeGreaterThan(0);
    expect(open.clocks[0].amber_at).toBeTruthy();

    const finished = (await lead.get('/api/security-incidents/clocks?status=done')).body.clocks as any[];
    expect(finished.find((c) => c.task_id === partner.task_id)).toMatchObject({
      state: 'met', notified_who: 'Desk (invented)', completed_by_name: expect.stringMatching(/security_lead/), incident: { ref: incident.ref },
    });
    const all = (await lead.get('/api/security-incidents/clocks?status=all')).body;
    expect(all.clocks.length).toBe(all.summary.open + all.summary.done + all.summary.not_required);
    expect((await lead.get('/api/security-incidents/clocks?status=bogus')).body.clocks.every((c: any) => c.status === 'pending')).toBe(true);
  });
});

describe('post-incident review (E09-22)', () => {
  let id: string;

  it('sets the date the review is due when the incident is closed, and tells the lead', async () => {
    const incident = await declare({ title: 'Workflow test: to be reviewed', lead_id: lead.userId });
    id = incident.id;
    expect(incident.review_status).toBe('not_started');
    expect(incident.review_due_on).toBeNull();
    const closed = await t.api.patch(`/api/security-incidents/${id}`, { status: 'closed' });
    expect(closed.body.closed_at).toBeTruthy();
    expect(closed.body.review_due_on).toMatch(/^\d{4}-\d{2}-\d{2}/);
    const days = (new Date(String(closed.body.review_due_on).slice(0, 10)).getTime() - Date.now()) / (24 * HOUR);
    expect(days).toBeGreaterThan(12);
    expect(days).toBeLessThan(15);
    expect((await t.api.get('/api/security-incidents/clocks')).body.summary.reviews_due).toBeGreaterThan(0);
    if (!hasNotify()) return;
    expect((await notesFor(lead.userId)).some((n) => n.kind === 'due' && n.record_id === id && n.title.startsWith('Post-incident review due by'))).toBe(true);
  });

  it('cannot be completed without what happened, the root cause and what to improve', async () => {
    const res = await lead.patch(`/api/security-incidents/${id}`, { review_status: 'completed' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['root_cause', 'to_improve', 'what_happened']);
    const scheduled = await lead.patch(`/api/security-incidents/${id}`, { review_status: 'scheduled', review_held_at: new Date(Date.now() + 48 * HOUR).toISOString() });
    expect(scheduled.status).toBe(200);
    expect((await logOf(id)).some((e) => e.entry.startsWith('Post-incident review: Scheduled; meeting'))).toBe(true);
  });

  it('records who completed it and when, logs it, and then freezes the findings', async () => {
    const done = await lead.patch(`/api/security-incidents/${id}`, {
      review_status: 'completed', what_happened: 'Invented account.', root_cause: 'Invented cause.', went_well: 'Invented.', to_improve: 'Invented improvement.',
    });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ review_status: 'completed', review_completed_by: lead.userId });
    expect(done.body.review_completed_at).toBeTruthy();
    expect((await logOf(id)).some((e) => e.kind === 'decision' && e.entry.startsWith('Post-incident review completed'))).toBe(true);

    const frozen = await lead.patch(`/api/security-incidents/${id}`, { root_cause: 'Rewritten afterwards' });
    expect(frozen.status).toBe(409);
    expect(frozen.body.error.code).toBe('review_completed');
    // Other fields, and an unchanged finding, are not affected.
    expect((await lead.patch(`/api/security-incidents/${id}`, { summary: 'Edited after the review', root_cause: 'Invented cause.' })).status).toBe(200);
    // The completion stamp is the system's to set.
    const forged = await lead.patch(`/api/security-incidents/${id}`, { review_completed_at: '2020-01-01T00:00:00Z' });
    expect((await t.api.get(`/api/security-incidents/${id}`)).body.review_completed_at).toBe(done.body.review_completed_at);
    expect([200, 400]).toContain(forged.status);
  });

  it('can be reopened, which clears the completion and allows changes again', async () => {
    const reopened = await lead.patch(`/api/security-incidents/${id}`, { review_status: 'drafted', root_cause: 'Corrected cause.' });
    expect(reopened.status).toBe(200);
    expect(reopened.body).toMatchObject({ review_status: 'drafted', review_completed_at: null, review_completed_by: null, root_cause: 'Corrected cause.' });
    expect((await logOf(id)).some((e) => e.entry.startsWith('Post-incident review reopened'))).toBe(true);
  });

  it('needs a reason to be marked not required', async () => {
    const res = await lead.patch(`/api/security-incidents/${id}`, { review_status: 'not_required' });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.review_skip_reason).toBeTruthy();
    const ok = await lead.patch(`/api/security-incidents/${id}`, { review_status: 'not_required', review_skip_reason: 'Invented: a false alarm.' });
    expect(ok.status).toBe(200);
    expect((await logOf(id)).some((e) => e.kind === 'decision' && e.entry.includes('Invented: a false alarm.'))).toBe(true);
  });
});

describe('incident report (E09-20)', () => {
  it('bundles the timeline, decisions, notifications made and lessons, and audits the read', async () => {
    const incident = await declare({ title: 'Workflow test: reported on', scenario: 'lost_device', personal_info_involved: true });
    const i = `/api/security-incidents/${incident.id}`;
    await lead.post(`${i}/log`, { entry: 'Invented decision: isolate the device.', kind: 'decision' });
    await lead.post(`${i}/evidence`, { item: 'Invented evidence item' });
    const partner = ((await t.api.get(`${i}/clocks`)).body.clocks as any[]).find((c) => c.party === 'Partner X');
    await lead.patch(`/api/notification-tasks/${partner.task_id}`, { status: 'done', notified_who: 'Desk (invented)', notified_how: 'Email', reference_received: 'WF-REF-9' });
    await lead.patch(i, { what_happened: 'Invented account.', root_cause: 'Invented cause.', to_improve: 'Invented improvement.', review_status: 'completed' });

    const res = await lead.get(`${i}/report`);
    expect(res.status).toBe(200);
    const r = res.body;
    expect(r.generated_by).toMatch(/security_lead/);
    expect(r.incident).toMatchObject({ ref: incident.ref, severity_label: 'High', status_label: 'Declared', stage: 'declared', scenario_label: 'Lost device' });
    expect(r.incident.answers.find((a: any) => a.question.startsWith('Could personal information')).yes).toBe(true);
    const times = r.timeline.map((e: any) => new Date(e.at).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(r.timeline[0].kind_label).toBeTruthy();
    expect(r.decisions.map((d: any) => d.entry)).toEqual(expect.arrayContaining(['Invented decision: isolate the device.']));
    expect(r.notifications.find((n: any) => n.party === 'Partner X')).toMatchObject({ state: 'met', reference_received: 'WF-REF-9', completed_by_name: expect.stringMatching(/security_lead/) });
    expect(r.notifications.find((n: any) => n.party === 'Agency W').status).toBe('pending');
    expect(r.checklist.map((p: any) => p.label)).toEqual(['Containment', 'Recovery']);
    expect(r.roles.length).toBeGreaterThan(3);
    expect(r.evidence[0].item).toBe('Invented evidence item');
    expect(r.review).toMatchObject({ stage: 'completed', status_label: 'Completed', root_cause: 'Invented cause.', completed_by: expect.stringMatching(/security_lead/) });
    // Follow-up actions come from another module: a list when it is loaded, otherwise null.
    expect(t.ctx.resources.get('action') ? Array.isArray(r.actions) || r.actions === null : r.actions === null).toBe(true);
    const audit = await t.db.query(`select 1 from audit_events where action = 'security_incident.report_export' and record_id = $1`, [incident.id]);
    expect(audit.length).toBe(1);
    expect((await lead.get('/api/security-incidents/00000000-0000-4000-8000-000000000000/report')).status).toBe(404);
  });

  it('lists follow-up actions raised from the incident when the action tracker is loaded', async () => {
    if (!t.ctx.resources.get('action')) return;
    const incident = await declare({ title: 'Workflow test: with a follow-up action' });
    const action = await t.api.post('/api/actions', { title: 'Invented follow-up', source: 'incident', source_type: 'security_incident', source_id: incident.id });
    expect(action.status).toBe(201);
    const r = (await t.api.get(`/api/security-incidents/${incident.id}/report`)).body;
    expect(r.actions.map((a: any) => a.title)).toEqual(['Invented follow-up']);
    expect(r.actions[0].status_label).toBeTruthy();
  });
});

describe('restricted behavior of the new routes', () => {
  it('shows an agent nothing and lets them change nothing', async () => {
    const incident = (await t.api.get('/api/security-incidents?pageSize=1')).body.rows[0];
    const kind = ((await t.api.get('/api/security-incidents/lists/kinds')).body as any[])[0];
    const status = ((await t.api.get('/api/security-incidents/lists/statuses')).body as any[])[0];
    const refused = (s: number) => s === 403 || s === 404;
    const calls: [string, Promise<{ status: number }>][] = [
      ['lifecycle', agent.get('/api/security-incidents/lifecycle')],
      ['clocks all', agent.get('/api/security-incidents/clocks?status=all')],
      ['sweep', agent.post('/api/security-incidents/clocks/sweep')],
      ['report', agent.get(`/api/security-incidents/${incident.id}/report`)],
      ['kinds list', agent.get('/api/security-incidents/lists/kinds')],
      ['kinds add', agent.post('/api/security-incidents/lists/kinds', { label: 'Nope' })],
      ['kinds change', agent.patch(`/api/security-incidents/lists/kinds/${kind.id}`, { label: 'Nope' })],
      ['kinds retire', agent.del(`/api/security-incidents/lists/kinds/${kind.id}`)],
      ['statuses list', agent.get('/api/security-incidents/lists/statuses')],
      ['statuses add', agent.post('/api/security-incidents/lists/statuses', { label: 'Nope', stage: 'closed' })],
      ['statuses change', agent.patch(`/api/security-incidents/lists/statuses/${status.id}`, { label: 'Nope' })],
      ['statuses retire', agent.del(`/api/security-incidents/lists/statuses/${status.id}`)],
      ['review', agent.patch(`/api/security-incidents/${incident.id}`, { review_status: 'not_required', review_skip_reason: 'Nope' })],
    ];
    for (const [name, call] of calls) {
      const res = await call;
      expect(refused(res.status), `${name} returned ${res.status}`).toBe(true);
    }
    expect((await t.anon.get('/api/security-incidents/lifecycle')).status).toBe(401);
    expect((await t.anon.post('/api/security-incidents/clocks/sweep')).status).toBe(401);
    // Nothing changed, and the report was not audited as opened by the agent.
    expect(((await t.api.get('/api/security-incidents/lists/kinds')).body as any[])[0].label).toBe(kind.label);
    const opened = await t.db.query(`select 1 from audit_events where action = 'security_incident.report_export' and actor_id = $1`, [agent.userId]);
    expect(opened.length).toBe(0);
    if (hasNotify()) expect(await notesFor(agent.userId)).toEqual([]);
  });

  it('keeps list changes for people with security.administer', async () => {
    // A role with security.view and security.edit but not administer.
    const role = await t.db.one<{ id: string }>(`insert into roles (key, name, enabled) values ('wf_responder', 'Workflow responder', true) returning id`);
    for (const p of ['security.view', 'security.edit']) await t.db.query(`insert into role_permissions (role_id, permission) values ($1, $2)`, [role!.id, p]);
    const responder = await t.as('wf_responder');
    expect((await responder.get('/api/security-incidents/lists/kinds')).status).toBe(200);
    expect((await responder.get('/api/security-incidents/lifecycle')).status).toBe(200);
    expect((await responder.post('/api/security-incidents/lists/kinds', { label: 'Nope' })).status).toBe(403);
    expect((await responder.post('/api/security-incidents/lists/statuses', { label: 'Nope', stage: 'closed' })).status).toBe(403);
    expect((await responder.post('/api/security-incidents/clocks/sweep')).status).toBe(403);
  });
});

describe('transit starter content', () => {
  it('ships transit scenarios with checklists, a rider data question, and only inactive placeholder rules', async () => {
    const kit = (await t.api.get('/api/security-incidents/kit')).body;
    for (const scenario of ['dispatch_outage', 'fare_system_compromise', 'onboard_network_compromise']) {
      const list = kit.checklists.find((c: any) => c.scenario === scenario);
      expect(list, scenario).toBeTruthy();
      expect(list.containment.length).toBeGreaterThan(3);
      expect(list.recovery.length).toBeGreaterThan(3);
    }
    const questions = (await t.api.get('/api/security-incidents/questions')).body.questions as any[];
    expect(questions.some((q) => q.key === 'kind:rider_account_data')).toBe(true);
    const rules = (await t.api.get('/api/security-notification-rules')).body as any[];
    expect(rules.some((r) => r.party === 'Transport safety or oversight authority')).toBe(true);
    expect(RULES.every((r) => r.hours === null && r.active === false)).toBe(true);

    // Choosing a transit scenario copies its checklist onto the incident.
    const incident = await declare({ scenario: 'dispatch_outage' });
    const items = (await t.api.get(`/api/security-incidents/${incident.id}/checklist`)).body as any[];
    expect(items.filter((i) => i.phase === 'containment').length).toBeGreaterThan(3);
  });
});
