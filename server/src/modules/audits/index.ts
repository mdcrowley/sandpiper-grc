import type { ModuleContext, ModuleDef } from '../../core/module.ts';
import { registerChecklists } from './checklists.ts';
import { registerCoverage } from './coverage.ts';
import { registerDue } from './due.ts';
import { registerFindings } from './findings.ts';
import { registerJobs } from './jobs.ts';
import { registerMetrics } from './metrics.ts';
import { registerReport } from './report.ts';
import { registerRequests } from './requests.ts';
import { registerResources } from './resources.ts';
import { seedAudits } from './seed.ts';
import { registerPlan } from './plan.ts';
import { registerWorkpapers } from './workpapers.ts';
import { ensureDefectLists, registerDefects } from './defects.ts';
import { registerMissed } from './missed.ts';
import { registerTime } from './time.ts';

/**
 * Audits and inspections (E24, feature area `audits`, permission module `audits`): the audit
 * universe and its multi-year coverage, audit engagements with their checklist, evidence requests,
 * findings and report approval, reusable checklist templates, recurring inspection schedules and
 * inspections run on a phone or tablet. Findings raise corrective action plans (record type `cap`,
 * contract C1) and hazards (safety) when those modules are loaded. Audits flagged `restricted`
 * also need `security.view`, and their findings and evidence requests follow them.
 */

const tableExists = async (ctx: ModuleContext, table: string) =>
  Boolean(await ctx.db.one(`select 1 from information_schema.tables where table_name = $1 limit 1`, [table]));

