// Calendar feeds (E36-03): a person's own ICS address of the dated work they are involved in, for
// their calendar program to subscribe to.
//
// - Off until an administrator sets `feeds.calendar_enabled`; switching it off makes every feed answer
//   404 at once (feeds stay listed and come back when it is switched on again).
// - The address carries a secret of 32 random bytes (`grc_cal_...`); only its SHA-256 is kept, so it is
//   shown once, when the feed is made or its address is replaced. Making a feed or replacing its address
//   needs a recent password confirmation, like an API token (W17-3). The person can replace the address
//   (the old one stops at once) or revoke the feed; an administrator can revoke anyone's. A password
//   change or reset, or a second-factor reset, revokes the person's feeds (core/tokens.ts revokeProgramAccess).
// - Answering a feed loads its person afresh: a disabled or deleted account (or a revoked, replaced or
//   unknown address) gets the same 404, which never says which. Each source comes from the calendar
//   source registry (core/calendar.ts): its type loaded and switched on, its permission held, and every
//   event's record visible to that person now (checked again here with `visibleWhere`, whatever the
//   source did). A restricted record therefore appears only for someone holding `security.view`, and
//   then as "Restricted record" unless the feed shows titles.
// - The public route is rate limited by address. The window is 90 days back to 365 days ahead.
import { randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { loadUser } from '../../core/auth.ts';
import { calendarSources, checkedEvents } from '../../core/calendar.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';
import { makeDbLimiter } from '../../core/ratelimit.ts';
import { configuredBase, loopbackBase, trustedBase } from '../../core/identity/base.ts';
import { clientIp } from '../../core/request.ts';
import { dayInZone } from '../../core/timezone.ts';
import { tokenHash } from '../../core/tokens.ts';
import { sensitive } from '../admin/shared.ts';
import { writeCalendar, type IcsEvent } from './ics.ts';
import { addDays } from '../../../../shared/dates.ts';

export const SETTING_CALENDAR_ENABLED = 'feeds.calendar_enabled';
export const FEED_PREFIX = 'grc_cal_';
export const MAX_FEEDS_PER_PERSON = 10;
export const DAYS_BACK = 90;
export const DAYS_AHEAD = 365;
const MAX_EVENTS = 5000;
const RESTRICTED_TITLE = 'Restricted record';
const TOKEN_RE = /^grc_cal_[A-Za-z0-9_-]{43}$/;

export const calendarEnabled = async (ctx: ModuleContext) => (await ctx.settings.get<unknown>(SETTING_CALENDAR_ENABLED, false)) === true;

/**
 * The application's address as people reach it (W17-7, core/identity/base.ts): setting `auth.public_url`,
 * else the request's own host only when it names this machine (a local installation), else '' (links
 * inside a feed are then relative). A feed address itself is made only with `trustedBase`, which
 * refuses (409 `public_url_required`) on a reachable installation with no application address.
 */
export async function appBase(ctx: ModuleContext, req: FastifyRequest): Promise<string> {
  return (await configuredBase(ctx.settings)) || loopbackBase(req) || '';
}

const feedAddress = (base: string, token: string) => `${base}/api/calendar/${token}.ics`;
const newToken = () => FEED_PREFIX + randomBytes(32).toString('base64url');

interface FeedRow { id: string; user_id: string; name: string; sources: unknown; detail: 'titles' | 'busy' }

const sourceList = (v: unknown): string[] => {
  const arr = typeof v === 'string' ? JSON.parse(v) : v;
  return Array.isArray(arr) ? arr.map(String) : [];
};

/** The events of one feed for its person, already checked for visibility, sorted by start. */
export async function feedEvents(ctx: ModuleContext, user: SessionUser, feed: FeedRow, base: string, today = dayInZone(0)): Promise<IcsEvent[]> {
  const from = addDays(today, -DAYS_BACK);
  const to = addDays(today, DAYS_AHEAD);
  const wanted = new Set(sourceList(feed.sources));
  const sources = calendarSources(ctx.app, ctx.resources, user).filter((s) => wanted.has(s.key));
  // Every record is checked again (core/calendar.ts checkedEvents): its type is on, it is visible to this person now, not deleted.
  const out: IcsEvent[] = [];
  for (const { event, source, restricted } of await checkedEvents(ctx, user, sources, from, to)) {
    // busy: only what kind of date it is; restricted: never a title unless the feed shows titles.
    const title = restricted
      ? (feed.detail === 'titles' ? event.title : RESTRICTED_TITLE)
      : (feed.detail === 'titles' ? event.title : source.label);
    out.push({
      uid: `${event.uid}@sandpiper-grc`, title, start: event.start, end: event.end, allDay: event.allDay,
      url: event.url.startsWith('/') ? `${base}${event.url}` : undefined,
    });
    if (out.length >= MAX_EVENTS) break;
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.uid.localeCompare(b.uid));
}

function present(r: Row) {
  return {
    id: r.id, name: r.name, sources: sourceList(r.sources), detail: r.detail,
    created_at: r.created_at, last_used_at: r.last_used_at ?? null, revoked_at: r.revoked_at ?? null,
  };
}

export function registerCalendarFeeds(ctx: ModuleContext) {
  const { app, db } = ctx;
  const limiter = makeDbLimiter(db, 'calendar_feed', 120, 60_000); // requests a minute per address

  /** Feeds are a person's own: never through a personal access token, which acts for programs. */
  const own = (req: FastifyRequest) => {
    if (!req.user) ctx.fail(401, 'unauthorized', 'Sign in first.');
    if (req.apiToken) ctx.fail(403, 'forbidden', 'Calendar feeds are managed in the application, not with an API token.');
    return req.user!;
  };

  function checkInput(user: SessionUser, b: Row, partial: boolean) {
    const fields: Record<string, string> = {};
    const out: { name?: string; sources?: string[]; detail?: 'titles' | 'busy' } = {};
    if (!partial || b.name !== undefined) {
      const name = typeof b.name === 'string' ? b.name.trim() : '';
      if (!name) fields.name = 'Give the feed a name, for example "Work calendar".';
      else if (name.length > 100) fields.name = 'Keep the name under 100 characters.';
      else out.name = name;
    }
    if (!partial || b.sources !== undefined) {
      const allowed = new Set(calendarSources(app, ctx.resources, user).map((s) => s.key));
      const list = Array.isArray(b.sources) ? [...new Set(b.sources.map(String))] : [];
      if (!list.length) fields.sources = 'Choose at least one kind of date.';
      else if (list.some((k) => !allowed.has(k))) fields.sources = 'Choose only from the kinds of date offered.';
      else out.sources = list;
    }
    if (!partial || b.detail !== undefined) {
      const detail = b.detail ?? 'titles';
      if (detail !== 'titles' && detail !== 'busy') fields.detail = 'Choose "titles" or "busy".';
      else out.detail = detail;
    }
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    return out;
  }

  async function ownFeed(req: FastifyRequest, user: SessionUser): Promise<Row> {
    const id = (req.params as { id?: string }).id ?? '';
    const row = UUID_RE.test(id) ? await db.one<Row>('select * from calendar_feeds where id = $1 and user_id = $2 and revoked_at is null', [id, user.id]) : undefined;
    return row ?? ctx.fail(404, 'not_found', 'Calendar feed not found.');
  }

  // ---------- a person's own feeds ----------

  app.get('/api/me/calendar-feeds', async (req) => {
    const user = own(req);
    const rows = await db.query<Row>(
      'select * from calendar_feeds where user_id = $1 and revoked_at is null order by created_at', [user.id]);
    return {
      enabled: await calendarEnabled(ctx),
      sources: calendarSources(app, ctx.resources, user).map((s) => ({ key: s.key, label: s.label })),
      feeds: rows.map(present),
      maxFeeds: MAX_FEEDS_PER_PERSON,
      window: { daysBack: DAYS_BACK, daysAhead: DAYS_AHEAD },
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/me/calendar-feeds', summary: 'My calendar feeds and the kinds of date I may put in one', tag: 'Calendar feeds',
    response: '{ enabled, sources: [{ key, label }], feeds: [{ id, name, sources, detail, created_at, last_used_at }], maxFeeds, window }',
  });

  // Whether calendar feeds are switched on: the menu under the person's name offers the page only then.
  app.get('/api/me/calendar-feeds/enabled', async (req) => {
    own(req);
    return { enabled: await calendarEnabled(ctx) };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/me/calendar-feeds/enabled', summary: 'Whether calendar feeds are switched on', tag: 'Calendar feeds',
    response: '{ enabled }',
  });

  app.post('/api/me/calendar-feeds', async (req, reply) => {
    const user = own(req);
    if (!(await calendarEnabled(ctx))) ctx.fail(409, 'feeds_off', 'Calendar feeds are switched off. An administrator can switch them on.');
    const input = checkInput(user, (req.body ?? {}) as Row, false);
    const count = (await db.one<{ n: number }>('select count(*)::int as n from calendar_feeds where user_id = $1 and revoked_at is null', [user.id]))!.n;
    if (count >= MAX_FEEDS_PER_PERSON) ctx.fail(409, 'too_many', `You can have up to ${MAX_FEEDS_PER_PERSON} calendar feeds. Revoke one you no longer use first.`);
    // W17-3: a feed address is a credential for your account, like an API token: confirm the password first.
    await sensitive(ctx, req, 'making a calendar feed');
    const base = await trustedBase(ctx.settings, req); // before anything is stored (W17-7)
    const token = newToken();
    const row = (await db.one<Row>(
      `insert into calendar_feeds (user_id, name, token_hash, sources, detail) values ($1, $2, $3, $4::jsonb, $5) returning *`,
      [user.id, input.name, tokenHash(token), JSON.stringify(input.sources), input.detail]))!;
    await ctx.audit(req, {
      action: 'calendar_feed.create', recordType: 'calendar_feed', recordId: row.id,
      summary: `Calendar feed made: ${input.name}`, after: { name: input.name, sources: input.sources, detail: input.detail },
    });
    reply.code(201);
    return { ...present(row), address: feedAddress(base, token) };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/me/calendar-feeds', summary: 'Make a calendar feed; its address is shown once', tag: 'Calendar feeds',
    body: '{ name, sources: [source key], detail: "titles" | "busy" }', response: 'The feed with `address` (shown only now)',
    description: 'Needs a recent password confirmation (403 `reauth_required`). 409 `public_url_required` on an installation other computers reach while no application address (auth.public_url) is set. 409 feeds_off while an administrator has not switched calendar feeds on; 409 too_many past 10 feeds. Not with an API token.',
  });

  app.patch('/api/me/calendar-feeds/:id', async (req) => {
    const user = own(req);
    const feed = await ownFeed(req, user);
    const input = checkInput(user, (req.body ?? {}) as Row, true);
    const row = (await db.one<Row>(
      `update calendar_feeds set name = coalesce($2, name), sources = coalesce($3::jsonb, sources), detail = coalesce($4, detail)
       where id = $1 returning *`,
      [feed.id, input.name ?? null, input.sources ? JSON.stringify(input.sources) : null, input.detail ?? null]))!;
    await ctx.audit(req, {
      action: 'calendar_feed.update', recordType: 'calendar_feed', recordId: feed.id, summary: `Calendar feed changed: ${row.name}`,
      before: { name: feed.name, sources: sourceList(feed.sources), detail: feed.detail }, after: input,
    });
    return present(row);
  });
  ctx.describeRoute({
    method: 'PATCH', path: '/api/me/calendar-feeds/:id', summary: 'Rename a calendar feed or change what it shows', tag: 'Calendar feeds',
    body: '{ name?, sources?, detail? }', response: 'The feed (its address does not change)',
  });

  app.post('/api/me/calendar-feeds/:id/rotate', async (req) => {
    const user = own(req);
    const feed = await ownFeed(req, user);
    if (!(await calendarEnabled(ctx))) ctx.fail(409, 'feeds_off', 'Calendar feeds are switched off. An administrator can switch them on.');
    await sensitive(ctx, req, 'replacing a calendar feed address');
    const base = await trustedBase(ctx.settings, req);
    const token = newToken();
    const row = (await db.one<Row>('update calendar_feeds set token_hash = $2, last_used_at = null where id = $1 returning *', [feed.id, tokenHash(token)]))!;
    await ctx.audit(req, { action: 'calendar_feed.rotate', recordType: 'calendar_feed', recordId: feed.id, summary: `Calendar feed address replaced: ${feed.name}` });
    return { ...present(row), address: feedAddress(base, token) };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/me/calendar-feeds/:id/rotate', summary: 'Replace a calendar feed\'s address; the old one stops at once', tag: 'Calendar feeds',
    response: 'The feed with its new `address` (shown only now)', description: 'Needs a recent password confirmation (403 `reauth_required`).',
  });

  app.delete('/api/me/calendar-feeds/:id', async (req) => {
    const user = own(req);
    const feed = await ownFeed(req, user);
    await db.query('update calendar_feeds set revoked_at = now(), revoked_by = $2 where id = $1 and revoked_at is null', [feed.id, user.id]);
    await ctx.audit(req, { action: 'calendar_feed.revoke', recordType: 'calendar_feed', recordId: feed.id, summary: `Calendar feed revoked: ${feed.name}` });
    return { ok: true };
  });
  ctx.describeRoute({ method: 'DELETE', path: '/api/me/calendar-feeds/:id', summary: 'Revoke one of my calendar feeds', tag: 'Calendar feeds' });

  // ---------- administrators ----------

  app.get('/api/admin/calendar-feeds', { preHandler: ctx.requirePerm('admin.administer') }, async () => {
    const rows = await db.query<Row>(
      `select f.id, f.name, f.detail, f.sources, f.created_at, f.last_used_at, u.display_name as user_name, u.username, u.status as user_status
         from calendar_feeds f left join users u on u.id = f.user_id
        where f.revoked_at is null order by u.display_name, f.created_at limit 2000`);
    return {
      enabled: await calendarEnabled(ctx),
      feeds: rows.map((r) => ({ ...present(r), user_name: r.user_name ?? 'Unknown user', username: r.username ?? '', user_active: r.user_status === 'active' })),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/admin/calendar-feeds', summary: 'Everyone\'s calendar feeds that are not revoked', tag: 'Calendar feeds', permission: 'admin.administer',
    response: '{ enabled, feeds: [{ id, name, detail, sources, created_at, last_used_at, user_name, username, user_active }] }',
  });

  app.delete('/api/admin/calendar-feeds/:id', { preHandler: ctx.requirePerm('admin.administer') }, async (req) => {
    const id = (req.params as { id: string }).id;
    const feed = UUID_RE.test(id) ? await db.one<Row>('select * from calendar_feeds where id = $1 and revoked_at is null', [id]) : undefined;
    if (!feed) ctx.fail(404, 'not_found', 'Calendar feed not found.');
    await db.query('update calendar_feeds set revoked_at = now(), revoked_by = $2 where id = $1 and revoked_at is null', [feed!.id, req.user!.id]);
    await ctx.audit(req, {
      action: 'calendar_feed.revoke', recordType: 'calendar_feed', recordId: feed!.id,
      summary: `Calendar feed revoked by an administrator: ${feed!.name}`, after: { user_id: feed!.user_id },
    });
    return { ok: true };
  });
  ctx.describeRoute({ method: 'DELETE', path: '/api/admin/calendar-feeds/:id', summary: 'Revoke anyone\'s calendar feed', tag: 'Calendar feeds', permission: 'admin.administer' });

  app.get('/api/admin/feeds/settings', { preHandler: ctx.requirePerm('admin.administer') }, async () => ({
    calendarEnabled: await calendarEnabled(ctx),
  }));
  ctx.describeRoute({
    method: 'GET', path: '/api/admin/feeds/settings', summary: 'Whether calendar feeds are switched on', tag: 'Calendar feeds', permission: 'admin.administer',
    response: '{ calendarEnabled }',
  });

  app.put('/api/admin/feeds/settings', { preHandler: ctx.requirePerm('admin.administer') }, async (req) => {
    const b = (req.body ?? {}) as Row;
    if (typeof b.calendarEnabled !== 'boolean') ctx.fail(400, 'validation', 'Check the highlighted fields.', { calendarEnabled: 'Choose on or off.' });
    const current = await calendarEnabled(ctx);
    if (b.calendarEnabled !== current) {
      // Switching on publishes data at secret addresses outside a session: confirm the password first.
      if (b.calendarEnabled) await sensitive(ctx, req, 'switching calendar feeds on');
      await ctx.settings.set(SETTING_CALENDAR_ENABLED, b.calendarEnabled, req);
    }
    return { calendarEnabled: b.calendarEnabled };
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/admin/feeds/settings', summary: 'Switch calendar feeds on or off', tag: 'Calendar feeds', permission: 'admin.administer',
    body: '{ calendarEnabled: boolean }', description: 'Switching on needs a recent password confirmation. Switched off, every feed address answers 404 until it is switched on again.',
  });

  // ---------- the feed itself (public, by its secret address) ----------

  app.get('/api/calendar/:file', { config: { public: true } }, async (req, reply) => {
    const notFound = () => ctx.fail(404, 'not_found', 'Not found.');
    const claim = await limiter.take(clientIp(req));
    if (!claim.ok) ctx.fail(429, 'rate_limited', 'Too many requests. Try again in a minute.');
    const file = (req.params as { file: string }).file;
    const token = file.endsWith('.ics') ? file.slice(0, -4) : '';
    if (!TOKEN_RE.test(token) || !(await calendarEnabled(ctx))) return notFound();
    const feed = await db.one<FeedRow & { last_used_at: string | null }>(
      'select id, user_id, name, sources, detail, last_used_at from calendar_feeds where token_hash = $1 and revoked_at is null', [tokenHash(token)]);
    if (!feed) return notFound();
    const user = await loadUser(db, feed.user_id); // null for a disabled or deleted account
    if (!user) return notFound();
    const base = await appBase(ctx, req);
    const events = await feedEvents(ctx, user, feed, base);
    await db.query(`update calendar_feeds set last_used_at = now() where id = $1 and (last_used_at is null or last_used_at < now() - interval '1 minute')`, [feed.id]);
    const appName = String(await ctx.settings.get<unknown>('app.name', 'Sandpiper GRC') ?? 'Sandpiper GRC');
    const body = writeCalendar({ name: `${appName}: ${feed.name}`, prodId: '-//Sandpiper GRC//Calendar feed//EN', events });
    return reply
      .header('cache-control', 'private, max-age=300')
      .header('x-robots-tag', 'noindex')
      .header('content-disposition', 'inline; filename="calendar.ics"')
      .type('text/calendar; charset=utf-8')
      .send(body);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/calendar/:file', summary: 'A calendar feed (ICS) by its secret address, /api/calendar/<secret>.ics', tag: 'Calendar feeds', public: true,
    response: 'text/calendar',
    description: 'No session: the secret in the address is the credential. 404 not_found, always the same, for an unknown, revoked or replaced address, a disabled account, or while calendar feeds are switched off. 429 rate_limited past 120 requests a minute from one address. Events from 90 days ago to 365 days ahead, only what the feed\'s person may see now; a restricted record shows as "Restricted record" unless the feed shows titles.',
  });
}
