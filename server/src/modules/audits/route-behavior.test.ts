import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';

// Behavior test for POST /api/audits/inspections/run [audits.administer] (E40-05): refused without the
// permission; with it, marks inspections not done a week after their due date as missed, reminds the
// inspector once, and answers its counts. Invented checklists only.

let t: Awaited<ReturnType<typeof testApp>>;

beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(async () => { await t?.close(); });

describe('POST /api/audits/inspections/run', () => {
  it('needs audits.administer', async () => {
    for (const role of ['security_lead', 'compliance_officer']) { // audits.view
      expect((await (await t.as(role)).post('/api/audits/inspections/run')).status).toBe(403);
    }
    expect((await t.anon.post('/api/audits/inspections/run')).status).toBe(401);
  });

  it('marks late inspections missed, reminds the inspector of one due soon, once, and answers its counts', async () => {
    const lead = await t.as('audit_lead'); // audits.*
    const tpl = (await lead.post('/api/checklist-templates', { name: 'Invented yard walk', kind: 'inspection', target_type: null })).body;
    expect(tpl.id).toBeTruthy();
    await lead.put(`/api/checklist-templates/${tpl.id}/items`, { items: [{ prompt: 'Invented: walkways clear' }] });
    const late = (await lead.post('/api/inspections', { template_id: tpl.id, target_type: 'none', due_on: dayInZone(-10) })).body;
    const recent = (await lead.post('/api/inspections', { template_id: tpl.id, target_type: 'none', due_on: dayInZone(-3) })).body;
    const soon = (await lead.post('/api/inspections', { template_id: tpl.id, target_type: 'none', due_on: dayInZone(1), inspector_id: lead.userId })).body;

    const res = await lead.post('/api/audits/inspections/run');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ created: expect.any(Number), missed: expect.any(Number), reminded: expect.any(Number), requestsReminded: expect.any(Number), verificationsReminded: expect.any(Number), skipped: [] });
    expect(res.body.missed).toBeGreaterThanOrEqual(1);
    expect((await lead.get(`/api/inspections/${late.id}`)).body.status).toBe('missed');
    expect((await lead.get(`/api/inspections/${recent.id}`)).body.status).not.toBe('missed');
    const notes = async () => (await t.db.query(`select 1 from notifications where record_type = 'inspection' and record_id = $1 and user_id = $2`, [soon.id, lead.userId])).length;
    expect(await notes()).toBe(1);

    const again = (await lead.post('/api/audits/inspections/run')).body;
    expect(again.missed).toBe(0);
    expect(await notes()).toBe(1);
  });
});
