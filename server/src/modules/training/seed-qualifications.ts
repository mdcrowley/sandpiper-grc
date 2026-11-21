// Invented sample qualifications (E29-12): requirements for the sample positions, a briefing
// course assigned by position, about 200 certifications (some expiring, some expired) and
// completions, for the sample roster the people module seeds in the dev profile. Idempotent:
// added only while the sample briefing course does not exist.
import type { ModuleContext, Row } from '../../core/module.ts';
import { addDays, addMonths } from './dates.ts';
import { rosterOn } from './people.ts';

const COURSE = '[Sample] Frontline rulebook briefing';
/** Certification types each sample position needs (by the people seed's position keys). */
const NEEDS: Record<string, string[]> = {
  bus_operator: ['vehicle_operator_license', 'medical_fitness'],
  rail_operator: ['safety_critical_competence', 'medical_fitness'],
  maintainer: ['equipment_operator'],
  signal_maintainer: ['track_access', 'electrical_safety'],
  supervisor: ['first_aid', 'safety_critical_competence'],
  dispatcher: ['safety_critical_competence'],
  station_agent: ['first_aid'],
  office: [],
};
const POSITION_NAMES: Record<string, string> = {
  bus_operator: '[Sample] Bus operator', rail_operator: '[Sample] Rail operator', maintainer: '[Sample] Rolling stock maintainer',
  signal_maintainer: '[Sample] Signal maintainer', supervisor: '[Sample] Supervisor', dispatcher: '[Sample] Dispatcher',
  station_agent: '[Sample] Station agent', office: '[Sample] Office staff',
};

export async function seedSampleQualifications(ctx: ModuleContext, today: string): Promise<string | null> {
  if (!rosterOn(ctx.db)) return null;
  const positions = new Map<string, Row>();
  for (const [key, name] of Object.entries(POSITION_NAMES)) {
    const p = await ctx.db.one<Row>('select id from positions where name = $1 and deleted_at is null', [name]);
    if (p) positions.set(key, p);
  }
  if (!positions.size) return null;
  if (await ctx.db.one('select 1 from courses where title = $1', [COURSE])) return 'sample qualifications already present';

  const types = new Map((await ctx.lookups.values('certification_type')).map((v) => [v.value, v.meta as Row]));
  const course = await ctx.resources.create('course', {
    title: COURSE, description: 'Invented sample: the yearly briefing on the rulebook for frontline staff in critical positions.',
    category: 'induction', format: 'briefing', duration_minutes: 90, recurrence_months: 12, due_days: 30, mandatory: true, status: 'active',
  });
  let requirements = 0;
  for (const [key, pos] of positions) {
    if (key !== 'office') {
      await ctx.db.query(`insert into position_requirements (position_id, kind, course_id, mandatory, grace_days) values ($1, 'course', $2, true, 14)`, [pos.id, course.id]);
      requirements++;
    }
    for (const t of NEEDS[key] ?? []) {
      await ctx.db.query(`insert into position_requirements (position_id, kind, certification_type, mandatory, grace_days) values ($1, 'certification', $2, true, 0)`, [pos.id, t]);
      requirements++;
    }
  }

  // Completions of the briefing: most within the year, a few lapsed, a few never done.
  const people = await ctx.db.query<Row>(
    `select p.id, p.user_id, pos.name as position from people p join positions pos on pos.id = p.position_id
     where p.deleted_at is null and p.employee_number like 'S-%' order by p.employee_number`);
  const keyOf = (name: string) => Object.entries(POSITION_NAMES).find(([, n]) => n === name)?.[0] ?? 'office';
  let completions = 0;
  let certs = 0;
  for (const [i, p] of people.entries()) {
    const key = keyOf(p.position);
    if (key !== 'office' && i % 11 !== 4) {
      const ago = i % 9 === 2 ? 400 + (i % 40) : 20 + ((i * 37) % 320);
      const done = addDays(today, -ago);
      await ctx.db.query(
        `insert into training_records (course_id, user_id, person_id, person_key, assigned_on, due_on, completed_on, result, source, assigned_notified_at)
         values ($1, $2, $3, $4, $5::date, $6::date, $5::date, 'attended', 'import', now())`,
        [course.id, p.user_id ?? null, p.id, p.user_id ? `u:${p.user_id}` : `p:${p.id}`, done, addDays(done, 30)]);
      completions++;
    }
    for (const [j, t] of (NEEDS[key] ?? []).entries()) {
      if ((i + j) % 17 === 9) continue; // a few have not given theirs yet
      const months = Number(types.get(t)?.validity_months) || 24;
      // Spread issue dates so some have expired and some expire within 30, 60 or 90 days.
      const daysLeft = (i + j) % 13 === 3 ? -(5 + (i % 40)) : (i + j) % 7 === 1 ? 10 + ((i * 7) % 80) : 100 + ((i * 53 + j * 29) % (months * 30 - 120));
      const expires = addDays(today, daysLeft);
      const issued = addMonths(expires, -months);
      await ctx.resources.create('certification', {
        person_id: p.id, certification_type: t, number: `SMP-${String(10000 + i * 10 + j)}`, issued_on: issued, expires_on: expires,
        status: 'active',
      });
      certs++;
    }
  }
  // The briefing is assigned by position (rules), so newcomers to those positions are asked too.
  for (const [key, pos] of positions) {
    if (key === 'office') continue;
    await ctx.db.query(`insert into training_assignments (course_id, audience_type, position_id) values ($1, 'position', $2)`, [course.id, pos.id]);
  }
  await ctx.audit(null, {
    action: 'training.seed', recordType: 'course', recordId: course.id,
    summary: `Sample qualifications added: ${requirements} requirements, ${certs} certifications, ${completions} briefing completions`,
  });
  return `${requirements} sample requirements, ${certs} sample certifications, ${completions} briefing completions`;
}
