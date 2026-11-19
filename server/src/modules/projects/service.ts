import type { FastifyRequest } from 'fastify';
import { ApiError, UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, ResourceDef, Row, SessionUser } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import {
  approvalBlockers, computeScore, computeTier, DEFAULT_CRITERIA, DEFAULT_TIERS, DEFAULT_WIP_LIMIT, MAX_SCORE, missingDocuments,
  RAG_VALUES, ragTrend, reportDue, templateDocuments,
  type Criterion, type GateDocument, type TierThresholds,
} from './rules.ts';

type Req = FastifyRequest | null;

export const SETTING_TIERS = 'projects.tier_thresholds';
export const SETTING_CRITERIA = 'projects.scoring_criteria';
export const SETTING_WIP = 'projects.wip_limit';
export const SETTING_INTAKE = 'projects.intake_open_to';
export const SETTING_REPORT_DAYS = 'projects.report_interval_days';

/** Who may submit a project request: people who may create projects, people who may view them, or everyone signed in. */
export const INTAKE_CHOICES = ['create', 'view', 'everyone'];
export const DEFAULT_REPORT_DAYS = 30;
/** What a request form may set; everything else is decided later by the project team. */
export const REQUEST_FIELDS = [
  'name', 'description', 'expected_benefits', 'sponsor', 'department', 'budget', 'funding_source', 'target_on',
  'touches_payment', 'touches_personal_data', 'touches_operational_systems', 'systems_affected',
];

export const DECISIONS = ['approved', 'rejected', 'deferred'];
/** The stage in which work in progress is counted against the limit. */
export const DELIVERY_STAGE = 'deliver';

/**
 * Values the module itself sets on read-only project fields (stage, latest ratings) during a
 * user's request. The resource engine drops read-only fields from user input, so the
 * beforeUpdate hook picks them up from here; the change is still validated, audited and
 * attributed to the user.
 */
const forced = new WeakMap<object, Row>();

export function takeForced(req: Req): Row | undefined {
  if (!req) return undefined;
  const patch = forced.get(req);
  forced.delete(req);
  return patch;
}

export function today(): string {
  return todayInZone();
}

const IDENT = /^[a-z_][a-z0-9_]*$/;

