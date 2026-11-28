import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';

// Invoices and payments against purchase orders (E46-66). Invented names only.

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let officer: Client;   // Procurement officer: enters invoices
let other: Client;     // a second procurement officer
let approver: Client;  // Approver: procurement.view, procurement.approve
let viewer: Client;

let line: Row;

beforeAll(async () => {
  t = await testApp();
  const role = await t.db.one<Row>(`insert into roles (key, name, enabled) values ('inv_viewer', 'inv_viewer', true) returning id`);
  await t.db.query(`insert into role_permissions (role_id, permission) values ($1, 'procurement.view')`, [role!.id]);
  officer = await t.as('procurement_officer');
  other = await t.as('procurement_officer');
  approver = await t.as('approver');
  viewer = await t.as('inv_viewer');
  const year = dayInZone().slice(0, 4);
  const budget = (await officer.post('/api/budgets', { name: 'Invented invoice budget', fiscal_year: `FY ${year}`, starts_on: `${year}-01-01`, ends_on: `${year}-12-31` })).body;
  line = (await officer.post('/api/budget-lines', { budget_id: budget.id, title: 'Invented shop supplies', kind: 'operating', account: '50-2000', amount: 20000 })).body;
  expect((await officer.post('/api/budget-versions', { budget_id: budget.id, kind: 'adopted', decision: 'Invented resolution' })).status).toBe(201);
}, 60_000);
afterAll(async () => { await t?.close(); });

/** An order issued to the vendor, with its lines, optionally received in part. */
const issuedOrder = async (title: string, lines: [string, number, number][], receive: number[] = []) => {
  const po = (await officer.post('/api/purchase-orders', { title, vendor_name: 'Invented Supply Co', budget_line_id: line.id })).body;
  for (const [description, quantity, unit_price] of lines) await officer.post('/api/purchase-order-lines', { purchase_order_id: po.id, description, quantity, unit_price });
  await officer.post(`/api/purchase-orders/${po.id}/submit`, {});
  expect((await approver.post(`/api/purchase-orders/${po.id}/decision`, { decision: 'approved' })).status).toBe(200);
  await officer.post(`/api/purchase-orders/${po.id}/issue`, {});
  const ls = (await viewer.get(`/api/purchase-orders/${po.id}/lines`)).body as Row[];
  const got = receive.map((q, i) => ({ line_id: ls[i].id, quantity: q })).filter((x) => x.quantity > 0);
  if (got.length) expect((await officer.post(`/api/purchase-orders/${po.id}/receipts`, { lines: got })).status).toBe(201);
  return { po: (await viewer.get(`/api/purchase-orders/${po.id}`)).body, lines: ls };
};

