import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import mod from './index.ts';
import { computeScore, computeTier, DEFAULT_CRITERIA, ragTrend } from './rules.ts';

// Invented data only.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

const make = async (data: Record<string, unknown>) => {
  const res = await t.api.post('/api/projects', { name: 'Test project', ...data });
  expect(res.status).toBe(201);
  return res.body;
};

/** Ticks every item on the project's current gate and approves it. */
async function passCurrentGate(id: string) {
  const gates = (await t.api.get(`/api/projects/${id}/gates`)).body;
  const gate = gates.gates.find((g: any) => g.id === gates.current_gate_id);
  for (const item of gate.items) {
    await t.api.patch(`/api/projects/${id}/gates/${gate.id}/items/${item.id}`, { checked: true });
  }
  for (const i of gate.documents.keys()) {
    await t.api.patch(`/api/projects/${id}/gates/${gate.id}/documents/${i}`, { received: true });
  }
  const res = await t.api.post(`/api/projects/${id}/gates/${gate.id}/decide`, { decision: 'approved', approver_name: 'A. Tester', approver_role: 'CIO' });
  expect(res.status).toBe(200);
  return res.body;
}

describe('tiers', () => {
  it('follows the thresholds, including the boundaries', () => {
    expect(computeTier({ budget: 49999.99 })).toBe('tier_3');
    expect(computeTier({ budget: 50000 })).toBe('tier_2');
    expect(computeTier({ budget: 100000 })).toBe('tier_2');
    expect(computeTier({ budget: 100000.01 })).toBe('tier_1');
    expect(computeTier({ budget: null })).toBe('tier_3');
    expect(computeTier({ budget: 100, touches_payment: true })).toBe('tier_1');
    expect(computeTier({ budget: 100, touches_personal_data: true })).toBe('tier_1');
    expect(computeTier({ budget: 100, touches_operational_systems: true })).toBe('tier_1');
  });

  it('assigns the tier on create and recomputes it on every save', async () => {
    const p = await make({ budget: 49999 });
    expect(p.ref).toMatch(/^PRJ-\d{5}$/);
    expect(p.tier).toBe('tier_3');
    expect(p._display.tier).toBe('Tier 3');
    expect((await t.api.patch(`/api/projects/${p.id}`, { budget: 50000 })).body.tier).toBe('tier_2');
    expect((await t.api.patch(`/api/projects/${p.id}`, { budget: 100000 })).body.tier).toBe('tier_2');
    expect((await t.api.patch(`/api/projects/${p.id}`, { budget: 100001 })).body.tier).toBe('tier_1');
    expect((await t.api.patch(`/api/projects/${p.id}`, { budget: 10 })).body.tier).toBe('tier_3');
    expect((await t.api.patch(`/api/projects/${p.id}`, { touches_personal_data: true })).body.tier).toBe('tier_1');
    // the tier itself cannot be written directly
    expect((await t.api.patch(`/api/projects/${p.id}`, { tier: 'tier_3' })).body.tier).toBe('tier_1');
  });

  it('allows an audited manual override with a reason', async () => {
    const p = await make({ budget: 1000 });
    const noReason = await t.api.patch(`/api/projects/${p.id}`, { tier_override: 'tier_1' });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.fields.tier_override_reason).toBeTruthy();
    const ok = await t.api.patch(`/api/projects/${p.id}`, { tier_override: 'tier_1', tier_override_reason: 'Executive interest' });
    expect(ok.body).toMatchObject({ tier: 'tier_1', tier_computed: 'tier_3', tier_override: 'tier_1' });
    const history = await t.api.get(`/api/history?record_type=project&record_id=${p.id}`);
    expect(history.body.some((h: any) => h.action === 'project.tier_override' && /Executive interest/.test(h.summary))).toBe(true);
    const cleared = await t.api.patch(`/api/projects/${p.id}`, { tier_override: null });
    expect(cleared.body).toMatchObject({ tier: 'tier_3', tier_override: null, tier_override_reason: null });
  });

  it('lets an administrator change the thresholds, which re-tiers existing projects', async () => {
    const p = await make({ budget: 30000 });
    expect((await t.api.get('/api/projects/settings')).body.tiers).toEqual({ tier3Below: 50000, tier1Above: 100000 });
    const bad = await t.api.patch('/api/projects/settings', { tiers: { tier3Below: 500, tier1Above: 100 } });
    expect(bad.status).toBe(400);
    const res = await t.api.patch('/api/projects/settings', { tiers: { tier3Below: 25000, tier1Above: 100000 } });
    expect(res.status).toBe(200);
    expect(res.body.recalculated).toBeGreaterThan(0);
    expect((await t.api.get(`/api/projects/${p.id}`)).body.tier).toBe('tier_2');
    await t.api.patch('/api/projects/settings', { tiers: { tier3Below: 50000, tier1Above: 100000 } });
    expect((await t.api.get(`/api/projects/${p.id}`)).body.tier).toBe('tier_3');
    const audited = await t.db.query(`select 1 from audit_events where action = 'setting.change' and record_id = 'projects.tier_thresholds'`);
    expect(audited.length).toBe(2);
  });
});

