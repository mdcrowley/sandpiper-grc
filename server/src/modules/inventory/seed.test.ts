import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import inventory from './index.ts';
import { deriveHosting, deriveStatus, matchCategories, namesPhrase } from './seed.ts';

// Small invented pipe-delimited files in a temp folder. The real seed folder is never read.
let t: Awaited<ReturnType<typeof testApp>>;
let dir: string;

const FILES: Record<string, string[]> = {
  'sites.psv': [
    'Site|Address|Function|Technology known to be there|Power and physical protection|Others on site|To confirm',
    'Pretend Warehouse|1 Pretend Way|Maintenance|Wifi; the Pretend Ops consoles|Generator; fenced|None|Who holds keys',
    'Pretend Office|2 Pretend Way|Administration|Printers|Battery backup|A tenant|',
  ],
  'data_categories.psv': [
    'Data category|What it contains|Where held|Custodian (role)|Shared with|Rule or agreement that applies|Retention found|Gaps',
    'Staff payroll data|Pay and bank details|Finance system|Finance lead|Bank|Internal policy|7 years|No review date',
    'Customer survey data|Answers and emails|Shared drive|Planning lead|Nobody|None found|Not stated|',
    'Camera footage|Video|Recorders|Safety lead|Police on request|Video policy|30 days|',
  ],
  'systems.psv': [
    'Group|System|Vendor|What it does|Main users|Hosting|Status and outlook|Sensitive data held|Agreement on file|Source|To confirm',
    'Operations|Pretend Ops|Madeup Corp|Tracks jobs|Operations staff|Vendor cloud|In use; renewed yearly|None|Yes|Interview|Renewal date',
    'Finance|Pretend Payroll|Fictional Inc|Pays staff|Finance|PRETEND servers|To be replaced next year|Staff payroll and bank details|No|Contract list|',
    'Finance|Pretend Ledger|Fictional Inc|Accounts|Finance|PRETEND server; moving to a vendor cloud|Under review|Supplier invoices|No|Contract list|Owner',
    'Public|Pretend Survey Tool|Not known|Collects answers|Planning|Not known|Trial|Customer survey answers|None|Email|',
    '',
  ],
};

beforeAll(async () => {
  t = await testApp();
  dir = mkdtempSync(join(tmpdir(), 'grc-inventory-seed-'));
  for (const [name, lines] of Object.entries(FILES)) writeFileSync(join(dir, name), lines.join('\r\n'), 'utf8');
});
afterAll(async () => {
  await t.close();
  rmSync(dir, { recursive: true, force: true });
});

const counts = async () => {
  const one = async (sql: string) => (await t.db.one<{ c: number }>(sql))!.c;
  return {
    systems: await one('select count(*)::int c from systems where deleted_at is null'),
    sites: await one('select count(*)::int c from sites where deleted_at is null'),
    categories: await one('select count(*)::int c from data_categories where deleted_at is null'),
    assets: await one('select count(*)::int c from assets where deleted_at is null'),
    dataLinks: await one('select count(*)::int c from system_data_categories'),
    siteLinks: await one('select count(*)::int c from system_sites'),
    integrations: await one('select count(*)::int c from system_integrations'),
  };
};

describe('derivations', () => {
  it('derives hosting only when the text is unambiguous', () => {
    expect(deriveHosting('Vendor cloud').hosting_type).toBe('vendor_hosted');
    expect(deriveHosting('Vendor hosted (example.test)').hosting_type).toBe('vendor_hosted');
    expect(deriveHosting('PRETEND servers').hosting_type).toBe('on_premises');
    expect(deriveHosting('Bigco cloud (business plan)')).toEqual({ hosting_type: 'cloud', hosting_provider: 'Bigco' });
    for (const text of ['PRETEND server; moving to a vendor cloud', 'On site; a cloud move was discussed', 'Not known', 'Vendor', '', null]) {
      expect(deriveHosting(text).hosting_type).toBeNull();
    }
  });

  it('derives status and matches names conservatively', () => {
    expect(deriveStatus('In use since last year')).toBe('in_use');
    expect(deriveStatus('To be replaced next year')).toBe('being_replaced');
    expect(deriveStatus('Trial')).toBeNull();
    const cats = [{ name: 'Staff payroll data' }, { name: 'Customer survey data' }, { name: 'Camera footage' }];
    expect(matchCategories('Staff payroll and bank details', cats).map((c) => c.name)).toEqual(['Staff payroll data']);
    expect(matchCategories('Staff rotas', cats)).toEqual([]);
    expect(matchCategories('None', cats)).toEqual([]);
    expect(namesPhrase('Wifi; the Pretend Ops consoles', 'Pretend Ops')).toBe(true);
    expect(namesPhrase('Pretend Operations desks', 'Pretend Ops')).toBe(false);
  });
});

