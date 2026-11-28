// Purchase orders (E46): the order and its lines, approval (through an approval workflow when one
// applies, otherwise by someone holding procurement.approve who did not ask for the order), issue,
// receiving, closing and canceling. The status is the application's: it moves only through these steps,
// except in a data load, which records past orders as they were.
import type { FastifyRequest } from 'fastify';
import { approvalEngine, defineApprovalKind } from '../../core/approval-kinds.ts';
import { routePattern } from '../../core/api/versioning.ts';
import { actorOf, dataLoadFor, isDataLoad } from '../../core/dataload.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { notePermission } from '../../core/permission-use.ts';
import { todayInZone } from '../../core/timezone.ts';
import { COMMITTING } from './lists.ts';
import { body, cents, cleanText, idParam, invalid, isDate, isInstant, num } from './shared.ts';

export const PO = 'purchase_order';
export const PO_LINE = 'purchase_order_line';
export const PO_KIND = 'purchase_order_approval';

/** Statuses in which the order can still be changed. */
const EDITABLE = ['draft'];

export async function recomputeTotal(ctx: ModuleContext, poId: string): Promise<number> {
  const r = await ctx.db.one<Row>(
    `update purchase_orders p set total = coalesce((select sum(l.amount) from purchase_order_lines l where l.purchase_order_id = p.id and l.deleted_at is null), 0)
     where p.id = $1 returning total`, [poId]);
  return num(r?.total);
}

