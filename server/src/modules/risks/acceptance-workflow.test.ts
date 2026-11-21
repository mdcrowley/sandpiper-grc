import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';

// E08-23: asking for a risk to be accepted runs the shared "Risk acceptance" approval workflow.
// All people and risks here are invented.

const loaded = !process.env.GRC_MODULES || process.env.GRC_MODULES.split(',').includes('workflows');
type T = Awaited<ReturnType<typeof testApp>>;
let t: T;
let owner: Awaited<ReturnType<T['as']>>; // asks
let approver: Awaited<ReturnType<T['as']>>; // decides
let blind: Awaited<ReturnType<T['as']>>; // risks.approve without security.view

const plus = (days: number) => dayInZone(days);
const panel = async (client: T['api'], id: string) => (await client.get(`/api/workflows/records/risk/${id}`)).body;
const waiting = async (client: T['api']) => (await client.get('/api/workflows/approvals')).body.rows as any[];
const ask = (client: T['api'], id: string, body: Record<string, unknown> = {}) =>
  client.post(`/api/risks/${id}/acceptance-request`, { expires_on: plus(180), rationale: 'Invented: the control costs more than the loss', ...body });

describe.runIf(loaded)('risk acceptance on the approval workflows', () => {
  beforeAll(async () => {
    t = await testApp();
    owner = await t.as('security_lead');
    approver = await t.as('security_lead');
    const role = await t.db.one<{ id: string }>(`insert into roles (key, name) values ('risk_approver_blind', 'Risk approver without security') returning id`);
    await t.db.query(`insert into role_permissions (role_id, permission) values ($1, 'risks.view'), ($1, 'risks.approve')`, [role!.id]);
    blind = await t.as('risk_approver_blind');
  }, 60_000);
  afterAll(async () => { await t?.close(); });

  const risk = async (title: string, l: number, i: number) =>
    (await owner.post('/api/risks', { title, residual_likelihood: l, residual_impact: i, inherent_likelihood: l, inherent_impact: i })).body;

  it('installs the default Risk acceptance workflow once', async () => {
    const defs = (await t.api.get('/api/workflows/definitions?record_type=risk')).body.rows.filter((d: any) => d.kind === 'risk_acceptance');
    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatchObject({ name: 'Risk acceptance', trigger: 'module', kind_label: 'Risk acceptance' });
    expect(defs[0].steps.map((s: any) => s.name)).toEqual(['Risk approver', 'Executive approver']);
    // Running the install again (another start) adds nothing.
    await t.app.workflows!.installKinds('risk_acceptance');
    expect((await t.api.get('/api/workflows/definitions?record_type=risk')).body.rows.filter((d: any) => d.kind === 'risk_acceptance')).toHaveLength(1);
  });

  it('keeps whether acceptance needs an executive on the risk', async () => {
    expect((await risk('Low probe', 1, 1)).acceptance_executive).toBe(false);
    expect((await risk('Extreme probe', 5, 5)).acceptance_executive).toBe(true);
  });

  it('asks, approves and records the acceptance; the executive step is skipped below the threshold', async () => {
    const r = await risk('Depot badge reader firmware', 2, 2);
    expect((await ask(owner, r.id, { expires_on: '' })).body.error.fields.expires_on).toBeDefined();
    const res = await ask(owner, r.id);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await ask(owner, r.id)).status).toBe(409); // already asked
    // The person who asked cannot decide; the approver sees it waiting.
    expect((await waiting(owner)).some((a) => a.record_id === r.id)).toBe(false);
    const item = (await waiting(approver)).find((a) => a.record_id === r.id);
    expect(item).toMatchObject({ kind: 'risk_acceptance', step: 'Risk approver' });
    const decided = await approver.post(`/api/workflows/steps/${item.step_id}/decision`, { decision: 'approved' });
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
    expect(decided.body.instance.status).toBe('approved');

    const after = (await t.api.get(`/api/risks/${r.id}`)).body;
    expect(after).toMatchObject({ status: 'accepted', treatment: 'accept' });
    const acc = (await t.api.get(`/api/risks/${r.id}/acceptances`)).body.acceptances[0];
    expect(acc).toMatchObject({ state: 'current', executive_required: false, reference: 'Approval workflow "Risk acceptance"' });
    expect(String(acc.expires_on).slice(0, 10)).toBe(plus(180));
    expect(acc.rationale).toMatch(/control costs more/);
    const p = await panel(t.api, r.id);
    expect(p.instances[0].steps[1].status).toBe('skipped');
    expect((await t.api.get(`/api/risks/${r.id}/acceptance-request`)).body.request).toMatchObject({ status: 'approved' });

    // Revoking is unchanged.
    const revoked = await approver.post(`/api/risks/${r.id}/acceptances/${acc.id}/revoke`, { reason: 'Invented: the supplier fixed it' });
    expect(revoked.status, JSON.stringify(revoked.body)).toBeLessThan(300);
    expect((await t.api.get(`/api/risks/${r.id}/acceptances`)).body.acceptances[0].state).toBe('revoked');
  });

  it('asks an executive too above the threshold', async () => {
    const r = await risk('Ticket vending back office exposure', 5, 5);
    expect((await ask(owner, r.id)).status).toBe(201);
    const first = (await waiting(approver)).find((a) => a.record_id === r.id);
    await approver.post(`/api/workflows/steps/${first.step_id}/decision`, { decision: 'approved' });
    const second = (await waiting(t.api as any)).find((a) => a.record_id === r.id);
    expect(second).toMatchObject({ step: 'Executive approver' });
    expect((await t.api.get(`/api/risks/${r.id}`)).body.status).not.toBe('accepted');
    await t.api.post(`/api/workflows/steps/${second.step_id}/decision`, { decision: 'approved' });
    const acc = (await t.api.get(`/api/risks/${r.id}/acceptances`)).body.acceptances[0];
    expect(acc).toMatchObject({ executive_required: true, approver_title: 'Executive approver (approval workflow)' });
    expect((await t.api.get(`/api/risks/${r.id}`)).body.status).toBe('accepted');
  });

  it('a rejection leaves the risk open, with the reason in its history', async () => {
    const r = await risk('Radio console patching', 3, 3);
    await ask(owner, r.id);
    const item = (await waiting(approver)).find((a) => a.record_id === r.id);
    expect((await approver.post(`/api/workflows/steps/${item.step_id}/decision`, { decision: 'rejected' })).status).toBe(400); // needs a reason
    await approver.post(`/api/workflows/steps/${item.step_id}/decision`, { decision: 'rejected', comment: 'Invented: patch it instead' });
    expect((await t.api.get(`/api/risks/${r.id}`)).body.status).toBe(r.status);
    expect((await t.api.get(`/api/risks/${r.id}/acceptances`)).body.acceptances).toHaveLength(0);
    const audit = await t.db.query<{ summary: string }>(`select summary from audit_events where action = 'risk.acceptance_rejected' and record_id = $1`, [r.id]);
    expect(audit[0].summary).toMatch(/patch it instead/);
    // It can be asked for again.
    expect((await ask(owner, r.id)).status).toBe(201);
  });

  it('never asks an approver who may not see restricted records', async () => {
    const r = await risk('Fare system key handling', 2, 3);
    await ask(owner, r.id);
    const p = await panel(t.api, r.id);
    const ids = p.instances[0].steps[0].approvers.map((a: any) => a.id);
    expect(ids).toContain(approver.userId);
    expect(ids).not.toContain(blind.userId);
    expect(((await blind.get('/api/workflows/approvals')).body.rows ?? []).some((a: any) => a.record_id === r.id)).toBe(false);
  });

  it('recording an acceptance by hand still works and settles a waiting request', async () => {
    const r = await risk('Depot CCTV retention', 2, 2);
    await ask(owner, r.id);
    const res = await approver.post(`/api/risks/${r.id}/acceptances`, { expires_on: plus(90), rationale: 'Invented: decided at the risk committee', approver_name: 'Pat Example' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await t.api.get(`/api/risks/${r.id}`)).body.status).toBe('accepted');
    expect((await t.api.get(`/api/risks/${r.id}/acceptance-request`)).body.request.status).toBe('canceled');
  });

  it('refuses a request for an unscored risk or with no workflow, and hides the kind with its area', async () => {
    const unscored = (await owner.post('/api/risks', { title: 'Unscored probe' })).body;
    expect((await ask(owner, unscored.id)).status).toBe(400);
    const def = (await t.api.get('/api/workflows/definitions?record_type=risk')).body.rows.find((d: any) => d.kind === 'risk_acceptance');
    await t.api.patch(`/api/workflows/definitions/${def.id}`, { active: false });
    try {
      const r = await risk('No workflow probe', 2, 2);
      const res = await ask(owner, r.id);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('no_workflow');
    } finally {
      await t.api.patch(`/api/workflows/definitions/${def.id}`, { active: true });
    }
    await t.ctx.settings.set('features', { risks: false });
    try {
      expect((await t.api.get('/api/workflows/options')).body.kinds.some((k: any) => k.key === 'risk_acceptance')).toBe(false);
      expect((await t.api.get('/api/workflows/definitions')).body.rows.some((d: any) => d.kind === 'risk_acceptance')).toBe(false);
    } finally {
      await t.ctx.settings.set('features', { risks: true });
    }
  });
});
