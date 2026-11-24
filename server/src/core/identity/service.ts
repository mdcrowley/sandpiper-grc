// The sign-in provider service: providers by key, sign-ins in flight, finishing a sign-in, and the
// sign-in policy that core sign-in consults (local passwords off, per-person limits, break-glass).
// Routes live in the administration module (server/src/modules/admin/sso.ts and providers.ts).
import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createSession, loadUser, secretBox, setSessionCookie, sha256 } from '../auth.ts';
import type { Db } from '../db.ts';
import { makeDbLimiter } from '../ratelimit.ts';
import { clientIp, cookieSecure } from '../request.ts';
import { isBreakGlass, resolveSignIn, syncMappedRoles, type Audit } from './accounts.ts';
import { configuredBase, loopbackBase } from './base.ts';
import { providerMfaSatisfied } from './config.ts';
import { addSignInPolicy, afterSignIn, checkSignIn } from './hooks.ts';
import { setProviderAllowList } from './http.ts';
import { ldapDriver } from './ldap.ts';
import { endSessionUrl, oidcDriver } from './oidc.ts';
import { samlDriver, samlLogoutUrl } from './saml.ts';
import { IdentityError, type ExternalIdentity, type ProviderDriver, type ProviderRecord, type RedirectStart } from './types.ts';

export interface IdentityDeps {
  app: FastifyInstance;
  db: Db;
  audit: Audit;
  settings: { get<T>(key: string, fallback: T): Promise<T> };
}

/**
 * The kinds of provider: OpenID Connect (oidc.ts), SAML 2.0 (saml.ts, E02-10; XML signatures
 * checked by @node-saml/node-saml with this application's own hardening in samlxml.ts) and a
 * directory (ldap.ts, E02-26: a user name and password typed here, checked by the directory).
 */
export const DRIVERS: Record<string, ProviderDriver> = { oidc: oidcDriver, saml: samlDriver, ldap: ldapDriver };

export const FLOW_COOKIE = 'grc_sso';
export const LINK_COOKIE = 'grc_sso_link';
const COOKIE_PATH = '/api/auth/sso';
const FLOW_MINUTES = 10;

const PROVIDER_COLS = 'id, key, type, name, enabled, is_default, config, secret, sort';
const toRecord = (r: any): ProviderRecord => ({
  id: r.id, key: r.key, type: r.type, name: r.name, enabled: r.enabled, isDefault: r.is_default, config: r.config ?? {}, secretSealed: r.secret,
});

export async function providerByKey(db: Db, key: string): Promise<ProviderRecord | null> {
  const row = await db.one(`select ${PROVIDER_COLS} from identity_providers where key = $1 and deleted_at is null`, [String(key)]);
  return row ? toRecord(row) : null;
}

export async function providerById(db: Db, id: string): Promise<ProviderRecord | null> {
  const row = await db.one(`select ${PROVIDER_COLS} from identity_providers where id = $1 and deleted_at is null`, [id]);
  return row ? toRecord(row) : null;
}

/** Enabled providers, default first, for the sign-in page. */
export async function enabledProviders(db: Db): Promise<ProviderRecord[]> {
  return (await db.query(`select ${PROVIDER_COLS} from identity_providers where enabled and deleted_at is null order by is_default desc, sort, lower(name)`)).map(toRecord);
}

const secretContext = (providerId: string) => `idp:${providerId}`;
export const sealSecret = (db: Db, providerId: string, secret: string) => secretBox(db).encrypt(secret, secretContext(providerId));
export function readSecret(db: Db, provider: ProviderRecord): string | null {
  if (!provider.secretSealed) return null;
  try {
    return secretBox(db).decrypt(provider.secretSealed, secretContext(provider.id));
  } catch {
    return null; // written with another secret key: the administrator enters it again
  }
}

/** IdentityError reason when single sign-on has no trusted address to give the provider (W19). */
export const NO_APPLICATION_ADDRESS = 'no application address';

/** What a person or administrator is told when single sign-on has no trusted address (W19). */
export const SSO_ADDRESS_REQUIRED = 'Single sign-on needs the application address: an administrator sets it under Administration > '
  + 'Sign-in providers ("Application address", auth.public_url). Without it, single sign-on works only on this computer.';

/**
 * This application's address for single sign-on (the OpenID Connect redirect address, the SAML entity
 * ID, ACS and single logout addresses, the sign-out return address): `auth.public_url`, else the Host
 * header only when it names this computer (core/identity/base.ts, as for MCP and calendar feeds). On an
 * installation other computers reach, a Host header is whatever the caller sent: building these
 * addresses from it let a caller choose which service provider this installation claims to be (W19).
 * Throws an IdentityError (reason NO_APPLICATION_ADDRESS) when neither applies.
 */