describe('stages and gates', () => {
  it('starts an intake request at the idea stage and opens its first gate', async () => {
    const p = await make({ name: 'Intake only', description: 'One-page request', sponsor: 'Someone', budget: 5000 });
    expect(p.stage).toBe('idea');
    expect(p.status).toBe('active');
    const g = (await t.api.get(`/api/projects/${p.id}/gates`)).body;
    expect(g.stages.map((s: any) => s.value)).toEqual(['idea', 'initiate', 'plan', 'procure', 'deliver', 'close']);
    expect(g.definitions.length).toBe(5);
    expect(g.gates.length).toBe(1);
    expect(g.gates[0]).toMatchObject({ gate_key: 'intake', from_stage: 'idea', to_stage: 'initiate', status: 'open', is_current: true, can_approve: false });
    expect(g.gates[0].items.length).toBeGreaterThan(2);
    expect(g.gates[0].items.every((i: any) => i.checked === false)).toBe(true);
    expect(g.gates[0].approvers_for_tier.length).toBeGreaterThan(0);
    // the stage cannot be set directly
    expect((await t.api.patch(`/api/projects/${p.id}`, { stage: 'close' })).body.stage).toBe('idea');
  });

  it('blocks approval while an item is unchecked, then advances the stage and opens the next gate', async () => {
    const p = await make({ name: 'Gate walk' });
    const gate = (await t.api.get(`/api/projects/${p.id}/gates`)).body.gates[0];
    const url = `/api/projects/${p.id}/gates/${gate.id}`;
    for (const item of gate.items.slice(1)) await t.api.patch(`${url}/items/${item.id}`, { checked: true });

    const blocked = await t.api.post(`${url}/decide`, { decision: 'approved', approver_name: 'A. Tester' });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.code).toBe('gate_blocked');
    expect(blocked.body.error.message).toContain(gate.items[0].label);

    // deferring is allowed with items outstanding and does not move the project
    const deferred = await t.api.post(`${url}/decide`, { decision: 'deferred', approver_name: 'A. Tester', notes: 'Next month' });
    expect(deferred.status).toBe(200);
    expect(deferred.body.project.stage).toBe('idea');
    expect(deferred.body.gate.status).toBe('deferred');

    const ticked = await t.api.patch(`${url}/items/${gate.items[0].id}`, { checked: true, note: 'Seen', evidence_ref: 'DOC-1' });
    expect(ticked.body).toMatchObject({ checked: true, checked_by_name: 'Test Admin', note: 'Seen', evidence_ref: 'DOC-1' });
    expect((await t.api.post(`${url}/decide`, { decision: 'approved' })).status).toBe(400); // approver name required
    await t.api.patch(`${url}/documents/0`, { received: true });

    const ok = await t.api.post(`${url}/decide`, { decision: 'approved', approver_name: 'A. Tester', approver_role: 'CIO', reference: 'Email 1' });
    expect(ok.status).toBe(200);
    expect(ok.body.project.stage).toBe('initiate');
    const after = (await t.api.get(`/api/projects/${p.id}/gates`)).body;
    expect(after.gates.map((g: any) => [g.gate_key, g.status])).toEqual([['intake', 'approved'], ['charter', 'open']]);
    expect(after.gates[0].decisions.map((d: any) => d.decision)).toEqual(['approved', 'deferred']);
    expect(after.current_gate_id).toBe(after.gates[1].id);
    // an approved gate is closed
    expect((await t.api.post(`${url}/decide`, { decision: 'approved', approver_name: 'X' })).status).toBe(409);
    expect((await t.api.patch(`${url}/items/${gate.items[0].id}`, { checked: false })).status).toBe(409);

    const actions = (await t.api.get(`/api/history?record_type=project&record_id=${p.id}`)).body.map((h: any) => h.action);
    for (const a of ['project.gate_open', 'project.gate_item', 'project.gate_decision', 'project.update']) expect(actions).toContain(a);
  });

  it('cannot pass the go-live gate with an unchecked item, and can once all are checked', async () => {
    const p = await make({ name: 'Go-live', budget: 150000 });
    for (let i = 0; i < 4; i++) await passCurrentGate(p.id);
    const g = (await t.api.get(`/api/projects/${p.id}/gates`)).body;
    expect(g.stage).toBe('deliver');
    const gate = g.gates.find((x: any) => x.is_current);
    expect(gate.gate_key).toBe('go_live');
    expect(gate.items.length).toBe(10);
    expect(gate.items.map((i: any) => i.label)).toContain('Backups configured and one restore tested');
    expect(gate.approvers_for_tier).toContain('Chief Executive Officer');
    const url = `/api/projects/${p.id}/gates/${gate.id}`;
    for (const i of gate.documents.keys()) await t.api.patch(`${url}/documents/${i}`, { received: true });

    for (const item of gate.items.slice(0, 9)) await t.api.patch(`${url}/items/${item.id}`, { checked: true });
    const blocked = await t.api.post(`${url}/decide`, { decision: 'approved', approver_name: 'A. Tester', approver_role: 'CEO' });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.message).toContain('Change record approved');
    expect((await t.api.get(`/api/projects/${p.id}`)).body.stage).toBe('deliver');

    await t.api.patch(`${url}/items/${gate.items[9].id}`, { checked: true });
    const due = (await t.api.get('/api/projects/portfolio')).body.gatesDue;
    expect(due.some((d: any) => d.project_id === p.id && d.ready)).toBe(true);
    const ok = await t.api.post(`${url}/decide`, { decision: 'approved', approver_name: 'A. Tester', approver_role: 'CEO' });
    expect(ok.status).toBe(200);
    expect(ok.body.project.stage).toBe('close');
    expect((await t.api.get(`/api/projects/${p.id}/gates`)).body.current_gate_id).toBeNull();
  });

  it('lets an administrator edit a gate template; new gates use it', async () => {
    const defs = (await t.api.get('/api/projects/gate-definitions')).body;
    expect(defs.find((d: any) => d.key === 'go_live').checklist.length).toBe(10);
    const res = await t.api.patch('/api/projects/gate-definitions/intake', {
      checklist: ['Only item'], required_documents: ['Request'], approvers: { tier_3: ['Head of IT'] },
    });
    expect(res.status).toBe(200);
    const p = await make({ name: 'After template change' });
    const gate = (await t.api.get(`/api/projects/${p.id}/gates`)).body.gates[0];
    expect(gate.items.map((i: any) => i.label)).toEqual(['Only item']);
    expect(gate.approvers_for_tier).toEqual(['Head of IT']);
    const doc = await t.api.patch(`/api/projects/${p.id}/gates/${gate.id}/documents/0`, { received: true, reference: 'File 7' });
    expect(doc.body.documents[0]).toEqual({ name: 'Request', required: true, received: true, reference: 'File 7' });
    expect((await t.api.patch('/api/projects/gate-definitions/nope', {})).status).toBe(404);
  });
});

