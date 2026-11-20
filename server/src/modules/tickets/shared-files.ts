// E15-13: files on a ticket that the service desk shares with the requester. Attachments have
// no "public" flag of their own, so the choice is kept here, one row per shared file; the portal
// lists and downloads exactly these (and the files the requester added themselves).
import type { ModuleContext, Row } from '../../core/module.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { TicketNotify } from './notify.ts';

export function registerSharedFiles(ctx: ModuleContext, notify: TicketNotify) {
  const { app, db } = ctx;
  const ticketOf = async (req: { params: unknown; user: unknown }) =>
    (await ctx.resources.find('ticket', String((req.params as Row).id), req.user as never)) ?? ctx.fail(404, 'not_found', 'Ticket not found.');

  /** The ticket's files with whether each is shared, and whether the requester added it. */
  async function list(ticket: Row): Promise<Row[]> {
    const hasFiles = Boolean((await db.one<{ t: string | null }>(`select to_regclass('public.attachments')::text as t`))?.t);
    if (!hasFiles) return [];
    return db.query<Row>(
      `select a.id, a.file_name, a.size_bytes, a.created_at, a.uploaded_by_name,
              (coalesce(a.created_by = $2::uuid, false) or coalesce(a.created_by = $3::uuid, false)) as from_requester,
              s.attachment_id is not null as shared, s.shared_by_name, s.shared_at
       from attachments a left join ticket_shared_files s on s.attachment_id = a.id
       where a.record_type = 'ticket' and a.record_id = $1 and a.deleted_at is null order by a.created_at`,
      [ticket.id, ticket.requester_id ?? null, ticket.affected_user_id ?? null]);
  }

  app.get('/api/tickets/:id/shared-files', { preHandler: ctx.requirePerm('tickets.view') }, async (req) => {
    const ticket = await ticketOf(req);
    return { rows: await list(ticket), requester_can_see: Boolean(ticket.requester_id || ticket.affected_user_id) };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/tickets/:id/shared-files', permission: 'tickets.view',
    summary: 'Files on a ticket and which of them its requester sees',
    response: '{ rows: [{ id, file_name, size_bytes, created_at, uploaded_by_name, from_requester, shared, shared_by_name, shared_at }], requester_can_see }',
  });

  app.put('/api/tickets/:id/shared-files/:attachmentId', { preHandler: ctx.requirePerm('tickets.edit') }, async (req) => {
    const ticket = await ticketOf(req);
    const attachmentId = String((req.params as Row).attachmentId);
    const shared = (req.body as Row | undefined)?.shared;
    if (typeof shared !== 'boolean') ctx.fail(400, 'validation', 'Check the highlighted fields.', { shared: 'Choose shared or not shared.' });
    const att = UUID_RE.test(attachmentId)
      ? await db.one<Row>(`select id, file_name from attachments where id = $1 and record_type = 'ticket' and record_id = $2 and deleted_at is null`, [attachmentId, ticket.id])
      : undefined;
    if (!att) ctx.fail(404, 'not_found', 'File not found on this ticket.');
    const was = Boolean(await db.one('select 1 from ticket_shared_files where attachment_id = $1', [att!.id]));
    if (was === shared) return { shared };
    if (shared) {
      await db.query(
        'insert into ticket_shared_files (attachment_id, ticket_id, shared_by, shared_by_name) values ($1,$2,$3,$4) on conflict (attachment_id) do nothing',
        [att!.id, ticket.id, req.user!.id, req.user!.displayName]);
    } else {
      await db.query('delete from ticket_shared_files where attachment_id = $1', [att!.id]);
    }
    await ctx.audit(req, {
      action: shared ? 'ticket.file_shared' : 'ticket.file_unshared', recordType: 'ticket', recordId: ticket.id,
      summary: shared ? `File shared with the requester: ${att!.file_name}` : `File no longer shared with the requester: ${att!.file_name}`,
      after: { attachment_id: att!.id, shared },
    });
    if (shared) {
      const people = [ticket.requester_id, ticket.affected_user_id].filter((id) => id && id !== req.user!.id);
      if (people.length) {
        await notify.send({ userIds: people, kind: 'general', title: `A file was shared with you on ${ticket.ref}`, body: att!.file_name, route: `/portal/requests/${ticket.id}` });
      }
    }
    return { shared };
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/tickets/:id/shared-files/:attachmentId', permission: 'tickets.edit',
    summary: 'Share a file on a ticket with its requester, or stop sharing it',
    body: '{ shared: boolean }', response: '{ shared }',
  });
}
