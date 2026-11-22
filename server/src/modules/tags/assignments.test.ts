import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// Tag values on records (E37-01) and attach, replace and end (E37-07). Invented values only.

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

const setFeatures = async (features: Record<string, boolean>) => {
  const res = await t.api.patch('/api/admin/features', { features });
  await t.api.get('/api/auth/state');
  return res;
};
const asset = async (body: Record<string, unknown>) => (await t.api.post('/api/assets', { name: 'Test asset', ...body })).body;
const vehicle = async (body: Record<string, unknown>) => (await t.api.post('/api/vehicles', { fleet_number: `T-${Math.floor(Math.random() * 1e9)}`, mode: 'bus', ...body })).body;
const site = async (body: Record<string, unknown>) => (await t.api.post('/api/sites', { name: 'Test site', ...body })).body;
const active = (key: string) => t.db.query<any>(`select * from tag_assignments where value_key = $1 and status = 'active'`, [key]);
const record = async (type: string, id: string) => (await t.api.get(`/api/asset-tags/record?type=${type}&id=${id}`)).body;

describe('tag values on records', () => {
  it('claims a value on create, unique across every taggable type, compared by value key', async () => {
    const a = await asset({ tag: 'TA-118342' });
    expect(a.tag).toBe('TA-118342');
    expect(await active('TA118342')).toMatchObject([{ record_type: 'asset', record_id: a.id, is_primary: true }]);
    // The same tag written another way, on a vehicle: refused on the field, whoever may see the asset.
    const v = await t.api.post('/api/vehicles', { fleet_number: 'T-1001', mode: 'bus', tag_number: 'ta 118_342' });
    expect(v.status).toBe(400);
    expect(v.body.error.fields.tag_number).toBe('Tag ta 118_342 is already in use.');
    // A decoded code holding the same value, attached through the tag routes: refused the same way.
    const s = await site({ name: 'Depot A (test)' });
    const code = await t.api.post('/api/asset-tags/attach', { recordType: 'site', recordId: s.id, value: 'TA‑118342', source: 'code' });
    expect(code.status).toBe(409);
    expect(code.body.error.code).toBe('in_use');
    expect(code.body.error.message).toMatch(/^Tag TA.118342 is already in use\.$/);
    // Leading zeros count.
    expect((await t.api.post('/api/vehicles', { fleet_number: 'T-1002', mode: 'bus', tag_number: '0118342TA' })).status).toBe(201);
  });

  it('numbers assets created without a tag, skipping values in use elsewhere', async () => {
    const next = await t.db.one<{ value: number }>(`select value from counters where key = 'AST-'`);
    const n = (next?.value ?? 0) + 1;
    const taken = `AST-${String(n).padStart(5, '0')}`;
    await vehicle({ tag_number: taken });
    const a = await asset({});
    expect(a.tag).toMatch(/^AST-\d{5}$/);
    expect(a.tag).not.toBe(taken);
    expect(await active(a.tag.replace('-', ''))).toHaveLength(1);
  });

  it('keeps the history when the field changes: replaced, then ended when cleared', async () => {
    const v = await vehicle({ tag_number: 'SB-004512' });
    const changed = await t.api.patch(`/api/vehicles/${v.id}`, { tag_number: 'SB-004513' });
    expect(changed.status).toBe(200);
    let tags = await record('vehicle', v.id);
    expect(tags.current.map((x: any) => x.value)).toEqual(['SB-004513']);
    expect(tags.earlier).toMatchObject([{ value: 'SB-004512', status: 'replaced', replacedByValue: 'SB-004513' }]);
    // The replaced value is free for another record now.
    expect((await vehicle({ tag_number: 'SB004512' })).tag_number).toBe('SB004512');
    await t.api.patch(`/api/vehicles/${v.id}`, { tag_number: null });
    tags = await record('vehicle', v.id);
    expect(tags.current).toEqual([]);
    expect(tags.earlier.map((x: any) => [x.value, x.status])).toEqual([['SB-004513', 'ended'], ['SB-004512', 'replaced']]);
    const actions = (await t.db.query<{ action: string }>(`select action from audit_events where record_type = 'vehicle' and record_id = $1 and action like 'tag.%' order by id`, [v.id])).map((x) => x.action);
    expect(actions).toEqual(['tag.attach', 'tag.replace', 'tag.end']);
  });

  it('never lets an unclaimed value that clashes stop an edit of other fields', async () => {
    const a = await asset({ tag: 'DUP-1' });
    const b = await asset({ tag: 'DUP-2' });
    // Two values that became the same before tags were unique across types (written directly).
    await t.db.query(`update assets set tag = 'dup 1' where id = $1`, [b.id]);
    await t.db.query(`delete from tag_assignments where record_id = $1`, [b.id]);
    const r = await t.app.tagsReconcile!();
    expect(r.clashes).toContain('dup 1');
    const edit = await t.api.patch(`/api/assets/${b.id}`, { tag: 'dup 1', location: 'Shelf 3' });
    expect(edit.status).toBe(200);
    expect(edit.body.location).toBe('Shelf 3');
    expect((await active('DUP1'))[0].record_id).toBe(a.id);
  });
});

