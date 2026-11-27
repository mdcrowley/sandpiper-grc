import { actorOf, dataLoadFor, onBehalfOf } from '../../core/dataload.ts';
import { todayInZone } from '../../core/timezone.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';
import type { Base, Req } from './base.ts';
import type { Conflicts } from './conflicts.ts';
import { approvalEngine } from '../../core/approval-kinds.ts';
import { KIND, type ChangeApproval } from './approval.ts';
import { DECISIONS, FINAL_STATUSES, matchRule, poolOf, type ApproverPool } from './rules.ts';
import { safetyAssessments } from './safety-impact.ts';

/** The status lifecycle, approvals and the post-implementation review. */
export function makeWorkflow(ctx: ModuleContext, base: Base, conflicts: Conflicts, approval: ChangeApproval) {
  const { db } = ctx;

  const ruleFor = async (change: Row) => matchRule(await base.approvalRules(), change.change_type, change.risk_level);
  const statusLabel = (value: string) => base.lookupLabel('change_status', value);

  // ---------- approvals (on the shared approval workflows, E05-13) ----------

  /** Decisions recorded since the change was last submitted count; earlier ones are history. */
  async function decisions(change: Row): Promise<Row[]> {
    const rows = await db.query<Row>('select * from change_approvals where change_id = $1 order by created_at desc', [change.id]);
    const since = change.submitted_at ? new Date(change.submitted_at).getTime() : Infinity;
    return rows.map((r) => ({ ...r, current: new Date(r.created_at).getTime() >= since }));
  }

  const poolFor = (change: Row): ApproverPool | null => {
    const p = typeof change.approver_pool === 'string' ? JSON.parse(change.approver_pool) : change.approver_pool;
    return p && ((p.users?.length ?? 0) || (p.roles?.length ?? 0)) ? { users: p.users ?? [], roles: p.roles ?? [] } : null;
  };

  /** True when an approval may be recorded now; `retrospective` when the work has already started. */
  async function awaiting(change: Row): Promise<{ open: boolean; retrospective: boolean }> {
    const eng = approvalEngine(ctx.app);
    const running = eng ? await eng.running(KIND, change.id) : null;
    return { open: Boolean(running), retrospective: Boolean(running) && change.status !== 'submitted' };
  }

  async function approvalsFor(change: Row, user?: SessionUser | null) {
    const rule = await ruleFor(change);
    const list = await decisions(change);
    const state = await awaiting(change);
    const pool = poolFor(change);
    const eng = approvalEngine(ctx.app);
    const p = eng ? await eng.progress(KIND, change.id, user?.id ?? null) : null;
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
      /** Named approvers and roles of the rule at submission; null: anyone with the approve permission. */
      pool: pool ? { users: userNames.map((u) => ({ id: u.id, name: u.display_name })), roles: roleNames.map((r) => ({ key: r.key, name: r.name })) } : null,
      /** The approval workflow of the current submission (its steps are on the shared approval panel). */
      workflow: p?.instance ? { id: p.instance.id, name: p.instance.name, status: p.instance.status, step_id: p.stepId } : null,
      /** Approvers of the current step who have not decided, by name. */
      waiting_for: state.open ? p?.waitingFor ?? [] : [],
      /** Whether the reader may record their own decision now (stand-ins included). */
      can_decide: Boolean(state.open && p?.canDecide),
      decisions: list,
    };
  }

  /** The errors the change's own route gave before approvals moved to workflows, for the engine's refusals. */
  function asChangeError(err: unknown): never {
    const m = String((err as { message?: string })?.message ?? '');
    if (/already decided/.test(m)) {
      ctx.fail(409, 'duplicate_approver', 'You have already recorded a decision on this change. Each approval must come from a different person.');
    }
    if (/not one of the approvers/.test(m)) ctx.fail(403, 'not_an_approver', 'This change is waiting for the approvers its rule names, and you are not one of them.');
    if (/asked for this approval/.test(m)) ctx.fail(403, 'own_change', 'You raised this change, so someone else must record its approval.');
    throw err;
  }

  /**
   * Records one decision through the change's own route (kept for the change page and integrations):
   * it is the reader's decision on the change's approval workflow. With `approver_name` (and
   * optionally role, date and reference) it records a decision given outside the application, such
   * as in a meeting or by email; it still counts as the decision of the person recording it. Without
   * a request (sample data), the system records it by name, as before (see recordAsSystem).
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

    const state = await awaiting(change);
    // E18-94: a data load records a past decision as it was, by the person it names (or the approver
    // named by hand), whether or not a workflow is waiting; nothing is sent.
    if (req?.user && (onBehalfOf(req) || !state.open) && await dataLoadFor(db, req, ctx.audit)) {
      const by = actorOf(req);
      return recordAsSystem(change, { ...d, approver_name: byHand ? d.approver_name : by.name }, state.retrospective, req, { id: by.id, name: by.name, own: !byHand });
    }
    if (!state.open) ctx.fail(409, 'not_awaiting_approval', 'This change is not waiting for approval.');
    if (req?.user && change.created_by === req.user.id) {
      ctx.fail(403, 'own_change', 'You raised this change, so someone else must record its approval.');
    }
    const eng = approval.engine();
    // The system (sample data, imports) records decisions given outside the application by name, as before.
    if (!req?.user) return recordAsSystem(change, d, state.retrospective);
    const userId = req.user.id;
    const name = byHand ? d.approver_name : req.user.displayName;
    approval.remember(change.id, userId, {
      approver_name: name, approver_role: d.approver_role ?? null, decided_on: d.decided_on, reference: d.reference ?? null, notes: d.notes ?? null,
    });
    const said = byHand ? `Recorded for ${d.approver_name}${d.approver_role ? ` (${d.approver_role})` : ''}, decided ${d.decided_on}${d.reference ? `, reference ${d.reference}` : ''}` : null;
    const comment = [said, d.notes].filter(Boolean).join(': ') || (d.decision === 'rejected' ? 'No reason given.' : null);
    try {
      await eng.decide(KIND, change.id, req, d.decision, comment);
    } catch (err) {
      asChangeError(err);
    } finally {
      approval.forget(change.id, userId);
    }
    const updated = (await ctx.resources.find('change', change.id))!;
    return { change: updated, approvals: await approvalsFor(updated, req?.user) };
  }

  /**
   * A decision the system records with no signed-in person (sample data, given outside the
   * application): kept on the change by name and counted per name as before; once it settles the
   * approval the running workflow is closed with it.
   */
  async function recordAsSystem(change: Row, d: Row, retrospective: boolean, req: Req = null, by?: { id: string | null; name: string | null; own: boolean }) {
    await base.insertRow('change_approvals', {
      change_id: change.id, decision: d.decision, approver_name: d.approver_name, approver_role: d.approver_role ?? null,
      decided_on: d.decided_on, reference: d.reference ?? null, notes: d.notes ?? null, retrospective,
      recorded_by: by?.id ?? null, recorded_by_name: by?.name ?? base.actorName(null), approver_user_id: by?.own ? by.id : null,
    });
    const current = (await decisions(change)).filter((r) => r.current && r.decision === 'approved');
    const received = new Set(current.map((r) => String(r.approver_name).trim().toLowerCase())).size;
    const required = Number(change.approvals_required);
    const patch: Row = { approvals_received: received };
    if (change.status === 'submitted') {
      if (d.decision === 'rejected') patch.status = 'rejected';
      else if (received >= required) patch.status = 'approved';
    } else if (d.decision === 'approved' && received >= required) patch.approved_retrospectively = true;
    if (d.decision === 'rejected' || received >= required) await approval.engine().cancel(KIND, change.id, `Decided outside the application: ${d.approver_name}.`, null);
    await ctx.audit(req, {
      action: 'change.approval', recordType: 'change', recordId: change.id,
      summary: `${base.changeLabel(change)} ${d.decision} by ${d.approver_name}: ${received} of ${required} approvals`,
      after: { ...d, retrospective, approvals_received: received, approvals_required: required },
    });
    const updated = await base.setFields(req, change.id, patch);
    return { change: updated, approvals: await approvalsFor(updated, req?.user ?? null) };
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

  /**
   * E25-11: while the safety area is on, a change that affects safety needs at least one hazard linked
   * as its safety assessment before it is submitted for approval, scheduled or started.
   */
  async function requireSafetyAssessment(change: Row) {
    if (!change.safety_impact || !ctx.resources.get('hazard')) return;
    if (await safetyAssessments(ctx, change.id) > 0) return;
    ctx.fail(409, 'safety_assessment_missing',
      'This change affects safety: link a hazard as its safety assessment first (Safety assessment, on the change page).');
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
        await requireSafetyAssessment(change);
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
        await requireSafetyAssessment(change);
        break;
      case 'in_progress': {
        const rule = await ruleFor(change);
        // Only a rule that allows approval after the fact lets work start unapproved.
        if (!(from === 'submitted' && rule.retrospective)) await requireApprovals(change);
        await requireNoOpenConflicts(change);
        await requireSafetyAssessment(change);
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
    // Submitting starts the rule's approval workflow (E05-13); going back to draft or canceling ends it.
    if (updated.status === 'submitted' && from !== 'submitted') return startApproval(req, change, updated);
    if ((to === 'draft' || to === 'cancelled') && approvalEngine(ctx.app)) {
      await approvalEngine(ctx.app)!.cancel(KIND, change.id, to === 'draft' ? 'The change went back to draft.' : 'The change was canceled.', req);
    }
    return updated;
  }

  /**
   * Starts the approval workflow the change's rule names. When none applies the change needs no
   * approval; when it cannot start, the change goes back to where it was and the reason is given.
   */
  async function startApproval(req: Req, before: Row, submitted: Row): Promise<Row> {
    const rule = await ruleFor(submitted);
    let started;
    try {
      started = await approval.engine().start(KIND, submitted, { requester: submitted.created_by ?? null, req, definitionId: rule.workflow_id ?? null });
    } catch (err) {
      await base.setFields(null, submitted.id, {
        status: before.status, submitted_at: before.submitted_at ?? null, approvals_received: before.approvals_received, approver_pool: before.approver_pool ?? null,
      });
      throw err;
    }
    if (!started) {
      const approved = await base.setFields(null, submitted.id, { status: 'approved', approvals_required: 0 });
      await ctx.audit(req, { action: 'change.transition', recordType: 'change', recordId: submitted.id, summary: `${base.changeLabel(submitted)} needs no approval: no change approval workflow applies to it`, after: { status: 'approved' } });
      return approved;
    }
    return approval.syncCounts(submitted.id);
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

  /** Changes waiting for this person's decision (stand-ins included), soonest planned start first. */
  async function waitingFor(user: SessionUser): Promise<Row[]> {
    const eng = approvalEngine(ctx.app);
    if (!ctx.can(user, 'changes.approve') || !eng) return [];
    const ids = await eng.waiting(KIND, user.id);
    if (!ids.length) return [];
    const open = await db.query<Row>(
      `select * from changes where deleted_at is null and id = any($1::uuid[]) and ${ctx.resources.visibleWhere('change', user)}
       order by planned_start nulls last, ref`, [ids]);
    return open.map((c) => ({
      id: c.id, ref: c.ref, title: c.title, status: c.status, change_type: c.change_type, risk_level: c.risk_level,
      planned_start: c.planned_start, planned_end: c.planned_end,
      approvals_required: c.approvals_required, approvals_received: c.approvals_received,
      retrospective: c.status !== 'submitted',
    }));
  }


  /** Everything the change page needs about where the change stands. */
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
