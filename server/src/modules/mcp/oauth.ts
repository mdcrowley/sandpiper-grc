// OAuth 2.1 for remote MCP connectors (E21-16), following the MCP authorization specification:
//
// - Protected resource metadata (RFC 9728) at /.well-known/oauth-protected-resource[/mcp], and a
//   401 from /mcp that points to it (WWW-Authenticate: Bearer resource_metadata="...").
// - Authorization server metadata (RFC 8414) at /.well-known/oauth-authorization-server.
// - Authorization code with PKCE (S256 only); the consent screen is the web page /oauth/authorize,
//   which asks this module (POST /api/mcp/oauth/authorize, .../decision) as the signed-in person.
// - Token endpoint /oauth/token: authorization_code and refresh_token. Access tokens last an hour;
//   refresh tokens rotate on every use, and a refresh token or code used twice revokes the grant.
// - Dynamic client registration (RFC 7591) at /oauth/register, only when an administrator allows
//   it; administrators can also register connectors by hand.
// - Revocation (RFC 7009) at /oauth/revoke.
// - Client ID metadata documents (E21-21): a client_id that is an https address is fetched (fenced as
//   in client-metadata.ts) when someone signed in opens the consent screen, only while an
//   administrator allows it and outbound connections are on. The last valid document is kept in
//   mcp_oauth_clients (registered_by = 'metadata') until it expires. The token endpoint never fetches.
// - The resource indicator (RFC 8707), when sent, must name this server's /mcp.
//
// Everything is off until an administrator switches it on (mcp.oauth_enabled). Access tokens are
// accepted only at /mcp: the core resolves them only for requests this module makes in-process,
// which carry a per-process secret header (INTERNAL_HEADER). Secrets are stored as SHA-256 only and
// never written to logs.
//
// Client kinds (wave 13, E38-02): everything above is the `assistant` kind. The `mobile` kind (the
// application's own app, client_id com.sandpipergrc) is defined by modules/mobile through
// defineOAuthClientKind; /oauth/token and /oauth/revoke hand its requests over before any assistant
// rule (including mcp.oauth_enabled) applies. Its sign-in screen is served by that module.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireRecentAuth } from '../../core/auth.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { makeDbLimiter } from '../../core/ratelimit.ts';
import { clientIp, isHttps } from '../../core/request.ts';
import { tokenHash } from '../../core/tokens.ts';
import {
  cacheSeconds, clientHostAllowed, clientIdUrlProblem, fetchClientMetadata, isUrlClientId, MAX_CLIENT_ID_LENGTH, MetadataError, validateClientMetadata as checkMetadataDocument,
} from './client-metadata.ts';
import { readSettings, mayConnect, type McpSettings } from './settings.ts';

export const ACCESS_PREFIX = 'grc_oat_';
export const REFRESH_PREFIX = 'grc_ort_';
const CLIENT_PREFIX = 'grc_cli_';
const SECRET_PREFIX = 'grc_cls_';
export const INTERNAL_HEADER = 'x-grc-mcp-internal';

export const SCOPES = { read: 'mcp:read', write: 'mcp:write' } as const;
const SUPPORTED_SCOPES = [SCOPES.read, SCOPES.write];
export const ACCESS_SECONDS = 3600;
export const REFRESH_DAYS = 30;
export const CODE_SECONDS = 300;
const MAX_DYNAMIC_CLIENTS = 1000;
const AUTH_METHODS = ['none', 'client_secret_basic', 'client_secret_post'];
/** Schemes never accepted as a redirect address (they would run code or read files in the browser). */
const BAD_SCHEMES = ['javascript', 'data', 'vbscript', 'file', 'about', 'blob', 'ws', 'wss', 'ftp', 'filesystem', 'view-source', 'chrome', 'intent'];

