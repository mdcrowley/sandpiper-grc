import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { detectDelimiter, normalizeSeverity, parseCsv, parseDate, pickCves } from './csv.ts';
import { addDays, today } from './policy.ts';

// An invented scanner export. Nothing here comes from a real scan.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { process.env.GRC_MODULES = 'vulnerabilities'; // these tests describe the module on its own
  t = await testApp(); });
afterAll(async () => { await t.close(); });

const MAPPING = {
  host_name: 'Host', host_ip: 'Address', port: 'Port', plugin_id: 'Check ID', title: 'Name', severity: 'Risk',
  cvss: 'Score', cves: 'CVE', first_seen: 'First Found', last_seen: 'Last Found', description: 'Synopsis', solution: 'Fix',
};
const HEADER = 'Host,Address,Port,Check ID,Name,Risk,Score,CVE,First Found,Last Found,Synopsis,Fix';
const d = (n: number) => addDays(today(), n);
const scan1 = () => [
  HEADER,
  `pretend-web-01,10.9.0.5,443,810001,"Pretend server, outdated",Critical,9.8,cve-2099-1111,${d(-20)},${d(-1)},"Old release, see notes",Upgrade`,
  `pretend-web-01,10.9.0.5,80,810002,Banner shows version,1,2.6,,${d(-20)},${d(-1)},,Hide the banner`,
  `pretend-db-01,10.9.0.6,5432,810003,Weak cipher accepted,Moderate,5.9,,${d(-9)},${d(-1)},,Disable it`,
  `,,443,810004,No host on this line,High,7.0,,,,,`,
  `pretend-db-01,10.9.0.6,22,810005,Severity is unreadable,Purple,,,,,,`,
  // The same host, port and finding as line 2 (the port written with its protocol): a repeat, not a new finding.
  `pretend-web-01,10.9.0.5,443/tcp,810001,"Pretend server, outdated",Critical,9.8,,,,,`,
].join('\r\n');
const run = (api: any, csv: string, over: Record<string, unknown> = {}) =>
  api.post('/api/vulnerabilities/import', { csv, mapping: MAPPING, source: 'Pretend scanner', fileName: 'scan.csv', ...over });

describe('reading files', () => {
  it('parses quoted cells and reports an unclosed quote', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n\n1,2', ',').map((r) => r.cells)).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['1', '2']]);
    expect(() => parseCsv('a,b\n"open,2\n3,4', ',')).toThrow(/line 2 is never closed/);
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
  });

  it('normalizes severity, dates and CVE lists', () => {
    const list = ['critical', 'high', 'medium', 'low', 'informational'].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }));
    expect(['CRITICAL', 'High', 'moderate', 'low', 'Info', 'none', '4', '3', '2', '1', '0', 'purple', ''].map((s) => normalizeSeverity(s, list)))
      .toEqual(['critical', 'high', 'medium', 'low', 'informational', 'informational', 'critical', 'high', 'medium', 'low', 'informational', null, null]);
    expect(parseDate('2030-03-05T10:00:00Z')).toBe('2030-03-05');
    expect(parseDate('05/03/2030')).toBe('2030-03-05');
    expect(parseDate('05/03/2030', false)).toBe('2030-05-03');
    expect(parseDate('25/03/2030', false)).toBe('2030-03-25');
    expect(parseDate('5 Mar 2030')).toBe('2030-03-05');
    expect(parseDate('Mar 5, 2030 09:00')).toBe('2030-03-05');
    expect(parseDate('31/02/2030')).toBeNull();
    expect(parseDate('soon')).toBeNull();
    expect(pickCves('cve-2099-2222; CVE-2099-1111, junk')).toBe('CVE-2099-1111, CVE-2099-2222');
  });

  it('gives clear errors for files that cannot be imported', async () => {
    const code = async (csv: unknown, over = {}) => (await run(t.api, csv as string, over)).body.error;
    expect((await code('')).fields.csv).toBeTruthy();
    expect((await code(HEADER)).message).toMatch(/no findings below/);
    expect((await code('Host,Name\n"broken,row')).code).toBe('malformed');
    expect((await code('PK\u0000\u0003binary')).message).toMatch(/does not look like a text file/);
    expect((await code('Host,Host,Risk\na,b,high')).message).toMatch(/repeats a column name \(host\)/);
    expect((await code(scan1(), { source: '' })).fields.source).toBeTruthy();
    const big = await run(t.api, `${HEADER}\n${'x'.repeat(5 * 1024 * 1024)}`);
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe('too_large');
    const unmapped = await run(t.api, scan1(), { mapping: { title: 'Name', severity: 'Nope', bogus: 'Host' } });
    expect(unmapped.body.error.code).toBe('mapping');
    const noHost = await run(t.api, scan1(), { mapping: { title: 'Name', severity: 'Missing column' } });
    expect(Object.keys(noHost.body.error.fields).sort()).toEqual(['host_name', 'severity']);
  });
});

