import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../test/helpers.ts';

// Migration 006: built-in list labels left as installed move to American spelling; stored values
// and labels an administrator changed stay as they are.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

describe('American list labels', () => {
  it('relabels untouched built-in values and keeps the stored values and edited labels', async () => {
    await t.ctx.lookups.ensure('spelling_probe', [
      { value: 'cancelled', label: 'Cancelled' },
      { value: 'software_licence', label: 'Software licence' },
    ]);
    await t.ctx.lookups.ensure('spelling_probe_edited', [{ value: 'cancelled', label: 'Called off' }]);
    await t.db.exec(readFileSync(new URL('./migrations/006_american_labels.sql', import.meta.url), 'utf8'));
    expect((await t.ctx.lookups.values('spelling_probe')).map((v) => [v.value, v.label]))
      .toEqual([['cancelled', 'Canceled'], ['software_licence', 'Software license']]);
    expect((await t.ctx.lookups.values('spelling_probe_edited')).map((v) => v.label)).toEqual(['Called off']);
  });

  it('installs the built-in lists with American labels', async () => {
    const labels = (await t.db.query<{ label: string }>('select label from lookups')).map((v) => v.label).join('\n');
    expect(labels).not.toMatch(/Cancelled|licence|organisation|Acknowledgement|colour|catalogue/i);
  });
});