export async function publicBase(deps: IdentityDeps, req: FastifyRequest): Promise<string> {
  const base = (await configuredBase(deps.settings)) || loopbackBase(req);
  if (!base) throw new IdentityError(NO_APPLICATION_ADDRESS, SSO_ADDRESS_REQUIRED);
  return base;
}

export const callbackPath = (key: string) => `/api/auth/sso/${encodeURIComponent(key)}/callback`;

/** A safe place inside the application to go back to: a path, never another site. */
export function safeReturn(raw: unknown, fallback: string): string {
  const r = typeof raw === 'string' ? raw.trim() : '';
  return /^\/(?![/\\])[^\s]{0,300}$/.test(r) ? r : fallback;
}

// ---------- sign-ins in flight ----------

export type FlowPurpose = 'signin' | 'link' | 'reauth';

/** Starts a redirect sign-in: stores the state and returns where to send the browser. */
export async function beginFlow(
  deps: IdentityDeps, req: FastifyRequest, reply: FastifyReply, provider: ProviderRecord, purpose: FlowPurpose,
  opts: { userId?: string; sessionHash?: string | null; returnTo?: string } = {},
): Promise<string> {
  const driver = DRIVERS[provider.type];
  if (!driver?.start) throw new IdentityError('provider kind cannot start a sign-in');
  const state = randomBytes(32).toString('base64url');
  const stateHash = sha256(state);
  const redirectUri = `${await publicBase(deps, req)}${callbackPath(provider.key)}`;
  const started: RedirectStart = await driver.start(provider, { redirectUri, state, reauth: purpose === 'reauth', secret: readSecret(deps.db, provider) });
  await deps.db.query('delete from identity_flows where expires_at < now()');
  await deps.db.query(
    `insert into identity_flows (state_hash, provider_id, purpose, remember, redirect_uri, user_id, session_hash, return_to, expires_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8, now() + make_interval(mins => $9::int))`,
    [stateHash, provider.id, purpose, secretBox(deps.db).encrypt(JSON.stringify(started.remember), `sso:${stateHash}`), redirectUri,
      opts.userId ?? null, opts.sessionHash ?? null, opts.returnTo ?? null, FLOW_MINUTES],
  );
  // Lax, not Strict: the browser must send it when the provider sends it back here (a top-level GET).
  reply.setCookie(FLOW_COOKIE, state, { httpOnly: true, sameSite: 'lax', path: COOKIE_PATH, maxAge: FLOW_MINUTES * 60, secure: cookieSecure(req) });
  return started.url;
}

export interface Flow {
  stateHash: string; providerId: string; purpose: FlowPurpose; redirectUri: string;
  userId: string | null; sessionHash: string | null; returnTo: string | null; remember: RedirectStart['remember'];
  /** SAML: the response the provider posted to the assertion consumer service, kept until this browser comes for it. */
  posted: string | null;
}

/**
 * SAML (E02-10): the identity provider posts its response from its own site, and a browser does not
 * send this application's SameSite=Lax state cookie with a cross-site POST. So the posted response
 * is only kept (encrypted, at most once, for a sign-in in flight that the RelayState names) and the
 * browser is sent on to the callback with a GET, which carries the cookie: the response is checked
 * there, bound to the browser that started the sign-in, exactly like an OpenID Connect callback.
 */
export async function keepPostedResponse(deps: IdentityDeps, provider: ProviderRecord, state: unknown, response: string): Promise<boolean> {
  if (typeof state !== 'string' || !state || state.length > 200) return false;
  const stateHash = sha256(state);
  const row = await deps.db.one(
    `update identity_flows set posted = $3
     where state_hash = $1 and provider_id = $2 and used_at is null and expires_at > now() and purpose <> 'pending_link' and posted is null
     returning 1`,
    [stateHash, provider.id, secretBox(deps.db).encrypt(response, `sso-post:${stateHash}`)],
  );
  return Boolean(row);
}

/**
 * SAML (E02-10): an assertion is accepted once. Its ID is remembered, per provider, until it could
 * no longer be presented; a second use is refused, on every server sharing the database.
 */
