import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../test/helpers.ts';
import { assertNotHeld, heldIdsOf, holdsOn } from './holds.ts';

// Legal-hold hook points (wave 11, contract C1). With no hold placed nothing is held, and every removal
// path that calls them behaves as before. Each path refusing a held record is tested in
// modules/holds/holds.test.ts.

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

describe('legal-hold hook points', () => {
  it('holds nothing while no hold is placed', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(await holdsOn(t.db, 'system', id)).toEqual([]);
    expect((await heldIdsOf(t.db, 'system')).size).toBe(0);
    for (const what of ['delete', 'anonymize', 'remove', 'remove_file'] as const) {
      await expect(assertNotHeld(t.db, 'system', id, what)).resolves.toBeUndefined();
    }
  });

  it('leaves the generic delete and the retention sweep working', async () => {
    const created = await t.api.post('/api/systems', { name: 'Hold probe system' });
    expect(created.status).toBe(201);
    expect((await t.api.del(`/api/systems/${created.body.id}`)).status).toBe(200);
    const sweep = await t.api.post('/api/admin/retention/sweep');
    expect(sweep.status).toBe(200);
    expect(sweep.body.held).toBe(0);
  });
});
