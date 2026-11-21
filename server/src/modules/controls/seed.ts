import type { ModuleContext, Row, SeedOptions } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { rollUp } from './controls.ts';
import { COVER_TYPES, COVERS } from './shared.ts';

/**
 * Invented sample controls for the `dev` profile (E26-10): twenty controls, thirty tests over the
 * past year (three ineffective, each with a corrective action plan when the action tracker offers
 * them), and coverage of the sample risks, hazards, framework outcomes, obligations and policies.
 *
 * Modules seed in alphabetical order, so most covered records are created after this module's
 * seed. Coverage is therefore linked twice: now, to matching records that already exist, and, for
 * the rest of the seed run, as each matching sample record is created (a record-change listener that
 * lives only as long as the seed command). Nothing is linked to records that do not match.
 */

export const SAMPLE_NOTE = 'Invented sample control (dev profile).';

type Cover = Partial<Record<(typeof COVER_TYPES)[number], RegExp>>;
interface SampleControl {
  title: string; objective: string; description: string; control_type: string; automation: string; frequency: string;
  domain: string; key?: boolean; months: number; status?: string; covers: Cover;
}

const CONTROLS: SampleControl[] = [
  { title: 'Remote-access sign-in needs a second factor', objective: 'Only authorized staff and suppliers reach internal systems from outside.', description: 'The remote-access gateway refuses a sign-in without a second factor; exceptions are approved and listed.', control_type: 'preventive', automation: 'automated', frequency: 'continuous', domain: 'cyber', key: true, months: 6, covers: { risk: /ransomware|depot network/i, framework_outcome: /\bPR\.AA-03\b/, policy: /remote working/i, obligation: /cyber insurance/i } },
  { title: 'Backup restore test', objective: 'Backups can be restored within the agreed time.', description: 'Each quarter a sample of systems is restored from backup to a test environment and the time taken is recorded.', control_type: 'corrective', automation: 'manual', frequency: 'quarterly', domain: 'cyber', key: true, months: 6, covers: { risk: /ransomware|data room|CAD\/AVL/i, framework_outcome: /\bPR\.DS-11\b/, policy: /backup/i, obligation: /cyber insurance/i } },
  { title: 'Camera footage retention review', objective: 'On-vehicle camera footage is kept for the agreed time and no longer.', description: 'Each month a sample of vehicles is checked: footage older than the retention period is gone and footage under a hold is kept.', control_type: 'detective', automation: 'manual', frequency: 'monthly', domain: 'operational', months: 6, covers: { hazard: /abuse of operators/i, policy: /on-vehicle/i } },
  { title: 'Pre-service vehicle check', objective: 'No vehicle enters service with a known defect in its doors, ramp or brakes.', description: 'Operators complete the pre-service check sheet before leaving the depot; defects are reported and the vehicle is held.', control_type: 'preventive', automation: 'manual', frequency: 'daily', domain: 'safety', key: true, months: 6, covers: { hazard: /ramp failures|doors closing|pulls away/i } },
  { title: 'Speed monitoring in the depot yard', objective: 'Vehicles keep to the yard speed limit.', description: 'Telematics alerts the yard supervisor when a vehicle exceeds the yard limit; alerts are followed up the same shift.', control_type: 'detective', automation: 'automated', frequency: 'continuous', domain: 'safety', months: 12, covers: { hazard: /reversing in the depot|pedestrians stepping/i } },
  { title: 'Quarterly user access review', objective: 'Only people who need it keep access to business systems.', description: 'System owners confirm each account and its permissions every quarter; leavers and unneeded rights are removed.', control_type: 'detective', automation: 'manual', frequency: 'quarterly', domain: 'cyber', key: true, months: 6, covers: { risk: /fare collection|depot network/i, framework_outcome: /\bPR\.AA-05\b/, policy: /access control/i } },
  { title: 'Security updates installed within the agreed time', objective: 'Known weaknesses are fixed before they can be used.', description: 'Updates rated critical are installed within 14 days, others within 30; the monthly report lists what is late.', control_type: 'preventive', automation: 'it_dependent_manual', frequency: 'monthly', domain: 'cyber', key: true, months: 3, covers: { risk: /unpatched|unsupported operating system/i, framework_outcome: /\bPR\.PS-02\b/ } },
  { title: 'Security log monitoring with alerts', objective: 'Suspicious activity is noticed and looked into quickly.', description: 'Logs from servers and network devices are collected centrally; alert rules page the on-call engineer.', control_type: 'detective', automation: 'automated', frequency: 'continuous', domain: 'cyber', months: 12, covers: { risk: /depot network/i, framework_outcome: /\b(DE\.CM-01|PR\.PS-04)\b/ } },
  { title: 'Supplier security assessment before award', objective: 'Suppliers that handle data or systems meet the security terms.', description: 'Procurement does not award a contract with system or data access until the security assessment is complete.', control_type: 'preventive', automation: 'manual', frequency: 'as_needed', domain: 'compliance', months: 12, covers: { risk: /supplier fails/i, framework_outcome: /\bGV\.SC-07\b/, policy: /supplier security/i } },
  { title: 'Change approval before production changes', objective: 'Changes to live systems are assessed and approved first.', description: 'The change register records the approval before the change window; unapproved changes are reported weekly.', control_type: 'preventive', automation: 'it_dependent_manual', frequency: 'as_needed', domain: 'operational', months: 12, covers: { risk: /CAD\/AVL/i, obligation: /technology changes/i } },
  { title: 'Fire suppression system inspection', objective: 'Fire suppression in the data room and charging areas works when needed.', description: 'A contractor inspects and tests the suppression systems once a year and certifies them.', control_type: 'preventive', automation: 'manual', frequency: 'yearly', domain: 'safety', months: 12, covers: { risk: /data room/i, hazard: /battery fire/i } },
  { title: 'Depot door release test', objective: 'Access-controlled doors open for an evacuation.', description: 'Each quarter the fire alarm release is tested on every access-controlled depot door.', control_type: 'detective', automation: 'manual', frequency: 'quarterly', domain: 'safety', months: 3, covers: { risk: /door access/i } },
  { title: 'Operator radio alarm test', objective: 'An operator\'s alarm reaches the control room at once.', description: 'Each month a sample of vehicles sends a test alarm and the control room confirms it.', control_type: 'detective', automation: 'manual', frequency: 'monthly', domain: 'safety', months: 3, covers: { hazard: /abuse of operators/i } },
  { title: 'Payment card data discovery scan', objective: 'Card numbers are stored only where they are allowed.', description: 'A scheduled scan looks for card numbers outside the payment environment; findings are removed.', control_type: 'detective', automation: 'automated', frequency: 'quarterly', domain: 'compliance', months: 6, covers: { obligation: /payment security/i, risk: /fare collection/i } },
  { title: 'Software license reconciliation', objective: 'Installed software matches what is licensed.', description: 'Once a year the software inventory is compared with license entitlements before the true-up.', control_type: 'detective', automation: 'manual', frequency: 'yearly', domain: 'financial', months: 12, covers: { obligation: /license true-up/i } },
  { title: 'Purchase approval limits', objective: 'Purchases are approved by someone with the authority to approve them.', description: 'The purchasing system routes each order to an approver whose limit covers its value.', control_type: 'preventive', automation: 'it_dependent_manual', frequency: 'continuous', domain: 'financial', months: 12, status: 'draft', covers: {} },
  { title: 'Rail yard switch inspection', objective: 'Switch defects are found before they cause a derailment.', description: 'Track staff inspect every yard switch each week and record defects for repair.', control_type: 'detective', automation: 'manual', frequency: 'weekly', domain: 'safety', key: true, months: 3, covers: { hazard: /track defects/i } },
  { title: 'Road crossing signal function test', objective: 'Crossing signals and bells work at every road crossing.', description: 'Each month signal technicians test the signals, bells and detection at each crossing.', control_type: 'detective', automation: 'manual', frequency: 'monthly', domain: 'safety', key: true, months: 6, covers: { hazard: /road crossings/i, risk: /signal priority/i } },
  { title: 'Rest-time check in rostering', objective: 'No duty is rostered without the minimum rest before it.', description: 'The rostering system refuses a duty that breaks the rest rules; overrides need a supervisor.', control_type: 'preventive', automation: 'automated', frequency: 'daily', domain: 'safety', months: 6, covers: { hazard: /fatigue/i } },
  { title: 'Incident response plan exercise', objective: 'Staff know their part in the incident response plan.', description: 'Once a year a tabletop exercise walks through a cyber incident; lessons go to the action tracker.', control_type: 'corrective', automation: 'manual', frequency: 'yearly', domain: 'cyber', months: 12, covers: { framework_outcome: /\bRS\.MA-01\b/, policy: /incident response/i } },
];

