import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { clock } from './clock.ts';

// Invented data only. November 2026 is on standard time: 08:00 local = 13:00Z. 20 November is a Friday.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { clock.set(null); await t.close(); });

const base = { title: 'Test ticket', requester_name: 'Pat Example', requester_department: 'Finance' };

describe('priority matrix', () => {
  it('computes priority from impact and urgency, and honors an override', async () => {
    clock.set('2026-11-18T15:00:00Z');
    const p1 = await t.api.post('/api/tickets', { ...base, impact: 'organisation', urgency: 'high' });
    expect(p1.status).toBe(201);
    expect(p1.body.ref).toMatch(/^TKT-\d{5}$/);
    expect(p1.body.priority).toBe('p1');
    expect(p1.body.priority_overridden).toBe(false);
    // P1: respond in 15 minutes at any hour, resolve in 4 hours.
    expect(p1.body.response_due_at).toBe('2026-11-18T15:15:00.000Z');
    expect(p1.body.resolve_due_at).toBe('2026-11-18T19:00:00.000Z');

    const low = await t.api.post('/api/tickets', { ...base, impact: 'individual', urgency: 'low' });
    expect(low.body.priority).toBe('p4');

    const forced = await t.api.post('/api/tickets', { ...base, impact: 'individual', urgency: 'low', priority: 'p2' });
    expect(forced.body.priority).toBe('p2');
    expect(forced.body.priority_overridden).toBe(true);
    // An overridden priority survives a change of impact...
    const kept = await t.api.patch(`/api/tickets/${forced.body.id}`, { impact: 'department' });
    expect(kept.body.priority).toBe('p2');
    // ...until the override is removed.
    const reset = await t.api.patch(`/api/tickets/${forced.body.id}`, { priority_overridden: false });
    expect(reset.body.priority).toBe('p4');

    const moved = await t.api.patch(`/api/tickets/${low.body.id}`, { impact: 'department', urgency: 'high' });
    expect(moved.body.priority).toBe('p2');
    // P2 from 10:00 local: respond by 11:00 local, resolve by 10:00 local the next business day.
    expect(moved.body.response_due_at).toBe('2026-11-18T16:00:00.000Z');
    expect(moved.body.resolve_due_at).toBe('2026-11-19T15:00:00.000Z');
  });

  it('is editable by an administrator only, and the change takes effect', async () => {
    const current = (await t.api.get('/api/tickets/priority-matrix')).body;
    expect(current.cells.organisation.high).toBe('p1');
    const denied = await t.app.inject({ method: 'PUT', url: '/api/tickets/priority-matrix', headers: { 'x-grc-csrf': '1' }, payload: current });
    expect(denied.statusCode).toBe(401);

    const put = (body: unknown) => put_(t, body);
    expect((await put({ default: 'p9', cells: {} })).status).toBe(400);
    const changed = { ...current, cells: { ...current.cells, individual: { ...current.cells.individual, low: 'p3' } } };
    expect((await put(changed)).status).toBe(200);
    expect((await t.api.post('/api/tickets', { ...base, impact: 'individual', urgency: 'low' })).body.priority).toBe('p3');
    expect((await put(current)).status).toBe(200);
    const audit = await t.db.query(`select 1 from audit_events where action = 'setting.change' and record_id = 'tickets.priority_matrix'`);
    expect(audit.length).toBeGreaterThanOrEqual(3);
  });
});

// The test client has no PUT helper, so call inject with the administrator's cookie taken from a GET.
async function put_(app: Awaited<ReturnType<typeof testApp>>, body: unknown, url = '/api/tickets/priority-matrix') {
  const cookie = await adminCookie(app);
  const res = await app.app.inject({ method: 'PUT', url, headers: { cookie, 'x-grc-csrf': '1' }, payload: body as object });
  return { status: res.statusCode, body: res.json() };
}
let cached: string | undefined;
async function adminCookie(app: Awaited<ReturnType<typeof testApp>>): Promise<string> {
  if (cached) return cached;
  const { ADMIN } = await import('../../test/helpers.ts');
  const res = await app.app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-grc-csrf': '1' }, payload: { username: ADMIN.username, password: ADMIN.password } });
  cached = res.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  return cached;
}

