// Vendor risk lifecycle (E35-01, E35-02): reassessment on a cadence set by the vendor's criticality,
// checks against exclusion lists the organization names, the lifecycle figures (C5 summary, C6
// metrics), the reassessment calendar source (C3) and the daily `vendors.lifecycle` work.
// No exclusion list is built in: the list is the organization's own (lookup `exclusion_list`), and a
// check is recorded as performed against it, with its result and reference.
import type { FastifyRequest } from 'fastify';
import { defineCalendarSource, whoFor } from '../../core/calendar.ts';
import { UUID_RE } from '../../core/errors.ts';
import { defineMetric } from '../../core/metrics.ts';
import type { LookupValue, ModuleContext, Row } from '../../core/module.ts';
import { notePermission } from '../../core/permission-use.ts';
import { addDays, daysBetween, localDate } from './dates.ts';
import { vendorsWithChecksOutstanding } from './intake.ts';
import { addMonths } from '../../../../shared/dates.ts';
export { addMonths }; // one copy for every module (E40-12)

export const REASSESS_REMINDER_SETTING = 'vendors.reassessment_reminder_days';
export const EXCLUSION_MONTHS_SETTING = 'vendors.exclusion_check_months';
export const EXCLUSION_BEFORE_CONTRACT_SETTING = 'vendors.exclusion_check_before_contract';
export const DEFAULT_REASSESS_REMINDER_DAYS = 30;
export const DEFAULT_EXCLUSION_MONTHS = 12;

/** Months between assessments by criticality (lookup meta `reassess_months`; editable; none = never due). */
export const DEFAULT_REASSESS_MONTHS: Record<string, number> = { critical: 12, high: 12, medium: 24, low: 36 };
const CADENCE_SEEDED = 'vendors.reassess_months_seeded';

export const EXCLUSION_RESULTS: LookupValue[] = [
  { value: 'clear', label: 'Clear', color: 'green', sort: 10 },
  { value: 'possible_match', label: 'Possible match', color: 'amber', sort: 20 },
  { value: 'match', label: 'Match', color: 'red', sort: 30 },
];

/** The lists of the lifecycle. Called from the module's `seedDefaults` (idempotent). */
export async function ensureLifecycleLists(ctx: ModuleContext): Promise<void> {
  const own = { module: 'vendors' };
  // One neutral example: the organization renames it to the list it checks, and adds others.
  await ctx.lookups.ensure('exclusion_list', [
    { value: 'government_exclusion_list', label: 'Government exclusion list (rename to yours)', sort: 10 },
  ], own);
  await ctx.lookups.ensure('exclusion_result', EXCLUSION_RESULTS, own);
  // The cadence goes onto the criticality values once, so a value an administrator later clears stays cleared.
  if (!(await ctx.settings.get<boolean>(CADENCE_SEEDED, false))) {
    for (const [value, months] of Object.entries(DEFAULT_REASSESS_MONTHS)) {
      await ctx.db.query(
        `update lookups set meta = meta || jsonb_build_object('reassess_months', $2::int)
         where list_key = 'vendor_criticality' and value = $1 and not (meta ? 'reassess_months')`, [value, months]);
    }
    await ctx.settings.set(CADENCE_SEEDED, true);
  }
}

/** Months between assessments for each criticality value (null = never due). */
export async function cadence(ctx: ModuleContext): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  for (const v of await ctx.lookups.values('vendor_criticality')) {
    const n = Number((v.meta as Row | undefined)?.reassess_months);
    out.set(v.value, Number.isInteger(n) && n > 0 ? n : null);
  }
  return out;
}

/**
 * The next assessment date: the last completed assessment plus the criticality's months. A vendor
 * never assessed is due from the day it was added. No criticality, or one with no months: never due.
 */
export function nextDue(months: number | null | undefined, lastAssessed: string | null, addedOn: string | null): string | null {
  if (!months) return null;
  if (lastAssessed) return addMonths(lastAssessed, months);
  return addedOn ?? localDate();
}

