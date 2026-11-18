import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hash, verify } from '@node-rs/argon2';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { CURRENCY, DEFAULT_APP_NAME, TIME_ZONE } from './config.ts';
import type { Db } from './db.ts';
import { fail } from './errors.ts';
import type { SessionUser } from './module.ts';
import { makeDbLimiter } from './ratelimit.ts';
import { clientIp, cookieSecure } from './request.ts';
import { isEncrypted, loadSecretBox, type SecretBox } from './secretbox.ts';
import type { makeAudit, makeSettings } from './services.ts';
import { matchTotpStep } from './totp.ts';

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

// ---------- authenticator keys: encrypted at rest, each code accepted once ----------

const boxes = new WeakMap<Db, SecretBox>();
/** The encryption box for this database's secrets (key from GRC_SECRET_KEY or the key file; see secretbox.ts). */
export function secretBox(db: Db): SecretBox {
  let box = boxes.get(db);
  if (!box) {
    box = loadSecretBox(db.dataDir);
    boxes.set(db, box);
  }
  return box;
}

const totpContext = (userId: string) => `totp:${userId}`;

/** Stores a user's authenticator key, encrypted. `null` removes it. */
export async function storeTotpSecret(db: Db, userId: string, secret: string | null): Promise<void> {
  await db.query(
    'update users set totp_secret = $2, totp_last_step = null, updated_at = now() where id = $1',
    [userId, secret === null ? null : secretBox(db).encrypt(secret, totpContext(userId))],
  );
}

/** The user's authenticator key in the clear, or null. Never return it from an API after enrolment. */
export async function readTotpSecret(db: Db, userId: string): Promise<string | null> {
  const row = await db.one<{ totp_secret: string | null }>('select totp_secret from users where id = $1', [userId]);
  if (!row?.totp_secret) return null;
  try {
    return secretBox(db).decrypt(row.totp_secret, totpContext(userId));
  } catch {
    // Written with a different secret key: no code can be accepted. A recovery code or an
    // administrator reset still works; supplying the right key puts it right.
    return null;
  }
}

/**
 * Checks a 6-digit code and uses it up: the time step of an accepted code is stored, and a code
 * from that step or an earlier one is refused, so a code seen once cannot be replayed.
 */
export async function acceptTotpCode(db: Db, userId: string, code: string, atMs = Date.now()): Promise<boolean> {
  const secret = await readTotpSecret(db, userId);
  if (!secret) return false;
  const step = matchTotpStep(secret, code, atMs);
  if (step === null) return false;
  const claimed = await db.one(
    'update users set totp_last_step = $2 where id = $1 and (totp_last_step is null or totp_last_step < $2) returning id',
    [userId, step],
  );
  return Boolean(claimed);
}

/**
 * Start-up migration: encrypts keys still stored in the clear (databases from before encryption)
 * and re-encrypts keys written with a retired key (GRC_SECRET_KEY_PREVIOUS). Returns how many changed.
 */
export async function encryptStoredSecrets(deps: Pick<Deps, 'db' | 'audit'>): Promise<number> {
  const box = secretBox(deps.db);
  const rows = await deps.db.query<{ id: string; totp_secret: string }>('select id, totp_secret from users where totp_secret is not null');
  let changed = 0;
  let unreadable = 0;
  for (const r of rows) {
    const context = totpContext(r.id);
    if (isEncrypted(r.totp_secret) && box.isCurrent(r.totp_secret, context)) continue;
    let plain: string;
    try {
      plain = box.decrypt(r.totp_secret, context);
    } catch {
      unreadable += 1; // written with a key we do not have: leave it, and say so below
      continue;
    }
    const sealed = box.encrypt(plain, context);
    await deps.db.query('update users set totp_secret = $2 where id = $1 and totp_secret = $3', [r.id, sealed, r.totp_secret]);
    changed += 1;
  }
  if (changed) {
    await deps.audit(null, {
      action: 'mfa.secrets_encrypted', recordType: 'user',
      summary: `${changed} authenticator key(s) encrypted with the current secret key`,
    });
  }
  if (unreadable) {
    console.error(`[secret key] ${unreadable} authenticator key(s) cannot be read with the current secret key. `
      + 'Those people cannot sign in with a code until the right key is supplied (GRC_SECRET_KEY, GRC_SECRET_KEY_FILE '
      + 'or GRC_SECRET_KEY_PREVIOUS) or an administrator resets their second factor.');
    await deps.audit(null, {
      action: 'mfa.secrets_unreadable', recordType: 'user',
      summary: `${unreadable} authenticator key(s) could not be read with the current secret key`,
    });
  }
  return changed;
}