describe('SLA clocks', () => {
  it('pauses across a weekend, shifts the due time on resume, then breaches', async () => {
    // Friday 15:00 local. P2: respond by 16:00 local, resolve by Monday 15:00 local.
    clock.set('2026-11-20T20:00:00Z');
    const made = await t.api.post('/api/tickets', { ...base, title: 'Weekend pause', impact: 'department', urgency: 'high' });
    const id = made.body.id;
    expect(made.body.priority).toBe('p2');
    expect(made.body.response_due_at).toBe('2026-11-20T21:00:00.000Z');
    expect(made.body.resolve_due_at).toBe('2026-11-23T20:00:00.000Z');
    expect(made.body.first_responded_at).toBeNull();

    // 15:10: picked up. First response is stamped, inside the target.
    clock.set('2026-11-20T20:10:00Z');
    const agent = await t.as('agent');
    const taken = await agent.patch(`/api/tickets/${id}`, { assignee_id: agent.userId, status: 'assigned' });
    expect(taken.body.first_responded_at).toBe('2026-11-20T20:10:00.000Z');
    expect(taken.body.response_breached).toBe(false);

    // 16:00 Friday: waiting on the requester. The clock stops.
    clock.set('2026-11-20T21:00:00Z');
    const paused = await agent.patch(`/api/tickets/${id}`, { status: 'waiting_requester' });
    expect(paused.body.paused_at).toBe('2026-11-20T21:00:00.000Z');

    // Saturday: paused, 8 working hours left.
    clock.set('2026-11-21T15:00:00Z');
    const sat = (await t.api.get(`/api/tickets/${id}/sla`)).body;
    expect(sat.paused).toBe(true);
    expect(sat.status_category).toBe('paused');
    expect(sat.resolve).toMatchObject({ state: 'paused', remaining_minutes: 480, breached: false });
    expect(sat.response.state).toBe('met');
    expect(sat.policy).toMatchObject({ respond_minutes: 60, resolve_minutes: 540 });

    // Tuesday 10:00 local: the original due time (Monday 15:00) has passed, but the ticket is still paused.
    clock.set('2026-11-24T15:00:00Z');
    expect((await t.api.get(`/api/tickets/${id}`)).body.resolve_breached).toBe(false);

    // Resume. Paused working time: Friday 1 h + Monday 9 h + Tuesday 2 h = 720 minutes.
    const resumed = await agent.patch(`/api/tickets/${id}`, { status: 'in_progress' });
    expect(resumed.body.paused_at).toBeNull();
    expect(resumed.body.paused_minutes).toBe(720);
    // 8 working hours left from Tuesday 10:00 local = Wednesday 09:00 local.
    expect(resumed.body.resolve_due_at).toBe('2026-11-25T14:00:00.000Z');
    expect(resumed.body.resolve_breached).toBe(false);
    const running = (await t.api.get(`/api/tickets/${id}/sla`)).body;
    expect(running.resolve).toMatchObject({ state: 'running', remaining_minutes: 480 });

    // Wednesday 09:30 local: late. Reading alone changes nothing (E18-29); the timed check raises the flag and audits it.
    clock.set('2026-11-25T14:30:00Z');
    expect((await t.api.get(`/api/tickets/${id}`)).body.resolve_breached).toBe(false);
    expect((await t.api.post('/api/tickets/sla/sweep')).body.flagged).toBeGreaterThanOrEqual(1);
    const late = (await t.api.get(`/api/tickets/${id}`)).body;
    expect(late.resolve_breached).toBe(true);
    expect((await t.api.get(`/api/tickets/${id}/sla`)).body.resolve).toMatchObject({ state: 'breached', remaining_minutes: -30 });
    const history = (await t.api.get(`/api/history?record_type=ticket&record_id=${id}`)).body;
    expect(history.filter((h: any) => h.action === 'ticket.sla_breach').length).toBe(1);

    const reason = await agent.patch(`/api/tickets/${id}`, { breach_reason: 'Requester was away until Tuesday.' });
    expect(reason.body.breach_reason).toMatch(/away/);
    const done = await agent.patch(`/api/tickets/${id}`, { status: 'resolved', resolution_code: 'fixed' });
    expect(done.body.resolved_at).toBe('2026-11-25T14:30:00.000Z');
    expect(done.body.resolve_breached).toBe(true);
  });

  it('does not count the weekend against an unpaused ticket, and breaches the response on Monday', async () => {
    // Friday 16:00 local, P3: respond within 4 working hours = Monday 11:00 local.
    clock.set('2026-11-20T21:00:00Z');
    const made = await t.api.post('/api/tickets', { ...base, title: 'Weekend wait', impact: 'individual', urgency: 'high' });
    expect(made.body.priority).toBe('p3');
    expect(made.body.response_due_at).toBe('2026-11-23T16:00:00.000Z');

    clock.set('2026-11-22T17:00:00Z'); // Sunday
    expect((await t.api.get(`/api/tickets/${made.body.id}`)).body.response_breached).toBe(false);
    clock.set('2026-11-23T15:59:00Z'); // Monday 10:59 local
    await t.api.post('/api/tickets/sla/sweep');
    expect((await t.api.get(`/api/tickets?f.response_breached=true&q=Weekend wait`)).body.total).toBe(0);
    clock.set('2026-11-23T16:01:00Z'); // Monday 11:01 local
    expect((await t.api.get(`/api/tickets?f.response_breached=true&q=Weekend wait`)).body.total).toBe(0);
    await t.api.post('/api/tickets/sla/sweep');
    expect((await t.api.get(`/api/tickets?f.response_breached=true&q=Weekend wait`)).body.total).toBe(1);

    // A late first response keeps the flag.
    const taken = await t.api.patch(`/api/tickets/${made.body.id}`, { status: 'in_progress' });
    expect(taken.body.response_breached).toBe(true);
    expect(taken.body.first_responded_at).toBe('2026-11-23T16:01:00.000Z');
  });

  it('skips holidays and lets an administrator change targets', async () => {
    const calendars = (await t.api.get('/api/tickets/sla/calendars')).body;
    const business = calendars.find((c: any) => c.key === 'business');
    expect(business.hours.mon).toEqual(['08:00', '17:00']);
    const holiday = await t.api.post(`/api/tickets/sla/calendars/${business.id}/holidays`, { day: '2026-11-26', name: 'Thanksgiving' });
    expect(holiday.status).toBe(201);

    clock.set('2026-11-25T21:30:00Z'); // Wednesday 16:30 local
    const made = await t.api.post('/api/tickets', { ...base, title: 'Holiday', impact: 'department', urgency: 'high' });
    // 30 minutes on Wednesday, Thursday closed, 30 minutes on Friday.
    expect(made.body.response_due_at).toBe('2026-11-27T13:30:00.000Z');

    const policies = (await t.api.get('/api/tickets/sla/policies')).body;
    expect(policies.map((p: any) => [p.priority, p.respond_minutes, p.resolve_minutes])).toEqual([
      ['p1', 15, 240], ['p2', 60, 540], ['p3', 240, 1620], ['p4', 540, 2700],
    ]);
    const p2 = policies.find((p: any) => p.priority === 'p2');
    expect((await put_(t, { respond_minutes: 0, resolve_minutes: 10, calendar_id: p2.calendar_id }, '/api/tickets/sla/policies/p2')).status).toBe(400);
    expect((await put_(t, { respond_minutes: 30, resolve_minutes: 540, calendar_id: p2.calendar_id }, '/api/tickets/sla/policies/p2')).status).toBe(200);
    const quicker = await t.api.post('/api/tickets', { ...base, title: 'Quicker', impact: 'department', urgency: 'high' });
    expect(quicker.body.response_due_at).toBe('2026-11-25T22:00:00.000Z');
    await put_(t, { respond_minutes: 60, resolve_minutes: 540, calendar_id: p2.calendar_id }, '/api/tickets/sla/policies/p2');
    expect((await t.api.del(`/api/tickets/sla/holidays/${holiday.body.id}`)).status).toBe(200);
  });
});