/** [control index, test type, days ago (negative = planned ahead), result, status]. Thirty tests. */
const TESTS: [number, 'design' | 'operating', number, string | null, string][] = [
  [0, 'design', 330, 'effective', 'reviewed'], [5, 'design', 300, 'effective', 'reviewed'], [16, 'design', 270, 'effective', 'reviewed'],
  [7, 'design', 240, 'partly_effective', 'reviewed'], [15, 'design', -20, null, 'planned'],
  [0, 'operating', 180, 'effective', 'reviewed'], [1, 'operating', 270, 'effective', 'reviewed'], [4, 'operating', 300, 'effective', 'reviewed'],
  [6, 'operating', 240, 'effective', 'reviewed'], [11, 'operating', 210, 'effective', 'reviewed'],
  [0, 'operating', 12, 'effective', 'complete'], [1, 'operating', 60, 'effective', 'reviewed'], [2, 'operating', 90, 'ineffective', 'reviewed'],
  [3, 'operating', -10, null, 'planned'], [4, 'operating', 120, 'effective', 'reviewed'], [5, 'operating', 60, 'partly_effective', 'reviewed'],
  [6, 'operating', 55, 'ineffective', 'reviewed'], [7, 'operating', 150, 'effective', 'reviewed'], [8, 'operating', 180, 'effective', 'reviewed'],
  [9, 'operating', 270, 'effective', 'reviewed'], [10, 'operating', 8, 'effective', 'complete'], [11, 'operating', 30, 'ineffective', 'reviewed'],
  [12, 'operating', -5, null, 'in_progress'], [13, 'operating', 95, 'partly_effective', 'reviewed'], [14, 'operating', 330, 'effective', 'reviewed'],
  [16, 'operating', 125, 'effective', 'reviewed'], [17, 'operating', 75, 'effective', 'reviewed'], [18, 'operating', 200, 'partly_effective', 'reviewed'],
  [19, 'operating', 340, 'effective', 'reviewed'], [8, 'operating', -30, null, 'planned'],
];

