import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from './db.ts';
import { fail, UUID_RE } from './errors.ts';
import type { Row, SessionUser } from './module.ts';
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

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

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
         t.last_used_at, t.last_used_ip, t.created_at, t.revoked_at,
         (t.revoked_at is null and t.expires_at > now()) as active
  from api_tokens t join users u on u.id = t.user_id`;

export function registerTokens(app: FastifyInstance, deps: Deps) {
  const { db, audit, settings } = deps;
  const failures = makeDbLimiter(db, 'token', 20, 5 * 60_000); // wrong tokens, by source address
  // Requests per token in the current minute. In memory: a restart only resets the minute.
  const windows = new Map<string, { minute: number; count: number }>();

  /** Resolves a bearer token into `req.user` (with the token's reduced permissions) or throws. */
  async function authenticate(req: FastifyRequest, token: string): Promise<void> {
    const ip = clientIp(req);
    if (await failures.blocked(ip)) fail(429, 'rate_limited', 'Too many requests with a wrong token. Wait a few minutes and try again.');
    const row = token.startsWith(TOKEN_PREFIX)
      ? await db.one<Row>(
        `select id, user_id, name, scopes, (last_used_at is null or last_used_at < now() - interval '1 minute') as stale
         from api_tokens where token_hash = $1 and revoked_at is null and expires_at > now()`,
        [tokenHash(token)])
      : undefined;
    const owner = row ? await deps.loadUser(db, row.user_id) : null;
    if (!row || !owner) {
      await failures.hit(ip);
      await audit(req, { action: 'token.refused', recordType: 'api_token', recordId: row?.id, summary: `API token refused (unknown, expired or revoked) from ${ip}` });
      fail(401, 'invalid_token', 'That API token is not valid. It may have expired or been revoked.');
    }
    const perMinute = Math.max(1, Number(await settings.get('tokens.rate_per_minute', 600)) || 600);
    const minute = Math.floor(Date.now() / 60_000);
    const w = windows.get(row!.id);
    if (!w || w.minute !== minute) windows.set(row!.id, { minute, count: 1 });
    else if (++w.count > perMinute) fail(429, 'rate_limited', `This API token is limited to ${perMinute} requests a minute.`);
    if (windows.size > 5000) for (const [k, v] of windows) if (v.minute !== minute) windows.delete(k);

    if (tokenBlocked(req.url)) fail(403, 'token_not_allowed', 'This route cannot be called with an API token. Sign in to use it.');
    if (row!.stale) await db.query('update api_tokens set last_used_at = now(), last_used_ip = $2 where id = $1', [row!.id, ip]);
    req.user = { ...owner!, permissions: intersectGrants(row!.scopes as string[], owner!.permissions) };
    req.sessionHash = null;
    req.apiToken = { id: row!.id, name: row!.name };
  }

  // Every change made with a token leaves an event naming the token, whatever the route itself records.
  app.addHook('onResponse', async (req, reply) => {
    if (!req.apiToken || ['GET', 'HEAD', 'OPTIONS'].includes(req.method) || reply.statusCode >= 400) return;
    await audit(req, {
      action: 'token.use', recordType: 'api_token', recordId: req.apiToken.id,
      summary: `${req.method} ${req.url.split('?')[0]} (${reply.statusCode}) with API token "${req.apiToken.name}"`,
    }).catch((err) => console.error('[tokens] could not audit a token request:', err));
  });

  const maxDays = async () => Math.max(1, Number(await settings.get('tokens.max_days', 365)) || 365);
  const publicRow = ({ user_id, user_name, username, ...t }: Row, withOwner: boolean) =>
    (withOwner ? { ...t, userId: user_id, userName: user_name, username } : t);

  app.get('/api/me/tokens', async (req) => ({
    tokens: (await db.query<Row>(`${LIST_SQL} where t.user_id = $1 order by t.created_at desc`, [req.user!.id])).map((t) => publicRow(t, false)),
    maxDays: await maxDays(),
    // What this person may put in a token today.
    grants: req.user!.permissions,
  }));

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
      const beyond = scopes.filter((s) => !scopeCovered(s, me.permissions));
      if (beyond.length) fields.scopes = `You do not hold these permissions yourself: ${beyond.join(', ')}.`;
    }
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

    const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
    const row = await db.one<Row>(
      `insert into api_tokens (user_id, name, token_hash, prefix, scopes, expires_at) values ($1,$2,$3,$4,$5::jsonb,$6)
       returning id, name, prefix, scopes, expires_at, created_at`,
      [me.id, name, tokenHash(token), token.slice(0, TOKEN_PREFIX.length + 6), JSON.stringify(scopes), expires!.toISOString()],
    );
    await audit(req, {
      action: 'token.create', recordType: 'api_token', recordId: row!.id,
      summary: `API token "${name}" created, expiring ${expires!.toISOString().slice(0, 10)}`, after: { name, scopes, expires_at: expires!.toISOString() },
    });
    reply.code(201);
    return { ...row, token }; // the only time the token itself is shown
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

  app.get('/api/admin/tokens', { preHandler: requirePerm('admin.administer') }, async (req) => {
    const q = req.query as Record<string, string>;
    const rows = await db.query<Row>(
      `${LIST_SQL} where ($1::text is null or t.user_id::text = $1) order by t.created_at desc limit 2000`,
      [q.user_id && UUID_RE.test(q.user_id) ? q.user_id : null]);
    return { tokens: rows.map((t) => publicRow(t, true)) };
  });

  app.delete('/api/admin/tokens/:id', { preHandler: requirePerm('admin.administer') }, (req) => revoke(req, 'true', []));

  return { authenticate, can };
}
