import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, SESSION_COOKIE } from '../auth.ts';
import { testApp } from '../../test/helpers.ts';
import { gizmos } from '../export/testing.ts';
import { writeXlsx } from '../export/xlsx.ts';
import { parseCsv, sniffDelimiter } from './read.ts';
import { parseDate, parseDateTime, parseNumber } from './service.ts';

let t: Awaited<ReturnType<typeof testApp>>;
let adminId = '';
const b64 = (s: string | Uint8Array) => Buffer.from(s).toString('base64');
const csvFile = (text: string, fileName = 'gizmos.csv') => ({ fileName, content: b64(text) });
const MAPPING = { Name: 'name', Status: 'status', Owner: 'owner_id', Due: 'due_on', Cost: 'cost', 'In service': 'active', Parent: 'parent_id' };

beforeAll(async () => {
  t = await testApp({ extraModules: [gizmos] });
  adminId = (await t.db.one<{ id: string }>("select id from users where username = 'admin'"))!.id;
  await t.api.post('/api/gizmos', { name: 'Ticket vending machine', status: 'open' });
  await t.api.post('/api/gizmos', { name: 'Hidden radio gateway', status: 'open', restricted: true });
});
afterAll(async () => { await t.close(); });

describe('reading values', () => {
  it('parses CSV with quotes, doubled quotes and line breaks, and finds the delimiter', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi""\nthere"\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"\nthere']]);
    expect(sniffDelimiter('Name;Status;Cost\nx;y;z')).toBe(';');
  });
  it('accepts common date, number and amount forms', () => {
    expect(['2026-03-04', '2026/3/4', '3/4/2026', '4 Mar 2026', '2026-02-30'].map(parseDate)).toEqual(['2026-03-04', '2026-03-04', '2026-03-04', '2026-03-04', null]);
    expect(parseDateTime('2026-03-04 09:30')).toBe('2026-03-04T14:30:00.000Z'); // organisation time zone (tests: New York)
    expect(parseDateTime('2026-03-04T09:30:00Z')).toBe('2026-03-04T09:30:00.000Z');
    expect([parseNumber('1,234.5'), parseNumber('(12)'), parseNumber('$1,200', true), parseNumber('12 apples')]).toEqual([1234.5, -12, 1200, null]);
  });
});

