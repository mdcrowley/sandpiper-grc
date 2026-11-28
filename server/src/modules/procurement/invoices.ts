// Vendor invoices against purchase orders (E46-66): the vendor's invoice number and date, its lines (a
// quantity at a price, or an amount) against the order's lines, the three-way match with the order and what
// was received, approval (an approval workflow when one applies, otherwise someone holding
// procurement.approve who did not enter the invoice; an invoice that does not match needs a written
// reason), the payment (date, reference, method) and voiding. Paid invoices are what a budget line has
// spent. The status is the application's: it moves only through these steps, except in a data load, which
// records past invoices as they were.
import type { FastifyRequest } from 'fastify';
import { approvalEngine, defineApprovalKind } from '../../core/approval-kinds.ts';
import { routePattern } from '../../core/api/versioning.ts';
import { actorOf, dataLoadFor, isDataLoad } from '../../core/dataload.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { PAID_SQL } from './budgets.ts';
import { PO, PO_LINE } from './orders.ts';
import { body, cents, cleanText, day, idParam, invalid, isDate, isInstant, num } from './shared.ts';

export const INVOICE = 'purchase_invoice';
export const INVOICE_LINE = 'purchase_invoice_line';
export const INVOICE_KIND = 'purchase_invoice_approval';
export const TOLERANCE_KEY = 'procurement.invoice_tolerance_pct';

/** Order statuses an invoice can be entered against: sent to the vendor. */
const INVOICEABLE = ['issued', 'partially_received', 'received', 'closed'];
/** Invoices counted against what was received (entered drafts are not yet). */
const COUNTED = ['pending_approval', 'approved', 'paid'];
/** Invoice statuses whose match is worked out again when something changes. */
const OPEN = ['draft', 'pending_approval'];
/** Fields of an invoice that may change after it is sent for approval. */
const LATE_FIELDS = ['notes', 'due_on'];

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyText = (n: number) => String(Math.round(n * 1000) / 1000);

/** The match tolerance as a fraction (the setting is a percentage, 0 as installed). */
export async function tolerance(ctx: ModuleContext): Promise<number> {
  const v = Number(await ctx.settings.get(TOLERANCE_KEY, 0));
  return Number.isFinite(v) && v > 0 ? Math.min(v, 100) / 100 : 0;
}

export interface LineMatch { id: string; status: 'matched' | 'exception'; note: string | null }

/**
 * The three-way match of one invoice: each line against its order line (the price ordered) and what was
 * received (the quantity and value), counting what other invoices sent for approval or paid already bill.
 * Stores the result on the lines and the invoice, with the invoice's amount.
 */
export async function matchInvoice(ctx: ModuleContext, invoiceId: string): Promise<{ status: string; note: string | null; lines: LineMatch[] }> {
  const { db } = ctx;
  const tol = await tolerance(ctx);
  const lines = await db.query<Row>(
    `select il.id, il.quantity, il.unit_price, il.amount, l.line_no, l.quantity as po_qty, l.unit_price as po_price, l.received_quantity,
            coalesce((select sum(o.quantity) from purchase_invoice_lines o join purchase_invoices oi on oi.id = o.invoice_id and oi.deleted_at is null and oi.status = any($2::text[])
                      where o.po_line_id = il.po_line_id and o.deleted_at is null and o.invoice_id <> il.invoice_id), 0) as other_qty,
            coalesce((select sum(o.amount) from purchase_invoice_lines o join purchase_invoices oi on oi.id = o.invoice_id and oi.deleted_at is null and oi.status = any($2::text[])
                      where o.po_line_id = il.po_line_id and o.deleted_at is null and o.invoice_id <> il.invoice_id), 0) as other_amount
     from purchase_invoice_lines il join purchase_order_lines l on l.id = il.po_line_id
     where il.invoice_id = $1 and il.deleted_at is null order by l.line_no, il.created_at`, [invoiceId, COUNTED]);
  const out: LineMatch[] = [];
  const notes: string[] = [];
  for (const l of lines) {
    const issues: string[] = [];
    const received = num(l.received_quantity);
    const price = num(l.po_price);
    const amount = num(l.amount);
    if (l.quantity !== null && l.quantity !== undefined) {
      const qty = num(l.quantity);
      const total = num(l.other_qty) + qty;
      if (total > received + 1e-9) issues.push(`${qtyText(total)} invoiced, ${qtyText(received)} received`);
      const billed = l.unit_price !== null && l.unit_price !== undefined ? num(l.unit_price) : qty ? amount / qty : 0;
      if (billed > price * (1 + tol) + 0.005) issues.push(`price ${fmt(billed)} above the order's ${fmt(price)}`);
    }
    const value = received * price;
    const billedTotal = num(l.other_amount) + amount;
    if (!issues.length && billedTotal > value * (1 + tol) + 0.005) issues.push(`${fmt(billedTotal)} invoiced against ${fmt(value)} received`);
    const note = issues.length ? issues.join('; ') : null;
    if (note) notes.push(`Line ${l.line_no}: ${note}`);
    out.push({ id: l.id, status: issues.length ? 'exception' : 'matched', note });
  }
  for (const m of out) await db.query('update purchase_invoice_lines set match_status = $2, match_note = $3 where id = $1', [m.id, m.status, m.note]);
  const status = !lines.length ? 'no_lines' : notes.length ? 'exception' : 'matched';
  const note = notes.length ? notes.join('. ').slice(0, 2000) : null;
  await db.query(
    `update purchase_invoices i set match_status = $2, match_note = $3,
            amount = coalesce((select sum(l.amount) from purchase_invoice_lines l where l.invoice_id = i.id and l.deleted_at is null), 0)
     where i.id = $1`, [invoiceId, status, note]);
  return { status, note, lines: out };
}

