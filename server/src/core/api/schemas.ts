import type { FieldDef, ResourceDef } from '../module.ts';

/**
 * JSON Schemas and operations of the generated record routes, and the components every
 * operation shares (errors, headers, parameters). Used by core/openapi.ts.
 */
type Json = Record<string, unknown>;

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const PDF_TYPE = 'application/pdf';

export const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const header = (name: string) => ({ $ref: `#/components/headers/${name}` });
const param = (name: string) => ({ $ref: `#/components/parameters/${name}` });
const nullable = (schema: Json): Json => ({ ...schema, type: [schema.type as string, 'null'] });
export const pascal = (type: string) => type.split('_').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');

export function fieldSchema(f: FieldDef): Json {
  const note = (extra: Json = {}): Json => ({ title: f.label, ...(f.help ? { description: f.help } : {}), ...(f.custom ? { 'x-custom': true } : {}), ...extra });
  if (f.multiple) return note({ type: ['array', 'null'], items: { type: 'string' }, 'x-list': f.list, description: `${f.help ? `${f.help} ` : ''}Values of the configurable list "${f.list}".` });
  switch (f.type) {
    case 'number': case 'currency': return note(nullable({ type: 'number', ...(f.type === 'currency' ? { 'x-currency': true } : {}) }));
    case 'date': return note(nullable({ type: 'string', format: 'date' }));
    case 'datetime': return note(nullable({ type: 'string', format: 'date-time' }));
    case 'boolean': return note(nullable({ type: 'boolean' }));
    case 'lookup': return note(nullable({ type: 'string', 'x-list': f.list, description: `${f.help ? `${f.help} ` : ''}A value of the configurable list "${f.list}" (GET /api/lookups/${f.list}).` }));
    case 'user': return note(nullable({ type: 'string', format: 'uuid', 'x-ref': 'user' }));
    case 'ref': return note(nullable({ type: 'string', format: 'uuid', 'x-ref': f.to, description: `${f.help ? `${f.help} ` : ''}The id of a ${f.to} record.` }));
    case 'json': return note({ description: `${f.help ? `${f.help} ` : ''}Any JSON value.` });
    default: return note(nullable({ type: 'string' }));
  }
}

const errorResponse = (description: string) => ({ description, headers: { 'X-Request-Id': header('X-Request-Id') }, content: { 'application/json': { schema: ref('Error') } } });
export const commonErrors = {
  400: errorResponse('The request was not valid (`validation`, `bad_json`, ...). `error.fields` names the fields at fault.'),
  401: errorResponse('Not signed in, or the token is not valid (`unauthenticated`, `invalid_token`).'),
  403: errorResponse('Not permitted (`forbidden`), security header missing (`csrf`), password confirmation needed (`reauth_required`), not callable with a token (`token_not_allowed`) or second factor not set up (`mfa_enrolment_required`).'),
  404: errorResponse('Not found, or not visible to the caller (`not_found`).'),
  429: { ...errorResponse('Too many requests (`rate_limited`). With a token, `Retry-After` says when to try again.'), headers: { 'X-Request-Id': header('X-Request-Id'), 'Retry-After': header('Retry-After') } },
};
export const publicErrors = { 400: commonErrors[400], 429: commonErrors[429] };
const conflict = (text: string) => errorResponse(text);

/** Headers on a successful answer; token requests also carry the rate-limit headers. */
export const okHeaders = (extra: Record<string, Json> = {}) => ({
  'X-Request-Id': header('X-Request-Id'),
  'RateLimit-Limit': header('RateLimit-Limit'),
  'RateLimit-Remaining': header('RateLimit-Remaining'),
  'RateLimit-Reset': header('RateLimit-Reset'),
  ...extra,
});
export const jsonResponse = (schema: Json, description = 'OK', extra: Record<string, Json> = {}) =>
  ({ description, headers: okHeaders(extra), content: { 'application/json': { schema } } });

