// Invented sample roster (dev profile only): 120 people across eight positions, marked "[Sample]".
// Every name, number and department is invented. Idempotent: added only while no sample
// position exists, so later edits and deletions are never undone.
import type { ModuleContext, Row, SeedOptions } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';

export const SAMPLE_POSITIONS: { key: string; name: string; code: string; department: string; safety: boolean; count: number; description: string }[] = [
  { key: 'bus_operator', name: '[Sample] Bus operator', code: 'BO', department: '[Sample] Operations', safety: true, count: 34, description: 'Drives fixed-route buses.' },
  { key: 'rail_operator', name: '[Sample] Rail operator', code: 'RO', department: '[Sample] Operations', safety: true, count: 20, description: 'Operates light-rail trains.' },
  { key: 'maintainer', name: '[Sample] Rolling stock maintainer', code: 'VM', department: '[Sample] Maintenance', safety: true, count: 18, description: 'Inspects and repairs buses and trains at the depots.' },
  { key: 'signal_maintainer', name: '[Sample] Signal maintainer', code: 'SM', department: '[Sample] Maintenance', safety: true, count: 10, description: 'Maintains signals, switches and track circuits.' },
  { key: 'supervisor', name: '[Sample] Supervisor', code: 'SU', department: '[Sample] Operations', safety: true, count: 10, description: 'Leads a shift of operators or maintainers.' },
  { key: 'dispatcher', name: '[Sample] Dispatcher', code: 'DI', department: '[Sample] Operations', safety: true, count: 8, description: 'Controls service from the operations center.' },
  { key: 'station_agent', name: '[Sample] Station agent', code: 'SA', department: '[Sample] Customer service', safety: false, count: 12, description: 'Helps riders at stations.' },
  { key: 'office', name: '[Sample] Office staff', code: 'OF', department: '[Sample] Administration', safety: false, count: 8, description: 'Finance, planning and administration.' },
];

const FIRST = ['Alex', 'Bailey', 'Cameron', 'Dana', 'Elliot', 'Frankie', 'Gale', 'Harper', 'Indy', 'Jordan', 'Kai', 'Logan', 'Morgan', 'Noel', 'Oakley', 'Parker', 'Quinn', 'Riley', 'Sage', 'Taylor', 'Umi', 'Val', 'Wren', 'Yael', 'Zion'];
const LAST = ['Abara', 'Brennick', 'Castellane', 'Dorvault', 'Eskeland', 'Farrowby', 'Galimore', 'Hestrow', 'Ilvane', 'Jessop-Ray', 'Kordell', 'Lunquist', 'Marrowfield', 'Nettleby', 'Orsini-Bay', 'Pellworth', 'Quarrington', 'Rosswell', 'Saltmarsh', 'Tindale', 'Underhay', 'Vantroy', 'Wexcombe', 'Yarrowby', 'Zellner'];

/** The sample roster's departments, created when missing (names marked "[Sample]"). */
async function department(ctx: ModuleContext, name: string): Promise<string> {
  const row = (await ctx.db.one<Row>('select id from departments where name = $1 and deleted_at is null', [name]))
    ?? (await ctx.db.one<Row>('insert into departments (name) values ($1) returning id', [name]))!;
  return row.id;
}

export async function seedPeople(ctx: ModuleContext, opts: SeedOptions): Promise<string> {
  if (opts.profile !== 'dev') return 'sample roster only in the dev profile';
  if (await ctx.db.one(`select 1 from positions where name = $1`, [SAMPLE_POSITIONS[0].name])) return 'sample roster already present';
  const today = todayInZone();
  const sites = ctx.resources.get('site')
    ? await ctx.db.query<Row>(`select id from sites where deleted_at is null order by name limit 4`) : [];
  let n = 0;
  const supervisors = new Map<string, string[]>(); // department -> supervisor person ids
  const created: Row[] = [];
  for (const p of SAMPLE_POSITIONS) {
    const dept = await department(ctx, p.department);
    const pos = await ctx.resources.create('position', {
      name: p.name, code: p.code, department_id: dept, safety_sensitive: p.safety, active: true, description: p.description,
    });
    for (let i = 0; i < p.count; i++) {
      const first = FIRST[(n * 7 + 3) % FIRST.length];
      const last = LAST[(n * 11 + 5 + Math.floor(n / FIRST.length)) % LAST.length];
      const years = 1 + ((n * 13) % 22);
      const hire = `${Number(today.slice(0, 4)) - years}-${String(1 + (n % 12)).padStart(2, '0')}-${String(1 + (n % 27)).padStart(2, '0')}`;
      const row = await ctx.resources.create('person', {
        full_name: `[Sample] ${first} ${last}`,
        employee_number: `S-${1001 + n}`,
        email: n % 3 === 0 ? `sample.roster${1001 + n}@example.test` : null,
        department_id: dept, position_id: pos.id,
        work_site_id: sites.length ? sites[n % sites.length].id : null,
        hire_date: hire,
        status: n % 29 === 7 ? 'on_leave' : 'active',
      });
      created.push({ ...row, department: p.department, position: p.key });
      if (p.key === 'supervisor') supervisors.set(p.department, [...(supervisors.get(p.department) ?? []), row.id]);
      n++;
    }
  }
  // Each frontline person reports to a supervisor of their department, when there is one.
  const fallback = supervisors.get('[Sample] Operations') ?? [];
  for (const [i, person] of created.entries()) {
    if (person.position === 'supervisor' || person.position === 'office') continue;
    const pool = supervisors.get(person.department) ?? fallback;
    if (pool.length) await ctx.resources.update('person', person.id, { supervisor_person_id: pool[i % pool.length] });
  }
  return `${SAMPLE_POSITIONS.length} sample positions, ${n} sample people on the roster`;
}
