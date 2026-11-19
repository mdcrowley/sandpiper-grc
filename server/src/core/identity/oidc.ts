// OpenID Connect sign-in (authorization code flow with PKCE, `state` and `nonce`), for any compliant
// identity provider. Issuer, client and claims are configuration; endpoints come from the provider's
// discovery document. Nothing here runs until a provider is switched on, or an administrator selects
// "Test connection".
import { createHash, randomBytes } from 'node:crypto';
import { assertAddress, addressProblem, fetchJson } from './http.ts';
import { candidateKeys, checkIdTokenClaims, parseJwt, SUPPORTED_ALGS, verifySignature, type Jwk, type JwtAlg } from './jwt.ts';
import { cleanCommonConfig } from './config.ts';
import { IdentityError, type ExternalIdentity, type OidcConfig, type ProviderDriver, type ProviderRecord, type TestResult } from './types.ts';

export interface DiscoveryDoc {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
  id_token_signing_alg_values_supported?: string[];
  code_challenge_methods_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
  /** RP-initiated logout (E02-23). */
  end_session_endpoint?: string;
  backchannel_logout_supported?: boolean;
  [k: string]: unknown;
}

/** The event a back-channel logout token carries (OpenID Connect Back-Channel Logout 1.0). */
export const BACKCHANNEL_EVENT = 'http://schemas.openid.net/event/backchannel-logout';

/** Cache lifetimes. Exported so tests can shorten them; nothing else should change them. */
export const oidcCache = {
  discoveryTtlMs: 60 * 60_000,
  jwksTtlMs: 60 * 60_000,
  /** An unknown key id triggers a fresh key set (key rotation), at most this often. */
  jwksMinRefreshMs: 60_000,
};

const discoveries = new Map<string, { doc: DiscoveryDoc; at: number }>();
const keySets = new Map<string, { keys: Jwk[]; at: number }>();

const b64url = (buf: Buffer) => buf.toString('base64url');
export const pkceChallenge = (verifier: string) => b64url(createHash('sha256').update(verifier).digest());
const RESERVED_PARAMS = new Set([
  'client_id', 'redirect_uri', 'response_type', 'scope', 'state', 'nonce', 'code_challenge', 'code_challenge_method',
  'prompt', 'max_age', 'response_mode', 'request', 'request_uri',
]);

export const discoveryUrl = (issuer: string) => `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`;

