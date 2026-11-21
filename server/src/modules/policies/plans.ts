// Plans (E28-08, E28-09): a policy whose document type is a plan (contract C6: a value of the
// `policy_document_type` list with `meta.plan`, for example the safety plan) carries an element map
// (where the plan covers each element of an operator-defined list, and who owns it) and is reviewed
// every year by several parties in turn through the `plan_review` approval kind. Approval sets the
// next review date from the document type's review cycle (`meta.review_months`, 12 when unset).
// Owned by the governance work (wave 10); the document type itself belongs to the policies roster work.
import type { FastifyRequest } from 'fastify';
import { approvalEngine, defineApprovalKind } from '../../core/approval-kinds.ts';
import { UUID_RE } from '../../core/errors.ts';
import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone, todayInZone } from '../../core/timezone.ts';

export const PLAN_KIND = 'plan_review';
export const PLAN_REVIEW_SETTING = 'policies.plan_review_reminder_days';
export const DEFAULT_PLAN_REVIEW_DAYS = 30;
const DEFAULT_REVIEW_MONTHS = 12;
const MAX_ELEMENTS = 200;
const HOUR = 3_600_000;

/** The four generic pillars of a safety management system; operators add or rename their own. */
export const DEFAULT_PLAN_ELEMENTS = [
  { value: 'policy_objectives', label: 'Safety policy and objectives', sort: 10 },
  { value: 'risk_management', label: 'Safety risk management', sort: 20 },
  { value: 'assurance', label: 'Safety assurance', sort: 30 },
  { value: 'promotion', label: 'Safety promotion', sort: 40 },
];

export const DEFAULT_PLAN_REVIEW_WORKFLOW = {
  name: 'Annual plan review',
  description: 'The yearly review of a plan (for example the safety plan), approved in turn by the accountable executive, the governing body '
    + 'and the safety committee, each by a different person. Name the right people in each step: by default anyone who may approve policies can.',
  steps: [
    { key: 'accountable-executive', name: 'Accountable executive', approvers: { kind: 'permission', permission: 'policies.approve' }, quorum: 'any', due_hours: 336 },
    { key: 'governing-body', name: 'Governing body', approvers: { kind: 'permission', permission: 'policies.approve' }, quorum: 'any', due_hours: 720, distinct_approvers: true },
    { key: 'safety-committee', name: 'Safety committee', approvers: { kind: 'permission', permission: 'policies.approve' }, quorum: 'any', due_hours: 720, distinct_approvers: true },
  ],
};

export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** Whether the policies table has the document type column yet (contract C6, added by the roster work). */
const columnCache = new WeakMap<object, boolean>();
async function hasDocumentType(ctx: ModuleContext): Promise<boolean> {
  if (columnCache.get(ctx.app)) return true;
  const yes = Boolean(await ctx.db.one(`select 1 from information_schema.columns where table_name = 'policies' and column_name = 'document_type'`));
  if (yes) columnCache.set(ctx.app, true);
  return yes;
}

/** Whether a policy is a plan, and its review cycle in months. */
export async function planInfo(ctx: ModuleContext, policy: Row): Promise<{ isPlan: boolean; reviewMonths: number }> {
  const none = { isPlan: false, reviewMonths: DEFAULT_REVIEW_MONTHS };
  if (!(await hasDocumentType(ctx))) return none;
  let type = policy.document_type;
  if (type === undefined) type = (await ctx.db.one<{ t: string | null }>('select document_type as t from policies where id = $1', [policy.id]))?.t ?? null;
  if (!type) return none;
  const value = (await ctx.lookups.values('policy_document_type')).find((v) => v.value === type);
  const isPlan = value ? value.meta?.plan === true : type === 'plan';
  const months = Number(value?.meta?.review_months);
  return { isPlan, reviewMonths: Number.isInteger(months) && months > 0 && months <= 120 ? months : DEFAULT_REVIEW_MONTHS };
}

