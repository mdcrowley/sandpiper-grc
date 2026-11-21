import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defineMetric } from '../../core/metrics.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { kriLevel, runKriCheck } from './enterprise.ts';

// Regulatory change (E30-04, E30-05), risk appetite (E30-06), key risk indicators (E30-07) and
// parent risks (E30-08). All data here is invented.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp({
    extraModules: [{
      key: 'zz_metric_stub',
      async register(ctx) {
        defineMetric(ctx.app, { key: 'stub.value', label: 'Stub value', unit: 'count', description: 'Always 9.', compute: async () => 9 });
      },
    }],
  });
});
afterAll(async () => { await t.close(); });

describe('regulatory changes', () => {
  it('numbers changes, needs an assessment to close, and makes linked obligations', async () => {
    const made = await t.api.post('/api/regulatory-changes', {
      title: 'Revised reporting rule for passenger injuries', issuer: 'Invented oversight body', citation: 'Rule 12.4 (invented)',
      published_on: dayInZone(-20), effective_on: dayInZone(60), summary: 'Injuries must be reported within 30 days.', impact_level: 'high',
    });
    expect(made.status).toBe(201);
    expect(made.body.ref).toMatch(/^REG-/);
    expect(made.body.status).toBe('identified');
    expect((await t.api.patch(`/api/regulatory-changes/${made.body.id}`, { status: 'implemented' })).status).toBe(400);
    expect((await t.api.post('/api/regulatory-changes', { title: 'Backwards', published_on: dayInZone(5), effective_on: dayInZone(1) })).status).toBe(400);

    const o = await t.api.post(`/api/regulatory-changes/${made.body.id}/obligation`, { type: 'law', frequency: 'yearly' });
    expect(o.status).toBe(201);
    expect(o.body).toMatchObject({ title: made.body.title, type: 'law', frequency: 'yearly', source: 'Rule 12.4 (invented), Invented oversight body' });
    expect(o.body.next_due_on.slice(0, 10)).toBe(dayInZone(60));

    const affected = await t.api.get(`/api/regulatory-changes/${made.body.id}/affected`);
    expect(affected.status).toBe(200);
    expect(affected.body).toEqual([expect.objectContaining({ type: 'obligation', id: o.body.id })]);
    // The generic Related panel shows the same link.
    const links = (await t.api.get(`/api/links?record_type=obligation&record_id=${o.body.id}`)).body;
    expect(links).toEqual([expect.objectContaining({ relation: 'affects', type: 'regulatory_change' })]);

    // Actions raised from a change carry its source.
    const a = await t.api.post('/api/actions', { title: 'Update the injury reporting form', source: 'regulatory_change', source_type: 'regulatory_change', source_id: made.body.id });
    expect(a.status).toBe(201);
    expect(a.body.source).toBe('regulatory_change');

    const viewer = await t.as('executive_viewer');
    expect((await viewer.post(`/api/regulatory-changes/${made.body.id}/obligation`, {})).status).toBe(403);
    expect((await t.api.post('/api/regulatory-changes/00000000-0000-0000-0000-000000000000/obligation', {})).status).toBe(404);
  });
});

describe('risk appetite', () => {
  it('flags risks above the appetite and keeps the flag in step', async () => {
    const risk = (await t.api.post('/api/risks', { title: 'Invented outage risk', category: 'cyber', residual_likelihood: 4, residual_impact: 4, inherent_likelihood: 5, inherent_impact: 5 })).body;
    expect(risk.appetite_breach).toBeNull();
    const before = (await t.api.get('/api/risks/appetite')).body;
    const cyber = before.categories.find((c: any) => c.category === 'cyber');
    expect(cyber.ratings.length).toBeGreaterThan(0);

    expect((await t.api.put('/api/risks/appetite', { categories: [{ category: 'cyber', max_rating: 'nonsense' }] })).status).toBe(400);
    expect((await t.api.put('/api/risks/appetite', { categories: [{ category: 'nope' }] })).status).toBe(400);
    expect((await t.api.put('/api/risks/appetite', { categories: [{ category: 'cyber', max_score: -1 }] })).status).toBe(400);
    const saved = await t.api.put('/api/risks/appetite', { categories: [{ category: 'cyber', statement: 'Low appetite for service outages.', max_rating: 'low', approved_by_name: 'Invented board', approved_on: dayInZone(-1) }] });
    expect(saved.status).toBe(200);
    const row = saved.body.categories.find((c: any) => c.category === 'cyber');
    expect(row).toMatchObject({ max_rating: 'low', statement: 'Low appetite for service outages.' });
    expect(row.breaches).toBeGreaterThanOrEqual(1);
    expect((await t.api.get(`/api/risks/${risk.id}`)).body.appetite_breach).toBe(true);

    // Lowering the residual rating ends the breach on save.
    const lowered = await t.api.patch(`/api/risks/${risk.id}`, { residual_likelihood: 1, residual_impact: 1 });
    expect(lowered.body.appetite_breach).toBe(false);

    // Removing the appetite clears the flag.
    await t.api.put('/api/risks/appetite', { categories: [{ category: 'cyber' }] });
    expect((await t.api.get(`/api/risks/${risk.id}`)).body.appetite_breach).toBeNull();
  });

  it('follows the risk restriction', async () => {
    // Risks permissions without security.view: nothing about risks, their appetite or their indicators.
    const role = await t.db.one<{ id: string }>(`insert into roles (key, name, description, enabled) values ('risks_nosec', 'risks_nosec', 'test', true) returning id`);
    for (const g of ['risks.*']) await t.db.query('insert into role_permissions (role_id, permission) values ($1,$2)', [role!.id, g]);
    const nosec = await t.as('risks_nosec');
    expect((await nosec.get('/api/risks/appetite')).status).toBe(403);
    expect((await nosec.put('/api/risks/appetite', { categories: [] })).status).toBe(403);
    expect((await nosec.get('/api/risks/rollup')).status).toBe(403);
    const list = await nosec.get('/api/kris');
    expect(list.status === 403 || list.body.total === 0).toBe(true);
  });
});

