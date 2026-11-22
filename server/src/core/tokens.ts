import { createHash, randomBytes } from 'node:crypto';
import { BlockList, isIP } from 'node:net';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db, Queryable } from './db.ts';
import { fail, UUID_RE } from './errors.ts';
import type { Row, SessionUser } from './module.ts';
import { routePattern } from './api/versioning.ts';
import { makeDbLimiter } from './ratelimit.ts';
import { clientIp } from './request.ts';
import { can, requirePerm, type makeAudit, type makeSettings } from './services.ts';

/**
 * Personal access tokens (E02-12): `Authorization: Bearer grc_pat_...` on /api routes.
 *
 * - A token is shown once, when it is created; only its SHA-256 is stored.
 * - A request made with a token acts as the token's owner, with the permissions the token's scopes
 *   and the owner's own grants have in common, worked out on every request. A token can therefore
 *   never do more than its owner can do at that moment.
 * - A request that carries an Authorization header never falls back to the session cookie, and
 *   needs no X-GRC-CSRF header (a browser cannot be tricked into sending the header).
 * - Tokens cannot reach the sign-in, account-security or token-management routes (TOKEN_BLOCKED),
 *   and cannot pass a password confirmation, so they cannot perform sensitive administrative actions.
 * - A token may be limited to source addresses (E02-18): a list of addresses and CIDR ranges.
 * - Modules may accept other bearer tokens with their own prefix (registerBearerResolver), such as
 *   the OAuth access tokens of the MCP module; the checks after the lookup are the same.
 */
export const TOKEN_PREFIX = 'grc_pat_';
const SCOPE_RE = /^(\*|[a-z][a-z0-9_]*\.(\*|[a-z][a-z0-9_]*))$/;

/** Routes a token may never call. `/api/auth/state` stays open so a client can check who it is. */
export function tokenBlocked(url: string): boolean {
  const path = url.split('?')[0];
  if (path === '/api/auth/state') return false;
  return path.startsWith('/api/auth/') || path === '/api/setup'
    || path === '/api/me/tokens' || path.startsWith('/api/me/tokens/')
    || path === '/api/admin/tokens' || path.startsWith('/api/admin/tokens/');
}

/**
 * Revokes every credential a person has handed to programs (wave 9, SA-8): their personal access
 * tokens and, when the AI assistant module is installed, their assistant (MCP OAuth) connections.
 * Called when their password is changed or reset, and when an administrator resets their second
 * factor, so a credential made by someone who had the old password stops working with it.
 * Returns how many of each were revoked; the caller writes the audit event.
 */
export async function revokeProgramAccess(db: Queryable, userId: string, by: string | null, reason: string): Promise<{ tokens: number; connections: number; devices: number }> {
  const tokens = await db.query(
    'update api_tokens set revoked_at = now(), revoked_by = $2 where user_id = $1 and revoked_at is null and expires_at > now() returning id',
    [userId, by]);
  let connections = 0;
  if ((await db.one<{ t: string | null }>(`select to_regclass('public.mcp_oauth_grants')::text as t`))?.t) {
    connections = (await db.query(
      `update mcp_oauth_grants set revoked_at = now(), revoked_by = $2, revoked_reason = $3
       where user_id = $1 and revoked_at is null and expires_at > now() returning id`,
      [userId, by, reason.slice(0, 200)])).length;
  }
  // Signed-in installations of the mobile app (modules/mobile, wave 13 E38-02), when that module is installed:
  // their access and refresh tokens stop working at once (the token lookups require an unrevoked device).
  let devices = 0;
  if ((await db.one<{ t: string | null }>(`select to_regclass('public.mobile_devices')::text as t`))?.t) {
    devices = (await db.query(
      `update mobile_devices set revoked_at = now(), revoked_by = $2, revoked_reason = $3
       where user_id = $1 and revoked_at is null returning id`,
      [userId, by, reason.slice(0, 200)])).length;
  }
  return { tokens: tokens.length, connections, devices };
}

