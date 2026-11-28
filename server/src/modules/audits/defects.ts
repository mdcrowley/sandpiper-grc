// Defects (wave 26, E46): something wrong found on a vehicle, site or asset, raised by hand or by
// itself from a checklist item not met when an inspection of that record is completed. A defect is
// open, then deferred (with a reason and a date) or its repair is ordered (with the work order),
// then repaired, and finally verified by someone other than the person who repaired it. A defect
// that takes the record out of service cannot be deferred, and opening one on a vehicle marks the
// vehicle out of service. The inspection history of one record (its inspections, open defects and
// whether it is out of service) is served for the vehicle, site and asset pages.
import type { FastifyRequest } from 'fastify';
import { defineCalendarSource, whoFor } from '../../core/calendar.ts';
import { actorOf, inDataLoad, isDataLoad } from '../../core/dataload.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { resolveTarget } from './resources.ts';

/** Record types a defect may be raised on (inspections of systems record findings, not defects). */
export const DEFECT_TARGETS = ['vehicle', 'site', 'asset'] as const;
/** Statuses in which the defect is not yet put right. */
export const DEFECT_OPEN = ['open', 'deferred', 'repair_ordered'];
/** The moves a person may make; a data load may set any status. */
export const DEFECT_MOVES: Record<string, string[]> = {
  open: ['deferred', 'repair_ordered', 'repaired', 'canceled'],
  deferred: ['open', 'repair_ordered', 'repaired', 'canceled'],
  repair_ordered: ['deferred', 'repaired', 'canceled'],
  repaired: ['verified', 'open'],
  verified: [],
  canceled: ['open'],
};