/** Works out a vendor's assessment dates again (after an assessment completes, or the cadence changes). */
export async function recomputeVendor(ctx: ModuleContext, vendorId: string): Promise<void> {
  const v = await ctx.db.one<Row>(
    `select v.id, v.criticality, v.last_assessed_on::text as last_assessed_on, v.next_assessment_due::text as next_assessment_due,
            v.created_at::date::text as added_on,
            (select max(a.assessed_on)::text from vendor_assessments a where a.vendor_id = v.id and a.deleted_at is null and a.status = 'completed') as last
     from vendors v where v.id = $1 and v.deleted_at is null`, [vendorId]);
  if (!v) return;
  const months = (await cadence(ctx)).get(v.criticality) ?? null;
  const next = nextDue(months, v.last, v.added_on);
  if ((v.last ?? null) === (v.last_assessed_on ?? null) && (next ?? null) === (v.next_assessment_due ?? null)) return;
  // System work: these fields are read-only to people. The change is audited on the vendor.
  await ctx.resources.update('vendor', v.id, { last_assessed_on: v.last ?? null, next_assessment_due: next });
}

/** Every vendor, after the months of a criticality change (and nightly, so nothing drifts). */
export async function recomputeAll(ctx: ModuleContext): Promise<number> {
  const rows = await ctx.db.query<Row>('select id from vendors where deleted_at is null');
  for (const r of rows) await recomputeVendor(ctx, r.id);
  return rows.length;
}

export async function exclusionMonths(ctx: ModuleContext): Promise<number> {
  const n = Number(await ctx.settings.get<number>(EXCLUSION_MONTHS_SETTING, DEFAULT_EXCLUSION_MONTHS));
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_EXCLUSION_MONTHS;
}

/** When the next exclusion check is due: the last check plus the months; never checked = due from the day the vendor was added. */
export const exclusionDue = (lastChecked: string | null, addedOn: string, months: number) =>
  lastChecked ? addMonths(lastChecked, months) : addedOn;

async function notify(ctx: ModuleContext, input: Row): Promise<number> {
  if (!ctx.app.hasDecorator('notify')) return 0;
  return (await (ctx.app as unknown as { notify: (i: Row) => Promise<{ sent: number }> }).notify(input)).sent;
}

/**
 * Whether a contract of this vendor may become active while `vendors.exclusion_check_before_contract`
 * is on: an exclusion check within the months, and its latest result is not a match. Null when it may.
 */
export async function activationBlock(ctx: ModuleContext, vendorId: string): Promise<string | null> {
  if ((await ctx.settings.get<boolean>(EXCLUSION_BEFORE_CONTRACT_SETTING, false)) !== true) return null;
  const latest = await ctx.db.one<Row>(
    `select checked_on::text as checked_on, result from vendor_exclusion_checks where vendor_id = $1 and deleted_at is null
     order by checked_on desc, created_at desc limit 1`, [vendorId]);
  if (!latest) return 'Record an exclusion-list check of this vendor before the contract becomes active.';
  if (latest.result === 'match') return 'The latest exclusion-list check of this vendor found a match, so the contract cannot become active.';
  const months = await exclusionMonths(ctx);
  if (addMonths(latest.checked_on, months) < localDate()) {
    return `The latest exclusion-list check of this vendor is more than ${months} months old. Record a new check before the contract becomes active.`;
  }
  return null;
}

