import type { ModuleContext } from '../../core/module.ts';
import { DEFAULT_GATES } from './rules.ts';

/** Lookup lists and gate templates. Runs at every start; never overwrites what an administrator changed. */
export async function seedProjectDefaults(ctx: ModuleContext): Promise<void> {
  await ctx.lookups.ensure('project_stage', [
    { value: 'idea', label: 'Idea', color: 'gray', sort: 10 },
    { value: 'initiate', label: 'Initiate', color: 'blue', sort: 20 },
    { value: 'plan', label: 'Plan', color: 'teal', sort: 30 },
    { value: 'procure', label: 'Procure', color: 'purple', sort: 40 },
    { value: 'deliver', label: 'Deliver', color: 'amber', sort: 50 },
    { value: 'close', label: 'Close', color: 'green', sort: 60 },
  ], { module: 'projects' });
  await ctx.lookups.ensure('project_status', [
    { value: 'active', label: 'Active', color: 'blue', sort: 10 },
    { value: 'on_hold', label: 'On hold', color: 'amber', sort: 20 },
    { value: 'cancelled', label: 'Cancelled', color: 'gray', sort: 30 },
    { value: 'completed', label: 'Completed', color: 'green', sort: 40 },
  ], { module: 'projects' });
  await ctx.lookups.ensure('project_tier', [
    { value: 'tier_1', label: 'Tier 1', color: 'red', sort: 10 },
    { value: 'tier_2', label: 'Tier 2', color: 'amber', sort: 20 },
    { value: 'tier_3', label: 'Tier 3', color: 'teal', sort: 30 },
  ], { module: 'projects' });
  await ctx.lookups.ensure('rag_rating', [
    { value: 'green', label: 'Green', color: 'green', sort: 10 },
    { value: 'amber', label: 'Amber', color: 'amber', sort: 20 },
    { value: 'red', label: 'Red', color: 'red', sort: 30 },
  ], { module: 'projects' });
  await ctx.lookups.ensure('project_rag_trend', [
    { value: 'improving', label: 'Improving', color: 'green', sort: 10 },
    { value: 'steady', label: 'Steady', color: 'gray', sort: 20 },
    { value: 'worsening', label: 'Worsening', color: 'red', sort: 30 },
  ], { module: 'projects' });
  await ctx.lookups.ensure('project_funding_source', [
    { value: 'operating', label: 'Operating budget', color: 'blue', sort: 10 },
    { value: 'capital', label: 'Capital budget', color: 'purple', sort: 20 },
    { value: 'grant', label: 'Grant or outside funder', color: 'teal', sort: 30 },
    { value: 'other', label: 'Other', color: 'gray', sort: 50 },
  ], { module: 'projects' });
  await ctx.lookups.ensure('project_item_kind', [
    { value: 'risk', label: 'Risk', color: 'red', sort: 10 },
    { value: 'issue', label: 'Issue', color: 'orange', sort: 20 },
    { value: 'decision', label: 'Decision', color: 'blue', sort: 30 },
    { value: 'change_request', label: 'Change request', color: 'purple', sort: 40 },
  ], { module: 'projects' });
  await ctx.lookups.ensure('project_item_status', [
    { value: 'open', label: 'Open', color: 'blue', sort: 10 },
    { value: 'in_progress', label: 'In progress', color: 'amber', sort: 20 },
    { value: 'approved', label: 'Approved', color: 'green', sort: 30 },
    { value: 'rejected', label: 'Rejected', color: 'red', sort: 40 },
    { value: 'closed', label: 'Closed', color: 'gray', sort: 50 },
  ], { module: 'projects' });
  await ctx.lookups.ensure('project_gate_status', [
    { value: 'open', label: 'Open', color: 'blue', sort: 10 },
    { value: 'approved', label: 'Approved', color: 'green', sort: 20 },
    { value: 'deferred', label: 'Deferred', color: 'amber', sort: 30 },
    { value: 'rejected', label: 'Rejected', color: 'red', sort: 40 },
    { value: 'reopened', label: 'Reopened', color: 'purple', sort: 50 },
  ], { module: 'projects' });

  for (const [i, g] of DEFAULT_GATES.entries()) {
    const made = await ctx.db.one<{ id: string }>(
      `insert into project_gate_defs (key, name, from_stage, to_stage, sort, required_documents, approvers, wants_change)
       values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8) on conflict (key) do nothing returning id`,
      [
        g.key, g.name, g.from, g.to, (i + 1) * 10,
        JSON.stringify(g.documents.map((name) => ({ name, required: true }))), JSON.stringify(g.approvers), g.wantsChange === true,
      ],
    );
    if (!made) continue; // already there: leave the administrator's version alone
    for (const [n, label] of g.checklist.entries()) {
      await ctx.db.query(
        'insert into project_gate_def_items (gate_def_id, label, sort) values ($1,$2,$3)', [made.id, label, (n + 1) * 10]);
    }
  }
}
