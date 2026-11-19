import { randomUUID } from 'node:crypto';
import type { FastifyInstance, RouteOptions } from 'fastify';
import { DEPRECATIONS, type Deprecation } from './deprecations.ts';

/**
 * The stable, versioned base path for integrators (E13-11), and the request id (E13-14).
 *
 * Every route registered under `/api/...` is also served at `/api/v1/...`. This is done once,
 * here, for every route core and the modules register: an `onRoute` hook registers the same
 * route (handler, hooks, options and plugin scope) at the versioned path, and an `onRequest`
 * hook - installed before any other - turns `/api/v1/x` back into `/api/x` on the request, so
 * that everything that looks at `req.url` (authentication, token rules, module hooks, audit
 * summaries) sees one path whichever form the caller used. `req.apiVersion` says which it was.
 * The web application keeps using `/api/...`.
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

/** Must run before any route is registered and before any other onRequest hook. */
export function installVersioning(app: FastifyInstance): void {
  app.decorateRequest('requestId', '');
  app.decorateRequest('apiVersion', null);

  app.addHook('onRoute', function alias(this: FastifyInstance, opts: RouteOptions & { prefix?: string }) {
    const url = opts.url ?? '';
    if (!url.startsWith('/api/') || isVersioned(url)) return;
    const methods = (Array.isArray(opts.method) ? opts.method : [opts.method]).filter((m) => String(m).toUpperCase() !== 'HEAD');
    if (!methods.length) return; // HEAD routes come with their GET route
    const target = versioned(url);
    // Inside a plugin with a prefix the url cannot be expressed relative to it: use the root instead.
    const owner = opts.prefix ? app : this;
    owner.route({ ...opts, method: methods.length === 1 ? methods[0] : methods, url: target, path: target } as RouteOptions);
  });

  app.addHook('onRequest', async (req, reply) => {
    const given = req.headers['x-request-id'];
    req.requestId = typeof given === 'string' && REQUEST_ID.test(given) ? given : randomUUID();
    reply.header('x-request-id', req.requestId);
    const raw = req.raw.url ?? '';
    if (isVersioned(raw)) {
      (req.raw as { originalUrl?: string }).originalUrl = raw;
      req.raw.url = unversioned(raw);
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
