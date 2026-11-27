import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayInZone } from '../../core/timezone.ts';
import { DEFAULT_ROLES } from '../../core/services.ts';
import { testApp } from '../../test/helpers.ts';
import { makeScales } from './scales.ts';

// E45-01: enterprise risk stands on its own, apart from security incidents: permissions, restriction
// per risk, the enterprise scale and fields per category, the target risk, and appetite versions.
// All data here is invented.

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let viewer: Client; // risks.view only
let secOnly: Client; // security.view only
let manager: Client; // the Risk manager role
let exec: Client; // the Executive viewer role

async function roleWith(key: string, grants: string[]): Promise<Client> {
  const role = await t.db.one<{ id: string }>(`insert into roles (key, name, enabled) values ($1, $1, true) returning id`, [key]);
  for (const g of grants) await t.db.query('insert into role_permissions (role_id, permission) values ($1,$2)', [role!.id, g]);
  return t.as(key);
}

const ok = { approved_on: dayInZone(-2), approved_by_name: 'Invented board chair', approval_body: 'Invented board of directors' };

beforeAll(async () => {
  t = await testApp();
  viewer = await roleWith('risk_view_only', ['risks.view']);
  secOnly = await roleWith('security_view_only', ['security.view']);
  manager = await t.as('risk_manager');
  exec = await t.as('executive_viewer');
});
afterAll(async () => { await t.close(); });

describe('permissions apart from security incidents', () => {
  it('lets risks.view alone see enterprise risks but not restricted (cyber) risks or security incidents', async () => {
    const ent = (await t.api.post('/api/risks', { title: 'Invented fare revenue shortfall', category: 'enterprise', inherent_likelihood: 3, inherent_impact: 4 })).body;
    const cyber = (await t.api.post('/api/risks', { title: 'Invented ransomware on dispatch', category: 'cyber', inherent_likelihood: 4, inherent_impact: 5 })).body;
    expect([ent.restricted, cyber.restricted]).toEqual([false, true]);
    expect(ent.scale_key).toBe('enterprise_5x5');
    expect(cyber.scale_key).toBe('cyber_5x5');

    const list = (await viewer.get('/api/risks?pageSize=500')).body.rows.map((r: any) => r.id);
    expect(list).toContain(ent.id);
    expect(list).not.toContain(cyber.id);
    expect((await viewer.get(`/api/risks/${ent.id}`)).status).toBe(200);
    expect((await viewer.get(`/api/risks/${cyber.id}`)).status).toBe(404);
    expect((await viewer.get('/api/meta')).body.resources.risk).toBeDefined();
    // Security incidents are not part of it.
    if (t.ctx.resources.get('security_incident')) {
      expect((await viewer.get('/api/security-incidents')).status).toBe(403);
    }

    // And the other way round: security.view alone opens no risk.
    expect((await secOnly.get('/api/risks')).status).toBe(403);
    expect((await secOnly.get('/api/risks/heatmap')).status).toBe(403);
    expect((await secOnly.get('/api/risks/appetite')).status).toBe(403);
    if (t.ctx.resources.get('security_incident')) {
      expect((await secOnly.get('/api/security-incidents')).status).toBe(200);
    }

    // Figures are the same for everyone; the restricted risk is masked, never left out.
    const mine = (await viewer.get('/api/risks/summary')).body;
    const admin = (await t.api.get('/api/risks/summary')).body;
    expect(mine.total).toBe(admin.total);
    expect(mine.levels).toEqual(admin.levels);
    const top = mine.top.find((r: any) => r.id === cyber.id);
    expect(top).toMatchObject({ title: 'Restricted risk', ref: null, masked: true });
    expect(mine.top.find((r: any) => r.id === ent.id)).toMatchObject({ title: 'Invented fare revenue shortfall', masked: false });
    const heat = (await viewer.get('/api/risks/heatmap/common?basis=inherent')).body;
    expect(heat.total).toBe((await t.api.get('/api/risks/heatmap/common?basis=inherent')).body.total);
    expect(heat.risks.find((r: any) => r.id === cyber.id)).toMatchObject({ title: 'Restricted risk', masked: true });
    const report = (await viewer.get('/api/risks/report')).body;
    expect(report.total).toBe((await t.api.get('/api/risks/report')).body.total);
    expect(report.top.find((r: any) => r.id === cyber.id)).toMatchObject({ title: 'Restricted risk', owner_name: null });
    for (const r of [ent, cyber]) await t.api.del(`/api/risks/${r.id}`);
  });

  it('ships a Risk manager role (switched off) and lets the Executive viewer read the register, heat map and appetite', async () => {
    const def = DEFAULT_ROLES.find((r) => r.key === 'risk_manager')!;
    expect(def).toMatchObject({ name: 'Risk manager', enabled: false });
    expect(def.grants).toContain('risks.*');
    expect(def.grants.some((g) => g.startsWith('security'))).toBe(false);
    expect(DEFAULT_ROLES.find((r) => r.key === 'executive_viewer')!.grants).toContain('risks.view');

    for (const path of ['/api/risks/summary', '/api/risks/heatmap?scale=enterprise_5x5', '/api/risks/appetite', '/api/risks/appetite/versions', '/api/risks/report', '/api/risks/rollup']) {
      expect((await exec.get(path)).status, path).toBe(200);
    }
    expect((await exec.post('/api/risks', { title: 'Nope', category: 'enterprise' })).status).toBe(403);
    expect((await exec.put('/api/risks/appetite', { reason: 'x', categories: [] })).status).toBe(403);

    const made = await manager.post('/api/risks', { title: 'Invented grant funding shortfall', category: 'enterprise' });
    expect(made.status).toBe(201);
    expect((await manager.put('/api/risks/appetite', { categories: [] })).status).toBe(200);
    await t.api.del(`/api/risks/${made.body.id}`);
  });
});

