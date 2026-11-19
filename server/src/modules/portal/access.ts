// Who may use the portal, and which tickets are "mine".
//
// The portal shows a person only the tickets where they are the requester or the affected
// person, never internal comments, and never anyone else's tickets. People who hold only the
// Requester role have no `tickets.*` permission at all, so every agent route (lists, one ticket,
// search, stats, exports, comments, history, attachments) refuses them; the portal routes are
// the only way in, and every one of them goes through `needOwnTicket` or the `MINE` condition.
import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { isEnabled } from './settings.ts';

/** SQL condition for "this ticket is mine": `$1` is the user's id. */
export const MINE = '(t.requester_id = $1 or t.affected_user_id = $1)';

export function makeAccess(ctx: ModuleContext) {
  /** preHandler: the portal is switched on and the caller holds the permission. */
  const need = (perm: 'portal.view' | 'portal.create') => async (req: FastifyRequest) => {
    if (!req.user) ctx.fail(401, 'unauthenticated', 'Sign in to continue.');
    if (!ctx.resources.get('ticket') || !(await isEnabled(ctx))) ctx.fail(404, 'portal_off', 'The self-service portal is switched off.');
    if (!ctx.can(req.user, perm)) ctx.fail(403, 'forbidden', 'You do not have permission to do that.');
  };

  /** One of the caller's own tickets. Someone else's ticket answers "not found", exactly like a missing one. */
  async function needOwnTicket(req: FastifyRequest, id: unknown): Promise<Row> {
    const row = typeof id === 'string' && UUID_RE.test(id)
      ? await ctx.db.one<Row>(`select t.* from tickets t where t.id = $2 and t.deleted_at is null and ${MINE}`, [req.user!.id, id])
      : undefined;
    return row ?? ctx.fail(404, 'not_found', 'Request not found.');
  }

  return { need, needOwnTicket };
}

export type Access = ReturnType<typeof makeAccess>;
