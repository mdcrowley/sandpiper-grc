// E03-15: catalog items with their own questions, fulfillment tasks and approval; E03-21: approval
// only for some answers; E03-22: who approves, how many and by when is the item's approval workflow
// (kind `ticket_approval` on the shared approval workflows).
import type { FastifyRequest } from 'fastify';
import { approvalEngine, defineApprovalKind } from '../../core/approval-kinds.ts';
import { actorOf, isDataLoad } from '../../core/dataload.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';
import type { TicketNotify } from './notify.ts';
import { categoryOf } from './sla.ts';

export const QUESTION_TYPES = ['text', 'longtext', 'choice', 'date', 'yes_no'] as const;
export interface Question { key: string; label: string; type: (typeof QUESTION_TYPES)[number]; required: boolean; options?: string[]; hint?: string }
export interface Answer { key: string; label: string; value: string }
export interface Task { title: string; done: boolean; done_at?: string | null; done_by_name?: string | null }

/** The ticket fields a catalog item may pre-fill. */
export const PREFILL_FIELDS = ['type', 'category', 'subcategory', 'title', 'description', 'impact', 'urgency', 'assignment_group', 'channel'];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'question';

export function makeCatalog(ctx: ModuleContext, notify: TicketNotify) {
  const { db } = ctx;
  const bad = (field: string, message: string): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', { [field]: message });

  function parse(field: string, value: unknown): unknown {
    if (typeof value !== 'string') return value;
    if (!value.trim()) return null;
    try { return JSON.parse(value); } catch { return bad(field, 'This is not valid JSON.'); }
  }

  /** Validates and tidies the structured parts of a catalog item (create or patch). */
  function checkItem(data: Row): Row {
    if ('defaults' in data) {
      const d = parse('defaults', data.defaults);
      if (d !== null && d !== undefined && (typeof d !== 'object' || Array.isArray(d))) {
        bad('defaults', 'Use a set of field names and values, for example {"type": "request"}.');
      }
      data.defaults = d ?? null;
    }
    if ('questions' in data) {
      const q = parse('questions', data.questions);
      if (q !== null && q !== undefined && !Array.isArray(q)) bad('questions', 'Questions must be a list.');
      const seen = new Set<string>();
      const out: Question[] = [];
      for (const raw of (q ?? []) as Row[]) {
        const label = String(raw?.label ?? '').trim();
        if (!label) bad('questions', 'Every question needs its wording.');
        const type = QUESTION_TYPES.includes(raw.type) ? raw.type : 'text';
        const options = Array.isArray(raw.options) ? raw.options.map((o: unknown) => String(o).trim()).filter(Boolean) : [];
        if (type === 'choice' && options.length < 2) bad('questions', `"${label}" needs at least two choices.`);
        let key = slug(String(raw.key || label));
        for (let n = 2; seen.has(key); n++) key = `${slug(String(raw.key || label))}_${n}`;
        seen.add(key);
        const hint = String(raw.hint ?? '').trim();
        out.push({ key, label, type, required: raw.required === true, ...(type === 'choice' ? { options } : {}), ...(hint ? { hint } : {}) });
      }
      if (out.length > 30) bad('questions', 'An item can ask at most 30 questions.');
      data.questions = out.length ? out : null;
    }
    // E03-21: how many approvals, from whom, and for which answers.
    if ('approvals_needed' in data) {
      const n = data.approvals_needed === null || data.approvals_needed === '' ? 1 : Number(data.approvals_needed);
      if (!Number.isInteger(n) || n < 1 || n > 5) bad('approvals_needed', 'Ask for 1 to 5 approvals.');
      data.approvals_needed = n;
    }
    if ('approver_ids' in data) {
      const a = parse('approver_ids', data.approver_ids);
      if (a !== null && a !== undefined && !Array.isArray(a)) bad('approver_ids', 'Approvers must be a list of people.');
      const ids = [...new Set(((a ?? []) as unknown[]).map((x) => String(x)))];
      if (ids.some((id) => !UUID_RE.test(id))) bad('approver_ids', 'Choose approvers from the list of people.');
      if (ids.length > 20) bad('approver_ids', 'Name at most 20 approvers.');
      data.approver_ids = ids.length ? ids : null;
    }
    if ('approval_condition' in data) {
      const c = parse('approval_condition', data.approval_condition) as Row | null | undefined;
      const cond = (c ?? {}) as Row;
      if (c === null || c === undefined || (typeof c === 'object' && !cond.question)) {
        data.approval_condition = null;
      } else {
        if (typeof c !== 'object' || Array.isArray(c)) bad('approval_condition', 'Choose a question and the answers that need approval.');
        const answers = (Array.isArray(cond.answers) ? cond.answers : []).map((x: unknown) => String(x).trim()).filter(Boolean);
        if (!answers.length) bad('approval_condition', 'Choose at least one answer that needs approval.');
        const questions = (Array.isArray(data.questions) ? data.questions : null) as Question[] | null;
        if (questions && !questions.some((q) => q.key === cond.question)) bad('approval_condition', 'Approval depends on a question this item does not ask.');
        data.approval_condition = { question: String(cond.question), answers };
      }
    }
    if ('approval_workflow_id' in data) {
      const id = data.approval_workflow_id === '' || data.approval_workflow_id === undefined ? null : data.approval_workflow_id;
      if (id !== null && !UUID_RE.test(String(id))) bad('approval_workflow_id', 'Choose an approval workflow from the list.');
      data.approval_workflow_id = id;
    }
    if ('tasks' in data) {
      const t = parse('tasks', data.tasks);
      if (t !== null && t !== undefined && !Array.isArray(t)) bad('tasks', 'Fulfillment tasks must be a list.');
      const out = ((t ?? []) as unknown[]).map((x) => String((x as Row)?.title ?? x ?? '').trim()).filter(Boolean);
      if (out.length > 30) bad('tasks', 'An item can have at most 30 fulfillment tasks.');
      data.tasks = out.length ? out : null;
    }
    return data;
  }

  /** A patch to the checklist: keeps who ticked each task and when. */
  function checkTasks(req: FastifyRequest | null, existing: Row, patch: Row): void {
    if (!('fulfilment_tasks' in patch)) return;
    const next = parse('fulfilment_tasks', patch.fulfilment_tasks);
    if (next !== null && next !== undefined && !Array.isArray(next)) bad('fulfilment_tasks', 'Fulfillment tasks must be a list.');
    const before = (existing.fulfilment_tasks ?? []) as Task[];
    const now = new Date().toISOString();
    const out: Task[] = [];
    for (const [i, raw] of ((next ?? []) as Row[]).entries()) {
      const title = String(raw?.title ?? '').trim();
      if (!title) bad('fulfilment_tasks', 'Every task needs a title.');
      const was = before[i]?.title === title ? before[i] : before.find((b) => b.title === title);
      const done = raw.done === true;
      // A data load keeps the time the task was done in the source (E45-55).
      const given = isDataLoad(req) && typeof raw.done_at === 'string' && !Number.isNaN(Date.parse(raw.done_at)) && Date.parse(raw.done_at) <= Date.now() + 60_000
        ? new Date(raw.done_at).toISOString() : null;
      out.push(done
        ? { title, done, done_at: given ?? (was?.done ? was.done_at ?? now : now), done_by_name: was?.done ? was.done_by_name ?? null : (req && actorOf(req).name) || 'System' }
        : { title, done });
    }
    if (out.length > 60) bad('fulfilment_tasks', 'A ticket can have at most 60 tasks.');
    patch.fulfilment_tasks = out.length ? out : null;
  }

  /**
   * While a request waits for approval (or was rejected) work cannot start: the ticket may sit in
   * its first statuses, wait on someone, or be canceled, and nothing else.
   */
  async function checkApprovalGate(req: FastifyRequest | null, existing: Row, status: unknown): Promise<void> {
    if (!req || status === existing.status || isDataLoad(req)) return; // a data load sets any status (E18-70)
    if (existing.approval_status !== 'pending' && existing.approval_status !== 'rejected') return;
    const meta = (await ctx.lookups.values('ticket_status')).find((s) => s.value === status)?.meta;
    const cat = categoryOf(meta);
    const allowed = cat === 'paused'
      || (cat === 'open' && (status === 'new' || status === 'assigned' || meta?.before_approval === true))
      || (cat === 'closed' && (status === 'cancelled' || meta?.resolution_code === false));
    if (allowed) return;
    bad('status', existing.approval_status === 'pending'
      ? 'This request is waiting for approval. Work can start once it is approved.'
      : 'This request was rejected. Cancel it, or ask for approval again.');
  }

  /**
   * E03-21 settings sent through the API (approvals_needed above one, or named approvers) without a
   * workflow: the item gets the catalog request approval workflow with exactly that step, made when
   * none exists yet, so integrations that set them keep working.
   */
  async function workflowForSettings(users: string[] | null, needed: number): Promise<string | null> {
    if (!approvalEngine(ctx.app)) return null;
    const approvers = users?.length ? { kind: 'users', users } : { kind: 'permission', permission: 'tickets.approve' };
    const quorum = needed > 1 ? needed : 'any';
    const same = (await db.query<Row>(`select id, steps from workflow_definitions where kind = 'ticket_approval' and active and deleted_at is null and conditions = '[]'::jsonb order by created_at`))
      .find((w) => {
        const steps = (typeof w.steps === 'string' ? JSON.parse(w.steps) : w.steps) as Row[];
        return steps.length === 1 && JSON.stringify(steps[0].quorum) === JSON.stringify(quorum) && !(steps[0].conditions ?? []).length
          && steps[0].approvers?.kind === approvers.kind
          && (approvers.kind === 'users' ? [...(steps[0].approvers.users ?? [])].sort().join() === [...users!].sort().join() : steps[0].approvers.permission === 'tickets.approve');
      });
    if (same) return same.id;
    const names = users?.length ? (await db.query<{ display_name: string }>('select display_name from users where id = any($1::uuid[]) order by display_name', [users])).map((u) => u.display_name) : [];
    const name = `Catalog request approval: ${needed > 1 ? `${needed} approvals` : 'one approval'}${names.length ? ` from ${names.slice(0, 3).join(', ')}${names.length > 3 ? ' and others' : ''}` : ''}`;
    const row = await db.one<{ id: string }>(
      `insert into workflow_definitions (record_type, kind, name, description, active, trigger, conditions, steps, on_approve, on_reject)
       values ('ticket', 'ticket_approval', $1, $2, true, 'module', '[]'::jsonb, $3::jsonb, '[]'::jsonb, '[]'::jsonb) returning id`,
      [name.slice(0, 120), 'Made from the approval settings of a catalog item (number of approvals and named approvers).',
        JSON.stringify([{ key: 'approve', name: 'Approve the request', approvers, quorum, conditions: [], due_hours: null, escalate_to: null }])]);
    return row?.id ?? null;
  }

  /** The approval workflow an item names must be an active catalog request approval workflow. */
  async function checkWorkflow(data: Row, existing?: Row): Promise<Row> {
    checkItem(data);
    if (!data.approval_workflow_id && ('approvals_needed' in data || 'approver_ids' in data)) {
      const users = 'approver_ids' in data ? data.approver_ids as string[] | null : existing?.approver_ids ?? null;
      const needed = Number('approvals_needed' in data ? data.approvals_needed : existing?.approvals_needed) || 1;
      if (users?.length || needed > 1) data.approval_workflow_id = await workflowForSettings(users?.length ? users : null, needed);
    }
    const id = data.approval_workflow_id;
    if (id) {
      const known = (await approvalEngine(ctx.app)?.definitions('ticket_approval')) ?? [];
      if (!known.some((w) => w.id === id)) bad('approval_workflow_id', 'Choose an active catalog request approval workflow.');
    }
    return data;
  }


  /** On a new ticket raised from an item: store the answers, copy the tasks, ask for approval. */
  async function applyToNewTicket(req: FastifyRequest | null, data: Row): Promise<void> {
    // A data load (E18-70) keeps the answers and tasks it gives, asks for no missing answer and starts no approval.
    const loading = isDataLoad(req);
    const given = data.catalog_answers;
    const givenTasks = data.fulfilment_tasks;
    delete data.catalog_answers;
    delete data.fulfilment_tasks;
    const item = data.catalog_item_id
      ? await db.one<Row>('select * from catalog_items where id = $1 and deleted_at is null', [data.catalog_item_id])
      : undefined;
    if (data.catalog_item_id && !item) bad('catalog_item_id', 'Catalog item was not found.');
    if (loading && (!item || given !== undefined)) {
      if (given !== undefined) data.catalog_answers = given;
      if (givenTasks !== undefined) data.fulfilment_tasks = givenTasks;
      if (!item || givenTasks !== undefined) return;
    }
    if (!item) return;
    const questions = (item.questions ?? []) as Question[];
    const byKey: Record<string, unknown> = Array.isArray(given)
      ? Object.fromEntries((given as Row[]).map((a) => [a?.key, a?.value]))
      : given && typeof given === 'object' ? (given as Record<string, unknown>) : {};
    const answers: Answer[] = [];
    const missing: Record<string, string> = {};
    for (const q of questions) {
      const raw = byKey[q.key];
      const value = raw === true ? 'Yes' : raw === false ? 'No' : String(raw ?? '').trim();
      if (!value) {
        if (q.required && req && !loading) missing[`catalog_answers.${q.key}`] = `${q.label} is required.`;
        continue;
      }
      if (q.type === 'choice' && req && !(q.options ?? []).includes(value)) missing[`catalog_answers.${q.key}`] = `${q.label}: choose one of the listed answers.`;
      answers.push({ key: q.key, label: q.label, value: value.slice(0, 4000) });
    }
    if (Object.keys(missing).length) ctx.fail(400, 'validation', 'Answer the questions for this request.', missing);
    if (!loading || given === undefined) data.catalog_answers = answers.length ? answers : null;
    const tasks = (item.tasks ?? []) as string[];
    if (!loading || givenTasks === undefined) data.fulfilment_tasks = tasks.length ? tasks.map((title) => ({ title, done: false })) : null;
    // E03-22: who decides, and how many, is the item's approval workflow, started once the ticket exists (afterCreate).
    if (needsApproval(item, answers) && !loading) data.approval_status = 'pending';
  }

  /** E03-21: an item that needs approval may need it only for some answers to one of its questions. */
  function needsApproval(item: Row, answers: Answer[]): boolean {
    if (!item.requires_approval) return false;
    const cond = item.approval_condition as { question?: string; answers?: string[] } | null;
    if (!cond?.question) return true;
    const given = answers.find((a) => a.key === cond.question)?.value;
    return given !== undefined && (cond.answers ?? []).some((v) => v.toLowerCase() === given.toLowerCase());
  }

  // ---------- approval on the shared workflows (E03-22) ----------

  const engine = () => approvalEngine(ctx.app);
  /** Who asked: the requester, or whoever raised the ticket. Nobody approves their own request. */
  const requesterOf = (ticket: Row): string | null => ticket.requester_id ?? ticket.created_by ?? null;

  /**
   * Starts the item's approval workflow on a ticket waiting for approval. A ticket stays waiting
   * (with a note) when no workflow can start, so nothing slips through unapproved; an agent can ask
   * again once an administrator has made one active.
   */
  async function askForApproval(req: FastifyRequest | null, ticket: Row): Promise<Row | null> {
    const e = engine();
    const item = ticket.catalog_item_id ? await db.one<Row>('select approval_workflow_id from catalog_items where id = $1', [ticket.catalog_item_id]) : undefined;
    let note: string | null = null;
    let started = null;
    if (!e) note = 'Approval workflows are not available, so nobody has been asked yet.';
    else {
      try {
        started = await e.start(KIND, ticket, {
          requester: requesterOf(ticket), req, definitionId: item?.approval_workflow_id ?? null, data: { catalog_item_id: ticket.catalog_item_id ?? null },
        });
        if (!started) note = 'No approval workflow applies to this request, so nobody has been asked yet. An agent can ask again once an administrator has made one active.';
      } catch (err) {
        note = (err as Error).message || 'The approval workflow could not start.';
      }
    }
    const patch: Row = { approval_status: 'pending', approval_by: null, approval_at: null, approval_note: note };
    if (started && e) patch.approvals_needed = (await e.progress(KIND, ticket.id, null)).required || 1;
    return ctx.resources.update('ticket', ticket.id, patch);
  }

  async function afterCreate(req: FastifyRequest | null, row: Row): Promise<void> {
    if (row.approval_status !== 'pending' || isDataLoad(req)) return; // a loaded ticket asks nobody (E18-70)
    // Never fails the new ticket: a problem is kept in its approval note.
    try { await askForApproval(req, row); } catch (err) { console.error('[tickets] asking for approval:', err); }
  }

  /** A ticket canceled or closed while it waits for approval stops its workflow. */
  async function afterUpdate(req: FastifyRequest | null, before: Row, after: Row): Promise<void> {
    if (after.approval_status !== 'pending' || before.status === after.status || isDataLoad(req)) return;
    const meta = (await ctx.lookups.values('ticket_status')).find((s) => s.value === after.status)?.meta;
    if (categoryOf(meta) !== 'closed') return;
    await engine()?.cancel(KIND, after.id, 'The request was closed or canceled.', req);
  }

  /** The decisions given before approvals moved to the workflows (kept for history). */
  const earlierDecisions = (ticketId: string) => db.query<Row>(
    `select id, user_id, user_name, decision, note, superseded, decided_at from ticket_approvals where ticket_id = $1 order by decided_at, id`, [ticketId]);

  /** Why this person may not decide right now, or null. */
  function mayDecide(user: SessionUser | null | undefined, ticket: Row, canDecide: boolean): string | null {
    if (!user || !ctx.can(user, 'tickets.approve')) return 'You do not have permission to approve requests.';
    if (requesterOf(ticket) === user.id) return 'You cannot approve your own request.';
    if (ticket.approval_status !== 'pending') return null;
    return canDecide ? null : 'This request is waiting for other approvers.';
  }

  /** Where the approval stands, from the ticket's approval workflow (and decisions made before it). */
  async function approvalView(user: SessionUser | null | undefined, ticket: Row) {
    const e = engine();
    const p = e ? await e.progress(KIND, ticket.id, user?.id ?? null) : null;
    const running = p?.instance?.status === 'running';
    const why = mayDecide(user, ticket, Boolean(p?.canDecide));
    const earlier = await earlierDecisions(ticket.id);
    const needed = Math.max(1, p?.required || Number(ticket.approvals_needed) || 1);
    return {
      status: ticket.approval_status ?? null, needed, approved: p?.approvals ?? 0, rejected: p?.instance?.status === 'rejected' ? 1 : 0,
      // Approvers still to decide, by name (the workflow panel on the ticket shows every step and decision).
      approvers: running && p!.waitingFor.length ? p!.waitingFor.map((label) => ({ id: label, label })) : null,
      workflow: p?.instance ? { id: p.instance.id, name: p.instance.name, status: p.instance.status, step_id: p.stepId } : null,
      // Decisions recorded before catalog approvals moved to the approval workflows: history only.
      decisions: earlier.map((d) => ({ ...d, counts: false, earlier: true })),
      my_decision: null,
      can_decide: Boolean(running && p?.canDecide && !why), cannot_decide_reason: running ? why : null,
      can_ask_again: Boolean(e && (ticket.approval_status === 'pending' || ticket.approval_status === 'rejected') && !running && user && ctx.can(user, 'tickets.edit')),
    };
  }

  const KIND = 'ticket_approval';

  /** The ticket approval kind: the workflows call back here on every decision and at the end. */
  function defineKind() {
    defineApprovalKind(ctx.app, {
      key: KIND, recordType: 'ticket', label: 'Catalog request approval',
      startsWhen: 'A request is raised from a catalog item that needs approval (and, when the item says so, only for the chosen answers)',
      outcome: 'Approved: work on the request may start. Rejected: the request stays blocked with the reason, until it is canceled or approval is asked again',
      approverPermission: 'tickets.approve',
      async onFinish(ev) {
        const ticket = await db.one<Row>('select * from tickets where id = $1', [ev.instance.recordId]);
        if (!ticket || ev.byModule) return;
        if (ev.outcome === 'canceled') {
          // Still waiting: nothing may start until an agent asks for approval again.
          await ctx.resources.update('ticket', ticket.id, { approval_note: `The approval was canceled${ev.comment ? `: ${ev.comment}` : '.'}` });
          return;
        }
        const behalf = ev.onBehalfOfName ? ` on behalf of ${ev.onBehalfOfName}` : '';
        const saved = await ctx.resources.update('ticket', ticket.id, {
          approval_status: ev.outcome, approval_by: ev.approverId, approval_at: new Date().toISOString(), approval_note: ev.comment ?? null,
        });
        await ctx.audit(ev.req, {
          action: 'ticket.approval', recordType: 'ticket', recordId: ticket.id,
          summary: `Request ${ev.outcome} by ${ev.approverName ?? 'an approver'}${behalf}: ${notify.name(ticket)}${ev.comment ? ` (${ev.comment})` : ''}`,
          before: { approval_status: ticket.approval_status }, after: { approval_status: ev.outcome, workflow: ev.instance.name },
        });
        // The workflow tells the requester; the people working the ticket hear it here.
        const mine = await notify.owners(saved);
        // (The requester is skipped unless they also work the ticket: the workflow has told them.)
        const skip = new Set([ev.approverId, mine.userIds?.includes(ev.instance.requestedBy ?? '') ? null : ev.instance.requestedBy].filter(Boolean));
        await notify.send({
          ...mine, userIds: [...(mine.userIds ?? []), ticket.created_by].filter((id) => id && !skip.has(id)),
          ...notify.about(ticket), kind: 'approval', title: `Request ${ev.outcome}: ${notify.name(ticket)}`, body: ev.comment ?? null,
        });
      },
      async install(h) {
        // Each distinct approval setting of the items becomes a workflow (the plain one first, so it
        // is the oldest and is chosen for items that name none); items then name their workflow.
        const step = (users: string[] | null, needed: number) => ({
          key: 'approve', name: 'Approve the request',
          approvers: users?.length ? { kind: 'users', users } : { kind: 'permission', permission: 'tickets.approve' },
          quorum: needed > 1 ? needed : 'any',
        });
        const made = new Map<string, string>();
        const configKey = (users: string[] | null, needed: number) => `${[...(users ?? [])].sort().join(',')}|${needed}`;
        const first = await h.hasDefinitions();
        if (!first) {
          made.set(configKey(null, 1), await h.define({
            name: 'Catalog request approval', description: 'Anyone who may approve service requests (other than the requester) approves once.',
            steps: [step(null, 1)],
          }));
        }
        const items = await h.db.query<Row>('select id, name, approvals_needed, approver_ids, approval_workflow_id from catalog_items where requires_approval and deleted_at is null order by name');
        const asList = (v: unknown): string[] | null => {
          const a = typeof v === 'string' ? JSON.parse(v) : v;
          return Array.isArray(a) && a.length ? a.map(String) : null;
        };
        const workflowOf = new Map<string, string>();
        for (const item of items) {
          const users = asList(item.approver_ids);
          const needed = Math.max(1, Number(item.approvals_needed) || 1);
          const k = configKey(users, needed);
          if (!made.has(k)) {
            made.set(k, await h.define({
              name: `Catalog request approval: ${item.name}`.slice(0, 120),
              description: `Made from the approval settings of the catalog item "${item.name}" when catalog approvals moved to approval workflows.`,
              steps: [step(users, needed)],
            }));
          }
          const id = item.approval_workflow_id ?? made.get(k)!;
          workflowOf.set(item.id, id);
          if (!item.approval_workflow_id) await h.db.query('update catalog_items set approval_workflow_id = $2 where id = $1', [item.id, id]);
        }
        // Requests that were waiting: a running workflow with their approvers and the approvals already given.
        const holders = await h.usersWith('tickets.approve');
        const pending = await h.db.query<Row>(`select * from tickets where approval_status = 'pending' and deleted_at is null`);
        for (const tk of pending) {
          const requester = requesterOf(tk);
          const named = asList(tk.approver_ids);
          const approvers = (named ? named.filter((u) => holders.includes(u)) : holders).filter((u) => u !== requester);
          const latest = new Map<string, Row>();
          for (const d of await earlierDecisions(tk.id)) if (!d.superseded) latest.set(d.user_id, d);
          const given = [...latest.values()].filter((d) => d.decision === 'approved' && approvers.includes(d.user_id));
          const definitionId = (tk.catalog_item_id && workflowOf.get(tk.catalog_item_id)) || made.get(configKey(null, 1))
            || (await h.db.one<{ id: string }>(`select id from workflow_definitions where kind = $1 and deleted_at is null order by active desc, created_at limit 1`, [KIND]))?.id;
          if (!definitionId) continue;
          await h.adopt({
            definitionId, recordId: tk.id, requestedBy: requester, startedAt: tk.opened_at ?? tk.created_at, data: { catalog_item_id: tk.catalog_item_id ?? null },
            approvers, required: Math.max(1, Number(tk.approvals_needed) || 1),
            decisions: given.map((d) => ({ userId: d.user_id, decision: 'approved' as const, comment: d.note ?? null, at: d.decided_at })),
          });
        }
      },
    });
  }

  function register() {
    defineKind();

    ctx.app.post('/api/tickets/:id/approval', { preHandler: ctx.requirePerm('tickets.approve') }, async (req) => {
      const row = (await ctx.resources.find('ticket', String((req.params as Row).id), req.user)) ?? ctx.fail(404, 'not_found', 'Ticket not found.');
      const b = (req.body ?? {}) as Row;
      if (b.decision !== 'approved' && b.decision !== 'rejected') bad('decision', 'Choose approve or reject.');
      if (!row.approval_status) ctx.fail(409, 'no_approval', 'This ticket does not need approval.');
      const note = String(b.note ?? '').trim().slice(0, 2000) || null;
      if (b.decision === 'rejected' && !note) bad('note', 'Say why the request is rejected.');
      if (requesterOf(row) === req.user!.id) ctx.fail(403, 'forbidden', 'You cannot approve your own request.');
      const e = engine() ?? ctx.fail(409, 'not_awaiting_approval', 'Approval workflows are not available.');
      // The same decision as on the Approvals page: the workflows check who may decide.
      await e.decide(KIND, row.id, req, b.decision, note);
      return ctx.resources.find('ticket', row.id, req.user);
    });
    ctx.describeRoute({
      method: 'POST', path: '/api/tickets/:id/approval', permission: 'tickets.approve',
      summary: 'Approve or reject a request waiting for you (the same decision as POST /api/workflows/steps/:id/decision on its approval workflow)',
      body: '{ decision: "approved" | "rejected", note?: string (required to reject) }', response: 'The ticket',
    });

    ctx.app.post('/api/tickets/:id/approval/ask', { preHandler: ctx.requirePerm('tickets.edit') }, async (req) => {
      const row = (await ctx.resources.find('ticket', String((req.params as Row).id), req.user)) ?? ctx.fail(404, 'not_found', 'Ticket not found.');
      if (row.approval_status !== 'pending' && row.approval_status !== 'rejected') ctx.fail(409, 'no_approval', 'This ticket is not waiting for approval.');
      const e = engine() ?? ctx.fail(409, 'approvals_unavailable', 'Approval workflows are not available.');
      if (await e.running(KIND, row.id)) ctx.fail(409, 'already_running', 'Approval has already been asked for and is waiting for decisions.');
      await askForApproval(req, row);
      await ctx.audit(req, {
        action: 'ticket.approval_asked', recordType: 'ticket', recordId: row.id,
        summary: `Approval asked for again: ${notify.name(row)}`, before: { approval_status: row.approval_status }, after: { approval_status: 'pending' },
      });
      return ctx.resources.find('ticket', row.id, req.user);
    });
    ctx.describeRoute({
      method: 'POST', path: '/api/tickets/:id/approval/ask', permission: 'tickets.edit',
      summary: 'Ask for approval again: a rejected request, or one whose approval was canceled or could not start, gets a new approval workflow',
      response: 'The ticket',
    });

    ctx.app.get('/api/tickets/:id/approvals', { preHandler: ctx.requirePerm('tickets.view') }, async (req) => {
      const row = (await ctx.resources.find('ticket', String((req.params as Row).id), req.user)) ?? ctx.fail(404, 'not_found', 'Ticket not found.');
      return approvalView(req.user, row);
    });
    ctx.describeRoute({
      method: 'GET', path: '/api/tickets/:id/approvals', permission: 'tickets.view', summary: 'Where the approval of a request stands, from its approval workflow (and decisions made before approvals moved to workflows)',
      response: '{ status, needed, approved, rejected, approvers: [{ id, label }] | null (still to decide), workflow: { id, name, status, step_id } | null, decisions: [{ user_name, decision, note, decided_at, earlier }] (before workflows), my_decision, can_decide, cannot_decide_reason, can_ask_again }',
    });

    ctx.app.get('/api/tickets/approval-workflows', { preHandler: ctx.requirePerm('tickets.view') }, async () =>
      ({ rows: (await engine()?.definitions(KIND)) ?? [] }));
    ctx.describeRoute({
      method: 'GET', path: '/api/tickets/approval-workflows', permission: 'tickets.view',
      summary: 'The active catalog request approval workflows a catalog item can name', response: '{ rows: [{ id, name, description }] }',
    });
  }

  return { checkItem, checkWorkflow, applyToNewTicket, checkTasks, checkApprovalGate, afterCreate, afterUpdate, register, approvalView, mayDecide };
}
