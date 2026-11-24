// Legal holds (E34-01, E34-02): a hold for a matter covers chosen records and every record a saved
// query matches; while it is active nothing under it may be deleted, removed for good, anonymized or
// lose its files (enforced in core, `core/holds.ts`). Releasing a hold goes through the
// "Legal hold release" approval kind, or, with no workflow, is done by someone holding legal.approve.
// Permission module `legal`. Not a feature area: a hold must never lapse because a part was switched off.
import type { FastifyRequest } from 'fastify';
import { approvalEngine, defineApprovalKind } from '../../core/approval-kinds.ts';
import { UUID_RE } from '../../core/errors.ts';
import { holdsOn } from '../../core/holds.ts';
import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext, ModuleDef, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { routePattern } from '../../core/api/versioning.ts';
import { notePermission } from '../../core/permission-use.ts';
import { placeSampleRecords, SAMPLE_JOB, seedHolds } from './seed.ts';
import { addRecords, cleanFilters, HOLD_TYPE, holdRecords, mayViewType, runAllQueries, runQuery, type RecordRef } from './service.ts';

export const RELEASE_KIND = 'legal_hold_release';
const DAY = 24 * 3_600_000;
const DETAIL = new Set(['text', 'longtext', 'user', 'json']);

export const DEFAULT_RELEASE_WORKFLOW = {
  name: 'Legal hold release',
  description: 'Releasing a legal hold, after which its records follow their retention periods again. Someone who may approve legal holds decides.',
  steps: [{ key: 'legal-approver', name: 'Legal approver', approvers: { kind: 'permission', permission: 'legal.approve' }, quorum: 'any' }],
};

async function seedDefaults(ctx: ModuleContext) {
  await ctx.lookups.ensure('legal_hold_status', [
    { value: 'active', label: 'Active', color: 'red', sort: 10 },
    { value: 'released', label: 'Released', color: 'gray', sort: 20 },
  ], { module: 'legal' });
}

