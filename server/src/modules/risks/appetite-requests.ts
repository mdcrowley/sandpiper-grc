import type { FastifyReply, FastifyRequest } from 'fastify';
import { approvalEngine, defineApprovalKind } from '../../core/approval-kinds.ts';
import { actorOf, isDataLoad } from '../../core/dataload.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import type { AppetiteRow, Enterprise } from './enterprise.ts';

// A change of the risk appetite through an approval workflow (E46-53), beside the two ways an approval
// given elsewhere is recorded (E45-04 by hand, E45-56 from a committee decision). Someone who
// administers risks asks for a change of one category (record type `risk_appetite_change`, RAC-
// numbers): the proposed statement, highest rating and score (or removing the appetite) and why. The
// "Risk appetite change" workflow routes it; approval records the proposal as the category's next
// version, with the approver, today's date, the workflow as the approving body and the request's
// number as the reference, and re-checks every risk. Rejection or withdrawal leaves the appetite as it
// was. A version recorded directly for the category meanwhile overtakes the request ("Superseded").
// In a data load no workflow runs: a loaded request carries its outcome.

export const KIND = 'risk_appetite_change';
export const TYPE = 'risk_appetite_change';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** What was asked for: changed by no one once the request exists (ask again instead). */
const PROPOSAL = ['category', 'statement', 'max_rating', 'max_score', 'remove_appetite', 'reason'] as const;

export const DEFAULT_APPETITE_WORKFLOW = {
  name: 'Risk appetite change',
  description: 'A change of how much risk the organization accepts in a category. Someone who may approve risks decides; it cannot be the '
    + 'person who asked. Add a step for your executives or the board\'s delegate if they sign off the appetite.',
  steps: [{ key: 'risk-approver', name: 'Risk approver', approvers: { kind: 'permission', permission: 'risks.approve' }, quorum: 'any' }],
};

export async function seedAppetiteRequestDefaults(ctx: ModuleContext): Promise<void> {
  await ctx.lookups.ensure('risk_appetite_change_status', [
    { value: 'awaiting_approval', label: 'Awaiting approval', color: 'amber', sort: 10 },
    { value: 'approved', label: 'Approved', color: 'green', sort: 20, meta: { closed: true } },
    { value: 'rejected', label: 'Rejected', color: 'red', sort: 30, meta: { closed: true } },
    { value: 'withdrawn', label: 'Withdrawn', color: 'gray', sort: 40, meta: { closed: true } },
    { value: 'superseded', label: 'Superseded', color: 'gray', sort: 50, meta: { closed: true } },
  ], { module: 'risks' });
}

interface Deps {
  enterprise: Enterprise;
  riskPre: (action: string) => ((req: FastifyRequest, reply: FastifyReply) => Promise<void>)[];
}

export interface AppetiteRequests {
  /** Whether a change can be sent for approval: an active workflow of the kind exists. */
  available(): Promise<boolean>;
  /** The request waiting for approval, by category. */
  waiting(): Promise<Map<string, Row>>;
  /** Versions were recorded directly for these categories: their waiting requests are superseded. */
  supersede(categories: string[], req: FastifyRequest | null): Promise<void>;
}