describe('status reports', () => {
  it('denormalises the latest ratings and returns the trend', async () => {
    const p = await make({ name: 'Reported' });
    const base = { accomplishments: 'Done things', next_steps: 'More things' };
    expect((await t.api.post(`/api/projects/${p.id}/status-reports`, { period_end: '2026-09-30', overall: 'purple' })).status).toBe(400);
    await t.api.post(`/api/projects/${p.id}/status-reports`, { ...base, period_end: '2026-09-30', overall: 'green', schedule: 'green', budget: 'green', risk: 'amber' });
    const second = await t.api.post(`/api/projects/${p.id}/status-reports`, { ...base, period_end: '2026-10-31', overall: 'amber', schedule: 'red', budget: 'green', risk: 'amber' });
    expect(second.status).toBe(201);
    expect(second.body.author_name).toBe('Test Admin');
    // an older period entered late does not replace the latest ratings
    await t.api.post(`/api/projects/${p.id}/status-reports`, { ...base, period_end: '2026-08-31', overall: 'red', schedule: 'red', budget: 'red', risk: 'red' });

    const row = (await t.api.get(`/api/projects/${p.id}`)).body;
    expect(row).toMatchObject({ rag_overall: 'amber', rag_schedule: 'red', rag_budget: 'green', rag_risk: 'amber', rag_trend: 'worsening', last_report_on: '2026-10-31' });

    const trend = (await t.api.get(`/api/projects/${p.id}/status-trend`)).body;
    expect(trend.series.map((s: any) => [s.period_end, s.overall])).toEqual([['2026-08-31', 'red'], ['2026-09-30', 'green'], ['2026-10-31', 'amber']]);
    expect(trend.direction).toBe('worsening');

    const inPortfolio = (await t.api.get('/api/projects/portfolio')).body.register.find((r: any) => r.id === p.id);
    expect(inPortfolio.trend.map((s: any) => s.overall)).toEqual(['red', 'green', 'amber']);
    expect(inPortfolio.rag_trend).toBe('worsening');

    await t.api.patch(`/api/projects/${p.id}/status-reports/${second.body.id}`, { overall: 'green' });
    expect((await t.api.get(`/api/projects/${p.id}`)).body).toMatchObject({ rag_overall: 'green', rag_trend: 'steady' });
    await t.api.del(`/api/projects/${p.id}/status-reports/${second.body.id}`);
    expect((await t.api.get(`/api/projects/${p.id}`)).body).toMatchObject({ rag_overall: 'green', rag_trend: 'improving', last_report_on: '2026-09-30' });
    expect((await t.api.get(`/api/projects/${p.id}/status-reports`)).body.length).toBe(2);
    expect(ragTrend('green', 'red')).toBe('improving');
  });
});

