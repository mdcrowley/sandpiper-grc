import type { FastifyRequest } from 'fastify';
import { featureState, optionName, optionOn } from '../../core/features.ts';
import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext, ModuleDef, Row } from '../../core/module.ts';
import { TIME_ZONE, todayInZone } from '../../core/timezone.ts';
import { emitWebhookEvent } from '../../core/webhooks.ts';
import { notifyPerson, notifyViewers, sweepClocks } from './alerts.ts';
import { amberFraction as readAmberFraction, byUrgency, clockOf, stamp } from './clocks.ts';
import {
  ensureDefaults, FLAG_FIELDS, incidentQuestions, KIND_LIST, lifecycle, loadOrganizationRules, reviewLifecycle, STAGE_LABELS, STAGES,
  triggerApplies, triggerOptions,
} from './defaults.ts';
import type { ReviewStage, Stage } from './defaults.ts';
import { registerKit, scheduleKit } from './kit.ts';
import { registerLists } from './lists.ts';
import { alertResponders, registerAlertRoutes } from './responders.ts';
import { buildReport } from './report.ts';
import { seedSample } from './seed.ts';

export { DEFAULT_AMBER_FRACTION } from './clocks.ts';

// Security incidents with regulatory clocks. Everything in this module is
// restricted: every route needs security.view as well as the action permission.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOUR = 3_600_000;
/** Days after closure by which the post-incident review is due. Setting: security.review_due_days. */
export const DEFAULT_REVIEW_DUE_DAYS = 14;
/** What the review records; frozen once the review is completed (reopen it to change them). */
const REVIEW_FINDINGS = ['what_happened', 'root_cause', 'went_well', 'to_improve', 'review_held_at', 'review_lead_id', 'review_attendees'];

type Req = FastifyRequest | null;

interface ColSpec {
  label: string;
  type?: 'text' | 'number' | 'boolean' | 'datetime';
  required?: boolean;
  /** Lookup list the value must belong to. */
  list?: string;
  oneOf?: string[];
  /** Allowed values worked out at request time. */
  allowed?: () => Promise<string[]>;
}

export interface IncidentService {
  syncTasks(incident: Row, req: Req): Promise<void>;
  addLog(incidentId: string, req: Req, entry: string, kind?: string, at?: Date): Promise<Row>;
}

export function makeService(ctx: ModuleContext): IncidentService & {
  matchingRules(flags: Row): Promise<Row[]>;
  applyChecklist(incident: Row, req: Req): Promise<number>;
  copyRoster(incident: Row, req: Req): Promise<void>;
  resyncOpenIncidents(req: Req): Promise<void>;
} {
  const { db } = ctx;

  const dueAt = (incident: Row, hours: number) =>
    new Date(new Date(incident.discovered_at).getTime() + Number(hours) * HOUR).toISOString();

  async function matchingRules(flags: Row): Promise<Row[]> {
    const rules = await db.query<Row>(
      `select * from notification_rules where deleted_at is null and active and deadline_hours is not null order by sort, party`,
    );
    return rules.filter((r) => triggerApplies(r.trigger_attribute, flags));
  }

  /**
   * Creates or refreshes the notification tasks of a declared incident. One task per
   * incident and rule; completed tasks are never touched; open tasks follow the discovery
   * time; an open task whose trigger no longer applies is marked "not required" (and
   * reopened if the trigger is set again).
   */
  async function syncTasks(incident: Row, req: Req): Promise<void> {
    if (!incident.declared_at) return;
    const rules = await matchingRules(incident);
    const tasks = await db.query<Row>(
      `select * from notification_tasks where incident_id = $1 and deleted_at is null and rule_id is not null`, [incident.id],
    );
    const byRule = new Map(tasks.map((t) => [t.rule_id as string, t]));
    for (const rule of rules) {
      const due = dueAt(incident, rule.deadline_hours);
      const t = byRule.get(rule.id);
      if (!t) {
        await ctx.resources.create('notification_task', {
          title: `Notify ${rule.party}`, incident_id: incident.id, rule_id: rule.id, party: rule.party,
          deadline_hours: rule.deadline_hours, required: rule.required, guidance: rule.guidance, due_at: due, status: 'pending',
        }, req);
      } else if (t.status === 'pending') {
        await ctx.resources.update('notification_task', t.id, { due_at: due, deadline_hours: rule.deadline_hours }, req);
        // A moved deadline starts the alerts afresh: the sweep raises them again if they are due.
        if (!t.due_at || new Date(t.due_at).getTime() !== new Date(due).getTime()) {
          await db.query(`update notification_tasks set alerted_amber_at = null, alerted_red_at = null where id = $1`, [t.id]);
        }
      } else if (t.status === 'not_required' && t.auto_not_required) {
        await ctx.resources.update('notification_task', t.id, {
          status: 'pending', auto_not_required: false, due_at: due, deadline_hours: rule.deadline_hours,
        }, req);
      }
    }
    const matched = new Set(rules.map((r) => r.id as string));
    const live = new Set((await db.query<Row>(
      `select id from notification_rules where deleted_at is null and active and deadline_hours is not null`,
    )).map((r) => r.id as string));
    for (const t of tasks) {
      // Only when the rule still stands but this incident no longer triggers it.
      if (t.status === 'pending' && !matched.has(t.rule_id) && live.has(t.rule_id)) {
        await ctx.resources.update('notification_task', t.id, { status: 'not_required', auto_not_required: true }, req);
      }
    }
  }

  async function resyncOpenIncidents(req: Req): Promise<void> {
    const closed = (await lifecycle(ctx)).filter((s) => s.stage === 'closed').map((s) => s.value);
    const open = await db.query<Row>(
      `select * from security_incidents where deleted_at is null and declared_at is not null and status <> all($1::text[])`, [closed],
    );
    for (const i of open) {
      await syncTasks(i, req);
      await sweepClocks(ctx, (id, entry) => addLog(id, null, entry), i.id);
    }
  }

  async function addLog(incidentId: string, req: Req, entry: string, kind = 'system', at?: Date): Promise<Row> {
    return (await db.one<Row>(
      `insert into incident_log_entries (incident_id, at, author_id, author_name, entry, kind)
       values ($1, coalesce($2::timestamptz, now()), $3, $4, $5, $6) returning *`,
      [incidentId, at ? at.toISOString() : null, req?.user?.id ?? null, req?.user?.displayName ?? 'System', entry, kind],
    ))!;
  }

  /** Copies the scenario's checklist onto the incident (once per scenario). Unchecked steps of a previous scenario are removed. */
  async function applyChecklist(incident: Row, req: Req): Promise<number> {
    if (!incident.scenario) return 0;
    const dropped = await db.query<Row>(
      `update incident_checklist_items set deleted_at = now(), updated_by = $3
       where incident_id = $1 and deleted_at is null and not done and template_id is not null and scenario is distinct from $2
       returning id`,
      [incident.id, incident.scenario, req?.user?.id ?? null],
    );
    if (dropped.length) {
      await ctx.audit(req, {
        action: 'security_incident.checklist_cleared', recordType: 'security_incident', recordId: incident.id,
        summary: `${dropped.length} unchecked checklist step(s) of the previous scenario removed`,
      });
    }
    const has = await db.one(
      `select 1 from incident_checklist_items where incident_id = $1 and scenario = $2 and template_id is not null and deleted_at is null limit 1`,
      [incident.id, incident.scenario],
    );
    if (has) return 0;
    const made = await db.query<Row>(
      `insert into incident_checklist_items (incident_id, template_id, scenario, phase, step, sort, created_by, updated_by)
       select $1, id, scenario, phase, step, sort, $3, $3 from incident_checklist_templates
       where scenario = $2 and active and deleted_at is null order by phase, sort returning id`,
      [incident.id, incident.scenario, req?.user?.id ?? null],
    );
    if (made.length) {
      await ctx.audit(req, {
        action: 'security_incident.checklist_copied', recordType: 'security_incident', recordId: incident.id,
        summary: `Checklist copied for scenario "${incident.scenario}" (${made.length} steps)`,
      });
    }
    return made.length;
  }

  /** Starts the incident's role list from the standing contact list. */
  async function copyRoster(incident: Row, req: Req): Promise<void> {
    const made = await db.query<Row>(
      `insert into incident_roles (incident_id, role, person_name, contact, sort, created_by, updated_by)
       select $1, role, person_name, contact, sort, $2, $2 from incident_contacts where deleted_at is null order by sort
       returning id`,
      [incident.id, req?.user?.id ?? null],
    );
    if (made.length) {
      await ctx.audit(req, {
        action: 'security_incident.roles_copied', recordType: 'security_incident', recordId: incident.id,
        summary: `${made.length} role(s) copied from the standing contact list`,
      });
    }
  }

  return { matchingRules, syncTasks, resyncOpenIncidents, addLog, applyChecklist, copyRoster };
}

