// Missed and overdue inspections (wave 26, E46): record why one was missed, reschedule it (a new
// inspection replaces it; the missed one stays, so the on-time figures keep it) and raise a
// follow-up action. The figures of inspections needing attention, for the inspection and safety
// pages, and the inspections in My work.
import type { FastifyRequest } from 'fastify';
import { defineCalendarSource, whoFor } from '../../core/calendar.ts';
import { actorOf, dataLoadFor } from '../../core/dataload.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { addDays } from './dates.ts';
import { DEFECT_OPEN } from './defects.ts';

const OPEN = ['scheduled', 'in_progress'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? '')).slice(0, 10);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Whether an inspection needs following up: missed, or still open after its due date. */
export const isLate = (ins: Row, today: string) =>
  ins.status === 'missed' || (OPEN.includes(String(ins.status)) && Boolean(ins.due_on) && day(ins.due_on) < today);

export function registerMissed(ctx: ModuleContext) {
  const { app, db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  const need = async (req: FastifyRequest): Promise<Row> =>
    (await ctx.resources.find('inspection', String((req.params as Row).id ?? ''), req.user)) ?? ctx.fail(404, 'not_found', 'Inspection not found.');
  const nameOf = (ins: Row) => [ins.ref, ins.title].filter(Boolean).join(' ');

  /** Records the reason on the inspection (and marks an overdue one missed). */
  async function recordReason(req: FastifyRequest, ins: Row, reason: string, body: Row): Promise<Row> {
    const load = await dataLoadFor(db, req);
    const on = load && typeof body.missed_reason_on === 'string' && DATE.test(body.missed_reason_on) ? body.missed_reason_on : dayInZone();
    const patch: Row = { missed_reason: reason, missed_reason_by: actorOf(req).id, missed_reason_on: on };
    if (ins.status !== 'missed') patch.status = 'missed';
    // System work: the reason fields are the application's to stamp; the person's request is audited below.
    const row = await ctx.resources.update('inspection', ins.id, patch, null, { via: 'missed inspection' });
    await ctx.audit(req, {
      action: 'inspection.missed_reason', recordType: 'inspection', recordId: ins.id,
      summary: `Inspection ${nameOf(ins)} missed: ${reason.slice(0, 300)}`, before: { status: ins.status }, after: { status: 'missed', missed_reason: reason },
    });
    return row;
  }

  function lateOrRefuse(ins: Row) {
    if (!isLate(ins, dayInZone())) ctx.fail(409, 'not_missed', 'Only a missed inspection, or one still open after its due date, can be followed up this way.');
  }

  app.post('/api/inspections/:id/missed-reason', { preHandler: ctx.requirePerm('audits.edit') }, async (req) => {
    const ins = await need(req);
    lateOrRefuse(ins);
    const body = (req.body ?? {}) as Row;
    const reason = text(body.reason, 4000) || invalid({ reason: 'Say why the inspection was missed.' });
    return recordReason(req, ins, reason, body);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/inspections/:id/missed-reason', tag: 'Audits', permission: 'audits.edit',
    summary: 'Record why an inspection was missed; an inspection still open after its due date is marked missed',
    description: '409 `not_missed` unless the inspection is missed or overdue. In data load mode `missed_reason_on` may give the date, and `on_behalf_of` the person.',
    body: '{ reason, missed_reason_on? }', response: 'the inspection',
  });

  app.post('/api/inspections/:id/reschedule', { preHandler: ctx.requirePerm('audits.create') }, async (req, reply) => {
    const ins = await need(req);
    lateOrRefuse(ins);
    if (ins.rescheduled_to_id) ctx.fail(409, 'already_rescheduled', 'This inspection has already been rescheduled.');
    const body = (req.body ?? {}) as Row;
    const load = await dataLoadFor(db, req);
    const due = typeof body.due_on === 'string' && DATE.test(body.due_on) ? body.due_on : invalid({ due_on: 'Give the new due date.' });
    if (!load && due < dayInZone()) invalid({ due_on: 'The new due date cannot be in the past.' });
    const reason = text(body.reason, 4000) || ins.missed_reason || invalid({ reason: 'Say why the inspection was missed.' });
    if (ins.schedule_id && await db.one('select 1 from inspections where schedule_id = $1 and due_on = $2 and deleted_at is null', [ins.schedule_id, due])) {
      ctx.fail(409, 'already_due', 'An inspection from the same schedule is already due on that date.');
    }
    let current = ins;
    if (!ins.missed_reason || text(body.reason, 4000)) current = await recordReason(req, ins, reason, body);
    const created = await ctx.resources.create('inspection', {
      template_id: ins.template_id, schedule_id: ins.schedule_id ?? null, target_type: ins.target_type ?? null, target_id: ins.target_id ?? null,
      inspector_id: typeof body.inspector_id === 'string' && body.inspector_id ? body.inspector_id : ins.inspector_id ?? null,
      due_on: due, status: 'scheduled', title: ins.title,
    }, req);
    const linked = await ctx.resources.update('inspection', created.id, { rescheduled_from_id: ins.id }, null, { via: 'reschedule' });
    await ctx.resources.update('inspection', ins.id, { rescheduled_to_id: created.id }, null, { via: 'reschedule' });
    await ctx.audit(req, {
      action: 'inspection.rescheduled', recordType: 'inspection', recordId: ins.id,
      summary: `Inspection ${nameOf(current)} rescheduled to ${due} as ${created.ref}`, after: { rescheduled_to_id: created.id, due_on: due },
    });
    reply.code(201);
    return linked;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/inspections/:id/reschedule', tag: 'Audits', permission: 'audits.create',
    summary: 'Reschedule a missed or overdue inspection: it is marked missed with its reason, and a new inspection is created for the new date',
    description: 'The reason is needed unless one was recorded already. 409 `not_missed`, `already_rescheduled`, or `already_due` when the schedule already has an inspection that day.',
    body: '{ due_on, reason?, inspector_id? }', response: 'the new inspection',
  });

  app.post('/api/inspections/:id/follow-up', { preHandler: ctx.requirePerm('actions.create') }, async (req, reply) => {
    if (!ctx.can(req.user, 'audits.view')) ctx.fail(403, 'forbidden', 'You do not have access to inspections.');
    const ins = await need(req);
    if (!ctx.resources.get('action')) ctx.fail(409, 'no_actions', 'Actions are not available on this installation.');
    lateOrRefuse(ins);
    const body = (req.body ?? {}) as Row;
    const due = typeof body.due_on === 'string' && DATE.test(body.due_on) ? body.due_on : addDays(dayInZone(), 14);
    const action = await ctx.resources.create('action', {
      title: text(body.title, 200) || `Follow up the missed inspection ${nameOf(ins)}`.slice(0, 200),
      description: text(body.description, 4000) || (ins.missed_reason ? `Missed: ${ins.missed_reason}` : 'The inspection was not carried out by its due date.'),
      source: 'inspection', source_type: 'inspection', source_id: ins.id,
      owner_id: typeof body.owner_id === 'string' && body.owner_id ? body.owner_id : ins.inspector_id ?? actorOf(req).id,
      due_on: due, priority: typeof body.priority === 'string' ? body.priority : 'medium', status: 'open',
    }, req);
    reply.code(201);
    return action;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/inspections/:id/follow-up', tag: 'Audits', permission: 'actions.create',
    summary: 'Raise a follow-up action on a missed or overdue inspection (also needs audits.view)',
    body: '{ title?, description?, owner_id?, due_on? (default in 14 days), priority? }', response: 'the action',
  });

  // ---------- figures ----------

  app.get('/api/inspections/attention', { preHandler: ctx.requirePerm('audits.view') }, async () => {
    const today = dayInZone();
    // Figures: every inspection, schedule and defect counts, whatever the reader may open.
    const actions = Boolean(ctx.resources.get('action'));
    const followed = actions
      ? `or exists (select 1 from actions a where a.deleted_at is null and a.source_type = 'inspection' and a.source_id::text = i.id::text)`
      : '';
    const ins = await db.one<Row>(
      `select count(*) filter (where i.status = any($1::text[]) and i.due_on < $2::date)::int as overdue,
              count(*) filter (where i.status = any($1::text[]) and i.due_on between $2::date and $3::date)::int as due_soon,
              count(*) filter (where i.status = 'missed' and not (i.rescheduled_to_id is not null ${followed}))::int as missed_open,
              count(*) filter (where i.status = 'missed' and i.due_on >= $4::date)::int as missed_90_days
       from inspections i where i.deleted_at is null`, [OPEN, today, addDays(today, 7), addDays(today, -90)]);
    const behind = await db.one<Row>(
      `select count(distinct s.id)::int as c from inspection_schedules s join inspections i on i.schedule_id = s.id and i.deleted_at is null
       where s.deleted_at is null and s.active
         and ((i.status = any($1::text[]) and i.due_on < $2::date) or (i.status = 'missed' and not (i.rescheduled_to_id is not null ${followed})))`, [OPEN, today]);
    const defects = await db.one<Row>(
      `select count(*) filter (where status = any($1::text[]))::int as open,
              count(*) filter (where status = any($1::text[]) and out_of_service)::int as out_of_service,
              count(*) filter (where status = 'repaired')::int as to_verify,
              count(*) filter (where status = 'deferred' and deferred_until < $2::date)::int as deferral_overdue
       from defects where deleted_at is null`, [DEFECT_OPEN, today]);
    return { today, inspections: { ...ins, schedules_behind: behind?.c ?? 0 }, defects };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/inspections/attention', tag: 'Audits', permission: 'audits.view',
    summary: 'Inspections needing attention (overdue, due within a week, missed without a reschedule or follow-up, schedules behind) and defect counts',
    response: '{ today, inspections: { overdue, due_soon, missed_open, missed_90_days, schedules_behind }, defects: { open, out_of_service, to_verify, deferral_overdue } }',
  });

  // ---------- My work and the calendars ----------

  // Inspections due and overdue are the source `audits.inspections` (feeds/sources.ts); this one adds
  // the missed inspections nobody has followed up yet (no reason recorded, not rescheduled), for their
  // inspector, dated by when they were due, so they stay listed until someone acts.
  defineCalendarSource(app, {
    key: 'audits.missed_inspections', label: 'Missed inspections to follow up', kind: 'Missed inspections',
    recordType: 'inspection', permission: 'audits.view', work: true, anyone: true,
    async events(c, user, _from, to, scope) {
      const rows = await c.db.query<Row>(
        `select t.id, t.ref, t.title, t.due_on::text as d, t.inspector_id as p from inspections t
         where t.deleted_at is null and ${c.resources.visibleWhere('inspection', user, 't')}
           and t.inspector_id is not null and ($1::uuid is null or t.inspector_id = $1) and t.due_on is not null
           and t.status = 'missed' and t.missed_reason is null and t.rescheduled_to_id is null and t.due_on <= $2::date
         order by t.due_on, t.id limit 2000`, [whoFor(user, scope), to]);
      return rows.map((r) => ({
        uid: `audits.missed_inspections:${r.id}`,
        title: `Missed inspection, record why or reschedule: ${r.ref ?? ''} ${String(r.title ?? '').slice(0, 120)}`.replace(/\s+/g, ' '),
        start: day(r.d), allDay: true, url: `/inspections/${r.id}`,
        recordType: 'inspection', recordId: r.id, ref: r.ref ?? null, personId: r.p ?? null,
      }));
    },
  });
}