describe('portfolio', () => {
  it('scores projects with the weighted criteria', async () => {
    expect(computeScore(null, DEFAULT_CRITERIA)).toBeNull();
    expect(computeScore({ strategic_alignment: 5, risk_reduction: 5, customer_benefit: 5, financial_return: 5, readiness: 5 }, DEFAULT_CRITERIA)).toBe(100);
    expect(computeScore({ a: 5, b: 0 }, [{ key: 'a', label: 'A', weight: 3 }, { key: 'b', label: 'B', weight: 1 }])).toBe(75);

    const p = await make({ name: 'Scored', scoring: { strategic_alignment: 5 } });
    expect(p.priority_score).toBe(25);
    expect((await t.api.patch(`/api/projects/${p.id}`, { scoring: { strategic_alignment: 9 } })).status).toBe(400);

    const criteria = [{ key: 'strategic_alignment', label: 'Strategy', weight: 1 }, { key: 'other', label: 'Other', weight: 1 }];
    expect((await t.api.patch('/api/projects/settings', { criteria: [] })).status).toBe(400);
    expect((await t.api.patch('/api/projects/settings', { criteria })).status).toBe(200);
    expect((await t.api.get(`/api/projects/${p.id}`)).body.priority_score).toBe(50);
    await t.api.patch('/api/projects/settings', { criteria: DEFAULT_CRITERIA });
    expect((await t.api.get(`/api/projects/${p.id}`)).body.priority_score).toBe(25);
  });

  it('returns the register, the funnel and a work-in-progress warning', async () => {
    const a = await make({ name: 'Delivery A', budget: 20000, spend_to_date: 5000 });
    const b = await make({ name: 'Delivery B' });
    for (const p of [a, b]) for (let i = 0; i < 4; i++) await passCurrentGate(p.id);
    await t.api.patch('/api/projects/settings', { wipLimit: 5 });
    let pf = (await t.api.get('/api/projects/portfolio')).body;
    expect(pf.wipWarning).toBeNull();
    expect(pf.wip).toMatchObject({ limit: 5, exceeded: false });
    const inDelivery = pf.wip.inDelivery;
    expect(inDelivery).toBeGreaterThanOrEqual(2);

    await t.api.patch('/api/projects/settings', { wipLimit: inDelivery - 1 });
    pf = (await t.api.get('/api/projects/portfolio')).body;
    expect(pf.wip.exceeded).toBe(true);
    expect(pf.wipWarning).toContain(`limit of ${inDelivery - 1}`);

    // a project on hold does not count
    await t.api.patch(`/api/projects/${b.id}`, { status: 'on_hold' });
    pf = (await t.api.get('/api/projects/portfolio')).body;
    expect(pf.wip.inDelivery).toBe(inDelivery - 1);
    expect(pf.wipWarning).toBeNull();

    const row = pf.register.find((r: any) => r.id === a.id);
    expect(row).toMatchObject({ stage: 'deliver', tier: 'tier_3', budget: 20000, spend_to_date: 5000, spend_pct: 25, over_budget: false });
    expect(row.gate).toMatchObject({ key: 'go_live', total: 10, checked: 0, ready: false });
    expect(pf.funnel.map((f: any) => f.stage)).toEqual(['idea', 'initiate', 'plan', 'procure', 'deliver', 'close']);
    expect(pf.funnel.find((f: any) => f.stage === 'deliver').count).toBeGreaterThanOrEqual(2);
    expect(pf.funnel.reduce((n: number, f: any) => n + f.count, 0)).toBe(pf.totals.projects);
  });
});

