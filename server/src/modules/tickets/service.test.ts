import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef } from '../../core/module.ts';
import { ADMIN, testApp } from '../../test/helpers.ts';
import { keywords } from './assist.ts';
import { clock } from './clock.ts';

// Invented data only. November 2026 is on standard time: 08:00 local = 13:00Z. 18 November is a Wednesday.
// Notifications: with the notifications module loaded the real table is read; alone, a recorder stands in.
const calls: { kind: string; title: string; userIds?: string[]; permission?: string }[] = [];
const recorder: ModuleDef = {
  key: 'test_notify_recorder',
  async register(ctx) {
    if (!ctx.app.hasDecorator('notify')) {
      (ctx.app as any).decorate('notify', async (input: any) => { calls.push(input); return { sent: 1, skipped: 0 }; });
    }
  },
};

let t: Awaited<ReturnType<typeof testApp>>;
let real = false;
let agent: Awaited<ReturnType<typeof t.as>>;
let cookie = '';
beforeAll(async () => {
  t = await testApp({ extraModules: [recorder] });
  real = t.modules.some((m) => m.key === 'notifications');
  agent = await t.as('agent');
  const res = await t.app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-grc-csrf': '1' }, payload: { username: ADMIN.username, password: ADMIN.password } });
  cookie = res.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
});
afterAll(async () => { clock.set(null); await t.close(); });

async function put(url: string, body: unknown) {
  const res = await t.app.inject({ method: 'PUT', url, headers: { cookie, 'x-grc-csrf': '1' }, payload: body as object });
  return { status: res.statusCode, body: res.json() };
}

/** How many notices of a kind whose title matches reached this person (or anyone). */
async function notices(kind: string, title: RegExp, userId?: string): Promise<number> {
  if (real) {
    const rows = await t.db.query<{ title: string; user_id: string }>('select title, user_id from notifications where kind = $1', [kind]);
    return rows.filter((r) => title.test(r.title) && (!userId || r.user_id === userId)).length;
  }
  return calls.filter((c) => c.kind === kind && title.test(c.title) && (!userId || c.userIds?.includes(userId) || !!c.permission)).length;
}

const base = { requester_name: 'Pat Example', requester_department: 'Finance' };
const sweep = () => t.api.get('/api/tickets?pageSize=1');

