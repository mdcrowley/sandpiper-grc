import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { FastifyInstance, FastifyRequest, RouteOptions } from 'fastify';
import { ApiError } from '../errors.ts';
import { DEPRECATIONS, type Deprecation } from './deprecations.ts';

/**
 * The stable, versioned base path for integrators (E13-11), one canonical request path, and the
 * request id (E13-14).
 *
 * Every route registered under `/api/...` is also served at `/api/v1/...`. This is done once, for
 * every route core and the modules register, **before routing**: `canonicalRequestUrl` is the web
 * server's `rewriteUrl` (see `buildApp` in app.ts), so `/api/v1/x` is routed as `/api/x`. There is
 * one route per handler, and everything that looks at the request - `req.url` and the matched route
 * pattern `req.routeOptions.url` alike (authentication, token rules, feature switches, module hooks,
 * audit summaries) - sees the same thing whichever form the caller used. `req.apiVersion` says
 * which it was; `req.originalUrl` keeps what was sent.
 *
 * The same step refuses (400 `bad_path`) a path the router would read differently from how it is
 * written (wave 9, SA-1): a percent-encoded letter, digit or `-._~` (`/%61pi/...` is routed as
 * `/api/...`), an encoded `/` or `\`, a malformed escape, `.` or `..` segments, or a target that
 * does not start with `/`. Browsers and HTTP libraries never send these, so nothing legitimate is
 * lost, and no check made on the request's path can be steered past by spelling.
 *
 * Compatibility promise for v1 (docs/api.md): only additive changes (new routes, new optional
 * parameters, new members in answers); anything removed or changed is first announced with a
 * `Deprecation` header (and `Sunset` when a date is set) on the affected route, and listed in
 * the OpenAPI document with `deprecated: true`.
 */

export const API_VERSION = '1';
export const V1 = '/api/v1';

declare module 'fastify' {
  interface FastifyRequest {
    /** The request id: the caller's `X-Request-Id` when it is sensible, otherwise a new UUID. Sent back on every answer. */
    requestId: string;
    /** 'v1' when the caller used the versioned path `/api/v1/...`, otherwise null. */
    apiVersion: 'v1' | null;
  }
}

/** True for `/api/v1`, `/api/v1/...` and `/api/v1?...`. */
export const isVersioned = (url: string) => url === V1 || url.startsWith(`${V1}/`) || url.startsWith(`${V1}?`);

/** `/api/v1/tickets?q=x` -> `/api/tickets?q=x`; other urls unchanged. */
export const unversioned = (url: string) => (isVersioned(url) ? `/api${url.slice(V1.length)}` : url);

/** `/api/tickets` -> `/api/v1/tickets`; urls outside /api unchanged. */
export const versioned = (url: string) => (url.startsWith('/api/') && !isVersioned(url) ? `${V1}${url.slice(4)}` : url);

const REQUEST_ID = /^[A-Za-z0-9._:@-]{1,128}$/;
/** RFC 3986 unreserved characters: encoding one changes nothing, so no client does it. */
const UNRESERVED = /^[A-Za-z0-9._~-]$/;

/**
 * Why a request target is refused before routing, or null when it is fine. Only the path is looked
 * at (up to `?` or `#`); query strings may hold anything.
 */
