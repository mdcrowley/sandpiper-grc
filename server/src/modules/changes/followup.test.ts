import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// With the real risks module, which owns the shared Actions contract and the action_source list.
let t: Awaited<ReturnType<typeof testApp>>;
const before = process.env.GRC_MODULES;
beforeAll(async () => {
  process.env.GRC_MODULES = 'changes,risks';
  t = await testApp();
});
afterAll(async () => {
  await t.close();
  if (before === undefined) delete process.env.GRC_MODULES; else process.env.GRC_MODULES = before;
});

describe('follow-up actions from a change (E05-10)', () => {
  it('carry the source "change" and point back at the change', async () => {
    expect((await t.ctx.lookups.values('action_source')).map((v) => v.value)).toContain('change');
    const change = await t.api.post('/api/changes', { title: 'Swap the depot router', planned_start: '2031-05-02T18:00:00.000Z', planned_end: '2031-05-02T20:00:00.000Z' });
    expect(change.status).toBe(201);
    const raised = await t.api.post(`/api/changes/${change.body.id}/actions`, { title: 'Label the new router', due_on: '2031-05-09' });
    expect(raised.status).toBe(201);
    const action = (await t.api.get(`/api/actions/${raised.body.id}`)).body;
    expect(action).toMatchObject({ title: 'Label the new router', source: 'change', source_type: 'change', source_id: change.body.id });
    expect(action._display.source).toMatch(/change/i);
  });
});
