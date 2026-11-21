// E05-13: change approval on the shared approval workflows. Each approval rule (change type and
// risk level) names a workflow of the kind `change_approval`; the number of approvals and who gives
// them are that workflow's first step, which the rules editor keeps in step with the rule (further
// steps, due times and escalation are set under Administration > Approval workflows). Submitting a
// change starts the rule's workflow; its outcome moves the change as recorded approvals did.
import type { FastifyRequest } from 'fastify';
import { approvalEngine, approvalKind, defineApprovalKind, type ApprovalEngine, type InstallHelpers } from '../../core/approval-kinds.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { emitWebhookEvent } from '../../core/webhooks.ts';
import { SETTING_RULES, type Base } from './base.ts';
import { notifyDecision } from './notify.ts';
import { ANY, DEFAULT_APPROVAL_RULES, matchRule, type ApprovalRule } from './rules.ts';

export const KIND = 'change_approval';
const APPROVE = 'changes.approve';

/** Details of a decision recorded through POST /api/changes/:id/approvals, until its callback writes them (shared by every service made for the app). */
const pending = new Map<string, DecisionDetails>();

const asJson = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;

/** Details a person gave with a decision recorded through the change's own route (by hand, for a meeting). */
export interface DecisionDetails { approver_name: string; approver_role: string | null; decided_on: string; reference: string | null; notes: string | null }

/** The first step a rule asks for: its approvers and how many approvals. */
export function stepOf(rule: ApprovalRule): Row {
  const users = [...new Set(rule.approver_user_ids ?? [])];
  const roles = [...new Set(rule.approver_role_keys ?? [])];
  return {
    key: 'approvers',
    name: rule.approver_roles.length ? rule.approver_roles.join(', ') : 'Change approvers',
    approvers: users.length || roles.length ? { kind: 'people', users, roles } : { kind: 'permission', permission: APPROVE },
    quorum: rule.approvals <= 1 ? 'any' : rule.approvals,
    conditions: [], due_hours: null, escalate_to: null,
  };
}

/** A rule's approvals and approvers as its workflow's first step has them now. */
export function fromStep(step: Row | undefined): Partial<ApprovalRule> | null {
  if (!step) return null;
  const a = step.approvers ?? {};
  const out: Partial<ApprovalRule> = { approvals: step.quorum === 'any' ? 1 : step.quorum === 'all' ? Math.max(1, (a.users?.length ?? 1)) : Number(step.quorum) || 1 };
  if (a.kind === 'people') { out.approver_user_ids = a.users ?? []; out.approver_role_keys = a.roles ?? []; }
  else if (a.kind === 'users') { out.approver_user_ids = a.users ?? []; out.approver_role_keys = []; }
  else if (a.kind === 'role') { out.approver_user_ids = []; out.approver_role_keys = [a.role]; }
  else { out.approver_user_ids = []; out.approver_role_keys = []; }
  return out;
}

const ruleName = (r: ApprovalRule, typeLabel: (v: string) => string, riskLabel: (v: string) => string) =>
  `Change approval: ${r.change_type === ANY ? 'any change' : `${typeLabel(r.change_type).toLowerCase()} change`}${r.risk_level === ANY ? '' : `, ${riskLabel(r.risk_level).toLowerCase()} risk`}`;

