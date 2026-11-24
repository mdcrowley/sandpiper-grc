// Confidential safety reporting, and telling the reporter what was done (E41-05).
//
// A reporter may ask for their identity to be kept confidential. The event row then never holds it:
// `reported_by_id` stays empty, the record is created as the application's own work (so neither
// "Created by" nor the history's first entry names the reporter), and the reporter is kept apart in
// `safety_confidential_reporters`. Lists, record pages, exports, fact sheets, search, reports,
// webhooks, imports and the assistant read the event row, so none of them can show it. Only the
// people an administrator names (`safety_confidential_viewers`, Administration > Confidential safety
// reports) may see who made the report, through GET /api/safety-events/:id/reporter, and every look
// is audited on the event's history (without the name).
//
// When an event with a reporter closes, the reporter is told in plain words what was done: the
// "What the reporter is told" text (`reporter_outcome`) is needed to close it, the reporter gets a
// notification, and the portal's "My safety reports" shows the text.
import type { FastifyRequest } from 'fastify';
import { requireRecentAuth } from '../../core/auth.ts';
import type { Queryable } from '../../core/db.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';

const MAX_VIEWERS = 25;

/** Active people with the permissions their enabled roles grant (as a session user is loaded). */
async function people(ctx: ModuleContext, ids: string[] | null): Promise<SessionUser[]> {
  const rows = await ctx.db.query<Row>(
    `select u.id, u.username, u.display_name, u.email,
        coalesce(array_agg(distinct r.key) filter (where r.enabled), '{}') as roles,
        coalesce(array_agg(distinct rp.permission) filter (where r.enabled and rp.permission is not null), '{}') as permissions
     from users u
     left join user_roles ur on ur.user_id = u.id
     left join roles r on r.id = ur.role_id
     left join role_permissions rp on rp.role_id = r.id
     where u.status = 'active' and u.deleted_at is null and ($1::uuid[] is null or u.id = any($1::uuid[]))
     group by u.id order by u.display_name`, [ids]);
  return rows.map((r) => ({ id: r.id, username: r.username, displayName: r.display_name, email: r.email, roles: r.roles, permissions: r.permissions }) as SessionUser);
}

/** The confidential reporter of one event: undefined when none is kept, `null` user for an anonymous report. */
export async function confidentialReporter(db: Queryable, eventId: string): Promise<{ user_id: string | null } | undefined> {
  return (await db.query<{ user_id: string | null }>('select user_id from safety_confidential_reporters where event_id = $1', [eventId]))[0];
}

/** Keeps the reporter of a confidential report apart from the event (inside the event's own save). */
export async function keepReporterApart(db: Queryable, eventId: string, userId: string | null): Promise<void> {
  await db.query(
    `insert into safety_confidential_reporters (event_id, user_id) values ($1, $2)
     on conflict (event_id) do update set user_id = excluded.user_id`, [eventId, userId]);
}

/** Removes the confidential reporter at the end of the retention period (with the event's own anonymizing). */
export async function forgetConfidentialReporter(db: Queryable, eventId: string): Promise<number> {
  return (await db.query('delete from safety_confidential_reporters where event_id = $1 returning 1', [eventId])).length;
}

/** The person to tell when an event closes: its reporter, kept on the event or apart. */
export async function reporterOf(db: Queryable, event: Row): Promise<string | null> {
  if (event.confidential_reporter) return (await confidentialReporter(db, event.id))?.user_id ?? null;
  return typeof event.reported_by_id === 'string' ? event.reported_by_id : null;
}

