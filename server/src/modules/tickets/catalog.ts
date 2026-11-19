// E03-15: catalog items with their own questions, fulfillment tasks and approval.
import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
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
    if (item.requires_approval) data.approval_status = 'pending';
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
    await notify.send({
      permission: 'tickets.approve', ...notify.about(row), kind: 'approval',
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
      const note = String(b.note ?? '').trim() || null;
      if (b.decision === 'rejected' && !note) bad('note', 'Say why the request is rejected.');
      // The approval fields are read-only to people, so they are written as the system and audited as the person.
      const saved = await ctx.resources.update('ticket', row.id, {
        approval_status: b.decision, approval_by: req.user!.id, approval_at: new Date().toISOString(), approval_note: note,
      });
      await ctx.audit(req, {
        action: 'ticket.approval', recordType: 'ticket', recordId: row.id,
        summary: `Request ${b.decision}: ${notify.name(row)}${note ? ` (${note})` : ''}`,
        before: { approval_status: row.approval_status }, after: { approval_status: b.decision },
      });
      const mine = (await notify.owners(saved));
      await notify.send({
        ...mine, userIds: [...(mine.userIds ?? []), row.created_by].filter((id) => id && id !== req.user!.id),
        ...notify.about(row), kind: 'approval',
        title: `Request ${b.decision}: ${notify.name(row)}`, body: note,
      });
      return ctx.resources.find('ticket', row.id, req.user);
    });
  }

  return { checkItem, applyToNewTicket, checkTasks, checkApprovalGate, afterCreate, register };
}
