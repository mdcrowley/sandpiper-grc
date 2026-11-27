import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { todayInZone } from '../../core/timezone.ts';
import { annualValueOf, refreshAllSpend } from './spend.ts';

// E45-43: annual value on contracts, annual spend on vendors, and their totals. Invented data only.
let t: Awaited<ReturnType<typeof testApp>>;
const year = todayInZone().slice(0, 4);
beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(async () => { await t?.close(); });

describe('annualValueOf', () => {
  it('takes this year\'s line, then the average of the lines, then the total over the term', () => {
    expect(annualValueOf({ value_by_year: { 2025: 100, 2026: 300 } }, '2026')).toBe(300);
    expect(annualValueOf({ value_by_year: { 2020: 100, 2021: 300 } }, '2026')).toBe(200);
    expect(annualValueOf({ total_value: 90000, start_date: '2025-01-01', end_date: '2027-12-31' }, '2026')).toBe(30000);
    // A term shorter than a year counts as one year; no term at all gives the total.
    expect(annualValueOf({ total_value: 5000, start_date: '2026-01-01', end_date: '2026-03-31' }, '2026')).toBe(5000);
    expect(annualValueOf({ total_value: 5000 }, '2026')).toBe(5000);
    expect(annualValueOf({}, '2026')).toBeNull();
  });
});

describe('spend on contracts and vendors', () => {
  let vendorA: string;
  let vendorB: string;
  let first: string;

  it('works out a contract\'s annual value and its vendor\'s spend when a contract is saved', async () => {
    vendorA = (await t.api.post('/api/vendors', { name: 'Example Signal Works' })).body.id;
    vendorB = (await t.api.post('/api/vendors', { name: 'Example Depot Supplies' })).body.id;
    const c1 = await t.api.post('/api/contracts', { title: 'Signal maintenance', vendor_id: vendorA, value_by_year: { [year]: 12000 } });
    expect(c1.status).toBe(201);
    expect(Number(c1.body.annual_value)).toBe(12000);
    first = c1.body.id;
    await t.api.post('/api/contracts', { title: 'Signal spares', vendor_id: vendorA, total_value: 6000, start_date: `${year}-01-01`, end_date: `${Number(year) + 1}-12-31` });
    await t.api.post('/api/contracts', { title: 'Old signal deal', vendor_id: vendorA, status: 'expired', total_value: 99999 });
    expect(Number((await t.api.get(`/api/vendors/${vendorA}`)).body.annual_spend)).toBe(15000);

    // The annual value cannot be typed.
    const typed = await t.api.patch(`/api/contracts/${first}`, { annual_value: 1, value_by_year: { [year]: 10000 } });
    expect(Number(typed.body.annual_value)).toBe(10000);
    expect(Number((await t.api.get(`/api/vendors/${vendorA}`)).body.annual_spend)).toBe(13000);
  });

  it('moves the spend when a contract moves to another vendor, and drops it when deleted', async () => {
    await t.api.patch(`/api/contracts/${first}`, { vendor_id: vendorB });
    expect(Number((await t.api.get(`/api/vendors/${vendorA}`)).body.annual_spend)).toBe(3000);
    expect(Number((await t.api.get(`/api/vendors/${vendorB}`)).body.annual_spend)).toBe(10000);
    expect((await t.api.del(`/api/contracts/${first}`)).status).toBeLessThan(300);
    expect((await t.api.get(`/api/vendors/${vendorB}`)).body.annual_spend).toBeNull();
  });

  it('lists and sorts by spend', async () => {
    const vendors = (await t.api.get('/api/vendors?sort=annual_spend&dir=desc&f.annual_spend.null=false')).body.rows;
    expect(vendors.map((v: any) => v.name)).toEqual(['Example Signal Works']);
    const contracts = (await t.api.get('/api/contracts?sort=annual_value&dir=desc&f.status=active')).body.rows;
    expect(contracts.map((c: any) => c.title)).toEqual(['Signal spares']);
  });

  it('totals every active contract and vendor, the same for everyone who may see the list', async () => {
    await t.db.query('update contracts set annual_value = null');
    await refreshAllSpend(t.ctx);
    const contracts = (await t.api.get('/api/contracts/spend-summary')).body;
    expect(contracts).toEqual({ year, active: 1, withValue: 1, annualValue: 3000 });
    const vendors = (await t.api.get('/api/vendors/spend-summary')).body;
    expect(vendors).toEqual({ year, withSpend: 1, annualSpend: 3000 });
    // Someone who holds the permission sees the same figures; someone without it gets none.
    for (const role of ['compliance_officer', 'project_manager', 'agent', 'executive_viewer']) {
      const other = await t.as(role);
      const res = await other.get('/api/vendors/spend-summary');
      if (res.status === 200) expect(res.body).toEqual(vendors);
      else expect(res.status).toBe(403);
    }
  });
});
