import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { HostIndex, portKey, samePort } from './rules.ts';

// Invented hosts and findings only. E10-12: host + port (+ protocol) + finding identifier is
// the duplicate key, and a host seen by address and by name is one host.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

const HEADER = 'Host,Address,Port,Protocol,Check ID,Name,Risk';
const MAPPING = { host_name: 'Host', host_ip: 'Address', port: 'Port', protocol: 'Protocol', plugin_id: 'Check ID', title: 'Name', severity: 'Risk' };
const run = (lines: string[], over: Record<string, unknown> = {}) =>
  t.api.post('/api/vulnerabilities/import', { csv: [HEADER, ...lines].join('\n'), mapping: MAPPING, source: 'Dedup scan', fileName: 'dedup.csv', dryRun: false, ...over });
const total = async (query = '') => (await t.api.get(`/api/vulnerabilities?pageSize=500${query}`)).body.total as number;
const findings = async (query: string) => (await t.api.get(`/api/vulnerabilities?pageSize=500&sort=port&${query}`)).body.rows as any[];

describe('the parts of the key', () => {
  it('reads a port with or without its protocol', () => {
    expect(portKey('443')).toBe('443');
    expect(portKey(' 443/TCP ')).toBe('443/tcp');
    expect(portKey('tcp/443')).toBe('443/tcp');
    expect(portKey('443 (tcp)')).toBe('443/tcp');
    expect(portKey('443', 'TCP')).toBe('443/tcp');
    expect(portKey('443/tcp', 'udp')).toBe('443/udp'); // a protocol column wins over the port text
    expect(portKey('0')).toBe('');
    expect(portKey('', 'icmp')).toBe('');
    expect(portKey(null)).toBe('');
    expect(portKey('general')).toBe('general');
  });

  it('treats a port without a protocol as the same port, but never two protocols', () => {
    expect(samePort('443', '443/tcp')).toBe(true);
    expect(samePort('443/tcp', '443')).toBe(true);
    expect(samePort('443/tcp', '443/udp')).toBe(false);
    expect(samePort('443', '8443')).toBe(false);
    expect(samePort('', '')).toBe(true);
    expect(samePort('', '443')).toBe(false);
  });

  it('reconciles a host seen by address and by name, without merging two named hosts on one address', () => {
    const hosts = new HostIndex();
    expect(hosts.resolve('', '10.7.0.1')).toBe('10.7.0.1'); // address only
    expect(hosts.resolve('Kiosk-01', '10.7.0.1')).toBe('10.7.0.1'); // the name is learned for the same host
    expect(hosts.resolve('kiosk-01', '')).toBe('10.7.0.1'); // and now names it
    expect(hosts.resolve('kiosk-02', '10.7.0.1')).toBe('kiosk-02'); // another name on a reused address is another host
    expect(hosts.resolve('', '10.7.0.1')).toBe('kiosk-02'); // the address now belongs to whoever was seen there last
    expect(hosts.resolve('', '')).toBe('');
  });
});

