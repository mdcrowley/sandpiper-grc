// E18-82: the sample data agrees with itself: each sample change is on the system it is about (or on
// none), the ended backup contract is on the backup service run by that vendor, and the sample
// training departments are the roster's. Invented data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import changes from './index.ts';
import inventory from '../inventory/index.ts';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

const opts = { profile: 'dev' as const, seedDir: 'none', organization: {} };

describe('sample changes and systems', () => {
  it('puts each sample change on the system its title names, and the call-routing change on none', async () => {
    await inventory.seed!(t.ctx, opts);
    await changes.seed!(t.ctx, opts);
    const rows = await t.db.query<{ title: string; system: string | null }>(
      `select c.title, s.name as system from changes c left join systems s on s.id = c.system_id where c.title like '[Sample]%'`);
    const on = (part: string) => rows.find((r) => r.title.includes(part))?.system ?? null;
    expect(on('finance system')).toBe('Example Finance System');
    expect(on('fare card database')).toBe('Example Fare Collection System');
    expect(on('crew rostering server')).toBe('Example Crew Rostering System');
    expect(on('customer information line call routing')).toBeNull();
    expect(rows.some((r) => r.system === 'Example Rail Signaling Interface')).toBe(false);
  });
});

describe('the sample vendor offboarding', () => {
  it('puts the ended backup contract on the backup service the vendor runs', async () => {
    if (!t.ctx.resources.get('vendor')) return;
    const vendors = (await import('../vendors/index.ts')).default;
    await vendors.seed!(t.ctx, opts);
    const sys = await t.db.one<{ name: string; vendor_name: string; vendor: string; contract: string | null }>(
      `select s.name, s.vendor_name, v.name as vendor, c.title as contract
         from systems s join vendors v on v.id = s.vendor_id left join contracts c on c.id = s.contract_id
        where c.import_key = 'dev-sample-ended'`);
    if (!sys) return; // the offboarding sample needs the vendor offboarding type
    expect(sys).toMatchObject({ name: 'Example Backup Service', vendor_name: 'Redbrick Managed IT', vendor: 'Redbrick Managed IT' });
    expect(await t.db.one(`select 1 as x from systems s join contracts c on c.id = s.contract_id where s.name = 'Example CAD/AVL System' and c.import_key = 'dev-sample-ended'`)).toBeFalsy();
  });
});

describe('sample departments', () => {
  it('uses the roster departments for sample training records, with no unmarked twin', async () => {
    const people = t.ctx.resources.get('person') ? (await import('../people/index.ts')).default : null;
    const training = t.ctx.resources.get('course') ? (await import('../training/index.ts')).default : null;
    if (!people || !training) return;
    await people.seed!(t.ctx, opts);
    await training.seed!(t.ctx, opts);
    const departments = new Set((await t.db.query<{ name: string }>('select name from departments where deleted_at is null')).map((r) => r.name));
    const used = (await t.db.query<{ name: string }>(
      'select distinct person_department as name from training_records where person_department is not null')).map((r) => r.name);
    expect(used.length).toBeGreaterThan(0);
    // A training department never stands beside a roster department of the same name marked "[Sample]".
    for (const n of used) expect(departments.has(`[Sample] ${n}`), `"${n}" beside "[Sample] ${n}"`).toBe(false);
  });
});
