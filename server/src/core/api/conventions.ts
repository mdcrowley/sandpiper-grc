import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db.ts';
import { ApiError } from '../errors.ts';
import { migrate } from '../migrate.ts';
import type { ResourceDef, Row } from '../module.ts';
import type { makeResources } from '../resource.ts';
import type { makeSettings } from '../services.ts';
import { unversioned } from './versioning.ts';

/**
 * Conventions every integrator can rely on, applied centrally to the generated record routes
 * (and, for paging, to any list answer of the usual shape). See docs/api.md.
 *
 * - ETag / If-Match (E13-12): one record (GET, POST, PATCH) answers with `ETag`. A PATCH or DELETE
 *   that sends `If-Match` is refused with 409 `version_conflict` when the record has changed since.
 *   Without the header nothing changes, so the web application is unaffected. Writes to one
 *   record are taken one at a time in this process, so the check and the write cannot interleave.
 * - Idempotency-Key (E13-13): a create (POST to a record type's path) with this header is stored
 *   for 24 hours; repeating it with the same key and body replays the first answer
 *   (`Idempotent-Replayed: true`) instead of creating a second record. The same key with a
 *   different body is refused (422 `idempotency_key_reused`); while the first is still running,
 *   409 `idempotency_in_progress`.
 * - Paging (E13-15): an answer `{ rows, total, page, pageSize }` carries `Link` (first, prev,
 *   next, last) and `X-Total-Count`.
 * - Rate limits (E13-16): requests made with a token carry `RateLimit-Limit`, `RateLimit-Remaining`,
 *   `RateLimit-Reset` and `RateLimit-Policy`; a 429 also carries `Retry-After`.
 * - Errors: an error answer that does not use the envelope `{ error: { code, message } }` gets one.
 */

declare module 'fastify' {
  interface FastifyRequest {
    /** Set while a create with an Idempotency-Key is running: the stored key's row id. */
    idempotencyRow: string | null;
    /** Set while this request holds the write lock on one record. */
    recordLock: (() => void) | null;
  }
}

interface Deps {
  res: ReturnType<typeof makeResources>;
  settings: ReturnType<typeof makeSettings>;
}
type Kind = 'list' | 'create' | 'get' | 'update' | 'delete';

const here = dirname(fileURLToPath(import.meta.url));
const stores = new WeakMap<FastifyInstance, Db>();
const KEY_RE = /^[\x21-\x7e]{1,255}$/;
const KEY_HOURS = 24;

/** Gives the conventions their database (idempotency keys) and applies their migrations. Called from core/routes.ts. */
export function registerApiStore(app: FastifyInstance, db: Db): void {
  stores.set(app, db);
  app.addHook('onReady', async () => {
    await migrate(db, [{ scope: 'core.api', dir: join(here, 'migrations') }]);
  });
}

/** A strong validator for one record: changes whenever the record is updated. */
export function etagOf(id: string, updatedAt: unknown): string {
  const ms = updatedAt instanceof Date ? updatedAt.getTime() : new Date(String(updatedAt)).getTime();
  return `"${createHash('sha256').update(`${id}:${ms}`).digest('base64url').slice(0, 22)}"`;
}

/**
 * Whether an If-Match header value accepts the current ETag: `*`, or one of a comma-separated
 * list. `W/` and the quotes are ignored (some shells and clients drop the quotes).
 */