/** Plan review reminders: the policy's owner (else everyone who may edit policies) is told once as the review date nears, and once when it is reached. */
export async function runPlanReviewReminders(ctx: ModuleContext): Promise<{ available: boolean; soon: number; due: number; notified: number }> {
  const run = { available: ctx.app.hasDecorator('notify') && await hasDocumentType(ctx), soon: 0, due: 0, notified: 0 };
  if (!run.available) return run;
  const raw = Math.round(Number(await ctx.settings.get<unknown>(PLAN_REVIEW_SETTING, DEFAULT_PLAN_REVIEW_DAYS)));
  const lead = Number.isFinite(raw) ? Math.min(365, Math.max(0, raw)) : DEFAULT_PLAN_REVIEW_DAYS;
  const types = await ctx.lookups.values('policy_document_type');
  const planTypes = types.length ? types.filter((v) => v.meta?.plan === true).map((v) => v.value) : ['plan'];
  if (!planTypes.length) return run;
  const today = dayInZone();
  const rows = await ctx.db.query<Row>(
    `select id, ref, title, owner_id, review_date::text as review_on from policies
     where deleted_at is null and status <> 'retired' and document_type = any($1::text[])
       and review_date is not null and review_date >= $2::date and review_date <= $3::date
       and not exists (select 1 from policy_plan_reviews r where r.policy_id = policies.id and r.outcome = 'in_review')
     order by review_date limit 500`, [planTypes, dayInZone(-30), dayInZone(lead)]);
  for (const p of rows) {
    const due = p.review_on <= today;
    const res = await ctx.app.notify({
      ...(p.owner_id ? { userIds: [p.owner_id] } : { permission: 'policies.edit' }),
      kind: 'reminder',
      title: due ? `Plan review due: ${p.ref} ${p.title}` : `Plan review due on ${p.review_on}: ${p.ref} ${p.title}`,
      body: 'Start the annual review on the plan\'s page, so that each party can approve it in turn.',
      recordType: 'policy', recordId: p.id, once: `policy.plan_review_${due ? 'due' : 'soon'}:${p.id}:${p.review_on}`,
    });
    if (due) run.due += 1; else run.soon += 1;
    run.notified += res.sent;
  }
  return run;
}

