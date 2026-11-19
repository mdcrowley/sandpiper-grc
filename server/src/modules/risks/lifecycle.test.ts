import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// Revoking and expiry of acceptances, reviews, the board report, the scale preview, action
// sources, assignment notifications and shared restricted actions. All data here is invented.

let t: Awaited<ReturnType<typeof testApp>>;
let lead: Awaited<ReturnType<typeof t.as>>;
let agent: Awaited<ReturnType<typeof t.as>>;
let reader: Awaited<ReturnType<typeof t.as>>; // risks.* without security.view

beforeAll(async () => {
  t = await testApp();
  lead = await t.as('security_lead');
  agent = await t.as('agent');
  const role = await t.db.one<{ id: string }>(`insert into roles (key, name) values ('risk_admin_only', 'Risk administrator only') returning id`);
  await t.db.query(`insert into role_permissions (role_id, permission) values ($1, 'risks.*')`, [role!.id]);
  reader = await t.as('risk_admin_only');
});
afterAll(async () => { await t.close(); });

const plus = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const hasNotify = () => t.app.hasDecorator('notify');
const notes = (userId: string, kind?: string) => t.db.query<{ title: string; kind: string; route: string | null }>(
  `select title, kind, route from notifications where user_id = $1 ${kind ? 'and kind = $2' : 'and $2::text is null'} order by created_at`, [userId, kind ?? null]);

describe('heat map extras', () => {
  it('shows closed risks only when asked, with movements and a ranked list', async () => {
    const moved = (await t.api.post('/api/risks', { title: 'Mover', inherent_likelihood: 4, inherent_impact: 4, residual_likelihood: 2, residual_impact: 3 })).body;
    const still = (await t.api.post('/api/risks', { title: 'Stays put', inherent_likelihood: 2, inherent_impact: 2, residual_likelihood: 2, residual_impact: 2 })).body;
    const closed = (await t.api.post('/api/risks', { title: 'Shut', inherent_likelihood: 5, inherent_impact: 5, residual_likelihood: 5, residual_impact: 4, status: 'closed' })).body;

    const open = (await t.api.get('/api/risks/heatmap?scale=cyber_5x5')).body;
    expect(open.include_closed).toBe(false);
    expect(open.risks.map((r: any) => r.title)).toEqual(['Mover', 'Stays put']); // ranked, highest residual first
    expect(open.risks[0]).toMatchObject({ id: moved.id, likelihood: 2, impact: 3, inherent: { likelihood: 4, impact: 4, rating: 'high' }, residual: { rating: 'medium' } });
    expect(open.movements).toEqual([{ from: { likelihood: 4, impact: 4 }, to: { likelihood: 2, impact: 3 }, count: 1, risk_ids: [moved.id] }]);

    const all = (await t.api.get('/api/risks/heatmap?scale=cyber_5x5&include_closed=true')).body;
    expect(all.include_closed).toBe(true);
    expect(all.total).toBe(3);
    expect(all.risks[0]).toMatchObject({ id: closed.id, closed: true });
    expect(all.cells.find((c: any) => c.likelihood === 5 && c.impact === 4).count).toBe(1);
    expect((await agent.get('/api/risks/heatmap?include_closed=true')).status).toBe(403);
    expect((await reader.get('/api/risks/heatmap?include_closed=true')).status).toBe(403);
    for (const r of [moved, still, closed]) await t.api.del(`/api/risks/${r.id}`);
  });
});