describe('assignment and target notifications (E03-13)', () => {
  it('tells a new assignee, warns once before the target and again when it is missed', async () => {
    clock.set('2026-11-18T15:00:00Z');
    const made = await t.api.post('/api/tickets', { ...base, title: 'Shared drive is slow for accounts', impact: 'department', urgency: 'medium', assignee_id: agent.userId });
    expect(made.status).toBe(201);
    expect(made.body.priority).toBe('p3');
    expect(await notices('assignment', /assigned to you: TKT-\d+ Shared drive/, agent.userId)).toBe(1);
    // Nobody is told about their own action.
    const own = await agent.post('/api/tickets', { ...base, title: 'Own ticket', assignee_id: agent.userId });
    expect(await notices('assignment', /Own ticket/)).toBe(0);
    await agent.patch(`/api/tickets/${own.body.id}`, { status: 'cancelled' });

    // P3 resolves in 27 working hours: due Monday 10:00 local. At 16:00 on Friday 3 working hours are left (under a quarter).
    await sweep();
    expect(await notices('sla', /Close to the resolve target: .*Shared drive/)).toBe(0);
    clock.set('2026-11-20T21:00:00Z');
    await sweep();
    await sweep();
    expect(await notices('sla', /Close to the resolve target: .*Shared drive/, agent.userId)).toBe(1);
    expect((await t.api.get(`/api/tickets/${made.body.id}`)).body.resolve_warned).toBe(true);
    expect((await t.api.get('/api/tickets?f.resolve_warned=true&f.resolve_breached=false')).body.rows.map((r: any) => r.id)).toContain(made.body.id);

    clock.set('2026-11-23T16:00:00Z');
    await sweep();
    await sweep();
    expect(await notices('sla', /Resolution target missed: .*Shared drive/, agent.userId)).toBe(1);
    await t.api.patch(`/api/tickets/${made.body.id}`, { status: 'cancelled' });
  });

  it('warns the assignment group about an unassigned ticket, at the share an administrator sets', async () => {
    expect((await put('/api/tickets/sla/settings', { warning_pct: 150 })).status).toBe(400);
    expect((await put('/api/tickets/sla/settings', { group_members: { nowhere: [agent.userId] } })).status).toBe(400);
    expect((await agent.get('/api/tickets/sla/settings')).body.warning_pct).toBe(75);
    const saved = await put('/api/tickets/sla/settings', { warning_pct: 50, group_members: { service_desk: [agent.userId] } });
    expect(saved.status).toBe(200);
    expect(saved.body.groups.find((g: any) => g.value === 'service_desk').members).toEqual([{ id: agent.userId, label: expect.any(String) }]);

    clock.set('2026-11-24T15:00:00Z');
    const made = await t.api.post('/api/tickets', { ...base, title: 'Card reader offline at reception', impact: 'department', urgency: 'high', assignment_group: 'service_desk' });
    expect(made.body.priority).toBe('p2');
    expect(await notices('assignment', /assigned to Service desk: .*Card reader/, agent.userId)).toBe(1);
    clock.set('2026-11-24T15:20:00Z');
    await sweep();
    expect(await notices('sla', /Close to the respond target: .*Card reader/)).toBe(0);
    clock.set('2026-11-24T15:31:00Z'); // 29 of 60 minutes left: over half used
    await sweep();
    expect(await notices('sla', /Close to the respond target: .*Card reader/, agent.userId)).toBe(1);
    clock.set('2026-11-24T16:05:00Z');
    await sweep();
    expect(await notices('sla', /Response target missed: .*Card reader/, agent.userId)).toBe(1);

    // Zero switches warnings off.
    await put('/api/tickets/sla/settings', { warning_pct: 0 });
    const quiet = await t.api.post('/api/tickets', { ...base, title: 'Quiet ticket for the switch', impact: 'department', urgency: 'high' });
    clock.set('2026-11-24T16:55:00Z');
    await sweep();
    expect(await notices('sla', /Close to the respond target: .*Quiet ticket/)).toBe(0);
    await put('/api/tickets/sla/settings', { warning_pct: 75 });
    for (const id of [made.body.id, quiet.body.id]) await t.api.patch(`/api/tickets/${id}`, { status: 'cancelled' });
  });
});

