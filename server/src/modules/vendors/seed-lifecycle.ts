// Invented samples of the vendor risk lifecycle (E35-06), dev profile only, all labeled "[Sample]":
// completed assessments that make three reassessments overdue, twelve exclusion-list checks (one
// possible match), five vendor issues (one with a corrective action plan) and one offboarding in
// progress for an ended sample contract, with system, remote-access and asset items. It links only
// to records that already exist and can be run again.
import type { ModuleContext, Row } from '../../core/module.ts';
import { oldSampleName, renameSamples, type SampleRename } from '../inventory/seed-rename.ts';
import { addDays, localDate } from './dates.ts';
import { recomputeVendor } from './lifecycle.ts';

const SAMPLE = '[Sample]';
const mark = (text: string) => `${SAMPLE} ${text}`;

/** [vendor name, days ago of the last completed assessment, or null for never] */
const ASSESSED: [string, number | null][] = [
  ['Northbank Software', 400],      // critical, 12 months: overdue
  ['Harbour Signal Systems', 380],  // critical: overdue
  ['Castle Peak Telecom', 420],     // high, 12 months: overdue
  ['Linden Payment Services', 100],
  ['Quillfeather Mapping', 200],    // low, 36 months
];

/** [vendor name, [days ago, result, reference, note]...]: two checks each, twelve in all. */
const CHECKS: [string, [number, string, string, string | null][]][] = [
  ['Northbank Software', [[390, 'clear', 'SAMPLE-SEARCH-1041', null], [25, 'clear', 'SAMPLE-SEARCH-1187', null]]],
  ['Harbour Signal Systems', [[400, 'clear', 'SAMPLE-SEARCH-1043', null], [40, 'clear', 'SAMPLE-SEARCH-1179', null]]],
  ['Castle Peak Telecom', [[380, 'clear', 'SAMPLE-SEARCH-1050', null], [12, 'possible_match', 'SAMPLE-SEARCH-1201',
    '[Sample] A similar name appears on the list with a different address. Asked the vendor to confirm its registration number.']]],
  ['Linden Payment Services', [[360, 'clear', 'SAMPLE-SEARCH-1061', null], [60, 'clear', 'SAMPLE-SEARCH-1160', null]]],
  ['Quillfeather Mapping', [[350, 'clear', 'SAMPLE-SEARCH-1066', null], [90, 'clear', 'SAMPLE-SEARCH-1144', null]]],
  ['Redbrick Managed IT', [[800, 'clear', 'SAMPLE-SEARCH-0912', null], [430, 'clear', 'SAMPLE-SEARCH-1022', null]]], // overdue
];

const ISSUES: { vendor: string; title: string; category: string; severity: string; status: string; raised: number; description: string; resolution?: string; cap?: boolean }[] = [
  { vendor: 'Castle Peak Telecom', title: mark('Main phone line outage during the morning peak'), category: 'service_failure', severity: 'high', status: 'resolved', raised: 75,
    description: 'Customer service lines were down for 95 minutes; calls failed over only after a manual change.', resolution: 'Vendor fixed the failover rule and credited the month\'s charge.' },
  { vendor: 'Northbank Software', title: mark('Payroll export failed twice in one month'), category: 'service_failure', severity: 'high', status: 'in_progress', raised: 30, cap: true,
    description: 'The payroll export file was incomplete on two pay runs and had to be corrected by hand.' },
  { vendor: 'Linden Payment Services', title: mark('Card reader security update delayed'), category: 'security', severity: 'medium', status: 'open', raised: 14,
    description: 'A security update for the fare card readers is three weeks later than the vendor promised.' },
  { vendor: 'Quillfeather Mapping', title: mark('Invoice billed at the old rate'), category: 'billing', severity: 'low', status: 'open', raised: 9,
    description: 'The renewal invoice used last year\'s list price instead of the agreed rate.' },
  { vendor: 'Harbour Signal Systems', title: mark('Assurance report sent late'), category: 'compliance', severity: 'medium', status: 'closed', raised: 120,
    description: 'The yearly independent assurance report arrived two months after the date in the contract.', resolution: 'Report received and reviewed; delivery date added to the contract calendar.' },
];