describe('scale preview', () => {
  it('validates a proposed scale and counts the risks it would re-rate, without saving', async () => {
    const risk = (await t.api.post('/api/risks', { title: 'Preview probe', inherent_likelihood: 2, inherent_impact: 2 })).body;
    const scale = (await t.api.get('/api/risks/scales/cyber_5x5')).body;
    const matrix = { ...scale.matrix, '2': { ...scale.matrix['2'], '2': 'medium' } };

    const preview = await t.api.post('/api/risks/scales/cyber_5x5/preview', { matrix });
    expect(preview.status).toBe(200);
    expect(preview.body).toEqual({ total: 1, rerated: 1, level_in_use: false });
    expect((await t.api.get(`/api/risks/${risk.id}`)).body.inherent_rating).toBe('low'); // nothing saved
    expect((await t.db.query(`select 1 from audit_events where action = 'risk_scale.update'`)).length).toBe(0);

    const dropped = await t.api.post('/api/risks/scales/cyber_5x5/preview', { likelihood_levels: scale.likelihood_levels.filter((l: any) => l.value !== 2) });
    expect(dropped.body.level_in_use).toBe(true); // saving would be refused: a risk is scored on that level
    const bad = await t.api.post('/api/risks/scales/cyber_5x5/preview', { acceptance_threshold: 'bogus' });
    expect(bad.body.error.fields.acceptance_threshold).toBeDefined();
    expect((await t.api.post('/api/risks/scales/nope/preview', {})).status).toBe(404);

    // Counts of risks are restricted: an administrator of scales without security.view gets none.
    expect((await reader.post('/api/risks/scales/cyber_5x5/preview', { matrix })).body).toEqual({ total: null, rerated: null, level_in_use: null });
    expect((await agent.post('/api/risks/scales/cyber_5x5/preview', { matrix })).status).toBe(403);
    await t.api.del(`/api/risks/${risk.id}`);
  });
});

