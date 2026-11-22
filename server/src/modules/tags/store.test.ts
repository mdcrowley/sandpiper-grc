import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { sequenceValue } from '../../../../shared/tag-format.ts';
import { stockStatus, takeFromSeries } from './store.ts';

// Tag formats (E37-02), tag stock and series (E37-03) and the area's settings. Invented values only.

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

const format = (body: Record<string, unknown>) => t.api.post('/api/asset-tags/formats', { name: 'Test format', characters: 'digits', ...body });

describe('tag formats', () => {
  it('adds, changes, lists and removes a format, audited', async () => {
    const made = await format({ name: 'Equipment tags', prefix: 'TA-', lengthMin: 6, lengthMax: 6, checkCharacter: 'mod10', carrier: 'both', recordTypes: ['asset', 'vehicle'] });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ name: 'Equipment tags', prefix: 'TA-', lengthMin: 6, checkCharacter: 'mod10', recordTypes: ['asset', 'vehicle'], active: true });
    const changed = await t.api.patch(`/api/asset-tags/formats/${made.body.id}`, { active: false });
    expect(changed.body).toMatchObject({ active: false, prefix: 'TA-' });
    expect((await t.api.get('/api/asset-tags/formats')).body.map((f: any) => f.id)).toContain(made.body.id);
    expect((await t.api.del(`/api/asset-tags/formats/${made.body.id}`)).status).toBe(200);
    expect((await t.api.get('/api/asset-tags/formats')).body.map((f: any) => f.id)).not.toContain(made.body.id);
    const audit = await t.db.query<{ action: string }>(`select action from audit_events where action like 'tag.format.%' order by id`);
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['tag.format.create', 'tag.format.update', 'tag.format.delete']));
  });

  it('refuses unsafe or malformed settings with field messages', async () => {
    const bad = await format({ characters: 'pattern', pattern: '(a+)+$', lengthMin: 7, lengthMax: 3, checkCharacter: 'mod11', recordTypes: ['ticket'] });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['lengthMax', 'pattern', 'recordTypes']);
    const tooLong = await format({ characters: 'pattern', pattern: 'A'.repeat(121) });
    expect(tooLong.body.error.fields.pattern).toMatch(/at most 120/);
    expect((await format({ characters: 'alphanumeric', checkCharacter: 'mod10' })).body.error.fields.checkCharacter).toMatch(/mod 36/);
    expect((await format({ extractPattern: 'TAG:\\d+' })).body.error.fields.extractPattern).toMatch(/brackets/);
    expect((await format({ name: '' })).body.error.fields.name).toBeTruthy();
  });

  it('tries a value against every format, saying why one does not match', async () => {
    const mod10 = (await format({ name: 'Mod 10 tags', prefix: 'TA-', lengthMin: 7, lengthMax: 7, checkCharacter: 'mod10', carrier: 'any', extractPattern: 'ID=(\\d+)' })).body;
    const mod11 = (await format({ name: 'Mod 11 tags', lengthMin: 6, lengthMax: 6, checkCharacter: 'mod11' })).body;
    const mod36 = (await format({ name: 'Mod 36 tags', characters: 'alphanumeric', prefix: 'SB', lengthMin: 7, lengthMax: 7, checkCharacter: 'mod36', carrier: 'text' })).body;
    const good10 = sequenceValue(118342, { prefix: 'TA-', digits: 6, checkCharacter: 'mod10' });
    const good11 = sequenceValue(45120, { digits: 5, checkCharacter: 'mod11' });
    const good36 = sequenceValue(4512, { prefix: 'SB-', digits: 6, checkCharacter: 'mod36' });
    const tryIt = async (value: string, source?: string, formatId?: string) => (await t.api.post('/api/asset-tags/formats/try', { value, source, formatId })).body;
    const result = (r: any, id: string) => r.results.find((x: any) => x.formatId === id);

    expect(result(await tryIt(good10), mod10.id)).toMatchObject({ ok: true });
    expect(result(await tryIt(good11), mod11.id)).toMatchObject({ ok: true });
    expect(result(await tryIt(good36), mod36.id)).toMatchObject({ ok: true });
    const wrongCheck = good10.slice(0, -1) + String((Number(good10.slice(-1)) + 1) % 10);
    const r = await tryIt(wrongCheck);
    expect(r.key).toBe(wrongCheck.replace('-', ''));
    expect(result(r, mod10.id)).toMatchObject({ ok: false, reason: 'check' });
    expect(result(r, mod10.id).message).toMatch(new RegExp(`expected ${good10.slice(-1)}`));
    expect(result(await tryIt('TA-12'), mod10.id)).toMatchObject({ ok: false, reason: 'length' });
    expect(result(await tryIt('XX-1183421'), mod10.id)).toMatchObject({ ok: false, reason: 'prefix' });
    // Text-only tags: a value read from a code is refused by the carrier; typed values are always checked by shape only.
    expect(result(await tryIt(good36, 'code'), mod36.id)).toMatchObject({ ok: false, reason: 'carrier' });
    // A code holding more than the value: the extraction pattern takes the marked part.
    const code = await tryIt(`SUPPLIER;ID=${good10.slice(3)};LOT 7`, 'code', mod10.id);
    expect(code.results).toHaveLength(1);
    expect(code.results[0]).toMatchObject({ ok: false, extracted: good10.slice(3) });
    const prefixed = (await format({ name: 'Codes', lengthMin: 7, lengthMax: 7, checkCharacter: 'mod10', extractPattern: 'ID=(\\d+)' })).body;
    expect((await tryIt(`SUPPLIER;ID=${good10.slice(3)};LOT 7`, 'code', prefixed.id)).results[0]).toMatchObject({ ok: true, extracted: good10.slice(3) });
    // A pattern format, and a pattern that could backtrack badly answers quickly (no match).
    const pat = (await format({ name: 'Pattern tags', characters: 'pattern', pattern: '^K\\d[A-Z]\\d[A-Z]\\d$' })).body;
    expect(result(await tryIt('k7q-2m9'), pat.id)).toMatchObject({ ok: true });
    expect(result(await tryIt('K7Q2MM'), pat.id)).toMatchObject({ ok: false, reason: 'pattern' });
    const started = Date.now();
    await tryIt('9'.repeat(1900));
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('needs tags.view to read and tags.manage to change', async () => {
    const agent = await t.as('agent');
    expect((await agent.get('/api/asset-tags/formats')).status).toBe(200);
    expect((await agent.post('/api/asset-tags/formats', { name: 'X', characters: 'digits' })).status).toBe(403);
    const requester = await t.as('requester');
    expect((await requester.get('/api/asset-tags/formats')).status).toBe(403);
    const manager = await t.as('asset_manager');
    expect((await manager.post('/api/asset-tags/formats', { name: 'Site tags', characters: 'digits' })).status).toBe(201);
  });

  it('checks typed values on records against the active formats for the type', async () => {
    const asset = await t.api.post('/api/assets', { name: 'Typed tag (test)', tag: 'QX-17' });
    expect(asset.status).toBe(400);
    expect(asset.body.error.fields.tag).toMatch(/does not match any tag format/);
    // The formats above are switched off, so the stock tests below type what they like.
    for (const f of (await t.api.get('/api/asset-tags/formats')).body) await t.api.patch(`/api/asset-tags/formats/${f.id}`, { active: false });
    expect((await t.api.post('/api/assets', { name: 'Typed tag (test)', tag: 'QX-17' })).status).toBe(201);
  });
});

