import { todayInZone } from '../../core/timezone.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';
import { emitWebhookEvent } from '../../core/webhooks.ts';
import type { Base, Req } from './base.ts';
import type { Conflicts } from './conflicts.ts';
import { notifyApprovalRequested, notifyDecision } from './notify.ts';
import { DECISIONS, FINAL_STATUSES, inPool, matchRule, poolOf, type ApproverPool } from './rules.ts';

/** The status lifecycle, approvals and the post-implementation review. */
export function makeWorkflow(ctx: ModuleContext, base: Base, conflicts: Conflicts) {
  const { db } = ctx;

  const ruleFor = async (change: Row) => matchRule(await base.approvalRules(), change.change_type, change.risk_level);
  const statusLabel = (value: string) => base.lookupLabel('change_status', value);

  // ---------- approvals ----------

  /** Decisions recorded since the change was last submitted count; earlier ones are history. */
  async function decisions(change: Row): Promise<Row[]> {
    const rows = await db.query<Row>('select * from change_approvals where change_id = $1 order by created_at desc', [change.id]);
    const since = change.submitted_at ? new Date(change.submitted_at).getTime() : Infinity;
    return rows.map((r) => ({ ...r, current: new Date(r.created_at).getTime() >= since }));
  }

  /** Who a decision belongs to: the person who recorded it (the system's own records go by name). */
  const deciderOf = (r: Row) => (r.recorded_by ? `user:${r.recorded_by}` : `name:${String(r.approver_name).trim().toLowerCase()}`);

  /** Approvals count once per person who recorded them, so one person cannot make up the number alone. */
  const countApproved = (rows: Row[]) => new Set(rows.filter((r) => r.current && r.decision === 'approved').map(deciderOf)).size;

  const poolFor = (change: Row): ApproverPool | null => {
    const p = typeof change.approver_pool === 'string' ? JSON.parse(change.approver_pool) : change.approver_pool;
    return p && ((p.users?.length ?? 0) || (p.roles?.length ?? 0)) ? { users: p.users ?? [], roles: p.roles ?? [] } : null;
  };

  /** Active users who hold changes.approve, with their role keys. */
  async function approverCandidates(): Promise<SessionUser[]> {
    const rows = await db.query<Row>(
      `select u.id, u.username, u.display_name, u.email,
          coalesce(array_agg(distinct r.key) filter (where r.enabled), '{}') as roles,
          coalesce(array_agg(distinct rp.permission) filter (where r.enabled and rp.permission is not null), '{}') as permissions
       from users u
       left join user_roles ur on ur.user_id = u.id
       left join roles r on r.id = ur.role_id
       left join role_permissions rp on rp.role_id = r.id
       where u.status = 'active' and u.deleted_at is null
       group by u.id`,
    );
    return rows
      .map((r) => ({ id: r.id, username: r.username, displayName: r.display_name, email: r.email, roles: r.roles, permissions: r.permissions }) as SessionUser)
      .filter((u) => ctx.can(u, 'changes.approve'));
  }

  /** The people who may decide on this change now: in its pool, not its requester, and not already decided. */
  async function eligibleApprovers(change: Row): Promise<SessionUser[]> {
    const pool = poolFor(change);
    const decided = new Set((await decisions(change)).filter((r) => r.current && r.recorded_by).map((r) => r.recorded_by));
    return (await approverCandidates()).filter((u) => u.id !== change.created_by && !decided.has(u.id) && inPool(pool, u.id, u.roles ?? []));
  }

  /** True when an approval may be recorded now; `retrospective` when the work has already started. */
  function awaiting(change: Row): { open: boolean; retrospective: boolean } {
    if (change.status === 'submitted') return { open: true, retrospective: false };
    const late = ['in_progress', 'completed', 'reviewed'].includes(change.status)
      && Number(change.approvals_received) < Number(change.approvals_required);
    return { open: late, retrospective: late };
  }

  async function approvalsFor(change: Row, user?: SessionUser | null) {
    const rule = await ruleFor(change);
    const list = await decisions(change);
    const state = awaiting(change);
    const pool = poolFor(change);
    const eligible = state.open ? await eligibleApprovers(change) : [];
    const roleNames = pool?.roles.length
      ? await db.query<{ key: string; name: string }>('select key, name from roles where key = any($1::text[])', [pool.roles])
      : [];
    const userNames = pool?.users.length
      ? await db.query<{ id: string; display_name: string }>('select id, display_name from users where id = any($1::uuid[])', [pool.users])
      : [];
    return {
      required: Number(change.approvals_required), received: Number(change.approvals_received),
      outstanding: Math.max(0, Number(change.approvals_required) - Number(change.approvals_received)),
      approver_roles: rule.approver_roles, retrospective_allowed: rule.retrospective,
      awaiting: state.open, retrospective: state.retrospective,
      approved_retrospectively: change.approved_retrospectively === true,
      /** Named approvers and roles, when the rule named them at submission; null: anyone with the approve permission. */
      pool: pool ? { users: userNames.map((u) => ({ id: u.id, name: u.display_name })), roles: roleNames.map((r) => ({ key: r.key, name: r.name })) } : null,
      /** People who may still decide, by name. */
      waiting_for: eligible.map((u) => u.displayName),
      /** Whether the reader may record their own decision now. */
      can_decide: Boolean(user && state.open && eligible.some((u) => u.id === user.id)),
      decisions: list,
    };
  }

  /**
   * Records one decision. Body `{ decision, notes? }` is the reader's own decision. With
   * `approver_name` (and optionally role, date and reference) it records a decision given
   * outside the application, such as in a meeting or by email. Either way the decision
   * belongs to the person recording it: each person decides once per submission, and when
   * the rule named approvers, only they may decide.
   */
  async function recordApproval(req: Req, change: Row, body: Row) {
    const own = body.approver_name === undefined || body.approver_name === null || String(body.approver_name).trim() === '';
    const byHand = !own || body.by_hand === true;
    const c = base.checker(body, false);
    c.oneOf('decision', 'Decision', DECISIONS, true);
    if (byHand) c.text('approver_name', 'Approver name', true);
    c.text('approver_role', 'Approver role');
    c.date('decided_on', 'Decision date');
    c.text('reference', 'Reference');
    c.text('notes', 'Notes');
    const d = c.finish();
    d.decided_on ??= todayInZone();
    if (d.decided_on > todayInZone()) ctx.fail(400, 'validation', 'Check the highlighted fields.', { decided_on: 'The decision date cannot be in the future.' });
    if (!byHand && req?.user) d.approver_name = req.user.displayName;

    const state = awaiting(change);
    if (!state.open) ctx.fail(409, 'not_awaiting_approval', 'This change is not waiting for approval.');
    if (req?.user && change.created_by === req.user.id) {
      ctx.fail(403, 'own_change', 'You raised this change, so someone else must record its approval.');
    }
    const before = await decisions(change);
    if (req?.user) {
      if (!inPool(poolFor(change), req.user.id, req.user.roles ?? [])) {
        ctx.fail(403, 'not_an_approver', 'This change is waiting for the approvers its rule names, and you are not one of them.');
      }
      if (before.some((r) => r.current && r.recorded_by === req.user!.id)) {
        ctx.fail(409, 'duplicate_approver', 'You have already recorded a decision on this change. Each approval must come from a different person.');
      }
    } else if (d.decision === 'approved' && before.some((r) => r.current && deciderOf(r) === `name:${d.approver_name.toLowerCase()}`)) {
      ctx.fail(409, 'duplicate_approver', `${d.approver_name} has already approved this change. Each approval must come from a different person.`);
    }

    await base.insertRow('change_approvals', {
      change_id: change.id, decision: d.decision, approver_name: d.approver_name, approver_role: d.approver_role ?? null,
      decided_on: d.decided_on, reference: d.reference ?? null, notes: d.notes ?? null, retrospective: state.retrospective,
      recorded_by: req?.user?.id ?? null, recorded_by_name: base.actorName(req),
      approver_user_id: !byHand ? req?.user?.id ?? null : null,
    });
    const received = countApproved(await decisions(change));
    const required = Number(change.approvals_required);
    const patch: Row = { approvals_received: received };
    if (change.status === 'submitted') {
      if (d.decision === 'rejected') patch.status = 'rejected';
      else if (received >= required) patch.status = 'approved';
    } else if (d.decision === 'approved' && received >= required) {
      patch.approved_retrospectively = true;
    }
    await ctx.audit(req, {
      action: 'change.approval', recordType: 'change', recordId: change.id,
      summary: `${base.changeLabel(change)} ${d.decision} by ${d.approver_name}${d.approver_role ? ` (${d.approver_role})` : ''}`
        + `${state.retrospective ? ', recorded after the work started' : ''}: ${received} of ${required} approvals`,
      after: { ...d, retrospective: state.retrospective, approvals_received: received, approvals_required: required },
    });
    const updated = await base.setFields(req, change.id, patch);
    await notifyDecision(ctx, updated, { decision: d.decision, by: d.approver_name, actorId: req?.user?.id ?? null, received, required });
    await emitWebhookEvent(ctx.app, {
      event: 'change.approval_decided', record: { type: 'change', id: change.id }, req,
      data: { decision: d.decision, approver: d.approver_name, approvalsReceived: received, approvalsRequired: required, status: updated.status },
    });
    return { change: updated, approvals: await approvalsFor(updated, req?.user) };
  }

  // ---------- status moves ----------

  function requireForSubmit(change: Row) {
    const missing: Record<string, string> = {};
    const need = (field: string, message: string) => { if (!String(change[field] ?? '').trim()) missing[field] = message; };
    need('description', 'Describe what will be done.');
    need('reason', 'Say why the change is needed.');
    need('implementation_plan', 'Add the implementation plan.');
    need('backout_plan', 'Add the back-out plan.');
    if (!change.planned_start) missing.planned_start = 'Enter the planned start.';
    if (!change.planned_end) missing.planned_end = 'Enter the planned end.';
    if (!change.risk_level) missing.risk_answers = 'Answer every question in the risk questionnaire.';
    if (Object.keys(missing).length) {
      ctx.fail(400, 'incomplete', `This change cannot be submitted yet: ${Object.values(missing).join(' ')}`, missing);
    }
  }

  async function requireApprovals(change: Row) {
    const outstanding = Number(change.approvals_required) - Number(change.approvals_received);
    if (outstanding > 0) {
      ctx.fail(409, 'approvals_missing',
        `This change needs ${change.approvals_required} ${Number(change.approvals_required) === 1 ? 'approval' : 'approvals'} and has ${change.approvals_received}. Record the outstanding approval first.`);
    }
  }

  async function requireNoOpenConflicts(change: Row) {
    const open = (await conflicts.conflictsFor(change)).filter((c) => !c.acknowledged);
    if (open.length) {
      ctx.fail(409, 'conflicts',
        `This change has ${open.length === 1 ? 'a conflict' : `${open.length} conflicts`} that must be resolved or acknowledged first: ${open.map((c) => c.summary).join('; ')}.`);
    }
  }

  function requireReview(change: Row) {
    if (change.pir_required && !change.pir_completed_at) {
      ctx.fail(409, 'review_missing', 'A post-implementation review is required before this change can be closed.');
    }
  }

  async function transition(req: Req, change: Row, body: Row): Promise<Row> {
    const to = String(body.to ?? '');
    const from = String(change.status);
    const allowed = (await base.transitions())[from] ?? [];
    if (!allowed.includes(to)) {
      ctx.fail(409, 'bad_transition', `A change that is "${await statusLabel(from)}" cannot be moved to "${await statusLabel(to) || to}".`);
    }
    const now = new Date().toISOString();
    const patch: Row = { status: to };
    const c = base.checker(body, true);

    switch (to) {
      case 'submitted': {
        requireForSubmit(change);
        patch.submitted_at = now;
        patch.approvals_received = 0;
        // The rules in force now decide the approvals and who gives them; nothing to wait for when they ask for none.
        const rule = await ruleFor(change);
        patch.approvals_required = change.template_id ? 0 : rule.approvals;
        patch.approver_pool = patch.approvals_required ? poolOf(rule) : null;
        if (patch.approvals_required === 0) patch.status = 'approved';
        break;
      }
      case 'draft':
        patch.approvals_received = 0;
        patch.submitted_at = null;
        patch.approver_pool = null;
        break;
      case 'approved':
        // Reached by recording approvals; the only manual move is taking a change off the schedule.
        if (from !== 'scheduled') ctx.fail(409, 'bad_transition', 'A change is approved by recording the approvals it needs.');
        break;
      case 'rejected':
        ctx.fail(409, 'bad_transition', 'A change is rejected by recording that decision as an approval.');
        break;
      case 'scheduled':
        if (!change.planned_start || !change.planned_end) ctx.fail(409, 'no_window', 'Enter the planned start and end before scheduling.');
        await requireApprovals(change);
        await requireNoOpenConflicts(change);
        break;
      case 'in_progress': {
        const rule = await ruleFor(change);
        // Only a rule that allows approval after the fact lets work start unapproved.
        if (!(from === 'submitted' && rule.retrospective)) await requireApprovals(change);
        await requireNoOpenConflicts(change);
        c.datetime('actual_start', 'Actual start');
        patch.actual_start = c.finish().actual_start ?? change.actual_start ?? now;
        break;
      }
      case 'completed': {
        const outcomes = (await ctx.lookups.values('change_outcome')).map((v) => v.value).filter((v) => v !== 'cancelled');
        c.oneOf('outcome', 'Outcome', outcomes, true);
        c.text('outcome_notes', 'Outcome notes');
        c.datetime('actual_end', 'Actual end');
        if (body.outcome === undefined) c.errors.outcome = 'Outcome is required.';
        const d = c.finish();
        patch.outcome = d.outcome;
        if (d.outcome_notes !== undefined) patch.outcome_notes = d.outcome_notes;
        patch.actual_end = d.actual_end ?? change.actual_end ?? now;
        patch.actual_start = change.actual_start ?? patch.actual_end;
        if (new Date(patch.actual_end) < new Date(patch.actual_start)) {
          ctx.fail(400, 'validation', 'Check the highlighted fields.', { actual_end: 'The actual end cannot be before the actual start.' });
        }
        break;
      }
      case 'reviewed':
        if (!change.pir_completed_at) ctx.fail(409, 'review_missing', 'Record the post-implementation review first.');
        break;
      case 'closed':
        requireReview(change);
        await requireApprovals(change);
        break;
      case 'cancelled':
        c.text('reason', 'Reason');
        patch.outcome = 'cancelled';
        patch.outcome_notes = c.finish().reason ?? change.outcome_notes ?? null;
        break;
      default:
        break;
    }

    const updated = await base.setFields(req, change.id, patch);
    await ctx.audit(req, {
      action: 'change.transition', recordType: 'change', recordId: change.id,
      summary: `${base.changeLabel(change)} moved from ${await statusLabel(from)} to ${await statusLabel(updated.status)}`
        + (to === 'submitted' && updated.status === 'approved' ? ' (the approval rules ask for no approval)' : ''),
      before: { status: from }, after: { status: updated.status },
    });
    if (updated.status === 'submitted' && from !== 'submitted') {
      await notifyApprovalRequested(ctx, updated, await eligibleApprovers(updated), req?.user?.id ?? null);
    }
    return updated;
  }

  // ---------- post-implementation review ----------

  async function saveReview(req: Req, change: Row, body: Row) {
    if (!['completed', 'reviewed'].includes(change.status)) {
      ctx.fail(409, 'not_completed', FINAL_STATUSES.includes(change.status)
        ? 'This change is closed; its review can no longer be changed.'
        : 'The review is recorded once the change has been completed.');
    }
    const c = base.checker(body, false);
    c.text('what_happened', 'What happened', true);
    c.text('cause', 'Cause', true);
    c.text('follow_up', 'Follow-up');
    const d = c.finish();

    const wanted = Array.isArray(body.actions) ? (body.actions as Row[]).filter((a) => String(a?.title ?? '').trim()) : [];
    if (wanted.length) {
      if (!ctx.resources.get('action')) ctx.fail(409, 'actions_unavailable', 'Actions are not available in this installation, so follow-up actions cannot be raised.');
      if (req && !ctx.can(req.user, 'actions.create')) ctx.fail(403, 'forbidden', 'You do not have permission to raise actions.');
    }

    const updated = await base.setFields(req, change.id, {
      pir_what_happened: d.what_happened, pir_cause: d.cause, pir_follow_up: d.follow_up ?? null,
      pir_completed_at: new Date().toISOString(), pir_completed_by_name: base.actorName(req),
      ...(change.status === 'completed' ? { status: 'reviewed' } : {}),
    });
    await ctx.audit(req, {
      action: 'change.review', recordType: 'change', recordId: change.id,
      summary: `Post-implementation review ${change.pir_completed_at ? 'updated' : 'recorded'} for ${base.changeLabel(change)}`,
      after: { what_happened: d.what_happened, cause: d.cause, follow_up: d.follow_up ?? null },
    });

    const actions: Row[] = [];
    for (const a of wanted) actions.push(await raiseAction(req, updated, a));
    return { change: updated, actions };
  }

  /** Follow-up work through the shared Actions contract (the module that owns it may not be loaded). */
  async function raiseAction(req: Req, change: Row, body: Row): Promise<Row> {
    const def = ctx.resources.get('action');
    if (!def) ctx.fail(409, 'actions_unavailable', 'Actions are not available in this installation.');
    if (req && !ctx.can(req.user, 'actions.create')) ctx.fail(403, 'forbidden', 'You do not have permission to raise actions.');
    const sources = def.fields.source?.list ? (await ctx.lookups.values(def.fields.source.list)).map((v) => v.value) : [];
    const data: Row = {
      title: String(body.title ?? '').trim(),
      description: String(body.description ?? '').trim() || `Follow-up from the review of change ${base.changeLabel(change)}.`,
      source: sources.includes('change') ? 'change' : 'other',
      source_type: 'change', source_id: change.id,
    };
    if (body.owner_id) data.owner_id = body.owner_id;
    if (body.due_on) data.due_on = body.due_on;
    if (body.priority) data.priority = body.priority;
    const action = await ctx.resources.create('action', data, req);
    await ctx.audit(req, {
      action: 'change.action_raised', recordType: 'change', recordId: change.id,
      summary: `Follow-up action raised from ${base.changeLabel(change)}: ${action.title}`,
      after: { action_id: action.id, action_ref: action.ref ?? null, title: action.title },
    });
    return { id: action.id, ref: action.ref ?? null, title: action.title, route: def.route };
  }

  /** Everything the change page needs about where the change stands. */
  /** Changes waiting for this person's decision, soonest planned start first. */
  async function waitingFor(user: SessionUser): Promise<Row[]> {
    if (!ctx.can(user, 'changes.approve')) return [];
    const open = await db.query<Row>(
      `select * from changes where deleted_at is null and ${ctx.resources.visibleWhere('change', user)}
         and (status = 'submitted' or (status in ('in_progress', 'completed', 'reviewed') and approvals_received < approvals_required))
         and created_by is distinct from $1
       order by planned_start nulls last, ref`, [user.id],
    );
    const out: Row[] = [];
    for (const c of open) {
      if (!inPool(poolFor(c), user.id, user.roles ?? [])) continue;
      if ((await decisions(c)).some((r) => r.current && r.recorded_by === user.id)) continue;
      out.push({
        id: c.id, ref: c.ref, title: c.title, status: c.status, change_type: c.change_type, risk_level: c.risk_level,
        planned_start: c.planned_start, planned_end: c.planned_end,
        approvals_required: c.approvals_required, approvals_received: c.approvals_received,
        retrospective: c.status !== 'submitted',
      });
    }
    return out;
  }

  async function workflowFor(change: Row, user?: SessionUser | null) {
    const allowed = (await base.transitions())[change.status] ?? [];
    return {
      status: change.status,
      next: allowed.filter((s) => s !== 'rejected' && !(s === 'approved' && change.status !== 'scheduled')),
      approvals: await approvalsFor(change, user),
      conflicts: await conflicts.conflictsFor(change),
      review: { required: change.pir_required === true, done: Boolean(change.pir_completed_at) },
      actions_available: Boolean(ctx.resources.get('action')),
    };
  }

  return { approvalsFor, recordApproval, transition, saveReview, raiseAction, workflowFor, ruleFor, waitingFor };
}

export type Workflow = ReturnType<typeof makeWorkflow>;
