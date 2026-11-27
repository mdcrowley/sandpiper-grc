import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { dayInZone } from '../../core/timezone.ts';
import { metricsAvailable } from '../../core/metrics.ts';

// E45-44: the change success rate (a figure). Invented changes; the outcome is written directly, as the
// completion workflow would.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(async () => { await t?.close(); });

async function finished(title: string, outcome: string, endDay: string) {
  const made = await t.api.post('/api/changes', { title });
  expect(made.status).toBe(201);
  await t.db.query(`update changes set outcome = $2, status = 'closed', actual_end = ($3::date + time '10:00') where id = $1`, [made.body.id, outcome, endDay]);
  return made.body.id as string;
}

describe('change success rate', () => {
  it('counts finished changes, leaves canceled ones out and treats failed and backed out as unsuccessful', async () => {
    await finished('Patch the depot file server', 'successful', dayInZone(-3));
    await finished('Upgrade the radio console', 'successful_with_issues', dayInZone(-10));
    await finished('Move the timetable database', 'backed_out', dayInZone(-5));
    await finished('Replace the fare gateway', 'failed', dayInZone(-200));
    await finished('Canceled switch work', 'cancelled', dayInZone(-2));
    const res = await t.api.get('/api/changes/success-rate');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ finished: 3, successful: 2, unsuccessful: 1, success_pct: 66.7, to: dayInZone(0) });
    expect(res.body.by_outcome.map((o: any) => [o.value, o.count, o.successful])).toEqual([
      ['successful', 1, true], ['successful_with_issues', 1, true], ['backed_out', 1, false],
    ]);
    const wide = await t.api.get(`/api/changes/success-rate?from=${dayInZone(-365)}&to=${dayInZone(0)}`);
    expect(wide.body).toMatchObject({ finished: 4, success_pct: 50 });
    const none = await t.api.get(`/api/changes/success-rate?from=${dayInZone(-1000)}&to=${dayInZone(-900)}`);
    expect(none.body).toMatchObject({ finished: 0, success_pct: null });
  });

  it('refuses a bad range', async () => {
    expect((await t.api.get('/api/changes/success-rate?from=yesterday')).status).toBe(400);
    expect((await t.api.get(`/api/changes/success-rate?from=${dayInZone(0)}&to=${dayInZone(-1)}`)).status).toBe(400);
  });

  it('is offered as a monthly metric', async () => {
    const m = metricsAvailable(t.app, t.ctx.resources).find((x) => x.key === 'changes.success_pct');
    expect(m?.unit).toBe('percent');
    const month = `${dayInZone(-3).slice(0, 7)}-01`;
    const value = await m!.compute(t.ctx, month);
    expect(value === null || (value >= 0 && value <= 100)).toBe(true);
    expect(await m!.compute(t.ctx, '2999-01-01')).toBeNull();
  });
});
