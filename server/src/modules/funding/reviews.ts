import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { activeUser, cleanText, flagged, idParam, validDate } from './shared.ts';

/**
 * Funder compliance reviews (E27-06, E27-07). Review areas are the organization's own: a set is
 * loaded from a JSON file (format below and in the user guide), never built in. A review copies
 * the areas of a set, and each area gets a self-assessment, answers to its questions, an owner
 * and notes. Document requests track what the funder asked for. Deficiencies the funder finds
 * are records of their own (`review_deficiency`, DEF-) that raise corrective action plans
 * (contract C1); a review cannot close while a deficiency is open, and a deficiency with a plan
 * cannot close before the plan does.
 *
 * File format: { "name", "version"?, "description"?, "areas": [{ "code", "title", "description"?,
 * "questions"?: [string] }] }. Loading the same name and version again updates titles and
 * questions and adds new areas; it never removes an area (reviews keep their own copy anyway).
 */

const here = dirname(fileURLToPath(import.meta.url));
export const SAMPLE_FILE = 'review-areas.sample.json';
export const readSampleAreas = (): unknown => JSON.parse(readFileSync(join(here, SAMPLE_FILE), 'utf8'));

const CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$/;
const MAX_AREAS = 200;
const MAX_QUESTIONS = 100;
const MAX_ERRORS = 40;
const text = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');

export interface AreaSetFile {
  name: string;
  version: string;
  description: string | null;
  areas: { code: string; title: string; description: string | null; questions: string[] }[];
}

/** Checks a parsed review area file. A cleaned copy, or the problems in plain words. */
export function validateAreaSet(input: unknown): { set?: AreaSetFile; errors: string[] } {
  const errors: string[] = [];
  const say = (m: string) => { if (errors.length < MAX_ERRORS) errors.push(m); };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { errors: ['The file must hold one JSON object with a "name" and a list of "areas".'] };
  const src = input as Row;
  const name = text(src.name);
  if (!name) say('"name" is missing: name the set of review areas, for example "Funder review areas 2027".');
  else if (name.length > 200) say('"name" is longer than 200 characters.');
  const version = text(src.version);
  if (version.length > 40) say('"version" is longer than 40 characters.');
  if (!Array.isArray(src.areas) || !src.areas.length) {
    say('"areas" must be a list with at least one area.');
    return { errors };
  }
  if (src.areas.length > MAX_AREAS) say(`The file holds ${src.areas.length} areas; the most is ${MAX_AREAS}.`);
  const codes = new Set<string>();
  const areas = (src.areas as Row[]).map((a, i) => {
    const at = `Area ${i + 1}`;
    const code = text(a?.code);
    const title = text(a?.title);
    if (!code) say(`${at}: an area needs a "code".`);
    else if (!CODE.test(code)) say(`${at}: the code "${code.slice(0, 30)}" may hold only letters, digits, dots, hyphens and underscores (up to 30).`);
    else if (codes.has(code.toLowerCase())) say(`Area code ${code} is used more than once.`);
    codes.add(code.toLowerCase());
    if (!title) say(`${code || at}: an area needs a "title".`);
    if (a?.questions !== undefined && !Array.isArray(a.questions)) say(`${code || at}: "questions" must be a list of questions.`);
    const questions = (Array.isArray(a?.questions) ? a.questions : []).map(text).filter(Boolean);
    if (questions.length > MAX_QUESTIONS) say(`${code || at}: at most ${MAX_QUESTIONS} questions.`);
    if (questions.some((q: string) => q.length > 2000)) say(`${code || at}: a question is longer than 2,000 characters.`);
    return { code, title: title.slice(0, 200), description: text(a?.description).slice(0, 4000) || null, questions };
  });
  if (errors.length) return { errors };
  return { errors, set: { name, version, description: text(src.description).slice(0, 4000) || null, areas } };
}

export interface AreaImportResult {
  set_id: string | null; name: string; version: string; created: boolean; dry_run: boolean;
  areas: { total: number; added: number; updated: number; unchanged: number };
  not_in_file: string[];
}

