import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hash, verify } from '@node-rs/argon2';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { CURRENCY, DEFAULT_APP_NAME, TIME_ZONE } from './config.ts';
import type { Db, Queryable } from './db.ts';
import { fail, UUID_RE } from './errors.ts';
import { featureState } from './features.ts';
import { isApiRequest } from './api/versioning.ts';
import { afterSignIn, checkSignIn, sessionSecondFactor, signOutRedirect } from './identity/hooks.ts';
import type { SessionUser } from './module.ts';
import { publicBranding } from './organization.ts';
import { makeDbLimiter } from './ratelimit.ts';
import { clientIp, cookieSecure } from './request.ts';
import { loadSecretBox, type SecretBox } from './secretbox.ts';
import { resealStoredSecrets, retiredKeyAdvice } from './secretkey-reseal.ts';
import type { makeAudit, makeSettings } from './services.ts';
import { registerTokens, revokeProgramAccess, revokedSummary } from './tokens.ts';
import { matchTotpStep } from './totp.ts';
// Passkeys and security keys, and the new-installation second-factor default (E02-08, E02-17).
import { applySetupSecondFactor, hasActivePasskey, passkeySecondFactor, registerWebAuthn } from './webauthn/index.ts';
import { WEBAUTHN_ENROLLMENT_ROUTES } from './webauthn/paths.ts';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** With `public`: a server-to-server route that proves itself with a signed token, so no CSRF header is asked for. */
    noCsrf?: boolean;
    /**
     * With `public`: the route checks a bearer token of its own (the SCIM provisioning endpoint, E36-01),
     * so neither a session nor a personal access token is looked at, and no CSRF header is asked for.
     */
    ownBearer?: boolean;
  }
}

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

let dummyHash: Promise<string> | null = null;
/**
 * Spends the time of one password check without an account to check against (unknown name, locked
 * or inactive account), so that the answer's timing does not tell them apart (wave 9, SA-6).
 */
export async function spendPasswordCheck(password: unknown): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(24).toString('base64url'));
  await verifyPassword(await dummyHash, String(password ?? ''));
}

// ---------- account lockout ----------

/** One claimed sign-in attempt: the account's failure count with it, and the lock it set (if any). */
export interface SignInAttempt { attempts: number; lockMinutes: number; lockText: string | null }

/** Progressive lockout: from the 5th failure, 1 minute doubling to a 15 minute ceiling. */
export const lockMinutesFor = (attempts: number) => (attempts >= 5 ? Math.min(15, 2 ** Math.min(attempts - 5, 10)) : 0);

/**
 * Claims one sign-in attempt on an account in a single statement (wave 9, SA-3): the attempt is
 * counted as a failure **before** the password is checked, and when it is the one that reaches the
 * lockout the lock is set at once, so attempts sent at the same moment cannot all slip through
 * before any of them is counted. Null when the account is locked (or `userId` is null: the
 * statement still runs, on no row, so an unknown name costs the same). A success clears the count;
 * an attempt that turns out not to be a failure is given back with `releaseSignInAttempt`.
 */
export async function claimSignInAttempt(db: Queryable, userId: string | null): Promise<SignInAttempt | null> {
  const row = await db.one<{ failed_attempts: number; lock_text: string | null }>(
    `update users set failed_attempts = failed_attempts + 1,
       locked_until = case when failed_attempts + 1 >= 5
         then now() + make_interval(mins => least(15, power(2, least(failed_attempts + 1 - 5, 10)))::int)
         else locked_until end
     where id = $1::uuid and (locked_until is null or locked_until <= now())
     returning failed_attempts, case when failed_attempts >= 5 then locked_until::text end as lock_text`,
    [userId ?? '00000000-0000-0000-0000-000000000000'],
  );
  if (!row) return null;
  return { attempts: row.failed_attempts, lockMinutes: lockMinutesFor(row.failed_attempts), lockText: row.lock_text };
}

/** Gives back a claimed attempt that was not a failure: one count less, and its lock lifted if still in place. */
export async function releaseSignInAttempt(db: Queryable, userId: string, attempt: SignInAttempt): Promise<void> {
  await db.query(
    `update users set failed_attempts = greatest(failed_attempts - 1, 0),
       locked_until = case when $2::text is not null and locked_until::text = $2::text then null else locked_until end
     where id = $1`,
    [userId, attempt.lockText],
  );
}

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