describe('generic import', () => {
  it('reads a file and suggests a mapping by label', async () => {
    const res = await t.api.post('/api/import/gizmo/read', csvFile('Name,Status,Owner,Due,Cost,Something else\nA,Open,admin,2026-01-01,5,x\n'));
    expect(res.status).toBe(200);
    expect(res.body.headers).toEqual(['Name', 'Status', 'Owner', 'Due', 'Cost', 'Something else']);
    expect(res.body.suggested).toEqual({ Name: 'name', Status: 'status', Owner: 'owner_id', Due: 'due_on', Cost: 'cost' });
    expect(res.body.rowCount).toBe(1);
    expect(res.body.modes).toEqual(['create', 'update', 'upsert']);
    expect(res.body.matchKeys.map((k: { name: string }) => k.name)).toEqual(['id', 'ref', 'name']);
    expect(res.body.fields.find((f: { name: string }) => f.name === 'name').required).toBe(true);
  });

  it('checks every row in a dry run and writes nothing', async () => {
    const before = (await t.api.get('/api/gizmos')).body.total;
    const csv = [
      'Name,Status,Owner,Due,Cost,In service,Parent',
      'Depot camera,In repair,admin@example.test,14/3/2026x,"$1,200.50",yes,Ticket vending machine',
      'Bus stop sign,Broken,Test Admin,2026-03-01,12,no,',
      ',Open,,,,,',
      'Bus stop sign,Open,,,,,',
      'Ferry pass reader,open,nobody@example.test,,,maybe,Hidden radio gateway',
    ].join('\n');
    const res = await t.api.post('/api/import/gizmo', { ...csvFile(csv), mapping: MAPPING, mode: 'create', matchKey: 'name', dryRun: true });
    expect(res.status).toBe(200);
    expect((await t.api.get('/api/gizmos')).body.total).toBe(before);
    const [camera, sign, blank, repeat, ferry] = res.body.rows;
    expect(camera).toMatchObject({ line: 2, action: 'error' });
    expect(camera.errors.due_on).toContain('is not a date');
    expect(sign.errors.status).toBe('Status: "Broken" is not an allowed value.');
    expect(blank.action).toBe('error');
    expect(blank.errors.name).toBe('Name is required.');
    expect(repeat).toMatchObject({ action: 'skip', reason: 'Repeats row 3 (same name).' });
    expect(ferry.errors).toMatchObject({ owner_id: 'Owner: no person matches "nobody@example.test".', active: 'In service must be yes or no.' });
    expect(res.body.unmatched).toEqual({ status: ['Broken'], owner_id: ['nobody@example.test'] });
    expect(res.body).toMatchObject({ dryRun: true, total: 5, created: 0, errors: 4, skipped: 1, duplicates: 1 });
  });

  it('imports valid rows with mapped values, audited per record and as a whole', async () => {
    const csv = [
      'Name,Status,Owner,Due,Cost,In service,Parent',
      'Depot camera,In repair,admin@example.test,14/3/2026,"$1,200.50",yes,Ticket vending machine',
      'Bus stop sign,Broken,Test Admin,2026-03-01,12,no,',
      'Ticket vending machine,Open,,,,,',
    ].join('\n');
    const body = { ...csvFile(csv), mapping: MAPPING, mode: 'create', matchKey: 'name', valueMap: { status: { broken: 'in_repair' } } };
    const dry = await t.api.post('/api/import/gizmo', { ...body, dryRun: true });
    expect(dry.body).toMatchObject({ created: 2, skipped: 1, errors: 0 });
    expect(dry.body.rows[2].reason).toBe('Already exists (Ticket vending machine).');
    const res = await t.api.post('/api/import/gizmo', { ...body, dryRun: false });
    expect(res.body).toMatchObject({ dryRun: false, created: 2, skipped: 1, errors: 0 });
    const camera = (await t.api.get(`/api/gizmos/${res.body.rows[0].id}`)).body;
    const parent = (await t.api.get('/api/gizmos?q=Ticket vending')).body.rows[0];
    expect(camera).toMatchObject({ name: 'Depot camera', status: 'in_repair', owner_id: adminId, due_on: '2026-03-14', cost: 1200.5, active: true, parent_id: parent.id });
    expect((await t.api.get(`/api/gizmos/${res.body.rows[1].id}`)).body.status).toBe('in_repair');
    const creates = await t.db.query("select 1 from audit_events where action = 'gizmo.create' and record_id = any($1::text[])", [[res.body.rows[0].id, res.body.rows[1].id]]);
    expect(creates.length).toBe(2);
    const history = await t.api.get('/api/import/history?type=gizmo');
    expect(history.body[0]).toMatchObject({ file: 'gizmos.csv', mode: 'create', created: 2, skipped: 1, errors: 0, by: 'Test Admin' });
  });

  it('updates existing records by a chosen key, and refuses an incomplete mapping', async () => {
    const list = (await t.api.get('/api/gizmos?q=Depot camera')).body.rows[0];
    const csv = `Reference,Status\n${list.ref},Done\nGZ-99999,Open\n`;
    const res = await t.api.post('/api/import/gizmo', { ...csvFile(csv), mapping: { Reference: 'ref', Status: 'status' }, mode: 'update', matchKey: 'ref', dryRun: false });
    expect(res.body).toMatchObject({ updated: 1, skipped: 1, created: 0 });
    expect(res.body.rows[1].reason).toBe('No existing gizmo matches "GZ-99999".');
    expect((await t.api.get(`/api/gizmos/${list.id}`)).body.status).toBe('done');

    const bad = await t.api.post('/api/import/gizmo', { ...csvFile('Status\nOpen\n'), mapping: { Status: 'status' }, mode: 'create' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.name).toContain('Map a column to Name');
    const noKey = await t.api.post('/api/import/gizmo', { ...csvFile('Name\nx\n'), mapping: { Name: 'name' }, mode: 'upsert' });
    expect(noKey.body.error.fields._match).toBeTruthy();
  });

  it('needs the same permissions as making the records by hand', async () => {
    const pm = await t.as('project_manager'); // tickets.view only
    expect((await pm.post('/api/import/gizmo', { ...csvFile('Name\nx\n'), mapping: { Name: 'name' } })).status).toBe(403);
    expect((await pm.post('/api/import/gizmo/read', csvFile('Name\nx\n'))).status).toBe(403);
    const agent = await t.as('agent'); // tickets.*, no security.view
    expect((await agent.post('/api/import/vault', { ...csvFile('Title\nx\n'), mapping: { Title: 'title' } })).status).toBe(404);
    const res = await agent.post('/api/import/gizmo', { ...csvFile('Name,Parent\nRail switch heater,Hidden radio gateway\n'), mapping: { Name: 'name', Parent: 'parent_id' } });
    expect(res.body.rows[0].errors.parent_id).toBe('Parent: no gizmo you can see matches "Hidden radio gateway".');
    // A key match never reveals a record the person cannot see.
    const dup = await agent.post('/api/import/gizmo', { ...csvFile('Name\nHidden radio gateway\n'), mapping: { Name: 'name' }, matchKey: 'name' });
    expect(dup.body.rows[0].action).toBe('create');
    expect((await agent.get('/api/import/history?type=vault')).status).toBe(404);
  });

  it('refuses files it cannot read', async () => {
    expect((await t.api.post('/api/import/gizmo/read', { fileName: 'old.xls', content: b64('x') })).body.error.message).toContain('.xls');
    expect((await t.api.post('/api/import/gizmo/read', { fileName: 'x.xlsx', content: b64('PK not really') })).status).toBe(400);
    expect((await t.api.post('/api/import/gizmo/read', csvFile('Name\n'))).body.error.message).toContain('no data rows');
  });

  it('reads XLSX: chosen sheet, typed dates and numbers', async () => {
    const file = writeXlsx({ sheets: [
      { name: 'Notes', columns: [{ header: 'Anything', type: 'text' }], rows: [['ignore me']] },
      { name: 'Gizmos', columns: [{ header: 'Name', type: 'text' }, { header: 'Due', type: 'date' }, { header: 'Cost', type: 'currency' }], rows: [['Wayside cabinet', '2026-07-01', 310.25]] },
    ] });
    const read = await t.api.post('/api/import/gizmo/read', { fileName: 'book.xlsx', content: b64(file), sheet: 'Gizmos' });
    expect(read.body).toMatchObject({ kind: 'xlsx', sheets: ['Notes', 'Gizmos'], sheet: 'Gizmos', headers: ['Name', 'Due', 'Cost'] });
    const res = await t.api.post('/api/import/gizmo', { fileName: 'book.xlsx', content: b64(file), sheet: 'Gizmos', mapping: read.body.suggested, dryRun: false });
    const made = (await t.api.get(`/api/gizmos/${res.body.rows[0].id}`)).body;
    expect(made).toMatchObject({ name: 'Wayside cabinet', due_on: '2026-07-01', cost: 310.25 });
  });
});

describe('XLSX round trip', () => {
  it('exports a list to XLSX and imports the same file back', async () => {
    await t.api.post('/api/gizmos', { name: 'Signal relay A', status: 'in_repair', owner_id: adminId, due_on: '2026-05-06', seen_at: '2026-05-06T12:00:00Z', cost: 42.5, units: 7, active: true, notes: 'Line 1\nLine 2' });
    await t.api.post('/api/gizmos', { name: 'Signal relay B', status: 'done', active: false, units: 0 });
    const cookie = await createSession(t.db, adminId);
    const exported = await t.app.inject({ method: 'GET', url: '/api/gizmos?format=xlsx&q=Signal relay&sort=name', headers: { cookie: `${SESSION_COOKIE}=${cookie}` } });
    const originals = (await t.api.get('/api/gizmos?q=Signal relay&sort=name')).body.rows;
    for (const r of originals) await t.api.del(`/api/gizmos/${r.id}`);

    const content = b64(exported.rawPayload);
    const read = await t.api.post('/api/import/gizmo/read', { fileName: 'gizmos.xlsx', content });
    expect(read.body.suggested).toMatchObject({ Reference: 'ref', Name: 'name', Status: 'status', Owner: 'owner_id', Due: 'due_on', 'Last seen': 'seen_at', Cost: 'cost', Units: 'units', 'In service': 'active' });
    // The reference of a removed record is only a match key, so leave it out when creating.
    const mapping = { ...read.body.suggested };
    delete mapping.Reference;
    const res = await t.api.post('/api/import/gizmo', { fileName: 'gizmos.xlsx', content, mapping, mode: 'create', dryRun: false });
    expect(res.body).toMatchObject({ created: 2, errors: 0 });
    const back = (await t.api.get('/api/gizmos?q=Signal relay&sort=name')).body.rows;
    const pick = (r: Record<string, unknown>) => ({ name: r.name, status: r.status, owner_id: r.owner_id, due_on: r.due_on, seen_at: r.seen_at, cost: r.cost, units: r.units, active: r.active, notes: r.notes });
    expect(back.map(pick)).toEqual(originals.map(pick));
    expect(back[0].ref).not.toBe(originals[0].ref);
  });
});