/** Loads (or with `dryRun` only measures) a checked review area file. */
export async function applyAreaSet(ctx: ModuleContext, set: AreaSetFile, req: FastifyRequest | null, opts: { dryRun?: boolean; sourceFile?: string | null } = {}): Promise<AreaImportResult> {
  const { db } = ctx;
  let row = await db.one<Row>('select * from review_area_sets where lower(name) = lower($1) and version = $2', [set.name, set.version]);
  const existing = row
    ? new Map((await db.query<Row>('select * from review_area_templates where set_id = $1', [row.id])).map((t) => [String(t.code).toLowerCase(), t]))
    : new Map<string, Row>();
  const differs = (a: AreaSetFile['areas'][number], t: Row, sort: number) => t.title !== a.title || (t.description ?? null) !== a.description
    || JSON.stringify(t.questions ?? []) !== JSON.stringify(a.questions) || Number(t.sort) !== sort;
  const added = set.areas.filter((a) => !existing.has(a.code.toLowerCase()));
  const updated = set.areas.filter((a, i) => existing.has(a.code.toLowerCase()) && differs(a, existing.get(a.code.toLowerCase())!, (i + 1) * 10));
  const inFile = new Set(set.areas.map((a) => a.code.toLowerCase()));
  const result: AreaImportResult = {
    set_id: row?.id ?? null, name: set.name, version: set.version, created: !row, dry_run: Boolean(opts.dryRun),
    areas: { total: set.areas.length, added: added.length, updated: updated.length, unchanged: set.areas.length - added.length - updated.length },
    not_in_file: [...existing.values()].filter((t) => !inFile.has(String(t.code).toLowerCase())).map((t) => t.code).sort(),
  };
  if (opts.dryRun) return result;
  const userId = req?.user?.id ?? null;
  await db.tx(async (tx) => {
    if (!row) {
      row = (await tx.one<Row>(
        `insert into review_area_sets (name, version, description, source_file, created_by, updated_by) values ($1,$2,$3,$4,$5,$5) returning *`,
        [set.name, set.version, set.description, opts.sourceFile ?? null, userId]))!;
    } else {
      await tx.query('update review_area_sets set description = $2, source_file = coalesce($3, source_file), updated_at = now(), updated_by = $4 where id = $1',
        [row.id, set.description, opts.sourceFile ?? null, userId]);
    }
    for (const [i, a] of set.areas.entries()) {
      await tx.query(
        `insert into review_area_templates (set_id, code, title, description, questions, sort) values ($1,$2,$3,$4,$5::jsonb,$6)
         on conflict (set_id, code) do update set title = excluded.title, description = excluded.description, questions = excluded.questions, sort = excluded.sort`,
        [row!.id, existing.get(a.code.toLowerCase())?.code ?? a.code, a.title, a.description, JSON.stringify(a.questions), (i + 1) * 10]);
    }
  });
  result.set_id = row!.id;
  await ctx.audit(req, {
    action: 'review_area_set.import', recordType: 'review_area_set', recordId: row!.id,
    summary: `Review areas "${set.name}"${set.version ? ` ${set.version}` : ''} loaded: ${added.length} added, ${updated.length} updated`,
    after: { name: set.name, version: set.version, areas: result.areas, source_file: opts.sourceFile ?? null },
  });
  return result;
}

/** Copies a set's areas into a review (areas the review already has are kept as they are). */
export async function loadAreas(ctx: ModuleContext, review: Row, setId: string, userId: string | null): Promise<number> {
  const added = await ctx.db.query<Row>(
    `insert into compliance_review_areas (review_id, area_code, title, description, questions, sort, created_by, updated_by)
     select $1, t.code, t.title, t.description, t.questions, t.sort, $3, $3 from review_area_templates t where t.set_id = $2
     on conflict (review_id, area_code) do nothing returning id`, [review.id, setId, userId]);
  if (review.set_id !== setId) await ctx.db.query('update compliance_reviews set set_id = $2 where id = $1', [review.id, setId]);
  return added.length;
}