/** Reminders for reassessments and exclusion checks coming due. Each is claimed in one statement before it is sent. */
export async function runLifecycleReminders(ctx: ModuleContext, now: Date = new Date()): Promise<{ reassessments: number; exclusions: number }> {
  const today = localDate(now);
  const lead = Number(await ctx.settings.get<number>(REASSESS_REMINDER_SETTING, DEFAULT_REASSESS_REMINDER_DAYS)) || DEFAULT_REASSESS_REMINDER_DAYS;
  const horizon = addDays(today, lead);
  let reassessments = 0;
  const due = await ctx.db.query<Row>(
    `select id, ref, name, owner_id, next_assessment_due::text as due from vendors
     where deleted_at is null and coalesce(status, '') <> 'former' and next_assessment_due is not null and next_assessment_due <= $1::date
       and assessment_reminded_for is distinct from next_assessment_due`, [horizon]);
  for (const v of due) {
    const claimed = await ctx.db.one(
      `update vendors set assessment_reminded_for = next_assessment_due
       where id = $1 and next_assessment_due = $2::date and assessment_reminded_for is distinct from next_assessment_due returning id`, [v.id, v.due]);
    if (!claimed) continue;
    const left = daysBetween(today, v.due);
    await notify(ctx, {
      userIds: [v.owner_id], permission: v.owner_id ? undefined : 'vendors.edit', kind: 'reminder', recordType: 'vendor', recordId: v.id,
      title: `${v.name}: reassessment ${left < 0 ? 'overdue' : left === 0 ? 'due today' : `due in ${left} day${left === 1 ? '' : 's'}`}`,
      body: `The vendor's next security assessment is due on ${v.due}.`, route: `/vendors/${v.id}?tab=lifecycle`,
    });
    reassessments += 1;
  }

  const months = await exclusionMonths(ctx);
  let exclusions = 0;
  const vendors = await ctx.db.query<Row>(
    `select id, name, owner_id, last_exclusion_check_on::text as last, created_at::date::text as added_on, exclusion_reminded_for::text as reminded
     from vendors where deleted_at is null and coalesce(status, '') = 'active'`);
  for (const v of vendors) {
    const dueOn = exclusionDue(v.last, v.added_on, months);
    if (dueOn > horizon || v.reminded === dueOn) continue;
    const claimed = await ctx.db.one(
      `update vendors set exclusion_reminded_for = $2::date where id = $1 and exclusion_reminded_for is distinct from $2::date returning id`, [v.id, dueOn]);
    if (!claimed) continue;
    await notify(ctx, {
      userIds: [v.owner_id], permission: v.owner_id ? undefined : 'vendors.edit', kind: 'reminder', recordType: 'vendor', recordId: v.id,
      title: `${v.name}: exclusion-list check ${dueOn < today ? 'overdue' : `due ${dueOn}`}`,
      body: v.last ? `The last check was on ${v.last}; checks are due every ${months} months.` : 'No exclusion-list check is recorded for this vendor.',
      route: `/vendors/${v.id}?tab=lifecycle`,
    });
    exclusions += 1;
  }
  return { reassessments, exclusions };
}

/** Lifecycle figures. A figure counts every record: vendors are never restricted. */
export async function lifecycleFigures(ctx: ModuleContext, at: string = localDate()): Promise<Row> {
  const months = await exclusionMonths(ctx);
  const vendors = await ctx.db.query<Row>(
    `select next_assessment_due::text as next, last_exclusion_check_on::text as last, created_at::date::text as added_on, status
     from vendors where deleted_at is null`);
  const issues = ctx.resources.get('vendor_issue')
    ? Number((await ctx.db.one<Row>(`select count(*)::int as n from vendor_issues where deleted_at is null and coalesce(status, '') in ('open', 'in_progress')`))?.n ?? 0)
    : 0;
  const offboardings = ctx.resources.get('vendor_offboarding')
    ? Number((await ctx.db.one<Row>(`select count(*)::int as n from vendor_offboardings where deleted_at is null and coalesce(status, '') in ('open', 'in_progress')`))?.n ?? 0)
    : 0;
  return {
    reassessments_overdue: vendors.filter((v) => v.status !== 'former' && v.next && v.next < at).length,
    exclusion_checks_overdue: vendors.filter((v) => v.status === 'active' && exclusionDue(v.last, v.added_on, months) < at).length,
    open_issues: issues,
    offboardings_open: offboardings,
    checks_outstanding: await vendorsWithChecksOutstanding(ctx), // E41-10
  };
}