describe('parent risks', () => {
  it('rolls risks up under a parent, two levels deep', async () => {
    const parent = (await t.api.post('/api/risks', { title: 'Invented enterprise risk: loss of service', category: 'enterprise', residual_likelihood: 3, residual_impact: 3 })).body;
    const child = (await t.api.post('/api/risks', { title: 'Invented depot power failure', parent_id: parent.id, residual_likelihood: 4, residual_impact: 5 })).body;
    expect(child.parent_id).toBe(parent.id);
    expect((await t.api.patch(`/api/risks/${parent.id}`, { parent_id: parent.id })).status).toBe(400);
    expect((await t.api.post('/api/risks', { title: 'Grandchild', parent_id: child.id })).status).toBe(400);
    expect((await t.api.patch(`/api/risks/${parent.id}`, { parent_id: child.id })).status).toBe(400);

    const roll = await t.api.get('/api/risks/rollup');
    expect(roll.status).toBe(200);
    const p = roll.body.find((r: any) => r.id === parent.id);
    expect(p).toMatchObject({ children: 1, open_children: 1 });
    expect(p.worst.id).toBe(child.id);
  });
});

describe('key risk indicators', () => {
  it('works out the level from the thresholds', () => {
    expect(kriLevel({ amber: 5, red: 10 }, 4)).toBe('green');
    expect(kriLevel({ amber: 5, red: 10 }, 5)).toBe('amber');
    expect(kriLevel({ amber: 5, red: 10 }, 12)).toBe('red');
    expect(kriLevel({ direction: 'lower_is_worse', amber: 90, red: 80 }, 85)).toBe('amber');
    expect(kriLevel({ direction: 'lower_is_worse', amber: 90, red: 80 }, 70)).toBe('red');
    expect(kriLevel({ amber: null, red: null }, 70)).toBeNull();
  });

  it('takes manual values, and at red brings the review forward and tells the owner', async () => {
    const owner = await t.as('security_lead');
    const risk = (await t.api.post('/api/risks', { title: 'Invented phishing risk', owner_id: owner.userId, review_on: dayInZone(90) })).body;
    expect((await t.api.post('/api/kris', { name: 'Bad thresholds', amber: 10, red: 5 })).status).toBe(400);
    expect((await t.api.post('/api/kris', { name: 'Bad percent', unit: 'percent', red: 150 })).status).toBe(400);
    const kri = await t.api.post('/api/kris', { name: 'Phishing clicks per month', risk_id: risk.id, amber: 5, red: 10, unit: 'count' });
    expect(kri.status).toBe(201);
    expect(kri.body.ref).toMatch(/^KRI-/);

    const month = dayInZone(0).slice(0, 7);
    expect((await t.api.put(`/api/kris/${kri.body.id}/values/2099-01`, { value: 1 })).status).toBe(400);
    expect((await t.api.put(`/api/kris/${kri.body.id}/values/${month}`, { value: -1 })).status).toBe(400);
    expect((await t.api.put(`/api/kris/${kri.body.id}/values/${month}`, { value: 'x' })).status).toBe(400);
    const amber = await t.api.put(`/api/kris/${kri.body.id}/values/${month}`, { value: 6 });
    expect(amber.status).toBe(200);
    expect(amber.body).toMatchObject({ last_level: 'amber', last_value: 6 });
    expect((await t.api.get(`/api/risks/${risk.id}`)).body.review_on.slice(0, 10)).toBe(dayInZone(90));

    const red = await t.api.put(`/api/kris/${kri.body.id}/values/${month}`, { value: 12, note: 'Campaign week' });
    expect(red.body.last_level).toBe('red');
    expect((await t.api.get(`/api/risks/${risk.id}`)).body.review_on.slice(0, 10)).toBe(dayInZone(0));
    if (t.app.hasDecorator('notify')) {
      expect((await t.db.query(`select 1 from notifications where user_id = $1 and title like 'Key risk indicator at red%'`, [owner.userId])).length).toBe(1);
    }
    const values = (await t.api.get(`/api/kris/${kri.body.id}/values`)).body;
    expect(values.values[0]).toMatchObject({ period: month, value: 12, level: 'red', note: 'Campaign week' });

    // A person without security.view sees nothing of indicators.
    const officer = await t.as('compliance_officer');
    expect((await officer.get(`/api/kris/${kri.body.id}/values`)).status).toBe(403);
  });

  it('fills computed indicators from a metric every day', async () => {
    expect((await t.api.post('/api/kris', { name: 'Unknown metric', metric_key: 'nope.nothing' })).status).toBe(400);
    const kri = (await t.api.post('/api/kris', { name: 'Stub metric indicator', metric_key: 'stub.value', amber: 5, red: 20 })).body;
    expect(kri.unit).toBe('count');
    expect((await t.api.put(`/api/kris/${kri.id}/values/${dayInZone(0).slice(0, 7)}`, { value: 1 })).status).toBe(409);
    const run = await runKriCheck(t.ctx);
    expect(run.computed).toBeGreaterThanOrEqual(2);
    const after = (await t.api.get(`/api/kris/${kri.id}`)).body;
    expect(after).toMatchObject({ last_value: 9, last_level: 'amber' });
    expect(await t.db.one(`select every_seconds from job_schedules where name = 'risks.kri_check'`)).toEqual({ every_seconds: 86400 });
  });
});

