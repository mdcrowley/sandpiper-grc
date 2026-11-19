import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// E18-34: taking an assessment snapshot carries the administrator's custom fields, and a required
// one is enforced. Invented data only.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

describe('custom fields on assessment snapshots (E18-34)', () => {
  it('are taken and required by POST /api/assessments', async () => {
    const fw = await t.api.post('/api/frameworks', { key: 'cfprobe', name: 'Probe Framework', version: '1.0' });
    expect(fw.status).toBe(201);
    const field = await t.api.post('/api/admin/custom-fields', { record_type: 'assessment_snapshot', label: 'Reviewed by board', type: 'text', required: true });
    expect(field.status).toBe(201);

    const missing = await t.api.post('/api/assessments', { name: 'Spring', framework_id: fw.body.id, date: '2025-03-01' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.fields).toHaveProperty('cf_reviewed_by_board');

    const made = await t.api.post('/api/assessments', { name: 'Spring', framework_id: fw.body.id, date: '2025-03-01', cf_reviewed_by_board: 'March meeting' });
    expect(made.status).toBe(201);
    expect((await t.api.get(`/api/assessment-snapshots/${made.body.id}`)).body.cf_reviewed_by_board).toBe('March meeting');
    expect((await t.api.patch(`/api/admin/custom-fields/${field.body.id}`, { active: false })).status).toBe(200);
  });
});