describe('attach, replace and end', () => {
  it('attaches, refuses a second tag unless several are allowed, replaces and ends, all audited', async () => {
    const s = await site({ name: 'Station B (test)' });
    const attached = await t.api.post('/api/asset-tags/attach', { recordType: 'site', recordId: s.id, value: 'K7Q2M9', source: 'text' });
    expect(attached.status).toBe(201);
    expect(attached.body).toMatchObject({ value: 'K7Q2M9', status: 'active', primary: true, source: 'text', recordType: 'site', assignedByName: 'Test Admin' });
    expect((await t.api.get(`/api/sites/${s.id}`)).body.tag_number).toBe('K7Q2M9');
    expect((await t.api.post('/api/asset-tags/attach', { recordType: 'site', recordId: s.id, value: 'K7Q2M9' })).body.error.code).toBe('in_use');
    const second = await t.api.post('/api/asset-tags/attach', { recordType: 'site', recordId: s.id, value: 'K7Q3M1' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('one_per_record');

    await t.api.put('/api/asset-tags/settings', { severalPerRecord: true });
    const extra = await t.api.post('/api/asset-tags/attach', { recordType: 'site', recordId: s.id, value: 'K7Q3M1' });
    expect(extra.status).toBe(201);
    expect(extra.body.primary).toBe(false);
    expect((await t.api.put('/api/asset-tags/settings', { severalPerRecord: false })).body?.error?.fields?.severalPerRecord).toMatch(/more than one tag/);

    // Replace the extra one: the old value is marked replaced, pointing at the new one.
    const replaced = await t.api.post('/api/asset-tags/replace', { assignmentId: extra.body.id, value: 'K7Q4M2', reason: 'Label peeled' });
    expect(replaced.status).toBe(200);
    expect(replaced.body).toMatchObject({ value: 'K7Q4M2', primary: false });
    // Replace the primary: the record's field follows.
    const prim = await t.api.post('/api/asset-tags/replace', { assignmentId: attached.body.id, value: 'K7Q5M3', source: 'typed' });
    expect(prim.body).toMatchObject({ value: 'K7Q5M3', primary: true });
    expect((await t.api.get(`/api/sites/${s.id}`)).body.tag_number).toBe('K7Q5M3');
    // End the primary as void: the other active value takes its place on the record.
    expect((await t.api.post('/api/asset-tags/end', { assignmentId: prim.body.id, status: 'void' })).body.error.fields.reason).toBeTruthy();
    const ended = await t.api.post('/api/asset-tags/end', { assignmentId: prim.body.id, status: 'void', reason: 'Damaged in cleaning' });
    expect(ended.status).toBe(200);
    expect(ended.body).toMatchObject({ value: 'K7Q5M3', status: 'void', reason: 'Damaged in cleaning', primary: false });
    expect((await t.api.get(`/api/sites/${s.id}`)).body.tag_number).toBe('K7Q4M2');
    const tags = await record('site', s.id);
    expect(tags.current).toMatchObject([{ value: 'K7Q4M2', primary: true }]);
    expect(tags.earlier.map((x: any) => `${x.value} ${x.status}`).sort()).toEqual(['K7Q2M9 replaced', 'K7Q3M1 replaced', 'K7Q5M3 void']);
    expect(tags).toMatchObject({ canManage: true, held: false });
    // End the last one as lost: the field is cleared.
    const lost = await t.api.post('/api/asset-tags/end', { assignmentId: tags.current[0].id, status: 'lost', reason: 'Not found at the count' });
    expect(lost.body.status).toBe('lost');
    expect((await t.api.get(`/api/sites/${s.id}`)).body.tag_number).toBeNull();
    expect((await t.api.post('/api/asset-tags/end', { assignmentId: tags.current[0].id, status: 'lost', reason: 'again' })).body.error.code).toBe('not_active');
    const actions = (await t.db.query<{ action: string }>(`select action from audit_events where record_type = 'site' and record_id = $1 and action like 'tag.%' order by id`, [s.id])).map((x) => x.action);
    expect(actions).toEqual(['tag.attach', 'tag.attach', 'tag.replace', 'tag.replace', 'tag.end', 'tag.end']);
    await t.api.put('/api/asset-tags/settings', { severalPerRecord: false });
  });

  it('lets one of two people attaching the same value at once win', async () => {
    const [a, b] = [await asset({}), await vehicle({})];
    const [ra, rb] = await Promise.all([
      t.api.post('/api/asset-tags/attach', { recordType: 'vehicle', recordId: b.id, value: 'RACE-777' }),
      t.api.patch(`/api/assets/${a.id}`, { tag: 'race 777' }),
    ]);
    const statuses = [ra.status, rb.status].sort();
    expect(statuses[0]).toBeLessThan(300);
    expect(statuses[1]).toBeGreaterThanOrEqual(400);
    expect(await active('RACE777')).toHaveLength(1);
    const [x, y] = [await vehicle({}), await vehicle({})];
    const both = await Promise.all([x, y].map((v) => t.api.post('/api/asset-tags/attach', { recordType: 'vehicle', recordId: v.id, value: 'RACE-778' })));
    expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(both.find((r) => r.status === 409)!.body.error.code).toBe('in_use');
  });

  it('needs tags.manage and edit on the record; the record itself needs view', async () => {
    const v = await vehicle({ tag_number: 'PERM-1' });
    const agent = await t.as('agent');
    expect((await agent.post('/api/asset-tags/attach', { recordType: 'vehicle', recordId: v.id, value: 'PERM-2' })).status).toBe(403);
    expect((await t.api.get(`/api/asset-tags/record?type=vehicle&id=00000000-0000-4000-8000-000000000000`)).status).toBe(404);
    expect((await t.api.get(`/api/asset-tags/record?type=ticket&id=${v.id}`)).status).toBe(404);
    const requester = await t.as('requester');
    expect((await requester.get(`/api/asset-tags/record?type=vehicle&id=${v.id}`)).status).toBe(404);
  });
});

describe('legal holds and retention', () => {
  it('refuses to attach, replace or end the tags of a held record, on the field too', async () => {
    const v = await vehicle({ tag_number: 'HOLD-1' });
    const hold = (await t.api.post('/api/legal-holds', { matter: 'Test matter' })).body;
    expect((await t.api.post(`/api/legal-holds/${hold.id}/records`, { records: [{ type: 'vehicle', id: v.id }] })).status).toBeLessThan(300);
    const tags = await record('vehicle', v.id);
    expect(tags).toMatchObject({ held: true, canManage: false });
    const id = tags.current[0].id;
    for (const res of [
      await t.api.post('/api/asset-tags/replace', { assignmentId: id, value: 'HOLD-2' }),
      await t.api.post('/api/asset-tags/end', { assignmentId: id, status: 'ended', reason: 'Test' }),
      await t.api.patch(`/api/vehicles/${v.id}`, { tag_number: 'HOLD-3' }),
      await t.api.patch(`/api/vehicles/${v.id}`, { tag_number: null }),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('on_hold');
      expect(res.body.error.message).not.toContain('Test matter');
    }
    const fresh = await vehicle({});
    await t.api.post(`/api/legal-holds/${hold.id}/records`, { records: [{ type: 'vehicle', id: fresh.id }] });
    expect((await t.api.post('/api/asset-tags/attach', { recordType: 'vehicle', recordId: fresh.id, value: 'HOLD-4' })).body.error.code).toBe('on_hold');
    // Other fields of a held record still change.
    expect((await t.api.patch(`/api/vehicles/${v.id}`, { tag_number: 'HOLD-1', notes: 'Checked' })).status).toBe(200);
    expect((await active('HOLD1'))[0].record_id).toBe(v.id);
  });

  it('ends the tags of a deleted record, freeing the value', async () => {
    const a = await asset({ tag: 'GONE-1' });
    expect((await t.api.del(`/api/assets/${a.id}`)).status).toBeLessThan(300);
    expect(await active('GONE1')).toEqual([]);
    const ended = await t.db.one<any>(`select status, reason from tag_assignments where record_id = $1`, [a.id]);
    expect(ended).toMatchObject({ status: 'ended', reason: 'Record deleted' });
    expect((await asset({ tag: 'GONE-1' })).tag).toBe('GONE-1');
  });

  it('ends the tags of an anonymized record and clears its tag number', async () => {
    const s = await site({ name: 'Old cabinet (test)', tag_number: 'ANON-1' });
    await t.core.retention.anonymize(t.ctx.resources.get('site')!, s.id);
    expect(await active('ANON1')).toEqual([]);
    expect((await t.db.one<any>('select tag_number from sites where id = $1', [s.id])).tag_number).toBeNull();
    // The reconcile step leaves an ended value ended.
    await t.app.tagsReconcile!();
    expect(await active('ANON1')).toEqual([]);
  });
});

describe('switched off', () => {
  it('claims nothing while asset tags are off, and catches up when they are on again', async () => {
    const a = await asset({ tag: 'OFF-1' });
    expect((await setFeatures({ tags: false })).status).toBe(200);
    try {
      expect((await t.api.get(`/api/asset-tags/record?type=asset&id=${a.id}`)).status).toBe(404);
      const changed = await t.api.patch(`/api/assets/${a.id}`, { tag: 'OFF-2' });
      expect(changed.body.tag).toBe('OFF-2');
      expect((await active('OFF1'))[0].record_id).toBe(a.id);
      expect(await active('OFF2')).toEqual([]);
      expect((await t.api.get('/api/meta')).body.resources.vehicle.fields.tag_number).toBeUndefined();
    } finally {
      expect((await setFeatures({ tags: true })).status).toBe(200);
    }
    await t.app.tagsReconcile!();
    expect((await active('OFF2'))[0].record_id).toBe(a.id);
    expect((await t.db.one<any>(`select status from tag_assignments where value_key = 'OFF1'`)).status).toBe('replaced');
  });
});
