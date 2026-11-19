// Files on a portal request.
//
// Uploads and downloads go through the attachments module's own routes, so every file is
// checked exactly as any other (allowed types, content against the name, malware scanner,
// size limit) and stored in the same place. Those routes decide access from the ticket
// permissions, which a requester does not hold; for these two routes only, and only when the
// file belongs to one of the caller's own requests, the request is let through as if the caller
// could see (and, for an upload, add files to) that one ticket:
//
//   PUT /api/attachments/upload?record_type=ticket&record_id=<my ticket>   (needs portal.create)
//   GET /api/attachments/:id/download   for a file I uploaded to my ticket  (needs portal.view)
//
// Nothing else changes: the requester still cannot list a ticket's files through the agent
// route, see files someone else attached, change or remove a file, or reach any other ticket.
import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';
import { MINE } from './access.ts';
import { isEnabled } from './settings.ts';

const UPLOAD = '/api/attachments/upload';
const DOWNLOAD = '/api/attachments/:id/download';

export function makeFiles(ctx: ModuleContext) {
  const { app, db } = ctx;
  let available = false;
  app.addHook('onReady', async () => {
    available = app.hasDecorator('fileScanner')
      && Boolean((await db.one<{ t: string | null }>(`select to_regclass('public.attachments')::text as t`))?.t);
  });

  const mine = async (userId: string, ticketId: unknown) => typeof ticketId === 'string' && UUID_RE.test(ticketId)
    && Boolean(await db.one(`select 1 from tickets t where t.id = $2 and t.deleted_at is null and ${MINE}`, [userId, ticketId]));

  const widen = (user: SessionUser, perms: string[]): SessionUser => ({ ...user, permissions: [...user.permissions, ...perms] });

  /**
   * Must be added before the attachments module registers its routes (from `seedDefaults`):
   * the upload route lives in its own Fastify scope, which copies the hooks present when it is created.
   */
  function addHook() {
    app.addHook('preHandler', async (req: FastifyRequest) => {
      const route = req.routeOptions?.url;
      if (!req.user || (route !== UPLOAD && route !== DOWNLOAD)) return;
      if (ctx.can(req.user, 'tickets.view') || !(await isEnabled(ctx))) return;
      if (route === UPLOAD && req.method === 'PUT') {
        const q = req.query as Record<string, string>;
        if (q.record_type !== 'ticket' || !ctx.can(req.user, 'portal.create') || !(await mine(req.user.id, q.record_id))) return;
        req.user = widen(req.user, ['tickets.view', 'tickets.edit']);
      } else if (route === DOWNLOAD && req.method === 'GET') {
        const id = (req.params as Row).id;
        if (!ctx.can(req.user, 'portal.view') || typeof id !== 'string' || !UUID_RE.test(id)) return;
        const att = await db.one<Row>(
          `select record_id from attachments where id = $1 and record_type = 'ticket' and deleted_at is null and created_by = $2`, [id, req.user.id]);
        if (!att || !(await mine(req.user.id, att.record_id))) return;
        req.user = widen(req.user, ['tickets.view']);
      }
    });
  }

  /** The files the caller added to one of their requests; null when files are not available here. */
  async function forTicket(req: FastifyRequest, ticketId: string): Promise<Row[] | null> {
    if (!available) return null;
    return db.query<Row>(
      `select id, file_name, size_bytes, created_at as uploaded_at from attachments
       where record_type = 'ticket' and record_id = $1 and deleted_at is null and created_by = $2 order by created_at`,
      [ticketId, req.user!.id]);
  }

  return { addHook, forTicket, available: () => available };
}

export type PortalFiles = ReturnType<typeof makeFiles>;