export function registerLifecycle(ctx: ModuleContext): void {
  const { app, db } = ctx;
  notePermission('vendors.administer');

  async function needVendor(req: FastifyRequest): Promise<Row> {
    const id = String((req.params as Row).id ?? '');
    if (!UUID_RE.test(id)) ctx.fail(404, 'not_found', 'Vendor not found.');
    return (await ctx.resources.find('vendor', id, req.user)) ?? ctx.fail(404, 'not_found', 'Vendor not found.');
  }

  // ---------- exclusion-list checks ----------

  const checkView = (r: Row, lists: LookupValue[]) => ({
    id: r.id, vendor_id: r.vendor_id, checked_on: r.checked_on, list_key: r.list_key,
    list_label: lists.find((l) => l.value === r.list_key)?.label ?? r.list_key,
    result: r.result, result_label: EXCLUSION_RESULTS.find((x) => x.value === r.result)?.label ?? r.result,
    reference: r.reference, note: r.note, checked_by: r.checked_by, checked_by_name: r.checked_by_name ?? null,
    attachment_id: r.attachment_id, attachment_name: r.attachment_name ?? null, created_at: r.created_at,
  });

  app.get('/api/vendors/:id/exclusion-checks', { preHandler: ctx.requirePerm('vendors.view') }, async (req) => {
    const vendor = await needVendor(req);
    const lists = await ctx.lookups.values('exclusion_list');
    // The file holding the result, when the attachments module is installed.
    const files = Boolean((await db.one<Row>("select to_regclass('attachments')::text as t"))?.t);
    const rows = await db.query<Row>(
      `select x.*, x.checked_on::text as checked_on, u.display_name as checked_by_name, ${files ? 'f.file_name' : 'null'} as attachment_name
       from vendor_exclusion_checks x
       left join users u on u.id = x.checked_by
       ${files ? 'left join attachments f on f.id = x.attachment_id and f.deleted_at is null' : ''}
       where x.vendor_id = $1 and x.deleted_at is null order by x.checked_on desc, x.created_at desc`, [vendor.id]);
    const months = await exclusionMonths(ctx);
    const added = (await db.one<Row>('select created_at::date::text as d from vendors where id = $1', [vendor.id]))!.d;
    const dueOn = exclusionDue(vendor.last_exclusion_check_on ?? null, added, months);
    return {
      rows: rows.map((r) => checkView(r, lists)),
      months, due_on: dueOn, overdue: dueOn < localDate(), latest_result: rows[0]?.result ?? null,
      before_contract: (await ctx.settings.get<boolean>(EXCLUSION_BEFORE_CONTRACT_SETTING, false)) === true,
      can_record: ctx.can(req.user, 'vendors.edit'),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/vendors/:id/exclusion-checks', tag: 'Vendors', permission: 'vendors.view',
    summary: 'The exclusion-list checks recorded for a vendor, newest first, with when the next one is due',
    response: '{ rows: [{ id, checked_on, list_key, list_label, result, result_label, reference, note, checked_by_name, attachment_id, attachment_name }], months, due_on, overdue, latest_result, before_contract, can_record }',
  });

  app.post('/api/vendors/:id/exclusion-checks', { preHandler: ctx.requirePerm('vendors.edit') }, async (req, reply) => {
    const vendor = await needVendor(req);
    const b = (req.body ?? {}) as Row;
    const today = localDate();
    const fields: Record<string, string> = {};
    const checkedOn = b.checked_on ? String(b.checked_on) : today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(checkedOn) || Number.isNaN(Date.parse(checkedOn))) fields.checked_on = 'Enter the date of the check.';
    else if (checkedOn > today) fields.checked_on = 'The check cannot be dated in the future.';
    const lists = await ctx.lookups.values('exclusion_list');
    if (!lists.some((l) => l.value === b.list_key)) fields.list_key = 'Choose the list that was checked.';
    if (!EXCLUSION_RESULTS.some((r) => r.value === b.result)) fields.result = 'Choose the result: clear, possible match or match.';
    const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
    const reference = text(b.reference, 200);
    const note = text(b.note, 2000);
    if (b.result !== 'clear' && b.result && !note) fields.note = 'Say what was found and what happens next.';
    let attachmentId: string | null = null;
    if (b.attachment_id) {
      const id = String(b.attachment_id);
      const file = UUID_RE.test(id)
        && (await db.one<Row>("select to_regclass('attachments')::text as t"))?.t
          ? await db.one('select id from attachments where id = $1 and record_type = $2 and record_id = $3 and deleted_at is null', [id, 'vendor', vendor.id])
        : undefined;
      if (!file) fields.attachment_id = 'Choose a file attached to this vendor.';
      else attachmentId = id;
    }
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    const row = (await db.one<Row>(
      `insert into vendor_exclusion_checks (vendor_id, checked_on, list_key, result, reference, checked_by, note, attachment_id, created_by, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$6,$6) returning *, checked_on::text as checked_on`,
      [vendor.id, checkedOn, b.list_key, b.result, reference, req.user!.id, note, attachmentId],
    ))!;
    const last = (await db.one<Row>(
      'select max(checked_on)::text as d from vendor_exclusion_checks where vendor_id = $1 and deleted_at is null', [vendor.id]))!.d;
    if (last !== (vendor.last_exclusion_check_on ?? null)) await ctx.resources.update('vendor', vendor.id, { last_exclusion_check_on: last });
    const listLabel = lists.find((l) => l.value === b.list_key)!.label;
    const resultLabel = EXCLUSION_RESULTS.find((r) => r.value === b.result)!.label;
    await ctx.audit(req, {
      action: 'vendor.exclusion_check', recordType: 'vendor', recordId: vendor.id,
      summary: `Exclusion-list check of ${vendor.name} recorded: ${resultLabel.toLowerCase()} on "${listLabel}" (${checkedOn})`,
      after: { check_id: row.id, checked_on: checkedOn, list_key: b.list_key, result: b.result, reference },
    });
    if (b.result === 'match' || b.result === 'possible_match') {
      await notify(ctx, {
        userIds: [vendor.owner_id], permission: vendor.owner_id ? undefined : 'vendors.edit', kind: 'general', recordType: 'vendor', recordId: vendor.id,
        title: `${vendor.name}: exclusion-list check found a ${b.result === 'match' ? 'match' : 'possible match'}`,
        body: `Checked against "${listLabel}" on ${checkedOn}. ${note ?? ''}`.trim(), route: `/vendors/${vendor.id}?tab=lifecycle`,
      });
    }
    reply.code(201);
    return checkView({ ...row, checked_by_name: req.user!.displayName }, lists);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/vendors/:id/exclusion-checks', tag: 'Vendors', permission: 'vendors.edit',
    summary: 'Record a check of a vendor against an exclusion list the organization names',
    description: 'A possible match or a match needs a note and notifies the vendor\'s owner (or, with no owner, everyone who may edit vendors). While the setting vendors.exclusion_check_before_contract is on, a match, or no check within vendors.exclusion_check_months, stops the vendor\'s contracts from becoming active.',
    body: '{ checked_on?: date (default today), list_key: string, result: "clear" | "possible_match" | "match", reference?: string, note?: string, attachment_id?: uuid (a file on the vendor) }',
    response: 'the check',
  });

  // ---------- reassessments due ----------

  app.get('/api/vendors/reassessments', { preHandler: ctx.requirePerm('vendors.view') }, async (req) => {
    const raw = String((req.query as Row).due_within ?? '');
    const within = raw === 'all' ? null : Number.isFinite(Number(raw)) && raw !== '' ? Math.min(3650, Math.max(0, Math.trunc(Number(raw)))) : 30;
    const today = localDate();
    const horizon = within === null ? '9999-12-31' : addDays(today, within);
    const months = await exclusionMonths(ctx);
    const crit = await ctx.lookups.values('vendor_criticality');
    const cad = await cadence(ctx);
    const rows = await db.query<Row>(
      `select v.id, v.ref, v.name, v.criticality, v.status, v.owner_id, u.display_name as owner_name,
              v.last_assessed_on::text as last_assessed_on, v.next_assessment_due::text as next_assessment_due,
              v.last_exclusion_check_on::text as last_exclusion_check_on, v.created_at::date::text as added_on
       from vendors v left join users u on u.id = v.owner_id
       where v.deleted_at is null and coalesce(v.status, '') <> 'former' and ${ctx.resources.visibleWhere('vendor', req.user, 'v')}
       order by v.next_assessment_due nulls last, v.name`);
    const out = rows.map((v) => {
      const exclusionDueOn = v.status === 'active' ? exclusionDue(v.last_exclusion_check_on, v.added_on, months) : null;
      const c = crit.find((x) => x.value === v.criticality);
      return {
        id: v.id, ref: v.ref, name: v.name, criticality: v.criticality, criticality_label: c?.label ?? null, criticality_color: c?.color ?? 'gray',
        cadence_months: cad.get(v.criticality) ?? null, owner_id: v.owner_id, owner_name: v.owner_name,
        last_assessed_on: v.last_assessed_on, next_assessment_due: v.next_assessment_due,
        days_left: v.next_assessment_due ? daysBetween(today, v.next_assessment_due) : null,
        assessment_overdue: Boolean(v.next_assessment_due && v.next_assessment_due < today),
        last_exclusion_check_on: v.last_exclusion_check_on, exclusion_due_on: exclusionDueOn,
        exclusion_overdue: Boolean(exclusionDueOn && exclusionDueOn < today),
      };
    }).filter((v) => (v.next_assessment_due && v.next_assessment_due <= horizon) || (v.exclusion_due_on && v.exclusion_due_on <= horizon));
    return { today, due_within: within, exclusion_months: months, rows: out };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/vendors/reassessments', tag: 'Vendors', permission: 'vendors.view',
    summary: 'Vendors whose reassessment or exclusion-list check is due within a number of days (overdue ones included)',
    query: { due_within: 'days ahead (default 30, at most 3650), or "all"' },
    response: '{ today, due_within, exclusion_months, rows: [{ id, ref, name, criticality, criticality_label, cadence_months, owner_name, last_assessed_on, next_assessment_due, days_left, assessment_overdue, last_exclusion_check_on, exclusion_due_on, exclusion_overdue }] }',
  });

  // ---------- settings ----------

  async function settingsView(req: FastifyRequest) {
    const crit = await ctx.lookups.values('vendor_criticality');
    const cad = await cadence(ctx);
    return {
      cadence: crit.map((c) => ({ value: c.value, label: c.label, months: cad.get(c.value) ?? null })),
      reminder_days: Number(await ctx.settings.get<number>(REASSESS_REMINDER_SETTING, DEFAULT_REASSESS_REMINDER_DAYS)),
      exclusion_months: await exclusionMonths(ctx),
      exclusion_before_contract: (await ctx.settings.get<boolean>(EXCLUSION_BEFORE_CONTRACT_SETTING, false)) === true,
      can_edit: ctx.can(req.user, 'vendors.administer'),
    };
  }

  app.get('/api/vendors/lifecycle-settings', { preHandler: ctx.requirePerm('vendors.view') }, async (req) => settingsView(req));
  ctx.describeRoute({
    method: 'GET', path: '/api/vendors/lifecycle-settings', tag: 'Vendors', permission: 'vendors.view',
    summary: 'Reassessment months by criticality, the reminder lead time, how often exclusion-list checks are due and whether one is needed before a contract becomes active',
    response: '{ cadence: [{ value, label, months }], reminder_days, exclusion_months, exclusion_before_contract, can_edit }',
  });

  app.put('/api/vendors/lifecycle-settings', { preHandler: ctx.requirePerm('vendors.administer') }, async (req) => {
    const b = (req.body ?? {}) as Row;
    const fields: Record<string, string> = {};
    const whole = (v: unknown, min: number, max: number) => {
      const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
      return Number.isInteger(n) && n >= min && n <= max ? n : null;
    };
    const crit = await ctx.lookups.values('vendor_criticality');
    const cadenceIn: { value: string; months: number | null }[] = [];
    if (b.cadence !== undefined) {
      if (!Array.isArray(b.cadence)) fields.cadence = 'Give the months for each criticality.';
      else {
        for (const c of b.cadence as Row[]) {
          if (!crit.some((x) => x.value === c?.value)) { fields.cadence = `Unknown criticality "${String(c?.value)}".`; break; }
          const months = c.months === null || c.months === '' ? null : whole(c.months, 1, 120);
          if (c.months !== null && c.months !== '' && months === null) { fields.cadence = 'Months must be a whole number from 1 to 120, or empty for never.'; break; }
          cadenceIn.push({ value: c.value, months });
        }
      }
    }
    const reminder = b.reminder_days === undefined ? undefined : whole(b.reminder_days, 0, 365);
    if (reminder === null) fields.reminder_days = 'Enter a whole number of days from 0 to 365.';
    const months = b.exclusion_months === undefined ? undefined : whole(b.exclusion_months, 1, 120);
    if (months === null) fields.exclusion_months = 'Enter a whole number of months from 1 to 120.';
    if (b.exclusion_before_contract !== undefined && typeof b.exclusion_before_contract !== 'boolean') fields.exclusion_before_contract = 'Send true or false.';
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

    const current = await cadence(ctx);
    let cadenceChanged = false;
    for (const c of cadenceIn) {
      if ((current.get(c.value) ?? null) === c.months) continue;
      cadenceChanged = true;
      await db.query(
        c.months === null
          ? `update lookups set meta = meta - 'reassess_months' where list_key = 'vendor_criticality' and value = $1`
          : `update lookups set meta = meta || jsonb_build_object('reassess_months', $2::int) where list_key = 'vendor_criticality' and value = $1`,
        c.months === null ? [c.value] : [c.value, c.months]);
      await ctx.audit(req, {
        action: 'vendor.reassessment_cadence', recordType: 'setting', recordId: `vendor_criticality.${c.value}.reassess_months`,
        summary: `Vendors of criticality "${crit.find((x) => x.value === c.value)!.label}" reassessed ${c.months ? `every ${c.months} months` : 'never (no cadence)'}`,
        before: { criticality: c.value, months: current.get(c.value) ?? null }, after: { criticality: c.value, months: c.months },
      });
    }
    // settings.set writes the audit event.
    if (reminder !== undefined && reminder !== Number(await ctx.settings.get<number>(REASSESS_REMINDER_SETTING, DEFAULT_REASSESS_REMINDER_DAYS))) {
      await ctx.settings.set(REASSESS_REMINDER_SETTING, reminder, req);
    }
    if (months !== undefined && months !== await exclusionMonths(ctx)) await ctx.settings.set(EXCLUSION_MONTHS_SETTING, months, req);
    if (typeof b.exclusion_before_contract === 'boolean'
      && b.exclusion_before_contract !== ((await ctx.settings.get<boolean>(EXCLUSION_BEFORE_CONTRACT_SETTING, false)) === true)) {
      await ctx.settings.set(EXCLUSION_BEFORE_CONTRACT_SETTING, b.exclusion_before_contract, req);
    }
    if (cadenceChanged) await recomputeAll(ctx);
    return settingsView(req);
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/vendors/lifecycle-settings', tag: 'Vendors', permission: 'vendors.administer',
    summary: 'Change the reassessment months by criticality (empty = never due), the reminder lead time and the exclusion-list check settings; changed months recompute every vendor\'s next assessment date',
    body: '{ cadence?: [{ value, months: number | null }], reminder_days?: number, exclusion_months?: number, exclusion_before_contract?: boolean }',
    response: 'as GET',
  });

  // ---------- figures (C5 summary, C6 metrics) ----------

  app.get('/api/vendors/lifecycle-summary', { preHandler: ctx.requirePerm('vendors.view') }, async () => lifecycleFigures(ctx));
  ctx.describeRoute({
    method: 'GET', path: '/api/vendors/lifecycle-summary', tag: 'Vendors', permission: 'vendors.view',
    summary: 'Vendor lifecycle figures: reassessments and exclusion-list checks overdue, open vendor issues, open offboardings and vendors whose risk tier still needs checks (counts only)',
    response: '{ reassessments_overdue, exclusion_checks_overdue, open_issues, offboardings_open, checks_outstanding }',
  });

  const monthEnd = (monthStart: string) => addDays(addMonths(monthStart, 1), -1);
  defineMetric(app, {
    key: 'vendors.reassessments_overdue', label: 'Vendor reassessments overdue', unit: 'count', recordType: 'vendor',
    description: 'Vendors (other than former ones) whose next security assessment date had passed at the end of the month (today for the month still running), by the reassessment months of their criticality.',
    async compute(c, monthStart) {
      const today = localDate();
      if (monthStart > today) return null;
      const end = monthEnd(monthStart);
      const at = end < today ? end : today;
      const r = await c.db.one<Row>(
        `select count(*)::int as n from vendors where deleted_at is null and coalesce(status, '') <> 'former'
           and next_assessment_due is not null and next_assessment_due < $1::date`, [at]);
      return Number(r?.n ?? 0);
    },
  });
  defineMetric(app, {
    key: 'vendors.open_issues', label: 'Open vendor issues', unit: 'count', recordType: 'vendor_issue',
    description: 'Vendor issues raised by the end of the month (today for the month still running) and not resolved by then.',
    async compute(c, monthStart) {
      const today = localDate();
      if (monthStart > today) return null;
      const end = monthEnd(monthStart);
      const at = end < today ? end : today;
      const r = await c.db.one<Row>(
        `select count(*)::int as n from vendor_issues where deleted_at is null
           and coalesce(raised_on, created_at::date) <= $1::date
           and (resolved_on is null or resolved_on > $1::date) and (resolved_on is not null or coalesce(status, '') in ('open', 'in_progress'))`, [at]);
      return Number(r?.n ?? 0);
    },
  });

  // ---------- calendar (C3) ----------

  defineCalendarSource(app, {
    key: 'vendors.reassessments', label: 'Vendor reassessments due (vendors I own)', recordType: 'vendor', permission: 'vendors.view',
    work: true, anyone: true, kind: 'Vendor reassessments', // E41-03: My work and the compliance calendar
    async events(c, user, from, to, scope) {
      const rows = await c.db.query<Row>(
        `select v.id, v.name, v.next_assessment_due::text as due, v.owner_id as p from vendors v
         where v.deleted_at is null and ($1::uuid is null or v.owner_id = $1) and coalesce(v.status, '') <> 'former'
           and v.next_assessment_due between $2::date and $3::date and ${c.resources.visibleWhere('vendor', user, 'v')}`,
        [whoFor(user, scope), from, to]);
      return rows.map((r) => ({
        uid: `vendors.reassessments:${r.id}:${r.due}`, title: `Reassess vendor: ${r.name}`, start: r.due, allDay: true,
        url: `/vendors/${r.id}?tab=lifecycle`, recordType: 'vendor', recordId: r.id, personId: r.p ?? null,
      }));
    },
  });
}
