/**
 * Routes announced for removal or change in a later API version (docs/api.md, "Versioning").
 *
 * Within v1 nothing is removed or changed incompatibly. When something must go, add it here
 * first: every answer from the route then carries `Deprecation: @<unix time>` (RFC 9745), a
 * `Sunset` date when one is set, and a `Link` to the notice; the OpenAPI document marks the
 * operation `deprecated: true` and gives the notice in its description.
 *
 * A renamed route sets `replacement`: the route is registered at its new path only, and
 * versioning.ts serves it at the old `path` too (same handler, hooks and permissions), so
 * integrations that use the old path keep working while they are told to move.
 */
export interface Deprecation {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** The route as registered, unversioned: '/api/tickets/:id/sla'. */
  path: string;
  /** When it was deprecated (ISO date). */
  since: string;
  /** When it may stop working (ISO date), if decided. */
  sunset?: string;
  /** What to use instead, in plain English. */
  notice: string;
  /** A page explaining the change. */
  link?: string;
  /** For a renamed route: the new path (unversioned, as registered). The old `path` is served as an alias of it. */
  replacement?: string;
}

/** A route renamed to American spelling; the British path stays as a deprecated alias. */
const renamed = (method: Deprecation['method'], path: string, replacement: string): Deprecation => ({
  method, path, replacement, since: '2026-11-19',
  notice: `Renamed to American spelling: use ${method} ${replacement} instead (same request and answer).`,
});

export const DEPRECATIONS: Deprecation[] = [
  renamed('GET', '/api/policies/acknowledgements/mine', '/api/policies/acknowledgments/mine'),
  renamed('GET', '/api/policies/acknowledgements/:ackId', '/api/policies/acknowledgments/:ackId'),
  renamed('POST', '/api/policies/acknowledgements/:ackId/acknowledge', '/api/policies/acknowledgments/:ackId/acknowledge'),
  renamed('GET', '/api/policies/:id/acknowledgements', '/api/policies/:id/acknowledgments'),
  renamed('GET', '/api/portal/catalogue', '/api/portal/catalog'),
  renamed('GET', '/api/reports/catalogue', '/api/reports/catalog'),
];
