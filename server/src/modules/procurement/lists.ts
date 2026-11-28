// The configurable lists of procurement (Administration > Lists, and Procurement > Settings). No
// jurisdiction's thresholds are built in: a method's dollar limit (`meta.max_value`) is empty until an
// administrator enters the organization's own.
import type { LookupValue, ModuleContext } from '../../core/module.ts';

export const OWN = { module: 'procurement' };

export const METHODS: LookupValue[] = [
  { value: 'micro_purchase', label: 'Micro-purchase', color: 'gray', sort: 10, meta: { evaluation: 'none', justification: 'no' } },
  { value: 'small_purchase', label: 'Small purchase (quotes)', color: 'blue', sort: 20, meta: { evaluation: 'price', justification: 'no' } },
  { value: 'sealed_bid', label: 'Sealed bid', color: 'teal', sort: 30, meta: { evaluation: 'price', justification: 'no' } },
  { value: 'competitive_proposals', label: 'Competitive proposals', color: 'purple', sort: 40, meta: { evaluation: 'scored', justification: 'no' } },
  { value: 'sole_source', label: 'Sole source', color: 'amber', sort: 50, meta: { evaluation: 'none', justification: 'yes' } },
  { value: 'cooperative', label: 'Cooperative purchase', color: 'green', sort: 60, meta: { evaluation: 'none', justification: 'no' } },
  { value: 'emergency', label: 'Emergency', color: 'red', sort: 70, meta: { evaluation: 'none', justification: 'yes' } },
];

/** Statuses of a procurement; `meta.open` marks those still being bought. */
export const PROCUREMENT_STATUSES: LookupValue[] = [
  { value: 'planning', label: 'Planning', color: 'gray', sort: 10, meta: { open: true } },
  { value: 'issued', label: 'Issued', color: 'blue', sort: 20, meta: { open: true } },
  { value: 'evaluation', label: 'Under evaluation', color: 'purple', sort: 30, meta: { open: true } },
  { value: 'awarded', label: 'Awarded', color: 'green', sort: 40 },
  { value: 'closed', label: 'Closed', color: 'gray', sort: 50 },
  { value: 'canceled', label: 'Canceled', color: 'red', sort: 60 },
];
export const OPEN_FALLBACK = ['planning', 'issued', 'evaluation'];

/** Statuses of a purchase order. Set by the application (submit, approve, issue, receive, close, cancel). */
export const PO_STATUSES: LookupValue[] = [
  { value: 'draft', label: 'Draft', color: 'gray', sort: 10 },
  { value: 'pending_approval', label: 'Awaiting approval', color: 'amber', sort: 20 },
  { value: 'approved', label: 'Approved', color: 'blue', sort: 30 },
  { value: 'issued', label: 'Issued', color: 'purple', sort: 40 },
  { value: 'partially_received', label: 'Partly received', color: 'teal', sort: 50 },
  { value: 'received', label: 'Received', color: 'green', sort: 60 },
  { value: 'closed', label: 'Closed', color: 'gray', sort: 70 },
  { value: 'canceled', label: 'Canceled', color: 'red', sort: 80 },
];
/**
 * Purchase order statuses whose amount not yet paid is committed against the budget (E46-66: what was
 * received stays committed until its invoice is paid). Closing an order releases what was not paid.
 */
export const COMMITTING = ['approved', 'issued', 'partially_received', 'received'];

/** Statuses of a vendor invoice. Set by the application (submit, approve, reject, pay, void). */
export const INVOICE_STATUSES: LookupValue[] = [
  { value: 'draft', label: 'Entered', color: 'gray', sort: 10 },
  { value: 'pending_approval', label: 'Awaiting approval', color: 'amber', sort: 20 },
  { value: 'approved', label: 'Approved for payment', color: 'blue', sort: 30 },
  { value: 'paid', label: 'Paid', color: 'green', sort: 40 },
  { value: 'voided', label: 'Voided', color: 'red', sort: 50 },
];