// ---------- second-factor requirement ----------

export type MfaEnforcement = 'off' | 'notice' | 'required';

/**
 * How a required second factor is applied (setting `auth.mfa_enforcement`):
 * `off` - nothing; `notice` - a reminder only (the default, so existing installations keep working);
 * `required` - a person who must enrol and has not can reach only the enrolment routes.
 */
export async function mfaEnforcement(deps: Deps): Promise<MfaEnforcement> {
  const v = await deps.settings.get<string>('auth.mfa_enforcement', 'notice');
  return v === 'off' || v === 'required' ? v : 'notice';
}

/** What a person who must enrol may still call: their own state, enrolment, password and sign-out. */
export const MFA_ENROLMENT_ROUTES = [
  '/api/health', '/api/auth/state', '/api/auth/logout', '/api/auth/security', '/api/auth/confirm',
  '/api/auth/totp/begin', '/api/auth/totp/confirm', '/api/auth/change-password', '/api/auth/sessions',
];

/**
 * Whether the second factor is required of this user and missing, and whether that now blocks them.
 * The grace period (`auth.mfa_grace_days`, default none) runs from the first request made while required.
 */
export async function mfaStatus(deps: Deps, userId: string): Promise<{ required: boolean; blocked: boolean; graceEndsAt: string | null }> {
  const mode = await mfaEnforcement(deps);
  if (mode === 'off' || !(await mfaEnrollmentRequired(deps, userId))) return { required: false, blocked: false, graceEndsAt: null };
  if (mode === 'notice') return { required: true, blocked: false, graceEndsAt: null };
  const graceDays = Math.max(0, Number(await deps.settings.get('auth.mfa_grace_days', 0)) || 0);
  const row = await deps.db.one<{ blocked: boolean; ends: string }>(
    `update users set mfa_required_since = coalesce(mfa_required_since, now()) where id = $1
     returning (coalesce(mfa_required_since, now()) + make_interval(days => $2::int)) <= now() as blocked,
               (coalesce(mfa_required_since, now()) + make_interval(days => $2::int)) as ends`,
    [userId, graceDays],
  );
  return { required: true, blocked: row?.blocked ?? true, graceEndsAt: graceDays ? row?.ends ?? null : null };
}

// ---------- re-authentication before sensitive actions ----------

/**
 * Sensitive administrative actions need the password to have been proved in this session within
 * the last `auth.reauth_minutes` (default 10): at sign-in, or since through POST /api/auth/confirm.
 * A refusal is audited and answers 403 `reauth_required`, which the web app turns into a prompt.
 */
export async function requireRecentAuth(deps: Deps, req: FastifyRequest, what: string): Promise<void> {
  const minutes = Math.max(1, Number(await deps.settings.get('auth.reauth_minutes', 10)) || 10);
  const fresh = req.sessionHash && await deps.db.one(
    `select 1 from sessions where token_hash = $1 and confirmed_at > now() - make_interval(mins => $2::int)`,
    [req.sessionHash, minutes],
  );
  if (fresh) return;
  await deps.audit(req, {
    action: 'reauth.required', recordType: 'user', recordId: req.user?.id,
    summary: `Refused until the password is confirmed again: ${what}`,
  });
  fail(403, 'reauth_required', 'Confirm your password to continue.');
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
    // A session starts with the password just proved (sign-in, setup or a password change).
    `insert into sessions (token_hash, user_id, expires_at, ip, user_agent, confirmed_at)
     values ($1, $2, now() + interval '8 hours', $3, $4, now())`,
    [sha256(token), userId, ip ?? null, userAgent ?? null],
  );
  return token;
}

