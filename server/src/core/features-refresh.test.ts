// Wave 26 (E46): a change to the feature switches applies in this process at once, also to work that
// runs before the next request (background jobs, seeds, system saves). Before, the fields of record
// types that refer to an area were rebuilt only by the next API request, so a system save right after
// switching an area on dropped them.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../test/helpers.ts';
import { featureState, knownFeatureState } from './features.ts';

describe('feature switches apply at once in the process', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  beforeAll(async () => { t = await testApp(); });
  afterAll(async () => { await t.ctx.settings.set('features', {}); await t.app.close(); });

  it('rebuilds the fields of types that refer to an area without waiting for a request', async () => {
    const system = () => t.ctx.resources.get('system');
    if (!system() || !t.ctx.resources.get('vendor')) return; // inventory or vendors not loaded
    expect(system()!.fields.vendor_id).toBeDefined();

    await t.ctx.settings.set('features', { vendors: false });
    // No request in between: the state and the record types already follow.
    expect(knownFeatureState(t.db).on.vendors).toBe(false);
    expect(system()!.fields.vendor_id).toBeUndefined();

    await t.ctx.settings.set('features', { vendors: true });
    expect(knownFeatureState(t.db).on.vendors).toBe(true);
    expect((await featureState(t.db)).on.vendors).toBe(true);
    expect(system()!.fields.vendor_id).toBeDefined();

    // A system save right after switching on keeps the field.
    const vendor = await t.ctx.resources.create('vendor', { name: 'Refresh Test Vendor' });
    const saved = await t.ctx.resources.create('system', { name: 'Refresh test system', vendor_id: vendor.id });
    expect(saved.vendor_id).toBe(vendor.id);
  });
});