describe('compliance samples', () => {
  it('seeds invented periods, changes, appetite, indicators and parent risks once (dev profile)', async () => {
    const { seedCompliance } = await import('./seed-compliance.ts');
    const { seedRisksModule } = await import('./seed.ts');
    const opts = { profile: 'dev' as const, seedDir: 'none', organization: {} };
    const first = await seedRisksModule(t.ctx, opts);
    expect(first).toMatch(/8 recurring obligations added with \d+ attested periods, 3 regulatory changes, appetite for 5 categories, 2 parent risks, \d+ key risk indicators/);
    expect(await seedCompliance(t.ctx, opts)).toBeNull();
    expect(await seedCompliance(t.ctx, { ...opts, profile: 'pilot' })).toBeNull();
    const typed = (await t.api.get('/api/obligations?f.frequency.null=false')).body.total;
    expect(typed).toBeGreaterThanOrEqual(12);
    const roll = (await t.api.get('/api/risks/rollup')).body;
    expect(roll.filter((r: any) => r.title.startsWith('[Sample]')).length).toBe(2);
    expect((await t.api.get('/api/kris?q=Sample')).body.total).toBeGreaterThanOrEqual(3);
    const breaches = (await t.api.get('/api/risks?f.appetite_breach=true')).body.total;
    expect(breaches).toBeGreaterThan(0);
  });
});

describe('heat map appetite line', () => {
  it('outlines the cells above the strictest appetite on the scale', async () => {
    const clear = (await t.api.get('/api/risks/appetite')).body.categories.map((c: any) => ({ category: c.category }));
    await t.api.put('/api/risks/appetite', { categories: [...clear, { category: 'cyber', max_rating: 'medium' }, { category: 'enterprise', max_rating: 'high' }] });
    const heat = (await t.api.get('/api/risks/heatmap?scale=cyber_5x5')).body;
    expect(heat.appetite).toMatchObject({ rating: 'medium' });
    expect(heat.appetite.categories).toEqual(['Cybersecurity']);
    expect(heat.cells.find((c: any) => c.rating === 'extreme').above_appetite).toBe(true);
    expect(heat.cells.find((c: any) => c.rating === 'low').above_appetite).toBe(false);
    await t.api.put('/api/risks/appetite', { categories: clear });
    expect((await t.api.get('/api/risks/heatmap?scale=cyber_5x5')).body.appetite).toBeNull();
  });
});
