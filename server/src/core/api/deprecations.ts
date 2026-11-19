/**
 * Routes announced for removal or change in a later API version (docs/api.md, "Versioning").
 *
 * Within v1 nothing is removed or changed incompatibly. When something must go, add it here
 * first: every answer from the route then carries `Deprecation: @<unix time>` (RFC 9745), a
 * `Sunset` date when one is set, and a `Link` to the notice; the OpenAPI document marks the
 * operation `deprecated: true` and gives the notice in its description.
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
}

export const DEPRECATIONS: Deprecation[] = [];
