import type { FastifyRequest } from 'fastify';
import {
  acceptTotpCode, checkPasswordPolicy, consumeRecoveryCode, mfaStatus, recoveryCodeHash, setPassword, sha256,
  storeTotpSecret, verifyPassword,
} from '../../core/auth.ts';
import { DEFAULT_APP_NAME } from '../../core/config.ts';
import type { ModuleContext } from '../../core/module.ts';
import { makeDbLimiter } from '../../core/ratelimit.ts';
import { clientIp } from '../../core/request.ts';
import { generateTotpSecret, totpUri } from '../../core/totp.ts';
import { body, generateRecoveryCodes } from './shared.ts';

const BAD_LINK = 'This link is not valid or has expired. Ask an administrator for a new one.';
const BAD_CODE = 'That code was not accepted. Check it and try again.';

/** Routes for the person themself: one-time links (public), second factor, own sessions. */
export function registerAccount(ctx: ModuleContext) {
  const { db, app } = ctx;
  const deps = { db, audit: ctx.audit, settings: ctx.settings };
  // Kept in the database, so a restart does not reset them.
  const linkFailures = makeDbLimiter(db, 'link', 20, 5 * 60_000); // by source address
  const codeFailures = makeDbLimiter(db, 'mfa_change', 8, 5 * 60_000); // by user

  // ---------- one-time setup and reset links ----------

  const findToken = (token: unknown) =>
    db.one<{ token_hash: string; purpose: string; user_id: string; username: string }>(
      `select t.token_hash, t.purpose, t.user_id, u.username from one_time_tokens t
       join users u on u.id = t.user_id and u.deleted_at is null and u.status <> 'disabled'
       where t.token_hash = $1 and t.used_at is null and t.expires_at > now()`,
      [sha256(typeof token === 'string' ? token : '')],
    );

  const minLength = () => ctx.settings.get('auth.password_min_length', 14);

  app.get('/api/auth/redeem', { config: { public: true } }, async (req) => {
    if (await linkFailures.blocked(clientIp(req))) ctx.fail(429, 'rate_limited', BAD_LINK);
    const t = await findToken((req.query as Record<string, string>).token);
    if (!t) {
      await linkFailures.hit(clientIp(req));
      return { valid: false, minLength: await minLength() };
    }
    return { valid: true, username: t.username, purpose: t.purpose, minLength: await minLength() };
  });

  app.post('/api/auth/redeem', { config: { public: true } }, async (req) => {
    const b = body(req);
    if (await linkFailures.blocked(clientIp(req))) ctx.fail(429, 'rate_limited', BAD_LINK);
    const reject = async (userId?: string): Promise<never> => {
      await linkFailures.hit(clientIp(req));
      await ctx.audit(req, {
        action: 'link.redeem_failure', recordType: 'user', recordId: userId,
        summary: `A one-time link was refused (invalid, used or expired) from ${req.ip}`,
      });
      return ctx.fail(400, 'invalid_link', BAD_LINK);
    };
    const t = await findToken(b.token);
    if (!t) return reject();

    const problem = await checkPasswordPolicy(deps, b.password, { id: t.user_id, username: t.username });
    if (problem) ctx.fail(400, 'validation', 'Check the highlighted fields.', { password: problem });

    // Claim the token first so two requests cannot both use it.
    const claimed = await db.one(
      'update one_time_tokens set used_at = now() where token_hash = $1 and used_at is null returning user_id', [t.token_hash],
    );
    if (!claimed) return reject(t.user_id);
    await setPassword(deps, t.user_id, b.password); // also activates a pending account and clears any lockout
    const ended = await db.query('delete from sessions where user_id = $1 returning 1', [t.user_id]);
    await ctx.audit(req, {
      action: t.purpose === 'setup' ? 'password.setup' : 'password.reset', recordType: 'user', recordId: t.user_id,
      summary: `${t.username} set a password with a one-time ${t.purpose} link from ${req.ip}; ${ended.length} session(s) ended`,
    });
    return { ok: true };
  });

  // ---------- second factor (authenticator app) ----------

  const me = (req: FastifyRequest) =>
    db.one<{ id: string; username: string; password_hash: string | null; has_secret: boolean; totp_enabled: boolean; codes: number; password_changed_at: string }>(
      `select id, username, password_hash, (totp_secret is not null) as has_secret, totp_enabled,
              jsonb_array_length(recovery_codes) as codes, password_changed_at
       from users where id = $1`,
      [req.user!.id],
    ).then((u) => u!);

  const limited = async (req: FastifyRequest) => {
    if (await codeFailures.blocked(req.user!.id)) ctx.fail(429, 'rate_limited', 'Too many attempts. Wait a few minutes and try again.');
  };

  /** Checks the current password; counts and audits a failure. */
  async function requirePassword(req: FastifyRequest, u: { password_hash: string | null }, password: unknown, what: string) {
    await limited(req);
    if (!u.password_hash || !(await verifyPassword(u.password_hash, String(password ?? '')))) {
      await codeFailures.hit(req.user!.id);
      await ctx.audit(req, { action: 'mfa.change_refused', recordType: 'user', recordId: req.user!.id, summary: `${what} refused: wrong password` });
      ctx.fail(400, 'validation', 'Check the highlighted fields.', { password: 'That is not your current password.' });
    }
  }

  async function storeNewCodes(userId: string): Promise<string[]> {
    const codes = generateRecoveryCodes();
    await db.query('update users set recovery_codes = $2::jsonb, updated_at = now() where id = $1', [userId, JSON.stringify(codes.map(recoveryCodeHash))]);
    return codes;
  }

  app.get('/api/auth/security', async (req) => {
    const u = await me(req);
    const mfa = await mfaStatus(deps, u.id);
    return {
      totpEnabled: u.totp_enabled,
      recoveryCodesLeft: u.totp_enabled ? u.codes : 0,
      mfaEnrollmentRequired: mfa.required,
      mfaEnrollmentBlocked: mfa.blocked,
      mfaGraceEndsAt: mfa.graceEndsAt,
      passwordChangedAt: u.password_changed_at,
      minLength: await minLength(),
    };
  });

  app.post('/api/auth/totp/begin', async (req) => {
    const u = await me(req);
    if (u.totp_enabled) ctx.fail(409, 'already_enabled', 'A second factor is already set up. Turn it off first to replace it.');
    const secret = generateTotpSecret();
    // Held as pending (totp_enabled stays false) until a code proves the app has the key.
    // Stored encrypted (core/secretbox.ts); this response is the only time the key is shown.
    await storeTotpSecret(db, u.id, secret);
    await ctx.audit(req, { action: 'mfa.enrol_begin', recordType: 'user', recordId: u.id, summary: 'Second-factor set-up started' });
    const issuer = await ctx.settings.get('app.name', DEFAULT_APP_NAME);
    return { secret, uri: totpUri(secret, u.username, issuer) };
  });

  app.post('/api/auth/totp/confirm', async (req) => {
    const u = await me(req);
    if (u.totp_enabled) ctx.fail(409, 'already_enabled', 'A second factor is already set up.');
    if (!u.has_secret) ctx.fail(409, 'not_started', 'Start the set-up again to get a new key.');
    await limited(req);
    if (!(await acceptTotpCode(db, u.id, String(body(req).code ?? '')))) {
      await codeFailures.hit(u.id);
      ctx.fail(400, 'validation', 'Check the highlighted fields.', { code: BAD_CODE });
    }
    await db.query('update users set totp_enabled = true, mfa_required_since = null, updated_at = now() where id = $1', [u.id]);
    const recoveryCodes = await storeNewCodes(u.id);
    await ctx.audit(req, {
      action: 'mfa.enable', recordType: 'user', recordId: u.id, summary: 'Second factor (authenticator app) turned on; recovery codes issued',
      before: { totp_enabled: false }, after: { totp_enabled: true },
    });
    return { ok: true, recoveryCodes }; // shown once; only hashes are kept
  });

  app.post('/api/auth/totp/disable', async (req) => {
    const u = await me(req);
    if (!u.totp_enabled) ctx.fail(409, 'not_enabled', 'No second factor is set up.');
    const b = body(req);
    await requirePassword(req, u, b.password, 'Turning off the second factor');
    const code = String(b.code ?? '').trim();
    if (!(await acceptTotpCode(db, u.id, code)) && !(await consumeRecoveryCode(db, u.id, code))) {
      await codeFailures.hit(u.id);
      await ctx.audit(req, { action: 'mfa.change_refused', recordType: 'user', recordId: u.id, summary: 'Turning off the second factor refused: wrong code' });
      ctx.fail(400, 'validation', 'Check the highlighted fields.', { code: BAD_CODE });
    }
    await db.query(`update users set totp_enabled = false, totp_secret = null, totp_last_step = null, recovery_codes = '[]', updated_at = now() where id = $1`, [u.id]);
    await ctx.audit(req, {
      action: 'mfa.disable', recordType: 'user', recordId: u.id, summary: 'Second factor turned off by the user',
      before: { totp_enabled: true }, after: { totp_enabled: false },
    });
    return { ok: true };
  });

  app.post('/api/auth/totp/recovery-codes', async (req) => {
    const u = await me(req);
    if (!u.totp_enabled) ctx.fail(409, 'not_enabled', 'Set up a second factor first.');
    await requirePassword(req, u, body(req).password, 'New recovery codes');
    const recoveryCodes = await storeNewCodes(u.id);
    await ctx.audit(req, { action: 'mfa.recovery_codes', recordType: 'user', recordId: u.id, summary: 'Recovery codes replaced; the old ones no longer work' });
    return { ok: true, recoveryCodes };
  });

  // ---------- own sessions ----------

  // The session token hash never leaves the server; the public id is a hash of it.
  const publicId = (tokenHash: string) => sha256(`session:${tokenHash}`).slice(0, 24);
  const mySessions = (req: FastifyRequest) =>
    db.query<{ token_hash: string; created_at: string; last_seen_at: string; expires_at: string; ip: string | null; user_agent: string | null }>(
      'select token_hash, created_at, last_seen_at, expires_at, ip, user_agent from sessions where user_id = $1 and expires_at > now() order by last_seen_at desc',
      [req.user!.id],
    );

  app.get('/api/auth/sessions', async (req) =>
    (await mySessions(req)).map(({ token_hash, ...s }) => ({ id: publicId(token_hash), ...s, current: token_hash === req.sessionHash })));

  app.delete('/api/auth/sessions/:id', async (req) => {
    const target = (await mySessions(req)).find((s) => publicId(s.token_hash) === (req.params as Record<string, string>).id);
    if (!target) ctx.fail(404, 'not_found', 'Session not found.');
    await db.query('delete from sessions where token_hash = $1', [target!.token_hash]);
    await ctx.audit(req, {
      action: 'session.end', recordType: 'user', recordId: req.user!.id,
      summary: `Ended ${target!.token_hash === req.sessionHash ? 'this session' : `a session from ${target!.ip ?? 'an unknown address'}`}`,
    });
    return { ok: true };
  });

  app.post('/api/auth/sessions/end-others', async (req) => {
    const ended = await db.query('delete from sessions where user_id = $1 and token_hash <> $2 returning 1', [req.user!.id, req.sessionHash]);
    await ctx.audit(req, { action: 'session.end', recordType: 'user', recordId: req.user!.id, summary: `Ended ${ended.length} other session(s)` });
    return { ok: true, ended: ended.length };
  });
}