async function register(ctx: ModuleContext) {
  const { app, db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

  ctx.defineResource({
    type: HOLD_TYPE, table: 'legal_holds', module: 'legal', label: 'Legal hold', plural: 'Legal holds',
    path: '/api/legal-holds', route: '/admin/legal-holds', titleField: 'matter',
    ref: { field: 'ref', prefix: 'LGH-' },
    searchable: ['matter', 'description'],
    defaultSort: { field: 'created_at', dir: 'desc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      matter: { label: 'Matter', type: 'text', required: true, personal: false },
      description: { label: 'Description', type: 'longtext' },
      custodian_id: { label: 'Custodian', type: 'user' },
      counsel_name: { label: 'Counsel', type: 'text', personal: true },
      starts_on: { label: 'Starts', type: 'date' },
      ends_on: { label: 'Expected end', type: 'date' },
      status: { label: 'Status', type: 'lookup', list: 'legal_hold_status', default: 'active', readOnly: true },
      released_on: { label: 'Released on', type: 'date', readOnly: true },
      released_by_name: { label: 'Released by', type: 'text', readOnly: true },
      release_reason: { label: 'Reason for release', type: 'longtext', readOnly: true },
    },
    hooks: {
      beforeCreate: async (_req, data) => {
        data.starts_on ??= dayInZone();
        if (data.ends_on && data.starts_on && String(data.ends_on) < String(data.starts_on)) invalid({ ends_on: 'The expected end must be on or after the start.' });
        return data;
      },
      beforeUpdate: async (_req, existing, patch) => {
        const merged = { ...existing, ...patch };
        if (merged.ends_on && merged.starts_on && String(merged.ends_on) < String(merged.starts_on)) invalid({ ends_on: 'The expected end must be on or after the start.' });
        return patch;
      },
    },
  });

  const holdFor = async (req: FastifyRequest): Promise<Row> =>
    (await ctx.resources.find(HOLD_TYPE, String((req.params as { id: string }).id), req.user)) ?? ctx.fail(404, 'not_found', 'Legal hold not found.');
  const mustBeActive = (hold: Row) => { if (hold.status !== 'active') ctx.fail(409, 'released', `Legal hold ${hold.ref} has been released.`); };

  // ---------------------------------------------------------------- records

  app.get('/api/legal-holds/:id/records', { preHandler: ctx.requirePerm('legal.view') }, async (req) => {
    const q = req.query as Row;
    const state = q.state === 'current' || q.state === 'released' ? q.state : 'all';
    return holdRecords(ctx, (await holdFor(req)).id, req.user, { page: Number(q.page) || 1, pageSize: Number(q.pageSize) || undefined, state });
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/legal-holds/:id/records', tag: 'Legal holds', permission: 'legal.view',
    summary: 'The records a legal hold covers that you may see, a page at a time; the counts include every held record',
    query: { state: '`current` (still held), `released` (taken off) or `all` (the default, current first)', page: 'Page number (default 1)', pageSize: 'Rows per page (default 100, at most 500)' },
    response: '{ rows: [{ id, record_type, typeLabel, record_id, label, ref, route, deleted, via: "hand" | "query", added_at, added_by_name, released_at }], total, hidden, released, shown, page, pageSize }',
  });

  app.post('/api/legal-holds/:id/records', { preHandler: ctx.requirePerm('legal.edit') }, async (req, reply) => {
    const hold = await holdFor(req);
    mustBeActive(hold);
    const b = (req.body ?? {}) as Row;
    const list: unknown[] = Array.isArray(b.records) ? b.records : [{ type: b.record_type, id: b.record_id }];
    if (!list.length || list.length > 500) invalid({ records: 'Choose from 1 to 500 records.' });
    const records: RecordRef[] = [];
    for (const item of list) {
      const r = (item ?? {}) as Row;
      const type = String(r.type ?? r.record_type ?? '');
      const id = String(r.id ?? r.record_id ?? '');
      // Only records the person may see can be chosen; a saved query covers the rest.
      const def = ctx.resources.get(type);
      const found = def && mayViewType(ctx, req.user, def) && UUID_RE.test(id) ? await ctx.resources.find(type, id, req.user) : undefined;
      if (!found) invalid({ records: 'Choose records you can see.' });
      records.push({ type, id });
    }
    const added = await addRecords(ctx, hold.id, records, req.user!.id);
    await ctx.audit(req, {
      action: 'legal_hold.records_add', recordType: HOLD_TYPE, recordId: hold.id,
      summary: `${added} record${added === 1 ? '' : 's'} placed under legal hold ${hold.ref}`, after: { records },
    });
    reply.code(201);
    return { added, ...(await holdRecords(ctx, hold.id, req.user)) };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/legal-holds/:id/records', tag: 'Legal holds', permission: 'legal.edit',
    summary: 'Place records you can see under an active legal hold (a record taken off before is put back)',
    body: '{ records: [{ type, id }] } or { record_type, record_id }', response: '{ added, rows, total, hidden, released }',
  });

  app.delete('/api/legal-holds/:id/records', { preHandler: ctx.requirePerm('legal.edit') }, async (req) => {
    const hold = await holdFor(req);
    mustBeActive(hold);
    const q = req.query as Record<string, string>;
    const type = String(q.record_type ?? q.type ?? '');
    const id = String(q.record_id ?? q.id ?? '');
    const def = ctx.resources.get(type);
    if (!def || !mayViewType(ctx, req.user, def) || !UUID_RE.test(id) || !(await ctx.resources.find(type, id, req.user))) {
      ctx.fail(404, 'not_found', 'Record not found on this hold.');
    }
    const row = await db.one<Row>(
      `update legal_hold_records set released_at = now(), released_by = $4
       where hold_id = $1 and record_type = $2 and record_id = $3::uuid and released_at is null returning id`, [hold.id, type, id, req.user!.id]);
    if (!row) ctx.fail(404, 'not_found', 'Record not found on this hold.');
    const label = await ctx.resources.labelFor(type, id);
    await ctx.audit(req, {
      action: 'legal_hold.record_remove', recordType: HOLD_TYPE, recordId: hold.id,
      summary: `${def!.label} ${label ?? id} taken off legal hold ${hold.ref}`, before: { record_type: type, record_id: id },
    });
    await ctx.audit(req, { action: 'legal_hold.released_record', recordType: type, recordId: id, summary: `Taken off legal hold ${hold.ref}` });
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'DELETE', path: '/api/legal-holds/:id/records', tag: 'Legal holds', permission: 'legal.edit',
    summary: 'Take one record off an active legal hold (kept in the hold\'s history; a saved query does not put it back)',
    query: { record_type: 'The record type.', record_id: 'The record id.' },
  });

  // ---------------------------------------------------------------- saved queries

  const listQueries = async (holdId: string, user: FastifyRequest['user']) => {
    const rows = await db.query<Row>(
      `select q.id, q.record_type, q.q, q.filters, q.last_run_at, q.matched, q.created_at, u.display_name as created_by_name
       from legal_hold_queries q left join users u on u.id = q.created_by where q.hold_id = $1 order by q.created_at`, [holdId]);
    return rows.map((r) => {
      const def = ctx.resources.get(r.record_type);
      // A query on a type the reader may not see is counted, never described.
      if (!def || !mayViewType(ctx, user, def)) return { id: r.id, hidden: true, typeLabel: def ? def.plural : 'A part that is switched off', matched: r.matched, last_run_at: r.last_run_at };
      return { ...r, typeLabel: def.plural, hidden: false };
    });
  };

  app.get('/api/legal-holds/:id/queries', { preHandler: ctx.requirePerm('legal.view') }, async (req) => listQueries((await holdFor(req)).id, req.user));
  ctx.describeRoute({
    method: 'GET', path: '/api/legal-holds/:id/queries', tag: 'Legal holds', permission: 'legal.view',
    summary: 'The saved queries of a legal hold (a query on a type you may not see shows only its count)',
    response: '[{ id, record_type, typeLabel, q, filters, last_run_at, matched, created_by_name, hidden }]',
  });

  app.post('/api/legal-holds/:id/queries', { preHandler: ctx.requirePerm('legal.edit') }, async (req, reply) => {
    const hold = await holdFor(req);
    mustBeActive(hold);
    const b = (req.body ?? {}) as Row;
    const def = ctx.resources.get(String(b.record_type ?? ''));
    if (!def || !mayViewType(ctx, req.user, def)) invalid({ record_type: 'Choose a kind of record you can see.' });
    const q = String(b.q ?? '').trim().slice(0, 200) || null;
    const { filters, error } = cleanFilters(def!, b.filters);
    if (error) invalid({ filters: error });
    if (!q && !Object.keys(filters).length) invalid({ q: 'Give search words or at least one filter: a query that matches every record is not a hold.' });
    // A search or a filter on words or people must not find out what a restricted record says (figures rule).
    const readsDetail = Boolean(q) || Object.keys(filters).some((k) => { const f = def!.fields[k.split('.')[1]]; return !k.split('.')[2] && f && DETAIL.has(f.type); });
    if (readsDetail && (def!.restricted || def!.rowRule) && !ctx.can(req.user, 'security.view')) {
      invalid({ q: `${def!.plural} may be restricted: searching their words or people needs permission to see restricted records. Filter by status, dates or numbers instead.` });
    }
    const row = (await db.one<Row>(
      `insert into legal_hold_queries (hold_id, record_type, q, filters, created_by) values ($1,$2,$3,$4::jsonb,$5) returning *`,
      [hold.id, def!.type, q, JSON.stringify(filters), req.user!.id]))!;
    await ctx.audit(req, {
      action: 'legal_hold.query_add', recordType: HOLD_TYPE, recordId: hold.id,
      summary: `Saved query on ${def!.plural.toLowerCase()} added to legal hold ${hold.ref}`, after: { record_type: def!.type, q, filters },
    });
    const run = await runQuery(ctx, row, req);
    reply.code(201);
    return { ...row, ...run };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/legal-holds/:id/queries', tag: 'Legal holds', permission: 'legal.edit',
    summary: 'Save a query on a legal hold and run it now: every record of the type it matches is held, restricted ones included; it runs again every night and only ever adds',
    body: '{ record_type, q?, filters?: { "f.<field>[.null|.gt|.lt|.gte|.lte]": value } }', response: '{ id, record_type, q, filters, matched, added }',
  });

  const queryFor = async (req: FastifyRequest, holdId: string): Promise<Row> => {
    const qid = String((req.params as { qid: string }).qid ?? '');
    return (UUID_RE.test(qid) ? await db.one<Row>('select * from legal_hold_queries where id = $1 and hold_id = $2', [qid, holdId]) : undefined)
      ?? ctx.fail(404, 'not_found', 'Saved query not found.');
  };

  app.post('/api/legal-holds/:id/queries/:qid/run', { preHandler: ctx.requirePerm('legal.edit') }, async (req) => {
    const hold = await holdFor(req);
    mustBeActive(hold);
    return runQuery(ctx, await queryFor(req, hold.id), req);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/legal-holds/:id/queries/:qid/run', tag: 'Legal holds', permission: 'legal.edit',
    summary: 'Run a saved query now (it also runs every night)', response: '{ matched, added, skipped? }',
  });

  app.delete('/api/legal-holds/:id/queries/:qid', { preHandler: ctx.requirePerm('legal.edit') }, async (req) => {
    const hold = await holdFor(req);
    const query = await queryFor(req, hold.id);
    await db.query('delete from legal_hold_queries where id = $1', [query.id]);
    await ctx.audit(req, {
      action: 'legal_hold.query_remove', recordType: HOLD_TYPE, recordId: hold.id,
      summary: `Saved query removed from legal hold ${hold.ref} (the records it added stay held)`, before: query,
    });
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'DELETE', path: '/api/legal-holds/:id/queries/:qid', tag: 'Legal holds', permission: 'legal.edit',
    summary: 'Remove a saved query; the records it added stay on the hold',
  });

  // ---------------------------------------------------------------- holds on one record

  app.get('/api/legal-holds/on', { preHandler: ctx.requirePerm('legal.view') }, async (req) => {
    const q = req.query as Record<string, string>;
    const def = ctx.resources.get(String(q.type ?? ''));
    const id = String(q.id ?? '');
    if (!def || !mayViewType(ctx, req.user, def) || !UUID_RE.test(id) || !(await ctx.resources.find(def.type, id, req.user))) {
      ctx.fail(404, 'not_found', 'Record not found.');
    }
    return holdsOn(db, def!.type, id);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/legal-holds/on', tag: 'Legal holds', permission: 'legal.view',
    summary: 'The active legal holds on one record you can see (anyone else only learns of a hold from the refusal)',
    query: { type: 'The record type.', id: 'The record id.' }, response: '[{ holdId, ref, matter }]',
  });

  // Record pages show a "Legal hold" banner: one record read through its generated route carries
  // `_holds: [{ id, ref }]` for people holding legal.view (never the matter).
  app.addHook('preSerialization', async (req, reply, payload) => {
    if (req.method !== 'GET' || reply.statusCode !== 200 || !payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
    const pattern = routePattern(req);
    if (!pattern.endsWith('/:id')) return payload;
    const type = ctx.resources.all().find((d) => d.type !== HOLD_TYPE && `${d.path}/:id` === pattern)?.type;
    const row = payload as Row;
    if (!type || !row.id || !req.user || !ctx.can(req.user, 'legal.view')) return payload;
    const holds = await holdsOn(db, type, String(row.id));
    return holds.length ? { ...row, _holds: holds.map((h) => ({ id: h.holdId, ref: h.ref })) } : payload;
  });

  // ---------------------------------------------------------------- release (E34-02)

  async function release(holdId: string, byName: string, reason: string, req: FastifyRequest | null) {
    const hold = (await db.one<Row>('select * from legal_holds where id = $1', [holdId]))!;
    if (hold.status !== 'active') return;
    await ctx.resources.update(HOLD_TYPE, hold.id, { status: 'released', released_on: dayInZone(), released_by_name: byName.slice(0, 200), release_reason: reason.slice(0, 2000) }, null);
    await ctx.audit(req, {
      action: 'legal_hold.release', recordType: HOLD_TYPE, recordId: hold.id,
      summary: `Legal hold ${hold.ref} released by ${byName}: ${reason}`,
    });
  }

  // Checked by the approval engine (approvers) and by the direct release below, for the role editor.
  notePermission('legal.approve');
  defineApprovalKind(app, {
    key: RELEASE_KIND, recordType: HOLD_TYPE, label: 'Legal hold release',
    startsWhen: 'Someone asks for a legal hold to be released (with the reason)',
    outcome: 'Approved: the hold is released and its records follow their retention periods again; rejected: the hold stays active, with the reason in its history',
    approverPermission: 'legal.approve',
    route: (id) => `/admin/legal-holds/${id}?tab=release`,
    async install(h) {
      if (!(await h.hasDefinitions())) await h.define(DEFAULT_RELEASE_WORKFLOW);
    },
    async onFinish(e) {
      if (e.outcome === 'canceled') return;
      const who = `${e.approverName ?? 'An approver'}${e.onBehalfOfName ? ` on behalf of ${e.onBehalfOfName}` : ''}`;
      if (e.outcome === 'rejected') {
        await ctx.audit(e.req, {
          action: 'legal_hold.release_rejected', recordType: HOLD_TYPE, recordId: e.instance.recordId,
          summary: `Release of the legal hold rejected by ${who}: ${e.comment ?? 'no reason given'}`,
        });
        return;
      }
      await release(e.instance.recordId, who, String(e.instance.data.reason ?? e.instance.note ?? 'Approved'), e.req);
    },
  });

  app.get('/api/legal-holds/:id/release', { preHandler: ctx.requirePerm('legal.view') }, async (req) => {
    const hold = await holdFor(req);
    const eng = approvalEngine(app);
    const latest = eng ? await eng.latest(RELEASE_KIND, hold.id) : null;
    return {
      status: hold.status, released_on: hold.released_on ?? null, released_by_name: hold.released_by_name ?? null, release_reason: hold.release_reason ?? null,
      workflow_available: Boolean(eng && (await eng.definitions(RELEASE_KIND)).length),
      request: latest ? { id: latest.id, workflow: latest.name, status: latest.status, started_at: latest.startedAt, finished_at: latest.finishedAt, reason: latest.data.reason ?? null } : null,
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/legal-holds/:id/release', tag: 'Legal holds', permission: 'legal.view',
    summary: 'Whether a legal hold is released, by whom and why, and its newest release approval',
    response: '{ status, released_on, released_by_name, release_reason, workflow_available, request: { id, workflow, status, started_at, finished_at, reason } | null }',
  });

  app.post('/api/legal-holds/:id/release', { preHandler: ctx.requirePerm('legal.edit') }, async (req, reply) => {
    const hold = await holdFor(req);
    mustBeActive(hold);
    const reason = String(((req.body ?? {}) as Row).reason ?? '').trim();
    if (reason.length < 5 || reason.length > 2000) invalid({ reason: 'Say why the hold can be released (5 to 2000 characters).' });
    const eng = approvalEngine(app);
    if (eng && await eng.running(RELEASE_KIND, hold.id)) ctx.fail(409, 'already_requested', 'Release of this hold is already waiting for approval.');
    const started = eng ? await eng.start(RELEASE_KIND, hold, { requester: req.user!.id, req, note: reason.slice(0, 2000), data: { reason } }) : null;
    if (started) {
      await ctx.audit(req, { action: 'legal_hold.release_requested', recordType: HOLD_TYPE, recordId: hold.id, summary: `Release of legal hold ${hold.ref} asked for (${started.name}): ${reason}` });
      reply.code(202);
      return { status: 'pending', instance_id: started.id, workflow: started.name };
    }
    // No workflow applies: someone who may approve legal holds releases it directly (audited).
    if (!ctx.can(req.user, 'legal.approve')) {
      ctx.fail(409, 'no_workflow', 'No Legal hold release workflow applies, so only someone who may approve legal holds can release it.');
    }
    await release(hold.id, req.user!.displayName, reason, req);
    return { status: 'released' };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/legal-holds/:id/release', tag: 'Legal holds', permission: 'legal.edit',
    summary: 'Release a legal hold: starts the Legal hold release approval (202), or, when no workflow applies, releases it at once for someone holding legal.approve',
    body: '{ reason }', response: '{ status: "pending" | "released", instance_id?, workflow? }',
  });

  // ---------------------------------------------------------------- nightly queries

  app.post('/api/legal-holds/queries/run', { preHandler: ctx.requirePerm('legal.administer') }, async () => runAllQueries(ctx));
  ctx.describeRoute({
    method: 'POST', path: '/api/legal-holds/queries/run', tag: 'Legal holds', permission: 'legal.administer',
    summary: 'Run every saved query of every active hold now (they also run every night)', response: '{ queries, added }',
  });
  const jobs = await scheduleWork(ctx, 'holds.queries', () => runAllQueries(ctx), { every: DAY, firstRunInMs: 150_000 });
  // The sample hold's records, placed once the samples exist (seed.ts).
  jobs.register(SAMPLE_JOB, async () => placeSampleRecords(ctx), { maxAttempts: 2 });
}

const mod: ModuleDef = {
  key: 'holds',
  seedDefaults,
  register,
  seed: seedHolds,
};
export default mod;
