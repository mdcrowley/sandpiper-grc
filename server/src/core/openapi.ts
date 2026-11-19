import type { FastifyInstance } from 'fastify';
import { installConventions } from './api/conventions.ts';
import { commonErrors, jsonResponse, publicErrors, ref, resourceOperations, resourceSchemas, sharedComponents } from './api/schemas.ts';
import { looseShape } from './api/shape.ts';
import { deprecationFor, installVersioning, isVersioned, V1, versioned } from './api/versioning.ts';
import { DEFAULT_APP_NAME } from './config.ts';
import type { CustomFields } from './customfields.ts';
import type { FieldDef, RouteDoc, SessionUser } from './module.ts';
import type { makeResources } from './resource.ts';
import { can, type makeSettings } from './services.ts';

/**
 * The OpenAPI 3.1 description of the API (E13-05), served at GET /api/openapi.json, and at
 * GET /api/v1/openapi.json with every path under the stable base path /api/v1 (E13-11).
 *
 * It is built on request from what is actually registered, so it cannot drift from the code:
 *  - every record type in the resource registry gives its six generated routes, with field
 *    schemas (custom fields included), filters, sorting, paging, exports and the conventions of
 *    core/api/conventions.ts (ETag / If-Match, Idempotency-Key, paging links);
 *  - every other route Fastify knows about is listed too, with the description its module gave
 *    through `ctx.describeRoute(...)` or the central tables in core/api/docs, or marked
 *    `x-undocumented` when there is none (core/api/coverage.test.ts keeps that list empty).
 * The document is cut down to what the caller may use: record types they cannot view and routes
 * whose stated permission they lack are left out.
 *
 * makeOpenApi also installs, before any route exists, the versioned alias of every route and the
 * request id (core/api/versioning.ts) and the integrator conventions (core/api/conventions.ts).
 */

interface Registered { method: string; url: string; public: boolean; origin: 'core' | 'module' }
type Json = Record<string, unknown>;

interface Deps {
  res: ReturnType<typeof makeResources>;
  custom: CustomFields;
  settings: ReturnType<typeof makeSettings>;
}

