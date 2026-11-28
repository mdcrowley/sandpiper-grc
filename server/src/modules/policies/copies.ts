// The register of issued paper copies (E43-14). A numbered controlled copy of a version is issued to a
// person (an account, or just a name) or kept at a place (a depot binder). When a later version takes
// effect, or the document is made obsolete, every copy of an earlier version not yet recalled is due to
// be recalled: the document's owner (else whoever issued it) has it in My work (calendar source
// `policies.copy_recalls`, work) and is told once when the new version takes effect. Recalling records
// the date, who did it and a note. Copies issued in a data load keep their dates and are listed on the
// Data loads page one by one, so a wrong one can be undone.
//
// Lists, not figures: the register is read by people who may read the document.
import type { FastifyRequest } from 'fastify';
import { defineCalendarSource, whoFor } from '../../core/calendar.ts';
import { actorOf, dataLoadFor, inDataLoad, noteLoaded } from '../../core/dataload.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { isDate } from './dates.ts';
import { loadedParts } from './loaded-parts.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const T = 'Documents';
/** How copies issued in a data load are listed in data_load_records. */
export const LOADED_COPY_TYPE = 'document_copy';
const ymd = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const text = (v: unknown, max = 200): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const docName = (p: Row) => [p.doc_number ?? p.ref, p.title].filter(Boolean).join(' ');

/**
 * SQL true for a copy (alias c) that is due to be recalled: not recalled, and its version is no longer
 * the one in force (superseded or withdrawn) or the document is obsolete.
 */
const RECALL_DUE = `c.recalled_on is null and c.deleted_at is null
  and (p.status = 'retired' or exists (select 1 from policy_versions v where v.id = c.version_id and v.status in ('superseded', 'withdrawn')))`;

export const copyView = (c: Row) => ({
  id: c.id, policy_id: c.policy_id, version_id: c.version_id, version: c.version === undefined || c.version === null ? null : Number(c.version),
  version_label: c.version_label ?? null, version_status: c.version_status ?? null,
  copy_number: Number(c.copy_number), holder_user_id: c.holder_user_id ?? null, holder_name: c.holder_name, location: c.location ?? null,
  issued_on: ymd(c.issued_on), issued_by_name: c.issued_by_name ?? null,
  recalled_on: ymd(c.recalled_on), recalled_by_name: c.recalled_by_name ?? null, recall_note: c.recall_note ?? null, notes: c.notes ?? null,
  recall_due: c.recall_due === true,
});

/** Tells the person who recalls (owner, else issuer) how many copies are now due to be recalled. Nothing in a load. */
export async function notifyRecalls(ctx: ModuleContext, policyId: string): Promise<number> {
  if (inDataLoad() || !ctx.app.hasDecorator('notify')) return 0;
  const rows = await ctx.db.query<Row>(
    `select coalesce(p.owner_id, c.issued_by) as who, count(*)::int as n, max(p.title) as title, max(p.doc_number) as doc_number, max(p.ref) as ref
     from document_copies c join policies p on p.id = c.policy_id
     where c.policy_id = $1 and ${RECALL_DUE} group by 1`, [policyId]);
  let sent = 0;
  for (const r of rows) {
    if (!r.who) continue;
    const res = await (ctx.app as unknown as { notify: (i: Row) => Promise<{ sent: number }> }).notify({
      userIds: [r.who], kind: 'reminder', recordType: 'policy', recordId: policyId, route: `/policies/${policyId}?tab=copies`,
      title: `Recall ${r.n} paper ${r.n === 1 ? 'copy' : 'copies'} of ${docName(r)}`,
      body: 'A later version is in force (or the document is obsolete). Collect the copies and record each recall in the register of paper copies.',
      once: `policy.copy_recall:${policyId}:${dayInZone()}`,
    });
    sent += res.sent;
  }
  return sent;
}

