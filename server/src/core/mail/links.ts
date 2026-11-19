// Set-up and reset links by email (E14-05).
//
//  - "Forgot your password?": anyone may ask for a reset link for a username or email address.
//    The answer is the same whether or not the account exists, requests are rate-limited by
//    source address and by account, and nothing is sent while email is switched off.
//  - Links an administrator issues (new user, new set-up link, reset link) are also emailed to
//    the person when email is on. The administrator is still shown the link, as before.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomToken, sha256 } from '../auth.ts';
import { UUID_RE } from '../errors.ts';
import type { ModuleContext, Row } from '../module.ts';
import { makeDbLimiter } from '../ratelimit.ts';
import { clientIp } from '../request.ts';
import { TIME_ZONE } from '../timezone.ts';
import { EMAIL_RE, type MailService } from './service.ts';

export const RESET_MINUTES_SETTING = 'auth.reset_link_minutes';
export const FORGOT_MESSAGE = 'If that matches an account with an email address, a link to set a new password is on its way. Check your inbox, and your junk folder. The link works once.';

const when = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TIME_ZONE });
export const expiresText = (at: string | Date) => `on ${when.format(new Date(at))} (${TIME_ZONE})`;

/** The admin routes that issue a link, and where the user id and the link are in their answer. */
const ADMIN_LINK_ROUTES: Record<string, { userId: (req: FastifyRequest, body: Row) => unknown; link: (body: Row) => unknown; purpose: (body: Row) => unknown }> = {
  'POST /api/admin/users': { userId: (_r, b) => b.user?.id, link: (b) => b.setupLink, purpose: () => 'setup' },
  'POST /api/admin/users/:id/setup-link': { userId: (r) => (r.params as Row).id, link: (b) => b.link, purpose: () => 'setup' },
  'POST /api/admin/users/:id/reset-link': { userId: (r) => (r.params as Row).id, link: (b) => b.link, purpose: (b) => b.purpose },
};

