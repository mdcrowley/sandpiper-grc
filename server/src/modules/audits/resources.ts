// The record types of audits and inspections, with the rules kept in their hooks.
import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone, displayDate } from '../../core/timezone.ts';
import { addDays, addMonths } from './dates.ts';
import { closingProblems, reportGate } from './report.ts';
import { scoreArea } from './plan.ts';
import { isDataLoad } from '../../core/dataload.ts';

/** Setting: days after a finding is ready for verification that the auditor's verification is due. */
export const VERIFICATION_DAYS_SETTING = 'audits.verification_days';
export const DEFAULT_VERIFICATION_DAYS = 30;
/** The finding status meaning the fix is done and waits for the auditor's verification. */
export const AWAITING_VERIFICATION = 'awaiting_verification';

export async function verificationDays(ctx: ModuleContext): Promise<number> {
  const n = Math.round(Number(await ctx.settings.get<unknown>(VERIFICATION_DAYS_SETTING, DEFAULT_VERIFICATION_DAYS)));
  return Number.isFinite(n) && n >= 0 && n <= 365 ? n : DEFAULT_VERIFICATION_DAYS;
}

/** Record types an inspection or schedule may be about, and the permission module of each. */
export const TARGET_TYPES = ['site', 'vehicle', 'asset', 'system'] as const;

const invalid = (ctx: ModuleContext, fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

/** Checks an inspection target and works out its label; `none` (or nothing) clears it. */
export async function resolveTarget(ctx: ModuleContext, req: FastifyRequest | null, merged: Row): Promise<{ target_type: string | null; target_id: string | null; target_label: string | null }> {
  const type = merged.target_type ? String(merged.target_type) : null;
  if (!type || type === 'none') return { target_type: type, target_id: null, target_label: null };
  if (!(TARGET_TYPES as readonly string[]).includes(type)) invalid(ctx, { target_type: 'Choose a site, vehicle, asset or system, or nothing in particular.' });
  const id = merged.target_id ? String(merged.target_id) : null;
  if (!id) return { target_type: type, target_id: null, target_label: null };
  if (!UUID_RE.test(id)) invalid(ctx, { target_id: 'Choose the record to inspect.' });
  if (!ctx.resources.get(type)) invalid(ctx, { target_type: 'That kind of record is not available on this installation.' });
  const found = await ctx.resources.find(type, id, req?.user);
  if (!found) invalid(ctx, { target_id: 'The record to inspect was not found.' });
  return { target_type: type, target_id: id, target_label: (await ctx.resources.labelFor(type, id)) ?? null };
}

function checkRange(ctx: ModuleContext, merged: Row, pairs: [string, string, string][]) {
  const errors: Record<string, string> = {};
  for (const [from, to, message] of pairs) {
    if (merged[from] && merged[to] && String(merged[to]) < String(merged[from])) errors[to] = message;
  }
  if (Object.keys(errors).length) invalid(ctx, errors);
}

function wholeNumber(ctx: ModuleContext, merged: Row, field: string, min: number, max: number, message: string) {
  const v = merged[field];
  if (v === null || v === undefined || v === '') return;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) invalid(ctx, { [field]: message });
}

