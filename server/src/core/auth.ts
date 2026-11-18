import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hash, verify } from '@node-rs/argon2';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { CURRENCY, DEFAULT_APP_NAME, TIME_ZONE } from './config.ts';
import type { Db } from './db.ts';
import { fail } from './errors.ts';
import type { SessionUser } from './module.ts';
import type { makeAudit, makeSettings } from './services.ts';
import { verifyTotp } from './totp.ts';

export const SESSION_COOKIE = 'grc_session';
const GENERIC_SIGNIN_ERROR = 'Sign-in failed. Check your details, or wait a few minutes and try again.';

interface Deps {
  db: Db;
  audit: ReturnType<typeof makeAudit>;
  settings: ReturnType<typeof makeSettings>;
}

// ---------- passwords ----------

export const hashPassword = (password: string) => hash(password); // Argon2id with a per-hash salt
export const verifyPassword = (hashed: string, password: string) => verify(hashed, password).catch(() => false);

/** Offline list of common passwords, one per line. Nothing is ever sent to an outside service. */
const commonPasswords: Set<string> = (() => {
  const file = fileURLToPath(new URL('./common-passwords.txt', import.meta.url));
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : [];
  return new Set(lines.map((l) => l.trim().toLowerCase()).filter(Boolean));
})();

/** Returns a plain-English problem, or null when the password is acceptable. */
export async function checkPasswordPolicy(
  deps: Deps, password: string, user?: { id?: string; username?: string; email?: string },
): Promise<string | null> {
  const min = await deps.settings.get('auth.password_min_length', 14);
  if (typeof password !== 'string' || password.length < min) return `Use at least ${min} characters.`;
  if (password.length > 256) return 'Use 256 characters or fewer.';
  const lower = password.toLowerCase();
  if (commonPasswords.has(lower)) return 'That password is on a list of commonly used passwords. Choose another.';
  if (user?.username && lower.includes(user.username.toLowerCase())) return 'Do not include your username.';
  if (user?.id) {
    const keep = await deps.settings.get('auth.password_history', 5);
    const old = await deps.db.query<{ password_hash: string }>(
      'select password_hash from password_history where user_id = $1 order by id desc limit $2', [user.id, keep],
    );
    for (const o of old) {
      if (await verifyPassword(o.password_hash, password)) return `Do not reuse any of your last ${keep} passwords.`;
    }
  }
  return null;
}

export async function setPassword(deps: Deps, userId: string, password: string): Promise<void> {
  const hashed = await hashPassword(password);
  await deps.db.query(
    `update users set password_hash = $2, password_changed_at = now(), failed_attempts = 0, locked_until = null,
       status = case when status = 'pending' then 'active' else status end, updated_at = now() where id = $1`,
    [userId, hashed],
  );
  await deps.db.query('insert into password_history (user_id, password_hash) values ($1,$2)', [userId, hashed]);
}

// ---------- sessions ----------

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');

/** Recovery codes are compared without case, spaces or dashes; only their SHA-256 is stored. */
export const recoveryCodeHash = (code: string) => sha256(String(code).toUpperCase().replace(/[^A-Z0-9]/g, ''));

/** Uses up one recovery code. True when the code was valid; it cannot be used again. */
export async function consumeRecoveryCode(db: Db, userId: string, code: string): Promise<boolean> {
  if (String(code).replace(/[^A-Za-z0-9]/g, '').length !== 10) return false;
  const row = await db.one(
    `update users set recovery_codes = recovery_codes - $2::text
     where id = $1 and jsonb_exists(recovery_codes, $2::text) returning id`,
    [userId, recoveryCodeHash(code)],
  );
  return Boolean(row);
}

/** True when a second factor is expected of this user (role or site-wide setting) and none is set up. */
export async function mfaEnrollmentRequired(deps: Deps, userId: string): Promise<boolean> {
  const forAll = (await deps.settings.get<boolean>('auth.mfa_required_for_all', false)) === true;
  const row = await deps.db.one<{ required: boolean }>(
    `select (not u.totp_enabled) and ($2::boolean or exists (
        select 1 from user_roles ur join roles r on r.id = ur.role_id
        where ur.user_id = u.id and r.enabled and r.requires_mfa)) as required
     from users u where u.id = $1`,
    [userId, forAll],
  );
  return Boolean(row?.required);
}

export async function createSession(db: Db, userId: string, ip?: string, userAgent?: string): Promise<string> {
  const token = randomToken();
  await db.query(
    `insert into sessions (token_hash, user_id, expires_at, ip, user_agent)
     values ($1, $2, now() + interval '8 hours', $3, $4)`,
    [sha256(token), userId, ip ?? null, userAgent ?? null],
  );
  return token;
}

function setSessionCookie(reply: FastifyReply, token: string) {
  // `secure` is off because the prototype is served over http on 127.0.0.1 only.
  reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'strict', path: '/', maxAge: 8 * 3600 });
}