/** "; 2 API token(s) and 1 assistant connection(s) revoked; 1 mobile device(s) signed out" for an audit summary, or ''. */
export const revokedSummary = (r: { tokens: number; connections: number; devices?: number }) =>
  (r.tokens || r.connections ? `; ${r.tokens} API token(s) and ${r.connections} assistant connection(s) revoked` : '')
  + (r.devices ? `; ${r.devices} mobile device(s) signed out` : '');

export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

/** What two grant patterns have in common, or null. Patterns: `*`, `<module>.*`, `<module>.<action>`. */
function common(a: string, b: string): string | null {
  if (a === '*') return b;
  if (b === '*') return a;
  if (a === b) return a;
  const [am, aa] = a.split('.');
  const [bm, ba] = b.split('.');
  if (am !== bm) return null;
  if (aa === '*') return b;
  if (ba === '*') return a;
  return null;
}

/** The permissions a token may use: everything its scopes and its owner's grants have in common. */
export function intersectGrants(scopes: string[], grants: string[]): string[] {
  const out = new Set<string>();
  for (const s of scopes) for (const g of grants) {
    const c = common(s, g);
    if (c) out.add(c);
  }
  return [...out];
}

/** Whether the owner's grants cover the whole of a scope (checked when a token is created). */
export function scopeCovered(scope: string, grants: string[]): boolean {
  return grants.some((g) => common(scope, g) === scope);
}

/**
 * Scope families that are not permissions (docs/api.md, "Scopes"): capabilities a token may be
 * given, such as `mcp.use` (the token may be used at the MCP endpoint). No role grants them, so
 * `scopeCovered` alone would refuse them to everyone but administrators holding `*`. Each says
 * who may put it in a token: `allowed(grants)` sees the person's own permissions. What the token
 * can then do is still limited to its permission scopes and its owner's grants.
 *
 * An installation may narrow a family further at run time (for example "only these roles may
 * connect an AI assistant"): see `registerScopeGate` on the Fastify instance.
 */
export interface ScopeFamily { description: string; allowed: (grants: string[]) => boolean }
export const SCOPE_FAMILIES = new Map<string, ScopeFamily>([
  // Anyone who holds any permission may let a token reach the MCP endpoint; an administrator
  // still has to switch the endpoint on, and every tool call is checked against the token's
  // permission scopes and the owner's grants.
  ['mcp.use', { description: 'Use this token at the MCP endpoint (/mcp)', allowed: (grants) => grants.length > 0 }],
]);

/** Adds a scope family (a module offering a capability scope). */
export function registerScopeFamily(scope: string, family: ScopeFamily): void {
  if (!SCOPE_RE.test(scope) || scope.endsWith('.*') || scope === '*') throw new Error(`Scope family "${scope}" must look like "<area>.<capability>"`);
  SCOPE_FAMILIES.set(scope, family);
}

/**
 * Whether a person may put a scope in a token: a permission they hold, or a scope family they are
 * allowed (`mcp.use`; `mcp.*` when every `mcp.` family is allowed and no permission is needed).
 */
export function scopeGrantable(scope: string, grants: string[]): boolean {
  if (scopeCovered(scope, grants)) return true;
  const family = SCOPE_FAMILIES.get(scope);
  if (family) return family.allowed(grants);
  if (scope.endsWith('.*') && scope !== '*') {
    const prefix = scope.slice(0, -1);
    const members = [...SCOPE_FAMILIES.entries()].filter(([s]) => s.startsWith(prefix));
    const permissionsOfArea = grants.some((g) => g.startsWith(prefix) || g === '*');
    return members.length > 0 && !permissionsOfArea && members.every(([, f]) => f.allowed(grants));
  }
  return false;
}

/** The scope families a person may put in a token, for the token screen. */
export const grantableFamilies = (grants: string[]) =>
  [...SCOPE_FAMILIES.entries()].filter(([, f]) => f.allowed(grants)).map(([scope, f]) => ({ scope, description: f.description }));

// ---------- source addresses (E02-18) ----------

