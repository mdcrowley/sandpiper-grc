import type { ModuleContext, Row, SeedOptions } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { DEFAULT_CRITERIA } from './settings.ts';

/**
 * Dev profile only, all invented: this year's budget with operating and capital lines, adopted and then
 * amended once, two solicitations (one being evaluated, one awarded), purchase orders at several steps and
 * their invoices (one paid, one awaiting approval, one that does not match). Vendors are named in plain text:
 * the vendors module seeds after this one. Records are found again by title, so a second run adds nothing.
 */
export async function seedProcurement(ctx: ModuleContext, opts: SeedOptions): Promise<string> {
  if (opts.profile !== 'dev') return 'nothing to load (sample procurement is dev profile only)';
  const { db } = ctx;
  const owner = (await db.one<Row>(`select id from users where status = 'active' and deleted_at is null order by created_at limit 1`))?.id ?? null;
  let made = 0;
  const find = (table: string, col: string, v: string) => db.one<Row>(`select * from ${table} where ${col} = $1 and deleted_at is null`, [v]);
  const once = async (type: string, table: string, col: string, data: Row) => {
    const found = await find(table, col, data[col]);
    if (found) return found;
    made += 1;
    return ctx.resources.create(type, data, null);
  };

  const year = dayInZone().slice(0, 4);
  const budget = await once('budget', 'budgets', 'name', {
    name: `[Sample] Operating and capital budget ${year}`, fiscal_year: `FY ${year}`, starts_on: `${year}-01-01`, ends_on: `${year}-12-31`, status: 'draft', owner_id: owner,
    notes: 'Invented sample budget.',
  });
  const line = async (title: string, kind: string, account: string, amount: number) => once('budget_line', 'budget_lines', 'title', { budget_id: budget.id, title, kind, account, amount });
  const parts = await line('[Sample] Bus parts and supplies', 'operating', '50-4100', 420000);
  const it = await line('[Sample] Software subscriptions and support', 'operating', '50-6200', 185000);
  const versioned = await db.one('select 1 from budget_versions where budget_id = $1 and deleted_at is null', [budget.id]);
  if (!versioned) {
    await line('[Sample] Depot bus wash replacement', 'capital', '70-1200', 650000);
    await line('[Sample] Fare collection upgrade', 'capital', '70-3100', 900000);
    await ctx.resources.create('budget_version', {
      budget_id: budget.id, kind: 'adopted', approved_on: `${year}-01-02` > dayInZone() ? dayInZone() : `${year}-01-02`, decision: '[Sample] Board resolution adopting the budget',
      reason: 'Annual budget as adopted.',
    }, null);
    // An amendment part way through the year: more for software support, and a new capital line.
    const on = dayInZone(-20);
    await ctx.resources.create('budget_version', {
      budget_id: budget.id, kind: 'amendment', approved_on: on, effective_on: on, decision: '[Sample] Board resolution amending the budget',
      reason: 'Help desk licenses added for the new depot; bus stop signage funded by a grant.',
      changes: [{ budget_line_id: it.id, change: 25000 }, { title: '[Sample] Bus stop signage', kind: 'capital', account: '70-4100', amount: 120000 }],
    }, null);
    made += 2;
  }

  const evaluating = await once('procurement', 'procurements', 'title', {
    title: '[Sample] Scheduling and dispatch software', method: 'competitive_proposals', solicitation_type: 'rfp', status: 'evaluation',
    description: 'Software for run-cutting, operator scheduling and daily dispatch, with hosting and support.',
    estimated_value: 480000, independent_estimate: 455000, independent_estimate_on: dayInZone(-75), buyer_id: owner,
    issued_on: dayInZone(-60), questions_due_on: dayInZone(-40), proposals_due_at: `${dayInZone(-21)}T14:00:00Z`, award_planned_on: dayInZone(10),
  });
  if (!(await db.one('select 1 from procurement_criteria where procurement_id = $1', [evaluating.id]))) {
    for (const [i, c] of DEFAULT_CRITERIA.entries()) {
      await db.query('insert into procurement_criteria (procurement_id, name, weight, max_score, sort) values ($1,$2,$3,$4,$5)', [evaluating.id, c.name, c.weight, c.max_score, i]);
    }
  }
  for (const [name, amount] of [['[Sample] Lakeside Transit Software', 462000], ['[Sample] Meridian Route Systems', 498500], ['[Sample] Cobalt Scheduling Ltd', 431000]] as [string, number][]) {
    if (!(await db.one('select 1 from procurement_offers where procurement_id = $1 and bidder_name = $2 and deleted_at is null', [evaluating.id, name]))) {
      await ctx.resources.create('procurement_offer', { procurement_id: evaluating.id, bidder_name: name, amount, received_at: `${dayInZone(-21)}T13:00:00Z`, status: 'responsive' }, null);
      made += 1;
    }
  }
  if (owner) await db.query(`insert into procurement_evaluators (procurement_id, user_id, role) values ($1, $2, 'chair') on conflict do nothing`, [evaluating.id, owner]);

  const awarded = await once('procurement', 'procurements', 'title', {
    title: '[Sample] Brake parts supply, two years', method: 'small_purchase', solicitation_type: 'rfq', status: 'awarded',
    estimated_value: 90000, buyer_id: owner, issued_on: dayInZone(-120), proposals_due_at: `${dayInZone(-100)}T16:00:00Z`,
  });
  if (!awarded.awarded_on) {
    const low = await ctx.resources.create('procurement_offer', { procurement_id: awarded.id, bidder_name: '[Sample] Northgate Bus Parts', amount: 84200, received_at: `${dayInZone(-101)}T10:00:00Z`, status: 'awarded' }, null);
    await ctx.resources.create('procurement_offer', { procurement_id: awarded.id, bidder_name: '[Sample] Ridgeway Fleet Supply', amount: 88950, received_at: `${dayInZone(-100)}T09:30:00Z`, status: 'not_selected' }, null);
    await ctx.resources.update('procurement', awarded.id, {
      awarded_offer_id: low.id, awarded_on: dayInZone(-95), awarded_by: owner, award_amount: 84200, award_reason: 'Lowest of two responsive quotes; within the estimate.',
    }, null);
    made += 2;
  }

  const order = async (title: string, status: string, data: Row, lines: [string, number, number][]) => {
    const found = await find('purchase_orders', 'title', title);
    if (found) return found;
    const po = await ctx.resources.create('purchase_order', { title, status: 'draft', requested_by: owner, budget_line_id: parts.id, ...data }, null);
    for (const [description, quantity, unit_price] of lines) {
      await ctx.resources.create('purchase_order_line', { purchase_order_id: po.id, description, quantity, unit_price }, null);
    }
    if (status !== 'draft') {
      const extra: Row = { status };
      if (status !== 'pending_approval') Object.assign(extra, { approved_by: owner, approved_at: `${dayInZone(-30)}T15:00:00Z` });
      if (['issued', 'partially_received', 'received'].includes(status)) extra.issued_on = dayInZone(-29);
      if (status === 'pending_approval') extra.submitted_at = `${dayInZone(-1)}T09:00:00Z`;
      await ctx.resources.update('purchase_order', po.id, extra, null);
    }
    if (['partially_received', 'received'].includes(status)) {
      const ls = await db.query<Row>('select * from purchase_order_lines where purchase_order_id = $1 order by line_no', [po.id]);
      for (const [i, l] of ls.entries()) {
        const qty = status === 'received' || i === 0 ? Number(l.quantity) : 0;
        if (!qty) continue;
        await db.query(`insert into purchase_order_receipts (purchase_order_id, line_id, quantity, received_on, received_by) values ($1,$2,$3,$4,$5)`, [po.id, l.id, qty, dayInZone(-10), owner]);
        await db.query('update purchase_order_lines set received_quantity = $2 where id = $1', [l.id, qty]);
      }
      if (status === 'received') await db.query('update purchase_orders set received_on = $2 where id = $1', [po.id, dayInZone(-10)]);
    }
    made += 1;
    return po;
  };
  await order('[Sample] Brake pads and rotors, first release', 'partially_received', { vendor_name: '[Sample] Northgate Bus Parts', procurement_id: awarded.id, order_date: dayInZone(-31) },
    [['Brake pad set, forty-foot bus', 120, 185], ['Brake rotor, rear axle', 40, 410]]);
  await order('[Sample] Wiper blades and mirrors', 'received', { vendor_name: '[Sample] Ridgeway Fleet Supply', order_date: dayInZone(-45) },
    [['Wiper blade, 28 inch', 300, 14.5], ['Side mirror glass', 60, 52]]);
  await order('[Sample] Help desk software renewal', 'pending_approval', { vendor_name: '[Sample] Bluefield Service Software', budget_line_id: it.id, order_date: dayInZone(-2) },
    [['Annual subscription, 25 agents', 1, 21500]]);
  await order('[Sample] Shop safety supplies', 'draft', { vendor_name: '[Sample] Harbor Industrial Supply', order_date: dayInZone(0) },
    [['Safety glasses, box of 12', 20, 38], ['Nitrile gloves, case', 15, 64]]);

  // Invoices: the received order paid, the partly received one awaiting approval, and one billing more than received.
  const invoice = async (poTitle: string, number: string, status: string, lines: (po: Row, ls: Row[]) => Row[], extra: Row = {}) => {
    const po = await find('purchase_orders', 'title', poTitle);
    if (!po || await db.one('select 1 from purchase_invoices where purchase_order_id = $1 and invoice_number = $2 and deleted_at is null', [po.id, number])) return;
    const ls = await db.query<Row>('select * from purchase_order_lines where purchase_order_id = $1 and deleted_at is null order by line_no', [po.id]);
    const inv = await ctx.resources.create('purchase_invoice', { purchase_order_id: po.id, invoice_number: number, invoice_date: dayInZone(-8), due_on: dayInZone(22), entered_by: owner }, null);
    for (const l of lines(po, ls)) await ctx.resources.create('purchase_invoice_line', { invoice_id: inv.id, ...l }, null);
    if (status !== 'draft') await ctx.resources.update('purchase_invoice', inv.id, { status, submitted_at: `${dayInZone(-7)}T10:00:00Z`, ...extra }, null);
    made += 1;
  };
  await invoice('[Sample] Wiper blades and mirrors', '[Sample] RFS-20417', 'paid',
    (_po, ls) => ls.map((l) => ({ po_line_id: l.id, quantity: Number(l.quantity) })),
    { approved_by_name: '[Sample] Finance approver', approved_at: `${dayInZone(-6)}T10:00:00Z`, paid_on: dayInZone(-3), payment_reference: '[Sample] EFT 004512', payment_method: 'electronic' });
  await invoice('[Sample] Brake pads and rotors, first release', '[Sample] NBP-8810', 'pending_approval',
    (_po, ls) => [{ po_line_id: ls[0].id, quantity: Number(ls[0].received_quantity) }]);
  await invoice('[Sample] Brake pads and rotors, first release', '[Sample] NBP-8811', 'draft',
    (_po, ls) => [{ po_line_id: ls[1].id, quantity: 10, unit_price: 425 }]);

  return `procurement sample records ${made}`;
}