export function registerAccountLinks(ctx: ModuleContext, mail: MailService) {
  const { app, db } = ctx;
  // Counted on every request, in the database (shared by processes, kept over a restart).
  const byAddress = makeDbLimiter(db, 'forgot_ip', 5, 15 * 60_000);
  const byAccount = makeDbLimiter(db, 'forgot_user', 3, 60 * 60_000);

  async function emailLink(userId: string, purpose: 'setup' | 'reset', link: string, expiresAt: string | Date, extra: Row = {}) {
    const u = await db.one<Row>(`select id, username, email from users where id = $1 and deleted_at is null and status <> 'disabled'`, [userId]);
    if (!u || !EMAIL_RE.test(String(u.email ?? ''))) return null;
    // Sent to this one address, whatever its roles: queueOne skips the role-based recipient lookup.
    await mail.queueOne(
      { template: purpose === 'setup' ? 'setup_link' : 'reset_link', purpose: purpose === 'setup' ? 'setup_link' : 'reset_link', data: { username: u.username, link, expiresAt: expiresText(expiresAt), ...extra } },
      { userId: u.id, to: u.email },
      { accountLink: true },
      { maxAttempts: 3 },
    );
    return u.email as string;
  }

  // ---------- forgot password ----------

  app.get('/api/auth/forgot-password', { config: { public: true } }, async () => ({ available: await mail.enabled() }));
  ctx.describeRoute({ method: 'GET', path: '/api/auth/forgot-password', tag: 'Session', public: true, summary: 'Whether reset links can be sent by email', response: '{ available }' });

  app.post('/api/auth/forgot-password', { config: { public: true } }, async (req) => {
    const ip = clientIp(req);
    if (await byAddress.blocked(ip)) ctx.fail(429, 'rate_limited', 'Too many requests from here. Wait a few minutes and try again.');
    await byAddress.hit(ip);
    const identifier = String(((req.body ?? {}) as Row).identifier ?? '').trim().slice(0, 254);
    if (!identifier) ctx.fail(400, 'validation', 'Check the highlighted fields.', { identifier: 'Enter your username or email address.' });

    const generic = { ok: true, message: FORGOT_MESSAGE };
    const u = await db.one<Row>(
      `select id, username, email, status from users
       where deleted_at is null and status <> 'disabled' and (lower(username) = lower($1) or lower(email) = lower($1))
       order by (lower(username) = lower($1)) desc limit 1`,
      [identifier],
    );
    if (!u) {
      await ctx.audit(req, { action: 'password.reset_request', summary: `Password reset asked for an unknown or disabled account from ${ip}` });
      return generic;
    }
    if (!(await mail.enabled()) || !EMAIL_RE.test(String(u.email ?? ''))) {
      await ctx.audit(req, { action: 'password.reset_request', recordType: 'user', recordId: u.id, summary: `Password reset asked for ${u.username} from ${ip}; not sent (email is off or the account has no address)` });
      return generic;
    }
    if (await byAccount.blocked(u.id)) {
      await ctx.audit(req, { action: 'password.reset_request', recordType: 'user', recordId: u.id, summary: `Password reset asked for ${u.username} from ${ip}; not sent (too many requests for this account)` });
      return generic;
    }
    await byAccount.hit(u.id);

    const minutes = Math.min(24 * 60, Math.max(15, Math.round(Number(await ctx.settings.get(RESET_MINUTES_SETTING, 60))) || 60));
    const purpose = u.status === 'pending' ? 'setup' : 'reset';
    const token = randomToken();
    // Replaces earlier self-service links (created_by is null), never one an administrator issued.
    await db.query('update one_time_tokens set used_at = now() where user_id = $1 and used_at is null and created_by is null', [u.id]);
    const row = await db.one<{ expires_at: string }>(
      `insert into one_time_tokens (token_hash, user_id, purpose, expires_at) values ($1, $2, $3, now() + make_interval(mins => $4::int)) returning expires_at`,
      [sha256(token), u.id, purpose, minutes],
    );
    await emailLink(u.id, purpose, `/redeem?token=${token}`, row!.expires_at);
    await ctx.audit(req, { action: 'password.reset_request', recordType: 'user', recordId: u.id, summary: `Password ${purpose} link emailed to ${u.username} at their request from ${ip}` });
    return generic;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/auth/forgot-password', tag: 'Session', public: true, summary: 'Ask for a password reset link by email',
    description: 'Always answers the same way whether or not the account exists. Limited to 5 requests in 15 minutes from one address and 3 links an hour for one account.',
    body: '{ identifier: username or email address }', response: '{ ok, message }',
  });

  // ---------- links an administrator issues ----------

  app.addHook('onSend', async (req: FastifyRequest, reply: FastifyReply, payload: unknown) => {
    const route = ADMIN_LINK_ROUTES[`${req.method} ${req.routeOptions?.url ?? ''}`];
    if (!route || reply.statusCode >= 300 || typeof payload !== 'string') return payload;
    try {
      const body = JSON.parse(payload) as Row;
      const userId = route.userId(req, body);
      const link = route.link(body);
      const purpose = route.purpose(body) === 'reset' ? 'reset' : 'setup';
      if (typeof userId !== 'string' || !UUID_RE.test(userId) || typeof link !== 'string' || !link.startsWith('/redeem?token=')) return payload;
      if (!(await mail.enabled())) return payload; // the administrator passes the link on, as before
      const to = await emailLink(userId, purpose, link, body.expiresAt ?? new Date(Date.now() + 24 * 3600_000));
      if (to) await ctx.audit(req, { action: 'user.link_emailed', recordType: 'user', recordId: userId, summary: `One-time ${purpose} link emailed to ${to}` });
      return JSON.stringify({ ...body, emailedTo: to });
    } catch (err) {
      console.error('[mail] could not email the link:', err);
      return payload;
    }
  });
}