export const MAX_SOURCES = 20;

/** `::ffff:10.0.0.1` -> `10.0.0.1`, `[::1]` -> `::1`, a zone index dropped. */
export function normalizeIp(ip: string): string {
  let s = String(ip ?? '').trim().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(s)) s = s.slice(7);
  return s;
}

/** One address or CIDR range, normalized, or null when it is not one. */
export function parseSource(entry: string): { address: string; prefix: number; family: 'ipv4' | 'ipv6' } | null {
  const m = /^([^/\s]+)(?:\/(\d{1,3}))?$/.exec(String(entry ?? '').trim());
  if (!m) return null;
  const address = normalizeIp(m[1]);
  const v = isIP(address);
  if (!v) return null;
  const max = v === 4 ? 32 : 128;
  const prefix = m[2] === undefined ? max : Number(m[2]);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) return null;
  return { address, prefix, family: v === 4 ? 'ipv4' : 'ipv6' };
}

/**
 * Checks a list of allowed source addresses as given by a person: `{ list }` (trimmed, without
 * duplicates; empty means "from anywhere") or `{ error }` in plain words.
 */
export function checkSources(value: unknown): { list: string[] } | { error: string } {
  if (value === undefined || value === null || value === '') return { list: [] };
  const raw = Array.isArray(value) ? value.map(String) : typeof value === 'string' ? value.split(/[\s,]+/) : null;
  if (!raw) return { error: 'Give a list of addresses or ranges.' };
  const list = [...new Set(raw.map((s) => s.trim()).filter(Boolean))];
  if (list.length > MAX_SOURCES) return { error: `List at most ${MAX_SOURCES} addresses or ranges.` };
  const bad = list.find((s) => !parseSource(s));
  if (bad) return { error: `"${bad.slice(0, 60)}" is not an address or range. Write for example 203.0.113.7, 10.20.0.0/16 or 2001:db8::/32.` };
  return { list };
}

/** Whether a request from `ip` is allowed by a token's list (an empty list allows every address). */
export function sourceAllowed(ip: string, sources: string[] | null | undefined): boolean {
  if (!sources || sources.length === 0) return true;
  const addr = normalizeIp(ip);
  const v = isIP(addr);
  if (!v) return false;
  const block = new BlockList();
  for (const s of sources) {
    const p = parseSource(s);
    if (p) block.addSubnet(p.address, p.prefix, p.family);
  }
  return block.check(addr, v === 4 ? 'ipv4' : 'ipv6');
}

// ---------- issuing ----------

export interface IssuedToken { row: Row; token: string }

/**
 * Stores a new personal access token and returns it with the secret (shown once). Callers check
 * the name, scopes and expiry first, and ask for a recent password confirmation. Used by
 * POST /api/me/tokens and by modules that make tokens for a purpose (the MCP module).
 */
export async function issueToken(db: Queryable, t: { userId: string; name: string; scopes: string[]; expires: Date; allowedSources?: string[] }): Promise<IssuedToken> {
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
  const sources = t.allowedSources?.length ? JSON.stringify(t.allowedSources) : null;
  const row = await db.one<Row>(
    `insert into api_tokens (user_id, name, token_hash, prefix, scopes, expires_at, allowed_sources) values ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb)
     returning id, name, prefix, scopes, expires_at, created_at, allowed_sources`,
    [t.userId, t.name, tokenHash(token), token.slice(0, TOKEN_PREFIX.length + 6), JSON.stringify(t.scopes), t.expires.toISOString(), sources],
  );
  return { row: row!, token };
}

// ---------- other bearer tokens, and what a request's token carries ----------