const mod: ModuleDef = {
  key: 'secincidents',

  async seedDefaults(ctx) {
    await ensureDefaults(ctx);
  },

  async register(ctx) {
    const { app, db } = ctx;
    const svc = makeService(ctx);

    // ---------- guards ----------

    /** Restricted module: the action permission and security.view are both needed. */
    const guard = (action: string) => async (req: FastifyRequest) => {
      if (!req.user) ctx.fail(401, 'unauthenticated', 'Sign in to continue.');
      if (!ctx.can(req.user, 'security.view') || !ctx.can(req.user, `security.${action}`)) {
        ctx.fail(403, 'forbidden', 'You do not have permission to do that.');
      }
    };
    const view = { preHandler: guard('view') };
    const edit = { preHandler: guard('edit') };
    const administer = { preHandler: guard('administer') };

    async function incidentOf(req: FastifyRequest): Promise<Row> {
      const id = String((req.params as Row).id ?? '');
      return (await ctx.resources.find('security_incident', id, req.user)) ?? ctx.fail(404, 'not_found', 'Security incident not found.');
    }

    async function labelOfLookup(list: string, value: unknown): Promise<string> {
      return (await ctx.lookups.values(list)).find((v) => v.value === value)?.label ?? String(value ?? '');
    }

    // ---------- small validation helper for the hand-written tables ----------

    async function parseCols(spec: Record<string, ColSpec>, body: Row, mode: 'create' | 'update'): Promise<Row> {
      const out: Row = {};
      const errors: Record<string, string> = {};
      for (const [name, c] of Object.entries(spec)) {
        let v = body[name];
        if (v === undefined) {
          if (mode === 'create' && c.required) errors[name] = `${c.label} is required.`;
          continue;
        }
        if (typeof v === 'string') v = v.trim();
        if (v === null || v === '') {
          if (c.required || c.type === 'boolean') errors[name] = `${c.label} is required.`;
          else out[name] = null;
          continue;
        }
        if (c.type === 'number') {
          const n = Number(v);
          if (Number.isFinite(n)) out[name] = n; else errors[name] = `${c.label} must be a number.`;
        } else if (c.type === 'boolean') {
          if (typeof v === 'boolean') out[name] = v; else errors[name] = `${c.label} must be yes or no.`;
        } else if (c.type === 'datetime') {
          const d = new Date(String(v));
          if (Number.isNaN(d.getTime())) errors[name] = `${c.label} must be a date and time.`; else out[name] = d.toISOString();
        } else {
          const s = String(v);
          if (s.length > 10000) errors[name] = `${c.label} is too long.`;
          else if (c.oneOf && !c.oneOf.includes(s)) errors[name] = `${c.label}: "${s}" is not an allowed value.`;
          else if (c.allowed && !(await c.allowed()).includes(s)) errors[name] = `${c.label}: "${s}" is not an allowed value.`;
          else if (c.list && !(await ctx.lookups.values(c.list)).some((x) => x.value === s)) errors[name] = `${c.label}: "${s}" is not an allowed value.`;
          else out[name] = s;
        }
      }
      if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
      return out;
    }

    async function insertRow(table: string, data: Row, req: FastifyRequest): Promise<Row> {
      const d = { ...data, created_by: req.user!.id, updated_by: req.user!.id };
      const cols = Object.keys(d);
      return (await db.one<Row>(
        `insert into ${table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
        Object.values(d),
      ))!;
    }

    async function updateRow(table: string, id: string, patch: Row, req: FastifyRequest): Promise<Row> {
      const cols = Object.keys(patch);
      return (await db.one<Row>(
        `update ${table} set ${cols.map((c, i) => `${c} = $${i + 3}`).join(', ')}${cols.length ? ',' : ''}
           updated_at = now(), updated_by = $2 where id = $1 returning *`,
        [id, req.user!.id, ...Object.values(patch)],
      ))!;
    }

    const changed = (before: Row, patch: Row) => {
      const b: Row = {}; const a: Row = {};
      const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v ?? null);
      for (const [k, v] of Object.entries(patch)) {
        if (JSON.stringify(norm(before[k])) !== JSON.stringify(norm(v))) { b[k] = before[k]; a[k] = v; }
      }
      return { before: b, after: a };
    };

    // Completed notifications are a legal record: refuse to delete them (the generated
    // DELETE route has no hook for this). Callers without access fall through to the usual 403.
    app.addHook('preHandler', async (req) => {
      if (req.method !== 'DELETE' || req.routeOptions?.url !== '/api/notification-tasks/:id') return;
      if (!req.user || !ctx.can(req.user, 'security.view') || !ctx.can(req.user, 'security.delete')) return;
      const t = await ctx.resources.find('notification_task', String((req.params as Row).id ?? ''), req.user);
      if (t?.status === 'done') ctx.fail(409, 'completed', 'A completed notification is kept as a record and cannot be deleted.');
    });

    // ---------- resources ----------

    ctx.defineResource({
      type: 'security_incident', table: 'security_incidents', module: 'security',
      label: 'Security incident', plural: 'Security incidents',
      path: '/api/security-incidents', route: '/security-incidents',
      titleField: 'title', ref: { field: 'ref', prefix: 'SEC-' }, restricted: true,
      searchable: ['title', 'summary', 'affected_systems', 'affected_data'],
      defaultSort: { field: 'discovered_at', dir: 'desc' },
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true },
        title: { label: 'Title', type: 'text', required: true },
        summary: { label: 'Summary', type: 'longtext' },
        severity: { label: 'Severity', type: 'lookup', list: 'security_incident_severity', default: 'moderate' },
        status: { label: 'Status', type: 'lookup', list: 'security_incident_status', default: 'reported', required: true },
        scenario: { label: 'Scenario', type: 'lookup', list: 'security_incident_scenario' },
        discovered_at: { label: 'Discovered', type: 'datetime' },
        declared_at: { label: 'Declared', type: 'datetime' },
        contained_at: { label: 'Contained', type: 'datetime' },
        closed_at: { label: 'Closed', type: 'datetime' },
        lead_id: { label: 'Incident lead', type: 'user' },
        affected_systems: { label: 'Affected systems', type: 'longtext' },
        affected_data: { label: 'Affected data', type: 'longtext' },
        is_cyber_incident: { label: 'Cybersecurity or ransomware incident', type: 'boolean', default: true },
        personal_info_involved: { label: 'Personal information involved', type: 'boolean', default: false },
        // Values of the incident_data_kind list (configurable; see defaults.ts).
        data_kinds: { label: 'Other kinds of data involved', type: 'json' },
        what_happened: { label: 'What happened', type: 'longtext' },
        went_well: { label: 'What went well', type: 'longtext' },
        to_improve: { label: 'What to improve', type: 'longtext' },
        root_cause: { label: 'Root cause', type: 'longtext' },
        review_status: { label: 'Post-incident review', type: 'lookup', list: 'incident_review_status', default: 'not_started', required: true },
        review_due_on: { label: 'Review due', type: 'date' },
        review_held_at: { label: 'Review meeting', type: 'datetime' },
        review_lead_id: { label: 'Review lead', type: 'user' },
        review_attendees: { label: 'Who took part', type: 'longtext' },
        review_skip_reason: { label: 'Why no review is needed', type: 'longtext' },
        review_completed_at: { label: 'Review completed', type: 'datetime', readOnly: true },
        review_completed_by: { label: 'Review completed by', type: 'user', readOnly: true },
        ransom_payment_status: { label: 'Ransom payment', type: 'lookup', list: 'ransom_payment_status', default: 'not_applicable', required: true },
        board_resolution_ref: { label: 'Payment approval reference', type: 'text' },
      },
      hooks: {
        beforeCreate: async (_req, data) => {
          const now = new Date().toISOString();
          for (const f of FLAG_FIELDS) if (data[f] === null || data[f] === undefined) data[f] = f === 'is_cyber_incident';
          data.data_kinds = await cleanKinds(data.data_kinds, []);
          if (!data.discovered_at) data.discovered_at = now;
          checkTimes(data, {});
          await checkRansom(data.ransom_payment_status, data.board_resolution_ref);
          await stampStatus(data.status, {}, data, now);
          await checkReview(_req, {}, data, now);
          return data;
        },
        beforeUpdate: async (_req, existing, patch) => {
          const now = new Date().toISOString();
          if (patch.review_status === null) delete patch.review_status;
          await checkReview(_req, existing, patch, now);
          for (const f of FLAG_FIELDS) if (patch[f] === null) patch[f] = false;
          if (patch.data_kinds !== undefined) patch.data_kinds = await cleanKinds(patch.data_kinds, existing.data_kinds ?? []);
          if (patch.discovered_at === null) {
            ctx.fail(400, 'validation', 'Check the highlighted fields.', { discovered_at: 'Discovered is required: the notification deadlines count from it.' });
          }
          checkTimes(patch, existing);
          const merged = { ...existing, ...patch };
          await checkRansom(merged.ransom_payment_status, merged.board_resolution_ref);
          if (patch.status !== undefined && patch.status !== existing.status) await stampStatus(patch.status, existing, patch, now);
          return patch;
        },
        afterCreate: async (req, row) => {
          await svc.copyRoster(row, req);
          await svc.applyChecklist(row, req);
          await svc.addLog(row.id, req, `Incident recorded with status "${await labelOfLookup('security_incident_status', row.status)}".`);
          if (row.declared_at) {
            await svc.addLog(row.id, req, 'Incident declared. Notification clocks run from the discovery time.');
            await svc.syncTasks(row, req);
            await declared(row);
          }
          if (row.ransom_payment_status !== 'not_applicable') await ransomChanged(req, { ransom_payment_status: 'not_applicable' }, row);
        },
        afterUpdate: async (req, before, after) => {
          if (after.scenario && after.scenario !== before.scenario) {
            const n = await svc.applyChecklist(after, req);
            await svc.addLog(after.id, req,
              `Scenario set to "${await labelOfLookup('security_incident_scenario', after.scenario)}"${n ? `; ${n} checklist steps copied` : ''}.`);
          }
          if (after.status !== before.status) {
            const label = await labelOfLookup('security_incident_status', after.status);
            await svc.addLog(after.id, req, !before.declared_at && after.declared_at
              ? `Incident declared (status "${label}"). Notification clocks run from the discovery time.`
              : `Status changed to "${label}".`);
          }
          if (after.ransom_payment_status !== before.ransom_payment_status) await ransomChanged(req, before, after);
          await svc.syncTasks(after, req);
          if (!before.declared_at && after.declared_at) await declared(after);
          else if (after.declared_at) await sweep(after.id);
          await reviewChanged(req, before, after);
        },
      },
    });

    const sweep = (incidentId?: string) => sweepClocks(ctx, (id, entry) => svc.addLog(id, null, entry), incidentId);

    /** Just declared: tell the people who can see the incident, then raise any alert that is already due. */
    async function declared(incident: Row) {
      const open = await db.query<Row>(
        `select party, due_at from notification_tasks where incident_id = $1 and deleted_at is null and status = 'pending' order by due_at nulls last`, [incident.id]);
      const next = open.find((t) => t.due_at);
      await notifyViewers(ctx, incident, {
        kind: 'general',
        title: `Security incident declared: ${incident.ref} ${incident.title}`,
        body: `Severity: ${await labelOfLookup('security_incident_severity', incident.severity) || 'not set'}. `
          + (open.length
            ? `${open.length} notification clock${open.length === 1 ? ' is' : 's are'} running${next ? `; the first deadline is ${stamp(next.due_at)} (${next.party})` : ''}.`
            : 'No notification clocks were started.'),
      });
      await emitWebhookEvent(ctx.app, {
        event: 'security_incident.declared', record: { type: 'security_incident', id: incident.id },
        data: {
          severity: incident.severity ?? null, declaredAt: incident.declared_at ? new Date(incident.declared_at).toISOString() : null,
          clocks: open.length, firstDeadline: next ? new Date(next.due_at).toISOString() : null,
        },
      });
      await alertResponders(ctx, incident, 'declared'); // by email and text message (E09-25)
      await sweep(incident.id);
    }

    // ---------- post-incident review ----------

    const filled = (v: unknown) => String(v ?? '').trim() !== '';
    const sameValue = (a: unknown, b: unknown) => {
      const norm = (v: unknown) => (v === undefined || v === '' ? null : v instanceof Date ? v.toISOString() : v);
      const x = norm(a); const y = norm(b);
      if (x !== null && y !== null && typeof x === 'string' && typeof y === 'string' && /^\d{4}-\d\d-\d\dT/.test(x) && /^\d{4}-\d\d-\d\dT/.test(y)) {
        return new Date(x).getTime() === new Date(y).getTime();
      }
      return x === y;
    };
    async function reviewStageOf(status: unknown): Promise<ReviewStage> {
      return (await reviewLifecycle(ctx)).find((s) => s.value === status)?.stage ?? 'open';
    }

    /**
     * The review workflow. Completing needs the account of what happened, the root cause and
     * what to improve; "not required" needs a reason; a completed review is frozen until it is
     * reopened. Closing an incident sets the date the review is due.
     */
    async function checkReview(req: Req, existing: Row, patch: Row, now: string) {
      const merged = { ...existing, ...patch };
      const was = await reviewStageOf(existing.review_status);
      const next = patch.review_status !== undefined ? await reviewStageOf(patch.review_status) : was;
      const fields: Record<string, string> = {};

      if (was === 'completed' && next === 'completed') {
        const touched = REVIEW_FINDINGS.filter((f) => patch[f] !== undefined && !sameValue(patch[f], existing[f]));
        if (touched.length) ctx.fail(409, 'review_completed', 'The post-incident review is complete. Reopen the review to change its findings.');
      }
      if (next === 'completed' && was !== 'completed') {
        if (!filled(merged.what_happened)) fields.what_happened = 'Write what happened before completing the review.';
        if (!filled(merged.root_cause)) fields.root_cause = 'Record the root cause before completing the review.';
        if (!filled(merged.to_improve)) fields.to_improve = 'Record what to improve before completing the review.';
        patch.review_completed_at = now;
        patch.review_completed_by = req?.user?.id ?? null;
      }
      if (next === 'not_required' && !filled(merged.review_skip_reason)) {
        fields.review_skip_reason = 'Say why no review is needed; the reason is added to the incident log.';
      }
      if (next !== 'completed' && was === 'completed') { patch.review_completed_at = null; patch.review_completed_by = null; }
      if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

      // Closing the incident starts the review clock.
      const closing = patch.status !== undefined && patch.status !== existing.status && (await stageOf(patch.status)) === 'closed';
      if (closing && next === 'open' && !merged.review_due_on) {
        const days = Number(await ctx.settings.get('security.review_due_days', DEFAULT_REVIEW_DUE_DAYS));
        const n = Number.isFinite(days) && days >= 0 && days <= 365 ? days : DEFAULT_REVIEW_DUE_DAYS;
        patch.review_due_on = todayInZone(new Date(Date.now() + n * 24 * HOUR));
      }
    }

    async function reviewChanged(req: Req, before: Row, after: Row) {
      const was = await reviewStageOf(before.review_status);
      const now = await reviewStageOf(after.review_status);
      if (after.review_status !== before.review_status) {
        const label = await labelOfLookup('incident_review_status', after.review_status);
        if (now === 'completed') {
          await svc.addLog(after.id, req, 'Post-incident review completed. Its findings are recorded under Lessons learned.', 'decision');
          await notifyViewers(ctx, after, { kind: 'general', title: `Post-incident review completed: ${after.ref} ${after.title}` });
        } else if (now === 'not_required') {
          await svc.addLog(after.id, req, `Post-incident review marked not required. Reason: ${String(after.review_skip_reason).trim()}`, 'decision');
        } else if (was !== 'open') {
          await svc.addLog(after.id, req, `Post-incident review reopened (status "${label}").`);
        } else {
          await svc.addLog(after.id, req,
            `Post-incident review: ${label}${after.review_held_at ? `; meeting ${stamp(after.review_held_at)}` : ''}.`);
        }
      }
      // The incident has just closed and a review is still to do: tell the lead when it is due.
      if (!before.closed_at && after.closed_at && now === 'open' && after.review_due_on) {
        const due = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
          .format(new Date(`${String(after.review_due_on).slice(0, 10)}T00:00:00Z`));
        await notifyPerson(ctx, after, after.review_lead_id ?? after.lead_id, {
          kind: 'due', title: `Post-incident review due by ${due}: ${after.ref}`, body: after.title,
        });
      }
    }

    /** Kinds of data must come from the configurable list; a kind already on the incident may stay after it is retired. */
    async function cleanKinds(value: unknown, held: string[]): Promise<string[]> {
      if (value === null || value === undefined) return [];
      const bad = () => ctx.fail(400, 'validation', 'Check the highlighted fields.', { data_kinds: 'Choose kinds of data from the list.' });
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) bad();
      const allowed = new Set([...(await ctx.lookups.values(KIND_LIST)).map((k) => k.value), ...held]);
      const out = [...new Set(value as string[])];
      if (out.some((v) => !allowed.has(v))) bad();
      return out.sort();
    }

    function checkTimes(patch: Row, existing: Row) {
      const fields: Record<string, string> = {};
      const soon = Date.now() + 5 * 60_000;
      if (patch.discovered_at && new Date(patch.discovered_at).getTime() > soon) fields.discovered_at = 'Discovered cannot be in the future.';
      const merged = { ...existing, ...patch };
      if (patch.closed_at && merged.discovered_at && new Date(patch.closed_at) < new Date(merged.discovered_at)) {
        fields.closed_at = 'Closed cannot be before the discovery time.';
      }
      if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    }

    /**
     * Ransom payment control: the organization's policy or the law may require formal approval
     * before a ransom is paid, so "approved" is refused until an approval reference is recorded.
     * The rule and the field's name follow the "ransom_approval" option (Administration > Features; E18-28).
     */
    async function checkRansom(status: unknown, resolution: unknown) {
      if (status !== 'approved' || String(resolution ?? '').trim()) return;
      const state = await featureState(db);
      if (!optionOn(state, 'ransom_approval')) return;
      const name = optionName(state, 'ransom_approval');
      const lower = /^[A-Z][a-z]/.test(name) ? name.charAt(0).toLowerCase() + name.slice(1) : name;
      ctx.fail(400, 'validation', `A ransom payment cannot be marked approved without the ${lower}.`, {
        board_resolution_ref: `Enter the ${lower} before marking the ransom payment approved.`,
      });
    }

    /** What a status means comes from the lifecycle list (lookup meta "stage"), not from its name. */
    async function stageOf(status: unknown): Promise<Stage> {
      return (await lifecycle(ctx)).find((s) => s.value === status)?.stage ?? 'reported';
    }

    async function stampStatus(status: string, existing: Row, patch: Row, now: string) {
      const has = (f: string) => patch[f] ?? existing[f];
      const reached = STAGES.indexOf(await stageOf(status));
      if (reached >= STAGES.indexOf('declared') && !has('declared_at')) patch.declared_at = now;
      if (reached >= STAGES.indexOf('contained') && !has('contained_at')) patch.contained_at = now;
      if (reached >= STAGES.indexOf('closed') && !has('closed_at')) patch.closed_at = now;
    }

    async function ransomChanged(req: Req, before: Row, after: Row) {
      const label = await labelOfLookup('ransom_payment_status', after.ransom_payment_status);
      await ctx.audit(req, {
        action: 'security_incident.ransom_decision', recordType: 'security_incident', recordId: after.id,
        summary: `Ransom payment status set to "${label}"${after.board_resolution_ref ? ` (approval reference ${after.board_resolution_ref})` : ''}`,
        before: { ransom_payment_status: before.ransom_payment_status, board_resolution_ref: before.board_resolution_ref ?? null },
        after: { ransom_payment_status: after.ransom_payment_status, board_resolution_ref: after.board_resolution_ref ?? null },
      });
      await svc.addLog(after.id, req,
        `Ransom payment status set to "${label}"${after.ransom_payment_status === 'approved' ? `, approval reference ${after.board_resolution_ref}` : ''}.`, 'decision');
    }

    ctx.defineResource({
      type: 'notification_task', table: 'notification_tasks', module: 'security',
      label: 'Notification task', plural: 'Notification tasks',
      path: '/api/notification-tasks', route: '/security-incidents/notifications',
      titleField: 'title', ref: { field: 'ref', prefix: 'NOT-' }, restricted: true,
      searchable: ['title', 'party', 'reference_received'],
      defaultSort: { field: 'due_at', dir: 'asc' },
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true },
        title: { label: 'Title', type: 'text' },
        incident_id: { label: 'Security incident', type: 'ref', to: 'security_incident', required: true },
        rule_id: { label: 'Notification rule', type: 'text' },
        party: { label: 'Party to notify', type: 'text', required: true },
        deadline_hours: { label: 'Deadline (hours from discovery)', type: 'number' },
        required: { label: 'Required (not just recommended)', type: 'boolean', default: true },
        guidance: { label: 'Guidance', type: 'longtext' },
        due_at: { label: 'Due', type: 'datetime' },
        status: { label: 'Status', type: 'lookup', list: 'notification_task_status', default: 'pending', required: true },
        auto_not_required: { label: 'Closed automatically', type: 'boolean', default: false },
        notified_who: { label: 'Who was notified', type: 'text' },
        notified_how: { label: 'How', type: 'text' },
        notified_at: { label: 'Notified at', type: 'datetime' },
        reference_received: { label: 'Reference received', type: 'text' },
        completed_by: { label: 'Completed by', type: 'user', readOnly: true },
        completed_at: { label: 'Completed at', type: 'datetime', readOnly: true },
      },
      hooks: {
        beforeCreate: async (req, data) => {
          const incident = await ctx.resources.find('security_incident', String(data.incident_id), req?.user);
          if (!incident) ctx.fail(400, 'validation', 'Check the highlighted fields.', { incident_id: 'Choose a security incident.' });
          if (data.rule_id && !UUID_RE.test(String(data.rule_id))) ctx.fail(400, 'validation', 'Check the highlighted fields.', { rule_id: 'Notification rule is not a valid reference.' });
          if (data.required === null) data.required = true;
          data.auto_not_required = false;
          if (!data.title) data.title = `Notify ${data.party}`;
          if (data.status === 'done') completion({}, data, req);
          return data;
        },
        beforeUpdate: (req, existing, patch) => {
          if (patch.incident_id !== undefined && patch.incident_id !== existing.incident_id) {
            ctx.fail(400, 'validation', 'Check the highlighted fields.', { incident_id: 'A notification task cannot be moved to another incident.' });
          }
          if (patch.rule_id !== undefined && patch.rule_id !== existing.rule_id) delete patch.rule_id;
          if (patch.title === null) delete patch.title;
          if (patch.required === null) delete patch.required;
          if (patch.auto_not_required === null) delete patch.auto_not_required;
          if (patch.status !== undefined && patch.status !== existing.status) {
            if (patch.auto_not_required === undefined) patch.auto_not_required = false;
            if (patch.status === 'done') completion(existing, patch, req);
            else if (existing.status === 'done') { patch.completed_by = null; patch.completed_at = null; }
          } else if (existing.status === 'done') {
            completion(existing, patch, req, false);
          }
          return patch;
        },
        afterCreate: async (req, row) => {
          if (row.status === 'done') await logCompletion(req, row);
        },
        afterUpdate: async (req, before, after) => {
          if (after.status === 'done' && before.status !== 'done') await logCompletion(req, after);
          else if (before.status === 'done' && after.status !== 'done') {
            await svc.addLog(after.incident_id, req, `Notification to ${after.party} reopened (status "${await labelOfLookup('notification_task_status', after.status)}").`, 'communication');
          }
        },
      },
    });

    /** A task is only "done" with the completion record: who was notified, how and when. */
    function completion(existing: Row, patch: Row, req: Req, stamp = true) {
      const merged = { ...existing, ...patch };
      const fields: Record<string, string> = {};
      if (!String(merged.notified_who ?? '').trim()) fields.notified_who = 'Record who was notified.';
      if (!String(merged.notified_how ?? '').trim()) fields.notified_how = 'Record how they were notified (phone, email, web form...).';
      if (merged.notified_at && new Date(merged.notified_at).getTime() > Date.now() + 5 * 60_000) fields.notified_at = 'The notification time cannot be in the future.';
      if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
      if (!stamp) return;
      const now = new Date().toISOString();
      if (!merged.notified_at) patch.notified_at = now;
      patch.completed_by = req?.user?.id ?? null;
      patch.completed_at = now;
    }

    async function logCompletion(req: Req, task: Row) {
      await svc.addLog(task.incident_id, req,
        `Notification recorded: ${task.party}. Notified ${task.notified_who} by ${task.notified_how} at ${stamp(task.notified_at)}`
        + `${task.reference_received ? `; reference ${task.reference_received}` : ''}.`, 'communication');
    }

    // ---------- regulatory clocks ----------

    const amberFraction = () => readAmberFraction(ctx);

    /**
     * Notification tasks across every incident, most urgent first. `status` = pending (default),
     * done, not_required or all. The summary always counts the open clocks, and the reviews
     * that are due, so one read feeds the notifications page and the incident list.
     */
    app.get('/api/security-incidents/clocks', view, async (req) => {
      const now = new Date();
      const fraction = await amberFraction();
      const wanted = String((req.query as Row)?.status ?? 'pending');
      const status = ['pending', 'done', 'not_required', 'all'].includes(wanted) ? wanted : 'pending';
      const rows = await db.query<Row>(
        `select t.*, u.display_name as completed_by_name, i.discovered_at, i.ref as incident_ref, i.title as incident_title,
                i.severity as incident_severity, i.status as incident_status
         from notification_tasks t join security_incidents i on i.id = t.incident_id left join users u on u.id = t.completed_by
         where t.deleted_at is null and i.deleted_at is null order by t.due_at nulls last`,
      );
      const all = rows.map((r) => ({
        ...clockOf(r, r.discovered_at, now, fraction),
        incident: { id: r.incident_id, ref: r.incident_ref, title: r.incident_title, severity: r.incident_severity, status: r.incident_status },
      })).sort(byUrgency);
      const count = (s: string) => all.filter((c: Row) => c.state === s).length;
      const closed = (await lifecycle(ctx)).filter((s) => s.stage === 'closed').map((s) => s.value);
      const openReview = (await reviewLifecycle(ctx)).filter((s) => s.stage === 'open').map((s) => s.value);
      const incidents = (await db.one<{ open: number; reviews: number }>(
        `select count(*) filter (where status <> all($1::text[]))::int as open,
                count(*) filter (where closed_at is not null and review_status = any($2::text[]))::int as reviews
         from security_incidents where deleted_at is null`, [closed, openReview]))!;
      return {
        now: now.toISOString(), amber_fraction: fraction,
        summary: {
          red: count('red'), amber: count('amber'), green: count('green'), open: count('red') + count('amber') + count('green'),
          done: count('met'), not_required: count('not_required'), open_incidents: incidents.open, reviews_due: incidents.reviews,
        },
        clocks: status === 'all' ? all : all.filter((c: Row) => c.status === status),
      };
    });

    /** Raises any amber or red alert that is due now. The server also does this by itself every minute. */
    app.post('/api/security-incidents/clocks/sweep', administer, async () => sweep());

    /** The lifecycle as data: each status with the stage it stands for, and the review statuses. */
    app.get('/api/security-incidents/lifecycle', view, async () => ({
      stages: STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s] })),
      statuses: await lifecycle(ctx),
      review_statuses: await reviewLifecycle(ctx),
      phases: (await ctx.lookups.values('incident_checklist_phase')).map((p) => ({ value: p.value, label: p.label })),
      time_zone: TIME_ZONE,
    }));

    /** The generated incident report: timeline, decisions, notifications made and lessons, for printing. */
    app.get('/api/security-incidents/:id/report', view, async (req) => buildReport(ctx, req, await incidentOf(req)));

    app.get('/api/security-incidents/:id/clocks', view, async (req) => {
      const incident = await incidentOf(req);
      const now = new Date();
      const fraction = await amberFraction();
      const tasks = await db.query<Row>(
        `select t.*, u.display_name as completed_by_name from notification_tasks t left join users u on u.id = t.completed_by
         where t.incident_id = $1 and t.deleted_at is null order by t.due_at nulls last, t.party`, [incident.id],
      );
      return {
        now: now.toISOString(), amber_fraction: fraction,
        incident: { id: incident.id, ref: incident.ref, title: incident.title, discovered_at: incident.discovered_at, declared_at: incident.declared_at },
        clocks: tasks.map((t) => clockOf(t, incident.discovered_at, now, fraction)).sort(byUrgency),
      };
    });

    /** Which notifications a set of answers would require; used by the declare flow before anything is saved. */
    app.post('/api/security-incidents/notification-preview', view, async (req) => {
      const b = (req.body ?? {}) as Row;
      const flags: Row = {};
      for (const f of FLAG_FIELDS) flags[f] = b[f] === true;
      flags.data_kinds = Array.isArray(b.data_kinds) ? b.data_kinds.filter((k: unknown) => typeof k === 'string') : [];
      const discovered = b.discovered_at ? new Date(String(b.discovered_at)) : new Date();
      if (Number.isNaN(discovered.getTime())) ctx.fail(400, 'validation', 'Check the highlighted fields.', { discovered_at: 'Discovered must be a date and time.' });
      const all = await db.query<Row>(`select * from notification_rules where deleted_at is null order by sort, party`);
      const applies = (r: Row) => triggerApplies(r.trigger_attribute, flags);
      const shape = (r: Row) => ({
        rule_id: r.id, party: r.party, trigger_attribute: r.trigger_attribute, deadline_hours: r.deadline_hours, required: r.required, guidance: r.guidance,
        due_at: r.deadline_hours === null ? null : new Date(discovered.getTime() + Number(r.deadline_hours) * HOUR).toISOString(),
      });
      return {
        discovered_at: discovered.toISOString(),
        notifications: all.filter((r) => r.active && r.deadline_hours !== null && applies(r)).map(shape),
        // Rules that would apply but are switched off (no deadline set yet): shown so nobody forgets them.
        not_configured: all.filter((r) => !(r.active && r.deadline_hours !== null) && applies(r)).map(shape),
      };
    });

    /** The yes/no questions of the declare flow and the triggers a notification rule may use. */
    app.get('/api/security-incidents/questions', view, async () => ({
      questions: await incidentQuestions(ctx),
      triggers: await triggerOptions(ctx),
    }));

    // ---------- offline incident kit, and its PDF copies on a schedule (kit.ts) ----------

    const kitCopies = registerKit(ctx, { view, exporter: { preHandler: guard('export') }, administer });

    // ---------- incident log (append-only: list and add, nothing else) ----------

    app.get('/api/security-incidents/:id/log', view, async (req) => {
      const incident = await incidentOf(req);
      return db.query(
        `select id, incident_id, at, author_id, author_name, entry, kind, created_at from incident_log_entries
         where incident_id = $1 order by at desc, created_at desc`, [incident.id],
      );
    });

    app.post('/api/security-incidents/:id/log', edit, async (req, reply) => {
      const incident = await incidentOf(req);
      const b = await parseCols({
        entry: { label: 'Entry', required: true },
        kind: { label: 'Kind', list: 'incident_log_kind' },
        at: { label: 'Time', type: 'datetime' },
      }, (req.body ?? {}) as Row, 'create');
      if (b.at && new Date(b.at).getTime() > Date.now() + 5 * 60_000) {
        ctx.fail(400, 'validation', 'Check the highlighted fields.', { at: 'The time of a log entry cannot be in the future.' });
      }
      const row = await svc.addLog(incident.id, req, b.entry, b.kind ?? 'note', b.at ? new Date(b.at) : undefined);
      await ctx.audit(req, {
        action: 'security_incident.log_add', recordType: 'security_incident', recordId: incident.id,
        summary: 'Incident log entry added', after: { id: row.id, at: row.at, kind: row.kind, entry: row.entry },
      });
      reply.code(201);
      return row;
    });

    // ---------- roles, evidence and checklist items on an incident ----------

    function childRoutes(o: { seg: string; table: string; noun: string; spec: Record<string, ColSpec>; order: string; describe: (r: Row) => string }) {
      const base = `/api/security-incidents/:id/${o.seg}`;
      const childOf = async (req: FastifyRequest, incident: Row): Promise<Row> => {
        const cid = String((req.params as Row).childId ?? '');
        const row = UUID_RE.test(cid)
          ? await db.one<Row>(`select * from ${o.table} where id = $1 and incident_id = $2 and deleted_at is null`, [cid, incident.id])
          : undefined;
        return row ?? ctx.fail(404, 'not_found', `${o.noun} not found.`);
      };

      app.get(base, view, async (req) => {
        const incident = await incidentOf(req);
        return db.query(`select * from ${o.table} where incident_id = $1 and deleted_at is null order by ${o.order}`, [incident.id]);
      });

      app.post(base, edit, async (req, reply) => {
        const incident = await incidentOf(req);
        const data = await parseCols(o.spec, (req.body ?? {}) as Row, 'create');
        const row = await insertRow(o.table, { ...data, incident_id: incident.id }, req);
        await ctx.audit(req, {
          action: `security_incident.${o.seg}_add`, recordType: 'security_incident', recordId: incident.id,
          summary: `${o.noun} added: ${o.describe(row)}`, after: data,
        });
        reply.code(201);
        return row;
      });

      app.patch(`${base}/:childId`, edit, async (req) => {
        const incident = await incidentOf(req);
        const before = await childOf(req, incident);
        const patch = await parseCols(o.spec, (req.body ?? {}) as Row, 'update');
        const diff = changed(before, patch);
        if (!Object.keys(diff.after).length) return before;
        const row = await updateRow(o.table, before.id, diff.after, req);
        await ctx.audit(req, {
          action: `security_incident.${o.seg}_update`, recordType: 'security_incident', recordId: incident.id,
          summary: `${o.noun} updated: ${o.describe(row)}`, before: diff.before, after: diff.after,
        });
        return row;
      });

      app.delete(`${base}/:childId`, edit, async (req) => {
        const incident = await incidentOf(req);
        const before = await childOf(req, incident);
        await db.query(`update ${o.table} set deleted_at = now(), updated_by = $2 where id = $1`, [before.id, req.user!.id]);
        await ctx.audit(req, {
          action: `security_incident.${o.seg}_remove`, recordType: 'security_incident', recordId: incident.id,
          summary: `${o.noun} removed: ${o.describe(before)}`, before,
        });
        return { ok: true };
      });
    }

    childRoutes({
      seg: 'roles', table: 'incident_roles', noun: 'Incident role', order: 'sort, created_at',
      spec: {
        role: { label: 'Role', required: true },
        person_name: { label: 'Person' },
        contact: { label: 'Contact' },
        sort: { label: 'Order', type: 'number' },
      },
      describe: (r) => `${r.role}${r.person_name ? ` - ${r.person_name}` : ''}`,
    });

    childRoutes({
      seg: 'evidence', table: 'incident_evidence', noun: 'Evidence item', order: 'collected_at nulls last, created_at',
      spec: {
        item: { label: 'Item', required: true },
        where_held: { label: 'Where held' },
        collected_by: { label: 'Collected by' },
        collected_at: { label: 'Collected at', type: 'datetime' },
        hash_ref: { label: 'Hash or reference' },
      },
      describe: (r) => r.item,
    });

    const checklistBase = '/api/security-incidents/:id/checklist';

    app.get(checklistBase, view, async (req) => {
      const incident = await incidentOf(req);
      return db.query(
        `select * from incident_checklist_items where incident_id = $1 and deleted_at is null order by phase, sort, created_at`, [incident.id],
      );
    });

    app.post(checklistBase, edit, async (req, reply) => {
      const incident = await incidentOf(req);
      const data = await parseCols({
        phase: { label: 'Phase', required: true, list: 'incident_checklist_phase' },
        step: { label: 'Step', required: true },
      }, (req.body ?? {}) as Row, 'create');
      const last = await db.one<{ s: number }>(
        `select coalesce(max(sort), 0)::int as s from incident_checklist_items where incident_id = $1 and phase = $2 and deleted_at is null`,
        [incident.id, data.phase],
      );
      const row = await insertRow('incident_checklist_items', { ...data, incident_id: incident.id, scenario: incident.scenario, sort: last!.s + 10 }, req);
      await ctx.audit(req, {
        action: 'security_incident.checklist_add', recordType: 'security_incident', recordId: incident.id,
        summary: `Checklist step added (${data.phase}): ${data.step}`, after: data,
      });
      reply.code(201);
      return row;
    });

    app.patch(`${checklistBase}/:itemId`, edit, async (req) => {
      const incident = await incidentOf(req);
      const itemId = String((req.params as Row).itemId ?? '');
      const before = (UUID_RE.test(itemId)
        ? await db.one<Row>(`select * from incident_checklist_items where id = $1 and incident_id = $2 and deleted_at is null`, [itemId, incident.id])
        : undefined) ?? ctx.fail(404, 'not_found', 'Checklist step not found.');
      const b = await parseCols({ done: { label: 'Done', type: 'boolean' } }, (req.body ?? {}) as Row, 'update');
      if (b.done === undefined || b.done === before.done) return before;
      const row = await updateRow('incident_checklist_items', before.id, b.done
        ? { done: true, done_by: req.user!.id, done_by_name: req.user!.displayName, done_at: new Date().toISOString() }
        : { done: false, done_by: null, done_by_name: null, done_at: null }, req);
      await ctx.audit(req, {
        action: b.done ? 'security_incident.checklist_tick' : 'security_incident.checklist_untick',
        recordType: 'security_incident', recordId: incident.id,
        summary: `Checklist step ${b.done ? 'checked' : 'unchecked'} (${before.phase}): ${before.step}`,
        before: { done: before.done }, after: { done: row.done },
      });
      return row;
    });

    // ---------- configuration: notification rules, checklist templates, standing contacts ----------

    function configRoutes(o: {
      path: string; table: string; noun: string; recordType: string; spec: Record<string, ColSpec>; order: string;
      describe: (r: Row) => string; check?: (merged: Row) => void; after?: (req: FastifyRequest) => Promise<void>;
      filter?: (query: Row) => { sql: string; params: unknown[] };
    }) {
      const one = async (req: FastifyRequest): Promise<Row> => {
        const id = String((req.params as Row).id ?? '');
        const row = UUID_RE.test(id) ? await db.one<Row>(`select * from ${o.table} where id = $1 and deleted_at is null`, [id]) : undefined;
        return row ?? ctx.fail(404, 'not_found', `${o.noun} not found.`);
      };

      app.get(o.path, view, async (req) => {
        const f = o.filter?.((req.query ?? {}) as Row) ?? { sql: 'true', params: [] };
        return db.query(`select * from ${o.table} where deleted_at is null and ${f.sql} order by ${o.order}`, f.params);
      });

      app.post(o.path, administer, async (req, reply) => {
        const data = await parseCols(o.spec, (req.body ?? {}) as Row, 'create');
        o.check?.(data);
        const row = await insertRow(o.table, data, req);
        await ctx.audit(req, { action: `${o.recordType}.create`, recordType: o.recordType, recordId: row.id, summary: `${o.noun} added: ${o.describe(row)}`, after: data });
        await o.after?.(req);
        reply.code(201);
        return row;
      });

      app.patch(`${o.path}/:id`, administer, async (req) => {
        const before = await one(req);
        const patch = await parseCols(o.spec, (req.body ?? {}) as Row, 'update');
        o.check?.({ ...before, ...patch });
        const diff = changed(before, patch);
        if (!Object.keys(diff.after).length) return before;
        const row = await updateRow(o.table, before.id, diff.after, req);
        await ctx.audit(req, {
          action: `${o.recordType}.update`, recordType: o.recordType, recordId: row.id,
          summary: `${o.noun} updated: ${o.describe(row)}`, before: diff.before, after: diff.after,
        });
        await o.after?.(req);
        return row;
      });

      app.delete(`${o.path}/:id`, administer, async (req) => {
        const before = await one(req);
        await db.query(`update ${o.table} set deleted_at = now(), updated_by = $2 where id = $1`, [before.id, req.user!.id]);
        await ctx.audit(req, { action: `${o.recordType}.delete`, recordType: o.recordType, recordId: before.id, summary: `${o.noun} removed: ${o.describe(before)}`, before });
        await o.after?.(req);
        return { ok: true };
      });
    }

    configRoutes({
      path: '/api/security-notification-rules', table: 'notification_rules', noun: 'Notification rule', recordType: 'notification_rule',
      order: 'sort, party',
      spec: {
        trigger_attribute: { label: 'Trigger', required: true, allowed: async () => (await triggerOptions(ctx)).map((t) => t.value) },
        party: { label: 'Party to notify', required: true },
        deadline_hours: { label: 'Deadline (hours from discovery)', type: 'number' },
        required: { label: 'Required', type: 'boolean' },
        guidance: { label: 'Guidance' },
        active: { label: 'Active', type: 'boolean' },
        sort: { label: 'Order', type: 'number' },
      },
      describe: (r) => r.party,
      check: (m) => {
        const fields: Record<string, string> = {};
        const hours = m.deadline_hours ?? null;
        if (hours !== null && (hours < 0 || hours > 24 * 366)) fields.deadline_hours = 'Deadline must be between 0 hours (immediately) and one year.';
        // A new rule is active by default, so it needs a deadline too.
        if (m.active !== false && hours === null) fields.deadline_hours = 'Set a deadline in hours from discovery before switching this rule on.';
        if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
      },
      // Open incidents pick up a changed rule straight away.
      after: (req) => svc.resyncOpenIncidents(req),
    });

    configRoutes({
      path: '/api/security-checklist-templates', table: 'incident_checklist_templates', noun: 'Checklist step', recordType: 'incident_checklist_template',
      order: 'scenario, phase, sort, created_at',
      spec: {
        scenario: { label: 'Scenario', required: true, list: 'security_incident_scenario' },
        phase: { label: 'Phase', required: true, list: 'incident_checklist_phase' },
        step: { label: 'Step', required: true },
        sort: { label: 'Order', type: 'number' },
        active: { label: 'Active', type: 'boolean' },
      },
      describe: (r) => `${r.scenario} / ${r.phase}: ${r.step}`,
      filter: (q) => (q.scenario ? { sql: 'scenario = $1', params: [String(q.scenario)] } : { sql: 'true', params: [] }),
    });

    configRoutes({
      path: '/api/security-incident-contacts', table: 'incident_contacts', noun: 'Incident contact', recordType: 'incident_contact',
      order: 'sort, role',
      spec: {
        role: { label: 'Role', required: true },
        person_name: { label: 'Person' },
        contact: { label: 'Contact' },
        notes: { label: 'Notes' },
        sort: { label: 'Order', type: 'number' },
      },
      describe: (r) => `${r.role}${r.person_name ? ` - ${r.person_name}` : ''}`,
    });

    // ---------- kinds of data and lifecycle statuses, editable on the rules screen ----------

    registerLists(ctx, { view, administer });
    registerAlertRoutes(ctx, { view, administer }); // alerts by email and text message (E09-25)

    // ---------- alerts as a clock turns amber or red ----------

    // Every minute on the job queue (Administration > Background jobs), once however many processes there are.
    await scheduleWork(ctx, 'secincidents.clock_sweep', () => sweep(), { every: 60_000, firstRunInMs: 20_000 });
    // A PDF copy of the offline kit after any change and on a schedule (E09-16).
    await scheduleKit(ctx, kitCopies);
  },

  async seed(ctx, opts) {
    const svc = makeService(ctx);
    // The organization's own rules first, so that open incidents and the sample pick them up.
    const added = await loadOrganizationRules(ctx, opts?.organization?.notificationRules);
    if (added) await svc.resyncOpenIncidents(null);
    // The invented sample incident is dev profile only (E18-69).
    const sample = opts.profile === 'dev' ? await seedSample(ctx, svc) : 'no sample incident (dev profile only)';
    return `${added} notification rule${added === 1 ? '' : 's'} added from the organization profile; ${sample}`;
  },
};

export default mod;
