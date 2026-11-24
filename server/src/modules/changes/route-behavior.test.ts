import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// Behavior tests for PATCH and DELETE /api/changes/blackouts/:blackoutId [changes.administer] (E40-05):
// the change shows in the list and in conflict checks, is validated against the stored period, and is
// audited; a removed period stops flagging changes. Invented data only.

let t: Awaited<ReturnType<typeof testApp>>;
const MISSING = '00000000-0000-4000-8000-0000000000ff';
const win = (day: string) => ({ planned_start: `${day}T18:00:00.000Z`, planned_end: `${day}T20:00:00.000Z`, system_ids: [] });
const audits = (action: string, id: string) =>
  t.db.query<any>('select * from audit_events where action = $1 and record_id = $2 order by id', [action, id]);
const kinds = async (day: string) => (await t.api.post('/api/changes/conflicts/check', win(day))).body.conflicts.map((c: any) => c.kind);

beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(async () => { await t?.close(); });

describe('PATCH /api/changes/blackouts/:blackoutId', () => {
  it('moves a blackout period, so conflict checks follow it, and audits what changed', async () => {
    const made = (await t.api.post('/api/changes/blackouts', { name: 'Invented fare change weekend', starts_at: '2033-03-05T00:00:00Z', ends_at: '2033-03-07T00:00:00Z' })).body;
    expect(await kinds('2033-03-06')).toEqual(['blackout']);

    const res = await t.api.patch(`/api/changes/blackouts/${made.id}`, { starts_at: '2033-04-05T00:00:00Z', ends_at: '2033-04-07T00:00:00Z', reason: 'Moved by the invented fare board' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: made.id, name: 'Invented fare change weekend', reason: 'Moved by the invented fare board' });
    expect(new Date(res.body.starts_at).toISOString()).toBe('2033-04-05T00:00:00.000Z');
    const listed = (await t.api.get('/api/changes/blackouts')).body.find((b: any) => b.id === made.id);
    expect(new Date(listed.ends_at).toISOString()).toBe('2033-04-07T00:00:00.000Z');
    expect(await kinds('2033-03-06')).toEqual([]);
    expect(await kinds('2033-04-06')).toEqual(['blackout']);
    const ev = await audits('change.blackout_update', made.id);
    expect(ev).toHaveLength(1);
    expect(Object.keys(ev[0].after).sort()).toEqual(['ends_at', 'reason', 'starts_at']);

    // An unchanged body writes nothing.
    await t.api.patch(`/api/changes/blackouts/${made.id}`, { name: 'Invented fare change weekend' });
    expect(await audits('change.blackout_update', made.id)).toHaveLength(1);
  });

  it('checks the change against the stored period, and refuses one that does not exist', async () => {
    const made = (await t.api.post('/api/changes/blackouts', { name: 'Invented timetable cutover', starts_at: '2033-06-01T00:00:00Z', ends_at: '2033-06-03T00:00:00Z' })).body;
    // An end before the stored start.
    const early = await t.api.patch(`/api/changes/blackouts/${made.id}`, { ends_at: '2033-05-30T00:00:00Z' });
    expect(early.status).toBe(400);
    expect(early.body.error.fields.ends_at).toBeDefined();
    // A weekly repeat longer than a week.
    const long = await t.api.patch(`/api/changes/blackouts/${made.id}`, { repeat: 'weekly', ends_at: '2033-06-20T00:00:00Z' });
    expect(long.body.error.fields.repeat).toBeDefined();
    expect((await t.api.patch(`/api/changes/blackouts/${made.id}`, { name: '' })).status).toBe(400);
    expect((await t.api.patch(`/api/changes/blackouts/${made.id}`, { system_ids: ['not-an-id'] })).body.error.fields.system_ids).toBeDefined();
    expect((await t.api.patch(`/api/changes/blackouts/${made.id}`, { system_ids: [MISSING] })).body.error.fields.system_ids).toBeDefined();
    expect(new Date((await t.db.one<any>('select ends_at from change_blackouts where id = $1', [made.id])).ends_at).toISOString()).toBe('2033-06-03T00:00:00.000Z');

    expect((await t.api.patch(`/api/changes/blackouts/${MISSING}`, { name: 'x' })).status).toBe(404);
    expect((await t.api.patch('/api/changes/blackouts/nope', { name: 'x' })).status).toBe(404);
  });

  it('needs changes.administer', async () => {
    const made = (await t.api.post('/api/changes/blackouts', { name: 'Invented permission check', starts_at: '2033-07-01T00:00:00Z', ends_at: '2033-07-02T00:00:00Z' })).body;
    for (const role of ['project_manager', 'approver']) { // changes.view; changes.view and approve
      const c = await t.as(role);
      expect((await c.patch(`/api/changes/blackouts/${made.id}`, { name: 'Renamed' })).status).toBe(403);
      expect((await c.del(`/api/changes/blackouts/${made.id}`)).status).toBe(403);
    }
    expect((await t.db.one<any>('select name, deleted_at from change_blackouts where id = $1', [made.id]))).toEqual({ name: 'Invented permission check', deleted_at: null });
    const agent = await t.as('agent'); // changes.*
    expect((await agent.patch(`/api/changes/blackouts/${made.id}`, { name: 'Renamed by the agent' })).status).toBe(200);
  });
});

describe('DELETE /api/changes/blackouts/:blackoutId', () => {
  it('removes a period from the list and from conflict checks, keeps the row, and audits', async () => {
    const made = (await t.api.post('/api/changes/blackouts', { name: 'Invented depot move', starts_at: '2033-09-10T00:00:00Z', ends_at: '2033-09-12T00:00:00Z' })).body;
    expect(await kinds('2033-09-11')).toEqual(['blackout']);
    const res = await t.api.del(`/api/changes/blackouts/${made.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect((await t.api.get('/api/changes/blackouts')).body.some((b: any) => b.id === made.id)).toBe(false);
    expect(await kinds('2033-09-11')).toEqual([]);
    expect((await t.db.one<any>('select deleted_at from change_blackouts where id = $1', [made.id])).deleted_at).not.toBeNull();
    const ev = await audits('change.blackout_delete', made.id);
    expect(ev).toHaveLength(1);
    expect(ev[0].summary).toBe('Blackout period deleted: Invented depot move');

    // Gone: a second delete or a change answers not found.
    expect((await t.api.del(`/api/changes/blackouts/${made.id}`)).status).toBe(404);
    expect((await t.api.patch(`/api/changes/blackouts/${made.id}`, { name: 'Back' })).status).toBe(404);
  });
});
