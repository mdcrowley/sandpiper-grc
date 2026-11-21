import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createSession, loadUser, requireRecentAuth, setSessionCookie, verifyPassword } from '../auth.ts';
import { DEFAULT_APP_NAME } from '../config.ts';
import type { Db } from '../db.ts';
import { fail, UUID_RE } from '../errors.ts';
import { afterSignIn, checkSignIn } from '../identity/hooks.ts';
import { makeDbLimiter } from '../ratelimit.ts';
import { clientIp } from '../request.ts';
import type { makeAudit, makeSettings } from '../services.ts';
import { requirePerm } from '../services.ts';
import { fromB64u, readClientData, verifyAssertion, verifyRegistration, WebAuthnError } from './ceremony.ts';
import { relyingParty } from './config.ts';
import { SUPPORTED_ALGS } from './cose.ts';
import {
  activeCredentials, CHALLENGE_SECONDS, cleanName, consumeChallenge, findCredential, issueChallenge, publicView,
  recordUse, saveCredential, type CredentialRow,
} from './store.ts';

/**
 * Passkeys and security keys (WebAuthn, E02-08): registration, sign-in with a passkey alone,
 * a passkey or security key in place of the 6-digit code, and listing, renaming and removing keys.
 * Hooked into core/auth.ts at three points: registerAuth calls registerWebAuthn, the password
 * sign-in calls passkeySecondFactor, and mfaEnrollmentRequired counts a passkey as a second factor.
 */

export interface WebAuthnDeps {
  db: Db;
  audit: ReturnType<typeof makeAudit>;
  settings: ReturnType<typeof makeSettings>;
}

const MAX_KEYS = 10;
const TRANSPORTS = ['usb', 'nfc', 'ble', 'internal', 'hybrid', 'smart-card'];
const GENERIC_SIGNIN_ERROR = 'Sign-in failed. Check your details, or wait a few minutes and try again.';

/** The user handle given to authenticators: the person's id as 16 bytes, base64url. Holds nothing personal. */
export const userHandle = (userId: string) => Buffer.from(userId.replace(/-/g, ''), 'hex').toString('base64url');

/** `auth.passkey_user_verification`: `preferred` (default) or `required` (every use must check a PIN or biometric). */
async function uvPolicy(deps: WebAuthnDeps): Promise<'preferred' | 'required'> {
  return (await deps.settings.get<string>('auth.passkey_user_verification', 'preferred')) === 'required' ? 'required' : 'preferred';
}
/** `auth.passkey_sign_in`: whether a passkey alone (with user verification) may sign a person in. Default on. */
const passwordlessAllowed = async (deps: WebAuthnDeps) => (await deps.settings.get<boolean>('auth.passkey_sign_in', true)) !== false;

const rpOrFail = (req: FastifyRequest) => {
  const rp = relyingParty(req);
  if (rp.problem) fail(400, 'passkeys_unavailable', rp.problem);
  return rp;
};

interface CredentialBody {
  id?: unknown;
  rawId?: unknown;
  type?: unknown;
  response?: Record<string, unknown>;
}
const credentialBody = (raw: unknown): CredentialBody => {
  if (!raw || typeof raw !== 'object') throw new WebAuthnError('malformed', 'The key\'s answer is missing.');
  const c = raw as CredentialBody;
  if (c.type !== 'public-key' || !c.response || typeof c.response !== 'object' || typeof c.id !== 'string') {
    throw new WebAuthnError('malformed', 'The key\'s answer is incomplete.');
  }
  return c;
};

/**
 * Checks a sign-in assertion end to end: uses up its challenge, finds the credential, checks it
 * belongs to `userId` (when given) and verifies the signature, then records the use.
 */
