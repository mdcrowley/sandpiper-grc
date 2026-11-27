// The agenda of a meeting (E28-03, wave 25): items in order, each with a presenter (an account or a
// typed name), the time allotted, open or closed (executive) session, whether it is on the consent
// agenda, the record discussed or an approval waiting for the chair, its papers (files of the
// meeting, controlled documents, other records), and its minutes (the discussion summary).
//
// Closed-session items are read in full only by the committee's members, chair and secretary and by
// the people who prepare meetings (governance.edit). Everyone else who may see the meeting sees that
// the item exists ("Closed session item"), never its title, papers or minutes: restriction hides
// detail, never counts.
import type { FastifyRequest } from 'fastify';
import { approvalEngine, approvalKind } from '../../core/approval-kinds.ts';
import { actorOf, isDataLoad } from '../../core/dataload.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';
import { seesClosed } from './committees.ts';
import { CLOSED_TITLE, meetingFor, MINUTES_KIND, SESSIONS, visibleTarget } from './meetings.ts';
import { PAPERS_PER_ITEM, paperInput, papersOf } from './papers.ts';

const LOCKED = 'minutes_approved';
const ITEM_COLS = `id, meeting_id, sort, title, presenter, presenter_id, record_type, record_id, workflow_kind, workflow_instance_id, notes,
  session, consent, minutes_allotted, discussion`;

/**
 * A meeting's agenda as `user` may read it. `closed`: whether they may read closed-session items
 * (worked out by the caller with `seesClosed`).
 */
export async function agendaFor(ctx: ModuleContext, user: SessionUser | null | undefined, meeting: Row, closed: boolean): Promise<Row[]> {
  const { app, db } = ctx;
  const rows = await db.query<Row>(
    `select ${ITEM_COLS}, (select display_name from users u where u.id = a.presenter_id) as presenter_name
     from agenda_items a where meeting_id = $1 order by sort, created_at`, [meeting.id]);
  const open = rows.filter((r) => closed || r.session !== 'closed');
  const papers = await papersOf(ctx, user, meeting.id, open.map((r) => r.id));
  const eng = approvalEngine(app);
  const out: Row[] = [];
  for (const r of rows) {
    if (!closed && r.session === 'closed') {
      out.push({ id: r.id, meeting_id: r.meeting_id, sort: r.sort, session: 'closed', consent: r.consent, title: CLOSED_TITLE, hidden: true, papers: [] });
      continue;
    }
    r.record = null;
    if (r.record_type && r.record_id) {
      const def = ctx.resources.get(r.record_type);
      const found = def && (!user || ctx.can(user, `${def.module}.view`)) ? await ctx.resources.find(def.type, r.record_id, user ?? undefined) : undefined;
      // A record the reader may not see (restricted, switched off, deleted) is not named.
      r.record = found ? { type: def!.type, typeLabel: def!.label, id: found.id, label: await ctx.resources.labelFor(def!.type, found.id), ref: def!.ref ? found[def!.ref.field] : null, route: def!.route } : { hidden: true };
    }
    if (r.workflow_kind && eng && r.record_id && r.record && !r.record.hidden) {
      const latest = await eng.latest(r.workflow_kind, r.record_id);
      r.workflow = latest && latest.id === r.workflow_instance_id ? { name: latest.name, status: latest.status, label: approvalKind(app, r.workflow_kind)?.label ?? r.workflow_kind } : null;
    }
    r.presenter_label = r.presenter_name ?? r.presenter ?? null;
    delete r.presenter_name;
    r.papers = papers.get(r.id) ?? [];
    out.push(r);
  }
  return out;
}

