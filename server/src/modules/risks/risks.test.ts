import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import mod from './index.ts';
import { HAZARD_SCALE_NAME, LEGACY_HAZARD_SCALE_NAME } from './scales.ts';

// All data here is invented.

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

const plus = (days: number) => dayInZone(days);

describe('risk scales', () => {
  it('seeds the 5 by 5 scale and the safety hazard scale', async () => {
    const res = await t.api.get('/api/risks/scales');
    expect(res.status).toBe(200);
    expect(res.body.map((s: any) => s.key)).toEqual(['cyber_5x5', 'hazard_4x5']);
    const [five, hazard] = res.body;
    expect(five.likelihood_levels.length).toBe(5);
    expect(five.impact_levels.length).toBe(5);
    expect(five.matrix['5']['5']).toBe('extreme');
    expect(five.matrix['1']['1']).toBe('low');
    expect(hazard.name).toBe('Safety hazard matrix (4 by 5)');
    expect(hazard.impact_label).toBe('Severity');
    expect(hazard.impact_levels.map((l: any) => l.label)).toEqual(['Negligible', 'Marginal', 'Critical', 'Catastrophic']);
    expect(hazard.likelihood_levels.map((l: any) => l.label)).toEqual(['Improbable', 'Remote', 'Occasional', 'Probable', 'Frequent']);
    expect(hazard.ratings.map((r: any) => r.label)).toEqual(['Low', 'Medium', 'Serious', 'High']);
    // Corners and a middle cell of the standard hazard matrix.
    expect(hazard.matrix['5']['4']).toBe('high');      // Frequent / Catastrophic
    expect(hazard.matrix['5']['1']).toBe('medium');    // Frequent / Negligible
    expect(hazard.matrix['1']['4']).toBe('medium');    // Improbable / Catastrophic
    expect(hazard.matrix['1']['1']).toBe('low');       // Improbable / Negligible
    expect(hazard.matrix['3']['3']).toBe('serious');   // Occasional / Critical
    expect(hazard.matrix['2']['4']).toBe('serious');   // Remote / Catastrophic
    // Every rating maps to a common summary level.
    expect(hazard.ratings.find((r: any) => r.key === 'serious').summary_level).toBe('high');
    expect(five.ratings.find((r: any) => r.key === 'extreme').summary_level).toBe('critical');
    expect(five.acceptance_threshold).toBe('high');
    expect(hazard.acceptance_threshold).toBe('serious');
  });

  it('lets only risks.administer edit a scale, validates it and re-rates risks', async () => {
    const made = await t.api.post('/api/risks', { title: 'Scale edit probe', inherent_likelihood: 2, inherent_impact: 2 });
    expect(made.body.inherent_rating).toBe('low');
    const scale = (await t.api.get('/api/risks/scales/cyber_5x5')).body;

    const pm = await t.as('project_manager');
    expect((await pm.patch('/api/risks/scales/cyber_5x5', { name: 'Nope' })).status).toBe(403);

    const bad = await t.api.patch('/api/risks/scales/cyber_5x5', { matrix: { ...scale.matrix, '2': { ...scale.matrix['2'], '2': 'bogus' } } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.matrix).toBeDefined();

    const removed = await t.api.patch('/api/risks/scales/cyber_5x5', { likelihood_levels: scale.likelihood_levels.filter((l: any) => l.value !== 2) });
    expect(removed.status).toBe(400);

    const ok = await t.api.patch('/api/risks/scales/cyber_5x5', { matrix: { ...scale.matrix, '2': { ...scale.matrix['2'], '2': 'medium' } } });
    expect(ok.status).toBe(200);
    expect((await t.api.get(`/api/risks/${made.body.id}`)).body.inherent_rating).toBe('medium');
    expect((await t.db.query(`select 1 from audit_events where action = 'risk_scale.update'`)).length).toBe(1);

    await t.api.patch('/api/risks/scales/cyber_5x5', { matrix: scale.matrix });
    expect((await t.api.get(`/api/risks/${made.body.id}`)).body.inherent_rating).toBe('low');
    await t.api.del(`/api/risks/${made.body.id}`);
  });
});

describe('risks', () => {
  it('computes ratings on the scale chosen by the category', async () => {
    const cyber = await t.api.post('/api/risks', {
      title: 'Invented cyber risk', category: 'cyber',
      inherent_likelihood: 4, inherent_impact: 5, residual_likelihood: 2, residual_impact: 3,
      inherent_rating: 'low', // read-only: ignored
    });
    expect(cyber.status).toBe(201);
    expect(cyber.body.ref).toMatch(/^RSK-\d{5}$/);
    expect(cyber.body.scale_key).toBe('cyber_5x5');
    expect(cyber.body.inherent_rating).toBe('extreme');
    expect(cyber.body.residual_rating).toBe('medium');
    expect(cyber.body.summary_level).toBe('medium');
    expect(cyber.body.inherent_score).toBeGreaterThan(cyber.body.residual_score);
    expect(cyber.body.status).toBe('open');

    const safety = await t.api.post('/api/risks', {
      title: 'Invented safety hazard', category: 'safety',
      inherent_likelihood: 5, inherent_impact: 4, residual_likelihood: 2, residual_impact: 4,
    });
    expect(safety.body.scale_key).toBe('hazard_4x5');
    expect(safety.body.inherent_rating).toBe('high');
    expect(safety.body.residual_rating).toBe('serious');
    expect(safety.body.summary_level).toBe('high');
    expect(safety.body._display.summary_level).toBe('High');

    const rescored = await t.api.patch(`/api/risks/${safety.body.id}`, { residual_likelihood: 1, residual_impact: 1 });
    expect(rescored.body.residual_rating).toBe('low');
    expect(rescored.body.summary_level).toBe('low');
    await t.api.patch(`/api/risks/${safety.body.id}`, { residual_likelihood: 2, residual_impact: 4 });
  });

  it('validates scores against the selected scale', async () => {
    const tooHigh = await t.api.post('/api/risks', { title: 'Bad severity', category: 'safety', inherent_likelihood: 3, inherent_impact: 5 });
    expect(tooHigh.status).toBe(400);
    expect(tooHigh.body.error.fields.inherent_impact).toMatch(/Catastrophic/);

    const half = await t.api.post('/api/risks', { title: 'Half scored', inherent_likelihood: 3 });
    expect(half.body.error.fields.inherent_impact).toMatch(/both/);

    const fraction = await t.api.post('/api/risks', { title: 'Fraction', inherent_likelihood: 2.5, inherent_impact: 2 });
    expect(fraction.body.error.fields.inherent_likelihood).toBeDefined();

    expect((await t.api.post('/api/risks', { title: 'No such scale', scale_key: 'nope' })).body.error.fields.scale_key).toBeDefined();
    expect((await t.api.post('/api/risks', { inherent_likelihood: 1, inherent_impact: 1 })).body.error.fields.title).toBeDefined();

    // Moving a 5 by 5 risk with impact 5 to the safety category fails until it is re-scored.
    const risk = await t.api.post('/api/risks', { title: 'Category mover', inherent_likelihood: 2, inherent_impact: 5 });
    expect((await t.api.patch(`/api/risks/${risk.body.id}`, { category: 'safety' })).status).toBe(400);
    const moved = await t.api.patch(`/api/risks/${risk.body.id}`, { category: 'safety', inherent_impact: 4 });
    expect(moved.body.scale_key).toBe('hazard_4x5');
    expect(moved.body.inherent_rating).toBe('serious');
    await t.api.del(`/api/risks/${risk.body.id}`);
  });

  it('counts risks per heat map cell and per rating', async () => {
    await t.api.post('/api/risks', { title: 'Second in the same cell', inherent_likelihood: 1, inherent_impact: 1, residual_likelihood: 2, residual_impact: 3 });
    const closed = await t.api.post('/api/risks', { title: 'Closed one', residual_likelihood: 2, residual_impact: 3, inherent_likelihood: 2, inherent_impact: 3, status: 'closed' });
    expect(closed.status).toBe(201);

    const map = await t.api.get('/api/risks/heatmap?scale=cyber_5x5&basis=residual');
    expect(map.status).toBe(200);
    expect(map.body.cells.length).toBe(25);
    const cell = map.body.cells.find((c: any) => c.likelihood === 2 && c.impact === 3);
    expect(cell.count).toBe(2);
    expect(cell.rating).toBe('medium');
    expect(cell.risk_ids.length).toBe(2);
    expect(cell.risk_ids).not.toContain(closed.body.id);
    expect(map.body.totals.find((x: any) => x.rating === 'medium').count).toBe(2);
    expect(map.body.total).toBe(2);

    const inherent = await t.api.get('/api/risks/heatmap?scale=cyber_5x5&basis=inherent');
    expect(inherent.body.cells.find((c: any) => c.likelihood === 4 && c.impact === 5).count).toBe(1);
    expect(inherent.body.cells.find((c: any) => c.likelihood === 1 && c.impact === 1).count).toBe(1);

    const hazard = await t.api.get('/api/risks/heatmap?scale=hazard_4x5');
    expect(hazard.body.cells.length).toBe(20);
    expect(hazard.body.cells.find((c: any) => c.likelihood === 2 && c.impact === 4).count).toBe(1);
    expect((await t.api.get('/api/risks/heatmap?scale=nope')).status).toBe(404);

    const summary = await t.api.get('/api/risks/summary');
    expect(summary.body.total).toBe(3);
    const level = (v: string) => summary.body.levels.find((l: any) => l.value === v);
    expect(level('medium').count).toBe(2);
    expect(level('medium').by_scale).toEqual({ cyber_5x5: 2, hazard_4x5: 0 });
    expect(level('high').by_scale).toEqual({ cyber_5x5: 0, hazard_4x5: 1 });
    expect(summary.body.top[0].title).toBe('Invented safety hazard');
    expect(summary.body.top[0].rating_label).toBe('Serious');
  });

  it('requires a named executive approver to accept a risk at or above the threshold', async () => {
    const high = (await t.api.get('/api/risks?q=Invented safety hazard')).body.rows[0];
    const low = (await t.api.get('/api/risks?q=Invented cyber risk')).body.rows[0];

    // Marking accepted without an acceptance record is refused.
    expect((await t.api.patch(`/api/risks/${low.id}`, { status: 'accepted' })).body.error.fields.status).toBeDefined();

    const rule = await t.api.get(`/api/risks/${high.id}/acceptances`);
    expect(rule.body.rule).toMatchObject({ rating: 'serious', threshold: 'serious', executive_required: true });

    const refused = await t.api.post(`/api/risks/${high.id}/acceptances`, { expires_on: plus(180), rationale: 'Invented reason' });
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('executive_approval_required');
    expect(refused.body.error.message).toMatch(/named executive approver/);
    expect(Object.keys(refused.body.error.fields).sort()).toEqual(['approver_name', 'approver_title', 'reference']);
    expect((await t.api.get(`/api/risks/${high.id}`)).body.status).toBe('open');

    const noTitle = await t.api.post(`/api/risks/${high.id}/acceptances`, { expires_on: plus(180), rationale: 'Invented reason', approver_name: 'Pat Example', reference: 'MEMO-1' });
    expect(noTitle.status).toBe(400);

    const ok = await t.api.post(`/api/risks/${high.id}/acceptances`, {
      expires_on: plus(20), rationale: 'Invented reason', approver_name: 'Pat Example', approver_title: 'Chief Executive Officer', reference: 'MEMO-1',
    });
    expect(ok.status).toBe(201);
    expect(ok.body.executive_required).toBe(true);
    const after = (await t.api.get(`/api/risks/${high.id}`)).body;
    expect(after.status).toBe('accepted');
    expect(after.treatment).toBe('accept');

    // Below the threshold the signed-in user is recorded as approver when none is named.
    const bad = await t.api.post(`/api/risks/${low.id}/acceptances`, { expires_on: '2020-01-01' });
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['expires_on', 'rationale']);
    const simple = await t.api.post(`/api/risks/${low.id}/acceptances`, { expires_on: plus(400), rationale: 'Invented reason' });
    expect(simple.status).toBe(201);
    expect(simple.body.approver_name).toBe('Test Admin');
    expect(simple.body.executive_required).toBe(false);

    const history = await t.api.get(`/api/history?record_type=risk&record_id=${high.id}`);
    expect(history.body.map((h: any) => h.action)).toContain('risk.accept');

    const expiring = await t.api.get('/api/risks/acceptances-expiring');
    expect(expiring.body.map((e: any) => e.risk_id)).toEqual([high.id]);
    expect(expiring.body[0].expired).toBe(false);
    await t.db.query(`update risk_acceptances set approved_on = current_date - 400, expires_on = current_date - 5 where risk_id = $1`, [high.id]);
    const expired = await t.api.get('/api/risks/acceptances-expiring?days=500');
    expect(expired.body.length).toBe(2);
    expect(expired.body[0]).toMatchObject({ risk_id: high.id, expired: true, days_left: -5 });

    // The threshold is configuration: raise it and the same rating no longer needs an executive.
    await t.api.patch('/api/risks/scales/hazard_4x5', { acceptance_threshold: 'high' });
    expect((await t.api.get(`/api/risks/${high.id}/acceptances`)).body.rule.executive_required).toBe(false);
    await t.api.patch('/api/risks/scales/hazard_4x5', { acceptance_threshold: 'serious' });
  });

  it('keeps risks invisible to an agent without security.view, everywhere', async () => {
    const agent = await t.as('agent');
    const risk = (await t.api.get('/api/risks?q=Invented cyber risk')).body.rows[0];
    const linked = await t.api.post('/api/actions', { title: 'Follow-up for a hidden risk', source: 'risk', source_type: 'risk', source_id: risk.id });

    expect((await agent.get('/api/risks')).status).toBe(403);
    expect((await agent.get(`/api/risks/${risk.id}`)).status).toBe(403);
    expect((await agent.get('/api/risks/stats?group=status')).status).toBe(403);
    expect((await agent.get('/api/risks?format=csv')).status).toBe(403);
    expect((await agent.get('/api/search?q=Invented')).body.filter((r: any) => r.type === 'risk')).toEqual([]);
    expect((await agent.get('/api/records/lookup?type=risk&q=Invented')).body).toEqual([]);
    expect((await agent.get('/api/risks/heatmap?scale=cyber_5x5')).status).toBe(403);
    expect((await agent.get('/api/risks/summary')).status).toBe(403);
    expect((await agent.get('/api/risks/acceptances-expiring')).status).toBe(403);
    expect((await agent.get(`/api/risks/${risk.id}/acceptances`)).status).toBe(403);
    expect((await agent.post(`/api/risks/${risk.id}/acceptances`, { expires_on: plus(30), rationale: 'x' })).status).toBe(403);
    expect((await agent.get(`/api/history?record_type=risk&record_id=${risk.id}`)).status).toBe(404);
    expect((await agent.get('/api/meta')).body.resources.risk).toBeUndefined();
    // An action raised on the risk is restricted with it (E08-16): see the actions tests.
    expect(linked.body.restricted).toBe(true);
    expect((await agent.get(`/api/actions/${linked.body.id}`)).status).toBe(404);

    // A role with risks.view but not security.view is still shut out of the hand-written routes.
    const role = await t.db.one<{ id: string }>(`insert into roles (key, name) values ('risk_reader', 'Risk reader') returning id`);
    await t.db.query(`insert into role_permissions (role_id, permission) values ($1, 'risks.*')`, [role!.id]);
    const reader = await t.as('risk_reader');
    expect((await reader.get('/api/risks')).status).toBe(403);
    expect((await reader.get('/api/risks/heatmap')).status).toBe(403);
    expect((await reader.get('/api/risks/summary')).status).toBe(403);
    expect((await reader.get(`/api/risks/${risk.id}/acceptances`)).status).toBe(403);

    const lead = await t.as('security_lead');
    expect((await lead.get('/api/risks')).body.total).toBeGreaterThan(2);
    expect((await lead.get(`/api/risks/${risk.id}`)).body.title).toBe('Invented cyber risk');
    expect((await lead.get('/api/search?q=Invented cyber')).body.some((r: any) => r.type === 'risk')).toBe(true);
    expect((await lead.get('/api/risks/heatmap?scale=cyber_5x5')).body.total).toBeGreaterThan(0);
    expect((await lead.get('/api/risks/summary')).body.total).toBeGreaterThan(0);
  });
});

