import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { REMINDER_SETTINGS } from './reminder-settings.ts';

// Administration > Reminders shows each number as "<label> (<unit>)", with days when no unit is given.
describe('reminder settings', () => {
  it('give every number its own unit, and a label that does not name another one', () => {
    for (const s of REMINDER_SETTINGS) {
      if (s.kind === 'statuses') continue;
      const unit = s.unit ?? 'days';
      if (/\bmonths?\b/i.test(s.key) || /\bmonths\b/i.test(s.label)) expect(unit, s.key).toBe('months');
      if (/_days\b/.test(s.key)) expect(unit, s.key).toBe('days');
      for (const other of ['days', 'months', 'hours'].filter((u) => u !== unit)) expect(s.label.toLowerCase(), s.key).not.toMatch(new RegExp(`^${other}\\b`));
    }
    expect(REMINDER_SETTINGS.find((s) => s.key === 'condition.assessment_every_months')).toMatchObject({ unit: 'months', label: 'Time between condition assessments' });
  });
});

// A switched-off area leaves no trace: its reminder settings are not offered, and come back with it.
describe('reminder settings of a switched-off area', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  beforeAll(async () => { t = await testApp(); }, 120_000);
  afterAll(async () => { await t?.close(); });

  it('are not listed or saved while the area is off', async () => {
    const keys = async () => (await t.api.get('/api/notifications/reminder-settings')).body.groups.flatMap((g: any) => g.settings.map((s: any) => s.key));
    await t.api.patch('/api/admin/features', { features: { insurance: true } });
    expect(await keys()).toContain('insurance.certificate_request_reminder_days');
    await t.api.patch('/api/admin/features', { features: { insurance: false } });
    try {
      const off = await keys();
      expect(off.filter((k: string) => k.startsWith('insurance.'))).toEqual([]);
      expect(off).toContain('notifications.digest_hour');
      expect((await t.api.patch('/api/notifications/reminder-settings', { values: { 'insurance.certificate_reminder_days': [10] } })).status).toBe(400);
    } finally {
      await t.api.patch('/api/admin/features', { features: { insurance: true } });
    }
  });
});