describe('items and milestones', () => {
  it('tracks risks, issues, decisions and change requests', async () => {
    const p = await make({ name: 'With items' });
    const risk = await t.api.post(`/api/projects/${p.id}/items`, { kind: 'risk', title: 'Supplier may slip', likelihood: 4, impact: 3, due_on: '2026-12-01' });
    expect(risk.status).toBe(201);
    expect(risk.body).toMatchObject({ kind: 'risk', status: 'open', score: 12 });
    const issue = await t.api.post(`/api/projects/${p.id}/items`, { kind: 'issue', title: 'Room not ready', likelihood: 4 });
    expect(issue.body.likelihood).toBeNull();
    expect((await t.api.post(`/api/projects/${p.id}/items`, { kind: 'wish', title: 'x' })).status).toBe(400);
    expect((await t.api.post(`/api/projects/${p.id}/items`, { kind: 'risk', title: 'x', impact: 9 })).status).toBe(400);
    expect((await t.api.patch(`/api/projects/${p.id}/items/${issue.body.id}`, { status: 'closed' })).body.status).toBe('closed');
    expect((await t.api.get(`/api/projects/${p.id}/items?kind=risk`)).body.length).toBe(1);
    await t.api.del(`/api/projects/${p.id}/items/${issue.body.id}`);
    expect((await t.api.get(`/api/projects/${p.id}/items`)).body.length).toBe(1);

    // only risks escalate
    const decision = await t.api.post(`/api/projects/${p.id}/items`, { kind: 'decision', title: 'Pick a date' });
    expect((await t.api.post(`/api/projects/${p.id}/items/${decision.body.id}/escalate`)).status).toBe(400);

    const escalated = await t.api.post(`/api/projects/${p.id}/items/${risk.body.id}/escalate`);
    if (t.ctx.resources.get('risk')) {
      // the whole application is loaded: the risk lands in the enterprise register
      expect(escalated.status).toBe(201);
      expect(escalated.body.item.escalated_risk_id).toBe(escalated.body.risk.id);
      expect((await t.api.post(`/api/projects/${p.id}/items/${risk.body.id}/escalate`)).status).toBe(409);
    } else {
      expect(escalated.status).toBe(409);
      expect(escalated.body.error.code).toBe('risk_register_unavailable');
      expect((await t.api.get(`/api/projects/${p.id}/items?kind=risk`)).body[0].escalated_risk_id).toBeNull();
    }
  });

  it('keeps milestones for the timeline', async () => {
    const p = await make({ name: 'With milestones' });
    const m = await t.api.post(`/api/projects/${p.id}/milestones`, { name: 'Kick-off', due_on: '2026-12-01' });
    expect(m.status).toBe(201);
    expect((await t.api.post(`/api/projects/${p.id}/milestones`, { name: 'No date' })).status).toBe(400);
    expect((await t.api.patch(`/api/projects/${p.id}/milestones/${m.body.id}`, { done_on: '2026-12-02' })).body.done_on).toBe('2026-12-02');
    const row = (await t.api.get('/api/projects/portfolio')).body.register.find((r: any) => r.id === p.id);
    expect(row.milestones).toMatchObject([{ name: 'Kick-off', due_on: '2026-12-01', done_on: '2026-12-02' }]);
    await t.api.del(`/api/projects/${p.id}/milestones/${m.body.id}`);
    expect((await t.api.get(`/api/projects/${p.id}/milestones`)).body).toEqual([]);
    expect((await t.api.get(`/api/projects/${p.id}/milestones/`)).status).toBeLessThan(500);
  });
});