describe('import', () => {
  let batchId: string;

  it('reports everything in a dry run and writes nothing', async () => {
    const res = await run(t.api, scan1());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ dryRun: true, total: 6, created: 3, updated: 0, unchanged: 0, duplicates: 1, errors: 2, missing: 0, closed: 0, batchId: null });
    const byLine = Object.fromEntries(res.body.rows.map((r: any) => [r.line, r]));
    expect(byLine[5].errors.host_name).toMatch(/No host name/);
    expect(byLine[6].errors.severity).toMatch(/"Purple" is not understood/);
    expect(byLine[7]).toMatchObject({ action: 'duplicate', duplicateOf: 2 });
    expect(byLine[3]).toMatchObject({ action: 'create', severity: 'low', host: 'pretend-web-01' });
    expect(res.body.rows[0].action).toBe('error'); // problems come first
    expect((await t.api.get('/api/vulnerabilities')).body.total).toBe(0);
    expect((await t.api.get('/api/vulnerabilities/imports')).body).toEqual([]);
    expect(await t.db.query(`select 1 from audit_events where action = 'vulnerability.import'`)).toEqual([]);
  });

  it('imports for real, records the batch and audits it', async () => {
    const res = await run(t.api, scan1(), { dryRun: false });
    expect(res.body).toMatchObject({ dryRun: false, total: 6, created: 3, errors: 2, duplicates: 1 });
    batchId = res.body.batchId;
    const list = (await t.api.get('/api/vulnerabilities?sort=plugin_id')).body;
    expect(list.total).toBe(3);
    expect(list.rows[0]).toMatchObject({
      title: 'Pretend server, outdated', host_name: 'pretend-web-01', host_ip: '10.9.0.5', port: '443', plugin_id: '810001',
      severity: 'critical', cvss: 9.8, cves: 'CVE-2099-1111', first_seen: d(-20), last_seen: d(-1), due_on: d(-5), overdue: true,
      status: 'open', source: 'Pretend scanner', import_batch_id: batchId, description: 'Old release, see notes', solution: 'Upgrade',
    });
    expect(list.rows[2]).toMatchObject({ severity: 'medium', first_seen: d(-9) });
    expect((await t.api.get(`/api/vulnerabilities?f.import_batch_id=${batchId}`)).body.total).toBe(3);

    const batches = (await t.api.get('/api/vulnerabilities/imports')).body;
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({
      id: batchId, source: 'Pretend scanner', file_name: 'scan.csv', imported_by_name: 'Test Admin',
      total_rows: 6, created_count: 3, updated_count: 0, error_count: 2, duplicate_count: 1, closed_count: 0,
    });
    expect((await t.api.get(`/api/vulnerabilities/imports/${batchId}`)).body.id).toBe(batchId);
    expect((await t.api.get('/api/vulnerabilities/imports/not-an-id')).status).toBe(404);

    const audit = await t.db.query<any>(`select summary, after, actor_name from audit_events where action = 'vulnerability.import'`);
    expect(audit).toHaveLength(1);
    expect(audit[0].summary).toMatch(/3 new, 0 updated/);
    expect(audit[0].after).toMatchObject({ batchId, created: 3, errors: 2 });
    // The batch event names every finding whose "last reported by" import it set.
    expect([...audit[0].after.reportedIds].sort()).toEqual(list.rows.map((r: any) => r.id).sort());
    expect((await t.db.query(`select 1 from audit_events where action = 'vulnerability.create'`)).length).toBe(3);
  });

  it('updates a known finding instead of duplicating it, with the severity change in its history', async () => {
    const scan2 = [
      HEADER,
      `PRETEND-WEB-01,10.9.0.5,443,810001,"Pretend server, outdated",High,8.1,CVE-2099-1111,,${d(0)},,`,
      `pretend-web-01,10.9.0.5,80,810002,Banner shows version,Low,2.6,,,${d(-1)},,`,
      `pretend-db-01,10.9.0.6,5432,810003,Weak cipher accepted,Medium,5.9,,,${d(0)},,`,
    ].join('\n');
    const dry = await run(t.api, scan2);
    expect(dry.body).toMatchObject({ created: 0, updated: 2, unchanged: 1, errors: 0 });
    expect(dry.body.rows.find((r: any) => r.line === 2).changes).toContain('Severity critical to high');
    expect((await t.api.get('/api/vulnerabilities?f.severity=critical')).body.total).toBe(1); // dry run changed nothing

    const real = await run(t.api, scan2, { dryRun: false });
    expect(real.body).toMatchObject({ created: 0, updated: 2, unchanged: 1 });
    expect((await t.api.get('/api/vulnerabilities')).body.total).toBe(3);
    const row = (await t.api.get('/api/vulnerabilities?f.plugin_id=810001')).body.rows[0];
    expect(row).toMatchObject({ severity: 'high', cvss: 8.1, last_seen: d(0), first_seen: d(-20), due_on: d(10), import_batch_id: real.body.batchId });
    const history = (await t.api.get(`/api/history?record_type=vulnerability&record_id=${row.id}`)).body;
    expect(history[0].before).toMatchObject({ severity: 'critical' });
    expect(history[0].after).toMatchObject({ severity: 'high', last_seen: d(0) });
    // The unchanged finding also belongs to the newest import now.
    expect((await t.api.get(`/api/vulnerabilities?f.import_batch_id=${real.body.batchId}`)).body.total).toBe(3);
  });

  it('closes findings missing from a later import only when asked, and reopens them if they come back', async () => {
    const scan3 = [HEADER, `pretend-web-01,10.9.0.5,443,810001,"Pretend server, outdated",High,8.1,,,${d(0)},,`].join('\n');
    // A hand-entered finding and one from another source are never closed by this import.
    await t.api.post('/api/vulnerabilities', { title: 'Entered by hand', host_name: 'pretend-db-01', plugin_id: 'manual-1', severity: 'low', source: 'Pretend scanner' });
    await run(t.api, [HEADER, `other-host,10.9.0.9,1,820001,From another tool,Low,1,,,,,`].join('\n'), { dryRun: false, source: 'Another tool' });

    const off = await run(t.api, scan3);
    expect(off.body).toMatchObject({ missing: 2, closed: 0, closeMissing: false });
    expect(off.body.missingFindings.map((f: any) => f.title).sort()).toEqual(['Banner shows version', 'Weak cipher accepted']);
    const dry = await run(t.api, scan3, { closeMissing: true });
    expect(dry.body).toMatchObject({ dryRun: true, missing: 2, closed: 2 });
    expect((await t.api.get('/api/vulnerabilities?f.status=fixed')).body.total).toBe(0);

    const real = await run(t.api, scan3, { closeMissing: true, dryRun: false });
    expect(real.body).toMatchObject({ unchanged: 1, closed: 2 });
    const fixed = (await t.api.get('/api/vulnerabilities?f.status=fixed')).body.rows;
    expect(fixed.map((f: any) => f.plugin_id).sort()).toEqual(['810002', '810003']);
    expect(fixed[0]).toMatchObject({ fixed_on: today(), closed: true });
    expect((await t.api.get(`/api/vulnerabilities/imports/${real.body.batchId}`)).body).toMatchObject({ close_missing: true, closed_count: 2 });
    expect((await t.api.get('/api/vulnerabilities?f.closed=false')).body.total).toBe(3);

    const back = await run(t.api, [HEADER, `pretend-web-01,10.9.0.5,80,810002,Banner shows version,Low,2.6,,,,,`].join('\n'), { dryRun: false });
    expect(back.body).toMatchObject({ reopened: 1, created: 0 });
    const again = (await t.api.get('/api/vulnerabilities?f.plugin_id=810002')).body.rows[0];
    expect(again).toMatchObject({ status: 'open', fixed_on: null, closed: false });
  });

  it('lets a security lead import, and matches nothing to assets when inventory is not loaded', async () => {
    const lead = await t.as('security_lead');
    const res = await run(lead, [HEADER, `lead-host,10.9.1.1,1,830001,Found by the lead,Info,0,,,,,`].join('\n'), { dryRun: false, source: 'Lead scan' });
    expect(res.body).toMatchObject({ created: 1, unmatchedHosts: [] });
    expect((await lead.get('/api/vulnerabilities?q=lead-host')).body.rows[0].severity).toBe('informational');
  });
});

