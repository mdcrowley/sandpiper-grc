import { describe, expect, it } from 'vitest';
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