async function seedDefaults(ctx: ModuleContext) {
  const own = { module: 'audits' };
  await ctx.lookups.ensure('audit_area_category', [
    { value: 'safety_plan_element', label: 'Safety plan element', color: 'red', sort: 10 },
    { value: 'process', label: 'Process', color: 'blue', sort: 20 },
    { value: 'department', label: 'Department', color: 'teal', sort: 30 },
    { value: 'system', label: 'System', color: 'purple', sort: 40 },
    { value: 'site', label: 'Site', color: 'amber', sort: 50 },
  ], own);
  await ctx.lookups.ensure('audit_risk_level', [
    { value: 'high', label: 'High', color: 'red', sort: 10 },
    { value: 'medium', label: 'Medium', color: 'amber', sort: 20 },
    { value: 'low', label: 'Low', color: 'green', sort: 30 },
  ], own);
  await ctx.lookups.ensure('audit_type', [
    { value: 'internal_audit', label: 'Internal audit', color: 'blue', sort: 10 },
    { value: 'safety_review', label: 'Safety review', color: 'red', sort: 20 },
    { value: 'compliance_pre_review', label: 'Compliance pre-review', color: 'purple', sort: 30 },
    { value: 'cyber_control_audit', label: 'Cybersecurity control audit', color: 'teal', sort: 40 },
  ], own);
  // meta.closed: the audit is finished (closing records the area's last audit date).
  await ctx.lookups.ensure('audit_status', [
    { value: 'planned', label: 'Planned', color: 'blue', sort: 10 },
    { value: 'fieldwork', label: 'Fieldwork', color: 'amber', sort: 20 },
    { value: 'reporting', label: 'Reporting', color: 'orange', sort: 30 },
    { value: 'closed', label: 'Closed', color: 'green', sort: 40, meta: { closed: true } },
    { value: 'canceled', label: 'Canceled', color: 'gray', sort: 50, meta: { closed: true, canceled: true } },
  ], own);
  await ctx.lookups.ensure('audit_opinion', [
    { value: 'effective', label: 'Effective', color: 'green', sort: 10 },
    { value: 'needs_improvement', label: 'Needs improvement', color: 'amber', sort: 20 },
    { value: 'ineffective', label: 'Ineffective', color: 'red', sort: 30 },
  ], own);
  await ctx.lookups.ensure('checklist_kind', [
    { value: 'inspection', label: 'Inspection', color: 'teal', sort: 10 },
    { value: 'audit', label: 'Audit', color: 'blue', sort: 20 },
  ], own);
  await ctx.lookups.ensure('inspection_target_type', [
    { value: 'site', label: 'Site', sort: 10 },
    { value: 'vehicle', label: 'Vehicle', sort: 20 },
    { value: 'asset', label: 'Asset', sort: 30 },
    { value: 'system', label: 'System', sort: 40 },
    { value: 'none', label: 'Nothing in particular', sort: 50 },
  ], own);
  // meta.days or meta.months: how far the next inspection is from the last one.
  await ctx.lookups.ensure('inspection_frequency', [
    { value: 'weekly', label: 'Weekly', sort: 10, meta: { days: 7 } },
    { value: 'monthly', label: 'Monthly', sort: 20, meta: { months: 1 } },
    { value: 'quarterly', label: 'Quarterly', sort: 30, meta: { months: 3 } },
    { value: 'yearly', label: 'Yearly', sort: 40, meta: { months: 12 } },
  ], own);
  await ctx.lookups.ensure('inspection_status', [
    { value: 'scheduled', label: 'Scheduled', color: 'blue', sort: 10 },
    { value: 'in_progress', label: 'In progress', color: 'amber', sort: 20 },
    { value: 'complete', label: 'Complete', color: 'green', sort: 30, meta: { closed: true } },
    { value: 'missed', label: 'Missed', color: 'red', sort: 40, meta: { closed: true } },
    // Canceled: not carried out and not due any more. Answers and completion are refused (E38-11).
    { value: 'canceled', label: 'Canceled', color: 'gray', sort: 50, meta: { closed: true } },
  ], own);
  await ctx.lookups.ensure('inspection_result', [
    { value: 'pass', label: 'Pass', color: 'green', sort: 10 },
    { value: 'pass_with_findings', label: 'Pass with findings', color: 'amber', sort: 20 },
    { value: 'fail', label: 'Fail', color: 'red', sort: 30 },
  ], own);
  await ctx.lookups.ensure('finding_rating', [
    { value: 'major_nonconformity', label: 'Major nonconformity', color: 'red', sort: 10 },
    { value: 'minor_nonconformity', label: 'Minor nonconformity', color: 'orange', sort: 20 },
    { value: 'observation', label: 'Observation', color: 'blue', sort: 30 },
    { value: 'opportunity', label: 'Opportunity for improvement', color: 'teal', sort: 40 },
  ], own);
  // meta.closed: nothing more is expected on the finding.
  await ctx.lookups.ensure('finding_status', [
    { value: 'open', label: 'Open', color: 'blue', sort: 10 },
    { value: 'responded', label: 'Response given', color: 'amber', sort: 20 },
    { value: 'cap_raised', label: 'Corrective action plan raised', color: 'purple', sort: 30 },
    // E45-16: the fix is done and waits for an auditor's verification; Closed needs that verification.
    { value: 'awaiting_verification', label: 'Awaiting verification', color: 'teal', sort: 35 },
    { value: 'closed', label: 'Closed', color: 'green', sort: 40, meta: { closed: true } },
  ], own);
  // E45-13: risk factors of an audit area for the risk-ranked plan. meta.factor (0 to 1) is how much the
  // value adds to the score; an administrator may change it.
  await ctx.lookups.ensure('audit_significance', [
    { value: 'high', label: 'High', color: 'red', sort: 10, meta: { factor: 1 } },
    { value: 'medium', label: 'Medium', color: 'amber', sort: 20, meta: { factor: 0.6 } },
    { value: 'low', label: 'Low', color: 'green', sort: 30, meta: { factor: 0.3 } },
  ], own);
  await ctx.lookups.ensure('audit_change_level', [
    { value: 'high', label: 'Major change', color: 'red', sort: 10, meta: { factor: 1 } },
    { value: 'medium', label: 'Some change', color: 'amber', sort: 20, meta: { factor: 0.6 } },
    { value: 'low', label: 'Little change', color: 'green', sort: 30, meta: { factor: 0.3 } },
    { value: 'none', label: 'No change', color: 'gray', sort: 40, meta: { factor: 0 } },
  ], own);
  // E45-15: the result of a workpaper step. meta.answer is what it counts as in the report (met, not
  // met, not applicable); meta.default marks the result an old yes / no / not applicable answer takes.
  await ctx.lookups.ensure('workpaper_result', [
    { value: 'satisfactory', label: 'Satisfactory, no exceptions', color: 'green', sort: 10, meta: { answer: 'yes', default: true } },
    { value: 'minor_exceptions', label: 'Minor exceptions', color: 'amber', sort: 20, meta: { answer: 'no' } },
    { value: 'exceptions', label: 'Exceptions found', color: 'red', sort: 30, meta: { answer: 'no', default: true } },
    { value: 'limitation', label: 'Could not be tested (scope limitation)', color: 'orange', sort: 40 },
    { value: 'not_applicable', label: 'Not applicable', color: 'gray', sort: 50, meta: { answer: 'na', default: true } },
  ], own);
  await ctx.lookups.ensure('audit_request_status', [
    { value: 'requested', label: 'Requested', color: 'blue', sort: 10 },
    { value: 'provided', label: 'Provided', color: 'amber', sort: 20 },
    { value: 'accepted', label: 'Accepted', color: 'green', sort: 30, meta: { closed: true } },
    { value: 'returned', label: 'Returned for more', color: 'orange', sort: 40 },
  ], own);
  // Corrective action plans and actions raised from inspections are filed under "Inspection" (audits
  // already have "Audit"). Modules seed in key order, so the action tracker's list may not exist
  // yet: its table does once the risks module is installed.
  if (await tableExists(ctx, 'actions')) {
    await ctx.lookups.ensure('action_source', [{ value: 'inspection', label: 'Inspection', color: 'teal', sort: 42 }]);
  }
  if (await tableExists(ctx, 'notifications')) {
    await ctx.lookups.ensure('notification_kind', [
      { value: 'audits', label: 'Audits and inspections', color: 'purple', sort: 77, meta: { description: 'An inspection or an evidence request is due or overdue, or an audit report waits for approval.' } },
    ]);
  }
  await ensureDefectLists(ctx); // wave 26
}

async function register(ctx: ModuleContext) {
  registerResources(ctx);
  const checklists = registerChecklists(ctx);
  registerWorkpapers(ctx, checklists); // E45-15: preparer and reviewer sign-off, review notes
  await registerPlan(ctx); // E45-13: the risk-ranked audit plan and its approved versions
  registerFindings(ctx);
  await registerRequests(ctx);
  registerCoverage(ctx);
  registerReport(ctx);
  registerMetrics(ctx);
  await registerJobs(ctx);
  registerDue(ctx); // evidence requests in My work and the calendars (E41-03)
  registerDefects(ctx); // wave 26: defects on vehicles, sites and assets, raised from inspections
  registerMissed(ctx); // wave 26: missed inspections followed up, figures needing attention, inspections in My work
  registerTime(ctx); // E45-63: the audit's time budget and hours worked
}

const mod: ModuleDef = {
  key: 'audits',
  seedDefaults,
  register,
  seed: seedAudits,
};
export default mod;
