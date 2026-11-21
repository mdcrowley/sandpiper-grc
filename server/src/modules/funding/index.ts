import type { ModuleContext, ModuleDef } from '../../core/module.ts';
import { registerAwards } from './awards.ts';
import { registerCertifications } from './certifications.ts';
import { DEFAULT_FUNDING_CLAUSES, FUNDING_CLAUSE_STATUSES, registerClauses } from './clauses.ts';
import { registerReviews } from './reviews.ts';
import { seedFunding } from './seed.ts';
import { registerSubrecipients } from './subrecipients.ts';
import { registerSummary } from './summary.ts';

/**
 * Funding and grant compliance (E27): funding awards and what they paid for, the reporting they
 * require (as obligations), yearly certifications signed by an authorized official, funder
 * compliance reviews with review areas loaded from a file, their deficiencies and corrective action
 * plans, and the funder-required clauses of funded contracts. Permission module `funding`; feature
 * area `funding`. No funder, program or law is built in: they are the organization's own data.
 */

async function seedDefaults(ctx: ModuleContext) {
  const own = { module: 'funding' };
  // meta.closed: the award is over (left out of open totals and reports due).
  await ctx.lookups.ensure('funding_award_status', [
    { value: 'applied', label: 'Applied for', color: 'blue', sort: 10 },
    { value: 'awarded', label: 'Awarded', color: 'teal', sort: 20 },
    { value: 'active', label: 'Active', color: 'green', sort: 30 },
    { value: 'closed_out', label: 'Closed out', color: 'gray', sort: 40, meta: { closed: true } },
  ], own);
  // The same keys as the obligation frequencies (contract C5), so an award's reporting becomes an obligation.
  await ctx.lookups.ensure('funding_report_frequency', [
    { value: 'monthly', label: 'Monthly', sort: 10 },
    { value: 'quarterly', label: 'Quarterly', sort: 20 },
    { value: 'half_yearly', label: 'Every six months', sort: 30 },
    { value: 'yearly', label: 'Yearly', sort: 40 },
    { value: 'once', label: 'Once, at the end', sort: 50 },
  ], own);
  await ctx.lookups.ensure('funding_certification_status', [
    { value: 'draft', label: 'Draft', color: 'blue', sort: 10 },
    { value: 'in_review', label: 'Waiting for signature', color: 'amber', sort: 20 },
    { value: 'signed', label: 'Signed', color: 'green', sort: 30 },
    { value: 'submitted', label: 'Submitted to the funder', color: 'teal', sort: 40, meta: { closed: true } },
  ], own);
  await ctx.lookups.ensure('funding_certification_category', [
    { value: 'general', label: 'General', sort: 10 },
    { value: 'financial', label: 'Financial management', sort: 20 },
    { value: 'procurement', label: 'Procurement', sort: 30 },
    { value: 'assets', label: 'Assets and maintenance', sort: 40 },
    { value: 'operations', label: 'Operations', sort: 50 },
    { value: 'accessibility', label: 'Accessibility', sort: 60 },
    { value: 'workforce', label: 'Workforce', sort: 70 },
    { value: 'environment', label: 'Environment', sort: 80 },
    { value: 'other', label: 'Other', sort: 90 },
  ], own);
  // meta.closed: the review is over; it cannot close while a deficiency is open.
  await ctx.lookups.ensure('compliance_review_status', [
    { value: 'preparing', label: 'Preparing', color: 'blue', sort: 10 },
    { value: 'self_assessment', label: 'Self-assessment', color: 'teal', sort: 20 },
    { value: 'on_site', label: 'Site visit', color: 'purple', sort: 30 },
    { value: 'draft_report', label: 'Draft report', color: 'amber', sort: 40 },
    { value: 'final_report', label: 'Final report', color: 'orange', sort: 50 },
    { value: 'closed', label: 'Closed', color: 'gray', sort: 60, meta: { closed: true } },
  ], own);
  await ctx.lookups.ensure('review_self_assessment', [
    { value: 'not_assessed', label: 'Not assessed', color: 'gray', sort: 10 },
    { value: 'compliant', label: 'Compliant', color: 'green', sort: 20 },
    { value: 'deficient', label: 'Deficient', color: 'red', sort: 30 },
    { value: 'not_applicable', label: 'Not applicable', color: 'blue', sort: 40 },
  ], own);
  await ctx.lookups.ensure('review_request_status', [
    { value: 'open', label: 'Open', color: 'blue', sort: 10 },
    { value: 'provided', label: 'Provided', color: 'teal', sort: 20 },
    { value: 'accepted', label: 'Accepted by the funder', color: 'green', sort: 30, meta: { closed: true } },
  ], own);
  // meta.closed: corrected. A deficiency with a corrective action plan closes when the plan does.
  await ctx.lookups.ensure('review_deficiency_status', [
    { value: 'open', label: 'Open', color: 'red', sort: 10 },
    { value: 'in_progress', label: 'Being corrected', color: 'amber', sort: 20 },
    { value: 'submitted', label: 'Response sent to the funder', color: 'teal', sort: 30 },
    { value: 'closed', label: 'Closed', color: 'green', sort: 40, meta: { closed: true } },
  ], own);
  await ctx.lookups.ensure('funding_clause', DEFAULT_FUNDING_CLAUSES, own);
  await ctx.lookups.ensure('funding_clause_status', FUNDING_CLAUSE_STATUSES, own);
}

async function register(ctx: ModuleContext) {
  // Corrective action plans and actions raised from deficiencies are filed under "Funding" (C8). Done
  // here, not in seedDefaults: modules seed their defaults in name order, so the risks module's
  // action_source list does not exist yet when funding's defaults run on a new database.
  if (await ctx.db.one(`select 1 from lookups where list_key = 'action_source' limit 1`)) {
    await ctx.lookups.ensure('action_source', [{ value: 'funding', label: 'Funding', sort: 148 }]);
  }
  registerAwards(ctx);
  await registerCertifications(ctx);
  registerReviews(ctx);
  registerClauses(ctx);
  registerSummary(ctx);
  await registerSubrecipients(ctx);
}

const mod: ModuleDef = {
  key: 'funding',
  seedDefaults,
  register,
  seed: seedFunding,
};
export default mod;