/** Registers the plan-element and plan-review routes and the `plan_review` approval kind. Called from policies/index.ts `register`. */
export function registerPlans(ctx: ModuleContext): void {
  const { app, db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  const engine = () => approvalEngine(app);

  // The element list is the operator's to change (Administration > Lookups); these are its first values.
  app.addHook('onReady', async () => {
    await ctx.lookups.ensure('plan_element', DEFAULT_PLAN_ELEMENTS, { module: 'policies' });
    await scheduleWork(ctx, 'policies.plan_reviews', () => runPlanReviewReminders(ctx), { every: HOUR, firstRunInMs: 120_000 });
  });

  const policyFor = async (req: FastifyRequest): Promise<Row> =>
    (await ctx.resources.find('policy', (req.params as { id: string }).id, req.user)) ?? ctx.fail(404, 'not_found', 'Policy not found.');
  const needPlan = async (policy: Row) => {
    const info = await planInfo(ctx, policy);
    if (!info.isPlan) ctx.fail(409, 'not_a_plan', 'This policy is not a plan. Set its document type to a plan first.');
    return info;
  };

  async function elementsOf(policyId: string): Promise<Row[]> {
    return db.query<Row>(
      `select e.id, e.element_key, e.title, e.section_ref, e.owner_id, u.display_name as owner_name, e.notes, e.sort
       from policy_plan_elements e left join users u on u.id = e.owner_id where e.policy_id = $1 order by e.sort, e.created_at`, [policyId]);
  }
  async function reviewsOf(policyId: string): Promise<Row[]> {
    return db.query<Row>(
      `select r.id, r.review_year, r.outcome, r.started_on::text as started_on, r.approved_on::text as approved_on, r.note,
         r.workflow_instance_id, v.version
       from policy_plan_reviews r left join policy_versions v on v.id = r.version_id where r.policy_id = $1 order by r.started_on desc, r.created_at desc`, [policyId]);
  }

  // ---------- the approval kind ----------

  defineApprovalKind(app, {
    key: PLAN_KIND, recordType: 'policy', label: 'Annual plan review',
    startsWhen: 'Someone who may edit policies starts the yearly review of a plan (a policy whose document type is a plan)',
    outcome: 'Approved: the review is recorded and the plan\'s next review date is set from its document type\'s review cycle; rejected: the review is recorded as rejected, with the reason, and the review date stays',
    approverPermission: 'policies.approve',
    async install(h) {
      if (!(await h.hasDefinitions())) await h.define(DEFAULT_PLAN_REVIEW_WORKFLOW);
    },
    async onFinish(e) {
      const reviewId = String(e.instance.data?.review_id ?? '');
      const review = UUID_RE.test(reviewId)
        ? await db.one<Row>(`select * from policy_plan_reviews where id = $1`, [reviewId])
        : await db.one<Row>(`select * from policy_plan_reviews where workflow_instance_id = $1`, [e.instance.id]);
      if (!review) return;
      const today = dayInZone();
      if (e.outcome !== 'approved') {
        await db.query(`update policy_plan_reviews set outcome = $2, note = coalesce($3, note), updated_at = now() where id = $1`,
          [review.id, e.outcome, e.comment ? String(e.comment).slice(0, 2000) : null]);
        if (e.outcome === 'rejected') {
          await ctx.audit(e.req, { action: 'policy.plan_review_rejected', recordType: 'policy', recordId: review.policy_id, summary: `Plan review ${review.review_year} rejected by ${e.approverName ?? 'an approver'}: ${e.comment ?? 'no reason given'}` });
        }
        return;
      }
      const policy = await db.one<Row>('select * from policies where id = $1 and deleted_at is null', [review.policy_id]);
      if (!policy) throw new Error('The plan no longer exists.');
      const { reviewMonths } = await planInfo(ctx, policy);
      const next = addMonths(today, reviewMonths);
      await db.query(`update policy_plan_reviews set outcome = 'approved', approved_on = $2, updated_at = now() where id = $1`, [review.id, today]);
      // System work, as the engine applies every outcome: the approver's own rights do not apply to its result.
      await ctx.resources.update('policy', policy.id, { review_date: next }, null);
      await ctx.audit(e.req, {
        action: 'policy.plan_review_approved', recordType: 'policy', recordId: policy.id,
        summary: `Plan review ${review.review_year} of ${policy.ref} approved; next review by ${next}`, after: { review_id: review.id, review_date: next },
      });
    },
  });

  // ---------- routes ----------

  app.get('/api/policies/:id/plan', { preHandler: ctx.requirePerm('policies.view') }, async (req) => {
    const policy = await policyFor(req);
    const info = await planInfo(ctx, policy);
    const eng = engine();
    return {
      is_plan: info.isPlan, review_months: info.reviewMonths, review_date: policy.review_date ?? null,
      elements: info.isPlan ? await elementsOf(policy.id) : [],
      reviews: info.isPlan ? await reviewsOf(policy.id) : [],
      review_available: Boolean(eng && (await eng.definitions(PLAN_KIND)).length),
      review_running: Boolean(eng && await eng.running(PLAN_KIND, policy.id)),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/policies/:id/plan', tag: 'Policies', permission: 'policies.view',
    summary: 'Whether a policy is a plan, with its element map and review history',
    response: '{ is_plan, review_months, review_date, elements: [...], reviews: [...], review_available, review_running }',
  });

  app.get('/api/policies/:id/plan-elements', { preHandler: ctx.requirePerm('policies.view') }, async (req) => {
    const policy = await policyFor(req);
    await needPlan(policy);
    return elementsOf(policy.id);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/policies/:id/plan-elements', tag: 'Policies', permission: 'policies.view',
    summary: 'The element map of a plan: where the plan covers each element and who owns it',
    response: '[{ id, element_key, title, section_ref, owner_id, owner_name, notes, sort }]',
  });

  app.put('/api/policies/:id/plan-elements', { preHandler: ctx.requirePerm('policies.edit') }, async (req) => {
    const policy = await policyFor(req);
    await needPlan(policy);
    const list = (req.body as Row | null)?.elements;
    if (!Array.isArray(list) || list.length > MAX_ELEMENTS) invalid({ elements: `Send the elements as a list (at most ${MAX_ELEMENTS}).` });
    const keys = new Set((await ctx.lookups.values('plan_element')).map((v) => v.value));
    const clean: Row[] = [];
    for (const [i, raw] of (list as Row[]).entries()) {
      const e = raw ?? {};
      const key = String(e.element_key ?? '');
      if (!keys.has(key)) invalid({ [`elements.${i}.element_key`]: 'Choose an element from the list.' });
      const owner = e.owner_id ? String(e.owner_id) : null;
      if (owner && (!UUID_RE.test(owner) || !(await db.one('select 1 from users where id = $1', [owner])))) invalid({ [`elements.${i}.owner_id`]: 'Choose a user.' });
      const text = (k: string, max: number) => String(e[k] ?? '').trim().slice(0, max) || null;
      clean.push({ element_key: key, title: text('title', 300), section_ref: text('section_ref', 120), owner_id: owner, notes: text('notes', 4000), sort: (i + 1) * 10 });
    }
    const before = await elementsOf(policy.id);
    await db.tx(async (tx) => {
      await tx.query('delete from policy_plan_elements where policy_id = $1', [policy.id]);
      for (const e of clean) {
        await tx.query(
          `insert into policy_plan_elements (policy_id, element_key, title, section_ref, owner_id, notes, sort, created_by, updated_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$8)`, [policy.id, e.element_key, e.title, e.section_ref, e.owner_id, e.notes, e.sort, req.user!.id]);
      }
    });
    const pick = (rows: Row[]) => rows.map((e) => ({ element_key: e.element_key, title: e.title, section_ref: e.section_ref, owner_id: e.owner_id }));
    await ctx.audit(req, {
      action: 'policy.plan_elements', recordType: 'policy', recordId: policy.id,
      summary: `Plan element map saved (${clean.length} entr${clean.length === 1 ? 'y' : 'ies'})`, before: { elements: pick(before) }, after: { elements: pick(clean) },
    });
    return elementsOf(policy.id);
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/policies/:id/plan-elements', tag: 'Policies', permission: 'policies.edit',
    summary: 'Replace the element map of a plan', body: '{ elements: [{ element_key, title?, section_ref?, owner_id?, notes? }] }',
  });

  app.post('/api/policies/:id/plan-review', { preHandler: ctx.requirePerm('policies.edit') }, async (req, reply) => {
    const policy = await policyFor(req);
    await needPlan(policy);
    const eng = engine();
    if (!eng) ctx.fail(409, 'approvals_unavailable', 'Approval workflows are not available in this installation.');
    if (await eng!.running(PLAN_KIND, policy.id)) ctx.fail(409, 'already_requested', 'A review of this plan is already waiting for approval.');
    const note = String((req.body as Row | null)?.note ?? '').trim().slice(0, 2000) || null;
    const today = todayInZone();
    const version = await db.one<{ id: string }>(`select id from policy_versions where policy_id = $1 and version = $2`, [policy.id, policy.current_version ?? -1]);
    // Claimed first (one review at a time, a unique index), so two requests at once cannot start two workflows.
    const claim = await db.one<Row>(
      `insert into policy_plan_reviews (policy_id, version_id, review_year, outcome, started_on, note, created_by, updated_by)
       values ($1,$2,$3,'in_review',$4,$5,$6,$6) on conflict do nothing returning id`,
      [policy.id, version?.id ?? null, Number(today.slice(0, 4)), today, note, req.user!.id]);
    if (!claim) ctx.fail(409, 'already_requested', 'A review of this plan is already waiting for approval.');
    let started: Awaited<ReturnType<NonNullable<ReturnType<typeof engine>>['start']>> = null;
    try {
      started = await eng!.start(PLAN_KIND, policy, { requester: req.user!.id, req, note, data: { review_id: claim!.id } });
    } finally {
      if (!started) await db.query('delete from policy_plan_reviews where id = $1', [claim!.id]);
    }
    if (!started) ctx.fail(409, 'no_workflow', 'No active Annual plan review workflow applies. An administrator can set one up under Administration > Approval workflows.');
    await db.query('update policy_plan_reviews set workflow_instance_id = $2 where id = $1', [claim!.id, started!.id]);
    const now = await eng!.latest(PLAN_KIND, policy.id);
    await ctx.audit(req, {
      action: 'policy.plan_review_started', recordType: 'policy', recordId: policy.id,
      summary: `Annual review ${today.slice(0, 4)} of ${policy.ref} started`, after: { review_id: claim!.id, workflow: started!.name },
    });
    reply.code(201);
    return { review_id: claim!.id, instance_id: started!.id, workflow: started!.name, status: now?.status ?? started!.status };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/policies/:id/plan-review', tag: 'Policies', permission: 'policies.edit',
    summary: 'Start the yearly review of a plan: the Annual plan review approval workflow, approved by each party in turn',
    body: '{ note? }', response: '{ review_id, instance_id, workflow, status }',
  });

  app.post('/api/policies/plan-reviews/run', { preHandler: ctx.requirePerm('policies.administer') }, async () => runPlanReviewReminders(ctx));
  ctx.describeRoute({
    method: 'POST', path: '/api/policies/plan-reviews/run', tag: 'Policies', permission: 'policies.administer',
    summary: 'Send the plan review reminders now (they also run every hour; each review date is announced at most twice)',
  });
}
