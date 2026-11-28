import type { FastifyRequest } from 'fastify';
// Procurement in the rest of the application (E46): the area's figures (Overview widget, metrics), dated
// work for My work and the calendars (offers due, evaluations to score, orders to approve), and the
// required-clauses checklist of each solicitation (the shared clause engine).
import { approvalEngine } from '../../core/approval-kinds.ts';
import { defineCalendarSource, whoFor } from '../../core/calendar.ts';
import { defineClauseSet, getChecklist, saveChecklist } from '../../core/clauses.ts';
import { defineMetric } from '../../core/metrics.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone, todayInZone } from '../../core/timezone.ts';
import { addDays } from '../../../../shared/dates.ts';
import { budgetTotals, currentBudgetIds } from './budgets.ts';
import { PO, PO_KIND } from './orders.ts';
import { body, idParam, invalid } from './shared.ts';
import { openStatuses, PROCUREMENT } from './solicitations.ts';

const ymd = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? '')).slice(0, 10);
export const CLAUSE_SET = 'procurement_clauses';

/** The area's figures: the same for every viewer. */
export async function procurementSummary(ctx: ModuleContext) {
  const { db } = ctx;
  const today = todayInZone();
  const open = await openStatuses(ctx);
  const s = (await db.one<Row>(
    `select count(*) filter (where status = any($1::text[]))::int as open,
            count(*) filter (where status = any($1::text[]) and proposals_due_at::date between $2::date and $3::date)::int as due_soon,
            count(*) filter (where status = any($1::text[]) and awarded_on is null and proposals_due_at::date < $2::date)::int as awaiting_award
     from procurements where deleted_at is null`, [open, today, addDays(today, 14)]))!;
  const p = (await db.one<Row>(
    `select count(*) filter (where status = 'pending_approval')::int as awaiting_approval,
            count(*) filter (where status in ('approved', 'issued', 'partially_received'))::int as open_orders,
            count(*) filter (where status = 'draft')::int as drafts
     from purchase_orders where deleted_at is null`))!;
  const budget = await budgetTotals(ctx, await currentBudgetIds(ctx));
  return {
    today,
    solicitations: { open: s.open, due_soon: s.due_soon, awaiting_award: s.awaiting_award },
    orders: { awaiting_approval: p.awaiting_approval, open: p.open_orders, drafts: p.drafts },
    budget,
  };
}