describe('ticket lifecycle', () => {
  it('runs from new to closed with an audit trail, and can be reopened', async () => {
    clock.set('2026-12-01T15:00:00Z'); // Tuesday 10:00 local
    const agent = await t.as('agent');
    const made = await agent.post('/api/tickets', {
      ...base, title: 'Lifecycle', type: 'request', category: 'access', requester_email: 'pat@example.test',
    });
    expect(made.status).toBe(201);
    expect(made.body.status).toBe('new');
    expect(made.body.channel).toBe('agent');
    expect(made.body.opened_at).toBe('2026-12-01T15:00:00.000Z');
    const id = made.body.id;

    expect((await agent.post('/api/tickets', { ...base, requester_email: 'not an email' })).body.error.fields.requester_email).toBeDefined();
    // Read-only SLA fields cannot be set by hand.
    const hack = await agent.patch(`/api/tickets/${id}`, { resolve_due_at: '2030-01-01T00:00:00Z', response_breached: true, subcategory: 'Shared drive' });
    expect(hack.body.resolve_due_at).toBe(made.body.resolve_due_at);
    expect(hack.body.response_breached).toBe(false);

    clock.set('2026-12-01T15:20:00Z');
    const mine = await agent.patch(`/api/tickets/${id}`, { assignee_id: agent.userId });
    expect(mine.body.first_responded_at).toBe('2026-12-01T15:20:00.000Z');
    expect((await agent.get('/api/tickets?f.assignee_id=me')).body.rows.map((r: any) => r.id)).toContain(id);
    await agent.patch(`/api/tickets/${id}`, { status: 'in_progress' });

    const vendor = await agent.patch(`/api/tickets/${id}`, { with_vendor: true, vendor_ref: 'CASE-1', status: 'waiting_vendor' });
    expect(vendor.body.vendor_raised_at).toBe('2026-12-01T15:20:00.000Z');
    expect(vendor.body.paused_at).not.toBeNull();

    clock.set('2026-12-01T17:00:00Z');
    const noCode = await agent.patch(`/api/tickets/${id}`, { status: 'resolved' });
    expect(noCode.status).toBe(400);
    expect(noCode.body.error.fields.resolution_code).toBeDefined();
    const resolved = await agent.patch(`/api/tickets/${id}`, { status: 'resolved', resolution_code: 'fulfilled', resolution_notes: 'Access granted.' });
    expect(resolved.body.resolved_at).toBe('2026-12-01T17:00:00.000Z');
    expect(resolved.body.paused_at).toBeNull();
    expect(resolved.body.paused_minutes).toBe(100);
    expect(resolved.body.resolve_breached).toBe(false);

    expect((await agent.patch(`/api/tickets/${id}`, { satisfaction_score: 9 })).status).toBe(400);
    clock.set('2026-12-02T15:00:00Z');
    const closed = await agent.patch(`/api/tickets/${id}`, { status: 'closed', satisfaction_score: 5, satisfaction_comment: 'Quick.' });
    expect(closed.body.closed_at).toBe('2026-12-02T15:00:00.000Z');
    expect(closed.body.resolved_at).toBe('2026-12-01T17:00:00.000Z');

    const history = (await agent.get(`/api/history?record_type=ticket&record_id=${id}`)).body;
    expect(history[history.length - 1].action).toBe('ticket.create');
    expect(history.filter((h: any) => h.action === 'ticket.update').length).toBeGreaterThanOrEqual(6);
    const resolveEvent = history.find((h: any) => h.after?.status === 'resolved');
    expect(resolveEvent.before.status).toBe('waiting_vendor');
    expect(resolveEvent.after.resolved_at).toBe('2026-12-01T17:00:00.000Z');
    expect(resolveEvent.actor_name).toMatch(/agent/);

    const reopened = await agent.patch(`/api/tickets/${id}`, { status: 'in_progress' });
    expect(reopened.body.resolved_at).toBeNull();
    expect(reopened.body.closed_at).toBeNull();
  });

  it('needs a resolution code to close a ticket, but not to cancel one (E18-15)', async () => {
    const agent = await t.as('agent');
    const id = (await agent.post('/api/tickets', { ...base, title: 'Straight to closed' })).body.id;
    const noCode = await agent.patch(`/api/tickets/${id}`, { status: 'closed' });
    expect(noCode.status).toBe(400);
    expect(noCode.body.error.fields.resolution_code).toBeDefined();
    expect((await agent.post('/api/tickets', { ...base, title: 'Born closed', status: 'closed' })).status).toBe(400);
    const closed = await agent.patch(`/api/tickets/${id}`, { status: 'closed', resolution_code: 'fixed' });
    expect(closed.status).toBe(200);
    expect(closed.body.closed_at).not.toBeNull();
    // The code cannot be cleared while the ticket stays closed.
    expect((await agent.patch(`/api/tickets/${id}`, { resolution_code: null })).status).toBe(400);
    const other = (await agent.post('/api/tickets', { ...base, title: 'Not needed after all' })).body.id;
    expect((await agent.patch(`/api/tickets/${other}`, { status: 'cancelled' })).status).toBe(200);
  });

  it('links child tickets to a major incident and stores the review', async () => {
    const parent = await t.api.post('/api/tickets', { ...base, title: 'Major', impact: 'organisation', urgency: 'high', major_incident: true });
    const child = await t.api.post('/api/tickets', { ...base, title: 'Child', parent_ticket_id: parent.body.id });
    expect(child.body._display.parent_ticket_id).toBe('Major');
    expect((await t.api.get(`/api/tickets?f.parent_ticket_id=${parent.body.id}`)).body.total).toBe(1);
    expect((await t.api.patch(`/api/tickets/${parent.body.id}`, { parent_ticket_id: parent.body.id })).status).toBe(400);
    const pir = await t.api.patch(`/api/tickets/${parent.body.id}`, { post_incident_review: { summary: 'Short outage', root_cause: 'Power dip' } });
    expect(pir.body.post_incident_review).toEqual({ summary: 'Short outage', root_cause: 'Power dip' });
  });
});

