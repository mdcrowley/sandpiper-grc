import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// Behavior tests for PATCH and DELETE /api/security-incidents/:id/evidence/:childId [security.edit]
// and PATCH and DELETE /api/security-incident-contacts/:id [security.administer] (E40-05). Both need
// security.view as well. Invented data only.

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let editor: Client; // security.view and security.edit, no administer
let blind: Client; // security.edit without security.view
const MISSING = '00000000-0000-4000-8000-000000000401';
const audits = (action: string, id: string) =>
  t.db.query<any>('select * from audit_events where action = $1 and record_id = $2 order by id', [action, id]);

async function withGrants(key: string, grants: string[]) {
  const role = await t.db.one<{ id: string }>(`insert into roles (key, name, description, enabled) values ($1,$1,'test',true) returning id`, [key]);
  for (const g of grants) await t.db.query('insert into role_permissions (role_id, permission) values ($1,$2)', [role!.id, g]);
  return t.as(key);
}
async function incident(title: string) {
  const made = await t.api.post('/api/security-incidents', { title, scenario: 'ransomware', severity: 'high', discovered_at: new Date(Date.now() - 3_600_000).toISOString() });
  expect(made.status).toBe(201);
  return made.body.id as string;
}

beforeAll(async () => {
  t = await testApp();
  editor = await withGrants('rb_sec_edit', ['security.view', 'security.edit']);
  blind = await withGrants('rb_sec_blind', ['security.edit', 'security.administer']);
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('PATCH and DELETE /api/security-incidents/:id/evidence/:childId', () => {
  it('changes only what is sent, audits the difference, then removes the item from the list', async () => {
    const id = await incident('Invented scheduling server encrypted');
    const ev = (await editor.post(`/api/security-incidents/${id}/evidence`, { item: 'Invented disk image', where_held: 'Evidence locker A', collected_by: 'Pat Example' })).body;
    expect(ev.item).toBe('Invented disk image');

    const res = await editor.patch(`/api/security-incidents/${id}/evidence/${ev.id}`, { hash_ref: 'sha256:0f0f-invented', where_held: 'Evidence locker B' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: ev.id, item: 'Invented disk image', collected_by: 'Pat Example', hash_ref: 'sha256:0f0f-invented', where_held: 'Evidence locker B' });
    expect((await editor.get(`/api/security-incidents/${id}/evidence`)).body[0]).toMatchObject({ hash_ref: 'sha256:0f0f-invented' });
    const changed = await audits('security_incident.evidence_update', id);
    expect(changed).toHaveLength(1);
    expect(changed[0].before).toEqual({ hash_ref: null, where_held: 'Evidence locker A' });
    expect(changed[0].after).toEqual({ hash_ref: 'sha256:0f0f-invented', where_held: 'Evidence locker B' });

    // Same values: nothing written.
    await editor.patch(`/api/security-incidents/${id}/evidence/${ev.id}`, { where_held: 'Evidence locker B' });
    expect(await audits('security_incident.evidence_update', id)).toHaveLength(1);
    expect((await editor.patch(`/api/security-incidents/${id}/evidence/${ev.id}`, { item: '' })).status).toBe(400);

    const gone = await editor.del(`/api/security-incidents/${id}/evidence/${ev.id}`);
    expect(gone.status).toBe(200);
    expect(gone.body).toEqual({ ok: true });
    expect((await editor.get(`/api/security-incidents/${id}/evidence`)).body).toEqual([]);
    expect(await audits('security_incident.evidence_remove', id)).toHaveLength(1);
    expect((await editor.del(`/api/security-incidents/${id}/evidence/${ev.id}`)).status).toBe(404);
    expect((await editor.patch(`/api/security-incidents/${id}/evidence/${ev.id}`, { item: 'Back' })).status).toBe(404);
  });

  it('refuses another incident\'s item and people without security.edit or security.view', async () => {
    const a = await incident('Invented incident A');
    const b = await incident('Invented incident B');
    const ev = (await editor.post(`/api/security-incidents/${a}/evidence`, { item: 'Invented firewall log export' })).body;
    expect((await editor.patch(`/api/security-incidents/${b}/evidence/${ev.id}`, { item: 'x' })).status).toBe(404);
    expect((await editor.del(`/api/security-incidents/${b}/evidence/${ev.id}`)).status).toBe(404);
    expect((await editor.patch(`/api/security-incidents/${MISSING}/evidence/${ev.id}`, { item: 'x' })).status).toBe(404);

    expect((await blind.patch(`/api/security-incidents/${a}/evidence/${ev.id}`, { item: 'x' })).status).toBe(403);
    expect((await blind.del(`/api/security-incidents/${a}/evidence/${ev.id}`)).status).toBe(403);
    const viewOnly = await withGrants('rb_sec_view', ['security.view']);
    expect((await viewOnly.patch(`/api/security-incidents/${a}/evidence/${ev.id}`, { item: 'x' })).status).toBe(403);
    expect((await viewOnly.del(`/api/security-incidents/${a}/evidence/${ev.id}`)).status).toBe(403);
    expect((await (await t.as('agent')).del(`/api/security-incidents/${a}/evidence/${ev.id}`)).status).toBe(403);
    expect((await t.db.one<any>('select item, deleted_at from incident_evidence where id = $1', [ev.id]))).toEqual({ item: 'Invented firewall log export', deleted_at: null });
  });
});

describe('PATCH and DELETE /api/security-incident-contacts/:id', () => {
  it('changes and removes a standing contact, audited; new incidents copy only live contacts', async () => {
    const lead = await t.as('security_lead'); // security.*
    const c = (await lead.post('/api/security-incident-contacts', { role: 'Invented outside counsel', person_name: 'Quinn Example', contact: '555-0100', sort: 5 })).body;
    const res = await lead.patch(`/api/security-incident-contacts/${c.id}`, { contact: '555-0199', notes: 'Invented: call after hours' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: c.id, role: 'Invented outside counsel', person_name: 'Quinn Example', contact: '555-0199', notes: 'Invented: call after hours' });
    expect((await lead.get('/api/security-incident-contacts')).body.find((x: any) => x.id === c.id).contact).toBe('555-0199');
    const ev = await audits('incident_contact.update', c.id);
    expect(ev).toHaveLength(1);
    expect(ev[0].before).toEqual({ contact: '555-0100', notes: null });
    expect((await lead.patch(`/api/security-incident-contacts/${c.id}`, { role: '' })).status).toBe(400);
    expect((await lead.patch(`/api/security-incident-contacts/${c.id}`, { sort: 'first' })).status).toBe(400);

    const gone = await lead.del(`/api/security-incident-contacts/${c.id}`);
    expect(gone.status).toBe(200);
    expect(gone.body).toEqual({ ok: true });
    expect((await lead.get('/api/security-incident-contacts')).body.some((x: any) => x.id === c.id)).toBe(false);
    expect(await audits('incident_contact.delete', c.id)).toHaveLength(1);
    expect((await lead.del(`/api/security-incident-contacts/${c.id}`)).status).toBe(404);
    expect((await lead.patch(`/api/security-incident-contacts/${c.id}`, { contact: 'x' })).status).toBe(404);

    // A removed contact is not copied onto a new incident's roles.
    const id = await incident('Invented incident after the contact left');
    const roles = (await lead.get(`/api/security-incidents/${id}/roles`)).body;
    expect(roles.some((r: any) => r.person_name === 'Quinn Example')).toBe(false);
  });

  it('needs security.administer and security.view', async () => {
    const c = (await t.api.post('/api/security-incident-contacts', { role: 'Invented insurer hotline' })).body;
    expect((await editor.patch(`/api/security-incident-contacts/${c.id}`, { contact: 'x' })).status).toBe(403);
    expect((await editor.del(`/api/security-incident-contacts/${c.id}`)).status).toBe(403);
    expect((await blind.patch(`/api/security-incident-contacts/${c.id}`, { contact: 'x' })).status).toBe(403);
    expect((await blind.del(`/api/security-incident-contacts/${c.id}`)).status).toBe(403);
    expect((await t.db.one<any>('select contact, deleted_at from incident_contacts where id = $1', [c.id]))).toEqual({ contact: null, deleted_at: null });
    expect((await t.api.patch(`/api/security-incident-contacts/${MISSING}`, { contact: 'x' })).status).toBe(404);
    expect((await t.api.patch('/api/security-incident-contacts/nope', { contact: 'x' })).status).toBe(404);
  });
});
