// Budget versions (E46-67): the adopted budget (version 0) and each amendment after it, with its date,
// the approval or board decision, the reason and the line changes. Recording a version applies its changes
// to the budget's lines, so the lines always hold the latest version, and keeps every line's amount before
// and after it, so the history can be read back. A data load records past adoptions and amendments with
// their own dates and the people named. Removing the latest version (or undoing a load) puts the lines back.
import type { FastifyRequest } from 'fastify';
import { routePattern } from '../../core/api/versioning.ts';
import { actorOf, dataLoadFor, isDataLoad } from '../../core/dataload.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { BUDGET, BUDGET_LINE } from './budgets.ts';
import { cents, cleanText, day, idParam, invalid, isDate, num } from './shared.ts';
import { UUID_RE } from '../../core/errors.ts';

export const BUDGET_VERSION = 'budget_version';

/** A line change as stored: a line's new amount, or a new line. */
type Change = { budget_line_id: string; amount: number } | { new: true; title: string; kind: string; account: string | null; department_id: string | null; project_id: string | null; funding_award_id: string | null; amount: number };

/** Fields that stay as recorded: changing them would rewrite the history. */
const FIXED = ['budget_id', 'kind', 'effective_on', 'changes', 'version_no'];

type DecisionLookup = (r: FastifyRequest, id: unknown) => Promise<{ ok: boolean; message?: string; decision?: Row }>;