describe('escalation rules (E03-14)', () => {
  it('are data, count the wait in working time, fire once and can be switched off', async () => {
    expect((await (await t.as('project_manager')).post('/api/tickets/escalation-rules', { name: 'x', condition: 'unassigned', wait_minutes: 5, to_group: 'service_desk' })).status).toBe(403);
    expect((await t.api.post('/api/tickets/escalation-rules', { name: '', condition: 'never', wait_minutes: 0 })).body.error.fields).toMatchObject({
      name: expect.any(String), condition: expect.any(String), wait_minutes: expect.any(String), to_user_id: expect.any(String),
    });
    const rule = await t.api.post('/api/tickets/escalation-rules', { name: 'Unassigned for two hours', condition: 'unassigned', wait_minutes: 120, to_user_id: agent.userId });
    expect(rule.status).toBe(201);
    const off = await t.api.post('/api/tickets/escalation-rules', { name: 'Switched off', condition: 'unassigned', wait_minutes: 1, to_group: 'service_desk', enabled: false });
    expect(off.body.enabled).toBe(false);
    expect((await agent.get('/api/tickets/escalation-rules')).body.rules).toHaveLength(2);

    // Logged at 16:00 local on a Friday: one working hour that day.
    clock.set('2026-11-27T21:00:00Z');
    const made = await t.api.post('/api/tickets', { ...base, title: 'Projector will not start', impact: 'department', urgency: 'medium' });
    clock.set('2026-11-28T15:00:00Z'); // Saturday: 18 hours on the wall, one of them worked
    await sweep();
    expect((await t.api.get(`/api/tickets/${made.body.id}/escalations`)).body).toHaveLength(0);
    clock.set('2026-11-30T14:30:00Z'); // Monday 09:30 local: 150 working minutes
    await sweep();
    await sweep();
    const fired = (await t.api.get(`/api/tickets/${made.body.id}/escalations`)).body;
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ rule_name: 'Unassigned for two hours' });
    expect((await t.api.get(`/api/tickets/${made.body.id}`)).body.escalated_at).toBe('2026-11-30T14:30:00.000Z');
    const history = (await t.api.get(`/api/history?record_type=ticket&record_id=${made.body.id}`)).body;
    expect(history.filter((h: any) => h.action === 'ticket.escalated')).toHaveLength(1);
    expect(await notices('sla', /Escalated to you: .*Projector/, agent.userId)).toBe(1);

    // Changing and removing a rule is audited.
    expect((await put(`/api/tickets/escalation-rules/${rule.body.id}`, { enabled: false })).body.enabled).toBe(false);
    expect((await t.api.del(`/api/tickets/escalation-rules/${off.body.id}`)).status).toBe(200);
    expect((await t.api.get('/api/tickets/escalation-rules')).body.rules).toHaveLength(1);
    const audit = await t.db.query(`select action from audit_events where record_type = 'escalation_rule'`);
    expect(audit.map((a: any) => a.action).sort()).toEqual(['escalation_rule.create', 'escalation_rule.create', 'escalation_rule.delete', 'escalation_rule.update']);
    await t.api.patch(`/api/tickets/${made.body.id}`, { status: 'cancelled' });
  });
});