export async function acceptAssertionOnce(deps: Pick<IdentityDeps, 'db'>, provider: ProviderRecord, identity: ExternalIdentity): Promise<void> {
  if (!identity.assertion) return;
  await deps.db.query('delete from identity_saml_assertions where expires_at < now()');
  const fresh = await deps.db.one(
    'insert into identity_saml_assertions (provider_id, assertion_id, expires_at) values ($1,$2,$3) on conflict do nothing returning 1',
    [provider.id, identity.assertion.id, identity.assertion.until.toISOString()],
  );
  if (!fresh) throw new IdentityError('assertion replayed');
}

/** Takes the flow named by `state` once: it must match this browser's cookie, be unused, unexpired and for this provider. */
export async function consumeFlow(deps: IdentityDeps, req: FastifyRequest, reply: FastifyReply, provider: ProviderRecord, state: unknown): Promise<Flow> {
  const cookie = req.cookies[FLOW_COOKIE];
  reply.clearCookie(FLOW_COOKIE, { path: COOKIE_PATH });
  if (typeof state !== 'string' || !state || state.length > 200) throw new IdentityError('no state');
  if (!cookie || cookie !== state) throw new IdentityError('state does not match this browser');
  const stateHash = sha256(state);
  const row = await deps.db.one<any>(
    `update identity_flows f set used_at = now(), posted = null
     from (select state_hash, posted from identity_flows where state_hash = $1) old
     where f.state_hash = old.state_hash and f.used_at is null and f.expires_at > now() and f.purpose <> 'pending_link'
     returning f.provider_id, f.purpose, f.remember, f.redirect_uri, f.user_id, f.session_hash, f.return_to, old.posted`,
    [stateHash],
  );
  if (!row) throw new IdentityError('state unknown, used or expired');
  if (row.provider_id !== provider.id) throw new IdentityError('state belongs to another provider');
  let remember: RedirectStart['remember'];
  let posted: string | null = null;
  try {
    remember = JSON.parse(secretBox(deps.db).decrypt(row.remember, `sso:${stateHash}`));
    if (row.posted) posted = secretBox(deps.db).decrypt(row.posted, `sso-post:${stateHash}`);
  } catch {
    throw new IdentityError('state unreadable');
  }
  return {
    stateHash, providerId: row.provider_id, purpose: row.purpose, redirectUri: row.redirect_uri,
    userId: row.user_id, sessionHash: row.session_hash, returnTo: row.return_to, remember, posted,
  };
}

// ---------- failures ----------

export function signinLimiter(db: Db) {
  return makeDbLimiter(db, 'signin', 20, 5 * 60_000); // the same bucket as password sign-in
}

export async function auditFailure(deps: IdentityDeps, req: FastifyRequest, provider: ProviderRecord | null, reason: string, userId?: string, what = 'Sign-in') {
  await signinLimiter(deps.db).hit(clientIp(req));
  await deps.audit(req, {
    action: what === 'Sign-in' ? 'signin.failure' : 'identity.failure', recordType: 'user', recordId: userId,
    summary: `${what} failed (${reason.slice(0, 160)}) via ${provider ? `${provider.name} (${provider.key})` : 'single sign-on'} from ${clientIp(req)}`,
  });
}

// ---------- finishing a sign-in ----------

export type SignInOutcome = { ok: true; userId: string } | { ok: false; code: 'failed' | 'no_account' | 'link' | 'mfa_required' | 'recovery_required' };

/**
 * E02-26: a directory password is one factor, so a directory sign-in asks for the person's own second
 * factor here before the session is made. `passed` (with how, for the audit event), `none` (the
 * person has none), a step still missing, or a failure reason (audited, and counted toward lockout).
 */
export type SecondFactorCheck = (userId: string) => Promise<
  { result: 'passed'; how: string } | { result: 'none' } | { result: 'mfa_required' | 'recovery_required' } | { result: 'failed'; reason: string }
>;