export function registerAppetiteRequests(ctx: ModuleContext, deps: Deps): AppetiteRequests {
  const { db, app } = ctx;
  const { enterprise } = deps;
  const engine = () => approvalEngine(app);
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  const text = (v: unknown) => { const s = String(v ?? '').trim(); return s ? s : null; };
  const categoryOf = async (value: unknown) => (await ctx.lookups.values('risk_category')).find((c) => c.value === value);
  const live = (id: string) => db.one<Row>('select * from risk_appetite_changes where id = $1 and deleted_at is null', [id]);
  const ratingLabel = async (category: Row | undefined, key: string | null) =>
    key ? ((await enterprise.scaleOf(category))?.ratings.find((r) => r.key === key)?.label ?? key) : 'no limit';

  /** Checks a new request (a person's, or one a data load brings) and fills its title and requester. */
  async function prepare(req: FastifyRequest | null, data: Row): Promise<Row> {
    const loading = isDataLoad(req);
    if (req?.user && !loading && !ctx.can(req.user, 'risks.administer')) {
      ctx.fail(403, 'forbidden', 'Only someone who administers risks can ask for a change of the risk appetite.');
    }
    const c = await categoryOf(data.category);
    if (!c) invalid({ category: 'Choose a risk category.' });
    const row = {
      statement: text(data.statement), max_rating: text(data.max_rating),
      max_score: data.max_score === null || data.max_score === undefined || data.max_score === '' ? null : Number(data.max_score),
    };
    const remove = data.remove_appetite === true;
    const errors: Record<string, string> = remove ? {} : enterprise.checkProposal(c!.label, await enterprise.scaleOf(c), row);
    if (!remove && !row.statement && !row.max_rating && row.max_score === null) {
      errors.statement = 'Give the appetite asked for (a statement, a highest rating or a highest score), or ask for it to be removed.';
    }
    if (!text(data.reason)) errors.reason = 'Say why the appetite should change.';
    else if (String(data.reason).length > 2000) errors.reason = 'The reason is at most 2,000 characters.';
    const current = (await enterprise.appetite()).get(c!.value);
    if (!loading && !Object.keys(errors).length) {
      if (remove && !current) errors.remove_appetite = `${c!.label} has no appetite to remove.`;
      else if (!remove && current && String(current.statement ?? '') === String(row.statement ?? '') && String(current.max_rating ?? '') === String(row.max_rating ?? '')
        && String(current.max_score ?? '') === String(row.max_score ?? '')) errors.statement = `This is the ${c!.label.toLowerCase()} appetite in force already.`;
    }
    if (loading) {
      // No workflow runs in a load (E18-70): a loaded request says how it ended.
      const status = String(data.status ?? 'awaiting_approval');
      if (status === 'awaiting_approval') errors.status = 'In a data load no approval workflow runs: give the outcome (approved, rejected, withdrawn or superseded).';
    }
    if (Object.keys(errors).length) invalid(errors);
    if (!loading) {
      const eng = engine();
      if (!eng || !(await eng.definitions(KIND)).length) {
        ctx.fail(409, 'no_workflow', 'No active Risk appetite change workflow exists. An administrator can set one up under Administration > Approval workflows, or record an approval given elsewhere as a new version.');
      }
      if (await db.one(`select 1 from risk_appetite_changes where category = $1 and status = 'awaiting_approval' and deleted_at is null`, [c!.value])) {
        ctx.fail(409, 'already_requested', `A change of the ${c!.label.toLowerCase()} appetite is already waiting for approval. Withdraw it first to ask for another.`);
      }
      data.status = 'awaiting_approval';
      for (const k of ['decided_on', 'decided_by_name', 'decision_note', 'version']) data[k] = null;
    }
    Object.assign(data, row, remove ? { statement: null, max_rating: null, max_score: null } : {}, { remove_appetite: remove, reason: text(data.reason) });
    data.title = `${remove ? 'Remove the' : 'Change of the'} ${c!.label.toLowerCase()} risk appetite`;
    data.requested_by ??= actorOf(req).id;
    return data;
  }

  ctx.defineResource({
    type: TYPE, table: 'risk_appetite_changes', module: 'risks', label: 'Risk appetite change', plural: 'Risk appetite changes',
    path: '/api/risks/appetite/changes', route: '/risks/appetite/changes', titleField: 'title',
    ref: { field: 'ref', prefix: 'RAC-' },
    searchable: ['title', 'statement', 'reason'],
    defaultSort: { field: 'created_at', dir: 'desc' },
    evidence: false,
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Title', type: 'text', readOnly: true, personal: false },
      category: { label: 'Category', type: 'lookup', list: 'risk_category', required: true, help: 'The risk category whose appetite should change.' },
      statement: { label: 'Appetite statement asked for', type: 'longtext', personal: false, help: 'In plain words, how much of this kind of risk is acceptable.' },
      max_rating: { label: 'Highest acceptable rating asked for', type: 'text', help: 'A rating key of the category\'s risk scale (for example low or medium); empty for no limit.' },
      max_score: { label: 'Highest acceptable score asked for', type: 'number', help: 'Optional: a whole number on the register\'s score.' },
      remove_appetite: { label: 'Remove the appetite', type: 'boolean', default: false, help: 'True to ask for the category\'s appetite to be removed instead.' },
      reason: { label: 'Why it should change', type: 'longtext', required: true, personal: false, help: 'Kept with the version when it is approved.' },
      status: { label: 'Status', type: 'lookup', list: 'risk_appetite_change_status', default: 'awaiting_approval', readOnly: true, help: 'Set by the approval workflow; in a data load, the outcome.' },
      requested_by: { label: 'Asked for by', type: 'user', readOnly: true },
      decided_on: { label: 'Decided on', type: 'date', readOnly: true },
      decided_by_name: { label: 'Decided by', type: 'text', readOnly: true },
      decision_note: { label: 'Decision note', type: 'longtext', readOnly: true },
      version: { label: 'Version recorded', type: 'number', readOnly: true },
    },
    hooks: {
      beforeCreate: (req, data) => prepare(req, data),
      beforeUpdate: async (req, _existing, patch) => {
        // What was asked for is what the approvers decide on: ask again rather than change it.
        if (req?.user && !isDataLoad(req) && PROPOSAL.some((k) => k in patch)) {
          ctx.fail(409, 'locked', 'What a request asks for cannot be changed. Withdraw it and ask again.');
        }
        return patch;
      },
      afterCreate: async (req, row) => {
        if (isDataLoad(req)) return;
        const eng = engine();
        const started = eng ? await eng.start(KIND, row, { requester: row.requested_by ?? null, req, note: String(row.reason ?? '').slice(0, 2000) }) : null;
        // A workflow whose conditions do not hold for this request: nothing would ever approve it.
        if (!started) ctx.fail(409, 'no_workflow', 'No active Risk appetite change workflow applies to this category. An administrator can set one up under Administration > Approval workflows.');
      },
    },
  });

  defineApprovalKind(app, {
    key: KIND, recordType: TYPE, label: 'Risk appetite change',
    startsWhen: 'Someone who administers risks asks for a change of a category\'s risk appetite (on the Risk appetite page)',
    outcome: 'Approved: the change is recorded as the category\'s next appetite version (approver, date, this workflow as the approving body) and every risk is checked against it; rejected or withdrawn: the appetite stays as it was',
    approverPermission: 'risks.approve',
    route: (id) => `/risks/appetite/changes/${id}`,
    async install(h) {
      if (!(await h.hasDefinitions())) await h.define(DEFAULT_APPETITE_WORKFLOW);
    },
    async onFinish(e) {
      const request = await live(e.instance.recordId);
      if (!request) return;
      const c = await categoryOf(request.category);
      const label = c?.label ?? request.category;
      const who = `${e.approverName ?? 'An approver'}${e.onBehalfOfName ? ` on behalf of ${e.onBehalfOfName}` : ''}`;
      if (e.outcome === 'canceled') {
        // The module's own withdrawal or supersession already set the status.
        if (request.status === 'awaiting_approval') {
          await ctx.resources.update(TYPE, request.id, { status: 'withdrawn', decided_on: dayInZone(), decision_note: e.comment ?? 'The approval was canceled.' }, null);
        }
        return;
      }
      if (e.outcome === 'rejected') {
        await ctx.resources.update(TYPE, request.id, { status: 'rejected', decided_on: dayInZone(), decided_by_name: who.slice(0, 200), decision_note: e.comment ?? null }, null);
        await ctx.audit(e.req, {
          action: 'risk_appetite.change_rejected', recordType: TYPE, recordId: request.id,
          summary: `Change of the ${label} risk appetite (${request.ref}) rejected by ${who}: ${e.comment ?? 'no reason given'}`,
        });
        return;
      }
      // Approved. The scale may have changed since it was asked for: a rating it no longer has is not recorded.
      const row: AppetiteRow = {
        category: request.category, statement: request.statement ?? null, max_rating: request.max_rating ?? null,
        max_score: request.max_score === null || request.max_score === undefined ? null : Number(request.max_score),
        approved_on: dayInZone(), approved_by_name: who.slice(0, 200), approval_body: `Approval workflow "${e.instance.name}"`.slice(0, 200),
        reference: request.ref, decision_id: null,
      };
      if (!request.remove_appetite) {
        const problems = enterprise.checkProposal(label, await enterprise.scaleOf(c), row);
        if (Object.keys(problems).length) throw new Error(`${Object.values(problems).join(' ')} The appetite was not changed; ask again.`);
      }
      const { versions, changed } = await enterprise.recordVersions([{ row, removed: request.remove_appetite === true }], request.reason ?? 'Approved through the approval workflow', e.approverId);
      const version = versions.get(request.category) ?? null;
      await ctx.resources.update(TYPE, request.id, { status: 'approved', decided_on: row.approved_on, decided_by_name: row.approved_by_name, decision_note: e.comment ?? null, version }, null);
      await ctx.audit(e.req, {
        action: 'risk_appetite.update', recordType: 'risk_appetite', recordId: 'appetite',
        summary: `Risk appetite ${request.remove_appetite ? 'removed' : 'changed'} for ${label} (version ${version}, ${request.ref}, approved by ${who} through the approval workflow; ${changed} risks changed breach): ${String(request.reason ?? '').slice(0, 160)}`,
        after: { category: request.category, version, statement: row.statement, max_rating: row.max_rating, max_score: row.max_score, removed: request.remove_appetite === true, request: request.ref },
      });
    },
  });

  app.post('/api/risks/appetite/changes/:id/withdraw', { preHandler: deps.riskPre('view') }, async (req) => {
    const id = String((req.params as Row).id ?? '');
    const request = (UUID.test(id) ? await ctx.resources.find(TYPE, id, req.user) : undefined) ?? ctx.fail(404, 'not_found', 'Risk appetite change not found.');
    if (request.status !== 'awaiting_approval') ctx.fail(409, 'not_waiting', `${request.ref} is no longer waiting for approval.`);
    if (request.requested_by !== req.user!.id && !ctx.can(req.user, 'risks.administer')) {
      ctx.fail(403, 'forbidden', 'Only the person who asked, or someone who administers risks, can withdraw the request.');
    }
    const reason = text((req.body as Row | undefined)?.reason) ?? 'Withdrawn by the person who asked.';
    if (reason.length > 2000) invalid({ reason: 'The reason is at most 2,000 characters.' });
    const updated = await ctx.resources.update(TYPE, request.id, { status: 'withdrawn', decided_on: dayInZone(), decided_by_name: (actorOf(req).name ?? '').slice(0, 200) || null, decision_note: reason }, null);
    await engine()?.cancel(KIND, request.id, reason, req);
    await ctx.audit(req, { action: 'risk_appetite.change_withdrawn', recordType: TYPE, recordId: request.id, summary: `${request.ref} withdrawn: ${reason.slice(0, 160)}` });
    return updated;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/risks/appetite/changes/:id/withdraw', tag: 'Risks', permission: 'risks.view',
    summary: 'Withdraw a change of the risk appetite that is waiting for approval (the person who asked, or someone with risks.administer)',
    body: '{ reason?: string }', response: 'The request, now Withdrawn',
  });

  return {
    async available() {
      const eng = engine();
      return Boolean(eng && (await eng.definitions(KIND)).length);
    },
    async waiting() {
      const rows = await db.query<Row>(
        `select r.id, r.ref, r.category, r.statement, r.max_rating, r.max_score, r.remove_appetite, r.reason, r.requested_by, r.created_at as requested_at,
                u.display_name as requested_by_name
         from risk_appetite_changes r left join users u on u.id = r.requested_by
         where r.deleted_at is null and r.status = 'awaiting_approval' order by r.created_at`);
      const eng = engine();
      const categories = await ctx.lookups.values('risk_category');
      const out = new Map<string, Row>();
      for (const r of rows) {
        const running = eng ? await eng.running(KIND, r.id) : null;
        const c = categories.find((x) => x.value === r.category);
        out.set(r.category, { ...r, max_rating_label: r.max_rating ? await ratingLabel(c, r.max_rating) : null, workflow: running?.name ?? null });
      }
      return out;
    },
    async supersede(categories, req) {
      if (!categories.length) return;
      const rows = await db.query<Row>(
        `select id, ref from risk_appetite_changes where deleted_at is null and status = 'awaiting_approval' and category = any($1::text[])`, [categories]);
      for (const r of rows) {
        const note = 'A version of the appetite was recorded directly while this request waited.';
        await ctx.resources.update(TYPE, r.id, { status: 'superseded', decided_on: dayInZone(), decision_note: note }, null);
        await engine()?.cancel(KIND, r.id, note, req);
        await ctx.audit(req, { action: 'risk_appetite.change_superseded', recordType: TYPE, recordId: r.id, summary: `${r.ref} superseded: ${note}` });
      }
    },
  };
}