export function registerResources(ctx: ModuleContext) {
  /** Keeps an area's stored risk score current after a change to it (the plan works scores out afresh). */
  async function storeScore(id: string) {
    const score = await scoreArea(ctx, id);
    if (score !== null) await ctx.db.query('update audit_areas set risk_score = $2, risk_scored_at = now() where id = $1', [id, score]);
  }

  // ---------- the audit universe ----------
  ctx.defineResource({
    type: 'audit_area', table: 'audit_areas', module: 'audits', label: 'Audit area', plural: 'Audit areas',
    path: '/api/audit-areas', route: '/audits/areas', titleField: 'name',
    searchable: ['name', 'description'],
    defaultSort: { field: 'risk_score', dir: 'desc' }, // E45-13: highest risk first
    fields: {
      name: { label: 'Name', type: 'text', required: true },
      category: { label: 'Category', type: 'lookup', list: 'audit_area_category' },
      description: { label: 'What is covered', type: 'longtext', personal: false },
      cycle_months: { label: 'Audit every (months)', type: 'number' },
      last_audited_on: { label: 'Last audited', type: 'date', readOnly: true },
      next_due_on: { label: 'Next audit due', type: 'date' },
      owner_id: { label: 'Owner', type: 'user' },
      risk_level: { label: 'Risk level', type: 'lookup', list: 'audit_risk_level' },
      // Risk factors of the risk-ranked plan (E45-13); the score is worked out (plan.ts).
      significance: { label: 'Significance', type: 'lookup', list: 'audit_significance' },
      change_level: { label: 'Change since the last audit', type: 'lookup', list: 'audit_change_level' },
      risk_score: { label: 'Risk score', type: 'number', readOnly: true },
      active: { label: 'In the audit plan', type: 'boolean', default: true },
    },
    hooks: {
      beforeCreate: (_req, data) => {
        wholeNumber(ctx, data, 'cycle_months', 1, 120, 'Give a whole number of months from 1 to 120.');
        return data;
      },
      afterCreate: async (_req, row) => { await storeScore(row.id); },
      afterUpdate: async (_req, _before, after) => { await storeScore(after.id); },
      beforeUpdate: (_req, existing, patch) => {
        const merged = { ...existing, ...patch };
        wholeNumber(ctx, merged, 'cycle_months', 1, 120, 'Give a whole number of months from 1 to 120.');
        // A new cycle moves the next due date on from the last audit, unless a date is given too.
        if ('cycle_months' in patch && !('next_due_on' in patch) && merged.last_audited_on && merged.cycle_months) {
          patch.next_due_on = addMonths(String(merged.last_audited_on), Number(merged.cycle_months));
        }
        return patch;
      },
    },
  });

  // ---------- audit engagements ----------
  async function auditRules(req: FastifyRequest | null, existing: Row | null, patch: Row): Promise<Row> {
    const merged = { ...(existing ?? {}), ...patch };
    // The plan year is shown as text (no thousands separator) but kept as a whole number.
    wholeNumber(ctx, merged, 'plan_year', 2000, 2100, 'Give the year the audit is planned for, such as 2027.');
    if ('plan_year' in patch) patch.plan_year = patch.plan_year === null || patch.plan_year === '' ? null : Number(patch.plan_year);
    checkRange(ctx, merged, [
      ['planned_start', 'planned_end', 'The planned end must be on or after the planned start.'],
      ['fieldwork_start', 'fieldwork_end', 'The end of fieldwork must be on or after its start.'],
    ]);
    if ('team_ids' in patch && patch.team_ids !== null) {
      const ids = patch.team_ids;
      if (!Array.isArray(ids) || ids.length > 50 || ids.some((id) => typeof id !== 'string' || !UUID_RE.test(id))) {
        invalid(ctx, { team_ids: 'The audit team is a list of people.' });
      }
      patch.team_ids = [...new Set(ids as string[])];
    }
    if (merged.template_id) {
      const t = await ctx.db.one<Row>('select kind from checklist_templates where id = $1 and deleted_at is null', [merged.template_id]);
      if ('template_id' in patch && t && t.kind !== 'audit') invalid(ctx, { template_id: 'Choose an audit checklist, not an inspection checklist.' });
    }
    const from = existing?.status ?? null;
    const to = 'status' in patch ? patch.status : from;
    if (to !== from) {
      const today = dayInZone();
      if (to === 'fieldwork' && !merged.fieldwork_start) patch.fieldwork_start = today;
      if (to === 'reporting' && !merged.fieldwork_end) patch.fieldwork_end = today;
      if (to === 'closed') {
        // People close an audit only with a report summary, a response or plan on every finding and,
        // where an Audit report approval workflow is set up, its approval. The approval itself closes
        // the audit as system work (req null), after the same checks were made when it was asked for.
        if (req && existing && !isDataLoad(req)) {
          const problems = await closingProblems(ctx, { ...merged, id: existing.id });
          if (problems.length) ctx.fail(400, 'validation', problems.join(' '), { status: problems[0] });
          const gate = await reportGate(ctx, existing.id);
          if (gate.required && !gate.approved) {
            ctx.fail(409, 'approval_required', gate.running
              ? 'The audit report is waiting for approval; the audit closes when it is approved.'
              : 'Ask for the audit report to be approved (Approval tab); the audit closes when it is approved.');
          }
        }
        patch.closed_on = today;
      } else if (from === 'closed') {
        patch.closed_on = null;
      }
    }
    return patch;
  }

  ctx.defineResource({
    type: 'audit_engagement', table: 'audits', module: 'audits', label: 'Audit engagement', plural: 'Audit engagements',
    path: '/api/audits', route: '/audits/engagements', titleField: 'title',
    ref: { field: 'ref', prefix: 'AUD-' },
    restricted: 'flag',
    searchable: ['title', 'scope', 'criteria', 'report_summary'],
    defaultSort: { field: 'planned_start', dir: 'desc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Title', type: 'text', required: true },
      audit_type: { label: 'Type', type: 'lookup', list: 'audit_type', required: true },
      area_id: { label: 'Audit area', type: 'ref', to: 'audit_area' },
      plan_year: { label: 'Plan year', type: 'text', personal: false },
      scope: { label: 'Scope', type: 'longtext', personal: false },
      criteria: { label: 'Criteria', type: 'longtext', personal: false },
      template_id: { label: 'Checklist', type: 'ref', to: 'checklist_template' },
      auditee_id: { label: 'Auditee', type: 'user' },
      lead_auditor_id: { label: 'Lead auditor', type: 'user' },
      team_ids: { label: 'Audit team', type: 'json', personal: true },
      planned_start: { label: 'Planned start', type: 'date' },
      planned_end: { label: 'Planned end', type: 'date' },
      fieldwork_start: { label: 'Fieldwork started', type: 'date' },
      fieldwork_end: { label: 'Fieldwork ended', type: 'date' },
      status: { label: 'Status', type: 'lookup', list: 'audit_status', default: 'planned' },
      report_summary: { label: 'Report summary', type: 'longtext' },
      opinion: { label: 'Overall opinion', type: 'lookup', list: 'audit_opinion' },
      report_approved_on: { label: 'Report approved', type: 'date', readOnly: true },
      report_approved_by_name: { label: 'Report approved by', type: 'text', readOnly: true },
      closed_on: { label: 'Closed', type: 'date', readOnly: true },
      restricted: { label: 'Restricted', type: 'boolean', default: false },
    },
    hooks: {
      beforeCreate: (req, data) => auditRules(req, null, data),
      beforeUpdate: (req, existing, patch) => auditRules(req, existing, patch),
      afterUpdate: async (_req, before, after) => {
        // Closing an audit records when its area was last audited, and when the next one is due.
        if (after.status === 'closed' && before.status !== 'closed' && after.area_id && ctx.resources.get('audit_area')) {
          const area = await ctx.db.one<Row>('select id, cycle_months from audit_areas where id = $1 and deleted_at is null', [after.area_id]);
          if (area) {
            const on = String(after.fieldwork_end ?? after.closed_on ?? dayInZone());
            await ctx.resources.update('audit_area', area.id, {
              last_audited_on: on, ...(area.cycle_months ? { next_due_on: addMonths(on, Number(area.cycle_months)) } : {}),
            }, null);
          }
        }
      },
    },
  });

  // ---------- checklist templates ----------
  ctx.defineResource({
    type: 'checklist_template', table: 'checklist_templates', module: 'audits', label: 'Checklist template', plural: 'Checklist templates',
    path: '/api/checklist-templates', route: '/audits/templates', titleField: 'name',
    searchable: ['name', 'description'],
    defaultSort: { field: 'name', dir: 'asc' },
    fields: {
      name: { label: 'Name', type: 'text', required: true },
      kind: { label: 'Used for', type: 'lookup', list: 'checklist_kind', required: true, default: 'inspection' },
      target_type: { label: 'Inspects', type: 'lookup', list: 'inspection_target_type' },
      description: { label: 'Description', type: 'longtext', personal: false },
      version: { label: 'Version', type: 'number', readOnly: true },
      active: { label: 'Active', type: 'boolean', default: true },
    },
  });

  // ---------- inspection schedules ----------
  async function scheduleRules(req: FastifyRequest | null, existing: Row | null, patch: Row): Promise<Row> {
    const merged = { ...(existing ?? {}), ...patch };
    if ('template_id' in patch) {
      const t = await ctx.db.one<Row>('select name, kind, target_type from checklist_templates where id = $1 and deleted_at is null', [patch.template_id]);
      if (!t) invalid(ctx, { template_id: 'Choose a checklist.' });
      if (t!.kind !== 'inspection') invalid(ctx, { template_id: 'Choose an inspection checklist, not an audit checklist.' });
      if (!merged.target_type && t!.target_type) patch.target_type = merged.target_type = t!.target_type;
    }
    if ('target_type' in patch || 'target_id' in patch || !existing) Object.assign(patch, await resolveTarget(ctx, req, merged));
    if (!existing && !patch.next_due_on) invalid(ctx, { next_due_on: 'Give the date the first inspection is due.' });
    if (!merged.name || (!existing && !patch.name)) {
      const t = await ctx.db.one<Row>('select name from checklist_templates where id = $1', [merged.template_id]);
      const label = patch.target_label ?? merged.target_label;
      patch.name = [t?.name, label].filter(Boolean).join(': ') || 'Inspection schedule';
    }
    return patch;
  }

  ctx.defineResource({
    type: 'inspection_schedule', table: 'inspection_schedules', module: 'audits', label: 'Inspection schedule', plural: 'Inspection schedules',
    path: '/api/inspection-schedules', route: '/inspections/schedules', titleField: 'name',
    // Role grants scoped to departments or sites (E41-01, core/scope.ts).
    scope: { site: (col) => `case when ${col('target_type')} = 'site' then ${col('target_id')} end` },
    searchable: ['name', 'target_label'],
    defaultSort: { field: 'next_due_on', dir: 'asc' },
    fields: {
      name: { label: 'Name', type: 'text' },
      template_id: { label: 'Checklist', type: 'ref', to: 'checklist_template', required: true },
      target_type: { label: 'Inspects', type: 'lookup', list: 'inspection_target_type' },
      target_id: { label: 'Record inspected', type: 'text', personal: false },
      target_label: { label: 'Inspected', type: 'text', readOnly: true, personal: false },
      frequency: { label: 'Frequency', type: 'lookup', list: 'inspection_frequency', required: true, default: 'monthly' },
      next_due_on: { label: 'Next due', type: 'date' },
      assignee_id: { label: 'Inspector', type: 'user' },
      active: { label: 'Active', type: 'boolean', default: true },
    },
    hooks: {
      beforeCreate: (req, data) => scheduleRules(req, null, data),
      beforeUpdate: (req, existing, patch) => scheduleRules(req, existing, patch),
    },
  });

  // ---------- inspections ----------
  async function inspectionRules(req: FastifyRequest | null, existing: Row | null, patch: Row): Promise<Row> {
    const merged = { ...(existing ?? {}), ...patch };
    if ('template_id' in patch) {
      if (existing) invalid(ctx, { template_id: 'The checklist of an inspection cannot be changed. Create a new inspection instead.' });
      const t = await ctx.db.one<Row>('select name, kind, target_type from checklist_templates where id = $1 and deleted_at is null', [patch.template_id]);
      if (!t) invalid(ctx, { template_id: 'Choose a checklist.' });
      if (t!.kind !== 'inspection') invalid(ctx, { template_id: 'Choose an inspection checklist, not an audit checklist.' });
      if (!merged.target_type && t!.target_type) patch.target_type = merged.target_type = t!.target_type;
    }
    if ('target_type' in patch || 'target_id' in patch || !existing) Object.assign(patch, await resolveTarget(ctx, req, merged));
    if (req && 'status' in patch && patch.status !== existing?.status) {
      if (patch.status === 'complete') invalid(ctx, { status: 'Complete the inspection from its checklist, which works out the result.' });
      if (existing?.status === 'complete') invalid(ctx, { status: 'A completed inspection cannot be reopened.' });
    }
    if (!merged.title) {
      const t = await ctx.db.one<Row>('select name from checklist_templates where id = $1', [merged.template_id]);
      patch.title = [t?.name, patch.target_label ?? merged.target_label].filter(Boolean).join(': ') || 'Inspection';
    }
    return patch;
  }

  ctx.defineResource({
    type: 'inspection', table: 'inspections', module: 'audits', label: 'Inspection', plural: 'Inspections',
    path: '/api/inspections', route: '/inspections', titleField: 'title',
    // Role grants scoped to departments or sites (E41-01, core/scope.ts).
    scope: { site: (col) => `case when ${col('target_type')} = 'site' then ${col('target_id')} end` },
    ref: { field: 'ref', prefix: 'INS-' },
    searchable: ['title', 'target_label', 'notes'],
    defaultSort: { field: 'due_on', dir: 'desc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Title', type: 'text' },
      template_id: { label: 'Checklist', type: 'ref', to: 'checklist_template', required: true },
      schedule_id: { label: 'Schedule', type: 'ref', to: 'inspection_schedule', readOnly: true },
      target_type: { label: 'Inspects', type: 'lookup', list: 'inspection_target_type' },
      target_id: { label: 'Record inspected', type: 'text', personal: false },
      target_label: { label: 'Inspected', type: 'text', readOnly: true, personal: false },
      inspector_id: { label: 'Inspector', type: 'user' },
      due_on: { label: 'Due', type: 'date' },
      performed_on: { label: 'Performed', type: 'date', readOnly: true },
      status: { label: 'Status', type: 'lookup', list: 'inspection_status', default: 'scheduled' },
      result: { label: 'Result', type: 'lookup', list: 'inspection_result', readOnly: true },
      score_pct: { label: 'Score (%)', type: 'number', readOnly: true },
      notes: { label: 'Notes', type: 'longtext' },
      // The signature of completion (E38-11): the signer's name and when; the drawing is a file on the inspection.
      signed_by_name: { label: 'Signed by', type: 'text', readOnly: true, personal: true },
      signed_at: { label: 'Signed', type: 'datetime', readOnly: true },
    },
    hooks: {
      beforeCreate: (req, data) => inspectionRules(req, null, data),
      beforeUpdate: (req, existing, patch) => inspectionRules(req, existing, patch),
    },
  });

  // ---------- findings ----------
  async function findingRules(req: FastifyRequest | null, existing: Row | null, patch: Row): Promise<Row> {
    const merged = { ...(existing ?? {}), ...patch };
    if (!existing || 'source_type' in patch || 'source_id' in patch) {
      if (existing && (merged.source_type !== existing.source_type || String(merged.source_id) !== String(existing.source_id))) {
        invalid(ctx, { source_id: 'A finding stays with the audit or inspection it was raised on.' });
      }
      const type = String(merged.source_type ?? '');
      if (type !== 'audit_engagement' && type !== 'inspection') invalid(ctx, { source_type: 'A finding is raised on an audit or an inspection.' });
      const table = type === 'audit_engagement' ? 'audits' : 'inspections';
      const id = String(merged.source_id ?? '');
      if (!UUID_RE.test(id) || !(await ctx.db.one(`select 1 from ${table} where id = $1 and deleted_at is null`, [id]))) {
        invalid(ctx, { source_id: `The ${type === 'inspection' ? 'inspection' : 'audit'} was not found.` });
      }
    }
    const responded = (v: unknown) => typeof v === 'string' && v.trim() !== '';
    if ('management_response' in patch && responded(patch.management_response) && !merged.responded_on) {
      patch.responded_on = dayInZone();
      if ((merged.status ?? 'open') === 'open') patch.status = 'responded';
    }
    // Verification before closing (E45-16): a person closes a finding only once an auditor has recorded
    // the verification (POST /api/audit-findings/:id/verify does both). System work and data loads
    // follow their own data.
    const from = existing?.status ?? null;
    const to = 'status' in patch ? patch.status : from;
    if (req && !isDataLoad(req) && to !== from) {
      const closed = (await ctx.lookups.values('finding_status')).filter((v) => v.meta?.closed === true).map((v) => v.value);
      if ((closed.length ? closed : ['closed']).includes(String(to)) && !merged.verified_on) {
        invalid(ctx, { status: 'An auditor records the verification (date, note and evidence) before the finding is closed: use Verify and close.' });
      }
    }
    if (to === AWAITING_VERIFICATION && to !== from) {
      if (!merged.verification_due && !(isDataLoad(req) && 'verification_due' in patch)) patch.verification_due = addDays(dayInZone(), await verificationDays(ctx));
    }
    // The auditor who verifies: the audit's lead auditor unless they own the response.
    if (!merged.verifier_id && (!existing || to === AWAITING_VERIFICATION) && merged.source_type === 'audit_engagement' && merged.source_id) {
      const lead = (await ctx.db.one<Row>('select lead_auditor_id from audits where id = $1', [merged.source_id]))?.lead_auditor_id;
      if (lead && lead !== merged.response_owner_id) patch.verifier_id = lead;
    }
    if ('verifier_id' in patch && patch.verifier_id && patch.verifier_id === merged.response_owner_id && req && !isDataLoad(req)) {
      invalid(ctx, { verifier_id: 'The auditor who verifies the fix cannot be the person who owns the response.' });
    }
    return patch;
  }

  ctx.defineResource({
    type: 'audit_finding', table: 'audit_findings', module: 'audits', label: 'Audit finding', plural: 'Audit findings',
    path: '/api/audit-findings', route: '/audit-findings', titleField: 'title',
    ref: { field: 'ref', prefix: 'FND-' },
    restricted: 'flag', restrictedFrom: { typeField: 'source_type', idField: 'source_id' },
    searchable: ['title', 'criteria', 'condition', 'cause', 'effect', 'recommendation', 'management_response'],
    defaultSort: { field: 'created_at', dir: 'desc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Finding', type: 'text', required: true },
      source_type: { label: 'Raised on', type: 'text', required: true, personal: false },
      source_id: { label: 'Audit or inspection', type: 'text', required: true, personal: false },
      item_id: { label: 'Checklist item', type: 'text', readOnly: true, personal: false },
      rating: { label: 'Rating', type: 'lookup', list: 'finding_rating', required: true, default: 'observation' },
      criteria: { label: 'Criteria (what should be)', type: 'longtext', personal: false },
      condition: { label: 'Condition (what was found)', type: 'longtext' },
      cause: { label: 'Cause', type: 'longtext' },
      effect: { label: 'Effect (risk or consequence)', type: 'longtext' },
      recommendation: { label: 'Recommendation', type: 'longtext' },
      management_response: { label: 'Management response', type: 'longtext' },
      response_owner_id: { label: 'Response owner', type: 'user' },
      response_due: { label: 'Response due', type: 'date' },
      responded_on: { label: 'Responded', type: 'date', readOnly: true },
      status: { label: 'Status', type: 'lookup', list: 'finding_status', default: 'open' },
      cap_id: { label: 'Corrective action plan', type: 'ref', to: 'cap', readOnly: true },
      hazard_id: { label: 'Hazard', type: 'ref', to: 'hazard', readOnly: true },
      // The auditor's verification of the fix (E45-16): recorded with POST /api/audit-findings/:id/verify.
      verifier_id: { label: 'Auditor to verify', type: 'user' },
      verification_due: { label: 'Verification due', type: 'date' },
      verified_on: { label: 'Verified on', type: 'date', readOnly: true },
      verified_by: { label: 'Verification recorded by', type: 'user', readOnly: true },
      verified_by_name: { label: 'Verified by', type: 'text', readOnly: true, personal: true },
      verification_note: { label: 'Verification', type: 'longtext', readOnly: true },
      verification_attachment_ids: { label: 'Verification files', type: 'json', readOnly: true, personal: false },
      verification_evidence_ids: { label: 'Verification evidence items', type: 'json', readOnly: true, personal: false },
      restricted: { label: 'Restricted', type: 'boolean', readOnly: true },
    },
    hooks: {
      beforeCreate: (req, data) => findingRules(req, null, data),
      beforeUpdate: (req, existing, patch) => findingRules(req, existing, patch),
    },
  });

  // ---------- evidence requests ----------
  ctx.defineResource({
    type: 'audit_request', table: 'audit_requests', module: 'audits', label: 'Evidence request', plural: 'Evidence requests',
    path: '/api/audit-requests', route: '/audits/requests', titleField: 'request',
    ref: { field: 'ref', prefix: 'REQ-' },
    restricted: 'flag', restrictedFrom: { typeField: 'source_type', idField: 'audit_id' },
    searchable: ['request', 'response_note'],
    defaultSort: { field: 'due_on', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      audit_id: { label: 'Audit', type: 'ref', to: 'audit_engagement', required: true },
      source_type: { label: 'Source type', type: 'text', readOnly: true, personal: false },
      request: { label: 'What is asked for', type: 'longtext', required: true, personal: false },
      owner_id: { label: 'Asked of', type: 'user' },
      due_on: { label: 'Due', type: 'date' },
      status: { label: 'Status', type: 'lookup', list: 'audit_request_status', default: 'requested' },
      response_note: { label: 'Response', type: 'longtext' },
      provided_at: { label: 'Provided', type: 'datetime', readOnly: true },
      restricted: { label: 'Restricted', type: 'boolean', readOnly: true },
    },
    hooks: {
      beforeCreate: (_req, data) => ({ ...data, source_type: 'audit_engagement' }),
      beforeUpdate: (_req, existing, patch) => {
        if ('audit_id' in patch && String(patch.audit_id) !== String(existing.audit_id)) {
          invalid(ctx, { audit_id: 'An evidence request stays with its audit.' });
        }
        if (patch.status === 'provided' && !existing.provided_at) patch.provided_at = new Date().toISOString();
        return patch;
      },
      afterCreate: async (_req, row) => {
        if (!row.owner_id || !ctx.app.hasDecorator('notify')) return;
        // The person asked may not be able to open audits, so the notice names only the request's
        // reference and leads to their own list of requests.
        await ctx.app.notify({
          userIds: [row.owner_id], kind: 'audits', route: '/audits/my-requests',
          title: `Evidence requested from you: ${row.ref}`,
          body: row.due_on ? `Please provide it by ${displayDate(String(row.due_on))}.` : 'Open your evidence requests to answer it.',
          once: `audit_request.new:${row.id}`,
        });
      },
    },
  });


}
