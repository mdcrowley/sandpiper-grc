// E03-15: catalog items with their own questions, fulfillment tasks and approval; E03-21: approval
// by more than one person, by named approvers, or only for some answers.
import type { FastifyRequest } from 'fastify';
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
    if ('tasks' in data) {
      const t = parse('tasks', data.tasks);
      if (t !== null && t !== undefined && !Array.isArray(t)) bad('tasks', 'Fulfillment tasks must be a list.');
      const out = ((t ?? []) as unknown[]).map((x) => String((x as Row)?.title ?? x ?? '').trim()).filter(Boolean);
      if (out.length > 30) bad('tasks', 'An item can have at most 30 fulfillment tasks.');
      data.tasks = out.length ? out : null;
    }
    return data;
  }

  /** On a new ticket raised from an item: store the answers, copy the tasks, ask for approval. */
  async function applyToNewTicket(req: FastifyRequest | null, data: Row): Promise<void> {
    const given = data.catalog_answers;
    delete data.catalog_answers;
    delete data.fulfilment_tasks;
    const item = data.catalog_item_id
      ? await db.one<Row>('select * from catalog_items where id = $1 and deleted_at is null', [data.catalog_item_id])
      : undefined;
    if (data.catalog_item_id && !item) bad('catalog_item_id', 'Catalog item was not found.');
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
        if (q.required && req) missing[`catalog_answers.${q.key}`] = `${q.label} is required.`;
        continue;
      }
      if (q.type === 'choice' && req && !(q.options ?? []).includes(value)) missing[`catalog_answers.${q.key}`] = `${q.label}: choose one of the listed answers.`;
      answers.push({ key: q.key, label: q.label, value: value.slice(0, 4000) });
    }
    if (Object.keys(missing).length) ctx.fail(400, 'validation', 'Answer the questions for this request.', missing);
    data.catalog_answers = answers.length ? answers : null;
    const tasks = (item.tasks ?? []) as string[];
    data.fulfilment_tasks = tasks.length ? tasks.map((title) => ({ title, done: false })) : null;
    if (needsApproval(item, answers)) {
      data.approval_status = 'pending';
      data.approvals_needed = Number(item.approvals_needed) || 1;
      data.approver_ids = Array.isArray(item.approver_ids) && item.approver_ids.length ? item.approver_ids : null;
    }
  }

  /** E03-21: an item that needs approval may need it only for some answers to one of its questions. */
  function needsApproval(item: Row, answers: Answer[]): boolean {
    if (!item.requires_approval) return false;
    const cond = item.approval_condition as { question?: string; answers?: string[] } | null;
    if (!cond?.question) return true;
    const given = answers.find((a) => a.key === cond.question)?.value;
    return given !== undefined && (cond.answers ?? []).some((v) => v.toLowerCase() === given.toLowerCase());
  }

  // ---------- decisions (E03-21) ----------

  const decisionsOf = (ticketId: string) => db.query<Row>(
    `select id, user_id, user_name, decision, note, superseded, decided_at from ticket_approvals where ticket_id = $1 order by decided_at, id`, [ticketId]);

  /** Where the decisions stand: each person's latest decision counts, overturned rejections do not. */
  function tally(ticket: Row, decisions: Row[]) {
    const latest = new Map<string, Row>();
    for (const d of decisions) if (!d.superseded) latest.set(d.user_id, d);
    const current = [...latest.values()];
    const approved = current.filter((d) => d.decision === 'approved');
    const rejected = current.filter((d) => d.decision === 'rejected');
    const needed = Math.max(1, Number(ticket.approvals_needed) || 1);
    const status = rejected.length ? 'rejected' : approved.length >= needed ? 'approved' : 'pending';
    return { needed, approved: approved.length, rejected: rejected.length, status, latest };
  }

  /** Who may decide on this ticket, and why not when they may not. */
  function mayDecide(user: SessionUser | null | undefined, ticket: Row): string | null {
    if (!user || !ctx.can(user, 'tickets.approve')) return 'You do not have permission to approve requests.';
    if (ticket.requester_id && ticket.requester_id === user.id) return 'You cannot approve your own request.';
    const named = Array.isArray(ticket.approver_ids) ? (ticket.approver_ids as string[]) : [];
    if (named.length && !named.includes(user.id)) return 'This request names other approvers.';
    return null;
  }

  async function approvalView(user: SessionUser | null | undefined, ticket: Row) {
    const decisions = await decisionsOf(ticket.id);
    const t = tally(ticket, decisions);
    const named = Array.isArray(ticket.approver_ids) ? (ticket.approver_ids as string[]) : [];
    const people = named.length
      ? await db.query<Row>('select id, display_name as label from users where id = any($1::uuid[]) order by display_name', [named]) : [];
    const why = mayDecide(user, ticket);
    return {
      status: ticket.approval_status ?? null, needed: t.needed, approved: t.approved, rejected: t.rejected,
      approvers: named.length ? people : null,
      decisions: decisions.map((d) => ({ ...d, counts: !d.superseded && t.latest.get(d.user_id)?.id === d.id })),
      my_decision: user ? t.latest.get(user.id)?.decision ?? null : null,
      can_decide: Boolean(ticket.approval_status) && !why, cannot_decide_reason: why,
    };
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
      out.push(done
        ? { title, done, done_at: was?.done ? was.done_at ?? now : now, done_by_name: was?.done ? was.done_by_name ?? null : req?.user?.displayName ?? 'System' }
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
    if (!req || status === existing.status) return;
    if (existing.approval_status !== 'pending' && existing.approval_status !== 'rejected') return;
    const meta = (await ctx.lookups.values('ticket_status')).find((s) => s.value === status)?.meta;
    const cat = categoryOf(meta);
    const allowed = cat === 'paused'
      || (cat === 'open' && (status === 'new' || status === 'assigned' || meta?.before_approval === true))
      || (cat === 'closed' && (status === 'cancelled' || meta?.resolution_code === false));
    if (allowed) return;
    bad('status', existing.approval_status === 'pending'
      ? 'This request is waiting for approval. Work can start once it is approved.'
      : 'This request was rejected. Cancel it, or ask for the decision to be changed.');
  }

  async function afterCreate(row: Row): Promise<void> {
    if (row.approval_status !== 'pending') return;
    const named = Array.isArray(row.approver_ids) && row.approver_ids.length ? (row.approver_ids as string[]) : null;
    await notify.send({
      ...(named ? { userIds: named } : { permission: 'tickets.approve' }), ...notify.about(row), kind: 'approval',
      title: `Approval needed: ${notify.name(row)}`,
      body: row.requester_name ? `Requested by ${row.requester_name}.` : null,
    });
  }

  function register() {
    ctx.app.post('/api/tickets/:id/approval', { preHandler: ctx.requirePerm('tickets.approve') }, async (req) => {
      const row = (await ctx.resources.find('ticket', String((req.params as Row).id), req.user)) ?? ctx.fail(404, 'not_found', 'Ticket not found.');
      const b = (req.body ?? {}) as Row;
      if (b.decision !== 'approved' && b.decision !== 'rejected') bad('decision', 'Choose approve or reject.');
      if (!row.approval_status) ctx.fail(409, 'no_approval', 'This ticket does not need approval.');
      const note = String(b.note ?? '').trim().slice(0, 2000) || null;
      if (b.decision === 'rejected' && !note) bad('note', 'Say why the request is rejected.');
      const why = mayDecide(req.user, row);
      if (why) ctx.fail(403, 'forbidden', why);
      const me = req.user!;
      const before = tally(row, await decisionsOf(row.id));
      if (before.latest.get(me.id)?.decision === b.decision) {
        ctx.fail(409, 'already_decided', b.decision === 'approved' ? 'You have already approved this request.' : 'You have already rejected this request.');
      }
      // An approval given while the request stands rejected overturns the rejection (as one approver could before).
      if (b.decision === 'approved' && row.approval_status === 'rejected') {
        await db.query(`update ticket_approvals set superseded = true where ticket_id = $1 and decision = 'rejected' and not superseded`, [row.id]);
      }
      await db.query(
        'insert into ticket_approvals (ticket_id, user_id, user_name, decision, note) values ($1,$2,$3,$4,$5)',
        [row.id, me.id, me.displayName, b.decision, note]);
      const after = tally(row, await decisionsOf(row.id));
      // The approval fields are read-only to people, so they are written as the system and audited as the person.
      const saved = await ctx.resources.update('ticket', row.id, {
        approval_status: after.status, approval_by: me.id, approval_at: new Date().toISOString(), approval_note: note,
      });
      const progress = after.needed > 1 ? ` (${after.approved} of ${after.needed} approvals)` : '';
      await ctx.audit(req, {
        action: 'ticket.approval', recordType: 'ticket', recordId: row.id,
        summary: `Request ${b.decision} by ${me.displayName}${progress}: ${notify.name(row)}${note ? ` (${note})` : ''}`,
        before: { approval_status: row.approval_status }, after: { approval_status: after.status, decision: b.decision },
      });
      if (after.status !== row.approval_status) {
        const mine = (await notify.owners(saved));
        await notify.send({
          ...mine, userIds: [...(mine.userIds ?? []), row.created_by, row.requester_id].filter((id) => id && id !== me.id),
          ...notify.about(row), kind: 'approval',
          title: `Request ${after.status === 'pending' ? 'back to waiting for approval' : after.status}: ${notify.name(row)}`, body: note,
        });
      }
      return ctx.resources.find('ticket', row.id, req.user);
    });

    ctx.app.get('/api/tickets/:id/approvals', { preHandler: ctx.requirePerm('tickets.view') }, async (req) => {
      const row = (await ctx.resources.find('ticket', String((req.params as Row).id), req.user)) ?? ctx.fail(404, 'not_found', 'Ticket not found.');
      return approvalView(req.user, row);
    });
    ctx.describeRoute({
      method: 'GET', path: '/api/tickets/:id/approvals', permission: 'tickets.view', summary: 'Where the approval of a request stands: decisions, approvals needed, named approvers',
      response: '{ status, needed, approved, rejected, approvers: [{ id, label }] | null, decisions: [{ user_name, decision, note, decided_at, superseded, counts }], my_decision, can_decide, cannot_decide_reason }',
    });
  }

  return { checkItem, applyToNewTicket, checkTasks, checkApprovalGate, afterCreate, register, approvalView, mayDecide };
}