export function registerWork(ctx: ModuleContext) {
  const { app } = ctx;

  app.get('/api/procurement/summary', { preHandler: ctx.requirePerm('procurement.view') }, async () => procurementSummary(ctx));
  ctx.describeRoute({
    method: 'GET', path: '/api/procurement/summary', tag: 'Procurement', permission: 'procurement.view',
    summary: 'Procurement figures, the same for every viewer: open solicitations, orders awaiting approval, and the budgets in force against committed and spent',
    response: '{ today, solicitations: { open, due_soon, awaiting_award }, orders: { awaiting_approval, open, drafts }, budget: { amount, committed, spent, remaining, used_pct } }',
  });

  // ---------- calendars and My work ----------

  defineCalendarSource(app, {
    key: 'procurement.offers_due', label: 'Offers due on solicitations', kind: 'Offers due',
    recordType: PROCUREMENT, permission: 'procurement.view', anyone: true,
    async events(c, user, from, to, scope) {
      const open = await openStatuses(ctx);
      const rows = await c.db.query<Row>(
        `select t.id, t.ref, t.title, t.proposals_due_at, t.buyer_id as p from procurements t
         where t.deleted_at is null and ${c.resources.visibleWhere(PROCUREMENT, user, 't')} and t.status = any($4::text[])
           and ($1::uuid is null or t.buyer_id = $1) and t.proposals_due_at is not null
           and t.proposals_due_at >= $2::date and t.proposals_due_at < ($3::date + 1)
         order by t.proposals_due_at limit 2000`, [whoFor(user, scope), from, to, open]);
      return rows.map((r) => ({
        uid: `procurement.offers_due:${r.id}`, title: `Offers due: ${r.ref ?? ''} ${String(r.title).slice(0, 120)}`.replace(/\s+/g, ' '),
        start: new Date(r.proposals_due_at).toISOString(), allDay: false, url: `/procurement/solicitations/${r.id}`,
        recordType: PROCUREMENT, recordId: r.id, ref: r.ref ?? null, personId: r.p ?? null,
      }));
    },
  });

  // Committee members score without a procurement permission of their own: each item names them.
  defineCalendarSource(app, {
    key: 'procurement.evaluations', label: 'Evaluations I am to score', kind: 'Evaluations',
    recordType: PROCUREMENT, permission: 'procurement.view', work: true, named: true,
    async events(c, user, from, to) {
      const rows = await c.db.query<Row>(
        `select t.id, t.ref, t.title, coalesce(t.award_planned_on, t.proposals_due_at::date, t.created_at::date)::text as d from procurements t
         join procurement_evaluators e on e.procurement_id = t.id and e.user_id = $1
         where t.deleted_at is null and t.awarded_on is null and t.status not in ('canceled', 'closed')
           and e.role <> 'advisor' and e.coi_status <> 'conflict' and e.submitted_at is null
           and coalesce(t.award_planned_on, t.proposals_due_at::date, t.created_at::date) <= $3::date
           and (coalesce(t.award_planned_on, t.proposals_due_at::date, t.created_at::date) >= $2::date or coalesce(t.award_planned_on, t.proposals_due_at::date, t.created_at::date) < $4::date)
         order by 4, t.id limit 500`, [user.id, from, to, dayInZone()]);
      return rows.map((r) => ({
        uid: `procurement.evaluations:${r.id}`, title: `Score offers: ${r.ref ?? ''} ${String(r.title).slice(0, 120)}`.replace(/\s+/g, ' '),
        start: ymd(r.d), allDay: true, url: `/procurement/evaluate/${r.id}`, recordType: PROCUREMENT, recordId: r.id, ref: r.ref ?? null, personId: user.id,
      }));
    },
  });

  defineCalendarSource(app, {
    key: 'procurement.order_approvals', label: 'Purchase orders to approve', kind: 'Purchase orders to approve',
    recordType: PO, permission: 'procurement.view', work: true,
    async events(c, user, from, to) {
      const rows = await c.db.query<Row>(
        `select t.id, t.ref, t.title, t.requested_by, coalesce(t.submitted_at, t.updated_at)::date::text as d from purchase_orders t
         where t.deleted_at is null and t.status = 'pending_approval' and ${c.resources.visibleWhere(PO, user, 't')}
           and coalesce(t.submitted_at, t.updated_at)::date <= $2::date
           and (coalesce(t.submitted_at, t.updated_at)::date >= $1::date or coalesce(t.submitted_at, t.updated_at)::date < $3::date)
         order by 5, t.id limit 500`, [from, to, dayInZone()]);
      const eng = approvalEngine(app);
      const waiting = new Set(eng ? await eng.waiting(PO_KIND, user.id) : []);
      const mayApprove = c.can(user, 'procurement.approve');
      const out = [];
      for (const r of rows) {
        const running = eng ? await eng.running(PO_KIND, r.id) : null;
        const mine = running ? waiting.has(r.id) : mayApprove && r.requested_by !== user.id;
        if (!mine) continue;
        out.push({
          uid: `procurement.order_approvals:${r.id}`, title: `Approve purchase order: ${r.ref ?? ''} ${String(r.title).slice(0, 120)}`.replace(/\s+/g, ' '),
          start: ymd(r.d), allDay: true, url: `/procurement/purchase-orders/${r.id}`, recordType: PO, recordId: r.id, ref: r.ref ?? null, personId: user.id,
        });
      }
      return out;
    },
  });

  // ---------- metrics ----------

  defineMetric(app, {
    key: 'procurement.open_solicitations', label: 'Open solicitations', unit: 'count', recordType: PROCUREMENT,
    description: 'Solicitations being planned, issued or evaluated at the end of the month: issued (or made) by then, and neither awarded nor canceled by then. For the month still running, today.',
    async compute(c, monthStart) {
      const today = dayInZone();
      const end = new Date(`${monthStart}T00:00:00Z`);
      end.setUTCMonth(end.getUTCMonth() + 1);
      end.setUTCDate(0);
      const at = end.toISOString().slice(0, 10) > today ? today : end.toISOString().slice(0, 10);
      const r = await c.db.one<Row>(
        `select count(*)::int as n from procurements where deleted_at is null
           and coalesce(issued_on, created_at::date) <= $1::date and (awarded_on is null or awarded_on > $1::date)
           and not (status in ('canceled', 'closed') and updated_at::date <= $1::date and awarded_on is null)`, [at]);
      return Number(r?.n ?? 0);
    },
  });
  defineMetric(app, {
    key: 'procurement.orders_awaiting_approval', label: 'Purchase orders awaiting approval', unit: 'count', recordType: PO,
    description: 'Purchase orders sent for approval and not yet decided. Worked out from the orders as they are now, so only the current month has a figure.',
    async compute(c, monthStart) {
      if (monthStart.slice(0, 7) !== dayInZone().slice(0, 7)) return null;
      const r = await c.db.one<Row>(`select count(*)::int as n from purchase_orders where deleted_at is null and status = 'pending_approval'`);
      return Number(r?.n ?? 0);
    },
  });
  defineMetric(app, {
    key: 'procurement.budget_used_pct', label: 'Budget used', unit: 'percent', recordType: 'budget',
    description: 'Committed and spent as a share of the budgets in force (adopted or amended, and today within their year). Only the current month has a figure.',
    async compute(c, monthStart) {
      if (monthStart.slice(0, 7) !== dayInZone().slice(0, 7)) return null;
      return (await budgetTotals(ctx, await currentBudgetIds(ctx))).used_pct;
    },
  });

  // ---------- required clauses ----------

  defineClauseSet(app, {
    key: CLAUSE_SET, label: 'Required clauses', list: 'procurement_clause', statusList: 'procurement_clause_status',
    scopeType: PROCUREMENT, permission: 'procurement.view', auditAction: 'procurement.clause_check',
    describe: ({ clause, status, scope }) => `Required clause "${clause}" on ${scope?.ref ?? 'the solicitation'}: ${status ?? 'not assessed'}`,
  });

  async function need(req: FastifyRequest) {
    const id = idParam(ctx, req, 'id', 'Solicitation');
    return (await ctx.resources.find(PROCUREMENT, id, req.user)) ?? ctx.fail(404, 'not_found', 'Solicitation not found.');
  }
  app.get('/api/procurements/:id/clauses', { preHandler: ctx.requirePerm('procurement.view') }, async (req) => {
    const proc = await need(req);
    return getChecklist(ctx, CLAUSE_SET, proc.id);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/procurements/:id/clauses', tag: 'Procurement', permission: 'procurement.view',
    summary: 'The required-clauses checklist of a solicitation (the organization\'s clause template, Lists > Procurement clause)',
    response: '{ clause_key, label, description, status, clause_text, note, updated_at }[]',
  });
  app.put('/api/procurements/:id/clauses', { preHandler: ctx.requirePerm('procurement.edit') }, async (req) => {
    const proc = await need(req);
    const rows = body(req).checks;
    if (!Array.isArray(rows)) invalid(ctx, { checks: 'Give a list of clause checks.' });
    return saveChecklist(ctx, CLAUSE_SET, proc.id, '', rows, req);
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/procurements/:id/clauses', tag: 'Procurement', permission: 'procurement.edit',
    summary: 'Record whether each required clause is in the solicitation and the resulting contract',
    body: '{ checks: { clause_key, status?, clause_text?, note? }[] }', response: '{ changed, checklist }',
  });
}
