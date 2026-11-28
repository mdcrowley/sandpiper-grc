// The committee's annual work plan and agenda posting deadline (E45-62).
//
// - Work plan: standing items a committee takes in given months of every year (the annual budget in
//   one month, the risk register review each quarter) or at every meeting when no month is named.
//   A meeting's "standing items due" are the plan's items for its month not yet on its agenda; adding
//   them puts each on the agenda (linked to the plan item), and the year view shows, month by month,
//   which plan items a meeting has taken.
// - Agenda posting deadline: a committee's `agenda_posting_days` says how many days before a meeting its
//   agenda must be posted (published). The secretary (else everyone who may edit committee records) is
//   reminded from two days before that deadline while the agenda is not published (reminders.ts runs it).
import type { FastifyRequest } from 'fastify';
import { actorOf, isDataLoad } from '../../core/dataload.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { addDays } from '../../../../shared/dates.ts';
import { meetingFor, SESSIONS } from './meetings.ts';

const LOCKED = 'minutes_approved';
/** Days before the posting deadline the reminder starts. */
export const AGENDA_REMIND_DAYS = 2;
const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const plain = (ymd: string) => dateFormat.format(new Date(`${ymd}T00:00:00Z`));

/** The day a meeting's agenda must be posted by, or null when its committee sets no deadline. */
export function agendaDueOn(meeting: Row, postingDays: unknown): string | null {
  const n = Number(postingDays);
  if (postingDays === null || postingDays === undefined || !Number.isInteger(n) || n < 0) return null;
  return addDays(todayInZone(new Date(meeting.scheduled_at)), -n);
}

const planView = (r: Row) => ({
  id: r.id, committee_id: r.committee_id, title: r.title, description: r.description ?? null,
  months: (r.months ?? []).map(Number), presenter: r.presenter ?? null, session: r.session, sort: Number(r.sort),
});

/** Reminds about agendas whose posting deadline is near or past and that are not published. */
export async function remindAgendaDeadlines(ctx: ModuleContext, now = new Date()): Promise<{ due: number; notified: number }> {
  const out = { due: 0, notified: 0 };
  if (!ctx.app.hasDecorator('notify')) return out;
  const today = todayInZone(now);
  const rows = await ctx.db.query<Row>(
    `select m.id, m.ref, m.title, m.scheduled_at, m.secretary_id, c.agenda_posting_days from meetings m join committees c on c.id = m.committee_id
     where m.deleted_at is null and c.deleted_at is null and m.status = 'planned' and c.agenda_posting_days is not null
       and m.scheduled_at > $1 and m.scheduled_at <= $2 order by m.scheduled_at limit 500`,
    [now.toISOString(), new Date(now.getTime() + 70 * 86_400_000).toISOString()]);
  for (const m of rows) {
    const due = agendaDueOn(m, m.agenda_posting_days);
    if (!due || addDays(due, -AGENDA_REMIND_DAYS) > today) continue;
    out.due += 1;
    const res = await (ctx.app as unknown as { notify: (i: Row) => Promise<{ sent: number }> }).notify({
      ...(m.secretary_id ? { userIds: [m.secretary_id] } : { permission: 'governance.edit' }), kind: 'governance',
      title: `${due < today ? 'Agenda posting deadline passed' : 'Agenda to post'}: ${m.ref} ${m.title}`,
      body: `The agenda must be posted by ${plain(due)}, ${m.agenda_posting_days} days before the meeting. Publish the agenda when it is ready.`,
      recordType: 'meeting', recordId: m.id, once: `governance.agenda:${m.id}:${due}:${due < today ? 'late' : 'soon'}`,
    });
    out.notified += res.sent;
  }
  return out;
}