const day = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? '')).slice(0, 10);
const invalid = (ctx: ModuleContext, fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
const filled = (v: unknown) => typeof v === 'string' ? v.trim() !== '' : v !== null && v !== undefined;

export async function ensureDefectLists(ctx: ModuleContext) {
  const own = { module: 'audits' };
  // meta.closed: nothing more is expected on the defect; meta.open: not yet put right.
  await ctx.lookups.ensure('defect_status', [
    { value: 'open', label: 'Open', color: 'red', sort: 10, meta: { open: true } },
    { value: 'deferred', label: 'Deferred', color: 'amber', sort: 20, meta: { open: true } },
    { value: 'repair_ordered', label: 'Repair ordered', color: 'blue', sort: 30, meta: { open: true } },
    { value: 'repaired', label: 'Repaired, to verify', color: 'teal', sort: 40 },
    { value: 'verified', label: 'Verified', color: 'green', sort: 50, meta: { closed: true } },
    { value: 'canceled', label: 'Canceled', color: 'gray', sort: 60, meta: { closed: true } },
  ], own);
  // meta.out_of_service: a new defect of this severity takes the record out of service unless told otherwise.
  await ctx.lookups.ensure('defect_severity', [
    { value: 'safety_critical', label: 'Critical: out of service', color: 'red', sort: 10, meta: { out_of_service: true } },
    { value: 'major', label: 'Major', color: 'orange', sort: 20 },
    { value: 'minor', label: 'Minor', color: 'amber', sort: 30 },
  ], own);
}

export function registerDefects(ctx: ModuleContext) {
  const { app, db } = ctx;

  async function defectRules(req: FastifyRequest | null, existing: Row | null, patch: Row): Promise<Row> {
    const merged = { ...(existing ?? {}), ...patch };
    const load = isDataLoad(req);
    const today = dayInZone();
    if ('target_type' in patch || 'target_id' in patch || !existing) {
      const type = merged.target_type ? String(merged.target_type) : null;
      if (type && !(DEFECT_TARGETS as readonly string[]).includes(type)) invalid(ctx, { target_type: 'A defect is raised on a vehicle, a site or an asset.' });
      if (!type || !merged.target_id) invalid(ctx, { target_id: 'Choose the vehicle, site or asset the defect is on.' });
      Object.assign(patch, await resolveTarget(ctx, req, merged));
    }
    if (!existing) {
      if (!filled(patch.found_on)) patch.found_on = load && merged.created_at ? day(merged.created_at) : today;
      if (patch.out_of_service === undefined || patch.out_of_service === null) {
        const sev = (await ctx.lookups.values('defect_severity')).find((s) => s.value === merged.severity);
        patch.out_of_service = sev?.meta?.out_of_service === true;
      }
      if (!filled(patch.status)) patch.status = 'open';
    }
    const from = existing ? String(existing.status ?? 'open') : 'open';
    const to = String(merged.status ?? 'open');
    const out = merged.out_of_service === true;
    if (load) {
      // A data load records what happened: no move rules, and stamps only where none is given.
      if (['repaired', 'verified'].includes(to)) {
        patch.repaired_on ??= merged.repaired_on ?? (merged.updated_at ? day(merged.updated_at) : today);
        if (!merged.repaired_by && to === 'repaired') patch.repaired_by = actorOf(req).id;
      }
      if (to === 'verified') {
        if (!merged.verified_on) patch.verified_on = merged.updated_at ? day(merged.updated_at) : today;
        if (!merged.verified_by) patch.verified_by = actorOf(req).id;
      }
      return patch;
    }
    if (!existing && to !== 'open' && req) invalid(ctx, { status: 'A new defect starts open.' });
    if (existing && to !== from && req) {
      if (!(DEFECT_MOVES[from] ?? []).includes(to)) {
        const names = new Map((await ctx.lookups.values('defect_status')).map((s) => [s.value, s.label]));
        invalid(ctx, { status: `A defect that is ${String(names.get(from) ?? from).toLowerCase()} cannot become ${String(names.get(to) ?? to).toLowerCase()}.` });
      }
    }
    if (req && to === 'deferred' && (to !== from || 'out_of_service' in patch || 'deferred_until' in patch)) {
      const errors: Record<string, string> = {};
      if (out) errors.status = 'A defect that takes the record out of service cannot be deferred. Order the repair instead.';
      if (!filled(merged.deferral_reason)) errors.deferral_reason = 'Say why the repair can wait.';
      if (!filled(merged.deferred_until)) errors.deferred_until = 'Give the date by which it must be repaired.';
      else if (String(merged.deferred_until) < today) errors.deferred_until = 'The date to repair by cannot be in the past.';
      if (Object.keys(errors).length) invalid(ctx, errors);
    }
    if (to !== from && to === 'repaired') {
      if (!filled(merged.repaired_on) || !('repaired_on' in patch)) patch.repaired_on = today;
      patch.repaired_by = actorOf(req).id;
    }
    if (to !== from && to === 'verified') {
      const by = actorOf(req).id;
      if (req && by && existing?.repaired_by && by === existing.repaired_by) {
        invalid(ctx, { status: 'Someone other than the person who repaired the defect verifies the repair.' });
      }
      patch.verified_by = by;
      patch.verified_on = today;
    }
    if (to !== from && to === 'open' && from === 'repaired') {
      // The repair did not hold: the defect is open again and the repair is cleared.
      patch.repaired_on = null;
      patch.repaired_by = null;
    }
    if (filled(merged.repaired_on) && String(merged.repaired_on) > today) invalid(ctx, { repaired_on: 'The repair date cannot be in the future.' });
    return patch;
  }

  /** An open defect that takes a vehicle out of service marks the vehicle out of service (system work, audited). */
  async function holdVehicle(row: Row) {
    if (inDataLoad() || row.target_type !== 'vehicle' || !row.target_id || row.out_of_service !== true) return;
    if (!DEFECT_OPEN.includes(String(row.status)) || !ctx.resources.get('vehicle')) return;
    const vehicle = await ctx.resources.find('vehicle', String(row.target_id));
    if (!vehicle || vehicle.status === 'out_of_service') return;
    const statuses = await ctx.lookups.values('vehicle_status');
    if (!statuses.some((s) => s.value === 'out_of_service')) return;
    if (statuses.find((s) => s.value === vehicle.status)?.meta?.retired === true) return;
    await ctx.resources.update('vehicle', vehicle.id, { status: 'out_of_service' }, null, { via: `defect ${row.ref ?? ''}`.trim() });
  }

  ctx.defineResource({
    type: 'defect', table: 'defects', module: 'audits', label: 'Defect', plural: 'Defects',
    path: '/api/defects', route: '/inspections/defects', titleField: 'title',
    ref: { field: 'ref', prefix: 'DEF-' },
    scope: { site: (col) => `case when ${col('target_type')} = 'site' then ${col('target_id')} end` },
    searchable: ['title', 'description', 'target_label', 'work_order_ref'],
    defaultSort: { field: 'found_on', dir: 'desc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Defect', type: 'text', required: true, help: 'What is wrong, in a few words, for example "Rear door sensitive edge not working".' },
      description: { label: 'Description', type: 'longtext', personal: false, help: 'What was found and where.' },
      target_type: { label: 'On', type: 'lookup', list: 'inspection_target_type', required: true, help: 'What the defect is on.' },
      target_id: { label: 'Record', type: 'text', personal: false, help: 'The id of the record the defect is on.' },
      target_label: { label: 'Found on', type: 'text', readOnly: true, personal: false },
      inspection_id: { label: 'Found at inspection', type: 'ref', to: 'inspection', help: 'The inspection that found it, when there was one.' },
      item_id: { label: 'Checklist item', type: 'text', readOnly: true, personal: false },
      severity: { label: 'Severity', type: 'lookup', list: 'defect_severity', default: 'minor', help: 'Critical defects take the record out of service.' },
      out_of_service: { label: 'Takes it out of service', type: 'boolean', help: 'True when it must not be used until the defect is repaired.' },
      status: { label: 'Status', type: 'lookup', list: 'defect_status', default: 'open' },
      found_on: { label: 'Found', type: 'date' },
      owner_id: { label: 'Owner', type: 'user', help: 'The person who sees the repair through.' },
      deferred_until: { label: 'Repair by', type: 'date', help: 'For a deferred defect: the date by which it must be repaired.' },
      deferral_reason: { label: 'Why the repair can wait', type: 'longtext', personal: false },
      work_order_ref: { label: 'Work order', type: 'text', help: 'The work order number in the maintenance system.' },
      repaired_on: { label: 'Repaired', type: 'date' },
      repaired_by: { label: 'Repaired by', type: 'user', readOnly: true },
      repair_notes: { label: 'Repair notes', type: 'longtext', personal: false },
      verified_on: { label: 'Verified', type: 'date', readOnly: true },
      verified_by: { label: 'Verified by', type: 'user', readOnly: true },
    },
    hooks: {
      beforeCreate: (req, data) => defectRules(req, null, data),
      beforeUpdate: (req, existing, patch) => defectRules(req, existing, patch),
      afterCreate: async (_req, row) => { await holdVehicle(row); },
      afterUpdate: async (_req, _before, after) => { await holdVehicle(after); },
    },
  });

  /** Raises a defect for each checklist item answered "not met" on a completed inspection of a vehicle, site or asset. */
  async function raiseDefects(inspection: Row, req: FastifyRequest | null): Promise<Row[]> {
    if (!(DEFECT_TARGETS as readonly string[]).includes(String(inspection.target_type)) || !inspection.target_id) return [];
    if (!ctx.resources.get(String(inspection.target_type))) return [];
    const failed = await db.query<Row>(
      `select i.id, i.prompt, i.critical, r.note from checklist_responses r join checklist_template_items i on i.id = r.item_id
       where r.parent_type = 'inspection' and r.parent_id = $1 and r.answer = 'no'
         and not exists (select 1 from defects d where d.inspection_id = $1 and d.item_id = i.id and d.deleted_at is null)
       order by i.sort, i.created_at`, [inspection.id]);
    const made: Row[] = [];
    for (const f of failed) {
      const row = await ctx.resources.create('defect', {
        title: String(f.prompt).slice(0, 200), description: f.note || `Not met at inspection ${inspection.ref ?? ''}.`.replace(/\s+\./, '.'),
        target_type: inspection.target_type, target_id: inspection.target_id, inspection_id: inspection.id,
        severity: f.critical ? 'safety_critical' : 'major', owner_id: inspection.inspector_id ?? null,
        found_on: inspection.performed_on ? day(inspection.performed_on) : dayInZone(),
      }, req ?? undefined);
      await db.query('update defects set item_id = $2 where id = $1', [row.id, f.id]);
      made.push(row);
    }
    return made;
  }

  // Completing an inspection (from the web, the mobile app or the API) raises its defects.
  ctx.resources.onChange?.(async ({ action, def, row }) => {
    if (def.type !== 'inspection' || action !== 'update' || row.status !== 'complete' || inDataLoad()) return;
    try { await raiseDefects(row, null); } catch (err) { console.error('[audits] defects from inspection', row.ref, err); }
  });

  app.post('/api/inspections/:id/defects', { preHandler: ctx.requirePerm('audits.create') }, async (req) => {
    const ins = (await ctx.resources.find('inspection', String((req.params as Row).id ?? ''), req.user)) ?? ctx.fail(404, 'not_found', 'Inspection not found.');
    if (ins.status !== 'complete') ctx.fail(409, 'not_complete', 'Defects are raised from a completed inspection.');
    if (!(DEFECT_TARGETS as readonly string[]).includes(String(ins.target_type))) ctx.fail(409, 'no_target', 'Defects are raised on a vehicle, site or asset; this inspection is not of one.');
    const made = await raiseDefects(ins, req);
    return { raised: made.length, defects: made.map((d) => ({ id: d.id, ref: d.ref, title: d.title })) };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/inspections/:id/defects', tag: 'Audits', permission: 'audits.create',
    summary: 'Raise a defect for each checklist item not met on a completed inspection of a record (items that already have one are skipped)',
    response: '{ raised, defects: [{ id, ref, title }] }',
  });

  // ---------- one record's inspections and defects ----------

  app.get('/api/inspection-history/:type/:id', { preHandler: ctx.requirePerm('audits.view') }, async (req) => {
    const { type, id } = req.params as { type: string; id: string };
    if (!(DEFECT_TARGETS as readonly string[]).includes(type) || !UUID_RE.test(id)) ctx.fail(404, 'not_found', 'Record not found.');
    if (!ctx.resources.get(type)) ctx.fail(404, 'not_found', 'Record not found.');
    const record = (await ctx.resources.find(type, id, req.user)) ?? ctx.fail(404, 'not_found', 'Record not found.');
    const today = dayInZone();
    const inspections = await db.query<Row>(
      `select t.id, t.ref, t.title, t.due_on::text as due_on, t.performed_on::text as performed_on, t.status, t.result, t.score_pct
       from inspections t where t.deleted_at is null and t.target_type = $1 and t.target_id = $2
         and ${ctx.resources.visibleWhere('inspection', req.user, 't')}
       order by coalesce(t.performed_on, t.due_on) desc nulls last, t.created_at desc limit 50`, [type, id]);
    const defects = await db.query<Row>(
      `select t.id, t.ref, t.title, t.severity, t.status, t.out_of_service, t.found_on::text as found_on, t.deferred_until::text as deferred_until,
              t.work_order_ref, t.inspection_id
       from defects t where t.deleted_at is null and t.target_type = $1 and t.target_id = $2
         and ${ctx.resources.visibleWhere('defect', req.user, 't')}
       order by (t.status = any($3::text[])) desc, t.found_on desc, t.created_at desc limit 100`, [type, id, DEFECT_OPEN]);
    // Figures: every defect and inspection of the record, whatever the reader may open.
    const counts = await db.one<Row>(
      `select count(*) filter (where status = any($3::text[]))::int as open,
              count(*) filter (where status = any($3::text[]) and out_of_service)::int as out_of_service,
              count(*) filter (where status = 'repaired')::int as to_verify,
              count(*) filter (where status = 'deferred' and deferred_until < $4::date)::int as deferral_overdue
       from defects where deleted_at is null and target_type = $1 and target_id = $2`, [type, id, DEFECT_OPEN, today]);
    const due = await db.one<Row>(
      `select count(*) filter (where status in ('scheduled', 'in_progress') and due_on < $3::date)::int as overdue,
              count(*) filter (where status = 'missed')::int as missed,
              min(due_on) filter (where status in ('scheduled', 'in_progress'))::text as next_due
       from inspections where deleted_at is null and target_type = $1 and target_id = $2`, [type, id, today]);
    return {
      record: { type, id, status: record.status ?? null },
      out_of_service: (counts?.out_of_service ?? 0) > 0 || record.status === 'out_of_service',
      counts: { ...counts, ...due },
      inspections, defects, can_create: ctx.can(req.user, 'audits.create'),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/inspection-history/:type/:id', tag: 'Audits', permission: 'audits.view',
    summary: 'One record\'s inspections, its defects (open first) and whether it is out of service',
    response: '{ record: { type, id, status }, out_of_service, counts: { open, out_of_service, to_verify, deferral_overdue, overdue, missed, next_due }, inspections: [...], defects: [...], can_create }',
  });

  // Defects in My work and the calendars: open ones for their owner (dated when found), deferred
  // ones by the date they must be repaired by, repaired ones to verify for their owner.
  defineCalendarSource(app, {
    key: 'audits.defects', label: 'Defects I am to see repaired', kind: 'Defects',
    recordType: 'defect', permission: 'audits.view', work: true, anyone: true,
    async events(c, user, from, to, scope) {
      const rows = await c.db.query<Row>(
        `select t.id, t.ref, t.title, t.status, t.owner_id as p,
                (case when t.status = 'deferred' and t.deferred_until is not null then t.deferred_until else coalesce(t.found_on, t.created_at::date) end)::text as d
         from defects t where t.deleted_at is null and ${c.resources.visibleWhere('defect', user, 't')}
           and t.owner_id is not null and ($1::uuid is null or t.owner_id = $1)
           and t.status in ('open', 'deferred', 'repair_ordered', 'repaired')
           and (case when t.status = 'deferred' and t.deferred_until is not null then t.deferred_until else coalesce(t.found_on, t.created_at::date) end) <= $3::date
           and ($2::date is not null)
         order by 6, t.id limit 2000`, [whoFor(user, scope), from, to]);
      return rows.map((r) => ({
        uid: `audits.defects:${r.id}`,
        title: `${r.status === 'repaired' ? 'Verify the repair' : r.status === 'deferred' ? 'Deferred defect due' : 'Defect to repair'}: ${r.ref ?? ''} ${String(r.title).slice(0, 120)}`.replace(/\s+/g, ' '),
        start: day(r.d), allDay: true, url: `/inspections/defects/${r.id}`, recordType: 'defect', recordId: r.id,
        ref: r.ref ?? null, personId: r.p ?? null,
      }));
    },
  });

  return { raiseDefects };
}
