import type { ModuleContext, Row } from '../../core/module.ts';
import { takeForced, type Base, type Req } from './base.ts';
import { computeRisk, FINAL_STATUSES, matchRule, safetyImpactOf } from './rules.ts';

/** Fields that decide the approval path: fixed once the change has been submitted. */
const LOCKED_AFTER_DRAFT = ['change_type', 'risk_answers', 'risk_override', 'risk_override_reason', 'safety_impact'];

/** The `change` record type: generic CRUD plus the hooks that keep risk, approvals and status right. */
export function defineChange(ctx: ModuleContext, base: Base): void {
  /** Validates a change as it would be saved and returns the fields the module works out. */
  async function derive(merged: Row, existing?: Row): Promise<Row> {
    const errors: Record<string, string> = {};
    const out: Row = {};
    const before = (a: unknown, b: unknown) => a && b && new Date(a as string) >= new Date(b as string);
    if (before(merged.planned_start, merged.planned_end)) errors.planned_end = 'The planned end must be after the planned start.';
    if (merged.actual_start && merged.actual_end && new Date(merged.actual_end) < new Date(merged.actual_start)) {
      errors.actual_end = 'The actual end cannot be before the actual start.';
    }
    if (merged.risk_override && !String(merged.risk_override_reason ?? '').trim()) {
      errors.risk_override_reason = 'Give a reason for overriding the risk level.';
    }

    let answers = merged.risk_answers;
    if (typeof answers === 'string') {
      try { answers = JSON.parse(answers); out.risk_answers = answers; } catch { errors.risk_answers = 'The risk answers are not valid.'; answers = null; }
    }
    if (answers !== null && answers !== undefined && (typeof answers !== 'object' || Array.isArray(answers))) {
      errors.risk_answers = 'The risk answers are not valid.';
      answers = null;
    }

    if (merged.template_id) {
      // A standard change carries the risk level its template was approved with.
      out.risk_computed = merged.risk_computed ?? merged.risk_level ?? null;
    } else {
      const q = await base.questionnaire();
      for (const [key, value] of Object.entries((answers ?? {}) as Row)) {
        const question = q.questions.find((x) => x.key === key);
        if (question && value !== null && value !== '' && !question.options.some((o) => o.value === value)) {
          errors.risk_answers = `"${value}" is not an answer to "${question.label}".`;
        }
      }
      const risk = computeRisk(answers as Row, q);
      out.risk_score = risk.score;
      out.risk_computed = risk.level;
      // A safety question in the questionnaire decides whether the change affects safety (E25-11).
      const safety = safetyImpactOf(answers as Row, q);
      if (safety !== null) out.safety_impact = safety;
    }
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);

    out.risk_level = merged.risk_override || out.risk_computed;
    out.risk_override_reason = merged.risk_override ? String(merged.risk_override_reason).trim() : null;

    const rule = matchRule(await base.approvalRules(), merged.change_type, out.risk_level);
    const status = merged.status ?? 'draft';
    // A draft shows the approvals its rule asks for; once submitted the number follows its approval workflow (E05-13).
    if (!existing || status === 'draft') {
      out.approvals_required = merged.change_type === 'standard' && merged.template_id ? 0 : rule.approvals;
    }
    const outcomes = merged.outcome ? await ctx.lookups.values('change_outcome') : [];
    out.pir_required = merged.change_type === 'emergency' || rule.pir_required
      || outcomes.find((o) => o.value === merged.outcome)?.meta?.pir === true;
    return out;
  }

  ctx.defineResource({
    type: 'change',
    table: 'changes',
    module: 'changes',
    label: 'Change',
    plural: 'Changes',
    path: '/api/changes',
    route: '/changes',
    titleField: 'title',
    ref: { field: 'ref', prefix: 'CHG-' },
    searchable: ['title', 'description', 'reason'],
    defaultSort: { field: 'planned_start', dir: 'desc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Title', type: 'text', required: true },
      description: { label: 'What will be done', type: 'longtext' },
      reason: { label: 'Why it is needed', type: 'longtext' },
      change_type: { label: 'Type', type: 'lookup', list: 'change_type', default: 'normal' },
      status: { label: 'Status', type: 'lookup', list: 'change_status', readOnly: true },
      template_id: { label: 'Template', type: 'text', readOnly: true },
      template_name: { label: 'Template', type: 'text', readOnly: true },
      system_id: { label: 'Main system', type: 'ref', to: 'system' },
      asset_id: { label: 'Main asset', type: 'ref', to: 'asset' },
      risk_answers: { label: 'Risk answers', type: 'json' },
      risk_score: { label: 'Risk score', type: 'number', readOnly: true },
      risk_computed: { label: 'Risk by the questionnaire', type: 'lookup', list: 'change_risk', readOnly: true },
      risk_override: { label: 'Risk override', type: 'lookup', list: 'change_risk' },
      risk_override_reason: { label: 'Reason for override', type: 'text' },
      risk_level: { label: 'Risk', type: 'lookup', list: 'change_risk', readOnly: true },
      safety_impact: { label: 'Affects safety', type: 'boolean', default: false },
      implementation_plan: { label: 'Implementation plan', type: 'longtext' },
      test_plan: { label: 'Test plan', type: 'longtext' },
      backout_plan: { label: 'Back-out plan', type: 'longtext' },
      planned_start: { label: 'Planned start', type: 'datetime' },
      planned_end: { label: 'Planned end', type: 'datetime' },
      actual_start: { label: 'Actual start', type: 'datetime' },
      actual_end: { label: 'Actual end', type: 'datetime' },
      outcome: { label: 'Outcome', type: 'lookup', list: 'change_outcome', readOnly: true },
      outcome_notes: { label: 'Outcome notes', type: 'longtext' },
      owner_id: { label: 'Owner', type: 'user' },
      assignee_id: { label: 'Implementer', type: 'user' },
      approvals_required: { label: 'Approvals needed', type: 'number', readOnly: true },
      approvals_received: { label: 'Approvals recorded', type: 'number', readOnly: true },
      approved_retrospectively: { label: 'Approved after the fact', type: 'boolean', readOnly: true },
      submitted_at: { label: 'Submitted', type: 'datetime', readOnly: true },
      approver_pool: { label: 'Approvers named at submission', type: 'json', readOnly: true },
      pir_required: { label: 'Review required', type: 'boolean', readOnly: true },
      pir_what_happened: { label: 'What happened', type: 'longtext', readOnly: true },
      pir_cause: { label: 'Cause', type: 'longtext', readOnly: true },
      pir_follow_up: { label: 'Follow-up', type: 'longtext', readOnly: true },
      pir_completed_at: { label: 'Review recorded', type: 'datetime', readOnly: true },
      pir_completed_by_name: { label: 'Review recorded by', type: 'text', readOnly: true },
    },
    hooks: {
      async beforeCreate(req, data) {
        const system = takeForced(req) ?? {};
        const merged: Row = { ...data, ...system };
        merged.status ??= 'draft';
        if (merged.change_type === 'standard' && !merged.template_id) {
          ctx.fail(400, 'validation', 'Check the highlighted fields.', {
            change_type: 'A standard change is raised from a template. Choose a template, or pick another type.',
          });
        }
        if (req?.user) merged.owner_id ??= req.user.id;
        return { ...merged, ...(await derive(merged)) };
      },
      async beforeUpdate(req, existing, patch) {
        const system = takeForced(req);
        const changed = Object.keys(patch).filter((k) => !base.same(existing[k], patch[k]));
        if (req && changed.length) {
          if (FINAL_STATUSES.includes(existing.status)) {
            ctx.fail(409, 'closed', 'This change is closed and can no longer be edited.');
          }
          const locked = changed.filter((k) => LOCKED_AFTER_DRAFT.includes(k));
          if (locked.length && existing.status !== 'draft') {
            ctx.fail(409, 'locked', 'The type and the risk assessment decide who approves a change, so they can be edited only while it is a draft. Return it to draft first.');
          }
          if (changed.includes('change_type') && (patch.change_type === 'standard' || existing.change_type === 'standard')) {
            ctx.fail(400, 'validation', 'Check the highlighted fields.', {
              change_type: 'A standard change is raised from a template; the type cannot be switched to or from standard.',
            });
          }
        }
        const merged: Row = { ...patch, ...(system ?? {}) };
        return { ...merged, ...(await derive({ ...existing, ...merged }, existing)) };
      },
      async afterCreate(req, row) {
        await base.syncPrimaryLink(req, row.id, 'system', null, row.system_id ?? null);
        await base.syncPrimaryLink(req, row.id, 'asset', null, row.asset_id ?? null);
        if (row.risk_override) await auditOverride(req, null, row);
      },
      async afterUpdate(req, before, after) {
        await base.syncPrimaryLink(req, after.id, 'system', before.system_id ?? null, after.system_id ?? null);
        await base.syncPrimaryLink(req, after.id, 'asset', before.asset_id ?? null, after.asset_id ?? null);
        if ((before.risk_override ?? null) !== (after.risk_override ?? null)
          || (after.risk_override && before.risk_override_reason !== after.risk_override_reason)) {
          await auditOverride(req, before, after);
        }
      },
    },
  });

  async function auditOverride(req: Req, before: Row | null, after: Row) {
    await ctx.audit(req, {
      action: 'change.risk_override', recordType: 'change', recordId: after.id,
      summary: after.risk_override
        ? `Risk manually set to ${await base.lookupLabel('change_risk', after.risk_override)} (the questionnaire gives ${after.risk_computed ? await base.lookupLabel('change_risk', after.risk_computed) : 'no level yet'}): ${after.risk_override_reason}`
        : 'Risk override removed; the risk follows the questionnaire again',
      before: before ? { risk_level: before.risk_level, risk_override: before.risk_override, reason: before.risk_override_reason } : undefined,
      after: { risk_level: after.risk_level, risk_override: after.risk_override, reason: after.risk_override_reason },
    });
  }
}