/** Works out the match again for the open invoices of an order (after receipts, or another invoice moved). */
export async function rematchOrder(ctx: ModuleContext, poId: string): Promise<void> {
  const rows = await ctx.db.query<Row>('select id from purchase_invoices where purchase_order_id = $1 and deleted_at is null and status = any($2::text[])', [poId, OPEN]);
  for (const r of rows) await matchInvoice(ctx, r.id);
}

export function registerInvoices(ctx: ModuleContext) {
  const { app, db } = ctx;
  const engine = () => approvalEngine(app);

  const normal = (v: unknown) => String(v ?? '').trim().toUpperCase().replace(/\s+/g, ' ');

  async function invoiceRules(req: FastifyRequest | null, existing: Row | null, patch: Row): Promise<Row> {
    const merged = { ...(existing ?? {}), ...patch };
    const errors: Record<string, string> = {};
    const load = isDataLoad(req);
    const today = todayInZone();
    if (existing) {
      if (patch.purchase_order_id && patch.purchase_order_id !== existing.purchase_order_id) errors.purchase_order_id = 'An invoice stays on its order.';
      if (req && !load && existing.status !== 'draft') {
        for (const f of Object.keys(patch)) {
          if (!LATE_FIELDS.includes(f) && f in (ctx.resources.get(INVOICE)?.fields ?? {}) && String(patch[f] ?? '') !== String(existing[f] ?? '')) {
            errors[f] = 'The invoice was sent for approval: it stays as entered (only its notes and due date change).';
          }
        }
      }
    } else {
      const po = UUID_RE.test(String(merged.purchase_order_id ?? ''))
        ? (req ? await ctx.resources.find(PO, String(merged.purchase_order_id), req.user) : await db.one<Row>('select * from purchase_orders where id = $1 and deleted_at is null', [merged.purchase_order_id]))
        : undefined;
      if (!po) invalid(ctx, { purchase_order_id: 'Choose the purchase order the invoice is for.' });
      if (!load && !INVOICEABLE.includes(po!.status)) errors.purchase_order_id = `${po!.ref} must be issued to the vendor before its invoices are entered.`;
      patch.vendor_id = po!.vendor_id ?? null;
      patch.vendor_name = po!.vendor_name ?? null;
      patch.department_id = po!.department_id ?? null;
      if (!load || !patch.status) patch.status = 'draft';
      const actor = actorOf(req);
      if (!merged.entered_by) { patch.entered_by = actor.id; patch.entered_by_name = actor.name; }
      if (!merged.received_on) patch.received_on = load ? (day(merged.invoice_date) ?? null) : today;
    }
    const m = { ...merged, ...patch };
    if (!cleanText(m.invoice_number, 100)) errors.invoice_number = 'Give the vendor\'s invoice number.';
    if (!m.invoice_date) errors.invoice_date = 'Give the date on the invoice.';
    else if (!load && day(m.invoice_date)! > today) errors.invoice_date = 'The invoice date cannot be in the future.';
    if (m.due_on && m.invoice_date && day(m.due_on)! < day(m.invoice_date)!) errors.due_on = 'Payment cannot be due before the invoice date.';
    if (!errors.invoice_number && ('invoice_number' in patch || !existing)) {
      // The same vendor's invoice number entered twice is the usual way an invoice is paid twice.
      const dup = await db.one<Row>(
        `select ref from purchase_invoices where deleted_at is null and status <> 'voided' and id <> coalesce($4::uuid, '00000000-0000-0000-0000-000000000000')
           and upper(regexp_replace(trim(invoice_number), '\\s+', ' ', 'g')) = $1
           and (($2::uuid is not null and vendor_id = $2) or ($2::uuid is null and lower(coalesce(vendor_name, '')) = lower(coalesce($3, ''))))`,
        [normal(m.invoice_number), m.vendor_id ?? null, m.vendor_name ?? null, existing?.id ?? null]);
      if (dup) errors.invoice_number = `This vendor's invoice ${String(m.invoice_number).trim()} is already entered (${dup.ref}).`;
    }
    if (Object.keys(errors).length) invalid(ctx, errors);
    if ('invoice_number' in patch) patch.invoice_number = String(patch.invoice_number).trim();
    return patch;
  }

  ctx.defineResource({
    type: INVOICE, table: 'purchase_invoices', module: 'procurement', label: 'Invoice', plural: 'Invoices',
    path: '/api/purchase-invoices', route: '/procurement/invoices', titleField: 'invoice_number',
    ref: { field: 'ref', prefix: 'INV-' },
    scope: { department: 'department_id' },
    searchable: ['invoice_number', 'vendor_name', 'payment_reference', 'notes'],
    defaultSort: { field: 'invoice_date', dir: 'desc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      purchase_order_id: { label: 'Purchase order', type: 'ref', to: PO, required: true, help: 'The order the vendor invoices; it must have been issued.' },
      invoice_number: { label: 'Invoice number', type: 'text', required: true, personal: false, help: 'The vendor\'s own invoice number, as printed on the invoice.' },
      invoice_date: { label: 'Invoice date', type: 'date', required: true, help: 'The date on the invoice.' },
      received_on: { label: 'Received', type: 'date', help: 'When the invoice reached the organization (today when left empty).' },
      due_on: { label: 'Payment due', type: 'date' },
      vendor_id: { label: 'Vendor', type: 'ref', to: 'vendor', readOnly: true },
      vendor_name: { label: 'Vendor name', type: 'text', readOnly: true, personal: false },
      department_id: { label: 'Department', type: 'ref', to: 'department', readOnly: true },
      amount: { label: 'Amount', type: 'currency', readOnly: true },
      status: { label: 'Status', type: 'lookup', list: 'invoice_status', default: 'draft', readOnly: true },
      match_status: { label: 'Match', type: 'lookup', list: 'invoice_match', readOnly: true },
      match_note: { label: 'What does not match', type: 'text', readOnly: true, personal: false },
      entered_by: { label: 'Entered by', type: 'user', readOnly: true },
      entered_by_name: { label: 'Entered by (name)', type: 'text', readOnly: true, personal: true },
      submitted_at: { label: 'Sent for approval', type: 'datetime', readOnly: true },
      approved_by: { label: 'Approved by', type: 'user', readOnly: true },
      approved_by_name: { label: 'Approved by (name)', type: 'text', readOnly: true, personal: true },
      approved_at: { label: 'Approved', type: 'datetime', readOnly: true },
      approval_note: { label: 'Why approved although it does not match', type: 'text', readOnly: true, personal: false },
      rejected_reason: { label: 'Why last returned', type: 'text', readOnly: true, personal: false },
      paid_on: { label: 'Paid on', type: 'date', readOnly: true },
      payment_reference: { label: 'Payment reference', type: 'text', readOnly: true, personal: false },
      payment_method: { label: 'Paid by', type: 'lookup', list: 'payment_method', readOnly: true },
      paid_by: { label: 'Payment recorded by', type: 'user', readOnly: true },
      paid_by_name: { label: 'Payment recorded by (name)', type: 'text', readOnly: true, personal: true },
      voided_reason: { label: 'Why voided', type: 'text', readOnly: true, personal: false },
      notes: { label: 'Notes', type: 'longtext' },
    },
    hooks: {
      beforeCreate: (req, data) => invoiceRules(req, null, data),
      beforeUpdate: (req, existing, patch) => invoiceRules(req, existing, patch),
      afterCreate: async (_req, row) => { await matchInvoice(ctx, row.id); },
    },
  });

  async function lineRules(req: FastifyRequest | null, existing: Row | null, patch: Row): Promise<Row> {
    const merged = { ...(existing ?? {}), ...patch };
    const errors: Record<string, string> = {};
    const load = isDataLoad(req);
    const inv = UUID_RE.test(String(merged.invoice_id ?? ''))
      ? await db.one<Row>('select id, status, purchase_order_id from purchase_invoices where id = $1 and deleted_at is null', [merged.invoice_id]) : undefined;
    if (!inv) invalid(ctx, { invoice_id: 'Invoice not found.' });
    if (existing && patch.invoice_id && patch.invoice_id !== existing.invoice_id) errors.invoice_id = 'A line stays on its invoice.';
    if (!load && inv!.status !== 'draft') errors.invoice_id = 'The invoice was sent for approval: its lines stay as entered.';
    const pl = UUID_RE.test(String(merged.po_line_id ?? ''))
      ? await db.one<Row>('select id, purchase_order_id, unit_price, line_no from purchase_order_lines where id = $1 and deleted_at is null', [merged.po_line_id]) : undefined;
    if (!pl || pl.purchase_order_id !== inv!.purchase_order_id) errors.po_line_id = 'Choose a line of the invoice\'s purchase order.';
    const has = (k: string) => merged[k] !== undefined && merged[k] !== null && merged[k] !== '';
    const qty = has('quantity') ? Number(merged.quantity) : null;
    if (qty !== null && (!Number.isFinite(qty) || qty <= 0)) errors.quantity = 'Give a quantity above zero, or leave it empty and give the amount.';
    const price = has('unit_price') ? Number(merged.unit_price) : null;
    if (price !== null && (!Number.isFinite(price) || price < 0)) errors.unit_price = 'Give a price of zero or more.';
    if (Object.keys(errors).length) invalid(ctx, errors);
    const touched = ['quantity', 'unit_price', 'amount', 'po_line_id'].some((k) => k in patch) || !existing;
    if (touched) {
      if (qty !== null) {
        const p = price ?? num(pl!.unit_price);
        patch.unit_price = p;
        // An amount given with the quantity wins (rounding on the vendor's side); otherwise quantity times price.
        patch.amount = 'amount' in patch && has('amount') ? cents(Number(patch.amount)) : cents(qty * p);
      } else {
        if (!has('amount')) invalid(ctx, { amount: 'Give the quantity invoiced or the amount.' });
        patch.unit_price = null;
        patch.amount = cents(Number(merged.amount));
      }
      if (!Number.isFinite(Number(patch.amount)) || Number(patch.amount) < 0) invalid(ctx, { amount: 'Give an amount of zero or more.' });
    }
    return patch;
  }

  ctx.defineResource({
    type: INVOICE_LINE, table: 'purchase_invoice_lines', module: 'procurement', label: 'Invoice line', plural: 'Invoice lines',
    path: '/api/purchase-invoice-lines', route: '/procurement/invoice-lines', titleField: 'notes',
    searchable: ['notes'],
    defaultSort: { field: 'created_at', dir: 'asc' },
    fields: {
      invoice_id: { label: 'Invoice', type: 'ref', to: INVOICE, required: true },
      po_line_id: { label: 'Order line', type: 'ref', to: PO_LINE, required: true, help: 'The purchase order line this invoice line bills.' },
      quantity: { label: 'Quantity', type: 'number', help: 'The quantity invoiced; leave empty when the vendor bills an amount only (services).' },
      unit_price: { label: 'Unit price', type: 'currency', help: 'The price invoiced; the order line\'s price when left empty.' },
      amount: { label: 'Amount', type: 'currency', help: 'The amount invoiced; quantity times price when left empty.' },
      match_status: { label: 'Match', type: 'lookup', list: 'invoice_match', readOnly: true },
      match_note: { label: 'What does not match', type: 'text', readOnly: true, personal: false },
      notes: { label: 'Notes', type: 'text', personal: false },
    },
    hooks: {
      beforeCreate: (req, data) => lineRules(req, null, data),
      beforeUpdate: (req, existing, patch) => lineRules(req, existing, patch),
      afterCreate: async (_req, row) => { await matchInvoice(ctx, row.invoice_id); },
      afterUpdate: async (_req, _before, after) => { await matchInvoice(ctx, after.invoice_id); },
    },
  });
  ctx.resources.onChange?.(async (c) => {
    if (c.def.type === INVOICE_LINE && (c.action === 'delete' || c.action === 'purge') && c.row.invoice_id) await matchInvoice(ctx, c.row.invoice_id);
    if (c.def.type === INVOICE && (c.action === 'delete' || c.action === 'purge') && c.row.purchase_order_id) await rematchOrder(ctx, c.row.purchase_order_id);
  });
  // A line of an invoice sent for approval is not deleted (outside a data load).
  app.addHook('preHandler', async (req) => {
    if (req.method !== 'DELETE' || routePattern(req) !== '/api/purchase-invoice-lines/:id') return;
    const id = String((req.params as Row)?.id ?? '');
    if (!UUID_RE.test(id)) return;
    const inv = await db.one<Row>('select i.status from purchase_invoice_lines l join purchase_invoices i on i.id = l.invoice_id where l.id = $1', [id]);
    if (inv && inv.status !== 'draft' && !(await dataLoadFor(db, req))) ctx.fail(409, 'not_draft', 'The invoice was sent for approval: its lines stay as entered.');
  });

  // ---------- approval ----------

  async function approveNow(inv: Row, by: { id: string | null; name: string | null }, at: string, note: string | null, req: FastifyRequest | null) {
    await ctx.resources.update(INVOICE, inv.id, { status: 'approved', approved_by: by.id, approved_by_name: by.name, approved_at: at, approval_note: note }, null);
    await ctx.audit(req, {
      action: 'purchase_invoice.approve', recordType: INVOICE, recordId: inv.id,
      summary: `${inv.ref} (invoice ${inv.invoice_number}) approved for payment by ${by.name ?? 'an approver'}${note ? ` although it does not match: ${note}` : ''}`,
      before: { status: inv.status }, after: { status: 'approved', approved_by: by.name, approval_note: note },
    });
  }
  async function backToDraft(inv: Row, why: string, req: FastifyRequest | null) {
    await ctx.resources.update(INVOICE, inv.id, { status: 'draft', submitted_at: null, rejected_reason: why.slice(0, 500) }, null);
    await ctx.audit(req, {
      action: 'purchase_invoice.reject', recordType: INVOICE, recordId: inv.id, summary: `${inv.ref} returned: ${why}`,
      before: { status: inv.status }, after: { status: 'draft', reason: why },
    });
    await rematchOrder(ctx, inv.purchase_order_id);
    if (app.hasDecorator('notify') && inv.entered_by) {
      await app.notify({ userIds: [inv.entered_by], kind: 'approval', recordType: INVOICE, recordId: inv.id, title: `Invoice ${inv.invoice_number} (${inv.ref}) was not approved`, body: why });
    }
  }

  defineApprovalKind(app, {
    key: INVOICE_KIND, recordType: INVOICE, label: 'Invoice approval',
    startsWhen: 'A vendor invoice is sent for approval',
    outcome: 'Approved: the invoice is approved for payment, with the approver\'s name and the time; rejected: it goes back to Entered with the reason',
    approverPermission: 'procurement.view',
    route: (id) => `/procurement/invoices/${id}`,
    tellsRequester: false,
    async onFinish(e) {
      const inv = await db.one<Row>('select * from purchase_invoices where id = $1 and deleted_at is null', [e.instance.recordId]);
      if (!inv || inv.status !== 'pending_approval') return;
      if (e.outcome === 'approved') {
        await approveNow(inv, { id: e.onBehalfOf ?? e.approverId, name: e.onBehalfOfName ?? e.approverName }, new Date().toISOString(),
          inv.match_status === 'exception' ? (e.comment ?? 'approved in the approval workflow') : null, e.req);
      } else if (e.outcome === 'rejected') await backToDraft(inv, e.comment ?? 'rejected in the approval workflow', e.req);
      else if (!e.byModule) await backToDraft(inv, e.comment ?? 'the approval workflow was canceled', e.req);
    },
  });

  async function need(req: FastifyRequest): Promise<Row> {
    const id = idParam(ctx, req, 'id', 'Invoice');
    return (await ctx.resources.find(INVOICE, id, req.user)) ?? ctx.fail(404, 'not_found', 'Invoice not found.');
  }
  const fresh = async (id: string, req: FastifyRequest) => (await ctx.resources.find(INVOICE, id, req.user))!;

  async function mayDecide(inv: Row, userId: string): Promise<{ workflow: boolean; may: boolean }> {
    const eng = engine();
    const running = eng ? await eng.running(INVOICE_KIND, inv.id) : null;
    if (running) return { workflow: true, may: (await eng!.progress(INVOICE_KIND, inv.id, userId)).canDecide };
    return { workflow: false, may: inv.entered_by !== userId };
  }

  app.get('/api/purchase-invoices/:id/approval', { preHandler: ctx.requirePerm('procurement.view') }, async (req) => {
    const inv = await need(req);
    const eng = engine();
    const latest = eng ? await eng.latest(INVOICE_KIND, inv.id) : null;
    const d = inv.status === 'pending_approval' ? await mayDecide(inv, req.user!.id) : { workflow: Boolean(latest && latest.status === 'running'), may: false };
    const canApprove = d.workflow ? d.may : d.may && ctx.can(req.user, 'procurement.approve');
    return { status: inv.status, match_status: inv.match_status, workflow: latest ? { name: latest.name, status: latest.status } : null, can_decide: inv.status === 'pending_approval' && canApprove };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/purchase-invoices/:id/approval', tag: 'Procurement', permission: 'procurement.view',
    summary: 'Where an invoice\'s approval stands and whether the reader may decide it (procurement.approve when no workflow applies)',
    response: '{ status, match_status, workflow: { name, status } | null, can_decide }',
  });

  app.post('/api/purchase-invoices/:id/submit', { preHandler: ctx.requirePerm('procurement.edit') }, async (req, reply) => {
    const inv = await need(req);
    if (inv.status !== 'draft') ctx.fail(409, 'not_draft', `${inv.ref} was already sent for approval.`);
    const n = await db.one<Row>('select count(*)::int as n from purchase_invoice_lines where invoice_id = $1 and deleted_at is null', [inv.id]);
    if (!Number(n?.n)) invalid(ctx, { lines: 'Add at least one line before sending the invoice for approval.' });
    const m = await matchInvoice(ctx, inv.id);
    const at = new Date().toISOString();
    await ctx.resources.update(INVOICE, inv.id, { status: 'pending_approval', submitted_at: at }, null);
    await rematchOrder(ctx, inv.purchase_order_id);
    await ctx.audit(req, {
      action: 'purchase_invoice.submit', recordType: INVOICE, recordId: inv.id,
      summary: `${inv.ref} (invoice ${inv.invoice_number}, ${fmt(num(inv.amount))}) sent for approval${m.status === 'exception' ? `; does not match: ${m.note}` : ''}`,
      before: { status: 'draft' }, after: { status: 'pending_approval', match_status: m.status },
    });
    const eng = engine();
    const started = eng ? await eng.start(INVOICE_KIND, { ...inv, status: 'pending_approval', match_status: m.status }, { requester: actorOf(req).id ?? req.user!.id, req, note: cleanText(body(req).note, 2000) }) : null;
    if (!started && app.hasDecorator('notify')) {
      const approvers = (await db.query<Row>(
        `select distinct ur.user_id from user_roles ur join role_permissions rp on rp.role_id = ur.role_id join roles r on r.id = ur.role_id and r.enabled
         where rp.permission in ('*', 'procurement.*', 'procurement.approve')`)).map((r) => r.user_id).filter((u) => u !== inv.entered_by);
      await app.notify({
        userIds: approvers, kind: 'approval', recordType: INVOICE, recordId: inv.id,
        title: `Invoice to approve: ${inv.invoice_number} from ${inv.vendor_name ?? 'a vendor'}`,
        body: `${inv.ref} · ${fmt(num(inv.amount))}${m.status === 'exception' ? ' · does not match the order and receipts' : ''}`,
      });
    }
    reply.code(started ? 202 : 200);
    return { ...(await fresh(inv.id, req)), workflow: started ? started.name : null };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/purchase-invoices/:id/submit', tag: 'Procurement', permission: 'procurement.edit',
    summary: 'Send an entered invoice for approval (its match is worked out again): through the invoice approval workflow when one applies, otherwise to the people who hold procurement.approve',
    body: '{ note? }', response: 'the invoice, with workflow (its name) when one started',
  });

  app.post('/api/purchase-invoices/:id/decision', { preHandler: ctx.requirePerm('procurement.view') }, async (req) => {
    let inv = await need(req);
    if (inv.status !== 'pending_approval') ctx.fail(409, 'not_pending', `${inv.ref} is not waiting for approval.`);
    const b = body(req);
    if (!['approved', 'rejected'].includes(b.decision)) invalid(ctx, { decision: 'Approve or reject.' });
    const comment = cleanText(b.comment, 2000);
    if (b.decision === 'rejected' && !comment) invalid(ctx, { comment: 'Say why it is not approved.' });
    const m = await matchInvoice(ctx, inv.id);
    inv = await fresh(inv.id, req);
    // An invoice that bills more than was received, or above the order's price, is paid only with a reason.
    if (b.decision === 'approved' && m.status === 'exception' && !comment) {
      invalid(ctx, { comment: `The invoice does not match the order and what was received (${m.note}): say why it is approved anyway.` });
    }
    const actor = actorOf(req);
    if (!actor.id) invalid(ctx, { on_behalf_of: 'Name an approver who has an account.' });
    const eng = engine();
    if (eng && await eng.running(INVOICE_KIND, inv.id)) {
      await eng.decide(INVOICE_KIND, inv.id, req, b.decision, comment);
      return fresh(inv.id, req);
    }
    if (!ctx.can(req.user, 'procurement.approve')) ctx.fail(403, 'forbidden', 'Approving invoices needs permission to approve in procurement.');
    // Separation of duties: the person who entered the invoice does not approve it.
    if (actor.id === inv.entered_by) ctx.fail(403, 'own_entry', 'You entered this invoice: someone else approves it.');
    if (b.decision === 'approved') {
      const load = await dataLoadFor(db, req);
      const at = load && isInstant(b.approved_at) ? new Date(b.approved_at).toISOString() : new Date().toISOString();
      await approveNow(inv, actor, at, m.status === 'exception' ? comment : null, req);
      if (app.hasDecorator('notify') && inv.entered_by) {
        await app.notify({ userIds: [inv.entered_by], kind: 'approval', recordType: INVOICE, recordId: inv.id, title: `Invoice ${inv.invoice_number} (${inv.ref}) was approved`, body: comment ?? 'It can now be paid.' });
      }
    } else await backToDraft(inv, `${comment} (${actor.name ?? 'an approver'})`, req);
    return fresh(inv.id, req);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/purchase-invoices/:id/decision', tag: 'Procurement', permission: 'procurement.approve',
    summary: 'Approve an invoice for payment or return it (a workflow approver decides their step; without a workflow, procurement.approve and not the person who entered it). An invoice that does not match needs a comment to be approved. approved_at in a data load',
    body: '{ decision: "approved" | "rejected", comment?, approved_at? }', response: 'the invoice',
  });

  app.post('/api/purchase-invoices/:id/payment', { preHandler: ctx.requirePerm('procurement.edit') }, async (req) => {
    const inv = await need(req);
    if (inv.status !== 'approved') ctx.fail(409, 'not_approved', `${inv.ref} must be approved for payment first.`);
    const b = body(req);
    const load = await dataLoadFor(db, req);
    const today = todayInZone();
    const on = isDate(b.paid_on) ? b.paid_on : today;
    const reference = cleanText(b.payment_reference, 100);
    const errors: Record<string, string> = {};
    if (!reference) errors.payment_reference = 'Give the payment reference (check number, transfer or batch reference).';
    if (!load && on > today) errors.paid_on = 'The payment date cannot be in the future.';
    if (on < day(inv.invoice_date)!) errors.paid_on = 'The payment cannot be before the invoice date.';
    const method = cleanText(b.payment_method, 50);
    if (method && !(await ctx.lookups.values('payment_method')).some((v) => v.value === method)) errors.payment_method = 'Choose a payment method from the list.';
    if (Object.keys(errors).length) invalid(ctx, errors);
    const actor = actorOf(req);
    await ctx.resources.update(INVOICE, inv.id, { status: 'paid', paid_on: on, payment_reference: reference, payment_method: method, paid_by: actor.id, paid_by_name: actor.name }, null);
    await ctx.audit(req, {
      action: 'purchase_invoice.pay', recordType: INVOICE, recordId: inv.id,
      summary: `${inv.ref} (invoice ${inv.invoice_number}, ${fmt(num(inv.amount))}) paid on ${on}, reference ${reference}`,
      before: { status: inv.status }, after: { status: 'paid', paid_on: on, payment_reference: reference, payment_method: method },
    });
    return fresh(inv.id, req);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/purchase-invoices/:id/payment', tag: 'Procurement', permission: 'procurement.edit',
    summary: 'Record the payment of an approved invoice: the date, the payment reference and the method. A paid invoice counts as spent on the budget lines of its order lines',
    body: '{ paid_on?, payment_reference, payment_method? }', response: 'the invoice',
  });

  app.post('/api/purchase-invoices/:id/void', { preHandler: ctx.requirePerm('procurement.edit') }, async (req) => {
    const inv = await need(req);
    if (!['draft', 'pending_approval', 'approved'].includes(inv.status)) ctx.fail(409, 'not_voidable', `${inv.ref} cannot be voided from its status.`);
    const reason = cleanText(body(req).reason, 300);
    if (!reason) invalid(ctx, { reason: 'Say why the invoice is voided (for example a duplicate, or replaced by a corrected invoice).' });
    const eng = engine();
    if (eng && inv.status === 'pending_approval') await eng.cancel(INVOICE_KIND, inv.id, `The invoice was voided: ${reason}`, req);
    await ctx.resources.update(INVOICE, inv.id, { status: 'voided', voided_reason: reason }, null);
    await ctx.audit(req, { action: 'purchase_invoice.void', recordType: INVOICE, recordId: inv.id, summary: `${inv.ref} (invoice ${inv.invoice_number}) voided: ${reason}`, before: { status: inv.status }, after: { status: 'voided', reason } });
    await rematchOrder(ctx, inv.purchase_order_id);
    return fresh(inv.id, req);
  });
  ctx.describeRoute({ method: 'POST', path: '/api/purchase-invoices/:id/void', tag: 'Procurement', permission: 'procurement.edit', summary: 'Void an invoice that is not paid (a running approval is canceled too)', body: '{ reason }', response: 'the invoice' });

  app.get('/api/purchase-invoices/:id/lines', { preHandler: ctx.requirePerm('procurement.view') }, async (req) => {
    const inv = await need(req);
    if (OPEN.includes(inv.status)) await matchInvoice(ctx, inv.id);
    const rows = await db.query<Row>(
      `select il.id, il.po_line_id, il.quantity, il.unit_price, il.amount, il.match_status, il.match_note, il.notes,
              l.line_no, l.description, l.quantity as ordered, l.unit_price as order_price, l.received_quantity
       from purchase_invoice_lines il join purchase_order_lines l on l.id = il.po_line_id
       where il.invoice_id = $1 and il.deleted_at is null order by l.line_no, il.created_at`, [inv.id]);
    return rows.map((r) => ({
      id: r.id, po_line_id: r.po_line_id, line_no: r.line_no, description: r.description,
      quantity: r.quantity === null ? null : num(r.quantity), unit_price: r.unit_price === null ? null : num(r.unit_price), amount: num(r.amount),
      ordered: num(r.ordered), order_price: num(r.order_price), received_quantity: num(r.received_quantity),
      match_status: r.match_status, match_note: r.match_note, notes: r.notes,
    }));
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/purchase-invoices/:id/lines', tag: 'Procurement', permission: 'procurement.view',
    summary: 'The lines of an invoice, each with its order line (ordered, price, received) and its match',
    response: '{ id, po_line_id, line_no, description, quantity, unit_price, amount, ordered, order_price, received_quantity, match_status, match_note, notes }[]',
  });

  // ---------- from the order ----------

  async function needOrder(req: FastifyRequest): Promise<Row> {
    const id = idParam(ctx, req, 'id', 'Purchase order');
    return (await ctx.resources.find(PO, id, req.user)) ?? ctx.fail(404, 'not_found', 'Purchase order not found.');
  }

  app.get('/api/purchase-orders/:id/invoices', { preHandler: ctx.requirePerm('procurement.view') }, async (req) => {
    const po = await needOrder(req);
    const invoices = await db.query<Row>(
      `select i.id, i.ref, i.invoice_number, i.invoice_date::text as invoice_date, i.due_on::text as due_on, i.amount, i.status, i.match_status, i.match_note,
              i.paid_on::text as paid_on, i.payment_reference
       from purchase_invoices i where i.purchase_order_id = $1 and i.deleted_at is null and ${ctx.resources.visibleWhere(INVOICE, req.user, 'i')}
       order by i.invoice_date, i.created_at`, [po.id]);
    // The three-way view of each order line: ordered, received, invoiced (sent for approval or later), paid.
    const lines = await db.query<Row>(
      `select l.id, l.line_no, l.description, l.quantity, l.unit_price, l.amount, l.received_quantity,
              coalesce(inv.qty, 0) as invoiced_quantity, coalesce(inv.amount, 0) as invoiced_amount, coalesce(pd.paid, 0) as paid
       from purchase_order_lines l
       left join (select o.po_line_id, sum(o.quantity) as qty, sum(o.amount) as amount from purchase_invoice_lines o
                  join purchase_invoices oi on oi.id = o.invoice_id and oi.deleted_at is null and oi.status = any($2::text[])
                  where o.deleted_at is null group by o.po_line_id) inv on inv.po_line_id = l.id
       left join (${PAID_SQL}) pd on pd.po_line_id = l.id
       where l.purchase_order_id = $1 and l.deleted_at is null order by l.line_no, l.created_at`, [po.id, COUNTED]);
    const out = lines.map((l) => ({
      id: l.id, line_no: l.line_no, description: l.description, quantity: num(l.quantity), unit_price: num(l.unit_price), amount: num(l.amount),
      received_quantity: num(l.received_quantity), received_value: cents(num(l.received_quantity) * num(l.unit_price)),
      invoiced_quantity: num(l.invoiced_quantity), invoiced_amount: cents(num(l.invoiced_amount)), paid: cents(num(l.paid)),
    }));
    const sum = (k: keyof typeof out[number]) => cents(out.reduce((s, l) => s + Number(l[k]), 0));
    return {
      invoices: invoices.map((i) => ({ ...i, amount: cents(num(i.amount)) })),
      lines: out,
      totals: { ordered: sum('amount'), received: sum('received_value'), invoiced: sum('invoiced_amount'), paid: sum('paid') },
      can_invoice: INVOICEABLE.includes(po.status),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/purchase-orders/:id/invoices', tag: 'Procurement', permission: 'procurement.view',
    summary: 'The invoices of a purchase order the reader may open, and each order line ordered, received, invoiced and paid (the three-way match)',
    response: '{ invoices: { id, ref, invoice_number, invoice_date, due_on, amount, status, match_status, match_note, paid_on, payment_reference }[], lines: { id, line_no, description, quantity, unit_price, amount, received_quantity, received_value, invoiced_quantity, invoiced_amount, paid }[], totals: { ordered, received, invoiced, paid }, can_invoice }',
  });

  app.post('/api/purchase-orders/:id/invoices', { preHandler: ctx.requirePerm('procurement.create') }, async (req, reply) => {
    const po = await needOrder(req);
    const b = body(req);
    const lines = Array.isArray(b.lines) ? (b.lines as Row[]) : [];
    const orderLines = await db.query<Row>('select id from purchase_order_lines where purchase_order_id = $1 and deleted_at is null', [po.id]);
    const has = (v: unknown) => v !== undefined && v !== null && v !== '';
    const wanted = lines.filter((l) => l && (has(l.quantity) && Number(l.quantity) !== 0 || has(l.amount) && Number(l.amount) !== 0));
    if (!wanted.length) invalid(ctx, { lines: 'Give the quantity or amount invoiced on at least one line.' });
    for (const l of wanted) if (!orderLines.some((o) => o.id === l.line_id)) invalid(ctx, { lines: 'Each line names a line of this order.' });
    const inv = await ctx.resources.create(INVOICE, {
      purchase_order_id: po.id, invoice_number: b.invoice_number, invoice_date: b.invoice_date, received_on: b.received_on ?? null,
      due_on: b.due_on ?? null, notes: cleanText(b.notes, 4000),
    }, req);
    try {
      for (const l of wanted) {
        await ctx.resources.create(INVOICE_LINE, {
          invoice_id: inv.id, po_line_id: l.line_id, quantity: has(l.quantity) ? Number(l.quantity) : null,
          unit_price: has(l.unit_price) ? Number(l.unit_price) : null, amount: has(l.amount) ? Number(l.amount) : null,
        }, req);
      }
    } catch (err) {
      if (ctx.resources.remove) await ctx.resources.remove(INVOICE, inv.id, req, { summary: '(a line of the new invoice was refused)' });
      throw err;
    }
    reply.code(201);
    return fresh(inv.id, req);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/purchase-orders/:id/invoices', tag: 'Procurement', permission: 'procurement.create',
    summary: 'Enter a vendor invoice against an issued order with its lines in one step (each line a quantity, or an amount, against an order line); its match is worked out',
    body: '{ invoice_number, invoice_date, received_on?, due_on?, notes?, lines: { line_id, quantity?, unit_price?, amount? }[] }', response: 'the invoice',
  });
}