describe('permissions', () => {
  it('lets a project manager manage projects and an agent only view', async () => {
    const pm = await t.as('project_manager');
    const agent = await t.as('agent');
    const made = await pm.post('/api/projects', { name: 'PM project' });
    expect(made.status).toBe(201);
    const id = made.body.id;
    const gate = (await pm.get(`/api/projects/${id}/gates`)).body.gates[0];
    const url = `/api/projects/${id}/gates/${gate.id}`;

    expect((await agent.get('/api/projects')).status).toBe(200);
    expect((await agent.get(`/api/projects/${id}/gates`)).status).toBe(200);
    expect((await agent.get('/api/projects/portfolio')).status).toBe(200);
    expect((await agent.post('/api/projects', { name: 'Nope' })).status).toBe(403);
    expect((await agent.patch(`/api/projects/${id}`, { name: 'Nope' })).status).toBe(403);
    expect((await agent.patch(`${url}/items/${gate.items[0].id}`, { checked: true })).status).toBe(403);
    expect((await agent.post(`${url}/decide`, { decision: 'deferred', approver_name: 'X' })).status).toBe(403);
    expect((await agent.post(`/api/projects/${id}/status-reports`, {})).status).toBe(403);
    expect((await agent.post(`/api/projects/${id}/items`, { kind: 'risk', title: 'x' })).status).toBe(403);
    expect((await agent.post(`/api/projects/${id}/milestones`, {})).status).toBe(403);
    expect((await agent.patch('/api/projects/settings', { wipLimit: 9 })).status).toBe(403);
    expect((await t.anon.get('/api/projects/portfolio')).status).toBe(401);

    for (const item of gate.items) expect((await pm.patch(`${url}/items/${item.id}`, { checked: true })).status).toBe(200);
    for (const i of gate.documents.keys()) expect((await pm.patch(`${url}/documents/${i}`, { received: true })).status).toBe(200);
    const decided = await pm.post(`${url}/decide`, { decision: 'approved', approver_name: 'Dept head', approver_role: 'Sponsor' });
    expect(decided.body.project.stage).toBe('initiate');
    expect((await pm.post(`/api/projects/${id}/status-reports`, { period_end: '2026-10-31', overall: 'green', schedule: 'green', budget: 'green', risk: 'green' })).status).toBe(201);
    expect((await pm.patch('/api/projects/settings', { wipLimit: 4 })).status).toBe(200);
    const history = await pm.get(`/api/history?record_type=project&record_id=${id}`);
    expect(history.body.find((h: any) => h.action === 'project.gate_decision').summary).toContain('Dept head');
  });
});

describe('sample data', () => {
  it('seeds invented projects once, across stages and tiers', async () => {
    const opts = { profile: 'dev' as const, seedDir: 'not-used' };
    expect(await mod.seed!(t.ctx, opts)).toMatch(/created/);
    expect(await mod.seed!(t.ctx, opts)).toMatch(/skipped/);
    const rows = (await t.api.get('/api/projects?q=%5BSample%5D&pageSize=50')).body.rows;
    expect(rows.length).toBe(7);
    expect(new Set(rows.map((r: any) => r.stage)).size).toBe(6);
    expect(new Set(rows.map((r: any) => r.tier)).size).toBe(3);
    // Not tied to sample titles: the in-delivery sample that has started its go-live checklist.
    const current = async (id: string) => (await t.api.get(`/api/projects/${id}/gates`)).body.gates.find((g: any) => g.is_current);
    const delivering = rows.filter((r: any) => r.stage === 'deliver');
    expect(delivering.length).toBe(2);
    const gates = await Promise.all(delivering.map((r: any) => current(r.id)));
    const i = gates.findIndex((g: any) => g.checked > 0);
    expect(gates[i]).toMatchObject({ gate_key: 'go_live', checked: 4, total: 10 });
    expect((await t.api.get(`/api/projects/${delivering[i].id}/status-trend`)).body.series.length).toBe(4);
  });
});

describe('configurable lists', () => {
  it('ties every project list to the projects module (E01-23)', async () => {
    const rows = await t.db.query<{ list_key: string; module: string | null }>(
      `select distinct l.list_key, o.module from lookups l left join lookup_lists o on o.list_key = l.list_key
       where l.list_key like 'project\_%' or l.list_key = 'rag_rating'`);
    expect(rows.length).toBe(9);
    expect(rows.filter((r) => r.module !== 'projects')).toEqual([]);
  });
});
