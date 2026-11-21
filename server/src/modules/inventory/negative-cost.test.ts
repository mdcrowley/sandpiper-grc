import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// BW-10: an asset's cost is never below zero, however it is written (the form, the API, imports,
// assistant tools), so the cost reports and dashboards add up. Invented data only.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(async () => { await t?.close(); });

describe('asset cost', () => {
  it('refuses a negative cost, beside the field, and accepts zero', async () => {
    const made = await t.api.post('/api/assets', { name: 'Spare validator', cost: -500 });
    expect(made.status).toBe(400);
    expect(made.body.error.fields.cost).toBe('Enter zero or more.');
    const ok = await t.api.post('/api/assets', { name: 'Spare validator', cost: 0 });
    expect(ok.status).toBe(201);
    const patched = await t.api.patch(`/api/assets/${ok.body.id}`, { cost: -1 });
    expect(patched.status).toBe(400);
    expect(patched.body.error.fields.cost).toBe('Enter zero or more.');
    expect((await t.api.patch(`/api/assets/${ok.body.id}`, { cost: 1250.5 })).status).toBe(200);
  });
});
