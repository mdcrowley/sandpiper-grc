import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// BW-10: a contract's total value is never below zero, however it is written, so the contract value
// reports and dashboards add up. Invented data only.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(async () => { await t?.close(); });

describe('contract total value', () => {
  it('refuses a negative value, beside the field, and accepts zero', async () => {
    const vendor = (await t.api.post('/api/vendors', { name: 'Larkspur Transit Supply' })).body;
    const made = await t.api.post('/api/contracts', { title: 'Fare media', vendor_id: vendor.id, total_value: -1000 });
    expect(made.status).toBe(400);
    expect(made.body.error.fields.total_value).toBe('Enter zero or more.');
    const ok = await t.api.post('/api/contracts', { title: 'Fare media', vendor_id: vendor.id, total_value: 0 });
    expect(ok.status).toBe(201);
    const patched = await t.api.patch(`/api/contracts/${ok.body.id}`, { total_value: -1 });
    expect(patched.status).toBe(400);
    expect(patched.body.error.fields.total_value).toBe('Enter zero or more.');
  });
});
