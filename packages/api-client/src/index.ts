// The API client for the mobile app (E38-01): types generated from the server's OpenAPI description
// (schema.ts, by ../generate.ts) and helpers to name a request's parts. The app's own transport
// (tokens, refresh, errors) is mobile/src/api/client.ts; this package has no runtime code.
//
//   import type { ApiResponse } from '../../../packages/api-client/src/index.ts';
//   type Page = ApiResponse<'/api/notifications', 'get'>;
import type { components, paths } from './schema.ts';

export type { components, paths };

/** Every generated path (with `{id}` placeholders), as in the OpenAPI description. */
export type ApiPath = keyof paths;
/** The methods a path has. */
export type ApiMethod<P extends ApiPath> = keyof paths[P] & ('get' | 'put' | 'post' | 'delete' | 'patch');

type Op<P extends ApiPath, M extends ApiMethod<P>> = paths[P][M] extends { response: unknown; body: unknown; query: unknown; path: unknown }
  ? paths[P][M]
  : never;

/** The JSON a successful answer carries. */
export type ApiResponse<P extends ApiPath, M extends ApiMethod<P>> = Op<P, M>['response'];
/** The JSON body a request sends (`never` when it sends none). */
export type ApiBody<P extends ApiPath, M extends ApiMethod<P>> = Op<P, M>['body'];
/** The query parameters (`never` when there are none). */
export type ApiQuery<P extends ApiPath, M extends ApiMethod<P>> = Op<P, M>['query'];
/** The path parameters (`never` when there are none). */
export type ApiPathParams<P extends ApiPath, M extends ApiMethod<P>> = Op<P, M>['path'];
/** A named component schema, for example `Schema<'Error'>`. */
export type Schema<N extends keyof components['schemas']> = components['schemas'][N];

/** Fills `{name}` placeholders: `fillPath('/api/notifications/{id}/read', { id })`. */
export function fillPath(path: string, params: Record<string, string>): string {
  return path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const v = params[name];
    if (v === undefined) throw new Error(`fillPath: no value for {${name}} in ${path}`);
    return encodeURIComponent(v);
  });
}
