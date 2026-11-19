import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';

// Action extras: the source implied by a record type, "assigned to you" notifications, and
// deliberate sharing of one restricted action with a person who lacks security.view (E08-16).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Value of the `action_source` list that fits a record type, used when a caller gives none. */
const SOURCE_BY_TYPE: Record<string, string> = {
  risk: 'risk',
  security_incident: 'incident', notification_task: 'incident',
  framework: 'assessment', framework_outcome: 'assessment', assessment_snapshot: 'assessment',
  exercise: 'exercise',
  project: 'project',
  change: 'change',
  vulnerability: 'vulnerability',
  policy: 'policy', policy_exception: 'policy',
  course: 'training',
  vendor: 'vendor', contract: 'vendor', evidence_item: 'vendor',
  problem: 'problem',
};

export function makeActionExtras(ctx: ModuleContext) {
  const notify = async (input: Parameters<typeof ctx.app.notify>[0]) =>
    (ctx.app.hasDecorator('notify') ? ctx.app.notify(input) : { sent: 0, skipped: 0 });

  /** The source list value for a record type, when that value is an active one. */
  async function sourceFor(sourceType: unknown): Promise<string | undefined> {
    const wanted = SOURCE_BY_TYPE[String(sourceType ?? '')] ?? String(sourceType ?? '');
    return (await ctx.lookups.values('action_source')).some((v) => v.value === wanted) ? wanted : undefined;
  }

  /**
   * Tells a person an action is now theirs. Due-soon and overdue reminders are not sent from
   * here: the notifications module's daily digest already sends those to every action owner.
   * Someone who assigns an action to themselves is not told, and an owner who may not see a
   * restricted action is skipped by the notification service.
   */
  async function notifyAssigned(req: FastifyRequest | null, action: Row): Promise<void> {
    if (!action.owner_id || action.owner_id === req?.user?.id) return;
    await notify({
      userIds: [action.owner_id], kind: 'assignment',
      title: `Action assigned to you: ${action.title}`,
      body: action.due_on ? `Due ${action.due_on}.` : null,
      recordType: 'action', recordId: action.id,
    });
  }

  const SHARED_COLUMNS = `a.id, a.ref, a.title, a.description, a.status, a.priority, a.owner_id, a.due_on::text as due_on,
    a.completed_on::text as completed_on, a.notes, a.department, a.updated_at, o.display_name as owner_name, b.display_name as shared_by`;
  const SHARED_FROM = `from action_shares s
    join actions a on a.id = s.action_id and a.deleted_at is null and coalesce(a.restricted, false)
    left join users o on o.id = a.owner_id
    left join users b on b.id = s.created_by`;

  /** What a sharee sees: the action itself, never the record it arose from. */
  async function sharedShape(rows: Row[]): Promise<Row[]> {
    const statuses = await ctx.lookups.values('action_status');
    const priorities = await ctx.lookups.values('action_priority');
    const label = (list: typeof statuses, v: unknown) => list.find((x) => x.value === v)?.label ?? (v as string | null);
    return rows.map(({ owner_name, ...r }) => ({
      ...r, shared: true,
      _display: { status: label(statuses, r.status), priority: label(priorities, r.priority), owner_id: owner_name ?? null },
    }));
  }

  function register(): void {
    const { app, db } = ctx;
    const visibleAction = async (req: FastifyRequest) =>
      (await ctx.resources.find('action', (req.params as { id: string }).id, req.user)) ?? ctx.fail(404, 'not_found', 'Action not found.');

    app.get('/api/actions/:id/shares', { preHandler: ctx.requirePerm('actions.view') }, async (req) => {
      const action = await visibleAction(req);
      const shares = await db.query<Row>(
        `select s.user_id, u.display_name as name, b.display_name as shared_by, s.created_at
         from action_shares s join users u on u.id = s.user_id left join users b on b.id = s.created_by
         where s.action_id = $1 order by u.display_name`, [action.id]);
      return { restricted: action.restricted === true, shares };
    });

    app.post('/api/actions/:id/shares', { preHandler: ctx.requirePerm('actions.edit') }, async (req, reply) => {
      const action = await visibleAction(req);
      if (action.restricted !== true) ctx.fail(400, 'not_restricted', 'This action is not restricted, so everyone who can see the action tracker can already see it.');
      const userId = String((req.body as Row | null)?.user_id ?? '');
      const target = UUID.test(userId)
        ? await db.one<Row>(`select id, display_name from users where id = $1 and status = 'active' and deleted_at is null`, [userId])
        : undefined;
      if (!target) ctx.fail(400, 'validation', 'Check the highlighted fields.', { user_id: 'Choose an active user.' });
      const added = await db.one(
        `insert into action_shares (action_id, user_id, created_by) values ($1,$2,$3) on conflict do nothing returning user_id`,
        [action.id, target!.id, req.user!.id]);
      if (added) {
        await ctx.audit(req, {
          action: 'action.share', recordType: 'action', recordId: action.id,
          summary: `Restricted action ${action.ref} shared with ${target!.display_name}`, after: { user_id: target!.id },
        });
        // No record is named: the notification service would refuse to tell someone about a record they cannot open.
        await notify({ userIds: [target!.id], kind: 'assignment', title: 'A restricted action has been shared with you', route: '/actions/mine' });
      }
      reply.code(201);
      return { user_id: target!.id, name: target!.display_name };
    });

    app.delete('/api/actions/:id/shares/:userId', { preHandler: ctx.requirePerm('actions.edit') }, async (req) => {
      const action = await visibleAction(req);
      const userId = (req.params as { userId: string }).userId;
      const removed = UUID.test(userId)
        ? await db.one('delete from action_shares where action_id = $1 and user_id = $2 returning user_id', [action.id, userId])
        : undefined;
      if (!removed) ctx.fail(404, 'not_found', 'That person does not have this action shared with them.');
      await ctx.audit(req, {
        action: 'action.unshare', recordType: 'action', recordId: action.id,
        summary: `Restricted action ${action.ref} no longer shared with one person`, before: { user_id: userId },
      });
      return { ok: true };
    });

    // ---- the sharee's side: only what was shared with the caller, and never its source record

    app.get('/api/actions/shared-with-me', { preHandler: ctx.requirePerm('actions.view') }, async (req) =>
      sharedShape(await db.query<Row>(`select ${SHARED_COLUMNS} ${SHARED_FROM} where s.user_id = $1 order by a.due_on nulls last, a.ref`, [req.user!.id])));

    const sharedWithCaller = async (req: FastifyRequest): Promise<Row> => {
      const id = (req.params as { id: string }).id;
      const row = UUID.test(id)
        ? await db.one<Row>(`select ${SHARED_COLUMNS} ${SHARED_FROM} where s.user_id = $1 and a.id = $2`, [req.user!.id, id])
        : undefined;
      return row ?? ctx.fail(404, 'not_found', 'Action not found.');
    };

    app.get('/api/actions/shared/:id', { preHandler: ctx.requirePerm('actions.view') }, async (req) =>
      (await sharedShape([await sharedWithCaller(req)]))[0]);

    app.patch('/api/actions/shared/:id', { preHandler: ctx.requirePerm('actions.edit') }, async (req) => {
      const before = await sharedWithCaller(req);
      const body = (req.body ?? {}) as Row;
      const patch: Row = {};
      for (const k of ['status', 'notes']) if (body[k] !== undefined) patch[k] = body[k];
      const refused = Object.keys(body).filter((k) => !(k in patch));
      if (refused.length) {
        ctx.fail(400, 'validation', 'On an action shared with you, only the status and the notes can be changed.',
          Object.fromEntries(refused.map((k) => [k, 'This cannot be changed on a shared action.'])));
      }
      if (Object.keys(patch).length) {
        // The caller cannot see the record under the restricted-record rules, so the change is
        // made as system work (validated and audited by the engine) and attributed here.
        await ctx.resources.update('action', before.id, patch);
        await ctx.audit(req, {
          action: 'action.shared_update', recordType: 'action', recordId: before.id,
          summary: `Shared action ${before.ref} updated by a person it is shared with`,
          before: Object.fromEntries(Object.keys(patch).map((k) => [k, before[k]])), after: patch,
        });
      }
      return (await sharedShape([await sharedWithCaller(req)]))[0];
    });
  }

  return { sourceFor, notifyAssigned, register };
}
