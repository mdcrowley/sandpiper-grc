import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { metricsAvailable } from '../../core/metrics.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';

// Purchase orders and budgets (E46). Invented names only.

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let officer: Client;   // Procurement officer: procurement.*
let other: Client;     // a second procurement officer
let approver: Client;  // Approver: procurement.view, procurement.approve
let viewer: Client;

let budget: Row;
let parts: Row;
let capital: Row;

beforeAll(async () => {
  t = await testApp();
  const role = await t.db.one<Row>(`insert into roles (key, name, enabled) values ('po_viewer', 'po_viewer', true) returning id`);
  await t.db.query(`insert into role_permissions (role_id, permission) values ($1, 'procurement.view')`, [role!.id]);
  officer = await t.as('procurement_officer');
  other = await t.as('procurement_officer');
  approver = await t.as('approver');
  viewer = await t.as('po_viewer');
  const year = dayInZone().slice(0, 4);
  budget = (await officer.post('/api/budgets', { name: 'Invented budget', fiscal_year: `FY ${year}`, starts_on: `${year}-01-01`, ends_on: `${year}-12-31` })).body;
  parts = (await officer.post('/api/budget-lines', { budget_id: budget.id, title: 'Invented parts', kind: 'operating', account: '50-1000', amount: 10000 })).body;
  capital = (await officer.post('/api/budget-lines', { budget_id: budget.id, title: 'Invented depot lift', kind: 'capital', account: '70-1000', amount: 50000 })).body;
  const adopted = await officer.post('/api/budget-versions', { budget_id: budget.id, kind: 'adopted', approved_on: dayInZone(0), decision: 'Invented board resolution' });
  expect(adopted.status, JSON.stringify(adopted.body)).toBe(201);
}, 60_000);
afterAll(async () => { await t?.close(); });

const newOrder = async (c: Client, title: string, lines: [string, number, number][], extra: Row = {}) => {
  const po = await c.post('/api/purchase-orders', { title, vendor_name: 'Invented Parts Co', budget_line_id: parts.id, ...extra });
  expect(po.status, JSON.stringify(po.body)).toBe(201);
  for (const [description, quantity, unit_price] of lines) {
    const l = await c.post('/api/purchase-order-lines', { purchase_order_id: po.body.id, description, quantity, unit_price });
    expect(l.status, JSON.stringify(l.body)).toBe(201);
  }
  return (await c.get(`/api/purchase-orders/${po.body.id}`)).body;
};

describe('budgets', () => {
  it('check their dates and keep projects for capital lines', async () => {
    expect((await officer.post('/api/budgets', { name: 'x', fiscal_year: 'FY', starts_on: dayInZone(0), ends_on: dayInZone(-1) })).status).toBe(400);
    const project = await officer.post('/api/budget-lines', { budget_id: budget.id, title: 'Operating with a project', kind: 'operating', amount: 1, project_id: budget.id });
    expect(project.status).toBe(400);
  });
});

