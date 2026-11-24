import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { commonStep } from './common-heatmap.ts';

// E41-17: one heat map of every risk scale at the common level. Invented data only.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

const five = [1, 2, 3, 4, 5].map((value) => ({ value, label: String(value) }));
const four = [1, 2, 3, 4].map((value) => ({ value, label: String(value) }));

describe('the common heat map', () => {
  it('spreads each scale from its lowest to its highest level', () => {
    expect(five.map((l) => commonStep(five, l.value))).toEqual([1, 2, 3, 4, 5]);
    expect(four.map((l) => commonStep(four, l.value))).toEqual([1, 2, 4, 5]);
    expect(commonStep([{ value: 7, label: 'Only' }], 7)).toBe(3);
    expect(commonStep(four, 9)).toBeNull();
    expect(commonStep(four, null)).toBeNull();
  });

  it('puts the risks of every scale on one grid, colored and counted at their common level', async () => {
    const cyber = (await t.api.post('/api/risks', { title: 'Invented cyber risk', category: 'cyber', inherent_likelihood: 4, inherent_impact: 5, residual_likelihood: 2, residual_impact: 3 })).body;
    const hazard = (await t.api.post('/api/risks', { title: 'Invented platform hazard', category: 'safety', inherent_likelihood: 5, inherent_impact: 4, residual_likelihood: 2, residual_impact: 4 })).body;
    expect(hazard.scale_key).toBe('hazard_4x5');
    await t.api.post('/api/risks', { title: 'Invented unscored risk', category: 'cyber' });

    const map = (await t.api.get('/api/risks/heatmap/common')).body;
    expect(map.scale.key).toBe('_common');
    expect(map.scale.ratings.map((r: any) => r.key)).toEqual(['low', 'medium', 'high', 'critical']);
    expect(map.scales.map((s: any) => s.key)).toEqual(['cyber_5x5', 'hazard_4x5']);
    expect(map.cells).toHaveLength(25);
    const at = (l: number, i: number) => map.cells.find((c: any) => c.likelihood === l && c.impact === i);
    // Residual: the cyber risk at (2, 3) medium; the hazard's severity 4 of 4 is step 5, rated Serious, which is High.
    expect(at(2, 3)).toMatchObject({ count: 1, rating: 'medium', risk_ids: [cyber.id] });
    expect(at(2, 5)).toMatchObject({ count: 1, rating: 'high', risk_ids: [hazard.id] });
    // An empty cell takes the worst common level any scale gives there: the top corner is critical.
    expect(at(5, 5)).toMatchObject({ count: 0, rating: 'critical' });
    expect(map.totals.find((x: any) => x.rating === 'high').count).toBe(1);
    expect(map.total).toBe(3);
    expect(map.unscored).toBe(1);
    expect(map.movements.length).toBe(2);
    const hazardRow = map.risks.find((r: any) => r.id === hazard.id);
    expect(hazardRow).toMatchObject({ likelihood: 2, impact: 5, scale_key: 'hazard_4x5', inherent: { likelihood: 5, impact: 5, rating: 'critical' }, residual: { rating: 'high' } });

    const inherent = (await t.api.get('/api/risks/heatmap/common?basis=inherent')).body;
    expect(inherent.cells.find((c: any) => c.likelihood === 5 && c.impact === 5)).toMatchObject({ count: 1, rating: 'critical' });
    expect(inherent.totals.find((x: any) => x.rating === 'critical').count).toBe(2);
  });

  it('needs the risks permission and security access, like the other heat map', async () => {
    expect((await (await t.as('agent')).get('/api/risks/heatmap/common')).status).toBe(403);
  });
});
