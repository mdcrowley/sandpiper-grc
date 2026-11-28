// Budgets (E46): a budget per fiscal year with its operating and capital lines (department, account,
// amount; capital lines can name a project). Committed is the part of approved, issued and received
// purchase orders charged to a line that is not yet paid; spent is what paid invoices charged to it
// (E46-66); remaining is the rest. These are figures: the same for every viewer. Once a budget is adopted
// its line amounts change only through an amendment (E46-67, versions.ts).
import type { FastifyRequest } from 'fastify';
import { routePattern } from '../../core/api/versioning.ts';
import { dataLoadFor, isDataLoad } from '../../core/dataload.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { COMMITTING } from './lists.ts';
import { cents, day, idParam, invalid, num } from './shared.ts';

export const BUDGET = 'budget';
export const BUDGET_LINE = 'budget_line';

/** Paid per purchase order line: the lines of paid invoices (E46-66). */
export const PAID_SQL = `
  select il.po_line_id, sum(il.amount) as paid from purchase_invoice_lines il
  join purchase_invoices i on i.id = il.invoice_id and i.deleted_at is null and i.status = 'paid'
  where il.deleted_at is null group by il.po_line_id`;

/**
 * SQL giving committed and spent per budget line id (every order counted, `$1` the committing statuses).
 * Spent is what paid invoices charged to the line; committed is what committing orders have not yet paid.
 */
export const LINE_FIGURES_SQL = `
  select l.budget_line_id as id,
         sum(case when p.status = any($1::text[]) then greatest(l.amount - coalesce(pd.paid, 0), 0) else 0 end) as committed,
         sum(coalesce(pd.paid, 0)) as spent
  from purchase_order_lines l join purchase_orders p on p.id = l.purchase_order_id and p.deleted_at is null
  left join (${PAID_SQL}) pd on pd.po_line_id = l.id
  where l.deleted_at is null and l.budget_line_id is not null group by l.budget_line_id`;

/** The amount of each line in a budget's adopted version (version 0), by line id. */
export const ADOPTED_SQL = `
  select vl.budget_line_id as id, vl.amount_after as adopted from budget_version_lines vl
  join budget_versions v on v.id = vl.version_id and v.deleted_at is null and v.version_no = 0`;

export interface LineFigures { amount: number; committed: number; spent: number; remaining: number; used_pct: number | null }

export const figuresOf = (amount: number, committed: number, spent: number): LineFigures => ({
  amount: cents(amount), committed: cents(committed), spent: cents(spent), remaining: cents(amount - committed - spent),
  used_pct: amount > 0 ? Math.round(((committed + spent) / amount) * 1000) / 10 : null,
});

/** Budgets in force today: adopted or amended (`meta.current`), and today within their dates when they have them. */
export async function currentBudgetIds(ctx: ModuleContext): Promise<string[]> {
  const current = (await ctx.lookups.values('budget_status')).filter((v) => (v.meta as Row | undefined)?.current === true).map((v) => v.value);
  const rows = await ctx.db.query<Row>(
    `select id from budgets where deleted_at is null and status = any($1::text[])
       and (starts_on is null or starts_on <= $2::date) and (ends_on is null or ends_on >= $2::date)`, [current.length ? current : ['adopted', 'amended'], todayInZone()]);
  return rows.map((r) => r.id);
}

/** Totals of some budgets (every line, every order). */
export async function budgetTotals(ctx: ModuleContext, budgetIds: string[]): Promise<LineFigures> {
  if (!budgetIds.length) return figuresOf(0, 0, 0);
  const r = await ctx.db.one<Row>(
    `with f as (${LINE_FIGURES_SQL})
     select coalesce(sum(b.amount), 0) as amount, coalesce(sum(f.committed), 0) as committed, coalesce(sum(f.spent), 0) as spent
     from budget_lines b left join f on f.id = b.id where b.deleted_at is null and b.budget_id = any($2::uuid[])`, [COMMITTING, budgetIds]);
  return figuresOf(num(r?.amount), num(r?.committed), num(r?.spent));
}

/** Whether a budget has been adopted (has a version): its line amounts then change only by amendment. */
export async function hasVersions(ctx: ModuleContext, budgetId: unknown): Promise<boolean> {
  if (!budgetId) return false;
  return Boolean(await ctx.db.one('select 1 from budget_versions where budget_id = $1 and deleted_at is null limit 1', [budgetId]));
}

/** Statuses only a budget version gives (adopted, amended). */
const VERSION_STATUSES = ['adopted', 'amended'];