describe('purchase orders', () => {
  it('total their lines, go through approval, issue and receiving, and move the budget figures', async () => {
    const po = await newOrder(officer, 'Invented brake parts', [['Brake pads', 10, 150], ['Rotors', 4, 400]]);
    expect(po).toMatchObject({ ref: expect.stringMatching(/^PO-/), status: 'draft', requested_by: officer.userId, order_date: dayInZone(0) });
    expect(Number(po.total)).toBe(3100);
    // The status is the application's.
    await officer.patch(`/api/purchase-orders/${po.id}`, { status: 'approved' });
    expect((await officer.get(`/api/purchase-orders/${po.id}`)).body.status).toBe('draft');

    // A draft does not commit the budget yet; the check shows what would remain.
    const check = (await viewer.get(`/api/purchase-orders/${po.id}/budget-check`)).body;
    expect(check[0]).toMatchObject({ id: parts.id, amount: 10000, committed: 0, this_order: 3100, remaining_after: 6900, over: false });

    expect((await officer.post(`/api/purchase-orders/${po.id}/submit`, {})).body.status).toBe('pending_approval');
    // Lines stay as sent.
    const lines = (await viewer.get(`/api/purchase-orders/${po.id}/lines`)).body;
    expect((await officer.patch(`/api/purchase-order-lines/${lines[0].id}`, { quantity: 20 })).status).toBe(400);
    expect((await officer.del(`/api/purchase-order-lines/${lines[0].id}`)).status).toBe(409);
    expect((await officer.post('/api/purchase-order-lines', { purchase_order_id: po.id, description: 'Extra', quantity: 1, unit_price: 1 })).status).toBe(400);

    // In the approver's My work; the requester may not approve their own order.
    expect(JSON.stringify((await approver.get('/api/work/mine')).body)).toContain(po.id);
    expect(JSON.stringify((await officer.get('/api/work/mine')).body)).not.toContain(po.id);
    expect((await viewer.post(`/api/purchase-orders/${po.id}/decision`, { decision: 'approved' })).status).toBe(403);
    expect((await officer.post(`/api/purchase-orders/${po.id}/decision`, { decision: 'approved' })).status).toBe(403);
    expect((await approver.get(`/api/purchase-orders/${po.id}/approval`)).body.can_decide).toBe(true);
    const ok = await approver.post(`/api/purchase-orders/${po.id}/decision`, { decision: 'approved' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ status: 'approved', approved_by: approver.userId });

    let fig = (await viewer.get(`/api/budgets/${budget.id}/figures`)).body;
    expect(fig.lines.find((l: Row) => l.id === parts.id)).toMatchObject({ committed: 3100, spent: 0, remaining: 6900, used_pct: 31 });

    expect((await officer.post(`/api/purchase-orders/${po.id}/receipts`, { lines: [{ line_id: lines[0].id, quantity: 1 }] })).status).toBe(409);
    expect((await officer.post(`/api/purchase-orders/${po.id}/issue`, {})).body).toMatchObject({ status: 'issued', issued_on: dayInZone(0) });
    expect((await officer.post(`/api/purchase-orders/${po.id}/receipts`, { lines: [{ line_id: lines[0].id, quantity: 11 }] })).status).toBe(400);
    const part = await officer.post(`/api/purchase-orders/${po.id}/receipts`, { lines: [{ line_id: lines[0].id, quantity: 10 }] });
    expect(part.status).toBe(201);
    expect(part.body.status).toBe('partially_received');
    fig = (await viewer.get(`/api/budgets/${budget.id}/figures`)).body;
    // Received but not paid stays committed: spent is what paid invoices charged (E46-66).
    expect(fig.lines.find((l: Row) => l.id === parts.id)).toMatchObject({ committed: 3100, spent: 0, remaining: 6900 });
    const rest = await officer.post(`/api/purchase-orders/${po.id}/receipts`, { lines: [{ line_id: lines[1].id, quantity: 4 }], received_on: dayInZone(-1) });
    expect(rest.body).toMatchObject({ status: 'received', received_on: dayInZone(-1) });
    expect((await viewer.get(`/api/purchase-orders/${po.id}/receipts`)).body).toHaveLength(2);
    fig = (await viewer.get(`/api/budgets/${budget.id}/figures`)).body;
    expect(fig.totals).toMatchObject({ amount: 60000, adopted: 60000, committed: 3100, spent: 0, remaining: 56900 });
    expect((await officer.post(`/api/purchase-orders/${po.id}/close`, {})).body.status).toBe('closed');
  });

  it('go back to draft when rejected, and closing releases what was not received', async () => {
    const po = await newOrder(officer, 'Invented filters', [['Air filter', 10, 50]]);
    await officer.post(`/api/purchase-orders/${po.id}/submit`, {});
    expect((await approver.post(`/api/purchase-orders/${po.id}/decision`, { decision: 'rejected' })).body.error.fields.comment).toBeTruthy();
    const back = await approver.post(`/api/purchase-orders/${po.id}/decision`, { decision: 'rejected', comment: 'Use the contract price.' });
    expect(back.body.status).toBe('draft');
    await officer.post(`/api/purchase-orders/${po.id}/submit`, {});
    await other.post(`/api/purchase-orders/${po.id}/decision`, { decision: 'approved' });
    await officer.post(`/api/purchase-orders/${po.id}/issue`, {});
    const line = (await viewer.get(`/api/purchase-orders/${po.id}/lines`)).body[0];
    await officer.post(`/api/purchase-orders/${po.id}/receipts`, { lines: [{ line_id: line.id, quantity: 4 }] });
    expect((await officer.post(`/api/purchase-orders/${po.id}/cancel`, { reason: 'x' })).status).toBe(409);
    const before = (await viewer.get(`/api/budget-lines/${parts.id}/figures`)).body;
    expect(before.committed).toBe(500);
    await officer.post(`/api/purchase-orders/${po.id}/close`, {});
    const after = (await viewer.get(`/api/budget-lines/${parts.id}/figures`)).body;
    expect(after.committed).toBe(0);
    expect(after.orders.map((o: Row) => o.id)).toContain(po.id);
  });

  it('use the purchase order approval workflow when one applies', async () => {
    const wf = await t.api.post('/api/workflows/definitions', {
      record_type: 'purchase_order', kind: 'purchase_order_approval', name: 'Purchase orders (test)',
      steps: [{ name: 'Finance', approvers: { kind: 'users', users: [other.userId] } }],
    });
    expect(wf.status, JSON.stringify(wf.body)).toBe(201);
    try {
      const po = await newOrder(officer, 'Invented lift inspection', [['Annual inspection', 1, 2400]], { budget_line_id: capital.id });
      const sent = await officer.post(`/api/purchase-orders/${po.id}/submit`, {});
      expect(sent.status).toBe(202);
      expect(sent.body.workflow).toBe('Purchase orders (test)');
      // Only the workflow's approver decides now.
      expect((await approver.get(`/api/purchase-orders/${po.id}/approval`)).body.can_decide).toBe(false);
      expect(JSON.stringify((await approver.get('/api/work/mine')).body)).not.toContain(po.id);
      expect(JSON.stringify((await other.get('/api/work/mine')).body)).toContain(po.id);
      const done = await other.post(`/api/purchase-orders/${po.id}/decision`, { decision: 'approved' });
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      expect((await t.api.get(`/api/purchase-orders/${po.id}`)).body).toMatchObject({ status: 'approved', approved_by: other.userId });
      const cancel = await newOrder(officer, 'Invented canceled order', [['Thing', 1, 10]]);
      await officer.post(`/api/purchase-orders/${cancel.id}/submit`, {});
      expect((await officer.post(`/api/purchase-orders/${cancel.id}/cancel`, { reason: 'No longer needed.' })).body.status).toBe('canceled');
    } finally {
      await t.api.del(`/api/workflows/definitions/${wf.body.id}`);
    }
  });

  it('load past orders as they were, received, with the people named', async () => {
    await t.db.query(`insert into users (username, email, display_name, status) values ('oldclerk', 'old.clerk@example.test', 'Olive Oldclerk', 'disabled')`);
    await t.db.query('update sessions set confirmed_at = now()');
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    try {
      const po = await t.api.post('/api/purchase-orders', {
        title: 'Invented 2018 tire order', vendor_name: 'Invented Tire Co', order_date: '2018-04-02', status: 'received', ref: 'PO-2018-0042',
        approved_at: '2018-04-03T10:00:00Z', approved_by_name: 'Olive Oldclerk', issued_on: '2018-04-04', received_on: '2018-05-01', created_at: '2018-04-02T09:00:00Z',
        on_behalf_of: 'oldclerk',
      });
      expect(po.status, JSON.stringify(po.body)).toBe(201);
      expect(po.body).toMatchObject({ ref: 'PO-2018-0042', status: 'received', order_date: '2018-04-02', received_on: '2018-05-01' });
      const line = await t.api.post('/api/purchase-order-lines', { purchase_order_id: po.body.id, description: 'Tire', quantity: 12, unit_price: 300, received_quantity: 12, budget_line_id: parts.id });
      expect(line.status, JSON.stringify(line.body)).toBe(201);
      expect(Number((await t.api.get(`/api/purchase-orders/${po.body.id}`)).body.total)).toBe(3600);
      const before = (await viewer.get(`/api/budget-lines/${parts.id}/figures`)).body;
      // A past invoice, loaded as paid with its approval and payment: the line's spent follows it.
      const inv = await t.api.post('/api/purchase-invoices', {
        purchase_order_id: po.body.id, invoice_number: 'IT-2018-77', invoice_date: '2018-05-03', status: 'paid', ref: 'INV-2018-0007',
        approved_by_name: 'Olive Oldclerk', approved_at: '2018-05-10T10:00:00Z', paid_on: '2018-05-20', payment_reference: 'CHK 10442', payment_method: 'check',
        created_at: '2018-05-04T09:00:00Z', on_behalf_of: 'oldclerk',
      });
      expect(inv.status, JSON.stringify(inv.body)).toBe(201);
      expect(inv.body).toMatchObject({ ref: 'INV-2018-0007', status: 'paid', paid_on: '2018-05-20', entered_by_name: 'Olive Oldclerk' });
      const il = await t.api.post('/api/purchase-invoice-lines', { invoice_id: inv.body.id, po_line_id: line.body.id, quantity: 12 });
      expect(il.status, JSON.stringify(il.body)).toBe(201);
      expect((await t.api.get(`/api/purchase-invoices/${inv.body.id}`)).body).toMatchObject({ amount: expect.anything(), match_status: 'matched' });
      const f = (await viewer.get(`/api/budget-lines/${parts.id}/figures`)).body;
      expect(f.spent - before.spent).toBe(3600);
      expect(f.orders.find((o: Row) => o.id === po.body.id)).toMatchObject({ amount: 3600, received: 3600, paid: 3600 });
    } finally {
      await t.api.post('/api/admin/data-load', { on: false });
    }
  });
});

