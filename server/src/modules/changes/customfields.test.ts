import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// E18-34: a standard change raised from a template carries the administrator's custom fields,
// and a required one is enforced there as on the ordinary create. Invented data only.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

describe('custom fields on changes (E18-34)', () => {
  it('are taken and required when a change is raised from a template', async () => {
    const field = await t.api.post('/api/admin/custom-fields', { record_type: 'change', label: 'Work order', type: 'text', required: true });
    expect(field.status).toBe(201);
    const template = await t.api.post('/api/changes/templates', {
      name: 'Depot router patching', title: 'Patch the depot router', implementation_plan: 'Patch and restart.',
      backout_plan: 'Restore the previous image.', risk_level: 'low', duration_minutes: 60,
    });
    expect(template.status).toBe(201);
    const raise = (body: Record<string, unknown>) => t.api.post(`/api/changes/templates/${template.body.id}/raise`, { planned_start: '2031-05-05T18:00:00Z', ...body });

    const missing = await raise({});
    expect(missing.status).toBe(400);
    expect(missing.body.error.fields).toHaveProperty('cf_work_order');

    const made = await raise({ cf_work_order: 'WO-1182' });
    expect(made.status).toBe(201);
    expect((await t.api.get(`/api/changes/${made.body.id}`)).body.cf_work_order).toBe('WO-1182');

    const plain = await t.api.post('/api/changes', { title: 'Swap a switch', change_type: 'normal', cf_work_order: 'WO-1183' });
    expect(plain.status).toBe(201);
    expect(plain.body.cf_work_order).toBe('WO-1183');
    expect((await t.api.patch(`/api/admin/custom-fields/${field.body.id}`, { active: false })).status).toBe(200);
  });
});