describe('revoking and expiry of acceptances', () => {
  it('revokes an acceptance with a reason, keeps the record and reopens the risk', async () => {
    const risk = (await lead.post('/api/risks', { title: 'Revocable', inherent_likelihood: 2, inherent_impact: 2 })).body;
    const acc = (await lead.post(`/api/risks/${risk.id}/acceptances`, { expires_on: plus(200), rationale: 'Invented reason' })).body;
    expect((await lead.get(`/api/risks/${risk.id}`)).body.status).toBe('accepted');
    const url = `/api/risks/${risk.id}/acceptances/${acc.id}/revoke`;

    expect((await agent.post(url, { reason: 'x' })).status).toBe(403);
    expect((await reader.post(url, { reason: 'x' })).status).toBe(403); // risks.approve without security.view
    expect((await (await t.as('auditor')).post(url, { reason: 'x' })).status).toBe(403);
    expect((await lead.post(url, {})).body.error.fields.reason).toBeDefined();
    expect((await lead.post(url, { reason: 'x', revoked_on: plus(3) })).body.error.fields.revoked_on).toMatch(/future/);
    expect((await lead.post(`/api/risks/${risk.id}/acceptances/11111111-2222-4333-8444-555555555555/revoke`, { reason: 'x' })).status).toBe(404);

    const done = await lead.post(url, { reason: 'The control it relied on was removed' });
    expect(done.status).toBe(200);
    expect(done.body.revoked_reason).toBe('The control it relied on was removed');
    expect((await lead.get(`/api/risks/${risk.id}`)).body.status).toBe('open');
    const list = (await lead.get(`/api/risks/${risk.id}/acceptances`)).body.acceptances;
    expect(list.length).toBe(1); // never deleted
    expect(list[0]).toMatchObject({ state: 'revoked', revoked_on: plus(0), revoked_by_name: expect.stringContaining('security_lead') });
    expect((await lead.post(url, { reason: 'again' })).body.error.code).toBe('already_revoked');

    const history = (await lead.get(`/api/history?record_type=risk&record_id=${risk.id}`)).body.map((h: any) => h.action);
    expect(history).toContain('risk.acceptance_revoke');
    // A revoked acceptance no longer lets the risk be marked accepted, and is not on the renewals list.
    expect((await lead.patch(`/api/risks/${risk.id}`, { status: 'accepted' })).body.error.fields.status).toBeDefined();
    expect((await lead.get('/api/risks/acceptances-expiring?days=3650')).body.some((a: any) => a.risk_id === risk.id)).toBe(false);

    // With an earlier acceptance still standing, revoking the newer one leaves the risk accepted.
    await lead.post(`/api/risks/${risk.id}/acceptances`, { expires_on: plus(300), rationale: 'First' });
    const second = (await lead.post(`/api/risks/${risk.id}/acceptances`, { expires_on: plus(400), rationale: 'Second' })).body;
    await lead.post(`/api/risks/${risk.id}/acceptances/${second.id}/revoke`, { reason: 'Recorded by mistake' });
    expect((await lead.get(`/api/risks/${risk.id}`)).body.status).toBe('accepted');
    const states = (await lead.get(`/api/risks/${risk.id}/acceptances`)).body.acceptances.map((a: any) => a.state).sort();
    expect(states).toEqual(['current', 'revoked', 'revoked']);
    await lead.del(`/api/risks/${risk.id}`);
  });

  it('moves a risk whose acceptance has expired to "needs review" and tells the owner', async () => {
    const risk = (await lead.post('/api/risks', { title: 'Lapsing', inherent_likelihood: 2, inherent_impact: 2, owner_id: lead.userId })).body;
    const soon = (await lead.post('/api/risks', { title: 'Nearly lapsing', inherent_likelihood: 1, inherent_impact: 2, owner_id: lead.userId })).body;
    await lead.post(`/api/risks/${risk.id}/acceptances`, { expires_on: plus(100), rationale: 'Invented reason' });
    await lead.post(`/api/risks/${soon.id}/acceptances`, { expires_on: plus(10), rationale: 'Invented reason' });

    expect((await agent.post('/api/risks/checks/run')).status).toBe(403);
    expect((await reader.post('/api/risks/checks/run')).status).toBe(403);
    const quiet = (await t.api.post('/api/risks/checks/run')).body;
    expect(quiet.expired).toBe(0);
    expect(quiet.expiring).toBe(hasNotify() ? 1 : 0);
    expect((await t.api.post('/api/risks/checks/run')).body.expiring).toBe(0); // told once

    await t.db.query(`update risk_acceptances set approved_on = current_date - 400, expires_on = current_date - 2 where risk_id = $1`, [risk.id]);
    const before = (await lead.get('/api/risks/summary')).body;
    expect(before.acceptances_expired).toBe(1);
    expect(before.acceptances_expiring).toBe(1);
    expect(before.needs_review).toBe(0);

    const run = (await t.api.post('/api/risks/checks/run')).body;
    expect(run.expired).toBe(1);
    const after = (await lead.get(`/api/risks/${risk.id}`)).body;
    expect(after.status).toBe('needs_review');
    expect(after._display.status).toBe('Needs review');
    const event = await t.db.one<{ actor_id: string | null }>(`select actor_id from audit_events where action = 'risk.acceptance_expired' and record_id = $1`, [risk.id]);
    expect(event).toBeDefined();
    expect(event!.actor_id).toBeNull(); // a system event
    expect((await t.api.post('/api/risks/checks/run')).body.expired).toBe(0); // and only once

    // It stays on the renewals list, marked expired, and in the summary counts.
    const renewals = (await lead.get('/api/risks/acceptances-expiring?days=60')).body;
    expect(renewals.map((a: any) => [a.risk_id, a.expired])).toEqual([[risk.id, true], [soon.id, false]]);
    expect((await lead.get('/api/risks/summary')).body).toMatchObject({ needs_review: 1, acceptances_expired: 1 });
    if (hasNotify()) {
      const titles = (await notes(lead.userId, 'reminder')).map((n) => n.title);
      expect(titles.some((x) => x.startsWith('Acceptance expired: ') && x.endsWith('Lapsing'))).toBe(true);
      expect(titles.some((x) => x.startsWith('Acceptance expires in 10 days: '))).toBe(true);
    }
    // Renewing puts it back.
    await lead.post(`/api/risks/${risk.id}/acceptances`, { expires_on: plus(90), rationale: 'Renewed' });
    expect((await lead.get(`/api/risks/${risk.id}`)).body.status).toBe('accepted');
    for (const r of [risk, soon]) await lead.del(`/api/risks/${r.id}`);
  });
});

