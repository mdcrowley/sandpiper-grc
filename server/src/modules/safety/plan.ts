// The safety plan from the safety pages (wave 26, E46). The plan itself is a controlled document
// (module policies) whose document type is a plan (`meta.plan` on the `policy_document_type` value),
// with its element map and annual review (policies/plans.ts). Safety shows which plans are the
// safety plan: those a safety administrator chose (setting `safety.plan_ids`) or, while none is
// chosen, every plan whose title mentions safety. For each: its version, the next review date and
// whether it is past, and where the annual review stands. Nothing here changes the document.
import type { ModuleContext, Row } from '../../core/module.ts';
import { approvalEngine } from '../../core/approval-kinds.ts';
import { UUID_RE } from '../../core/errors.ts';
import { dayInZone } from '../../core/timezone.ts';

export const SAFETY_PLAN_SETTING = 'safety.plan_ids';
const PLAN_REVIEW_KIND = 'plan_review';
const MAX_PLANS = 20;

export function registerSafetyPlan(ctx: ModuleContext) {
  const { app, db } = ctx;

  async function planTypes(): Promise<string[]> {
    const values = await ctx.lookups.values('policy_document_type');
    return values.length ? values.filter((v) => v.meta?.plan === true).map((v) => v.value) : ['plan'];
  }
  async function chosen(): Promise<string[]> {
    const ids = await ctx.settings.get<unknown>(SAFETY_PLAN_SETTING, []);
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)) : [];
  }

  app.get('/api/safety/plans', { preHandler: ctx.requirePerm('safety.view') }, async (req) => {
    if (!ctx.resources.get('policy')) return { available: false, chosen: false, plans: [], candidates: [] };
    const types = await planTypes();
    const ids = await chosen();
    const visible = ctx.resources.visibleWhere('policy', req.user, 'p');
    const base = `from policies p left join users u on u.id = p.owner_id
      where p.deleted_at is null and ${visible} and p.document_type = any($1::text[]) and coalesce(p.status, '') <> 'retired'`;
    const rows = await db.query<Row>(
      `select p.id, p.ref, p.title, p.status, p.current_version, p.review_date::text as review_date, p.last_reviewed_on::text as last_reviewed_on,
              u.display_name as owner_name ${base}
         and (case when cardinality($2::uuid[]) > 0 then p.id = any($2::uuid[]) else p.title ilike '%safety%' end)
       order by p.title limit ${MAX_PLANS}`, [types, ids]);
    const today = dayInZone();
    const engine = approvalEngine(app);
    const plans = [];
    for (const p of rows) {
      const reviews = await db.query<Row>(
        `select review_year, outcome, started_on::text as started_on, approved_on::text as approved_on
         from policy_plan_reviews where policy_id = $1 order by started_on desc, created_at desc limit 3`, [p.id]);
      const elements = await db.one<Row>(
        `select count(*)::int as total, count(*) filter (where owner_id is null)::int as unowned from policy_plan_elements where policy_id = $1`, [p.id]);
      let progress: Row | null = null;
      if (engine && reviews[0]?.outcome === 'in_review') {
        const pr = await engine.progress(PLAN_REVIEW_KIND, p.id, req.user!.id);
        if (pr.instance && pr.instance.status === 'running') {
          progress = { name: pr.instance.name, approvals: pr.approvals, required: pr.required, waiting_for: pr.waitingFor.length };
        }
      }
      plans.push({
        ...p, review_overdue: Boolean(p.review_date && p.review_date < today),
        last_review: reviews[0] ?? null, review_running: reviews[0]?.outcome === 'in_review', review_progress: progress,
        elements: elements?.total ?? 0, elements_unowned: elements?.unowned ?? 0,
      });
    }
    // The administrator's choice: every plan the reader may see (to pick from).
    const candidates = ctx.can(req.user, 'safety.administer')
      ? await db.query<Row>(`select p.id, p.ref, p.title ${base} order by p.title limit 200`, [types])
      : [];
    return { available: true, chosen: ids.length > 0, plans, candidates, can_open: ctx.can(req.user, 'policies.view') };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/safety/plans', permission: 'safety.view',
    summary: 'The safety plan(s): documents of a plan type chosen as the safety plan (else those titled with "safety"), with version, next review and annual review state',
    response: '{ available, chosen, can_open, plans: [{ id, ref, title, status, current_version, review_date, review_overdue, last_reviewed_on, owner_name, last_review, review_running, review_progress, elements, elements_unowned }], candidates: [{ id, ref, title }] }',
  });

  app.put('/api/safety/plans', { preHandler: ctx.requirePerm('safety.administer') }, async (req) => {
    if (!ctx.resources.get('policy')) ctx.fail(409, 'not_available', 'Documents are not available on this installation.');
    const body = (req.body ?? {}) as Row;
    const list = Array.isArray(body.plan_ids) ? body.plan_ids : null;
    if (!list || list.length > MAX_PLANS || list.some((x: unknown) => typeof x !== 'string' || !UUID_RE.test(x))) {
      ctx.fail(400, 'validation', 'Check the highlighted fields.', { plan_ids: `Choose up to ${MAX_PLANS} plans.` });
    }
    const ids = [...new Set(list as string[])];
    if (ids.length) {
      const found = await db.query<Row>(
        `select p.id from policies p where p.deleted_at is null and p.id = any($1::uuid[]) and p.document_type = any($2::text[])
           and ${ctx.resources.visibleWhere('policy', req.user, 'p')}`, [ids, await planTypes()]);
      if (found.length !== ids.length) ctx.fail(400, 'validation', 'Check the highlighted fields.', { plan_ids: 'Choose documents whose type is a plan.' });
    }
    // settings.set writes the audit event.
    await ctx.settings.set(SAFETY_PLAN_SETTING, ids, req);
    return { plan_ids: ids };
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/safety/plans', permission: 'safety.administer',
    summary: 'Choose which plans the safety pages show as the safety plan (an empty list: every plan titled with "safety")',
    body: '{ plan_ids: string[] }', response: '{ plan_ids }',
  });
}