describe('restriction per risk', () => {
  it('takes it from the category, lets only those who see restricted records change it, and keeps indicators in step', async () => {
    // Without security.view nobody adds a risk they could not then see, or changes the flag.
    const refused = await viewer.post('/api/risks', { title: 'Invented phishing risk', category: 'cyber' });
    expect(refused.status).toBe(403); // risks.view only: no create at all
    const refusedCyber = await manager.post('/api/risks', { title: 'Invented phishing risk', category: 'cyber' });
    expect(refusedCyber.status).toBe(400);
    expect(refusedCyber.body.error.fields.category).toMatch(/restricted/);
    const ent = (await manager.post('/api/risks', { title: 'Invented depot lease risk', category: 'enterprise' })).body;
    expect((await manager.patch(`/api/risks/${ent.id}`, { restricted: true })).body.error.fields.restricted).toBeDefined();

    // Someone who sees restricted records may restrict it; an indicator on it follows.
    const kri = (await manager.post('/api/kris', { name: 'Invented lease renewals overdue', risk_id: ent.id, amber: 1, red: 3 })).body;
    expect(kri.restricted).toBe(false);
    expect((await t.api.patch(`/api/risks/${ent.id}`, { restricted: true })).body.restricted).toBe(true);
    expect((await t.api.get(`/api/kris/${kri.id}`)).body.restricted).toBe(true);
    expect((await manager.get(`/api/kris/${kri.id}`)).status).toBe(404);
    expect((await manager.get(`/api/risks/${ent.id}`)).status).toBe(404);
    await t.api.patch(`/api/risks/${ent.id}`, { restricted: false });
    expect((await manager.get(`/api/kris/${kri.id}`)).status).toBe(200);
    await t.api.del(`/api/kris/${kri.id}`);
    await t.api.del(`/api/risks/${ent.id}`);
  });

  it('shows the category\'s own fields only for it (cybersecurity: affected systems and data)', async () => {
    const cats = (await t.api.get('/api/lookups/risk_category')).body;
    expect(cats.find((c: any) => c.value === 'cyber').meta).toMatchObject({ restricted: true, fields: ['affected'] });
    expect(cats.find((c: any) => c.value === 'enterprise').meta).toMatchObject({ scale: 'enterprise_5x5' });
    expect(cats.find((c: any) => c.value === 'enterprise').meta.fields).toBeUndefined();
  });
});

