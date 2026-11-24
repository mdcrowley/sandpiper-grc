// Operational alerts (E40-04): background work that keeps failing is told to the administrators,
// in the application and by email, once per problem until it clears.
//
//   const alerts = makeOpsAlerts(ctx);
//   await alerts.raise('webhook:<id>', { title: 'Webhook "Ticket feed" keeps failing', detail: '...', route: '/admin/webhooks' });
//   await alerts.clear(['webhook:<id>']);
//
// A problem is a row of `ops_alerts`, by key. `raise` opens it (or reopens one that cleared) and
// tells every holder of `admin.administer` once: the notification is claimed with a conditional
// update, so two server processes never both send it. Raising an open problem again only records
// that it was seen. Every opening and clearing is audited (actions `ops.alert` and `ops.alert_clear`).
// What is told says which part is failing and where to look; never a person's name, an address or
// a message's content (those stay on the page it links to).
import type { ModuleContext, Row } from '../module.ts';

export interface OpsAlertInput {
  /** One line: what is wrong. */
  title: string;
  /** A second line: since when, how often, what to do. No personal data. */
  detail?: string;
  /** The in-app page that shows the problem. */
  route?: string;
}

export interface OpsAlerts {
  /** Opens the problem (told once) or records that it is still there. Returns true when it was told now. */
  raise(key: string, input: OpsAlertInput): Promise<boolean>;
  /** Clears these problems (those still open). Returns the keys cleared. */
  clear(keys: string[]): Promise<string[]>;
  /** Clears every open problem whose key starts with `prefix` and is not in `still`. */
  clearExcept(prefix: string, still: Iterable<string>): Promise<string[]>;
  /** The open problems, newest first. */
  open(): Promise<Row[]>;
}

const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export function makeOpsAlerts(ctx: Pick<ModuleContext, 'app' | 'db' | 'audit'>): OpsAlerts {
  const { app, db } = ctx;

  async function tell(key: string, input: OpsAlertInput) {
    const title = clip(input.title, 200);
    const body = input.detail ? clip(input.detail, 900) : null;
    const route = input.route && /^\/(?!\/)/.test(input.route) ? input.route : '/admin/jobs';
    if (app.hasDecorator('notify')) {
      await app.notify({ permission: 'admin.administer', kind: 'general', title, body, route });
    }
    // By email as well, whatever each administrator chose for the bell: a failure nobody reads
    // about in time is the problem this solves. When email itself is what fails, the bell remains.
    if (app.hasDecorator('sendMail')) {
      await app.sendMail({
        permission: 'admin.administer', template: 'message', purpose: 'alerts',
        data: { subject: title, message: [body, 'This alert is sent once; it is sent again only if the problem clears and comes back.'].filter(Boolean).join('\n\n'), link: route },
      });
    }
    await ctx.audit(null, { action: 'ops.alert', recordType: 'ops_alert', recordId: key, summary: `Administrators alerted: ${title}` });
  }

  return {
    async raise(key, input) {
      const k = clip(key, 200);
      await db.query(
        `insert into ops_alerts (key, title, detail, route) values ($1, $2, $3, $4)
         on conflict (key) do update set
           title = excluded.title, detail = excluded.detail, route = excluded.route, last_seen_at = now(),
           opened_at = case when ops_alerts.cleared_at is null then ops_alerts.opened_at else now() end,
           notified_at = case when ops_alerts.cleared_at is null then ops_alerts.notified_at else null end,
           occurrences = ops_alerts.occurrences + case when ops_alerts.cleared_at is null then 0 else 1 end,
           cleared_at = null`,
        [k, clip(input.title, 200), input.detail ? clip(input.detail, 900) : null, input.route ?? null],
      );
      // Whoever sets notified_at tells the administrators; another process's update matches nothing.
      const claimed = await db.one(`update ops_alerts set notified_at = now() where key = $1 and notified_at is null and cleared_at is null returning key`, [k]);
      if (!claimed) return false;
      try {
        await tell(k, input);
      } catch (err) {
        // Not told: try again on the next check.
        await db.query('update ops_alerts set notified_at = null where key = $1', [k]).catch(() => undefined);
        throw err;
      }
      return true;
    },

    async clear(keys) {
      if (!keys.length) return [];
      const rows = await db.query<{ key: string; title: string }>(
        `update ops_alerts set cleared_at = now() where key = any($1::text[]) and cleared_at is null returning key, title`, [keys],
      );
      for (const r of rows) {
        await ctx.audit(null, { action: 'ops.alert_clear', recordType: 'ops_alert', recordId: r.key, summary: `Cleared: ${r.title}` });
      }
      return rows.map((r) => r.key);
    },

    async clearExcept(prefix, still) {
      const keep = [...still];
      const open = await db.query<{ key: string }>(
        `select key from ops_alerts where cleared_at is null and starts_with(key, $1) and not (key = any($2::text[]))`, [prefix, keep],
      );
      return this.clear(open.map((r) => r.key));
    },

    open: () => db.query<Row>(
      `select key, title, detail, route, opened_at, last_seen_at, notified_at, occurrences from ops_alerts where cleared_at is null order by opened_at desc limit 100`,
    ),
  };
}
