// The notification service: `app.notify(...)`.
//
// Any module raises a notification with one guarded line and no import of this module:
//
//   if (ctx.app.hasDecorator('notify')) {
//     await ctx.app.notify({ userIds: [ticket.assignee_id], kind: 'assignment',
//       title: `Ticket assigned to you: ${ticket.title}`, recordType: 'ticket', recordId: ticket.id });
//   }
//
// Recipients: `userIds`, and/or everyone whose roles grant `permission` (the two are combined).
// Only active users receive anything. When `recordType` and `recordId` are given, a recipient
// who may not see that record gets nothing, so a notification can never reveal a restricted
// record; the link defaults to the record's page. For something that is not a record, leave
// them out and pass `route` (an in-app path beginning with "/").
// `kind` is a value of the configurable list `notification_kind`; each person can switch
// kinds off, or choose for each kind the bell, email, both or nothing (`notification_preferences.channels`).
// When email is on and chosen, a message is queued at once, or the notification waits for the
// person's daily summary (email.ts); a restricted record is never described in an email.
// `oncePerDay` skips anyone who already received this kind for this record today.
// The call never throws: a failure is logged and reported as nothing sent.
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, ResourceDef, Row, SessionUser } from '../../core/module.ts';

export interface NotifyInput {
  /** People to notify, by user id. Unknown, pending and disabled users are ignored. */
  userIds?: (string | null | undefined)[];
  /** Also notify everyone holding this permission, for example "security.view". */
  permission?: string;
  /** A value of the `notification_kind` list: assignment, approval, due, sla, reminder, acknowledgement, clock, watch, general. */
  kind: string;
  /** One line, shown in the bell and the list. Write it for the recipient. */
  title: string;
  /** Optional second line. */
  body?: string | null;
  /** The record this is about. Recipients who may not see it are skipped. */
  recordType?: string;
  recordId?: string;
  /** In-app path to open. Defaults to the record's page. */
  route?: string;
  /** Skip recipients who already have this kind for this record (or this title) today. */
  oncePerDay?: boolean;
}

export interface NotifyResult { sent: number; skipped: number }

export const CHANNELS = ['app', 'email', 'both', 'none'] as const;
export type Channel = (typeof CHANNELS)[number];
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

/** How one kind reaches a person: their choice, else "none" if they muted it, else the bell only. */
export function channelFor(pref: { muted: string[]; channels: Record<string, string> } | undefined, kind: string): Channel {
  const chosen = pref?.channels?.[kind];
  if ((CHANNELS as readonly string[]).includes(chosen as string)) return chosen as Channel;
  return pref?.muted.includes(kind) ? 'none' : 'app';
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Present when the notifications module is loaded: guard with `app.hasDecorator('notify')`. */
    notify(input: NotifyInput): Promise<NotifyResult>;
  }
}

const KIND_RE = /^[a-z][a-z0-9_]{0,39}$/;

/** An in-app path, or null: never a link that leaves the application. */
export function safeRoute(route: unknown): string | null {
  const r = typeof route === 'string' ? route.trim() : '';
  return /^\/(?!\/)[^\s\\]*$/.test(r) && r.length <= 500 ? r : null;
}

/** Every active user with the permissions their enabled roles grant (as core loads a session user). */
export async function activeUsers(ctx: ModuleContext): Promise<SessionUser[]> {
  const rows = await ctx.db.query<Row>(
    `select u.id, u.username, u.display_name, u.email,
        coalesce(array_agg(distinct r.key) filter (where r.enabled), '{}') as roles,
        coalesce(array_agg(distinct rp.permission) filter (where r.enabled and rp.permission is not null), '{}') as permissions
     from users u
     left join user_roles ur on ur.user_id = u.id
     left join roles r on r.id = ur.role_id
     left join role_permissions rp on rp.role_id = r.id
     where u.status = 'active' and u.deleted_at is null
     group by u.id`,
  );
  return rows.map((r) => ({
    id: r.id, username: r.username, displayName: r.display_name, email: r.email, roles: r.roles, permissions: r.permissions,
  }));
}

/** Whether `user` may see this record now: the module's view permission and the restricted-record rules. */
export async function maySee(ctx: ModuleContext, user: SessionUser, def: ResourceDef, id: string): Promise<boolean> {
  if (!ctx.can(user, `${def.module}.view`)) return false;
  if (def.restricted === true && !ctx.can(user, 'security.view')) return false;
  return (await ctx.resources.find(def.type, id, user)) !== undefined;
}

