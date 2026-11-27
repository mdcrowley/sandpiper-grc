// E18-75: the vendor card headlines a passed notice date on an open contract (the most urgent state),
// and ended contracts never count. Invented data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { addDays, localDate } from './dates.ts';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

describe('vendor summary notice dates', () => {
  it('names the latest passed notice date of an open contract, and leaves ended contracts out', async () => {
    const today = localDate();
    const v = (await t.api.post('/api/vendors', { name: 'Invented Larkspur Hosting' })).body.id as string;
    const mk = async (title: string, extra: Record<string, unknown>) => (await t.api.post('/api/contracts', { title, vendor_id: v, ...extra })).body;
    const passed = await mk('Invented open, notice passed', { end_date: addDays(today, 20), notice_days: 60 });
    const older = await mk('Invented open, notice passed earlier', { end_date: addDays(today, 10), notice_days: 90 });
    const ended = await mk('Invented ended', { end_date: addDays(today, 30), notice_days: 60 });
    expect((await t.api.patch(`/api/contracts/${ended.id}`, { status: 'terminated' })).status).toBe(200);
    const later = await mk('Invented open, notice to come', { end_date: addDays(today, 400), notice_days: 30 });
    expect(passed.notice_date < today && later.notice_date > today).toBe(true);

    const s = (await t.api.get(`/api/vendors/${v}/summary`)).body;
    expect(s.notice_dates_passed).toBe(2); // the ended contract is not counted
    expect(s.last_passed_notice_date).toBe(passed.notice_date);
    expect(s.last_passed_contract).toMatchObject({ id: passed.id, title: 'Invented open, notice passed' });
    expect(s.next_notice_date).toBe(later.notice_date);
    expect(older.notice_date < passed.notice_date).toBe(true);
  });

  it('has no passed date when only ended contracts passed theirs', async () => {
    const today = localDate();
    const v = (await t.api.post('/api/vendors', { name: 'Invented Wren Cabling' })).body.id as string;
    const c = (await t.api.post('/api/contracts', { title: 'Invented ended cabling', vendor_id: v, end_date: addDays(today, 20), notice_days: 60 })).body;
    await t.api.patch(`/api/contracts/${c.id}`, { status: 'expired' });
    const s = (await t.api.get(`/api/vendors/${v}/summary`)).body;
    expect(s).toMatchObject({ notice_dates_passed: 0, last_passed_notice_date: null, last_passed_contract: null, contracts_open: 0 });
  });
});
