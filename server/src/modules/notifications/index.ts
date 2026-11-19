// In-app notifications: the `app.notify` service other modules call (see service.ts), each
// person's list with read state and preferences, and the daily digest (see digest.ts).
import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleDef, Row } from '../../core/module.ts';
import { runDigest } from './digest.ts';
import { makeNotify, maySee, safeRoute } from './service.ts';

const KIND_LIST = 'notification_kind';
const HOUR = 3_600_000;

const mod: ModuleDef = {
  key: 'notifications',

  async seedDefaults(ctx) {
    await ctx.lookups.ensure(KIND_LIST, [
      { value: 'assignment', label: 'Assigned to me', color: 'blue', sort: 10, meta: { description: 'Work that has been given to you.' } },
      { value: 'approval', label: 'Approvals', color: 'purple', sort: 20, meta: { description: 'Something is waiting for your decision.' } },
      { value: 'due', label: 'Due dates', color: 'amber', sort: 30, meta: { description: 'Your actions and decisions that are due soon or overdue.' } },
      { value: 'sla', label: 'Service-level targets', color: 'orange', sort: 40, meta: { description: 'Your tickets that are close to their target time.' } },
      { value: 'reminder', label: 'Reminders', color: 'teal', sort: 50, meta: { description: 'Dates set on records, such as contract notice dates.' } },
      { value: 'acknowledgement', label: 'Acknowledgements', color: 'green', sort: 60, meta: { description: 'You have been asked to read and acknowledge something.' } },
      { value: 'clock', label: 'Notification clocks', color: 'red', sort: 70, meta: { description: 'A deadline to notify someone outside the organisation is close or has passed.' } },
      { value: 'general', label: 'Other', color: 'gray', sort: 90, meta: { description: 'Anything that does not fit the kinds above.' } },
    ], { public: true }); // everyone has notifications, so everyone may read the kinds
  },

  async register(ctx) {
    const { app, db } = ctx;
    const notify = makeNotify(ctx);
    // Guarded so that building the module twice on one instance cannot fail.
    if (!app.hasDecorator('notify')) app.decorate('notify', notify);

    const me = (req: FastifyRequest) => req.user!.id;
    const unreadCount = async (userId: string) =>
      (await db.one<{ c: number }>('select count(*)::int c from notifications where user_id = $1 and read_at is null', [userId]))!.c;

    // ---------- my notifications ----------

    app.get('/api/notifications', async (req) => {
      const q = req.query as Record<string, string>;
      const pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 20));
      const page = Math.max(1, Number(q.page) || 1);
      const where = `user_id = $1${q.unread === 'true' ? ' and read_at is null' : ''}`;
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
      const row = await db.one<{ muted_kinds: string[]; daily_digest: boolean }>(
        'select muted_kinds, daily_digest from notification_preferences where user_id = $1', [userId],
      );
      const muted = Array.isArray(row?.muted_kinds) ? row!.muted_kinds : [];
      return {
        kinds: kinds.map((k) => ({
          value: k.value, label: k.label, color: k.color ?? 'gray',
          description: typeof k.meta?.description === 'string' ? k.meta.description : '',
          enabled: !muted.includes(k.value),
        })),
        dailyDigest: row?.daily_digest ?? false,
        // Email is not built: the digest choice is stored for when it is.
        emailAvailable: false,
      };
    }

    app.get('/api/notifications/preferences', async (req) => preferences(me(req)));

    app.patch('/api/notifications/preferences', async (req) => {
      const b = (req.body ?? {}) as Row;
      const before = await preferences(me(req));
      const known = new Set(before.kinds.map((k) => k.value));
      const fields: Record<string, string> = {};
      let muted = before.kinds.filter((k) => !k.enabled).map((k) => k.value);
      if (b.kinds !== undefined) {
        if (typeof b.kinds !== 'object' || b.kinds === null || Array.isArray(b.kinds)) fields.kinds = 'Send the kinds as { kind: true or false }.';
        else {
          const unknown = Object.keys(b.kinds).filter((k) => !known.has(k));
          const notBoolean = Object.entries(b.kinds).filter(([, v]) => typeof v !== 'boolean').map(([k]) => k);
          if (unknown.length) fields.kinds = `Unknown kind: ${unknown.join(', ')}.`;
          else if (notBoolean.length) fields.kinds = `Use true or false for: ${notBoolean.join(', ')}.`;
          else {
            const set = new Set(muted);
            for (const [k, on] of Object.entries(b.kinds as Record<string, boolean>)) { if (on) set.delete(k); else set.add(k); }
            muted = [...set].sort();
          }
        }
      }
      if (b.dailyDigest !== undefined && typeof b.dailyDigest !== 'boolean') fields.dailyDigest = 'Daily digest must be true or false.';
      if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
      const dailyDigest = b.dailyDigest ?? before.dailyDigest;

      const was = { muted: before.kinds.filter((k) => !k.enabled).map((k) => k.value).sort(), dailyDigest: before.dailyDigest };
      const now = { muted, dailyDigest };
      if (JSON.stringify(was) !== JSON.stringify(now)) {
        await db.query(
          `insert into notification_preferences (user_id, muted_kinds, daily_digest) values ($1, $2::jsonb, $3)
           on conflict (user_id) do update set muted_kinds = excluded.muted_kinds, daily_digest = excluded.daily_digest, updated_at = now()`,
          [me(req), JSON.stringify(muted), dailyDigest],
        );
        await ctx.audit(req, {
          action: 'notification.preferences', recordType: 'user', recordId: me(req),
          summary: 'Notification preferences changed', before: was, after: now,
        });
      }
      return preferences(me(req));
    });

    // ---------- daily digest ----------

    app.post('/api/notifications/digest/run', { preHandler: ctx.requirePerm('admin.administer') }, async () => runDigest(ctx, notify));

    // No timers under the test runner or with a throwaway in-memory database.
    if (!process.env.VITEST && process.env.GRC_DATA_DIR !== 'memory') {
      const safeRun = () => { runDigest(ctx, notify).catch((err) => console.error('[notifications] digest failed:', err)); };
      const first = setTimeout(safeRun, 60_000);
      const timer = setInterval(safeRun, HOUR);
      first.unref();
      timer.unref();
      app.addHook('onClose', async () => { clearTimeout(first); clearInterval(timer); });
    }
  },
};
export default mod;
