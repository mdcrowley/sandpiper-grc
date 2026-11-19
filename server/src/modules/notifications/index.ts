// Notifications: the `app.notify` service other modules call (see service.ts), each person's
// list with read state and preferences, the daily reminders (digest.ts) and the daily email
// summary (email.ts).
//
// This module also starts two core services in its seedDefaults (so they exist before any
// module's register runs): the background job queue (`app.jobs`, core/jobs) and outbound
// email (`app.sendMail`, core/mail). Both are idempotent; if core starts them itself, nothing
// changes here.
import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import { ensureJobs } from '../../core/jobs/index.ts';
import { ensureMail } from '../../core/mail/index.ts';
import type { ModuleDef, Row } from '../../core/module.ts';
import { runDigest } from './digest.ts';
import { runEmailDigest } from './email.ts';
import { channelFor, CHANNELS, makeNotify, maySee, safeRoute, type Channel } from './service.ts';

const KIND_LIST = 'notification_kind';
const HOUR = 3_600_000;

const mod: ModuleDef = {
  key: 'notifications',

  async seedDefaults(ctx) {
    await ensureJobs(ctx);
    await ensureMail(ctx);
    await ctx.lookups.ensure(KIND_LIST, [
      { value: 'assignment', label: 'Assigned to me', color: 'blue', sort: 10, meta: { description: 'Work that has been given to you.' } },
      { value: 'approval', label: 'Approvals', color: 'purple', sort: 20, meta: { description: 'Something is waiting for your decision.' } },
      { value: 'due', label: 'Due dates', color: 'amber', sort: 30, meta: { description: 'Your actions and decisions that are due soon or overdue.' } },
      { value: 'sla', label: 'Service-level targets', color: 'orange', sort: 40, meta: { description: 'Your tickets that are close to their target time.' } },
      { value: 'reminder', label: 'Reminders', color: 'teal', sort: 50, meta: { description: 'Dates set on records, such as contract notice dates.' } },
      { value: 'acknowledgement', label: 'Acknowledgements', color: 'green', sort: 60, meta: { description: 'You have been asked to read and acknowledge something.' } },
      { value: 'clock', label: 'Notification clocks', color: 'red', sort: 70, meta: { description: 'A deadline to notify someone outside the organisation is close or has passed.' } },
      { value: 'watch', label: 'Records I watch', color: 'gray', sort: 80, meta: { description: 'A record you watch has changed status or has a new comment.' } },
      { value: 'general', label: 'Other', color: 'gray', sort: 90, meta: { description: 'Anything that does not fit the kinds above.' } },
    ], { public: true }); // everyone has notifications, so everyone may read the kinds
  },

  async register(ctx) {
    const { app, db } = ctx;
    const jobs = await ensureJobs(ctx);
    await ensureMail(ctx);
    const notify = makeNotify(ctx);
    // Guarded so that building the module twice on one instance cannot fail.
    if (!app.hasDecorator('notify')) app.decorate('notify', notify);

    const me = (req: FastifyRequest) => req.user!.id;
    const unreadCount = async (userId: string) =>
      (await db.one<{ c: number }>('select count(*)::int c from notifications where user_id = $1 and in_app and read_at is null', [userId]))!.c;

    // ---------- my notifications ----------

    app.get('/api/notifications', async (req) => {
      const q = req.query as Record<string, string>;
      const pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 20));
      const page = Math.max(1, Number(q.page) || 1);
      const where = `user_id = $1 and in_app${q.unread === 'true' ? ' and read_at is null' : ''}`;
      const total = (await db.one<{ c: number }>(`select count(*)::int c from notifications where ${where}`, [me(req)]))!.c;
      const found = await db.query<Row>(
        `select id, kind, title, body, route, record_type, record_id, created_at, read_at from notifications
         where ${where} order by created_at desc, id limit ${pageSize} offset ${(page - 1) * pageSize}`,
        [me(req)],
      );
      // Access is checked again at reading time: if the record has since been restricted,
      // removed, or the reader's role has changed, the notification no longer names it.
      const rows: Row[] = [];
      for (const n of found) {
        const def = n.record_type ? ctx.resources.get(n.record_type) : undefined;
        const hidden = n.record_type !== null && !(def && (await maySee(ctx, req.user!, def, n.record_id)));
        rows.push(hidden
          ? { ...n, title: 'A record you can no longer open', body: null, route: null, record_type: null, record_id: null, unavailable: true }
          : { ...n, route: safeRoute(n.route), unavailable: false });
      }
      return { rows, total, page, pageSize, unread: await unreadCount(me(req)) };
    });

    app.get('/api/notifications/unread-count', async (req) => ({ unread: await unreadCount(me(req)) }));

    // Read state is a personal view setting, not business data: it is not written to the audit log.
    app.post('/api/notifications/read-all', async (req) => {
      const rows = await db.query('update notifications set read_at = now() where user_id = $1 and read_at is null returning id', [me(req)]);
      return { ok: true, marked: rows.length, unread: 0 };
    });

    app.post('/api/notifications/:id/read', async (req) => {
      const id = (req.params as { id: string }).id;
      // Someone else's notification is "not found", exactly like one that does not exist.
      const row = UUID_RE.test(id)
        ? await db.one<Row>(
          'update notifications set read_at = coalesce(read_at, now()) where id = $1 and user_id = $2 returning id, read_at', [id, me(req)],
        )
        : undefined;
      if (!row) ctx.fail(404, 'not_found', 'Notification not found.');
      return { ok: true, id: row!.id, read_at: row!.read_at, unread: await unreadCount(me(req)) };
    });

    // ---------- preferences ----------

    async function preferences(userId: string) {
      const kinds = await ctx.lookups.values(KIND_LIST);
      const row = await db.one<{ muted_kinds: string[]; daily_digest: boolean; channels: Record<string, string> }>(
        'select muted_kinds, daily_digest, channels from notification_preferences where user_id = $1', [userId],
      );
      const pref = { muted: Array.isArray(row?.muted_kinds) ? row!.muted_kinds : [], channels: row?.channels ?? {} };
      const email = await db.one<{ email: string }>('select email from users where id = $1', [userId]);
      return {
        kinds: kinds.map((k) => {
          const channel = channelFor(pref, k.value);
          return {
            value: k.value, label: k.label, color: k.color ?? 'gray',
            description: typeof k.meta?.description === 'string' ? k.meta.description : '',
            enabled: channel !== 'none', channel,
          };
        }),
        dailyDigest: row?.daily_digest ?? false,
        emailAvailable: await app.mailEnabled(),
        emailAddress: email?.email ?? null,
        digestHour: Math.min(23, Math.max(0, Math.round(Number(await ctx.settings.get<unknown>('notifications.digest_hour', 7))) || 0)),
      };
    }

    app.get('/api/notifications/preferences', async (req) => preferences(me(req)));

    app.patch('/api/notifications/preferences', async (req) => {
      const b = (req.body ?? {}) as Row;
      const before = await preferences(me(req));
      const known = new Set(before.kinds.map((k) => k.value));
      const fields: Record<string, string> = {};
      const channels: Record<string, Channel> = Object.fromEntries(before.kinds.map((k) => [k.value, k.channel]));
      const objectOf = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v);
      if (b.kinds !== undefined) {
        if (!objectOf(b.kinds)) fields.kinds = 'Send the kinds as { kind: true or false }.';
        else {
          const unknown = Object.keys(b.kinds).filter((k) => !known.has(k));
          const notBoolean = Object.entries(b.kinds).filter(([, v]) => typeof v !== 'boolean').map(([k]) => k);
          if (unknown.length) fields.kinds = `Unknown kind: ${unknown.join(', ')}.`;
          else if (notBoolean.length) fields.kinds = `Use true or false for: ${notBoolean.join(', ')}.`;
          else {
            for (const [k, on] of Object.entries(b.kinds as Record<string, boolean>)) {
              if (!on) channels[k] = 'none';
              else if (channels[k] === 'none') channels[k] = 'app';
            }
          }
        }
      }
      if (b.channels !== undefined) {
        if (!objectOf(b.channels)) fields.channels = 'Send the channels as { kind: "app", "email", "both" or "none" }.';
        else {
          const unknown = Object.keys(b.channels).filter((k) => !known.has(k));
          const bad = Object.entries(b.channels).filter(([, v]) => !(CHANNELS as readonly unknown[]).includes(v)).map(([k]) => k);
          if (unknown.length) fields.channels = `Unknown kind: ${unknown.join(', ')}.`;
          else if (bad.length) fields.channels = `Use app, email, both or none for: ${bad.join(', ')}.`;
          else Object.assign(channels, b.channels);
        }
      }
      if (b.dailyDigest !== undefined && typeof b.dailyDigest !== 'boolean') fields.dailyDigest = 'Daily digest must be true or false.';
      if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
      const dailyDigest = b.dailyDigest ?? before.dailyDigest;

      // The audit shape: muted kinds and the digest choice, plus the kinds sent by email when there are any.
      const summary = (ch: Record<string, Channel>, digest: boolean) => {
        const email = Object.entries(ch).filter(([, c]) => c === 'email' || c === 'both').map(([k, c]) => `${k}:${c}`).sort();
        return { muted: Object.entries(ch).filter(([, c]) => c === 'none').map(([k]) => k).sort(), dailyDigest: digest, ...(email.length ? { email } : {}) };
      };
      const was = summary(Object.fromEntries(before.kinds.map((k) => [k.value, k.channel])), before.dailyDigest);
      const now = summary(channels, dailyDigest);
      if (JSON.stringify(was) !== JSON.stringify(now)) {
        // Only choices that differ from the default (the bell) are stored.
        const stored = Object.fromEntries(Object.entries(channels).filter(([, c]) => c !== 'app'));
        await db.query(
          `insert into notification_preferences (user_id, muted_kinds, daily_digest, channels) values ($1, $2::jsonb, $3, $4::jsonb)
           on conflict (user_id) do update set muted_kinds = excluded.muted_kinds, daily_digest = excluded.daily_digest,
             channels = excluded.channels, updated_at = now()`,
          [me(req), JSON.stringify(now.muted), dailyDigest, JSON.stringify(stored)],
        );
        await ctx.audit(req, {
          action: 'notification.preferences', recordType: 'user', recordId: me(req),
          summary: 'Notification preferences changed', before: was, after: now,
        });
      }
      return preferences(me(req));
    });

    // ---------- scheduled work, on the job queue ----------

    jobs.register('notifications.reminders', async () => runDigest(ctx, notify), { maxAttempts: 3 });
    jobs.register('notifications.email_digest', async () => runEmailDigest(ctx), { maxAttempts: 3 });
    await jobs.schedule('notifications.reminders', { type: 'notifications.reminders', every: HOUR, firstRunInMs: 60_000 });
    await jobs.schedule('notifications.email_digest', { type: 'notifications.email_digest', every: HOUR, firstRunInMs: 5 * 60_000 });

    app.post('/api/notifications/digest/run', { preHandler: ctx.requirePerm('admin.administer') }, async () => runDigest(ctx, notify));
    app.post('/api/notifications/email-digest/run', { preHandler: ctx.requirePerm('admin.administer') }, async () => runEmailDigest(ctx));
    ctx.describeRoute({ method: 'POST', path: '/api/notifications/digest/run', permission: 'admin.administer', summary: 'Raise the daily reminders now (actions due, tickets near their target)' });
    ctx.describeRoute({ method: 'POST', path: '/api/notifications/email-digest/run', permission: 'admin.administer', summary: 'Send the daily email summaries that are due now' });
  },
};
export default mod;