/** Fetches (or reuses) the discovery document and checks it belongs to this issuer. */
export async function discover(issuer: string, fresh = false): Promise<DiscoveryDoc> {
  const cached = discoveries.get(issuer);
  if (!fresh && cached && Date.now() - cached.at < oidcCache.discoveryTtlMs) return cached.doc;
  const { status, json } = await fetchJson(discoveryUrl(issuer), 'discovery document');
  if (status !== 200 || !json || typeof json !== 'object') {
    throw new IdentityError('discovery failed', `The discovery document could not be read (status ${status}).`);
  }
  const doc = json as DiscoveryDoc;
  // OpenID Connect Discovery 1.0, section 4.3: the issuer in the document must be exactly the one asked for.
  if (doc.issuer !== issuer) {
    throw new IdentityError('discovery issuer mismatch',
      `The discovery document names the issuer "${String(doc.issuer)}", not "${issuer}". Enter the issuer exactly as the provider states it.`);
  }
  for (const k of ['authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
    if (typeof doc[k] !== 'string' || !doc[k]) throw new IdentityError(`discovery lacks ${k}`, `The discovery document has no ${k}.`);
    assertAddress(doc[k], k.replace(/_/g, ' '));
  }
  if (Array.isArray(doc.code_challenge_methods_supported) && !doc.code_challenge_methods_supported.includes('S256')) {
    throw new IdentityError('no PKCE', 'The provider does not offer PKCE with S256, which this application requires.');
  }
  discoveries.set(issuer, { doc, at: Date.now() });
  return doc;
}

async function loadKeys(uri: string): Promise<{ keys: Jwk[]; at: number }> {
  const { status, json } = await fetchJson(uri, 'key set');
  if (status !== 200 || !json || !Array.isArray(json.keys)) {
    throw new IdentityError('key set unreadable', `The provider's key set could not be read (status ${status}).`);
  }
  const entry = { keys: (json.keys as Jwk[]).filter((k) => k && typeof k === 'object' && typeof k.kty === 'string'), at: Date.now() };
  keySets.set(uri, entry);
  return entry;
}

/** Keys that may have signed a token: from the cache, refetched when stale or when the key id is unknown. */
async function keysFor(uri: string, kid: string | undefined, alg: JwtAlg): Promise<Jwk[]> {
  let entry = keySets.get(uri);
  if (!entry || Date.now() - entry.at >= oidcCache.jwksTtlMs) entry = await loadKeys(uri);
  let found = candidateKeys(entry.keys, kid, alg);
  if (!found.length && Date.now() - entry.at >= oidcCache.jwksMinRefreshMs) {
    entry = await loadKeys(uri); // the provider may have rotated its keys
    found = candidateKeys(entry.keys, kid, alg);
  }
  return found;
}

/** Verifies an ID token's signature and claims, and returns its payload. */
export async function verifyIdToken(
  token: string, doc: DiscoveryDoc, config: Pick<OidcConfig, 'clientId' | 'algorithms'>, nonce: string,
): Promise<Record<string, any>> {
  const jwt = parseJwt(token);
  const alg = jwt.header.alg as JwtAlg;
  const allowed = (config.algorithms?.length ? config.algorithms : SUPPORTED_ALGS).filter((a) => SUPPORTED_ALGS.includes(a));
  if (!allowed.includes(alg)) throw new IdentityError(`algorithm ${String(jwt.header.alg)} not accepted`);
  if (jwt.header.crit !== undefined) throw new IdentityError('unsupported critical header');
  const kid = typeof jwt.header.kid === 'string' ? jwt.header.kid : undefined;
  const keys = await keysFor(doc.jwks_uri, kid, alg);
  if (!keys.length) throw new IdentityError('signing key not found');
  if (!keys.some((k) => verifySignature(jwt, alg, k))) throw new IdentityError('bad signature');
  checkIdTokenClaims(jwt.payload, { issuer: doc.issuer, audience: config.clientId, nonce });
  return jwt.payload;
}

function claimText(payload: Record<string, any>, claim: string): string | null {
  const v = payload[claim];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Turns verified ID token claims into the identity the rest of the application uses. */
export function identityFromClaims(payload: Record<string, any>, config: OidcConfig): ExternalIdentity {
  const emailClaim = config.emailClaim || 'email';
  const raw = claimText(payload, emailClaim);
  const email = raw && /^[^@\s]+@[^@\s]+$/.test(raw) && raw.length <= 254 ? raw.toLowerCase() : null;
  // `email_verified` describes the `email` claim only; another claim is trusted only when the administrator says so.
  const verified = emailClaim === 'email' && (payload.email_verified === true || payload.email_verified === 'true');
  const g = config.groupsClaim ? payload[config.groupsClaim] : undefined;
  const groups = (Array.isArray(g) ? g : typeof g === 'string' ? [g] : [])
    .filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 256).slice(0, 500);
  const given = [claimText(payload, 'given_name'), claimText(payload, 'family_name')].filter(Boolean).join(' ');
  const amr = (Array.isArray(payload.amr) ? payload.amr : [])
    .filter((x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 100).slice(0, 20);
  return {
    subject: payload.sub,
    email,
    emailVerified: Boolean(email) && (verified || config.trustEmail === true),
    displayName: (claimText(payload, config.nameClaim || 'name') ?? given) || null,
    groups,
    amr,
    acr: typeof payload.acr === 'string' && payload.acr.length <= 200 ? payload.acr : null,
    sid: typeof payload.sid === 'string' && payload.sid.length <= 255 ? payload.sid : null,
  };
}

/**
 * Group overage (E02-24): the token says the person has groups but names a source instead of
 * listing them (OpenID Connect "distributed claims": `_claim_names` / `_claim_sources`; some
 * directories also send `hasgroups: true`).
 */
export function groupsOverage(payload: Record<string, any>, groupsClaim: string): { endpoint: string | null; accessToken: string | null } | null {
  if (!groupsClaim || payload[groupsClaim] !== undefined) return null;
  const names = payload._claim_names;
  const source = names && typeof names === 'object' ? names[groupsClaim] : undefined;
  if (typeof source === 'string') {
    const src = payload._claim_sources?.[source];
    const endpoint = src && typeof src.endpoint === 'string' ? src.endpoint : null;
    const accessToken = src && typeof src.access_token === 'string' ? src.access_token : null;
    return { endpoint, accessToken };
  }
  if (payload.hasgroups === true || payload.hasgroups === 'true') return { endpoint: null, accessToken: null };
  return null;
}

const groupList = (g: unknown): string[] | null => {
  if (Array.isArray(g)) return g.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 256).slice(0, 500);
  if (typeof g === 'string' && g) return [g];
  return null;
};

/**
 * Groups from the userinfo endpoint, or from the distributed-claims endpoint the token names. Only a
 * JSON answer whose subject matches is used (a signed JWT answer from another party cannot be checked
 * here, so it is not used). Null when no list could be had.
 */
async function fetchGroups(
  doc: DiscoveryDoc, config: OidcConfig, subject: string, accessToken: string | null, overage: ReturnType<typeof groupsOverage>,
): Promise<string[] | null> {
  const tries: { url: string; token: string | null }[] = [];
  if (doc.userinfo_endpoint && accessToken) tries.push({ url: doc.userinfo_endpoint, token: accessToken });
  if (overage?.endpoint) tries.push({ url: overage.endpoint, token: overage.accessToken ?? accessToken });
  for (const t of tries) {
    if (!t.token || addressProblem(t.url)) continue;
    try {
      const { status, json } = await fetchJson(t.url, 'group list', { headers: { authorization: `Bearer ${t.token}` } });
      if (status !== 200 || !json || typeof json !== 'object') continue;
      if (json.sub !== undefined && json.sub !== subject) continue; // OIDC Core 5.3.2: must be the same person
      const found = groupList(json[config.groupsClaim]) ?? groupList(json.value);
      if (found) return found;
    } catch {
      // Not reachable or not usable: try the next source; the caller treats "none" as unknown.
    }
  }
  return null;
}

/** RP-initiated logout (E02-23): where to send the browser to sign out at the provider too, or null. */
export async function endSessionUrl(
  provider: ProviderRecord, opts: { idToken: string | null; postLogoutRedirectUri: string },
): Promise<string | null> {
  const config = provider.config as OidcConfig;
  if (config.endSession !== true) return null;
  let doc: DiscoveryDoc;
  try {
    doc = await discover(config.issuer);
  } catch {
    return null; // the provider cannot be reached: signing out here still works
  }
  if (typeof doc.end_session_endpoint !== 'string' || addressProblem(doc.end_session_endpoint)) return null;
  const url = new URL(doc.end_session_endpoint);
  if (opts.idToken) url.searchParams.set('id_token_hint', opts.idToken);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('post_logout_redirect_uri', opts.postLogoutRedirectUri);
  return url.toString();
}

/**
 * Checks a back-channel logout token (OpenID Connect Back-Channel Logout 1.0, section 2.6): signed
 * by the provider, for this client, recent, with the logout event, a subject or session id, and no nonce.
 */
export async function verifyLogoutToken(provider: ProviderRecord, token: string): Promise<{ sub: string | null; sid: string | null; jti: string | null }> {
  const config = provider.config as OidcConfig;
  const doc = await discover(config.issuer);
  const jwt = parseJwt(token);
  const alg = jwt.header.alg as JwtAlg;
  const allowed = (config.algorithms?.length ? config.algorithms : SUPPORTED_ALGS).filter((a) => SUPPORTED_ALGS.includes(a));
  if (!allowed.includes(alg)) throw new IdentityError(`algorithm ${String(jwt.header.alg)} not accepted`);
  if (jwt.header.crit !== undefined) throw new IdentityError('unsupported critical header');
  const keys = await keysFor(doc.jwks_uri, typeof jwt.header.kid === 'string' ? jwt.header.kid : undefined, alg);
  if (!keys.length) throw new IdentityError('signing key not found');
  if (!keys.some((k) => verifySignature(jwt, alg, k))) throw new IdentityError('bad signature');
  const p = jwt.payload;
  const now = Math.floor(Date.now() / 1000);
  if (p.iss !== doc.issuer) throw new IdentityError('wrong issuer');
  const audiences = Array.isArray(p.aud) ? p.aud : [p.aud];
  if (!audiences.includes(config.clientId)) throw new IdentityError('wrong audience');
  if (typeof p.iat !== 'number' || p.iat > now + 120 || p.iat < now - 600) throw new IdentityError('token too old or from the future');
  if (p.exp !== undefined && (typeof p.exp !== 'number' || p.exp <= now - 120)) throw new IdentityError('token expired');
  if (p.nonce !== undefined) throw new IdentityError('a logout token must not carry a nonce');
  if (!p.events || typeof p.events !== 'object' || typeof p.events[BACKCHANNEL_EVENT] !== 'object') throw new IdentityError('not a logout token');
  const sub = typeof p.sub === 'string' && p.sub && p.sub.length <= 255 ? p.sub : null;
  const sid = typeof p.sid === 'string' && p.sid && p.sid.length <= 255 ? p.sid : null;
  if (!sub && !sid) throw new IdentityError('no subject or session id');
  return { sub, sid, jti: typeof p.jti === 'string' ? p.jti.slice(0, 255) : null };
}

const ALG_SET = new Set<string>(SUPPORTED_ALGS);

export const oidcDriver: ProviderDriver = {
  type: 'oidc',
  label: 'OpenID Connect',
  style: 'redirect',

  cleanConfig(input, existing) {
    const { config: common, fields } = cleanCommonConfig(input, existing);
    const text = (k: string, fallback = '') => String(input[k] ?? existing?.[k] ?? fallback).trim();
    const issuer = text('issuer');
    if (!issuer) fields.issuer = 'Enter the issuer address the provider gives you.';
    else if (issuer.length > 500 || addressProblem(issuer)) fields.issuer = `The issuer ${addressProblem(issuer) ?? 'is too long'}.`;
    const clientId = text('clientId');
    if (!clientId || clientId.length > 255) fields.clientId = 'Enter the client ID the provider gave this application.';
    const scopes = text('scopes', 'openid email profile').split(/\s+/).filter(Boolean);
    if (!scopes.includes('openid')) scopes.unshift('openid');
    if (scopes.some((s) => !/^[\x21\x23-\x5B\x5D-\x7E]{1,100}$/.test(s)) || scopes.length > 20) fields.scopes = 'Use up to 20 scopes separated by spaces.';
    const tokenAuth = text('tokenAuth', 'client_secret_basic');
    if (!['client_secret_basic', 'client_secret_post', 'none'].includes(tokenAuth)) fields.tokenAuth = 'Choose how the application proves itself to the provider.';
    const claim = (k: string, fallback: string) => {
      const v = text(k, fallback);
      if (v && !/^[A-Za-z0-9_.:/-]{1,100}$/.test(v)) fields[k] = 'Use a claim name: letters, numbers and _ . : / - only.';
      return v;
    };
    const algorithms = Array.isArray(input.algorithms ?? existing?.algorithms)
      ? [...new Set((input.algorithms ?? existing?.algorithms) as string[])] : [...SUPPORTED_ALGS];
    if (!algorithms.length || algorithms.some((a) => !ALG_SET.has(a))) fields.algorithms = 'Choose one or more of RS256, ES256 and PS256.';
    const extraRaw = (input.extraParams ?? existing?.extraParams ?? {}) as Record<string, unknown>;
    const extraParams: Record<string, string> = {};
    if (typeof extraRaw !== 'object' || Array.isArray(extraRaw)) fields.extraParams = 'Give extra parameters as name and value pairs.';
    else {
      for (const [k, v] of Object.entries(extraRaw)) {
        if (!/^[A-Za-z0-9_.-]{1,60}$/.test(k) || RESERVED_PARAMS.has(k) || typeof v !== 'string' || v.length > 500) {
          fields.extraParams = `"${k}" cannot be used as an extra parameter.`;
          break;
        }
        extraParams[k] = v;
      }
      if (Object.keys(extraParams).length > 10) fields.extraParams = 'Use up to 10 extra parameters.';
    }
    const onOff = (k: string) => {
      const v = input[k] !== undefined ? input[k] : existing?.[k] ?? false;
      if (typeof v !== 'boolean') fields[k] = 'Choose on or off.';
      return v === true;
    };
    const config: OidcConfig = {
      ...common,
      groupsFromUserinfo: onOff('groupsFromUserinfo'),
      endSession: onOff('endSession'),
      backchannelLogout: onOff('backchannelLogout'),
      issuer, clientId, scopes: scopes.join(' '), tokenAuth: tokenAuth as OidcConfig['tokenAuth'],
      emailClaim: claim('emailClaim', 'email') || 'email',
      nameClaim: claim('nameClaim', 'name') || 'name',
      groupsClaim: claim('groupsClaim', ''),
      algorithms: algorithms as OidcConfig['algorithms'],
      extraParams,
    };
    if (common.mappingEnabled && !config.groupsClaim) fields.groupsClaim = 'Name the claim that holds groups or roles, or switch role mapping off.';
    return { config, fields };
  },

  async test(provider, secret) {
    const config = provider.config as OidcConfig;
    try {
      const doc = await discover(config.issuer, true);
      const keys = await loadKeys(doc.jwks_uri);
      const algs = doc.id_token_signing_alg_values_supported ?? [];
      const usable = (config.algorithms ?? SUPPORTED_ALGS).filter((a) => !algs.length || algs.includes(a));
      const notes: string[] = [];
      if (!usable.length) notes.push(`The provider signs ID tokens with ${algs.join(', ')}, none of which is accepted here.`);
      if (config.tokenAuth !== 'none' && !secret) notes.push('No client secret is stored yet.');
      const methods = doc.token_endpoint_auth_methods_supported;
      if (Array.isArray(methods) && !methods.includes(config.tokenAuth)) notes.push(`The provider does not list "${config.tokenAuth}" among its client authentication methods.`);
      if (config.endSession && !doc.end_session_endpoint) notes.push('Signing out at the provider is on, but the provider offers no end_session_endpoint.');
      if (config.backchannelLogout && doc.backchannel_logout_supported === false) notes.push('Back-channel sign-out is on, but the provider says it does not support it.');
      if (config.groupsFromUserinfo && !doc.userinfo_endpoint) notes.push('Groups from userinfo is on, but the provider offers no userinfo_endpoint.');
      const result: TestResult = {
        ok: notes.length === 0,
        message: notes.length
          ? `The discovery document was read, but: ${notes.join(' ')}`
          : `The discovery document and the key set were read. ${keys.keys.length} signing key(s) found.`,
        details: {
          issuer: doc.issuer, authorizationEndpoint: doc.authorization_endpoint, tokenEndpoint: doc.token_endpoint,
          jwksUri: doc.jwks_uri, signingAlgorithms: algs, keys: keys.keys.length,
          pkce: Array.isArray(doc.code_challenge_methods_supported) ? doc.code_challenge_methods_supported.includes('S256') : 'not stated',
          endSessionEndpoint: doc.end_session_endpoint ?? null,
          backchannelLogout: doc.backchannel_logout_supported ?? 'not stated',
        },
      };
      return result;
    } catch (err) {
      return { ok: false, message: err instanceof IdentityError ? err.message : 'The provider could not be reached.' };
    }
  },

  async start(provider, { redirectUri, state, reauth }) {
    const config = provider.config as OidcConfig;
    const doc = await discover(config.issuer);
    const nonce = b64url(randomBytes(24));
    const codeVerifier = b64url(randomBytes(32));
    const url = new URL(doc.authorization_endpoint);
    for (const [k, v] of Object.entries(config.extraParams ?? {})) url.searchParams.set(k, v);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', config.scopes || 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', pkceChallenge(codeVerifier));
    url.searchParams.set('code_challenge_method', 'S256');
    // E02-22: when multi-factor sign-in at the provider counts here, ask for the levels that show it.
    if (config.providerMfa && config.mfaAcr?.length) url.searchParams.set('acr_values', config.mfaAcr.join(' '));
    if (reauth) {
      // Confirming identity before a sensitive action: ask the provider to check the person again.
      url.searchParams.set('prompt', 'login');
      url.searchParams.set('max_age', '0');
    }
    return { url: url.toString(), remember: { nonce, codeVerifier } };
  },

  async complete(provider, secret, { params, redirectUri, remember }) {
    const config = provider.config as OidcConfig;
    if (params.error) throw new IdentityError(`provider refused: ${String(params.error).slice(0, 60)}`);
    const doc = await discover(config.issuer);
    // RFC 9207: when the provider names itself in the response, it must be the one we asked.
    if (params.iss !== undefined && params.iss !== doc.issuer) throw new IdentityError('wrong issuer in response');
    if (!params.code || params.code.length > 4096) throw new IdentityError('no authorization code');
    const form: Record<string, string> = {
      grant_type: 'authorization_code', code: params.code, redirect_uri: redirectUri, code_verifier: remember.codeVerifier,
    };
    const headers: Record<string, string> = {};
    if (config.tokenAuth === 'client_secret_basic') {
      if (!secret) throw new IdentityError('no client secret stored');
      headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(secret)}`).toString('base64')}`;
    } else {
      form.client_id = config.clientId;
      if (config.tokenAuth === 'client_secret_post') {
        if (!secret) throw new IdentityError('no client secret stored');
        form.client_secret = secret;
      }
    }
    const { status, json } = await fetchJson(doc.token_endpoint, 'token endpoint', { method: 'POST', form, headers });
    if (status !== 200 || !json || typeof json.id_token !== 'string') {
      const code = json && typeof json.error === 'string' ? json.error.slice(0, 60) : `status ${status}`;
      throw new IdentityError(`token request refused (${code})`);
    }
    const payload = await verifyIdToken(json.id_token, doc, config, remember.nonce);
    const identity = identityFromClaims(payload, config);
    identity.idToken = json.id_token;
    // E02-24: groups the token does not list (too many), or that the administrator asked to read from userinfo.
    const overage = config.groupsClaim ? groupsOverage(payload, config.groupsClaim) : null;
    if (config.groupsClaim && (overage || config.groupsFromUserinfo)) {
      const accessToken = typeof json.access_token === 'string' && json.access_token.length <= 8192 ? json.access_token : null;
      const fetched = await fetchGroups(doc, config, identity.subject, accessToken, overage);
      if (fetched) identity.groups = fetched;
      else if (overage) identity.groupsUnknown = true;
    }
    return identity;
  },

  forget(provider) {
    const issuer = (provider.config as OidcConfig).issuer;
    const doc = discoveries.get(issuer)?.doc;
    if (doc) keySets.delete(doc.jwks_uri);
    discoveries.delete(issuer);
  },
};