async function checkAssertion(
  deps: WebAuthnDeps, req: FastifyRequest, raw: unknown, opts: { userId?: string; requireUserVerification: boolean },
): Promise<CredentialRow> {
  const body = credentialBody(raw);
  const r = body.response!;
  const clientData = readClientData(r.clientDataJSON);
  const challenge = await consumeChallenge(deps.db, clientData.challenge, 'login');
  if (!challenge) throw new WebAuthnError('challenge', 'This sign-in request has expired or was already used. Start again.');
  const row = await findCredential(deps.db, String(body.id));
  if (!row || (opts.userId && row.user_id !== opts.userId) || (challenge.userId && challenge.userId !== row.user_id)) {
    throw new WebAuthnError('unknown_credential', 'That passkey or security key is not registered here.');
  }
  if (row.revoked_at) throw new WebAuthnError('revoked', 'That passkey or security key was removed from the account.');
  if (r.userHandle !== undefined && r.userHandle !== null && r.userHandle !== '') {
    if (fromB64u(r.userHandle, 'user handle').toString('base64url') !== userHandle(row.user_id)) {
      throw new WebAuthnError('unknown_credential', 'That passkey belongs to a different account.');
    }
  }
  const rp = relyingParty(req);
  const result = verifyAssertion({
    clientData, authenticatorData: r.authenticatorData, signature: r.signature,
    credential: { publicKey: row.public_key, alg: row.alg, signCount: row.sign_count, rpId: row.rp_id },
    rpId: rp.rpId, origins: rp.origins, requireUserVerification: opts.requireUserVerification,
  });
  if (!(await recordUse(deps.db, row.id, result.signCount, clientIp(req)))) {
    throw new WebAuthnError('sign_count', 'The key\'s use counter went backwards, which can mean it was copied. It has been refused.');
  }
  return row;
}

/** Audits a refused passkey; a counter that went backwards is recorded as a possible copy of the key. */
async function auditRefusal(deps: WebAuthnDeps, req: FastifyRequest, err: WebAuthnError, userId?: string, raw?: unknown) {
  let recordId = userId;
  if (!recordId && raw && typeof (raw as CredentialBody).id === 'string') {
    recordId = (await findCredential(deps.db, String((raw as CredentialBody).id)))?.user_id;
  }
  await deps.audit(req, {
    action: err.code === 'sign_count' ? 'passkey.sign_count_regression' : 'passkey.refused',
    recordType: 'user', recordId,
    summary: err.code === 'sign_count'
      ? `Passkey refused: its use counter went backwards (possible copied key) from ${clientIp(req)}`
      : `Passkey refused (${err.code}) from ${clientIp(req)}`,
  });
}

/**
 * Hook for POST /api/auth/login, after the password has been checked. `none`: the person has no
 * passkeys; `needed`: they have, and sent no assertion; `passed`: the assertion in `webauthn` is good
 * and stands in for the 6-digit code; `failed`: it was refused (audited).
 */
export async function passkeySecondFactor(
  deps: WebAuthnDeps, req: FastifyRequest, userId: string, assertion: unknown,
): Promise<'none' | 'needed' | 'passed' | 'failed'> {
  if (!(await deps.db.one('select 1 from webauthn_credentials where user_id = $1 and revoked_at is null limit 1', [userId]))) return 'none';
  if (assertion === undefined || assertion === null || assertion === '') return 'needed';
  try {
    const row = await checkAssertion(deps, req, assertion, { userId, requireUserVerification: (await uvPolicy(deps)) === 'required' });
    await deps.audit(req, { action: 'passkey.used', recordType: 'user', recordId: userId, summary: `Passkey "${row.name}" used as the second factor` });
    return 'passed';
  } catch (err) {
    if (!(err instanceof WebAuthnError)) throw err;
    await auditRefusal(deps, req, err, userId);
    return 'failed';
  }
}

/**
 * Options for the second step of a sign-in, after the person's first factor has been checked (a
 * local password here, or a directory password: E02-29): a challenge tied to that person, listing
 * their keys at this address so that security keys which do not store passkeys work too. Throws
 * 404 `no_passkeys` when they have none here.
 */
export async function passkeyLoginOptions(deps: WebAuthnDeps, req: FastifyRequest, userId: string) {
  const rp = rpOrFail(req);
  const keys = (await activeCredentials(deps.db, userId)).filter((c) => c.rp_id === rp.rpId);
  if (!keys.length) fail(404, 'no_passkeys', 'No passkey or security key is registered for this account at this address.');
  const challenge = await issueChallenge(deps.db, 'login', userId);
  return {
    publicKey: {
      challenge, rpId: rp.rpId, timeout: CHALLENGE_SECONDS * 1000, userVerification: await uvPolicy(deps),
      allowCredentials: keys.map((c) => ({ type: 'public-key', id: c.credential_id, transports: c.transports })),
    },
  };
}

/**
 * Recovery codes belong to a second factor. When a person's last factor goes (no passkey left and no
 * authenticator app), their codes go too, so they cannot later stand in for a factor that is gone.
 */
async function dropOrphanRecoveryCodes(db: Db, userId: string): Promise<void> {
  await db.query(
    `update users set recovery_codes = '[]'::jsonb where id = $1 and not totp_enabled
       and not exists (select 1 from webauthn_credentials c where c.user_id = users.id and c.revoked_at is null)`, [userId],
  );
}

