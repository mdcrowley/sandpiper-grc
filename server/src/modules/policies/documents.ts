// Document control routes (E43): the library every signed-in person reads, the hierarchy, who may
// read a document (access) and reader counts, numbering and department codes, the approvals and
// relationships of a document, and the register's figures.
import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { pageOf } from '../../core/api/conventions.ts';
import {
  accessOf, audienceOutside, checkAccessInput, isController, mayChangeAccess, readableSql, readerIds, readerIdsSql, readerParams,
  type AccessTables,
} from './access.ts';
import { localDate, daysBetween } from './dates.ts';
import { renderPolicyMarkdown } from './markdown.ts';
import { CODE_RE, DEFAULT_NUMBER_PATTERN, NUMBER_PATTERN_SETTING, nextNumber, numberPattern, patternProblem } from './numbering.ts';
import { excerptOf } from './search.ts';
import { typeMap, type TypeInfo } from './types.ts';
import { READER_STATUSES, versionView } from './versions.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const ymd = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const T = 'Documents';

/**
 * Closes the open acknowledgment requests of people who can no longer read a document after its
 * access was narrowed (accounts, and roster people whose account cannot read it and whose roster
 * department is outside). Audited. Returns how many were closed.
 */
export async function closeUnreadable(ctx: ModuleContext, tables: AccessTables, req: FastifyRequest | null, policy: Row): Promise<number> {
  if (policy.access !== 'restricted') return 0;
  const readers = await readerIds(ctx, tables, policy);
  const closed = await ctx.db.query<{ id: string }>(
    `update policy_acknowledgements set superseded_at = now()
     where policy_id = $1 and acknowledged_at is null and superseded_at is null and not (user_id = any($2::uuid[])) returning id`,
    [policy.id, readers]);
  let roster = 0;
  if (ctx.resources.get('person')) {
    roster = (await ctx.db.query<{ id: string }>(
      `update policy_person_acknowledgements a set superseded_at = now()
       from people p
       where a.policy_id = $1 and a.acknowledged_at is null and a.superseded_at is null and p.id = a.person_id
         and not coalesce(p.user_id = any($2::uuid[]), false)
         and not coalesce(p.department_id in (
           with recursive dn(id) as (
             select d.id from departments d where d.deleted_at is null and (d.id::text in (select jsonb_array_elements_text($3::jsonb))
               or exists (select 1 from document_groups g where g.deleted_at is null and $4::jsonb @> jsonb_build_array(g.id::text)
                          and g.departments @> jsonb_build_array(d.id::text)))
             union select d.id from departments d join dn on d.parent_id = dn.id where d.deleted_at is null)
           select id from dn), false)
       returning a.id`,
      [policy.id, readers, JSON.stringify(list(policy.access_departments)), JSON.stringify(list(policy.access_groups))])).length;
  }
  const n = closed.length + roster;
  if (req) (req as FastifyRequest & { documentClosed?: number }).documentClosed = n;
  if (n) {
    await ctx.audit(req, {
      action: 'policy.ack_closed_access', recordType: 'policy', recordId: policy.id,
      summary: `${n} acknowledgment request${n === 1 ? '' : 's'} closed: the ${n === 1 ? 'person' : 'people'} can no longer read ${[policy.doc_number ?? policy.ref, policy.title].filter(Boolean).join(' ')}`,
      after: { closed: closed.length, roster_closed: roster },
    });
  }
  return n;
}