export function makeChangeApproval(ctx: ModuleContext, base: Base) {
  const { db } = ctx;
  const engine = (): ApprovalEngine => approvalEngine(ctx.app) ?? ctx.fail(409, 'approvals_unavailable', 'Approval workflows are not available in this installation.');


  const key = (changeId: string, userId: string) => `${changeId}:${userId}`;

  async function labels() {
    const types = await ctx.lookups.values('change_type');
    const risks = await ctx.lookups.values('change_risk');
    return {
      type: (v: string) => types.find((x) => x.value === v)?.label ?? v,
      risk: (v: string) => risks.find((x) => x.value === v)?.label ?? v,
    };
  }

  async function definition(id: string | null | undefined): Promise<Row | undefined> {
    if (!id) return undefined;
    return db.one<Row>('select * from workflow_definitions where id = $1 and kind = $2 and deleted_at is null', [id, KIND]);
  }

  /** Rules with their approvals and approvers read from their workflows (the workflow is the source). */
  async function rulesWithWorkflows(rules: ApprovalRule[]): Promise<(ApprovalRule & { workflow_name?: string | null })[]> {
    const out = [];
    for (const r of rules) {
      const w = r.approvals > 0 ? await definition(r.workflow_id) : undefined;
      const first = w ? fromStep(asJson<Row[]>(w.steps)[0]) : null;
      out.push({ ...r, ...(first ?? {}), approvals: r.approvals > 0 && first ? first.approvals! : r.approvals, workflow_name: w?.name ?? null });
    }
    return out;
  }

  /**
   * After the rules are saved: each rule that asks for approval gets a workflow (made when it has
   * none), and its first step follows the rule's approvals and approvers. Answers the rules with
   * their workflow ids. `req` null: the system (install).
   */
  async function syncWorkflows(rules: ApprovalRule[], req: FastifyRequest | null, h?: InstallHelpers): Promise<ApprovalRule[]> {
    const l = await labels();
    const out: ApprovalRule[] = [];
    for (const r of rules) {
      if (r.approvals <= 0) { out.push({ ...r, workflow_id: r.workflow_id ?? null }); continue; }
      const step = stepOf(r);
      const w = await definition(r.workflow_id);
      if (w) {
        const steps = asJson<Row[]>(w.steps);
        const first = steps[0] ?? {};
        if (JSON.stringify([first.approvers, first.quorum]) !== JSON.stringify([step.approvers, step.quorum])) {
          steps[0] = { ...first, approvers: step.approvers, quorum: step.quorum, name: first.name ?? step.name };
          await db.query('update workflow_definitions set steps = $2::jsonb, version = version + 1, updated_at = now(), updated_by = $3 where id = $1',
            [w.id, JSON.stringify(steps), req?.user?.id ?? null]);
          await ctx.audit(req, { action: 'workflow_definition.update', summary: `Approval workflow "${w.name}" follows the change approval rule's approvers`, before: { step: first }, after: { step: steps[0] } });
        }
        out.push({ ...r, workflow_id: w.id });
        continue;
      }
      let id: string;
      {
        const input = { name: ruleName(r, l.type, l.risk), description: 'Made from the change approval rules. Its first step follows the rule; add steps, due times and escalation here.', steps: [step] };
        if (h) id = await h.define(input);
        else {
          id = (await db.one<{ id: string }>(
            `insert into workflow_definitions (record_type, kind, name, description, trigger, steps, created_by, updated_by)
             values ('change', $1, $2, $3, 'module', $4::jsonb, $5, $5) returning id`,
            [KIND, input.name, input.description, JSON.stringify(input.steps), req?.user?.id ?? null]))!.id;
          await ctx.audit(req, { action: 'workflow_definition.create', summary: `Approval workflow "${input.name}" created for changes`, after: input });
        }
      }
      out.push({ ...r, workflow_id: id });
    }
    return out;
  }

  async function recordId(change: Row): Promise<Row> {
    return (await ctx.resources.find('change', change.id))!;
  }

  /** Keeps the change's approval counts in step with its workflow (shown in lists and checked by status moves). */
  async function syncCounts(changeId: string, finished = false): Promise<Row> {
    const change = (await ctx.resources.find('change', changeId))!;
    const p = await engine().progress(KIND, changeId, null);
    const required = Math.max(Number(change.approvals_required) || 0, p.required);
    const received = finished ? Math.max(required, p.approvals) : p.approvals;
    if (received === Number(change.approvals_received) && required === Number(change.approvals_required)) return change;
    return base.setFields(null, changeId, { approvals_received: received, approvals_required: finished ? received : required });
  }

  // Declared once per application (the seed command makes a second service).
  if (!approvalKind(ctx.app, KIND)) defineApprovalKind(ctx.app, {
    key: KIND, recordType: 'change', label: 'Change approval', approverPermission: APPROVE,
    startsWhen: 'A change is submitted for approval (each approval rule names its workflow)',
    outcome: 'Approved: the change becomes Approved (or, when the work had already started, is flagged as approved afterwards); rejected: the change becomes Rejected',
    route: (id) => `/changes/${id}?tab=approvals`,
    tellsRequester: false,

    async onDecision(e) {
      const change = await recordId({ id: e.instance.recordId });
      const details = pending.get(key(change.id, e.userId));
      const retrospective = change.status !== 'submitted';
      const own = !details || details.approver_name === e.userName;
      const name = own ? (e.onBehalfOfName ? `${e.userName} on behalf of ${e.onBehalfOfName}` : e.userName) : details!.approver_name;
      await base.insertRow('change_approvals', {
        change_id: change.id, decision: e.decision, approver_name: name, approver_role: details?.approver_role ?? null,
        decided_on: details?.decided_on ?? todayInZone(),
        reference: details?.reference ?? null, notes: details ? details.notes : e.comment, retrospective,
        recorded_by: e.userId, recorded_by_name: e.userName, approver_user_id: own ? e.userId : null,
      });
      const updated = await syncCounts(change.id);
      await ctx.audit(e.req, {
        action: 'change.approval', recordType: 'change', recordId: change.id,
        summary: `${base.changeLabel(change)} ${e.decision} by ${name}${details?.approver_role ? ` (${details.approver_role})` : ''}`
          + `${retrospective ? ', recorded after the work started' : ''}: ${updated.approvals_received} of ${updated.approvals_required} approvals`,
        after: { decision: e.decision, approver_name: name, retrospective, approvals_received: updated.approvals_received, approvals_required: updated.approvals_required, workflow: e.instance.name },
      });
      // Kept for a release beside workflow.decided (see the API guide).
      await emitWebhookEvent(ctx.app, {
        event: 'change.approval_decided', record: { type: 'change', id: change.id }, req: e.req,
        data: { decision: e.decision, approver: name, approvalsReceived: updated.approvals_received, approvalsRequired: updated.approvals_required, status: updated.status },
      });
    },

    async onFinish(e) {
      if (e.byModule) return;
      const change = await recordId({ id: e.instance.recordId });
      if (!change) return;
      const by = e.approverName ? (e.onBehalfOfName ? `${e.approverName} on behalf of ${e.onBehalfOfName}` : e.approverName) : 'the approvers';
      if (e.outcome === 'approved') {
        const counted = await syncCounts(change.id, true);
        const patch: Row = change.status === 'submitted' ? { status: 'approved' } : { approved_retrospectively: true };
        const updated = await base.setFields(null, change.id, patch);
        await notifyDecision(ctx, updated, { decision: 'approved', by, actorId: e.approverId, received: Number(counted.approvals_received), required: Number(counted.approvals_required) });
      } else if (e.outcome === 'rejected') {
        if (change.status === 'submitted') {
          const updated = await base.setFields(null, change.id, { status: 'rejected' });
          await notifyDecision(ctx, updated, { decision: 'rejected', by, actorId: e.approverId, received: Number(updated.approvals_received), required: Number(updated.approvals_required) });
        } else {
          // The work had started under a rule that allows approval afterwards: the rejection stays on
          // the record and the approval is asked for again, so the change cannot be closed without it.
          await notifyDecision(ctx, change, { decision: 'rejected', by, actorId: e.approverId, received: Number(change.approvals_received), required: Number(change.approvals_required) });
          const rule = matchRule(await base.approvalRules(), change.change_type, change.risk_level);
          await engine().start(KIND, change, { requester: change.created_by ?? null, req: null, definitionId: rule.workflow_id ?? null, note: 'Asked again after a rejection recorded after the work started.' });
        }
      } else if (change.status === 'submitted') {
        // Canceled from the approval panel (by whoever asked, or an administrator): back to draft.
        await base.setFields(null, change.id, { status: 'draft', approvals_received: 0, submitted_at: null, approver_pool: null });
        await ctx.audit(e.req, {
          action: 'change.transition', recordType: 'change', recordId: change.id,
          summary: `${base.changeLabel(change)} returned to draft: its approval workflow was canceled${e.comment ? ` (${e.comment})` : ''}`,
          before: { status: 'submitted' }, after: { status: 'draft' },
        });
      }
    },

    async install(h) {
      // The rules in force (on a new installation, the defaults) become workflows.
      const stored = await ctx.settings.get<ApprovalRule[] | null>(SETTING_RULES, null);
      const rules = await syncWorkflows(stored ?? DEFAULT_APPROVAL_RULES, null, h);
      await ctx.settings.set(SETTING_RULES, rules);
      // Changes waiting for approval move onto the workflow of their rule, with the approvals already recorded.
      const waiting = await db.query<Row>(
        `select * from changes where deleted_at is null and approvals_required > 0 and approvals_received < approvals_required
           and status in ('submitted', 'in_progress', 'completed', 'reviewed')`);
      const holders = await h.usersWith(APPROVE);
      const fallback = rules.find((r) => r.workflow_id)?.workflow_id ?? null;
      for (const c of waiting) {
        const rule = matchRule(rules, c.change_type, c.risk_level);
        const definitionId = rule.workflow_id ?? fallback;
        if (!definitionId) continue;
        const pool = asJson<{ users?: string[]; roles?: string[] } | null>(c.approver_pool);
        let people = holders.filter((u) => u !== c.created_by);
        if (pool && ((pool.users?.length ?? 0) || (pool.roles?.length ?? 0))) {
          const inRoles = pool.roles?.length
            ? (await db.query<{ user_id: string }>('select ur.user_id from user_roles ur join roles r on r.id = ur.role_id and r.enabled where r.key = any($1::text[])', [pool.roles])).map((x) => x.user_id)
            : [];
          people = people.filter((u) => (pool.users ?? []).includes(u) || inRoles.includes(u));
        }
        const since = c.submitted_at ? new Date(c.submitted_at).getTime() : 0;
        const earlier = (await db.query<Row>(`select * from change_approvals where change_id = $1 and decision = 'approved' and recorded_by is not null order by created_at`, [c.id]))
          .filter((r) => new Date(r.created_at).getTime() >= since);
        const seen = new Set<string>();
        const decisions = earlier.filter((r) => !seen.has(r.recorded_by) && seen.add(r.recorded_by)).map((r) => ({
          userId: r.recorded_by as string, decision: 'approved' as const, comment: [r.approver_name !== r.recorded_by_name ? `Recorded for ${r.approver_name}` : null, r.notes].filter(Boolean).join(': ') || null,
          at: new Date(r.created_at).toISOString(),
        }));
        await h.adopt({
          definitionId, recordId: c.id, requestedBy: c.created_by ?? null, startedAt: c.submitted_at ? new Date(c.submitted_at).toISOString() : null,
          approvers: people, required: Number(c.approvals_required), decisions, note: 'Taken over from the change approval rules.',
        });
      }
    },
  });

  return {
    syncWorkflows, rulesWithWorkflows, syncCounts, engine,
    /** Remembers the details of a decision recorded through the change's own route until its callback runs. */
    remember(changeId: string, userId: string, d: DecisionDetails) { pending.set(key(changeId, userId), d); },
    forget(changeId: string, userId: string) { pending.delete(key(changeId, userId)); },
  };
}

export type ChangeApproval = ReturnType<typeof makeChangeApproval>;
