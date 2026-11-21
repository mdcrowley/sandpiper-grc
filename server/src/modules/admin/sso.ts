// Single sign-on routes for people: the sign-in buttons, the trip to the provider and back, and
// linking, confirming and unlinking identities on Account security. Protocol and policy are in
// server/src/core/identity; the administrator's screens are in providers.ts.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { acceptTotpCode, consumeRecoveryCode, loadUser, requireRecentAuth, SESSION_COOKIE, sha256 } from '../../core/auth.ts';
import { ApiError } from '../../core/errors.ts';
import { DirectoryRefusal } from '../../core/identity/ldap.ts';
import { passkeyLoginOptions, passkeySecondFactor } from '../../core/webauthn/index.ts';
import { makeDbLimiter } from '../../core/ratelimit.ts';
import { linkIdentity } from '../../core/identity/accounts.ts';
import {
  acceptAssertionOnce, auditFailure, beginFlow, callbackPath, consumeFlow, DRIVERS, enabledProviders, finishSignIn, keepPostedResponse,
  LINK_COOKIE, localSignInOn, providerById, providerByKey, publicBase, readSecret, registerSignInPolicy, safeReturn, signinLimiter,
  type IdentityDeps,
} from '../../core/identity/service.ts';
import { IdentityError, type ExternalIdentity, type ProviderRecord } from '../../core/identity/types.ts';
import { verifyLogoutToken } from '../../core/identity/oidc.ts';
import { idpLogoutResponseUrl, serviceProviderMetadata, verifyIdpLogoutRequest, type VerifiedLogoutRequest } from '../../core/identity/saml.ts';
import { LIMITS } from '../../core/identity/samlxml.ts';
import { providerMfaSatisfied } from '../../core/identity/config.ts';
import type { ModuleContext } from '../../core/module.ts';
import { clientIp } from '../../core/request.ts';
import { body } from './shared.ts';

const ACCOUNT = '/account/security';

export function identityDeps(ctx: ModuleContext): IdentityDeps {
  return { app: ctx.app, db: ctx.db, audit: ctx.audit, settings: ctx.settings };
}

/** Methods a person can still sign in with, for the "do not remove the last way in" checks. */
export async function signInMethods(ctx: ModuleContext, userId: string) {
  const row = await ctx.db.one<{ has_password: boolean; break_glass: boolean; allowed: string[] | null }>(
    `select (u.password_hash is not null) as has_password, coalesce(s.break_glass, false) as break_glass, s.allowed_methods as allowed
     from users u left join identity_user_settings s on s.user_id = u.id where u.id = $1`, [userId],
  );
  const identities = await ctx.db.query<{ id: string; provider_id: string; key: string; enabled: boolean }>(
    `select i.id, i.provider_id, p.key, p.enabled from user_identities i
     join identity_providers p on p.id = i.provider_id and p.deleted_at is null where i.user_id = $1`, [userId],
  );
  const localOn = await localSignInOn(ctx);
  const allows = (m: string) => !row?.allowed || row.allowed.includes(m);
  const local = Boolean(row?.has_password) && (localOn || Boolean(row?.break_glass)) && allows('local');
  return { local, identities, allows, hasPassword: Boolean(row?.has_password), breakGlass: Boolean(row?.break_glass) };
}

