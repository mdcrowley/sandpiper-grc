import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// The real corrective action plan type (contract C1, risks module), rather than the stand-in of audits.test.ts.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  process.env.GRC_MODULES = 'audits,risks,workflows,notifications';
  t = await testApp();
});
afterAll(async () => { delete process.env.GRC_MODULES; await t.close(); });

describe('findings raise corrective action plans (contract C1)', () => {
  it('creates a plan filed under Inspection for a finding from an inspection', async () => {
    if (!t.ctx.resources.get('cap')) return; // the plan type is not part of this build yet
    // Seeded on the first start although audits seeds before risks and notifications.
    expect((await t.ctx.lookups.values('action_source')).map((v) => v.value)).toContain('inspection');
    expect((await t.ctx.lookups.values('notification_kind')).map((v) => v.value)).toContain('audits');
    const tpl = await t.api.post('/api/checklist-templates', { name: 'Invented check', kind: 'inspection' });
    const ins = await t.api.post('/api/inspections', { template_id: tpl.body.id, target_type: 'none' });
    const f = await t.api.post('/api/audit-findings', { title: 'Invented gap', source_type: 'inspection', source_id: ins.body.id, condition: 'Invented condition.' });
    const res = await t.api.post(`/api/audit-findings/${f.body.id}/cap`, {});
    expect(res.status).toBe(201);
    expect(res.body.cap.route).toBe(`/caps/${res.body.cap.id}`);
    const plan = (await t.api.get(`/api/caps/${res.body.cap.id}`)).body;
    expect(plan).toMatchObject({ source: 'inspection', source_type: 'audit_finding', source_id: f.body.id, title: 'Invented gap' });
    expect(plan.problem_statement).toContain('Invented condition.');
    expect((await t.api.get(`/api/audit-findings/${f.body.id}`)).body.cap_id).toBe(res.body.cap.id);
  });

  it('records a plan raised from the plan panel (straight through the plan type) on the finding', async () => {
    if (!t.ctx.resources.get('cap')) return;
    const tpl = await t.api.post('/api/checklist-templates', { name: 'Invented check 2', kind: 'inspection' });
    const ins = await t.api.post('/api/inspections', { template_id: tpl.body.id, target_type: 'none' });
    const f = await t.api.post('/api/audit-findings', { title: 'Invented gap 2', source_type: 'inspection', source_id: ins.body.id });
    const plan = await t.api.post('/api/caps', { title: 'Invented plan', problem_statement: 'Invented.', source_type: 'audit_finding', source_id: f.body.id });
    expect(plan.status).toBe(201);
    expect((await t.api.get(`/api/audit-findings/${f.body.id}`)).body).toMatchObject({ cap_id: plan.body.id, status: 'cap_raised' });
  });
});
