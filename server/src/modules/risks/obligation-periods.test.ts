import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { addMonths, periodEndingOn } from './obligations.ts';

// Obligation type, frequency, applicability and period attestation (E30-01, E30-02). Invented data only.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

describe('date helpers', () => {
  it('moves by months and keeps the end of a shorter month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(periodEndingOn('2026-03-31', 3)).toEqual({ period_start: '2026-01-01', period_end: '2026-03-31', due_on: '2026-03-31' });
    expect(periodEndingOn('2026-03-31', 0)).toEqual({ period_start: '2026-03-31', period_end: '2026-03-31', due_on: '2026-03-31' });
  });
});

describe('obligation type, frequency and applies to (contract C5)', () => {
  it('offers the lists, including funding_condition', async () => {
    const meta = (await t.api.get('/api/meta')).body;
    const f = meta.resources.obligation.fields;
    expect(f.type).toMatchObject({ type: 'lookup', list: 'obligation_type' });
    expect(f.frequency).toMatchObject({ type: 'lookup', list: 'obligation_frequency' });
    expect(f.applies_to.type).toBe('json');
    expect(meta.lookups.obligation_type.map((v: any) => v.value)).toContain('funding_condition');
    expect(meta.lookups.obligation_frequency.map((v: any) => v.value))
      .toEqual(['once', 'monthly', 'quarterly', 'half_yearly', 'yearly', 'every_2_years', 'every_3_years']);
  });

  it('normalizes applies_to and refuses what it cannot name', async () => {
    const ok = await t.api.post('/api/obligations', {
      title: 'Quarterly ridership return', type: 'funding_condition', frequency: 'quarterly',
      applies_to: ['Bus operations', { label: 'Light rail' }, 'bus operations', ''],
    });
    expect(ok.status).toBe(201);
    expect(ok.body.applies_to).toEqual([{ label: 'Bus operations' }, { label: 'Light rail' }]);

    // Restricted record types (risks) cannot be named on an unrestricted obligation.
    const risk = (await t.api.post('/api/risks', { title: 'Invented risk' })).body;
    const bad = await t.api.post('/api/obligations', { title: 'X', applies_to: [{ type: 'risk', id: risk.id }] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.applies_to).toMatch(/restricted/);
    expect((await t.api.post('/api/obligations', { title: 'X', applies_to: 'Depots' })).status).toBe(400);
    expect((await t.api.post('/api/obligations', { title: 'X', type: 'nonsense' })).status).toBe(400);

    // A record of another type is stored with its label.
    const other = (await t.api.post('/api/obligations', { title: 'Parent filing' })).body;
    const linked = await t.api.post('/api/obligations', { title: 'Child filing', applies_to: [{ type: 'obligation', id: other.id }] });
    expect(linked.status).toBe(201);
    expect(linked.body.applies_to[0]).toMatchObject({ type: 'obligation', id: other.id });
    expect(linked.body.applies_to[0].label).toContain('Parent filing');
  });
});

describe('obligation periods and attestation', () => {
  it('adds the period ending on the next due date, attests it and rolls the date on', async () => {
    const due = dayInZone(-5);
    const o = (await t.api.post('/api/obligations', { title: 'Monthly safety data return', frequency: 'monthly', next_due_on: due })).body;
    const listed = await t.api.get(`/api/obligations/${o.id}/periods`);
    expect(listed.status).toBe(200);
    expect(listed.body.next).toEqual(periodEndingOn(due, 1));

    const added = await t.api.post(`/api/obligations/${o.id}/periods`, {});
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ period_end: due, due_on: due, status: null });
    expect((await t.api.post(`/api/obligations/${o.id}/periods`, { period_start: added.body.period_start })).status).toBe(409);

    // Not met needs a note.
    expect((await t.api.post(`/api/obligations/${o.id}/periods/${added.body.id}/attest`, { status: 'not_met' })).status).toBe(400);
    expect((await t.api.post(`/api/obligations/${o.id}/periods/${added.body.id}/attest`, { status: 'bogus' })).status).toBe(400);
    expect((await t.api.post(`/api/obligations/${o.id}/periods/${added.body.id}/attest`, { status: 'met', attested_on: dayInZone(3) })).status).toBe(400);

    const att = await t.api.post(`/api/obligations/${o.id}/periods/${added.body.id}/attest`, { status: 'met', evidence: 'Return filed; receipt kept' });
    expect(att.status).toBe(200);
    expect(att.body.period).toMatchObject({ status: 'met', attested_on: dayInZone(0), evidence: 'Return filed; receipt kept' });
    expect(att.body.obligation.status).toBe('met');
    expect(att.body.obligation.next_due_on.slice(0, 10)).toBe(addMonths(due, 1));
    expect(att.body.obligation.last_attested_on).toBe(dayInZone(0));

    // Correcting the same period does not roll the date a second time.
    const again = await t.api.post(`/api/obligations/${o.id}/periods/${added.body.id}/attest`, { status: 'partly_met', note: 'One table was late' });
    expect(again.body.obligation.status).toBe('partly_met');
    expect(again.body.obligation.next_due_on.slice(0, 10)).toBe(addMonths(due, 1));

    // The history shows both steps.
    const hist = (await t.api.get(`/api/history?record_type=obligation&record_id=${o.id}`)).body;
    expect(JSON.stringify(hist)).toContain('obligation.attest');

    // A period of another obligation is not found here.
    const o2 = (await t.api.post('/api/obligations', { title: 'Other', frequency: 'yearly', next_due_on: dayInZone(10) })).body;
    expect((await t.api.post(`/api/obligations/${o2.id}/periods/${added.body.id}/attest`, { status: 'met' })).status).toBe(404);
    expect((await t.api.post(`/api/obligations/${o2.id}/periods/not-a-uuid/attest`, { status: 'met' })).status).toBe(404);
  });

  it('needs obligations.edit to attest', async () => {
    const o = (await t.api.post('/api/obligations', { title: 'Yearly certificate', frequency: 'yearly', next_due_on: dayInZone(20) })).body;
    const p = (await t.api.post(`/api/obligations/${o.id}/periods`, {})).body;
    const viewer = await t.as('executive_viewer');
    expect((await viewer.post(`/api/obligations/${o.id}/periods/${p.id}/attest`, { status: 'met' })).status).toBe(403);
  });
});