export function registerSso(ctx: ModuleContext) {
  const { app, db } = ctx;
  const deps = identityDeps(ctx);
  registerSignInPolicy(deps);

  const enabledProvider = async (req: FastifyRequest) => {
    const p = await providerByKey(db, String((req.params as Record<string, string>).key ?? ''));
    if (!p || !p.enabled || !DRIVERS[p.type]?.start) ctx.fail(404, 'not_found', 'That sign-in provider is not available.');
    return p!;
  };

  // ---------- the sign-in page ----------

  // `style`: `redirect` providers get a button; `credentials` providers (a directory, E02-26) are a
  // choice on the password form.
  app.get('/api/auth/providers', { config: { public: true } }, async () => ({
    providers: (await enabledProviders(db)).map((p) => ({ key: p.key, name: p.name, isDefault: p.isDefault, style: DRIVERS[p.type]?.style ?? 'redirect' })),
    localSignIn: await localSignInOn(ctx),
  }));

  // ---------- directory (LDAP) sign-in (E02-26) ----------
  // The person types a directory user name and password into this application's form; the directory
  // checks them (core/identity/ldap.ts). Rate limits as for a password: failures by source address
  // (the shared sign-in bucket), and by user name at this directory; a wrong password also counts
  // toward the progressive lockout of the account it is linked to. The second factor still applies.
  const directoryFailures = makeDbLimiter(db, 'signin_directory', 5, 15 * 60_000); // by provider and user name
  const confirmFailures = makeDbLimiter(db, 'confirm', 8, 5 * 60_000); // by user, shared with POST /api/auth/confirm
  const GENERIC = 'Sign-in failed. Check your details, or wait a few minutes and try again.';

  /** Progressive lockout of a local account, as for a wrong local password (from the 5th failure, 1 minute doubling to 15). */
  async function countAccountFailure(req: FastifyRequest, userId: string) {
    const row = await db.one<{ failed_attempts: number }>('update users set failed_attempts = failed_attempts + 1 where id = $1 returning failed_attempts', [userId]);
    const attempts = row?.failed_attempts ?? 0;
    const lockMinutes = attempts >= 5 ? Math.min(15, 2 ** (attempts - 5)) : 0;
    if (!lockMinutes) return;
    await db.query('update users set locked_until = now() + make_interval(mins => $2::int) where id = $1', [userId, lockMinutes]);
    await ctx.audit(null, { action: 'signin.lockout', recordType: 'user', recordId: userId, summary: `Account locked for ${lockMinutes} minute(s) after ${attempts} failed attempts (directory sign-in)` });
  }

  /** A directory provider by the key in the address, switched on. */
  const directoryProvider = async (req: FastifyRequest) => {
    const p = await providerByKey(db, String((req.params as Record<string, string>).key ?? ''));
    if (!p || !p.enabled || DRIVERS[p.type]?.style !== 'credentials' || !DRIVERS[p.type].authenticate) ctx.fail(404, 'not_found', 'That sign-in provider is not available.');
    return p!;
  };

  /**
   * Checks a directory user name and password, with the rate limits and lockout of a directory sign-in
   * (shared by signing in, the passkey step, linking and confirming: E02-26, E02-29). Every failure is
   * audited (`what` names the step) and answered with the same message.
   */
  async function checkDirectory(req: FastifyRequest, p: ProviderRecord, what: 'Sign-in' | 'Linking' | 'Confirmation', userId?: string): Promise<ExternalIdentity> {
    const b = body(req);
    const username = String(b.username ?? '').trim();
    const password = typeof b.password === 'string' ? b.password : '';
    if (!username || !password) ctx.fail(400, 'validation', 'Check the highlighted fields.', { ...(!username ? { username: 'Enter your user name.' } : {}), ...(!password ? { password: 'Enter your password.' } : {}) });
    // Never logged: the password. The user name is shortened and shown as typed, like a local sign-in.
    const who = `"${username.slice(0, 80).replace(/[\u0000-\u001f]/g, '?')}"`;
    const accountKey = `${p.id}:${username.toLowerCase()}`;
    // Claimed before the directory is asked (wave 9): attempts made at the same moment all count.
    const claim = await directoryFailures.take(accountKey);
    if (!claim.ok) {
      await auditFailure(deps, req, p, `too many failed directory sign-ins for ${who}; refused for a while`, userId, what);
      ctx.fail(401, 'invalid_credentials', GENERIC);
    }
    try {
      const identity = await DRIVERS[p.type].authenticate!(p, readSecret(db, p), username, password);
      await claim.release();
      return identity;
    } catch (err) {
      const refusal = err instanceof DirectoryRefusal ? err : null;
      const reason = err instanceof IdentityError ? err.reason : 'unexpected error';
      if (!(err instanceof IdentityError)) console.error('[identity] directory sign-in failed:', (err as Error)?.message);
      const linked = refusal?.subject
        ? await db.one<{ user_id: string }>('select user_id from user_identities where provider_id = $1 and subject = $2', [p.id, refusal.subject]) : undefined;
      if (refusal?.kind === 'password') {
        if (linked) await countAccountFailure(req, linked.user_id);
      } else {
        await claim.release(); // not a wrong password (directory unreachable, misconfigured): not counted
      }
      await auditFailure(deps, req, p, `${reason} for ${who}`, linked?.user_id ?? userId, what);
      if (refusal?.kind === 'unavailable' || refusal?.kind === 'config') {
        return ctx.fail(502, 'provider_unavailable', `${p.name} cannot be reached just now. Try again, or ask an administrator.`);
      }
      return ctx.fail(401, 'invalid_credentials', GENERIC);
    }
  }
  const clearDirectoryFailures = (req: FastifyRequest, p: ProviderRecord) =>
    directoryFailures.clear(`${p.id}:${String(body(req).username ?? '').trim().toLowerCase()}`);
  const webauthnDeps = { db, audit: ctx.audit, settings: ctx.settings };
  const hasPasskey = async (userId: string) =>
    Boolean(await db.one('select 1 from webauthn_credentials where user_id = $1 and revoked_at is null limit 1', [userId]).catch(() => undefined));
  const given = (v: unknown) => v !== undefined && v !== null && v !== '';

  app.post('/api/auth/sso/:key/login', { config: { public: true } }, async (req, reply) => {
    reply.header('cache-control', 'no-store');
    if (await signinLimiter(db).blocked(clientIp(req))) ctx.fail(429, 'rate_limited', GENERIC);
    const p = await directoryProvider(req);
    const identity = await checkDirectory(req, p, 'Sign-in');
    const b = body(req);
    const code = String(b.totp ?? b.recoveryCode ?? '').trim();
    let keyOnly = false;
    const out = await finishSignIn(deps, req, reply, p, identity, {
      // A directory password is one factor: the person's own second factor still applies: an
      // authenticator code, a passkey or security key (E02-29), or a recovery code.
      secondFactor: async (userId) => {
        const u = await db.one<{ totp_enabled: boolean; locked: boolean }>(
          'select totp_enabled, (locked_until is not null and locked_until > now()) as locked from users where id = $1', [userId],
        );
        if (u?.locked) return { result: 'failed', reason: 'account locked' };
        const hasKey = await hasPasskey(userId);
        if (!u?.totp_enabled && !hasKey) return { result: 'none' };
        keyOnly = !u?.totp_enabled;
        if (hasKey && given(b.webauthn)) {
          if ((await passkeySecondFactor(webauthnDeps, req, userId, b.webauthn)) === 'passed') return { result: 'passed', how: 'a passkey' };
          await countAccountFailure(req, userId);
          return { result: 'failed', reason: 'passkey or security key not accepted' };
        }
        if (!code) return { result: u?.totp_enabled ? 'mfa_required' : 'recovery_required' };
        if (u?.totp_enabled && (await acceptTotpCode(db, userId, code))) return { result: 'passed', how: 'second factor' };
        if (await consumeRecoveryCode(db, userId, code)) {
          const left = await db.one<{ n: number }>('select jsonb_array_length(recovery_codes) as n from users where id = $1', [userId]);
          await ctx.audit(req, { action: 'mfa.recovery_code_used', recordType: 'user', recordId: userId, summary: `Recovery code used to sign in; ${left?.n ?? 0} left` });
          return { result: 'passed', how: 'a recovery code' };
        }
        await countAccountFailure(req, userId);
        return { result: 'failed', reason: u?.totp_enabled ? 'wrong authenticator or recovery code' : 'wrong recovery code' };
      },
    });
    if (out.ok) {
      await clearDirectoryFailures(req, p);
      return { ok: true };
    }
    if (out.code === 'mfa_required') return ctx.fail(401, 'mfa_required', 'Enter the 6-digit code from your authenticator app.');
    if (out.code === 'recovery_required') {
      // E02-29: the person's second factor is a passkey: POST /api/auth/sso/:key/passkey-options, then
      // this route again with `webauthn`. A recovery code works too.
      return ctx.fail(401, 'mfa_required', 'Use your passkey or security key to finish signing in, or enter one of your recovery codes.',
        keyOnly ? { passkey: 'required', recovery: 'available' } : { recovery: 'required' });
    }
    if (out.code === 'link') return { ok: false, link: true };
    if (out.code === 'no_account') return ctx.fail(403, 'no_account', 'Your directory sign-in worked, but there is no account here for you. Ask an administrator to add you.');
    return ctx.fail(401, 'invalid_credentials', GENERIC);
  });

  /**
   * E02-29: the passkey step after a directory password. Checks the directory user name and password
   * again (so a key list is never handed out for a name alone), then answers the options for the
   * linked person's keys, to pass to navigator.credentials.get and send back to the sign-in as `webauthn`.
   */
  app.post('/api/auth/sso/:key/passkey-options', { config: { public: true } }, async (req, reply) => {
    reply.header('cache-control', 'no-store');
    if (await signinLimiter(db).blocked(clientIp(req))) ctx.fail(429, 'rate_limited', GENERIC);
    const p = await directoryProvider(req);
    const identity = await checkDirectory(req, p, 'Sign-in');
    const linked = await db.one<{ user_id: string }>(
      `select i.user_id from user_identities i join users u on u.id = i.user_id
       where i.provider_id = $1 and i.subject = $2 and u.deleted_at is null and u.status = 'active'
         and (u.locked_until is null or u.locked_until <= now())`, [p.id, identity.subject]);
    if (!linked) {
      await auditFailure(deps, req, p, 'passkey step: no active account linked to this directory entry');
      ctx.fail(401, 'invalid_credentials', GENERIC);
    }
    return passkeyLoginOptions(webauthnDeps, req, linked!.user_id);
  });

  // ---------- a directory on Account security (E02-29) ----------

  /** Links a directory to the signed-in person with their directory user name and password. */
  app.post('/api/auth/sso/:key/link-directory', async (req) => {
    const me = req.user!;
    const p = await directoryProvider(req);
    const methods = await signInMethods(ctx, me.id);
    if (methods.breakGlass) ctx.fail(409, 'break_glass', 'The break-glass account signs in with its password only, so it cannot be linked.');
    if (!methods.allows(p.key)) ctx.fail(409, 'not_allowed', `Your account may not use ${p.name}. Ask an administrator.`);
    if (methods.identities.some((i) => i.provider_id === p.id)) ctx.fail(409, 'already_linked', `Your account is already linked to ${p.name}.`);
    // Proof that it is really the account holder: a confirmation in the last few minutes, then the directory's own.
    await requireRecentAuth({ db, audit: ctx.audit, settings: ctx.settings }, req, `linking ${p.name}`);
    if (await confirmFailures.blocked(me.id)) ctx.fail(429, 'rate_limited', 'Too many attempts. Wait a few minutes and try again.');
    let identity: ExternalIdentity;
    try {
      identity = await checkDirectory(req, p, 'Linking', me.id);
    } catch (err) {
      await confirmFailures.hit(me.id);
      throw err;
    }
    const problem = await linkProblem(ctx, me.id, p, identity);
    if (problem) {
      await auditFailure(deps, req, p, problem.reason, me.id, 'Linking');
      ctx.fail(409, problem.code, problem.message);
    }
    await clearDirectoryFailures(req, p);
    await linkIdentity(deps, req, { userId: me.id, provider: p, identity, method: 'self' });
    return { ok: true, provider: p.name };
  });

  /**
   * Confirms the signed-in person's identity with their directory password before a sensitive action
   * (as POST /api/auth/confirm does with a password kept here): the entry must be the one linked to
   * them, and a person with a second factor proves it too (`code` or `webauthn`; 400
   * `second_factor_required` names what they have). Same limits as a password confirmation.
   */
  app.post('/api/auth/sso/:key/confirm', async (req) => {
    const me = req.user!;
    const p = await directoryProvider(req);
    if (!(await db.one('select 1 from user_identities where user_id = $1 and provider_id = $2', [me.id, p.id]))) {
      ctx.fail(409, 'not_linked', `Your account is not linked to ${p.name}.`);
    }
    if (await confirmFailures.blocked(me.id)) ctx.fail(429, 'rate_limited', 'Too many attempts. Wait a few minutes and try again.');
    const refuse = async (reason: string, fields: Record<string, string>): Promise<never> => {
      await confirmFailures.hit(me.id);
      await ctx.audit(req, { action: 'reauth.failure', recordType: 'user', recordId: me.id, summary: `Confirmation through ${p.name} refused: ${reason}` });
      return ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    };
    let identity: ExternalIdentity;
    try {
      identity = await checkDirectory(req, p, 'Confirmation', me.id);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'validation') throw err;
      await confirmFailures.hit(me.id);
      if (err instanceof ApiError && err.code === 'invalid_credentials') {
        return ctx.fail(400, 'validation', 'Check the highlighted fields.', { password: `That is not your ${p.name} user name and password.` });
      }
      throw err;
    }
    if (!(await db.one('select 1 from user_identities where user_id = $1 and provider_id = $2 and subject = $3', [me.id, p.id, identity.subject]))) {
      await refuse('a different directory entry', { password: `Those are not the ${p.name} details linked to your account.` });
    }
    await clearDirectoryFailures(req, p);
    // E02-30: remember the user name that worked (never the password), for the next confirmation.
    if (identity.loginName) {
      await db.query('update user_identities set login_name = $3 where user_id = $1 and provider_id = $2', [me.id, p.id, identity.loginName]);
    }
    // E01-29: a person with a second factor proves it too: a code from the app, a recovery code, or a passkey.
    const b = body(req);
    const factor = await db.one<{ totp_enabled: boolean }>('select totp_enabled from users where id = $1', [me.id]);
    const hasKey = await hasPasskey(me.id);
    let how = `${p.name} password`;
    if (factor?.totp_enabled || hasKey) {
      const code = String(b.code ?? '').trim();
      if (hasKey && given(b.webauthn)) {
        if ((await passkeySecondFactor(webauthnDeps, req, me.id, b.webauthn)) !== 'passed') {
          await refuse('passkey or security key not accepted', { code: 'That passkey or security key was not accepted. Try again, or enter a code.' });
        }
        how += ' and passkey';
      } else if (code) {
        if (factor?.totp_enabled && (await acceptTotpCode(db, me.id, code))) how += ' and authenticator code';
        else if (await consumeRecoveryCode(db, me.id, code)) {
          how += ' and a recovery code';
          const left = await db.one<{ n: number }>('select jsonb_array_length(recovery_codes) as n from users where id = $1', [me.id]);
          await ctx.audit(req, { action: 'mfa.recovery_code_used', recordType: 'user', recordId: me.id, summary: `Recovery code used to confirm identity; ${left?.n ?? 0} left` });
        } else await refuse('wrong authenticator or recovery code', { code: 'That code was not accepted. Check it and try again.' });
      } else {
        // The password was right; now the second factor. Not counted as a failure.
        const ask = factor?.totp_enabled
          ? 'Enter the 6-digit code from your authenticator app, or a recovery code.'
          : 'Use your passkey or security key, or enter a recovery code.';
        ctx.fail(400, 'second_factor_required', ask, {
          code: ask, ...(factor?.totp_enabled ? { totp: 'available' } : {}), ...(hasKey ? { passkey: 'available' } : {}),
        });
      }
    }
    const minutes = Math.max(1, Number(await ctx.settings.get('auth.reauth_minutes', 10)) || 10);
    await db.query('update sessions set confirmed_at = now() where token_hash = $1', [req.sessionHash]);
    await ctx.audit(req, { action: 'reauth.success', recordType: 'user', recordId: me.id, summary: `Identity confirmed (${how}) for administrative actions` });
    return { ok: true, minutes };
  });

  /**
   * How the signed-in person can confirm their identity: their password here, and the directories linked
   * to them, each with the user name last used with it (E02-30), which the confirmation dialog fills in.
   */
  app.get('/api/auth/sso/confirm-methods', async (req) => {
    const me = req.user!;
    const rows = await db.query<{ key: string; name: string; type: string; login_name: string | null }>(
      `select p.key, p.name, p.type, i.login_name from user_identities i join identity_providers p on p.id = i.provider_id and p.deleted_at is null and p.enabled
       where i.user_id = $1 order by p.name`, [me.id]);
    const pw = await db.one<{ has: boolean }>('select password_hash is not null as has from users where id = $1', [me.id]);
    return {
      password: Boolean(pw?.has),
      directories: rows.filter((r) => DRIVERS[r.type]?.style === 'credentials').map((r) => ({ key: r.key, name: r.name, username: r.login_name ?? null })),
    };
  });

  app.post('/api/auth/sso/:key/start', { config: { public: true } }, async (req, reply) => {
    if (await signinLimiter(db).blocked(clientIp(req))) ctx.fail(429, 'rate_limited', 'Too many failed sign-ins from this address. Wait a few minutes and try again.');
    const p = await enabledProvider(req);
    try {
      return { redirectUrl: await beginFlow(deps, req, reply, p, 'signin') };
    } catch (err) {
      await auditFailure(deps, req, p, err instanceof IdentityError ? err.reason : 'could not start');
      return ctx.fail(502, 'provider_unavailable', `${p.name} cannot be reached just now. Try again, or ask an administrator.`);
    }
  });

  /** Where the provider sends the browser back. Always answers with a redirect into the application. */
  app.get('/api/auth/sso/:key/callback', { config: { public: true } }, async (req, reply) => {
    const q = req.query as Record<string, string>;
    const go = (path: string) => reply.header('cache-control', 'no-store').redirect(path, 302);
    const p = await providerByKey(db, String((req.params as Record<string, string>).key ?? ''));
    if (!p || !p.enabled) {
      await auditFailure(deps, req, p, 'provider unknown or switched off');
      return go('/?sso=failed');
    }
    let flow;
    try {
      flow = await consumeFlow(deps, req, reply, p, q.state);
    } catch (err) {
      await auditFailure(deps, req, p, err instanceof IdentityError ? err.reason : 'bad state');
      return go('/?sso=failed');
    }
    const back = flow.purpose === 'signin' ? '/' : safeReturn(flow.returnTo, ACCOUNT);
    const sep = back.includes('?') ? '&' : '?';
    let identity: ExternalIdentity;
    try {
      // SAML: the response is the one posted to the assertion consumer service for this sign-in, never one from the address.
      const params = p.type === 'saml' ? { SAMLResponse: flow.posted ?? '' } : q;
      identity = await DRIVERS[p.type].complete!(p, readSecret(db, p), { params, redirectUri: flow.redirectUri, remember: flow.remember });
      await acceptAssertionOnce(deps, p, identity); // SAML: each assertion works once
    } catch (err) {
      const reason = err instanceof IdentityError ? err.reason : 'unexpected error';
      if (!(err instanceof IdentityError)) console.error('[identity] sign-in could not be completed:', err);
      await auditFailure(deps, req, p, reason, flow.userId ?? undefined, flow.purpose === 'signin' ? 'Sign-in' : flow.purpose === 'link' ? 'Linking' : 'Confirmation');
      return go(flow.purpose === 'signin' ? '/?sso=failed' : `${back}${sep}sso=${flow.purpose}_failed`);
    }

    if (flow.purpose === 'signin') {
      const out = await finishSignIn(deps, req, reply, p, identity);
      return go(out.ok ? '/' : `/?sso=${out.code}`);
    }

    // Linking and confirming belong to the session that started them, which must still be live.
    const live = flow.userId && flow.sessionHash && await db.one(
      'select 1 from sessions where token_hash = $1 and user_id = $2 and expires_at > now()', [flow.sessionHash, flow.userId],
    );
    if (!live) {
      await auditFailure(deps, req, p, 'the session that started it has ended', flow.userId ?? undefined, flow.purpose === 'link' ? 'Linking' : 'Confirmation');
      return go(`/?sso=failed`);
    }
    if (flow.purpose === 'reauth') {
      const mine = await db.one('select 1 from user_identities where provider_id = $1 and subject = $2 and user_id = $3', [p.id, identity.subject, flow.userId]);
      if (!mine) {
        await auditFailure(deps, req, p, 'a different person signed in at the provider', flow.userId!, 'Confirmation');
        return go(`${back}${sep}sso=reauth_failed`);
      }
      // E01-29 and E02-22: with a provider trusted for multi-factor sign-in, a confirmation must show one too.
      if (p.config.providerMfa === true && !providerMfaSatisfied(p.config, identity)) {
        await auditFailure(deps, req, p, 'the provider did not show a multi-factor sign-in', flow.userId!, 'Confirmation');
        return go(`${back}${sep}sso=reauth_failed`);
      }
      await db.query('update sessions set confirmed_at = now() where token_hash = $1', [flow.sessionHash]);
      await ctx.audit(req, { action: 'reauth.success', recordType: 'user', recordId: flow.userId!, summary: `Identity confirmed again through ${p.name} for administrative actions` });
      return go(`${back}${sep}sso=confirmed`);
    }
    // purpose === 'link'
    const problem = await linkProblem(ctx, flow.userId!, p, identity);
    if (problem) {
      await auditFailure(deps, req, p, problem.reason, flow.userId!, 'Linking');
      return go(`${back}${sep}sso=link_failed&why=${problem.code}`);
    }
    req.user = await loadUser(db, flow.userId!); // the person who started it, for the audit event
    await linkIdentity(deps, req, { userId: flow.userId!, provider: p, identity, method: 'self' });
    return go(`${back}${sep}sso=linked`);
  });

  // ---------- a sign-in that matched an account by email: link it with the password ----------

  const pendingLink = async (req: FastifyRequest) => {
    const token = req.cookies[LINK_COOKIE];
    if (!token) return null;
    return db.one<{ state_hash: string; provider_id: string; user_id: string; subject: string; email: string }>(
      `select state_hash, provider_id, user_id, subject, email from identity_flows
       where state_hash = $1 and purpose = 'pending_link' and used_at is null and expires_at > now()`, [sha256(token)],
    );
  };

  app.get('/api/auth/sso/pending', { config: { public: true } }, async (req) => {
    const pending = await pendingLink(req);
    const p = pending && await providerById(db, pending.provider_id);
    if (!pending || !p) return { pending: false };
    const [name, domain] = pending.email.split('@');
    return { pending: true, provider: p.name, email: `${name.slice(0, 2)}${'*'.repeat(Math.max(1, name.length - 2))}@${domain}` };
  });

  app.post('/api/auth/sso/pending/cancel', { config: { public: true } }, async (req, reply) => {
    const pending = await pendingLink(req);
    if (pending) await db.query('update identity_flows set used_at = now() where state_hash = $1', [pending.state_hash]);
    reply.clearCookie(LINK_COOKIE, { path: '/api/auth/sso' });
    return { ok: true };
  });

  app.post('/api/auth/sso/pending/complete', async (req, reply) => {
    const me = req.user!;
    const pending = await pendingLink(req);
    reply.clearCookie(LINK_COOKIE, { path: '/api/auth/sso' });
    const p = pending && await providerById(db, pending.provider_id);
    if (!pending || !p) ctx.fail(404, 'not_found', 'There is no sign-in waiting to be linked. Start again from the sign-in page.');
    if (pending!.user_id !== me.id) {
      await auditFailure(deps, req, p, 'a different account signed in with its password', me.id, 'Linking');
      ctx.fail(409, 'wrong_account', 'That sign-in belongs to a different account here, so nothing was linked.');
    }
    // The password must have been proved just now, in this session.
    const fresh = await db.one('select 1 from sessions where token_hash = $1 and confirmed_at > now() - interval \'5 minutes\'', [req.sessionHash]);
    if (!fresh) ctx.fail(403, 'reauth_required', 'Confirm your password to continue.');
    const claimed = await db.one('update identity_flows set used_at = now() where state_hash = $1 and used_at is null returning 1', [pending!.state_hash]);
    if (!claimed) ctx.fail(409, 'used', 'That sign-in has already been linked or canceled.');
    const identity: ExternalIdentity = { subject: pending!.subject, email: pending!.email, emailVerified: true, displayName: null, groups: [] };
    const problem = await linkProblem(ctx, me.id, p!, identity);
    if (problem) {
      await auditFailure(deps, req, p, problem.reason, me.id, 'Linking');
      ctx.fail(409, problem.code, problem.message);
    }
    await linkIdentity(deps, req, { userId: me.id, provider: p!, identity, method: 'sign_in_confirmed' });
    return { ok: true, provider: p!.name };
  });

  // ---------- Account security: my identities ----------

  app.get('/api/auth/identities', async (req) => {
    const me = req.user!;
    const methods = await signInMethods(ctx, me.id);
    const linked = await db.query(
      `select i.id, i.email, i.linked_at, i.last_used_at, i.link_method, p.key as provider_key, p.name as provider_name, p.type as provider_type, p.enabled
       from user_identities i join identity_providers p on p.id = i.provider_id and p.deleted_at is null
       where i.user_id = $1 order by p.name`, [me.id],
    );
    const session = await db.one<{ method: string; break_glass: boolean; provider: string | null }>(
      `select s.method, s.break_glass, p.name as provider from identity_sessions s left join identity_providers p on p.id = s.provider_id
       where s.token_hash = $1`, [req.sessionHash],
    );
    return {
      identities: linked,
      available: (await enabledProviders(db))
        // `style`: a redirect provider is linked by a trip to it; a directory with its user name and password (E02-29).
        .filter((p) => !linked.some((l: any) => l.provider_key === p.key) && methods.allows(p.key))
        .map((p) => ({ key: p.key, name: p.name, style: DRIVERS[p.type]?.style ?? 'redirect' })),
      hasPassword: methods.hasPassword,
      localSignIn: methods.local,
      breakGlass: methods.breakGlass,
      session: { method: session?.method ?? 'local', provider: session?.provider ?? null, breakGlass: Boolean(session?.break_glass) },
    };
  });

  app.post('/api/auth/sso/:key/link', async (req, reply) => {
    const me = req.user!;
    const p = await enabledProvider(req);
    const methods = await signInMethods(ctx, me.id);
    if (methods.breakGlass) ctx.fail(409, 'break_glass', 'The break-glass account signs in with its password only, so it cannot be linked.');
    if (!methods.allows(p.key)) ctx.fail(409, 'not_allowed', `Your account may not use ${p.name}. Ask an administrator.`);
    if (methods.identities.some((i) => i.provider_id === p.id)) ctx.fail(409, 'already_linked', `Your account is already linked to ${p.name}.`);
    // Proof that it is really the account holder: a password (or provider) confirmation in the last few minutes.
    await requireRecentAuth({ db, audit: ctx.audit, settings: ctx.settings }, req, `linking ${p.name}`);
    return startFor(req, reply, p, 'link');
  });

  app.post('/api/auth/sso/:key/reauth', async (req, reply) => {
    const me = req.user!;
    const p = await enabledProvider(req);
    if (!(await db.one('select 1 from user_identities where user_id = $1 and provider_id = $2', [me.id, p.id]))) {
      ctx.fail(409, 'not_linked', `Your account is not linked to ${p.name}.`);
    }
    return startFor(req, reply, p, 'reauth');
  });

  async function startFor(req: FastifyRequest, reply: FastifyReply, p: ProviderRecord, purpose: 'link' | 'reauth') {
    try {
      const url = await beginFlow(deps, req, reply, p, purpose, {
        userId: req.user!.id, sessionHash: req.sessionHash, returnTo: safeReturn(body(req).returnTo, ACCOUNT),
      });
      return { redirectUrl: url };
    } catch (err) {
      await auditFailure(deps, req, p, err instanceof IdentityError ? err.reason : 'could not start', req.user!.id, purpose === 'link' ? 'Linking' : 'Confirmation');
      return ctx.fail(502, 'provider_unavailable', `${p.name} cannot be reached just now. Try again later.`);
    }
  }

  app.delete('/api/auth/identities/:id', async (req) => {
    const me = req.user!;
    const id = String((req.params as Record<string, string>).id ?? '');
    const row = await db.one<{ id: string; provider_id: string; email: string | null }>(
      'select id, provider_id, email from user_identities where id::text = $1 and user_id = $2', [id, me.id],
    );
    if (!row) ctx.fail(404, 'not_found', 'Linked identity not found.');
    await requireRecentAuth({ db, audit: ctx.audit, settings: ctx.settings }, req, 'unlinking a sign-in provider');
    await unlinkIdentity(ctx, req, me.id, row!, 'by the person');
    return { ok: true };
  });

  // ---------- SAML 2.0 (E02-10) ----------
  // The identity provider posts its response here (HTTP-POST binding) from its own site. A browser
  // sends no SameSite=Lax cookie with that cross-site POST, so the response is only kept for the
  // sign-in its RelayState names, and the browser is sent on to the callback with a GET that does
  // carry the state cookie; the response is checked there. It is a top-level form post from another
  // site, not a call from this application, so the CSRF header is not asked for (route `noCsrf`).
  app.register(async (scoped) => {
    const bodyLimit = Math.ceil(LIMITS.messageBytes / 3) * 4 * 2 + 4096; // base64, then form-encoded
    scoped.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit }, (_req, raw, done) => {
      try { done(null, Object.fromEntries(new URLSearchParams(String(raw)))); } catch (err) { done(err as Error, undefined); }
    });
    scoped.post('/api/auth/sso/:key/acs', { config: { public: true, noCsrf: true }, bodyLimit }, async (req, reply) => {
      const go = (path: string) => reply.header('cache-control', 'no-store').redirect(path, 303);
      if (await signinLimiter(db).blocked(clientIp(req))) return go('/?sso=failed');
      const p = await providerByKey(db, String((req.params as Record<string, string>).key ?? ''));
      if (!p || !p.enabled || p.type !== 'saml') {
        await auditFailure(deps, req, p, 'SAML response for a provider that is unknown, switched off or not SAML');
        return go('/?sso=failed');
      }
      const form = (req.body ?? {}) as Record<string, unknown>;
      const response = form.SAMLResponse;
      const relay = form.RelayState;
      if (typeof response !== 'string' || !response) {
        await auditFailure(deps, req, p, 'no SAMLResponse posted');
        return go('/?sso=failed');
      }
      if (!(await keepPostedResponse(deps, p, relay, response))) {
        await auditFailure(deps, req, p, typeof relay === 'string' && relay
          ? 'SAML response for a sign-in that is unknown, used, expired or already answered'
          : 'unsolicited SAML response (no RelayState): only sign-ins started here are accepted');
        return go('/?sso=failed');
      }
      return go(`${callbackPath(p.key)}?state=${encodeURIComponent(String(relay))}`);
    });
  });

  /** This application's service-provider metadata for one SAML provider, to give to the identity provider. */
  app.get('/api/auth/sso/:key/metadata', { config: { public: true } }, async (req, reply) => {
    const p = await providerByKey(db, String((req.params as Record<string, string>).key ?? ''));
    if (!p || p.type !== 'saml') return ctx.fail(404, 'not_found', 'There is no SAML provider with that short name.');
    let base: string;
    try { base = await publicBase(deps, req); } catch { return ctx.fail(409, 'no_address', 'Set the application address under Sign-in providers first.'); }
    const download = (req.query as Record<string, string>).download === '1';
    reply.header('content-type', 'application/samlmetadata+xml; charset=utf-8').header('cache-control', 'no-store');
    if (download) reply.header('content-disposition', `attachment; filename="${p.key}-metadata.xml"`);
    return reply.send(serviceProviderMetadata(p, `${base}${callbackPath(p.key)}`));
  });

  // ---------- SAML single logout ----------
  // GET with a SAMLResponse: the identity provider sends the browser back after a sign-out started
  // here (SP-initiated); the session here has already ended, so nothing more is needed.
  // GET (HTTP-Redirect) or POST (HTTP-POST) with a SAMLRequest: a sign-out started at the identity
  // provider (E02-27). Acted on only when the provider has it switched on: the signed request is
  // checked, the sessions made through this provider for that NameID (and SessionIndex, when given)
  // end, and a signed LogoutResponse is sent back. A form post from another site: no CSRF header
  // (route `noCsrf`); the request's signature is the proof.
  async function idpLogout(req: FastifyRequest, reply: FastifyReply, binding: 'redirect' | 'post') {
    reply.header('cache-control', 'no-store');
    const go = (url: string) => reply.redirect(url, binding === 'post' ? 303 : 302);
    const p = await providerByKey(db, String((req.params as Record<string, string>).key ?? ''));
    const rawQuery = (req.raw.url ?? '').split('?')[1] ?? '';
    const form = (binding === 'post' ? req.body ?? {} : {}) as Record<string, unknown>;
    const hasRequest = binding === 'post' ? typeof form.SAMLRequest === 'string' : new URLSearchParams(rawQuery).has('SAMLRequest');
    if (!hasRequest || !p || p.type !== 'saml') return go('/');
    // Not switched on for this provider: as before, the browser just comes home (an identity provider
    // sends these to every application at once, so it is not counted as a failure).
    if (!p.enabled || p.config.idpLogout !== true) return go('/');
    const ip = clientIp(req);
    if (await signinLimiter(db).blocked(ip)) return go('/');
    let base: string;
    try { base = await publicBase(deps, req); } catch { return go('/'); }
    const callbackUrl = `${base}${callbackPath(p.key)}`;
    let request: VerifiedLogoutRequest;
    try {
      request = await verifyIdpLogoutRequest(p, binding === 'post' ? { binding, form, callbackUrl } : { binding, rawQuery, callbackUrl });
      // Each request works once.
      await db.query('delete from identity_saml_assertions where expires_at < now()');
      const fresh = await db.one(
        `insert into identity_saml_assertions (provider_id, assertion_id, expires_at) values ($1,$2, now() + interval '15 minutes') on conflict do nothing returning 1`,
        [p.id, `logout:${request.id}`],
      );
      if (!fresh) throw new IdentityError('LogoutRequest replayed');
    } catch (err) {
      await auditFailure(deps, req, p, err instanceof IdentityError ? err.reason : 'unexpected error', undefined, 'Single logout');
      return go('/?sso=failed');
    }
    const linked = await db.one<{ user_id: string }>('select user_id from user_identities where provider_id = $1 and subject = $2', [p.id, request.nameId]);
    const ended = linked ? await db.query<{ user_id: string }>(
      `delete from sessions where token_hash in (
         select s.token_hash from identity_sessions s join sessions x on x.token_hash = s.token_hash
         where s.provider_id = $1 and x.user_id = $2 and (cardinality($3::text[]) = 0 or s.sid = any($3::text[])))
       returning user_id`,
      [p.id, linked.user_id, request.sessionIndexes],
    ) : [];
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    await ctx.audit(req, {
      action: 'identity.saml_logout', recordType: 'user', recordId: linked?.user_id,
      summary: `${p.name} signed ${ended.length} session(s) out (sign-out started at the identity provider, HTTP-${binding === 'post' ? 'POST' : 'Redirect'} binding) from ${ip}${linked ? '' : ' (the NameID is not linked to an account here)'}`,
    });
    const key = readSecret(db, p);
    if (!key) return go('/');
    try {
      return go(await idpLogoutResponseUrl(p, key, { requestId: request.id, relayState: request.relayState, success: true, callbackUrl }));
    } catch {
      return go('/');
    }
  }

  app.get('/api/auth/sso/:key/slo', { config: { public: true } }, async (req, reply) => idpLogout(req, reply, 'redirect'));
  app.register(async (scoped) => {
    scoped.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: Math.ceil(LIMITS.messageBytes / 3) * 4 * 2 + 4096 }, (_req, raw, done) => {
      try { done(null, Object.fromEntries(new URLSearchParams(String(raw)))); } catch (err) { done(err as Error, undefined); }
    });
    scoped.post('/api/auth/sso/:key/slo', { config: { public: true, noCsrf: true } }, async (req, reply) => idpLogout(req, reply, 'post'));
  });

  // ---------- back-channel sign-out (E02-23) ----------
  // The provider calls this, server to server, when a person signs out there or their directory
  // account is disabled. It carries a signed logout token, not a browser session, so the CSRF header
  // is not asked for (route config `noCsrf`); the token's signature is the proof.
  app.register(async (scoped) => {
    scoped.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 32 * 1024 }, (_req, raw, done) => {
      try { done(null, Object.fromEntries(new URLSearchParams(String(raw)))); } catch (err) { done(err as Error, undefined); }
    });
    scoped.post('/api/auth/sso/:key/backchannel-logout', { config: { public: true, noCsrf: true } }, async (req, reply) => {
      reply.header('cache-control', 'no-store');
      const ip = clientIp(req);
      if (await signinLimiter(db).blocked(ip)) return reply.code(429).send({ error: 'rate_limited' });
      const p = await providerByKey(db, String((req.params as Record<string, string>).key ?? ''));
      if (!p || !p.enabled || p.type !== 'oidc' || p.config.backchannelLogout !== true) return reply.code(404).send({ error: 'not_found' });
      const token = (req.body as Record<string, unknown> | undefined)?.logout_token;
      let claims: { sub: string | null; sid: string | null; jti: string | null };
      try {
        if (typeof token !== 'string' || !token) throw new IdentityError('no logout token');
        claims = await verifyLogoutToken(p, token);
      } catch (err) {
        await auditFailure(deps, req, p, err instanceof IdentityError ? err.reason : 'unexpected error', undefined, 'Back-channel sign-out');
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (claims.jti) {
        await db.query(`delete from identity_logout_tokens where received_at < now() - interval '1 day'`);
        const fresh = await db.one('insert into identity_logout_tokens (provider_id, jti) values ($1,$2) on conflict do nothing returning 1', [p.id, claims.jti]);
        if (!fresh) return reply.code(200).send({ ok: true }); // already acted on
      }
      const linked = claims.sub
        ? await db.one<{ user_id: string }>('select user_id from user_identities where provider_id = $1 and subject = $2', [p.id, claims.sub])
        : undefined;
      // Sessions made through this provider: for that person, or for that provider session.
      const ended = await db.query<{ user_id: string }>(
        `delete from sessions where token_hash in (
           select s.token_hash from identity_sessions s join sessions x on x.token_hash = s.token_hash
           where s.provider_id = $1 and (($2::text is not null and s.sid = $2) or ($3::uuid is not null and x.user_id = $3)))
         returning user_id`,
        [p.id, claims.sid, linked?.user_id ?? null],
      );
      const users = [...new Set(ended.map((r) => r.user_id))];
      await ctx.audit(req, {
        action: 'identity.backchannel_logout', recordType: 'user', recordId: users.length === 1 ? users[0] : linked?.user_id,
        summary: `${p.name} signed ${ended.length} session(s) out from ${ip}${claims.sub && !linked ? ' (the subject is not linked to an account here)' : ''}`,
      });
      return reply.code(200).send({ ok: true });
    });
  });

  app.get('/api/auth/sso/session', async (req) => {
    const s = await db.one<{ method: string; break_glass: boolean; provider: string | null }>(
      `select s.method, s.break_glass, p.name as provider from identity_sessions s
       left join identity_providers p on p.id = s.provider_id where s.token_hash = $1`, [req.sessionHash],
    );
    return { method: s?.method ?? 'local', provider: s?.provider ?? null, breakGlass: Boolean(s?.break_glass) };
  });
}

