import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { dayInZone, todayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { addMonths, nextMonitoring, runSubrecipientReminders, seedSubrecipients } from './subrecipients.ts';

// Sub-recipient monitoring (E35-07, E27-11): records on awards, monitoring history, reminders by
// frequency (claimed once), findings that raise a corrective action plan, retention and the switch.
let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let officer: Client;   // compliance officer: funding.*, actions.*
let agent: Client;     // no funding permissions
let awardId: string;
const before = process.env.GRC_MODULES;

beforeAll(async () => {
  process.env.GRC_MODULES = 'funding,risks,notifications,vendors,admin';
  t = await testApp();
  officer = await t.as('compliance_officer');
  agent = await t.as('agent');
  awardId = (await officer.post('/api/funding-awards', { title: 'Award with partners', status: 'active', amount: 500000 })).body.id;
}, 90_000);
afterAll(async () => {
  await t?.close();
  if (before === undefined) delete process.env.GRC_MODULES; else process.env.GRC_MODULES = before;
});

describe('due dates', () => {
  it('moves the next monitoring on by the frequency', () => {
    expect(nextMonitoring('quarterly', '2026-01-31', '2026-11-21')).toBe('2026-04-30');
    expect(nextMonitoring('yearly', null, '2026-11-21')).toBe('2026-11-21');
    expect(nextMonitoring('once', '2026-01-31', '2026-11-21')).toBeNull();
    expect(nextMonitoring(null, null, '2026-11-21')).toBeNull();
  });
});

describe('sub-recipients', () => {
  let subId: string;

  it('records a sub-recipient on an award, due for monitoring at once', async () => {
    expect((await agent.post('/api/subrecipients', { name: 'Partner', award_id: awardId })).status).toBe(403);
    expect((await officer.post('/api/subrecipients', { name: 'Partner' })).status).toBe(400);
    const res = await officer.post('/api/subrecipients', { name: 'Partner agency (test)', award_id: awardId, monitoring_frequency: 'quarterly', amount: 120000, owner_id: officer.userId });
    expect(res.status).toBe(201);
    expect(res.body.ref).toMatch(/^SUB-/);
    expect(res.body.next_monitoring_due).toBe(todayInZone());
    subId = res.body.id;
  });

  it('keeps a monitoring history and works out the next date', async () => {
    const url = `/api/subrecipients/${subId}/monitoring`;
    expect((await officer.post(url, { method: 'site_visit', result: 'findings' })).body.error.fields.findings).toBeTruthy();
    expect((await officer.post(url, { method: 'phone', result: 'satisfactory' })).status).toBe(400);
    expect((await officer.post(url, { method: 'desk_review', result: 'satisfactory', monitored_on: dayInZone(3) })).status).toBe(400);
    expect((await officer.post(url, { method: 'desk_review', result: 'satisfactory', monitored_on: dayInZone(-100) })).status).toBe(201);
    const visit = await officer.post(url, { method: 'site_visit', result: 'findings', monitored_on: dayInZone(-10), findings: 'Records missing (test).' });
    expect(visit.status).toBe(201);
    const list = (await officer.get(url)).body;
    expect(list.rows.map((r: Row) => r.method)).toEqual(['site_visit', 'desk_review']);
    expect(list.last_monitored_on).toBe(dayInZone(-10));
    expect(list.next_monitoring_due).toBe(addMonths(dayInZone(-10), 3));
    expect((await agent.get(url)).status).toBe(403);
  });

  it('raises a corrective action plan from findings, once', async () => {
    const list = (await officer.get(`/api/subrecipients/${subId}/monitoring`)).body.rows as Row[];
    const visit = list.find((r) => r.result === 'findings')!;
    const desk = list.find((r) => r.result === 'satisfactory')!;
    expect((await officer.post(`/api/subrecipients/${subId}/monitoring/${desk.id}/cap`, {})).status).toBe(409);
    const cap = await officer.post(`/api/subrecipients/${subId}/monitoring/${visit.id}/cap`, {});
    expect(cap.status).toBe(201);
    expect((await t.api.get(`/api/caps/${cap.body.cap.id}`)).body).toMatchObject({ source: 'funding', source_type: 'subrecipient', source_id: subId });
    expect((await officer.post(`/api/subrecipients/${subId}/monitoring/${visit.id}/cap`, {})).status).toBe(409);
    expect((await officer.get(`/api/subrecipients/${subId}/monitoring`)).body.rows.find((r: Row) => r.id === visit.id).cap_ref).toMatch(/^CAP-/);
  });

  it('reminds once when monitoring comes due, however many runs overlap', async () => {
    const due = (await officer.post('/api/subrecipients', { name: 'Due partner (test)', award_id: awardId, monitoring_frequency: 'yearly', owner_id: officer.userId })).body;
    await Promise.all([runSubrecipientReminders(t.ctx), runSubrecipientReminders(t.ctx), runSubrecipientReminders(t.ctx)]);
    await runSubrecipientReminders(t.ctx);
    const sent = await t.db.query<Row>('select title from notifications where user_id = $1 and record_id = $2', [officer.userId, due.id]);
    expect(sent).toHaveLength(1);
  });

  it('clears who monitored and the findings when anonymized at the end of retention', async () => {
    await t.db.query(`update subrecipients set created_at = now() - interval '12 years', updated_at = now() - interval '12 years' where id = $1`, [subId]);
    expect((await t.api.put('/api/admin/retention/subrecipient', { periodMonths: 24, disposal: 'anonymize' })).status).toBe(200);
    await t.core.retention.sweep();
    const review = (await t.api.get('/api/admin/retention/reviews?record_type=subrecipient')).body.rows.find((r: Row) => r.record_id === subId);
    expect(review).toBeTruthy();
    const admin = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
    await t.db.query('update sessions set confirmed_at = now() where user_id = $1', [admin]);
    expect((await t.api.post(`/api/admin/retention/reviews/${review.id}/anonymize`, { reason: 'End of the schedule (test).', confirm: true })).status).toBe(200);
    const rows = await t.db.query<Row>('select by, findings from subrecipient_monitoring where subrecipient_id = $1', [subId]);
    expect(rows.every((r) => r.by === null && (r.findings === null || !r.findings.includes('test')))).toBe(true);
  });

  it('seeds two invented sub-recipients once, labeled as samples', async () => {
    await t.ctx.resources.create('funding_award', { title: '[Sample] Operating assistance', status: 'active' });
    expect(await seedSubrecipients(t.ctx, { profile: 'pilot', seedDir: '', organization: {} } as never)).toBeNull();
    expect(await seedSubrecipients(t.ctx, { profile: 'dev', seedDir: '', organization: {} } as never)).toMatch(/sub-recipients 2/);
    expect(await seedSubrecipients(t.ctx, { profile: 'dev', seedDir: '', organization: {} } as never)).toBeNull();
    const names = (await t.db.query<Row>(`select name from subrecipients where name like '[Sample] %'`)).map((r) => r.name);
    expect(names).toHaveLength(2);
  });

  it('disappears with the funding area', async () => {
    const admin = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
    await t.db.query('update sessions set confirmed_at = now() where user_id = $1', [admin]);
    expect((await t.api.patch('/api/admin/features', { features: { funding: false } })).status).toBe(200);
    try {
      const res = await t.api.get('/api/subrecipients');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('switched_off');
      expect((await t.api.get('/api/meta')).body.lookups.subrecipient_monitoring_result).toBeUndefined();
    } finally {
      await t.api.patch('/api/admin/features', { features: { funding: true } });
    }
  });
});
