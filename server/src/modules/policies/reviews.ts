// Periodic reviews of documents (E43). A review ends in one of: no change (the review is recorded
// and the next review date moves on by the cycle; no new version), revise (a draft opens from the
// effective text) or make obsolete. Plans keep their annual review by approval workflow (plans.ts);
// both kinds live in policy_plan_reviews (`kind` plan_annual | periodic).
import type { FastifyRequest } from 'fastify';
import { actorOf } from '../../core/dataload.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { addMonths } from '../../../../shared/dates.ts';
import type { AccessTables } from './access.ts';
import { syncPolicyStatus } from './acknowledgments.ts';
import { daysBetween, isDate, localDate } from './dates.ts';
import { cycleOf } from './types.ts';
import { asLoadIfLoading, retireDocument, versionView } from './versions.ts';

const T = 'Documents';
const RESULTS = ['no_change', 'revise', 'retire'] as const;
const ymd = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

export function registerReviews(ctx: ModuleContext, tables: AccessTables): void {
  const { app, db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  const needPolicy = async (req: FastifyRequest): Promise<Row> =>
    (await ctx.resources.find('policy', String((req.params as Row).id ?? ''), req.user)) ?? ctx.fail(404, 'not_found', 'Document not found.');

  const reviewView = (r: Row) => ({
    id: r.id, kind: r.kind, result: r.result ?? null, outcome: r.outcome, review_year: Number(r.review_year),
    started_on: ymd(r.started_on), reviewed_on: ymd(r.reviewed_on) ?? ymd(r.approved_on), approved_on: ymd(r.approved_on),
    reviewed_by_name: r.reviewed_by_name ?? null, note: r.note ?? null, version: r.version === null || r.version === undefined ? null : Number(r.version),
  });

  app.get('/api/policies/:id/reviews', { preHandler: ctx.requirePerm('policies.view') }, async (req) => {
    const policy = await needPolicy(req);
    const rows = await db.query<Row>(
      `select r.*, v.version from policy_plan_reviews r left join policy_versions v on v.id = r.version_id
       where r.policy_id = $1 order by coalesce(r.reviewed_on, r.started_on) desc, r.created_at desc`, [policy.id]);
    return rows.map(reviewView);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/policies/:id/reviews', tag: T, permission: 'policies.view',
    summary: 'A document\'s reviews: periodic reviews and, for plans, annual reviews',
    response: '[{ id, kind, result, outcome, review_year, started_on, reviewed_on, approved_on, reviewed_by_name, note, version }]',
  });

  app.post('/api/policies/:id/reviews', { preHandler: ctx.requirePerm('policies.edit') }, async (req, reply) => asLoadIfLoading(ctx, req, async (load) => {
    const policy = await needPolicy(req);
    const b = (req.body ?? {}) as Row;
    const result = String(b.result ?? '');
    if (!(RESULTS as readonly string[]).includes(result)) invalid({ result: 'Choose the result of the review.' });
    if (result === 'retire' && !ctx.can(req.user, 'policies.approve')) ctx.fail(403, 'forbidden', 'Making a document obsolete needs approval permission.');
    if (policy.status === 'retired') ctx.fail(409, 'retired', 'This document is obsolete. It is not reviewed any more.');
    const today = localDate();
    const reviewedOn = b.reviewed_on === undefined || b.reviewed_on === null || b.reviewed_on === '' ? today : String(b.reviewed_on);
    if (!isDate(reviewedOn)) invalid({ reviewed_on: 'Enter a date (YYYY-MM-DD).' });
    if (!load && reviewedOn > today) invalid({ reviewed_on: 'A review cannot be recorded for a future date.' });
    const note = b.note === undefined || b.note === null ? null : String(b.note).trim().slice(0, 4000) || null;
    const by = String(b.reviewed_by_name ?? '').trim().slice(0, 200) || actorOf(req).name || req.user!.displayName;
    const current = await db.one<Row>(`select * from policy_versions where policy_id = $1 and status = 'published'`, [policy.id]);
    if (result === 'no_change' && !current) ctx.fail(409, 'not_effective', 'This document has no effective version to confirm. Publish a version first.');

    const review = (await db.one<Row>(
      `insert into policy_plan_reviews (policy_id, version_id, review_year, outcome, started_on, approved_on, reviewed_on, kind, result, reviewed_by_name, note, created_by, updated_by)
       values ($1, $2, $3, 'completed', $4, $4, $4, 'periodic', $5, $6, $7, $8, $8) returning *`,
      [policy.id, current?.id ?? null, Number(reviewedOn.slice(0, 4)), reviewedOn, result, by, note, req.user!.id]))!;
    const out: Row = { review: reviewView({ ...review, version: current?.version ?? null }) };

    // The next review: from this review by the cycle (never earlier than a later review already recorded).
    const months = await cycleOf(ctx, policy);
    const latest = ymd((await db.one<Row>(
      `select max(reviewed_on) as d from policy_plan_reviews where policy_id = $1 and kind = 'periodic'`, [policy.id]))?.d) ?? reviewedOn;
    const next = months ? addMonths(latest, months) : null;
    await db.query(
      `update policies set last_reviewed_on = $2::date, review_date = coalesce($3::date, review_date), updated_at = now(), updated_by = $4 where id = $1`,
      [policy.id, latest, result === 'retire' ? null : next, req.user!.id]);
    out.next_review_on = result === 'retire' ? null : next;

    if (result === 'revise' && !load) {
      const open = await db.one<Row>(`select * from policy_versions where policy_id = $1 and status in ('draft', 'in_review', 'approved') order by version desc limit 1`, [policy.id]);
      if (open) out.version = versionView(open);
      else {
        const n = (await db.one<{ n: number }>('select coalesce(max(version), 0)::int + 1 as n from policy_versions where policy_id = $1', [policy.id]))!.n;
        const draft = (await db.one<Row>(
          `insert into policy_versions (policy_id, version, body, change_summary, content_kind, source_attachment_id, created_by, updated_by)
           values ($1, $2, $3, $4, $5, $6, $7, $7) returning *`,
          [policy.id, n, current?.body ?? '', `Revision after the review of ${reviewedOn}.`, current?.content_kind ?? 'markdown',
            current?.content_kind === 'file' ? current.source_attachment_id : null, req.user!.id]))!;
        await syncPolicyStatus(ctx, policy.id, req.user!.id);
        out.version = versionView(draft);
      }
    }
    const name = [policy.doc_number ?? policy.ref, policy.title].filter(Boolean).join(' ');
    await ctx.audit(req, {
      action: 'policy.review', recordType: 'policy', recordId: policy.id,
      summary: `${name} reviewed on ${reviewedOn} by ${by}: ${result === 'no_change' ? 'no change' : result === 'revise' ? 'to be revised' : 'to be made obsolete'}${next && result !== 'retire' ? `; next review by ${next}` : ''}`,
      after: { review_id: review.id, result, reviewed_on: reviewedOn, reviewed_by_name: by, next_review_on: out.next_review_on, version: current ? Number(current.version) : null },
    });
    if (result === 'retire') {
      const fresh = (await db.one<Row>('select * from policies where id = $1', [policy.id]))!;
      const r = await retireDocument(ctx, tables, req, fresh, { reason: b.reason ?? note ?? `Made obsolete at the review of ${reviewedOn}.`, replaced_by_id: b.replaced_by_id, retired_on: reviewedOn, load });
      out.retired = true;
      out.children = r.children;
      out.hidden_children = r.hidden_children;
    }
    reply.code(201);
    return out;
  }));
  ctx.describeRoute({
    method: 'POST', path: '/api/policies/:id/reviews', tag: T, permission: 'policies.edit',
    summary: 'Record a periodic review: no change (the next review date moves on), revise (a draft opens) or make obsolete (needs policies.approve)',
    description: 'In data load mode a past review is recorded with its own date and nothing else happens (no draft is opened).',
    body: '{ result: "no_change" | "revise" | "retire", reviewed_on?, note?, reviewed_by_name?, reason?, replaced_by_id? }',
    response: '{ review, next_review_on, version?, retired?, children?, hidden_children? }',
  });

  app.get('/api/documents/reviews', { preHandler: ctx.requirePerm('policies.edit') }, async (req) => {
    const q = req.query as Row;
    const today = localDate();
    const raw = Number(q.days);
    const days = Number.isInteger(raw) && raw >= 0 ? Math.min(raw, 3650) : 90;
    const state = ['overdue', 'due', 'all'].includes(String(q.state)) ? String(q.state) : 'all';
    const rows = await db.query<Row>(
      `select p.id, p.ref, p.doc_number, p.title, p.document_type, p.owner_id, u.display_name as owner_name, p.review_date, p.last_reviewed_on
       from policies p left join users u on u.id = p.owner_id
       where p.deleted_at is null and p.status = 'published' and p.review_date is not null
         and p.review_date <= ($1::date + $2::int) and ${ctx.resources.visibleWhere('policy', req.user, 'p')}
       order by p.review_date, p.title limit 1000`, [today, days]);
    const out = rows.map((r) => {
      const next = ymd(r.review_date)!;
      return {
        id: r.id, ref: r.ref, doc_number: r.doc_number, title: r.title, document_type: r.document_type, owner_id: r.owner_id, owner_name: r.owner_name ?? null,
        next_review_on: next, last_reviewed_on: ymd(r.last_reviewed_on), days_left: daysBetween(today, next), state: next < today ? 'overdue' : 'due',
      };
    }).filter((r) => state === 'all' || r.state === state);
    return { today, days, rows: out };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/documents/reviews', tag: T, permission: 'policies.edit',
    summary: 'Documents whose review is overdue or due within `days` (default 90), that the caller works with',
    query: { state: 'overdue | due | all', days: 'look-ahead in days' },
    response: '{ today, days, rows: [{ id, ref, doc_number, title, document_type, owner_id, owner_name, next_review_on, last_reviewed_on, days_left, state }] }',
  });
}
