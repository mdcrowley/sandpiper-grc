import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// E18-34: a project request carries the administrator's custom fields for people who see them
// (they may view projects); for a requester who may not, required ones are not enforced and
// custom values are not taken. Invented data only.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

describe('custom fields on project requests (E18-34)', () => {
  it('are required for people who see them and skipped for requesters who do not', async () => {
    expect((await t.api.patch('/api/projects/settings', { intakeOpenTo: 'everyone' })).status).toBe(200);
    const field = await t.api.post('/api/admin/custom-fields', { record_type: 'project', label: 'Program code', type: 'text', required: true });
    expect(field.status).toBe(201);

    const agent = await t.as('agent'); // may view projects
    const missing = await agent.post('/api/projects/requests', { name: 'Platform display refresh' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.fields).toHaveProperty('cf_program_code');
    const made = await agent.post('/api/projects/requests', { name: 'Platform display refresh', cf_program_code: 'PG-7' });
    expect(made.status).toBe(201);
    expect((await t.api.get(`/api/projects/${made.body.id}`)).body.cf_program_code).toBe('PG-7');

    const requester = await t.as('requester'); // may not view projects: no custom fields in their metadata
    const theirs = await requester.post('/api/projects/requests', { name: 'Bike racks at the depot', cf_program_code: 'PG-8' });
    expect(theirs.status).toBe(201);
    expect(theirs.body.can_open).toBe(false);
    expect((await t.api.get(`/api/projects/${theirs.body.id}`)).body.cf_program_code).toBeNull();
    expect((await t.api.patch(`/api/admin/custom-fields/${field.body.id}`, { active: false })).status).toBe(200);
  });
});