export function makeNotify(ctx: ModuleContext) {
  async function deliver(input: NotifyInput): Promise<NotifyResult> {
    const title = String(input.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    const body = input.body ? String(input.body).trim().slice(0, 1000) || null : null;
    const kind = KIND_RE.test(String(input.kind ?? '')) ? input.kind : 'general';
    if (!title) return { sent: 0, skipped: 0 };

    const ids = new Set((input.userIds ?? []).filter((i): i is string => typeof i === 'string' && UUID_RE.test(i)));
    const permission = typeof input.permission === 'string' && input.permission ? input.permission : null;
    if (!ids.size && !permission) return { sent: 0, skipped: 0 };
    const targets = (await activeUsers(ctx)).filter((u) => ids.has(u.id) || (permission !== null && ctx.can(u, permission)));
    if (!targets.length) return { sent: 0, skipped: 0 };

    let def: ResourceDef | undefined;
    let recordId: string | null = null;
    let route = safeRoute(input.route);
    if (input.recordType !== undefined || input.recordId !== undefined) {
      def = typeof input.recordType === 'string' ? ctx.resources.get(input.recordType) : undefined;
      if (!def || typeof input.recordId !== 'string' || !UUID_RE.test(input.recordId)) {
        // Without a known record nobody's access can be checked, so nobody is told.
        console.warn(`[notifications] not sent: unknown record ${String(input.recordType)}/${String(input.recordId)}`);
        return { sent: 0, skipped: targets.length };
      }
      recordId = input.recordId;
      route ??= `${def.route}/${recordId}`;
    }

    const prefs = new Map<string, { muted: string[]; channels: Record<string, string>; digest: boolean }>();
    for (const p of await ctx.db.query<{ user_id: string; muted_kinds: string[]; channels: Record<string, string>; daily_digest: boolean }>(
      'select user_id, muted_kinds, channels, daily_digest from notification_preferences where user_id = any($1::uuid[])', [targets.map((u) => u.id)],
    )) {
      prefs.set(p.user_id, {
        muted: Array.isArray(p.muted_kinds) ? p.muted_kinds : [],
        channels: p.channels && typeof p.channels === 'object' ? p.channels : {},
        digest: p.daily_digest === true,
      });
    }
    const mailOn = ctx.app.hasDecorator('sendMail') && (await ctx.app.mailEnabled());
    let kindLabel: string | undefined;

    const already = new Set<string>();
    if (input.oncePerDay) {
      const rows = def
        ? await ctx.db.query<{ user_id: string }>(
          `select user_id from notifications where kind = $1 and record_type = $2 and record_id = $3 and created_at >= current_date`,
          [kind, def.type, recordId],
        )
        : await ctx.db.query<{ user_id: string }>(
          `select user_id from notifications where kind = $1 and record_type is null and title = $2 and created_at >= current_date`,
          [kind, title],
        );
      for (const r of rows) already.add(r.user_id);
    }

    let sent = 0;
    for (const user of targets) {
      const pref = prefs.get(user.id);
      const channel = channelFor(pref, kind);
      if (channel === 'none' || already.has(user.id)) continue;
      if (def && !(await maySee(ctx, user, def, recordId!))) continue;
      // Email, if chosen and possible; otherwise the bell, so that nothing is lost.
      const wantsEmail = channel === 'email' || channel === 'both';
      const canEmail = wantsEmail && mailOn && EMAIL_RE.test(String(user.email ?? ''));
      const inApp = channel !== 'email' || !canEmail;
      const emailState = !wantsEmail ? null : !canEmail ? 'skipped' : pref?.digest ? 'digest' : 'queued';
      await ctx.db.query(
        `insert into notifications (user_id, kind, title, body, route, record_type, record_id, in_app, email_state) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [user.id, kind, title, body, route, def?.type ?? null, recordId, inApp, emailState],
      );
      if (emailState === 'queued') {
        kindLabel ??= (await ctx.lookups.values('notification_kind')).find((k) => k.value === kind)?.label ?? 'Other';
        // What the recipient may see is checked again when the message is sent; a restricted
        // record gets the content-free security message (core/mail/service.ts).
        await ctx.app.sendMail({
          userIds: [user.id], template: 'notification', purpose: 'notification',
          data: { title, body, kindLabel, link: route ?? '/notifications' },
          record: def ? { type: def.type, id: recordId! } : undefined,
        });
      }
      sent += 1;
    }
    if (sent) {
      // The title stays out of the audit summary: the record it names may be restricted.
      await ctx.audit(null, {
        action: 'notification.send', recordType: def?.type, recordId: recordId ?? undefined,
        summary: `Notification (${kind}) sent to ${sent} ${sent === 1 ? 'person' : 'people'}`,
      });
    }
    return { sent, skipped: targets.length - sent };
  }

  return async function notify(input: NotifyInput): Promise<NotifyResult> {
    try {
      return await deliver(input ?? ({} as NotifyInput));
    } catch (err) {
      console.error('[notifications] notify failed:', err);
      return { sent: 0, skipped: 0 };
    }
  };
}