export function registerBudgets(ctx: ModuleContext) {
  const { app, db } = ctx;

  async function budgetRules(req: FastifyRequest | null, existing: Row | null, patch: Row): Promise<Row> {
    const m = { ...(existing ?? {}), ...patch };
    if (m.starts_on && m.ends_on && day(m.ends_on)! < day(m.starts_on)!) invalid(ctx, { ends_on: 'The year cannot end before it starts.' });
    // Adopted and Amended come from recording the adoption or an amendment (a data load records them as they were).
    if (req && !isDataLoad(req) && 'status' in patch && patch.status !== (existing?.status ?? null) && VERSION_STATUSES.includes(String(patch.status))) {
      invalid(ctx, { status: 'Record the adoption or an amendment on the budget\'s Versions tab: the status follows it.' });
    }
    return patch;
  }

  ctx.defineResource({
    type: BUDGET, table: 'budgets', module: 'procurement', label: 'Budget', plural: 'Budgets',
    path: '/api/budgets', route: '/procurement/budgets', titleField: 'name',
    ref: { field: 'ref', prefix: 'BUD-' },
    searchable: ['name', 'fiscal_year', 'notes'],
    defaultSort: { field: 'starts_on', dir: 'desc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      name: { label: 'Name', type: 'text', required: true, help: 'For example "Operating and capital budget 2027".' },
      fiscal_year: { label: 'Fiscal year', type: 'text', required: true, personal: false, help: 'The organization\'s own name for the year, for example "FY 2027" or "2026-27".' },
      starts_on: { label: 'Year starts', type: 'date' },
      ends_on: { label: 'Year ends', type: 'date' },
      status: { label: 'Status', type: 'lookup', list: 'budget_status', default: 'draft', help: 'Adopted and Amended follow the budget\'s versions: record the adoption, then each amendment.' },
      owner_id: { label: 'Owner', type: 'user' },
      notes: { label: 'Notes', type: 'longtext' },
    },
    hooks: {
      beforeCreate: (req, data) => budgetRules(req, null, data),
      beforeUpdate: (req, existing, patch) => budgetRules(req, existing, patch),
    },
  });

  async function lineRules(req: FastifyRequest | null, existing: Row | null, patch: Row): Promise<Row> {
    const merged = { ...(existing ?? {}), ...patch };
    const errors: Record<string, string> = {};
    if (merged.amount !== null && merged.amount !== undefined && Number(merged.amount) < 0) errors.amount = 'Give an amount of zero or more.';
    if (merged.project_id && (merged.kind ?? 'operating') !== 'capital') errors.project_id = 'Only a capital line names a project.';
    // E46-67: once adopted, amounts change (and lines are added) only through an amendment, which keeps
    // the earlier amounts as a version. System work (the amendment itself) passes no request.
    if (req && await hasVersions(ctx, merged.budget_id)) {
      if (!existing) errors.budget_id = 'The budget is adopted: add the line with an amendment.';
      else if ('amount' in patch && num(patch.amount) !== num(existing.amount)) errors.amount = 'The budget is adopted: change the amount with an amendment.';
      else if ('budget_id' in patch && patch.budget_id !== existing.budget_id) errors.budget_id = 'A line of an adopted budget stays in it.';
    }
    if (Object.keys(errors).length) invalid(ctx, errors);
    return patch;
  }

  ctx.defineResource({
    type: BUDGET_LINE, table: 'budget_lines', module: 'procurement', label: 'Budget line', plural: 'Budget lines',
    path: '/api/budget-lines', route: '/procurement/budget-lines', titleField: 'title',
    ref: { field: 'ref', prefix: 'BL-' },
    scope: { department: 'department_id' },
    searchable: ['title', 'account', 'notes'],
    defaultSort: { field: 'account', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      budget_id: { label: 'Budget', type: 'ref', to: BUDGET, required: true },
      title: { label: 'Line', type: 'text', required: true, personal: false, help: 'What the money is for, for example "Bus parts" or "Depot roof replacement".' },
      kind: { label: 'Operating or capital', type: 'lookup', list: 'budget_kind', default: 'operating' },
      department_id: { label: 'Department', type: 'ref', to: 'department' },
      account: { label: 'Account', type: 'text', personal: false, help: 'The account or cost code in the finance system.' },
      amount: { label: 'Budgeted', type: 'currency', required: true, help: 'The amount in the current version. Once the budget is adopted it changes only through an amendment.' },
      project_id: { label: 'Project', type: 'ref', to: 'project', help: 'Capital lines: the project the money is for.' },
      funding_award_id: { label: 'Funding award', type: 'ref', to: 'funding_award', help: 'The grant or other award that pays for this line, if any.' },
      notes: { label: 'Notes', type: 'longtext', personal: false },
    },
    hooks: {
      beforeCreate: (req, data) => lineRules(req, null, data),
      beforeUpdate: (req, existing, patch) => lineRules(req, existing, patch),
    },
  });

  // A line of an adopted budget is not deleted (outside a data load): an amendment sets it to zero.
  app.addHook('preHandler', async (req) => {
    if (req.method !== 'DELETE' || routePattern(req) !== '/api/budget-lines/:id') return;
    const id = String((req.params as Row)?.id ?? '');
    if (!UUID_RE.test(id)) return;
    const line = await db.one<Row>('select budget_id from budget_lines where id = $1 and deleted_at is null', [id]);
    if (line && await hasVersions(ctx, line.budget_id) && !(await dataLoadFor(db, req))) {
      ctx.fail(409, 'adopted', 'The budget is adopted: set the line to zero with an amendment instead.');
    }
  });

  // ---------- figures ----------

  app.get('/api/budgets/:id/figures', { preHandler: ctx.requirePerm('procurement.view') }, async (req) => {
    const id = idParam(ctx, req, 'id', 'Budget');
    const budget = (await ctx.resources.find(BUDGET, id, req.user)) ?? ctx.fail(404, 'not_found', 'Budget not found.');
    const totals = await budgetTotals(ctx, [budget.id]);
    const adopted = await db.one<Row>(
      `select v.total_after from budget_versions v where v.budget_id = $1 and v.deleted_at is null and v.version_no = 0`, [budget.id]);
    const byKind = await db.query<Row>(
      `with f as (${LINE_FIGURES_SQL})
       select coalesce(b.kind, 'operating') as kind, coalesce(sum(b.amount), 0) as amount, coalesce(sum(f.committed), 0) as committed, coalesce(sum(f.spent), 0) as spent
       from budget_lines b left join f on f.id = b.id where b.deleted_at is null and b.budget_id = $2 group by 1 order by 1`, [COMMITTING, budget.id]);
    // The lines the reader may open (scope by department), each with its own figures.
    const lines = await db.query<Row>(
      `with f as (${LINE_FIGURES_SQL}), a as (${ADOPTED_SQL})
       select b.id, b.ref, b.title, b.kind, b.account, b.amount, b.department_id, d.name as department, b.project_id, a.adopted,
              coalesce(f.committed, 0) as committed, coalesce(f.spent, 0) as spent
       from budget_lines b left join f on f.id = b.id left join a on a.id = b.id left join departments d on d.id = b.department_id
       where b.deleted_at is null and b.budget_id = $2 and ${ctx.resources.visibleWhere(BUDGET_LINE, req.user, 'b')}
       order by b.kind, b.account nulls last, b.title`, [COMMITTING, budget.id]);
    const all = await db.one<Row>('select count(*)::int as n from budget_lines where budget_id = $1 and deleted_at is null', [budget.id]);
    return {
      totals: { ...totals, adopted: adopted ? cents(num(adopted.total_after)) : null },
      by_kind: byKind.map((k) => ({ kind: k.kind, ...figuresOf(num(k.amount), num(k.committed), num(k.spent)) })),
      lines: lines.map((l) => ({
        id: l.id, ref: l.ref, title: l.title, kind: l.kind, account: l.account, department_id: l.department_id, department: l.department ?? null,
        project_id: l.project_id, adopted: l.adopted === null || l.adopted === undefined ? null : cents(num(l.adopted)),
        ...figuresOf(num(l.amount), num(l.committed), num(l.spent)),
      })),
      hidden_lines: Number(all?.n ?? 0) - lines.length,
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/budgets/:id/figures', tag: 'Procurement', permission: 'procurement.view',
    summary: 'Budget against committed and spent (paid invoices): totals with the adopted amount and by operating or capital (the same for everyone), and each line the reader may open',
    response: '{ totals: { amount, adopted, committed, spent, remaining, used_pct }, by_kind: [...], lines: [{ id, ref, title, kind, account, department, project_id, adopted, amount, committed, spent, remaining, used_pct }], hidden_lines }',
  });

  app.get('/api/budget-lines/:id/figures', { preHandler: ctx.requirePerm('procurement.view') }, async (req) => {
    const id = idParam(ctx, req, 'id', 'Budget line');
    const line = (await ctx.resources.find(BUDGET_LINE, id, req.user)) ?? ctx.fail(404, 'not_found', 'Budget line not found.');
    const f = await db.one<Row>(`with f as (${LINE_FIGURES_SQL}) select committed, spent from f where id = $2`, [COMMITTING, line.id]);
    const orders = await db.query<Row>(
      `select p.id, p.ref, p.title, p.status, p.vendor_name, p.order_date::text as order_date, sum(l.amount) as amount,
              sum(l.received_quantity * l.unit_price) as received, sum(coalesce(pd.paid, 0)) as paid
       from purchase_order_lines l join purchase_orders p on p.id = l.purchase_order_id and p.deleted_at is null
       left join (${PAID_SQL}) pd on pd.po_line_id = l.id
       where l.budget_line_id = $1 and l.deleted_at is null and ${ctx.resources.visibleWhere('purchase_order', req.user, 'p')}
       group by p.id order by p.order_date desc nulls last limit 200`, [line.id]);
    return {
      ...figuresOf(num(line.amount), num(f?.committed), num(f?.spent)),
      orders: orders.map((o) => ({ ...o, amount: cents(num(o.amount)), received: cents(num(o.received)), paid: cents(num(o.paid)) })),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/budget-lines/:id/figures', tag: 'Procurement', permission: 'procurement.view',
    summary: 'One budget line: amount, committed, spent (paid invoices), remaining, and the purchase orders charged to it that the reader may open',
    response: '{ amount, committed, spent, remaining, used_pct, orders: { id, ref, title, status, vendor_name, order_date, amount, received, paid }[] }',
  });
}
