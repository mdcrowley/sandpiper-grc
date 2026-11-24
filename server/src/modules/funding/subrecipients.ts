import type { FastifyRequest } from 'fastify';
import { scheduleWork } from '../../core/jobs/index.ts';
import type { LookupValue, ModuleContext, Row, SeedOptions } from '../../core/module.ts';
import { ANONYMIZED_TEXT, onAnonymize } from '../../core/retention.ts';
import { dayInZone, todayInZone } from '../../core/timezone.ts';
import type { SampleRename } from '../inventory/seed-rename.ts';
import { activeUser, cleanText, idParam, validDate } from './shared.ts';

/**
 * Sub-recipients of funding awards and their monitoring (E35-07, E27-11). A sub-recipient is an
 * organization that receives part of an award to carry out part of its work (a partner agency, a
 * research partner); the organization monitors it on a cadence (desk reviews, site visits, report
 * reviews). Monitoring with findings may raise a corrective action plan (record type `cap`, contract
 * C1, source `funding`). Reminders go out when monitoring comes due (job `funding.subrecipients`).
 * The frequency uses the award reporting frequencies (the same keys as the obligation frequencies).
 */

export const SUBRECIPIENT_REMINDER_SETTING = 'funding.subrecipient_reminder_days';
export const DEFAULT_SUBRECIPIENT_REMINDER_DAYS = 30;
const MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };

export const MONITORING_METHODS: LookupValue[] = [
  { value: 'desk_review', label: 'Desk review', sort: 10 },
  { value: 'site_visit', label: 'Site visit', sort: 20 },
  { value: 'report_review', label: 'Report review', sort: 30 },
];
export const MONITORING_RESULTS: LookupValue[] = [
  { value: 'satisfactory', label: 'Satisfactory', color: 'green', sort: 10 },
  { value: 'findings', label: 'Findings', color: 'amber', sort: 20 },
  { value: 'unsatisfactory', label: 'Unsatisfactory', color: 'red', sort: 30 },
];

export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** The next monitoring date: the last one plus the frequency; never monitored = due now; "once" and done = never again. */
export function nextMonitoring(frequency: string | null | undefined, last: string | null, today: string): string | null {
  if (!frequency) return null;
  if (!last) return today;
  const months = MONTHS[frequency];
  return months ? addMonths(last, months) : null;
}

async function notify(ctx: ModuleContext, input: Row): Promise<number> {
  if (!ctx.app.hasDecorator('notify')) return 0;
  return (await (ctx.app as unknown as { notify: (i: Row) => Promise<{ sent: number }> }).notify(input)).sent;
}

/** Reminders for monitoring coming due, each claimed in one statement before it is sent. */
export async function runSubrecipientReminders(ctx: ModuleContext): Promise<number> {
  const lead = Number(await ctx.settings.get<number>(SUBRECIPIENT_REMINDER_SETTING, DEFAULT_SUBRECIPIENT_REMINDER_DAYS)) || DEFAULT_SUBRECIPIENT_REMINDER_DAYS;
  const today = todayInZone();
  const rows = await ctx.db.query<Row>(
    `select s.id, s.ref, s.name, s.owner_id, s.next_monitoring_due::text as due, a.manager_id
     from subrecipients s join funding_awards a on a.id = s.award_id
     where s.deleted_at is null and coalesce(s.status, '') = 'active' and s.next_monitoring_due is not null
       and s.next_monitoring_due <= $1::date and s.monitoring_reminded_for is distinct from s.next_monitoring_due`, [dayInZone(lead)]);
  let sent = 0;
  for (const r of rows) {
    const claimed = await ctx.db.one(
      `update subrecipients set monitoring_reminded_for = next_monitoring_due
       where id = $1 and next_monitoring_due = $2::date and monitoring_reminded_for is distinct from next_monitoring_due returning id`, [r.id, r.due]);
    if (!claimed) continue;
    await notify(ctx, {
      userIds: [r.owner_id ?? r.manager_id], permission: r.owner_id || r.manager_id ? undefined : 'funding.edit',
      kind: 'reminder', recordType: 'subrecipient', recordId: r.id,
      title: `${r.name}: monitoring ${r.due < today ? 'overdue' : `due ${r.due}`}`,
      body: `Sub-recipient ${r.ref} is due for monitoring on ${r.due}.`, route: `/funding/subrecipients/${r.id}?tab=monitoring`,
    });
    sent += 1;
  }
  return sent;
}