describe('actions', () => {
  it('creates, updates and filters actions, setting the completion date', async () => {
    const sourceId = '11111111-2222-4333-8444-555555555555';
    const made = await t.api.post('/api/actions', {
      title: 'Invented action', priority: 'high', due_on: plus(-3), source: 'audit', source_type: 'widget', source_id: sourceId, department: 'Finance',
    });
    expect(made.status).toBe(201);
    expect(made.body.ref).toMatch(/^ACT-\d{5}$/);
    expect(made.body.status).toBe('open');
    expect(made.body.completed_on).toBeNull();
    expect(made.body._display.source).toBe('Audit');

    expect((await t.api.post('/api/actions', { title: 'Bad source', source_id: 'not-a-uuid' })).body.error.fields.source_id).toBeDefined();
    expect((await t.api.post('/api/actions', { title: 'Bad status', status: 'nonsense' })).status).toBe(400);

    await t.api.post('/api/actions', { title: 'Another for the same record', source_type: 'widget', source_id: sourceId });
    await t.api.post('/api/actions', { title: 'For a different record', source_type: 'widget', source_id: '99999999-2222-4333-8444-555555555555' });
    const bySource = await t.api.get(`/api/actions?f.source_type=widget&f.source_id=${sourceId}`);
    expect(bySource.body.total).toBe(2);
    expect(bySource.body.rows.every((r: any) => r.source_id === sourceId)).toBe(true);

    const done = await t.api.patch(`/api/actions/${made.body.id}`, { status: 'done' });
    expect(done.body.completed_on).toBe(plus(0));
    const reopened = await t.api.patch(`/api/actions/${made.body.id}`, { status: 'in_progress' });
    expect(reopened.body.completed_on).toBeNull();

    expect((await t.api.del(`/api/actions/${made.body.id}`)).status).toBe(200);
    expect((await t.api.get(`/api/actions/${made.body.id}`)).status).toBe(404);
    const history = await t.api.get('/api/audit?action=action.update');
    expect(history.body.total).toBeGreaterThan(1);
  });

  it('summarizes open, overdue and due-this-week actions by owner and source', async () => {
    await t.db.query('update actions set deleted_at = now() where deleted_at is null');
    const agent = await t.as('agent');
    await t.api.post('/api/actions', { title: 'Overdue one', due_on: plus(-10), source: 'audit', owner_id: agent.userId, department: 'Finance' });
    await t.api.post('/api/actions', { title: 'Due today', due_on: plus(0), source: 'audit', owner_id: agent.userId });
    await t.api.post('/api/actions', { title: 'Far off', due_on: plus(60), source: 'exercise' });
    await t.api.post('/api/actions', { title: 'No date', source: 'exercise', status: 'blocked' });
    await t.api.post('/api/actions', { title: 'Overdue but finished', due_on: plus(-10), source: 'audit', status: 'done' });
    await t.api.post('/api/actions', { title: 'Overdue but canceled', due_on: plus(-10), source: 'audit', status: 'cancelled' });

    const s = (await agent.get('/api/actions/summary')).body;
    expect(s.open).toBe(4);
    expect(s.overdue).toBe(1);
    expect(s.due_this_week).toBe(1);
    expect(s.unassigned).toBe(2);
    expect(s.by_owner).toEqual([
      { owner_id: agent.userId, label: expect.stringContaining('agent'), open: 2, overdue: 1 },
      { owner_id: null, label: 'Unassigned', open: 2, overdue: 0 },
    ]);
    expect(s.by_source.find((x: any) => x.value === 'audit')).toMatchObject({ label: 'Audit', open: 2, overdue: 1 });
    expect(s.by_source.find((x: any) => x.value === 'exercise')).toMatchObject({ open: 2, overdue: 0 });
    expect(s.by_department.find((x: any) => x.value === 'Finance')).toMatchObject({ open: 1, overdue: 1 });

    // The same overdue view through the generic filters.
    const overdue = await agent.get(`/api/actions?f.due_on.lt=${s.today}&f.status=open,in_progress,blocked`);
    expect(overdue.body.rows.map((r: any) => r.title)).toEqual(['Overdue one']);
    expect((await agent.get('/api/actions?f.owner_id=me')).body.total).toBe(2);

    expect((await (await t.as('executive_viewer')).get('/api/actions/summary')).status).toBe(403);
  });

  it('hides an action raised on a restricted record from people without security.view, everywhere', async () => {
    const agent = await t.as('agent');
    const lead = await t.as('security_lead');
    const risk = (await t.api.post('/api/risks', { title: 'Invented risk with a follow-up' })).body;
    const before = (await agent.get('/api/actions/summary')).body;
    const beforeTotal = (await agent.get('/api/actions')).body.total;

    const hidden = await lead.post('/api/actions', {
      title: 'Quokka follow-up on the hidden risk', source: 'risk', source_type: 'risk', source_id: risk.id,
      due_on: plus(-5), owner_id: agent.userId, department: 'Quokka department',
    });
    expect(hidden.status).toBe(201);
    expect(hidden.body.restricted).toBe(true);
    const open = await agent.post('/api/actions', { title: 'Quokka ordinary action', source: 'audit', due_on: plus(-5) });
    expect(open.body.restricted).toBe(false);
    // The flag is derived from the source record: a caller cannot set or clear it.
    expect((await lead.patch(`/api/actions/${hidden.body.id}`, { restricted: false, notes: 'x' })).body.restricted).toBe(true);
    expect((await agent.post('/api/actions', { title: 'Tries to flag', restricted: true })).body.restricted).toBe(false);

    // list, get, edit, delete
    const list = await agent.get('/api/actions?q=Quokka');
    expect(list.body.rows.map((r: any) => r.title)).toEqual(['Quokka ordinary action']);
    expect(list.body.total).toBe(1);
    expect((await agent.get('/api/actions')).body.total).toBe(beforeTotal + 2); // the two unrestricted ones
    expect((await agent.get(`/api/actions/${hidden.body.id}`)).status).toBe(404);
    expect((await agent.patch(`/api/actions/${hidden.body.id}`, { title: 'x' })).status).toBe(404);
    expect((await agent.del(`/api/actions/${hidden.body.id}`)).status).toBe(404);
    expect((await agent.get(`/api/actions?f.source_type=risk&f.source_id=${risk.id}`)).body.total).toBe(0);
    // search, pickers, statistics, export
    expect((await agent.get('/api/search?q=Quokka')).body.map((r: any) => r.label)).toEqual(['Quokka ordinary action']);
    expect((await agent.get('/api/records/lookup?type=action&q=Quokka')).body.map((r: any) => r.label)).toEqual(['Quokka ordinary action']);
    // Statistics are figures: the same for everyone, the restricted action counted but its details masked.
    const stats = (await agent.get('/api/actions/stats?group=source')).body;
    expect(stats).toEqual((await lead.get('/api/actions/stats?group=source')).body);
    expect(stats.groups.find((g: any) => g.value === 'risk').count).toBe(1);
    const byDept = (await agent.get('/api/actions/stats?group=department')).body;
    expect(byDept).toEqual((await lead.get('/api/actions/stats?group=department')).body);
    expect(JSON.stringify(byDept)).not.toContain('Quokka');
    expect(byDept.groups.find((g: any) => g.restricted).count).toBeGreaterThanOrEqual(1);
    const byOwner = (await agent.get('/api/actions/stats?group=owner_id')).body;
    expect(byOwner.groups.find((g: any) => g.value === agent.userId)?.count ?? 0)
      .toBe((await agent.get(`/api/actions?f.owner_id=${agent.userId}`)).body.total);
    expect((await agent.get('/api/actions/stats?group=status&q=Quokka')).body.total).toBe(1);
    expect((await lead.get('/api/actions/stats?group=status&q=Quokka')).body.total).toBe(1);
    const csv = await (await t.as('security_lead')).get('/api/actions?format=csv&q=Quokka');
    expect(csv.text).toContain('Quokka follow-up on the hidden risk');
    expect(csv.text).toMatch(/Restricted export by/);
    const auditorCsv = await t.api.get('/api/actions?format=csv&q=Quokka ordinary');
    expect(auditorCsv.text).not.toMatch(/Restricted export by/);
    // The summary is a figure: the restricted action is in every count, for the agent and the lead
    // alike; its owner and department show as "Restricted records" for both. "Mine" is each person's own.
    const after = (await agent.get('/api/actions/summary')).body;
    expect(after.open).toBe(before.open + 3);
    expect(after.overdue).toBe(before.overdue + 2);
    expect(after.by_source.find((s: any) => s.value === 'risk')).toMatchObject({ open: 1, overdue: 1 });
    expect(after.by_owner.find((o: any) => o.restricted)).toMatchObject({ owner_id: null, label: 'Restricted records', open: 1, overdue: 1 });
    expect(after.by_department.find((d: any) => d.restricted)).toMatchObject({ value: null, label: 'Restricted records', open: 1 });
    expect(JSON.stringify(after)).not.toContain('Quokka');
    expect(after.mine.open).toBe(before.mine.open); // the agent owns it but may not see it
    const leadSummary = (await lead.get('/api/actions/summary')).body;
    const { mine: _a, ...agentFigures } = after;
    const { mine: _l, ...leadFigures } = leadSummary;
    expect(leadFigures).toEqual(agentFigures);
    // history, comments, links and the audit search
    expect((await agent.get(`/api/history?record_type=action&record_id=${hidden.body.id}`)).status).toBe(404);
    expect((await agent.post('/api/comments', { record_type: 'action', record_id: hidden.body.id, body: 'hello' })).status).toBe(404);
    expect((await agent.post('/api/links', { from_type: 'action', from_id: open.body.id, to_type: 'action', to_id: hidden.body.id })).status).toBe(404);
    const auditor = await t.as('auditor'); // audit.view without security.view
    const events = (await auditor.get('/api/audit?q=Quokka')).body.rows.map((e: any) => e.summary);
    expect(events.some((s: string) => s.includes('Quokka ordinary action'))).toBe(true);
    expect(events.some((s: string) => s.includes('hidden risk'))).toBe(false);
    expect((await lead.get('/api/audit?q=Quokka')).body.rows.some((e: any) => e.summary.includes('hidden risk'))).toBe(true);

    // A person who cannot see a record cannot raise or move an action onto it (and learns nothing from trying).
    const probe = await agent.post('/api/actions', { title: 'Probe', source_type: 'risk', source_id: risk.id });
    expect(probe.status).toBe(400);
    const missing = await agent.post('/api/actions', { title: 'Probe', source_type: 'risk', source_id: '11111111-2222-4333-8444-555555555555' });
    expect(missing.body).toEqual(probe.body);
    expect((await agent.patch(`/api/actions/${open.body.id}`, { source_type: 'risk', source_id: risk.id })).status).toBe(400);

    // Moving an action onto, or off, a restricted record changes its restriction with it.
    const moved = await lead.patch(`/api/actions/${open.body.id}`, { source_type: 'risk', source_id: risk.id });
    expect(moved.body.restricted).toBe(true);
    expect((await agent.get(`/api/actions/${open.body.id}`)).status).toBe(404);
    const back = await lead.patch(`/api/actions/${open.body.id}`, { source_type: null, source_id: null });
    expect(back.body.restricted).toBe(false);
    expect((await agent.get(`/api/actions/${open.body.id}`)).status).toBe(200);
    expect((await lead.del(`/api/actions/${hidden.body.id}`)).status).toBe(200);
  });

  it('brings existing actions in line with their source at start-up', async () => {
    // A database from before the rule: an action linked to a risk but not flagged.
    const dir = mkdtempSync(join(tmpdir(), 'grc-risks-'));
    try {
      const first = await buildApp({ dataDir: dir, serveWeb: false });
      const risk = await first.ctx.resources.create('risk', { title: 'Invented older risk' });
      const old = (await first.db.one<{ id: string }>(
        `insert into actions (title, status, source_type, source_id, restricted) values ('Older follow-up', 'open', 'risk', $1, false) returning id`, [risk.id]))!;
      await first.close();

      const second = await buildApp({ dataDir: dir, serveWeb: false });
      expect((await second.db.one<{ restricted: boolean }>('select restricted from actions where id = $1', [old.id]))!.restricted).toBe(true);
      expect((await second.db.query(`select 1 from audit_events where action = 'action.restriction_sync'`)).length).toBe(1);
      await second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
describe('obligations', () => {
  it('has no obligations on a fresh app', async () => {
    expect((await t.api.get('/api/obligations')).body.total).toBe(0);
    expect((await t.db.query(`select 1 from audit_events where action = 'obligation.create'`)).length).toBe(0);
  });

  it('supports the usual record operations', async () => {
    const made = await t.api.post('/api/obligations', { title: 'Invented duty', source: 'Invented contract', next_due_on: plus(30) });
    expect(made.body.ref).toBe('OBL-00001');
    const edited = await t.api.patch(`/api/obligations/${made.body.id}`, { status: 'met', how_met: 'Annual check', evidence: 'Signed form' });
    expect(edited.body._display.status).toBe('Met');
    expect((await (await t.as('agent')).get('/api/obligations')).body.total).toBe(1);
    expect((await (await t.as('agent')).post('/api/obligations', { title: 'Nope' })).status).toBe(403);
    await t.api.del(`/api/obligations/${made.body.id}`);
  });
});

describe('seed', () => {
  it('loads information requests from a pipe-delimited file, idempotently, with sample risks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grc-risks-seed-'));
    try {
      writeFileSync(join(dir, 'information_requests.psv'), [
        'ID|Dept|Item|Why|Feeds|Form|Priority|IfNone',
        'ZZ-01|Planning|List of invented widgets|Needed for the widget plan|Widget register|Spreadsheet|High|Say so',
        'ZZ-02|Finance|Invented budget codes|Needed to label costs|Cost report|Email|Medium|',
        'ZZ-03|Finance|Invented approval chart||||Unusual|Draw one',
      ].join('\r\n'), 'utf8');
      const before = (await t.api.get('/api/actions')).body.total;

      const first = await mod.seed!(t.ctx, { profile: 'pilot', seedDir: dir });
      expect(first).toMatch(/3 information-request actions added/);
      expect(first).toMatch(/9 sample risks added/);
      expect(first).toMatch(/0 obligations added \(0 in the register\)/);
      const again = await mod.seed!(t.ctx, { profile: 'pilot', seedDir: dir });
      expect(again).toMatch(/0 information-request actions added, 0 updated, 3 unchanged \(3 in total\)/);
      expect(again).toMatch(/0 sample risks added/);

      const loaded = await t.api.get('/api/actions?f.source=information_request&sort=external_ref');
      expect(loaded.body.total).toBe(3);
      expect(loaded.body.rows[0]).toMatchObject({
        external_ref: 'ZZ-01', title: 'List of invented widgets', department: 'Planning', priority: 'high',
        description: 'Needed for the widget plan', status: 'open',
      });
      expect(loaded.body.rows[0].notes).toBe('Feeds: Widget register\nForm: Spreadsheet\nIf none: Say so');
      expect(loaded.body.rows[2].priority).toBe('medium');

      const samples = await t.api.get('/api/risks?q=[Sample]');
      expect(samples.body.total).toBe(9);
      expect(new Set(samples.body.rows.map((r: any) => r.scale_key))).toEqual(new Set(['cyber_5x5', 'hazard_4x5']));
      const accepted = samples.body.rows.filter((r: any) => r.status === 'accepted');
      expect(accepted.length).toBe(2);
      expect((await t.api.get(`/api/risks/${accepted[0].id}/acceptances`)).body.acceptances.length).toBe(1);
      const linked = await t.api.get('/api/actions?f.source_type=risk&f.source=risk');
      expect(new Set(linked.body.rows.map((r: any) => r.source_id)).size).toBe(2);
      // 3 information requests + 3 actions linked to sample risks.
      expect((await t.api.get('/api/actions')).body.total).toBe(before + 6);

      const dev = await mod.seed!(t.ctx, { profile: 'dev', seedDir: dir });
      expect(dev).toMatch(/12 invented actions added/);
      // The dev profile also adds invented example obligations, once.
      expect(dev).toMatch(/4 obligations added \(4 in the register\)/);
      const devAgain = await mod.seed!(t.ctx, { profile: 'dev', seedDir: dir });
      expect(devAgain).toMatch(/0 invented actions added/);
      expect(devAgain).toMatch(/0 obligations added \(4 in the register\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('updates changed information requests on a re-run, keeping edits made in the application', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grc-risks-reimport-'));
    const write = (rows: string[]) => writeFileSync(join(dir, 'information_requests.psv'), ['ID|Dept|Item|Why|Feeds|Form|Priority|IfNone', ...rows].join('\n'), 'utf8');
    const get = async (ref: string) => (await t.api.get(`/api/actions?f.external_ref=${ref}`)).body.rows[0];
    try {
      write(['RR-01|Operations|Invented roster extract|First reason|||Low|', 'RR-02|Finance|Invented fare codes|Why|||Low|']);
      expect(await mod.seed!(t.ctx, { profile: 'pilot', seedDir: dir })).toMatch(/2 information-request actions added/);
      // Someone edits RR-01's priority in the application.
      await t.api.patch(`/api/actions/${(await get('RR-01')).id}`, { priority: 'high' });

      // The file changes both the title and the priority of RR-01; RR-02 is unchanged.
      write(['RR-01|Operations|Invented roster extract (all depots)|First reason|||Medium|', 'RR-02|Finance|Invented fare codes|Why|||Low|']);
      expect(await mod.seed!(t.ctx, { profile: 'pilot', seedDir: dir })).toMatch(/0 information-request actions added, 1 updated, 1 unchanged/);
      expect(await get('RR-01')).toMatchObject({ title: 'Invented roster extract (all depots)', priority: 'high' }); // the edit wins
      const history = (await t.api.get(`/api/history?record_type=action&record_id=${(await get('RR-01')).id}`)).body;
      expect(history.length).toBeGreaterThanOrEqual(3); // created, edited, updated by the import: all audited

      // Running again with the same file changes nothing.
      expect(await mod.seed!(t.ctx, { profile: 'pilot', seedDir: dir })).toMatch(/0 updated, 2 unchanged/);
      // A request deleted in the application is not brought back by a changed row.
      await t.api.del(`/api/actions/${(await get('RR-02')).id}`);
      write(['RR-01|Operations|Invented roster extract (all depots)|First reason|||Medium|', 'RR-02|Finance|Invented fare codes, revised|Why|||Low|']);
      expect(await mod.seed!(t.ctx, { profile: 'pilot', seedDir: dir })).toMatch(/0 information-request actions added, 0 updated, 2 unchanged/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips the information requests quietly when the file is absent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grc-risks-empty-'));
    try {
      const before = (await t.api.get('/api/actions?f.source=information_request')).body.total;
      const note = await mod.seed!(t.ctx, { profile: 'pilot', seedDir: dir });
      expect(note).toMatch(/no information_requests\.psv in the seed folder/);
      expect(note).toMatch(/0 sample risks added/);
      expect((await t.api.get('/api/actions?f.source=information_request')).body.total).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loads obligations from the organization profile once and never overwrites an edit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grc-risks-org-'));
    try {
      await t.db.query('update obligations set deleted_at = now() where deleted_at is null');
      const organization = {
        obligations: [
          { title: 'Invented widget return', source: 'Invented widget law', requirement: 'File the widget return every year', how_met: 'Finance files it', evidence: 'Receipt', next_due_on: plus(90) },
          { title: 'Invented supplier terms', source: 'Invented contract', requirement: 'Keep widget records for six years' },
          { source: 'No title, so ignored' },
        ],
      };
      const first = await mod.seed!(t.ctx, { profile: 'pilot', seedDir: dir, organization });
      expect(first).toMatch(/2 obligations added \(2 in the register\)/);
      const rows = (await t.api.get('/api/obligations?sort=ref')).body.rows;
      expect(rows.map((r: any) => r.title)).toEqual(['Invented widget return', 'Invented supplier terms']);
      expect(rows[0]).toMatchObject({ source: 'Invented widget law', how_met: 'Finance files it', evidence: 'Receipt', next_due_on: plus(90), status: 'not_assessed' });
      expect(rows[0].ref).toMatch(/^OBL-\d{5}$/);

      const edited = await t.api.patch(`/api/obligations/${rows[0].id}`, { source: 'Edited by hand', status: 'met' });
      expect(edited.status).toBe(200);
      await t.api.del(`/api/obligations/${rows[1].id}`);

      const again = await mod.seed!(t.ctx, { profile: 'pilot', seedDir: dir, organization });
      expect(again).toMatch(/0 obligations added \(1 in the register\)/);
      const after = (await t.api.get('/api/obligations')).body.rows;
      expect(after.length).toBe(1);
      expect(after[0]).toMatchObject({ title: 'Invented widget return', source: 'Edited by hand', status: 'met' });

      // No profile at all: nothing is added in the pilot profile.
      expect(await mod.seed!(t.ctx, { profile: 'pilot', seedDir: dir })).toMatch(/0 obligations added/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('renames the hazard scale and safety category left by an earlier version, once', async () => {
    const names = async () => ({
      scale: (await t.db.one<{ name: string }>(`select name from risk_scales where key = 'hazard_4x5'`))!.name,
      category: (await t.db.one<{ label: string }>(`select label from lookups where list_key = 'risk_category' and value = 'safety'`))!.label,
    });
    expect(await names()).toEqual({ scale: HAZARD_SCALE_NAME, category: 'Safety' });

    await t.db.query(`update risk_scales set name = $1, description = 'Old text' where key = 'hazard_4x5'`, [LEGACY_HAZARD_SCALE_NAME]);
    await t.db.query(`update lookups set label = $1 where list_key = 'risk_category' and value = 'safety'`, [`Safety (${LEGACY_HAZARD_SCALE_NAME})`]);
    await mod.seedDefaults!(t.ctx);
    expect(await names()).toEqual({ scale: HAZARD_SCALE_NAME, category: 'Safety' });
    const scale = (await t.api.get('/api/risks/scales/hazard_4x5')).body;
    expect(scale.description).toMatch(/standard hazard risk-assessment matrix/);
    expect(scale.ratings.length).toBe(4);
    // The description shipped before is brought up to date; one an administrator wrote is kept.
    await t.db.query(`update risk_scales set description = 'Four severity levels by five likelihood levels, the standard hazard risk-assessment matrix.' where key = 'hazard_4x5'`);
    await mod.seedDefaults!(t.ctx);
    expect((await t.api.get('/api/risks/scales/hazard_4x5')).body.description).toMatch(/^The safety hazard matrix used in transit safety management/);

    // Names an administrator chose are left alone.
    await t.db.query(`update risk_scales set name = 'Our hazard scale' where key = 'hazard_4x5'`);
    await t.db.query(`update lookups set label = 'Health and safety' where list_key = 'risk_category' and value = 'safety'`);
    await mod.seedDefaults!(t.ctx);
    expect(await names()).toEqual({ scale: 'Our hazard scale', category: 'Health and safety' });
  });
});