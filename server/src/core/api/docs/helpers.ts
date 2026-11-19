import type { RouteDoc } from '../../module.ts';
import { shape, type JsonSchema } from '../shape.ts';

/**
 * Helpers for the central route descriptions in this folder: one file per module, each a list of
 * `route(...)` entries for that module's hand-written routes. A module that describes a route
 * itself with `ctx.describeRoute` wins over the entry here (it is registered later).
 *
 *   route('GET', '/api/tickets/:id/sla', 'Service-level clocks of one ticket', {
 *     tag: 'Tickets', permission: 'tickets.view',
 *     response: '{ responseDueAt: datetime | null, resolveDueAt: datetime | null, paused: boolean }',
 *   })
 *
 * `body` and `response` use the notation of `core/api/shape.ts` and are checked when the file is
 * loaded, so a mistake fails at once. `query` values are a description (a string parameter) or
 * `q(type, description)`. `file` says the answer is a download of that media type rather than
 * JSON; `status` is the success status when it is not 200 (201 for a create).
 */
export interface DocInput {
  tag: string;
  permission?: string;
  description?: string;
  public?: boolean;
  query?: Record<string, string | JsonSchema>;
  body?: string;
  response?: string;
  file?: string;
  status?: number;
}

export function route(method: RouteDoc['method'], path: string, summary: string, x: DocInput): RouteDoc {
  let response: JsonSchema | undefined = x.response !== undefined ? shape(x.response) : undefined;
  if (x.file) response = { type: 'string', format: 'binary', 'x-content-type': x.file, ...(response ? { description: 'See the summary.' } : {}) };
  if (x.status && response) response = { ...response, 'x-status': x.status };
  else if (x.status) response = { 'x-status': x.status };
  return {
    method, path, summary, tag: x.tag,
    ...(x.permission ? { permission: x.permission } : {}),
    ...(x.description ? { description: x.description } : {}),
    ...(x.public ? { public: true } : {}),
    ...(x.query ? { query: x.query } : {}),
    ...(x.body !== undefined ? { body: shape(x.body) } : {}),
    ...(response ? { response } : {}),
  };
}

/** A query parameter of a given type: `q('integer', 'Page number, from 1.')`. Types as in shape(). */
export function q(type: string, description: string): JsonSchema {
  return { ...shape(type), description };
}

/** The usual paging parameters of a hand-written list. */
export const paging = {
  page: q('integer', 'Page number, from 1.'),
  pageSize: q('integer', 'Rows a page.'),
};