/** Registers the sub-recipient record type and routes. Called from funding/index.ts `register`. */
export async function registerSubrecipients(ctx: ModuleContext): Promise<void> {
  const { app, db } = ctx;
  const own = { module: 'funding' };
  await ctx.lookups.ensure('subrecipient_status', [
    { value: 'active', label: 'Active', color: 'green', sort: 10 },
    { value: 'suspended', label: 'Suspended', color: 'amber', sort: 20 },
    { value: 'closed', label: 'Closed', color: 'gray', sort: 30, meta: { closed: true } },
  ], own);
  await ctx.lookups.ensure('subrecipient_risk_level', [
    { value: 'high', label: 'High', color: 'red', sort: 10 },
    { value: 'medium', label: 'Medium', color: 'amber', sort: 20 },
    { value: 'low', label: 'Low', color: 'green', sort: 30 },
  ], own);
  await ctx.lookups.ensure('subrecipient_monitoring_method', MONITORING_METHODS, own);
  await ctx.lookups.ensure('subrecipient_monitoring_result', MONITORING_RESULTS, own);

  async function check(merged: Row, patch: Row, existing: Row | null) {
    const fields: Record<string, string> = {};
    if ((patch.award_id !== undefined || !existing) && !(await ctx.resources.find('funding_award', merged.award_id))) fields.award_id = 'Choose an award.';
    if (merged.vendor_id && patch.vendor_id !== undefined && ctx.resources.get('vendor') && !(await ctx.resources.find('vendor', merged.vendor_id))) {
      fields.vendor_id = 'Vendor not found.';
    }
    if (merged.amount !== null && merged.amount !== undefined && Number(merged.amount) < 0) fields.amount = 'Enter zero or more.';
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    // A new frequency brings a new due date.
    if (!existing || (patch.monitoring_frequency !== undefined && patch.monitoring_frequency !== existing.monitoring_frequency)) {
      patch.next_monitoring_due = nextMonitoring(merged.monitoring_frequency, merged.last_monitored_on ?? null, todayInZone());
    }
  }

  ctx.defineResource({
    type: 'subrecipient', table: 'subrecipients', module: 'funding', label: 'Sub-recipient', plural: 'Sub-recipients',
    path: '/api/subrecipients', route: '/funding/subrecipients', titleField: 'name', ref: { field: 'ref', prefix: 'SUB-' },
    searchable: ['name', 'notes'],
    defaultSort: { field: 'next_monitoring_due', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      name: { label: 'Name', type: 'text', required: true },
      award_id: { label: 'Award', type: 'ref', to: 'funding_award', required: true },
      vendor_id: { label: 'Vendor record', type: 'ref', to: 'vendor' },
      amount: { label: 'Amount passed through', type: 'currency' },
      risk_level: { label: 'Risk level', type: 'lookup', list: 'subrecipient_risk_level', default: 'medium' },
      monitoring_frequency: { label: 'Monitoring frequency', type: 'lookup', list: 'funding_report_frequency', default: 'yearly' },
      last_monitored_on: { label: 'Last monitored on', type: 'date', readOnly: true },
      next_monitoring_due: { label: 'Next monitoring due', type: 'date', readOnly: true },
      status: { label: 'Status', type: 'lookup', list: 'subrecipient_status', default: 'active' },
      owner_id: { label: 'Monitored by', type: 'user' },
      notes: { label: 'Notes', type: 'longtext' },
    },
    hooks: {
      beforeCreate: async (_req, data) => { await check(data, data, null); return data; },
      beforeUpdate: async (_req, existing, patch) => { await check({ ...existing, ...patch }, patch, existing); return patch; },
    },
  });

  const needSub = async (req: FastifyRequest): Promise<Row> =>
    (await ctx.resources.find('subrecipient', idParam(ctx, req), req.user)) ?? ctx.fail(404, 'not_found', 'Sub-recipient not found.');

  const view = (r: Row) => ({
    id: r.id, subrecipient_id: r.subrecipient_id, monitored_on: r.monitored_on, method: r.method,
    method_label: MONITORING_METHODS.find((m) => m.value === r.method)?.label ?? r.method,
    result: r.result, result_label: MONITORING_RESULTS.find((m) => m.value === r.result)?.label ?? r.result,
    result_color: MONITORING_RESULTS.find((m) => m.value === r.result)?.color ?? 'gray',
    findings: r.findings, cap_id: r.cap_id, cap_ref: r.cap_ref ?? null, by: r.by, by_name: r.by_name ?? null,
  });

  async function history(subId: string): Promise<Row[]> {
    const caps = ctx.resources.get('cap');
    return db.query<Row>(
      `select m.*, m.monitored_on::text as monitored_on, u.display_name as by_name${caps ? ', c.ref as cap_ref' : ''}
       from subrecipient_monitoring m left join users u on u.id = m.by
       ${caps ? `left join ${caps.table} c on c.id = m.cap_id` : ''}
       where m.subrecipient_id = $1 and m.deleted_at is null order by m.monitored_on desc, m.created_at desc`, [subId]);
  }

  app.get('/api/subrecipients/:id/monitoring', { preHandler: ctx.requirePerm('funding.view') }, async (req) => {
    const sub = await needSub(req);
    return {
      rows: (await history(sub.id)).map(view),
      next_monitoring_due: sub.next_monitoring_due, last_monitored_on: sub.last_monitored_on,
      can_record: ctx.can(req.user, 'funding.edit'),
      can_raise_cap: Boolean(ctx.resources.get('cap')) && ctx.can(req.user, 'actions.create') && ctx.can(req.user, 'funding.edit'),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/subrecipients/:id/monitoring', tag: 'Funding', permission: 'funding.view',
    summary: 'The monitoring history of a sub-recipient, newest first, with when monitoring is next due',
    response: '{ rows: [{ id, monitored_on, method, method_label, result, result_label, findings, cap_id, cap_ref, by_name }], next_monitoring_due, last_monitored_on, can_record, can_raise_cap }',
  });

  app.post('/api/subrecipients/:id/monitoring', { preHandler: ctx.requirePerm('funding.edit') }, async (req, reply) => {
    const sub = await needSub(req);
    const b = (req.body ?? {}) as Row;
    const today = todayInZone();
    const fields: Record<string, string> = {};
    const on = b.monitored_on ? String(b.monitored_on) : today;
    if (!validDate(on)) fields.monitored_on = 'Enter the date of the monitoring.';
    else if (on > today) fields.monitored_on = 'The monitoring cannot be dated in the future.';
    if (!MONITORING_METHODS.some((m) => m.value === b.method)) fields.method = 'Choose how it was monitored.';
    if (!MONITORING_RESULTS.some((m) => m.value === b.result)) fields.result = 'Choose the result.';
    const findings = cleanText(b.findings, 8000);
    if (b.result && b.result !== 'satisfactory' && !findings) fields.findings = 'Describe what was found.';
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    const by = b.by ? await activeUser(ctx, b.by, 'by') : req.user!.id;
    const row = (await db.one<Row>(
      `insert into subrecipient_monitoring (subrecipient_id, monitored_on, method, result, findings, by, created_by, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7,$7) returning *, monitored_on::text as monitored_on`,
      [sub.id, on, b.method, b.result, findings, by, req.user!.id]))!;
    const last = (await db.one<Row>('select max(monitored_on)::text as d from subrecipient_monitoring where subrecipient_id = $1 and deleted_at is null', [sub.id]))!.d;
    // System work: the dates are read-only to people.
    await ctx.resources.update('subrecipient', sub.id, { last_monitored_on: last, next_monitoring_due: nextMonitoring(sub.monitoring_frequency, last, today) });
    await ctx.audit(req, {
      action: 'subrecipient.monitoring', recordType: 'subrecipient', recordId: sub.id,
      summary: `Monitoring of ${sub.ref} recorded: ${MONITORING_METHODS.find((m) => m.value === b.method)!.label.toLowerCase()} on ${on}, ${MONITORING_RESULTS.find((m) => m.value === b.result)!.label.toLowerCase()}`,
      after: { monitoring_id: row.id, monitored_on: on, method: b.method, result: b.result },
    });
    reply.code(201);
    return view({ ...row, by_name: by === req.user!.id ? req.user!.displayName : null });
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/subrecipients/:id/monitoring', tag: 'Funding', permission: 'funding.edit',
    summary: 'Record a monitoring of a sub-recipient; findings are needed unless the result is satisfactory, and the next due date moves on by the frequency',
    body: '{ monitored_on?: date (default today), method: "desk_review" | "site_visit" | "report_review", result: "satisfactory" | "findings" | "unsatisfactory", findings?: string, by?: user id }',
    response: 'the monitoring',
  });

  app.post('/api/subrecipients/:id/monitoring/:mid/cap', { preHandler: ctx.requirePerm('funding.edit') }, async (req, reply) => {
    const sub = await needSub(req);
    const mid = idParam(ctx, req, 'mid');
    const m = await db.one<Row>('select *, monitored_on::text as monitored_on from subrecipient_monitoring where id = $1 and subrecipient_id = $2 and deleted_at is null', [mid, sub.id]);
    if (!m) ctx.fail(404, 'not_found', 'Monitoring not found.');
    const capDef = ctx.resources.get('cap');
    if (!capDef) ctx.fail(409, 'caps_unavailable', 'Corrective action plans are not part of this installation.');
    if (!ctx.can(req.user, 'actions.create')) ctx.fail(403, 'forbidden', 'Raising a corrective action plan also needs permission to create actions.');
    if (m!.result === 'satisfactory') ctx.fail(409, 'no_findings', 'This monitoring had no findings.');
    if (m!.cap_id && (await ctx.resources.find('cap', m!.cap_id))) ctx.fail(409, 'cap_exists', 'This monitoring already has a corrective action plan.');
    const b = (req.body ?? {}) as Row;
    const data: Row = {
      title: (cleanText(b.title, 200) ?? `${sub.name}: monitoring findings of ${m!.monitored_on}`).slice(0, 200),
      source: 'funding', source_type: 'subrecipient', source_id: sub.id,
      problem_statement: cleanText(b.problem_statement, 8000) ?? [m!.findings, `Found in the monitoring of sub-recipient ${sub.ref} on ${m!.monitored_on}.`].filter(Boolean).join('\n\n'),
      responsible_id: sub.owner_id ?? null,
    };
    for (const k of Object.keys(data)) if (!(k in capDef!.fields) || data[k] === null) delete data[k];
    const cap = await ctx.resources.create('cap', data, req);
    await db.query('update subrecipient_monitoring set cap_id = $2, updated_at = now(), updated_by = $3 where id = $1', [m!.id, cap.id, req.user!.id]);
    await ctx.audit(req, {
      action: 'subrecipient.cap', recordType: 'subrecipient', recordId: sub.id,
      summary: `Corrective action plan ${cap.ref ?? cap.title} raised from the monitoring of ${sub.ref} on ${m!.monitored_on}`, after: { monitoring_id: m!.id, cap_id: cap.id },
    });
    reply.code(201);
    return { cap: { id: cap.id, ref: cap.ref ?? null, title: cap.title, route: capDef!.route ? `${capDef!.route}/${cap.id}` : null } };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/subrecipients/:id/monitoring/:mid/cap', tag: 'Funding', permission: 'funding.edit',
    summary: 'Raise a corrective action plan (source Funding) from a monitoring with findings (also needs actions.create)',
    description: '409 `caps_unavailable` when corrective action plans are not loaded or switched off; 409 `no_findings` for a satisfactory monitoring; 409 `cap_exists` when one was already raised.',
    body: '{ title?, problem_statement? }', response: '{ cap: { id, ref, title, route } }',
  });

  // Anonymizing a sub-recipient at the end of its retention period clears who monitored it and the findings text.
  onAnonymize('subrecipient', async (tx, id) => tx.query(
    `update subrecipient_monitoring set by = null, findings = case when findings is null then null else $2 end where subrecipient_id = $1`, [id, ANONYMIZED_TEXT]));

  await scheduleWork(ctx, 'funding.subrecipients', async () => ({ reminded: await runSubrecipientReminders(ctx) }), { every: 24 * 60 * 60 * 1000, firstRunInMs: 95_000 });
}

const SAMPLE_SUBRECIPIENTS = ['[Sample] County paratransit partner', '[Sample] University research partner'];

/** Names of an earlier version, renamed in place (E18-65); run by seed.ts before the awards are looked up. */
export const SUBRECIPIENT_RENAMES: SampleRename[] = [
  { type: 'subrecipient', names: [
    ['Sample county paratransit partner (sample)', SAMPLE_SUBRECIPIENTS[0]],
    ['Sample university research partner (sample)', SAMPLE_SUBRECIPIENTS[1]],
  ] },
  { type: 'cap', column: 'title', names: [['Sample county paratransit partner (sample): monitoring findings', `${SAMPLE_SUBRECIPIENTS[0]}: monitoring findings`]] },
];

/** Sample sub-recipients (dev profile), invented and labeled "[Sample]". Called from seed.ts after the sample awards. */
export async function seedSubrecipients(ctx: ModuleContext, opts: SeedOptions): Promise<string | null> {
  if (opts.profile !== 'dev') return null;
  if (await ctx.db.one(`select 1 from subrecipients where name like '[Sample] %' limit 1`)) return null;
  const award = await ctx.db.one<Row>(
    `select id from funding_awards where deleted_at is null and title = '[Sample] Operating assistance' order by created_at limit 1`)
    ?? await ctx.db.one<Row>('select id from funding_awards where deleted_at is null order by created_at limit 1');
  if (!award) return null;
  const owner = (await ctx.db.one<Row>(`select id from users where status = 'active' and deleted_at is null order by created_at limit 1`))?.id ?? null;
  const samples = [
    {
      name: SAMPLE_SUBRECIPIENTS[0], amount: 420000, risk_level: 'high', monitoring_frequency: 'quarterly',
      notes: '[Sample] Runs demand-response trips in the outer service area under the award.',
      history: [
        { on: -200, method: 'desk_review', result: 'satisfactory', findings: null },
        { on: -110, method: 'site_visit', result: 'findings', findings: 'Driver training records for two new drivers were not on file at the visit. Vehicle inspection sheets were incomplete for one month.', cap: true },
      ],
    },
    {
      name: SAMPLE_SUBRECIPIENTS[1], amount: 95000, risk_level: 'low', monitoring_frequency: 'yearly',
      notes: '[Sample] Studies rider travel patterns for the service plan.',
      history: [
        { on: -300, method: 'report_review', result: 'satisfactory', findings: null },
      ],
    },
  ];
  let monitored = 0;
  let plans = 0;
  for (const s of samples) {
    const sub = await ctx.resources.create('subrecipient', {
      name: s.name, award_id: award.id, amount: s.amount, risk_level: s.risk_level, monitoring_frequency: s.monitoring_frequency,
      status: 'active', owner_id: owner, notes: s.notes,
    });
    for (const h of s.history) {
      const m = (await ctx.db.one<Row>(
        `insert into subrecipient_monitoring (subrecipient_id, monitored_on, method, result, findings, by) values ($1,$2,$3,$4,$5,$6) returning id`,
        [sub.id, dayInZone(h.on), h.method, h.result, h.findings, owner]))!;
      monitored += 1;
      const capDef = ctx.resources.get('cap');
      if ((h as Row).cap && capDef) {
        const data: Row = {
          title: `${s.name}: monitoring findings`, source: 'funding', source_type: 'subrecipient', source_id: sub.id,
          problem_statement: h.findings, responsible_id: owner,
        };
        for (const k of Object.keys(data)) if (!(k in capDef.fields) || data[k] === null) delete data[k];
        try {
          const cap = await ctx.resources.create('cap', data);
          await ctx.db.query('update subrecipient_monitoring set cap_id = $2 where id = $1', [m.id, cap.id]);
          plans += 1;
        } catch { /* corrective action plans not usable here: the history stays */ }
      }
    }
    const last = s.history.map((h) => dayInZone(h.on)).sort().pop()!;
    await ctx.resources.update('subrecipient', sub.id, { last_monitored_on: last, next_monitoring_due: nextMonitoring(s.monitoring_frequency, last, todayInZone()) });
  }
  return `sub-recipients ${samples.length} with ${monitored} monitorings${plans ? ` and ${plans} corrective action plan${plans === 1 ? '' : 's'}` : ''}`;
}