describe('seed', () => {
  it('skips pilot files that are not in the seed folder, and says which', async () => {
    const app = await testApp();
    try {
      const note = await inventory.seed!(app.ctx, { profile: 'pilot', seedDir: join(dir, 'does-not-exist') });
      expect(note).toContain('systems 0, sites 0, data categories 0');
      expect(note).toContain('not in the seed folder and skipped: sites.psv, data_categories.psv, systems.psv');
      expect(note).not.toContain('sample assets');
    } finally {
      await app.close();
    }
  });
  it('loads the pilot files and is safe to run twice', async () => {
    const first = await inventory.seed!(t.ctx, { profile: 'pilot', seedDir: dir });
    expect(first).toContain('systems 4, sites 2, data categories 3');
    expect(first).not.toContain('sample assets');
    const after = await counts();
    expect(after).toEqual({ systems: 4, sites: 2, categories: 3, assets: 0, dataLinks: 2, siteLinks: 1, integrations: 0 });

    const payroll = (await t.api.get('/api/systems?q=Pretend Payroll')).body.rows[0];
    expect(payroll).toMatchObject({
      system_group: 'Finance', vendor_name: 'Fictional Inc', function: 'Pays staff', users: 'Finance',
      hosting_notes: 'PRETEND servers', hosting_type: 'on_premises', status: 'being_replaced',
      status_outlook: 'To be replaced next year', sensitive_data_held: 'Staff payroll and bank details',
      agreement_on_file: 'No', source: 'Contract list', vendor_id: null,
    });
    expect(payroll.ref).toMatch(/^SYS-/);
    expect((await t.api.get(`/api/systems/${payroll.id}/data-categories`)).body.map((c: any) => c.name)).toEqual(['Staff payroll data']);
    const ledger = (await t.api.get('/api/systems?q=Pretend Ledger')).body.rows[0];
    expect(ledger).toMatchObject({ hosting_type: null, status: null, to_confirm: 'Owner' });
    const warehouse = (await t.api.get('/api/sites?q=Pretend Warehouse')).body.rows[0];
    expect(warehouse).toMatchObject({ address: '1 Pretend Way', protection_notes: 'Generator; fenced', to_confirm: 'Who holds keys' });
    expect((await t.api.get(`/api/sites/${warehouse.id}/systems`)).body.map((s: any) => s.name)).toEqual(['Pretend Ops']);
    const category = (await t.api.get('/api/data-categories?q=Staff payroll')).body.rows[0];
    expect(category).toMatchObject({ custodian: 'Finance lead', retention_period: '7 years', gaps: 'No review date' });

    // A value chosen by a person survives a re-run; nothing is duplicated; no new audit noise.
    await t.api.patch(`/api/systems/${ledger.id}`, { hosting_type: 'hybrid', status: 'in_use' });
    const events = (await t.db.one<{ c: number }>('select count(*)::int c from audit_events'))!.c;
    const second = await inventory.seed!(t.ctx, { profile: 'pilot', seedDir: dir });
    expect(second).toContain('systems 4, sites 2, data categories 3');
    expect(await counts()).toEqual(after);
    expect((await t.api.get(`/api/systems/${ledger.id}`)).body).toMatchObject({ hosting_type: 'hybrid', status: 'in_use' });
    expect((await t.db.one<{ c: number }>('select count(*)::int c from audit_events'))!.c).toBe(events);
  });

  it('generates an invented estate for the dev profile, idempotently', async () => {
    const before = await counts();
    const note = await inventory.seed!(t.ctx, { profile: 'dev', seedDir: join(dir, 'does-not-exist') });
    expect(note).toContain('systems 24, sites 6, data categories 8');
    const after = await counts();
    expect(after.systems - before.systems).toBe(24);
    expect(after.sites - before.sites).toBe(6);
    expect(after.categories - before.categories).toBe(8);
    expect(after.assets).toBe(23);
    expect(note).toContain('sample assets 23 (23 new)');
    expect(after.integrations).toBe(28);
    // Sample assets with funder interest and past support, tied to the invented estate.
    const all = (await t.api.get('/api/assets?pageSize=100')).body.rows;
    expect(all.every((a: any) => a.name.startsWith('[Sample]'))).toBe(true);
    expect(all.filter((a: any) => a.funder_interest).length).toBeGreaterThanOrEqual(2);
    expect((await t.api.get('/api/inventory/reports/assets-past-support')).body.total).toBeGreaterThanOrEqual(2);
    expect(all.some((a: any) => a.system_id !== null && a.site_id !== null)).toBe(true);
    await inventory.seed!(t.ctx, { profile: 'dev', seedDir: dir });
    expect(await counts()).toEqual(after);
    const graph = (await t.api.get('/api/systems/graph')).body;
    expect(graph.nodes.filter((n: any) => n.type === 'system')).toHaveLength(28);
    expect(graph.edges.filter((e: any) => e.kind === 'integration')).toHaveLength(28);
  });
});