export interface BuildOptions {
  /** 'v1': every path under /api/v1 (the stable base path for integrators). Default: /api. */
  version?: 'v1' | null;
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const key = (method: string, url: string) => `${method.toUpperCase()} ${url}`;
/** '/api/x/:id/y' -> '/api/x/{id}/y' with its parameter names. */
function openApiPath(url: string): { path: string; params: string[] } {
  const params: string[] = [];
  const path = url.replace(/:([A-Za-z0-9_]+)/g, (_m, name) => { params.push(name); return `{${name}}`; }).replace(/\*/g, () => { params.push('path'); return '{path}'; });
  return { path, params };
}
/** 'GET', '/api/tickets/:id/sla' -> 'get_tickets_id_sla'. */
const operationId = (method: string, url: string) =>
  `${method.toLowerCase()}_${url.replace(/^\/api\//, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;

/** A described body or answer: a JSON Schema, the shape notation, or free text. */
function describedSchema(v: Json | string | undefined, fallback: string): Json {
  if (v === undefined) return { description: fallback };
  if (typeof v !== 'string') return v;
  const parsed = looseShape(v);
  return parsed ? { ...parsed, description: v } : { description: v };
}

/** Replaces `x-resource: <type>` (from `@type` in the shape notation) with a reference, or a plain record. */
function resolveRecords(schema: unknown, has: (type: string) => string | null): unknown {
  if (Array.isArray(schema)) return schema.map((s) => resolveRecords(s, has));
  if (!schema || typeof schema !== 'object') return schema;
  const s = schema as Json;
  if (typeof s['x-resource'] === 'string') {
    const name = has(s['x-resource']);
    const { 'x-resource': type, ...rest } = s;
    return name ? { ...rest, ...ref(name) } : { ...rest, ...ref('Record'), description: `A ${String(type).replace(/_/g, ' ')} record.` };
  }
  return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, resolveRecords(v, has)]));
}

export function makeOpenApi(app: FastifyInstance) {
  const routes: Registered[] = [];
  const docs = new Map<string, RouteDoc>();
  let origin: Registered['origin'] = 'core';
  let deps: Deps | null = null;

  // /api/v1 aliases and the request id, then the integrator conventions. Before any route.
  installVersioning(app);
  const conventions = installConventions(app);

  // Every route, as it is registered. Must be installed before any route is.
  app.addHook('onRoute', (r) => {
    if (!r.url.startsWith('/api/') || isVersioned(r.url)) return;
    for (const m of Array.isArray(r.method) ? r.method : [r.method]) {
      const method = String(m).toUpperCase();
      if (!METHODS.includes(method) || routes.some((x) => x.method === method && x.url === r.url)) continue;
      routes.push({ method, url: r.url, public: Boolean((r.config as { public?: boolean } | undefined)?.public), origin });
    }
  });

  function describe(doc: RouteDoc): void {
    docs.set(key(doc.method, doc.path), doc);
  }

  /** The document for one caller; `null` builds it whole (the openapi-cli command). */
  async function build(user: SessionUser | null, opts: BuildOptions = {}): Promise<Json> {
    if (!deps) throw new Error('OpenAPI: not attached');
    const { res, custom, settings } = deps;
    const allowed = (perm: string | undefined) => !perm || !user || can(user, perm);
    const defs = res.registry.all().filter((d) => !user || res.mayAccess(user, d, 'view'));
    const hidden = res.registry.all().filter((d) => !defs.includes(d));

    const shared = sharedComponents();
    const schemas: Json = { ...shared.schemas };
    const paths: Record<string, Json> = {};
    const tags = new Map<string, string>();
    const generated = new Set<string>();
    const put = (method: string, url: string, op: Json) => {
      const { path, params } = openApiPath(url);
      const existing = (op.parameters as Json[] | undefined) ?? [];
      op.parameters = [...params.map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } })), ...existing];
      if (!(op.parameters as Json[]).length) delete op.parameters;
      const dep = deprecationFor(method, url);
      if (dep) {
        op.deprecated = true;
        op.description = [op.description, `**Deprecated** since ${dep.since}${dep.sunset ? `; may stop working after ${dep.sunset}` : ''}. ${dep.notice}`].filter(Boolean).join('\n\n');
      }
      (paths[path] ??= {})[method.toLowerCase()] = op;
    };

    for (const d of defs) {
      const fields: Record<string, FieldDef> = { ...d.fields, ...(await custom.defs(d.type)) };
      tags.set(d.plural, `${d.label} records (permission module \`${d.module}\`${d.restricted === true ? '; restricted: also needs `security.view`' : d.restricted === 'flag' ? '; rows flagged restricted also need `security.view`' : ''}).`);
      Object.assign(schemas, resourceSchemas(d, fields));
      for (const [method, url, op] of resourceOperations(d, fields)) {
        generated.add(key(method, url));
        put(method, url, op);
      }
    }
    // Generated routes of types the caller cannot view are not "undocumented": they are simply left out.
    for (const d of hidden) {
      for (const [m, u] of [['GET', d.path], ['GET', `${d.path}/stats`], ['GET', `${d.path}/:id`], ['POST', d.path], ['PATCH', `${d.path}/:id`], ['DELETE', `${d.path}/:id`]]) generated.add(key(m, u));
    }
    const recordSchema = (type: string) => {
      const d = defs.find((x) => x.type === type);
      return d ? d.type.split('_').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('') : null;
    };

    for (const r of routes) {
      if (generated.has(key(r.method, r.url))) continue;
      const doc = docs.get(key(r.method, r.url));
      // A route under a record type's path belongs to that type; one under /api/admin to administrators.
      const owner = res.registry.all().filter((d) => r.url === d.path || r.url.startsWith(`${d.path}/`)).sort((a, b) => b.path.length - a.path.length)[0];
      if (owner && hidden.includes(owner)) continue;
      if (doc ? !allowed(doc.permission) : r.url.startsWith('/api/admin/') && !allowed('admin.administer')) continue;
      const tag = doc?.tag ?? owner?.plural ?? (r.url.split('/')[2] ?? 'api').replace(/^./, (c) => c.toUpperCase());
      if (!tags.has(tag)) tags.set(tag, '');
      const isPublic = doc?.public ?? r.public;
      const answer = resolveRecords(describedSchema(doc?.response, 'See the module documentation.'), recordSchema) as Json;
      const { 'x-status': status, 'x-content-type': media, ...answerSchema } = answer;
      const op: Json = {
        tags: [tag],
        summary: doc?.summary ?? `${r.method} ${r.url}`,
        operationId: operationId(r.method, r.url),
        ...(doc?.description ? { description: doc.description } : {}),
        ...(doc?.permission ? { 'x-permission': doc.permission } : {}),
        ...(doc ? {} : { 'x-undocumented': true }),
        ...(isPublic ? { security: [] } : {}),
        parameters: Object.entries(doc?.query ?? {}).map(([name, v]) => ({
          name, in: 'query', schema: typeof v === 'string' ? { type: 'string' } : v,
          ...(typeof v === 'string' ? { description: v } : typeof v.description === 'string' ? { description: v.description } : {}),
        })),
        ...(doc?.body !== undefined ? { requestBody: { content: { 'application/json': { schema: resolveRecords(describedSchema(doc.body, ''), recordSchema) } } } } : {}),
        responses: {
          [typeof status === 'number' ? status : r.method === 'POST' && doc?.response === undefined ? 'default' : 200]: media
            ? { ...jsonResponse({}), content: { [String(media)]: { schema: answerSchema } } }
            : jsonResponse(answerSchema),
          ...(isPublic ? publicErrors : commonErrors),
        },
      };
      put(r.method, r.url, op);
    }

    const v1 = opts.version === 'v1';
    const ordered = Object.entries(paths).sort(([a], [b]) => a.localeCompare(b)).map(([p, ops]) => [v1 ? versioned(p) : p, ops] as const);
    return {
      openapi: '3.1.0',
      info: {
        title: `${await settings.get('app.name', DEFAULT_APP_NAME)} API`,
        version: '1',
        description: [
          'Generated from the running application: record types come from the resource registry, other routes from the modules that registered them.',
          'This copy lists what the caller may use.',
          '',
          `**Base path and versioning.** Integrations use \`${V1}/...\`, the stable version 1 of the API: within v1 changes are additive only (new routes, new optional parameters, new members in answers). Anything to be removed is announced first with a \`Deprecation\` header and marked deprecated here. The same routes are also served under \`/api/...\` for the web application.`,
          '',
          '**Authentication.** Either a personal access token (`Authorization: Bearer grc_pat_...`, created under Account security; it acts as its owner, limited to the token\'s scopes) or a browser session (cookie `grc_session`). With a session, every request that changes data must also carry the header `X-GRC-CSRF: 1`; with a token it need not.',
          '',
          '**Errors.** `{ "error": { "code", "message", "fields"? } }` with a matching HTTP status. Every answer carries `X-Request-Id`.',
          '',
          '**Conventions.** Lists page with `page` and `pageSize` and answer with `Link` and `X-Total-Count`; one record answers with an `ETag` that `If-Match` on PATCH and DELETE checks (409 `version_conflict`); a create accepts `Idempotency-Key`; token requests carry `RateLimit-*` headers.',
          '',
          '**Restricted records.** Records of restricted types, and records flagged restricted, are invisible without `security.view`: they are absent from lists, counts, search, links and exports, and answer 404 by id.',
        ].join('\n'),
      },
      servers: [{ url: '/', description: 'This installation' }],
      security: [{ bearerToken: [] }, { session: [], csrfHeader: [] }],
      tags: [...tags.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, description]) => ({ name, ...(description ? { description } : {}) })),
      paths: Object.fromEntries(ordered),
      components: {
        securitySchemes: {
          bearerToken: { type: 'http', scheme: 'bearer', description: 'A personal access token.' },
          session: { type: 'apiKey', in: 'cookie', name: 'grc_session', description: 'Browser session, set by POST /api/auth/login.' },
          csrfHeader: { type: 'apiKey', in: 'header', name: 'X-GRC-CSRF', description: 'Send `1` on every request that changes data when using a session.' },
        },
        schemas,
        headers: shared.headers,
        parameters: shared.parameters,
      },
      ...(v1 ? { 'x-api-version': 'v1' } : {}),
    };
  }

  return {
    describe,
    build,
    /** Every /api route registered so far (unversioned), with where it came from. */
    routes: () => [...routes],
    /** Whether a route was described with describeRoute or a central table. */
    described: (method: string, url: string) => docs.has(key(method, url)),
    /** Routes registered from now on belong to modules. */
    modulesFromHere() { origin = 'module'; },
    /** Supplies the registry and registers GET /api/openapi.json (and so /api/v1/openapi.json). */
    attach(d: Deps) {
      deps = d;
      conventions.attach({ res: d.res, settings: d.settings });
      app.get('/api/openapi.json', async (req) => build(req.user, { version: req.apiVersion }));
    },
  };
}

export type OpenApi = ReturnType<typeof makeOpenApi>;
