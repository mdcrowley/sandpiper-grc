// Evidence links: the Evidence tab of a record, and the "Used by" tab of an evidence record (E45-06).
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import {
  checkPart, checkPartOpen, evidenceFor, findEvidence, findTarget, LINK_TYPES, mayLinkTo, removeLink, storeLink, usedBy, validPart,
} from './links.ts';

const T = 'Evidence';

export function registerEvidenceLinks(ctx: ModuleContext) {
  const { app, db } = ctx;
  const view = ctx.requirePerm('evidence.view');
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

  async function relationOf(v: unknown): Promise<string> {
    if (v === undefined || v === null || v === '') return 'supports';
    const s = String(v);
    if (!(await ctx.lookups.values('evidence_relation')).some((x) => x.value === s)) invalid({ relation: 'Choose how the evidence relates from the list.' });
    return s;
  }

  app.get('/api/evidence-library/link-types', { preHandler: view }, async (req) => LINK_TYPES
    .map((type) => ctx.resources.get(type))
    .filter((def) => def && ctx.can(req.user, `${def.module}.view`) && !(def.restricted === true && !ctx.can(req.user, 'security.view')))
    .map((def) => ({ type: def!.type, label: def!.label, route: def!.route, may_link: ctx.can(req.user, `${def!.module}.edit`) })));
  ctx.describeRoute({
    method: 'GET', path: '/api/evidence-library/link-types', tag: T, permission: 'evidence.view',
    summary: 'The kinds of record evidence is usually linked to that the caller may see, and whether the caller may link to them',
    response: '[{ type, label, route, may_link }]',
  });

  // Any signed-in person who may see the record: evidence they may not see is counted, not listed.
  app.get('/api/evidence-links', async (req) => {
    const q = req.query as Row;
    const target = await findTarget(ctx, req.user, q.record_type, q.record_id) ?? ctx.fail(404, 'not_found', 'Record not found.');
    const part = q.part === undefined ? undefined : validPart(q.part);
    if (part === '\u0000') invalid({ part: 'Give a part such as area:FM, or leave it out.' });
    const out = await evidenceFor(ctx, req.user, target, part);
    return {
      ...out,
      may_view: ctx.can(req.user, 'evidence.view'),
      may_link: ctx.can(req.user, 'evidence.view') && await mayLinkTo(ctx, req, target, part ?? ''),
      may_create: ctx.can(req.user, 'evidence.create'),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/evidence-links', tag: T,
    summary: 'The evidence a record uses (all its parts, or one part); evidence the caller may not see is counted in `hidden`',
    description: 'Needs view permission on the record. `part` (optional): "" for the record itself, or a part such as `area:FM`, `request:<uuid>`, `period:<uuid>`.',
    query: { record_type: 'Record type', record_id: 'Record id', part: 'Optional part' },
    response: '{ rows: [{ link_id, part, part_label, relation, note, linked_at, evidence: { id, ref, title, source, url, owner_name, valid_until, collected_on, period_start, period_end, files, state, restricted } }], hidden, total, may_view, may_link, may_create }',
  });

  app.post('/api/evidence-links', { preHandler: view }, async (req, reply) => {
    const b = (req.body ?? {}) as Row;
    const evidence = await findEvidence(ctx, req.user, b.evidence_id) ?? invalid({ evidence_id: 'Choose an evidence record of the library.' });
    const target = await findTarget(ctx, req.user, b.record_type, b.record_id) ?? ctx.fail(404, 'not_found', 'Record not found.');
    const part = validPart(b.part);
    if (part === '\u0000') invalid({ part: 'Give a part such as area:FM, or leave it empty.' });
    if (!(await mayLinkTo(ctx, req, target, part))) ctx.fail(403, 'forbidden', `Linking evidence changes this ${target.def.label.toLowerCase()}: it needs permission to edit it.`);
    await checkPartOpen(ctx, target, part);
    await checkPart(ctx, target, part);
    const relation = await relationOf(b.relation);
    const note = b.note == null ? null : String(b.note).trim().slice(0, 2000) || null;
    const { row, created } = await storeLink(ctx, req, evidence, target, { part, relation, note });
    reply.code(created ? 201 : 200);
    return row;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/evidence-links', tag: T, permission: 'evidence.view',
    summary: 'Use an evidence record of the library for a record (or a part of it); linking again changes the relation and note',
    description: 'Needs edit permission on the record (or the part\'s own rule: a funder document request\'s assignee) and sight of the evidence record. 201 for a new link, 200 for a changed one.',
    body: '{ evidence_id, record_type, record_id, part?, relation?: "supports" | "demonstrates" | "responds" | "reference", note? }',
    response: '{ id, evidence_id, record_type, record_id, part, relation, note, created_at, created_by }',
  });

  app.delete('/api/evidence-links/:id', async (req) => {
    const id = String((req.params as Row).id ?? '');
    const link = UUID_RE.test(id) ? await db.one<Row>('select * from evidence_links where id = $1', [id]) : undefined;
    const target = link ? await findTarget(ctx, req.user, link.record_type, String(link.record_id)) : undefined;
    const evidence = link ? await findEvidence(ctx, req.user, String(link.evidence_id)) : undefined;
    // A link to something the caller cannot see is "not found", so its existence does not leak.
    if (!link || !target || !evidence) ctx.fail(404, 'not_found', 'Link not found.');
    if (!(await mayLinkTo(ctx, req, target!, link!.part))) ctx.fail(403, 'forbidden', `Removing evidence changes this ${target!.def.label.toLowerCase()}: it needs permission to edit it.`);
    await checkPartOpen(ctx, target!, String(link!.part ?? ''));
    await removeLink(ctx, req, link!, evidence!, target!);
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'DELETE', path: '/api/evidence-links/:id', tag: T,
    summary: 'Stop using an evidence record for a record; the evidence record itself stays in the library',
    description: 'Needs sight of both and edit permission on the record (or the part\'s own rule). 409 `part_locked` when the part is locked (a reviewed workpaper step).', response: '{ ok }',
  });

  app.get('/api/evidence-library/:id/used-by', { preHandler: view }, async (req) => {
    const evidence = await findEvidence(ctx, req.user, (req.params as Row).id) ?? ctx.fail(404, 'not_found', 'Evidence record not found.');
    return usedBy(ctx, req.user, evidence.id);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/evidence-library/:id/used-by', tag: T, permission: 'evidence.view',
    summary: 'The records an evidence record is used by; records the caller may not see are counted in `hidden`',
    response: '{ rows: [{ link_id, record_type, type_label, record_id, ref, label, route, part, part_label, relation, note, linked_at }], hidden, total }',
  });
  // A deleted evidence record is no longer listed anywhere (the joins skip it); purging it for good
  // removes its links (on delete cascade).
}
