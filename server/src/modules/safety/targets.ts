import type { FastifyRequest } from 'fastify';
import { approvalEngine, defineApprovalKind } from '../../core/approval-kinds.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';

/**
 * Values entered by hand (E25-07) and yearly targets with their approval (E25-10).
 *
 * A manual indicator takes one value per month (`PUT /api/safety-indicators/:id/values/:period`).
 * Any indicator may have a target per year: it takes the place of the indicator's own target for
 * the months of that year, unless it was rejected. A year's target is approved either through the
 * approval workflow of kind `safety_targets` (record type `safety_indicator`, one year at a time),
 * or recorded as decided elsewhere, for example at a safety committee meeting, by someone who holds
 * `safety.approve` (with the decision's reference, and the meeting decision when the governance
 * module records one). Changing an approved target sends it back to "proposed".
 */

export const KIND = 'safety_targets';
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const TARGET_STATUSES = ['proposed', 'pending_approval', 'approved', 'rejected'];

/** Each year's target in force (rejected ones are left out). */
export async function targetsByYear(ctx: Pick<ModuleContext, 'db'>, indicatorId: string): Promise<Map<number, { target: number; direction: string }>> {
  const rows = await ctx.db.query<Row>(
    `select year, target, direction from safety_indicator_targets where indicator_id = $1 and status <> 'rejected'`, [indicatorId]);
  return new Map(rows.map((r) => [Number(r.year), { target: Number(r.target), direction: String(r.direction) }]));
}

/** The workflow a new installation starts with: one approver holding safety.approve. */
export const DEFAULT_TARGETS_WORKFLOW = {
  name: 'Safety performance targets',
  description: 'A year\'s safety performance target. Someone who may approve safety records decides; add a step for the accountable executive or the safety committee if your organization needs one.',
  steps: [{ key: 'safety-approver', name: 'Safety approver', approvers: { kind: 'permission', permission: 'safety.approve' }, quorum: 'any' }],
};