export async function loadUser(db: Db, userId: string): Promise<SessionUser | null> {
  const row = await db.one<any>(
    `select u.id, u.username, u.display_name, u.email,
        coalesce(array_agg(distinct r.key) filter (where r.enabled), '{}') as roles,
        coalesce(array_agg(distinct rp.permission) filter (where r.enabled and rp.permission is not null), '{}') as permissions
     from users u
     left join user_roles ur on ur.user_id = u.id
     left join roles r on r.id = ur.role_id
     left join role_permissions rp on rp.role_id = r.id
     where u.id = $1 and u.status = 'active' and u.deleted_at is null
     group by u.id`,
    [userId],
  );
  if (!row) return null;
  return {
    id: row.id, username: row.username, displayName: row.display_name, email: row.email,
    roles: row.roles, permissions: row.permissions,
  };
}

async function sessionUser(db: Db, token: string | undefined, idleMinutes: number) {
  if (!token) return null;
  const hashed = sha256(token);
  const s = await db.one<{ user_id: string; stale: boolean }>(
    `select user_id, last_seen_at < now() - interval '1 minute' as stale from sessions
     where token_hash = $1 and expires_at > now() and last_seen_at > now() - make_interval(mins => $2::int)`,
    [hashed, idleMinutes],
  );
  if (!s) return null;
  if (s.stale) await db.query('update sessions set last_seen_at = now() where token_hash = $1', [hashed]);
  const user = await loadUser(db, s.user_id);
  return user ? { user, hashed } : null;
}

// ---------- routes ----------