export async function ensureProcurementLists(ctx: ModuleContext): Promise<void> {
  await ctx.lookups.ensure('procurement_method', METHODS, OWN);
  await ctx.lookups.ensure('procurement_status', PROCUREMENT_STATUSES, OWN);
  await ctx.lookups.ensure('solicitation_type', [
    { value: 'rfp', label: 'Request for proposals', color: 'purple', sort: 10 },
    { value: 'rfq', label: 'Request for quotes', color: 'blue', sort: 20 },
    { value: 'ifb', label: 'Invitation for bids', color: 'teal', sort: 30 },
    { value: 'rfi', label: 'Request for information', color: 'gray', sort: 40 },
    { value: 'none', label: 'No solicitation', color: 'gray', sort: 50 },
  ], OWN);
  await ctx.lookups.ensure('offer_status', [
    { value: 'received', label: 'Received', color: 'blue', sort: 10 },
    { value: 'responsive', label: 'Responsive', color: 'teal', sort: 20 },
    { value: 'nonresponsive', label: 'Not responsive', color: 'red', sort: 30 },
    { value: 'withdrawn', label: 'Withdrawn', color: 'gray', sort: 40 },
    { value: 'awarded', label: 'Awarded', color: 'green', sort: 50 },
    { value: 'not_selected', label: 'Not selected', color: 'gray', sort: 60 },
  ], OWN);
  await ctx.lookups.ensure('evaluator_role', [
    { value: 'chair', label: 'Chair', color: 'purple', sort: 10 },
    { value: 'member', label: 'Member', color: 'blue', sort: 20 },
    { value: 'advisor', label: 'Advisor (does not score)', color: 'gray', sort: 30 },
  ], OWN);
  await ctx.lookups.ensure('protest_status', [
    { value: 'received', label: 'Received', color: 'blue', sort: 10 },
    { value: 'under_review', label: 'Under review', color: 'amber', sort: 20 },
    { value: 'upheld', label: 'Upheld', color: 'red', sort: 30 },
    { value: 'denied', label: 'Denied', color: 'green', sort: 40 },
    { value: 'withdrawn', label: 'Withdrawn', color: 'gray', sort: 50 },
  ], OWN);
  // The organization's own clause template: every procurement is checked against it.
  await ctx.lookups.ensure('procurement_clause', [
    { value: 'termination', label: 'Termination for cause and for convenience', sort: 10, meta: { description: 'How either party may end the contract, and what is paid then.' } },
    { value: 'records_access', label: 'Access to records and audit', sort: 20, meta: { description: 'The organization, its auditors and funders may inspect the contractor\'s records about the contract.' } },
    { value: 'changes', label: 'Changes and change orders', sort: 30, meta: { description: 'How scope, price and schedule changes are agreed in writing.' } },
    { value: 'disputes', label: 'Disputes and remedies', sort: 40, meta: { description: 'How disputes are raised and resolved, and the remedies for breach.' } },
    { value: 'exclusion', label: 'Exclusion and debarment certification', sort: 50, meta: { description: 'The contractor certifies it is not excluded from public contracts, and checks its subcontractors.' } },
    { value: 'conflict', label: 'Conflict of interest and gifts', sort: 60, meta: { description: 'No undisclosed conflicts of interest; no gifts to people involved in the procurement.' } },
    { value: 'nondiscrimination', label: 'Equal opportunity and nondiscrimination', sort: 70, meta: { description: 'The contractor does not discriminate in employment or in the services it provides.' } },
    { value: 'insurance', label: 'Insurance and indemnification', sort: 80, meta: { description: 'The insurance the contractor carries and the losses it covers.' } },
    { value: 'data_security', label: 'Data protection and security', sort: 90, meta: { description: 'How the contractor protects the organization\'s data and systems and reports incidents.' } },
    { value: 'funder_terms', label: 'Terms required by the funding source', sort: 100, meta: { description: 'Clauses a grant or other funding source requires to be passed on to contractors.' } },
  ], OWN);
  await ctx.lookups.ensure('procurement_clause_status', [
    { value: 'included', label: 'Included', color: 'green', sort: 10 },
    { value: 'missing', label: 'Missing', color: 'red', sort: 20 },
    { value: 'not_applicable', label: 'Not applicable', color: 'gray', sort: 30 },
  ], OWN);
  await ctx.lookups.ensure('po_status', PO_STATUSES, OWN);
  await ctx.lookups.ensure('budget_status', [
    { value: 'draft', label: 'Draft', color: 'gray', sort: 10 },
    { value: 'adopted', label: 'Adopted', color: 'green', sort: 20, meta: { current: true } },
    { value: 'amended', label: 'Amended', color: 'teal', sort: 30, meta: { current: true } },
    { value: 'closed', label: 'Closed', color: 'gray', sort: 40 },
  ], OWN);
  await ctx.lookups.ensure('invoice_status', INVOICE_STATUSES, OWN);
  await ctx.lookups.ensure('invoice_match', [
    { value: 'matched', label: 'Matches order and receipts', color: 'green', sort: 10 },
    { value: 'exception', label: 'Does not match', color: 'red', sort: 20 },
    { value: 'no_lines', label: 'No lines yet', color: 'gray', sort: 30 },
  ], OWN);
  await ctx.lookups.ensure('payment_method', [
    { value: 'electronic', label: 'Electronic transfer', color: 'blue', sort: 10 },
    { value: 'check', label: 'Check', color: 'teal', sort: 20 },
    { value: 'card', label: 'Purchasing card', color: 'purple', sort: 30 },
    { value: 'wire', label: 'Wire transfer', color: 'gray', sort: 40 },
    { value: 'other', label: 'Other', color: 'gray', sort: 50 },
  ], OWN);
  await ctx.lookups.ensure('budget_version_kind', [
    { value: 'adopted', label: 'Adopted budget', color: 'green', sort: 10 },
    { value: 'amendment', label: 'Amendment', color: 'teal', sort: 20 },
  ], OWN);
  await ctx.lookups.ensure('budget_kind', [
    { value: 'operating', label: 'Operating', color: 'blue', sort: 10 },
    { value: 'capital', label: 'Capital', color: 'purple', sort: 20 },
  ], OWN);
}

/** Values of a list whose `meta[key]` is true, or the fallback when none carries it. */
export async function flagged(ctx: ModuleContext, list: string, key: string, fallback: string[]): Promise<string[]> {
  const values = await ctx.lookups.values(list);
  const out = values.filter((v) => (v.meta as Record<string, unknown> | undefined)?.[key] === true).map((v) => v.value);
  return out.length ? out : fallback;
}
