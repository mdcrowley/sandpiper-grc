import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// E46-61: complaint time limits counted in working days on the organization's working calendar (the
// business-hours calendar records requests count on, holidays included), and several bases per
// complaint. Invented data only.
let t: Awaited<ReturnType<typeof testApp>>;

beforeAll(async () => {
  t = await testApp();
  await t.db.query('update sessions set confirmed_at = now()');
  const on = await t.api.patch('/api/admin/features', { features: { civilrights: true } });
  expect(on.status, JSON.stringify(on.body)).toBe(200);
}, 120_000);
afterAll(async () => { await t?.close(); });

const ok = (res: { status: number; body: any }, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body;
};

describe('time limits in working days', () => {
  it('counts calendar days as installed and shows the working calendar', async () => {
    const s = ok(await t.api.get('/api/civil-rights/settings'));
    expect(s).toMatchObject({ ackDays: 10, ackWorking: false, investigationWorking: false, appealWorking: false });
    expect(s).toHaveProperty('workingCalendar');
    expect(s).toHaveProperty('holidays');
    // Received Friday 2026-01-09: 10 calendar days = Monday 2026-01-19.
    const c = ok(await t.api.post('/api/civil-rights/complaints', { subject: 'Invented calendar-day complaint', received_on: '2026-01-09' }), 201);
    expect(c.ack_due_on).toBe('2026-01-19');
    expect(c.investigation_due_on).toBe('2026-04-09');
  });

  it('refuses a counting that is not true or false', async () => {
    const bad = await t.api.put('/api/civil-rights/settings', { ackWorking: 'yes' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields).toHaveProperty('ackWorking');
  });

  it('counts working days, skipping weekends and the calendar\'s holidays', async () => {
    const saved = ok(await t.api.put('/api/civil-rights/settings', { ackWorking: true, appealWorking: true, appealDays: 5 }));
    expect(saved).toMatchObject({ ackWorking: true, investigationWorking: false, appealWorking: true, appealDays: 5 });
    // Received Friday 2026-01-09: 10 working days = Friday 2026-01-23; the investigation stays in calendar days.
    const c = ok(await t.api.post('/api/civil-rights/complaints', { subject: 'Invented working-day complaint', received_on: '2026-01-09' }), 201);
    expect(c.ack_due_on).toBe('2026-01-23');
    expect(c.investigation_due_on).toBe('2026-04-09');

    // A holiday on the business-hours calendar moves the limit by a working day.
    const cals = (await t.api.get('/api/tickets/sla/calendars')).body as { id: string; key: string; name: string }[];
    const business = cals.find((x) => x.key === 'business');
    if (business) {
      ok(await t.api.post(`/api/tickets/sla/calendars/${business.id}/holidays`, { day: '2026-01-19', name: 'Invented midwinter holiday' }), 201);
      const shown = ok(await t.api.get('/api/civil-rights/settings'));
      expect(shown).toMatchObject({ workingCalendar: business.name, holidays: 1 });
      const h = ok(await t.api.post('/api/civil-rights/complaints', { subject: 'Invented holiday complaint', received_on: '2026-01-09' }), 201);
      expect(h.ack_due_on).toBe('2026-01-26');
    }

    // An appeal in working days: received Thursday 2026-02-05, 5 working days = Thursday 2026-02-12.
    const a = ok(await t.api.patch(`/api/civil-rights/complaints/${c.id}`, { appeal_received_on: '2026-02-05' }));
    expect(a.appeal_due_on).toBe('2026-02-12');

    // The clock says which limits count working days.
    const clock = ok(await t.api.get(`/api/civil-rights/complaints/${c.id}/clock`));
    const byKey = Object.fromEntries(clock.limits.map((l: any) => [l.key, l]));
    expect(byKey.ack.working).toBe(true);
    expect(byKey.investigation.working).toBe(false);
    expect(byKey.appeal.working).toBe(true);
  });

  it('keeps dates already worked out when the counting changes', async () => {
    const before = ok(await t.api.post('/api/civil-rights/complaints', { subject: 'Invented complaint before the change', received_on: '2026-03-06' }), 201);
    ok(await t.api.put('/api/civil-rights/settings', { ackWorking: false, appealWorking: false, appealDays: 30 }));
    const again = ok(await t.api.get(`/api/civil-rights/complaints/${before.id}`));
    expect(again.ack_due_on).toBe(before.ack_due_on);
    // Changing the day received works the limit out again with the new counting.
    const moved = ok(await t.api.patch(`/api/civil-rights/complaints/${before.id}`, { received_on: '2026-03-06' }));
    expect(moved.ack_due_on).toBe('2026-03-16');
  });
});

describe('several bases', () => {
  it('keeps every basis and the first as the main one', async () => {
    const c = ok(await t.api.post('/api/civil-rights/complaints', { subject: 'Invented two-basis complaint', bases: ['national_origin', 'disability'] }), 201);
    expect(c.bases).toEqual(['national_origin', 'disability']);
    expect(c.basis).toBe('national_origin');
    // The list filter finds a complaint by any of its bases, not only the first (core/resource.ts).
    const ids = async (q: string) => ok(await t.api.get(`/api/civil-rights/complaints?${q}`)).rows.map((r: any) => r.id);
    expect(await ids('f.bases=disability')).toContain(c.id);
    expect(await ids('f.bases=sex,disability')).toContain(c.id);
    expect(await ids('f.bases=religion')).not.toContain(c.id);
    const bad = await t.api.post('/api/civil-rights/complaints', { subject: 'Invented bad basis', bases: ['not_a_basis'] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields).toHaveProperty('bases');

    const changed = ok(await t.api.patch(`/api/civil-rights/complaints/${c.id}`, { bases: ['sex'] }));
    expect(changed).toMatchObject({ bases: ['sex'], basis: 'sex' });
    const cleared = ok(await t.api.patch(`/api/civil-rights/complaints/${c.id}`, { bases: [] }));
    expect(cleared.bases).toEqual([]);
    expect(cleared.basis).toBeNull();
  });

  it('accepts one basis from an older client as the first of the bases', async () => {
    const c = ok(await t.api.post('/api/civil-rights/complaints', { subject: 'Invented one-basis complaint', basis: 'age' }), 201);
    expect(c.bases).toEqual(['age']);
    const more = ok(await t.api.patch(`/api/civil-rights/complaints/${c.id}`, { bases: ['age', 'religion'] }));
    const first = ok(await t.api.patch(`/api/civil-rights/complaints/${more.id}`, { basis: 'income' }));
    expect(first.bases).toEqual(['income', 'religion']);
    expect(first.basis).toBe('income');
  });

  it('starts with an empty list when no basis is given', async () => {
    const c = ok(await t.api.post('/api/civil-rights/complaints', { subject: 'Invented no-basis complaint' }), 201);
    expect(c.bases).toEqual([]);
    expect(c.basis).toBeNull();
  });
});
