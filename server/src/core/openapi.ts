import type { FastifyInstance } from 'fastify';
import { DEFAULT_APP_NAME } from './config.ts';
import type { CustomFields } from './customfields.ts';
import type { FieldDef, ResourceDef, RouteDoc, SessionUser } from './module.ts';
import type { makeResources } from './resource.ts';
import { can, type makeSettings } from './services.ts';

/**
 * The OpenAPI 3.1 description of the API (E13-05), served at GET /api/openapi.json.
 *
 * It is built on request from what is actually registered, so it cannot drift from the code:
 *  - every record type in the resource registry gives its six generated routes, with field
 *    schemas (custom fields included), filters, sorting and paging;
 *  - every other route Fastify knows about is listed too, with the description its module gave
 *    through `ctx.describeRoute(...)`, or marked `x-undocumented` when it gave none.
 * The document is cut down to what the caller may use: record types they cannot view and routes
 * whose stated permission they lack are left out.
 */

interface Registered { method: string; url: string; public: boolean; origin: 'core' | 'module' }
type Json = Record<string, unknown>;

interface Deps {
  res: ReturnType<typeof makeResources>;
  custom: CustomFields;
  settings: ReturnType<typeof makeSettings>;
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const key = (method: string, url: string) => `${method.toUpperCase()} ${url}`;
const pascal = (type: string) => type.split('_').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
/** '/api/x/:id/y' -> '/api/x/{id}/y' with its parameter names. */
function openApiPath(url: string): { path: string; params: string[] } {
  const params: string[] = [];
  const path = url.replace(/:([A-Za-z0-9_]+)/g, (_m, name) => { params.push(name); return `{${name}}`; }).replace(/\*/g, () => { params.push('path'); return '{path}'; });
  return { path, params };
}
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const nullable = (schema: Json): Json => ({ ...schema, type: [schema.type as string, 'null'] });

function fieldSchema(f: FieldDef): Json {
  const note = (extra: Json = {}): Json => ({ title: f.label, ...(f.help ? { description: f.help } : {}), ...(f.custom ? { 'x-custom': true } : {}), ...extra });
  if (f.multiple) return note({ type: ['array', 'null'], items: { type: 'string' }, 'x-list': f.list });
  switch (f.type) {
    case 'number': case 'currency': return note(nullable({ type: 'number', ...(f.type === 'currency' ? { 'x-currency': true } : {}) }));
    case 'date': return note(nullable({ type: 'string', format: 'date' }));
    case 'datetime': return note(nullable({ type: 'string', format: 'date-time' }));
    case 'boolean': return note(nullable({ type: 'boolean' }));
    case 'lookup': return note(nullable({ type: 'string', 'x-list': f.list, description: `${f.help ? `${f.help} ` : ''}A value of the configurable list "${f.list}" (GET /api/lookups/${f.list}).` }));
    case 'user': return note(nullable({ type: 'string', format: 'uuid', 'x-ref': 'user' }));
    case 'ref': return note(nullable({ type: 'string', format: 'uuid', 'x-ref': f.to }));
    case 'json': return note({});
    default: return note(nullable({ type: 'string' }));
  }
}

const asSchema = (v: Json | string | undefined, fallback: string): Json =>
  (v === undefined ? { description: fallback } : typeof v === 'string' ? { description: v } : v);

export function makeOpenApi(app: FastifyInstance) {
  const routes: Registered[] = [];
  const docs = new Map<string, RouteDoc>();
  let origin: Registered['origin'] = 'core';
  let deps: Deps | null = null;

  // Every route, as it is registered. Must be installed before any route is.
  app.addHook('onRoute', (r) => {
    if (!r.url.startsWith('/api/')) return;
    for (const m of Array.isArray(r.method) ? r.method : [r.method]) {
      const method = String(m).toUpperCase();
      if (!METHODS.includes(method) || routes.some((x) => x.method === method && x.url === r.url)) continue;
      routes.push({ method, url: r.url, public: Boolean((r.config as { public?: boolean } | undefined)?.public), origin });
    }
  });

  function describe(doc: RouteDoc): void {
    docs.set(key(doc.method, doc.path), doc);
  }

  /** The document for one caller; `null` builds it whole (the `npm run openapi` command). */
  async function build(user: SessionUser | null): Promise<Json> {
    if (!deps) throw new Error('OpenAPI: not attached');
    const { res, custom, settings } = deps;
    const allowed = (perm: string | undefined) => !perm || !user || can(user, perm);
    const defs = res.registry.all().filter((d) => !user || res.mayAccess(user, d, 'view'));
    const hidden = res.registry.all().filter((d) => !defs.includes(d));

    const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ref('Error') } } });
    const commonErrors = {
      400: errorResponse('The request was not valid. `error.fields` names the fields at fault.'),
      401: errorResponse('Not signed in, or the token is not valid.'),
      403: errorResponse('Not permitted (`forbidden`), security header missing (`csrf`), password confirmation needed (`reauth_required`) or second factor not set up (`mfa_enrolment_required`).'),
      404: errorResponse('Not found, or not visible to the caller.'),
      429: errorResponse('Too many requests.'),
    };
    const json = (schema: Json, description = 'OK') => ({ description, content: { 'application/json': { schema } } });

    const schemas: Json = {
      Error: {
        type: 'object', required: ['error'],
        properties: {
          error: {
            type: 'object', required: ['code', 'message'],
            properties: {
              code: { type: 'string', description: 'Stable machine-readable code, for example `validation`, `forbidden`, `not_found`.' },
              message: { type: 'string', description: 'Plain-English message.' },
              fields: { type: 'object', additionalProperties: { type: 'string' }, description: 'Field name -> problem, on validation errors.' },
            },
          },
        },
      },
      Ok: { type: 'object', properties: { ok: { type: 'boolean' } } },
    };
    const paths: Record<string, Json> = {};
    const tags = new Map<string, string>();
    const generated = new Set<string>();
    const put = (method: string, url: string, op: Json) => {
      const { path, params } = openApiPath(url);
      const existing = (op.parameters as Json[] | undefined) ?? [];
      op.parameters = [...params.map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } })), ...existing];
      if (!(op.parameters as Json[]).length) delete op.parameters;
      (paths[path] ??= {})[method.toLowerCase()] = op;
    };

    for (const d of defs) {
      const name = pascal(d.type);
      const fields: Record<string, FieldDef> = { ...d.fields, ...(await custom.defs(d.type)) };
      const tag = d.plural;
      tags.set(tag, `${d.label} records (permission module \`${d.module}\`${d.restricted === true ? '; restricted: also needs `security.view`' : d.restricted === 'flag' ? '; rows flagged restricted also need `security.view`' : ''}).`);
      const properties: Json = {
        id: { type: 'string', format: 'uuid', readOnly: true },
        ...Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, { ...fieldSchema(f), ...(f.readOnly ? { readOnly: true } : {}) }])),
        created_at: { type: 'string', format: 'date-time', readOnly: true },
        created_by: { type: ['string', 'null'], format: 'uuid', readOnly: true },
        updated_at: { type: 'string', format: 'date-time', readOnly: true },
        updated_by: { type: ['string', 'null'], format: 'uuid', readOnly: true },
        _display: { type: 'object', additionalProperties: { type: 'string' }, readOnly: true, description: 'Labels for user, ref and lookup fields.' },
        _tags: { type: 'array', items: { type: 'string' }, readOnly: true },
      };
      schemas[name] = { type: 'object', title: d.label, properties, additionalProperties: true };
      const writable = Object.entries(fields).filter(([, f]) => !f.readOnly);
      schemas[`${name}Input`] = {
        type: 'object', title: `${d.label} (create or update)`,
        properties: Object.fromEntries(writable.map(([k, f]) => [k, { ...fieldSchema(f), ...(f.default !== undefined ? { default: f.default } : {}) }])),
        required: writable.filter(([, f]) => f.required && f.default === undefined).map(([k]) => k),
      };
      const fieldNames = [...Object.keys(fields), 'created_at', 'updated_at', 'created_by', 'updated_by'];
      const filters: Json[] = [
        { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Search. Full text (whole words, word endings, several words, a prefix for the last word) from three characters; substring below that. Reference numbers match as typed.' },
        ...fieldNames.map((k) => ({
          name: `f.${k}`, in: 'query', schema: { type: 'string' },
          description: `Filter on ${fields[k]?.label ?? k}: any of the comma-separated values${fields[k]?.type === 'user' || k.endsWith('_by') ? ' (`me` = the caller)' : ''}. `
            + `Also \`f.${k}.null=true|false\`${['date', 'datetime', 'number', 'currency'].includes(fields[k]?.type ?? 'datetime') ? `, \`f.${k}.gt\`, \`.gte\`, \`.lt\`, \`.lte\`` : ''}.`,
        })),
        ...(d.fields.tags ? [] : [{ name: 'f.tags', in: 'query', schema: { type: 'string' }, description: 'Records carrying any of these tags (comma-separated). `f.tags.all=` needs every tag; `f.tags.null=true` is untagged.' }]),
      ];
      const x = (action: string) => ({ 'x-permission': `${d.module}.${action}`, ...(d.restricted === true ? { 'x-also-needs': 'security.view' } : {}) });
      const ops: [string, string, Json][] = [
        ['GET', d.path, {
          tags: [tag], summary: `List ${d.plural.toLowerCase()}`, operationId: `list_${d.type}`, ...x('view'),
          description: `\`format=csv\` exports the filtered list instead (needs \`${d.module}.export\`; audited).`,
          parameters: [
            ...filters,
            { name: 'sort', in: 'query', schema: { type: 'string', enum: fieldNames } },
            { name: 'dir', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
            { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 50 } },
            { name: 'format', in: 'query', schema: { type: 'string', enum: ['csv'] } },
          ],
          responses: {
            200: {
              description: 'A page of rows, or a CSV file.',
              content: {
                'application/json': { schema: { type: 'object', required: ['rows', 'total', 'page', 'pageSize'], properties: { rows: { type: 'array', items: ref(name) }, total: { type: 'integer' }, page: { type: 'integer' }, pageSize: { type: 'integer' } } } },
                'text/csv': { schema: { type: 'string' } },
              },
            },
            ...commonErrors,
          },
        }],
        ['GET', `${d.path}/stats`, {
          tags: [tag], summary: `Count ${d.plural.toLowerCase()} by a field`, operationId: `stats_${d.type}`, ...x('view'),
          parameters: [{ name: 'group', in: 'query', required: true, schema: { type: 'string', enum: Object.keys(fields).filter((k) => !fields[k].multiple) } }, ...filters],
          responses: {
            200: json({ type: 'object', properties: { groups: { type: 'array', items: { type: 'object', properties: { value: { type: ['string', 'null'] }, label: { type: 'string' }, color: { type: 'string' }, count: { type: 'integer' } } } }, total: { type: 'integer' } } }),
            ...commonErrors,
          },
        }],
        ['GET', `${d.path}/:id`, { tags: [tag], summary: `Get one ${d.label.toLowerCase()}`, operationId: `get_${d.type}`, ...x('view'), responses: { 200: json(ref(name)), ...commonErrors } }],
        ['POST', d.path, {
          tags: [tag], summary: `Create a ${d.label.toLowerCase()}`, operationId: `create_${d.type}`, ...x('create'),
          requestBody: { required: true, content: { 'application/json': { schema: ref(`${name}Input`) } } },
          responses: { 201: json(ref(name), 'Created'), ...commonErrors },
        }],
        ['PATCH', `${d.path}/:id`, {
          tags: [tag], summary: `Update a ${d.label.toLowerCase()}`, operationId: `update_${d.type}`, ...x('edit'),
          description: 'Partial: send only the fields to change.',
          requestBody: { required: true, content: { 'application/json': { schema: { ...ref(`${name}Input`) } } } },
          responses: { 200: json(ref(name)), ...commonErrors },
        }],
        ['DELETE', `${d.path}/:id`, { tags: [tag], summary: `Delete a ${d.label.toLowerCase()} (soft delete)`, operationId: `delete_${d.type}`, ...x('delete'), responses: { 200: json(ref('Ok')), ...commonErrors } }],
      ];
      for (const [method, url, op] of ops) {
        generated.add(key(method, url));
        put(method, url, op);
      }
    }
    // Generated routes of types the caller cannot view are not "undocumented": they are simply left out.
    for (const d of hidden) {
      for (const [m, u] of [['GET', d.path], ['GET', `${d.path}/stats`], ['GET', `${d.path}/:id`], ['POST', d.path], ['PATCH', `${d.path}/:id`], ['DELETE', `${d.path}/:id`]]) generated.add(key(m, u));
    }

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
      const op: Json = {
        tags: [tag],
        summary: doc?.summary ?? `${r.method} ${r.url}`,
        ...(doc?.description ? { description: doc.description } : {}),
        ...(doc?.permission ? { 'x-permission': doc.permission } : {}),
        ...(doc ? {} : { 'x-undocumented': true }),
        ...(isPublic ? { security: [] } : {}),
        parameters: Object.entries(doc?.query ?? {}).map(([name, v]) => ({
          name, in: 'query', schema: typeof v === 'string' ? { type: 'string' } : v, ...(typeof v === 'string' ? { description: v } : {}),
        })),
        ...(doc?.body !== undefined ? { requestBody: { content: { 'application/json': { schema: asSchema(doc.body, '') } } } } : {}),
        responses: {
          [r.method === 'POST' && doc?.response === undefined ? 'default' : 200]: json(asSchema(doc?.response, 'See the module documentation.')),
          ...(isPublic ? { 400: commonErrors[400], 429: commonErrors[429] } : commonErrors),
        },
      };
      put(r.method, r.url, op);
    }

    return {
      openapi: '3.1.0',
      info: {
        title: `${await settings.get('app.name', DEFAULT_APP_NAME)} API`,
        version: '1',
        description: [
          'Generated from the running application: record types come from the resource registry, other routes from the modules that registered them.',
          'This copy lists what the caller may use.',
          '',
          '**Authentication.** Either a personal access token (`Authorization: Bearer grc_pat_...`, created under Account security; it acts as its owner, limited to the token\'s scopes) or a browser session (cookie `grc_session`). With a session, every request that changes data must also carry the header `X-GRC-CSRF: 1`; with a token it need not.',
          '',
          '**Errors.** `{ "error": { "code", "message", "fields"? } }` with a matching HTTP status.',
          '',
          '**Restricted records.** Records of restricted types, and records flagged restricted, are invisible without `security.view`: they are absent from lists, counts, search, links and exports, and answer 404 by id.',
        ].join('\n'),
      },
      servers: [{ url: '/' }],
      security: [{ bearerToken: [] }, { session: [], csrfHeader: [] }],
      tags: [...tags.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, description]) => ({ name, ...(description ? { description } : {}) })),
      paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
      components: {
        securitySchemes: {
          bearerToken: { type: 'http', scheme: 'bearer', description: 'A personal access token.' },
          session: { type: 'apiKey', in: 'cookie', name: 'grc_session', description: 'Browser session, set by POST /api/auth/login.' },
          csrfHeader: { type: 'apiKey', in: 'header', name: 'X-GRC-CSRF', description: 'Send `1` on every request that changes data when using a session.' },
        },
        schemas,
      },
    };
  }

  return {
    describe,
    build,
    /** Every /api route registered so far, with where it came from. */
    routes: () => [...routes],
    /** Whether a route was described with describeRoute. */
    described: (method: string, url: string) => docs.has(key(method, url)),
    /** Routes registered from now on belong to modules. */
    modulesFromHere() { origin = 'module'; },
    /** Supplies the registry and registers GET /api/openapi.json. */
    attach(d: Deps) {
      deps = d;
      app.get('/api/openapi.json', async (req) => build(req.user));
    },
  };
}

export type OpenApi = ReturnType<typeof makeOpenApi>;
