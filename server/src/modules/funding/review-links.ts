// A funder compliance review connected to the rest of the compliance data (E45-10):
// - the awards it reviews (compliance_review_awards);
// - per area, the controls, obligations and documents it relies on (compliance_review_area_links), with
//   the controls' latest ratings, and evidence from the evidence library suggested from them;
// - evidence per area and per document request in the evidence library (parts 'area:<code>' and
//   'request:<id>'), and file upload by the person a request is assigned to;
// - carrying a review forward: the next review starts from the previous one's areas, answers (as
//   drafts), related records, area evidence, document requests and awards, and shows its deficiencies.
// The evidence library is optional: without it (module not loaded or area switched off) evidence counts
// are 0 and the evidence routes answer 409 `evidence_unavailable`.
import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { evidenceFromUpload } from '../evidence/files.ts';
import { copyLinks, EVIDENCE_TYPE, findTarget, stateOf } from '../evidence/links.ts';
import { defineEvidencePart } from '../evidence/parts.ts';
import { expiringDays } from '../evidence/settings.ts';
import { cleanText, flagged, idParam } from './shared.ts';

const T = 'Funding';
/** The kinds of record a review area may rely on. */
export const AREA_LINK_TYPES = ['control', 'obligation', 'policy'];

const evidenceOn = (ctx: ModuleContext) => Boolean(ctx.resources.get(EVIDENCE_TYPE));
const day = (v: unknown) => (v == null ? null : (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10));

/** Evidence links per part of a review, counted for everyone ('area:FM' -> 2). */
async function evidenceCounts(ctx: ModuleContext, reviewId: string, prefix: 'area' | 'request'): Promise<Map<string, number>> {
  if (!evidenceOn(ctx)) return new Map();
  const rows = await ctx.db.query<Row>(
    `select l.part, count(*)::int as n from evidence_links l join evidence_records e on e.id = l.evidence_id and e.deleted_at is null
     where l.record_type = 'compliance_review' and l.record_id = $1 and l.part like $2 group by l.part`, [reviewId, `${prefix}:%`]);
  return new Map(rows.map((r) => [String(r.part), Number(r.n)]));
}

/** The related records of a review's areas, as the caller may see them; the others counted. */
async function areaLinks(ctx: ModuleContext, user: SessionUser | null | undefined, reviewId: string, code?: string) {
  const links = await ctx.db.query<Row>(
    `select id, area_code, record_type, record_id::text as record_id from compliance_review_area_links where review_id = $1${code ? ' and area_code = $2' : ''} order by created_at`,
    code ? [reviewId, code] : [reviewId]);
  const shown = new Map<string, Row[]>();
  const hidden = new Map<string, number>();
  const byType = new Map<string, Row[]>();
  for (const l of links) byType.set(l.record_type, [...(byType.get(l.record_type) ?? []), l]);
  for (const [type, list] of byType) {
    const def = ctx.resources.get(type);
    if (!def) continue; // not part of this installation, or switched off
    const ids = list.map((l) => l.record_id);
    const live = new Set((await ctx.db.query<Row>(`select id::text as id from ${def.table} where id = any($1::uuid[]) and deleted_at is null`, [ids])).map((r) => r.id));
    const may = ctx.can(user ?? null, `${def.module}.view`) && !(def.restricted === true && !ctx.can(user ?? null, 'security.view'));
    const rows = may ? await ctx.db.query<Row>(
      `select * from ${def.table} where id = any($1::uuid[]) and deleted_at is null and ${ctx.resources.visibleWhere(type, user)}`, [ids]) : [];
    const byId = new Map(rows.map((r) => [String(r.id), r]));
    for (const l of list) {
      if (!live.has(l.record_id)) continue;
      const r = byId.get(l.record_id);
      if (!r) { hidden.set(l.area_code, (hidden.get(l.area_code) ?? 0) + 1); continue; }
      const item: Row = {
        id: l.id, record_type: type, type_label: def.label, record_id: l.record_id, ref: def.ref ? r[def.ref.field] ?? null : null,
        title: r[def.titleField] ?? def.label, route: `${def.route}/${l.record_id}`, status: r.status ?? null,
      };
      if (type === 'control') Object.assign(item, { operating_rating: r.operating_rating ?? null, design_rating: r.design_rating ?? null, last_tested_on: day(r.last_tested_on) });
      if (type === 'obligation') Object.assign(item, { next_due_on: day(r.next_due_on) });
      shown.set(l.area_code, [...(shown.get(l.area_code) ?? []), item]);
    }
  }
  return { shown, hidden };
}

