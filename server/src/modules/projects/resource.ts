import type { ModuleContext, Row } from '../../core/module.ts';
import { actorOf, isDataLoad } from '../../core/dataload.ts';
import { departmentPrepare } from '../../core/scope.ts';
import { takeForced, type ProjectService } from './service.ts';

/** The `project` record type: generic CRUD plus the hooks that keep tier, score and gates right. */
export function defineProject(ctx: ModuleContext, svc: ProjectService): void {
  ctx.defineResource({
    type: 'project',
    table: 'projects',
    module: 'projects',
    label: 'Project',
    plural: 'Projects',
    path: '/api/projects',
    // Role grants scoped to departments or sites (E41-01, core/scope.ts).
    scope: { department: 'department_id' },
    route: '/projects',
    titleField: 'name',
    ref: { field: 'ref', prefix: 'PRJ-' },
    searchable: ['name', 'description', 'sponsor', 'department'],
    defaultSort: { field: 'created_at', dir: 'desc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      name: { label: 'Name', type: 'text', required: true },
      description: { label: 'What is needed and why', type: 'longtext' },
      expected_benefits: { label: 'Expected benefits', type: 'longtext' },
      sponsor: { label: 'Sponsor', type: 'text' },
      sponsor_id: { label: 'Sponsor (user)', type: 'user' },
      project_manager_id: { label: 'Project manager', type: 'user' },
      system_owner: { label: 'System owner', type: 'text' },
      system_owner_id: { label: 'System owner (user)', type: 'user' },
      // E41-01: a reference to the organization's departments; `department` keeps its name (set by the database).
      department_id: { label: 'Department', type: 'ref', to: 'department' },
      department: { label: 'Department name', type: 'text', readOnly: true },
      tier: { label: 'Tier', type: 'lookup', list: 'project_tier', readOnly: true },
      tier_computed: { label: 'Tier by the rules', type: 'lookup', list: 'project_tier', readOnly: true },
      tier_override: { label: 'Tier override', type: 'lookup', list: 'project_tier' },
      tier_override_reason: { label: 'Reason for override', type: 'text' },
      stage: { label: 'Stage', type: 'lookup', list: 'project_stage', readOnly: true },
      status: { label: 'Status', type: 'lookup', list: 'project_status', default: 'active' },
      budget: { label: 'Budget', type: 'currency' },
      spend_to_date: { label: 'Spend to date', type: 'currency' },
      funding_source: { label: 'Funding source', type: 'lookup', list: 'project_funding_source' },
      start_on: { label: 'Start date', type: 'date' },
      target_on: { label: 'Target date', type: 'date' },
      touches_payment: { label: 'Touches payment', type: 'boolean', default: false },
      touches_personal_data: { label: 'Touches personal data', type: 'boolean', default: false },
      touches_operational_systems: { label: 'Touches operational systems', type: 'boolean', default: false },
      security_impact: { label: 'Security impact', type: 'longtext' },
      data_impact: { label: 'Data impact', type: 'longtext' },
      vendor_id: { label: 'Vendor', type: 'ref', to: 'vendor' },
      contract_id: { label: 'Contract', type: 'ref', to: 'contract' },
      systems_affected: { label: 'Systems affected', type: 'json' },
      requested_by: { label: 'Requested by', type: 'user', readOnly: true },
      scoring: { label: 'Scores', type: 'json' },
      priority_score: { label: 'Priority score', type: 'number', readOnly: true },
      rag_overall: { label: 'Overall', type: 'lookup', list: 'rag_rating', readOnly: true },
      rag_schedule: { label: 'Schedule', type: 'lookup', list: 'rag_rating', readOnly: true },
      rag_budget: { label: 'Budget rating', type: 'lookup', list: 'rag_rating', readOnly: true },
      rag_risk: { label: 'Risk rating', type: 'lookup', list: 'rag_rating', readOnly: true },
      rag_trend: { label: 'Trend', type: 'lookup', list: 'project_rag_trend', readOnly: true },
      last_report_on: { label: 'Last status report', type: 'date', readOnly: true },
    },
    hooks: {
      // A department may still be given by name (`department` or `department_id`), as before E41-01.
      prepare: departmentPrepare(ctx.db),
      async beforeCreate(req, data) {
        data.stage ??= 'idea'; // intake: a new request starts as an idea
        if (req?.user) data.requested_by = isDataLoad(req) && data.requested_by ? data.requested_by : actorOf(req).id;
        return { ...data, ...(await svc.derive(req, data)) };
      },
      async beforeUpdate(req, existing, patch) {
        const merged: Row = { ...patch, ...(takeForced(req) ?? {}) };
        return { ...merged, ...(await svc.derive(req, { ...existing, ...merged }, merged)) };
      },
      async afterCreate(req, row) {
        if (row.tier_override) await auditOverride(req, null, row);
        await svc.openGate(row, req);
      },
      async afterUpdate(req, before, after) {
        if ((before.tier_override ?? null) !== (after.tier_override ?? null) || (after.tier_override && before.tier_override_reason !== after.tier_override_reason)) {
          await auditOverride(req, before, after);
        }
        if (before.stage !== after.stage) await svc.openGate(after, req);
        // E41-08: the project's certifiable items and requirements carry its department (access scope).
        if ((before.department_id ?? null) !== (after.department_id ?? null)) {
          for (const table of ['project_cert_items', 'project_cert_requirements']) {
            await ctx.db.query(`update ${table} set department_id = $2 where project_id = $1`, [after.id, after.department_id ?? null]);
          }
        }
        if (after.rag_overall === 'red' && before.rag_overall !== 'red') await svc.notifyTurnedRed(after);
      },
    },
  });

  async function auditOverride(req: Parameters<ModuleContext['audit']>[0], before: Row | null, after: Row) {
    await ctx.audit(req, {
      action: 'project.tier_override', recordType: 'project', recordId: after.id,
      summary: after.tier_override
        ? `Tier manually set to ${String(after.tier_override).replace('tier_', 'Tier ')} (the rules give ${String(after.tier_computed).replace('tier_', 'Tier ')}): ${after.tier_override_reason}`
        : 'Tier override removed; the tier follows the rules again',
      before: before ? { tier: before.tier, tier_override: before.tier_override, reason: before.tier_override_reason } : undefined,
      after: { tier: after.tier, tier_override: after.tier_override, reason: after.tier_override_reason },
    });
  }
}