export function registerAuth(app: FastifyInstance, deps: Deps) {
  const { db, audit, settings } = deps;
  const failuresByIp = new Map<string, number[]>();

  app.decorateRequest('user', null);
  app.decorateRequest('sessionHash', null);

  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    const idle = await settings.get('auth.idle_minutes', 30);
    const s = await sessionUser(db, req.cookies[SESSION_COOKIE], idle);
    req.user = s?.user ?? null;
    req.sessionHash = s?.hashed ?? null;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-grc-csrf'] !== '1') {
      fail(403, 'csrf', 'Request blocked: missing security header.');
    }
    if (!req.user && !req.routeOptions?.config?.public) fail(401, 'unauthenticated', 'Sign in to continue.');
  });

  const userCount = async () => (await db.one<{ c: number }>('select count(*)::int c from users'))!.c;

  app.get('/api/health', { config: { public: true } }, async () => ({ ok: true }));

  app.get('/api/auth/state', { config: { public: true } }, async (req) => ({
    appName: await settings.get('app.name', DEFAULT_APP_NAME),
    timeZone: TIME_ZONE,
    currency: CURRENCY,
    setupRequired: (await userCount()) === 0,
    user: req.user && {
      id: req.user.id, username: req.user.username, displayName: req.user.displayName,
      email: req.user.email, roles: req.user.roles,
    },
    permissions: req.user?.permissions ?? [],
    features: await settings.get('features', { portal: false }),
    pilot: await settings.get('pilot_mode', true),
    // The prototype shows a notice rather than blocking; see docs/known-gaps.md.
    mfaEnrollmentRequired: req.user ? await mfaEnrollmentRequired(deps, req.user.id) : false,
  }));

  // First run: creates the initial administrator. There is no default account.
  app.post('/api/setup', { config: { public: true } }, async (req, reply) => {
    if ((await userCount()) > 0) fail(409, 'already_set_up', 'Setup has already been completed.');
    const b = (req.body ?? {}) as Record<string, string>;
    const fields: Record<string, string> = {};
    const username = String(b.username ?? '').trim();
    const email = String(b.email ?? '').trim();
    const displayName = String(b.displayName ?? '').trim();
    if (!/^[A-Za-z0-9._-]{3,64}$/.test(username)) fields.username = 'Use 3 to 64 letters, numbers, dots, dashes or underscores.';
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) fields.email = 'Enter an email address.';
    if (!displayName) fields.displayName = 'Enter a name.';
    const problem = await checkPasswordPolicy(deps, b.password, { username });
    if (problem) fields.password = problem;
    if (Object.keys(fields).length) fail(400, 'validation', 'Check the highlighted fields.', fields);

    const user = await db.one<{ id: string }>(
      `insert into users (username, email, display_name, status) values ($1,$2,$3,'active') returning id`,
      [username, email, displayName],
    );
    await setPassword(deps, user!.id, b.password);
    await db.query(
      `insert into user_roles (user_id, role_id) select $1, id from roles where key = 'administrator'`, [user!.id],
    );
    const token = await createSession(db, user!.id, req.ip, req.headers['user-agent']);
    setSessionCookie(reply, token);
    req.user = await loadUser(db, user!.id);
    await audit(req, {
      action: 'setup.complete', recordType: 'user', recordId: user!.id,
      summary: `Initial administrator ${username} created`,
    });
    return { ok: true };
  });

  app.post('/api/auth/login', { config: { public: true } }, async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, string>;
    const identifier = String(b.username ?? '').trim().toLowerCase();
    const password = String(b.password ?? '');

    // Rate limit by source address (failures only).
    const now = Date.now();
    const recent = (failuresByIp.get(req.ip) ?? []).filter((t) => now - t < 5 * 60_000);
    failuresByIp.set(req.ip, recent);
    if (recent.length >= 20) fail(429, 'rate_limited', GENERIC_SIGNIN_ERROR);

    const reject = async (reason: string, userId?: string): Promise<never> => {
      recent.push(now);
      await audit(null, {
        action: 'signin.failure', recordType: 'user', recordId: userId,
        summary: `Sign-in failed (${reason}) for "${identifier.slice(0, 80)}" via local from ${req.ip}`,
      });
      return fail(401, 'invalid_credentials', GENERIC_SIGNIN_ERROR);
    };

    const u = await db.one<any>(
      `select id, password_hash, status, totp_enabled, totp_secret, failed_attempts,
              (locked_until is not null and locked_until > now()) as locked
       from users where deleted_at is null and (lower(username) = $1 or lower(email) = $1)`,
      [identifier],
    );
    if (!u || u.status !== 'active' || !u.password_hash) {
      await hashPassword(password); // spend comparable time whether or not the account exists
      return reject('unknown or inactive account');
    }
    if (u.locked) return reject('account locked', u.id);

    const registerFailure = async (reason: string) => {
      const attempts = u.failed_attempts + 1;
      // Progressive lockout: from the 5th failure, 1 minute doubling to a 15 minute ceiling.
      const lockMinutes = attempts >= 5 ? Math.min(15, 2 ** (attempts - 5)) : 0;
      await db.query(
        `update users set failed_attempts = $2,
           locked_until = case when $3::int > 0 then now() + make_interval(mins => $3::int) else null end where id = $1`,
        [u.id, attempts, lockMinutes],
      );
      if (lockMinutes) {
        await audit(null, {
          action: 'signin.lockout', recordType: 'user', recordId: u.id,
          summary: `Account locked for ${lockMinutes} minute(s) after ${attempts} failed attempts`,
        });
      }
      return reject(reason, u.id);
    };

    if (!(await verifyPassword(u.password_hash, password))) return registerFailure('wrong password');
    let usedRecoveryCode = false;
    if (u.totp_enabled) {
      // A single-use recovery code is accepted in place of the authenticator code.
      const code = String(b.totp ?? b.recoveryCode ?? '').trim();
      if (!code) fail(401, 'mfa_required', 'Enter the 6-digit code from your authenticator app.');
      if (!verifyTotp(u.totp_secret, code)) {
        usedRecoveryCode = await consumeRecoveryCode(db, u.id, code);
        if (!usedRecoveryCode) return registerFailure('wrong authenticator or recovery code');
      }
    }

    await db.query(
      'update users set failed_attempts = 0, locked_until = null, last_login_at = now() where id = $1', [u.id],
    );
    const token = await createSession(db, u.id, req.ip, req.headers['user-agent']);
    setSessionCookie(reply, token);
    req.user = await loadUser(db, u.id);
    await audit(req, {
      action: 'signin.success', recordType: 'user', recordId: u.id,
      summary: `Signed in via local${usedRecoveryCode ? ' with a recovery code' : u.totp_enabled ? ' with second factor' : ''}`,
    });
    if (usedRecoveryCode) {
      const left = await db.one<{ n: number }>('select jsonb_array_length(recovery_codes) as n from users where id = $1', [u.id]);
      await audit(req, {
        action: 'mfa.recovery_code_used', recordType: 'user', recordId: u.id,
        summary: `Recovery code used to sign in; ${left?.n ?? 0} left`,
      });
    }
    return { ok: true };
  });

  app.post('/api/auth/logout', { config: { public: true } }, async (req, reply) => {
    if (req.sessionHash) {
      await db.query('delete from sessions where token_hash = $1', [req.sessionHash]);
      await audit(req, { action: 'signout', recordType: 'user', recordId: req.user!.id, summary: 'Signed out' });
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post('/api/auth/change-password', async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, string>;
    const me = req.user!;
    const row = await db.one<{ password_hash: string }>('select password_hash from users where id = $1', [me.id]);
    if (!row?.password_hash || !(await verifyPassword(row.password_hash, String(b.currentPassword ?? '')))) {
      fail(400, 'validation', 'Check the highlighted fields.', { currentPassword: 'That is not your current password.' });
    }
    const problem = await checkPasswordPolicy(deps, b.newPassword, me);
    if (problem) fail(400, 'validation', 'Check the highlighted fields.', { newPassword: problem });
    await setPassword(deps, me.id, b.newPassword);
    // All active sessions end on password change; this browser gets a fresh one.
    await db.query('delete from sessions where user_id = $1', [me.id]);
    setSessionCookie(reply, await createSession(db, me.id, req.ip, req.headers['user-agent']));
    await audit(req, { action: 'password.change', recordType: 'user', recordId: me.id, summary: 'Password changed' });
    return { ok: true };
  });

  app.get('/api/users/options', async (req) => {
    const q = `%${String((req.query as any).q ?? '').trim()}%`;
    return db.query(
      `select id, display_name as label from users
       where deleted_at is null and status <> 'disabled' and (display_name ilike $1 or username ilike $1)
       order by display_name limit 25`,
      [q],
    );
  });
}