describe('reviews and the board report', () => {
  it('lists reviews due, records a completed review and reminds the owner once', async () => {
    const risk = (await lead.post('/api/risks', {
      title: 'Reviewable', inherent_likelihood: 4, inherent_impact: 4, residual_likelihood: 3, residual_impact: 3, review_on: plus(-3), owner_id: lead.userId,
    })).body;
    const far = (await lead.post('/api/risks', { title: 'Not yet', inherent_likelihood: 1, inherent_impact: 1, review_on: plus(200) })).body;

    const due = (await lead.get('/api/risks/reviews-due')).body;
    expect(due.map((r: any) => r.id)).toEqual([risk.id]);
    expect(due[0]).toMatchObject({ overdue: true, days_left: -3, rating_label: 'Medium' });
    expect((await agent.get('/api/risks/reviews-due')).status).toBe(403);
    expect((await reader.get('/api/risks/reviews-due')).status).toBe(403);
    expect((await agent.get(`/api/risks/${risk.id}/reviews`)).status).toBe(403);
    expect((await agent.post(`/api/risks/${risk.id}/reviews`, { next_review_on: plus(90) })).status).toBe(403);
    expect((await reader.post(`/api/risks/${risk.id}/reviews`, { next_review_on: plus(90) })).status).toBe(403);

    const run = (await t.api.post('/api/risks/checks/run')).body;
    expect(run.reviews).toBe(hasNotify() ? 1 : 0);
    expect((await t.api.post('/api/risks/checks/run')).body.reviews).toBe(0);

    expect((await lead.post(`/api/risks/${risk.id}/reviews`, {})).body.error.fields.next_review_on).toBeDefined();
    expect((await lead.post(`/api/risks/${risk.id}/reviews`, { next_review_on: plus(-1) })).body.error.fields.next_review_on).toMatch(/after/);
    const first = await lead.post(`/api/risks/${risk.id}/reviews`, { next_review_on: plus(90), note: 'Controls still working' });
    expect(first.status).toBe(201);
    expect(first.body.residual_rating).toBe('medium');
    const now = (await lead.get(`/api/risks/${risk.id}`)).body;
    expect(now).toMatchObject({ review_on: plus(90), last_reviewed_on: plus(0) });
    expect((await lead.get('/api/risks/reviews-due')).body).toEqual([]);
    expect((await lead.get(`/api/history?record_type=risk&record_id=${risk.id}`)).body.map((h: any) => h.action)).toContain('risk.review');

    // Movement: re-scored worse since that review, so the report shows it as increased.
    await lead.patch(`/api/risks/${risk.id}`, { residual_likelihood: 4, residual_impact: 4 });
    const reviews = (await lead.get(`/api/risks/${risk.id}/reviews`)).body;
    expect(reviews[0]).toMatchObject({ note: 'Controls still working', residual_label: 'Medium', reviewed_by: expect.stringContaining('security_lead') });

    const report = (await lead.get('/api/risks/report')).body;
    expect(report.total).toBe(2);
    expect(report.top[0]).toMatchObject({ id: risk.id, rating_label: 'High', movement: 'up', previous_label: 'Medium', inherent_label: 'High', residual_label: 'High' });
    expect(report.increased.map((r: any) => r.id)).toEqual([risk.id]);
    expect(report.decreased).toEqual([]);
    expect(report.not_reviewed).toBe(1);
    expect(report.levels.find((l: any) => l.value === 'high').count).toBe(1);
    // A second review at the new rating: movement is still measured against the review before it.
    await lead.post(`/api/risks/${risk.id}/reviews`, { next_review_on: plus(120) });
    expect((await lead.get('/api/risks/report')).body.top[0]).toMatchObject({ movement: 'up', previous_label: 'Medium' });

    // Acceptances about to expire are in the report; follow-up work is counted per risk.
    await lead.post(`/api/risks/${far.id}/acceptances`, { expires_on: plus(30), rationale: 'Invented reason' });
    await lead.post('/api/actions', { title: 'Follow-up', source_type: 'risk', source_id: risk.id, due_on: plus(-2) });
    const again = (await lead.get('/api/risks/report?top=1')).body;
    expect(again.top.length).toBe(1);
    expect(again.top[0].actions).toEqual({ open: 1, overdue: 1 });
    expect(again.acceptances.map((a: any) => [a.risk_id, a.days_left])).toEqual([[far.id, 30]]);

    expect((await agent.get('/api/risks/report')).status).toBe(403);
    expect((await reader.get('/api/risks/report')).status).toBe(403);
    for (const r of [risk, far]) await lead.del(`/api/risks/${r.id}`);
  });
});

