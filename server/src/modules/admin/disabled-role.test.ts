// E18-78: a role switched off under Administration > Roles grants nothing, so it cannot be handed out
// (the person would silently have no access); a person who already holds it keeps it. Invented data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

describe('switched-off roles', () => {
  it('refuses to give a switched-off role on create or update, and keeps one already held', async () => {
    const off = (await t.db.one<{ key: string; name: string }>(`insert into roles (key, name, enabled) values ('invented_off', 'Invented off role', false) returning key, name`))!;
    const made = await t.api.post('/api/admin/users', { username: 'invented.offrole', email: 'invented.offrole@example.test', displayName: 'Invented Off Role', roles: [off.key] });
    expect(made.status).toBe(400);
    expect(made.body.error.fields.roles).toContain('switched off');
    expect(made.body.error.fields.roles).toContain(off.name);

    const ok = await t.api.post('/api/admin/users', { username: 'invented.onrole', email: 'invented.onrole@example.test', displayName: 'Invented On Role', roles: ['agent'] });
    expect(ok.status).toBe(201);
    const id = ok.body.user.id as string;
    const add = await t.api.patch(`/api/admin/users/${id}`, { roles: ['agent', off.key] });
    expect(add.status).toBe(400);
    expect(add.body.error.fields.roles).toContain('switched off');

    // Held from before it was switched off: saving the roles again keeps it.
    const role = (await t.db.one<{ id: string }>('select id from roles where key = $1', [off.key]))!;
    await t.db.query('insert into user_roles (user_id, role_id) values ($1, $2)', [id, role.id]);
    const keep = await t.api.patch(`/api/admin/users/${id}`, { roles: ['agent', off.key] });
    expect(keep.status, JSON.stringify(keep.body)).toBe(200);
  });

  it("accepts a role of a switched-off area, which applies once the area is on", async () => {
    // The Requester role belongs to the self-service portal: hidden on the Roles page while the portal is off.
    await t.db.query(`update roles set enabled = false where key = 'requester'`);
    expect((await t.api.patch('/api/admin/features', { features: { portal: false } })).status).toBe(200);
    const made = await t.api.post('/api/admin/users', { username: 'invented.requester', email: 'invented.requester@example.test', displayName: 'Invented Requester', roles: ['requester'] });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
  });
});
