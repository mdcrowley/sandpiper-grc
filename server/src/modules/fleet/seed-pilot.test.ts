import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import fleet from './index.ts';
import { SERVICE_COLUMNS, VEHICLE_COLUMNS } from './seed-pilot.ts';

// E19-13: vehicles.psv and services.psv in the pilot seed folder. Small invented files in a temp
// folder; the real seed folder is never read. Needs fleet and inventory (GRC_MODULES=fleet,inventory or all).
let t: Awaited<ReturnType<typeof testApp>>;
let dir: string;

const write = (name: string, lines: string[]) => writeFileSync(join(dir, name), lines.join('\r\n'), 'utf8');
const SITES = [
  'Site|Address|Function|Technology known to be there|Power and physical protection|Others on site|To confirm',
  'Pretend Garage East|9 Pretend Way|Bus garage|Yard wireless|Generator|None|',
];
const SYSTEMS = [
  'Group|System|Vendor|What it does|Main users|Hosting|Status and outlook|Sensitive data held|Agreement on file|Source|To confirm',
  'Operations|Pretend Dispatch|Madeup Corp|Tracks buses|Dispatchers|Vendor cloud|In use|None|Yes|Interview|',
  'Revenue|Pretend Fares|Fictional Inc|Takes fares|Revenue staff|Vendor cloud|In use|Card data|Yes|Interview|',
];
const VEHICLES = [
  VEHICLE_COLUMNS.join('|'),
  '5101|Bus|In service|Pretend Coachworks|Strider 12|2021|PRT5101|Pretend Garage East|2021-05-01|80|Grant|80|First electric bus',
  '5102|bus|spare|Pretend Coachworks|Strider 12|2019|PRT5102|Pretend Garage West|2019-02-01|80|||',
  '5103|Hovercraft|In service|||||||||| ',
  '5104|Bus||||1850|||||||',
  '|Bus|In service||||||||||',
  '',
];
const SERVICES = [
  SERVICE_COLUMNS.join('|'),
  '21|Pretend Crosstown|Bus|Fixed route|Running|Pretend Garage East|Every 15 minutes|Pretend Dispatch (CAD/AVL); Pretend Fares (Fare collection); Pretend Signals|',
  'X9|Pretend Express|bus|express||Pretend Garage East||Pretend Dispatch|Peak only',
  '22||Bus|Fixed route||||||',
];

beforeAll(async () => {
  t = await testApp();
  dir = mkdtempSync(join(tmpdir(), 'grc-fleet-seed-'));
  write('sites.psv', SITES);
  write('systems.psv', SYSTEMS);
  write('vehicles.psv', VEHICLES);
  write('services.psv', SERVICES);
});
afterAll(async () => {
  await t.close();
  rmSync(dir, { recursive: true, force: true });
});

const vehicle = (n: string) => t.db.one<any>('select * from vehicles where fleet_number = $1 and deleted_at is null', [n]);

describe('pilot seed: vehicles and services', () => {
  it('says there is nothing to load when neither file is in the seed folder', async () => {
    const note = await fleet.seed!(t.ctx, { profile: 'pilot', seedDir: join(dir, 'does-not-exist'), organization: {} } as any);
    expect(note).toMatch(/nothing to load: vehicles\.psv and services\.psv are not in the seed folder/);
  });

  it('loads vehicles and services, finds depots and systems by name, and names what it skipped', async () => {
    const note = await fleet.seed!(t.ctx, { profile: 'pilot', seedDir: dir, organization: {} } as any) as string;
    expect(note).toContain('vehicles 2 (2 new), services 2 (2 new), new links to systems 3');
    expect(note).toContain('not found, left empty: depot "Pretend Garage West", system "Pretend Signals"');
    expect(note).toContain('vehicles.psv line 4 (unknown mode "Hovercraft")');
    expect(note).toMatch(/vehicles\.psv line 5 \(Enter a four-digit year\.\)/);
    expect(note).toContain('vehicles.psv line 6 (no fleet number)');
    expect(note).toContain('services.psv line 4 (Route and Name are both needed)');
    expect(note).not.toContain('line 7'); // a blank line is ignored

    const garage = await t.db.one<any>(`select id from sites where name = 'Pretend Garage East'`);
    const first = await vehicle('5101');
    expect(first).toMatchObject({
      mode: 'bus', status: 'in_service', make: 'Pretend Coachworks', model_year: 2021, depot_id: garage.id,
      capacity: 80, funding_source: 'grant', funder_interest: true, funder_interest_pct: 80, notes: 'First electric bus',
    });
    expect(String(first.in_service_date)).toContain('2021-05-01');
    expect(await vehicle('5102')).toMatchObject({ status: 'spare', depot_id: null, funder_interest: false });

    const service = await t.db.one<any>(`select * from services where route_code = '21'`);
    expect(service).toMatchObject({ name: 'Pretend Crosstown', mode: 'bus', service_type: 'fixed_route', status: 'active', depot_id: garage.id });
    const deps = await t.db.query<any>(
      `select s.name, l.dependency from service_systems l join systems s on s.id = l.system_id where l.service_id = $1 order by s.name`, [service.id]);
    expect(deps).toEqual([{ name: 'Pretend Dispatch', dependency: 'cad_avl' }, { name: 'Pretend Fares', dependency: 'fare_collection' }]);
    expect(await t.db.one<any>(`select service_type, notes from services where route_code = 'X9'`)).toEqual({ service_type: 'express', notes: 'Peak only' });
  });

  it('is safe to run again: updates by fleet number and route, and never clears a value with an empty cell', async () => {
    write('vehicles.psv', [VEHICLE_COLUMNS.join('|'), '5101|Bus|In maintenance||||||||||', '5102|Bus|||||||||||Spare for the depot']);
    const note = await fleet.seed!(t.ctx, { profile: 'pilot', seedDir: dir, organization: {} } as any) as string;
    expect(note).toContain('vehicles 2 (0 new), services 2 (0 new), new links to systems 0');
    expect(await vehicle('5101')).toMatchObject({ status: 'in_maintenance', make: 'Pretend Coachworks', capacity: 80 });
    expect((await vehicle('5102')).notes).toBe('Spare for the depot');
    expect((await t.db.one<{ c: number }>('select count(*)::int c from vehicles where deleted_at is null'))!.c).toBe(2);
    expect((await t.db.one<{ c: number }>('select count(*)::int c from services where deleted_at is null'))!.c).toBe(2);
    expect((await t.db.one<{ c: number }>(`select count(*)::int c from sites where name = 'Pretend Garage East'`))!.c).toBe(1);
  });
});