/** What a module's resolver finds for a bearer token of its own kind. */
export interface BearerResolution {
  /** Identifies the credential in audit events and the per-token request limit (a uuid). */
  id: string;
  name: string;
  userId: string;
  /** Scopes, as for a personal access token (permission scopes and scope families). */
  scopes: string[];
  allowedSources?: string[] | null;
  /**
   * A recent sign-in claim (ISO time of a fresh password or second-factor proof) that the credential
   * carries because its issuer made the person sign in again for it: today only the mobile app's tokens
   * after a `prompt=login` sign-in (modules/mobile). `requireRecentAuth` accepts it for
   * `auth.reauth_minutes` from that time, as it accepts a session's confirmation. Personal access tokens
   * never carry one.
   */
  confirmedAt?: string | null;
}
/** Answers null for an unknown, expired or revoked token; may throw `fail(...)` to refuse with a reason. */
export type BearerResolver = (token: string, req: FastifyRequest) => Promise<BearerResolution | null>;
/** May this person put the scope in a credential right now (beyond `ScopeFamily.allowed`)? */
export type ScopeGate = (user: SessionUser) => Promise<boolean>;

declare module 'fastify' {
  interface FastifyInstance {
    /** Accept bearer tokens starting with `prefix` (e.g. `grc_oat_`) on /api routes. */
    registerBearerResolver(prefix: string, resolver: BearerResolver): void;
    /** Narrow who may put a scope family in a token at run time (e.g. by role). */
    registerScopeGate(scope: string, gate: ScopeGate): void;
  }
}

const requestScopes = new WeakMap<FastifyRequest, string[]>();
/** The scopes of the token a request was made with (as stored), or undefined for a session. */
export const tokenScopes = (req: FastifyRequest): string[] | undefined => requestScopes.get(req);
const requestConfirmed = new WeakMap<FastifyRequest, number>();
/** The recent sign-in claim (epoch ms) of the bearer token a request was made with, or null (always null for a session or personal access token). */
export const tokenConfirmedAt = (req: FastifyRequest): number | null => requestConfirmed.get(req) ?? null;

export interface ApiTokenInfo { id: string; name: string }

interface Deps {
  db: Db;
  audit: ReturnType<typeof makeAudit>;
  settings: ReturnType<typeof makeSettings>;
  loadUser(db: Db, userId: string): Promise<SessionUser | null>;
  requireRecentAuth(req: FastifyRequest, what: string): Promise<void>;
}

const LIST_SQL = `
  select t.id, t.user_id, u.display_name as user_name, u.username, t.name, t.prefix, t.scopes, t.expires_at,
         t.last_used_at, t.last_used_ip, t.created_at, t.revoked_at, coalesce(t.allowed_sources, '[]'::jsonb) as allowed_sources,
         (t.revoked_at is null and t.expires_at > now()) as active
  from api_tokens t join users u on u.id = t.user_id`;

