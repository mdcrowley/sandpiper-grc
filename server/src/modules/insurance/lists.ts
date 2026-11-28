// The insurance area's configurable lists (Administration > Lists). Values are general: no line of
// coverage, carrier or form of one jurisdiction is built in, and every list can be changed.
import type { ModuleContext } from '../../core/module.ts';

export const LISTS = [
  'insurance_line', 'insurer_kind', 'insurance_policy_status', 'insurance_renewal_status', 'insurance_condition_status',
  'insurance_certificate_status', 'insurance_certificate_check', 'insurance_requirement_state', 'insurance_claim_status',
  'insurance_claim_kind', 'insurance_claim_direction', 'insurance_payment_kind', 'insurance_allocation_method', 'insurance_valuation_basis',
  'insurance_request_status',
];

export async function ensureInsuranceLists(ctx: ModuleContext) {
  const own = { module: 'insurance' };
  await ctx.lookups.ensure('insurance_line', [
    { value: 'property', label: 'Property', color: 'blue', sort: 10 },
    { value: 'general_liability', label: 'General liability', color: 'teal', sort: 20 },
    { value: 'auto_liability', label: 'Auto liability', color: 'indigo', sort: 30 },
    { value: 'auto_physical_damage', label: 'Auto physical damage', color: 'indigo', sort: 40 },
    { value: 'workers_comp', label: 'Workers\' compensation', color: 'amber', sort: 50 },
    { value: 'cyber', label: 'Cyber', color: 'purple', sort: 60 },
    { value: 'public_officials', label: 'Public officials and errors and omissions', color: 'gray', sort: 70 },
    { value: 'crime', label: 'Crime and fidelity', color: 'gray', sort: 80 },
    { value: 'pollution', label: 'Pollution', color: 'green', sort: 90 },
    { value: 'excess', label: 'Excess or umbrella liability', color: 'teal', sort: 100 },
    { value: 'professional', label: 'Professional liability', color: 'gray', sort: 110 },
    { value: 'other', label: 'Other', color: 'gray', sort: 900 },
  ], own);
  await ctx.lookups.ensure('insurer_kind', [
    { value: 'insurer', label: 'Insurance company', sort: 10 },
    { value: 'risk_pool', label: 'Risk pool', sort: 20 },
    { value: 'self', label: 'Self-insured program', sort: 30 },
  ], own);
  await ctx.lookups.ensure('insurance_policy_status', [
    { value: 'draft', label: 'Being placed', color: 'gray', sort: 10 },
    { value: 'active', label: 'In force', color: 'green', sort: 20 },
    { value: 'expired', label: 'Expired', color: 'gray', sort: 30, meta: { closed: true } },
    { value: 'replaced', label: 'Renewed', color: 'gray', sort: 40, meta: { closed: true } },
    { value: 'canceled', label: 'Canceled', color: 'red', sort: 50, meta: { closed: true } },
  ], own);
  await ctx.lookups.ensure('insurance_renewal_status', [
    { value: 'not_started', label: 'Not started', color: 'gray', sort: 10 },
    { value: 'gathering', label: 'Gathering information', color: 'blue', sort: 20 },
    { value: 'submitted', label: 'Application submitted', color: 'blue', sort: 30 },
    { value: 'quoted', label: 'Quotes received', color: 'amber', sort: 40 },
    { value: 'bound', label: 'Bound', color: 'green', sort: 50, meta: { done: true } },
    { value: 'not_renewing', label: 'Not renewing', color: 'gray', sort: 60, meta: { done: true } },
  ], own);
  await ctx.lookups.ensure('insurance_condition_status', [
    { value: 'not_assessed', label: 'Not assessed', color: 'gray', sort: 10 },
    { value: 'met', label: 'Met', color: 'green', sort: 20 },
    { value: 'partly', label: 'Partly met', color: 'amber', sort: 30 },
    { value: 'not_met', label: 'Not met', color: 'red', sort: 40, meta: { failed: true } },
  ], own);
  await ctx.lookups.ensure('insurance_certificate_status', [
    { value: 'requested', label: 'Requested', color: 'gray', sort: 10 },
    { value: 'to_review', label: 'Sent by the vendor, to review', color: 'amber', sort: 15 },
    { value: 'received', label: 'Received', color: 'blue', sort: 20 },
    { value: 'accepted', label: 'Accepted', color: 'green', sort: 30 },
    { value: 'rejected', label: 'Rejected', color: 'red', sort: 40, meta: { closed: true } },
    { value: 'superseded', label: 'Superseded', color: 'gray', sort: 50, meta: { closed: true } },
  ], own);
  await ctx.lookups.ensure('insurance_certificate_check', [
    { value: 'meets', label: 'Meets the contract', color: 'green', sort: 10 },
    { value: 'short', label: 'Short of the contract', color: 'red', sort: 20 },
    { value: 'expired', label: 'Expired', color: 'red', sort: 30 },
    { value: 'none', label: 'No requirement on file', color: 'gray', sort: 40 },
  ], own);
  await ctx.lookups.ensure('insurance_requirement_state', [
    { value: 'met', label: 'Met', color: 'green', sort: 10 },
    { value: 'short', label: 'Shortfall', color: 'red', sort: 20 },
    { value: 'expired', label: 'Certificate expired', color: 'red', sort: 30 },
    { value: 'missing', label: 'No certificate', color: 'amber', sort: 40 },
  ], own);
  await ctx.lookups.ensure('insurance_claim_status', [
    { value: 'open', label: 'Open', color: 'blue', sort: 10 },
    { value: 'investigating', label: 'Under investigation', color: 'amber', sort: 20 },
    { value: 'litigation', label: 'In litigation', color: 'red', sort: 30 },
    { value: 'closed', label: 'Closed', color: 'green', sort: 40, meta: { closed: true } },
    { value: 'denied', label: 'Denied', color: 'gray', sort: 50, meta: { closed: true } },
    { value: 'withdrawn', label: 'Withdrawn', color: 'gray', sort: 60, meta: { closed: true } },
  ], own);
  // `restrict`: claims of this kind usually hold personal or security details and start restricted.
  await ctx.lookups.ensure('insurance_claim_kind', [
    { value: 'property_damage', label: 'Property damage', sort: 10 },
    { value: 'vehicle', label: 'Vehicle collision or damage', sort: 20 },
    { value: 'bodily_injury', label: 'Bodily injury', sort: 30, meta: { restrict: true } },
    { value: 'workers_comp', label: 'Workers\' compensation', sort: 40, meta: { restrict: true } },
    { value: 'cyber', label: 'Cyber incident', sort: 50, meta: { restrict: true } },
    { value: 'liability', label: 'Other liability', sort: 60 },
    { value: 'crime', label: 'Crime or theft', sort: 70 },
    { value: 'other', label: 'Other', sort: 900 },
  ], own);
  await ctx.lookups.ensure('insurance_claim_direction', [
    { value: 'against', label: 'Against the organization', sort: 10 },
    { value: 'first_party', label: 'By the organization under its own policy', sort: 20 },
    { value: 'subrogation', label: 'By the organization against another party', sort: 30 },
  ], own);
  // Wave 27 (E46-62): kinds of claim payment; `recovery` marks money coming back to the organization.
  await ctx.lookups.ensure('insurance_payment_kind', [
    { value: 'indemnity', label: 'Payment to the claimant', color: 'blue', sort: 10 },
    { value: 'medical', label: 'Medical payment', color: 'blue', sort: 20 },
    { value: 'repair', label: 'Repair or replacement', color: 'blue', sort: 30 },
    { value: 'expense', label: 'Claim expense (legal, adjusting, experts)', color: 'gray', sort: 40 },
    { value: 'deductible', label: 'Deductible or retention paid', color: 'amber', sort: 50 },
    { value: 'other_payment', label: 'Other payment', color: 'gray', sort: 60 },
    { value: 'insurer_recovery', label: 'Received from the insurer', color: 'green', sort: 110, meta: { recovery: 'yes' } },
    { value: 'subrogation', label: 'Recovered from another party', color: 'green', sort: 120, meta: { recovery: 'yes' } },
    { value: 'salvage', label: 'Salvage', color: 'green', sort: 130, meta: { recovery: 'yes' } },
    { value: 'other_recovery', label: 'Other recovery', color: 'green', sort: 140, meta: { recovery: 'yes' } },
    { value: 'opening_paid', label: 'Paid before payments were listed', color: 'gray', sort: 900 },
    { value: 'opening_recovery', label: 'Recovered before payments were listed', color: 'gray', sort: 910, meta: { recovery: 'yes' } },
  ], own);
  // Wave 27 (E46-64): how a policy's premium is split, and how a scheduled property is valued.
  await ctx.lookups.ensure('insurance_allocation_method', [
    { value: 'equal', label: 'Equally', sort: 10 },
    { value: 'measure', label: 'By a measure (payroll, floor area, units)', sort: 20 },
    { value: 'insured_value', label: 'By insured value (schedule of values)', sort: 30 },
    { value: 'manual', label: 'By hand (percentages)', sort: 40 },
  ], own);
  await ctx.lookups.ensure('insurance_valuation_basis', [
    { value: 'replacement_cost', label: 'Replacement cost', sort: 10 },
    { value: 'actual_cash_value', label: 'Actual cash value', sort: 20 },
    { value: 'agreed_value', label: 'Agreed value', sort: 30 },
    { value: 'appraised', label: 'Appraised value', sort: 40 },
    { value: 'book_value', label: 'Book value', sort: 50 },
  ], own);
  // Wave 27 (E46-65): requests to vendors for certificates of insurance.
  await ctx.lookups.ensure('insurance_request_status', [
    { value: 'draft', label: 'Not sent yet', color: 'gray', sort: 10 },
    { value: 'sent', label: 'Sent', color: 'blue', sort: 20 },
    { value: 'received', label: 'Certificates received', color: 'green', sort: 30, meta: { closed: true } },
    { value: 'canceled', label: 'Canceled', color: 'gray', sort: 40, meta: { closed: true } },
  ], own);
}

/** Values of a list whose meta carries `flag` (closed statuses, kinds that start restricted). */
export async function valuesWith(ctx: ModuleContext, list: string, flag: string): Promise<string[]> {
  return (await ctx.lookups.values(list)).filter((v) => (v.meta as Record<string, unknown> | undefined)?.[flag] === true).map((v) => v.value);
}