export function registerAgenda(ctx: ModuleContext) {
  const { app, db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  const engine = () => approvalEngine(app);

  async function locked(meeting: Row, req: FastifyRequest) {
    if (isDataLoad(req)) return; // a data load may add the agenda and minutes of a past meeting
    if (meeting.status === LOCKED) ctx.fail(409, 'minutes_approved', 'The minutes of this meeting are approved, so it can no longer be changed.');
  }

  async function agendaOf(req: FastifyRequest, meeting: Row): Promise<Row[]> {
    return agendaFor(ctx, req.user, meeting, await seesClosed(ctx, req.user, meeting.committee_id));
  }

  async function agendaInput(req: FastifyRequest, meeting: Row, body: Row, existing: Row | null): Promise<Row> {
    const out: Row = {};
    const text = (k: string, max: number) => { if (body[k] !== undefined) out[k] = String(body[k] ?? '').trim().slice(0, max) || null; };
    text('title', 300); text('presenter', 160); text('notes', 4000); text('discussion', 20000);
    if (!existing && !out.title) invalid({ title: 'Give the item a title.' });
    if ('title' in out && !out.title) invalid({ title: 'Give the item a title.' });
    if (body.session !== undefined) {
      if (!(SESSIONS as readonly string[]).includes(String(body.session))) invalid({ session: 'Choose open or closed session.' });
      out.session = String(body.session);
    }
    if (body.consent !== undefined) out.consent = body.consent === true || body.consent === 'true';
    if (body.minutes_allotted !== undefined) {
      const n = body.minutes_allotted === null || body.minutes_allotted === '' ? null : Number(body.minutes_allotted);
      if (n !== null && (!Number.isInteger(n) || n < 1 || n > 600)) invalid({ minutes_allotted: 'Enter whole minutes, from 1 to 600.' });
      out.minutes_allotted = n;
    }
    if (body.presenter_id !== undefined) {
      const id = body.presenter_id ? String(body.presenter_id) : null;
      if (id && (!UUID_RE.test(id) || !(await db.one(`select 1 as ok from users where id = $1 and deleted_at is null`, [id])))) invalid({ presenter_id: 'Choose a person with an account, or type the presenter\'s name.' });
      out.presenter_id = id;
    }
    // An item on the consent agenda is adopted without discussion, so it cannot be in closed session.
    const merged = { ...(existing ?? {}), ...out };
    if (merged.consent && merged.session === 'closed') invalid({ consent: 'A closed-session item cannot be on the consent agenda.' });
    if ('discussion' in out && existing && out.discussion !== existing.discussion && await engine()?.running(MINUTES_KIND, meeting.id)) {
      ctx.fail(409, 'minutes_in_approval', 'The minutes are waiting for the chair\'s approval. Withdraw them (or wait for the decision) before changing them.');
    }
    if (body.record_type !== undefined || body.record_id !== undefined) {
      if (body.record_type && body.record_id) {
        const target = await visibleTarget(ctx, req, body.record_type, body.record_id);
        out.record_type = String(body.record_type);
        out.record_id = target.id;
      } else { out.record_type = null; out.record_id = null; }
      out.workflow_kind = null; out.workflow_instance_id = null;
    }
    if (body.workflow_kind) {
      const kind = approvalKind(app, String(body.workflow_kind));
      const recordType = out.record_type ?? existing?.record_type;
      const recordId = out.record_id ?? existing?.record_id;
      const running = kind && kind.recordType === recordType && recordId ? await engine()?.running(kind.key, recordId) : null;
      if (!running) invalid({ workflow_kind: 'No approval of that kind is waiting on this record.' });
      out.workflow_kind = kind!.key;
      out.workflow_instance_id = running!.id;
    }
    return out;
  }

  const itemOf = async (meetingId: string, itemId: string): Promise<Row> =>
    (UUID_RE.test(itemId) ? await db.one<Row>('select * from agenda_items where id = $1 and meeting_id = $2', [itemId, meetingId]) : undefined)
      ?? ctx.fail(404, 'not_found', 'Agenda item not found.');

  /** An item the caller may change: a closed-session item needs someone who may read it. */
  async function itemToChange(req: FastifyRequest, meeting: Row): Promise<Row> {
    const item = await itemOf(meeting.id, (req.params as { itemId: string }).itemId);
    if (item.session === 'closed' && !(await seesClosed(ctx, req.user, meeting.committee_id))) ctx.fail(404, 'not_found', 'Agenda item not found.');
    return item;
  }

  app.get('/api/meetings/:id/agenda', { preHandler: ctx.requirePerm('governance.view') }, async (req) => agendaOf(req, await meetingFor(ctx, req)));
  ctx.describeRoute({
    method: 'GET', path: '/api/meetings/:id/agenda', tag: 'Governance', permission: 'governance.view',
    summary: 'A meeting\'s agenda with each item\'s papers and minutes; a record the reader may not see is not named, and a closed-session item is shown only as "Closed session item" to people who are not members',
    response: '[{ id, sort, title, presenter, presenter_id, presenter_label, session, consent, minutes_allotted, discussion, record_type, record_id, record, workflow_kind, workflow, notes, papers: [{ id, kind, file_name?, record?, version?, hidden?, missing? }], hidden? }]',
  });

  app.post('/api/meetings/:id/agenda', { preHandler: ctx.requirePerm('governance.edit') }, async (req, reply) => {
    const meeting = await meetingFor(ctx, req);
    await locked(meeting, req);
    const input = await agendaInput(req, meeting, (req.body ?? {}) as Row, null);
    const next = (await db.one<{ n: number }>('select coalesce(max(sort), 0)::int + 10 as n from agenda_items where meeting_id = $1', [meeting.id]))!.n;
    const by = actorOf(req).id;
    const row = (await db.one<Row>(
      `insert into agenda_items (meeting_id, sort, title, presenter, presenter_id, record_type, record_id, workflow_kind, workflow_instance_id, notes,
         session, consent, minutes_allotted, discussion, created_by, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15) returning id`,
      [meeting.id, next, input.title, input.presenter ?? null, input.presenter_id ?? null, input.record_type ?? null, input.record_id ?? null,
        input.workflow_kind ?? null, input.workflow_instance_id ?? null, input.notes ?? null, input.session ?? 'open', input.consent ?? false,
        input.minutes_allotted ?? null, input.discussion ?? null, by]))!;
    await ctx.audit(req, {
      action: 'meeting.agenda_add', recordType: 'meeting', recordId: meeting.id,
      summary: `Agenda item added: ${input.session === 'closed' ? 'a closed-session item' : input.title}`, after: { item_id: row.id, ...input },
    });
    reply.code(201);
    return (await agendaOf(req, meeting)).find((r) => r.id === row.id);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/meetings/:id/agenda', tag: 'Governance', permission: 'governance.edit',
    summary: 'Add an agenda item, optionally about a record or an approval waiting for the chair',
    body: '{ title, presenter?, presenter_id?, session?: open | closed, consent?, minutes_allotted?, notes?, discussion?, record_type?, record_id?, workflow_kind? }',
  });

  app.patch('/api/meetings/:id/agenda/:itemId', { preHandler: ctx.requirePerm('governance.edit') }, async (req) => {
    const meeting = await meetingFor(ctx, req);
    await locked(meeting, req);
    const before = await itemToChange(req, meeting);
    const input = await agendaInput(req, meeting, (req.body ?? {}) as Row, before);
    const keys = Object.keys(input);
    if (keys.length) {
      await db.query(`update agenda_items set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now(), updated_by = $${keys.length + 2} where id = $1`,
        [before.id, ...keys.map((k) => input[k]), actorOf(req).id]);
      await ctx.audit(req, {
        action: 'meeting.agenda_change', recordType: 'meeting', recordId: meeting.id,
        summary: keys.length === 1 && keys[0] === 'discussion' ? `Minutes written for: ${before.title}` : `Agenda item changed: ${input.title ?? before.title}`,
        before: Object.fromEntries(keys.map((k) => [k, before[k]])), after: input,
      });
    }
    return (await agendaOf(req, meeting)).find((r) => r.id === before.id);
  });
  ctx.describeRoute({
    method: 'PATCH', path: '/api/meetings/:id/agenda/:itemId', tag: 'Governance', permission: 'governance.edit',
    summary: 'Change an agenda item or write its minutes (discussion)',
    body: '{ title?, presenter?, presenter_id?, session?, consent?, minutes_allotted?, notes?, discussion?, record_type?, record_id?, workflow_kind? }',
  });

  app.delete('/api/meetings/:id/agenda/:itemId', { preHandler: ctx.requirePerm('governance.edit') }, async (req) => {
    const meeting = await meetingFor(ctx, req);
    await locked(meeting, req);
    const before = await itemToChange(req, meeting);
    const motions = await db.one('select 1 as ok from meeting_decisions where agenda_item_id::text = $1 and deleted_at is null limit 1', [before.id]);
    if (motions) ctx.fail(409, 'has_decisions', 'A decision was recorded on this item. Remove the decision first, or keep the item.');
    await db.query('delete from agenda_items where id = $1', [before.id]);
    await ctx.audit(req, { action: 'meeting.agenda_remove', recordType: 'meeting', recordId: meeting.id, summary: `Agenda item removed: ${before.title}`, before });
    return { ok: true };
  });
  ctx.describeRoute({ method: 'DELETE', path: '/api/meetings/:id/agenda/:itemId', tag: 'Governance', permission: 'governance.edit', summary: 'Remove an agenda item (and its list of papers; the files stay on the meeting)' });

  app.put('/api/meetings/:id/agenda/order', { preHandler: ctx.requirePerm('governance.edit') }, async (req) => {
    const meeting = await meetingFor(ctx, req);
    await locked(meeting, req);
    const ids = (req.body as Row | null)?.ids;
    const current = await db.query<{ id: string }>('select id from agenda_items where meeting_id = $1', [meeting.id]);
    if (!Array.isArray(ids) || ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((id) => current.some((c) => c.id === id))) {
      invalid({ ids: 'Send every item of the agenda once, in the new order.' });
    }
    await db.tx(async (tx) => {
      for (const [i, id] of (ids as string[]).entries()) await tx.query('update agenda_items set sort = $2 where id = $1', [id, (i + 1) * 10]);
    });
    await ctx.audit(req, { action: 'meeting.agenda_order', recordType: 'meeting', recordId: meeting.id, summary: 'Agenda reordered', after: { ids } });
    return agendaOf(req, meeting);
  });
  ctx.describeRoute({ method: 'PUT', path: '/api/meetings/:id/agenda/order', tag: 'Governance', permission: 'governance.edit', summary: 'Put the agenda in a new order', body: '{ ids: [item id, ...] }' });

  // ---------- papers ----------

  app.post('/api/meetings/:id/agenda/:itemId/papers', { preHandler: ctx.requirePerm('governance.edit') }, async (req, reply) => {
    const meeting = await meetingFor(ctx, req);
    await locked(meeting, req);
    const item = await itemToChange(req, meeting);
    const input = await paperInput(ctx, req, meeting.id, (req.body ?? {}) as Row);
    const count = (await db.one<{ n: number }>('select count(*)::int as n from agenda_item_papers where item_id = $1', [item.id]))!.n;
    if (count >= PAPERS_PER_ITEM) ctx.fail(409, 'too_many', `An agenda item holds at most ${PAPERS_PER_ITEM} papers.`);
    const same = await db.one(
      `select 1 as ok from agenda_item_papers where item_id = $1 and kind = $2 and attachment_id is not distinct from $3::uuid
         and record_type is not distinct from $4 and record_id is not distinct from $5::uuid`,
      [item.id, input.kind, input.attachment_id, input.record_type, input.record_id]);
    if (same) ctx.fail(409, 'already_there', 'That paper is already on this item.');
    const row = (await db.one<Row>(
      `insert into agenda_item_papers (item_id, meeting_id, kind, attachment_id, record_type, record_id, sort, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [item.id, meeting.id, input.kind, input.attachment_id, input.record_type, input.record_id, (count + 1) * 10, actorOf(req).id]))!;
    await ctx.audit(req, {
      action: 'meeting.paper_add', recordType: 'meeting', recordId: meeting.id,
      summary: `Paper added to agenda item ${item.session === 'closed' ? '(closed session)' : `"${item.title}"`}`, after: { item_id: item.id, paper_id: row.id, ...input },
    });
    reply.code(201);
    return (await papersOf(ctx, req.user, meeting.id, [item.id])).get(item.id)?.find((p) => p.id === row.id);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/meetings/:id/agenda/:itemId/papers', tag: 'Governance', permission: 'governance.edit',
    summary: 'Add a paper to an agenda item: a file attached to the meeting, a controlled document from the document library, or another record',
    body: '{ kind: file | document | record, attachment_id? (file), record_id? (document: the document; record: with record_type), record_type? }',
  });

  app.delete('/api/meetings/:id/agenda/:itemId/papers/:paperId', { preHandler: ctx.requirePerm('governance.edit') }, async (req) => {
    const meeting = await meetingFor(ctx, req);
    await locked(meeting, req);
    const item = await itemToChange(req, meeting);
    const paperId = String((req.params as Row).paperId ?? '');
    const before = UUID_RE.test(paperId) ? await db.one<Row>('select * from agenda_item_papers where id = $1 and item_id = $2', [paperId, item.id]) : undefined;
    if (!before) ctx.fail(404, 'not_found', 'Paper not found.');
    await db.query('delete from agenda_item_papers where id = $1', [paperId]);
    await ctx.audit(req, { action: 'meeting.paper_remove', recordType: 'meeting', recordId: meeting.id, summary: 'Paper removed from an agenda item', before });
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'DELETE', path: '/api/meetings/:id/agenda/:itemId/papers/:paperId', tag: 'Governance', permission: 'governance.edit',
    summary: 'Take a paper off an agenda item (a file stays attached to the meeting)',
  });
}