export function registerTokens(app: FastifyInstance, deps: Deps) {
  const { db, audit, settings } = deps;
  const failures = makeDbLimiter(db, 'token', 20, 5 * 60_000); // wrong tokens, by source address
  // Requests per token in the current minute. In memory: a restart only resets the minute.
  const windows = new Map<string, { minute: number; count: number }>();
  const resolvers = new Map<string, BearerResolver>();
  const gates = new Map<string, ScopeGate>();

  app.decorate('registerBearerResolver', (prefix: string, resolver: BearerResolver) => {
    if (!/^grc_[a-z]{2,8}_$/.test(prefix) || prefix === TOKEN_PREFIX) throw new Error(`Bearer prefix "${prefix}" must look like "grc_xyz_" and not be ${TOKEN_PREFIX}`);
    resolvers.set(prefix, resolver);
  });
  app.decorate('registerScopeGate', (scope: string, gate: ScopeGate) => { gates.set(scope, gate); });

  /** Whether `user` may put `scope` in a token now: grantable, and any run-time gate agrees. */
  async function mayGrant(scope: string, user: SessionUser): Promise<boolean> {
    if (!scopeGrantable(scope, user.permissions)) return false;
    if (scopeCovered(scope, user.permissions)) return true;
    const names = scope.endsWith('.*') ? [...SCOPE_FAMILIES.keys()].filter((s) => s.startsWith(scope.slice(0, -1))) : [scope];
    for (const n of names) {
      const gate = gates.get(n);
      if (gate && !(await gate(user))) return false;
    }
    return true;
  }

  /** Resolves a bearer token into `req.user` (with the token's reduced permissions) or throws. */
  async function authenticate(req: FastifyRequest, token: string): Promise<void> {
    const ip = clientIp(req);
    if (await failures.blocked(ip)) fail(429, 'rate_limited', 'Too many requests with a wrong token. Wait a few minutes and try again.');
    let found: (BearerResolution & { stale?: boolean }) | null = null;
    if (token.startsWith(TOKEN_PREFIX)) {
      const row = await db.one<Row>(
        `select id, user_id, name, scopes, allowed_sources, (last_used_at is null or last_used_at < now() - interval '1 minute') as stale
         from api_tokens where token_hash = $1 and revoked_at is null and expires_at > now()`,
        [tokenHash(token)]);
      if (row) found = { id: row.id, name: row.name, userId: row.user_id, scopes: row.scopes, allowedSources: row.allowed_sources, stale: row.stale };
    } else {
      const resolver = [...resolvers.entries()].find(([p]) => token.startsWith(p))?.[1];
      if (resolver) found = await resolver(token, req);
    }
    const owner = found ? await deps.loadUser(db, found.userId) : null;
    if (!found || !owner) {
      await failures.hit(ip);
      await audit(req, { action: 'token.refused', recordType: 'api_token', recordId: found?.id, summary: `API token refused (unknown, expired or revoked) from ${ip}` });
      fail(401, 'invalid_token', 'That API token is not valid. It may have expired or been revoked.');
    }
    if (!sourceAllowed(ip, found!.allowedSources)) {
      await failures.hit(ip);
      await audit(req, { action: 'token.refused', recordType: 'api_token', recordId: found!.id, summary: `API token "${found!.name}" refused: used from ${ip}, which is not among its allowed source addresses` });
      fail(403, 'token_source_not_allowed', 'This API token may not be used from this address.');
    }
    const perMinute = Math.max(1, Number(await settings.get('tokens.rate_per_minute', 600)) || 600);
    const minute = Math.floor(Date.now() / 60_000);
    const w = windows.get(found!.id);
    if (!w || w.minute !== minute) windows.set(found!.id, { minute, count: 1 });
    else if (++w.count > perMinute) fail(429, 'rate_limited', `This API token is limited to ${perMinute} requests a minute.`);
    if (windows.size > 5000) for (const [k, v] of windows) if (v.minute !== minute) windows.delete(k);

    // The path and the route it matched must both be allowed (they agree once the path is canonical).
    if (tokenBlocked(req.url) || tokenBlocked(routePattern(req))) fail(403, 'token_not_allowed', 'This route cannot be called with an API token. Sign in to use it.');
    if (found!.stale) await db.query('update api_tokens set last_used_at = now(), last_used_ip = $2 where id = $1', [found!.id, ip]);
    req.user = { ...owner!, permissions: intersectGrants(found!.scopes, owner!.permissions) };
    req.sessionHash = null;
    req.apiToken = { id: found!.id, name: found!.name };
    requestScopes.set(req, [...found!.scopes]);
    // Only a module's resolver can give a recent sign-in claim; a personal access token never has one.
    if (!token.startsWith(TOKEN_PREFIX) && found!.confirmedAt) {
      const at = Date.parse(found!.confirmedAt);
      if (Number.isFinite(at)) requestConfirmed.set(req, at);
    }
  }

  // Every change made with a token leaves an event naming the token, whatever the route itself records.
  // Written before the answer is sent (onSend), so a caller that sees the answer can read the event.
  app.addHook('onSend', async (req, reply, payload) => {
    if (!req.apiToken || ['GET', 'HEAD', 'OPTIONS'].includes(req.method) || reply.statusCode >= 400) return payload;
    await audit(req, {
      action: 'token.use', recordType: 'api_token', recordId: req.apiToken.id,
      summary: `${req.method} ${req.url.split('?')[0]} (${reply.statusCode}) with API token "${req.apiToken.name}"`,
    }).catch((err) => console.error('[tokens] could not audit a token request:', err));
    return payload;
  });

  const maxDays = async () => Math.max(1, Number(await settings.get('tokens.max_days', 365)) || 365);
  const publicRow = ({ user_id, user_name, username, ...t }: Row, withOwner: boolean) =>
    (withOwner ? { ...t, userId: user_id, userName: user_name, username } : t);

  app.get('/api/me/tokens', async (req) => {
    const families = [];
    for (const f of grantableFamilies(req.user!.permissions)) if (await mayGrant(f.scope, req.user!)) families.push(f);
    return {
      tokens: (await db.query<Row>(`${LIST_SQL} where t.user_id = $1 order by t.created_at desc`, [req.user!.id])).map((t) => publicRow(t, false)),
      maxDays: await maxDays(),
      // What this person may put in a token today.
      grants: req.user!.permissions,
      // Capability scopes (not permissions) they may add, such as `mcp.use`.
      scopeFamilies: families,
      // The address this request came from, to help fill in "allowed source addresses".
      yourAddress: normalizeIp(clientIp(req)),
    };
  });

  app.post('/api/me/tokens', async (req, reply) => {
    const b = (req.body ?? {}) as Row;
    const me = req.user!;
    const fields: Record<string, string> = {};
    const name = String(b.name ?? '').trim();
    if (!name || name.length > 80) fields.name = 'Give the token a name of up to 80 characters.';
    else if (await db.one('select 1 from api_tokens where user_id = $1 and lower(name) = lower($2) and revoked_at is null and expires_at > now()', [me.id, name])) {
      fields.name = 'You already have an active token with that name.';
    }
    const scopes = Array.isArray(b.scopes) ? [...new Set(b.scopes.map((s: unknown) => String(s).trim()))] as string[] : [];
    if (!scopes.length) fields.scopes = 'Choose at least one permission for the token.';
    else if (scopes.some((s) => !SCOPE_RE.test(s))) fields.scopes = 'Permissions look like "tickets.view", "tickets.*" or "*".';
    else {
      const beyond: string[] = [];
      for (const s of scopes) if (!(await mayGrant(s, me))) beyond.push(s);
      if (beyond.length) fields.scopes = `You do not hold these permissions yourself: ${beyond.join(', ')}.`;
    }
    const sources = checkSources(b.allowedSources);
    if ('error' in sources) fields.allowedSources = sources.error;
    const limit = await maxDays();
    let expires: Date | null = null;
    if (b.expiresAt !== undefined && b.expiresAt !== null && b.expiresAt !== '') {
      const d = new Date(String(b.expiresAt));
      expires = Number.isNaN(d.getTime()) ? null : d;
    } else if (b.expiresInDays !== undefined) {
      const days = Number(b.expiresInDays);
      expires = Number.isFinite(days) && days > 0 ? new Date(Date.now() + days * 86_400_000) : null;
    }
    if (!expires) fields.expiresInDays = 'Choose when the token expires.';
    else if (expires.getTime() <= Date.now()) fields.expiresInDays = 'The expiry must be in the future.';
    else if (expires.getTime() > Date.now() + limit * 86_400_000 + 60_000) fields.expiresInDays = `A token may last at most ${limit} days.`;
    if (Object.keys(fields).length) fail(400, 'validation', 'Check the highlighted fields.', fields);
    await deps.requireRecentAuth(req, 'creating an API token');

    const allowedSources = 'list' in sources ? sources.list : [];
    const { row, token } = await issueToken(db, { userId: me.id, name, scopes, expires: expires!, allowedSources });
    await audit(req, {
      action: 'token.create', recordType: 'api_token', recordId: row.id,
      summary: `API token "${name}" created, expiring ${expires!.toISOString().slice(0, 10)}${allowedSources.length ? `, usable from ${allowedSources.join(', ')} only` : ''}`,
      after: { name, scopes, expires_at: expires!.toISOString(), ...(allowedSources.length ? { allowed_sources: allowedSources } : {}) },
    });
    reply.code(201);
    return { ...row, allowed_sources: row.allowed_sources ?? [], token }; // the only time the token itself is shown
  });

  async function revoke(req: FastifyRequest, where: string, params: unknown[]) {
    const id = String((req.params as Row).id ?? '');
    const row = UUID_RE.test(id) ? await db.one<Row>(
      `update api_tokens set revoked_at = now(), revoked_by = $1 where id = $2 and revoked_at is null and ${where} returning id, name, user_id`,
      [req.user!.id, id, ...params]) : undefined;
    if (!row) fail(404, 'not_found', 'Token not found.');
    await audit(req, {
      action: 'token.revoke', recordType: 'api_token', recordId: id,
      summary: `API token "${row!.name}" revoked${row!.user_id === req.user!.id ? '' : ' by an administrator'}`, before: { user_id: row!.user_id },
    });
    return { ok: true };
  }

  app.delete('/api/me/tokens/:id', (req) => revoke(req, 'user_id = $3', [req.user!.id]));

  /**
   * Changes the source addresses of a live token (E02-18): its owner, or an administrator. An empty
   * list allows any address again. Needs a recent password confirmation, since it can widen where the
   * token works; audited with the lists before and after.
   */
  async function changeSources(req: FastifyRequest, where: string, params: unknown[]) {
    const id = String((req.params as Row).id ?? '');
    const row = UUID_RE.test(id) ? await db.one<Row>(
      `select id, name, user_id, coalesce(allowed_sources, '[]'::jsonb) as allowed_sources from api_tokens
       where id = $1 and revoked_at is null and expires_at > now() and ${where}`, [id, ...params]) : undefined;
    if (!row) fail(404, 'not_found', 'Token not found, or it has expired or been revoked.');
    const b = (req.body ?? {}) as Row;
    if (b.allowedSources === undefined) fail(400, 'validation', 'Check the highlighted fields.', { allowedSources: 'Give the allowed source addresses, or an empty list to allow any address.' });
    const sources = checkSources(b.allowedSources);
    if ('error' in sources) fail(400, 'validation', 'Check the highlighted fields.', { allowedSources: sources.error });
    const list = (sources as { list: string[] }).list;
    const before = row!.allowed_sources as string[];
    const by = row!.user_id === req.user!.id ? '' : ' by an administrator';
    await deps.requireRecentAuth(req, 'changing where an API token may be used from');
    const updated = await db.one<Row>(
      `update api_tokens set allowed_sources = $2::jsonb where id = $1
       returning id, name, prefix, scopes, expires_at, created_at, coalesce(allowed_sources, '[]'::jsonb) as allowed_sources`,
      [id, list.length ? JSON.stringify(list) : null]);
    await audit(req, {
      action: 'token.update', recordType: 'api_token', recordId: id,
      summary: `Allowed source addresses of API token "${row!.name}" changed${by}: ${list.length ? list.join(', ') : 'any address'}`,
      before: { allowed_sources: before }, after: { allowed_sources: list },
    });
    return updated;
  }

  app.patch('/api/me/tokens/:id', (req) => changeSources(req, 'user_id = $2', [req.user!.id]));

  app.get('/api/admin/tokens', { preHandler: requirePerm('admin.administer') }, async (req) => {
    const q = req.query as Record<string, string>;
    const rows = await db.query<Row>(
      `${LIST_SQL} where ($1::text is null or t.user_id::text = $1) order by t.created_at desc limit 2000`,
      [q.user_id && UUID_RE.test(q.user_id) ? q.user_id : null]);
    return { tokens: rows.map((t) => publicRow(t, true)) };
  });

  app.delete('/api/admin/tokens/:id', { preHandler: requirePerm('admin.administer') }, (req) => revoke(req, 'true', []));
  app.patch('/api/admin/tokens/:id', { preHandler: requirePerm('admin.administer') }, (req) => changeSources(req, 'true', []));

  return { authenticate, can };
}