describe('tag stock', () => {
  it('registers a bought sequence and a list, and refuses overlaps by value key', async () => {
    const seq = await t.api.post('/api/asset-tags/ranges', { kind: 'sequence', prefix: 'TB-', digits: 6, first: 10000, last: 10999, supplierNote: 'Box 1 of 2 (invented supplier)', receivedOn: '2026-11-02' });
    expect(seq.status).toBe(201);
    expect(seq.body).toMatchObject({ kind: 'sequence', firstValue: 'TB-010000', lastValue: 'TB-010999', size: 1000, source: 'bought', counts: { attached: 0, available: 1000, void: 0, lost: 0 }, receivedOn: '2026-11-02' });
    // Overlap with the sequence, written differently (no dash, lower case): refused.
    const overlap = await t.api.post('/api/asset-tags/ranges', { kind: 'sequence', prefix: 'tb', digits: 6, first: 10990, last: 11010 });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.code).toBe('overlap');
    expect(overlap.body.error.message).toContain('TB010990');
    const list = await t.api.post('/api/asset-tags/ranges', { kind: 'list', values: ['K7Q2M9', 'k7q-3m1', 'X9P4R2'] });
    expect(list.status).toBe(201);
    expect(list.body).toMatchObject({ kind: 'list', size: 3 });
    expect((await t.api.post('/api/asset-tags/ranges', { kind: 'list', values: ['tb 010 500'] })).status).toBe(409);
    expect((await t.api.post('/api/asset-tags/ranges', { kind: 'list', values: ['K7Q3M1'] })).status).toBe(409);
    const dupes = await t.api.post('/api/asset-tags/ranges', { kind: 'list', values: ['A1B2C3', 'a1b2-c3'] });
    expect(dupes.body.error.fields.values).toMatch(/more than once/);
    const tooBig = await t.api.post('/api/asset-tags/ranges', { kind: 'sequence', digits: 7, first: 1, last: 200_000 });
    expect(tooBig.body.error.fields.last).toMatch(/at most 100,000/);
    expect((await stockStatus(t.db, 'TB010500')).inStock).toBe(true);
    expect((await stockStatus(t.db, 'K7Q3M1')).inStock).toBe(true);
    expect((await stockStatus(t.db, 'TB011000')).inStock).toBe(false);
  });

  it('refuses stock that overlaps a value attached to a record, and counts attached, void and lost', async () => {
    const made = await t.api.post('/api/assets', { name: 'Fare machine (test)', tag: 'TC-000005' });

    const asset = made.body;
    expect(asset.tag).toBe('TC-000005');
    const clash = await t.api.post('/api/asset-tags/ranges', { kind: 'sequence', prefix: 'TC-', digits: 6, first: 1, last: 10 });
    expect(clash.status).toBe(409);
    expect(clash.body.error.message).toContain('TC000005');
    const range = (await t.api.post('/api/asset-tags/ranges', { kind: 'sequence', prefix: 'TC-', digits: 6, first: 11, last: 20 })).body;
    await t.api.patch(`/api/assets/${asset.id}`, { tag: 'TC-000011' });
    const marked = await t.api.post('/api/asset-tags/stock/mark', { values: ['TC-000012', 'TC-000013'], status: 'void', reason: 'Torn' });
    expect(marked.body).toEqual({ marked: 2 });
    await t.api.post('/api/asset-tags/stock/mark', { values: ['TC-000014'], status: 'lost' });
    expect((await t.api.post('/api/asset-tags/stock/mark', { values: ['TC-000011'], status: 'void' })).body.error.fields.values).toMatch(/Attached/);
    expect((await t.api.post('/api/asset-tags/stock/mark', { values: ['TZ-1'], status: 'void' })).body.error.fields.values).toMatch(/Not in your tag stock/);
    const listed = (await t.api.get('/api/asset-tags/ranges')).body.find((r: any) => r.id === range.id);
    expect(listed.counts).toEqual({ attached: 1, available: 6, void: 2, lost: 1 });
    const values = (await t.api.get(`/api/asset-tags/ranges/${range.id}/values?state=attached,lost`)).body;
    expect(values.total).toBe(2);
    expect(values.rows[0]).toMatchObject({ value: 'TC-000011', state: 'attached', recordType: 'asset', recordId: asset.id, route: `/assets/${asset.id}` });
    expect(values.rows[1]).toMatchObject({ value: 'TC-000014', state: 'lost' });
    // A void value cannot be attached until it is available again.
    const blocked = await t.api.patch(`/api/assets/${asset.id}`, { tag: 'TC-000012' });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.fields.tag).toMatch(/marked void/);
    await t.api.post('/api/asset-tags/stock/mark', { values: ['TC-000012'], status: 'available' });
    expect((await t.api.patch(`/api/assets/${asset.id}`, { tag: 'TC-000012' })).status).toBe(200);
    // Attached values keep the stock: it cannot be removed. The replaced value counts as void.
    expect((await t.api.del(`/api/asset-tags/ranges/${range.id}`)).body.error.code).toBe('in_use');
    const after = (await t.api.get('/api/asset-tags/ranges')).body.find((r: any) => r.id === range.id);
    expect(after.counts).toEqual({ attached: 1, available: 6, void: 2, lost: 1 }); // 11 replaced (void), 12 attached, 13 void, 14 lost
  });

  it('removes stock nothing is attached to, freeing its values', async () => {
    const r = (await t.api.post('/api/asset-tags/ranges', { kind: 'list', values: ['Q1W2E3', 'Q1W2E4'], note: 'Test list' })).body;
    expect((await t.api.patch(`/api/asset-tags/ranges/${r.id}`, { note: 'Changed', receivedOn: '2026-10-01' })).body).toMatchObject({ note: 'Changed', receivedOn: '2026-10-01' });
    expect((await t.api.del(`/api/asset-tags/ranges/${r.id}`)).status).toBe(200);
    expect((await t.api.post('/api/asset-tags/ranges', { kind: 'list', values: ['Q1W2E3'] })).status).toBe(201);
  });

  it('checks stock values against the chosen format', async () => {
    const f = (await format({ name: 'Six digits mod 10', lengthMin: 7, lengthMax: 7, checkCharacter: 'mod10' })).body;
    const r = await t.api.post('/api/asset-tags/ranges', { kind: 'sequence', formatId: f.id, digits: 6, first: 500000, last: 500009 });
    expect(r.status).toBe(201);
    expect(r.body.firstValue).toBe(sequenceValue(500000, { digits: 6, checkCharacter: 'mod10' }));
    expect((await t.api.post('/api/asset-tags/ranges', { kind: 'sequence', formatId: f.id, digits: 5, first: 1, last: 2 })).body.error.fields.formatId).toBeTruthy();
    expect((await t.api.post('/api/asset-tags/ranges', { kind: 'list', formatId: f.id, values: ['1234567'] })).body.error.fields.values).toMatch(/do not match/);
    expect((await t.api.del(`/api/asset-tags/formats/${f.id}`)).body.error.code).toBe('in_use');
  });
});