export function registerConfidential(ctx: ModuleContext) {
  const { app, db } = ctx;
  const TAG = 'Safety';
  const mayBeNamed = (u: SessionUser) => ctx.can(u, 'safety.view');

  async function viewerIds(): Promise<string[]> {
    return (await db.query<{ user_id: string }>('select user_id from safety_confidential_viewers order by added_at')).map((r) => r.user_id);
  }

  /** Whether this person may see confidential reporters now: named, and still holding safety.view. */
  async function isNamed(user: SessionUser): Promise<boolean> {
    if (!mayBeNamed(user)) return false;
    return Boolean(await db.one('select 1 from safety_confidential_viewers where user_id = $1', [user.id]));
  }

  async function state(user: SessionUser) {
    const ids = await viewerIds();
    const found = ids.length ? await people(ctx, ids) : [];
    const admin = ctx.can(user, 'safety.administer');
    return {
      viewers: ids.map((id) => {
        const p = found.find((u) => u.id === id);
        return { id, label: p?.displayName ?? 'Inactive or removed user', eligible: Boolean(p && mayBeNamed(p)) };
      }),
      named: await isNamed(user),
      eligible: admin ? (await people(ctx, null)).filter(mayBeNamed).map((u) => ({ id: u.id, label: u.displayName })) : undefined,
      can_administer: admin,
    };
  }

  app.get('/api/safety/confidential-viewers', { preHandler: ctx.requirePerm('safety.view') }, async (req) => state(req.user!));
  ctx.describeRoute({
    method: 'GET', path: '/api/safety/confidential-viewers', tag: TAG, permission: 'safety.view',
    summary: 'The people named to see who made a confidential safety report, and whether I am one of them',
    response: '{ viewers: [{ id, label, eligible }], named, eligible?: [{ id, label }] (administrators), can_administer }',
  });

  app.put('/api/safety/confidential-viewers', { preHandler: ctx.requirePerm('safety.administer') }, async (req) => {
    const b = (req.body ?? {}) as Row;
    const before = await viewerIds();
    if (!Array.isArray(b.viewers) || b.viewers.some((x: unknown) => typeof x !== 'string' || !UUID_RE.test(x))) {
      ctx.fail(400, 'validation', 'Check the highlighted fields.', { viewers: 'Choose people from the list.' });
    }
    const ids = [...new Set(b.viewers as string[])];
    if (ids.length > MAX_VIEWERS) ctx.fail(400, 'validation', 'Check the highlighted fields.', { viewers: `Name at most ${MAX_VIEWERS} people.` });
    const added = ids.filter((id) => !before.includes(id));
    const removed = before.filter((id) => !ids.includes(id));
    if (!added.length && !removed.length) return state(req.user!);
    // People already named who have since lost access may stay (they cannot see anything until they have it again).
    const found = added.length ? await people(ctx, added) : [];
    if (added.some((id) => !found.some((u) => u.id === id && mayBeNamed(u)))) {
      ctx.fail(400, 'validation', 'Check the highlighted fields.', { viewers: 'Only active people who can see safety events can be named.' });
    }
    // Naming someone lets them see who reported: confirm who is asking first.
    if (added.length) await requireRecentAuth({ db, audit: ctx.audit, settings: ctx.settings }, req, 'name people who may see confidential safety reporters');
    // The change and its audit event are saved together.
    const save = async () => {
      if (removed.length) await db.query('delete from safety_confidential_viewers where user_id = any($1::uuid[])', [removed]);
      for (const id of added) await db.query('insert into safety_confidential_viewers (user_id, added_by) values ($1, $2) on conflict do nothing', [id, req.user!.id]);
      const names = added.map((id) => found.find((u) => u.id === id)?.displayName ?? id);
      await ctx.audit(req, {
        action: 'safety.confidential_viewers',
        summary: `People who may see confidential safety reporters changed${added.length ? `; added: ${names.join(', ')}` : ''}${removed.length ? `; ${removed.length} removed` : ''}`,
        before: { viewers: before }, after: { viewers: ids },
      });
    };
    await (db.atomic ? db.atomic(save) : save());
    return state(req.user!);
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/safety/confidential-viewers', tag: TAG, permission: 'safety.administer',
    summary: 'Name the people who may see who made a confidential safety report',
    description: `Replaces the list. Each person must be active and hold \`safety.view\`; at most ${MAX_VIEWERS}. Adding anyone needs a recent password confirmation (403 \`reauth_required\`). Audited.`,
    body: '{ viewers: [uuid] }',
    response: '{ viewers: [{ id, label, eligible }], named, eligible?, can_administer }',
  });

  /** Who made a confidential report: named people only, and every look is recorded on the event's history. */
  app.get('/api/safety-events/:id/reporter', { preHandler: ctx.requirePerm('safety.view') }, async (req: FastifyRequest) => {
    const event = (await ctx.resources.find('safety_event', (req.params as { id: string }).id, req.user)) ?? ctx.fail(404, 'not_found', 'Safety event not found.');
    if (!event.confidential_reporter) return { confidential: false };
    if (!(await isNamed(req.user!))) {
      ctx.fail(403, 'not_named', 'The reporter asked for their identity to be kept confidential. Only the people your organization names can see it.');
    }
    const kept = await confidentialReporter(db, event.id);
    const person = kept?.user_id
      ? await db.one<Row>('select id, display_name, email, status from users where id = $1', [kept.user_id])
      : undefined;
    await ctx.audit(req, {
      action: 'safety_event.reporter_view', recordType: 'safety_event', recordId: event.id,
      summary: `Confidential reporter's identity viewed (${event.ref})`,
    });
    return {
      confidential: true,
      reporter: person ? { id: person.id, name: person.display_name, email: person.email ?? null, active: person.status === 'active' } : null,
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/safety-events/:id/reporter', tag: TAG, permission: 'safety.view',
    summary: 'Who made a confidential safety report (named people only; every look is audited)',
    description: 'Answers `{ confidential: false }` for an event whose reporter is not confidential (its reporter is the `reported_by_id` field). For a confidential one, only people named under Administration > Confidential safety reports who hold `safety.view` get an answer (others 403 `not_named`); each answer writes `safety_event.reporter_view` to the event\'s history. `reporter` is null for an anonymous report.',
    response: '{ confidential, reporter?: { id, name, email, active } | null }',
  });
}