/** The user's authenticator key in the clear, or null. Never return it from an API after enrollment. */
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
  // Every kind of sealed value (E02-20): authenticator keys, webhook and provider secrets, the mail
  // password, the object store key, links waiting to be emailed (core/secretkey-reseal.ts).
  const counts = await resealStoredSecrets(deps.db, box, { write: true });
  const totp = counts.find((c) => c.key === 'totp') ?? { changed: 0, unreadable: 0 };
  const changed = totp.changed;
  const unreadable = totp.unreadable;
  const others = counts.filter((c) => c.key !== 'totp');
  const otherChanged = others.filter((c) => c.changed);
  if (otherChanged.length) {
    const n = otherChanged.reduce((s, c) => s + c.changed, 0);
    await deps.audit(null, {
      action: 'secret_key.reencrypted', recordType: 'setting',
      summary: `${n} stored secret(s) re-encrypted with the current secret key: ${otherChanged.map((c) => `${c.changed} ${c.label}`).join(', ')}`,
    });
  }
  const otherUnreadable = others.filter((c) => c.unreadable);
  if (otherUnreadable.length) {
    const what = otherUnreadable.map((c) => `${c.unreadable} ${c.label}`).join(', ');
    console.error(`[secret key] Some stored secrets cannot be read with the current secret key (${what}). Supply the key they were written with `
      + '(GRC_SECRET_KEY_PREVIOUS) or enter those secrets again.');
    await deps.audit(null, {
      action: 'secret_key.unreadable', recordType: 'setting',
      summary: `Stored secrets that cannot be read with the current secret key: ${what}`,
    });
  }
  if (box.retiredKeys > 0 && !counts.some((c) => c.unreadable)) {
    console.log(`[secret key] ${retiredKeyAdvice(counts.map((c) => ({ ...c, changed: 0 })), box.retiredKeys)}`);
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
 * `required` - a person who must enroll and has not can reach only the enrollment routes.
 */
export async function mfaEnforcement(deps: Deps): Promise<MfaEnforcement> {
  return enforcementOf(await deps.settings.get<string>('auth.mfa_enforcement', 'notice'));
}

/** A stored `auth.mfa_enforcement` value as one of the three modes (anything else is `notice`). */
const enforcementOf = (v: unknown): MfaEnforcement => (v === 'off' || v === 'required' ? v : 'notice');

/** What a person who must enroll may still call: their own state, enrollment, password and sign-out. */
export const MFA_ENROLLMENT_ROUTES = [
  '/api/health', '/api/auth/state', '/api/auth/logout', '/api/auth/security', '/api/auth/confirm',
  '/api/auth/totp/begin', '/api/auth/totp/confirm', '/api/auth/change-password', '/api/auth/sessions',
  ...WEBAUTHN_ENROLLMENT_ROUTES,
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

/**
 * The same, for one session: a session made through a sign-in provider trusted for multi-factor
 * sign-in, whose token showed it, needs no second factor here (E02-22). Other sessions of the same
 * person are judged on their own.
 */
export async function mfaStatusForSession(
  deps: Deps, app: FastifyInstance, userId: string, sessionHash: string | null | undefined,
): Promise<{ required: boolean; blocked: boolean; graceEndsAt: string | null; viaProvider: boolean }> {
  const status = await mfaStatus(deps, userId);
  if (status.required && (await sessionSecondFactor(app, sessionHash))) return { required: false, blocked: false, graceEndsAt: null, viaProvider: true };
  return { ...status, viaProvider: false };
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
  // A passkey or security key counts as a second factor too (core/webauthn).
  return Boolean(row?.required) && !(await hasActivePasskey(deps.db, userId));
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

export function setSessionCookie(req: FastifyRequest, reply: FastifyReply, token: string) {
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
    // Permission modules of switched-off areas: nobody holds them (core/features.ts).
    off: [...(await featureState(db)).offPermissions],
  };
}

/** The settings every signed-in request needs, read with its session (E16-38). */
const REQUEST_SETTINGS = ['auth.idle_minutes', 'auth.mfa_enforcement'];

/** Those settings as read for one request, so it never reads them twice. */
const requestSettings = new WeakMap<FastifyRequest, Record<string, unknown>>();

/**
 * The session, its person, their roles and permissions, and the settings a request needs, in one
 * statement (E16-38; it was four on every request). Settings are read fresh each time, so a change
 * applies to the next request without any cache to invalidate. `last_seen_at` is written at most
 * once a minute.
 */
async function sessionUser(db: Db, token: string | undefined) {
  if (!token) return null;
  const hashed = sha256(token);
  const row = await db.one<any>(
    `select u.id, u.username, u.display_name, u.email,
        coalesce(array_agg(distinct r.key) filter (where r.enabled), '{}') as roles,
        coalesce(array_agg(distinct rp.permission) filter (where r.enabled and rp.permission is not null), '{}') as permissions,
        extract(epoch from now() - s.last_seen_at)::float8 as idle_seconds,
        (select jsonb_object_agg(st.key, st.value) from settings st where st.key = any($2::text[])) as settings
     from sessions s
     join users u on u.id = s.user_id and u.status = 'active' and u.deleted_at is null
     left join user_roles ur on ur.user_id = u.id
     left join roles r on r.id = ur.role_id
     left join role_permissions rp on rp.role_id = r.id
     where s.token_hash = $1 and s.expires_at > now()
     group by u.id, s.last_seen_at`,
    [hashed, REQUEST_SETTINGS],
  );
  if (!row) return null;
  const settings: Record<string, unknown> = row.settings ?? {};
  // The idle time-out (setting auth.idle_minutes, default 30), as `last_seen_at > now() - idle` did.
  const idleMinutes = Number(settings['auth.idle_minutes'] ?? 30);
  if (!(Number(row.idle_seconds) < (Number.isFinite(idleMinutes) ? idleMinutes : 30) * 60)) return null;
  if (Number(row.idle_seconds) > 60) await db.query('update sessions set last_seen_at = now() where token_hash = $1', [hashed]);
  const user: SessionUser = {
    id: row.id, username: row.username, displayName: row.display_name, email: row.email,
    roles: row.roles, permissions: row.permissions,
    // Permission modules of switched-off areas: nobody holds them (core/features.ts).
    off: [...(await featureState(db)).offPermissions],
  };
  return { user, hashed, settings };
}

// ---------- routes ----------

type StateGrant = (user: SessionUser) => Promise<string[]> | string[];
const stateGrants = new WeakMap<FastifyInstance, StateGrant[]>();

/**
 * A grant a module works out per person, listed with the permissions in /api/auth/state so the web
 * app's menus follow it (BW-06: "projects.request" for whoever may send a project request under
 * the module's own setting). No route checks it; the module's routes keep their own rule.
 */
export function addStateGrant(app: FastifyInstance, grant: StateGrant): void {
  stateGrants.set(app, [...(stateGrants.get(app) ?? []), grant]);
}

async function grantsFor(app: FastifyInstance, user: SessionUser): Promise<string[]> {
  const out: string[] = [];
  for (const grant of stateGrants.get(app) ?? []) out.push(...(await grant(user)));
  return out;
}

export function registerAuth(app: FastifyInstance, deps: Deps) {
  const { db, audit, settings } = deps;
  // Failures only, kept in the database so a restart does not reset them.
  const signinFailures = makeDbLimiter(db, 'signin', 20, 5 * 60_000); // by source address
  const confirmFailures = makeDbLimiter(db, 'confirm', 8, 5 * 60_000); // by user

  // Encrypt authenticator keys left in the clear by an earlier version (and after a key change).
  app.addHook('onReady', async () => { await encryptStoredSecrets(deps); });

  app.decorateRequest('user', null);
  app.decorateRequest('sessionHash', null);

  app.decorateRequest('apiToken', null);
  const tokens = registerTokens(app, { db, audit, settings, loadUser, requireRecentAuth: (req, what) => requireRecentAuth(deps, req, what) });
  registerWebAuthn(app, deps); // passkeys and security keys: /api/auth/webauthn/...

  app.addHook('onRequest', async (req) => {
    // By path or by matched route (the path is canonical before routing: core/api/versioning.ts).
    if (!isApiRequest(req)) return;
    // A public route with its own bearer check (E36-01): nobody is signed in there, whatever is sent.
    if (req.routeOptions?.config?.ownBearer === true && req.routeOptions?.config?.public === true) return;
    const authorization = req.headers.authorization;
    if (authorization !== undefined) {
      // A personal access token (core/tokens.ts). The session cookie is ignored, and no CSRF header
      // is needed: a browser cannot be made to send an Authorization header across sites.
      const m = /^Bearer\s+(\S+)$/i.exec(authorization);
      if (!m) fail(401, 'invalid_token', 'Use "Authorization: Bearer <token>".');
      await tokens.authenticate(req, m![1]);
    } else {
      const s = await sessionUser(db, req.cookies[SESSION_COOKIE]);
      req.user = s?.user ?? null;
      req.sessionHash = s?.hashed ?? null;
      if (s) requestSettings.set(req, s.settings);
      // `noCsrf`: a server-to-server route that proves itself with a signed token, not a cookie
      // (the provider's back-channel sign-out); it must also be public, so a session is never used there.
      const serverToServer = req.routeOptions?.config?.noCsrf === true && req.routeOptions?.config?.public === true;
      if (!serverToServer && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-grc-csrf'] !== '1') {
        fail(403, 'csrf', 'Request blocked: missing security header.');
      }
    }
    if (!req.user && !req.routeOptions?.config?.public) fail(401, 'unauthenticated', 'Sign in to continue.');
    // A required second factor that is missing limits the person to enrollment (and signing out).
    if (req.user && !req.routeOptions?.config?.public && !MFA_ENROLLMENT_ROUTES.includes(req.url.split('?')[0])) {
      // Read with the session when there is one (one statement per request); a token reads it here.
      const known = requestSettings.get(req);
      const mode = known ? enforcementOf(known['auth.mfa_enforcement']) : await mfaEnforcement(deps);
      if (mode === 'required' && (await mfaStatusForSession(deps, app, req.user.id, req.sessionHash)).blocked) {
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
    const mfa = req.user ? await mfaStatusForSession(deps, app, req.user.id, req.sessionHash) : { required: false, blocked: false, graceEndsAt: null };
    return {
    appName: await settings.get('app.name', DEFAULT_APP_NAME),
    // The organization's public look (Administration > Organization): names, colors, logos.
    branding: await publicBranding(db),
    timeZone: TIME_ZONE,
    currency: CURRENCY,
    setupRequired: (await userCount()) === 0,
    user: req.user && {
      id: req.user.id, username: req.user.username, displayName: req.user.displayName,
      email: req.user.email, roles: req.user.roles,
    },
    permissions: req.user ? [...req.user.permissions, ...(await grantsFor(app, req.user))] : [],
    // Every area's switch (core/features.ts); `areasOff`: permission modules nobody holds while off.
    features: (await featureState(db)).on,
    areasOff: [...(await featureState(db)).offPermissions],
    pilot: await settings.get('pilot_mode', true),
    // `mfaEnrollmentRequired`: show the reminder. `mfaEnrollmentBlocked`: nothing but enrollment works
    // until the person enrolls (setting auth.mfa_enforcement = required; see docs/security.md).
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

    // One at a time (wave 9, SA-9): the check that nobody can sign in yet and the creation of the
    // administrator happen in one transaction under a lock, so requests racing the real
    // administrator cannot each create one.
    const hashed = await hashPassword(b.password);
    const user = await db.tx(async (tx) => {
      await tx.query(`select pg_advisory_xact_lock(hashtext('grc.setup'))`);
      const done = await tx.one<{ c: number }>('select count(*)::int c from users where password_hash is not null');
      if (done!.c > 0) return null;
      const made = await tx.one<{ id: string }>(
        `insert into users (username, email, display_name, status, password_hash, password_changed_at)
         values ($1,$2,$3,'active',$4, now()) returning id`,
        [username, email, displayName, hashed],
      );
      await tx.query('insert into password_history (user_id, password_hash) values ($1,$2)', [made!.id, hashed]);
      await tx.query(`insert into user_roles (user_id, role_id) select $1, id from roles where key = 'administrator'`, [made!.id]);
      return made;
    });
    if (!user) fail(409, 'already_set_up', 'Setup has already been completed.');
    const token = await createSession(db, user!.id, clientIp(req), req.headers['user-agent']);
    setSessionCookie(req, reply, token);
    req.user = await loadUser(db, user!.id);
    await audit(req, {
      action: 'setup.complete', recordType: 'user', recordId: user!.id,
      summary: `Initial administrator ${username} created`,
    });
    // E02-17: the wizard's choice of second-factor enforcement for this new installation.
    const secondFactor = await applySetupSecondFactor(deps, req, (b as Record<string, unknown>).secondFactor);
    return { ok: true, secondFactor };
  });

  app.post('/api/auth/login', { config: { public: true } }, async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, string>;
    const identifier = String(b.username ?? '').trim().toLowerCase();
    const password = String(b.password ?? '');

    // Rate limit by source address (failures only). The attempt is claimed before any work, so
    // attempts sent at the same moment all count (wave 9, SA-3); a success gives it back.
    const ip = clientIp(req);
    const slot = await signinFailures.take(ip);
    if (!slot.ok) fail(429, 'rate_limited', GENERIC_SIGNIN_ERROR);

    const reject = async (reason: string, userId?: string): Promise<never> => {
      // Passing the request records the source address; nobody is signed in, so there is no actor.
      await audit(req, {
        action: 'signin.failure', recordType: 'user', recordId: userId,
        summary: `Sign-in failed (${reason}) for "${identifier.slice(0, 80)}" via local from ${ip}`,
      });
      return fail(401, 'invalid_credentials', GENERIC_SIGNIN_ERROR);
    };

    const u = await db.one<any>(
      `select id, password_hash, status, totp_enabled
       from users where deleted_at is null and (lower(username) = $1 or lower(email) = $1)`,
      [identifier],
    );
    const known = Boolean(u && u.status === 'active' && u.password_hash);
    // The account's attempt is claimed atomically too (refused while locked); an unknown name runs
    // the same statement on no row, so every refusal costs the same (SA-6).
    const attempt = await claimSignInAttempt(db, known ? u.id : null);
    if (!known || !attempt) {
      await spendPasswordCheck(password); // the same work as a wrong password, whether or not the account exists or is locked
      return reject(known ? 'account locked' : 'unknown or inactive account', known ? u.id : undefined);
    }
    const a = attempt;

    const registerFailure = async (reason: string) => {
      if (a.lockMinutes) {
        await audit(null, {
          action: 'signin.lockout', recordType: 'user', recordId: u.id,
          summary: `Account locked for ${a.lockMinutes} minute(s) after ${a.attempts} failed attempts`,
        });
      }
      return reject(reason, u.id);
    };
    // Not a failure (the password was right; a second factor is still to come, or a policy refused):
    // the attempt and the address's slot are given back.
    const notAFailure = async () => {
      await releaseSignInAttempt(db, u.id, a);
      await slot.release();
    };

    if (!(await verifyPassword(u.password_hash, password))) return registerFailure('wrong password');
    // Passkeys and security keys (core/webauthn): an assertion in `webauthn` stands in for the code.
    const passkey = await passkeySecondFactor(deps, req, u.id, (b as Record<string, unknown>).webauthn);
    if (passkey === 'failed') return registerFailure('passkey or security key not accepted');
    let usedRecoveryCode = false;
    if (passkey === 'needed' && !u.totp_enabled) {
      // E02-21: a person whose only second factor is a passkey can use a recovery code instead.
      const code = String(b.recoveryCode ?? b.totp ?? '').trim();
      if (!code) {
        await notAFailure();
        fail(401, 'mfa_required', 'Use your passkey or security key to finish signing in.', { passkey: 'required' });
      }
      usedRecoveryCode = await consumeRecoveryCode(db, u.id, code);
      if (!usedRecoveryCode) return registerFailure('wrong recovery code');
    }
    if (u.totp_enabled && passkey !== 'passed') {
      // A single-use recovery code is accepted in place of the authenticator code.
      const code = String(b.totp ?? b.recoveryCode ?? '').trim();
      if (!code) {
        await notAFailure();
        fail(401, 'mfa_required', 'Enter the 6-digit code from your authenticator app.');
      }
      if (!(await acceptTotpCode(db, u.id, code))) {
        usedRecoveryCode = await consumeRecoveryCode(db, u.id, code);
        if (!usedRecoveryCode) return registerFailure('wrong authenticator or recovery code');
      }
    }

    // Sign-in policies (core/identity/hooks.ts): local passwords switched off, a person limited to
    // single sign-on. Refused like any other failure, so the answer reveals nothing.
    const refused = await checkSignIn(app, { userId: u.id, method: 'local' });
    if (refused) {
      await releaseSignInAttempt(db, u.id, a); // the details were right: not counted against the account
      return reject(refused, u.id);
    }

    await slot.release();
    await db.query(
      'update users set failed_attempts = 0, locked_until = null, last_login_at = now() where id = $1', [u.id],
    );
    const token = await createSession(db, u.id, ip, req.headers['user-agent']);
    setSessionCookie(req, reply, token);
    req.user = await loadUser(db, u.id);
    await audit(req, {
      action: 'signin.success', recordType: 'user', recordId: u.id,
      summary: `Signed in via local${usedRecoveryCode ? ' with a recovery code' : passkey === 'passed' ? ' with a passkey' : u.totp_enabled ? ' with second factor' : ''}`,
    });
    if (usedRecoveryCode) {
      const left = await db.one<{ n: number }>('select jsonb_array_length(recovery_codes) as n from users where id = $1', [u.id]);
      await audit(req, {
        action: 'mfa.recovery_code_used', recordType: 'user', recordId: u.id,
        summary: `Recovery code used to sign in; ${left?.n ?? 0} left`,
      });
    }
    await afterSignIn(app, req, { userId: u.id, method: 'local', sessionToken: token });
    return { ok: true };
  });

  app.post('/api/auth/logout', { config: { public: true } }, async (req, reply) => {
    let redirectUrl: string | null = null;
    if (req.sessionHash) {
      // E02-23: a session made through a provider that signs out there too gets the provider's sign-out address.
      try {
        redirectUrl = await signOutRedirect(app, req, req.sessionHash);
      } catch (err) {
        console.error('[auth] provider sign-out address could not be made:', (err as Error).message);
      }
      await db.query('delete from sessions where token_hash = $1', [req.sessionHash]);
      await audit(req, {
        action: 'signout', recordType: 'user', recordId: req.user!.id,
        summary: redirectUrl ? 'Signed out, and sent to sign out at the provider too' : 'Signed out',
      });
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return redirectUrl ? { ok: true, redirectUrl } : { ok: true };
  });

  app.post('/api/auth/change-password', async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, string>;
    const me = req.user!;
    // Wrong current passwords count with the password confirmation's limit (8 in 5 minutes per
    // person) and are audited (wave 9, SA-10), so a borrowed session cannot be used to guess it.
    const slot = await confirmFailures.take(me.id);
    if (!slot.ok) fail(429, 'rate_limited', 'Too many attempts. Wait a few minutes and try again.');
    const row = await db.one<{ password_hash: string }>('select password_hash from users where id = $1', [me.id]);
    if (!row?.password_hash || !(await verifyPassword(row.password_hash, String(b.currentPassword ?? '')))) {
      await audit(req, { action: 'password.change_refused', recordType: 'user', recordId: me.id, summary: 'Password change refused: wrong current password' });
      fail(400, 'validation', 'Check the highlighted fields.', { currentPassword: 'That is not your current password.' });
    }
    await slot.release();
    const problem = await checkPasswordPolicy(deps, b.newPassword, me);
    if (problem) fail(400, 'validation', 'Check the highlighted fields.', { newPassword: problem });
    await setPassword(deps, me.id, b.newPassword);
    // All active sessions end on password change; this browser gets a fresh one.
    await db.query('delete from sessions where user_id = $1', [me.id]);
    // API tokens and AI assistant connections end too (SA-8), unless the person asks to keep them.
    const keep = (b as Record<string, unknown>).keepProgramAccess === true;
    const revoked = keep ? { tokens: 0, connections: 0 } : await revokeProgramAccess(db, me.id, me.id, 'password changed');
    setSessionCookie(req, reply, await createSession(db, me.id, clientIp(req), req.headers['user-agent']));
    await audit(req, {
      action: 'password.change', recordType: 'user', recordId: me.id,
      summary: `Password changed${revokedSummary(revoked)}${keep ? '; API tokens and assistant connections kept at the person\'s request' : ''}`,
    });
    return { ok: true, revoked };
  });

  // Proves the password (and the second factor, when the person has one: E01-29) again for this
  // session, before a sensitive action.
  app.post('/api/auth/confirm', async (req) => {
    const me = req.user!;
    // Claimed before the check, so parallel guesses all count (wave 9); given back unless it fails.
    const slot = await confirmFailures.take(me.id);
    if (!slot.ok) fail(429, 'rate_limited', 'Too many attempts. Wait a few minutes and try again.');
    const row = await db.one<{ password_hash: string | null }>('select password_hash from users where id = $1', [me.id]);
    if (!row?.password_hash || !(await verifyPassword(row.password_hash, String((req.body as any)?.password ?? '')))) {
      await audit(req, { action: 'reauth.failure', recordType: 'user', recordId: me.id, summary: 'Password confirmation refused: wrong password' });
      fail(400, 'validation', 'Check the highlighted fields.', { password: 'That is not your current password.' });
    }
    // E01-29: a person with a second factor proves it too: a code from the app, a recovery code, or a passkey.
    const b = (req.body ?? {}) as Record<string, unknown>;
    const factor = await db.one<{ totp_enabled: boolean }>('select totp_enabled from users where id = $1', [me.id]);
    const hasPasskey = await hasActivePasskey(db, me.id);
    let how = 'password';
    if (factor?.totp_enabled || hasPasskey) {
      const refuse = async (reason: string, field: string): Promise<never> => {
        await audit(req, { action: 'reauth.failure', recordType: 'user', recordId: me.id, summary: `Password confirmation refused: ${reason}` });
        return fail(400, 'validation', 'Check the highlighted fields.', { code: field });
      };
      const code = String(b.code ?? '').trim();
      if (b.webauthn !== undefined && b.webauthn !== null && b.webauthn !== '' && hasPasskey) {
        const result = await passkeySecondFactor(deps, req, me.id, b.webauthn);
        if (result !== 'passed') await refuse('passkey or security key not accepted', 'That passkey or security key was not accepted. Try again, or enter a code.');
        how = 'password and passkey';
      } else if (code) {
        if (factor?.totp_enabled && (await acceptTotpCode(db, me.id, code))) how = 'password and authenticator code';
        else if (await consumeRecoveryCode(db, me.id, code)) {
          how = 'password and a recovery code';
          const left = await db.one<{ n: number }>('select jsonb_array_length(recovery_codes) as n from users where id = $1', [me.id]);
          await audit(req, { action: 'mfa.recovery_code_used', recordType: 'user', recordId: me.id, summary: `Recovery code used to confirm the password; ${left?.n ?? 0} left` });
        } else await refuse('wrong authenticator or recovery code', 'That code was not accepted. Check it and try again.');
      } else {
        // The password was right; now the second factor. Not counted as a failure.
        await slot.release();
        const ask = factor?.totp_enabled
          ? 'Enter the 6-digit code from your authenticator app, or a recovery code.'
          : 'Use your passkey or security key, or enter a recovery code.';
        fail(400, 'second_factor_required', ask, {
          code: ask, ...(factor?.totp_enabled ? { totp: 'available' } : {}), ...(hasPasskey ? { passkey: 'available' } : {}),
        });
      }
    }
    await slot.release();
    const minutes = Math.max(1, Number(await settings.get('auth.reauth_minutes', 10)) || 10);
    await db.query('update sessions set confirmed_at = now() where token_hash = $1', [req.sessionHash]);
    await audit(req, { action: 'reauth.success', recordType: 'user', recordId: me.id, summary: `Identity confirmed (${how}) for administrative actions` });
    return { ok: true, minutes };
  });

  const idList = (raw: unknown) =>
    [...new Set(String(raw ?? '').split(',').map((s) => s.trim()).filter((s) => UUID_RE.test(s)))].slice(0, 500);

  // Names for ids, including people who have since been disabled or removed (History shows who did what).
  app.get('/api/users/labels', async (req) => {
    const ids = idList((req.query as any).ids);
    if (!ids.length) return [];
    return db.query(
      `select id, display_name as label, (deleted_at is null and status <> 'disabled') as active
       from users where id = any($1::uuid[]) order by display_name`, [ids]);
  });

  app.get('/api/users/options', async (req) => {
    const query = req.query as Record<string, string>;
    // `ids=` returns exactly those people (a picker showing its current values), with no 25-row cut.
    if (query.ids !== undefined) {
      const ids = idList(query.ids);
      if (!ids.length) return [];
      return db.query(
        `select id, display_name as label from users where deleted_at is null and id = any($1::uuid[]) order by display_name`, [ids]);
    }
    const q = `%${String(query.q ?? '').trim().replace(/[%_\\]/g, '\\$&')}%`;
    return db.query(
      `select id, display_name as label from users
       where deleted_at is null and status <> 'disabled' and (display_name ilike $1 or username ilike $1)
       order by display_name limit 25`,
      [q],
    );
  });
}