describe('configuration without code', () => {
  it('lets an administrator add statuses through /api/lookups and use them', async () => {
    clock.set('2026-12-03T15:00:00Z');
    const parts = await t.api.post('/api/lookups', { list_key: 'ticket_status', value: 'awaiting_parts', label: 'Awaiting parts', color: 'amber', sort: 45, meta: { category: 'paused' } });
    expect(parts.status).toBe(201);
    const plain = await t.api.post('/api/lookups', { list_key: 'ticket_status', value: 'triage', label: 'Triage', sort: 15 });
    expect(plain.status).toBe(201);

    const made = await t.api.post('/api/tickets', { ...base, title: 'New statuses' });
    const id = made.body.id;
    // No category: behaves as an open status, and leaving "new" counts as the first response.
    const triage = await t.api.patch(`/api/tickets/${id}`, { status: 'triage' });
    expect(triage.status).toBe(200);
    expect(triage.body._display.status).toBe('Triage');
    expect(triage.body.paused_at).toBeNull();
    expect(triage.body.first_responded_at).not.toBeNull();
    expect((await t.api.get(`/api/tickets/${id}/sla`)).body.status_category).toBe('open');

    const waiting = await t.api.patch(`/api/tickets/${id}`, { status: 'awaiting_parts' });
    expect(waiting.body._display.status).toBe('Awaiting parts');
    expect(waiting.body.paused_at).toBe('2026-12-03T15:00:00.000Z');
    expect((await t.api.get(`/api/tickets/${id}/sla`)).body.resolve.state).toBe('paused');
    expect((await t.api.get('/api/tickets/stats?group=status')).body.groups.map((g: any) => g.value)).toContain('awaiting_parts');
    expect((await t.api.patch(`/api/tickets/${id}`, { status: 'made_up' })).status).toBe(400);
  });
});