export function registerReviews(ctx: ModuleContext) {
  const { db, app } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  const view = ctx.requirePerm('funding.view');
  const edit = ctx.requirePerm('funding.edit');
  const admin = ctx.requirePerm('funding.administer');
  const closedReview = () => flagged(ctx, 'compliance_review_status', 'closed', ['closed']);
  const closedDeficiency = () => flagged(ctx, 'review_deficiency_status', 'closed', ['closed']);

  // ---------- review area sets ----------

  app.post('/api/funding/review-area-sets/import', { preHandler: admin }, async (req, reply) => {
    const body = (req.body ?? {}) as Row;
    const wrapped = body && typeof body === 'object' && 'file' in body;
    const dryRun = wrapped && (body.dryRun === true || body.dry_run === true);
    const { set, errors } = validateAreaSet(wrapped ? body.file : body);
    if (!set) {
      return reply.code(400).send({ error: { code: 'validation', message: 'The file cannot be loaded as it stands.', fields: { file: errors.join('\n') }, problems: errors } });
    }
    const result = await applyAreaSet(ctx, set, req, { dryRun, sourceFile: wrapped ? cleanText(body.source_file, 200) : null });
    reply.code(dryRun || !result.created ? 200 : 201);
    return result;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/funding/review-area-sets/import', tag: 'Funding', permission: 'funding.administer',
    summary: 'Load a set of funder review areas from a file (the file itself, or { file, dryRun, source_file } to check it first)',
    description: 'File format: { "name": string, "version"?: string, "description"?: string, "areas": [{ "code": string, "title": string, "description"?: string, "questions"?: [string] }] }. Loading the same name and version again updates the areas and adds new ones; none is removed.',
    body: '{ name, version?, description?, areas: [{ code, title, description?, questions? }] } | { file, dryRun?, source_file? }',
    response: '{ set_id, name, version, created, dry_run, areas: { total, added, updated, unchanged }, not_in_file }',
  });

  app.get('/api/funding/review-area-sets', { preHandler: view }, async () => db.query<Row>(
    `select s.id, s.name, s.version, s.description, s.source_file, s.updated_at,
            (select count(*)::int from review_area_templates t where t.set_id = s.id) as areas,
            (select count(*)::int from compliance_reviews r where r.set_id = s.id and r.deleted_at is null) as reviews
     from review_area_sets s order by lower(s.name), s.version`));
  ctx.describeRoute({
    method: 'GET', path: '/api/funding/review-area-sets', tag: 'Funding', permission: 'funding.view',
    summary: 'The sets of review areas loaded, with how many areas and reviews each has',
    response: '[{ id, name, version, description, source_file, updated_at, areas, reviews }]',
  });

  app.get('/api/funding/review-area-sets/sample', { preHandler: admin }, async () => readSampleAreas());
  ctx.describeRoute({
    method: 'GET', path: '/api/funding/review-area-sets/sample', tag: 'Funding', permission: 'funding.administer',
    summary: 'The invented sample file of review areas that ships with the application, in the file format to load', response: 'a review area file',
  });

  app.get('/api/funding/review-area-sets/:id', { preHandler: view }, async (req) => {
    const set = await db.one<Row>('select * from review_area_sets where id = $1', [idParam(ctx, req)]);
    if (!set) ctx.fail(404, 'not_found', 'Set of review areas not found.');
    const areas = await db.query<Row>('select code, title, description, questions from review_area_templates where set_id = $1 order by sort, code', [set!.id]);
    return { ...set, areas };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/funding/review-area-sets/:id', tag: 'Funding', permission: 'funding.view',
    summary: 'One set of review areas with its areas and questions', response: '{ id, name, version, description, source_file, areas: [{ code, title, description, questions }] }',
  });

  // ---------- reviews ----------

  async function openDeficiencies(reviewId: string): Promise<number> {
    return Number((await db.one<Row>(
      `select count(*)::int as n from review_deficiencies where review_id = $1 and deleted_at is null and not (coalesce(status, '') = any($2::text[]))`,
      [reviewId, await closedDeficiency()]))!.n);
  }

  ctx.defineResource({
    type: 'compliance_review', table: 'compliance_reviews', module: 'funding', label: 'Compliance review', plural: 'Compliance reviews',
    path: '/api/compliance-reviews', route: '/funding/reviews', titleField: 'title',
    ref: { field: 'ref', prefix: 'CRV-' },
    searchable: ['title', 'funder_name', 'period', 'notes'],
    defaultSort: { field: 'site_visit_on', dir: 'desc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Review', type: 'text', required: true },
      funder_name: { label: 'Funder', type: 'text', personal: false },
      period: { label: 'Period reviewed', type: 'text' },
      site_visit_on: { label: 'Site visit', type: 'date' },
      lead_id: { label: 'Review lead', type: 'user' },
      status: { label: 'Status', type: 'lookup', list: 'compliance_review_status', default: 'preparing' },
      closed_on: { label: 'Closed on', type: 'date', readOnly: true },
      notes: { label: 'Notes', type: 'longtext', personal: false },
    },
    hooks: {
      beforeUpdate: async (_req, existing, patch) => {
        if ('status' in patch && patch.status !== existing.status) {
          const closed = await closedReview();
          if (closed.includes(patch.status)) {
            const open = await openDeficiencies(existing.id);
            if (open) invalid({ status: `${open} deficienc${open === 1 ? 'y is' : 'ies are'} still open. Close ${open === 1 ? 'it' : 'them'} before closing the review.` });
            patch.closed_on = todayInZone();
          } else if (closed.includes(existing.status)) {
            patch.closed_on = null;
          }
        }
        return patch;
      },
    },
  });

  async function needReview(req: FastifyRequest): Promise<Row> {
    return (await ctx.resources.find('compliance_review', idParam(ctx, req), req.user)) ?? ctx.fail(404, 'not_found', 'Compliance review not found.');
  }
  const openOnly = async (review: Row) => {
    if ((await closedReview()).includes(review.status)) ctx.fail(409, 'closed', 'This review is closed. Reopen it to change it.');
  };

  app.post('/api/compliance-reviews/:id/areas/load', { preHandler: edit }, async (req) => {
    const review = await needReview(req);
    await openOnly(review);
    const setId = String(((req.body ?? {}) as Row).set_id ?? review.set_id ?? '');
    if (!UUID_RE.test(setId) || !(await db.one('select 1 from review_area_sets where id = $1', [setId]))) {
      invalid({ set_id: 'Choose a set of review areas (load one under Funding > Review areas first).' });
    }
    const added = await loadAreas(ctx, review, setId, req.user!.id);
    await ctx.audit(req, {
      action: 'compliance_review.areas_load', recordType: 'compliance_review', recordId: review.id,
      summary: `${added} review area${added === 1 ? '' : 's'} added to ${review.ref}`, after: { set_id: setId, added },
    });
    return { added };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/compliance-reviews/:id/areas/load', tag: 'Funding', permission: 'funding.edit',
    summary: 'Copy the areas of a set into a review (areas already there are kept)', body: '{ set_id: uuid }', response: '{ added }',
  });

  app.get('/api/compliance-reviews/:id/areas', { preHandler: view }, async (req) => {
    const review = await needReview(req);
    const areas = await db.query<Row>(
      `select a.*, u.display_name as owner_name,
              (select count(*)::int from review_deficiencies d where d.review_id = a.review_id and d.area_code = a.area_code and d.deleted_at is null) as deficiencies
       from compliance_review_areas a left join users u on u.id = a.owner_id
       where a.review_id = $1 order by a.sort, a.area_code`, [review.id]);
    const set = review.set_id ? await db.one<Row>('select id, name, version from review_area_sets where id = $1', [review.set_id]) : null;
    return { set: set ?? null, areas };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/compliance-reviews/:id/areas', tag: 'Funding', permission: 'funding.view',
    summary: 'A review\'s areas with their self-assessment, answers, owner and number of deficiencies',
    response: '{ set: { id, name, version } | null, areas: [{ id, area_code, title, description, questions, self_assessment, answers, owner_id, owner_name, notes, deficiencies }] }',
  });

  app.put('/api/compliance-reviews/:id/areas/:code', { preHandler: edit }, async (req) => {
    const review = await needReview(req);
    await openOnly(review);
    const code = String((req.params as Row).code ?? '');
    const area = await db.one<Row>('select * from compliance_review_areas where review_id = $1 and area_code = $2', [review.id, code]);
    if (!area) ctx.fail(404, 'not_found', 'This review has no such area.');
    const b = (req.body ?? {}) as Row;
    const next: Row = {};
    const errors: Record<string, string> = {};
    if ('self_assessment' in b) {
      const v = String(b.self_assessment ?? '');
      if (!(await ctx.lookups.values('review_self_assessment')).some((x) => x.value === v)) errors.self_assessment = 'Choose a self-assessment from the list.';
      else next.self_assessment = v;
    }
    if ('answers' in b) {
      const answers = b.answers;
      const questions = (area!.questions ?? []) as string[];
      if (!Array.isArray(answers) || answers.length > questions.length || answers.some((x) => x !== null && typeof x !== 'string')) {
        errors.answers = `Give a list of up to ${questions.length} answers, one per question.`;
      } else if (answers.some((x) => typeof x === 'string' && x.length > 8000)) {
        errors.answers = 'An answer is longer than 8,000 characters.';
      } else next.answers = JSON.stringify(answers.map((x) => (typeof x === 'string' ? x.trim() : '')));
    }
    if ('notes' in b) next.notes = cleanText(b.notes, 8000);
    if (Object.keys(errors).length) invalid(errors);
    if ('owner_id' in b) next.owner_id = await activeUser(ctx, b.owner_id, 'owner_id');
    const cols = Object.keys(next);
    if (!cols.length) return area;
    const row = (await db.one<Row>(
      `update compliance_review_areas set ${cols.map((c, i) => `${c} = $${i + 2}${c === 'answers' ? '::jsonb' : ''}`).join(', ')}, updated_at = now(), updated_by = $${cols.length + 2}
       where id = $1 returning *`, [area!.id, ...cols.map((c) => next[c]), req.user!.id]))!;
    const before: Row = {};
    const after: Row = {};
    for (const c of cols) { before[c] = area![c]; after[c] = row[c]; }
    await ctx.audit(req, {
      action: 'compliance_review.area_update', recordType: 'compliance_review', recordId: review.id,
      summary: `Area ${area!.area_code} ${area!.title} updated on ${review.ref}`, before: { area: code, ...before }, after: { area: code, ...after },
    });
    return row;
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/compliance-reviews/:id/areas/:code', tag: 'Funding', permission: 'funding.edit',
    summary: 'Record the self-assessment, answers, owner and notes of one area of a review',
    body: '{ self_assessment?: "compliant" | "deficient" | "not_applicable" | "not_assessed", answers?: [string], owner_id?: uuid | null, notes?: string }',
    response: 'the area',
  });

  // ---------- document requests ----------

  async function requestInput(b: Row, creating: boolean, reviewId: string): Promise<Row> {
    const out: Row = {};
    const errors: Record<string, string> = {};
    if (creating || 'request' in b) {
      const r = cleanText(b.request, 4000);
      if (!r) errors.request = 'Say what the funder asked for.';
      else out.request = r;
    }
    if ('area_code' in b) {
      const c = cleanText(b.area_code, 30);
      if (c && !(await db.one('select 1 from compliance_review_areas where review_id = $1 and area_code = $2', [reviewId, c]))) errors.area_code = 'Choose an area of this review.';
      else out.area_code = c;
    }
    if ('due_on' in b) {
      if (b.due_on && !validDate(b.due_on)) errors.due_on = 'Give a date (YYYY-MM-DD).';
      else out.due_on = b.due_on || null;
    }
    if ('status' in b) {
      const s = String(b.status ?? '');
      if (!(await ctx.lookups.values('review_request_status')).some((x) => x.value === s)) errors.status = 'Choose a status from the list.';
      else out.status = s;
    }
    if ('response_note' in b) out.response_note = cleanText(b.response_note, 8000);
    if (Object.keys(errors).length) invalid(errors);
    if ('owner_id' in b) out.owner_id = await activeUser(ctx, b.owner_id, 'owner_id');
    return out;
  }

  app.get('/api/compliance-reviews/:id/requests', { preHandler: view }, async (req) => {
    const review = await needReview(req);
    return db.query<Row>(
      `select q.*, q.due_on::text as due_on, u.display_name as owner_name from compliance_review_requests q left join users u on u.id = q.owner_id
       where q.review_id = $1 order by q.due_on nulls last, q.created_at`, [review.id]);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/compliance-reviews/:id/requests', tag: 'Funding', permission: 'funding.view',
    summary: 'The documents and information the funder asked for in a review', response: '[{ id, area_code, request, owner_id, owner_name, due_on, status, response_note }]',
  });

  app.post('/api/compliance-reviews/:id/requests', { preHandler: edit }, async (req, reply) => {
    const review = await needReview(req);
    await openOnly(review);
    const data = await requestInput((req.body ?? {}) as Row, true, review.id);
    const cols = Object.keys(data);
    const row = (await db.one<Row>(
      `insert into compliance_review_requests (review_id, ${cols.join(', ')}, created_by, updated_by)
       values ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}, $${cols.length + 2}, $${cols.length + 2}) returning *`,
      [review.id, ...cols.map((c) => data[c]), req.user!.id]))!;
    await ctx.audit(req, {
      action: 'compliance_review.request_add', recordType: 'compliance_review', recordId: review.id,
      summary: `Request added to ${review.ref}: ${String(row.request).slice(0, 120)}`, after: data,
    });
    reply.code(201);
    return row;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/compliance-reviews/:id/requests', tag: 'Funding', permission: 'funding.edit',
    summary: 'Add a document request to a review', body: '{ request, area_code?, owner_id?, due_on?, status?, response_note? }', response: 'the request',
  });

  async function needRequest(req: FastifyRequest, review: Row): Promise<Row> {
    return (await db.one<Row>('select * from compliance_review_requests where id = $1 and review_id = $2', [idParam(ctx, req, 'rid'), review.id]))
      ?? ctx.fail(404, 'not_found', 'Request not found.');
  }

  // The person a request is assigned to may answer it (status and response) without funding.edit.
  app.patch('/api/compliance-reviews/:id/requests/:rid', { preHandler: view }, async (req) => {
    const review = await needReview(req);
    await openOnly(review);
    const current = await needRequest(req, review);
    const b = (req.body ?? {}) as Row;
    const editor = ctx.can(req.user, 'funding.edit');
    if (!editor) {
      if (current.owner_id !== req.user!.id) ctx.fail(403, 'forbidden', 'Only the person this request is assigned to, or someone who may edit funding records, can change it.');
      for (const k of Object.keys(b)) if (!['status', 'response_note'].includes(k)) delete b[k];
    }
    const data = await requestInput(b, false, review.id);
    const cols = Object.keys(data);
    if (!cols.length) return current;
    const row = (await db.one<Row>(
      `update compliance_review_requests set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now(), updated_by = $${cols.length + 2}
       where id = $1 returning *`, [current.id, ...cols.map((c) => data[c]), req.user!.id]))!;
    const before: Row = {};
    for (const c of cols) before[c] = current[c];
    await ctx.audit(req, {
      action: 'compliance_review.request_update', recordType: 'compliance_review', recordId: review.id,
      summary: `Request updated on ${review.ref}: ${String(row.request).slice(0, 120)}`, before, after: data,
    });
    return row;
  });
  ctx.describeRoute({
    method: 'PATCH', path: '/api/compliance-reviews/:id/requests/:rid', tag: 'Funding', permission: 'funding.view',
    summary: 'Change a document request: anything with funding.edit; its status and response only, for the person it is assigned to',
    body: '{ request?, area_code?, owner_id?, due_on?, status?, response_note? }', response: 'the request',
  });

  app.delete('/api/compliance-reviews/:id/requests/:rid', { preHandler: edit }, async (req) => {
    const review = await needReview(req);
    await openOnly(review);
    const current = await needRequest(req, review);
    await db.query('delete from compliance_review_requests where id = $1', [current.id]);
    await ctx.audit(req, {
      action: 'compliance_review.request_remove', recordType: 'compliance_review', recordId: review.id,
      summary: `Request removed from ${review.ref}: ${String(current.request).slice(0, 120)}`, before: { request: current.request, status: current.status },
    });
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'DELETE', path: '/api/compliance-reviews/:id/requests/:rid', tag: 'Funding', permission: 'funding.edit',
    summary: 'Remove a document request from a review', response: '{ ok }',
  });

  // ---------- deficiencies ----------

  /**
   * Corrective action plans raised for a deficiency that are not closed yet (C1: `cap_status` values
   * with meta.closed). Plans may be raised here or from the plan panel on the deficiency's page; either
   * way their source is the deficiency. Null when plans are not part of this installation.
   */
  async function openPlans(deficiencyId: string): Promise<number | null> {
    const def = ctx.resources.get('cap');
    if (!def || !def.fields.source_type) return null;
    const closed = await flagged(ctx, 'cap_status', 'closed', ['closed']);
    return Number((await db.one<Row>(
      `select count(*)::int as n from ${def.table} where deleted_at is null and source_type = 'review_deficiency' and source_id::text = $1
         and not (coalesce(status, '') = any($2::text[]))`, [deficiencyId, closed]))!.n);
  }

  async function checkDeficiency(req: FastifyRequest | null, merged: Row, patch: Row, existing: Row | null) {
    const errors: Record<string, string> = {};
    if ('review_id' in patch && (!existing || patch.review_id !== existing.review_id)) {
      const review = merged.review_id ? await ctx.resources.find('compliance_review', String(merged.review_id), req?.user ?? null) : undefined;
      if (!review) errors.review_id = 'Choose a compliance review.';
      else if ((await closedReview()).includes(review.status)) errors.review_id = 'That review is closed. Reopen it to add a deficiency.';
    }
    if ('area_code' in patch && merged.area_code && merged.review_id
      && !(await db.one('select 1 from compliance_review_areas where review_id = $1 and area_code = $2', [merged.review_id, merged.area_code]))) {
      errors.area_code = 'Give the code of one of the review\'s areas, or leave it empty.';
    }
    if (Object.keys(errors).length) invalid(errors);
    if ('status' in patch && (!existing || patch.status !== existing.status)) {
      const closed = await closedDeficiency();
      if (closed.includes(patch.status)) {
        if (existing && ((await openPlans(existing.id)) ?? 0) > 0) {
          invalid({ status: 'A corrective action plan for this deficiency is not closed yet. The deficiency closes when its plans close (their actions done and verified).' });
        }
        patch.closed_on = todayInZone();
      } else if (existing && closed.includes(existing.status)) {
        patch.closed_on = null;
      }
    }
  }

  ctx.defineResource({
    type: 'review_deficiency', table: 'review_deficiencies', module: 'funding', label: 'Review deficiency', plural: 'Review deficiencies',
    path: '/api/review-deficiencies', route: '/funding/deficiencies', titleField: 'title',
    ref: { field: 'ref', prefix: 'DEF-' },
    searchable: ['title', 'description', 'required_action'],
    defaultSort: { field: 'due_on', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Deficiency', type: 'text', required: true },
      review_id: { label: 'Compliance review', type: 'ref', to: 'compliance_review', required: true },
      area_code: { label: 'Review area code', type: 'text' },
      description: { label: 'What the funder found', type: 'longtext', personal: false },
      required_action: { label: 'Corrective action required', type: 'longtext', personal: false },
      owner_id: { label: 'Owner', type: 'user' },
      due_on: { label: 'Due', type: 'date' },
      status: { label: 'Status', type: 'lookup', list: 'review_deficiency_status', default: 'open' },
      cap_id: { label: 'Corrective action plan', type: 'ref', to: 'cap', readOnly: true },
      closed_on: { label: 'Closed on', type: 'date', readOnly: true },
    },
    hooks: {
      beforeCreate: async (req, data) => { await checkDeficiency(req, data, data, null); return data; },
      beforeUpdate: async (req, existing, patch) => { await checkDeficiency(req, { ...existing, ...patch }, patch, existing); return patch; },
    },
  });

  app.post('/api/review-deficiencies/:id/cap', { preHandler: edit }, async (req, reply) => {
    const def = await ctx.resources.find('review_deficiency', idParam(ctx, req), req.user) ?? ctx.fail(404, 'not_found', 'Deficiency not found.');
    const capDef = ctx.resources.get('cap');
    if (!capDef) ctx.fail(409, 'caps_unavailable', 'Corrective action plans are not part of this installation.');
    if (!ctx.can(req.user, 'actions.create')) ctx.fail(403, 'forbidden', 'Raising a corrective action plan also needs permission to create actions.');
    if (((await openPlans(def.id)) ?? 0) > 0) ctx.fail(409, 'already_raised', 'This deficiency already has a corrective action plan that is not closed.');
    if ((await closedDeficiency()).includes(def.status)) ctx.fail(409, 'closed', 'This deficiency is closed.');
    const review = await db.one<Row>('select ref, title, funder_name from compliance_reviews where id = $1', [def.review_id]);
    const b = (req.body ?? {}) as Row;
    const data: Row = {
      title: (cleanText(b.title, 200) ?? `Correct ${def.ref}: ${def.title}`).slice(0, 200),
      source: 'funding', source_type: 'review_deficiency', source_id: def.id,
      problem_statement: cleanText(b.problem_statement, 8000)
        ?? [def.description, def.required_action ? `Required: ${def.required_action}` : null, review ? `Found in ${review.ref} ${review.title}.` : null].filter(Boolean).join('\n\n'),
    };
    if (capDef!.fields.responsible_id) data.responsible_id = def.owner_id ?? null;
    if (capDef!.fields.due_on) data.due_on = def.due_on ?? null;
    for (const k of Object.keys(data)) if (!(k in capDef!.fields)) delete data[k];
    const cap = await ctx.resources.create('cap', data, req);
    // The record-change listener below links the plan and marks the deficiency as being corrected.
    await ctx.audit(req, {
      action: 'review_deficiency.cap', recordType: 'review_deficiency', recordId: def.id,
      summary: `Corrective action plan ${cap.ref ?? cap.title} raised for ${def.ref}`, after: { cap_id: cap.id },
    });
    reply.code(201);
    return { cap_id: cap.id, ref: cap.ref ?? null, route: `${capDef!.route}/${cap.id}` };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/review-deficiencies/:id/cap', tag: 'Funding', permission: 'funding.edit',
    summary: 'Raise a corrective action plan for a deficiency (also needs actions.create); the plan\'s source is the deficiency',
    body: '{ title?, problem_statement? }', response: '{ cap_id, ref, route }',
  });

  // Plans follow their deficiency (system work, recorded in the deficiency's history): the first plan
  // raised for it is linked and the deficiency is being corrected; when its last open plan closes, it closes.
  ctx.resources.onChange?.(async ({ action, def, row }) => {
    if (def.type !== 'cap' || row.source_type !== 'review_deficiency' || !row.source_id || !UUID_RE.test(String(row.source_id))) return;
    const d = await db.one<Row>('select id, status, cap_id from review_deficiencies where id = $1 and deleted_at is null', [String(row.source_id)]);
    if (!d || (await closedDeficiency()).includes(d.status)) return;
    if (action === 'create') {
      const patch: Row = {};
      if (d.cap_id !== row.id) patch.cap_id = row.id;
      if (d.status === 'open' && (await ctx.lookups.values('review_deficiency_status')).some((v) => v.value === 'in_progress')) patch.status = 'in_progress';
      if (Object.keys(patch).length) await ctx.resources.update('review_deficiency', d.id, patch, null);
      return;
    }
    if (action !== 'update' || !(await flagged(ctx, 'cap_status', 'closed', ['closed'])).includes(row.status)) return;
    if (((await openPlans(d.id)) ?? 0) > 0) return;
    await ctx.resources.update('review_deficiency', d.id, { status: 'closed' }, null);
  });
}