describe('action sources and assignment', () => {
  it('offers the newer sources and files an action under its source record', async () => {
    const sources = (await t.api.get('/api/lookups/action_source')).body.map((v: any) => v.value);
    expect(sources).toEqual(expect.arrayContaining(['change', 'vulnerability', 'policy', 'training', 'vendor', 'problem', 'other']));
    expect((await t.api.get('/api/lookups/action_source')).body.find((v: any) => v.value === 'problem').label).toBe('Problem');
    // A problem record files its actions under "Problem" when the tickets module is loaded (its type must exist to be a source).
    if (t.ctx.resources.get('problem')) {
      const problem = await t.ctx.resources.create('problem', { title: 'Invented recurring depot printer fault' });
      expect((await t.api.post('/api/actions', { title: 'From a problem', source_type: 'problem', source_id: problem.id })).body.source).toBe('problem');
    } else {
      expect((await t.api.post('/api/actions', { title: 'From a problem', source_type: 'problem', source_id: '11111111-2222-4333-8444-555555555556' })).body.source).toBe('problem');
    }
    expect((await agent.get('/api/lookups/action_source')).status).toBe(200);

    const risk = (await lead.post('/api/risks', { title: 'Source probe' })).body;
    expect((await lead.post('/api/actions', { title: 'From a risk', source_type: 'risk', source_id: risk.id })).body.source).toBe('risk');
    expect((await agent.post('/api/actions', { title: 'From nowhere' })).body.source).toBe('other');
    expect((await agent.post('/api/actions', { title: 'From an unknown type', source_type: 'widget', source_id: '11111111-2222-4333-8444-555555555555' })).body.source).toBe('other');
    expect((await agent.post('/api/actions', { title: 'Chosen', source: 'vendor' })).body._display.source).toBe('Vendor');
    await lead.del(`/api/risks/${risk.id}`);
  });

  it('tells a person when an action becomes theirs, once, and leaves due reminders to the digest', async () => {
    if (!hasNotify()) return; // the notifications module is not loaded in this run
    const other = await t.as('agent');
    const made = (await agent.post('/api/actions', { title: 'Wombat handover', owner_id: other.userId, due_on: plus(-1) })).body;
    expect((await notes(other.userId)).map((n) => [n.kind, n.title])).toEqual([['assignment', 'Action assigned to you: Wombat handover']]);

    await agent.post('/api/actions', { title: 'My own', owner_id: agent.userId }); // nobody tells me about my own work
    await agent.patch(`/api/actions/${made.id}`, { status: 'in_progress' }); // no change of owner
    expect((await notes(agent.userId)).length).toBe(0);
    expect((await notes(other.userId)).length).toBe(1);

    await other.patch(`/api/actions/${made.id}`, { owner_id: agent.userId });
    expect((await notes(agent.userId, 'assignment')).length).toBe(1);
    // Overdue and due-soon reminders are the daily digest's: nothing of that kind comes from here.
    expect((await notes(other.userId, 'due')).length).toBe(0);

    // An owner who may not see a restricted action is not told its title.
    const risk = (await lead.post('/api/risks', { title: 'Quiet risk' })).body;
    await lead.post('/api/actions', { title: 'Numbat secret follow-up', source_type: 'risk', source_id: risk.id, owner_id: other.userId });
    expect((await notes(other.userId)).some((n) => n.title.includes('Numbat'))).toBe(false);
    await lead.del(`/api/risks/${risk.id}`);
  });
});

