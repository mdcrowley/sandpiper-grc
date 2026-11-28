// The insurance area's configurable lists (Administration > Lists). Values are general: no line of
// coverage, carrier or form of one jurisdiction is built in, and every list can be changed.
import type { ModuleContext } from '../../core/module.ts';

export const LISTS = [
  'insurance_line', 'insurer_kind', 'insurance_policy_status', 'insurance_renewal_status', 'insurance_condition_status',
  'insurance_certificate_status', 'insurance_certificate_check', 'insurance_requirement_state', 'insurance_claim_status',
  'insurance_claim_kind', 'insurance_claim_direction',
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
}

/** Values of a list whose meta carries `flag` (closed statuses, kinds that start restricted). */
export async function valuesWith(ctx: ModuleContext, list: string, flag: string): Promise<string[]> {
  return (await ctx.lookups.values(list)).filter((v) => (v.meta as Record<string, unknown> | undefined)?.[flag] === true).map((v) => v.value);
}