const FAILED_SAMPLES: Record<number, [string, string, string | null][]> = {
  2: [['Bus 1104, depot recorder', 'exception', 'Footage from five months ago still on the recorder.'], ['Bus 1131, depot recorder', 'pass', null], ['Tram 207, on-board recorder', 'exception', 'Automatic deletion switched off after a repair.'], ['Bus 1150, depot recorder', 'pass', null]],
  6: [['Fare system servers', 'exception', 'Critical update installed after 41 days.'], ['Dispatch workstations', 'pass', null], ['Depot network switches', 'exception', 'Firmware update not scheduled.']],
  11: [['North depot, door N3', 'exception', 'Door stayed locked when the alarm sounded.'], ['North depot, door N1', 'pass', null], ['South depot, door S2', 'pass', null]],
};

/** Links sample controls to the covered records that match their patterns and are not linked yet. */
async function linkRecord(ctx: ModuleContext, controls: { id: string; covers: Cover }[], type: string, row: Row): Promise<number> {
  const def = ctx.resources.get(type);
  if (!def) return 0;
  const text = [def.ref ? row[def.ref.field] : '', row[def.titleField]].filter(Boolean).join(' ');
  let n = 0;
  for (const c of controls) {
    const re = c.covers[type as keyof Cover];
    if (!re || !re.test(text)) continue;
    const made = await ctx.db.one(
      `insert into record_links (from_type, from_id, to_type, to_id, relation) values ('control', $1, $2, $3, $4)
       on conflict (from_type, from_id, to_type, to_id, relation) do nothing returning id`,
      [c.id, type, row.id, COVERS],
    );
    if (made) n += 1;
  }
  return n;
}