/** Signs in as the person the identity resolves to (or says what is missing). Audits either way. */
export async function finishSignIn(
  deps: IdentityDeps, req: FastifyRequest, reply: FastifyReply, provider: ProviderRecord, identity: ExternalIdentity,
  opts: { secondFactor?: SecondFactorCheck } = {},
): Promise<SignInOutcome> {
  const resolved = await resolveSignIn(deps, req, provider, identity);
  if (resolved.kind === 'refused') {
    await auditFailure(deps, req, provider, resolved.reason, resolved.userId);
    return { ok: false, code: resolved.noAccount ? 'no_account' : 'failed' };
  }
  if (resolved.kind === 'link_needed') {
    const token = randomBytes(32).toString('base64url');
    await deps.db.query(
      `insert into identity_flows (state_hash, provider_id, purpose, user_id, subject, email, expires_at)
       values ($1,$2,'pending_link',$3,$4,$5, now() + make_interval(mins => $6::int))`,
      [sha256(token), provider.id, resolved.userId, identity.subject, identity.email, FLOW_MINUTES],
    );
    reply.setCookie(LINK_COOKIE, token, { httpOnly: true, sameSite: 'strict', path: COOKIE_PATH, maxAge: FLOW_MINUTES * 60, secure: cookieSecure(req) });
    await deps.audit(req, {
      action: 'identity.link_pending', recordType: 'user', recordId: resolved.userId,
      summary: `${provider.name} sign-in matched this account by verified email; waiting for the password to link them (from ${clientIp(req)})`,
    });
    return { ok: false, code: 'link' };
  }
  const user = await loadUser(deps.db, resolved.userId);
  if (!user) {
    await auditFailure(deps, req, provider, 'account disabled or waiting for setup', resolved.userId);
    return { ok: false, code: 'failed' };
  }
  const refused = await checkSignIn(deps.app, { userId: user.id, method: provider.key });
  if (refused) {
    await auditFailure(deps, req, provider, refused, user.id);
    return { ok: false, code: 'failed' };
  }
  let factor = '';
  if (opts.secondFactor) {
    const second = await opts.secondFactor(user.id);
    if (second.result === 'mfa_required' || second.result === 'recovery_required') return { ok: false, code: second.result };
    if (second.result === 'failed') {
      await auditFailure(deps, req, provider, second.reason, user.id);
      return { ok: false, code: 'failed' };
    }
    if (second.result === 'passed') factor = ` with ${second.how}`;
  }
  if (identity.groupsUnknown && provider.config.mappingEnabled) {
    // E02-24: the provider has groups for this person but did not send them. Removing roles because
    // "no group matched" would be wrong, so roles are left as they are, and that is recorded.
    await deps.audit(req, {
      action: 'identity.groups_unknown', recordType: 'user', recordId: user.id,
      summary: `${provider.name} said this person has too many groups to list and they could not be fetched; roles were left unchanged`,
    });
  } else {
    await syncMappedRoles(deps, req, user.id, provider, identity.groups);
  }
  const mfa = providerMfaSatisfied(provider.config, identity);
  await deps.db.query('update users set last_login_at = now(), failed_attempts = 0, locked_until = null where id = $1', [user.id]);
  await deps.db.query('update user_identities set last_used_at = now(), email = coalesce($3, email), login_name = coalesce($4, login_name) where provider_id = $1 and subject = $2',
    [provider.id, identity.subject, identity.email, identity.loginName ?? null]);
  const token = await createSession(deps.db, user.id, clientIp(req), req.headers['user-agent']);
  setSessionCookie(req, reply, token);
  req.user = await loadUser(deps.db, user.id);
  await deps.audit(req, {
    action: 'signin.success', recordType: 'user', recordId: user.id,
    summary: `Signed in via ${provider.name} (${DRIVERS[provider.type]?.label ?? provider.type})${mfa ? ' with a multi-factor sign-in at the provider' : ''}${factor} from ${clientIp(req)}`,
  });
  await afterSignIn(deps.app, req, {
    userId: user.id, method: provider.key, sessionToken: token,
    provider: {
      mfa, sid: identity.sid ?? null,
      // Kept (encrypted) only to name the session when signing out at the provider: the ID token, or the SAML NameID and session index.
      idToken: provider.config.endSession === true ? identity.idToken ?? (identity.samlSession ? JSON.stringify(identity.samlSession) : null) : null,
    },
  });
  return { ok: true, userId: user.id };
}

// ---------- sign-in policy ----------

export async function localSignInOn(deps: Pick<IdentityDeps, 'settings'>): Promise<boolean> {
  return (await deps.settings.get<boolean>('auth.local_signin', true)) !== false;
}