describe('series', () => {
  it('adds a series and takes numbers safely when two people print at once', async () => {
    const s = await t.api.post('/api/asset-tags/series', { name: 'Printed equipment tags', prefix: 'PR-', digits: 5, nextNumber: 1 });
    expect(s.status).toBe(201);
    expect(s.body).toMatchObject({ nextValue: 'PR-00001', nextNumber: 1, active: true });
    const [a, b] = await Promise.all([takeFromSeries(t.ctx, s.body.id, 30, null), takeFromSeries(t.ctx, s.body.id, 30, null)]);
    const all = [...a.values, ...b.values];
    expect(new Set(all).size).toBe(60);
    expect(all.sort()[0]).toBe('PR-00001');
    expect(all.sort()[59]).toBe('PR-00060');
    const series = (await t.api.get('/api/asset-tags/series')).body.find((x: any) => x.id === s.body.id);
    expect(series).toMatchObject({ nextNumber: 61, nextValue: 'PR-00061' });
    const ranges = (await t.api.get('/api/asset-tags/ranges')).body.filter((r: any) => r.seriesId === s.body.id);
    expect(ranges).toHaveLength(2);
    expect(ranges.every((r: any) => r.source === 'printed' && r.size === 30)).toBe(true);
  });

  it('refuses to print numbers already in stock without using any, and stops at the end of the digits', async () => {
    const s = (await t.api.post('/api/asset-tags/series', { name: 'Overlapping series', prefix: 'TB-', digits: 6, nextNumber: 10995 })).body;
    await expect(takeFromSeries(t.ctx, s.id, 3, null)).rejects.toMatchObject({ status: 409 });
    expect((await t.api.get('/api/asset-tags/series')).body.find((x: any) => x.id === s.id).nextNumber).toBe(10995);
    expect((await t.api.patch(`/api/asset-tags/series/${s.id}`, { nextNumber: 11000 })).body.nextValue).toBe('TB-011000');
    expect((await takeFromSeries(t.ctx, s.id, 2, null)).values).toEqual(['TB-011000', 'TB-011001']);
    const small = (await t.api.post('/api/asset-tags/series', { name: 'Two digits', prefix: 'ZZ', digits: 2, nextNumber: 98 })).body;
    await expect(takeFromSeries(t.ctx, small.id, 5, null)).rejects.toMatchObject({ status: 409 });
    const off = (await t.api.patch(`/api/asset-tags/series/${small.id}`, { active: false })).body;
    expect(off.active).toBe(false);
    await expect(takeFromSeries(t.ctx, small.id, 1, null)).rejects.toMatchObject({ status: 404 });
  });
});

describe('settings', () => {
  it('reads and changes the area settings', async () => {
    expect((await t.api.get('/api/asset-tags/settings')).body).toEqual({ severalPerRecord: false, logLookups: true, lookupDays: 90, printLimit: 1000 });
    const put = await t.api.put('/api/asset-tags/settings', { lookupDays: 30, printLimit: 500 });
    expect(put.body).toMatchObject({ lookupDays: 30, printLimit: 500 });
    expect((await t.api.put('/api/asset-tags/settings', { lookupDays: 0 })).status).toBe(400);
    await t.api.put('/api/asset-tags/settings', { lookupDays: 90, printLimit: 1000 });
  });
});