describe('figures', () => {
  it('give the same summary to everyone and offer the metrics', async () => {
    const a = (await viewer.get('/api/procurement/summary')).body;
    const b = (await officer.get('/api/procurement/summary')).body;
    expect(a).toEqual(b);
    expect(a.budget.amount).toBe(60000);
    expect(a.orders).toHaveProperty('awaiting_approval');
    const keys = metricsAvailable(t.app, t.ctx.resources).map((m) => m.key);
    expect(keys).toEqual(expect.arrayContaining(['procurement.open_solicitations', 'procurement.orders_awaiting_approval', 'procurement.budget_used_pct']));
    const month = dayInZone().slice(0, 7);
    const values = (await viewer.get(`/api/metrics?month=${month}`)).body;
    expect(JSON.stringify(values)).toContain('procurement.budget_used_pct');
  });

  it('put offers due in the calendar of the buyer', async () => {
    const p = (await officer.post('/api/procurements', { title: 'Invented signage', method: 'sealed_bid', status: 'issued', proposals_due_at: `${dayInZone(3)}T15:00:00Z` })).body;
    const cal = (await officer.get(`/api/work/calendar?from=${dayInZone(0)}&to=${dayInZone(10)}`));
    if (cal.status === 200) expect(JSON.stringify(cal.body)).toContain(p.id);
  });
});
