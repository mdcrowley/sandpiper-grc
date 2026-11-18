import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';
import {
  matchVendor, normaliseVendorName, parseNoticeDays, parseRenewal, parseResolution, parseTermDates, parseTotalValue,
} from './seed.ts';

// A stand-in for the inventory and actions modules, so the cross-module steps can be tested without them.
const standIns: ModuleDef = {
  key: 'vendorseedstandins',
  async seedDefaults(ctx) {
    await ctx.db.exec(`
      create table if not exists t_systems (
        id uuid primary key default gen_random_uuid(), name text not null, vendor_name text, vendor_id uuid,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);
      create table if not exists t_actions (
        id uuid primary key default gen_random_uuid(), title text not null, description text, status text, priority text,
        source text, source_type text, source_id uuid,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'system', table: 't_systems', module: 'systems', label: 'System', plural: 'Systems',
      path: '/api/systems', route: '/systems', titleField: 'name',
      fields: {
        name: { label: 'Name', type: 'text', required: true },
        vendor_name: { label: 'Vendor name', type: 'text' },
        vendor_id: { label: 'Vendor', type: 'ref', to: 'vendor' },
      },
    });
    ctx.defineResource({
      type: 'action', table: 't_actions', module: 'actions', label: 'Action', plural: 'Actions',
      path: '/api/actions', route: '/actions', titleField: 'title',
      fields: {
        title: { label: 'Title', type: 'text', required: true },
        description: { label: 'Description', type: 'longtext' },
        status: { label: 'Status', type: 'text' },
        priority: { label: 'Priority', type: 'text' },
        source: { label: 'Source', type: 'text' },
        source_type: { label: 'Source type', type: 'text' },
        source_id: { label: 'Source record', type: 'text' },
      },
    });
  },
};

const HEADER = 'Vendor|Service|Criticality (proposed)|Document on file|Date and resolution|Term and renewal|Value|Hosting|Data ownership and return|Named security standard|Breach notice|Service levels and recovery|Liability cap|Cyber insurance required|Terms not on file|Action';

// Invented register rows.
const ROWS = [
  'Ironbridge Data, Inc. (Tallow as subcontractor)|Website hosting|Critical until replaced|Signed agreement|4 May 2031; Resolution 2031-07|1 July 2031 to 30 June 2032; 60 days\' notice|$48,000.00|Vendor cloud|Customer owns its data; returned within 30 days|None; "reasonable care" only|Within 24 hours|No uptime figure. Credits capped at 5 percent|12 months\' fees|Yes, but limits to be agreed|None|Agree a security schedule',
  'Juniper Lane Radio|Radio maintenance|High|No contract on file|Not known|Not known|Not known|Not known|Not known|Not known|Not known|Not known|Not known|Not known|The agreement|Obtain the agreement',
  'Kestrel Maps|Planning tool|Low|Order form|2 Feb 2031|Until terminated; 30 days\' notice|None|Vendor cloud|Not stated|Not applicable|Not stated|Not applicable|$1,000|No|None|None',
];
const EXTRA = 'Larchwood Payroll Co|Payroll bureau|Medium|Signed agreement|9 Sept 2031|To 31 Dec 2032|About $9,000 a year|Vendor cloud|Not stated|Not stated|Not stated|Not stated|Not stated|Not stated|None|Ask for the insurance certificate';

let t: Awaited<ReturnType<typeof testApp>>;
let seedDir: string;
let seed: NonNullable<ModuleDef['seed']>;

const write = (rows: string[]) => writeFileSync(join(seedDir, 'vendor_contracts.psv'), [HEADER, ...rows].join('\r\n') + '\r\n', 'utf8');
const count = async (table: string) => (await t.db.one<{ c: number }>(`select count(*)::int c from ${table}`))!.c;

beforeAll(async () => {
  process.env.GRC_MODULES = 'vendors'; // the stand-ins replace the real inventory and risks modules
  t = await testApp({ extraModules: [standIns] });
  seedDir = mkdtempSync(join(tmpdir(), 'grc-vendors-test-'));
  const mod = t.modules.find((m) => m.key === 'vendors')!;
  seed = mod.seed!.bind(mod);
});
afterAll(async () => {
  await t.close();
  rmSync(seedDir, { recursive: true, force: true });
});

describe('reading register text', () => {
  it('takes dates only from an unambiguous range', () => {
    expect(parseTermDates('1 July 2031 to 30 June 2032; renewed yearly')).toEqual({ start_date: '2031-07-01', end_date: '2032-06-30' });
    expect(parseTermDates('1 Jan to 31 Dec 2033')).toEqual({ start_date: '2033-01-01', end_date: '2033-12-31' });
    expect(parseTermDates('To 14 Feb 2034')).toEqual({ end_date: '2034-02-14' });
    expect(parseTermDates('3 years from the in-service date')).toEqual({});
    expect(parseTermDates('2031 to 2036 per file name')).toEqual({});
    expect(parseTermDates('31 Feb 2031 to 30 June 2032')).toEqual({});
    expect(parseTermDates(null)).toEqual({});
  });

  it('reads notice days, renewal, resolution and a single total', () => {
    expect(parseNoticeDays('3 years, then yearly; 60 days\' notice')).toBe(60);
    expect(parseNoticeDays('30 days notice to end; 90 days notice to renew')).toBeUndefined();
    expect(parseNoticeDays('Not stated')).toBeUndefined();
    expect(parseRenewal('3 years, then automatic 1-year renewals', false)).toBe('auto_renew');
    expect(parseRenewal('2 years plus two optional years', false)).toBe('option');
    expect(parseRenewal('Until terminated', false)).toBe('evergreen');
    expect(parseRenewal('1 July 2031 to 30 June 2032', true)).toBe('fixed');
    expect(parseRenewal('Not stated', false)).toBe('unknown');
    expect(parseResolution('4 May 2031; Resolution 2031-07')).toBe('2031-07');
    expect(parseResolution('Resolution 2031-07, amended by Resolution 2031-19')).toBeUndefined();
    expect(parseTotalValue('$48,000.00')).toBe(48000);
    expect(parseTotalValue('$48,000 a year')).toBeUndefined();
  });

  it('matches system vendor names loosely but not wildly', () => {
    const vendors = [
      { id: 'a', name: 'Ironbridge Data, Inc. (Tallow as subcontractor)' },
      { id: 'b', name: 'Juniper Lane Radio' },
      { id: 'c', name: 'Tallow' },
    ];
    expect(normaliseVendorName('Ironbridge Data, Inc.')).toBe('ironbridge data');
    expect(matchVendor('IRONBRIDGE DATA', vendors)).toBe('a');
    expect(matchVendor('Ironbridge', vendors)).toBe('a');
    expect(matchVendor('Juniper Lane Radio LLC; someone else (maintenance)', vendors)).toBe('b');
    expect(matchVendor('Tallow', vendors)).toBe('c'); // a vendor in its own right beats an alias
    expect(matchVendor('Juniper through a reseller', vendors)).toBe('b');
    expect(matchVendor('Not known', vendors)).toBeNull();
    expect(matchVendor('Iron', vendors)).toBeNull();
  });
});

describe('pilot seed', () => {
  let systemId: string;

  it('skips quietly, with a note, when the register file is not in the seed folder', async () => {
    const note = await seed(t.ctx, { profile: 'pilot', seedDir: join(seedDir, 'does-not-exist') });
    expect(note).toMatch(/no vendor_contracts\.psv in the seed folder, contract register skipped/);
    expect(await count('vendors')).toBe(0);
  });

  it('loads vendors, contracts, clause checks, actions and system links', async () => {
    write(ROWS);
    systemId = (await t.api.post('/api/systems', { name: 'Website', vendor_name: 'Ironbridge Data' })).body.id;
    await t.api.post('/api/systems', { name: 'Mystery box', vendor_name: 'Not known' });
    const note = await seed(t.ctx, { profile: 'pilot', seedDir });
    expect(note).toMatch(/3 register rows/);
    expect(note).toMatch(/vendors 3 new/);
    expect(await count('vendors')).toBe(3);
    expect(await count('contracts')).toBe(3);
    const vendors = (await t.api.get('/api/vendors?sort=name')).body.rows;
    expect(vendors.map((v: any) => v.criticality)).toEqual(['critical', 'high', 'low']);
    expect(vendors[0].notes).toMatch(/Critical until replaced/);
    expect(vendors[0].services).toBe('Website hosting');
    const c = (await t.api.get(`/api/contracts?f.vendor_id=${vendors[0].id}`)).body.rows[0];
    expect(c).toMatchObject({
      start_date: '2031-07-01', end_date: '2032-06-30', notice_days: 60, notice_date: '2032-05-01',
      renewal_mechanism: 'fixed', resolution_number: '2031-07', total_value: 48000, status: 'active',
      term_and_renewal: '1 July 2031 to 30 June 2032; 60 days\' notice', value_text: '$48,000.00', document_on_file: 'Signed agreement',
    });
    const checks = (await t.api.get(`/api/contracts/${c.id}/clauses`)).body;
    const status = (key: string) => checks.find((k: any) => k.clause_key === key);
    expect(status('data_ownership')).toMatchObject({ status: 'present', clause_text: 'Customer owns its data; returned within 30 days' });
    expect(status('security_standard').status).toBe('absent');
    expect(status('breach_notice').status).toBe('present');
    expect(status('recovery_sla').status).toBe('partial');
    expect(status('cyber_insurance').status).toBe('partial');
    expect(status('mfa')).toMatchObject({ status: null, clause_text: null });
    const none = (await t.api.get(`/api/contracts?f.vendor_id=${vendors[1].id}`)).body.rows[0];
    expect(none).toMatchObject({ status: 'not_on_file', document_type: 'none_on_file', end_date: null, notice_date: null, term_and_renewal: 'Not known' });
    const unknown = (await t.api.get(`/api/contracts/${none.id}/clauses`)).body.find((k: any) => k.clause_key === 'breach_notice');
    expect(unknown).toMatchObject({ status: null, clause_text: 'Not known' });
    const evergreen = (await t.api.get(`/api/contracts?f.vendor_id=${vendors[2].id}`)).body.rows[0];
    expect(evergreen).toMatchObject({ renewal_mechanism: 'evergreen', notice_days: 30, notice_date: null, total_value: null });
    const actions = (await t.api.get('/api/actions?sort=title')).body.rows;
    expect(actions).toHaveLength(2); // the third row's action cell says "None"
    expect(actions[0]).toMatchObject({
      title: 'Contract follow-up: Ironbridge Data, Inc. (Tallow as subcontractor)', description: 'Agree a security schedule',
      source: 'other', source_type: 'vendor', source_id: vendors[0].id, priority: 'high', status: 'open',
    });
    expect((await t.api.get(`/api/systems/${systemId}`)).body.vendor_id).toBe(vendors[0].id);
    expect((await t.api.get('/api/systems?f.vendor_id.null=true')).body.total).toBe(1);
  });

  it('is idempotent and keeps edits made in the application', async () => {
    const before = await count('audit_events');
    const vendor = (await t.api.get('/api/vendors?q=Ironbridge')).body.rows[0];
    const contract = (await t.api.get(`/api/contracts?f.vendor_id=${vendor.id}`)).body.rows[0];
    await t.api.patch(`/api/contracts/${contract.id}`, { notice_days: 90, title: 'Ironbridge hosting agreement' });
    await t.api.patch(`/api/contracts/${contract.id}/clauses/breach_notice`, { status: 'partial', note: 'Only for confirmed incidents' });
    const edits = (await count('audit_events')) - before;
    const note = await seed(t.ctx, { profile: 'pilot', seedDir });
    expect(note).toMatch(/vendors 0 new, 0 updated \(3 in total\)/);
    expect(note).toMatch(/contracts 0 new, 0 updated/);
    expect(await count('vendors')).toBe(3);
    expect(await count('contracts')).toBe(3);
    expect(await count('t_actions')).toBe(2);
    expect((await count('audit_events')) - before).toBe(edits); // the second run changed nothing
    const again = (await t.api.get(`/api/contracts/${contract.id}`)).body;
    expect(again).toMatchObject({ notice_days: 90, title: 'Ironbridge hosting agreement', notice_date: '2032-04-01' });
    const check = (await t.api.get(`/api/contracts/${contract.id}/clauses`)).body.find((k: any) => k.clause_key === 'breach_notice');
    expect(check).toMatchObject({ status: 'partial', note: 'Only for confirmed incidents' });
  });

  it('takes a later, longer file: new rows are added and changed text is refreshed', async () => {
    const changed = ROWS[2].replace('Vendor cloud|Not stated', 'Vendor cloud, two regions|Not stated');
    write([ROWS[0], ROWS[1], changed, EXTRA]);
    const note = await seed(t.ctx, { profile: 'pilot', seedDir });
    expect(note).toMatch(/4 register rows/);
    expect(note).toMatch(/vendors 1 new, 0 updated \(4 in total\)/);
    expect(note).toMatch(/contracts 1 new, 1 updated/);
    expect(await count('contracts')).toBe(4);
    expect(await count('t_actions')).toBe(3);
    const kestrel = (await t.api.get('/api/contracts?q=Kestrel')).body.rows[0];
    expect(kestrel.hosting).toBe('Vendor cloud, two regions');
    const larch = (await t.api.get('/api/contracts?q=Larchwood')).body.rows[0];
    expect(larch).toMatchObject({ end_date: '2032-12-31', notice_date: '2032-12-31', total_value: null });
  });
});

describe('dev seed', () => {
  it('creates invented vendors with contracts, checks and evidence, and can be re-run', async () => {
    const vendorsBefore = await count('vendors');
    await seed(t.ctx, { profile: 'dev', seedDir: join(seedDir, 'does-not-exist') });
    expect((await count('vendors')) - vendorsBefore).toBe(6);
    const evidence = await count('evidence_items');
    const checks = await count('contract_clause_checks');
    expect(evidence).toBeGreaterThan(4);
    expect((await t.api.get('/api/vendors/evidence-expiring?days=90')).body.rows.length).toBeGreaterThan(2);
    expect((await t.api.get('/api/contracts/renewals')).body.contracts.length).toBeGreaterThan(5);
    await seed(t.ctx, { profile: 'dev', seedDir: join(seedDir, 'does-not-exist') });
    expect((await count('vendors')) - vendorsBefore).toBe(6);
    expect(await count('evidence_items')).toBe(evidence);
    expect(await count('contract_clause_checks')).toBe(checks);
  });
});