describe('permissions', () => {
  it('lets agents work tickets and a project manager only view', async () => {
    const agent = await t.as('agent');
    const pm = await t.as('project_manager');
    const made = await agent.post('/api/tickets', { ...base, title: 'Agent ticket' });
    expect(made.status).toBe(201);
    expect((await agent.patch(`/api/tickets/${made.body.id}`, { status: 'assigned' })).status).toBe(200);

    expect((await pm.get('/api/tickets')).status).toBe(200);
    expect((await pm.get(`/api/tickets/${made.body.id}`)).status).toBe(200);
    expect((await pm.get(`/api/tickets/${made.body.id}/sla`)).status).toBe(200);
    expect((await pm.get('/api/tickets/metrics')).status).toBe(200);
    expect((await pm.post('/api/tickets', { ...base })).status).toBe(403);
    expect((await pm.patch(`/api/tickets/${made.body.id}`, { status: 'closed' })).status).toBe(403);
    expect((await pm.del(`/api/tickets/${made.body.id}`)).status).toBe(403);
    expect((await pm.post('/api/problems', { title: 'No' })).status).toBe(403);
    expect((await pm.get('/api/knowledge')).status).toBe(403);
    expect((await pm.post(`/api/tickets/sla/calendars/${made.body.id}/holidays`, { day: '2026-12-25' })).status).toBe(403);
    expect((await t.anon.get('/api/tickets')).status).toBe(401);
  });
});