export function registerCopies(ctx: ModuleContext): void {
  const { app, db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

  async function needPolicy(req: FastifyRequest): Promise<Row> {
    return (await ctx.resources.find('policy', (req.params as Row).id, req.user)) ?? ctx.fail(404, 'not_found', 'Document not found.');
  }
  async function needCopy(policy: Row, cid: unknown): Promise<Row> {
    const row = typeof cid === 'string' && UUID.test(cid)
      ? await db.one<Row>('select * from document_copies where id = $1 and policy_id = $2 and deleted_at is null', [cid, policy.id]) : undefined;
    return row ?? ctx.fail(404, 'not_found', 'Copy not found.');
  }
  async function listOf(policyId: string): Promise<Row[]> {
    return db.query<Row>(
      `select c.*, v.version, v.version_label, v.status as version_status, (${RECALL_DUE}) as recall_due
       from document_copies c join policies p on p.id = c.policy_id left join policy_versions v on v.id = c.version_id
       where c.policy_id = $1 and c.deleted_at is null order by c.copy_number`, [policyId]);
  }
  /** A date from the body: not in the future; `fallback` when none is given. */
  function dateOf(v: unknown, field: string, fallback: string, fields: Record<string, string>): string {
    const s = text(v, 10);
    if (!s) return fallback;
    if (!isDate(s)) { fields[field] = 'Enter a date (YYYY-MM-DD).'; return fallback; }
    if (s > dayInZone()) fields[field] = 'The date cannot be in the future.';
    return s;
  }

  app.get('/api/policies/:id/copies', { preHandler: ctx.requirePerm('policies.view') }, async (req) => {
    const policy = await needPolicy(req);
    const rows = (await listOf(policy.id)).map(copyView);
    return {
      rows,
      out: rows.filter((r) => !r.recalled_on).length,
      recall_due: rows.filter((r) => r.recall_due).length,
      can_edit: ctx.can(req.user, 'policies.edit'),
      next_number: rows.reduce((m, r) => Math.max(m, r.copy_number), 0) + 1,
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/policies/:id/copies', tag: T, permission: 'policies.view',
    summary: 'The register of issued paper copies of a document: who holds each numbered copy, of which version, and recalls',
    response: '{ rows: [{ id, copy_number, version_id, version, version_label, version_status, holder_user_id, holder_name, location, issued_on, issued_by_name, recalled_on, recalled_by_name, recall_note, notes, recall_due }], out, recall_due, can_edit, next_number }',
  });

  app.post('/api/policies/:id/copies', { preHandler: ctx.requirePerm('policies.edit') }, async (req, reply) => {
    const policy = await needPolicy(req);
    const b = (req.body ?? {}) as Row;
    const load = await dataLoadFor(db, req, ctx.audit);
    const fields: Record<string, string> = {};
    if (policy.status === 'retired' && !load) ctx.fail(409, 'retired', 'This document is obsolete. Its copies can only be recalled.');
    // The version issued: the one given, else the one in force.
    let version: Row | undefined;
    if (b.version_id !== undefined && b.version_id !== null && b.version_id !== '') {
      version = typeof b.version_id === 'string' && UUID.test(b.version_id)
        ? await db.one<Row>('select * from policy_versions where id = $1 and policy_id = $2', [b.version_id, policy.id]) : undefined;
      if (!version) fields.version_id = 'Choose a version of this document.';
      else if (!load && version.status !== 'published') fields.version_id = 'Only the version in force can be issued as a controlled copy.';
    } else {
      version = await db.one<Row>(`select * from policy_versions where policy_id = $1 and status = 'published'`, [policy.id]);
      if (!version) fields.version_id = 'The document has no version in force to issue.';
    }
    // The holder: an account, or a name (a person or a place such as a depot binder).
    let holderId: string | null = null;
    let holderName = text(b.holder_name);
    if (b.holder_user_id !== undefined && b.holder_user_id !== null && b.holder_user_id !== '') {
      const u = typeof b.holder_user_id === 'string' && UUID.test(b.holder_user_id)
        ? await db.one<Row>('select id, display_name from users where id = $1', [b.holder_user_id]) : undefined;
      if (!u) fields.holder_user_id = 'Choose a person from the list.';
      else { holderId = String(u.id); holderName = holderName ?? String(u.display_name); }
    }
    if (!holderName && !fields.holder_user_id) fields.holder_name = 'Name the person or place holding the copy.';
    let number: number | null = null;
    if (b.copy_number !== undefined && b.copy_number !== null && b.copy_number !== '') {
      number = Number(b.copy_number);
      if (!Number.isInteger(number) || number < 1 || number > 100_000) fields.copy_number = 'The copy number must be a whole number from 1.';
    }
    const issuedOn = dateOf(b.issued_on, 'issued_on', dayInZone(), fields);
    let recalledOn: string | null = null;
    if (load && b.recalled_on) recalledOn = dateOf(b.recalled_on, 'recalled_on', dayInZone(), fields);
    if (recalledOn && recalledOn < issuedOn) fields.recalled_on = 'A copy cannot be recalled before it was issued.';
    if (Object.keys(fields).length) invalid(fields);
    const actor = actorOf(req);
    const row = await db.tx(async (tx) => {
      await tx.query('select id from policies where id = $1 for update', [policy.id]);
      const n = number ?? (await tx.one<{ n: number }>('select coalesce(max(copy_number), 0)::int + 1 as n from document_copies where policy_id = $1 and deleted_at is null', [policy.id]))!.n;
      if (await tx.one('select 1 from document_copies where policy_id = $1 and copy_number = $2 and deleted_at is null', [policy.id, n])) {
        invalid({ copy_number: `Copy ${n} of this document is already in the register.` });
      }
      return (await tx.one<Row>(
        `insert into document_copies (policy_id, version_id, copy_number, holder_user_id, holder_name, location, issued_on, issued_by, issued_by_name,
           recalled_on, recalled_by, recalled_by_name, recall_note, notes, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15) returning *`,
        [policy.id, version!.id, n, holderId, holderName, text(b.location), issuedOn, actor.id, actor.name ?? req.user!.displayName,
          recalledOn, recalledOn ? actor.id : null, recalledOn ? actor.name ?? req.user!.displayName : null, recalledOn ? text(b.recall_note, 2000) : null,
          text(b.notes, 2000), req.user!.id]))!;
    });
    if (load) await noteLoaded(db, LOADED_COPY_TYPE, String(row.id), req);
    await ctx.audit(req, {
      action: 'policy.copy_issue', recordType: 'policy', recordId: policy.id,
      summary: `Paper copy ${row.copy_number} of ${docName(policy)} (version ${version!.version}) issued to ${holderName}${row.location ? ` at ${row.location}` : ''}`,
      after: { copy_id: row.id, copy_number: row.copy_number, version: Number(version!.version), holder_name: holderName, location: row.location, issued_on: issuedOn, recalled_on: recalledOn },
    });
    reply.code(201);
    return copyView((await listOf(policy.id)).find((c) => c.id === row.id) ?? row);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/policies/:id/copies', tag: T, permission: 'policies.edit',
    summary: 'Issue a numbered controlled paper copy of the version in force to a person or place',
    description: 'The copy number is the next free one unless given. In data load mode any version may be named, and issued_on and recalled_on (with recall_note) keep the dates given; the copy is listed on the Data loads page. 409 retired for an obsolete document (outside a load).',
    body: '{ holder_user_id?, holder_name?, location?, version_id?, copy_number?, issued_on?, notes?, recalled_on? (load only), recall_note? }',
  });

  app.patch('/api/policies/:id/copies/:cid', { preHandler: ctx.requirePerm('policies.edit') }, async (req) => {
    const policy = await needPolicy(req);
    const copy = await needCopy(policy, (req.params as Row).cid);
    const b = (req.body ?? {}) as Row;
    const patch: Row = {};
    if (b.holder_name !== undefined) {
      patch.holder_name = text(b.holder_name);
      if (!patch.holder_name) invalid({ holder_name: 'Name the person or place holding the copy.' });
    }
    if (b.location !== undefined) patch.location = text(b.location);
    if (b.notes !== undefined) patch.notes = text(b.notes, 2000);
    const keys = Object.keys(patch).filter((k) => (patch[k] ?? null) !== (copy[k] ?? null));
    if (!keys.length) return copyView((await listOf(policy.id)).find((c) => c.id === copy.id)!);
    await db.query(
      `update document_copies set ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')}, updated_at = now(), updated_by = $2 where id = $1`,
      [copy.id, req.user!.id, ...keys.map((k) => patch[k])]);
    await ctx.audit(req, {
      action: 'policy.copy_update', recordType: 'policy', recordId: policy.id,
      summary: `Paper copy ${copy.copy_number} of ${docName(policy)} changed`,
      before: Object.fromEntries(keys.map((k) => [k, copy[k] ?? null])), after: Object.fromEntries(keys.map((k) => [k, patch[k] ?? null])),
    });
    return copyView((await listOf(policy.id)).find((c) => c.id === copy.id)!);
  });
  ctx.describeRoute({
    method: 'PATCH', path: '/api/policies/:id/copies/:cid', tag: T, permission: 'policies.edit',
    summary: 'Correct who holds a paper copy, where it is kept, or its notes', body: '{ holder_name?, location?, notes? }',
  });

  app.post('/api/policies/:id/copies/:cid/recall', { preHandler: ctx.requirePerm('policies.edit') }, async (req) => {
    const policy = await needPolicy(req);
    const copy = await needCopy(policy, (req.params as Row).cid);
    if (copy.recalled_on) ctx.fail(409, 'recalled', `Copy ${copy.copy_number} was already recalled.`);
    const b = (req.body ?? {}) as Row;
    const fields: Record<string, string> = {};
    const on = dateOf(b.recalled_on, 'recalled_on', dayInZone(), fields);
    if (on < String(ymd(copy.issued_on))) fields.recalled_on = 'A copy cannot be recalled before it was issued.';
    if (Object.keys(fields).length) invalid(fields);
    const actor = actorOf(req);
    await db.query(
      `update document_copies set recalled_on = $2, recalled_by = $3, recalled_by_name = $4, recall_note = $5, updated_at = now(), updated_by = $6 where id = $1`,
      [copy.id, on, actor.id, actor.name ?? req.user!.displayName, text(b.note ?? b.recall_note, 2000), req.user!.id]);
    await ctx.audit(req, {
      action: 'policy.copy_recall', recordType: 'policy', recordId: policy.id,
      summary: `Paper copy ${copy.copy_number} of ${docName(policy)} recalled from ${copy.holder_name} on ${on}`,
      before: { recalled_on: null }, after: { copy_id: copy.id, recalled_on: on, note: text(b.note ?? b.recall_note, 2000) },
    });
    return copyView((await listOf(policy.id)).find((c) => c.id === copy.id)!);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/policies/:id/copies/:cid/recall', tag: T, permission: 'policies.edit',
    summary: 'Record that a paper copy was recalled (collected or destroyed)', body: '{ recalled_on?: YYYY-MM-DD (not in the future; default today), note? }',
    description: 'The person who recalled it is the caller, or the person a data load names. 409 recalled when it already was.',
  });

  app.delete('/api/policies/:id/copies/:cid', { preHandler: ctx.requirePerm('policies.edit') }, async (req) => {
    const policy = await needPolicy(req);
    const copy = await needCopy(policy, (req.params as Row).cid);
    await db.query('update document_copies set deleted_at = now(), updated_at = now(), updated_by = $2 where id = $1', [copy.id, req.user!.id]);
    await ctx.audit(req, {
      action: 'policy.copy_delete', recordType: 'policy', recordId: policy.id,
      summary: `Paper copy ${copy.copy_number} of ${docName(policy)} taken out of the register (entered by mistake)`,
      before: { copy_id: copy.id, copy_number: copy.copy_number, holder_name: copy.holder_name },
    });
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'DELETE', path: '/api/policies/:id/copies/:cid', tag: T, permission: 'policies.edit',
    summary: 'Take a copy entered by mistake out of the register (a copy that was handed out is recalled instead)',
  });

  // My work: copies to recall, for the document's owner (else the person who issued them).
  defineCalendarSource(app, {
    key: 'policies.copy_recalls', label: 'Paper copies to recall', recordType: 'policy', permission: 'policies.view',
    work: true, anyone: true, kind: 'Paper copies to recall',
    async events(c, user, _from, to, scope) {
      if (!c.resources.get('policy')) return [];
      const rows = await c.db.query<Row>(
        `select c.id, c.copy_number, c.holder_name, p.id as policy_id, p.ref, p.doc_number, p.title, coalesce(p.owner_id, c.issued_by) as who,
                coalesce(v.superseded_on, v.withdrawn_on, p.retired_on, c.issued_on)::text as d
         from document_copies c join policies p on p.id = c.policy_id and p.deleted_at is null left join policy_versions v on v.id = c.version_id
         where ${RECALL_DUE} and ${c.resources.visibleWhere('policy', user, 'p')}
           and ($1::uuid is null or coalesce(p.owner_id, c.issued_by) = $1)
           and coalesce(v.superseded_on, v.withdrawn_on, p.retired_on, c.issued_on) <= $2::date
         order by 9, c.copy_number limit 2000`, [whoFor(user, scope), to]);
      return rows.map((r) => ({
        uid: `policies.copy_recalls:${r.id}`, title: `Recall paper copy ${r.copy_number} of ${docName(r)} (${r.holder_name})`,
        start: String(r.d).slice(0, 10), allDay: true, url: `/policies/${r.policy_id}?tab=copies`, recordType: 'policy', recordId: String(r.policy_id),
        ref: r.doc_number ?? r.ref ?? null, personId: r.who ?? null,
      }));
    },
  });

  // Copies issued in a data load, listed one by one on the Data loads page.
  loadedParts(app).set(LOADED_COPY_TYPE, {
    label: 'Paper copies',
    async list(ids) {
      const rows = ids.length ? await db.query<Row>(
        `select c.id, c.copy_number, c.holder_name, c.deleted_at, p.id as policy_id, p.ref, p.doc_number, p.title
         from document_copies c join policies p on p.id = c.policy_id where c.id = any($1::uuid[])`, [ids]) : [];
      const byId = new Map(rows.map((r) => [String(r.id), r]));
      return ids.map((id) => {
        const r = byId.get(id);
        if (!r) return { id, label: 'Copy no longer there', route: null, gone: true };
        return { id, label: `${docName(r)}: copy ${r.copy_number} (${r.holder_name})`, route: `/policies/${r.policy_id}`, gone: Boolean(r.deleted_at) };
      });
    },
    async undo(req, id) {
      const copy = UUID.test(id) ? await db.one<Row>('select c.*, p.title, p.doc_number, p.ref from document_copies c join policies p on p.id = c.policy_id where c.id = $1 and c.deleted_at is null', [id]) : undefined;
      if (!copy) return 'missing';
      await db.query('update document_copies set deleted_at = now(), updated_at = now(), updated_by = $2 where id = $1', [id, req.user!.id]);
      await ctx.audit(req, {
        action: 'policy.copy_delete', recordType: 'policy', recordId: copy.policy_id,
        summary: `Paper copy ${copy.copy_number} of ${docName(copy)} removed (undoing a data load)`,
        before: { copy_id: id, copy_number: copy.copy_number, holder_name: copy.holder_name },
      });
      return 'deleted';
    },
  });
}