export function registerWorkPlan(ctx: ModuleContext) {
  const { app, db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  const committeeFor = async (req: FastifyRequest): Promise<Row> =>
    (await ctx.resources.find('committee', (req.params as { id: string }).id, req.user)) ?? ctx.fail(404, 'not_found', 'Committee not found.');

  function planInput(body: Row, existing: Row | null): Row {
    const out: Row = {};
    const fields: Record<string, string> = {};
    if (body.title !== undefined || !existing) {
      out.title = String(body.title ?? '').trim().slice(0, 300);
      if (!out.title) fields.title = 'Give the standing item a title.';
    }
    if (body.description !== undefined) out.description = String(body.description ?? '').trim().slice(0, 4000) || null;
    if (body.presenter !== undefined) out.presenter = String(body.presenter ?? '').trim().slice(0, 160) || null;
    if (body.session !== undefined) {
      if (!(SESSIONS as readonly string[]).includes(String(body.session))) fields.session = 'Choose open or closed session.';
      else out.session = String(body.session);
    }
    if (body.months !== undefined) {
      const list = Array.isArray(body.months) ? body.months.map(Number) : [];
      if (!Array.isArray(body.months) || list.some((m) => !Number.isInteger(m) || m < 1 || m > 12)) fields.months = 'Choose months from 1 (January) to 12 (December), or none for every meeting.';
      else out.months = [...new Set(list)].sort((a, b) => a - b);
    }
    if (body.sort !== undefined) {
      const n = Number(body.sort);
      if (!Number.isInteger(n) || n < 0 || n > 100_000) fields.sort = 'Enter a whole number.';
      else out.sort = n;
    }
    if (Object.keys(fields).length) invalid(fields);
    return out;
  }

  async function planOf(committeeId: string): Promise<Row[]> {
    return db.query<Row>('select * from committee_work_plan where committee_id = $1 and deleted_at is null order by sort, created_at', [committeeId]);
  }

  app.get('/api/committees/:id/work-plan', { preHandler: ctx.requirePerm('governance.view') }, async (req) => {
    const committee = await committeeFor(req);
    const year = Number((req.query as Row)?.year) || Number(todayInZone().slice(0, 4));
    if (!Number.isInteger(year) || year < 1990 || year > 2200) invalid({ year: 'Enter a year.' });
    const items = (await planOf(committee.id)).map(planView);
    // Which meetings of the year took each item (an agenda item added from the plan).
    const taken = await db.query<Row>(
      `select a.work_plan_item_id, m.id as meeting_id, m.ref, m.scheduled_at from agenda_items a join meetings m on m.id = a.meeting_id
       where m.committee_id = $1 and m.deleted_at is null and m.status <> 'canceled' and a.work_plan_item_id is not null
         and m.scheduled_at >= $2::date and m.scheduled_at < ($2::date + interval '1 year')`, [committee.id, `${year}-01-01`]);
    const meetings = await db.query<Row>(
      `select id, ref, scheduled_at, status from meetings where committee_id = $1 and deleted_at is null and status <> 'canceled'
         and scheduled_at >= $2::date and scheduled_at < ($2::date + interval '1 year') order by scheduled_at`, [committee.id, `${year}-01-01`]);
    const monthOf = (at: unknown) => Number(todayInZone(new Date(String(at))).slice(5, 7));
    return {
      year, can_edit: ctx.can(req.user, 'governance.edit'), agenda_posting_days: committee.agenda_posting_days ?? null,
      items: items.map((i) => ({
        ...i,
        taken: taken.filter((t) => t.work_plan_item_id === i.id).map((t) => ({ meeting_id: t.meeting_id, ref: t.ref, month: monthOf(t.scheduled_at) })),
      })),
      meetings: meetings.map((m) => ({ id: m.id, ref: m.ref, scheduled_at: m.scheduled_at, status: m.status, month: monthOf(m.scheduled_at) })),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/committees/:id/work-plan', tag: 'Governance', permission: 'governance.view',
    summary: 'A committee\'s annual work plan: its standing items with their months, and for one year the meetings and which of them took each item',
    query: { year: 'The year (default this year)' },
    response: '{ year, can_edit, agenda_posting_days, items: [{ id, title, description, months, presenter, session, sort, taken: [{ meeting_id, ref, month }] }], meetings: [{ id, ref, scheduled_at, status, month }] }',
  });

  app.post('/api/committees/:id/work-plan', { preHandler: ctx.requirePerm('governance.edit') }, async (req, reply) => {
    const committee = await committeeFor(req);
    const data = planInput((req.body ?? {}) as Row, null);
    const row = (await db.one<Row>(
      `insert into committee_work_plan (committee_id, title, description, months, presenter, session, sort, created_by, updated_by)
       values ($1,$2,$3,$4::int[],$5,$6,coalesce($7, (select coalesce(max(sort), 0) + 10 from committee_work_plan where committee_id = $1 and deleted_at is null)),$8,$8) returning *`,
      [committee.id, data.title, data.description ?? null, data.months ?? [], data.presenter ?? null, data.session ?? 'open', data.sort ?? null, req.user!.id]))!;
    await ctx.audit(req, {
      action: 'committee.work_plan_add', recordType: 'committee', recordId: committee.id,
      summary: `Standing item added to the work plan: ${row.title}`, after: planView(row),
    });
    reply.code(201);
    return planView(row);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/committees/:id/work-plan', tag: 'Governance', permission: 'governance.edit',
    summary: 'Add a standing item to a committee\'s annual work plan', body: '{ title, description?, months?: [1..12] (none: every meeting), presenter?, session?: open | closed, sort? }',
  });

  async function planItem(req: FastifyRequest, committee: Row): Promise<Row> {
    const id = String((req.params as Row).itemId ?? '');
    const row = UUID_RE.test(id) ? await db.one<Row>('select * from committee_work_plan where id = $1 and committee_id = $2 and deleted_at is null', [id, committee.id]) : undefined;
    return row ?? ctx.fail(404, 'not_found', 'Standing item not found.');
  }

  app.patch('/api/committees/:id/work-plan/:itemId', { preHandler: ctx.requirePerm('governance.edit') }, async (req) => {
    const committee = await committeeFor(req);
    const item = await planItem(req, committee);
    const data = planInput((req.body ?? {}) as Row, item);
    const keys = Object.keys(data);
    if (!keys.length) return planView(item);
    const row = (await db.one<Row>(
      `update committee_work_plan set ${keys.map((k, i) => `${k} = $${i + 3}${k === 'months' ? '::int[]' : ''}`).join(', ')}, updated_at = now(), updated_by = $2 where id = $1 returning *`,
      [item.id, req.user!.id, ...keys.map((k) => data[k])]))!;
    await ctx.audit(req, {
      action: 'committee.work_plan_change', recordType: 'committee', recordId: committee.id,
      summary: `Standing item changed in the work plan: ${row.title}`, before: planView(item), after: planView(row),
    });
    return planView(row);
  });
  ctx.describeRoute({
    method: 'PATCH', path: '/api/committees/:id/work-plan/:itemId', tag: 'Governance', permission: 'governance.edit',
    summary: 'Change a standing item of the work plan', body: 'as POST',
  });

  app.delete('/api/committees/:id/work-plan/:itemId', { preHandler: ctx.requirePerm('governance.edit') }, async (req) => {
    const committee = await committeeFor(req);
    const item = await planItem(req, committee);
    await db.query('update committee_work_plan set deleted_at = now(), updated_at = now(), updated_by = $2 where id = $1', [item.id, req.user!.id]);
    await ctx.audit(req, {
      action: 'committee.work_plan_remove', recordType: 'committee', recordId: committee.id,
      summary: `Standing item removed from the work plan: ${item.title}`, before: planView(item),
    });
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'DELETE', path: '/api/committees/:id/work-plan/:itemId', tag: 'Governance', permission: 'governance.edit',
    summary: 'Remove a standing item from the work plan (items already on agendas stay)',
  });

  /** The plan items due at a meeting (its month, or every meeting) and whether each is on its agenda. */
  async function dueAt(meeting: Row): Promise<Row[]> {
    const month = Number(todayInZone(new Date(meeting.scheduled_at)).slice(5, 7));
    const plan = (await planOf(meeting.committee_id)).filter((p) => !(p.months ?? []).length || (p.months as number[]).map(Number).includes(month));
    const on = new Set((await db.query<Row>('select work_plan_item_id from agenda_items where meeting_id = $1 and work_plan_item_id is not null', [meeting.id])).map((r) => String(r.work_plan_item_id)));
    return plan.map((p) => ({ ...planView(p), on_agenda: on.has(String(p.id)) }));
  }

  app.get('/api/meetings/:id/work-plan', { preHandler: ctx.requirePerm('governance.view') }, async (req) => {
    const meeting = await meetingFor(ctx, req);
    const committee = await db.one<Row>('select agenda_posting_days from committees where id = $1', [meeting.committee_id]);
    const due = agendaDueOn(meeting, committee?.agenda_posting_days);
    const today = todayInZone();
    return {
      agenda_due_on: due, agenda_posting_days: committee?.agenda_posting_days ?? null,
      agenda_late: Boolean(due && due < today && meeting.status === 'planned'),
      standing_items: await dueAt(meeting),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/meetings/:id/work-plan', tag: 'Governance', permission: 'governance.view',
    summary: 'For one meeting: the day its agenda must be posted by (the committee\'s posting deadline) and the work plan\'s standing items due that month, each marked when on the agenda',
    response: '{ agenda_due_on, agenda_posting_days, agenda_late, standing_items: [{ id, title, months, presenter, session, on_agenda }] }',
  });

  app.post('/api/meetings/:id/agenda/from-work-plan', { preHandler: ctx.requirePerm('governance.edit') }, async (req) => {
    const meeting = await meetingFor(ctx, req);
    if (meeting.status === LOCKED && !isDataLoad(req)) ctx.fail(409, 'minutes_approved', 'The minutes of this meeting are approved, so it can no longer be changed.');
    if (meeting.status === 'canceled') ctx.fail(409, 'canceled', 'The meeting was canceled.');
    const wanted = (req.body as Row | null)?.item_ids;
    const due = (await dueAt(meeting)).filter((p) => !p.on_agenda && (!Array.isArray(wanted) || wanted.includes(p.id)));
    const by = actorOf(req).id ?? req.user!.id;
    for (const p of due) {
      await db.query(
        `insert into agenda_items (meeting_id, sort, title, presenter, notes, session, consent, work_plan_item_id, created_by, updated_by)
         values ($1, (select coalesce(max(sort), 0) + 10 from agenda_items where meeting_id = $1), $2, $3, $4, $5, false, $6, $7, $7)`,
        [meeting.id, p.title, p.presenter, p.description, p.session, p.id, by]);
    }
    if (due.length) {
      await ctx.audit(req, {
        action: 'meeting.agenda_from_plan', recordType: 'meeting', recordId: meeting.id,
        summary: `${due.length} standing ${due.length === 1 ? 'item' : 'items'} from the work plan added to the agenda`, after: { items: due.map((p) => p.title) },
      });
    }
    return { added: due.length, standing_items: await dueAt(meeting) };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/meetings/:id/agenda/from-work-plan', tag: 'Governance', permission: 'governance.edit',
    summary: 'Add the work plan\'s standing items due at this meeting (its month, or every meeting) that are not on its agenda yet',
    body: '{ item_ids?: [plan item id] (default: all due) }', response: '{ added, standing_items }',
  });
}