export function sharedComponents(): { schemas: Json; headers: Json; parameters: Json } {
  const h = (description: string, schema: Json = { type: 'string' }) => ({ description, schema });
  return {
    schemas: {
      Error: {
        type: 'object', required: ['error'], description: 'Every error answer has this shape, with a matching HTTP status.',
        properties: {
          error: {
            type: 'object', required: ['code', 'message'],
            properties: {
              code: { type: 'string', description: 'Stable machine-readable code, for example `validation`, `forbidden`, `not_found`, `version_conflict`.' },
              message: { type: 'string', description: 'Plain-English message, safe to show to a person.' },
              fields: { type: 'object', additionalProperties: { type: 'string' }, description: 'Field name -> problem, on validation errors.' },
            },
          },
        },
      },
      Ok: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean', const: true } } },
      Stats: {
        type: 'object', required: ['groups', 'total'], description: 'Counts of the records matching the filters, grouped by one field.',
        properties: {
          groups: {
            type: 'array',
            items: {
              type: 'object', required: ['value', 'label', 'count'],
              properties: {
                value: { type: ['string', 'null'], description: 'The stored value (null: records with no value).' },
                label: { type: 'string', description: 'Its display label.' },
                color: { type: 'string', description: 'Its color in the configurable list, or `gray`.' },
                count: { type: 'integer' },
              },
            },
          },
          total: { type: 'integer' },
        },
      },
      Record: {
        type: 'object', description: 'Any record: the fields of its type plus the standard ones.', additionalProperties: true,
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
          _display: { type: 'object', additionalProperties: { type: 'string' } },
          _tags: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    headers: {
      'X-Request-Id': h('Identifies this request. Send your own (1 to 128 letters, digits and `._:@-`) to follow a call through your logs; otherwise one is made up. Quote it when reporting a problem.'),
      ETag: h('Version of the record. Send it back in `If-Match` to update only if nobody has changed the record since.'),
      Link: h('Paging links (RFC 8288): `first`, `prev`, `next`, `last`.'),
      'X-Total-Count': h('Number of matching rows over every page.', { type: 'integer' }),
      'RateLimit-Limit': h('With a token: requests allowed each minute.', { type: 'integer' }),
      'RateLimit-Remaining': h('With a token: requests left this minute.', { type: 'integer' }),
      'RateLimit-Reset': h('With a token: seconds until the count starts again.', { type: 'integer' }),
      'RateLimit-Policy': h('With a token: the policy, for example `600;w=60`.'),
      'Retry-After': h('Seconds to wait before trying again.', { type: 'integer' }),
      'Idempotent-Replayed': h('`true` when this is the stored answer to an earlier request with the same `Idempotency-Key`.'),
      Deprecation: h('Present when the route is deprecated: `@<unix time>` of the announcement (RFC 9745).'),
      Sunset: h('When a deprecated route may stop working (HTTP date).'),
    },
    parameters: {
      IfMatch: { name: 'If-Match', in: 'header', required: false, schema: { type: 'string' }, description: 'Optional. The `ETag` you last read: the change is refused with 409 `version_conflict` when the record has changed since. `*` matches any version.' },
      IdempotencyKey: { name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string', maxLength: 255 }, description: 'Optional. A unique key (for example a UUID) for this create. Repeating the request with the same key within 24 hours returns the first answer instead of creating a second record.' },
      RequestId: { name: 'X-Request-Id', in: 'header', required: false, schema: { type: 'string', maxLength: 128 }, description: 'Optional. Your own id for this request; it is sent back and recorded.' },
      Page: PAGE,
      PageSize: PAGE_SIZE,
    },
  };
}

const PAGE = { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 }, description: 'Page number, from 1.' };
const PAGE_SIZE = { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 50 }, description: 'Rows a page (at most 500).' };

/** The list envelope of one record type. */
function pageSchema(d: ResourceDef, name: string): Json {
  return {
    type: 'object', title: `A page of ${d.plural.toLowerCase()}`, required: ['rows', 'total', 'page', 'pageSize'],
    properties: {
      rows: { type: 'array', items: ref(name) },
      total: { type: 'integer', description: 'Matching rows over every page.' },
      page: { type: 'integer' },
      pageSize: { type: 'integer' },
    },
  };
}

/** The schemas of one record type: the row, the input and a page of rows. */
export function resourceSchemas(d: ResourceDef, fields: Record<string, FieldDef>): Json {
  const name = pascal(d.type);
  const properties: Json = {
    id: { type: 'string', format: 'uuid', readOnly: true },
    ...Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, { ...fieldSchema(f), ...(f.readOnly ? { readOnly: true } : {}) }])),
    created_at: { type: 'string', format: 'date-time', readOnly: true },
    created_by: { type: ['string', 'null'], format: 'uuid', readOnly: true },
    updated_at: { type: 'string', format: 'date-time', readOnly: true },
    updated_by: { type: ['string', 'null'], format: 'uuid', readOnly: true },
    _display: {
      type: 'object', readOnly: true, description: 'Display labels for the user, record and list fields that have a value.',
      properties: Object.fromEntries(Object.entries(fields).filter(([, f]) => ['user', 'ref', 'lookup'].includes(f.type)).map(([k, f]) => [k, { type: 'string', title: f.label }])),
      additionalProperties: { type: 'string' },
    },
    _tags: { type: 'array', items: { type: 'string' }, readOnly: true, description: 'Tags on the record.' },
  };
  const writable = Object.entries(fields).filter(([, f]) => !f.readOnly);
  const custom = Object.keys(fields).filter((k) => fields[k].custom);
  return {
    [name]: {
      type: 'object', title: d.label, properties, required: ['id', 'created_at', 'updated_at'], additionalProperties: true,
      description: `A ${d.label.toLowerCase()} record.${custom.length ? ` Custom fields (\`cf_*\`): ${custom.map((k) => `\`${k}\``).join(', ')}.` : ' Custom fields an administrator adds appear as `cf_<key>`.'}`,
    },
    [`${name}Input`]: {
      type: 'object', title: `${d.label} (create or update)`,
      properties: Object.fromEntries(writable.map(([k, f]) => [k, { ...fieldSchema(f), ...(f.default !== undefined ? { default: f.default } : {}) }])),
      required: writable.filter(([, f]) => f.required && f.default === undefined).map(([k]) => k),
    },
    [`${name}Page`]: pageSchema(d, name),
  };
}