function setSessionCookie(req: FastifyRequest, reply: FastifyReply, token: string) {
  // `secure` follows GRC_COOKIE_SECURE (off by default: the prototype is plain http on 127.0.0.1).
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'strict', path: '/', maxAge: 8 * 3600, secure: cookieSecure(req),
  });
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
  // Failures only, kept in the database so a restart does not reset them.
  const signinFailures = makeDbLimiter(db, 'signin', 20, 5 * 60_000); // by source address
  const confirmFailures = makeDbLimiter(db, 'confirm', 8, 5 * 60_000); // by user

  // Encrypt authenticator keys left in the clear by an earlier version (and after a key change).
  app.addHook('onReady', async () => { await encryptStoredSecrets(deps); });

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
    // A required second factor that is missing limits the person to enrolment (and signing out).
    if (req.user && !req.routeOptions?.config?.public && !MFA_ENROLMENT_ROUTES.includes(req.url.split('?')[0])) {
      if ((await mfaEnforcement(deps)) === 'required' && (await mfaStatus(deps, req.user.id)).blocked) {
        fail(403, 'mfa_enrolment_required', 'Set up your second factor to continue. Open Account security to do it.');
      }
    }
  });

  // Setup stays open until someone can actually sign in: sample people created by a seed
  // (no password) must not lock the first administrator out.
  const userCount = async () =>
    (await db.one<{ c: number }>('select count(*)::int c from users where password_hash is not null'))!.c;

  app.get('/api/health', { config: { public: true } }, async () => ({ ok: true }));

  app.get('/api/auth/state', { config: { public: true } }, async (req) => {
    const mfa = req.user ? await mfaStatus(deps, req.user.id) : { required: false, blocked: false, graceEndsAt: null };
    return {
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
    // `mfaEnrollmentRequired`: show the reminder. `mfaEnrollmentBlocked`: nothing but enrolment works
    // until the person enrols (setting auth.mfa_enforcement = required; see docs/security.md).
    mfaEnrollmentRequired: mfa.required,
    mfaEnrollmentBlocked: mfa.blocked,
    mfaGraceEndsAt: mfa.graceEndsAt,
    mfaEnforcement: await mfaEnforcement(deps),
    };
  });

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
    const token = await createSession(db, user!.id, clientIp(req), req.headers['user-agent']);
    setSessionCookie(req, reply, token);
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
    const ip = clientIp(req);
    if (await signinFailures.blocked(ip)) fail(429, 'rate_limited', GENERIC_SIGNIN_ERROR);

    const reject = async (reason: string, userId?: string): Promise<never> => {
      await signinFailures.hit(ip);
      // Passing the request records the source address; nobody is signed in, so there is no actor.
      await audit(req, {
        action: 'signin.failure', recordType: 'user', recordId: userId,
        summary: `Sign-in failed (${reason}) for "${identifier.slice(0, 80)}" via local from ${ip}`,
      });
      return fail(401, 'invalid_credentials', GENERIC_SIGNIN_ERROR);
    };

    const u = await db.one<any>(
      `select id, password_hash, status, totp_enabled, failed_attempts,
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
      if (!(await acceptTotpCode(db, u.id, code))) {
        usedRecoveryCode = await consumeRecoveryCode(db, u.id, code);
        if (!usedRecoveryCode) return registerFailure('wrong authenticator or recovery code');
      }
    }

    await db.query(
      'update users set failed_attempts = 0, locked_until = null, last_login_at = now() where id = $1', [u.id],
    );
    const token = await createSession(db, u.id, ip, req.headers['user-agent']);
    setSessionCookie(req, reply, token);
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
    setSessionCookie(req, reply, await createSession(db, me.id, clientIp(req), req.headers['user-agent']));
    await audit(req, { action: 'password.change', recordType: 'user', recordId: me.id, summary: 'Password changed' });
    return { ok: true };
  });

  // Proves the password again for this session, before a sensitive administrative action.
  app.post('/api/auth/confirm', async (req) => {
    const me = req.user!;
    if (await confirmFailures.blocked(me.id)) fail(429, 'rate_limited', 'Too many attempts. Wait a few minutes and try again.');
    const row = await db.one<{ password_hash: string | null }>('select password_hash from users where id = $1', [me.id]);
    if (!row?.password_hash || !(await verifyPassword(row.password_hash, String((req.body as any)?.password ?? '')))) {
      await confirmFailures.hit(me.id);
      await audit(req, { action: 'reauth.failure', recordType: 'user', recordId: me.id, summary: 'Password confirmation refused: wrong password' });
      fail(400, 'validation', 'Check the highlighted fields.', { password: 'That is not your current password.' });
    }
    const minutes = Math.max(1, Number(await settings.get('auth.reauth_minutes', 10)) || 10);
    await db.query('update sessions set confirmed_at = now() where token_hash = $1', [req.sessionHash]);
    await audit(req, { action: 'reauth.success', recordType: 'user', recordId: me.id, summary: 'Password confirmed for administrative actions' });
    return { ok: true, minutes };
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