const CONTRACT = mark('Redbrick legacy backup service');
/** The corrective action plan of a vendor issue: "[Sample] Vendor: issue". */
const capTitle = (vendor: string, title: string) => mark(`${vendor}: ${title.slice(SAMPLE.length + 1)}`).slice(0, 200);

/** Names of an earlier version ("X (sample)"), renamed in place (E18-65). */
export const VENDOR_RENAMES: SampleRename[] = [
  { type: 'vendor_issue', column: 'title', names: ISSUES.map((i) => i.title) },
  { type: 'cap', column: 'title', names: ISSUES.filter((i) => i.cap).map((i) => [`${i.vendor}: ${oldSampleName(i.title)}`, capTitle(i.vendor, i.title)] as [string, string]) },
  { type: 'contract', column: 'title', names: [CONTRACT] },
];

export async function seedLifecycle(ctx: ModuleContext): Promise<string[]> {
  const { db } = ctx;
  const today = localDate();
  const parts: string[] = [];
  await renameSamples(ctx, VENDOR_RENAMES);
  const owner = (await db.one<Row>(`select id from users where status = 'active' and deleted_at is null order by created_at limit 1`))?.id ?? null;
  const vendorByName = async (name: string) => db.one<Row>('select * from vendors where lower(name) = lower($1) and deleted_at is null order by created_at limit 1', [name]);

  // Owners, so reminders and the calendar have someone to reach.
  if (owner) await db.query('update vendors set owner_id = $1 where owner_id is null and deleted_at is null', [owner]);

  // Completed assessments: three reassessments come out overdue.
  const set = await db.one<Row>('select id from vendor_question_sets where active order by version desc limit 1');
  let assessed = 0;
  for (const [name, ago] of ASSESSED) {
    const v = await vendorByName(name);
    if (!v || ago === null || !set) continue;
    if (!(await db.one(`select 1 from vendor_assessments where vendor_id = $1 and status = 'completed' and deleted_at is null`, [v.id]))) {
      await db.query(
        `insert into vendor_assessments (vendor_id, question_set_id, status, assessed_on, answers, score, notes, completed_at, completed_by)
         values ($1,$2,'completed',$3,'{}'::jsonb,$4,$5,now(),$6)`,
        [v.id, set.id, addDays(today, -ago), 60 + (assessed * 7) % 35, mark('Vendor assessment'), owner]);
      assessed += 1;
    }
    await recomputeVendor(ctx, v.id);
  }
  for (const v of await db.query<Row>('select id from vendors where deleted_at is null')) await recomputeVendor(ctx, v.id);
  if (assessed) parts.push(`${assessed} completed assessments`);

  // Exclusion-list checks against the neutral example list.
  let checks = 0;
  for (const [name, list] of CHECKS) {
    const v = await vendorByName(name);
    if (!v) continue;
    for (const [ago, result, reference, note] of list) {
      if (await db.one('select 1 from vendor_exclusion_checks where vendor_id = $1 and reference = $2', [v.id, reference])) continue;
      await db.query(
        `insert into vendor_exclusion_checks (vendor_id, checked_on, list_key, result, reference, checked_by, note)
         values ($1,$2,'government_exclusion_list',$3,$4,$5,$6)`, [v.id, addDays(today, -ago), result, reference, owner, note]);
      checks += 1;
    }
    const last = (await db.one<Row>('select max(checked_on)::text as d from vendor_exclusion_checks where vendor_id = $1 and deleted_at is null', [v.id]))!.d;
    if (last && last !== v.last_exclusion_check_on) await ctx.resources.update('vendor', v.id, { last_exclusion_check_on: last });
  }
  if (checks) parts.push(`${checks} exclusion-list checks`);

  // Vendor issues.
  let issues = 0;
  for (const i of ISSUES) {
    const v = await vendorByName(i.vendor);
    if (!v || await db.one('select 1 from vendor_issues where title = $1', [i.title])) continue;
    const row = await ctx.resources.create('vendor_issue', {
      vendor_id: v.id, title: i.title, category: i.category, severity: i.severity, status: i.status, owner_id: owner,
      raised_on: addDays(today, -i.raised), description: i.description, resolution: i.resolution ?? null,
      resolved_on: i.resolution ? addDays(today, -Math.max(1, i.raised - 20)) : null,
    });
    issues += 1;
    const capDef = ctx.resources.get('cap');
    if (i.cap && capDef) {
      const data: Row = {
        title: capTitle(v.name, i.title), source: 'vendor', source_type: 'vendor_issue', source_id: row.id,
        problem_statement: i.description, responsible_id: owner, due_on: addDays(today, 30),
      };
      for (const k of Object.keys(data)) if (!(k in capDef.fields) || data[k] === null) delete data[k];
      try { await ctx.resources.create('cap', data); } catch { /* the plan is optional in the samples */ }
    }
  }
  if (issues) parts.push(`${issues} vendor issues`);

  // An ended contract and its offboarding, in progress.
  const vendor = await vendorByName('Redbrick Managed IT');
  if (vendor && ctx.resources.get('vendor_offboarding')) {
    let contract = await db.one<Row>(`select * from contracts where vendor_id = $1 and import_key = 'dev-sample-ended' and deleted_at is null`, [vendor.id]);
    if (!contract) {
      contract = await ctx.resources.create('contract', {
        vendor_id: vendor.id, import_key: 'dev-sample-ended', title: CONTRACT, document_type: 'agreement',
        status: 'terminated', renewal_mechanism: 'fixed', start_date: addDays(today, -1110), end_date: addDays(today, -15), notice_days: 60,
        owner_id: owner, notes: mark('Ended when backups moved to the managed services agreement.'),
      });
      // Things the vendor supplied under it, so the checklist has system, remote-access and asset items.
      const sys = ctx.resources.get('system');
      if (sys?.fields.vendor_id) {
        // The system this vendor ran under the contract (its backups), never an unrelated one (E18-82).
        const s = await db.one<Row>(
          `select id from ${sys.table} where deleted_at is null and (vendor_id is null or vendor_id = $1)
             and (lower(coalesce(vendor_name, '')) = lower($2) or name ilike '%backup%')
           order by (lower(coalesce(vendor_name, '')) = lower($2) and name ilike '%backup%') desc, created_at limit 1`, [vendor.id, vendor.name]);
        if (s) await ctx.resources.update('system', s.id, { vendor_id: vendor.id, vendor_name: vendor.name, ...(sys.fields.contract_id ? { contract_id: contract.id } : {}) });
      }
      const asset = ctx.resources.get('asset');
      if (asset?.fields.vendor_id) {
        const a = await db.one<Row>(`select id from ${asset.table} where deleted_at is null and vendor_id is null${asset.fields.status ? ` and coalesce(status, '') <> 'disposed'` : ''} order by created_at limit 1`);
        if (a) await ctx.resources.update('asset', a.id, { vendor_id: vendor.id, ...(asset.fields.contract_id ? { contract_id: contract.id } : {}) });
      }
    }
    if (!(await db.one('select 1 from vendor_offboardings where contract_id = $1 and deleted_at is null', [contract.id]))) {
      await db.query('update contracts set offboarding_started_on = $2 where id = $1 and offboarding_started_on is null', [contract.id, addDays(today, -15)]);
      const ob = await ctx.resources.create('vendor_offboarding', {
        vendor_id: vendor.id, contract_id: contract.id, trigger: 'terminated', status: 'open', owner_id: owner,
        due_on: addDays(today, 15), notes: mark('Offboarding'),
      });
      const items = await db.query<Row>('select id, kind from vendor_offboarding_items where offboarding_id = $1 order by sort', [ob.id]);
      const account = items.find((i) => i.kind === 'account_access');
      const template = items.filter((i) => i.kind === 'other');
      for (const [i, item] of [account, template[template.length - 1]].filter(Boolean).entries()) {
        await db.query(`update vendor_offboarding_items set status = 'done', done_by = $2, done_on = $3, evidence_note = $4 where id = $1`,
          [item!.id, owner, addDays(today, -10 + i), i === 0 ? mark('Vendor accounts disabled in the directory.') : mark('Final invoice paid.')]);
      }
      await ctx.resources.update('vendor_offboarding', ob.id, { status: 'in_progress' });
      parts.push(`offboarding ${ob.ref} with ${items.length} items`);
    }
  }
  return parts;
}