export function registerVersions(ctx: ModuleContext) {
  const { app, db } = ctx;

  const latestOf = (budgetId: string) => db.one<Row>(
    `select id, version_no, kind, effective_on::text as effective_on from budget_versions where budget_id = $1 and deleted_at is null order by version_no desc limit 1`, [budgetId]);

  async function cleanChanges(req: FastifyRequest | null, budgetId: string, raw: unknown, errors: Record<string, string>): Promise<Change[]> {
    if (raw === null || raw === undefined || raw === '') return [];
    let list = raw;
    if (typeof list === 'string') { try { list = JSON.parse(list); } catch { errors.changes = 'Give the line changes as a list.'; return []; } }
    if (!Array.isArray(list)) { errors.changes = 'Give the line changes as a list.'; return []; }
    if (list.length > 500) { errors.changes = 'At most 500 line changes in one version.'; return []; }
    const lines = await db.query<Row>('select id, amount from budget_lines where budget_id = $1 and deleted_at is null', [budgetId]);
    const out: Change[] = [];
    const seen = new Set<string>();
    for (const [i, c] of (list as Row[]).entries()) {
      const n = `Change ${i + 1}`;
      if (!c || typeof c !== 'object') { errors.changes = `${n}: give a line and its amount.`; break; }
      if (c.budget_line_id) {
        const line = lines.find((l) => l.id === c.budget_line_id);
        if (!line || (req && !(await ctx.resources.find(BUDGET_LINE, String(c.budget_line_id), req.user)))) { errors.changes = `${n}: choose a line of this budget.`; break; }
        if (seen.has(line.id)) { errors.changes = `${n}: the line is changed twice.`; break; }
        seen.add(line.id);
        const has = (k: string) => c[k] !== undefined && c[k] !== null && c[k] !== '';
        if (!has('amount') && !has('change')) { errors.changes = `${n}: give the new amount or the change.`; break; }
        const amount = has('amount') ? Number(c.amount) : num(line.amount) + Number(c.change);
        if (!Number.isFinite(amount) || amount < 0) { errors.changes = `${n}: the line's amount cannot be below zero.`; break; }
        out.push({ budget_line_id: line.id, amount: cents(amount) });
      } else {
        const title = cleanText(c.title, 300);
        const amount = Number(c.amount);
        if (!title) { errors.changes = `${n}: name the new line, or choose a line of this budget.`; break; }
        if (!Number.isFinite(amount) || amount < 0) { errors.changes = `${n}: give the new line an amount of zero or more.`; break; }
        const kind = c.kind === 'capital' ? 'capital' : 'operating';
        const ref = (v: unknown) => (typeof v === 'string' && UUID_RE.test(v) ? v : null);
        if (c.project_id && kind !== 'capital') { errors.changes = `${n}: only a capital line names a project.`; break; }
        out.push({ new: true, title, kind, account: cleanText(c.account, 100), department_id: ref(c.department_id), project_id: ref(c.project_id), funding_award_id: ref(c.funding_award_id), amount: cents(amount) });
      }
    }
    return out;
  }

  async function versionRules(req: FastifyRequest | null, data: Row): Promise<Row> {
    const errors: Record<string, string> = {};
    const load = isDataLoad(req);
    if (req && !ctx.can(req.user, 'procurement.approve')) ctx.fail(403, 'forbidden', 'Recording the adoption or an amendment of a budget needs permission to approve in procurement.');
    const budget = data.budget_id && UUID_RE.test(String(data.budget_id))
      ? (req ? await ctx.resources.find(BUDGET, String(data.budget_id), req.user) : await db.one<Row>('select * from budgets where id = $1 and deleted_at is null', [data.budget_id]))
      : undefined;
    if (!budget) invalid(ctx, { budget_id: 'Choose the budget.' });
    if (!load && budget!.status === 'closed') errors.budget_id = 'The budget is closed.';
    const kind = data.kind === 'adopted' ? 'adopted' : 'amendment';
    data.kind = kind;
    const latest = await latestOf(budget!.id);
    const today = todayInZone();
    // The approval: a committee decision when one is named (governance on), otherwise in words.
    if (data.decision_id) {
      const ask = (app as unknown as { committeeDecision?: DecisionLookup }).committeeDecision;
      const answer = ask && req ? await ask(req, data.decision_id) : { ok: false, message: 'Committees and meetings are not available, so a decision cannot be named.' };
      if (!answer.ok) errors.decision_id = answer.message ?? 'Choose a carried decision.';
      else {
        data.approved_on ??= answer.decision!.decided_on;
        data.decision ??= answer.decision!.reference;
      }
    }
    if (data.approved_on && !isDate(day(data.approved_on))) errors.approved_on = 'Give a date (YYYY-MM-DD).';
    else if (!load && data.approved_on && day(data.approved_on)! > today) errors.approved_on = 'The approval date cannot be in the future.';
    data.effective_on = day(data.effective_on) ?? day(data.approved_on) ?? today;
    if (kind === 'adopted') {
      if (latest) errors.kind = 'The budget is already adopted: record an amendment.';
      data.version_no = 0;
      data.title = 'Adopted budget';
    } else {
      if (!latest) errors.kind = 'Record the adoption of the budget first.';
      else if (data.effective_on < latest.effective_on) errors.effective_on = `Amendments are recorded in order: this one cannot take effect before the previous version (${latest.effective_on}).`;
      data.version_no = Number(latest?.version_no ?? 0) + 1;
      data.title = `Amendment ${data.version_no}`;
      if (!cleanText(data.reason)) errors.reason = 'Say why the budget is amended.';
    }
    if (!cleanText(data.decision) && !data.decision_id) errors.decision = 'Say who approved it: the board decision or other approval.';
    const changes = await cleanChanges(req, budget!.id, data.changes, errors);
    if (kind === 'amendment' && !errors.changes) {
      const lines = await db.query<Row>('select id, amount from budget_lines where budget_id = $1 and deleted_at is null', [budget!.id]);
      const real = changes.filter((c) => 'new' in c || num(lines.find((l) => l.id === c.budget_line_id)?.amount) !== c.amount);
      if (!real.length) errors.changes = 'Change the amount of at least one line, or add a line.';
    }
    if (kind === 'adopted' && !errors.changes && !changes.length) {
      const n = await db.one<Row>('select count(*)::int as n from budget_lines where budget_id = $1 and deleted_at is null', [budget!.id]);
      if (!Number(n?.n)) errors.changes = 'Add the budget\'s lines before recording its adoption.';
    }
    if (Object.keys(errors).length) invalid(ctx, errors);
    data.changes = changes;
    const actor = actorOf(req);
    data.recorded_by = actor.id;
    data.recorded_by_name = actor.name;
    return data;
  }

  /** Applies a new version's changes to the lines and keeps every line's amount before and after it. */
  async function apply(row: Row) {
    const before = await db.query<Row>('select id, amount from budget_lines where budget_id = $1 and deleted_at is null', [row.budget_id]);
    const changes = (Array.isArray(row.changes) ? row.changes : []) as Change[];
    const stored: Change[] = [];
    const added = new Set<string>();
    for (const c of changes) {
      if ('new' in c) {
        const line = await ctx.resources.create(BUDGET_LINE, {
          budget_id: row.budget_id, title: c.title, kind: c.kind, account: c.account, department_id: c.department_id,
          project_id: c.project_id, funding_award_id: c.funding_award_id, amount: c.amount,
        }, null);
        added.add(line.id);
        stored.push({ budget_line_id: line.id, amount: c.amount });
      } else {
        const was = before.find((l) => l.id === c.budget_line_id);
        if (was && num(was.amount) !== c.amount) await ctx.resources.update(BUDGET_LINE, c.budget_line_id, { amount: c.amount }, null);
        stored.push(c);
      }
    }
    const after = await db.query<Row>('select id, amount from budget_lines where budget_id = $1 and deleted_at is null', [row.budget_id]);
    for (const l of after) {
      const was = before.find((b) => b.id === l.id);
      await db.query('insert into budget_version_lines (version_id, budget_line_id, amount_before, amount_after) values ($1,$2,$3,$4)',
        [row.id, l.id, added.has(l.id) || !was ? null : num(was.amount), num(l.amount)]);
    }
    const sum = (rows: Row[]) => cents(rows.reduce((s, r) => s + num(r.amount), 0));
    // New lines are named by their id from now on, so the stored changes read back as line changes.
    await db.query('update budget_versions set total_before = $2, total_after = $3, changes = $4 where id = $1',
      [row.id, sum(before), sum(after), JSON.stringify(stored)]);
    const budget = await db.one<Row>('select status from budgets where id = $1 and deleted_at is null', [row.budget_id]);
    const status = row.kind === 'adopted' ? 'adopted' : 'amended';
    if (budget && budget.status !== 'closed' && budget.status !== status) await ctx.resources.update(BUDGET, row.budget_id, { status }, null);
  }

  /** After a version is removed: the lines go back to the latest version left (or to before the removed one). */
  async function rebuild(req: FastifyRequest | null, removed: Row) {
    const latest = await db.one<Row>(
      'select id, kind from budget_versions where budget_id = $1 and deleted_at is null order by version_no desc limit 1', [removed.budget_id]);
    const snapshot = await db.query<Row>(
      'select budget_line_id, amount_before, amount_after from budget_version_lines where version_id = $1', [latest ? latest.id : removed.id]);
    const lines = await db.query<Row>('select id, amount from budget_lines where budget_id = $1 and deleted_at is null', [removed.budget_id]);
    const addedByRemoved = new Set((await db.query<Row>(
      'select budget_line_id from budget_version_lines where version_id = $1 and amount_before is null', [removed.id])).map((r) => r.budget_line_id));
    for (const l of lines) {
      const s = snapshot.find((x) => x.budget_line_id === l.id);
      const target = !s ? null : latest ? s.amount_after : s.amount_before;
      if (target === null || target === undefined) {
        if (!addedByRemoved.has(l.id)) continue;
        if (req && ctx.resources.remove) await ctx.resources.remove(BUDGET_LINE, l.id, req, { summary: '(the budget version that added it was removed)' });
        else await db.query('update budget_lines set deleted_at = now(), updated_at = now() where id = $1', [l.id]);
        continue;
      }
      if (num(target) !== num(l.amount)) await ctx.resources.update(BUDGET_LINE, l.id, { amount: num(target) }, null);
    }
    const budget = await db.one<Row>('select status from budgets where id = $1 and deleted_at is null', [removed.budget_id]);
    const status = !latest ? 'draft' : latest.kind === 'adopted' ? 'adopted' : 'amended';
    if (budget && budget.status !== 'closed' && budget.status !== status) await ctx.resources.update(BUDGET, removed.budget_id, { status }, null);
  }

  ctx.defineResource({
    type: BUDGET_VERSION, table: 'budget_versions', module: 'procurement', label: 'Budget version', plural: 'Budget versions',
    path: '/api/budget-versions', route: '/procurement/budget-versions', titleField: 'title',
    searchable: ['title', 'decision', 'reason', 'notes'],
    defaultSort: { field: 'version_no', dir: 'asc' },
    fields: {
      budget_id: { label: 'Budget', type: 'ref', to: BUDGET, required: true },
      kind: { label: 'Version', type: 'lookup', list: 'budget_version_kind', default: 'amendment', help: 'Adopted budget: the first version, as approved. Amendment: each later change, in date order.' },
      version_no: { label: 'Number', type: 'number', readOnly: true },
      title: { label: 'Title', type: 'text', readOnly: true, personal: false },
      effective_on: { label: 'Takes effect', type: 'date', help: 'When this version applies from; the approval date when left empty.' },
      approved_on: { label: 'Approved on', type: 'date' },
      decision: { label: 'Approval or board decision', type: 'text', personal: false, help: 'Who approved it, for example "Board resolution 2027-14" or "Approved by the general manager".' },
      decision_id: { label: 'Committee decision', type: 'ref', to: 'meeting_decision', help: 'The carried decision of the board or committee that approved it, when committees are used.' },
      document_id: { label: 'Document', type: 'ref', to: 'policy', help: 'The controlled document holding the budget or the amendment, if any.' },
      reason: { label: 'Reason', type: 'longtext', personal: false, help: 'Why the budget changes (needed for an amendment).' },
      changes: {
        label: 'Line changes', type: 'json',
        help: 'A list: { "budget_line_id": <line>, "amount": <new amount> } or { "budget_line_id": <line>, "change": <increase, negative to decrease> }; a new line is { "title", "kind": "operating" | "capital", "account", "amount" }. For the adoption it may be empty (the lines as they are).',
      },
      total_before: { label: 'Total before', type: 'currency', readOnly: true },
      total_after: { label: 'Total after', type: 'currency', readOnly: true },
      recorded_by: { label: 'Recorded by', type: 'user', readOnly: true },
      recorded_by_name: { label: 'Recorded by (name)', type: 'text', readOnly: true, personal: true },
      notes: { label: 'Notes', type: 'longtext' },
    },
    hooks: {
      beforeCreate: (req, data) => versionRules(req, data),
      beforeUpdate: async (req, existing, patch) => {
        for (const f of FIXED) {
          if (f in patch && JSON.stringify(patch[f] ?? null) !== JSON.stringify(f === 'effective_on' ? day(existing[f]) : existing[f] ?? null)) {
            invalid(ctx, { [f]: 'A recorded version stays as it was: record another amendment instead.' });
          }
        }
        if (req && !ctx.can(req.user, 'procurement.approve')) ctx.fail(403, 'forbidden', 'Changing a budget version needs permission to approve in procurement.');
        if ('reason' in patch && existing.kind === 'amendment' && !cleanText(patch.reason)) invalid(ctx, { reason: 'Say why the budget is amended.' });
        return patch;
      },
      afterCreate: (_req, row) => apply(row),
    },
  });

  ctx.resources.onChange?.(async (c) => {
    if (c.def.type === BUDGET_VERSION && c.action === 'delete' && c.row.budget_id) await rebuild(c.req, c.row);
  });
  // Only the latest version is removed (outside a data load, whose undo removes them all).
  app.addHook('preHandler', async (req) => {
    if (req.method !== 'DELETE' || routePattern(req) !== '/api/budget-versions/:id') return;
    const id = String((req.params as Row)?.id ?? '');
    if (!UUID_RE.test(id)) return;
    const v = await db.one<Row>('select budget_id, version_no from budget_versions where id = $1 and deleted_at is null', [id]);
    if (!v) return;
    const later = await db.one('select 1 from budget_versions where budget_id = $1 and deleted_at is null and version_no > $2', [v.budget_id, v.version_no]);
    if (later && !(await dataLoadFor(db, req))) ctx.fail(409, 'not_latest', 'Only the latest version can be removed: a later amendment builds on this one.');
  });

  // ---------- history ----------

  app.get('/api/budgets/:id/versions', { preHandler: ctx.requirePerm('procurement.view') }, async (req) => {
    const id = idParam(ctx, req, 'id', 'Budget');
    const budget = (await ctx.resources.find(BUDGET, id, req.user)) ?? ctx.fail(404, 'not_found', 'Budget not found.');
    const versions = await db.query<Row>(
      `select id, version_no, kind, title, effective_on::text as effective_on, approved_on::text as approved_on, decision, decision_id, document_id,
              reason, total_before, total_after, recorded_by_name, created_at
       from budget_versions where budget_id = $1 and deleted_at is null order by version_no`, [budget.id]);
    // Each line the reader may open, with its amount in every version (figures stay whole in the totals).
    const lines = await db.query<Row>(
      `select b.id, b.ref, b.title, b.account, b.kind, b.amount from budget_lines b
       where b.budget_id = $1 and ${ctx.resources.visibleWhere(BUDGET_LINE, req.user, 'b')}
         and (b.deleted_at is null or exists (select 1 from budget_version_lines vl join budget_versions v on v.id = vl.version_id and v.deleted_at is null where vl.budget_line_id = b.id))
       order by b.kind, b.account nulls last, b.title`, [budget.id]);
    const cells = versions.length ? await db.query<Row>(
      'select version_id, budget_line_id, amount_after from budget_version_lines where version_id = any($1::uuid[])', [versions.map((v) => v.id)]) : [];
    const all = await db.one<Row>('select count(*)::int as n from budget_lines where budget_id = $1 and deleted_at is null', [budget.id]);
    const visibleNow = lines.length;
    return {
      current_version: versions.length ? versions[versions.length - 1].version_no : null,
      versions: versions.map((v) => ({ ...v, total_before: cents(num(v.total_before)), total_after: cents(num(v.total_after)), change: cents(num(v.total_after) - num(v.total_before)) })),
      lines: lines.map((l) => ({
        id: l.id, ref: l.ref, title: l.title, account: l.account, kind: l.kind, current: cents(num(l.amount)),
        amounts: versions.map((v) => {
          const c = cells.find((x) => x.version_id === v.id && x.budget_line_id === l.id);
          return c ? cents(num(c.amount_after)) : null;
        }),
      })),
      hidden_lines: Math.max(0, Number(all?.n ?? 0) - visibleNow),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/budgets/:id/versions', tag: 'Procurement', permission: 'procurement.view',
    summary: 'A budget\'s history: the adopted budget and each amendment (totals the same for everyone), and the amount of each line the reader may open in every version',
    response: '{ current_version, versions: { id, version_no, kind, title, effective_on, approved_on, decision, decision_id, document_id, reason, total_before, total_after, change, recorded_by_name }[], lines: { id, ref, title, account, kind, current, amounts: (number | null)[] }[], hidden_lines }',
  });

  app.get('/api/budget-versions/:id/lines', { preHandler: ctx.requirePerm('procurement.view') }, async (req) => {
    const id = idParam(ctx, req, 'id', 'Budget version');
    const v = (await ctx.resources.find(BUDGET_VERSION, id, req.user)) ?? ctx.fail(404, 'not_found', 'Budget version not found.');
    const rows = await db.query<Row>(
      `select vl.budget_line_id, vl.amount_before, vl.amount_after, b.ref, b.title, b.account, b.kind
       from budget_version_lines vl join budget_lines b on b.id = vl.budget_line_id
       where vl.version_id = $1 and ${ctx.resources.visibleWhere(BUDGET_LINE, req.user, 'b')}
       order by b.kind, b.account nulls last, b.title`, [v.id]);
    const total = await db.one<Row>('select count(*)::int as n from budget_version_lines where version_id = $1', [v.id]);
    return {
      total_before: cents(num(v.total_before)), total_after: cents(num(v.total_after)),
      lines: rows.map((r) => ({
        budget_line_id: r.budget_line_id, ref: r.ref, title: r.title, account: r.account, kind: r.kind,
        amount_before: r.amount_before === null ? null : cents(num(r.amount_before)), amount_after: cents(num(r.amount_after)),
        change: cents(num(r.amount_after) - num(r.amount_before)), added: r.amount_before === null,
      })),
      hidden_lines: Number(total?.n ?? 0) - rows.length,
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/budget-versions/:id/lines', tag: 'Procurement', permission: 'procurement.view',
    summary: 'One budget version: every line\'s amount before and after it (the lines the reader may open) and the totals',
    response: '{ total_before, total_after, lines: { budget_line_id, ref, title, account, kind, amount_before, amount_after, change, added }[], hidden_lines }',
  });
}