const sha = (s: string) => tokenHash(s);
const random = (prefix: string) => prefix + randomBytes(32).toString('base64url');
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Equal strings, compared in constant time. */
export function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(sha(a));
  const y = Buffer.from(sha(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The base address used as issuer and resource: `auth.public_url`, or as the request reached us. */
export async function oauthBase(ctx: ModuleContext, req: FastifyRequest): Promise<string> {
  const configured = String(await ctx.settings.get<unknown>('auth.public_url', '') ?? '').replace(/\/+$/, '');
  if (configured) return configured;
  return `${isHttps(req) ? 'https' : 'http'}://${req.headers.host ?? '127.0.0.1'}`;
}

/** OAuth needs HTTPS, except on this computer (loopback), as the specification requires. */
export function secureBase(base: string): boolean {
  try {
    const u = new URL(base);
    return u.protocol === 'https:' || (u.protocol === 'http:' && LOOPBACK.has(u.hostname));
  } catch {
    return false;
  }
}

/** Whether a redirect address may be registered: https, http on loopback, or an app's own scheme. */
export function redirectProblem(uri: unknown): string | null {
  if (typeof uri !== 'string' || !uri || uri.length > 500) return 'A redirect address must be a URL of up to 500 characters.';
  let u: URL;
  try { u = new URL(uri); } catch { return `"${uri.slice(0, 80)}" is not a URL.`; }
  if (u.hash || uri.includes('#')) return 'A redirect address may not contain a fragment (#).';
  if (u.username || u.password) return 'A redirect address may not contain a user name or password.';
  const scheme = u.protocol.slice(0, -1).toLowerCase();
  if (scheme === 'https') return null;
  if (scheme === 'http') return LOOPBACK.has(u.hostname) ? null : 'Use https, or http only on this computer (localhost or 127.0.0.1).';
  if (BAD_SCHEMES.includes(scheme) || !/^[a-z][a-z0-9+.-]*$/.test(scheme)) return `The "${scheme}:" scheme is not allowed for a redirect address.`;
  return null; // a private-use scheme of a desktop or mobile app
}

/** The registered address a request's redirect_uri matches (loopback addresses may use any port). */
export function matchRedirect(registered: string[], given: string): string | null {
  if (registered.includes(given)) return given;
  let g: URL;
  try { g = new URL(given); } catch { return null; }
  if (g.protocol !== 'http:' || !LOOPBACK.has(g.hostname)) return null;
  for (const r of registered) {
    try {
      const u = new URL(r);
      if (u.protocol === 'http:' && u.hostname === g.hostname && u.pathname === g.pathname && u.search === g.search) return given;
    } catch { /* skip */ }
  }
  return null;
}

/** base64url(SHA-256(verifier)) === challenge (RFC 7636, S256). */
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  const computed = createHash('sha256').update(verifier).digest('base64url');
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

const resourceOk = (resource: unknown, base: string) =>
  resource === undefined || resource === null || resource === '' || [`${base}/mcp`, `${base}/mcp/`].includes(String(resource));

/** A requested scope string as our scopes, or null when it names one we do not know. Empty = read. */
export function parseScope(scope: unknown): string[] | null {
  const parts = [...new Set(String(scope ?? '').split(' ').map((s) => s.trim()).filter(Boolean))];
  if (!parts.length) return [SCOPES.read];
  if (parts.some((p) => !SUPPORTED_SCOPES.includes(p as typeof SCOPES.read))) return null;
  return parts;
}

/** A redirect address on this computer (http://localhost, 127.0.0.1 or [::1]). */
export function isLoopbackRedirect(uri: string): boolean {
  try { return LOOPBACK.has(new URL(uri).hostname); } catch { return false; }
}

/** Up to 100 printable characters, for names given by connectors. */
const cleanName = (s: unknown) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 100);

export interface AuthorizeParams {
  response_type?: string; client_id?: string; redirect_uri?: string; code_challenge?: string; code_challenge_method?: string;
  scope?: string; state?: string; resource?: string;
}

type Checked =
  | { kind: 'stop'; status: number; code: string; message: string }
  | { kind: 'redirect'; url: string }
  | { kind: 'ok'; client: Row; redirectUri: string; scopes: string[]; challenge: string; resource: string | null; state: string | undefined; issuer: string };

/**
 * Callbacks the module gives: the scopes a person's assistant token would carry, and the core's
 * per-process marker that admits OAuth access tokens on in-process calls.
 */
export interface OAuthDeps {
  scopesFor(perms: string[], access: 'read' | 'write'): string[];
}

// ---------- client kinds (wave 13, E38-02) ----------
//
// The authorization server serves two kinds of client: `assistant` (the AI-assistant connectors
// above: registered, approved and governed by mcp.oauth_enabled) and `mobile` (the application's own
// app, built in, governed by the Mobile app area). A kind other than `assistant` is defined by its
// module (modules/mobile) with `defineOAuthClientKind`; the token and revocation endpoints hand a
// request whose client_id that kind owns to it, before any assistant rule applies, so the assistant
// switches never govern it and an assistant client can never reach it. Requests for any other
// client_id behave exactly as before.

export type OAuthClientKindKey = 'assistant' | 'mobile';

/** What the endpoints lend a client kind: the shared failure limiter and the OAuth answer formats. */
export interface OAuthKindHelpers {
  /** Failed token and revocation requests by source address (30 in 5 minutes, shared with connectors). */
  failures: ReturnType<typeof makeDbLimiter>;
  /** `{ error, error_description }` with `cache-control: no-store`. */
  error(reply: FastifyReply, status: number, error: string, description: string, headers?: Record<string, string>): FastifyReply;
  /** The issuer address (auth.public_url or as requested). */
  base(req: FastifyRequest): Promise<string>;
}

export interface OAuthClientKind {
  key: Exclude<OAuthClientKindKey, 'assistant'>;
  /** Whether this kind owns a client_id (compared exactly). */
  owns(clientId: string): boolean;
  /** The token endpoint for this kind (form body already parsed to strings). */
  token(req: FastifyRequest, reply: FastifyReply, body: Record<string, string>, h: OAuthKindHelpers): Promise<unknown>;
  /** The revocation endpoint for this kind (RFC 7009: answers 200 for unknown tokens). */
  revoke(req: FastifyRequest, reply: FastifyReply, body: Record<string, string>, h: OAuthKindHelpers): Promise<unknown>;
}

const clientKinds = new WeakMap<FastifyInstance, OAuthClientKind[]>();

/** Adds a client kind (in a module's register()). Throws on a second definition of the same key. */
export function defineOAuthClientKind(app: FastifyInstance, kind: OAuthClientKind): void {
  const list = clientKinds.get(app) ?? [];
  if (list.some((k) => k.key === kind.key)) throw new Error(`OAuth client kind "${kind.key}" is defined twice`);
  clientKinds.set(app, [...list, kind]);
}

/** The kind of client a client_id belongs to: a defined kind that owns it, otherwise `assistant`. */
export function clientKindOf(app: FastifyInstance, clientId: unknown): OAuthClientKindKey {
  return kindFor(app, clientId)?.key ?? 'assistant';
}

function kindFor(app: FastifyInstance, clientId: unknown): OAuthClientKind | undefined {
  if (typeof clientId !== 'string' || !clientId) return undefined;
  return (clientKinds.get(app) ?? []).find((k) => k.owns(clientId));
}

export function registerOAuth(ctx: ModuleContext, deps: OAuthDeps) {
  const { app, db } = ctx;
  const internalSecret = randomBytes(32).toString('base64url');
  const failures = makeDbLimiter(db, 'mcp_oauth', 30, 5 * 60_000);
  const registrations = makeDbLimiter(db, 'mcp_oauth_register', 10, 60 * 60_000);
  const metadataFetches = makeDbLimiter(db, 'mcp_oauth_metadata', 20, 10 * 60_000);
  let sweeps = 0;

  /** Client ID metadata documents are usable: allowed by an administrator and outbound connections on. */
  const metadataOn = async (settings: McpSettings) =>
    settings.clientMetadata && (await ctx.settings.get<unknown>('integrations.outbound_enabled', false)) === true;

  const sessionOnly = (req: FastifyRequest) => {
    if (req.apiToken) ctx.fail(403, 'token_not_allowed', 'This cannot be done with an API token. Sign in to do it.');
  };
  const recentAuth = (req: FastifyRequest, what: string) => requireRecentAuth({ db, audit: ctx.audit, settings: ctx.settings }, req, what);

  async function sweep() {
    if (++sweeps % 50 !== 1) return;
    await db.query(`delete from mcp_oauth_codes where expires_at < now() - interval '1 day'`).catch(() => undefined);
    await db.query(`delete from mcp_oauth_tokens where expires_at < now() - interval '1 day'`).catch(() => undefined);
  }

  // ---------- access tokens, resolved by the core for in-process calls only ----------

  app.registerBearerResolver(ACCESS_PREFIX, async (token, req) => {
    const marker = req.headers[INTERNAL_HEADER];
    if (typeof marker !== 'string' || !sameSecret(marker, internalSecret)) {
      ctx.fail(401, 'invalid_token', 'This access token works only at the MCP endpoint (/mcp).');
    }
    const settings = await readSettings(ctx);
    if (!settings.oauthEnabled) return null;
    // Connectors known by a metadata document stop working at once when that is switched off.
    const row = await db.one<Row>(
      `select g.id, g.name, g.user_id, g.permissions, (g.last_used_at is null or g.last_used_at < now() - interval '1 minute') as stale
       from mcp_oauth_tokens t join mcp_oauth_grants g on g.id = t.grant_id
       join mcp_oauth_clients c on c.client_id = g.client_id
       where t.token_hash = $1 and t.kind = 'access' and t.expires_at > now()
         and g.revoked_at is null and g.expires_at > now() and c.revoked_at is null and not c.pending
         and (c.registered_by <> 'metadata' or $2::boolean)`, [sha(token), await metadataOn(settings)]);
    if (!row) return null;
    if (row.stale) await db.query('update mcp_oauth_grants set last_used_at = now(), last_used_ip = $2 where id = $1', [row.id, clientIp(req)]);
    return { id: row.id, name: row.name, userId: row.user_id, scopes: [...(row.permissions as string[]), 'mcp.use'] };
  });

  /** Headers that let an OAuth access token through on in-process calls (see the resolver above). */
  const internalHeaders = (authorization: string): Record<string, string> =>
    (/^Bearer\s+grc_oat_/i.test(authorization) ? { [INTERNAL_HEADER]: internalSecret } : {});

  // ---------- metadata ----------

  /** Answers 404 (as if nothing were here) unless OAuth is on and the address is secure. */
  async function available(req: FastifyRequest): Promise<{ settings: McpSettings; base: string } | null> {
    const settings = await readSettings(ctx);
    const base = await oauthBase(ctx, req);
    if (!settings.enabled || !settings.oauthEnabled || !secureBase(base)) return null;
    return { settings, base };
  }

  const cors = (reply: FastifyReply) => {
    // Public clients (for example a browser-based MCP client) may call these from any origin; no
    // cookies are read here, so this exposes nothing.
    reply.header('access-control-allow-origin', '*');
    reply.header('access-control-allow-headers', 'authorization, content-type, mcp-protocol-version');
    reply.header('access-control-allow-methods', 'GET, POST, OPTIONS');
  };
  const notHere = (reply: FastifyReply) => reply.code(404).send({ error: 'not_found', error_description: 'OAuth sign-in for remote connectors is not switched on here.' });

  const resourceMetadata = async (req: FastifyRequest, reply: FastifyReply) => {
    cors(reply);
    const on = await available(req);
    if (!on) return notHere(reply);
    return {
      resource: `${on.base}/mcp`,
      authorization_servers: [on.base],
      scopes_supported: SUPPORTED_SCOPES,
      bearer_methods_supported: ['header'],
      resource_name: String(await ctx.settings.get('app.name', 'Sandpiper GRC')),
      resource_documentation: `${on.base}/help/ai-assistants-and-mcp`,
    };
  };
  app.get('/.well-known/oauth-protected-resource', resourceMetadata);
  app.get('/.well-known/oauth-protected-resource/mcp', resourceMetadata);

  app.get('/.well-known/oauth-authorization-server', async (req, reply) => {
    cors(reply);
    const on = await available(req);
    if (!on) return notHere(reply);
    const b = on.base;
    return {
      issuer: b,
      authorization_endpoint: `${b}/oauth/authorize`,
      token_endpoint: `${b}/oauth/token`,
      revocation_endpoint: `${b}/oauth/revoke`,
      ...(on.settings.oauthRegistration ? { registration_endpoint: `${b}/oauth/register` } : {}),
      scopes_supported: SUPPORTED_SCOPES,
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: AUTH_METHODS,
      revocation_endpoint_auth_methods_supported: AUTH_METHODS,
      authorization_response_iss_parameter_supported: true,
      client_id_metadata_document_supported: await metadataOn(on.settings),
      service_documentation: `${b}/help/ai-assistants-and-mcp`,
    };
  });

  /** For /mcp: the WWW-Authenticate value pointing a client at the metadata, when OAuth is on. */
  async function challenge(req: FastifyRequest, error?: string): Promise<string> {
    const on = await available(req);
    const parts = ['Bearer realm="sandpiper-grc"'];
    if (error) parts.push(`error="${error}"`);
    // No scope here: a client then asks for the scopes in the metadata, and the person chooses on the consent screen.
    if (on) parts.push(`resource_metadata="${on.base}/.well-known/oauth-protected-resource/mcp"`);
    return parts.join(', ');
  }

  // ---------- the token, registration and revocation endpoints (form or JSON bodies) ----------

  const oauthError = (reply: FastifyReply, status: number, error: string, description: string, headers: Record<string, string> = {}) => {
    for (const [k, v] of Object.entries(headers)) reply.header(k, v);
    reply.header('cache-control', 'no-store');
    return reply.code(status).send({ error, error_description: description });
  };

  /** The client a request authenticates as (RFC 6749 2.3), or an error to send. */
  async function authenticateClient(req: FastifyRequest, body: Record<string, string>): Promise<{ client: Row } | { status: number; error: string; description: string; basic: boolean }> {
    let id = body.client_id;
    let secret = body.client_secret;
    let method = secret !== undefined ? 'client_secret_post' : 'none';
    const basic = /^Basic\s+(\S+)$/i.exec(String(req.headers.authorization ?? ''));
    if (basic) {
      const decoded = Buffer.from(basic[1], 'base64').toString('utf8');
      const at = decoded.indexOf(':');
      if (at < 0) return { status: 401, error: 'invalid_client', description: 'The client credentials are malformed.', basic: true };
      try {
        id = decodeURIComponent(decoded.slice(0, at).replace(/\+/g, ' '));
        secret = decodeURIComponent(decoded.slice(at + 1).replace(/\+/g, ' '));
      } catch {
        return { status: 401, error: 'invalid_client', description: 'The client credentials are malformed.', basic: true };
      }
      if (body.client_id !== undefined && body.client_id !== id) return { status: 400, error: 'invalid_request', description: 'Two different client ids were sent.', basic: true };
      method = 'client_secret_basic';
    }
    if (!id) return { status: 401, error: 'invalid_client', description: 'Send the client_id.', basic: !!basic };
    const client = await db.one<Row>('select * from mcp_oauth_clients where client_id = $1 and revoked_at is null and not pending', [String(id).slice(0, MAX_CLIENT_ID_LENGTH)]);
    if (!client) return { status: 401, error: 'invalid_client', description: 'Unknown client.', basic: !!basic };
    if (client.registered_by === 'metadata' && !(await metadataOn(await readSettings(ctx)))) {
      return { status: 401, error: 'invalid_client', description: 'Connectors known by a metadata document are switched off here.', basic: !!basic };
    }
    if (client.auth_method === 'none') {
      if (method !== 'none') return { status: 401, error: 'invalid_client', description: 'This client was registered without a secret; send only its client_id.', basic: !!basic };
    } else {
      // A confidential client may use either secret method; the secret must match.
      if (method === 'none' || !secret || !client.secret_hash || !sameSecretHash(secret, client.secret_hash)) {
        return { status: 401, error: 'invalid_client', description: 'Client authentication failed.', basic: !!basic };
      }
    }
    return { client };
  }

  const sameSecretHash = (secret: string, hash: string) => {
    const a = Buffer.from(sha(secret));
    const b = Buffer.from(hash);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  async function revokeGrant(grantId: string, reason: string, by: string | null = null) {
    await db.query(`update mcp_oauth_grants set revoked_at = now(), revoked_by = $2, revoked_reason = $3 where id = $1 and revoked_at is null`, [grantId, by, reason]);
    await db.query(`update mcp_oauth_tokens set expires_at = least(expires_at, now()) where grant_id = $1`, [grantId]);
  }

  async function issueTokens(grant: Row): Promise<Record<string, unknown>> {
    const access = random(ACCESS_PREFIX);
    const refresh = random(REFRESH_PREFIX);
    await db.query(
      `insert into mcp_oauth_tokens (token_hash, grant_id, kind, expires_at) values
         ($1, $3, 'access', least(now() + make_interval(secs => $4::int), $5::timestamptz)),
         ($2, $3, 'refresh', least(now() + make_interval(days => $6::int), $5::timestamptz))`,
      [sha(access), sha(refresh), grant.id, ACCESS_SECONDS, new Date(grant.expires_at).toISOString(), REFRESH_DAYS]);
    const left = Math.floor((new Date(grant.expires_at).getTime() - Date.now()) / 1000);
    return { access_token: access, token_type: 'Bearer', expires_in: Math.max(1, Math.min(ACCESS_SECONDS, left)), refresh_token: refresh, scope: grant.scope };
  }

  app.register(async (scope: FastifyInstance) => {
    // Only inside this plugin: OAuth requests are form-encoded (RFC 6749).
    scope.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
      try {
        done(null, Object.fromEntries(new URLSearchParams(String(body ?? ''))));
      } catch (err) {
        done(err as Error, undefined);
      }
    });
    const bodyOf = (req: FastifyRequest): Record<string, string> => {
      const b = req.body;
      if (!b || typeof b !== 'object' || Array.isArray(b)) return {};
      return Object.fromEntries(Object.entries(b as Record<string, unknown>).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, String(v)]));
    };
    for (const url of ['/oauth/token', '/oauth/register', '/oauth/revoke']) {
      scope.options(url, async (_req, reply) => { cors(reply); return reply.code(204).send(); });
    }

    const helpers: OAuthKindHelpers = { failures, error: oauthError, base: (req) => oauthBase(ctx, req) };
    /** Another kind of client (a public client: its id is in the body, never in a Basic header). */
    const otherKind = (req: FastifyRequest) =>
      (/^Basic\s/i.test(String(req.headers.authorization ?? '')) ? undefined : kindFor(app, bodyOf(req).client_id));

    scope.post('/oauth/token', async (req, reply) => {
      cors(reply);
      const kind = otherKind(req);
      if (kind) return kind.token(req, reply, bodyOf(req), helpers);
      const on = await available(req);
      if (!on) return notHere(reply);
      void sweep();
      const ip = clientIp(req);
      if (await failures.blocked(ip)) return oauthError(reply, 429, 'temporarily_unavailable', 'Too many failed requests. Wait a few minutes and try again.', { 'retry-after': '300' });
      const body = bodyOf(req);
      const failed = async (status: number, error: string, description: string, headers: Record<string, string> = {}) => {
        await failures.hit(ip);
        return oauthError(reply, status, error, description, headers);
      };
      const who = await authenticateClient(req, body);
      if (!('client' in who)) return failed(who.status, who.error, who.description, who.basic ? { 'www-authenticate': 'Basic realm="sandpiper-grc"' } : {});
      const client = who.client;
      if (!resourceOk(body.resource, on.base)) return failed(400, 'invalid_target', 'This server is the resource at /mcp; ask for that.');

      if (body.grant_type === 'authorization_code') {
        if (!body.code || !body.code_verifier || !body.redirect_uri) return failed(400, 'invalid_request', 'Send code, code_verifier and redirect_uri.');
        // Single use, atomically: a second attempt finds used_at already set.
        const code = await db.one<Row>(
          `update mcp_oauth_codes set used_at = now() where code_hash = $1 and used_at is null returning *`, [sha(body.code)]);
        if (!code) {
          const replay = await db.one<Row>('select grant_id, client_id from mcp_oauth_codes where code_hash = $1', [sha(body.code)]);
          if (replay?.grant_id) {
            await revokeGrant(replay.grant_id, 'authorization code used twice');
            await ctx.audit(req, { action: 'mcp.oauth.code_reuse', recordType: 'mcp_oauth_grant', recordId: replay.grant_id, summary: 'An authorization code was used twice; the connection it made was revoked' });
          }
          return failed(400, 'invalid_grant', 'The authorization code is not valid (unknown, used or expired).');
        }
        if (code.client_id !== client.client_id) return failed(400, 'invalid_grant', 'The authorization code was issued to another client.');
        if (new Date(code.expires_at).getTime() <= Date.now()) return failed(400, 'invalid_grant', 'The authorization code has expired.');
        if (code.redirect_uri !== body.redirect_uri) return failed(400, 'invalid_grant', 'redirect_uri does not match the authorization request.');
        if (!pkceMatches(body.code_verifier, code.code_challenge)) return failed(400, 'invalid_grant', 'The code_verifier does not match the code_challenge.');
        if (body.resource && code.resource && !resourceOk(body.resource, code.resource.replace(/\/mcp\/?$/, ''))) return failed(400, 'invalid_target', 'The resource differs from the authorization request.');
        const owner = await db.one<Row>(`select id from users where id = $1 and status = 'active' and deleted_at is null`, [code.user_id]);
        if (!owner) return failed(400, 'invalid_grant', 'The person who approved this connection can no longer sign in.');
        const grant = await db.one<Row>(
          `insert into mcp_oauth_grants (client_id, user_id, name, scope, permissions, resource, expires_at)
           values ($1, $2, $3, $4, $5::jsonb, $6, now() + make_interval(days => $7::int)) returning *`,
          [client.client_id, code.user_id, `${client.name} (connector)`.slice(0, 120), code.scope, JSON.stringify(code.permissions), code.resource ?? `${on.base}/mcp`, code.grant_days]);
        await db.query('update mcp_oauth_codes set grant_id = $2 where code_hash = $1', [code.code_hash, grant!.id]);
        await db.query('update mcp_oauth_clients set last_used_at = now() where id = $1', [client.id]);
        reply.header('cache-control', 'no-store').header('pragma', 'no-cache');
        return issueTokens(grant!);
      }

      if (body.grant_type === 'refresh_token') {
        if (!body.refresh_token) return failed(400, 'invalid_request', 'Send refresh_token.');
        const hash = sha(body.refresh_token);
        const used = await db.one<Row>(
          `update mcp_oauth_tokens set used_at = now() where token_hash = $1 and kind = 'refresh' and used_at is null returning grant_id, expires_at`, [hash]);
        if (!used) {
          // A refresh token presented again after it was rotated: someone else may hold it. Revoke the whole grant.
          const again = await db.one<Row>(`select grant_id from mcp_oauth_tokens where token_hash = $1 and kind = 'refresh'`, [hash]);
          if (again) {
            await revokeGrant(again.grant_id, 'refresh token used twice');
            await ctx.audit(req, { action: 'mcp.oauth.refresh_reuse', recordType: 'mcp_oauth_grant', recordId: again.grant_id, summary: 'A refresh token was used twice; the connection was revoked' });
          }
          return failed(400, 'invalid_grant', 'The refresh token is not valid (unknown, used or revoked).');
        }
        const grant = await db.one<Row>(
          `select * from mcp_oauth_grants where id = $1 and revoked_at is null and expires_at > now()`, [used.grant_id]);
        if (!grant || new Date(used.expires_at).getTime() <= Date.now()) return failed(400, 'invalid_grant', 'The connection has expired or was revoked. Connect again.');
        if (grant.client_id !== client.client_id) return failed(400, 'invalid_grant', 'The refresh token was issued to another client.');
        if (body.scope) {
          const asked = parseScope(body.scope);
          const has = String(grant.scope).split(' ');
          if (!asked || asked.some((s) => !has.includes(s))) return failed(400, 'invalid_scope', 'A refresh cannot add scopes.');
        }
        const owner = await db.one<Row>(`select id from users where id = $1 and status = 'active' and deleted_at is null`, [grant.user_id]);
        if (!owner) return failed(400, 'invalid_grant', 'The person who approved this connection can no longer sign in.');
        reply.header('cache-control', 'no-store').header('pragma', 'no-cache');
        return issueTokens(grant);
      }

      return failed(400, 'unsupported_grant_type', 'Use authorization_code or refresh_token.');
    });

    scope.post('/oauth/register', async (req, reply) => {
      cors(reply);
      const on = await available(req);
      if (!on) return notHere(reply);
      if (!on.settings.oauthRegistration) {
        return oauthError(reply, 403, 'access_denied', 'Connectors cannot register themselves here. Ask an administrator to add this connector under Administration > AI assistant access.');
      }
      const ip = clientIp(req);
      if (await registrations.blocked(ip)) return oauthError(reply, 429, 'temporarily_unavailable', 'Too many registrations from this address. Try again later.', { 'retry-after': '3600' });
      await registrations.hit(ip);
      const b = (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}) as Row;
      const result = await validateClientMetadata(b);
      if ('error' in result) return oauthError(reply, 400, result.error, result.description);
      const count = (await db.one<{ n: number }>(`select count(*)::int as n from mcp_oauth_clients where registered_by = 'dynamic' and revoked_at is null`))!.n;
      if (count >= MAX_DYNAMIC_CLIENTS) return oauthError(reply, 400, 'invalid_client_metadata', 'This installation has too many registered connectors. Ask an administrator to remove unused ones.');
      const made = await createClient(result, 'dynamic', null, ip);
      await ctx.audit(req, { action: 'mcp.oauth.client_register', recordType: 'mcp_oauth_client', recordId: made.row.id, summary: `Connector "${result.name}" registered itself (redirects to ${result.redirectUris.map((u) => hostOf(u)).join(', ')})` });
      reply.code(201).header('cache-control', 'no-store');
      return clientAnswer(made.row, made.secret, result);
    });

    scope.post('/oauth/revoke', async (req, reply) => {
      cors(reply);
      const kind = otherKind(req);
      if (kind) return kind.revoke(req, reply, bodyOf(req), helpers);
      const on = await available(req);
      if (!on) return notHere(reply);
      const body = bodyOf(req);
      const ip = clientIp(req);
      if (await failures.blocked(ip)) return oauthError(reply, 429, 'temporarily_unavailable', 'Too many failed requests. Wait a few minutes and try again.');
      const who = await authenticateClient(req, body);
      if (!('client' in who)) {
        await failures.hit(ip);
        return oauthError(reply, who.status, who.error, who.description, who.basic ? { 'www-authenticate': 'Basic realm="sandpiper-grc"' } : {});
      }
      if (!body.token) return oauthError(reply, 400, 'invalid_request', 'Send the token to revoke.');
      const row = await db.one<Row>(
        `select t.kind, t.grant_id, g.client_id from mcp_oauth_tokens t join mcp_oauth_grants g on g.id = t.grant_id where t.token_hash = $1`, [sha(body.token)]);
      // Unknown tokens and other clients' tokens are answered the same way (RFC 7009).
      if (row && row.client_id === who.client.client_id) {
        if (row.kind === 'refresh') {
          await revokeGrant(row.grant_id, 'revoked by the connector');
          await ctx.audit(req, { action: 'mcp.oauth.revoke', recordType: 'mcp_oauth_grant', recordId: row.grant_id, summary: `Connector "${who.client.name}" ended its connection` });
        } else {
          await db.query('update mcp_oauth_tokens set expires_at = least(expires_at, now()) where token_hash = $1', [sha(body.token)]);
        }
      }
      reply.header('cache-control', 'no-store');
      return {};
    });
  });

  // ---------- clients ----------

  interface ClientInput { name: string; redirectUris: string[]; authMethod: string; clientUri: string | null; grantTypes: string[]; scope: string | null }

  const hostOf = (u: string) => { try { const x = new URL(u); return x.host || `${x.protocol}`; } catch { return u.slice(0, 40); } };

  async function validateClientMetadata(b: Row): Promise<ClientInput | { error: string; description: string }> {
    const uris = b.redirect_uris;
    if (!Array.isArray(uris) || !uris.length || uris.length > 10) return { error: 'invalid_redirect_uri', description: 'Give one to ten redirect_uris.' };
    for (const u of uris) {
      const p = redirectProblem(u);
      if (p) return { error: 'invalid_redirect_uri', description: p };
    }
    const authMethod = b.token_endpoint_auth_method === undefined ? 'client_secret_basic' : String(b.token_endpoint_auth_method);
    if (!AUTH_METHODS.includes(authMethod)) return { error: 'invalid_client_metadata', description: `token_endpoint_auth_method must be one of ${AUTH_METHODS.join(', ')}.` };
    const grantTypes = b.grant_types === undefined ? ['authorization_code'] : b.grant_types;
    if (!Array.isArray(grantTypes) || !grantTypes.length || grantTypes.some((g: unknown) => !['authorization_code', 'refresh_token'].includes(String(g)))) {
      return { error: 'invalid_client_metadata', description: 'grant_types may contain only authorization_code and refresh_token.' };
    }
    if (b.response_types !== undefined && (!Array.isArray(b.response_types) || b.response_types.some((r: unknown) => r !== 'code'))) {
      return { error: 'invalid_client_metadata', description: 'response_types may contain only code.' };
    }
    if (b.scope !== undefined && b.scope !== null && !parseScope(b.scope)) return { error: 'invalid_client_metadata', description: `scope may contain only ${SUPPORTED_SCOPES.join(' and ')}.` };
    let clientUri: string | null = null;
    if (b.client_uri !== undefined && b.client_uri !== null && b.client_uri !== '') {
      try {
        const u = new URL(String(b.client_uri));
        if (u.protocol !== 'https:') throw new Error('scheme');
        clientUri = u.href.slice(0, 300);
      } catch {
        return { error: 'invalid_client_metadata', description: 'client_uri must be an https address.' };
      }
    }
    return {
      name: cleanName(b.client_name) || 'Unnamed connector',
      redirectUris: [...new Set(uris.map(String))], authMethod, clientUri,
      grantTypes: [...new Set(grantTypes.map(String))] as string[], scope: b.scope ? String(b.scope) : null,
    };
  }

  async function createClient(c: ClientInput, by: 'dynamic' | 'administrator', userId: string | null, ip: string) {
    const clientId = random(CLIENT_PREFIX);
    const secret = c.authMethod === 'none' ? null : random(SECRET_PREFIX);
    const row = await db.one<Row>(
      `insert into mcp_oauth_clients (client_id, secret_hash, name, redirect_uris, auth_method, client_uri, registered_by, created_by, created_ip)
       values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9) returning *`,
      [clientId, secret ? sha(secret) : null, c.name, JSON.stringify(c.redirectUris), c.authMethod, c.clientUri, by, userId, ip]);
    return { row: row!, secret };
  }

  const clientAnswer = (row: Row, secret: string | null, c: ClientInput) => ({
    client_id: row.client_id,
    client_id_issued_at: Math.floor(new Date(row.created_at).getTime() / 1000),
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    client_name: c.name,
    redirect_uris: c.redirectUris,
    grant_types: c.grantTypes,
    response_types: ['code'],
    token_endpoint_auth_method: c.authMethod,
    ...(c.clientUri ? { client_uri: c.clientUri } : {}),
    ...(c.scope ? { scope: c.scope } : {}),
  });

  // ---------- the consent screen's API (signed-in person, never a token) ----------

  // ---------- connectors known by a client ID metadata document (E21-21) ----------

  type Stop = { stop: { status: number; code: string; message: string } };
  const stop = (status: number, code: string, message: string): Stop => ({ stop: { status, code, message } });

  /**
   * The connector a URL client_id names: from the cache while its document is fresh, otherwise
   * fetched and checked now. Only reached from the consent screen's API, by someone signed in.
   */
  async function urlClient(req: FastifyRequest, clientId: string, settings: McpSettings): Promise<{ client: Row } | Stop> {
    if (!settings.clientMetadata) {
      return stop(400, 'invalid_client', 'This connector identifies itself by a web address (a client ID metadata document), which is not switched on here. An administrator can switch it on under Administration > AI assistant access, or add the connector by hand.');
    }
    if (!(await metadataOn(settings))) {
      return stop(409, 'outbound_disabled', 'This connector identifies itself by a web address, which this installation would have to fetch, but outbound connections are switched off. An administrator can switch them on under Administration > Settings > Outbound connections.');
    }
    const problem = clientIdUrlProblem(clientId);
    if (problem) return stop(400, 'invalid_client', problem);
    const url = new URL(clientId);
    const refuse = async (reason: string, message: string, status = 400, code = 'invalid_client') => {
      await ctx.audit(req, {
        action: 'mcp.oauth.client_metadata_refused', recordType: 'mcp_oauth_client',
        summary: `Refused the connector at ${url.host}: ${message}`.slice(0, 400), after: { client_id: clientId, reason },
      });
      return stop(status, code, message);
    };
    if (!clientHostAllowed(url, settings.clientMetadataHosts)) {
      return refuse('host_not_allowed', `Connectors from ${url.host} are not on this installation's list of allowed hosts. Ask an administrator.`, 403, 'client_host_not_allowed');
    }
    const cached = await db.one<Row>(`select *, (metadata_expires_at > now()) as fresh from mcp_oauth_clients where client_id = $1`, [clientId]);
    if (cached?.revoked_at) {
      return stop(403, 'client_blocked', `An administrator removed the connector at ${url.host}. Ask an administrator to allow it again.`);
    }
    if (cached?.fresh) {
      if (cached.pending) return stop(403, 'client_pending', `The connector "${cached.name}" (${url.host}) is waiting for an administrator to approve it under Administration > AI assistant access.`);
      return { client: cached };
    }
    const who = req.user?.id ?? clientIp(req);
    if (await metadataFetches.blocked(who)) return stop(429, 'rate_limited', 'Too many connectors were looked up in a short time. Wait a few minutes and try again.');
    await metadataFetches.hit(who);
    let meta;
    let seconds;
    try {
      const got = await fetchClientMetadata(url, settings.clientMetadataHosts);
      meta = checkMetadataDocument(got.body, clientId, redirectProblem, parseScope);
      seconds = cacheSeconds(got.cacheControl);
    } catch (err) {
      const reason = err instanceof MetadataError ? err.reason : 'error';
      const text = err instanceof MetadataError ? err.message : 'The document could not be read.';
      // Errors are never cached: the next attempt fetches again.
      return refuse(reason, `The connector's metadata document at ${clientId} was not accepted: ${text}`);
    }
    const pending = cached ? cached.pending : settings.clientMetadataApproval;
    const row = (await db.one<Row>(
      `insert into mcp_oauth_clients (client_id, name, redirect_uris, auth_method, client_uri, registered_by, created_by, created_ip,
                                      pending, metadata_fetched_at, metadata_expires_at)
       values ($1, $2, $3::jsonb, 'none', $4, 'metadata', $5, $6, $7, now(), now() + make_interval(secs => $8::int))
       on conflict (client_id) do update set name = excluded.name, redirect_uris = excluded.redirect_uris, client_uri = excluded.client_uri,
         metadata_fetched_at = excluded.metadata_fetched_at, metadata_expires_at = excluded.metadata_expires_at
       returning *`,
      [clientId, meta.name, JSON.stringify(meta.redirectUris), meta.clientUri, req.user?.id ?? null, clientIp(req), pending, seconds]))!;
    const returnsTo = meta.redirectUris.map((u) => hostOf(u)).join(', ');
    if (!cached) {
      await ctx.audit(req, {
        action: 'mcp.oauth.client_metadata', recordType: 'mcp_oauth_client', recordId: row.id,
        summary: `Connector "${meta.name}" from ${url.host} identified itself by its metadata document (returns to ${returnsTo})${pending ? '; waiting for an administrator to approve it' : ''}`,
        after: { client_id: clientId, redirect_uris: meta.redirectUris },
      });
    } else if (cached.name !== meta.name || JSON.stringify(cached.redirect_uris) !== JSON.stringify(meta.redirectUris)) {
      await ctx.audit(req, {
        action: 'mcp.oauth.client_metadata', recordType: 'mcp_oauth_client', recordId: row.id,
        summary: `Connector "${meta.name}" from ${url.host} changed its metadata document (returns to ${returnsTo})`,
        before: { name: cached.name, redirect_uris: cached.redirect_uris }, after: { name: meta.name, redirect_uris: meta.redirectUris },
      });
    }
    if (row.pending) return stop(403, 'client_pending', `The connector "${row.name}" (${url.host}) is new here. An administrator must approve it under Administration > AI assistant access before anyone can connect it.`);
    return { client: row };
  }

  async function checkAuthorize(req: FastifyRequest, p: AuthorizeParams): Promise<Checked> {
    const settings = await readSettings(ctx);
    const issuer = await oauthBase(ctx, req);
    if (!settings.enabled || !settings.oauthEnabled) return { kind: 'stop', status: 409, code: 'oauth_disabled', message: 'Sign-in for remote connectors is switched off here. An administrator can switch it on under Administration > AI assistant access.' };
    if (!secureBase(issuer)) return { kind: 'stop', status: 409, code: 'oauth_insecure', message: 'Sign-in for remote connectors needs this installation to be reached over HTTPS.' };
    let client: Row | undefined;
    if (isUrlClientId(p.client_id)) {
      const found = await urlClient(req, String(p.client_id), settings);
      if ('stop' in found) return { kind: 'stop', ...found.stop };
      client = found.client;
    } else {
      client = p.client_id ? await db.one<Row>('select * from mcp_oauth_clients where client_id = $1 and revoked_at is null and not pending', [String(p.client_id).slice(0, 200)]) : undefined;
    }
    if (!client) return { kind: 'stop', status: 400, code: 'invalid_client', message: 'This connector is not known here (unknown or removed client_id). Add it again, or ask an administrator.' };
    const registered = client.redirect_uris as string[];
    // A metadata document's redirect addresses must match exactly (no port leeway on loopback).
    const exact = client.registered_by === 'metadata';
    const redirectUri = p.redirect_uri
      ? (exact ? (registered.includes(String(p.redirect_uri)) ? String(p.redirect_uri) : null) : matchRedirect(registered, String(p.redirect_uri)))
      : registered.length === 1 ? registered[0] : null;
    if (!redirectUri || redirectProblem(redirectUri)) {
      // Never redirect to an address that was not registered.
      return { kind: 'stop', status: 400, code: 'invalid_redirect_uri', message: 'The connector asked to return to an address it did not register. Nothing was sent to it.' };
    }
    const back = (error: string, description: string) => {
      const u = new URL(redirectUri);
      u.searchParams.set('error', error);
      u.searchParams.set('error_description', description);
      if (p.state !== undefined) u.searchParams.set('state', String(p.state));
      u.searchParams.set('iss', issuer);
      return { kind: 'redirect' as const, url: u.href };
    };
    if (p.response_type !== 'code') return back('unsupported_response_type', 'Only response_type=code is supported.');
    if (!p.code_challenge || p.code_challenge_method !== 'S256') return back('invalid_request', 'PKCE with code_challenge_method=S256 is required.');
    if (!/^[A-Za-z0-9_-]{43}$/.test(String(p.code_challenge))) return back('invalid_request', 'code_challenge must be a base64url SHA-256 value.');
    const scopes = parseScope(p.scope);
    if (!scopes) return back('invalid_scope', `Scopes offered: ${SUPPORTED_SCOPES.join(' ')}.`);
    if (!resourceOk(p.resource, issuer)) return back('invalid_target', `The resource here is ${issuer}/mcp.`);
    if (p.state !== undefined && String(p.state).length > 1000) return back('invalid_request', 'state is too long.');
    return { kind: 'ok', client, redirectUri, scopes, challenge: String(p.code_challenge), resource: p.resource ? `${issuer}/mcp` : null, state: p.state === undefined ? undefined : String(p.state), issuer };
  }

  const paramsOf = (b: Row): AuthorizeParams => {
    const out: Record<string, string> = {};
    for (const k of ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'scope', 'state', 'resource']) {
      if (b[k] !== undefined && b[k] !== null) out[k] = String(b[k]);
    }
    return out;
  };
  const maxDays = async () => Math.max(1, Number(await ctx.settings.get('tokens.max_days', 365)) || 365);

  app.post('/api/mcp/oauth/authorize', async (req) => {
    sessionOnly(req);
    const checked = await checkAuthorize(req, paramsOf((req.body ?? {}) as Row));
    if (checked.kind === 'stop') ctx.fail(checked.status, checked.code, checked.message);
    if (checked.kind === 'redirect') return { ok: false, redirect: checked.url };
    const ok = checked as Extract<Checked, { kind: 'ok' }>;
    const settings = await readSettings(ctx);
    const me = req.user!;
    return {
      ok: true,
      client: {
        name: ok.client.name, clientUri: ok.client.client_uri, redirectHost: hostOf(ok.redirectUri), redirectUri: ok.redirectUri,
        registeredBy: ok.client.registered_by, registeredAt: ok.client.created_at,
        // A connector known by its metadata document: where the document is (its name is self-declared).
        ...(ok.client.registered_by === 'metadata' ? { clientId: ok.client.client_id, clientIdHost: hostOf(ok.client.client_id) } : {}),
        // A loopback redirect can be received by any program on the person's computer.
        localRedirect: isLoopbackRedirect(ok.redirectUri),
      },
      requestedWrite: ok.scopes.includes(SCOPES.write),
      canWrite: me.permissions.some((p) => p === '*' || /\.(\*|create|edit)$/.test(p)),
      writeEnabled: settings.writeEnabled,
      mayConnect: mayConnect(settings, me),
      maxDays: await maxDays(),
    };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/mcp/oauth/authorize', tag: 'AI assistants',
    summary: 'Check an OAuth authorization request for the consent screen (signed-in session only)',
    body: '{ response_type, client_id, redirect_uri, code_challenge, code_challenge_method, scope?, state?, resource? } (the query of /oauth/authorize)',
    response: '{ ok: true, client: { name, clientUri, redirectHost, redirectUri, registeredBy: "dynamic" | "administrator" | "metadata", registeredAt, clientId?, clientIdHost?, localRedirect }, requestedWrite, canWrite, writeEnabled, mayConnect, maxDays } | { ok: false, redirect }',
    description: 'A client_id that is an https address is a client ID metadata document (E21-21): while allowed, the document is fetched, checked and cached here. Refusals: 400 `invalid_client`, 403 `client_host_not_allowed`, `client_pending` or `client_blocked`, 409 `outbound_disabled`, 429 `rate_limited`.',
  });

  app.post('/api/mcp/oauth/decision', async (req) => {
    sessionOnly(req);
    const b = (req.body ?? {}) as Row;
    const checked = await checkAuthorize(req, paramsOf(b));
    if (checked.kind === 'stop') ctx.fail(checked.status, checked.code, checked.message);
    if (checked.kind === 'redirect') return { redirect: checked.url };
    const ok = checked as Extract<Checked, { kind: 'ok' }>;
    const me = req.user!;
    const answer = (params: Record<string, string>) => {
      const u = new URL(ok.redirectUri);
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      if (ok.state !== undefined) u.searchParams.set('state', ok.state);
      u.searchParams.set('iss', ok.issuer);
      return { redirect: u.href };
    };
    if (b.approve !== true) {
      await ctx.audit(req, { action: 'mcp.oauth.deny', recordType: 'mcp_oauth_client', recordId: ok.client.id, summary: `Declined to connect "${ok.client.name}"` });
      return answer({ error: 'access_denied', error_description: 'The person declined.' });
    }
    const settings = await readSettings(ctx);
    if (!mayConnect(settings, me)) ctx.fail(403, 'mcp_not_allowed', 'Your role may not connect AI assistants here. Ask an administrator.');
    const access = b.access === 'write' && ok.scopes.includes(SCOPES.write) ? 'write' : 'read';
    const days = Number(b.expiresInDays ?? 30);
    const limit = await maxDays();
    if (!Number.isInteger(days) || days < 1 || days > limit) ctx.fail(400, 'validation', 'Check the highlighted fields.', { expiresInDays: `Choose from 1 to ${limit} days.` });
    const permissions = deps.scopesFor(me.permissions, access).filter((s) => !s.startsWith('mcp.'));
    if (!permissions.length) ctx.fail(400, 'validation', 'You have no permissions an assistant could use.', { access: 'You have no permissions an assistant could use.' });
    await recentAuth(req, 'connecting an AI assistant by sign-in');
    const code = random('');
    const scope = access === 'write' ? `${SCOPES.read} ${SCOPES.write}` : SCOPES.read;
    await db.query(
      `insert into mcp_oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, scope, permissions, resource, grant_days, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, now() + make_interval(secs => $10::int))`,
      [sha(code), ok.client.client_id, me.id, ok.redirectUri, ok.challenge, scope, JSON.stringify(permissions), ok.resource, days, CODE_SECONDS]);
    await ctx.audit(req, {
      action: 'mcp.oauth.consent', recordType: 'mcp_oauth_client', recordId: ok.client.id,
      summary: `Allowed "${ok.client.name}" to connect as an AI assistant (${access === 'write' ? 'read and write' : 'read only'}, ${days} days), returning to ${hostOf(ok.redirectUri)}`,
      after: { scope, days },
    });
    return answer({ code });
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/mcp/oauth/decision', tag: 'AI assistants',
    summary: 'Approve or decline an OAuth authorization request (signed-in session, recent password confirmation to approve)',
    body: '{ ...the authorization request, approve: boolean, access: "read" | "write", expiresInDays }',
    response: '{ redirect } - where the browser goes next (the connector\'s redirect address with code or error, state and iss)',
  });

  // ---------- connections (grants) and clients for the pages ----------

  const GRANTS_SQL = `
    select g.id, g.name, g.scope, g.created_at, g.expires_at, g.last_used_at, g.user_id, u.display_name as user_name,
           c.name as client_name, c.id as client_row_id
    from mcp_oauth_grants g join mcp_oauth_clients c on c.client_id = g.client_id left join users u on u.id = g.user_id
    where g.revoked_at is null and g.expires_at > now() and c.revoked_at is null`;

  async function myGrants(userId: string) {
    return db.query<Row>(`${GRANTS_SQL} and g.user_id = $1 order by g.created_at desc`, [userId]);
  }

  app.delete('/api/mcp/oauth/grants/:id', async (req) => {
    sessionOnly(req);
    const id = String((req.params as Row).id ?? '');
    const admin = ctx.can(req.user!, 'admin.administer');
    const row = UUID_RE.test(id) ? await db.one<Row>('select g.id, g.name, g.user_id from mcp_oauth_grants g where g.id = $1 and g.revoked_at is null', [id]) : undefined;
    if (!row || (row.user_id !== req.user!.id && !admin)) ctx.fail(404, 'not_found', 'Connection not found.');
    await revokeGrant(row!.id, row!.user_id === req.user!.id ? 'disconnected by its owner' : 'revoked by an administrator', req.user!.id);
    await ctx.audit(req, { action: 'mcp.oauth.revoke', recordType: 'mcp_oauth_grant', recordId: row!.id, summary: `Connection "${row!.name}" ended${row!.user_id === req.user!.id ? '' : ' by an administrator'}` });
    return { ok: true };
  });
  ctx.describeRoute({ method: 'DELETE', path: '/api/mcp/oauth/grants/:id', tag: 'AI assistants', summary: 'End a connector\'s OAuth connection (your own; administrators any). Its tokens stop working at once' });

  async function adminView() {
    const clients = await db.query<Row>(
      `select c.id, c.client_id, c.name, c.redirect_uris, c.auth_method, c.client_uri, c.registered_by, c.created_at, c.last_used_at,
              c.pending, c.metadata_fetched_at, c.metadata_expires_at, c.approved_at,
              (select count(*)::int from mcp_oauth_grants g where g.client_id = c.client_id and g.revoked_at is null and g.expires_at > now()) as connections
       from mcp_oauth_clients c where c.revoked_at is null order by c.pending desc, c.created_at desc limit 500`);
    const grants = await db.query<Row>(`${GRANTS_SQL} order by g.created_at desc limit 500`);
    // Connectors known by a metadata document that an administrator removed stay blocked until allowed again.
    const blocked = await db.query<Row>(
      `select id, client_id, name, revoked_at from mcp_oauth_clients where registered_by = 'metadata' and revoked_at is not null order by revoked_at desc limit 200`);
    return { clients, grants, blocked };
  }

  app.post('/api/mcp/admin/oauth/clients', { preHandler: ctx.requirePerm('admin.administer') }, async (req, reply) => {
    sessionOnly(req);
    const b = (req.body ?? {}) as Row;
    const fields: Record<string, string> = {};
    const name = cleanName(b.name);
    if (!name) fields.name = 'Name the connector.';
    const uris = Array.isArray(b.redirectUris) ? b.redirectUris.map((s: unknown) => String(s).trim()).filter(Boolean) : [];
    if (!uris.length || uris.length > 10) fields.redirectUris = 'Give one to ten redirect addresses, one per line.';
    else { const p = uris.map(redirectProblem).find(Boolean); if (p) fields.redirectUris = p; }
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    await recentAuth(req, 'adding a connector');
    const input: ClientInput = { name, redirectUris: [...new Set(uris)] as string[], authMethod: b.confidential === true ? 'client_secret_basic' : 'none', clientUri: null, grantTypes: ['authorization_code', 'refresh_token'], scope: null };
    const made = await createClient(input, 'administrator', req.user!.id, clientIp(req));
    await ctx.audit(req, { action: 'mcp.oauth.client_register', recordType: 'mcp_oauth_client', recordId: made.row.id, summary: `Connector "${name}" added by an administrator` });
    reply.code(201);
    return { id: made.row.id, clientId: made.row.client_id, ...(made.secret ? { clientSecret: made.secret } : {}), name, redirectUris: input.redirectUris, authMethod: input.authMethod };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/mcp/admin/oauth/clients', permission: 'admin.administer', tag: 'AI assistants',
    summary: 'Add a connector (OAuth client) by hand; a client secret, if asked for, is shown once',
    body: '{ name, redirectUris: string[], confidential?: boolean }', response: '{ id, clientId, clientSecret?, name, redirectUris, authMethod }',
  });

  app.delete('/api/mcp/admin/oauth/clients/:id', { preHandler: ctx.requirePerm('admin.administer') }, async (req) => {
    sessionOnly(req);
    const id = String((req.params as Row).id ?? '');
    const row = UUID_RE.test(id) ? await db.one<Row>('update mcp_oauth_clients set revoked_at = now(), revoked_by = $2 where id = $1 and revoked_at is null returning id, client_id, name', [id, req.user!.id]) : undefined;
    if (!row) ctx.fail(404, 'not_found', 'Connector not found.');
    const grants = await db.query<Row>('select id from mcp_oauth_grants where client_id = $1 and revoked_at is null', [row!.client_id]);
    for (const g of grants) await revokeGrant(g.id, 'connector removed by an administrator', req.user!.id);
    await ctx.audit(req, { action: 'mcp.oauth.client_remove', recordType: 'mcp_oauth_client', recordId: row!.id, summary: `Connector "${row!.name}" removed with its ${grants.length} connection(s)` });
    return { ok: true, connectionsEnded: grants.length };
  });
  ctx.describeRoute({
    method: 'DELETE', path: '/api/mcp/admin/oauth/clients/:id', permission: 'admin.administer', tag: 'AI assistants', summary: 'Remove a connector and end all its connections',
    description: 'A connector known by its metadata document stays blocked (listed under `blocked`) until allowed again.',
  });

  app.post('/api/mcp/admin/oauth/clients/:id/approve', { preHandler: ctx.requirePerm('admin.administer') }, async (req) => {
    sessionOnly(req);
    const id = String((req.params as Row).id ?? '');
    const found = UUID_RE.test(id) ? await db.one<Row>('select id, name, client_id from mcp_oauth_clients where id = $1 and pending and revoked_at is null', [id]) : undefined;
    if (!found) ctx.fail(404, 'not_found', 'No connector waiting for approval with that id.');
    await recentAuth(req, 'approving a connector');
    await db.query('update mcp_oauth_clients set pending = false, approved_at = now(), approved_by = $2 where id = $1', [id, req.user!.id]);
    await ctx.audit(req, { action: 'mcp.oauth.client_approve', recordType: 'mcp_oauth_client', recordId: id, summary: `Connector "${found!.name}" (${hostOf(found!.client_id)}) approved; people may now connect it` });
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/mcp/admin/oauth/clients/:id/approve', permission: 'admin.administer', tag: 'AI assistants',
    summary: 'Approve a connector known by its metadata document that is waiting for approval (recent password confirmation)',
  });

  app.delete('/api/mcp/admin/oauth/blocked/:id', { preHandler: ctx.requirePerm('admin.administer') }, async (req) => {
    sessionOnly(req);
    const id = String((req.params as Row).id ?? '');
    const row = UUID_RE.test(id)
      ? await db.one<Row>(`delete from mcp_oauth_clients where id = $1 and registered_by = 'metadata' and revoked_at is not null returning id, name, client_id`, [id])
      : undefined;
    if (!row) ctx.fail(404, 'not_found', 'No blocked connector with that id.');
    await ctx.audit(req, { action: 'mcp.oauth.client_unblock', recordType: 'mcp_oauth_client', recordId: row!.id, summary: `Connector "${row!.name}" (${hostOf(row!.client_id)}) allowed again; its document is fetched afresh next time` });
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'DELETE', path: '/api/mcp/admin/oauth/blocked/:id', permission: 'admin.administer', tag: 'AI assistants',
    summary: 'Allow a removed connector known by its metadata document again (it is looked up afresh, and approved again if approval is on)',
  });

  return { challenge, internalHeaders, myGrants, adminView, available };
}