/** Registers the rules core sign-in asks about, and what happens after each sign-in. */
export function registerSignInPolicy(deps: IdentityDeps): void {
  // Calls to providers reach a private address only when it is listed exactly (W17-6, http.ts).
  setProviderAllowList(() => deps.settings.get<unknown>('integrations.allowed_hosts', []));
  addSignInPolicy(deps.app, {
    async check({ userId, method }) {
      const s = await deps.db.one<{ break_glass: boolean; allowed_methods: string[] | null }>(
        'select break_glass, allowed_methods from identity_user_settings where user_id = $1', [userId],
      );
      if (s?.break_glass) return method === 'local' ? null : 'the break-glass account signs in with its local password only';
      if (method === 'local' && !(await localSignInOn(deps))) return 'local passwords are switched off';
      if (s?.allowed_methods && !s.allowed_methods.includes(method)) {
        return method === 'local' ? 'this person may not sign in with a password' : 'this person may not use this provider';
      }
      return null;
    },
    async after(req, { userId, method, sessionToken, provider: facts }) {
      const breakGlass = await isBreakGlass(deps.db, userId);
      const provider = method === 'local' ? null : await providerByKey(deps.db, method);
      const tokenHash = sha256(sessionToken);
      // The ID token is kept only to name the session at the provider's sign-out page (E02-23), encrypted.
      const idTokenSealed = provider && facts?.idToken ? secretBox(deps.db).encrypt(facts.idToken, `sso-session:${tokenHash}`) : null;
      await deps.db.query(
        `insert into identity_sessions (token_hash, method, provider_id, break_glass, mfa, sid, id_token_sealed)
         values ($1,$2,$3,$4,$5,$6,$7) on conflict (token_hash) do nothing`,
        [tokenHash, method, provider?.id ?? null, breakGlass, Boolean(provider && facts?.mfa), provider ? facts?.sid ?? null : null, idTokenSealed],
      );
      if (breakGlass) await breakGlassAlarm(deps, req, userId);
    },
    // E02-22: a session made through a provider trusted for multi-factor sign-in, whose token showed it.
    async sessionSecondFactor(sessionHash) {
      return Boolean(await deps.db.one(
        `select 1 from identity_sessions s join identity_providers p on p.id = s.provider_id and p.deleted_at is null
         where s.token_hash = $1 and s.mfa and coalesce((p.config->>'providerMfa')::boolean, false)`, [sessionHash],
      ));
    },
    // E02-23: signing out here also signs out at the provider, when that is switched on for it.
    async signOutRedirect(req, sessionHash) {
      const s = await deps.db.one<{ provider_id: string | null; id_token_sealed: string | null }>(
        'select provider_id, id_token_sealed from identity_sessions where token_hash = $1', [sessionHash],
      );
      if (!s?.provider_id) return null;
      const provider = await providerById(deps.db, s.provider_id);
      if (!provider || !provider.enabled || provider.config.endSession !== true) return null;
      let idToken: string | null = null;
      if (s.id_token_sealed) {
        try { idToken = secretBox(deps.db).decrypt(s.id_token_sealed, `sso-session:${sessionHash}`); } catch { idToken = null; }
      }
      let base: string;
      try { base = await publicBase(deps, req); } catch { return null; }
      if (provider.type === 'saml') {
        return samlLogoutUrl(provider, readSecret(deps.db, provider), { session: idToken, callbackUrl: `${base}${callbackPath(provider.key)}` });
      }
      return endSessionUrl(provider, { idToken, postLogoutRedirectUri: `${base}/` });
    },
  });
}

/** Every use of the break-glass account: a prominent audit event and an in-app alert to every administrator. */
async function breakGlassAlarm(deps: IdentityDeps, req: FastifyRequest, userId: string): Promise<void> {
  const user = req.user ?? (await loadUser(deps.db, userId));
  const ip = clientIp(req);
  await deps.audit(req, {
    action: 'signin.break_glass', recordType: 'user', recordId: userId,
    summary: `BREAK-GLASS ACCOUNT USED: ${user?.username ?? userId} signed in from ${ip}. Every administrator has been alerted.`,
  });
  const app = deps.app as any;
  if (app.hasDecorator?.('notify') && typeof app.notify === 'function') {
    try {
      await app.notify({
        permission: 'admin.administer', kind: 'general',
        title: `Break-glass account used: ${user?.displayName ?? 'emergency administrator'}`,
        body: `The break-glass account ${user?.username ?? ''} signed in from ${ip} at ${new Date().toISOString()}. If this was not a planned emergency, end its sessions and change its password now.`,
        route: `/admin/users/${userId}`,
      });
    } catch (err) {
      console.error('[identity] break-glass notification failed:', err);
    }
  }
  // And by email, when an administrator has switched email on (core/mail; it sends nothing otherwise).
  if (app.hasDecorator?.('sendMail') && typeof app.sendMail === 'function') {
    try {
      await app.sendMail({
        permission: 'admin.administer', purpose: 'break_glass', link: '/admin/audit',
        subject: `Break-glass account used: ${user?.username ?? 'emergency administrator'}`,
        text: `The break-glass account ${user?.username ?? ''} signed in from ${ip} at ${new Date().toISOString()}. `
          + 'If this was not a planned emergency, end its sessions and change its password now. The audit log has the details.',
      });
    } catch (err) {
      console.error('[identity] break-glass email failed:', err);
    }
  }
}
