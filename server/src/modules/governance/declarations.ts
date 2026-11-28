// Declarations of interest (conflicts of interest) and recused votes (E45-60). A member (or anyone
// named, as a data load names people) declares an interest in one agenda item, or in the whole meeting
// when no item is named, and what they did about it: took no part (recused), left the room, or stayed
// (the interest was noted and the chair let them take part). A member who took no part cannot be
// recorded as voting for, against or abstaining on a motion of that item (or of any item, for a
// declaration about the whole meeting): their vote is "recused" (or "absent"). A member declares their
// own interest from their member view; the secretary records anyone's. The minutes list declarations.
//
// Closed-session items: the people who may not read them see that a declaration was made about a
// closed-session item, never the item's title or the interest (restriction hides detail, never counts).
import type { FastifyRequest } from 'fastify';
import { actorOf, isDataLoad, resolvePerson } from '../../core/dataload.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';
import { memberSql, seesClosed, withNames } from './committees.ts';
import { CLOSED_TITLE, meetingFor } from './meetings.ts';

export const DECLARATION_ACTIONS = ['recused', 'left_room', 'stayed'] as const;
/** Actions that mean the person took no part in the decision. */
export const TOOK_NO_PART = ['recused', 'left_room'];
const LOCKED = 'minutes_approved';
const ACTION_LABEL: Record<string, string> = { recused: 'Took no part (recused)', left_room: 'Left the room', stayed: 'Stayed, with the chair\'s agreement' };
export const declarationActionLabel = (a: unknown) => ACTION_LABEL[String(a)] ?? String(a ?? '');

/** A meeting's declarations as `user` may read them. */
export async function declarationsFor(ctx: ModuleContext, user: SessionUser | null | undefined, meeting: Row, closed: boolean): Promise<Row[]> {
  const rows = await ctx.db.query<Row>(
    `select d.id, d.agenda_item_id, d.member_id, d.user_id, d.name, d.interest, d.action, d.declared_at, d.recorded_by_name,
            a.title as item_title, a.session as item_session, a.sort as item_sort
     from meeting_declarations d left join agenda_items a on a.id = d.agenda_item_id
     where d.meeting_id = $1 and d.deleted_at is null order by a.sort nulls first, d.declared_at, d.created_at`, [meeting.id]);
  return rows.map((r) => {
    const hidden = !closed && r.item_session === 'closed';
    return {
      id: r.id, agenda_item_id: r.agenda_item_id, member_id: r.member_id, name: r.name, action: r.action, action_label: declarationActionLabel(r.action),
      declared_at: r.declared_at, recorded_by_name: r.recorded_by_name ?? null,
      item_title: r.agenda_item_id ? (hidden ? CLOSED_TITLE : r.item_title) : null,
      interest: hidden ? null : r.interest, hidden,
    };
  });
}

/**
 * Members who took no part, by agenda item ('' for the whole meeting): a vote of for, against or
 * abstaining recorded for one of them on a motion about `itemId` is refused, outside a data load.
 */
export async function checkRecusals(ctx: ModuleContext, req: FastifyRequest, meetingId: string, itemId: string | null, votes: { member_id: string; vote: string }[] | null, members: Row[]): Promise<void> {
  if (!votes?.length || isDataLoad(req)) return;
  const out = await ctx.db.query<{ member_id: string }>(
    `select distinct member_id from meeting_declarations where meeting_id = $1 and deleted_at is null and member_id is not null
       and action = any($3::text[]) and (agenda_item_id is null or agenda_item_id::text = $2)`, [meetingId, itemId ?? '', TOOK_NO_PART]);
  const recused = new Set(out.map((r) => String(r.member_id)));
  for (const v of votes) {
    if (recused.has(v.member_id) && !['recused', 'absent'].includes(v.vote)) {
      const name = members.find((m) => m.id === v.member_id)?.name ?? 'A member';
      ctx.fail(400, 'validation', 'Check the highlighted fields.', { vote: `${name} declared an interest and took no part: record their vote as recused.` });
    }
  }
}

