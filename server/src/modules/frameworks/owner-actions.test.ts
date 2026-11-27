import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { dayInZone } from '../../core/timezone.ts';

// E45-41: outcomes that need work go to their owners as actions. Invented framework and codes.
let t: Awaited<ReturnType<typeof testApp>>;
let fw: string;
let me: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
  t = await testApp();
  me = (await t.api.get('/api/auth/state')).body.user.id;
  fw = (await t.api.post('/api/frameworks', { key: 'owners', name: 'Owner Framework', version: '1' })).body.id;
  for (const [code, extra] of [
    ['OW.AA-01', { status: 'not_evidenced', owner_id: 'ME', priority: true }],
    ['OW.AA-02', { status: 'partial', owner_id: 'ME' }],
    ['OW.AA-03', { status: 'met', owner_id: 'ME' }],
    ['OW.AA-04', { status: 'partial' }],
  ] as const) {
    const data: Record<string, unknown> = { framework_id: fw, code, official_text: `Wording ${code}`, ...extra };
    if (data.owner_id === 'ME') data.owner_id = me;
    const res = await t.api.post('/api/framework-outcomes', data);
    expect(res.status).toBe(201);
    ids[code] = res.body.id;
  }
});
afterAll(async () => { await t.close(); });

describe('send outcomes that need work to their owners', () => {
  it('counts first with a dry run and creates nothing', async () => {
    const res = await t.api.post(`/api/frameworks/${fw}/send-to-owners`, { dry_run: true });
    expect(res.status).toBe(200);
    expect(res.body.needsWork).toBe(3);
    expect(res.body.created.map((c: any) => c.code)).toEqual(['OW.AA-01', 'OW.AA-02']);
    expect(res.body.withoutOwner.map((c: any) => c.code)).toEqual(['OW.AA-04']);
    const actions = await t.api.get('/api/actions?f.source_type=framework_outcome');
    expect(actions.body.total).toBe(0);
  });

  it('needs a due date that is not in the past', async () => {
    expect((await t.api.post(`/api/frameworks/${fw}/send-to-owners`, {})).body.error.fields.due_on).toBeTruthy();
    expect((await t.api.post(`/api/frameworks/${fw}/send-to-owners`, { due_on: dayInZone(-1) })).body.error.fields.due_on).toMatch(/past/);
  });

  it('creates one action per owned outcome below target, linked to the outcome', async () => {
    const due = dayInZone(30);
    const res = await t.api.post(`/api/frameworks/${fw}/send-to-owners`, { due_on: due });
    expect(res.status).toBe(200);
    expect(res.body.created).toHaveLength(2);
    const action = (await t.api.get(`/api/actions/${res.body.created[0].id}`)).body;
    expect(action).toMatchObject({
      owner_id: me, due_on: due, source: 'assessment', source_type: 'framework_outcome', source_id: ids['OW.AA-01'], priority: 'high',
    });
    expect(action.title).toContain('OW.AA-01');
  });

  it('does not send a second action while the first is open', async () => {
    const res = await t.api.post(`/api/frameworks/${fw}/send-to-owners`, { due_on: dayInZone(30) });
    expect(res.body.created).toHaveLength(0);
    expect(res.body.alreadyOpen).toHaveLength(2);
  });

  it('judges the statuses an assessment captured, and can keep to priority outcomes', async () => {
    // Close the earlier actions so the outcomes can be sent again.
    for (const a of (await t.api.get('/api/actions?f.source_type=framework_outcome')).body.rows) {
      expect((await t.api.patch(`/api/actions/${a.id}`, { status: 'cancelled' })).status).toBe(200);
    }
    const snap = (await t.api.post('/api/assessment-snapshots', { name: 'Spring review', framework_id: fw })).body;
    await t.api.patch(`/api/framework-outcomes/${ids['OW.AA-01']}`, { status: 'met' });
    const res = await t.api.post(`/api/frameworks/${fw}/send-to-owners`, { due_on: dayInZone(14), snapshot_id: snap.id, priority_only: true });
    expect(res.status).toBe(200);
    expect(res.body.created.map((c: any) => c.code)).toEqual(['OW.AA-01']);
    const action = (await t.api.get(`/api/actions/${res.body.created[0].id}`)).body;
    expect(action.description).toContain('Spring review');

    const other = (await t.api.post('/api/frameworks', { key: 'other', name: 'Other' })).body.id;
    expect((await t.api.post(`/api/frameworks/${other}/send-to-owners`, { due_on: dayInZone(14), snapshot_id: snap.id })).status).toBe(404);
  });

  it('needs edit permission on frameworks', async () => {
    const agent = await t.as('agent');
    expect((await agent.post(`/api/frameworks/${fw}/send-to-owners`, { dry_run: true })).status).toBe(403);
  });
});