export function registerTargets(ctx: ModuleContext) {
  const { app, db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  const view = { preHandler: ctx.requirePerm('safety.view') };
  const edit = { preHandler: ctx.requirePerm('safety.edit') };
  const approve = { preHandler: ctx.requirePerm('safety.approve') };

  const indicatorFor = async (req: FastifyRequest): Promise<Row> =>
    (await ctx.resources.find('safety_indicator', (req.params as { id: string }).id, req.user)) ?? ctx.fail(404, 'not_found', 'Indicator not found.');
  const yearOf = (req: FastifyRequest): number => {
    const y = Number((req.params as { year: string }).year);
    return Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : ctx.fail(404, 'not_found', 'Give the year as four digits.');
  };
  const targetRow = async (indicatorId: string, year: number) =>
    db.one<Row>('select * from safety_indicator_targets where indicator_id = $1 and year = $2', [indicatorId, year]);
  const shape = (r: Row) => ({ ...r, target: Number(r.target), year: Number(r.year) });

  // ---------- manual values ----------

  app.get('/api/safety-indicators/:id/values', view, async (req) => {
    const ind = await indicatorFor(req);
    const rows = await db.query<Row>(
      `select to_char(v.period, 'YYYY-MM') as period, v.value, v.note, v.updated_at, u.display_name as entered_by_name
       from safety_indicator_values v left join users u on u.id = v.entered_by where v.indicator_id = $1 order by v.period desc`, [ind.id]);
    return rows.map((r) => ({ ...r, value: Number(r.value) }));
  });
  ctx.describeRoute({ method: 'GET', path: '/api/safety-indicators/:id/values', permission: 'safety.view', summary: 'Values entered by hand for an indicator, newest month first', response: '[{ period, value, note, updated_at, entered_by_name }]' });

  app.put('/api/safety-indicators/:id/values/:period', edit, async (req) => {
    const ind = await indicatorFor(req);
    if (ind.measure !== 'manual') ctx.fail(409, 'not_manual', 'Values are entered by hand only for an indicator measured by hand.');
    const period = String((req.params as { period: string }).period);
    if (!PERIOD.test(period)) invalid({ period: 'Give the month as YYYY-MM.' });
    if (period > dayInZone().slice(0, 7)) invalid({ period: 'A value cannot be entered for a future month.' });
    const b = (req.body ?? {}) as Row;
    const before = await db.one<Row>('select value, note from safety_indicator_values where indicator_id = $1 and period = $2::date', [ind.id, `${period}-01`]);
    if (b.value === null || b.value === '' || b.value === undefined) {
      await db.query('delete from safety_indicator_values where indicator_id = $1 and period = $2::date', [ind.id, `${period}-01`]);
      if (before) await ctx.audit(req, { action: 'safety_indicator.value_remove', recordType: 'safety_indicator', recordId: ind.id, summary: `Value for ${period} removed`, before });
      return { period, value: null, note: null };
    }
    const value = Number(b.value);
    if (!Number.isFinite(value) || value < 0) invalid({ value: 'Give a number, zero or more.' });
    const note = String(b.note ?? '').trim().slice(0, 1000) || null;
    await db.query(
      `insert into safety_indicator_values (indicator_id, period, value, note, entered_by) values ($1,$2::date,$3,$4,$5)
       on conflict (indicator_id, period) do update set value = excluded.value, note = excluded.note, entered_by = excluded.entered_by, updated_at = now()`,
      [ind.id, `${period}-01`, value, note, req.user!.id]);
    await ctx.audit(req, {
      action: 'safety_indicator.value', recordType: 'safety_indicator', recordId: ind.id,
      summary: `Value for ${period} recorded: ${value}`, before: before ?? undefined, after: { period, value, note },
    });
    return { period, value, note };
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/safety-indicators/:id/values/:period', permission: 'safety.edit',
    summary: 'Enter (or, with an empty value, remove) the value of a manual indicator for one month', body: '{ value: number | null, note? }',
  });

  // ---------- yearly targets ----------

  app.get('/api/safety-indicators/:id/targets', view, async (req) => {
    const ind = await indicatorFor(req);
    const eng = approvalEngine(app);
    const rows = await db.query<Row>('select * from safety_indicator_targets where indicator_id = $1 order by year desc', [ind.id]);
    const running = eng ? await eng.running(KIND, ind.id) : null;
    return {
      approval_available: Boolean(eng && (await eng.definitions(KIND)).length),
      running: running ? { id: running.id, workflow: running.name, year: running.data.year ?? null, started_at: running.startedAt } : null,
      targets: rows.map(shape),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/safety-indicators/:id/targets', permission: 'safety.view',
    summary: 'An indicator\'s yearly targets, and the approval waiting, if any',
    response: '{ approval_available, running: { id, workflow, year, started_at } | null, targets: [{ id, year, target, direction, status, approved_by_name, approved_on, approval_ref, decision_id, note }] }',
  });

  function cleanTarget(b: Row, existing: Row | null): Row {
    const errors: Record<string, string> = {};
    const out: Row = {};
    if (!existing || b.target !== undefined) {
      const t = Number(b.target);
      if (b.target === null || b.target === '' || b.target === undefined || !Number.isFinite(t) || t < 0) errors.target = 'Give the target, zero or more.'; else out.target = t;
    }
    if (!existing || b.direction !== undefined) {
      const d = String(b.direction ?? 'at_most');
      if (!['at_most', 'at_least'].includes(d)) errors.direction = 'Choose at most or at least.'; else out.direction = d;
    }
    if (b.note !== undefined) out.note = String(b.note ?? '').trim().slice(0, 2000) || null;
    if (Object.keys(errors).length) invalid(errors);
    return out;
  }

  /** Body: { year, target, direction?, note? }. */
  app.post('/api/safety-indicators/:id/targets', edit, async (req, reply) => {
    const ind = await indicatorFor(req);
    const b = (req.body ?? {}) as Row;
    const year = Number(b.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) invalid({ year: 'Give the year as four digits.' });
    if (await targetRow(ind.id, year)) ctx.fail(409, 'duplicate', `There is already a target for ${year}. Change that one.`);
    const d = cleanTarget(b, null);
    const row = (await db.one<Row>(
      `insert into safety_indicator_targets (indicator_id, year, target, direction, note, created_by, updated_by) values ($1,$2,$3,$4,$5,$6,$6) returning *`,
      [ind.id, year, d.target, d.direction, d.note ?? null, req.user!.id]))!;
    await ctx.audit(req, { action: 'safety_indicator.target_add', recordType: 'safety_indicator', recordId: ind.id, summary: `Target for ${year} proposed: ${d.direction === 'at_least' ? 'at least' : 'at most'} ${d.target}`, after: shape(row) });
    reply.code(201);
    return shape(row);
  });
  ctx.describeRoute({ method: 'POST', path: '/api/safety-indicators/:id/targets', permission: 'safety.edit', summary: 'Propose an indicator\'s target for a year', body: '{ year, target, direction?: "at_most" | "at_least", note? }' });

  app.patch('/api/safety-indicators/:id/targets/:year', edit, async (req) => {
    const ind = await indicatorFor(req);
    const year = yearOf(req);
    const before = (await targetRow(ind.id, year)) ?? ctx.fail(404, 'not_found', `No target for ${year}.`);
    if (before.status === 'pending_approval') ctx.fail(409, 'pending_approval', 'This target is waiting for approval. Cancel the approval request first.');
    const d = cleanTarget((req.body ?? {}) as Row, before);
    const changesFigure = (d.target !== undefined && Number(d.target) !== Number(before.target)) || (d.direction !== undefined && d.direction !== before.direction);
    // A changed figure is a new proposal: its earlier approval no longer covers it.
    const reset = changesFigure ? { status: 'proposed', approved_by_name: null, approved_on: null, approval_ref: null, decision_id: null } : {};
    const all: Row = { ...d, ...reset };
    const keys = Object.keys(all);
    if (!keys.length) return shape(before);
    const row = (await db.one<Row>(
      `update safety_indicator_targets set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now(), updated_by = $${keys.length + 2} where id = $1 returning *`,
      [before.id, ...keys.map((k) => all[k]), req.user!.id]))!;
    await ctx.audit(req, {
      action: 'safety_indicator.target_update', recordType: 'safety_indicator', recordId: ind.id,
      summary: `Target for ${year} changed${changesFigure && before.status === 'approved' ? ' (it needs approval again)' : ''}`, before: shape(before), after: shape(row),
    });
    return shape(row);
  });
  ctx.describeRoute({ method: 'PATCH', path: '/api/safety-indicators/:id/targets/:year', permission: 'safety.edit', summary: 'Change a year\'s target (a changed figure needs approval again)', body: '{ target?, direction?, note? }' });

  app.delete('/api/safety-indicators/:id/targets/:year', edit, async (req) => {
    const ind = await indicatorFor(req);
    const year = yearOf(req);
    const before = (await targetRow(ind.id, year)) ?? ctx.fail(404, 'not_found', `No target for ${year}.`);
    if (before.status === 'approved' && !ctx.can(req.user, 'safety.approve')) ctx.fail(403, 'forbidden', 'An approved target can be removed only by someone who may approve safety records.');
    if (before.status === 'pending_approval') await approvalEngine(app)?.cancel(KIND, ind.id, `The target for ${year} was removed.`, req);
    await db.query('delete from safety_indicator_targets where id = $1', [before.id]);
    await ctx.audit(req, { action: 'safety_indicator.target_remove', recordType: 'safety_indicator', recordId: ind.id, summary: `Target for ${year} removed`, before: shape(before) });
    return { ok: true };
  });
  ctx.describeRoute({ method: 'DELETE', path: '/api/safety-indicators/:id/targets/:year', permission: 'safety.edit', summary: 'Remove a year\'s target (an approved one also needs safety.approve)' });

  // ---------- approval ----------

  defineApprovalKind(app, {
    key: KIND, recordType: 'safety_indicator', label: 'Safety performance targets',
    startsWhen: 'Someone asks for an indicator\'s target for a year to be approved',
    outcome: 'Approved: the year\'s target is recorded as approved (approver and date); rejected: it is marked rejected and the indicator\'s own target applies that year',
    approverPermission: 'safety.approve',
    route: (id) => `/safety/indicators/${id}?tab=targets`,
    async install(h) {
      if (!(await h.hasDefinitions())) await h.define(DEFAULT_TARGETS_WORKFLOW);
    },
    async onFinish(e) {
      const year = Number(e.instance.data.year);
      const row = await targetRow(e.instance.recordId, year);
      if (!row) {
        if (e.outcome === 'canceled') return;
        throw new Error(`The target for ${year} no longer exists.`);
      }
      if (e.outcome === 'canceled') {
        if (row.status === 'pending_approval') await db.query(`update safety_indicator_targets set status = 'proposed', updated_at = now() where id = $1`, [row.id]);
        return;
      }
      const who = `${e.approverName ?? 'An approver'}${e.onBehalfOfName ? ` on behalf of ${e.onBehalfOfName}` : ''}`;
      if (e.outcome === 'rejected') {
        await db.query(`update safety_indicator_targets set status = 'rejected', note = coalesce($2, note), updated_at = now() where id = $1`, [row.id, e.comment ? `Rejected: ${e.comment}` : null]);
      } else {
        await db.query(
          `update safety_indicator_targets set status = 'approved', approved_by_name = $2, approved_on = $3, approval_ref = $4, updated_at = now() where id = $1`,
          [row.id, who, dayInZone(), `Approval workflow "${e.instance.name}"`]);
      }
      await ctx.audit(e.req, {
        action: e.outcome === 'approved' ? 'safety_indicator.target_approved' : 'safety_indicator.target_rejected',
        recordType: 'safety_indicator', recordId: e.instance.recordId,
        summary: `Target for ${year} ${e.outcome} by ${who}${e.comment ? `: ${e.comment}` : ''}`,
      });
    },
  });

  app.post('/api/safety-indicators/:id/targets/:year/approval', edit, async (req, reply) => {
    const ind = await indicatorFor(req);
    const year = yearOf(req);
    const row = (await targetRow(ind.id, year)) ?? ctx.fail(404, 'not_found', `No target for ${year}.`);
    if (row.status === 'approved') ctx.fail(409, 'approved', `The target for ${year} is already approved.`);
    const eng = approvalEngine(app) ?? ctx.fail(409, 'approvals_unavailable', 'Approval workflows are not available: record the decision instead.');
    if (await eng.running(KIND, ind.id)) ctx.fail(409, 'already_requested', 'A target of this indicator is already waiting for approval.');
    const note = String(((req.body ?? {}) as Row).note ?? '').trim().slice(0, 2000) || null;
    const started = await eng.start(KIND, ind, { requester: req.user!.id, req, note: note ?? `Target for ${year}`, data: { year, target: Number(row.target), direction: row.direction } });
    if (!started) ctx.fail(409, 'no_workflow', 'No active Safety performance targets workflow applies. An administrator can set one up under Administration > Approval workflows, or record the decision instead.');
    await db.query(`update safety_indicator_targets set status = 'pending_approval', updated_at = now() where id = $1 and status <> 'approved'`, [row.id]);
    await ctx.audit(req, { action: 'safety_indicator.target_approval_requested', recordType: 'safety_indicator', recordId: ind.id, summary: `Approval of the target for ${year} asked for (${started!.name})` });
    reply.code(201);
    return { instance_id: started!.id, workflow: started!.name, status: (await eng.latest(KIND, ind.id))?.status ?? started!.status, target: shape((await targetRow(ind.id, year))!) };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/safety-indicators/:id/targets/:year/approval', permission: 'safety.edit',
    summary: 'Ask for a year\'s target to be approved: starts the Safety performance targets approval workflow', body: '{ note? }',
    response: '{ instance_id, workflow, status, target }',
  });

  /** Records an approval given outside the application, for example at a safety committee meeting. */
  app.post('/api/safety-indicators/:id/targets/:year/decision', approve, async (req) => {
    const ind = await indicatorFor(req);
    const year = yearOf(req);
    const row = (await targetRow(ind.id, year)) ?? ctx.fail(404, 'not_found', `No target for ${year}.`);
    const b = (req.body ?? {}) as Row;
    const errors: Record<string, string> = {};
    const decided = String(b.decision ?? 'approved');
    if (!['approved', 'rejected'].includes(decided)) errors.decision = 'Choose approved or rejected.';
    const by = String(b.approved_by_name ?? '').trim().slice(0, 200);
    if (!by) errors.approved_by_name = 'Say who decided (a person or a body, for example the safety committee).';
    const on = String(b.approved_on ?? '').trim();
    if (!DATE.test(on) || Number.isNaN(Date.parse(on))) errors.approved_on = 'Give the date of the decision (YYYY-MM-DD).';
    else if (on > dayInZone()) errors.approved_on = 'The decision cannot be in the future.';
    const ref = String(b.approval_ref ?? '').trim().slice(0, 300);
    if (!ref) errors.approval_ref = 'Give a reference to the decision, for example the meeting and item.';
    const decision = b.decision_id ? String(b.decision_id) : null;
    if (decision && !UUID.test(decision)) errors.decision_id = 'Choose a meeting decision.';
    else if (decision && ctx.resources.get('meeting_decision') && !(await ctx.resources.find('meeting_decision', decision, req.user))) errors.decision_id = 'That meeting decision does not exist.';
    if (Object.keys(errors).length) invalid(errors);
    // A decision taken outside replaces any request still waiting in the application.
    await approvalEngine(app)?.cancel(KIND, ind.id, `Decided outside the application: ${ref}.`, req);
    const updated = (await db.one<Row>(
      `update safety_indicator_targets set status = $2, approved_by_name = $3, approved_on = $4, approval_ref = $5,
         decision_id = $6, updated_at = now(), updated_by = $7 where id = $1 returning *`,
      [row.id, decided, by, on, ref, decision && ctx.resources.get('meeting_decision') ? decision : null, req.user!.id]))!;
    await ctx.audit(req, {
      action: decided === 'approved' ? 'safety_indicator.target_approved' : 'safety_indicator.target_rejected',
      recordType: 'safety_indicator', recordId: ind.id,
      summary: `Target for ${year} recorded as ${decided} by ${by} on ${on} (${ref})`, before: shape(row), after: shape(updated),
    });
    return shape(updated);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/safety-indicators/:id/targets/:year/decision', permission: 'safety.approve',
    summary: 'Record a year\'s target as approved or rejected outside the application, for example at a committee meeting',
    body: '{ decision?: "approved" | "rejected", approved_by_name, approved_on: date, approval_ref, decision_id? }',
  });
}
