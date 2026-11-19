import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// E10-17: exercise step outcomes as findings and on the exercise calendar. Invented data.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

describe('exercise step outcomes (E10-17)', () => {
  it('raise a finding in one action from a step not done or done with issues', async () => {
    const ex = (await t.api.post('/api/exercises', { title: 'Depot ransomware tabletop', type: 'tabletop', status: 'completed', exercise_date: '2030-04-02' })).body;
    const step = async (text: string, outcome: string | null, notes?: string) =>
      (await t.api.post(`/api/exercises/${ex.id}/steps`, { step: text, outcome, notes })).body;
    const missed = await step('Call the insurer', 'not_done', 'Nobody had the number.');
    const rough = await step('Isolate the depot network', 'with_issues');
    const fine = await step('Brief the operations desk', 'went_well');
    await step('Restore the scheduling server', null);

    const raised = await t.api.post(`/api/exercises/${ex.id}/steps/${missed.id}/finding`, { recommendation: 'Keep the insurer number in the incident binder.' });
    expect(raised.status).toBe(201);
    expect(raised.body).toMatchObject({ severity: 'high', step_id: missed.id, recommendation: 'Keep the insurer number in the incident binder.' });
    expect(raised.body.finding).toContain('Call the insurer');
    expect(raised.body.finding).toContain('Nobody had the number.');
    expect((await t.api.post(`/api/exercises/${ex.id}/steps/${missed.id}/finding`, {})).body.error.code).toBe('already_raised');
    expect((await t.api.post(`/api/exercises/${ex.id}/steps/${rough.id}/finding`, {})).body.severity).toBe('medium');
    expect((await t.api.post(`/api/exercises/${ex.id}/steps/${fine.id}/finding`, {})).body.error.code).toBe('not_a_gap');
    expect((await t.api.post(`/api/exercises/${ex.id}/steps/${rough.id}/finding`, { severity: 'nope' })).status).toBe(409);

    const steps = (await t.api.get(`/api/exercises/${ex.id}/steps`)).body.steps;
    expect(steps.find((s: any) => s.id === missed.id).finding_id).toBe(raised.body.id);
    expect(steps.find((s: any) => s.id === fine.id).finding_id).toBeNull();
    const findings = (await t.api.get(`/api/exercises/${ex.id}/findings`)).body.findings;
    expect(findings.map((f: any) => f.step_id)).toEqual(expect.arrayContaining([missed.id, rough.id]));
    expect((await t.api.get(`/api/history?record_type=exercise&record_id=${ex.id}`)).body.some((h: any) => h.summary.includes('from a step recorded as "Not done"'))).toBe(true);

    const viewer = await t.as('agent');
    expect((await viewer.post(`/api/exercises/${ex.id}/steps/${rough.id}/finding`, {})).status).toBe(403);
  });

  it('show on the calendar how the steps of the latest run of each kind went', async () => {
    const cal = (await t.api.get('/api/exercises/calendar')).body;
    const tabletop = cal.by_type.find((b: any) => b.type === 'tabletop');
    expect(tabletop.last_steps).toEqual({ total: 4, went_well: 1, with_issues: 1, not_done: 1, not_tested: 0, unrecorded: 1 });
    expect(cal.by_type.filter((b: any) => b.type !== 'tabletop').every((b: any) => b.last_steps === null)).toBe(true);
  });
});
