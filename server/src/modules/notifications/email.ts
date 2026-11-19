// The daily email summary, for people who chose "one summary a day" (E14-04).
//
// Notifications they asked to receive by email wait with email_state = 'digest'. Once a day,
// from the hour set in `notifications.digest_hour` (organization time zone, default 7), this
// job sends each such person one message listing them. Each item is checked again: a record
// the person can no longer open is left out, and a restricted one is listed only as "a new
// security notification" with no title. The job runs hourly on the queue; running it more
// often sends nothing twice.
import type { ModuleContext, Row } from '../../core/module.ts';
import { TIME_ZONE, todayInZone } from '../../core/timezone.ts';
import { activeUsers, maySee } from './service.ts';

export const SETTING_DIGEST_HOUR = 'notifications.digest_hour';
const MAX_ITEMS = 50;
const RESTRICTED_ITEM = 'A new security notification — open the application to view it';

const hourFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: TIME_ZONE });

export interface EmailDigestResult { people: number; messages: number; items: number }

export async function runEmailDigest(ctx: ModuleContext, now = new Date()): Promise<EmailDigestResult> {
  const out = { people: 0, messages: 0, items: 0 };
  if (!ctx.app.hasDecorator('sendMail') || !(await ctx.app.mailEnabled())) return out;
  const hour = Math.min(23, Math.max(0, Math.round(Number(await ctx.settings.get<unknown>(SETTING_DIGEST_HOUR, 7))) || 0));
  if (Number(hourFormat.format(now)) < hour) return out;
  const today = todayInZone(now);

  const waiting = await ctx.db.query<{ user_id: string }>(
    `select distinct n.user_id from notifications n join notification_preferences p on p.user_id = n.user_id
     where n.email_state = 'digest' and (p.last_digest_on is null or p.last_digest_on < $1::date)`,
    [today],
  );
  if (!waiting.length) return out;
  const users = new Map((await activeUsers(ctx)).map((u) => [u.id, u]));

  for (const { user_id } of waiting) {
    out.people += 1;
    const rows = await ctx.db.query<Row>(
      `select id, title, route, record_type, record_id from notifications where user_id = $1 and email_state = 'digest' order by created_at`,
      [user_id],
    );
    const user = users.get(user_id);
    const items: { title: string; link: string | null }[] = [];
    if (user) {
      for (const n of rows) {
        if (!n.record_type) { items.push({ title: n.title, link: n.route }); continue; }
        const def = ctx.resources.get(n.record_type);
        if (!def || !(await maySee(ctx, user, def, n.record_id))) continue; // no longer theirs to see
        const row = await ctx.resources.find(def.type, n.record_id, null);
        const restricted = def.restricted === true || (def.restricted === 'flag' && row?.restricted === true);
        items.push(restricted ? { title: RESTRICTED_ITEM, link: '/notifications' } : { title: n.title, link: n.route });
      }
    }
    // Claim the day first, so a second process (or a second run) does not send it again.
    const claimed = await ctx.db.one(
      `update notification_preferences set last_digest_on = $2::date where user_id = $1 and (last_digest_on is null or last_digest_on < $2::date) returning user_id`,
      [user_id, today],
    );
    if (!claimed) continue;
    await ctx.db.query(`update notifications set email_state = 'digested' where id = any($1::uuid[])`, [rows.map((r) => r.id)]);
    if (!items.length) continue;
    const shown = items.slice(0, MAX_ITEMS);
    if (items.length > MAX_ITEMS) shown.push({ title: `and ${items.length - MAX_ITEMS} more`, link: '/notifications' });
    const res = await ctx.app.sendMail({
      userIds: [user_id], template: 'digest', purpose: 'digest', items: shown,
      data: { count: items.length, link: '/notifications' },
    });
    out.messages += res.queued;
    out.items += items.length;
  }
  return out;
}
