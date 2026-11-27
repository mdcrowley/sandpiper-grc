// E18-76: a finding with no owner takes one from its asset, else its system (technical owner, then
// business owner), when it is added or linked; an owner given is kept. Invented data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

describe('finding owner from what it is on', () => {
  it('fills the owner from the system or asset, and never overrides one', async () => {
    if (!t.ctx.resources.get('system')) return;
    const tech = await t.as('agent');
    const biz = await t.as('agent');
    const keeper = await t.as('agent');
    const sys = (await t.api.post('/api/systems', { name: 'Invented depot yard system', technical_owner_id: tech.userId, business_owner_id: biz.userId })).body;
    const bizOnly = (await t.api.post('/api/systems', { name: 'Invented fare kiosk system', business_owner_id: biz.userId })).body;

    const a = (await t.api.post('/api/vulnerabilities', { title: 'Invented weak cipher', severity: 'medium', system_id: sys.id })).body;
    expect(a.owner_id).toBe(tech.userId);
    const b = (await t.api.post('/api/vulnerabilities', { title: 'Invented old library', severity: 'low', system_id: bizOnly.id })).body;
    expect(b.owner_id).toBe(biz.userId);
    // Given explicitly: kept.
    const c = (await t.api.post('/api/vulnerabilities', { title: 'Invented open port', severity: 'low', system_id: sys.id, owner_id: keeper.userId })).body;
    expect(c.owner_id).toBe(keeper.userId);
    // Linked later: filled then; an owner already set is never changed by a new link.
    const d = (await t.api.post('/api/vulnerabilities', { title: 'Invented default password', severity: 'high' })).body;
    expect(d.owner_id).toBeNull();
    expect((await t.api.patch(`/api/vulnerabilities/${d.id}`, { system_id: sys.id })).body.owner_id).toBe(tech.userId);
    expect((await t.api.patch(`/api/vulnerabilities/${d.id}`, { system_id: bizOnly.id })).body.owner_id).toBe(tech.userId);
    // A disabled person is not given findings.
    await t.db.query(`update users set status = 'disabled' where id = $1`, [tech.userId]);
    const e = (await t.api.post('/api/vulnerabilities', { title: 'Invented expired certificate', severity: 'medium', system_id: sys.id })).body;
    expect(e.owner_id).toBe(biz.userId);
    if (t.ctx.resources.get('asset')) {
      const asset = (await t.api.post('/api/assets', { name: 'Invented yard switch', owner_id: keeper.userId, system_id: bizOnly.id })).body;
      const f = (await t.api.post('/api/vulnerabilities', { title: 'Invented switch firmware', severity: 'high', asset_id: asset.id })).body;
      expect(f).toMatchObject({ owner_id: keeper.userId, system_id: bizOnly.id });
    }
  });
});