export function registerDocumentRoutes(ctx: ModuleContext, tables: AccessTables): void {
  const { app, db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  const readable = (req: FastifyRequest, alias: string) => readableSql(req.user, alias, tables);
  const seesDrafts = (req: FastifyRequest) => ctx.can(req.user, 'policies.edit') || ctx.can(req.user, 'policies.approve');

  /** A document the person may read (the distribution rule only: scope narrows working, not reading). */
  async function readableDoc(req: FastifyRequest, id: unknown): Promise<Row> {
    const row = typeof id === 'string' && UUID.test(id)
      ? await db.one<Row>(`select * from policies p where p.id = $1 and p.deleted_at is null and ${readable(req, 'p')}`, [id]) : undefined;
    return row ?? ctx.fail(404, 'not_found', 'Document not found.');
  }
  /** A document the person may work on: the register's rule (policies.view, distribution and scope). */
  async function workDoc(req: FastifyRequest): Promise<Row> {
    return (await ctx.resources.find('policy', String((req.params as Row).id ?? ''), req.user)) ?? ctx.fail(404, 'not_found', 'Document not found.');
  }
  const typeOf = (types: Map<string, TypeInfo>, v: unknown): TypeInfo =>
    types.get(String(v ?? '')) ?? { value: String(v ?? ''), label: String(v ?? ''), tier: 3, tierLabel: '', reviewMonths: null, ackDefault: false, plan: false, external: false, uncontrolled: false };

  // ---------- the library ----------

  const LIB_COLUMNS = `p.id, p.ref, p.doc_number, p.title, p.summary, p.document_type, p.owning_department_id, d.name as department_name,
    p.status, p.access, p.review_date, p.retired_on, p.search_text, v.version, v.version_label, v.effective_on`;
  const LIB_FROM = `policies p
    left join departments d on d.id = p.owning_department_id and d.deleted_at is null
    left join lateral (select version, version_label, effective_on from policy_versions pv
      where pv.policy_id = p.id and pv.status in ('published', 'withdrawn') order by pv.version desc limit 1) v on true`;

  function libraryFilter(req: FastifyRequest, q: Row, params: unknown[]): string {
    const where = [`p.deleted_at is null`, readable(req, 'p')];
    where.push(q.include_obsolete === '1' || q.include_obsolete === 'true' ? `p.status in ('published', 'retired')` : `p.status = 'published'`);
    if (q.type) { params.push(String(q.type).split(',')); where.push(`p.document_type = any($${params.length}::text[])`); }
    if (q.department && UUID.test(String(q.department))) { params.push(q.department); where.push(`p.owning_department_id = $${params.length}::uuid`); }
    const text = String(q.q ?? '').trim().slice(0, 200);
    if (text) {
      params.push(`%${text.replace(/[%_\\]/g, '\\$&')}%`);
      const n = params.length;
      where.push(`(p.title ilike $${n} or p.doc_number ilike $${n} or p.ref ilike $${n} or p.summary ilike $${n} or p.search_text ilike $${n})`);
    }
    return where.join(' and ');
  }

  app.get('/api/documents/library', async (req) => {
    const q = req.query as Row;
    const { page, pageSize } = pageOf(q);
    const params: unknown[] = [];
    const where = libraryFilter(req, q, params);
    const total = (await db.one<{ c: number }>(`select count(*)::int as c from policies p where ${where}`, params))!.c;
    const rows = await db.query<Row>(
      `select ${LIB_COLUMNS} from ${LIB_FROM} where ${where}
       order by p.doc_number nulls last, lower(p.title), p.id limit ${pageSize} offset ${(page - 1) * pageSize}`, params);
    const types = await typeMap(ctx);
    const text = String(q.q ?? '').trim();
    return {
      rows: rows.map((r) => {
        const t = typeOf(types, r.document_type);
        return {
          id: r.id, ref: r.ref, doc_number: r.doc_number, title: r.title, summary: r.summary, document_type: r.document_type,
          type_label: t.label, tier: t.tierLabel || String(t.tier), owning_department_id: r.owning_department_id, department_name: r.department_name ?? null,
          status: r.status, access: r.access, restricted: r.access === 'restricted', version: r.version === null || r.version === undefined ? null : Number(r.version),
          version_label: r.version_label ?? null, effective_on: ymd(r.effective_on), next_review_on: ymd(r.review_date), retired_on: ymd(r.retired_on),
          excerpt: text ? excerptOf(r.search_text, text) : null,
        };
      }),
      total, page, pageSize,
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/documents/library', tag: T,
    summary: 'The document library: effective documents the caller may read (every signed-in person)',
    description: 'Only documents in the caller\'s distribution. `q` matches the number, title, summary and full text.',
    query: { q: 'words', type: 'document types, comma-separated', department: 'owning department id', include_obsolete: '1 to include obsolete documents', page: 'page', pageSize: 'rows per page' },
    response: '{ rows: [{ id, ref, doc_number, title, summary, document_type, type_label, tier, owning_department_id, department_name, status, access, restricted, version, version_label, effective_on, next_review_on, retired_on, excerpt }], total, page, pageSize }',
  });

  app.get('/api/documents/library/tree', async (req) => {
    const q = req.query as Row;
    const params: unknown[] = [];
    const where = libraryFilter(req, { include_obsolete: q.include_obsolete }, params);
    const byType = await db.query<{ value: string; count: number }>(`select p.document_type as value, count(*)::int as count from policies p where ${where} group by 1`, params);
    const byDept = await db.query<{ id: string | null; name: string | null; count: number }>(
      `select p.owning_department_id as id, d.name, count(*)::int as count from policies p
       left join departments d on d.id = p.owning_department_id and d.deleted_at is null where ${where} group by 1, 2 order by lower(d.name) nulls last`, params);
    const types = await typeMap(ctx);
    const counted = new Map(byType.map((t) => [t.value, t.count]));
    return {
      types: [...types.values()].filter((t) => counted.has(t.value)).sort((a, b) => a.tier - b.tier)
        .map((t) => ({ value: t.value, label: t.label, tier: t.tierLabel || String(t.tier), count: counted.get(t.value) ?? 0 })),
      departments: byDept.map((d) => ({ id: d.id, name: d.id ? d.name : null, count: d.count })),
      total: byType.reduce((n, t) => n + t.count, 0),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/documents/library/tree', tag: T,
    summary: 'Library navigation: counts by type and owning department of the documents the caller can open (a list, not a figure)',
    query: { include_obsolete: '1 to count obsolete documents too' },
    response: '{ types: [{ value, label, tier, count }], departments: [{ id, name, count }], total }',
  });

  app.get('/api/documents/library/:id', async (req) => {
    const doc = await readableDoc(req, (req.params as Row).id);
    const editor = seesDrafts(req);
    if (!['published', 'retired'].includes(doc.status) && !editor) ctx.fail(404, 'not_found', 'Document not found.');
    const types = await typeMap(ctx);
    const t = typeOf(types, doc.document_type);
    const versions = (await db.query<Row>(
      `select v.*, u.display_name as author_name,
              (select max(r.reviewed_on) from policy_plan_reviews r where r.version_id = v.id and r.kind = 'periodic' and r.result = 'no_change')::text as reviewed_no_change_on
       from policy_versions v left join users u on u.id = v.created_by where v.policy_id = $1 order by v.version desc`, [doc.id]))
      .filter((v) => READER_STATUSES.includes(v.status));
    const wanted = Number((req.query as Row).version);
    const version = Number.isInteger(wanted) && wanted > 0
      ? versions.find((v) => Number(v.version) === wanted)
      : versions.find((v) => v.status === 'published') ?? versions.find((v) => v.status === 'withdrawn') ?? versions[0];
    if (Number.isInteger(wanted) && wanted > 0 && !version) ctx.fail(404, 'not_found', 'Version not found.');
    const current = versions.find((v) => v.status === 'published');
    const scheduled = await db.one<Row>(`select version, effective_on from policy_versions where policy_id = $1 and scheduled and status = 'approved'`, [doc.id]);
    let banner: { kind: string; text: string } | null = null;
    if (doc.status === 'retired') banner = { kind: 'obsolete', text: `Obsolete since ${ymd(doc.retired_on) ?? 'an earlier date'}: not for use.` };
    else if (version?.status === 'superseded') banner = { kind: 'superseded', text: `Superseded on ${ymd(version.superseded_on) ?? 'a later date'}: not for use.${current ? ` Current version: ${current.version_label ?? current.version}.` : ''}` };
    else if (t.uncontrolled) banner = { kind: 'reference', text: 'Reference only: this document is kept for information and is not controlled.' };
    else if (scheduled) banner = { kind: 'scheduled', text: `Version ${scheduled.version} is approved and takes effect on ${ymd(scheduled.effective_on)}.` };
    const names = await db.query<Row>(
      `select (select display_name from users where id = $1) as owner_name, (select name from departments where id = $2) as department_name`,
      [doc.owner_id ?? null, doc.owning_department_id ?? null]);
    const replacedBy = doc.replaced_by_id
      ? await db.one<Row>(`select id, doc_number, title from policies p where id = $1 and deleted_at is null and ${readable(req, 'p')}`, [doc.replaced_by_id]) : null;
    return {
      document: {
        id: doc.id, ref: doc.ref, doc_number: doc.doc_number, title: doc.title, summary: doc.summary, document_type: doc.document_type,
        type_label: t.label, tier: t.tierLabel || String(t.tier), status: doc.status, access: doc.access,
        owner_id: doc.owner_id, owner_name: names[0]?.owner_name ?? null, owning_department_id: doc.owning_department_id,
        department_name: names[0]?.department_name ?? null, approver_name: doc.approver_name, approver_role: doc.approver_role,
        next_review_on: ymd(doc.review_date), last_reviewed_on: ymd(doc.last_reviewed_on), retired_on: ymd(doc.retired_on), retire_reason: doc.retire_reason,
        replaced_by: replacedBy ?? null, ack_required: doc.ack_required !== false, publisher: doc.publisher, edition: doc.edition,
        published_on: ymd(doc.published_on), source_url: doc.source_url, license_note: doc.license_note, expires_on: ymd(doc.expires_on),
        uncontrolled: t.uncontrolled, can_edit: ctx.can(req.user, 'policies.edit') && !!(await ctx.resources.find('policy', doc.id, req.user)),
      },
      version: version ? versionView(version) : null,
      versions: versions.map((v) => versionView(v, false)),
      banner,
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/documents/library/:id', tag: T,
    summary: 'Read one document in the library: its details, the effective (or chosen) version\'s text and its published versions',
    description: '404 when the caller is outside the document\'s distribution, or the document has never taken effect.',
    query: { version: 'a version number (published, superseded or withdrawn)' },
    response: '{ document: {...}, version: Version | null, versions: [Version], banner: { kind, text } | null }',
  });

  // ---------- hierarchy ----------

  const NODE = `p.id, p.ref, p.doc_number, p.title, p.document_type, p.status, p.retired_on, p.parent_id,
    (select count(*)::int from policies c where c.parent_id = p.id and c.deleted_at is null) as child_count`;
  const node = (types: Map<string, TypeInfo>) => (r: Row) => ({
    id: r.id, ref: r.ref, doc_number: r.doc_number, title: r.title, document_type: r.document_type,
    tier: typeOf(types, r.document_type).tierLabel || String(typeOf(types, r.document_type).tier), status: r.status, retired_on: ymd(r.retired_on), child_count: Number(r.child_count ?? 0),
  });

  async function hierarchyOf(req: FastifyRequest, doc: Row) {
    const types = await typeMap(ctx);
    const toNode = node(types);
    const ancestors: Row[] = [];
    let parentId = doc.parent_id;
    const seen = new Set<string>([doc.id]);
    while (parentId && !seen.has(parentId) && ancestors.length < 20) {
      seen.add(parentId);
      const p = await db.one<Row>(`select ${NODE} from policies p where p.id = $1 and p.deleted_at is null and ${readable(req, 'p')}`, [parentId]);
      if (!p) break; // a parent the person cannot read ends the path
      ancestors.unshift(p);
      parentId = p.parent_id;
    }
    const kids = await db.query<Row>(
      `select ${NODE}, coalesce(${readable(req, 'p')}, false) as readable from policies p
       where p.parent_id = $1 and p.deleted_at is null order by p.doc_number nulls last, lower(p.title)`, [doc.id]);
    const parent = ancestors[ancestors.length - 1];
    const mine = typeOf(types, doc.document_type);
    let tierWarning: string | null = null;
    if (parent) {
      const pt = typeOf(types, parent.document_type);
      if (mine.tier < pt.tier && mine.tier <= 4 && pt.tier <= 4) tierWarning = `A ${mine.label.toLowerCase()} usually sits above a ${pt.label.toLowerCase()}, not under it.`;
    }
    return {
      parent: parent ? toNode(parent) : null,
      ancestors: ancestors.map(toNode),
      children: kids.filter((k) => k.readable).map(toNode),
      hidden_children: kids.filter((k) => !k.readable).length,
      tier_warning: tierWarning,
      document: toNode({ ...doc, child_count: kids.length }),
    };
  }

  app.get('/api/policies/:id/hierarchy', async (req) => {
    const doc = await readableDoc(req, (req.params as Row).id);
    if (!seesDrafts(req) && !['published', 'retired'].includes(doc.status)) ctx.fail(404, 'not_found', 'Document not found.');
    const h = await hierarchyOf(req, doc);
    return { document: h.document, ancestors: h.ancestors, children: h.children, hidden_children: h.hidden_children, tier_warning: h.tier_warning };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/policies/:id/hierarchy', tag: T,
    summary: 'A document\'s place in the hierarchy: the documents above it and below it that the caller may read; hidden children are counted',
    response: '{ document: Node, ancestors: [Node], children: [Node], hidden_children, tier_warning }',
  });

  // ---------- access ----------

  async function accessView(req: FastifyRequest, doc: Row) {
    const a = accessOf(doc);
    const [departments, roles, groups, users] = await Promise.all([
      db.query<Row>('select id, name from departments where id = any($1::uuid[]) order by lower(name)', [a.access_departments.filter((x) => UUID.test(x))]),
      db.query<Row>('select key, name from roles where key = any($1::text[]) order by name', [a.access_roles]),
      db.query<Row>('select id, name from document_groups where id = any($1::uuid[]) and deleted_at is null order by lower(name)', [a.access_groups.filter((x) => UUID.test(x))]),
      db.query<Row>('select id, display_name as name from users where id = any($1::uuid[]) order by lower(display_name)', [a.access_users.filter((x) => UUID.test(x))]),
    ]);
    const outside = await audienceOutside(ctx, doc);
    return {
      access: a.access, departments, roles, groups, users,
      reader_count: a.access === 'organization'
        ? (await db.one<{ c: number }>(`select count(*)::int as c from users where deleted_at is null and status = 'active'`))!.c
        : (await readerIds(ctx, tables, doc)).length,
      can_change: mayChangeAccess(req.user, doc),
      audience_outside: Object.values(outside),
    };
  }

  app.get('/api/policies/:id/access', { preHandler: ctx.requirePerm('policies.edit') }, async (req) => accessView(req, await workDoc(req)));
  ctx.describeRoute({
    method: 'GET', path: '/api/policies/:id/access', tag: T, permission: 'policies.edit',
    summary: 'Who may read a document: its access lists with names, the number of readers, and whether the caller may change them',
    response: '{ access, departments: [{ id, name }], roles: [{ key, name }], groups: [{ id, name }], users: [{ id, name }], reader_count, can_change, audience_outside: [string] }',
  });

  app.put('/api/policies/:id/access', { preHandler: ctx.requirePerm('policies.view') }, async (req) => {
    const doc = await workDoc(req);
    if (!mayChangeAccess(req.user, doc)) ctx.fail(403, 'forbidden', 'Only the document\'s owner or a document controller can change who may read it.');
    const b = (req.body ?? {}) as Row;
    const patch: Row = {};
    for (const k of ['access', 'access_departments', 'access_roles', 'access_groups', 'access_users']) if (k in b) patch[k] = b[k];
    if (!Object.keys(patch).length) invalid({ access: 'Choose who may read this document.' });
    await checkAccessInput(ctx, patch);
    const before = accessOf(doc);
    // The record engine checks the audience, saves, audits the change and closes requests of people
    // who can no longer read (index.ts hooks).
    const after = await ctx.resources.update('policy', doc.id, patch, req);
    await ctx.audit(req, {
      action: 'policy.access_change', recordType: 'policy', recordId: doc.id,
      summary: `Who may read ${[doc.doc_number ?? doc.ref, doc.title].filter(Boolean).join(' ')} changed`,
      before, after: accessOf(after),
    });
    return { ...(await accessView(req, after)), closed: (req as FastifyRequest & { documentClosed?: number }).documentClosed ?? 0 };
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/policies/:id/access', tag: T, permission: 'policies.view',
    summary: 'Change who may read a document (its owner or a document controller, policies.administer)',
    description: '400 `audience_outside` when the people asked to acknowledge would reach outside the readers. Open acknowledgment requests of people who can no longer read are closed. Audited (policy.access_change, with the lists before and after).',
    body: '{ access: "organization" | "restricted", access_departments: [uuid], access_roles: [key], access_groups: [uuid], access_users: [uuid] }',
    response: 'as GET, plus { closed }',
  });

  app.get('/api/policies/:id/readers/count', { preHandler: ctx.requirePerm('policies.edit') }, async (req) => {
    const doc = await workDoc(req);
    return { count: (await readerIds(ctx, tables, doc)).length, access: doc.access };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/policies/:id/readers/count', tag: T, permission: 'policies.edit',
    summary: 'How many active people may read a document', response: '{ count, access }',
  });

  app.post('/api/documents/readers/count', { preHandler: ctx.requirePerm('policies.edit') }, async (req) => {
    const b = { ...((req.body ?? {}) as Row) };
    const owner = b.owner_id;
    await checkAccessInput(ctx, b);
    const n = (await db.query(readerIdsSql(tables), readerParams({ ...b, owner_id: UUID.test(String(owner ?? '')) ? owner : null, created_by: req.user!.id, id: null }))).length;
    return { count: n };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/documents/readers/count', tag: T, permission: 'policies.edit',
    summary: 'How many people the access settings being edited would let read (nothing is saved)',
    body: '{ access, access_departments, access_roles, access_groups, access_users, owner_id? }', response: '{ count }',
  });

  // ---------- numbering ----------

  app.post('/api/policies/:id/number', { preHandler: ctx.requirePerm('policies.administer') }, async (req) => {
    const doc = await workDoc(req);
    if (doc.doc_number && ((req.body ?? {}) as Row).replace !== true) ctx.fail(409, 'has_number', 'This document already has a number. Ask to replace it.');
    const number = await nextNumber(ctx, doc);
    await ctx.resources.update('policy', doc.id, { doc_number: number }, req);
    return { doc_number: number };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/policies/:id/number', tag: T, permission: 'policies.administer',
    summary: 'Give a document the next number from the numbering pattern', body: '{ replace?: boolean }', response: '{ doc_number }',
    description: '409 `has_number` when it has a number and `replace` is not true. Numbers are never handed out twice.',
  });

  app.get('/api/documents/numbering', { preHandler: ctx.requirePerm('policies.view') }, async () => ({ pattern: await numberPattern(ctx), default_pattern: DEFAULT_NUMBER_PATTERN }));
  ctx.describeRoute({ method: 'GET', path: '/api/documents/numbering', tag: T, permission: 'policies.view', summary: 'The document numbering pattern', response: '{ pattern, default_pattern }' });
  app.put('/api/documents/numbering', { preHandler: ctx.requirePerm('policies.administer') }, async (req) => {
    const pattern = ((req.body ?? {}) as Row).pattern;
    const problem = patternProblem(pattern);
    if (problem) invalid({ pattern: problem });
    await ctx.settings.set(NUMBER_PATTERN_SETTING, String(pattern).trim(), req);
    return { pattern: String(pattern).trim(), default_pattern: DEFAULT_NUMBER_PATTERN };
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/documents/numbering', tag: T, permission: 'policies.administer',
    summary: 'Change the numbering pattern: {prefix}, {dept}, {year}, {seq} or {seq:N}', body: '{ pattern }', response: '{ pattern, default_pattern }',
  });

  const codesView = () => db.query<Row>(
    `select d.id as department_id, d.name as department_name, c.code from departments d
     left join document_department_codes c on c.department_id = d.id where d.deleted_at is null order by lower(d.name)`);
  app.get('/api/documents/department-codes', { preHandler: ctx.requirePerm('policies.view') }, async () => codesView());
  ctx.describeRoute({ method: 'GET', path: '/api/documents/department-codes', tag: T, permission: 'policies.view', summary: 'Short department codes used in document numbers', response: '[{ department_id, department_name, code }]' });
  app.put('/api/documents/department-codes', { preHandler: ctx.requirePerm('policies.administer') }, async (req) => {
    const codes = ((req.body ?? {}) as Row).codes;
    if (!Array.isArray(codes) || codes.length > 2000) invalid({ codes: 'Send the list of department codes.' });
    const seen = new Set<string>();
    const clean: { department_id: string; code: string }[] = [];
    for (const c of codes as Row[]) {
      const id = String(c?.department_id ?? '');
      const code = String(c?.code ?? '').trim().toUpperCase();
      if (!UUID.test(id)) invalid({ codes: 'One of the departments does not exist.' });
      if (!code) continue;
      if (!CODE_RE.test(code)) invalid({ codes: `"${code.slice(0, 20)}" is not a code: use 1 to 10 letters or digits.` });
      if (seen.has(code)) invalid({ codes: `The code ${code} is used twice.` });
      seen.add(code);
      clean.push({ department_id: id, code });
    }
    const known = await db.query<{ id: string }>('select id::text as id from departments where deleted_at is null and id = any($1::uuid[])', [clean.map((c) => c.department_id)]);
    if (known.length !== new Set(clean.map((c) => c.department_id)).size) invalid({ codes: 'One of the departments does not exist.' });
    const before = await db.query<Row>('select department_id, code from document_department_codes order by code');
    await db.tx(async (tx) => {
      await tx.query('delete from document_department_codes');
      for (const c of clean) await tx.query('insert into document_department_codes (department_id, code) values ($1, $2)', [c.department_id, c.code]);
    });
    await ctx.audit(req, { action: 'policy.department_codes', recordType: 'setting', summary: `Department codes for document numbers changed (${clean.length})`, before, after: clean });
    return codesView();
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/documents/department-codes', tag: T, permission: 'policies.administer',
    summary: 'Replace the department codes used in document numbers (1 to 10 letters or digits, unique)',
    body: '{ codes: [{ department_id, code }] }', response: '[{ department_id, department_name, code }]',
  });

  // ---------- approvals and relationships ----------

  app.get('/api/documents/approvals', { preHandler: ctx.requirePerm('policies.approve') }, async (req) => {
    const rows = await db.query<Row>(
      `select p.id as policy_id, p.ref, p.doc_number, p.title, v.id as version_id, v.version, v.version_label, v.status, v.scheduled,
              v.effective_on, u.display_name as author_name, v.created_by, v.updated_at
       from policy_versions v join policies p on p.id = v.policy_id and p.deleted_at is null
       left join users u on u.id = v.created_by
       where (v.status = 'in_review' or (v.status = 'approved' and not v.scheduled)) and ${ctx.resources.visibleWhere('policy', req.user, 'p')}
       order by v.updated_at`);
    return rows.map((r) => ({ ...r, version: Number(r.version), effective_on: ymd(r.effective_on), own: r.created_by === req.user!.id }));
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/documents/approvals', tag: T, permission: 'policies.approve',
    summary: 'Versions waiting for approval (in review) or for publishing (approved); `own` marks versions the caller wrote, which someone else must approve',
    response: '[{ policy_id, ref, doc_number, title, version_id, version, version_label, status, scheduled, effective_on, author_name, created_by, updated_at, own }]',
  });

  app.get('/api/policies/:id/relationships', async (req) => {
    const doc = await readableDoc(req, (req.params as Row).id);
    if (!seesDrafts(req) && !['published', 'retired'].includes(doc.status)) ctx.fail(404, 'not_found', 'Document not found.');
    const links = await db.query<Row>(
      `select relation, 'out' as direction, to_type as type, to_id as record_id from record_links where from_type = 'policy' and from_id = $1
       union all
       select relation, 'in' as direction, from_type as type, from_id as record_id from record_links where to_type = 'policy' and to_id = $1
       limit 1000`, [doc.id]);
    const labels = new Map((await ctx.lookups.values('document_link_relation')).map((v) => [v.value, v.label]));
    const groups = new Map<string, { relation: string; label: string; items: Row[]; hidden: number }>();
    for (const l of links) {
      const g = groups.get(l.relation) ?? { relation: l.relation, label: labels.get(l.relation) ?? (l.relation === 'related' ? 'Related' : String(l.relation)), items: [] as Row[], hidden: 0 };
      groups.set(l.relation, g);
      const def = ctx.resources.get(l.type);
      const rec = def && ctx.can(req.user, `${def.module}.view`) ? await ctx.resources.find(l.type, l.record_id, req.user) : undefined;
      if (!def || !rec) { g.hidden += 1; continue; }
      g.items.push({
        type: l.type, typeLabel: def.label, id: l.record_id, label: rec[def.titleField] ?? null, ref: def.ref ? rec[def.ref.field] ?? null : null,
        route: def.route, direction: l.direction,
      });
    }
    const h = await hierarchyOf(req, doc);
    return { groups: [...groups.values()], parent: h.parent, children: h.children, hidden_children: h.hidden_children };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/policies/:id/relationships', tag: T,
    summary: 'A document\'s links grouped by relation, with the parent and children; links to records the caller cannot open are counted, not named',
    response: '{ groups: [{ relation, label, items: [{ type, typeLabel, id, label, ref, route, direction }], hidden }], parent, children, hidden_children }',
  });

  // ---------- the register's figures (the same for everyone) ----------

  app.get('/api/documents/summary', { preHandler: ctx.requirePerm('policies.view') }, async () => {
    const today = localDate();
    const row = (await db.one<Row>(
      `select count(*) filter (where status = 'published')::int as effective,
              count(*) filter (where status in ('in_review', 'approved'))::int as in_review,
              count(*) filter (where status = 'published' and review_date < $1::date)::int as review_overdue,
              count(*) filter (where status = 'published' and review_date >= $1::date and review_date <= ($1::date + 90))::int as review_due_90,
              count(*) filter (where status = 'retired')::int as obsolete,
              count(*) filter (where status <> 'retired' and owner_id is null)::int as without_owner,
              count(*)::int as total
       from policies where deleted_at is null`, [today]))!;
    const byType = await db.query<{ value: string; count: number }>(`select document_type as value, count(*)::int as count from policies where deleted_at is null and status <> 'retired' group by 1`);
    const types = await typeMap(ctx);
    const ack = (await db.one<{ asked: number; done: number }>(
      `select count(*)::int as asked, count(a.acknowledged_at)::int as done from policy_acknowledgements a
       join policies p on p.id = a.policy_id and p.deleted_at is null and p.status = 'published'
       join policy_versions v on v.id = a.version_id and v.status = 'published'
       where a.superseded_at is null or a.acknowledged_at is not null`))!;
    return {
      ...row,
      by_type: byType.map((t) => ({ value: t.value, label: typeOf(types, t.value).label, count: t.count })).sort((a, b) => b.count - a.count),
      ack_completion_pct: ack.asked ? Math.round((ack.done / ack.asked) * 1000) / 10 : null,
      today,
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/documents/summary', tag: T, permission: 'policies.view',
    summary: 'The register\'s figures: effective, in review, reviews overdue and due in 90 days, obsolete, without owner, by type, acknowledgment completion (the same for everyone)',
    response: '{ effective, in_review, review_overdue, review_due_90, obsolete, without_owner, total, by_type: [{ value, label, count }], ack_completion_pct, today }',
  });

  void isController; void daysBetween; void renderPolicyMarkdown;
}