describe('problems, knowledge and catalog', () => {
  it('records a problem and drafts a known error in the knowledge base', async () => {
    const p = await t.api.post('/api/problems', { title: 'Printer jams', workaround: 'Use tray 2', root_cause: 'Worn roller' });
    expect(p.body.ref).toMatch(/^PRB-/);
    const ticket = await t.api.post('/api/tickets', { ...base, title: 'Jam', problem_id: p.body.id });
    expect(ticket.body._display.problem_id).toBe('Printer jams');
    const article = await t.api.post(`/api/problems/${p.body.id}/publish-known-error`);
    expect(article.status).toBe(201);
    expect(article.body.title).toBe('Known error: Printer jams');
    expect(article.body.body).toContain('Use tray 2');
    const after = (await t.api.get(`/api/problems/${p.body.id}`)).body;
    expect(after.known_error).toBe(true);
    expect(after.knowledge_article_id).toBe(article.body.id);
    expect((await t.api.post(`/api/problems/${p.body.id}/publish-known-error`)).status).toBe(409);
  });

  it('versions an article when its body changes and counts feedback', async () => {
    const a = await t.api.post('/api/knowledge', { title: 'Reset a password', body: 'First text', audience: 'staff' });
    expect(a.body.ref).toMatch(/^KB-/);
    expect(a.body.version).toBe(1);
    expect(a.body.status).toBe('draft');
    const id = a.body.id;
    expect((await t.api.patch(`/api/knowledge/${id}`, { status: 'published', version: 99 })).body.version).toBe(1);
    expect((await t.api.patch(`/api/knowledge/${id}`, { body: 'Second text' })).body.version).toBe(2);
    expect((await t.api.patch(`/api/knowledge/${id}`, { body: 'Third text', title: 'Reset a password safely' })).body.version).toBe(3);
    const versions = (await t.api.get(`/api/knowledge/${id}/versions`)).body;
    expect(versions.map((v: any) => [v.version, v.body, v.current])).toEqual([
      [3, 'Third text', true], [2, 'Second text', false], [1, 'First text', false],
    ]);
    expect(versions[2].title).toBe('Reset a password');

    // E18-17: one vote per person per article version; a repeat is not counted, a change replaces it.
    const agent = await t.as('agent');
    const other = await t.as('agent');
    expect((await agent.post(`/api/knowledge/${id}/feedback`, { helpful: true })).body).toMatchObject({ helpful_yes: 1, helpful_no: 0, changed: true });
    expect((await agent.post(`/api/knowledge/${id}/feedback`, { helpful: true })).body).toMatchObject({ helpful_yes: 1, helpful_no: 0, changed: false });
    expect((await other.post(`/api/knowledge/${id}/feedback`, { helpful: true })).body).toMatchObject({ helpful_yes: 2, helpful_no: 0 });
    const fb = await agent.post(`/api/knowledge/${id}/feedback`, { helpful: false });
    expect(fb.body).toMatchObject({ helpful_yes: 1, helpful_no: 1, your_vote: false, changed: true });
    expect((await agent.post(`/api/knowledge/${id}/feedback`, { helpful: 'maybe' })).status).toBe(400);
    // Feedback does not make a new version.
    expect((await t.api.get(`/api/knowledge/${id}`)).body.version).toBe(3);
    // A new version of the article can be voted on again.
    await t.api.patch(`/api/knowledge/${id}`, { body: 'Fourth text' });
    expect((await agent.post(`/api/knowledge/${id}/feedback`, { helpful: false })).body).toMatchObject({ helpful_yes: 1, helpful_no: 2, changed: true });
  });

  it('starts with the default catalog', async () => {
    const items = (await t.api.get('/api/catalog-items?sort=name')).body.rows;
    expect(items.map((i: any) => i.name)).toEqual([
      'Access request', 'Equipment fault', 'Hardware', 'Leaver', 'New starter', 'Software', 'Vendor access',
    ]);
    const fault = items.find((i: any) => i.name === 'Equipment fault');
    const made = await t.api.post('/api/tickets', { ...fault.defaults, title: `${fault.defaults.title}router`, catalog_item_id: fault.id });
    expect(made.status).toBe(201);
    expect(made.body.type).toBe('incident');
    expect(made.body._display.catalog_item_id).toBe('Equipment fault');
    expect((await t.api.post('/api/catalog-items', { name: 'Bad', defaults: '[1,2]' })).status).toBe(400);
  });
});

