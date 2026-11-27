import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { dayInZone, displayDate } from '../../core/timezone.ts';

// E45-42: application portfolio facts on systems: version, end of vendor support (with reminders)
// and annual cost. Invented data only.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(async () => { await t?.close(); });

describe('system version, end of support and annual cost', () => {
  it('are saved, listed, filtered and sorted', async () => {
    const a = await t.api.post('/api/systems', { name: 'Example timetable planner', version: '7.2', support_end: dayInZone(40), annual_cost: 18500 });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ version: '7.2', support_end: dayInZone(40) });
    expect(Number(a.body.annual_cost)).toBe(18500);
    const b = await t.api.post('/api/systems', { name: 'Example fare reporting', support_end: dayInZone(400), annual_cost: 2400.5 });
    expect(b.status).toBe(201);
    const patched = await t.api.patch(`/api/systems/${b.body.id}`, { version: '2024 R1' });
    expect(patched.body.version).toBe('2024 R1');

    const soon = await t.api.get(`/api/systems?f.support_end.lt=${dayInZone(90)}`);
    expect(soon.body.rows.map((r: any) => r.name)).toEqual(['Example timetable planner']);
    const sorted = await t.api.get('/api/systems?sort=annual_cost&dir=desc&f.annual_cost.null=false');
    expect(sorted.body.rows.map((r: any) => r.name)).toEqual(['Example timetable planner', 'Example fare reporting']);
    const meta = (await t.api.get('/api/meta')).body.resources.system.fields;
    expect(meta.support_end.label).toBe('End of support');
    expect(meta.annual_cost.type).toBe('currency');
  });

  it('refuses a negative annual cost', async () => {
    const res = await t.api.post('/api/systems', { name: 'Example negative', annual_cost: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.annual_cost).toBe('Enter zero or more.');
  });

  it('reminds the technical owner once per step before support ends', async () => {
    const owner = await t.as('agent');
    const sys = (await t.api.post('/api/systems', { name: 'Example radio console', technical_owner_id: owner.userId, support_end: dayInZone(6) })).body;
    await t.api.post('/api/systems', { name: 'Example retired console', status: 'retired', technical_owner_id: owner.userId, support_end: dayInZone(6) });
    const first = (await t.api.post('/api/inventory/reminders/run')).body;
    if (!t.app.hasDecorator('notify')) {
      expect(first.systems).toBe(0);
      return;
    }
    expect(first.systems).toBe(1);
    const titles = (await owner.get('/api/notifications?pageSize=100')).body.rows.map((n: any) => n.title);
    expect(titles).toContain(`Vendor support for ${sys.ref} Example radio console ends in 6 days (${displayDate(dayInZone(6))})`);
    expect(titles.some((x: string) => x.includes('retired console'))).toBe(false);
    expect((await t.api.post('/api/inventory/reminders/run')).body.systems).toBe(0);
  });
});