describe('sharing one restricted action', () => {
  it('lets the person it is shared with see and progress that action, and nothing else', async () => {
    const stranger = await t.as('agent');
    const risk = (await lead.post('/api/risks', { title: 'Bilby risk' })).body;
    const action = (await lead.post('/api/actions', {
      title: 'Bilby restricted follow-up', source_type: 'risk', source_id: risk.id, owner_id: agent.userId, due_on: plus(5), notes: 'Start here',
    })).body;
    const open = (await agent.post('/api/actions', { title: 'Bilby ordinary action' })).body;
    expect(action.restricted).toBe(true);

    // Before sharing: invisible to the agent, and the agent cannot share or list shares.
    expect((await agent.get('/api/actions/shared-with-me')).body).toEqual([]);
    expect((await agent.get(`/api/actions/shared/${action.id}`)).status).toBe(404);
    expect((await agent.get(`/api/actions/${action.id}/shares`)).status).toBe(404);
    expect((await agent.post(`/api/actions/${action.id}/shares`, { user_id: agent.userId })).status).toBe(404);
    expect((await (await t.as('executive_viewer')).get('/api/actions/shared-with-me')).status).toBe(403);

    expect((await lead.post(`/api/actions/${open.id}/shares`, { user_id: agent.userId })).body.error.code).toBe('not_restricted');
    expect((await lead.post(`/api/actions/${action.id}/shares`, { user_id: 'nope' })).body.error.fields.user_id).toBeDefined();
    const shared = await lead.post(`/api/actions/${action.id}/shares`, { user_id: agent.userId });
    expect(shared.status).toBe(201);
    await lead.post(`/api/actions/${action.id}/shares`, { user_id: agent.userId }); // repeating is harmless
    expect((await lead.get(`/api/actions/${action.id}/shares`)).body).toMatchObject({ restricted: true, shares: [{ user_id: agent.userId }] });
    expect((await t.db.query(`select 1 from audit_events where action = 'action.share' and record_id = $1`, [action.id])).length).toBe(1);

    // The sharee sees the action through the shared routes only, without its source record.
    const mine = (await agent.get('/api/actions/shared-with-me')).body;
    expect(mine.length).toBe(1);
    expect(mine[0]).toMatchObject({ id: action.id, title: 'Bilby restricted follow-up', shared: true, notes: 'Start here', due_on: plus(5) });
    expect(mine[0]._display).toMatchObject({ status: 'Open', owner_id: expect.stringContaining('agent') });
    expect(Object.keys(mine[0])).not.toEqual(expect.arrayContaining(['source_id']));
    expect(mine[0].source_type).toBeUndefined();
    expect((await agent.get(`/api/actions/shared/${action.id}`)).body.ref).toBe(action.ref);
    // Everything else stays shut: the generic routes, search, the risk itself, and other people.
    expect((await agent.get(`/api/actions/${action.id}`)).status).toBe(404);
    expect((await agent.get('/api/actions?q=Bilby')).body.rows.map((r: any) => r.title)).toEqual(['Bilby ordinary action']);
    expect((await agent.get('/api/search?q=Bilby')).body.map((r: any) => r.label)).toEqual(['Bilby ordinary action']);
    expect((await agent.get(`/api/risks/${risk.id}`)).status).toBe(403);
    expect((await stranger.get('/api/actions/shared-with-me')).body).toEqual([]);
    expect((await stranger.get(`/api/actions/shared/${action.id}`)).status).toBe(404);
    expect((await stranger.patch(`/api/actions/shared/${action.id}`, { status: 'done' })).status).toBe(404);
    if (hasNotify()) {
      const told = await notes(agent.userId, 'assignment');
      expect(told.map((n) => [n.title, n.route])).toContainEqual(['A restricted action has been shared with you', '/actions/mine']);
      expect(told.some((n) => n.title.includes('Bilby restricted'))).toBe(false);
    }

    // The sharee may change status and notes, nothing else.
    expect((await agent.patch(`/api/actions/shared/${action.id}`, { title: 'Renamed' })).body.error.fields.title).toBeDefined();
    expect((await agent.patch(`/api/actions/shared/${action.id}`, { status: 'nonsense' })).status).toBe(400);
    const done = await agent.patch(`/api/actions/shared/${action.id}`, { status: 'done', notes: 'Finished' });
    expect(done.body).toMatchObject({ status: 'done', completed_on: plus(0), notes: 'Finished' });
    expect((await lead.get(`/api/actions/${action.id}`)).body.status).toBe('done');
    const attributed = await t.db.one<{ actor_id: string }>(`select actor_id from audit_events where action = 'action.shared_update' and record_id = $1`, [action.id]);
    expect(attributed!.actor_id).toBe(agent.userId);

    // Unsharing closes it again; so does the action stopping being restricted (it is then simply visible).
    expect((await agent.del(`/api/actions/${action.id}/shares/${agent.userId}`)).status).toBe(404);
    expect((await lead.del(`/api/actions/${action.id}/shares/${agent.userId}`)).status).toBe(200);
    expect((await lead.del(`/api/actions/${action.id}/shares/${agent.userId}`)).status).toBe(404);
    expect((await agent.get('/api/actions/shared-with-me')).body).toEqual([]);
    expect((await agent.get(`/api/actions/shared/${action.id}`)).status).toBe(404);
    await lead.del(`/api/risks/${risk.id}`);
  });
});
