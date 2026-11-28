import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';

// E45-57: which risk categories make their new risks restricted records, set through a form (route)
// rather than the list's meta; and the proximity, velocity and strategic objective of a risk.
// Invented risks only.

let t: Awaited<ReturnType<typeof testApp>>;

beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(async () => { await t?.close(); });

describe('restriction per category', () => {
  it('lists the categories with their restriction and counts, and changes one', async () => {
    const list = (await t.api.get('/api/risks/categories')).body;
    expect(list.can_change).toBe(true);
    expect(list.categories.find((c: Row) => c.category === 'cyber')).toMatchObject({ restricted: true });
    expect(list.categories.find((c: Row) => c.category === 'compliance')).toMatchObject({ restricted: false });

    const before = (await t.api.post('/api/risks', { title: 'Invented compliance risk', category: 'compliance' })).body;
    expect(before.restricted).toBe(false);
    const res = await t.api.put('/api/risks/categories/compliance/restriction', { restricted: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.changed).toBe(0);
    // New risks in it are restricted; the existing one changes only when asked.
    expect((await t.api.post('/api/risks', { title: 'Invented second compliance risk', category: 'compliance' })).body.restricted).toBe(true);
    expect((await t.api.get(`/api/risks/${before.id}`)).body.restricted).toBe(false);
    const all = await t.api.put('/api/risks/categories/compliance/restriction', { restricted: true, apply_to_existing: true });
    expect(all.body.changed).toBe(1);
    expect((await t.api.get(`/api/risks/${before.id}`)).body.restricted).toBe(true);
    expect((await t.api.put('/api/risks/categories/compliance/restriction', { restricted: 'yes' })).status).toBe(400);
    expect((await t.api.put('/api/risks/categories/nonsense/restriction', { restricted: true })).status).toBe(404);
  });

  it('needs risks.administer and sight of restricted records to change', async () => {
    const r = await t.db.one<{ id: string }>(`insert into roles (key, name, enabled) values ('risk_admin_open', 'Invented risk admin', true) returning id`);
    for (const p of ['risks.view', 'risks.administer']) await t.db.query('insert into role_permissions (role_id, permission) values ($1, $2)', [r!.id, p]);
    const admin = await t.as('risk_admin_open');
    expect((await admin.get('/api/risks/categories')).body.can_change).toBe(false);
    expect((await admin.put('/api/risks/categories/compliance/restriction', { restricted: false })).status).toBe(403);
  });
});

describe('further risk fields', () => {
  it('keeps proximity, velocity and the strategic objective', async () => {
    const made = await t.api.post('/api/risks', {
      title: 'Invented loss of a bus depot', category: 'enterprise', proximity: 'near', velocity: 'rapid', strategic_objective: 'Reliable service on every route',
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body).toMatchObject({ proximity: 'near', velocity: 'rapid', strategic_objective: 'Reliable service on every route' });
    expect((await t.api.post('/api/risks', { title: 'Invented', category: 'enterprise', velocity: 'teleport' })).status).toBe(400);
    expect(made.body._display.proximity).toBe('3 to 12 months');
  });
});
