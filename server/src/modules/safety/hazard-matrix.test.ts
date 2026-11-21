import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// E20-15: the hazard matrix is kept with the risk scales, stays in use while "Risks and obligations"
// is switched off, and can be changed from the Safety side then (level names and cell ratings).
// All data is invented. Needs safety and risks: GRC_MODULES=safety,risks,notifications (or all).

let t: Awaited<ReturnType<typeof testApp>>;
const setFeatures = (features: Record<string, boolean>) => t.api.patch('/api/admin/features', { features });

beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

describe('the hazard matrix while risks are switched off', () => {
  it('keeps scoring hazards, and lets a safety administrator change the matrix without the risk scale routes', async () => {
    const hazard = (await t.api.post('/api/hazards', { title: 'Wet platform edge at the north stop', likelihood: 3, severity: 3, residual_likelihood: 2, residual_severity: 2 })).body;
    expect([hazard.rating, hazard.residual_rating]).toEqual(['serious', 'medium']);
    const risk = (await t.api.post('/api/risks', { title: 'Door controller fails locked', category: 'safety', inherent_likelihood: 3, inherent_impact: 3 })).body;
    expect(risk.scale_key).toBe('hazard_4x5');
    expect(risk.inherent_rating).toBe('serious');
    const original = (await t.api.get('/api/safety/scale')).body;

    expect((await setFeatures({ risks: false })).status).toBe(200);
    try {
      expect((await t.api.get('/api/risks/scales/hazard_4x5')).status).toBe(404);
      // Hazards are still rated on the saved matrix.
      expect((await t.api.get('/api/safety/scale')).body.key).toBe('hazard_4x5');
      const made = await t.api.post('/api/hazards', { title: 'Loose handrail on the depot stairs', likelihood: 3, severity: 3 });
      expect(made.body.rating).toBe('serious');

      // Only a safety administrator may change it.
      const manager = await t.as('safety_manager');
      const viewer = await t.as('agent');
      const matrix = { ...original.matrix, 3: { ...original.matrix['3'], 3: 'high' } };
      expect((await viewer.patch('/api/safety/scale', { matrix })).status).toBe(403);
      // The levels' values and the rest of the scale stay as they are.
      const fewer = await manager.patch('/api/safety/scale', { likelihood_levels: original.likelihood_levels.slice(1) });
      expect(fewer.body.error.fields.likelihood_levels).toMatch(/same likelihood levels/);
      expect((await manager.patch('/api/safety/scale', { acceptance_threshold: 'high' })).body.error.fields.acceptance_threshold).toMatch(/cannot be changed here/);
      expect((await manager.patch('/api/safety/scale', { matrix: { ...matrix, 3: { ...matrix['3'], 3: 'nonsense' } } })).body.error.fields.matrix).toBeDefined();

      const impact = original.impact_levels.map((l: any) => (l.value === 4 ? { ...l, label: 'Catastrophic (loss of life)' } : l));
      const res = await manager.patch('/api/safety/scale', { matrix, impact_levels: impact });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.rerated).toBe(2); // both hazards rated Occasional by Critical
      expect(res.body.scale.impact_levels.find((l: any) => l.value === 4).label).toBe('Catastrophic (loss of life)');
      expect((await t.api.get(`/api/hazards/${hazard.id}`)).body.rating).toBe('high');
      expect((await t.api.get(`/api/hazards/${hazard.id}`)).body.residual_rating).toBe('medium');
      const audit = await t.db.one<{ summary: string }>(`select summary from audit_events where action = 'risk_scale.update' order by id desc limit 1`);
      expect(audit!.summary).toMatch(/Hazard matrix changed from Safety.*2 hazards re-rated/);
    } finally {
      expect((await setFeatures({ risks: true })).status).toBe(200);
    }
    // The risk scored on the same matrix follows it too.
    expect((await t.api.get(`/api/risks/${risk.id}`)).body.inherent_rating).toBe('high');
    const back = await t.api.patch('/api/safety/scale', { matrix: original.matrix, impact_levels: original.impact_levels });
    expect(back.status).toBe(200);
    expect((await t.api.get(`/api/risks/${risk.id}`)).body.inherent_rating).toBe('serious');
  });
});

describe('the hazard matrix saved from Risk scales (BS-4)', () => {
  it('re-rates the hazards as well as the risks', async () => {
    const hazard = (await t.api.post('/api/hazards', { title: 'Uneven yard surface by the wash bay', likelihood: 5, severity: 4, residual_likelihood: 5, residual_severity: 4 })).body;
    const before = hazard.rating;
    expect(before).toBeTruthy();
    const original = (await t.api.get('/api/risks/scales/hazard_4x5')).body;
    const lowest = original.ratings[0].key;
    expect(lowest).not.toBe(before);
    const matrix = { ...original.matrix, 5: { ...original.matrix['5'], 4: lowest } };
    const res = await t.api.patch('/api/risks/scales/hazard_4x5', { matrix });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    try {
      const now = (await t.api.get(`/api/hazards/${hazard.id}`)).body;
      expect([now.rating, now.residual_rating]).toEqual([lowest, lowest]);
      expect(now.score).toBeLessThan(hazard.score);
    } finally {
      expect((await t.api.patch('/api/risks/scales/hazard_4x5', { matrix: original.matrix })).status).toBe(200);
    }
    expect((await t.api.get(`/api/hazards/${hazard.id}`)).body.rating).toBe(before);
  });
});