export function makeService(ctx: ModuleContext) {
  const { db } = ctx;

  // ---------- small helpers ----------

  function checker(body: Row | undefined, partial: boolean) {
    const errors: Record<string, string> = {};
    const out: Row = {};
    const raw = (name: string, label: string, required: boolean): unknown => {
      let v = body?.[name];
      if (typeof v === 'string') v = v.trim();
      if (v === undefined) {
        if (!partial && required) errors[name] = `${label} is required.`;
        return undefined;
      }
      if (v === null || v === '') {
        if (required) errors[name] = `${label} is required.`; else out[name] = null;
        return undefined;
      }
      return v;
    };
    return {
      out,
      errors,
      text(name: string, label: string, required = false) {
        const v = raw(name, label, required);
        if (v !== undefined) out[name] = String(v);
      },
      date(name: string, label: string, required = false) {
        const v = raw(name, label, required);
        if (v === undefined) return;
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !Number.isNaN(Date.parse(String(v)))) out[name] = String(v);
        else errors[name] = `${label} must be a date (YYYY-MM-DD).`;
      },
      int(name: string, label: string, min: number, max: number, required = false) {
        const v = raw(name, label, required);
        if (v === undefined) return;
        const n = Number(v);
        if (Number.isInteger(n) && n >= min && n <= max) out[name] = n;
        else errors[name] = `${label} must be a whole number from ${min} to ${max}.`;
      },
      oneOf(name: string, label: string, allowed: string[], required = false) {
        const v = raw(name, label, required);
        if (v === undefined) return;
        if (allowed.includes(String(v))) out[name] = String(v);
        else errors[name] = `${label}: "${v}" is not an allowed value.`;
      },
      uuid(name: string, label: string) {
        const v = raw(name, label, false);
        if (v === undefined) return;
        if (UUID_RE.test(String(v))) out[name] = String(v); else errors[name] = `${label} is not a valid reference.`;
      },
      bool(name: string, label: string) {
        const v = raw(name, label, false);
        if (v === undefined) return;
        if (typeof v === 'boolean') out[name] = v;
        else if (v === 'true' || v === 'false') out[name] = v === 'true';
        else errors[name] = `${label} must be yes or no.`;
      },
      finish(): Row {
        if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
        return out;
      },
    };
  }

  function sqlParts(data: Row, startAt = 1) {
    const cols: string[] = [];
    const marks: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(data)) {
      if (!IDENT.test(k)) throw new Error(`Bad column name: ${k}`);
      const isJson = typeof v === 'object' && v !== null && !(v instanceof Date);
      cols.push(k);
      params.push(isJson ? JSON.stringify(v) : v);
      marks.push(`$${startAt + params.length - 1}${isJson ? '::jsonb' : ''}`);
    }
    return { cols, marks, params };
  }

  /** Table names come from this file only, never from a request. */
  async function insertRow(table: string, data: Row): Promise<Row> {
    const { cols, marks, params } = sqlParts(data);
    return (await db.one<Row>(`insert into ${table} (${cols.join(', ')}) values (${marks.join(', ')}) returning *`, params))!;
  }

  async function updateRow(table: string, id: string, data: Row, req: Req): Promise<Row> {
    const { cols, marks, params } = sqlParts(data, 3);
    const sets = cols.map((c, i) => `${c} = ${marks[i]}`);
    return (await db.one<Row>(
      `update ${table} set ${[...sets, 'updated_at = now()', 'updated_by = $2'].join(', ')} where id = $1 returning *`,
      [id, req?.user?.id ?? null, ...params],
    ))!;
  }

  const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v ?? null);

  /** Keeps only the keys whose value differs from the existing row. */
  function changes(existing: Row, patch: Row) {
    const before: Row = {};
    const after: Row = {};
    for (const [k, v] of Object.entries(patch)) {
      if (JSON.stringify(norm(existing[k])) !== JSON.stringify(norm(v))) {
        before[k] = existing[k] ?? null;
        after[k] = v;
      }
    }
    return { before, after, changed: Object.keys(after).length > 0 };
  }

  const actorName = (req: Req) => req?.user?.displayName ?? 'System';
  const projectLabel = (p: Row) => [p.ref, p.name].filter(Boolean).join(' ');

  async function needProject(id: string, req: Req): Promise<Row> {
    return (await ctx.resources.find('project', id, req?.user)) ?? ctx.fail(404, 'not_found', 'Project not found.');
  }

  async function needChild(table: string, label: string, projectId: string, id: string, softDelete = true): Promise<Row> {
    const row = UUID_RE.test(id)
      ? await db.one<Row>(
          `select * from ${table} where id = $1 and project_id = $2${softDelete ? ' and deleted_at is null' : ''}`, [id, projectId])
      : undefined;
    return row ?? ctx.fail(404, 'not_found', `${label} not found.`);
  }

  /** Sets read-only project fields on behalf of the module; see `forced` above. */
  async function setProjectFields(req: Req, id: string, patch: Row): Promise<Row> {
    if (!req) return ctx.resources.update('project', id, patch, null);
    forced.set(req, patch);
    try {
      return await ctx.resources.update('project', id, {}, req);
    } finally {
      forced.delete(req);
    }
  }

  // ---------- settings ----------

  async function getSettings() {
    const tiers = { ...DEFAULT_TIERS, ...(await ctx.settings.get<Partial<TierThresholds>>(SETTING_TIERS, {})) };
    const criteria = await ctx.settings.get<Criterion[]>(SETTING_CRITERIA, DEFAULT_CRITERIA);
    const wipLimit = await ctx.settings.get<number>(SETTING_WIP, DEFAULT_WIP_LIMIT);
    const intakeOpenTo = await ctx.settings.get<string>(SETTING_INTAKE, 'create');
    const reportIntervalDays = await ctx.settings.get<number>(SETTING_REPORT_DAYS, DEFAULT_REPORT_DAYS);
    return { tiers, criteria, wipLimit, maxScore: MAX_SCORE, intakeOpenTo, reportIntervalDays };
  }

  async function mayRequest(user: SessionUser | null | undefined): Promise<boolean> {
    if (!user) return false;
    if (ctx.can(user, 'projects.create')) return true;
    const openTo = (await getSettings()).intakeOpenTo;
    return openTo === 'everyone' || (openTo === 'view' && ctx.can(user, 'projects.view'));
  }

  async function putSettings(req: Req, body: Row) {
    const errors: Record<string, string> = {};
    const current = await getSettings();
    let tiers: TierThresholds | undefined;
    let criteria: Criterion[] | undefined;
    let wipLimit: number | undefined;

    if (body.tiers !== undefined) {
      const a = Number(body.tiers?.tier3Below);
      const b = Number(body.tiers?.tier1Above);
      if (!Number.isFinite(a) || a < 0) errors['tiers.tier3Below'] = 'Enter an amount of zero or more.';
      if (!Number.isFinite(b) || b < 0) errors['tiers.tier1Above'] = 'Enter an amount of zero or more.';
      else if (Number.isFinite(a) && b < a) errors['tiers.tier1Above'] = 'The Tier 1 threshold cannot be below the Tier 3 threshold.';
      tiers = { tier3Below: a, tier1Above: b };
    }
    if (body.criteria !== undefined) {
      if (!Array.isArray(body.criteria) || !body.criteria.length) {
        errors.criteria = 'Add at least one scoring criterion.';
      } else {
        const seen = new Set<string>();
        criteria = [];
        for (const [i, c] of (body.criteria as Row[]).entries()) {
          const label = String(c?.label ?? '').trim();
          const key = String(c?.key ?? '').trim() || label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
          const weight = Number(c?.weight);
          if (!label) errors[`criteria.${i}.label`] = 'Give the criterion a name.';
          if (!IDENT.test(key)) errors[`criteria.${i}.key`] = 'The key may hold lower-case letters, digits and underscores.';
          else if (seen.has(key)) errors[`criteria.${i}.key`] = `"${key}" is used twice.`;
          if (!Number.isFinite(weight) || weight < 0) errors[`criteria.${i}.weight`] = 'Weight must be zero or more.';
          seen.add(key);
          criteria.push({ key, label, weight, description: String(c?.description ?? '').trim() || undefined });
        }
        if (!Object.keys(errors).length && !criteria.some((c) => c.weight > 0)) errors.criteria = 'At least one criterion needs a weight above zero.';
      }
    }
    if (body.wipLimit !== undefined) {
      wipLimit = Number(body.wipLimit);
      if (!Number.isInteger(wipLimit) || wipLimit < 1 || wipLimit > 500) errors.wipLimit = 'Enter a whole number of 1 or more.';
    }
    if (body.intakeOpenTo !== undefined && !INTAKE_CHOICES.includes(String(body.intakeOpenTo))) {
      errors.intakeOpenTo = 'Choose who may submit a project request.';
    }
    let reportIntervalDays: number | undefined;
    if (body.reportIntervalDays !== undefined) {
      reportIntervalDays = Number(body.reportIntervalDays);
      if (!Number.isInteger(reportIntervalDays) || reportIntervalDays < 1 || reportIntervalDays > 366) {
        errors.reportIntervalDays = 'Enter a whole number of days from 1 to 366.';
      }
    }
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
    if (body.intakeOpenTo !== undefined && body.intakeOpenTo !== current.intakeOpenTo) await ctx.settings.set(SETTING_INTAKE, String(body.intakeOpenTo), req);
    if (reportIntervalDays !== undefined && reportIntervalDays !== current.reportIntervalDays) await ctx.settings.set(SETTING_REPORT_DAYS, reportIntervalDays, req);

    const differs = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
    let recalculate = false;
    if (tiers && differs(tiers, current.tiers)) { await ctx.settings.set(SETTING_TIERS, tiers, req); recalculate = true; }
    if (criteria && differs(criteria, current.criteria)) { await ctx.settings.set(SETTING_CRITERIA, criteria, req); recalculate = true; }
    if (wipLimit !== undefined && wipLimit !== current.wipLimit) await ctx.settings.set(SETTING_WIP, wipLimit, req);

    // Tiers and scores are derived, so apply the new rules to every project now (each change is audited).
    let recalculated = 0;
    if (recalculate) {
      const ids = await db.query<{ id: string; updated_at: Date }>('select id, updated_at from projects where deleted_at is null');
      for (const p of ids) {
        const row = await ctx.resources.update('project', p.id, {}, req);
        if (new Date(row.updated_at).getTime() !== new Date(p.updated_at).getTime()) recalculated += 1;
      }
    }
    return { ...(await getSettings()), recalculated };
  }

  // ---------- derived project fields (used by the resource hooks) ----------

  /** `changed` is the patch on an update (undefined on create), so unchanged lists are not re-checked. */
  async function derive(req: Req, merged: Row, changed?: Row): Promise<Row> {
    const errors: Record<string, string> = {};
    const { tiers, criteria } = await getSettings();

    if (merged.budget !== null && merged.budget !== undefined && Number(merged.budget) < 0) errors.budget = 'Budget cannot be negative.';
    if (merged.spend_to_date !== null && merged.spend_to_date !== undefined && Number(merged.spend_to_date) < 0) errors.spend_to_date = 'Spend to date cannot be negative.';
    if (merged.start_on && merged.target_on && String(merged.target_on) < String(merged.start_on)) errors.target_on = 'Target date cannot be before the start date.';

    let scoring = merged.scoring;
    if (typeof scoring === 'string') {
      try { scoring = JSON.parse(scoring); } catch { errors.scoring = 'Scores are not valid.'; scoring = null; }
    }
    if (scoring !== null && scoring !== undefined) {
      if (typeof scoring !== 'object' || Array.isArray(scoring)) errors.scoring = 'Scores are not valid.';
      else {
        for (const [k, v] of Object.entries(scoring as Row)) {
          if (v === null || v === '') continue;
          const n = Number(v);
          if (!Number.isFinite(n) || n < 0 || n > MAX_SCORE) {
            const label = criteria.find((c) => c.key === k)?.label ?? k;
            errors.scoring = `${label}: scores run from 0 to ${MAX_SCORE}.`;
          }
        }
      }
    }
    if (merged.tier_override && !String(merged.tier_override_reason ?? '').trim()) {
      errors.tier_override_reason = 'Give a reason for overriding the tier.';
    }

    // Systems affected: a list of system ids. Checked only when it is being changed.
    let systems: string[] | undefined;
    if (changed === undefined || 'systems_affected' in changed) {
      let raw = merged.systems_affected ?? [];
      if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = null; } }
      if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string' || !UUID_RE.test(v))) {
        errors.systems_affected = 'Systems affected must be a list of systems.';
      } else {
        systems = [...new Set(raw as string[])];
        if (systems.length > 50) errors.systems_affected = 'Choose at most 50 systems.';
        else if (systems.length && !ctx.resources.get('system')) errors.systems_affected = 'The system inventory is not available in this installation.';
        else {
          for (const id of systems) {
            if (!(await ctx.resources.find('system', id, req?.user))) { errors.systems_affected = 'One of the systems could not be found.'; break; }
          }
        }
      }
    }
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);

    const tierComputed = computeTier(merged, tiers);
    return {
      ...(systems ? { systems_affected: systems } : {}),
      tier_computed: tierComputed,
      tier: merged.tier_override || tierComputed,
      tier_override_reason: merged.tier_override ? String(merged.tier_override_reason).trim() : null,
      priority_score: computeScore(scoring as Row, criteria),
      ...(typeof merged.scoring === 'string' ? { scoring } : {}),
    };
  }

  // ---------- gates ----------

  async function stageList() {
    return ctx.lookups.values('project_stage');
  }

  /** Instantiates the gate out of the project's current stage, copying the template checklist. */
  async function openGate(project: Row, req: Req): Promise<Row | undefined> {
    const def = await db.one<Row>(
      'select * from project_gate_defs where from_stage = $1 and active order by sort limit 1', [project.stage]);
    if (!def) return undefined;
    const existing = await db.one<Row>('select * from project_gates where project_id = $1 and gate_key = $2', [project.id, def.key]);
    if (existing) return existing;
    const gate = await insertRow('project_gates', {
      project_id: project.id, gate_def_id: def.id, gate_key: def.key, name: def.name,
      from_stage: def.from_stage, to_stage: def.to_stage, sort: def.sort,
      documents: templateDocuments(def.required_documents).map((d) => ({ ...d, received: false, reference: '' })),
      approvers: def.approvers ?? {}, wants_change: def.wants_change === true,
      created_by: req?.user?.id ?? null, updated_by: req?.user?.id ?? null,
    });
    await db.query(
      `insert into gate_checklist_items (project_gate_id, label, sort)
       select $1, label, sort from project_gate_def_items where gate_def_id = $2 order by sort`,
      [gate.id, def.id],
    );
    await ctx.audit(req, {
      action: 'project.gate_open', recordType: 'project', recordId: project.id,
      summary: `Gate opened: ${def.name} (${projectLabel(project)})`, after: { gate: def.key },
    });
    return gate;
  }

  /** The change record linked to a gate, as far as `user` may see it. */
  async function changeFor(gate: Row, user?: SessionUser | null): Promise<Row | null> {
    const def = ctx.resources.get('change');
    if (!def || !gate.change_id) return null;
    const row = user === undefined || ctx.can(user, `${def.module}.view`) ? await ctx.resources.find('change', gate.change_id, user) : undefined;
    if (!row) return { id: gate.change_id, label: 'A change record you cannot open', ref: null, route: null, status: null };
    return {
      id: row.id, label: row[def.titleField] ?? 'Change', ref: def.ref ? row[def.ref.field] ?? null : null,
      route: `${def.route}/${row.id}`, status: row.status ?? null,
    };
  }

  async function gateViews(project: Row, user?: SessionUser | null): Promise<Row[]> {
    const gates = await db.query<Row>('select * from project_gates where project_id = $1 order by sort, opened_at', [project.id]);
    if (!gates.length) return [];
    const ids = gates.map((g) => g.id);
    const statusLabel = (await ctx.lookups.values('project_status')).find((s) => s.value === project.status)?.label;
    const changesLoaded = Boolean(ctx.resources.get('change'));
    const changes = new Map<string, Row | null>();
    for (const g of gates) if (g.change_id) changes.set(g.id, await changeFor(g, user));
    const items = await db.query<Row>(
      'select * from gate_checklist_items where project_gate_id = any($1::uuid[]) order by sort, label', [ids]);
    const decisions = await db.query<Row>(
      'select * from project_gate_decisions where project_gate_id = any($1::uuid[]) order by created_at desc', [ids]);
    return gates.map((g) => {
      const own = items.filter((i) => i.project_gate_id === g.id);
      const outstanding = own.filter((i) => !i.checked).map((i) => i.label);
      const isCurrent = g.from_stage === project.stage && g.status !== 'approved';
      const blockers = isCurrent
        ? approvalBlockers({ projectStatus: project.status, statusLabel, outstanding, documents: g.documents })
        : [];
      return {
        ...g,
        items: own,
        decisions: decisions.filter((d) => d.project_gate_id === g.id),
        total: own.length,
        checked: own.length - outstanding.length,
        outstanding,
        missing_documents: missingDocuments(g.documents),
        blockers,
        is_current: isCurrent,
        can_approve: isCurrent && blockers.length === 0,
        approvers_for_tier: (g.approvers ?? {})[project.tier] ?? [],
        change_available: changesLoaded && g.wants_change === true,
        change: changes.get(g.id) ?? null,
      };
    });
  }

  async function gatesFor(project: Row, user?: SessionUser | null) {
    const gates = await gateViews(project, user);
    const last = gates.filter((g) => g.status === 'approved' && g.to_stage === project.stage).pop();
    const definitions = await db.query<Row>(
      'select key, name, from_stage, to_stage, sort from project_gate_defs where active order by sort');
    return {
      project_id: project.id, stage: project.stage, status: project.status, tier: project.tier,
      stages: (await stageList()).map((s) => ({ value: s.value, label: s.label })),
      definitions,
      gates,
      current_gate_id: gates.find((g) => g.is_current)?.id ?? null,
      /** The gate that would be reopened by moving the project back a stage. */
      rollback: last ? { gate_id: last.id, gate_name: last.name, to_stage: last.from_stage } : null,
    };
  }

  /** True when the gate has nothing left to do except the decision itself. */
  async function gateReady(project: Row, gateId: string): Promise<boolean> {
    if (project.status !== 'active') return false;
    const gate = await db.one<Row>('select * from project_gates where id = $1', [gateId]);
    if (!gate || gate.status === 'approved' || gate.from_stage !== project.stage) return false;
    const open = await db.one<{ c: number }>('select count(*)::int c from gate_checklist_items where project_gate_id = $1 and not checked', [gateId]);
    return (open?.c ?? 0) === 0 && missingDocuments(gate.documents).length === 0;
  }

  // ---------- notifications (only when the notifications module is loaded) ----------

  async function notify(input: Row): Promise<void> {
    if (!ctx.app.hasDecorator('notify')) return;
    await (ctx.app as unknown as { notify(i: Row): Promise<unknown> }).notify(input);
  }

  /** Tells the approvers, the sponsor and the manager that a gate is waiting for a decision. */
  async function notifyGateReady(project: Row, gateName: string): Promise<void> {
    const common = { recordType: 'project', recordId: project.id, route: `/projects/${project.id}?tab=gate`, oncePerDay: true };
    await notify({
      ...common, kind: 'approval', permission: 'projects.approve',
      title: `Gate ready for a decision: ${gateName} (${projectLabel(project)})`,
      body: 'Every checklist item is ticked and the required documents are in place.',
    });
    await notify({
      ...common, kind: 'due', userIds: [project.project_manager_id, project.sponsor_id],
      title: `Gate decision due: ${gateName} (${projectLabel(project)})`,
      body: 'The gate is ready. Ask the approver for a decision and record it on the project.',
    });
  }

  async function notifyTurnedRed(project: Row): Promise<void> {
    await notify({
      kind: 'general', userIds: [project.project_manager_id, project.sponsor_id], permission: 'projects.approve',
      recordType: 'project', recordId: project.id, route: `/projects/${project.id}?tab=reports`, oncePerDay: true,
      title: `Project turned red: ${projectLabel(project)}`,
      body: 'The latest status report rates the project red overall: it needs a decision or help.',
    });
  }

  /**
   * The daily sweep: status reports that are due, and gates still waiting for a decision.
   * Each person hears about one project at most once a day.
   */
  async function runReminders(): Promise<{ reportsDue: number; gatesDue: number }> {
    const { reportIntervalDays } = await getSettings();
    const rows = await db.query<Row>(
      `select * from projects where deleted_at is null and status = 'active' and stage not in ('idea', 'close')`);
    let reportsDue = 0;
    for (const p of rows) {
      const last = p.last_report_on instanceof Date ? p.last_report_on.toISOString().slice(0, 10) : p.last_report_on;
      if (!p.project_manager_id || !reportDue(last, today(), reportIntervalDays)) continue;
      reportsDue += 1;
      await notify({
        kind: 'reminder', userIds: [p.project_manager_id], recordType: 'project', recordId: p.id,
        route: `/projects/${p.id}?tab=reports`, oncePerDay: true,
        title: `Status report due: ${projectLabel(p)}`,
        body: p.last_report_on ? `The last report is more than ${reportIntervalDays} days old.` : 'No status report has been filed yet.',
      });
    }
    let gatesDue = 0;
    for (const g of (await portfolio()).gatesDue) {
      if (!g.ready) continue;
      gatesDue += 1;
      const p = await db.one<Row>('select * from projects where id = $1', [g.project_id]);
      if (p) await notifyGateReady(p, g.gate_name);
    }
    return { reportsDue, gatesDue };
  }

  async function needGate(project: Row, gateId: string): Promise<Row> {
    const gate = UUID_RE.test(gateId)
      ? await db.one<Row>('select * from project_gates where id = $1 and project_id = $2', [gateId, project.id])
      : undefined;
    return gate ?? ctx.fail(404, 'not_found', 'Gate not found.');
  }

  async function setChecklistItem(req: Req, project: Row, gateId: string, itemId: string, body: Row): Promise<Row> {
    const gate = await needGate(project, gateId);
    if (gate.status === 'approved') ctx.fail(409, 'gate_closed', 'This gate has been approved; its checklist can no longer be changed.');
    const item = (UUID_RE.test(itemId)
      ? await db.one<Row>('select * from gate_checklist_items where id = $1 and project_gate_id = $2', [itemId, gate.id])
      : undefined) ?? ctx.fail(404, 'not_found', 'Checklist item not found.');
    const c = checker(body, true);
    c.bool('checked', 'Checked');
    c.text('note', 'Note');
    c.text('evidence_ref', 'Evidence reference');
    const patch = c.finish();
    if (patch.checked === null) patch.checked = false;
    if (patch.checked !== undefined && patch.checked !== item.checked) {
      patch.checked_by = patch.checked ? req?.user?.id ?? null : null;
      patch.checked_by_name = patch.checked ? actorName(req) : null;
      patch.checked_at = patch.checked ? new Date().toISOString() : null;
    }
    const diff = changes(item, { checked: patch.checked, note: patch.note, evidence_ref: patch.evidence_ref });
    for (const k of Object.keys(diff.after)) if (diff.after[k] === undefined) { delete diff.after[k]; delete diff.before[k]; }
    if (!Object.keys(diff.after).length) return item;
    const saved = await updateRow('gate_checklist_items', item.id, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)), req);
    const verb = diff.after.checked === true ? 'ticked' : diff.after.checked === false ? 'unticked' : 'updated';
    await ctx.audit(req, {
      action: 'project.gate_item', recordType: 'project', recordId: project.id,
      summary: `${gate.name} checklist item ${verb}: ${item.label}`,
      before: { item: item.label, ...diff.before }, after: { item: item.label, ...diff.after },
    });
    if (diff.after.checked === true && (await gateReady(project, gate.id))) await notifyGateReady(project, gate.name);
    return saved;
  }

  async function setGateDocument(req: Req, project: Row, gateId: string, index: number, body: Row): Promise<Row> {
    const gate = await needGate(project, gateId);
    if (gate.status === 'approved') ctx.fail(409, 'gate_closed', 'This gate has been approved; its documents can no longer be changed.');
    const docs = [...((gate.documents ?? []) as Row[])];
    if (!Number.isInteger(index) || index < 0 || index >= docs.length) ctx.fail(404, 'not_found', 'Document not found.');
    const c = checker(body, true);
    c.bool('received', 'Received');
    c.text('reference', 'Reference');
    c.uuid('attachment_id', 'File');
    const patch = c.finish();
    const before = docs[index];
    const after: Row = {
      ...before,
      ...(patch.received !== undefined ? { received: patch.received === true } : {}),
      ...(patch.reference !== undefined ? { reference: patch.reference ?? '' } : {}),
      ...(patch.attachment_id !== undefined ? { attachment_id: patch.attachment_id } : {}),
    };
    if (JSON.stringify(before) === JSON.stringify(after)) return gate;
    docs[index] = after;
    const saved = await updateRow('project_gates', gate.id, { documents: docs }, req);
    await ctx.audit(req, {
      action: 'project.gate_document', recordType: 'project', recordId: project.id,
      summary: `${gate.name} document ${after.received ? 'received' : 'updated'}: ${after.name}`, before, after,
    });
    if (after.received && !before.received && (await gateReady(project, gate.id))) await notifyGateReady(project, gate.name);
    return saved;
  }

  /** An approver may waive a required document, with a reason, or withdraw the waiver. */
  async function waiveGateDocument(req: Req, project: Row, gateId: string, index: number, body: Row): Promise<Row> {
    const gate = await needGate(project, gateId);
    if (gate.status === 'approved') ctx.fail(409, 'gate_closed', 'This gate has been approved; its documents can no longer be changed.');
    const docs = [...((gate.documents ?? []) as GateDocument[])];
    if (!Number.isInteger(index) || index < 0 || index >= docs.length) ctx.fail(404, 'not_found', 'Document not found.');
    const before = docs[index];
    const waive = body.waived !== false && body.waived !== 'false';
    const reason = String(body.reason ?? '').trim();
    if (waive && !reason) ctx.fail(400, 'validation', 'Check the highlighted fields.', { reason: 'Say why this document is not needed.' });
    if (waive && before.required !== true) ctx.fail(400, 'not_required', 'This document is optional, so there is nothing to waive.');
    const after: GateDocument = waive
      ? { ...before, waived: true, waive_reason: reason, waived_by_name: actorName(req), waived_on: today() }
      : { ...before, waived: false, waive_reason: null, waived_by_name: null, waived_on: null };
    if (JSON.stringify(before) === JSON.stringify(after)) return gate;
    docs[index] = after;
    const saved = await updateRow('project_gates', gate.id, { documents: docs }, req);
    await ctx.audit(req, {
      action: 'project.gate_document_waive', recordType: 'project', recordId: project.id,
      summary: waive ? `${gate.name} document waived: ${after.name}. Reason: ${reason}` : `${gate.name} document waiver withdrawn: ${after.name}`,
      before, after,
    });
    if (waive && (await gateReady(project, gate.id))) await notifyGateReady(project, gate.name);
    return saved;
  }

  /** Links (or unlinks) the change record that carries a gate, such as the go-live change. */
  async function setGateChange(req: Req, project: Row, gateId: string, body: Row): Promise<Row> {
    const gate = await needGate(project, gateId);
    if (gate.status === 'approved') ctx.fail(409, 'gate_closed', 'This gate has been approved; it can no longer be changed.');
    const def = ctx.resources.get('change');
    if (!def) ctx.fail(409, 'changes_unavailable', 'Change records are not available in this installation.');
    const id = body.change_id === null || body.change_id === '' ? null : String(body.change_id ?? '');
    let label: string | null = null;
    if (id !== null) {
      const row = UUID_RE.test(id) && req?.user && ctx.can(req.user, `${def.module}.view`) ? await ctx.resources.find('change', id, req.user) : undefined;
      if (!row) ctx.fail(400, 'validation', 'Check the highlighted fields.', { change_id: 'That change record could not be found.' });
      label = [def.ref ? row[def.ref.field] : null, row[def.titleField]].filter(Boolean).join(' ');
    }
    if ((gate.change_id ?? null) === id) return gate;
    const saved = await updateRow('project_gates', gate.id, { change_id: id }, req);
    await ctx.audit(req, {
      action: 'project.gate_change', recordType: 'project', recordId: project.id,
      summary: id ? `${gate.name} gate linked to change ${label}` : `${gate.name} gate: change record unlinked`,
      before: { change_id: gate.change_id ?? null }, after: { change_id: id },
    });
    return saved;
  }

  /** Sends the project back to the stage before its last approved gate and reopens that gate. */
  async function rollbackStage(req: Req, project: Row, body: Row) {
    const reason = String(body.reason ?? '').trim();
    if (!reason) ctx.fail(400, 'validation', 'Check the highlighted fields.', { reason: 'Say why the project is moving back.' });
    if (project.status === 'cancelled') ctx.fail(409, 'project_cancelled', 'A cancelled project cannot be moved between stages.');
    const gate = await db.one<Row>(
      `select * from project_gates where project_id = $1 and to_stage = $2 and status = 'approved' order by sort desc limit 1`,
      [project.id, project.stage]);
    if (!gate) ctx.fail(409, 'no_earlier_stage', 'This project is at its first stage, so there is nothing to move back to.');
    await insertRow('project_gate_decisions', {
      project_gate_id: gate.id, project_id: project.id, decision: 'reopened',
      approver_name: actorName(req), approver_role: null, decided_on: today(), reference: null, notes: reason,
      recorded_by: req?.user?.id ?? null, recorded_by_name: actorName(req),
    });
    const saved = await updateRow('project_gates', gate.id, { status: 'open' }, req);
    await ctx.audit(req, {
      action: 'project.stage_rollback', recordType: 'project', recordId: project.id,
      summary: `Moved back from ${project.stage} to ${gate.from_stage}; ${gate.name} gate reopened. Reason: ${reason}`,
      before: { stage: project.stage, gate: gate.gate_key, status: 'approved' },
      after: { stage: gate.from_stage, gate: gate.gate_key, status: 'open', reason },
    });
    const updated = await setProjectFields(req, project.id, {
      stage: gate.from_stage, ...(project.status === 'completed' ? { status: 'active' } : {}),
    });
    return { project: updated, gate: saved };
  }

  async function decideGate(req: Req, project: Row, gateId: string, body: Row) {
    const gate = await needGate(project, gateId);
    const c = checker(body, false);
    c.oneOf('decision', 'Decision', DECISIONS, true);
    c.text('approver_name', 'Approver name', true);
    c.text('approver_role', 'Approver role');
    c.date('decided_on', 'Decision date');
    c.text('reference', 'Reference');
    c.text('notes', 'Notes');
    const d = c.finish();
    d.decided_on ??= today();
    if (d.decided_on > today()) ctx.fail(400, 'validation', 'Check the highlighted fields.', { decided_on: 'The decision date cannot be in the future.' });

    if (gate.status === 'approved') ctx.fail(409, 'gate_closed', 'This gate has already been approved.');
    if (gate.from_stage !== project.stage) ctx.fail(409, 'not_current_gate', 'This is not the project\'s current gate.');
    if (project.status !== 'active') {
      ctx.fail(409, 'project_not_active', 'Gate decisions can be recorded only while the project is active. Change its status first.');
    }
    if (d.decision === 'approved') {
      const open = await db.query<{ label: string }>(
        'select label from gate_checklist_items where project_gate_id = $1 and not checked order by sort, label', [gate.id]);
      if (open.length) {
        ctx.fail(
          400, 'gate_blocked',
          `This gate cannot be approved while checklist items are outstanding: ${open.map((i) => i.label).join('; ')}.`,
          { checklist: `${open.length} checklist ${open.length === 1 ? 'item is' : 'items are'} outstanding.` },
        );
      }
      const missing = missingDocuments(gate.documents);
      if (missing.length) {
        ctx.fail(
          400, 'gate_blocked',
          `This gate cannot be approved while required documents are missing: ${missing.join('; ')}. Mark each as received, or have an approver waive it with a reason.`,
          { documents: `${missing.length} required ${missing.length === 1 ? 'document is' : 'documents are'} missing.` },
        );
      }
    }

    await insertRow('project_gate_decisions', {
      project_gate_id: gate.id, project_id: project.id, decision: d.decision,
      approver_name: d.approver_name, approver_role: d.approver_role ?? null, decided_on: d.decided_on,
      reference: d.reference ?? null, notes: d.notes ?? null,
      recorded_by: req?.user?.id ?? null, recorded_by_name: actorName(req),
    });
    const saved = await updateRow('project_gates', gate.id, {
      status: d.decision, decided_by_name: d.approver_name, decided_by_role: d.approver_role ?? null,
      decided_on: d.decided_on, decision_reference: d.reference ?? null, decision_notes: d.notes ?? null,
    }, req);
    await ctx.audit(req, {
      action: 'project.gate_decision', recordType: 'project', recordId: project.id,
      summary: `${gate.name} gate ${d.decision} by ${d.approver_name}${d.approver_role ? ` (${d.approver_role})` : ''}`,
      before: { gate: gate.gate_key, status: gate.status },
      after: { gate: gate.gate_key, status: d.decision, approver_name: d.approver_name, approver_role: d.approver_role ?? null, decided_on: d.decided_on, reference: d.reference ?? null, notes: d.notes ?? null },
    });

    let updated = project;
    if (d.decision === 'approved') {
      // The afterUpdate hook opens the next gate when the stage changes. A stage with no gate
      // out of it is the end of the road: the project is completed by the same change.
      const onward = await db.one('select 1 from project_gate_defs where from_stage = $1 and active limit 1', [gate.to_stage]);
      updated = await setProjectFields(req, project.id, { stage: gate.to_stage, ...(onward ? {} : { status: 'completed' }) });
    }
    return { project: updated, gate: saved };
  }

  // ---------- gate templates (administration) ----------

  async function gateDefinitions(): Promise<Row[]> {
    const defs = await db.query<Row>('select * from project_gate_defs order by sort');
    const items = await db.query<Row>('select * from project_gate_def_items order by sort, label');
    return defs.map((d) => ({
      ...d,
      required_documents: templateDocuments(d.required_documents),
      checklist: items.filter((i) => i.gate_def_id === d.id).map((i) => i.label),
    }));
  }

  async function putGateDefinition(req: Req, key: string, body: Row): Promise<Row> {
    const before = (await gateDefinitions()).find((d) => d.key === key) ?? ctx.fail(404, 'not_found', 'Gate not found.');
    const errors: Record<string, string> = {};
    const strings = (v: unknown, field: string, label: string): string[] | undefined => {
      if (v === undefined) return undefined;
      if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) { errors[field] = `${label} must be a list of text entries.`; return undefined; }
      return [...new Set((v as string[]).map((x) => x.trim()).filter(Boolean))];
    };
    const name = body.name === undefined ? undefined : String(body.name).trim();
    if (name === '') errors.name = 'Name is required.';
    const checklist = strings(body.checklist, 'checklist', 'Checklist');
    // Documents arrive as names (required) or as { name, required }.
    let documents: { name: string; required: boolean }[] | undefined;
    if (body.required_documents !== undefined) {
      const list = body.required_documents;
      const ok = Array.isArray(list) && list.every((d) => typeof d === 'string'
        || (d && typeof d === 'object' && typeof d.name === 'string' && (d.required === undefined || typeof d.required === 'boolean')));
      if (!ok) errors.required_documents = 'Documents must be a list of names, each marked required or optional.';
      else documents = templateDocuments(list);
    }
    if (body.wants_change !== undefined && typeof body.wants_change !== 'boolean') errors.wants_change = 'Choose yes or no.';
    let approvers: Row | undefined;
    if (body.approvers !== undefined) {
      if (typeof body.approvers !== 'object' || body.approvers === null || Array.isArray(body.approvers)) errors.approvers = 'Approvers must be listed by tier.';
      else {
        const tiers = (await ctx.lookups.values('project_tier')).map((t) => t.value);
        approvers = {};
        for (const [tier, list] of Object.entries(body.approvers as Row)) {
          if (!tiers.includes(tier)) { errors.approvers = `"${tier}" is not a tier.`; continue; }
          const clean = strings(list, 'approvers', 'Approvers');
          if (clean) approvers[tier] = clean;
        }
      }
    }
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);

    const patch: Row = {};
    if (name !== undefined) patch.name = name;
    if (documents) patch.required_documents = documents;
    if (approvers) patch.approvers = approvers;
    if (body.wants_change !== undefined) patch.wants_change = body.wants_change;
    if (Object.keys(patch).length) await updateRow('project_gate_defs', before.id, patch, req);
    if (checklist) {
      await db.query('delete from project_gate_def_items where gate_def_id = $1', [before.id]);
      for (const [i, label] of checklist.entries()) {
        await db.query('insert into project_gate_def_items (gate_def_id, label, sort) values ($1,$2,$3)', [before.id, label, (i + 1) * 10]);
      }
    }
    const after = (await gateDefinitions()).find((d) => d.key === key)!;
    const pick = (d: Row) => ({ name: d.name, checklist: d.checklist, required_documents: d.required_documents, approvers: d.approvers, wants_change: d.wants_change });
    if (JSON.stringify(pick(before)) !== JSON.stringify(pick(after))) {
      await ctx.audit(req, {
        action: 'project.gate_definition', recordType: 'project_gate_def', recordId: before.id,
        summary: `Gate template changed: ${after.name}`, before: pick(before), after: pick(after),
      });
    }
    return after;
  }

  // ---------- status reports ----------

  async function refreshRag(req: Req, projectId: string): Promise<Row> {
    const [latest, previous] = await db.query<Row>(
      `select * from status_reports where project_id = $1 and deleted_at is null
       order by period_end desc, created_at desc limit 2`, [projectId]);
    return setProjectFields(req, projectId, {
      rag_overall: latest?.overall ?? null,
      rag_schedule: latest?.schedule ?? null,
      rag_budget: latest?.budget ?? null,
      rag_risk: latest?.risk ?? null,
      rag_trend: ragTrend(latest?.overall, previous?.overall),
      last_report_on: latest?.period_end ?? null,
    });
  }

  function reportInput(body: Row, partial: boolean): Row {
    const c = checker(body, partial);
    c.date('period_end', 'Period end', true);
    c.oneOf('overall', 'Overall rating', RAG_VALUES, true);
    c.oneOf('schedule', 'Schedule rating', RAG_VALUES, true);
    c.oneOf('budget', 'Budget rating', RAG_VALUES, true);
    c.oneOf('risk', 'Risk rating', RAG_VALUES, true);
    c.text('accomplishments', 'Accomplishments');
    c.text('next_steps', 'Next steps');
    c.text('decisions_needed', 'Decisions needed');
    return c.finish();
  }

  const REPORT_SQL = 'select * from status_reports where project_id = $1 and deleted_at is null';

  async function listReports(projectId: string): Promise<Row[]> {
    return db.query<Row>(`${REPORT_SQL} order by period_end desc, created_at desc`, [projectId]);
  }

  async function addReport(req: Req, project: Row, body: Row): Promise<Row> {
    const data = reportInput(body, false);
    const row = await insertRow('status_reports', {
      ...data, project_id: project.id,
      author_id: req?.user?.id ?? null, author_name: req ? actorName(req) : String(body.author_name ?? 'System'),
      created_by: req?.user?.id ?? null, updated_by: req?.user?.id ?? null,
    });
    await ctx.audit(req, {
      action: 'project.status_report_create', recordType: 'project', recordId: project.id,
      summary: `Status report added for the period ending ${row.period_end}: overall ${row.overall}`, after: data,
    });
    await refreshRag(req, project.id);
    return row;
  }

  async function updateReport(req: Req, project: Row, reportId: string, body: Row): Promise<Row> {
    const existing = await needChild('status_reports', 'Status report', project.id, reportId);
    const diff = changes(existing, reportInput(body, true));
    if (!diff.changed) return existing;
    const row = await updateRow('status_reports', existing.id, diff.after, req);
    await ctx.audit(req, {
      action: 'project.status_report_update', recordType: 'project', recordId: project.id,
      summary: `Status report for the period ending ${row.period_end} updated`, before: diff.before, after: diff.after,
    });
    await refreshRag(req, project.id);
    return row;
  }

  async function removeChild(req: Req, project: Row, table: string, label: string, action: string, id: string, describe: (r: Row) => string) {
    const existing = await needChild(table, label, project.id, id);
    await db.query(`update ${table} set deleted_at = now(), updated_by = $2 where id = $1`, [existing.id, req?.user?.id ?? null]);
    await ctx.audit(req, {
      action, recordType: 'project', recordId: project.id, summary: `${label} deleted: ${describe(existing)}`,
      before: Object.fromEntries(Object.entries(existing).filter(([k, v]) => v !== null && !['id', 'project_id', 'created_by', 'updated_by', 'created_at', 'updated_at', 'deleted_at'].includes(k))),
    });
    return existing;
  }

  async function statusTrend(project: Row) {
    const series = await db.query<Row>(
      `select id, period_end, overall, schedule, budget, risk, author_name from status_reports
       where project_id = $1 and deleted_at is null order by period_end, created_at`, [project.id]);
    const latest = series[series.length - 1] ?? null;
    const previous = series[series.length - 2] ?? null;
    return {
      project_id: project.id,
      series,
      latest,
      direction: ragTrend(latest?.overall, previous?.overall),
    };
  }

  // ---------- risks, issues, decisions, change requests ----------

  async function itemInput(body: Row, partial: boolean, existing?: Row): Promise<Row> {
    const kinds = (await ctx.lookups.values('project_item_kind')).map((v) => v.value);
    const statuses = (await ctx.lookups.values('project_item_status')).map((v) => v.value);
    const c = checker(body, partial);
    c.oneOf('kind', 'Kind', kinds, true);
    c.text('title', 'Title', true);
    c.text('detail', 'Detail');
    c.uuid('owner_id', 'Owner');
    c.text('owner', 'Owner');
    c.oneOf('status', 'Status', statuses);
    c.date('due_on', 'Due date');
    c.int('likelihood', 'Likelihood', 1, 5);
    c.int('impact', 'Impact', 1, 5);
    const data = c.finish();
    if (data.status === null) data.status = 'open';
    if ((data.kind ?? existing?.kind) !== 'risk') {
      if (data.likelihood !== undefined || existing?.likelihood) data.likelihood = null;
      if (data.impact !== undefined || existing?.impact) data.impact = null;
    }
    return data;
  }

  const ITEM_SQL = `select i.*, u.display_name as owner_name,
      case when i.likelihood is not null and i.impact is not null then i.likelihood * i.impact end as score
    from project_items i left join users u on u.id = i.owner_id
    where i.project_id = $1 and i.deleted_at is null`;

  async function listItems(projectId: string, kind?: string): Promise<Row[]> {
    return kind
      ? db.query<Row>(`${ITEM_SQL} and i.kind = $2 order by i.created_at desc`, [projectId, kind])
      : db.query<Row>(`${ITEM_SQL} order by i.created_at desc`, [projectId]);
  }

  const oneItem = async (projectId: string, id: string) =>
    (await db.one<Row>(`${ITEM_SQL} and i.id = $2`, [projectId, id]))!;

  async function addItem(req: Req, project: Row, body: Row): Promise<Row> {
    const data = await itemInput(body, false);
    const row = await insertRow('project_items', {
      ...data, project_id: project.id, created_by: req?.user?.id ?? null, updated_by: req?.user?.id ?? null,
    });
    await ctx.audit(req, {
      action: 'project.item_create', recordType: 'project', recordId: project.id,
      summary: `Project ${String(row.kind).replace('_', ' ')} added: ${row.title}`, after: data,
    });
    return oneItem(project.id, row.id);
  }

  async function updateItem(req: Req, project: Row, itemId: string, body: Row): Promise<Row> {
    const existing = await needChild('project_items', 'Item', project.id, itemId);
    const diff = changes(existing, await itemInput(body, true, existing));
    if (diff.changed) {
      await updateRow('project_items', existing.id, diff.after, req);
      await ctx.audit(req, {
        action: 'project.item_update', recordType: 'project', recordId: project.id,
        summary: `Project ${String(existing.kind).replace('_', ' ')} updated: ${existing.title}`, before: diff.before, after: diff.after,
      });
    }
    return oneItem(project.id, existing.id);
  }

  /** Maps a project risk onto whatever fields the risk register has; the two modules share no code. */
  async function riskDataFor(def: ResourceDef, project: Row, item: Row): Promise<Row> {
    const data: Row = {};
    const put = async (name: string, value: unknown) => {
      const f = def.fields[name];
      if (!f || f.readOnly || value === null || value === undefined || value === '' || name in data) return;
      if (f.type === 'lookup') {
        const allowed = (await ctx.lookups.values(f.list!)).map((v) => v.value);
        if (allowed.includes(String(value))) data[name] = String(value);
      } else if (f.type === 'number') {
        if (Number.isFinite(Number(value))) data[name] = Number(value);
      } else if (f.type === 'text' || f.type === 'longtext') {
        data[name] = String(value);
      } else if (f.type === 'user' || f.type === 'ref') {
        if (UUID_RE.test(String(value))) data[name] = String(value);
      } else if (f.type === 'date') {
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) data[name] = String(value);
      }
    };
    const provenance = `Escalated from project ${projectLabel(project)}.`;
    await put(def.titleField, item.title);
    const longField = ['description', 'detail', 'details', 'notes'].find((n) => def.fields[n] && n !== def.titleField);
    if (longField) await put(longField, [item.detail, provenance].filter(Boolean).join('\n\n'));
    for (const n of ['likelihood', 'inherent_likelihood']) await put(n, item.likelihood);
    for (const n of ['impact', 'inherent_impact']) await put(n, item.impact);
    await put('owner_id', item.owner_id ?? project.project_manager_id);
    await put('owner', item.owner);
    await put('department', project.department);
    await put('source', 'project');
    await put('source_type', 'project');
    await put('source_id', project.id);
    await put('project_id', project.id);
    await put('review_on', item.due_on);
    return data;
  }

  async function escalateItem(req: Req, project: Row, itemId: string) {
    const item = await needChild('project_items', 'Item', project.id, itemId);
    if (item.kind !== 'risk') ctx.fail(400, 'not_a_risk', 'Only project risks can be escalated to the enterprise risk register.');
    if (item.escalated_risk_id) ctx.fail(409, 'already_escalated', 'This risk has already been escalated to the enterprise risk register.');
    const def = ctx.resources.get('risk');
    if (!def) {
      ctx.fail(409, 'risk_register_unavailable', 'The enterprise risk register is not available in this installation, so the risk cannot be escalated.');
    }
    let risk: Row;
    try {
      risk = await ctx.resources.create('risk', await riskDataFor(def, project, item), req);
    } catch (err) {
      if (err instanceof ApiError) {
        const detail = err.fields ? Object.values(err.fields).join(' ') : err.message;
        ctx.fail(409, 'escalation_failed', `The risk register did not accept this risk: ${detail}`);
      }
      throw err;
    }
    await updateRow('project_items', item.id, { escalated_risk_id: risk.id, escalated_at: new Date().toISOString() }, req);
    const ref = def.ref ? risk[def.ref.field] ?? null : null;
    await ctx.audit(req, {
      action: 'project.item_escalate', recordType: 'project', recordId: project.id,
      summary: `Project risk escalated to the enterprise risk register${ref ? ` as ${ref}` : ''}: ${item.title}`,
      after: { item: item.title, risk_id: risk.id, risk_ref: ref },
    });
    return { item: await oneItem(project.id, item.id), risk: { id: risk.id, ref, route: def.route } };
  }

  // ---------- requests from people outside the project team ----------

  /** Creates a project from the request form. Only the request fields are taken from the body. */
  async function createRequest(req: FastifyRequest, body: Row): Promise<Row> {
    if (!(await mayRequest(req.user))) ctx.fail(403, 'forbidden', 'You do not have permission to submit a project request.');
    const data: Row = {};
    for (const k of REQUEST_FIELDS) if (body[k] !== undefined) data[k] = body[k];
    const row = await ctx.resources.create('project', data, req);
    return { id: row.id, ref: row.ref, name: row.name, stage: row.stage, status: row.status, can_open: ctx.can(req.user, 'projects.view') };
  }

  /** The caller's own requests and how far each has got. Needs no permission on projects. */
  async function myRequests(user: SessionUser): Promise<Row[]> {
    const rows = await db.query<Row>(
      `select p.id, p.ref, p.name, p.stage, p.status, p.tier, p.created_at, p.target_on,
              g.name as gate_name, g.status as gate_status,
              (select count(*)::int from gate_checklist_items i where i.project_gate_id = g.id) as gate_total,
              (select count(*)::int from gate_checklist_items i where i.project_gate_id = g.id and i.checked) as gate_checked
       from projects p left join project_gates g on g.project_id = p.id and g.from_stage = p.stage and g.status <> 'approved'
       where p.deleted_at is null and p.requested_by = $1 order by p.created_at desc limit 100`, [user.id]);
    const stages = await stageList();
    const statuses = await ctx.lookups.values('project_status');
    return rows.map((r) => ({
      ...r,
      stage_label: stages.find((s) => s.value === r.stage)?.label ?? r.stage,
      stage_index: stages.findIndex((s) => s.value === r.stage),
      stage_count: stages.length,
      status_label: statuses.find((s) => s.value === r.status)?.label ?? r.status,
      status_color: statuses.find((s) => s.value === r.status)?.color ?? 'gray',
    }));
  }

  // ---------- systems affected ----------

  /** The systems a project affects, as far as `user` may see them. */
  async function systemsFor(project: Row, user: SessionUser | null | undefined) {
    const def = ctx.resources.get('system');
    const ids = Array.isArray(project.systems_affected) ? (project.systems_affected as string[]) : [];
    if (!def) return { available: false, systems: [], hidden: ids.length };
    const systems: Row[] = [];
    if (!user || ctx.can(user, `${def.module}.view`)) {
      for (const id of ids) {
        const row = await ctx.resources.find('system', id, user);
        if (row) systems.push({ id: row.id, label: row[def.titleField], ref: def.ref ? row[def.ref.field] ?? null : null, route: `${def.route}/${row.id}` });
      }
    }
    return { available: true, systems, hidden: ids.length - systems.length };
  }

  // ---------- milestones ----------

  function milestoneInput(body: Row, partial: boolean): Row {
    const c = checker(body, partial);
    c.text('name', 'Name', true);
    c.date('due_on', 'Due date', true);
    c.date('done_on', 'Completed on');
    c.int('sort', 'Order', 0, 100000);
    const data = c.finish();
    if (data.sort === null) data.sort = 0;
    return data;
  }

  async function listMilestones(projectId: string): Promise<Row[]> {
    return db.query<Row>(
      'select * from project_milestones where project_id = $1 and deleted_at is null order by due_on, sort, name', [projectId]);
  }

  async function addMilestone(req: Req, project: Row, body: Row): Promise<Row> {
    const data = milestoneInput(body, false);
    const row = await insertRow('project_milestones', {
      ...data, project_id: project.id, created_by: req?.user?.id ?? null, updated_by: req?.user?.id ?? null,
    });
    await ctx.audit(req, {
      action: 'project.milestone_create', recordType: 'project', recordId: project.id,
      summary: `Milestone added: ${row.name} (due ${row.due_on})`, after: data,
    });
    return row;
  }

  async function updateMilestone(req: Req, project: Row, milestoneId: string, body: Row): Promise<Row> {
    const existing = await needChild('project_milestones', 'Milestone', project.id, milestoneId);
    const diff = changes(existing, milestoneInput(body, true));
    if (!diff.changed) return existing;
    const row = await updateRow('project_milestones', existing.id, diff.after, req);
    await ctx.audit(req, {
      action: 'project.milestone_update', recordType: 'project', recordId: project.id,
      summary: `Milestone updated: ${row.name}`, before: diff.before, after: diff.after,
    });
    return row;
  }

  // ---------- portfolio ----------

  async function portfolio() {
    const { wipLimit, criteria } = await getSettings();
    const stages = await stageList();
    const projects = await db.query<Row>(
      `select p.id, p.ref, p.name, p.department, p.sponsor, p.tier, p.stage, p.status, p.priority_score, p.funding_source,
              p.budget, p.spend_to_date, p.start_on, p.target_on, p.project_manager_id, u.display_name as project_manager,
              p.rag_overall, p.rag_schedule, p.rag_budget, p.rag_risk, p.rag_trend, p.last_report_on
       from projects p left join users u on u.id = p.project_manager_id
       where p.deleted_at is null
       order by p.priority_score desc nulls last, p.name`);
    const ids = projects.map((p) => p.id);
    const reports = ids.length ? await db.query<Row>(
      `select project_id, period_end, overall, schedule, budget, risk from status_reports
       where project_id = any($1::uuid[]) and deleted_at is null order by period_end, created_at`, [ids]) : [];
    const milestones = ids.length ? await db.query<Row>(
      `select id, project_id, name, due_on, done_on from project_milestones
       where project_id = any($1::uuid[]) and deleted_at is null order by due_on, sort, name`, [ids]) : [];
    const gates = ids.length ? await db.query<Row>(
      `select g.id, g.project_id, g.gate_key, g.name, g.from_stage, g.to_stage, g.status, g.decided_on, g.opened_at, g.documents,
              count(i.id)::int as total, (count(i.id) filter (where i.checked))::int as checked
       from project_gates g left join gate_checklist_items i on i.project_gate_id = g.id
       where g.project_id = any($1::uuid[]) and g.status <> 'approved'
       group by g.id`, [ids]) : [];

    const register = projects.map((p): Row => {
      const gate = gates.find((g) => g.project_id === p.id && g.from_stage === p.stage) ?? null;
      const budget = p.budget === null ? null : Number(p.budget);
      const spend = p.spend_to_date === null ? null : Number(p.spend_to_date);
      return {
        ...p,
        spend_pct: budget && spend !== null ? Math.round((spend / budget) * 1000) / 10 : null,
        over_budget: budget !== null && spend !== null && spend > budget,
        trend: reports.filter((r) => r.project_id === p.id).slice(-8).map(({ project_id: _p, ...r }) => r),
        milestones: milestones.filter((m) => m.project_id === p.id).map(({ project_id: _p, ...m }) => m),
        gate: gate && {
          id: gate.id, key: gate.gate_key, name: gate.name, status: gate.status, to_stage: gate.to_stage,
          checked: gate.checked, total: gate.total,
          documents_missing: missingDocuments(gate.documents).length,
          ready: gate.total === gate.checked && missingDocuments(gate.documents).length === 0,
        },
      };
    });

    const live = register.filter((p) => p.status !== 'cancelled');
    const funnel = stages.map((s) => {
      const inStage = live.filter((p) => p.stage === s.value);
      return {
        stage: s.value, label: s.label, color: s.color ?? 'gray',
        count: inStage.length,
        active: inStage.filter((p) => p.status === 'active').length,
        budget: inStage.reduce((n, p) => n + (Number(p.budget) || 0), 0),
      };
    });

    const inDelivery = register.filter((p) => p.status === 'active' && p.stage === DELIVERY_STAGE).length;
    const exceeded = inDelivery > wipLimit;
    const wipWarning = exceeded
      ? `${inDelivery} active projects are in delivery, above the work-in-progress limit of ${wipLimit}. Finish or pause a project before starting another.`
      : null;

    // A decision is due when the current gate's checklist is complete, or an earlier decision was deferred.
    const gatesDue = register
      .filter((p) => p.status === 'active' && p.gate && (p.gate.ready || p.gate.status === 'deferred'))
      .map((p) => ({
        project_id: p.id, ref: p.ref, name: p.name, tier: p.tier, stage: p.stage, target_on: p.target_on,
        gate_id: p.gate.id, gate_name: p.gate.name, gate_status: p.gate.status,
        checked: p.gate.checked, total: p.gate.total, ready: p.gate.ready,
      }));

    return {
      register,
      funnel,
      wip: { limit: wipLimit, inDelivery, exceeded, stage: DELIVERY_STAGE },
      wipWarning,
      gatesDue,
      totals: {
        projects: live.length,
        active: live.filter((p) => p.status === 'active').length,
        budget: live.reduce((n, p) => n + (Number(p.budget) || 0), 0),
        spend: live.reduce((n, p) => n + (Number(p.spend_to_date) || 0), 0),
        rag: {
          red: live.filter((p) => p.rag_overall === 'red').length,
          amber: live.filter((p) => p.rag_overall === 'amber').length,
          green: live.filter((p) => p.rag_overall === 'green').length,
          none: live.filter((p) => !p.rag_overall).length,
        },
      },
      today: today(),
      criteria,
    };
  }

  return {
    needProject, getSettings, putSettings, derive, mayRequest, createRequest, myRequests, systemsFor,
    notifyTurnedRed, runReminders, waiveGateDocument, setGateChange, rollbackStage,
    openGate, gatesFor, gateViews, setChecklistItem, setGateDocument, decideGate,
    gateDefinitions, putGateDefinition,
    listReports, addReport, updateReport, statusTrend, refreshRag,
    listItems, addItem, updateItem, escalateItem,
    listMilestones, addMilestone, updateMilestone,
    removeChild, portfolio,
  };
}

export type ProjectService = ReturnType<typeof makeService>;