describe('invoices', () => {
  it('are entered against an issued order, matched with what was received, approved, paid, and move spent', async () => {
    const draft = (await officer.post('/api/purchase-orders', { title: 'Invented draft order', vendor_name: 'Invented Supply Co' })).body;
    const early = await officer.post('/api/purchase-invoices', { purchase_order_id: draft.id, invoice_number: 'A-1', invoice_date: dayInZone(0) });
    expect(early.status).toBe(400);
    expect(early.body.error.fields.purchase_order_id).toMatch(/issued/);

    const { po, lines } = await issuedOrder('Invented gloves and glasses', [['Gloves, case', 10, 60], ['Glasses, box', 5, 40]], [10, 0]);
    // Lines given with the invoice: a quantity at the order price, an amount only.
    const made = await officer.post(`/api/purchase-orders/${po.id}/invoices`, {
      invoice_number: ' isc-1001 ', invoice_date: dayInZone(-1), due_on: dayInZone(29),
      lines: [{ line_id: lines[0].id, quantity: 10 }, { line_id: lines[1].id, amount: 200 }],
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body).toMatchObject({ ref: expect.stringMatching(/^INV-/), invoice_number: 'isc-1001', status: 'draft', vendor_name: 'Invented Supply Co', entered_by: officer.userId, received_on: dayInZone(0) });
    expect(Number(made.body.amount)).toBe(800);
    // Nothing of line 2 was received yet: the invoice does not match.
    expect(made.body.match_status).toBe('exception');
    expect(made.body.match_note).toMatch(/Line 2: 200\.00 invoiced against 0\.00 received/);

    // The same vendor's invoice number twice is refused (case and spaces do not matter).
    const dup = await officer.post('/api/purchase-invoices', { purchase_order_id: po.id, invoice_number: 'ISC-1001', invoice_date: dayInZone(0) });
    expect(dup.status).toBe(400);
    expect(dup.body.error.fields.invoice_number).toContain(made.body.ref);

    // Receiving the rest makes it match.
    await officer.post(`/api/purchase-orders/${po.id}/receipts`, { lines: [{ line_id: lines[1].id, quantity: 5 }] });
    const inv = (await viewer.get(`/api/purchase-invoices/${made.body.id}`)).body;
    expect(inv.match_status).toBe('matched');
    const ils = (await viewer.get(`/api/purchase-invoices/${inv.id}/lines`)).body;
    expect(ils).toHaveLength(2);
    expect(ils[0]).toMatchObject({ line_no: 1, quantity: 10, unit_price: 60, amount: 600, received_quantity: 10, match_status: 'matched' });
    expect(ils[1]).toMatchObject({ quantity: null, amount: 200, match_status: 'matched' });

    // The status is the application's; sending for approval locks the lines.
    await officer.patch(`/api/purchase-invoices/${inv.id}`, { status: 'paid' });
    expect((await viewer.get(`/api/purchase-invoices/${inv.id}`)).body.status).toBe('draft');
    expect((await officer.post(`/api/purchase-invoices/${inv.id}/payment`, { payment_reference: 'X' })).status).toBe(409);
    expect((await officer.post(`/api/purchase-invoices/${inv.id}/submit`, {})).body.status).toBe('pending_approval');
    expect((await officer.patch(`/api/purchase-invoice-lines/${ils[0].id}`, { quantity: 9 })).status).toBe(400);
    expect((await officer.del(`/api/purchase-invoice-lines/${ils[0].id}`)).status).toBe(409);
    expect((await officer.patch(`/api/purchase-invoices/${inv.id}`, { invoice_number: 'ISC-9' })).status).toBe(400);
    expect((await officer.patch(`/api/purchase-invoices/${inv.id}`, { notes: 'Checked against the delivery slip.' })).status).toBe(200);

    // My work: the approver, not the person who entered it.
    expect(JSON.stringify((await approver.get('/api/work/mine')).body)).toContain(inv.id);
    expect(JSON.stringify((await officer.get('/api/work/mine')).body)).not.toContain(inv.id);
    expect((await officer.post(`/api/purchase-invoices/${inv.id}/decision`, { decision: 'approved' })).status).toBe(403);
    expect((await viewer.post(`/api/purchase-invoices/${inv.id}/decision`, { decision: 'approved' })).status).toBe(403);
    expect((await approver.get(`/api/purchase-invoices/${inv.id}/approval`)).body).toMatchObject({ can_decide: true, match_status: 'matched' });
    const ok = await approver.post(`/api/purchase-invoices/${inv.id}/decision`, { decision: 'approved' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ status: 'approved', approved_by: approver.userId, approval_note: null });

    // Approved but not paid: still committed; the calendar shows it falling due.
    let f = (await viewer.get(`/api/budget-lines/${line.id}/figures`)).body;
    expect(f).toMatchObject({ committed: 800, spent: 0 });
    const cal = await officer.get(`/api/work/calendar?from=${dayInZone(0)}&to=${dayInZone(40)}`);
    expect(cal.status).toBe(200);
    expect(JSON.stringify(cal.body)).toContain(`procurement.invoices_due:${inv.id}`);

    const noRef = await officer.post(`/api/purchase-invoices/${inv.id}/payment`, { paid_on: dayInZone(0) });
    expect(noRef.body.error.fields.payment_reference).toBeTruthy();
    expect((await officer.post(`/api/purchase-invoices/${inv.id}/payment`, { paid_on: dayInZone(5), payment_reference: 'EFT 1' })).status).toBe(400);
    const paid = await officer.post(`/api/purchase-invoices/${inv.id}/payment`, { paid_on: dayInZone(0), payment_reference: 'EFT 000123', payment_method: 'electronic' });
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(paid.body).toMatchObject({ status: 'paid', paid_on: dayInZone(0), payment_reference: 'EFT 000123', payment_method: 'electronic', paid_by: officer.userId });
    expect((await officer.post(`/api/purchase-invoices/${inv.id}/void`, { reason: 'x' })).status).toBe(409);

    // Spent is what was paid; the order is no longer committed for it.
    f = (await viewer.get(`/api/budget-lines/${line.id}/figures`)).body;
    expect(f).toMatchObject({ committed: 0, spent: 800, remaining: 19200 });
    expect(f.orders.find((o: Row) => o.id === po.id)).toMatchObject({ amount: 800, received: 800, paid: 800 });
    const three = (await viewer.get(`/api/purchase-orders/${po.id}/invoices`)).body;
    expect(three.totals).toEqual({ ordered: 800, received: 800, invoiced: 800, paid: 800 });
    expect(three.invoices).toHaveLength(1);
    expect(three.lines[0]).toMatchObject({ received_quantity: 10, invoiced_quantity: 10, invoiced_amount: 600, paid: 600 });
    // An order invoiced cannot be canceled.
    expect((await officer.post(`/api/purchase-orders/${po.id}/cancel`, { reason: 'x' })).status).toBe(409);
  });

  it('need a reason to approve one that does not match, count other invoices, and can be returned or voided', async () => {
    const { po, lines } = await issuedOrder('Invented filters', [['Air filter', 10, 50]], [4]);
    const first = (await officer.post(`/api/purchase-orders/${po.id}/invoices`, { invoice_number: 'F-1', invoice_date: dayInZone(0), lines: [{ line_id: lines[0].id, quantity: 4 }] })).body;
    expect(first.match_status).toBe('matched');
    await officer.post(`/api/purchase-invoices/${first.id}/submit`, {});
    // A second invoice for the same goods bills more than was received; a higher price too.
    const second = (await other.post(`/api/purchase-orders/${po.id}/invoices`, { invoice_number: 'F-2', invoice_date: dayInZone(0), lines: [{ line_id: lines[0].id, quantity: 2, unit_price: 55 }] })).body;
    expect(second.match_status).toBe('exception');
    expect(second.match_note).toMatch(/6 invoiced, 4 received; price 55\.00 above the order's 50\.00/);
    await other.post(`/api/purchase-invoices/${second.id}/submit`, {});
    const bare = await approver.post(`/api/purchase-invoices/${second.id}/decision`, { decision: 'approved' });
    expect(bare.status).toBe(400);
    expect(bare.body.error.fields.comment).toMatch(/does not match/);
    // Returned to the person who entered it, with the reason.
    const back = await approver.post(`/api/purchase-invoices/${second.id}/decision`, { decision: 'rejected', comment: 'Ask the vendor for a credit.' });
    expect(back.body).toMatchObject({ status: 'draft', rejected_reason: expect.stringContaining('credit') });
    const voided = await other.post(`/api/purchase-invoices/${second.id}/void`, { reason: 'Replaced by a corrected invoice.' });
    expect(voided.body).toMatchObject({ status: 'voided', voided_reason: 'Replaced by a corrected invoice.' });
    // A voided number may be entered again.
    const again = (await other.post(`/api/purchase-orders/${po.id}/invoices`, { invoice_number: 'F-2', invoice_date: dayInZone(0), lines: [{ line_id: lines[0].id, amount: 300 }] })).body;
    expect(again.match_status).toBe('exception');
    await other.post(`/api/purchase-invoices/${again.id}/submit`, {});
    const over = await approver.post(`/api/purchase-invoices/${again.id}/decision`, { decision: 'approved', comment: 'Freight agreed with the buyer.' });
    expect(over.body).toMatchObject({ status: 'approved', approval_note: 'Freight agreed with the buyer.' });
    const audit = await t.db.one<Row>(`select summary from audit_events where record_id = $1 and action = 'purchase_invoice.approve'`, [again.id]);
    expect(audit?.summary).toContain('although it does not match');
  });

  it('match within the tolerance set by an administrator', async () => {
    const { po, lines } = await issuedOrder('Invented hoses', [['Hose', 1, 100]], [1]);
    const inv = (await officer.post(`/api/purchase-orders/${po.id}/invoices`, { invoice_number: 'H-1', invoice_date: dayInZone(0), lines: [{ line_id: lines[0].id, quantity: 1, unit_price: 102 }] })).body;
    expect(inv.match_status).toBe('exception');
    expect((await viewer.put('/api/procurement/settings', { invoice_tolerance_pct: 5 })).status).toBe(403);
    const set = await t.api.put('/api/procurement/settings', { invoice_tolerance_pct: 5 });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body.invoice_tolerance_pct).toBe(5);
    expect((await t.api.put('/api/procurement/settings', { invoice_tolerance_pct: 90 })).status).toBe(400);
    try {
      expect((await viewer.get(`/api/purchase-invoices/${inv.id}/lines`)).body[0].match_status).toBe('matched');
      expect((await viewer.get(`/api/purchase-invoices/${inv.id}`)).body.match_status).toBe('matched');
    } finally {
      await t.api.put('/api/procurement/settings', { invoice_tolerance_pct: 0 });
    }
  });

  it('use the invoice approval workflow when one applies', async () => {
    const wf = await t.api.post('/api/workflows/definitions', {
      record_type: 'purchase_invoice', kind: 'purchase_invoice_approval', name: 'Invoices (test)',
      steps: [{ name: 'Accounts payable', approvers: { kind: 'users', users: [other.userId] } }],
    });
    expect(wf.status, JSON.stringify(wf.body)).toBe(201);
    try {
      const { po, lines } = await issuedOrder('Invented paint', [['Paint, gallon', 4, 30]], [4]);
      const inv = (await officer.post(`/api/purchase-orders/${po.id}/invoices`, { invoice_number: 'P-1', invoice_date: dayInZone(0), lines: [{ line_id: lines[0].id, quantity: 4 }] })).body;
      const sent = await officer.post(`/api/purchase-invoices/${inv.id}/submit`, {});
      expect(sent.status).toBe(202);
      expect(sent.body.workflow).toBe('Invoices (test)');
      expect((await approver.get(`/api/purchase-invoices/${inv.id}/approval`)).body.can_decide).toBe(false);
      expect(JSON.stringify((await other.get('/api/work/mine')).body)).toContain(inv.id);
      const done = await other.post(`/api/purchase-invoices/${inv.id}/decision`, { decision: 'approved' });
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      expect((await t.api.get(`/api/purchase-invoices/${inv.id}`)).body).toMatchObject({ status: 'approved', approved_by: other.userId });
    } finally {
      await t.api.del(`/api/workflows/definitions/${wf.body.id}`);
    }
  });

  it('give the same invoice figures to everyone', async () => {
    const a = (await viewer.get('/api/procurement/summary')).body;
    const b = (await officer.get('/api/procurement/summary')).body;
    expect(a).toEqual(b);
    expect(a.invoices).toMatchObject({ awaiting_approval: expect.any(Number), exceptions: expect.any(Number), to_pay: expect.any(Number), overdue: expect.any(Number) });
    expect(a.invoices.to_pay).toBeGreaterThanOrEqual(1);
  });
});