describe('target risk', () => {
  it('scores the target on the risk\'s scale and shows it on the heat map, summary and report', async () => {
    expect((await t.api.post('/api/risks', { title: 'Bad target', category: 'enterprise', target_likelihood: 9, target_impact: 1 })).status).toBe(400);
    expect((await t.api.post('/api/risks', { title: 'Half target', category: 'enterprise', target_likelihood: 2 })).body.error.fields.target_impact).toBeDefined();
    expect((await t.api.post('/api/risks', { title: 'Date only', category: 'enterprise', target_on: dayInZone(90) })).body.error.fields.target_on).toBeDefined();

    const risk = (await t.api.post('/api/risks', {
      title: 'Invented bus operator shortage', category: 'enterprise',
      inherent_likelihood: 5, inherent_impact: 4, residual_likelihood: 4, residual_impact: 4, target_likelihood: 2, target_impact: 3, target_on: dayInZone(180),
    })).body;
    expect(risk).toMatchObject({ inherent_rating: 'extreme', residual_rating: 'high', target_rating: 'medium' });
    expect(risk.target_score).toBeLessThan(risk.residual_score);

    const heat = (await t.api.get('/api/risks/heatmap?scale=enterprise_5x5&basis=target')).body;
    expect(heat.basis).toBe('target');
    expect(heat.cells.find((c: any) => c.likelihood === 2 && c.impact === 3).risk_ids).toContain(risk.id);
    expect(heat.movements).toContainEqual({ from: { likelihood: 4, impact: 4 }, to: { likelihood: 2, impact: 3 }, count: 1, risk_ids: [risk.id] });
    expect(heat.risks.find((r: any) => r.id === risk.id).target).toMatchObject({ likelihood: 2, impact: 3, rating: 'medium', on: dayInZone(180) });

    const summary = (await t.api.get('/api/risks/summary')).body;
    expect(summary.with_target).toBeGreaterThanOrEqual(1);
    expect(summary.above_target).toBeGreaterThanOrEqual(1);
    const row = (await t.api.get('/api/risks/report')).body.top.find((r: any) => r.id === risk.id);
    expect(row).toMatchObject({ inherent_label: 'Extreme', residual_label: 'High', target_label: 'Medium', above_target: true, target_on: dayInZone(180) });

    // Re-rating the scale re-rates the target too.
    const scale = (await t.api.get('/api/risks/scales/enterprise_5x5')).body;
    await t.api.patch('/api/risks/scales/enterprise_5x5', { matrix: { ...scale.matrix, '2': { ...scale.matrix['2'], '3': 'low' } } });
    expect((await t.api.get(`/api/risks/${risk.id}`)).body.target_rating).toBe('low');
    await t.api.patch('/api/risks/scales/enterprise_5x5', { matrix: scale.matrix });
    // A level a target is scored on cannot be removed.
    const removed = await t.api.patch('/api/risks/scales/enterprise_5x5', { likelihood_levels: scale.likelihood_levels.filter((l: any) => l.value !== 2) });
    expect(removed.status).toBe(400);
    await t.api.del(`/api/risks/${risk.id}`);
  });
});

describe('appetite versions', () => {
  it('records each change as a version with its approval, who recorded it and why, and keeps the earlier ones', async () => {
    const first = await manager.put('/api/risks/appetite', { categories: [{ category: 'compliance', statement: 'Invented: no tolerance for missed filings.', max_rating: 'medium' }] });
    expect(first.status).toBe(400);
    expect(Object.keys(first.body.error.fields).sort()).toEqual(['categories.0.approval_body', 'categories.0.approved_by_name', 'categories.0.approved_on', 'reason']);
    const future = await manager.put('/api/risks/appetite', { reason: 'x', categories: [{ category: 'compliance', max_rating: 'medium', ...ok, approved_on: dayInZone(5) }] });
    expect(future.body.error.fields['categories.0.approved_on']).toMatch(/future/);

    const v1 = await manager.put('/api/risks/appetite', { reason: 'Annual appetite review', categories: [{ category: 'compliance', statement: 'Invented: no tolerance for missed filings.', max_rating: 'medium', ...ok, reference: 'Invented resolution 1' }] });
    expect(v1.status).toBe(200);
    const c1 = v1.body.categories.find((c: any) => c.category === 'compliance');
    const base = c1.version;
    expect(c1).toMatchObject({ max_rating: 'medium', approval_body: 'Invented board of directors', reason: 'Annual appetite review', changed_by_name: expect.stringContaining('risk_manager') });

    // Saving the same thing again is no new version.
    const same = await manager.put('/api/risks/appetite', { categories: [{ category: 'compliance', statement: 'Invented: no tolerance for missed filings.', max_rating: 'medium', ...ok, reference: 'Invented resolution 1' }] });
    expect(same.status).toBe(200);
    expect(same.body.categories.find((c: any) => c.category === 'compliance').version).toBe(base);

    const v2 = await manager.put('/api/risks/appetite', { reason: 'Committee loosened it after the new filing system', categories: [{ category: 'compliance', statement: 'Invented: low tolerance.', max_rating: 'high', ...ok, approval_body: 'Invented risk committee' }] });
    expect(v2.body.categories.find((c: any) => c.category === 'compliance')).toMatchObject({ version: base + 1, max_rating: 'high', versions: base + 1 });

    const versions = (await exec.get('/api/risks/appetite/versions?category=compliance')).body;
    expect(versions.map((v: any) => v.version).slice(0, 2)).toEqual([base + 1, base]);
    expect(versions[0]).toMatchObject({ approval_body: 'Invented risk committee', reason: 'Committee loosened it after the new filing system', category_label: 'Compliance', removed: false });
    expect(versions[1]).toMatchObject({ max_rating: 'medium', reference: 'Invented resolution 1', recorded_by_name: expect.stringContaining('risk_manager') });

    // Removing it is a version too, and needs a reason.
    expect((await manager.put('/api/risks/appetite', { categories: [{ category: 'compliance' }] })).body.error.fields.reason).toBeDefined();
    await manager.put('/api/risks/appetite', { reason: 'Withdrawn pending a new policy', categories: [{ category: 'compliance' }] });
    const after = (await t.api.get('/api/risks/appetite/versions?category=compliance')).body;
    expect(after[0]).toMatchObject({ version: base + 2, removed: true });
    expect((await t.api.get('/api/risks/appetite')).body.categories.find((c: any) => c.category === 'compliance').max_rating).toBeNull();
    expect((await t.db.query(`select 1 from audit_events where action = 'risk_appetite.update' and summary like '%Withdrawn pending%'`)).length).toBe(1);
    expect((await viewer.put('/api/risks/appetite', { reason: 'x', categories: [] })).status).toBe(403);
  });
});

