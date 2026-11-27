// The member reading view (wave 25): the members of a committee (people with an account, directly or
// through their roster person), its chair and its secretary read the agenda of its meetings, the
// papers, the board book (members' version, closed-session items included) and, once published, the
// minutes, without needing any permission in the application. Each route checks membership of the
// meeting's committee today; someone who is not a member gets 404, as for a meeting that does not exist.
// A paper inside the book or the agenda that is another record still follows the reader's own rights.
import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import { sandboxDownload, sendStoredFile } from '../attachments/intake.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { agendaFor } from './agenda.ts';
import { makeBook, makeMinutes, sendPdf } from './book.ts';
import { memberSql } from './committees.ts';
import { hasTable } from './papers.ts';

/** The agenda and book are ready once the agenda is published. */
const BOOK_READY = new Set(['agenda_published', 'held', 'minutes_approved']);

export function registerMemberView(ctx: ModuleContext) {
  const { app, db } = ctx;
  const MEETING_COLS = `t.id, t.ref, t.title, t.committee_id, t.scheduled_at, t.duration_minutes, t.location, t.status, t.minutes_published_at,
    t.minutes_approved_on::text as minutes_approved_on, c.name as committee_name`;

  /** A meeting of a committee the caller sits on, or 404. */
  async function myMeeting(req: FastifyRequest): Promise<Row> {
    const id = String((req.params as Row).id ?? '');
    const row = UUID_RE.test(id) ? await db.one<Row>(
      `select ${MEETING_COLS}, t.minutes, t.chair_id, t.secretary_id, t.minutes_approved_meeting_id, t.minutes_approved_decision_id
       from meetings t join committees c on c.id = t.committee_id
       where t.id = $1 and t.deleted_at is null and ${memberSql(ctx, req.user?.id, 't.committee_id')}`, [id]) : undefined;
    return row ?? ctx.fail(404, 'not_found', 'Meeting not found.');
  }

  const present = (m: Row) => ({
    id: m.id, ref: m.ref, title: m.title, committee_id: m.committee_id, committee_name: m.committee_name, scheduled_at: m.scheduled_at,
    duration_minutes: m.duration_minutes ?? null, location: m.location ?? null, status: m.status,
    book_ready: BOOK_READY.has(m.status), minutes_published: Boolean(m.minutes_published_at), minutes_published_at: m.minutes_published_at ?? null,
  });

  app.get('/api/governance/my-meetings', async (req) => {
    const rows = await db.query<Row>(
      `select ${MEETING_COLS} from meetings t join committees c on c.id = t.committee_id
       where t.deleted_at is null and c.deleted_at is null and ${memberSql(ctx, req.user?.id, 't.committee_id')}
         and t.scheduled_at > now() - interval '400 days'
       order by t.scheduled_at desc limit 200`);
    const now = Date.now() - 12 * 3600 * 1000;
    const all = rows.map(present);
    return {
      upcoming: all.filter((m) => new Date(m.scheduled_at).getTime() >= now).reverse(),
      recent: all.filter((m) => new Date(m.scheduled_at).getTime() < now),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/governance/my-meetings', tag: 'Governance',
    summary: 'Meetings of the committees the caller sits on (member, chair or secretary): upcoming ones, soonest first, and those of the last year. Needs no permission',
    response: '{ upcoming: [meeting], recent: [meeting] } with meeting = { id, ref, title, committee_name, scheduled_at, location, status, book_ready, minutes_published }',
  });

  app.get('/api/governance/my-meetings/:id', async (req) => {
    const m = await myMeeting(req);
    const ready = BOOK_READY.has(m.status);
    const agenda = ready ? await agendaFor(ctx, req.user, m, true) : [];
    // The minutes of an item are read here once published.
    if (!m.minutes_published_at) for (const a of agenda) delete a.discussion;
    for (const a of agenda) { delete a.workflow; delete a.workflow_instance_id; }
    return { meeting: present(m), agenda, agenda_published: ready };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/governance/my-meetings/:id', tag: 'Governance',
    summary: 'One meeting of a committee the caller sits on, with its agenda and papers once the agenda is published (closed-session items included); 404 for anyone else',
  });

  app.get('/api/governance/my-meetings/:id/book', async (req, reply) => {
    const m = await myMeeting(req);
    if (!BOOK_READY.has(m.status)) ctx.fail(409, 'not_published', 'The board book is ready once the agenda is published.');
    const textOnly = (req.query as Row)?.text === '1';
    const made = await makeBook(ctx, req.user, m, { version: 'members', textOnly, producedBy: req.user!.displayName });
    await ctx.audit(req, { action: 'meeting.book', recordType: 'meeting', recordId: m.id, summary: `Board book of ${m.ref} read by a member${textOnly ? ' (text only)' : ''}`, after: { version: 'members', text_only: textOnly } });
    return sendPdf(reply, made.pdf, `${m.ref}-board-book`);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/governance/my-meetings/:id/book', tag: 'Governance',
    summary: 'The members\' board book of a meeting of a committee the caller sits on, once its agenda is published',
    query: { text: '1: print the text of PDF papers instead of appending them' }, response: 'application/pdf',
  });

  app.get('/api/governance/my-meetings/:id/minutes', async (req, reply) => {
    const m = await myMeeting(req);
    if (!m.minutes_published_at) ctx.fail(409, 'not_published', 'The minutes are not published yet.');
    const meeting = (await db.one<Row>('select * from meetings where id = $1', [m.id]))!;
    const pdf = await makeMinutes(ctx, req.user, meeting, { version: 'members', producedBy: req.user!.displayName });
    await ctx.audit(req, { action: 'meeting.minutes_pdf', recordType: 'meeting', recordId: m.id, summary: `Published minutes of ${m.ref} read by a member`, after: { version: 'members' } });
    return sendPdf(reply, pdf, `${m.ref}-minutes`);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/governance/my-meetings/:id/minutes', tag: 'Governance',
    summary: 'The published minutes (PDF) of a meeting of a committee the caller sits on', response: 'application/pdf',
  });

  app.get('/api/governance/my-meetings/:id/papers/:paperId', { onSend: sandboxDownload }, async (req, reply) => {
    const m = await myMeeting(req);
    if (!BOOK_READY.has(m.status)) ctx.fail(404, 'not_found', 'Paper not found.');
    const paperId = String((req.params as Row).paperId ?? '');
    const files = await hasTable(ctx, 'attachments') && ctx.app.hasDecorator('attachmentStores');
    const att = files && UUID_RE.test(paperId) ? await db.one<Row>(
      `select a.* from agenda_item_papers p join attachments a on a.id = p.attachment_id and a.record_type = 'meeting' and a.record_id = p.meeting_id
       where p.id = $1 and p.meeting_id = $2 and p.kind = 'file' and a.deleted_at is null and a.storage_driver <> 'link'`, [paperId, m.id]) : undefined;
    if (!att) return ctx.fail(404, 'not_found', 'Paper not found.');
    await ctx.audit(req, { action: 'meeting.paper_read', recordType: 'meeting', recordId: m.id, summary: `Paper "${att.file_name}" of ${m.ref} downloaded by a member`, after: { attachment_id: att.id } });
    return sendStoredFile(ctx, reply, att, async (_code, message) => ctx.fail(500, 'file_problem', message));
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/governance/my-meetings/:id/papers/:paperId', tag: 'Governance',
    summary: 'Download a file paper of a meeting of a committee the caller sits on, once the agenda is published',
  });
}