/** The extra facts of a review's areas: related records and evidence counts. */
export async function areaExtras(ctx: ModuleContext, req: FastifyRequest, review: Row, areas: Row[]): Promise<Row[]> {
  const { shown, hidden } = await areaLinks(ctx, req.user, review.id);
  const evidence = await evidenceCounts(ctx, review.id, 'area');
  return areas.map((a) => ({
    ...a, links: shown.get(a.area_code) ?? [], links_hidden: hidden.get(a.area_code) ?? 0, evidence: evidence.get(`area:${a.area_code}`) ?? 0,
  }));
}

/** Document requests with how many evidence records answer each. */
export async function requestExtras(ctx: ModuleContext, review: Row, rows: Row[]): Promise<Row[]> {
  const evidence = await evidenceCounts(ctx, review.id, 'request');
  return rows.map((r) => ({ ...r, evidence: evidence.get(`request:${r.id}`) ?? 0 }));
}

export function registerReviewLinks(ctx: ModuleContext) {
  const { app, db } = ctx;
  const view = ctx.requirePerm('funding.view');
  const edit = ctx.requirePerm('funding.edit');
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  const closedStatuses = () => flagged(ctx, 'compliance_review_status', 'closed', ['closed']);

  async function needReview(req: FastifyRequest, param = 'id'): Promise<Row> {
    return (await ctx.resources.find('compliance_review', idParam(ctx, req, param), req.user)) ?? ctx.fail(404, 'not_found', 'Compliance review not found.');
  }
  async function openOnly(review: Row) {
    if ((await closedStatuses()).includes(review.status)) ctx.fail(409, 'closed', 'This review is closed. Reopen it to change it.');
  }
  async function needArea(review: Row, code: string): Promise<Row> {
    return (await db.one<Row>('select * from compliance_review_areas where review_id = $1 and area_code = $2', [review.id, code]))
      ?? ctx.fail(404, 'not_found', 'This review has no such area.');
  }
  const needEvidence = () => { if (!evidenceOn(ctx)) ctx.fail(409, 'evidence_unavailable', 'The evidence library is not part of this installation.'); };

  // ---------- evidence parts: areas and document requests ----------

  defineEvidencePart(app, {
    recordType: 'compliance_review', prefix: 'area', label: 'Review area',
    describe: async (q, recordId, key) => {
      const a = await q.one<Row>('select area_code, title from compliance_review_areas where review_id = $1 and area_code = $2', [recordId, key]);
      return a ? `${a.area_code} ${a.title}` : null;
    },
    names: async (q, recordId) => new Map((await q.query<Row>('select area_code, title from compliance_review_areas where review_id = $1', [recordId]))
      .map((a) => [String(a.area_code), `${a.area_code} ${a.title}`])),
  });
  defineEvidencePart(app, {
    recordType: 'compliance_review', prefix: 'request', label: 'Document request',
    describe: async (q, recordId, key) => {
      if (!UUID_RE.test(key)) return null;
      const r = await q.one<Row>('select request from compliance_review_requests where id = $1 and review_id = $2', [key, recordId]);
      return r ? String(r.request).slice(0, 120) : null;
    },
    names: async (q, recordId) => new Map((await q.query<Row>('select id::text as id, request from compliance_review_requests where review_id = $1', [recordId]))
      .map((r) => [String(r.id), String(r.request).slice(0, 120)])),
    // The person a request is assigned to answers it with evidence, while the review is open.
    mayLink: async (req, recordId, key) => {
      if (!UUID_RE.test(key) || !ctx.can(req.user, 'funding.view')) return false;
      const r = await db.one<Row>(
        `select q.owner_id, v.status from compliance_review_requests q join compliance_reviews v on v.id = q.review_id where q.id = $1 and q.review_id = $2`, [key, recordId]);
      return Boolean(r && r.owner_id === req.user!.id && !(await closedStatuses()).includes(r.status));
    },
  });

  // ---------- awards under review ----------

  async function reviewAwards(user: SessionUser | null | undefined, reviewId: string) {
    return db.query<Row>(
      `select a.id, a.ref, a.title, a.funder_name, a.status, a.period_start::text as period_start, a.period_end::text as period_end
       from compliance_review_awards x join funding_awards a on a.id = x.award_id
       where x.review_id = $1 and a.deleted_at is null and ${ctx.resources.visibleWhere('funding_award', user, 'a')} order by a.ref`, [reviewId]);
  }

  app.get('/api/compliance-reviews/:id/awards', { preHandler: view }, async (req) => reviewAwards(req.user, (await needReview(req)).id));
  ctx.describeRoute({
    method: 'GET', path: '/api/compliance-reviews/:id/awards', tag: T, permission: 'funding.view',
    summary: 'The funding awards a compliance review covers', response: '[{ id, ref, title, funder_name, status, period_start, period_end }]',
  });

  app.put('/api/compliance-reviews/:id/awards', { preHandler: edit }, async (req) => {
    const review = await needReview(req);
    await openOnly(review);
    const ids = (req.body as Row | undefined)?.award_ids;
    if (!Array.isArray(ids) || ids.length > 200 || ids.some((x) => typeof x !== 'string' || !UUID_RE.test(x))) invalid({ award_ids: 'Give a list of awards.' });
    const wanted = [...new Set(ids as string[])];
    for (const id of wanted) if (!(await ctx.resources.find('funding_award', id, req.user))) invalid({ award_ids: 'Choose awards from the list.' });
    const before = (await db.query<Row>('select award_id::text as id from compliance_review_awards where review_id = $1', [review.id])).map((r) => r.id);
    await db.query('delete from compliance_review_awards where review_id = $1 and not (award_id = any($2::uuid[]))', [review.id, wanted]);
    for (const id of wanted) {
      await db.query('insert into compliance_review_awards (review_id, award_id, created_by) values ($1,$2,$3) on conflict do nothing', [review.id, id, req.user!.id]);
    }
    const added = wanted.filter((x) => !before.includes(x));
    const removed = before.filter((x) => !wanted.includes(x));
    if (added.length || removed.length) {
      await ctx.audit(req, {
        action: 'compliance_review.awards', recordType: 'compliance_review', recordId: review.id,
        summary: `Awards under review on ${review.ref}: ${added.length} added, ${removed.length} removed`, before: { award_ids: before }, after: { award_ids: wanted },
      });
    }
    return reviewAwards(req.user, review.id);
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/compliance-reviews/:id/awards', tag: T, permission: 'funding.edit',
    summary: 'Set the funding awards a compliance review covers', body: '{ award_ids: [uuid] }', response: 'the awards, as GET answers them',
  });

  app.get('/api/funding-awards/:id/reviews', { preHandler: view }, async (req) => {
    const award = await ctx.resources.find('funding_award', idParam(ctx, req), req.user) ?? ctx.fail(404, 'not_found', 'Funding award not found.');
    return db.query<Row>(
      `select r.id, r.ref, r.title, r.status, r.site_visit_on::text as site_visit_on, r.period,
              (select count(*)::int from review_deficiencies d where d.review_id = r.id and d.deleted_at is null) as deficiencies
       from compliance_review_awards x join compliance_reviews r on r.id = x.review_id
       where x.award_id = $1 and r.deleted_at is null and ${ctx.resources.visibleWhere('compliance_review', req.user, 'r')}
       order by r.site_visit_on desc nulls last, r.ref desc`, [award.id]);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/funding-awards/:id/reviews', tag: T, permission: 'funding.view',
    summary: 'The compliance reviews that cover an award', response: '[{ id, ref, title, status, site_visit_on, period, deficiencies }]',
  });

  // ---------- what an area relies on ----------

  app.post('/api/compliance-reviews/:id/areas/:code/links', { preHandler: edit }, async (req, reply) => {
    const review = await needReview(req);
    await openOnly(review);
    const area = await needArea(review, String((req.params as Row).code ?? ''));
    const b = (req.body ?? {}) as Row;
    if (!AREA_LINK_TYPES.includes(String(b.record_type))) invalid({ record_type: 'Choose a control, an obligation or a document.' });
    const target = await findTarget(ctx, req.user, b.record_type, b.record_id) ?? invalid({ record_id: 'Choose a record you can see.' });
    const row = await db.one<Row>(
      `insert into compliance_review_area_links (review_id, area_code, record_type, record_id, created_by) values ($1,$2,$3,$4,$5)
       on conflict (review_id, area_code, record_type, record_id) do nothing returning *`, [review.id, area.area_code, target.def.type, target.row.id, req.user!.id]);
    if (row) {
      await ctx.audit(req, {
        action: 'compliance_review.area_link', recordType: 'compliance_review', recordId: review.id,
        summary: `Area ${area.area_code} of ${review.ref} relies on ${target.def.label.toLowerCase()} ${[target.ref, target.label].filter(Boolean).join(' ')}`,
        after: { area: area.area_code, record_type: target.def.type, record_id: target.row.id },
      });
    }
    reply.code(row ? 201 : 200);
    return (await areaLinks(ctx, req.user, review.id, area.area_code)).shown.get(area.area_code) ?? [];
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/compliance-reviews/:id/areas/:code/links', tag: T, permission: 'funding.edit',
    summary: 'Record that a review area relies on a control, an obligation or a document (also needs view permission on it)',
    body: '{ record_type: "control" | "obligation" | "policy", record_id }', response: 'the area\'s related records',
  });

  app.delete('/api/compliance-reviews/:id/areas/:code/links/:lid', { preHandler: edit }, async (req) => {
    const review = await needReview(req);
    await openOnly(review);
    const link = await db.one<Row>('select * from compliance_review_area_links where id = $1 and review_id = $2 and area_code = $3',
      [idParam(ctx, req, 'lid'), review.id, String((req.params as Row).code ?? '')]);
    if (!link || !(await findTarget(ctx, req.user, link.record_type, String(link.record_id)))) ctx.fail(404, 'not_found', 'Link not found.');
    await db.query('delete from compliance_review_area_links where id = $1', [link!.id]);
    await ctx.audit(req, {
      action: 'compliance_review.area_unlink', recordType: 'compliance_review', recordId: review.id,
      summary: `Area ${link!.area_code} of ${review.ref} no longer relies on a ${link!.record_type}`, before: { area: link!.area_code, record_type: link!.record_type, record_id: link!.record_id },
    });
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'DELETE', path: '/api/compliance-reviews/:id/areas/:code/links/:lid', tag: T, permission: 'funding.edit',
    summary: 'Remove a related control, obligation or document from a review area', response: '{ ok }',
  });

  // Evidence already used by the area's related records, not yet used by the area: one click to reuse.
  app.get('/api/compliance-reviews/:id/areas/:code/suggested-evidence', { preHandler: view }, async (req) => {
    const review = await needReview(req);
    const area = await needArea(review, String((req.params as Row).code ?? ''));
    if (!evidenceOn(ctx) || !ctx.can(req.user, 'evidence.view')) return { rows: [], available: evidenceOn(ctx) };
    const related = (await areaLinks(ctx, req.user, review.id, area.area_code)).shown.get(area.area_code) ?? [];
    if (!related.length) return { rows: [], available: true };
    const found = await db.query<Row>(
      `select e.id, e.ref, e.title, e.valid_until, l.record_type, l.record_id::text as record_id
       from evidence_links l join evidence_records e on e.id = l.evidence_id and e.deleted_at is null
       where l.part = '' and (l.record_type, l.record_id::text) in (select * from unnest($1::text[], $2::text[]))
         and ${ctx.resources.visibleWhere(EVIDENCE_TYPE, req.user, 'e')}
         and not exists (select 1 from evidence_links x where x.evidence_id = e.id and x.record_type = 'compliance_review' and x.record_id = $3 and x.part = $4)
       order by lower(e.title)`,
      [related.map((r) => r.record_type), related.map((r) => r.record_id), review.id, `area:${area.area_code}`]);
    const today = todayInZone();
    const window = await expiringDays(ctx);
    const byId = new Map<string, Row>();
    for (const f of found) {
      const via = related.find((r) => r.record_type === f.record_type && r.record_id === f.record_id);
      const row = byId.get(f.id) ?? { id: f.id, ref: f.ref, title: f.title, valid_until: day(f.valid_until), state: stateOf(f.valid_until, today, window), via: [] as Row[] };
      if (via) row.via.push({ type_label: via.type_label, ref: via.ref, title: via.title });
      byId.set(f.id, row);
    }
    return { rows: [...byId.values()], available: true };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/compliance-reviews/:id/areas/:code/suggested-evidence', tag: T, permission: 'funding.view',
    summary: 'Evidence the area\'s related controls, obligations and documents already use, that the area does not use yet',
    response: '{ available, rows: [{ id, ref, title, valid_until, state, via: [{ type_label, ref, title }] }] }',
  });

  // ---------- a document request answered with a file ----------

  app.post('/api/compliance-reviews/:id/requests/:rid/files', { preHandler: view }, async (req, reply) => {
    const review = await needReview(req);
    await openOnly(review);
    needEvidence();
    const request = await db.one<Row>('select * from compliance_review_requests where id = $1 and review_id = $2', [idParam(ctx, req, 'rid'), review.id])
      ?? ctx.fail(404, 'not_found', 'Request not found.');
    if (!ctx.can(req.user, 'funding.edit') && request.owner_id !== req.user!.id) {
      ctx.fail(403, 'forbidden', 'Only the person this request is assigned to, or someone who may edit funding records, can answer it.');
    }
    const b = (req.body ?? {}) as Row;
    const target = { def: ctx.resources.get('compliance_review')!, row: review, label: review.title, ref: review.ref ?? null };
    const title = cleanText(b.title, 200) ?? `${String(request.request).slice(0, 150)} (${review.ref})`;
    const out = await evidenceFromUpload(ctx, req, String(b.upload_id ?? ''), {
      title, description: cleanText(b.description, 4000) ?? `Provided for ${review.ref} ${review.title}: ${request.request}`,
      valid_until: b.valid_until || null, owner_id: req.user!.id,
    }, { target, part: `request:${request.id}`, relation: 'responds' });
    if (request.status === 'open') {
      await db.query(`update compliance_review_requests set status = 'provided', updated_at = now(), updated_by = $2 where id = $1`, [request.id, req.user!.id]);
      await ctx.audit(req, {
        action: 'compliance_review.request_update', recordType: 'compliance_review', recordId: review.id,
        summary: `Request answered with a file on ${review.ref}: ${String(request.request).slice(0, 120)}`, before: { status: 'open' }, after: { status: 'provided' },
      });
    }
    reply.code(201);
    return { evidence_id: out.evidence.id, ref: out.evidence.ref, attachment_id: out.attachment_id, link_id: out.link_id, status: request.status === 'open' ? 'provided' : request.status };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/compliance-reviews/:id/requests/:rid/files', tag: T, permission: 'funding.view',
    summary: 'Answer a document request with a file: it is filed in the evidence library and linked to the request (an open request becomes provided)',
    description: 'For the person the request is assigned to, or anyone with funding.edit. Upload the file first with /api/attachments/uploads (start, parts, finish). 409 `evidence_unavailable` when the evidence library is not part of this installation.',
    body: '{ upload_id, title?, description?, valid_until? }', response: '{ evidence_id, ref, attachment_id, link_id, status }',
  });

  // ---------- carrying a review forward ----------

  async function carryForward(req: FastifyRequest, from: Row, to: Row) {
    const userId = req.user!.id;
    const out = { areas_added: 0, areas_filled: 0, related: 0, evidence: 0, requests: 0, awards: 0 };
    await db.query(
      `update compliance_reviews set previous_review_id = $2, set_id = coalesce(set_id, $3), funder_id = coalesce(funder_id, $4), funder_name = coalesce(funder_name, $5)
       where id = $1`, [to.id, from.id, from.set_id ?? null, from.funder_id ?? null, from.funder_name ?? null]);
    // Areas: new ones copied with their answers as drafts; existing ones still blank take the old answers.
    const fromAreas = await db.query<Row>('select * from compliance_review_areas where review_id = $1 order by sort, area_code', [from.id]);
    for (const a of fromAreas) {
      const existing = await db.one<Row>('select * from compliance_review_areas where review_id = $1 and area_code = $2', [to.id, a.area_code]);
      if (!existing) {
        await db.query(
          `insert into compliance_review_areas (review_id, area_code, title, description, questions, self_assessment, answers, owner_id, notes, sort, created_by, updated_by)
           values ($1,$2,$3,$4,$5::jsonb,'not_assessed',$6::jsonb,$7,$8,$9,$10,$10)`,
          [to.id, a.area_code, a.title, a.description, JSON.stringify(a.questions ?? []), JSON.stringify(a.answers ?? []), a.owner_id, a.notes, a.sort, userId]);
        out.areas_added++;
      } else if (!(existing.answers ?? []).some((x: string) => x && String(x).trim()) && !existing.notes) {
        await db.query(`update compliance_review_areas set answers = $2::jsonb, notes = $3, owner_id = coalesce(owner_id, $4), updated_at = now(), updated_by = $5 where id = $1`,
          [existing.id, JSON.stringify(a.answers ?? []), a.notes, a.owner_id, userId]);
        out.areas_filled++;
      }
    }
    out.related = (await db.query<Row>(
      `insert into compliance_review_area_links (review_id, area_code, record_type, record_id, created_by)
       select $2, l.area_code, l.record_type, l.record_id, $3 from compliance_review_area_links l
       where l.review_id = $1 and exists (select 1 from compliance_review_areas a where a.review_id = $2 and a.area_code = l.area_code)
       on conflict do nothing returning id`, [from.id, to.id, userId])).length;
    // The same evidence records serve the new review's areas: nothing is uploaded again.
    for (const a of fromAreas) {
      out.evidence += await copyLinks(ctx, { type: 'compliance_review', id: from.id, part: `area:${a.area_code}` }, { type: 'compliance_review', id: to.id, part: `area:${a.area_code}` }, userId);
    }
    // Document requests come back open, assigned to the same people, without due dates or responses.
    out.requests = (await db.query<Row>(
      `insert into compliance_review_requests (review_id, area_code, request, owner_id, status, created_by, updated_by)
       select $2, case when exists (select 1 from compliance_review_areas a where a.review_id = $2 and a.area_code = q.area_code) then q.area_code end,
              q.request, q.owner_id, 'open', $3, $3
       from compliance_review_requests q
       where q.review_id = $1 and not exists (select 1 from compliance_review_requests x where x.review_id = $2 and lower(x.request) = lower(q.request))
       order by q.created_at returning id`, [from.id, to.id, userId])).length;
    out.awards = (await db.query<Row>(
      `insert into compliance_review_awards (review_id, award_id, created_by) select $2, award_id, $3 from compliance_review_awards where review_id = $1
       on conflict do nothing returning award_id`, [from.id, to.id, userId])).length;
    await ctx.audit(req, {
      action: 'compliance_review.carry_forward', recordType: 'compliance_review', recordId: to.id,
      summary: `Carried forward from ${from.ref}: ${out.areas_added} areas added, ${out.areas_filled} filled, ${out.requests} requests, ${out.evidence} evidence links`,
      after: { from: from.id, ...out },
    });
    return out;
  }

  async function sourceReview(req: FastifyRequest, to: Row): Promise<Row> {
    const id = String(((req.body ?? {}) as Row).from_review_id ?? '');
    const from = UUID_RE.test(id) ? await ctx.resources.find('compliance_review', id, req.user) : undefined;
    if (!from) invalid({ from_review_id: 'Choose an earlier compliance review.' });
    if (from!.id === to.id) invalid({ from_review_id: 'Choose another review than this one.' });
    return from!;
  }

  app.post('/api/compliance-reviews/:id/carry-forward', { preHandler: edit }, async (req) => {
    const to = await needReview(req);
    await openOnly(to);
    const from = await sourceReview(req, to);
    return carryForward(req, from, to);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/compliance-reviews/:id/carry-forward', tag: T, permission: 'funding.edit',
    summary: 'Start this review from an earlier one: its areas (answers as drafts, self-assessments to do again), related records, area evidence, document requests (open again) and awards',
    description: 'Areas this review already has keep their answers, unless they are still blank. Requests with the same wording are not copied twice. Deficiencies are not copied: GET /previous lists the earlier review\'s.',
    body: '{ from_review_id }', response: '{ areas_added, areas_filled, related, evidence, requests, awards }',
  });

  app.post('/api/compliance-reviews/:id/next', { preHandler: ctx.requirePerm('funding.create') }, async (req, reply) => {
    const from = await needReview(req);
    const b = (req.body ?? {}) as Row;
    const created = await ctx.resources.create('compliance_review', {
      title: cleanText(b.title, 200) ?? `${String(from.title).slice(0, 180)} (next review)`,
      funder_id: from.funder_id ?? null, funder_name: from.funder_name ?? null,
      period: cleanText(b.period, 200), site_visit_on: b.site_visit_on || null, lead_id: from.lead_id ?? null, status: 'preparing',
    }, req);
    const counts = await carryForward(req, from, created);
    reply.code(201);
    return { id: created.id, ref: created.ref, ...counts };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/compliance-reviews/:id/next', tag: T, permission: 'funding.create',
    summary: 'Start the next review of the same funder from this one (a new review, carried forward)',
    body: '{ title?, period?, site_visit_on? }', response: '{ id, ref, areas_added, areas_filled, related, evidence, requests, awards }',
  });

  app.get('/api/compliance-reviews/:id/previous', { preHandler: view }, async (req) => {
    const review = await needReview(req);
    const prev = review.previous_review_id ? await ctx.resources.find('compliance_review', String(review.previous_review_id), req.user) : undefined;
    if (!prev) return { review: null, deficiencies: [] };
    const deficiencies = await db.query<Row>(
      `select d.id, d.ref, d.title, d.area_code, d.status, d.closed_on::text as closed_on, d.cap_id from review_deficiencies d
       where d.review_id = $1 and d.deleted_at is null and ${ctx.resources.visibleWhere('review_deficiency', req.user, 'd')} order by d.ref`, [prev.id]);
    return { review: { id: prev.id, ref: prev.ref, title: prev.title, status: prev.status, closed_on: day(prev.closed_on) }, deficiencies };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/compliance-reviews/:id/previous', tag: T, permission: 'funding.view',
    summary: 'The review this one was carried forward from, with its deficiencies and how they were closed',
    response: '{ review: { id, ref, title, status, closed_on } | null, deficiencies: [{ id, ref, title, area_code, status, closed_on, cap_id }] }',
  });
}