/** Why an identity cannot be linked to this person, or null. */
async function linkProblem(ctx: ModuleContext, userId: string, p: ProviderRecord, identity: ExternalIdentity) {
  const user = await ctx.db.one<{ email: string; break_glass: boolean }>(
    `select u.email, coalesce(s.break_glass, false) as break_glass from users u
     left join identity_user_settings s on s.user_id = u.id where u.id = $1`, [userId],
  );
  if (!user) return { code: 'failed', reason: 'account not found', message: 'Account not found.' };
  if (user.break_glass) return { code: 'break_glass', reason: 'break-glass account', message: 'The break-glass account cannot be linked.' };
  const other = await ctx.db.one<{ user_id: string }>('select user_id from user_identities where provider_id = $1 and subject = $2', [p.id, identity.subject]);
  if (other && other.user_id !== userId) return { code: 'taken', reason: 'identity already linked to another account', message: `That ${p.name} identity is already linked to another account.` };
  if (other) return { code: 'already_linked', reason: 'already linked', message: `Your account is already linked to ${p.name}.` };
  if (await ctx.db.one('select 1 from user_identities where user_id = $1 and provider_id = $2', [userId, p.id])) {
    return { code: 'already_linked', reason: 'account already linked at this provider', message: `Your account is already linked to ${p.name}.` };
  }
  if (!identity.email || !identity.emailVerified) return { code: 'unverified', reason: 'no verified email from the provider', message: `${p.name} did not confirm an email address.` };
  if (identity.email.toLowerCase() !== user.email.toLowerCase()) {
    return { code: 'email', reason: 'provider email differs from the account email', message: `The email address ${p.name} gave is not the one on your account.` };
  }
  return null;
}