describe('saved column mappings', () => {
  it('saves, lists, replaces and deletes a named mapping, with audit events', async () => {
    const bad = await t.api.post('/api/vulnerabilities/import/presets', { name: '', mapping: {} });
    expect(bad.body.error.fields.name).toBeTruthy();
    const made = await t.api.post('/api/vulnerabilities/import/presets', { name: 'Pretend scanner export', source: 'Pretend scanner', mapping: MAPPING });
    expect(made.status).toBe(201);
    const replaced = await t.api.post('/api/vulnerabilities/import/presets', { name: 'pretend scanner EXPORT', source: 'Pretend scanner', delimiter: ';', mapping: { ...MAPPING, service: 'Svc' } });
    expect(replaced.status).toBe(200);
    expect(replaced.body.id).toBe(made.body.id);
    const list = (await t.api.get('/api/vulnerabilities/import/presets')).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'pretend scanner EXPORT', source: 'Pretend scanner', delimiter: ';' });
    expect(list[0].mapping.service).toBe('Svc');
    expect((await t.api.post('/api/vulnerabilities/import/presets', { name: 'Bad', mapping: { nonsense: 'X' } })).status).toBe(400);

    // The saved mapping drives the next import as it stands.
    const res = await t.api.post('/api/vulnerabilities/import', {
      csv: 'Host;Check ID;Name;Risk;Svc\npreset-host;840001;Imported with a preset;high;https', source: list[0].source,
      mapping: { host_name: 'Host', plugin_id: 'Check ID', title: 'Name', severity: 'Risk', service: 'Svc' }, presetName: list[0].name, dryRun: false,
    });
    expect(res.body).toMatchObject({ created: 1, delimiter: ';' });
    expect((await t.api.get(`/api/vulnerabilities/imports/${res.body.batchId}`)).body.preset_name).toBe('pretend scanner EXPORT');

    expect((await t.api.del(`/api/vulnerabilities/import/presets/${made.body.id}`)).status).toBe(200);
    expect((await t.api.del(`/api/vulnerabilities/import/presets/${made.body.id}`)).status).toBe(404);
    expect((await t.api.get('/api/vulnerabilities/import/presets')).body).toEqual([]);
    const actions = (await t.db.query<any>(`select action from audit_events where action like 'vulnerability.mapping.%' order by id`)).map((e) => e.action);
    expect(actions).toEqual(['vulnerability.mapping.create', 'vulnerability.mapping.update', 'vulnerability.mapping.delete']);
  });
});
