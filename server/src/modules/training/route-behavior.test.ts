import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { CERT_REMINDER_SETTING } from './qualifications.ts';

// Behavior tests for hand-written training routes no other test named (E40-05):
// PATCH and DELETE /api/positions/:id/requirements/:rid and GET/PUT /api/training/certifications/settings.
// Invented data only.

let t: Awaited<ReturnType<typeof testApp>>;
const MISSING = '00000000-0000-4000-8000-000000000201';
const audits = (action: string, id: string) =>
  t.db.query<any>('select * from audit_events where action = $1 and record_id = $2 order by id', [action, id]);

beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(async () => { await t?.close(); });

async function positionWithRequirement(name: string) {
  const pos = (await t.api.post('/api/positions', { name })).body;
  const req = await t.api.post(`/api/positions/${pos.id}/requirements`, { kind: 'certification', certification_type: 'first_aid', grace_days: 10 });
  expect(req.status).toBe(201);
  return { pos, req: req.body };
}

describe('PATCH /api/positions/:id/requirements/:rid', () => {
  it('changes whether a requirement is mandatory and its grace days, and audits before and after', async () => {
    const { pos, req } = await positionWithRequirement('Invented platform supervisor');
    expect(req).toMatchObject({ mandatory: true, grace_days: 10 });
    const coordinator = await t.as('training_coordinator');
    const res = await coordinator.patch(`/api/positions/${pos.id}/requirements/${req.id}`, { mandatory: false, grace_days: 30 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: req.id, position_id: pos.id, kind: 'certification', certification_type: 'first_aid', mandatory: false, grace_days: 30 });
    expect((await t.api.get(`/api/positions/${pos.id}/requirements`)).body[0]).toMatchObject({ mandatory: false, grace_days: 30 });
    const ev = await audits('position_requirement.update', pos.id);
    expect(ev).toHaveLength(1);
    expect(ev[0].before).toEqual({ mandatory: true, grace_days: 10 });
    expect(ev[0].after).toEqual({ mandatory: false, grace_days: 30 });

    // Only the grace days: mandatory stays as it is.
    expect((await coordinator.patch(`/api/positions/${pos.id}/requirements/${req.id}`, { grace_days: 5 })).body).toMatchObject({ mandatory: false, grace_days: 5 });
  });

  it('validates, refuses a requirement of another position, and needs training.edit', async () => {
    const { pos, req } = await positionWithRequirement('Invented yard dispatcher');
    const other = (await t.api.post('/api/positions', { name: 'Invented other position' })).body;
    const bad = await t.api.patch(`/api/positions/${pos.id}/requirements/${req.id}`, { grace_days: 400 });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.grace_days).toBeDefined();
    expect((await t.api.patch(`/api/positions/${pos.id}/requirements/${req.id}`, { grace_days: 1.5 })).status).toBe(400);
    expect((await t.api.patch(`/api/positions/${other.id}/requirements/${req.id}`, { grace_days: 1 })).status).toBe(404);
    expect((await t.api.patch(`/api/positions/${pos.id}/requirements/${MISSING}`, { grace_days: 1 })).status).toBe(404);
    expect((await t.api.patch(`/api/positions/${MISSING}/requirements/${req.id}`, { grace_days: 1 })).status).toBe(404);

    for (const role of ['agent']) { // training.view only (wave 26: the Safety manager may now edit training)
      const c = await t.as(role);
      expect((await c.patch(`/api/positions/${pos.id}/requirements/${req.id}`, { grace_days: 1 })).status).toBe(403);
      expect((await c.del(`/api/positions/${pos.id}/requirements/${req.id}`)).status).toBe(403);
    }
    expect((await t.db.one<any>('select grace_days, deleted_at from position_requirements where id = $1', [req.id]))).toEqual({ grace_days: 10, deleted_at: null });
    expect(await audits('position_requirement.update', pos.id)).toHaveLength(0);
  });
});

describe('DELETE /api/positions/:id/requirements/:rid', () => {
  it('removes a requirement from the position, audits it, and lets it be added again', async () => {
    const { pos, req } = await positionWithRequirement('Invented track inspector');
    const res = await (await t.as('training_coordinator')).del(`/api/positions/${pos.id}/requirements/${req.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect((await t.api.get(`/api/positions/${pos.id}/requirements`)).body).toEqual([]);
    const ev = await audits('position_requirement.delete', pos.id);
    expect(ev).toHaveLength(1);
    expect(ev[0].before).toEqual({ kind: 'certification', course_id: null, certification_type: 'first_aid' });
    expect((await t.api.del(`/api/positions/${pos.id}/requirements/${req.id}`)).status).toBe(404);
    expect((await t.api.patch(`/api/positions/${pos.id}/requirements/${req.id}`, { grace_days: 1 })).status).toBe(404);
    // Gone, so the same requirement is no longer a duplicate.
    expect((await t.api.post(`/api/positions/${pos.id}/requirements`, { kind: 'certification', certification_type: 'first_aid' })).status).toBe(201);
  });
});

describe('GET and PUT /api/training/certifications/settings', () => {
  it('reads the default reminder days, saves new ones sorted without repeats, and audits the change', async () => {
    const viewer = await t.as('agent'); // training.view
    expect((await viewer.get('/api/training/certifications/settings')).body).toEqual({ reminder_days: [90, 60, 30] });

    const res = await t.api.put('/api/training/certifications/settings', { reminder_days: [7, 45, 7, 120] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reminder_days: [120, 45, 7] });
    expect((await viewer.get('/api/training/certifications/settings')).body).toEqual({ reminder_days: [120, 45, 7] });
    const ev = (await audits('setting.change', CERT_REMINDER_SETTING)).filter((e) => e.actor_name === 'Test Admin');
    expect(ev).toHaveLength(1);
    expect(JSON.stringify(ev[0].after)).toContain('120');
  });

  it('validates the days and needs training.administer to change them, training.view to read them', async () => {
    for (const reminder_days of [[], [0], [366], [1.5], [1, 2, 3, 4, 5, 6, 7], 'thirty', null]) {
      const res = await t.api.put('/api/training/certifications/settings', { reminder_days });
      expect(res.status, JSON.stringify(reminder_days)).toBe(400);
      expect(res.body.error.fields.reminder_days).toBeDefined();
    }
    const before = (await t.api.get('/api/training/certifications/settings')).body;
    // training.edit is not enough; the coordinator holds training.* and may.
    const editorRole = await t.db.one<{ id: string }>(`insert into roles (key, name, description, enabled) values ('rb_training_edit','rb_training_edit','test',true) returning id`);
    for (const g of ['training.view', 'training.edit']) await t.db.query('insert into role_permissions (role_id, permission) values ($1,$2)', [editorRole!.id, g]);
    const editor = await t.as('rb_training_edit');
    expect((await editor.put('/api/training/certifications/settings', { reminder_days: [10] })).status).toBe(403);
    expect((await (await t.as('training_coordinator')).put('/api/training/certifications/settings', { reminder_days: [14] })).body).toEqual({ reminder_days: [14] });
    expect(before).not.toEqual({ reminder_days: [14] });
    expect((await (await t.as('project_manager')).get('/api/training/certifications/settings')).status).toBe(403);
  });
});