export function registerWebAuthn(app: FastifyInstance, deps: WebAuthnDeps) {
  const { db, audit, settings } = deps;
  const signinFailures = makeDbLimiter(db, 'signin', 20, 5 * 60_000); // shared with password sign-in, by address
  const changeFailures = makeDbLimiter(db, 'mfa_change', 8, 5 * 60_000); // by user

  // ---------- the person's own keys ----------

  app.get('/api/auth/webauthn/credentials', async (req) => {
    const rp = relyingParty(req);
    return {
      credentials: (await activeCredentials(db, req.user!.id)).map(publicView),
      rpId: rp.rpId,
      problem: rp.problem,
      userVerification: await uvPolicy(deps),
      passwordless: await passwordlessAllowed(deps),
      max: MAX_KEYS,
    };
  });

  app.post('/api/auth/webauthn/register/options', async (req) => {
    const me = req.user!;
    const rp = rpOrFail(req);
    await requireRecentAuth(deps, req, 'Adding a passkey or security key');
    const existing = await activeCredentials(db, me.id);
    if (existing.length >= MAX_KEYS) fail(409, 'too_many', `An account can have at most ${MAX_KEYS} passkeys and security keys. Remove one first.`);
    const challenge = await issueChallenge(db, 'register', me.id);
    const uv = await uvPolicy(deps);
    return {
      publicKey: {
        challenge,
        rp: { id: rp.rpId, name: await settings.get('app.name', DEFAULT_APP_NAME) },
        user: { id: userHandle(me.id), name: me.username, displayName: me.displayName },
        pubKeyCredParams: SUPPORTED_ALGS.map((alg) => ({ type: 'public-key', alg })),
        timeout: CHALLENGE_SECONDS * 1000,
        attestation: 'none',
        excludeCredentials: existing.filter((c) => c.rp_id === rp.rpId).map((c) => ({ type: 'public-key', id: c.credential_id, transports: c.transports })),
        authenticatorSelection: { residentKey: 'preferred', requireResidentKey: false, userVerification: uv },
      },
    };
  });

  app.post('/api/auth/webauthn/register', async (req) => {
    const me = req.user!;
    const rp = rpOrFail(req);
    if (await changeFailures.blocked(me.id)) fail(429, 'rate_limited', 'Too many attempts. Wait a few minutes and try again.');
    const b = (req.body ?? {}) as Record<string, unknown>;
    const existing = await activeCredentials(db, me.id);
    const name = cleanName(b.name) || `Passkey ${existing.length + 1}`;
    if (existing.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      fail(400, 'validation', 'Check the highlighted fields.', { name: 'You already have a key with that name.' });
    }
    try {
      const body = credentialBody(b.credential);
      const clientData = readClientData(body.response!.clientDataJSON);
      const challenge = await consumeChallenge(db, clientData.challenge, 'register');
      if (!challenge || challenge.userId !== me.id) throw new WebAuthnError('challenge', 'This request has expired or was already used. Start again.');
      const created = verifyRegistration({
        clientData, attestationObject: body.response!.attestationObject, rpId: rp.rpId, origins: rp.origins,
        requireUserVerification: (await uvPolicy(deps)) === 'required',
      });
      if (body.id !== created.credentialId) throw new WebAuthnError('malformed', 'The key\'s answer does not match its credential.');
      if (await findCredential(db, created.credentialId)) throw new WebAuthnError('duplicate', 'That key is already registered.');
      const transports = Array.isArray(body.response!.transports)
        ? [...new Set((body.response!.transports as unknown[]).map(String).filter((t) => TRANSPORTS.includes(t)))] : [];
      const row = await saveCredential(db, me.id, rp.rpId, name, transports, created);
      // A second factor now exists: any grace period restarts if every factor is later removed.
      await db.query('update users set mfa_required_since = null, updated_at = now() where id = $1', [me.id]);
      await audit(req, {
        action: 'passkey.register', recordType: 'user', recordId: me.id,
        summary: `Passkey "${name}" added (${publicView(row).algorithm}${created.backupEligible ? ', synced' : ''}${created.userVerified ? ', with user verification' : ''})`,
      });
      // E02-21: a first passkey with no authenticator app leaves the person with no way back in if it is
      // lost; the page offers recovery codes then (they are made with POST /api/auth/totp/recovery-codes).
      const codes = await db.one<{ totp: boolean; n: number }>('select totp_enabled as totp, jsonb_array_length(recovery_codes) as n from users where id = $1', [me.id]);
      return { ok: true, credential: publicView(row), offerRecoveryCodes: !codes?.totp && !codes?.n };
    } catch (err) {
      if (!(err instanceof WebAuthnError)) throw err;
      await changeFailures.hit(me.id);
      await audit(req, { action: 'passkey.register_refused', recordType: 'user', recordId: me.id, summary: `Adding a passkey refused (${err.code})` });
      return fail(400, `passkey_${err.code}`, err.message);
    }
  });

  const ownCredential = async (req: FastifyRequest, userId: string) => {
    const id = String((req.params as Record<string, string>).cid ?? '');
    const row = UUID_RE.test(id)
      ? await db.one<CredentialRow>('select * from webauthn_credentials where id = $1 and user_id = $2 and revoked_at is null', [id, userId])
      : undefined;
    if (!row) fail(404, 'not_found', 'That passkey or security key was not found.');
    return row!;
  };

  app.patch('/api/auth/webauthn/credentials/:cid', async (req) => {
    const me = req.user!;
    const row = await ownCredential(req, me.id);
    const name = cleanName(((req.body ?? {}) as Record<string, unknown>).name);
    if (!name) fail(400, 'validation', 'Check the highlighted fields.', { name: 'Enter a name.' });
    const others = await activeCredentials(db, me.id);
    if (others.some((c) => c.id !== row.id && c.name.toLowerCase() === name.toLowerCase())) {
      fail(400, 'validation', 'Check the highlighted fields.', { name: 'You already have a key with that name.' });
    }
    await db.query('update webauthn_credentials set name = $2 where id = $1', [row.id, name]);
    await audit(req, { action: 'passkey.rename', recordType: 'user', recordId: me.id, summary: `Passkey "${row.name}" renamed to "${name}"`, before: { name: row.name }, after: { name } });
    return { ok: true };
  });

  app.delete('/api/auth/webauthn/credentials/:cid', async (req) => {
    const me = req.user!;
    const row = await ownCredential(req, me.id);
    await requireRecentAuth(deps, req, 'Removing a passkey or security key');
    await db.query('update webauthn_credentials set revoked_at = now(), revoked_by = $2 where id = $1', [row.id, me.id]);
    await dropOrphanRecoveryCodes(db, me.id);
    await audit(req, { action: 'passkey.revoke', recordType: 'user', recordId: me.id, summary: `Passkey "${row.name}" removed by its owner` });
    return { ok: true };
  });

  // ---------- an administrator looking after someone else's keys ----------

  const adminPre = { preHandler: requirePerm('admin.administer') };
  const targetUser = (req: FastifyRequest) => {
    const id = String((req.params as Record<string, string>).id ?? '');
    if (!UUID_RE.test(id)) fail(404, 'not_found', 'User not found.');
    return id;
  };

  app.get('/api/admin/users/:id/passkeys', adminPre, async (req) => {
    const userId = targetUser(req);
    if (!(await db.one('select 1 from users where id = $1', [userId]))) fail(404, 'not_found', 'User not found.');
    return { credentials: (await activeCredentials(db, userId)).map(publicView) };
  });

  app.delete('/api/admin/users/:id/passkeys/:cid', adminPre, async (req) => {
    const userId = targetUser(req);
    const row = await ownCredential(req, userId);
    await requireRecentAuth(deps, req, 'Removing someone\'s passkey');
    await db.query('update webauthn_credentials set revoked_at = now(), revoked_by = $2 where id = $1', [row.id, req.user!.id]);
    await dropOrphanRecoveryCodes(db, userId);
    await audit(req, { action: 'passkey.revoke', recordType: 'user', recordId: userId, summary: `Passkey "${row.name}" removed by an administrator` });
    return { ok: true };
  });

  // ---------- confirming one's identity before a sensitive action (E01-29) ----------

  /** A challenge for the signed-in person's own keys, answered in POST /api/auth/confirm as `webauthn`. */
  app.post('/api/auth/webauthn/confirm/options', async (req) => {
    const me = req.user!;
    const rp = rpOrFail(req);
    const keys = (await activeCredentials(db, me.id)).filter((c) => c.rp_id === rp.rpId);
    if (!keys.length) fail(404, 'no_passkeys', 'No passkey or security key is registered for your account at this address.');
    const challenge = await issueChallenge(db, 'login', me.id);
    return {
      publicKey: {
        challenge, rpId: rp.rpId, timeout: CHALLENGE_SECONDS * 1000, userVerification: await uvPolicy(deps),
        allowCredentials: keys.map((c) => ({ type: 'public-key', id: c.credential_id, transports: c.transports })),
      },
    };
  });

  // ---------- sign-in ----------

  /**
   * Options for a sign-in ceremony. With no body: a passkey alone (the browser offers the passkeys it
   * holds for this site). With `username` and `password`: the second step after the password, listing
   * that person's keys so that security keys which do not store passkeys work too. The password is
   * checked here so a key list is never handed out for a name alone.
   */
  app.post('/api/auth/webauthn/login/options', { config: { public: true } }, async (req) => {
    const rp = rpOrFail(req);
    const ip = clientIp(req);
    if (await signinFailures.blocked(ip)) fail(429, 'rate_limited', GENERIC_SIGNIN_ERROR);
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (b.username === undefined) {
      if (!(await passwordlessAllowed(deps))) fail(403, 'passkey_sign_in_off', 'Signing in with a passkey alone is switched off here. Sign in with your password.');
      const challenge = await issueChallenge(db, 'login', null);
      return { publicKey: { challenge, rpId: rp.rpId, timeout: CHALLENGE_SECONDS * 1000, userVerification: 'required', allowCredentials: [] } };
    }
    const identifier = String(b.username ?? '').trim().toLowerCase();
    const u = await db.one<{ id: string; password_hash: string | null; status: string; locked: boolean }>(
      `select id, password_hash, status, (locked_until is not null and locked_until > now()) as locked
       from users where deleted_at is null and (lower(username) = $1 or lower(email) = $1)`, [identifier],
    );
    const ok = u && u.status === 'active' && !u.locked && u.password_hash && (await verifyPassword(u.password_hash, String(b.password ?? '')));
    if (!ok) {
      await signinFailures.hit(ip);
      await audit(req, { action: 'signin.failure', recordType: 'user', recordId: u?.id, summary: `Sign-in failed (passkey step: wrong details) for "${identifier.slice(0, 80)}" from ${ip}` });
      fail(401, 'invalid_credentials', GENERIC_SIGNIN_ERROR);
    }
    return passkeyLoginOptions(deps, req, u!.id);
  });

  /** Signs in with a passkey alone. The key must have checked a PIN or biometric (user verification). */
  app.post('/api/auth/webauthn/login', { config: { public: true } }, async (req, reply) => {
    rpOrFail(req);
    const ip = clientIp(req);
    if (await signinFailures.blocked(ip)) fail(429, 'rate_limited', GENERIC_SIGNIN_ERROR);
    if (!(await passwordlessAllowed(deps))) fail(403, 'passkey_sign_in_off', 'Signing in with a passkey alone is switched off here. Sign in with your password.');
    const raw = ((req.body ?? {}) as Record<string, unknown>).credential;
    let row: CredentialRow;
    try {
      row = await checkAssertion(deps, req, raw, { requireUserVerification: true });
    } catch (err) {
      if (!(err instanceof WebAuthnError)) throw err;
      await signinFailures.hit(ip);
      await auditRefusal(deps, req, err, undefined, raw);
      const message = ['challenge', 'no_verification', 'revoked', 'unknown_credential'].includes(err.code) ? err.message : GENERIC_SIGNIN_ERROR;
      return fail(401, `passkey_${err.code}`, message);
    }
    const u = await db.one<{ id: string; status: string; locked: boolean }>(
      `select id, status, (locked_until is not null and locked_until > now()) as locked from users where id = $1 and deleted_at is null`, [row.user_id],
    );
    if (!u || u.status !== 'active' || u.locked) {
      await signinFailures.hit(ip);
      await audit(req, { action: 'signin.failure', recordType: 'user', recordId: row.user_id, summary: `Sign-in failed (account inactive or locked) via passkey from ${ip}` });
      return fail(401, 'invalid_credentials', GENERIC_SIGNIN_ERROR);
    }
    // Sign-in policies (core/identity/hooks.ts) treat a passkey like a local sign-in.
    const refused = await checkSignIn(app, { userId: u.id, method: 'local' });
    if (refused) {
      await signinFailures.hit(ip);
      await audit(req, { action: 'signin.failure', recordType: 'user', recordId: u.id, summary: `Sign-in failed (${refused}) via passkey from ${ip}` });
      return fail(401, 'invalid_credentials', GENERIC_SIGNIN_ERROR);
    }
    await db.query('update users set failed_attempts = 0, locked_until = null, last_login_at = now() where id = $1', [u.id]);
    const token = await createSession(db, u.id, ip, req.headers['user-agent']);
    setSessionCookie(req, reply, token);
    req.user = await loadUser(db, u.id);
    await audit(req, { action: 'signin.success', recordType: 'user', recordId: u.id, summary: `Signed in via passkey "${row.name}"` });
    await afterSignIn(app, req, { userId: u.id, method: 'local', sessionToken: token });
    return { ok: true };
  });
}