/** Removes a link, refusing when it is the person's last way to sign in. Audited. */
export async function unlinkIdentity(
  ctx: ModuleContext, req: FastifyRequest, userId: string, row: { id: string; provider_id: string; email: string | null }, who: string,
) {
  const methods = await signInMethods(ctx, userId);
  const others = methods.identities.filter((i) => i.id !== row.id && i.enabled && methods.allows(i.key));
  if (!methods.local && others.length === 0) {
    ctx.fail(409, 'last_method', 'This is the only way left to sign in to the account, so it cannot be unlinked. Set a password or link another provider first.');
  }
  const p = await providerById(ctx.db, row.provider_id);
  await ctx.db.query('delete from user_identities where id = $1', [row.id]);
  // Other sessions made through that provider end too (not the one doing this).
  await ctx.db.query(
    `delete from sessions where user_id = $1 and token_hash <> $3
       and token_hash in (select token_hash from identity_sessions where provider_id = $2)`,
    [userId, row.provider_id, req.sessionHash ?? ''],
  );
  await ctx.audit(req, {
    action: 'identity.unlink', recordType: 'user', recordId: userId,
    summary: `${p?.name ?? 'Provider'} identity unlinked ${who} (from ${clientIp(req)})`,
    before: { provider: p?.key, email: row.email },
  });
}