export function pathProblem(rawUrl: string): string | null {
  if (!rawUrl.startsWith('/')) return 'The request path must start with "/".';
  const cut = rawUrl.search(/[?#]/);
  const path = cut === -1 ? rawUrl : rawUrl.slice(0, cut);
  for (let i = path.indexOf('%'); i !== -1; i = path.indexOf('%', i + 1)) {
    const hex = path.slice(i + 1, i + 3);
    if (!/^[0-9A-Fa-f]{2}$/.test(hex)) return 'The request path holds a malformed percent escape.';
    const ch = String.fromCharCode(parseInt(hex, 16));
    if (UNRESERVED.test(ch) || ch === '/' || ch === '\\') return 'The request path encodes a character that must be sent as it is.';
  }
  if (path.split('/').some((s) => s === '.' || s === '..')) return 'The request path holds a "." or ".." segment.';
  return null;
}

/** What `canonicalRequestUrl` leaves on the raw request for the hooks after routing. */
interface Marked { grcCanonical?: true; grcVersion?: 'v1'; grcRefused?: string }

/** Routed to when a path is refused: no route has it, so only the global hooks run (and refuse it). */
const REFUSED_PATH = '/.refused-path';

/**
 * The web server's `rewriteUrl` (Fastify option): runs before routing. Refuses a path that would be
 * routed differently from how it is written, and routes `/api/v1/x` as `/api/x`.
 */
export function canonicalRequestUrl(req: IncomingMessage): string {
  const raw = req.url ?? '/';
  const marked = req as IncomingMessage & Marked;
  marked.grcCanonical = true;
  const problem = pathProblem(raw);
  if (problem) {
    marked.grcRefused = problem;
    return REFUSED_PATH;
  }
  if (isVersioned(raw)) {
    marked.grcVersion = 'v1';
    return unversioned(raw);
  }
  return raw;
}

/**
 * The route a request matched, as registered and unversioned; for a renamed route's deprecated
 * alias, the route it stands for. Empty when no route matched. Guards that decide by route use this.
 */
export function routePattern(req: FastifyRequest): string {
  const url = req.routeOptions?.url;
  if (!url) return '';
  const plain = unversioned(url);
  const dep = DEPRECATIONS.find((d) => d.replacement && d.path === plain && d.method === req.method.toUpperCase());
  return dep?.replacement ?? plain;
}

/** True when a request is for the API: by its path or by the route it matched. */
export const isApiRequest = (req: FastifyRequest) =>
  req.url === '/api' || req.url.startsWith('/api/') || req.url.startsWith('/api?') || routePattern(req).startsWith('/api/');

/** Must run before any route is registered and before any other onRequest hook. */
export function installVersioning(app: FastifyInstance): void {
  app.decorateRequest('requestId', '');
  app.decorateRequest('apiVersion', null);

  // A renamed route is also served at its old, deprecated path. (/api/v1 needs no route of its own:
  // canonicalRequestUrl routes it to the plain path.)
  app.addHook('onRoute', function alias(this: FastifyInstance, opts: RouteOptions & { prefix?: string }) {
    const url = opts.url ?? '';
    if (!url.startsWith('/api/') || isVersioned(url)) return;
    const methods = (Array.isArray(opts.method) ? opts.method : [opts.method]).filter((m) => String(m).toUpperCase() !== 'HEAD');
    if (!methods.length) return; // HEAD routes come with their GET route
    // Inside a plugin with a prefix the url cannot be expressed relative to it: use the root instead.
    const owner = opts.prefix ? app : this;
    for (const dep of DEPRECATIONS) {
      if (dep.replacement !== url || !methods.some((m) => String(m).toUpperCase() === dep.method)) continue;
      owner.route({ ...opts, method: dep.method, url: dep.path, path: dep.path } as RouteOptions);
    }
  });

  app.addHook('onRequest', async (req, reply) => {
    const given = req.headers['x-request-id'];
    req.requestId = typeof given === 'string' && REQUEST_ID.test(given) ? given : randomUUID();
    reply.header('x-request-id', req.requestId);
    const marked = req.raw as IncomingMessage & Marked;
    // Fail closed: a server built without the rewrite would route /api/v1 and encoded paths unchecked.
    if (!marked.grcCanonical) throw new Error('The web server must be built with rewriteUrl: canonicalRequestUrl (core/api/versioning.ts).');
    if (marked.grcRefused) throw new ApiError(400, 'bad_path', marked.grcRefused);
    if (marked.grcVersion) {
      req.apiVersion = 'v1';
      reply.header('api-version', API_VERSION);
    }
  });

  // Announced deprecations (core/api/deprecations.ts).
  app.addHook('onSend', async (req, reply) => {
    const dep = deprecationFor(req.method, req.routeOptions?.url);
    if (!dep) return;
    reply.header('deprecation', `@${Math.floor(new Date(dep.since).getTime() / 1000)}`);
    if (dep.sunset) reply.header('sunset', new Date(dep.sunset).toUTCString());
    if (dep.link) reply.header('link', [reply.getHeader('link'), `<${dep.link}>; rel="deprecation"`].filter(Boolean).join(', '));
  });
}

/** The deprecation announced for a route (as registered, either form), if any. */
export function deprecationFor(method: string, routeUrl: string | undefined): Deprecation | undefined {
  if (!routeUrl) return undefined;
  const url = unversioned(routeUrl);
  return DEPRECATIONS.find((d) => d.method === method.toUpperCase() && d.path === url);
}