export function registerDeclarations(ctx: ModuleContext) {
  const { app, db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

  async function editable(req: FastifyRequest, meeting: Row) {
    if (isDataLoad(req)) return;
    if (meeting.status === LOCKED) ctx.fail(409, 'minutes_approved', 'The minutes of this meeting are approved, so it can no longer be changed.');
    if (meeting.status === 'canceled') ctx.fail(409, 'canceled', 'The meeting was canceled.');
  }

  /** The item, which must be on this meeting's agenda (and readable when closed). */
  async function itemOf(req: FastifyRequest, meeting: Row, id: unknown): Promise<string | null> {
    if (id === undefined || id === null || id === '') return null;
    const item = typeof id === 'string' && UUID_RE.test(id) ? await db.one<Row>('select id, session from agenda_items where id = $1 and meeting_id = $2', [id, meeting.id]) : undefined;
    if (!item || (item.session === 'closed' && !(await seesClosed(ctx, req.user, meeting.committee_id)))) invalid({ agenda_item_id: 'Choose an item of this meeting\'s agenda.' });
    return String(item!.id);
  }

  function detailsOf(body: Row): { interest: string; action: string } {
    const interest = String(body.interest ?? '').trim().slice(0, 2000);
    const action = body.action === undefined || body.action === null || body.action === '' ? 'recused' : String(body.action);
    const fields: Record<string, string> = {};
    if (!interest) fields.interest = 'Describe the interest (for example: "Owns shares in a bidder").';
    if (!(DECLARATION_ACTIONS as readonly string[]).includes(action)) fields.action = 'Choose recused, left the room or stayed.';
    if (Object.keys(fields).length) invalid(fields);
    return { interest, action };
  }

  async function insert(req: FastifyRequest, meeting: Row, data: Row): Promise<Row> {
    const by = actorOf(req);
    const loaded = isDataLoad(req) && data.declared_at ? data.declared_at : null;
    const row = (await db.one<Row>(
      `insert into meeting_declarations (meeting_id, agenda_item_id, member_id, user_id, name, interest, action, declared_at, recorded_by, recorded_by_name, created_by, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7,coalesce($8::timestamptz, now()),$9,$10,$11,$11) returning id`,
      [meeting.id, data.agenda_item_id, data.member_id, data.user_id, data.name, data.interest, data.action, loaded, by.id, by.name ?? req.user!.displayName, req.user!.id]))!;
    await ctx.audit(req, {
      action: 'meeting.declaration', recordType: 'meeting', recordId: meeting.id,
      summary: `Declaration of interest by ${data.name}${data.agenda_item_id ? ' on an agenda item' : ' for the whole meeting'}: ${declarationActionLabel(data.action)}`,
      after: { declaration_id: row.id, agenda_item_id: data.agenda_item_id, member_id: data.member_id, action: data.action },
    });
    return row;
  }

  app.get('/api/meetings/:id/declarations', { preHandler: ctx.requirePerm('governance.view') }, async (req) => {
    const meeting = await meetingFor(ctx, req);
    return declarationsFor(ctx, req.user, meeting, await seesClosed(ctx, req.user, meeting.committee_id));
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/meetings/:id/declarations', tag: 'Governance', permission: 'governance.view',
    summary: 'Declarations of interest made at a meeting, per agenda item (or the whole meeting); closed-session detail is hidden from people who may not read it',
    response: '[{ id, agenda_item_id, item_title, member_id, name, interest, action, action_label, declared_at, recorded_by_name, hidden }]',
  });

  app.post('/api/meetings/:id/declarations', { preHandler: ctx.requirePerm('governance.edit') }, async (req, reply) => {
    const meeting = await meetingFor(ctx, req);
    await editable(req, meeting);
    const body = (req.body ?? {}) as Row;
    const agendaItemId = await itemOf(req, meeting, body.agenda_item_id);
    const { interest, action } = detailsOf(body);
    // Who: a member of the committee (by id or name), or anyone named as a data load names people.
    const members = await withNames(ctx, await db.query<Row>(
      `select m.id, m.user_id, m.person_id, coalesce(nullif(m.name, ''), u.display_name) as name from committee_members m left join users u on u.id = m.user_id
       where m.committee_id = $1 and m.deleted_at is null`, [meeting.committee_id]));
    let who: { member_id: string | null; user_id: string | null; name: string } | null = null;
    const raw = body.member_id ?? body.member ?? body.name;
    if (typeof raw === 'string' && UUID_RE.test(raw)) {
      const m = members.find((x) => x.id === raw);
      if (m) who = { member_id: m.id, user_id: m.user_id ?? null, name: String(m.name) };
    }
    if (!who && typeof raw === 'string' && raw.trim()) {
      const byName = members.filter((x) => String(x.name).toLowerCase() === raw.trim().toLowerCase());
      if (byName.length === 1) who = { member_id: byName[0].id, user_id: byName[0].user_id ?? null, name: String(byName[0].name) };
      else {
        const p = await resolvePerson(db, raw, 'member');
        const m = members.find((x) => (p.userId && x.user_id === p.userId) || (p.personId && x.person_id === p.personId));
        who = m ? { member_id: m.id, user_id: m.user_id ?? null, name: String(m.name) } : { member_id: null, user_id: p.userId, name: p.name };
      }
    }
    if (!who) invalid({ member: 'Choose the member who declared the interest.' });
    let declaredAt: string | null = null;
    if (body.declared_at !== undefined && body.declared_at !== null && body.declared_at !== '') {
      if (!isDataLoad(req)) invalid({ declared_at: 'Declarations are recorded now; an earlier time is given only in a data load.' });
      if (Number.isNaN(Date.parse(String(body.declared_at)))) invalid({ declared_at: 'Enter a date and time.' });
      declaredAt = new Date(String(body.declared_at)).toISOString();
    }
    const row = await insert(req, meeting, { agenda_item_id: agendaItemId, ...who!, interest, action, declared_at: declaredAt });
    reply.code(201);
    return (await declarationsFor(ctx, req.user, meeting, true)).find((d) => d.id === row.id);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/meetings/:id/declarations', tag: 'Governance', permission: 'governance.edit',
    summary: 'Record a declaration of interest: who (a member by id or name; in a data load anyone named), the agenda item (none: the whole meeting), the interest and what they did',
    body: '{ member_id? | member? | name?, agenda_item_id?, interest, action?: recused (default) | left_room | stayed, declared_at? (data load only) }',
    description: 'A member who took no part (recused, left_room) cannot be recorded as voting for, against or abstaining on a motion of that item: record "recused".',
  });

  app.delete('/api/meetings/:id/declarations/:declarationId', { preHandler: ctx.requirePerm('governance.edit') }, async (req) => {
    const meeting = await meetingFor(ctx, req);
    await editable(req, meeting);
    const id = String((req.params as Row).declarationId ?? '');
    const row = UUID_RE.test(id) ? await db.one<Row>('select * from meeting_declarations where id = $1 and meeting_id = $2 and deleted_at is null', [id, meeting.id]) : undefined;
    if (!row) return ctx.fail(404, 'not_found', 'Declaration not found.');
    await db.query('update meeting_declarations set deleted_at = now(), updated_at = now(), updated_by = $2 where id = $1', [id, req.user!.id]);
    await ctx.audit(req, {
      action: 'meeting.declaration_remove', recordType: 'meeting', recordId: meeting.id,
      summary: `Declaration of interest by ${row.name} removed (recorded by mistake)`, before: { declaration_id: id, name: row.name, action: row.action },
    });
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'DELETE', path: '/api/meetings/:id/declarations/:declarationId', tag: 'Governance', permission: 'governance.edit',
    summary: 'Remove a declaration of interest recorded by mistake (not once the minutes are approved)',
  });

  // A member declares their own interest from their member view (no governance permission needed).
  app.post('/api/governance/my-meetings/:id/declarations', async (req, reply) => {
    const id = String((req.params as Row).id ?? '');
    const meeting = UUID_RE.test(id) ? await db.one<Row>(
      `select t.* from meetings t where t.id = $1 and t.deleted_at is null and ${memberSql(ctx, req.user?.id, 't.committee_id')}`, [id]) : undefined;
    if (!meeting) return ctx.fail(404, 'not_found', 'Meeting not found.');
    await editable(req, meeting);
    if (meeting.status === 'held') ctx.fail(409, 'held', 'The meeting has been held. Ask the secretary to record the declaration.');
    const body = (req.body ?? {}) as Row;
    const agendaItemId = await itemOf(req, meeting, body.agenda_item_id);
    const { interest, action } = detailsOf(body);
    const member = await db.one<Row>(
      `select m.id from committee_members m where m.committee_id = $1 and m.deleted_at is null and m.user_id = $2 order by m.created_at limit 1`,
      [meeting.committee_id, req.user!.id]);
    const row = await insert(req, meeting, {
      agenda_item_id: agendaItemId, member_id: member?.id ?? null, user_id: req.user!.id, name: req.user!.displayName, interest, action, declared_at: null,
    });
    reply.code(201);
    return (await declarationsFor(ctx, req.user, meeting, true)).find((d) => d.id === row.id);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/governance/my-meetings/:id/declarations', tag: 'Governance',
    summary: 'Declare your own interest in an agenda item (or the whole meeting) of a meeting of a committee you sit on, before it is held. Needs no permission',
    body: '{ agenda_item_id?, interest, action?: recused (default) | left_room | stayed }',
  });

  app.get('/api/governance/my-meetings/:id/declarations', async (req) => {
    const id = String((req.params as Row).id ?? '');
    const meeting = UUID_RE.test(id) ? await db.one<Row>(
      `select t.* from meetings t where t.id = $1 and t.deleted_at is null and ${memberSql(ctx, req.user?.id, 't.committee_id')}`, [id]) : undefined;
    if (!meeting) return ctx.fail(404, 'not_found', 'Meeting not found.');
    return declarationsFor(ctx, req.user, meeting, true);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/governance/my-meetings/:id/declarations', tag: 'Governance',
    summary: 'Declarations of interest at a meeting of a committee you sit on. Needs no permission',
  });
}