describe('sample data', () => {
  it('seeds about 40 labeled tickets once', async () => {
    clock.set('2026-12-10T17:00:00Z');
    const mod = t.modules.find((m) => m.key === 'tickets')!;
    const note = await mod.seed!(t.ctx, { profile: 'dev', seedDir: '' });
    expect(String(note)).toMatch(/40 sample tickets/);
    const count = async (where = 'true') =>
      (await t.db.one<{ n: number }>(`select count(*)::int as n from tickets where title like '[Sample]%' and ${where}`))!.n;
    expect(await count()).toBe(40);
    expect(await count('response_breached or resolve_breached')).toBeGreaterThanOrEqual(3);
    expect(await count('with_vendor')).toBeGreaterThanOrEqual(3);
    expect(await count(`opened_at < '2026-11-09T00:00:00Z'`)).toBe(0);
    expect(await count('major_incident')).toBe(1);
    expect(await count('parent_ticket_id is not null')).toBe(2);
    expect((await t.db.one<{ n: number }>(`select count(*)::int as n from problems where title like '[Sample]%'`))!.n).toBe(2);
    expect((await t.db.one<{ n: number }>(`select count(*)::int as n from knowledge_articles where title like '[Sample]%'`))!.n).toBe(4);
    const item = await t.db.one<{ questions: unknown[]; tasks: unknown[] }>(`select questions, tasks from catalog_items where name like '[Sample]%'`);
    expect(item?.questions).toHaveLength(4);
    expect(item?.tasks).toHaveLength(3);

    expect(String(await mod.seed!(t.ctx, { profile: 'pilot', seedDir: '' }))).toMatch(/skipped/);
    expect(await count()).toBe(40);
  });
});
