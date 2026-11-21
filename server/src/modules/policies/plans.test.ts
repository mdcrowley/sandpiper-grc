import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { addMonths, runPlanReviewReminders } from './plans.ts';

// A stand-in for contract C6 (the policy document type, added by the roster work): the column and
// the list with a plan value. Harmless once the real migration is in place.
const standIn: ModuleDef = {
  key: 'planstandins',
  async seedDefaults(ctx) {
    await ctx.db.exec('alter table policies add column if not exists document_type text');
    if (!(await ctx.lookups.values('policy_document_type')).length) {
      await ctx.lookups.ensure('policy_document_type', [
        { value: 'policy', label: 'Policy', sort: 10 },
        { value: 'plan', label: 'Plan', sort: 60, meta: { plan: true, review_months: 12 } },
      ], { module: 'policies' });
    }
  },
};

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let editor: Client;   // security lead: policies.*
let second: Client;   // another security lead
let third: Client;
let reader: Client;   // agent: policies.view
let planId: string;
let otherId: string;

beforeAll(async () => {
  process.env.GRC_MODULES = 'policies,workflows,notifications';
  t = await testApp({ extraModules: [standIn] });
  editor = await t.as('security_lead');
  second = await t.as('security_lead');
  third = await t.as('security_lead');
  reader = await t.as('agent');
  planId = (await editor.post('/api/policies', { title: 'Invented safety plan', review_date: dayInZone(10) })).body.id;
  await t.db.query(`update policies set document_type = 'plan' where id = $1`, [planId]);
  otherId = (await editor.post('/api/policies', { title: 'Invented ordinary policy' })).body.id;
});
afterAll(async () => { delete process.env.GRC_MODULES; await t.close(); });

describe('plan element map', () => {
  it('only plans have one', async () => {
    expect((await reader.get(`/api/policies/${otherId}/plan`)).body.is_plan).toBe(false);
    expect((await editor.put(`/api/policies/${otherId}/plan-elements`, { elements: [] })).status).toBe(409);
    const p = (await reader.get(`/api/policies/${planId}/plan`)).body;
    expect(p).toMatchObject({ is_plan: true, review_months: 12, elements: [], reviews: [], review_available: true });
  });

  it('offers the four generic pillars and saves the map with an audit entry', async () => {
    const values = (await reader.get('/api/lookups/plan_element')).body.map((v: Row) => v.value);
    expect(values).toEqual(['policy_objectives', 'risk_management', 'assurance', 'promotion']);
    const bad = await editor.put(`/api/policies/${planId}/plan-elements`, { elements: [{ element_key: 'nonsense' }] });
    expect(bad.status).toBe(400);
    const r = await editor.put(`/api/policies/${planId}/plan-elements`, { elements: [
      { element_key: 'risk_management', title: 'Hazard log', section_ref: 'Section 2.1', owner_id: editor.userId },
      { element_key: 'assurance', title: 'Indicators', section_ref: 'Section 3.1' },
    ] });
    expect(r.status).toBe(200);
    expect(r.body.map((e: Row) => e.element_key)).toEqual(['risk_management', 'assurance']);
    expect(r.body[0].owner_name).toMatch(/security_lead/);
    expect((await reader.put(`/api/policies/${planId}/plan-elements`, { elements: [] })).status).toBe(403);
    const audit = await t.db.query<Row>(`select * from audit_events where action = 'policy.plan_elements' and record_id = $1`, [planId]);
    expect(audit).toHaveLength(1);
  });
});

describe('annual plan review', () => {
  it('runs through three parties, each a different person, and sets the next review date', async () => {
    const start = await editor.post(`/api/policies/${planId}/plan-review`, { note: 'Invented yearly review' });
    expect(start.status).toBe(201);
    expect((await editor.post(`/api/policies/${planId}/plan-review`)).status).toBe(409); // one at a time
    const step = async (who: Pick<Client, 'get'>) => (await who.get('/api/workflows/approvals')).body.rows.find((r: Row) => r.record_id === planId);
    // The person who started it never decides it.
    expect(await step(editor)).toBeUndefined();
    const s1 = await step(second);
    expect(s1.step).toBe('Accountable executive');
    expect((await second.post(`/api/workflows/steps/${s1.step_id}/decision`, { decision: 'approved' })).status).toBe(200);
    // The same person may not decide the next step too.
    expect(await step(second)).toBeUndefined();
    const s2 = await step(third);
    expect(s2.step).toBe('Governing body');
    await third.post(`/api/workflows/steps/${s2.step_id}/decision`, { decision: 'approved' });
    const s3 = await step(t.api);
    expect(s3.step).toBe('Safety committee');
    await t.api.post(`/api/workflows/steps/${s3.step_id}/decision`, { decision: 'approved' });
    const plan = (await reader.get(`/api/policies/${planId}/plan`)).body;
    expect(plan.reviews[0]).toMatchObject({ outcome: 'approved', review_year: Number(dayInZone().slice(0, 4)) });
    expect(plan.review_running).toBe(false);
    expect((await reader.get(`/api/policies/${planId}`)).body.review_date).toBe(addMonths(dayInZone(), 12));
  });

  it('refuses a review of a policy that is not a plan', async () => {
    expect((await editor.post(`/api/policies/${otherId}/plan-review`)).status).toBe(409);
  });

  it('adds months without running past the end of a month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-21', 12)).toBe('2027-11-21');
  });

  it('reminds the owner once as the review date nears', async () => {
    const id = (await editor.post('/api/policies', { title: 'Invented second plan', owner_id: editor.userId, review_date: dayInZone(5) })).body.id;
    await t.db.query(`update policies set document_type = 'plan' where id = $1`, [id]);
    const ctx = { app: t.app, db: t.db, settings: { get: async (_k: string, f: unknown) => f }, lookups: { values: async () => [{ value: 'plan', meta: { plan: true } }] } } as any;
    const first = await runPlanReviewReminders(ctx);
    expect(first.soon).toBeGreaterThanOrEqual(1);
    await runPlanReviewReminders(ctx);
    const sent = await t.db.query<Row>('select 1 from notifications where user_id = $1 and record_id = $2', [editor.userId, id]);
    expect(sent).toHaveLength(1);
  });
});