export async function seedControls(ctx: ModuleContext, opts: SeedOptions): Promise<string> {
  if (opts.profile !== 'dev') return 'nothing to load (organizations import their own control catalog)';
  if (await ctx.db.one('select 1 from controls where notes = $1 limit 1', [SAMPLE_NOTE])) {
    const existing = await ctx.db.query<Row>('select id, title from controls where notes = $1 and deleted_at is null', [SAMPLE_NOTE]);
    const linked = await linkExisting(ctx, existing.map((r) => ({ id: r.id, covers: CONTROLS.find((c) => c.title === r.title)?.covers ?? {} })));
    return `sample controls already loaded${linked ? ` (${linked} coverage links added)` : ''}`;
  }
  const users = (await ctx.db.query<Row>(`select id from users where status = 'active' and deleted_at is null order by created_at limit 3`)).map((u) => u.id);
  const owner = users[0] ?? null;
  const tester = users[1] ?? users[0] ?? null;
  const reviewer = users.find((u) => u !== tester) ?? null;

  const made: { id: string; covers: Cover }[] = [];
  for (const c of CONTROLS) {
    const row = await ctx.resources.create('control', {
      title: c.title, objective: c.objective, description: c.description, control_type: c.control_type, automation: c.automation,
      frequency: c.frequency, domain: c.domain, key_control: !!c.key, status: c.status ?? 'active', test_every_months: c.months,
      owner_id: owner, operator_id: tester, next_test_due: dayInZone(20 + made.length * 9), notes: SAMPLE_NOTE,
    });
    made.push({ id: row.id, covers: c.covers });
  }

  const capType = ctx.resources.get('cap');
  const capsOn = !!capType && ['source_type', 'source_id', 'problem_statement'].every((f) => f in capType.fields);
  let tests = 0;
  let caps = 0;
  for (const [i, type, daysAgo, result, status] of TESTS) {
    const control = CONTROLS[i];
    const done = status === 'reviewed' || status === 'complete';
    const performed = daysAgo > 0 ? dayInZone(-daysAgo) : null;
    const failed = result === 'ineffective';
    const test = await ctx.resources.create('control_test', {
      control_id: made[i].id, test_type: type, status, result,
      planned_on: daysAgo > 0 ? dayInZone(-daysAgo - 7) : dayInZone(-daysAgo),
      performed_on: done ? performed : null,
      period_start: type === 'operating' && performed ? dayInZone(-daysAgo - 90) : null,
      period_end: type === 'operating' && performed ? dayInZone(-daysAgo - 1) : null,
      tester_id: tester,
      method: type === 'design' ? 'inquiry' : (control.automation === 'automated' ? 'reperformance' : 'inspection'),
      population: type === 'design' ? null : `Every occurrence of the control in the ninety days before testing (invented sample).`,
      sample_size: done ? (failed ? 0 : 25) : null,
      exceptions_found: done ? (result === 'effective' ? 0 : result === 'partly_effective' ? 2 : 0) : null,
      conclusion: !done ? null
        : failed ? 'The control did not operate as designed for part of the period. A corrective action plan has been raised.'
        : result === 'partly_effective' ? 'Minor exceptions found; the owner has agreed to tighten the procedure.'
        : 'The control operated as designed for the period tested.',
      ...(status === 'reviewed' ? { reviewer_id: reviewer, reviewed_on: dayInZone(-Math.max(daysAgo - 5, 1)), review_note: 'Checked the sample and the evidence (invented sample).' } : {}),
    });
    tests += 1;
    if (failed) {
      for (const [k, [item, r, note]] of (FAILED_SAMPLES[i] ?? []).entries()) {
        await ctx.db.query('insert into control_test_samples (test_id, item, result, note, sort) values ($1,$2,$3,$4,$5)', [test.id, item, r, note, (k + 1) * 10]);
      }
      const samples = FAILED_SAMPLES[i] ?? [];
      await ctx.db.query('update control_tests set sample_size = $2, exceptions_found = $3 where id = $1',
        [test.id, samples.length, samples.filter((s) => s[1] === 'exception').length]);
      if (capsOn) {
        const cap = await ctx.resources.create('cap', {
          title: `Fix control: ${control.title}`.slice(0, 200), source: 'control', source_type: 'control_test', source_id: test.id,
          problem_statement: `The control was rated ineffective by test ${test.ref}. ${test.conclusion}`,
          ...('responsible_id' in capType!.fields && owner ? { responsible_id: owner } : {}),
          ...('due_on' in capType!.fields ? { due_on: dayInZone(30) } : {}),
        });
        await ctx.resources.update('control_test', test.id, { cap_id: cap.id });
        caps += 1;
      }
    }
  }
  for (const c of made) await rollUp(ctx, c.id);

  const linked = await linkExisting(ctx, made);
  // Covered records the later modules create during this seed run are linked as they appear.
  ctx.resources.onChange?.(async ({ action, def, row, req }) => {
    if (action !== 'create' || req || !(COVER_TYPES as readonly string[]).includes(def.type)) return;
    await linkRecord(ctx, made, def.type, row);
  });
  return `${made.length} sample controls, ${tests} tests${capsOn ? `, ${caps} corrective action plans` : ''}, ${linked} coverage links to records already there (the rest are linked as their modules seed)`;
}

async function linkExisting(ctx: ModuleContext, controls: { id: string; covers: Cover }[]): Promise<number> {
  let n = 0;
  for (const type of COVER_TYPES) {
    const def = ctx.resources.get(type);
    if (!def) continue;
    const cols = [...new Set(['id', def.titleField, ...(def.ref ? [def.ref.field] : [])])];
    const rows = await ctx.db.query<Row>(`select ${cols.join(', ')} from ${def.table} where deleted_at is null`);
    for (const r of rows) n += await linkRecord(ctx, controls, type, r);
  }
  return n;
}