export function ifMatchAccepts(header: string, current: string): boolean {
  const bare = (s: string) => s.trim().replace(/^W\//, '').replace(/^"(.*)"$/, '$1');
  return header.split(',').map(bare).some((t) => t === '*' || t === bare(current));
}

/** A Link header value for a page of a list, from the url the caller used. */
export function pageLinks(url: string, page: number, pageSize: number, total: number): string {
  const last = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const [path, query = ''] = url.split('?');
  const at = (p: number) => {
    const params = new URLSearchParams(query);
    params.set('page', String(p));
    params.set('pageSize', String(pageSize));
    return `<${path}?${params.toString()}>`;
  };
  const links = [`${at(1)}; rel="first"`];
  if (page > 1) links.push(`${at(Math.min(page - 1, last))}; rel="prev"`);
  if (page < last) links.push(`${at(page + 1)}; rel="next"`);
  links.push(`${at(last)}; rel="last"`);
  return links.join(', ');
}

export function installConventions(app: FastifyInstance) {
  let deps: Deps | null = null;
  let routes: Map<string, { def: ResourceDef; kind: Kind }> | null = null;
  const locks = new Map<string, Promise<void>>();
  const windows = new Map<string, { minute: number; count: number }>();

  app.decorateRequest('idempotencyRow', null);
  app.decorateRequest('recordLock', null);

  /** The generated record route a request is on, if any. */
  function recordRoute(req: FastifyRequest) {
    if (!deps || !req.routeOptions?.url) return undefined;
    if (!routes) {
      routes = new Map();
      for (const def of deps.res.registry.all()) {
        routes.set(`GET ${def.path}`, { def, kind: 'list' });
        routes.set(`POST ${def.path}`, { def, kind: 'create' });
        routes.set(`GET ${def.path}/:id`, { def, kind: 'get' });
        routes.set(`PATCH ${def.path}/:id`, { def, kind: 'update' });
        routes.set(`DELETE ${def.path}/:id`, { def, kind: 'delete' });
      }
    }
    return routes.get(`${req.method} ${unversioned(req.routeOptions.url)}`);
  }

  async function lock(key: string): Promise<() => void> {
    while (locks.has(key)) await locks.get(key);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    locks.set(key, held);
    const timer = setTimeout(() => done(), 60_000); // never hold a record longer than a minute
    let freed = false;
    function done() {
      if (freed) return;
      freed = true;
      clearTimeout(timer);
      locks.delete(key);
      release();
    }
    return done;
  }

  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    const route = recordRoute(req);
    if (!route || !deps || !req.user) return;
    const { def, kind } = route;
    const { res } = deps;

    if (kind === 'update' || kind === 'delete') {
      const id = String((req.params as Row).id ?? '');
      req.recordLock = await lock(`${def.type}:${id}`);
      const ifMatch = req.headers['if-match'];
      if (typeof ifMatch !== 'string' || !res.mayAccess(req.user, def, kind === 'update' ? 'edit' : 'delete')) return;
      const row = await res.registry.find(def.type, id, req.user).catch(() => undefined);
      if (!row) return; // the route answers 404
      const current = etagOf(row.id, row.updated_at);
      if (!ifMatchAccepts(ifMatch, current)) {
        reply.header('etag', current);
        throw new ApiError(409, 'version_conflict', `This ${def.label.toLowerCase()} has changed since you read it. Fetch it again, then reapply your change.`);
      }
      return;
    }

    if (kind === 'create') {
      const key = req.headers['idempotency-key'];
      if (key === undefined) return;
      const db = stores.get(app);
      if (!db || !res.mayAccess(req.user, def, 'create')) return;
      if (typeof key !== 'string' || !KEY_RE.test(key)) {
        throw new ApiError(400, 'bad_idempotency_key', 'Idempotency-Key must be 1 to 255 visible characters, for example a UUID.');
      }
      const owner = `${req.user.id}:${req.apiToken?.id ?? 'session'}`;
      const path = unversioned(req.routeOptions.url!);
      const fingerprint = createHash('sha256').update(`${req.method} ${path} ${JSON.stringify(req.body ?? {})}`).digest('hex');
      await db.query('delete from api_idempotency_keys where expires_at < now()');
      const made = await db.one<{ id: string }>(
        `insert into api_idempotency_keys (owner, key, method, path, fingerprint, record_type, expires_at)
         values ($1, $2, $3, $4, $5, $6, now() + make_interval(hours => $7::int))
         on conflict (owner, key) do nothing returning id`,
        [owner, key, req.method, path, fingerprint, def.type, KEY_HOURS],
      );
      if (made) {
        req.idempotencyRow = made.id;
        return;
      }
      const prior = await db.one<Row>('select * from api_idempotency_keys where owner = $1 and key = $2', [owner, key]);
      if (!prior) throw new ApiError(409, 'idempotency_in_progress', 'A request with this Idempotency-Key is still being handled. Try again shortly.');
      if (prior.fingerprint !== fingerprint) {
        throw new ApiError(422, 'idempotency_key_reused', 'This Idempotency-Key was already used for a different request. Use a new key for a new request.');
      }
      if (prior.status === null) throw new ApiError(409, 'idempotency_in_progress', 'A request with this Idempotency-Key is still being handled. Try again shortly.');
      reply.code(prior.status).header('idempotent-replayed', 'true').type(prior.content_type ?? 'application/json; charset=utf-8');
      return reply.send(prior.body);
    }
  });

  // Paging links, ETags, and the error envelope: on the answer object, before it is serialised.
  app.addHook('preSerialization', async (req: FastifyRequest, reply: FastifyReply, payload: unknown) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
    const body = payload as Row;
    const status = reply.statusCode;
    // Only API answers (req.url is already unversioned): /mcp, static files and the rest keep their own shape.
    if (!(req.url === '/api' || req.url.startsWith('/api/') || req.url.startsWith('/api?'))) return payload;
    if (status >= 400) {
      const e = body.error;
      if (e && typeof e === 'object' && typeof e.code === 'string') return payload;
      return {
        ...body,
        error: {
          code: typeof body.code === 'string' ? body.code : `http_${status}`,
          message: typeof e === 'string' ? e : typeof body.message === 'string' ? body.message : 'The request could not be completed.',
        },
      };
    }
    if (req.method === 'GET' && Array.isArray(body.rows) && [body.total, body.page, body.pageSize].every((n) => Number.isInteger(n))) {
      reply.header('link', pageLinks(req.originalUrl, body.page, body.pageSize, body.total));
      reply.header('x-total-count', String(body.total));
    }
    const route = recordRoute(req);
    if (route && ['get', 'create', 'update'].includes(route.kind) && typeof body.id === 'string' && body.updated_at) {
      reply.header('etag', etagOf(body.id, body.updated_at));
    }
    return payload;
  });

  // Rate-limit headers on token requests, and storing an idempotent create's answer.
  app.addHook('onSend', async (req: FastifyRequest, reply: FastifyReply, payload: unknown) => {
    if (deps && (req.apiToken || (reply.statusCode === 429 && /^Bearer\s/i.test(req.headers.authorization ?? '')))) {
      const limit = Math.max(1, Number(await deps.settings.get('tokens.rate_per_minute', 600)) || 600);
      const now = Date.now();
      const minute = Math.floor(now / 60_000);
      const reset = Math.max(1, Math.ceil(((minute + 1) * 60_000 - now) / 1000));
      let used = limit;
      if (req.apiToken) {
        const w = windows.get(req.apiToken.id);
        if (!w || w.minute !== minute) windows.set(req.apiToken.id, { minute, count: 1 });
        else w.count += 1;
        used = windows.get(req.apiToken.id)!.count;
        if (windows.size > 5000) for (const [k, v] of windows) if (v.minute !== minute) windows.delete(k);
      }
      reply.header('ratelimit-limit', String(limit));
      reply.header('ratelimit-remaining', String(Math.max(0, limit - used)));
      reply.header('ratelimit-reset', String(reset));
      reply.header('ratelimit-policy', `${limit};w=60`);
      if (reply.statusCode === 429) reply.header('retry-after', String(reset));
    }

    if (req.idempotencyRow) {
      const db = stores.get(app);
      const id = req.idempotencyRow;
      req.idempotencyRow = null;
      if (db) {
        if (reply.statusCode >= 200 && reply.statusCode < 300 && typeof payload === 'string') {
          let recordId: string | null = null;
          try { recordId = JSON.parse(payload)?.id ?? null; } catch { /* not JSON */ }
          await db.query(
            'update api_idempotency_keys set status = $2, content_type = $3, body = $4, record_id = $5 where id = $1',
            [id, reply.statusCode, String(reply.getHeader('content-type') ?? 'application/json; charset=utf-8'), payload, recordId],
          );
        } else {
          // A refusal is not remembered: the client may correct the request and send the same key again.
          await db.query('delete from api_idempotency_keys where id = $1', [id]);
        }
      }
    }
    return payload;
  });

  const unlock = async (req: FastifyRequest) => {
    req.recordLock?.();
    req.recordLock = null;
    // A create that never answered (the caller went away) must not hold its key for a day.
    if (req.idempotencyRow) {
      const id = req.idempotencyRow;
      req.idempotencyRow = null;
      await stores.get(app)?.query('delete from api_idempotency_keys where id = $1 and status is null', [id]).catch(() => undefined);
    }
  };
  app.addHook('onResponse', unlock);
  app.addHook('onRequestAbort', unlock);

  return {
    attach(d: Deps) { deps = d; },
  };
}