describe('import', () => {
  const twoPorts = [
    'dedup-web-01,10.7.1.5,443,tcp,910001,Old protocol version accepted,High',
    'dedup-web-01,10.7.1.5,8443,tcp,910001,Old protocol version accepted,High',
    'dedup-web-01,10.7.1.5,53,udp,910002,Name service answers anyone,Medium',
    'dedup-web-01,10.7.1.5,53,tcp,910002,Name service answers anyone,Medium',
    'dedup-web-01,10.7.1.5,,,910003,Operating system out of support,Critical',
  ];

  it('keeps the same finding on two ports, and on two protocols of one port, as separate findings', async () => {
    const dry = await run(twoPorts, { dryRun: true });
    expect(dry.body).toMatchObject({ total: 5, created: 5, duplicates: 0, errors: 0 });
    const real = await run(twoPorts);
    expect(real.body).toMatchObject({ created: 5, updated: 0, duplicates: 0 });
    const rows = await findings('f.plugin_id=910001');
    expect(rows.map((r) => [r.port, r.protocol, r.port_key])).toEqual([['443', 'tcp', '443/tcp'], ['8443', 'tcp', '8443/tcp']]);
    expect((await findings('f.plugin_id=910002')).map((r) => r.port_key).sort()).toEqual(['53/tcp', '53/udp']);
    expect(new Set((await findings('f.host_key=dedup-web-01')).map((r) => r.host_key)).size).toBe(1);
  });

  it('creates nothing new when the same file is imported again', async () => {
    const before = await total();
    const dry = await run(twoPorts, { dryRun: true });
    expect(dry.body).toMatchObject({ created: 0, updated: 0, unchanged: 5, reopened: 0, duplicates: 0, errors: 0, missing: 0 });
    const again = await run(twoPorts);
    expect(again.body).toMatchObject({ created: 0, updated: 0, unchanged: 5 });
    expect(await total()).toBe(before);
    expect((await t.db.query(`select 1 from audit_events where action = 'vulnerability.create'`)).length).toBe(5);
  });

  it('matches a port written without its protocol to the recorded one, and reports a repeat inside a file', async () => {
    const before = await total();
    const res = await run([
      'dedup-web-01,10.7.1.5,443,,910001,Old protocol version accepted,High',
      'dedup-web-01,10.7.1.5,443/tcp,,910001,Old protocol version accepted,High',
    ]);
    expect(res.body).toMatchObject({ created: 0, unchanged: 1, duplicates: 1 });
    expect(res.body.rows.find((r: any) => r.action === 'duplicate')).toMatchObject({ line: 3, duplicateOf: 2 });
    expect(await total()).toBe(before);
    expect((await findings('f.plugin_id=910001'))[0]).toMatchObject({ port: '443', protocol: 'tcp', port_key: '443/tcp' }); // the protocol is not lost
  });

  it('does not duplicate a host seen first by address and later by name', async () => {
    const first = await run([',10.7.2.9,22,tcp,910010,Weak key exchange offered,Medium', ',10.7.2.9,80,tcp,910011,Version shown in banner,Low'], { source: 'Alias scan' });
    expect(first.body).toMatchObject({ created: 2 });
    const before = await total();

    // The next scan knows the name. Same host: both findings are updated (the name is added), nothing is created.
    const named = ['dedup-db-01,10.7.2.9,22,tcp,910010,Weak key exchange offered,Medium', 'dedup-db-01,10.7.2.9,80,tcp,910011,Version shown in banner,Low'];
    const dry = await run(named, { source: 'Alias scan', dryRun: true });
    expect(dry.body).toMatchObject({ created: 0, updated: 2, missing: 0 });
    expect(dry.body.rows[0].changes).toContain('Host name');
    expect((await run(named, { source: 'Alias scan' })).body).toMatchObject({ created: 0, updated: 2 });
    expect(await total()).toBe(before);
    const rows = await findings('f.plugin_id=910010,910011');
    expect(rows.map((r) => r.host_name)).toEqual(['dedup-db-01', 'dedup-db-01']);
    expect(new Set(rows.map((r) => r.host_key)).size).toBe(1);

    // By name alone, by address alone and in another letter case: still the same two findings.
    for (const lines of [
      ['dedup-db-01,,22,tcp,910010,Weak key exchange offered,Medium', 'DEDUP-DB-01,,80,tcp,910011,Version shown in banner,Low'],
      [',10.7.2.9,22,tcp,910010,Weak key exchange offered,Medium', ',10.7.2.9,80,tcp,910011,Version shown in banner,Low'],
    ]) {
      expect((await run(lines, { source: 'Alias scan' })).body).toMatchObject({ created: 0, updated: 0, unchanged: 2, missing: 0 });
    }
    expect(await total()).toBe(before);
  });

  it('does not duplicate a host seen first by name and later by address', async () => {
    await run(['dedup-app-01,10.7.3.4,443,tcp,910020,Certificate about to expire,Low'], { source: 'Reverse scan' });
    const before = await total();
    const res = await run([',10.7.3.4,443,tcp,910020,Certificate about to expire,Low'], { source: 'Reverse scan' });
    expect(res.body).toMatchObject({ created: 0, unchanged: 1 });
    expect(await total()).toBe(before);
    // A new finding reported by address alone joins the named host.
    const more = await run([',10.7.3.4,22,tcp,910021,Weak key exchange offered,Medium'], { source: 'Reverse scan' });
    expect(more.body).toMatchObject({ created: 1 });
    expect((await findings('f.plugin_id=910021'))[0]).toMatchObject({ host_key: 'dedup-app-01', host_ip: '10.7.3.4' });
  });

  it('keeps two named hosts apart when they share an address', async () => {
    const res = await run(['dedup-app-02,10.7.3.4,443,tcp,910020,Certificate about to expire,Low'], { source: 'Reverse scan' });
    expect(res.body).toMatchObject({ created: 1 });
    expect((await findings('f.plugin_id=910020')).map((r) => r.host_key).sort()).toEqual(['dedup-app-01', 'dedup-app-02']);
  });

  it('gives a finding entered by hand the host it belongs to', async () => {
    const byAddress = (await t.api.post('/api/vulnerabilities', { title: 'Found in a review', host_ip: '10.7.2.9', port: '5432/tcp', severity: 'low' })).body;
    expect(byAddress).toMatchObject({ host_key: '10.7.2.9', port_key: '5432/tcp' }); // the key of the host first seen by address
    const byName = (await t.api.post('/api/vulnerabilities', { title: 'Found in another review', host_name: 'Dedup-DB-01', severity: 'low' })).body;
    expect(byName.host_key).toBe('10.7.2.9');
    // Learning an address for a host known by name keeps its key; a new name for it is a new host.
    const lone = (await t.api.post('/api/vulnerabilities', { title: 'Lone host finding', host_name: 'dedup-lone-01', severity: 'low' })).body;
    expect((await t.api.patch(`/api/vulnerabilities/${lone.id}`, { host_ip: '10.7.9.9' })).body.host_key).toBe('dedup-lone-01');
    expect((await t.api.patch(`/api/vulnerabilities/${lone.id}`, { port: '25', protocol: 'TCP' })).body.port_key).toBe('25/tcp');
    expect((await t.api.patch(`/api/vulnerabilities/${lone.id}`, { host_name: 'dedup-renamed-01', host_ip: null })).body.host_key).toBe('dedup-renamed-01');
  });
});