describe('working calendars (E03-17)', () => {
  it('can be added, and retired only when no target uses them', async () => {
    expect((await (await t.as('project_manager')).post('/api/tickets/sla/calendars', { name: 'Evening rota' })).status).toBe(403);
    const made = await t.api.post('/api/tickets/sla/calendars', { name: 'Evening rota' });
    expect(made.status).toBe(201);
    expect(made.body.hours.mon).toEqual(['08:00', '17:00']);
    expect((await t.api.post('/api/tickets/sla/calendars', { name: 'evening rota' })).status).toBe(400);
    expect((await t.api.post('/api/tickets/sla/calendars', { name: 'Elsewhere', timezone: 'Nowhere/Never' })).body.error.fields.timezone).toBeTruthy();

    const policies = (await t.api.get('/api/tickets/sla/policies')).body;
    const p4 = policies.find((p: any) => p.priority === 'p4');
    expect((await put('/api/tickets/sla/policies/p4', { respond_minutes: p4.respond_minutes, resolve_minutes: p4.resolve_minutes, calendar_id: made.body.id })).status).toBe(200);
    const refused = await t.api.del(`/api/tickets/sla/calendars/${made.body.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toContain('P4 Low');
    await put('/api/tickets/sla/policies/p4', { respond_minutes: p4.respond_minutes, resolve_minutes: p4.resolve_minutes, calendar_id: p4.calendar_id });
    expect((await t.api.del(`/api/tickets/sla/calendars/${made.body.id}`)).status).toBe(200);
    expect((await t.api.get('/api/tickets/sla/calendars')).body.map((c: any) => c.name)).not.toContain('Evening rota');
    const audit = await t.db.query(`select action from audit_events where record_type = 'calendar' and record_id = $1 order by at`, [made.body.id]);
    expect(audit.map((a: any) => a.action)).toEqual(['calendar.create', 'calendar.retire']);
  });

  it('previews when a ticket of a priority would fall due', async () => {
    clock.set('2026-12-02T15:00:00Z');
    const p = (await t.api.get('/api/tickets/sla/preview?priority=p2')).body;
    expect(p.response_due_at).toBe('2026-12-02T16:00:00.000Z');
    expect(p.resolve_due_at).toBe('2026-12-03T15:00:00.000Z');
    expect((await t.api.get('/api/tickets/sla/preview?priority=none')).body.policy).toBeNull();
  });
});

describe('catalogue items with questions, tasks and approval (E03-15)', () => {
  it('asks the questions, copies the tasks and holds work until approved', async () => {
    clock.set('2026-12-02T15:00:00Z');
    const bad = await t.api.post('/api/catalog-items', { name: 'Bad', questions: [{ label: 'Pick', type: 'choice', options: ['Only one'] }] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.questions).toContain('two choices');
    const item = await t.api.post('/api/catalog-items', {
      name: 'Door access card', category: 'access', requires_approval: true,
      defaults: { type: 'request', category: 'access', title: 'Door access: ' },
      questions: [{ label: 'Who needs the card', required: true }, { label: 'Which door', type: 'choice', options: ['Front', 'Stores'] }, { label: 'Needed from', type: 'date' }],
      tasks: ['Issue the card', { title: 'Record the card number' }, '  '],
    });
    expect(item.status).toBe(201);
    expect(item.body.questions.map((q: any) => q.key)).toEqual(['who_needs_the_card', 'which_door', 'needed_from']);
    expect(item.body.tasks).toEqual(['Issue the card', 'Record the card number']);

    const start = { ...base, title: 'Door access: stores', type: 'request', catalog_item_id: item.body.id };
    const missing = await agent.post('/api/tickets', start);
    expect(missing.status).toBe(400);
    expect(missing.body.error.fields['catalog_answers.who_needs_the_card']).toBe('Who needs the card is required.');
    expect((await agent.post('/api/tickets', { ...start, catalog_answers: { who_needs_the_card: 'Sam Sample', which_door: 'Roof' } })).status).toBe(400);
    const made = await agent.post('/api/tickets', { ...start, catalog_answers: { who_needs_the_card: 'Sam Sample', which_door: 'Stores' } });
    expect(made.status).toBe(201);
    expect(made.body.catalog_answers).toEqual([
      { key: 'who_needs_the_card', label: 'Who needs the card', value: 'Sam Sample' },
      { key: 'which_door', label: 'Which door', value: 'Stores' },
    ]);
    expect(made.body.fulfilment_tasks).toEqual([{ title: 'Issue the card', done: false }, { title: 'Record the card number', done: false }]);
    expect(made.body.approval_status).toBe('pending');
    expect(await notices('approval', /Approval needed: .*Door access: stores/)).toBeGreaterThanOrEqual(1);

    // Work cannot start, but the ticket can be assigned, wait or be cancelled.
    const url = `/api/tickets/${made.body.id}`;
    const blocked = await agent.patch(url, { status: 'in_progress' });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.fields.status).toContain('waiting for approval');
    expect((await agent.patch(url, { status: 'resolved', resolution_code: 'fulfilled' })).status).toBe(400);
    expect((await agent.patch(url, { status: 'assigned', assignee_id: agent.userId })).status).toBe(200);
    // People cannot approve by editing the field.
    expect((await agent.patch(url, { approval_status: 'approved' })).body.approval_status).toBe('pending');

    const viewer = await t.as('project_manager');
    expect((await viewer.post(`${url}/approval`, { decision: 'approved' })).status).toBe(403);
    expect((await t.api.post(`${url}/approval`, { decision: 'maybe' })).status).toBe(400);
    expect((await t.api.post(`${url}/approval`, { decision: 'rejected' })).body.error.fields.note).toBeTruthy();
    const approved = await t.api.post(`${url}/approval`, { decision: 'approved', note: 'Agreed with the site lead' });
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ approval_status: 'approved', approval_note: 'Agreed with the site lead' });
    expect(await notices('approval', /Request approved: .*Door access: stores/, agent.userId)).toBe(1);
    const history = (await t.api.get(`/api/history?record_type=ticket&record_id=${made.body.id}`)).body;
    expect(history.some((h: any) => h.action === 'ticket.approval' && h.actor_name === ADMIN.displayName)).toBe(true);

    expect((await agent.patch(url, { status: 'in_progress' })).status).toBe(200);
    const ticked = await agent.patch(url, { fulfilment_tasks: [{ title: 'Issue the card', done: true }, { title: 'Record the card number', done: false }] });
    expect(ticked.body.fulfilment_tasks[0]).toMatchObject({ title: 'Issue the card', done: true, done_at: expect.any(String), done_by_name: expect.stringContaining('agent') });
    expect(ticked.body.fulfilment_tasks[1]).toEqual({ title: 'Record the card number', done: false });
    expect((await agent.patch(url, { fulfilment_tasks: [{ title: '' }] })).status).toBe(400);

    // A ticket with no catalogue item ignores answers, and an unknown item is refused.
    const plain = await agent.post('/api/tickets', { ...base, title: 'No item', catalog_answers: { x: 'y' } });
    expect(plain.body.catalog_answers).toBeNull();
    expect(plain.body.approval_status).toBeNull();
    expect((await agent.post('/api/tickets', { ...base, title: 'Lost item', catalog_item_id: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
  });
});

describe('"IT agents only" articles (E03-16)', () => {
  it('are hidden from people without the agent permission in lists, reads, search, pickers and links', async () => {
    const role = await t.db.one<{ id: string }>(`insert into roles (key, name) values ('reader', 'Reader') returning id`);
    for (const p of ['knowledge.view', 'knowledge.create', 'knowledge.edit']) await t.db.query('insert into role_permissions (role_id, permission) values ($1,$2)', [role!.id, p]);
    const reader = await t.as('reader');

    const open = await t.api.post('/api/knowledge', { title: 'Lanyard printer: setting up', body: 'Plug it in.', audience: 'staff', status: 'published' });
    const closed = await t.api.post('/api/knowledge', { title: 'Lanyard printer: service password', body: 'Kept in the safe.', audience: 'agents', status: 'published' });
    expect(closed.status).toBe(201);
    await t.api.post('/api/links', { from_type: 'knowledge_article', from_id: open.body.id, to_type: 'knowledge_article', to_id: closed.body.id });

    // An agent sees both.
    expect((await agent.get('/api/knowledge?q=Lanyard')).body.total).toBe(2);
    expect((await agent.get(`/api/knowledge/${closed.body.id}`)).status).toBe(200);
    expect((await agent.get('/api/search?q=Lanyard')).body.filter((r: any) => r.type === 'knowledge_article')).toHaveLength(2);

    // A reader sees only the article for all staff.
    const list = await reader.get('/api/knowledge?q=Lanyard');
    expect(list.body.rows.map((r: any) => r.id)).toEqual([open.body.id]);
    expect(list.body.total).toBe(1);
    expect((await reader.get('/api/knowledge?q=Lanyard&f.audience=agents')).body.total).toBe(0);
    expect((await reader.get('/api/knowledge?q=Lanyard&f.audience=agents,staff')).body.total).toBe(1);
    expect((await reader.get('/api/knowledge/stats?group=audience')).body.groups.map((g: any) => g.value)).not.toContain('agents');
    expect((await reader.get('/api/knowledge?format=csv')).status).toBe(403); // no export permission at all
    expect((await reader.get(`/api/knowledge/${open.body.id}`)).status).toBe(200);
    for (const path of ['', '/versions']) expect((await reader.get(`/api/knowledge/${closed.body.id}${path}`)).status).toBe(404);
    expect((await reader.patch(`/api/knowledge/${closed.body.id}`, { title: 'Mine now' })).status).toBe(404);
    expect((await reader.post(`/api/knowledge/${closed.body.id}/feedback`, { helpful: true })).status).toBe(404);
    expect((await reader.get('/api/search?q=Lanyard')).body.map((r: any) => r.id)).toEqual([open.body.id]);
    expect((await reader.get('/api/records/lookup?type=knowledge_article&q=Lanyard')).body.map((r: any) => r.id)).toEqual([open.body.id]);
    expect((await reader.get(`/api/links?record_type=knowledge_article&record_id=${open.body.id}`)).body).toEqual([]);
    expect((await agent.get(`/api/links?record_type=knowledge_article&record_id=${open.body.id}`)).body).toHaveLength(1);
    for (const route of ['comments', 'history', 'links']) {
      expect((await reader.get(`/api/${route}?record_type=knowledge_article&record_id=${closed.body.id}`)).status).toBe(404);
    }
    expect((await reader.post('/api/comments', { record_type: 'knowledge_article', record_id: closed.body.id, body: 'Hello' })).status).toBe(404);

    // A reader cannot write an article they would then lose sight of.
    expect((await reader.post('/api/knowledge', { title: 'Secret', audience: 'agents' })).body.error.fields.audience).toBeTruthy();
    expect((await reader.patch(`/api/knowledge/${open.body.id}`, { audience: 'agents' })).status).toBe(400);
    expect((await reader.post('/api/knowledge', { title: 'For everyone', audience: 'staff' })).status).toBe(201);
  });
});

describe('help while logging a ticket', () => {
  it('picks the useful words of a title', () => {
    expect(keywords('The printer on the second floor is not working, please help')).toEqual(['printer', 'second', 'floor']);
    expect(keywords('  ')).toEqual([]);
  });

  it('suggests likely duplicates and published articles, and counts the queues', async () => {
    clock.set('2026-12-03T15:00:00Z');
    const first = await agent.post('/api/tickets', { ...base, title: 'Lanyard printer jammed on second floor' });
    const other = await agent.post('/api/tickets', { ...base, title: 'Keyboard missing a key' });
    const s = await agent.get(`/api/tickets/suggest?title=${encodeURIComponent('Second floor lanyard printer is jammed again')}`);
    expect(s.status).toBe(200);
    expect(s.body.tickets.map((x: any) => x.id)).toEqual([first.body.id]);
    expect(s.body.articles.map((a: any) => a.title).sort()).toEqual(['Lanyard printer: service password', 'Lanyard printer: setting up']);
    // The ticket being edited is left out, and one shared word is not enough for a long title.
    expect((await agent.get(`/api/tickets/suggest?title=${encodeURIComponent('Lanyard printer jammed')}&exclude=${first.body.id}`)).body.tickets).toEqual([]);
    expect((await agent.get(`/api/tickets/suggest?title=${encodeURIComponent('Keyboard tray broken')}`)).body.tickets).toEqual([]);
    expect((await agent.get('/api/tickets/suggest?title=')).body).toEqual({ words: [], tickets: [], articles: [] });
    // Someone who can see tickets but not the knowledge base gets no articles.
    const viewer = await t.as('project_manager');
    expect((await viewer.get(`/api/tickets/suggest?title=${encodeURIComponent('Lanyard printer jammed')}`)).body.articles).toEqual([]);

    const before = (await agent.get('/api/tickets/queue-counts')).body;
    expect(before).toMatchObject({ open: expect.any(Number), mine: expect.any(Number), unassigned: expect.any(Number), breaching: expect.any(Number) });
    await agent.patch(`/api/tickets/${other.body.id}`, { assignee_id: agent.userId });
    const after = (await agent.get('/api/tickets/queue-counts')).body;
    expect(after.mine).toBe(before.mine + 1);
    expect(after.unassigned).toBe(before.unassigned - 1);
  });
});
