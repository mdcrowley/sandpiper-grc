import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';
import { seedVendors } from '../vendors/seed.ts';
import { seedContinuity } from './seed.ts';

// The invented continuity samples (E31-09): ten processes with two gaps by construction, three plans
// in three states, and one closed activation with an after-action plan.
let t: Awaited<ReturnType<typeof testApp>>;
const dev = { profile: 'dev' as const, seedDir: 'none', organization: {} };

beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

describe('sample continuity records', () => {
  it('are dev-only, invented, labeled and complete on a second run', async () => {
    expect(await seedContinuity(t.ctx, { ...dev, profile: 'pilot' })).toMatch(/dev profile only/);
    expect(await seedContinuity(t.ctx, dev)).toMatch(/^10 sample business processes/);
    const processes = (await t.api.get('/api/business-processes?pageSize=100')).body.rows as Row[];
    expect(processes).toHaveLength(10);
    expect(processes.every((p) => p.name.startsWith('[Sample] '))).toBe(true);

    const summary = (await t.api.get('/api/continuity/summary')).body;
    expect(summary).toMatchObject({ processes: 10, with_gap: 2, plans: { total: 3, review_overdue: 1 }, activations: { active: 0 } });
    const gaps = (await t.api.get('/api/continuity/gaps')).body.rows as Row[];
    expect(gaps.filter((g) => g.gap).map((g) => g.name).sort()).toEqual(['[Sample] Fare collection', '[Sample] Payroll']);
    // Paratransit scheduling reaches its systems through the Dial-a-Ride service.
    expect(gaps.find((g) => g.name === '[Sample] Paratransit scheduling')?.systems.some((s: Row) => s.via)).toBe(true);

    const plans = (await t.api.get('/api/continuity-plans?pageSize=10')).body.rows as Row[];
    expect(plans.map((p) => p.status).sort()).toEqual(['approved', 'approved', 'in_review']);
    const tree = (await t.api.get(`/api/continuity-plans/${plans[0].id}/call-tree`)).body as Row[];
    expect(tree.length).toBe(8);
    expect(tree.every((n) => n.name)).toBe(true);

    const [activation] = (await t.api.get('/api/emergency-activations')).body.rows as Row[];
    expect(activation).toMatchObject({ status: 'closed', event_type: 'severe_weather' });
    expect(((await t.api.get(`/api/emergency-activations/${activation.id}/log`)).body as Row[]).length).toBeGreaterThan(5);
    expect((await t.api.get(`/api/caps?f.source_id=${activation.id}`)).body.rows).toHaveLength(1);
    expect((await t.api.get('/api/bias?pageSize=20')).body.rows).toHaveLength(6);

    // Vendors seed after this module: a second run links them.
    const linked = async () => (await t.db.query(`select 1 from process_dependencies where dep_type = 'vendor'`)).length;
    expect(await linked()).toBe(0);
    await seedVendors(t.ctx, dev);
    expect(await seedContinuity(t.ctx, dev)).toMatch(/already loaded; \d+ more dependencies linked/);
    expect(await linked()).toBeGreaterThan(0);
    expect((await t.api.get('/api/business-processes?pageSize=100')).body.rows).toHaveLength(10);
  });
});