describe('migration 002', () => {
  it('keys rows written before it, reconciles their hosts and loses nothing', async () => {
    // Rows as the first version wrote them: no port key, and one host split in two by name and by address.
    const insert = (title: string, name: string | null, ip: string | null, port: string | null, hostKey: string) => t.db.one<{ id: string }>(
      `insert into vulnerabilities (ref, title, host_name, host_ip, host_key, port, finding_key, severity, first_seen, last_seen)
       values ($1, $2, $3, $4, $5, $6, 'id:legacy', 'low', current_date - 5, current_date - 1) returning id`,
      [`OLD-${title}`, `Legacy ${title}`, name, ip, hostKey, port],
    );
    const named = (await insert('named', 'legacy-host-01', '10.7.8.1', '445/tcp', 'legacy-host-01'))!.id;
    const byAddress = (await insert('address', null, '10.7.8.1', 'TCP/445', '10.7.8.1'))!.id;
    const plain = (await insert('plain', 'legacy-host-02', null, ' 8080 ', 'legacy-host-02'))!.id;
    const words = (await insert('words', 'legacy-host-02', null, 'general', 'legacy-host-02'))!.id;
    const zero = (await insert('zero', 'legacy-host-02', null, '0', 'legacy-host-02'))!.id;
    const noPort = (await insert('none', null, null, null, ''))!.id; // cannot be keyed: left alone, still listed
    const count = async () => (await t.db.one<{ n: number }>('select count(*)::int as n from vulnerabilities'))!.n;
    const before = await count();

    const sql = readFileSync(fileURLToPath(new URL('./migrations/002_dedup_keys.sql', import.meta.url)), 'utf8');
    await t.db.exec(sql);
    await t.db.exec(sql); // safe to run again

    expect(await count()).toBe(before);
    const row = async (id: string) => (await t.db.one<any>('select host_key, port_key, port, host_name from vulnerabilities where id = $1', [id]))!;
    expect(await row(named)).toMatchObject({ host_key: 'legacy-host-01', port_key: '445/tcp' });
    expect(await row(byAddress)).toMatchObject({ host_key: 'legacy-host-01', port_key: '445/tcp', port: 'TCP/445', host_name: null });
    expect((await row(plain)).port_key).toBe('8080');
    expect((await row(words)).port_key).toBe('general');
    expect((await row(zero)).port_key).toBe('');
    expect(await row(noPort)).toMatchObject({ host_key: '', port_key: '' });
    // The migration's reading of a port is the application's.
    for (const id of [named, byAddress, plain, words, zero]) {
      const r = await row(id);
      expect(portKey(r.port)).toBe(r.port_key);
    }
    // The record type still reads and writes through the rebuilt view.
    const api = (await t.api.get(`/api/vulnerabilities/${noPort}`)).body;
    expect(api).toMatchObject({ title: 'Legacy none', age_days: 5, overdue: false });
    expect((await t.api.patch(`/api/vulnerabilities/${noPort}`, { remediation_notes: 'Still editable' })).status).toBe(200);
  });
});
