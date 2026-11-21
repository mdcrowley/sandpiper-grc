import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { DEFAULT_QUESTIONNAIRE, safetyImpactOf } from './rules.ts';

// E25-11: a change that affects safety needs a hazard linked as its safety assessment before it is
// submitted, scheduled or started. Everything here is invented. Needs changes and safety (with risks
// for the hazard matrix): GRC_MODULES=changes,safety,risks,notifications,workflows (or all).

const loaded = !process.env.GRC_MODULES || ['changes', 'safety', 'risks'].every((m) => process.env.GRC_MODULES!.split(',').includes(m));
const LOW = { people_affected: 'few', downtime: 'none', back_out: 'quick', experience: 'routine', testing: 'full' };
const SAFETY_Q = {
  key: 'safety', label: 'Could this change affect passenger or staff safety?', weight: 0, meta: { safety_impact: true },
  options: [{ value: 'no', label: 'No', score: 0 }, { value: 'yes', label: 'Yes', score: 1 }],
};

describe('safetyImpactOf', () => {
  it('reads the safety questions only', () => {
    const q = { ...DEFAULT_QUESTIONNAIRE, questions: [...DEFAULT_QUESTIONNAIRE.questions, SAFETY_Q] };
    expect(safetyImpactOf({ ...LOW, safety: 'yes' }, q)).toBe(true);
    expect(safetyImpactOf({ ...LOW, safety: 'no' }, q)).toBe(false);
    expect(safetyImpactOf(LOW, q)).toBeNull();
    expect(safetyImpactOf({ safety: 'yes' }, DEFAULT_QUESTIONNAIRE)).toBeNull();
  });
});

describe.runIf(loaded)('safety assessment on changes', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  beforeAll(async () => { t = await testApp(); }, 60_000);
  afterAll(async () => { await t?.close(); });

  it('keeps the safety question flag in the questionnaire and sets the change from it', async () => {
    const settings = (await t.api.get('/api/changes/settings')).body;
    const questionnaire = { ...settings.questionnaire, questions: [...settings.questionnaire.questions, SAFETY_Q] };
    const saved = await t.api.patch('/api/changes/settings', { questionnaire });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const after = (await t.api.get('/api/changes/settings')).body.questionnaire.questions.find((q: any) => q.key === 'safety');
    expect(after.meta).toEqual({ safety_impact: true });

    const day = '2031-03-04';
    const change = (await t.api.post('/api/changes', {
      title: 'Test new tram stop layout', description: 'Move the stop.', reason: 'Invented.', implementation_plan: 'Build.', test_plan: 'Walk it.',
      backout_plan: 'Restore.', risk_answers: { ...LOW, safety: 'yes' }, planned_start: `${day}T18:00:00.000Z`, planned_end: `${day}T20:00:00.000Z`,
    })).body;
    expect(change.safety_impact).toBe(true);

    let state = (await t.api.get(`/api/changes/${change.id}/safety-assessment`)).body;
    expect(state).toMatchObject({ available: true, safety_impact: true, required: true, count: 0 });
    const refused = await t.api.post(`/api/changes/${change.id}/transition`, { to: 'submitted' });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('safety_assessment_missing');

    // "Create hazard from this change": source change, linked as the assessment.
    expect((await t.api.post(`/api/changes/${change.id}/safety-assessment`, {})).body.error.fields.title).toBeDefined();
    const made = await t.api.post(`/api/changes/${change.id}/safety-assessment`, { title: 'Test passengers crossing at the moved stop' });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body).toMatchObject({ required: false, count: 1 });
    const hazard = (await t.api.get(`/api/hazards/${made.body.hazards[0].id}`)).body;
    expect(hazard.source).toBe('change');
    const links = (await t.api.get(`/api/links?record_type=change&record_id=${change.id}`)).body;
    expect(JSON.stringify(links)).toContain('safety_assessment');

    expect((await t.api.post(`/api/changes/${change.id}/transition`, { to: 'submitted' })).status).toBe(200);
    // The safety flag is part of the assessment: fixed once submitted.
    expect((await t.api.patch(`/api/changes/${change.id}`, { safety_impact: false })).status).toBe(409);

    // Unlinking leaves nothing: scheduling is refused again.
    state = (await t.api.del(`/api/changes/${change.id}/safety-assessment/${hazard.id}`)).body;
    expect(state.required).toBe(true);
  });

  it('lists the hazards only to people who may see the hazard log', async () => {
    const day = '2031-03-05';
    const change = (await t.api.post('/api/changes', { title: 'Test depot ramp', safety_impact: true, planned_start: `${day}T18:00:00.000Z`, planned_end: `${day}T20:00:00.000Z` })).body;
    expect(change.safety_impact).toBe(true);
    await t.api.post(`/api/changes/${change.id}/safety-assessment`, { title: 'Test ramp hazard' });
    const changeOnly = await t.as('agent');
    const state = await changeOnly.get(`/api/changes/${change.id}/safety-assessment`);
    if (state.status === 200) expect(state.body).toMatchObject({ count: 1, hazards: [] });
    expect((await changeOnly.post(`/api/changes/${change.id}/safety-assessment`, { title: 'x' })).status).toBe(403);
  });
});