export function registerOrders(ctx: ModuleContext) {
  const { app, db } = ctx;
  const engine = () => approvalEngine(app);
  notePermission('procurement.approve');

  async function poRules(req: FastifyRequest | null, existing: Row | null, patch: Row): Promise<Row> {
    const merged = { ...(existing ?? {}), ...patch };
    const errors: Record<string, string> = {};
    if (!merged.vendor_id && !String(merged.vendor_name ?? '').trim()) errors.vendor_name = 'Choose the vendor or write its name.';
    const load = isDataLoad(req);
    if (existing && !load && !EDITABLE.includes(existing.status)) {
      for (const f of ['vendor_id', 'vendor_name', 'budget_line_id']) {
        if (f in patch && (patch[f] ?? null) !== (existing[f] ?? null)) errors[f] = 'The order is no longer a draft: its vendor and budget line stay as approved.';
      }
    }
    if (Object.keys(errors).length) invalid(ctx, errors);
    if (patch.vendor_id && patch.vendor_id !== existing?.vendor_id && ctx.resources.get('vendor')) {
      const v = await db.one<Row>('select name from vendors where id = $1', [patch.vendor_id]);
      if (v) patch.vendor_name = v.name;
    }
    if (!existing) {
      if (!merged.order_date) patch.order_date = todayInZone();
      if (!merged.requested_by && req?.user) patch.requested_by = actorOf(req).id;
      if (!load || !patch.status) patch.status = load && patch.status ? patch.status : 'draft';
    }
    return patch;
  }

  ctx.defineResource({
    type: PO, table: 'purchase_orders', module: 'procurement', label: 'Purchase order', plural: 'Purchase orders',
    path: '/api/purchase-orders', route: '/procurement/purchase-orders', titleField: 'title',
    ref: { field: 'ref', prefix: 'PO-' },
    scope: { department: 'department_id' },
    searchable: ['title', 'vendor_name', 'notes'],
    defaultSort: { field: 'order_date', dir: 'desc' },
    fields: {
      ref: { label: 'Order number', type: 'text', readOnly: true },
      title: { label: 'What is ordered', type: 'text', required: true, help: 'A short description, for example "Replacement bus wash brushes".' },
      vendor_id: { label: 'Vendor', type: 'ref', to: 'vendor' },
      vendor_name: { label: 'Vendor name', type: 'text', personal: false, help: 'Filled in from the vendor; write it when the vendor has no record.' },
      order_date: { label: 'Order date', type: 'date' },
      status: { label: 'Status', type: 'lookup', list: 'po_status', default: 'draft', readOnly: true },
      total: { label: 'Total', type: 'currency', readOnly: true },
      department_id: { label: 'Department', type: 'ref', to: 'department' },
      requested_by: { label: 'Requested by', type: 'user' },
      procurement_id: { label: 'Solicitation', type: 'ref', to: 'procurement', help: 'The solicitation this order comes from, if any.' },
      contract_id: { label: 'Contract', type: 'ref', to: 'contract' },
      budget_line_id: { label: 'Budget line', type: 'ref', to: 'budget_line', help: 'The budget line new lines are charged to unless a line names another.' },
      needed_by: { label: 'Needed by', type: 'date' },
      submitted_at: { label: 'Sent for approval', type: 'datetime', readOnly: true },
      approved_by: { label: 'Approved by', type: 'user', readOnly: true },
      approved_by_name: { label: 'Approved by (name)', type: 'text', readOnly: true, personal: true },
      approved_at: { label: 'Approved', type: 'datetime', readOnly: true },
      issued_on: { label: 'Issued to the vendor', type: 'date', readOnly: true },
      received_on: { label: 'Fully received', type: 'date', readOnly: true },
      closed_on: { label: 'Closed', type: 'date', readOnly: true },
      canceled_reason: { label: 'Why canceled', type: 'text', readOnly: true, personal: false },
      notes: { label: 'Notes', type: 'longtext' },
    },
    hooks: {
      beforeCreate: (req, data) => poRules(req, null, data),
      beforeUpdate: (req, existing, patch) => poRules(req, existing, patch),
    },
  });

  async function lineRules(req: FastifyRequest | null, existing: Row | null, patch: Row): Promise<Row> {
    const merged = { ...(existing ?? {}), ...patch };
    const errors: Record<string, string> = {};
    const qty = Number(merged.quantity ?? 1);
    const price = Number(merged.unit_price ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) errors.quantity = 'Give a quantity above zero.';
    if (!Number.isFinite(price) || price < 0) errors.unit_price = 'Give a price of zero or more.';
    const po = await db.one<Row>('select id, status, budget_line_id from purchase_orders where id = $1 and deleted_at is null', [merged.purchase_order_id]);
    if (!po) errors.purchase_order_id = 'Purchase order not found.';
    const load = isDataLoad(req);
    if (po && !load) {
      if (!EDITABLE.includes(po.status)) {
        const money = ['quantity', 'unit_price', 'budget_line_id', 'description', 'purchase_order_id'].some((f) => f in patch && String(patch[f] ?? '') !== String(existing?.[f] ?? ''));
        if (!existing || money) errors.purchase_order_id = 'The order is no longer a draft: its lines stay as approved.';
      }
      if (existing && patch.purchase_order_id && patch.purchase_order_id !== existing.purchase_order_id) errors.purchase_order_id = 'A line stays on its order.';
    }
    if (Object.keys(errors).length) invalid(ctx, errors);
    patch.amount = cents(qty * price);
    if (!existing) {
      if (!merged.budget_line_id && po!.budget_line_id) patch.budget_line_id = po!.budget_line_id;
      if (!merged.line_no) {
        const n = await db.one<Row>('select coalesce(max(line_no), 0) + 1 as n from purchase_order_lines where purchase_order_id = $1 and deleted_at is null', [po!.id]);
        patch.line_no = Number(n?.n ?? 1);
      }
    }
    return patch;
  }

  ctx.defineResource({
    type: PO_LINE, table: 'purchase_order_lines', module: 'procurement', label: 'Purchase order line', plural: 'Purchase order lines',
    path: '/api/purchase-order-lines', route: '/procurement/purchase-order-lines', titleField: 'description',
    searchable: ['description', 'notes'],
    defaultSort: { field: 'line_no', dir: 'asc' },
    fields: {
      purchase_order_id: { label: 'Purchase order', type: 'ref', to: PO, required: true },
      line_no: { label: 'Line', type: 'number' },
      description: { label: 'Description', type: 'text', required: true, personal: false },
      quantity: { label: 'Quantity', type: 'number', required: true, default: 1 },
      unit_price: { label: 'Unit price', type: 'currency', required: true },
      amount: { label: 'Amount', type: 'currency', readOnly: true },
      budget_line_id: { label: 'Budget line', type: 'ref', to: 'budget_line', help: 'The budget line (account) this line is charged to.' },
      asset_id: { label: 'Asset', type: 'ref', to: 'asset', help: 'The asset bought or serviced, when there is one.' },
      received_quantity: { label: 'Received', type: 'number', readOnly: true },
      notes: { label: 'Notes', type: 'longtext', personal: false },
    },
    hooks: {
      beforeCreate: (req, data) => lineRules(req, null, data),
      beforeUpdate: (req, existing, patch) => lineRules(req, existing, patch),
      afterCreate: async (_req, row) => { await recomputeTotal(ctx, row.purchase_order_id); },
      afterUpdate: async (_req, before, after) => {
        await recomputeTotal(ctx, after.purchase_order_id);
        if (before.purchase_order_id !== after.purchase_order_id) await recomputeTotal(ctx, before.purchase_order_id);
      },
    },
  });
  ctx.resources.onChange?.(async (c) => {
    if (c.def.type === PO_LINE && (c.action === 'delete' || c.action === 'purge') && c.row.purchase_order_id) await recomputeTotal(ctx, c.row.purchase_order_id);
  });
  // A line of an order that is no longer a draft is not deleted (outside a data load).
  app.addHook('preHandler', async (req) => {
    if (req.method !== 'DELETE' || routePattern(req) !== '/api/purchase-order-lines/:id') return;
    const id = String((req.params as Row)?.id ?? '');
    const po = await db.one<Row>(
      `select p.status from purchase_order_lines l join purchase_orders p on p.id = l.purchase_order_id where l.id::text = $1`, [id]).catch(() => undefined);
    if (po && !EDITABLE.includes(po.status) && !(await dataLoadFor(db, req))) ctx.fail(409, 'not_draft', 'The order is no longer a draft: its lines stay as approved.');
  });

  // ---------- approval ----------

  async function approveNow(po: Row, by: { id: string | null; name: string | null }, at: string, req: FastifyRequest | null) {
    await ctx.resources.update(PO, po.id, { status: 'approved', approved_by: by.id, approved_by_name: by.name, approved_at: at }, null);
    await ctx.audit(req, {
      action: 'purchase_order.approve', recordType: PO, recordId: po.id,
      summary: `${po.ref} approved by ${by.name ?? 'an approver'}`, before: { status: po.status }, after: { status: 'approved', approved_by: by.name },
    });
  }
  async function backToDraft(po: Row, why: string, req: FastifyRequest | null) {
    await ctx.resources.update(PO, po.id, { status: 'draft', submitted_at: null }, null);
    await ctx.audit(req, {
      action: 'purchase_order.reject', recordType: PO, recordId: po.id, summary: `${po.ref} returned to draft: ${why}`,
      before: { status: po.status }, after: { status: 'draft', reason: why },
    });
    if (app.hasDecorator('notify') && po.requested_by) {
      await app.notify({ userIds: [po.requested_by], kind: 'approval', recordType: PO, recordId: po.id, title: `${po.ref} was not approved`, body: why });
    }
  }

  defineApprovalKind(app, {
    key: PO_KIND, recordType: PO, label: 'Purchase order approval',
    startsWhen: 'A purchase order is sent for approval',
    outcome: 'Approved: the order becomes Approved, with the approver\'s name and the time; rejected: it goes back to Draft with the reason',
    approverPermission: 'procurement.view',
    route: (id) => `/procurement/purchase-orders/${id}`,
    tellsRequester: false,
    async onFinish(e) {
      const po = await db.one<Row>('select * from purchase_orders where id = $1 and deleted_at is null', [e.instance.recordId]);
      if (!po || po.status !== 'pending_approval') return;
      if (e.outcome === 'approved') {
        await approveNow(po, { id: e.onBehalfOf ?? e.approverId, name: e.onBehalfOfName ?? e.approverName }, new Date().toISOString(), e.req);
        if (app.hasDecorator('notify') && po.requested_by) {
          await app.notify({ userIds: [po.requested_by], kind: 'approval', recordType: PO, recordId: po.id, title: `${po.ref} was approved`, body: 'It can now be issued to the vendor.' });
        }
      } else if (e.outcome === 'rejected') await backToDraft(po, e.comment ?? 'rejected in the approval workflow', e.req);
      else if (!e.byModule) await backToDraft(po, e.comment ?? 'the approval workflow was canceled', e.req);
    },
  });

  async function need(req: FastifyRequest): Promise<Row> {
    const id = idParam(ctx, req, 'id', 'Purchase order');
    return (await ctx.resources.find(PO, id, req.user)) ?? ctx.fail(404, 'not_found', 'Purchase order not found.');
  }
  const linesOf = (poId: string) => db.query<Row>(
    `select l.*, b.title as budget_line_title, b.account as budget_account from purchase_order_lines l left join budget_lines b on b.id = l.budget_line_id
     where l.purchase_order_id = $1 and l.deleted_at is null order by l.line_no, l.created_at`, [poId]);
  const fresh = async (id: string, req: FastifyRequest) => (await ctx.resources.find(PO, id, req.user))!;

  /** Who may decide the order now: the workflow's approvers, or (without a workflow) approvers who did not ask for it. */
  async function mayDecide(po: Row, userId: string): Promise<{ workflow: boolean; may: boolean }> {
    const eng = engine();
    const running = eng ? await eng.running(PO_KIND, po.id) : null;
    if (running) return { workflow: true, may: (await eng!.progress(PO_KIND, po.id, userId)).canDecide };
    return { workflow: false, may: po.requested_by !== userId };
  }

  app.get('/api/purchase-orders/:id/approval', { preHandler: ctx.requirePerm('procurement.view') }, async (req) => {
    const po = await need(req);
    const eng = engine();
    const latest = eng ? await eng.latest(PO_KIND, po.id) : null;
    const d = po.status === 'pending_approval' ? await mayDecide(po, req.user!.id) : { workflow: Boolean(latest && latest.status === 'running'), may: false };
    const canApprove = d.workflow ? d.may : d.may && ctx.can(req.user, 'procurement.approve');
    return { status: po.status, workflow: latest ? { name: latest.name, status: latest.status } : null, can_decide: po.status === 'pending_approval' && canApprove };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/purchase-orders/:id/approval', tag: 'Procurement', permission: 'procurement.view',
    summary: 'Where a purchase order\'s approval stands and whether the reader may decide it (procurement.approve when no workflow applies)',
    response: '{ status, workflow: { name, status } | null, can_decide }',
  });

  app.post('/api/purchase-orders/:id/submit', { preHandler: ctx.requirePerm('procurement.edit') }, async (req, reply) => {
    const po = await need(req);
    if (po.status !== 'draft') ctx.fail(409, 'not_draft', `${po.ref} is not a draft.`);
    const lines = await linesOf(po.id);
    if (!lines.length) invalid(ctx, { lines: 'Add at least one line before sending the order for approval.' });
    const at = new Date().toISOString();
    await ctx.resources.update(PO, po.id, { status: 'pending_approval', submitted_at: at }, null);
    await ctx.audit(req, { action: 'purchase_order.submit', recordType: PO, recordId: po.id, summary: `${po.ref} sent for approval (${num(po.total).toLocaleString('en-US')})`, before: { status: 'draft' }, after: { status: 'pending_approval' } });
    const eng = engine();
    const started = eng ? await eng.start(PO_KIND, { ...po, status: 'pending_approval' }, { requester: actorOf(req).id ?? req.user!.id, req, note: cleanText(body(req).note, 2000) }) : null;
    if (!started && app.hasDecorator('notify')) {
      const approvers = (await db.query<Row>(
        `select distinct ur.user_id from user_roles ur join role_permissions rp on rp.role_id = ur.role_id join roles r on r.id = ur.role_id and r.enabled
         where rp.permission in ('*', 'procurement.*', 'procurement.approve')`)).map((r) => r.user_id).filter((u) => u !== po.requested_by);
      await app.notify({ userIds: approvers, kind: 'approval', recordType: PO, recordId: po.id, title: `Purchase order to approve: ${po.ref} ${po.title}`, body: `${po.vendor_name ?? ''} · ${num(po.total).toLocaleString('en-US')}` });
    }
    reply.code(started ? 202 : 200);
    return { ...(await fresh(po.id, req)), workflow: started ? started.name : null };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/purchase-orders/:id/submit', tag: 'Procurement', permission: 'procurement.edit',
    summary: 'Send a draft purchase order for approval: through the purchase order approval workflow when one applies, otherwise to the people who hold procurement.approve',
    body: '{ note? }', response: 'the purchase order, with workflow (its name) when one started',
  });

  app.post('/api/purchase-orders/:id/decision', { preHandler: ctx.requirePerm('procurement.view') }, async (req) => {
    const po = await need(req);
    if (po.status !== 'pending_approval') ctx.fail(409, 'not_pending', `${po.ref} is not waiting for approval.`);
    const b = body(req);
    if (!['approved', 'rejected'].includes(b.decision)) invalid(ctx, { decision: 'Approve or reject.' });
    const comment = cleanText(b.comment, 2000);
    if (b.decision === 'rejected' && !comment) invalid(ctx, { comment: 'Say why it is rejected.' });
    const actor = actorOf(req);
    if (!actor.id) invalid(ctx, { on_behalf_of: 'Name an approver who has an account.' });
    const eng = engine();
    if (eng && await eng.running(PO_KIND, po.id)) {
      await eng.decide(PO_KIND, po.id, req, b.decision, comment);
      return fresh(po.id, req);
    }
    if (!ctx.can(req.user, 'procurement.approve')) ctx.fail(403, 'forbidden', 'Approving purchase orders needs permission to approve in procurement.');
    // Separation of duties: the person who asked for the order does not approve it.
    if (actor.id === po.requested_by) ctx.fail(403, 'own_request', 'You asked for this order: someone else approves it.');
    if (b.decision === 'approved') {
      const load = await dataLoadFor(db, req);
      const at = load && isInstant(b.approved_at) ? new Date(b.approved_at).toISOString() : new Date().toISOString();
      await approveNow(po, actor, at, req);
      if (app.hasDecorator('notify') && po.requested_by) {
        await app.notify({ userIds: [po.requested_by], kind: 'approval', recordType: PO, recordId: po.id, title: `${po.ref} was approved`, body: comment ?? 'It can now be issued to the vendor.' });
      }
    } else await backToDraft(po, `${comment} (${actor.name ?? 'an approver'})`, req);
    return fresh(po.id, req);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/purchase-orders/:id/decision', tag: 'Procurement', permission: 'procurement.approve',
    summary: 'Approve or reject a purchase order waiting for approval (a workflow approver decides their step; without a workflow, procurement.approve and not the requester). approved_at in a data load',
    body: '{ decision: "approved" | "rejected", comment?, approved_at? }', response: 'the purchase order',
  });

  /** A move of the order's status through one of the steps after approval. */
  async function move(req: FastifyRequest, po: Row, to: string, extra: Row, summary: string) {
    await ctx.resources.update(PO, po.id, { status: to, ...extra }, null);
    await ctx.audit(req, { action: `purchase_order.${to}`, recordType: PO, recordId: po.id, summary, before: { status: po.status }, after: { status: to, ...extra } });
    return fresh(po.id, req);
  }
  const dateOr = (v: unknown, fallback: string) => (isDate(v) ? v : fallback);

  app.post('/api/purchase-orders/:id/issue', { preHandler: ctx.requirePerm('procurement.edit') }, async (req) => {
    const po = await need(req);
    if (po.status !== 'approved') ctx.fail(409, 'not_approved', `${po.ref} must be approved before it is issued.`);
    const on = dateOr(body(req).issued_on, todayInZone());
    return move(req, po, 'issued', { issued_on: on }, `${po.ref} issued to ${po.vendor_name ?? 'the vendor'} on ${on}`);
  });
  ctx.describeRoute({ method: 'POST', path: '/api/purchase-orders/:id/issue', tag: 'Procurement', permission: 'procurement.edit', summary: 'Record that an approved purchase order was sent to the vendor', body: '{ issued_on? }', response: 'the purchase order' });

  app.get('/api/purchase-orders/:id/receipts', { preHandler: ctx.requirePerm('procurement.view') }, async (req) => {
    const po = await need(req);
    return db.query<Row>(
      `select r.id, r.line_id, l.line_no, l.description, r.quantity, r.received_on::text as received_on, r.received_by_name, r.note
       from purchase_order_receipts r join purchase_order_lines l on l.id = r.line_id where r.purchase_order_id = $1 order by r.received_on, r.created_at`, [po.id]);
  });
  ctx.describeRoute({ method: 'GET', path: '/api/purchase-orders/:id/receipts', tag: 'Procurement', permission: 'procurement.view', summary: 'What has been received against a purchase order', response: '{ id, line_id, line_no, description, quantity, received_on, received_by_name, note }[]' });

  app.post('/api/purchase-orders/:id/receipts', { preHandler: ctx.requirePerm('procurement.edit') }, async (req, reply) => {
    const po = await need(req);
    const load = await dataLoadFor(db, req);
    if (!load && !['issued', 'partially_received'].includes(po.status)) ctx.fail(409, 'not_issued', `${po.ref} must be issued before anything is received.`);
    const b = body(req);
    const today = todayInZone();
    const on = dateOr(b.received_on, today);
    if (!load && on > today) invalid(ctx, { received_on: 'The date received cannot be in the future.' });
    if (!Array.isArray(b.lines) || !b.lines.length) invalid(ctx, { lines: 'Give the quantity received of at least one line.' });
    const lines = await linesOf(po.id);
    const wanted = (b.lines as Row[]).map((x) => {
      const line = lines.find((l) => l.id === x?.line_id);
      const qty = Number(x?.quantity);
      if (!line) invalid(ctx, { lines: 'Each quantity names a line of this order.' });
      if (!Number.isFinite(qty) || qty <= 0) invalid(ctx, { lines: 'Give quantities above zero.' });
      if (qty > num(line!.quantity) - num(line!.received_quantity) + 1e-9) invalid(ctx, { lines: `Line ${line!.line_no}: more than is still to receive (${num(line!.quantity) - num(line!.received_quantity)}).` });
      return { line: line!, qty };
    });
    const actor = actorOf(req);
    const note = cleanText(b.note, 2000);
    await db.tx(async (tx) => {
      for (const w of wanted) {
        await tx.query(`insert into purchase_order_receipts (purchase_order_id, line_id, quantity, received_on, received_by, received_by_name, note, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [po.id, w.line.id, w.qty, on, actor.id, actor.name, note, req.user!.id]);
        await tx.query('update purchase_order_lines set received_quantity = received_quantity + $2, updated_at = now() where id = $1', [w.line.id, w.qty]);
      }
    });
    const after = await linesOf(po.id);
    const full = after.every((l) => num(l.received_quantity) >= num(l.quantity) - 1e-9);
    const status = full ? 'received' : 'partially_received';
    reply.code(201);
    return move(req, po, status, full ? { received_on: on } : {},
      `${po.ref}: ${wanted.map((w) => `${w.qty} of line ${w.line.line_no}`).join(', ')} received on ${on}${full ? ' (everything ordered is received)' : ''}`);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/purchase-orders/:id/receipts', tag: 'Procurement', permission: 'procurement.edit',
    summary: 'Record goods or services received against lines of an issued order; the order becomes partly received or received (who received is recorded)',
    body: '{ received_on?, note?, lines: { line_id, quantity }[] }', response: 'the purchase order',
  });

  app.post('/api/purchase-orders/:id/close', { preHandler: ctx.requirePerm('procurement.edit') }, async (req) => {
    const po = await need(req);
    if (!['issued', 'partially_received', 'received'].includes(po.status)) ctx.fail(409, 'not_open', `${po.ref} cannot be closed from its status.`);
    const on = dateOr(body(req).closed_on, todayInZone());
    return move(req, po, 'closed', { closed_on: on }, `${po.ref} closed on ${on}; what was not received is no longer committed`);
  });
  ctx.describeRoute({ method: 'POST', path: '/api/purchase-orders/:id/close', tag: 'Procurement', permission: 'procurement.edit', summary: 'Close an issued or received order (what was not received stops counting as committed)', body: '{ closed_on? }', response: 'the purchase order' });

  app.post('/api/purchase-orders/:id/cancel', { preHandler: ctx.requirePerm('procurement.edit') }, async (req) => {
    const po = await need(req);
    if (!['draft', 'pending_approval', 'approved', 'issued'].includes(po.status)) ctx.fail(409, 'not_cancelable', `${po.ref} cannot be canceled from its status.`);
    const received = await db.one<Row>('select count(*)::int as n from purchase_order_receipts where purchase_order_id = $1', [po.id]);
    if (Number(received?.n) > 0) ctx.fail(409, 'has_receipts', 'Something was already received: close the order instead.');
    const reason = cleanText(body(req).reason, 300);
    if (!reason) invalid(ctx, { reason: 'Say why the order is canceled.' });
    const eng = engine();
    if (eng && po.status === 'pending_approval') await eng.cancel(PO_KIND, po.id, `The order was canceled: ${reason}`, req);
    return move(req, po, 'canceled', { canceled_reason: reason }, `${po.ref} canceled: ${reason}`);
  });
  ctx.describeRoute({ method: 'POST', path: '/api/purchase-orders/:id/cancel', tag: 'Procurement', permission: 'procurement.edit', summary: 'Cancel an order nothing was received against (a running approval is canceled too)', body: '{ reason }', response: 'the purchase order' });

  // ---------- the budget lines an order is charged to ----------

  app.get('/api/purchase-orders/:id/budget-check', { preHandler: ctx.requirePerm('procurement.view') }, async (req) => {
    const po = await need(req);
    // Figures: what each budget line holds, has committed and has spent, counting every order.
    const rows = await db.query<Row>(
      `with mine as (select budget_line_id, sum(amount) as this_order from purchase_order_lines where purchase_order_id = $1 and deleted_at is null and budget_line_id is not null group by budget_line_id)
       select b.id, b.ref, b.title, b.account, b.amount, m.this_order,
              coalesce((select sum(case when p.status = any($2::text[]) then l.amount - l.received_quantity * l.unit_price else 0 end)
                        from purchase_order_lines l join purchase_orders p on p.id = l.purchase_order_id and p.deleted_at is null
                        where l.budget_line_id = b.id and l.deleted_at is null), 0) as committed,
              coalesce((select sum(l.received_quantity * l.unit_price) from purchase_order_lines l join purchase_orders p on p.id = l.purchase_order_id and p.deleted_at is null
                        where l.budget_line_id = b.id and l.deleted_at is null and p.status <> 'canceled'), 0) as spent
       from mine m join budget_lines b on b.id = m.budget_line_id and b.deleted_at is null order by b.ref`, [po.id, COMMITTING]);
    const counted = COMMITTING.includes(po.status) || ['received', 'closed', 'partially_received'].includes(po.status);
    return rows.map((r) => {
      const amount = num(r.amount); const committed = num(r.committed); const spent = num(r.spent);
      const remaining = cents(amount - committed - spent);
      // A draft or pending order is not yet committed: show what is left once it is.
      const after = counted ? remaining : cents(remaining - num(r.this_order));
      return { id: r.id, ref: r.ref, title: r.title, account: r.account, amount, committed: cents(committed), spent: cents(spent), remaining, this_order: cents(num(r.this_order)), remaining_after: after, over: after < 0 };
    });
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/purchase-orders/:id/budget-check', tag: 'Procurement', permission: 'procurement.view',
    summary: 'The budget lines an order is charged to: amount, committed, spent, remaining, this order and what remains after it (the same for everyone)',
    response: '{ id, ref, title, account, amount, committed, spent, remaining, this_order, remaining_after, over }[]',
  });

  app.get('/api/purchase-orders/:id/lines', { preHandler: ctx.requirePerm('procurement.view') }, async (req) => {
    const po = await need(req);
    return (await linesOf(po.id)).map((l) => ({
      id: l.id, line_no: l.line_no, description: l.description, quantity: num(l.quantity), unit_price: num(l.unit_price), amount: num(l.amount),
      budget_line_id: l.budget_line_id, budget_line: l.budget_line_id ? `${l.budget_account ? `${l.budget_account} ` : ''}${l.budget_line_title ?? ''}`.trim() : null,
      asset_id: l.asset_id, received_quantity: num(l.received_quantity), notes: l.notes,
    }));
  });
  ctx.describeRoute({ method: 'GET', path: '/api/purchase-orders/:id/lines', tag: 'Procurement', permission: 'procurement.view', summary: 'The lines of a purchase order with their budget line and what was received', response: '{ id, line_no, description, quantity, unit_price, amount, budget_line_id, budget_line, asset_id, received_quantity, notes }[]' });
}