describe('the enterprise scale on an earlier database', () => {
  it('copies the five-by-five scale, moves enterprise, compliance and third-party categories and their risks, once', async () => {
    // Undo the split as an earlier version would have it, with an edited cyber matrix.
    const cyber = (await t.api.get('/api/risks/scales/cyber_5x5')).body;
    const edited = { ...cyber.matrix, '1': { ...cyber.matrix['1'], '5': 'high' } };
    await t.api.patch('/api/risks/scales/cyber_5x5', { matrix: edited });
    const risk = (await t.api.post('/api/risks', { title: 'Invented vendor failure', category: 'third_party', inherent_likelihood: 1, inherent_impact: 5 })).body;
    await t.db.query(`update risks set scale_key = 'cyber_5x5' where scale_key = 'enterprise_5x5'`);
    await makeScales(t.ctx).rescore('cyber_5x5');
    expect((await t.api.get(`/api/risks/${risk.id}`)).body.inherent_rating).toBe('high');
    await t.db.query(`delete from risk_scales where key = 'enterprise_5x5'`);
    await t.db.query(`update lookups set meta = jsonb_build_object('scale', 'cyber_5x5') where list_key = 'risk_category' and value in ('enterprise', 'compliance', 'third_party', 'cyber')`);
    await t.db.query(`update risk_scales set name = 'Cyber and enterprise risk (5 by 5)' where key = 'cyber_5x5'`);

    await makeScales(t.ctx).seedDefaults();
    const moved = (await t.api.get(`/api/risks/${risk.id}`)).body;
    expect(moved).toMatchObject({ scale_key: 'enterprise_5x5', inherent_rating: 'high' }); // no change of rating: the copy keeps the edited matrix
    expect((await t.api.get('/api/risks/scales/enterprise_5x5')).body.matrix['1']['5']).toBe('high');
    expect((await t.api.get('/api/risks/scales/cyber_5x5')).body.name).toBe('Cybersecurity risk (5 by 5)');
    const cats = (await t.api.get('/api/lookups/risk_category')).body;
    expect(cats.find((c: any) => c.value === 'third_party').meta.scale).toBe('enterprise_5x5');
    expect(cats.find((c: any) => c.value === 'cyber').meta).toMatchObject({ scale: 'cyber_5x5', restricted: true, fields: ['affected'] });
    // Running again changes nothing.
    await makeScales(t.ctx).seedDefaults();
    expect((await t.db.query(`select 1 from risk_scales where key = 'enterprise_5x5'`)).length).toBe(1);
    await t.api.patch('/api/risks/scales/cyber_5x5', { matrix: cyber.matrix });
    await t.api.del(`/api/risks/${risk.id}`);
  });
});
