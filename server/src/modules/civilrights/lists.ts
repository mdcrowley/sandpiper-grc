// The configurable lists of the civil rights area. Every one is the organization's own: values can be
// renamed, added or retired under Administration > Lists. None names a law, an agency or a program of
// any jurisdiction; the bases are common examples that each organization edits to match what applies.
import type { ModuleContext } from '../../core/module.ts';

export const COMPLAINT_FINAL = ['closed', 'withdrawn'];
export const REPORT_DONE = ['submitted', 'accepted'];

export const CR_LISTS = [
  'civil_rights_program_type', 'civil_rights_program_status', 'civil_rights_item_status', 'civil_rights_report_type',
  'civil_rights_report_status', 'civil_rights_channel', 'civil_rights_basis', 'civil_rights_complaint_status',
  'civil_rights_outcome', 'civil_rights_goal_status',
];

export async function ensureLists(ctx: ModuleContext) {
  const own = { module: 'civilrights' };
  await ctx.lookups.ensure('civil_rights_program_type', [
    { value: 'nondiscrimination', label: 'Nondiscrimination', color: 'blue', sort: 10 },
    { value: 'accessible_service', label: 'Accessible service', color: 'teal', sort: 20 },
    { value: 'business_participation', label: 'Business participation', color: 'purple', sort: 30 },
    { value: 'equal_employment', label: 'Equal employment', color: 'amber', sort: 40 },
    { value: 'language_access', label: 'Language access', color: 'green', sort: 50 },
    { value: 'other', label: 'Other', color: 'gray', sort: 90 },
  ], own);
  await ctx.lookups.ensure('civil_rights_program_status', [
    { value: 'draft', label: 'Draft', color: 'gray', sort: 10 },
    { value: 'adopted', label: 'Adopted', color: 'green', sort: 20 },
    { value: 'update_due', label: 'Update due', color: 'amber', sort: 30 },
    { value: 'retired', label: 'Retired', color: 'gray', sort: 90, meta: { final: true } },
  ], own);
  await ctx.lookups.ensure('civil_rights_item_status', [
    { value: 'open', label: 'Not yet in place', color: 'gray', sort: 10 },
    { value: 'in_progress', label: 'In progress', color: 'blue', sort: 20 },
    { value: 'in_place', label: 'In place', color: 'green', sort: 30, meta: { done: true } },
    { value: 'needs_attention', label: 'Needs attention', color: 'red', sort: 40 },
    { value: 'not_applicable', label: 'Not applicable', color: 'gray', sort: 50, meta: { done: true } },
  ], own);
  await ctx.lookups.ensure('civil_rights_report_type', [
    { value: 'program_update', label: 'Program update', sort: 10 },
    { value: 'monitoring', label: 'Monitoring report', sort: 20 },
    { value: 'participation', label: 'Participation report', sort: 30 },
    { value: 'workforce', label: 'Workforce report', sort: 40 },
    { value: 'other', label: 'Other', sort: 90 },
  ], own);
  await ctx.lookups.ensure('civil_rights_report_status', [
    { value: 'planned', label: 'Planned', color: 'gray', sort: 10 },
    { value: 'in_preparation', label: 'In preparation', color: 'blue', sort: 20 },
    { value: 'submitted', label: 'Submitted', color: 'green', sort: 30, meta: { final: true } },
    { value: 'returned', label: 'Returned for changes', color: 'amber', sort: 40 },
    { value: 'accepted', label: 'Accepted', color: 'green', sort: 50, meta: { final: true } },
  ], own);
  await ctx.lookups.ensure('civil_rights_channel', [
    { value: 'in_person', label: 'In person', sort: 10 },
    { value: 'phone', label: 'Phone', sort: 20 },
    { value: 'email', label: 'Email', sort: 30 },
    { value: 'letter', label: 'Letter', sort: 40 },
    { value: 'web_form', label: 'Web form', sort: 50 },
    { value: 'referral', label: 'Referred by another body', sort: 60 },
    { value: 'other', label: 'Other', sort: 90 },
  ], own);
  await ctx.lookups.ensure('civil_rights_basis', [
    { value: 'race_color', label: 'Race or color', sort: 10 },
    { value: 'national_origin', label: 'National origin or language', sort: 20 },
    { value: 'disability', label: 'Disability', sort: 30 },
    { value: 'sex', label: 'Sex', sort: 40 },
    { value: 'age', label: 'Age', sort: 50 },
    { value: 'religion', label: 'Religion', sort: 60 },
    { value: 'income', label: 'Income', sort: 70 },
    { value: 'other', label: 'Other', sort: 90 },
  ], own);
  await ctx.lookups.ensure('civil_rights_complaint_status', [
    { value: 'received', label: 'Received', color: 'blue', sort: 10 },
    { value: 'acknowledged', label: 'Acknowledged', color: 'teal', sort: 20 },
    { value: 'investigating', label: 'Investigating', color: 'amber', sort: 30 },
    { value: 'findings_issued', label: 'Findings issued', color: 'purple', sort: 40 },
    { value: 'appealed', label: 'Appealed', color: 'red', sort: 50 },
    { value: 'closed', label: 'Closed', color: 'gray', sort: 60, meta: { final: true } },
    { value: 'withdrawn', label: 'Withdrawn', color: 'gray', sort: 70, meta: { final: true } },
  ], own);
  await ctx.lookups.ensure('civil_rights_outcome', [
    { value: 'substantiated', label: 'Substantiated', color: 'red', sort: 10 },
    { value: 'not_substantiated', label: 'Not substantiated', color: 'gray', sort: 20 },
    { value: 'resolved', label: 'Resolved informally', color: 'green', sort: 30 },
    { value: 'referred', label: 'Referred elsewhere', color: 'blue', sort: 40 },
    { value: 'withdrawn', label: 'Withdrawn', color: 'gray', sort: 50 },
  ], own);
  await ctx.lookups.ensure('civil_rights_goal_status', [
    { value: 'draft', label: 'Draft', color: 'gray', sort: 10 },
    { value: 'set', label: 'Set', color: 'blue', sort: 20 },
    { value: 'reported', label: 'Reported', color: 'green', sort: 30 },
  ], own);
}

/** The values this area adds to shared lists (notification kinds are seeded after this module's own lists). */
export async function sharedValues(ctx: ModuleContext) {
  if (await ctx.db.one(`select 1 from lookups where list_key = 'notification_kind' limit 1`)) {
    await ctx.lookups.ensure('notification_kind', [
      { value: 'civilrights', label: 'Civil rights', color: 'purple', sort: 81, meta: { description: 'A civil rights complaint or program report is due soon or overdue.' } },
    ]);
  }
}