/** The six generated routes of one record type: [method, url, operation]. */
export function resourceOperations(d: ResourceDef, fields: Record<string, FieldDef>): [string, string, Json][] {
  const name = pascal(d.type);
  const tag = d.plural;
  const fieldNames = [...Object.keys(fields), 'created_at', 'updated_at', 'created_by', 'updated_by'];
  const filters: Json[] = [
    { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Search. Full text (whole words, word endings, several words, a prefix for the last word) from three characters; substring below that. Reference numbers match as typed. Best matches first when no `sort` is given.' },
    ...fieldNames.map((k) => ({
      name: `f.${k}`, in: 'query', schema: { type: 'string' },
      description: `Filter on ${fields[k]?.label ?? k}: any of the comma-separated values${fields[k]?.type === 'user' || k.endsWith('_by') ? ' (`me` = the caller)' : ''}. `
        + `Also \`f.${k}.null=true|false\`${['date', 'datetime', 'number', 'currency'].includes(fields[k]?.type ?? 'datetime') ? `, \`f.${k}.gt\`, \`.gte\`, \`.lt\`, \`.lte\`` : ''}.`,
    })),
    ...(d.fields.tags ? [] : [{ name: 'f.tags', in: 'query', schema: { type: 'string' }, description: 'Records carrying any of these tags (comma-separated). `f.tags.all=` needs every tag; `f.tags.null=true` is untagged.' }]),
  ];
  const x = (action: string) => ({ 'x-permission': `${d.module}.${action}`, ...(d.restricted === true ? { 'x-also-needs': 'security.view' } : {}) });
  const file = (type: string, what: string) => ({ schema: { type: 'string', format: 'binary', description: what }, 'x-media': type });
  const etag = { ETag: header('ETag') };
  const v409 = conflict('The record changed since the `If-Match` version (`version_conflict`). The answer carries the current `ETag`.');
  return [
    ['GET', d.path, {
      tags: [tag], summary: `List ${d.plural.toLowerCase()}`, operationId: `list_${d.type}`, ...x('view'),
      description: `A page of ${d.plural.toLowerCase()} matching the filters, with paging links in \`Link\`. `
        + `\`format=csv\`, \`xlsx\` or \`pdf\` exports every matching row (up to 50,000) instead, with the columns named in \`columns\` (needs \`${d.module}.export\`; audited; restricted content is watermarked).`,
      parameters: [
        ...filters,
        { name: 'sort', in: 'query', schema: { type: 'string', enum: fieldNames } },
        { name: 'dir', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
        PAGE, PAGE_SIZE,
        { name: 'format', in: 'query', schema: { type: 'string', enum: ['csv', 'xlsx', 'pdf'] }, description: 'Export instead of a page of JSON.' },
        { name: 'columns', in: 'query', schema: { type: 'string' }, description: 'Exports: comma-separated field names, in order (default: every field).' },
      ],
      responses: {
        200: {
          description: 'A page of rows (JSON), or the export file.',
          headers: okHeaders({ Link: header('Link'), 'X-Total-Count': header('X-Total-Count') }),
          content: {
            'application/json': { schema: pageSchema(d, name) },
            'text/csv': file('text/csv', 'UTF-8 with a byte-order mark; one header row of field labels; display labels for user, record and list fields.'),
            [XLSX_TYPE]: file(XLSX_TYPE, 'A spreadsheet with typed cells (dates, numbers, currency) and the filters above the table.'),
            [PDF_TYPE]: file(PDF_TYPE, 'A printable table with the filters and the time it was produced.'),
          },
        },
        ...commonErrors,
      },
    }],
    ['GET', `${d.path}/stats`, {
      tags: [tag], summary: `Count ${d.plural.toLowerCase()} by a field`, operationId: `stats_${d.type}`, ...x('view'),
      parameters: [{ name: 'group', in: 'query', required: true, schema: { type: 'string', enum: Object.keys(fields).filter((k) => !fields[k].multiple) } }, ...filters],
      responses: { 200: jsonResponse(ref('Stats')), ...commonErrors },
    }],
    ['GET', `${d.path}/:id`, {
      tags: [tag], summary: `Get one ${d.label.toLowerCase()}`, operationId: `get_${d.type}`, ...x('view'),
      responses: { 200: jsonResponse(ref(name), 'OK', etag), ...commonErrors },
    }],
    ['POST', d.path, {
      tags: [tag], summary: `Create a ${d.label.toLowerCase()}`, operationId: `create_${d.type}`, ...x('create'),
      description: 'Send `Idempotency-Key` to make a retry safe: the same key and body within 24 hours returns the first answer (with `Idempotent-Replayed: true`) instead of a second record.',
      parameters: [param('IdempotencyKey')],
      requestBody: { required: true, content: { 'application/json': { schema: ref(`${name}Input`) } } },
      responses: {
        201: jsonResponse(ref(name), 'Created', { ...etag, 'Idempotent-Replayed': header('Idempotent-Replayed') }),
        ...commonErrors,
        409: conflict('A request with this `Idempotency-Key` is still running (`idempotency_in_progress`).'),
        422: conflict('This `Idempotency-Key` was used for a different request (`idempotency_key_reused`).'),
      },
    }],
    ['PATCH', `${d.path}/:id`, {
      tags: [tag], summary: `Update a ${d.label.toLowerCase()}`, operationId: `update_${d.type}`, ...x('edit'),
      description: 'Partial: send only the fields to change. Send `If-Match` with the `ETag` you read to refuse the change when someone else has changed the record since.',
      parameters: [param('IfMatch')],
      requestBody: { required: true, content: { 'application/json': { schema: ref(`${name}Input`) } } },
      responses: { 200: jsonResponse(ref(name), 'OK', etag), ...commonErrors, 409: v409 },
    }],
    ['DELETE', `${d.path}/:id`, {
      tags: [tag], summary: `Delete a ${d.label.toLowerCase()} (soft delete)`, operationId: `delete_${d.type}`, ...x('delete'),
      parameters: [param('IfMatch')],
      responses: { 200: jsonResponse(ref('Ok')), ...commonErrors, 409: v409 },
    }],
  ];
}
