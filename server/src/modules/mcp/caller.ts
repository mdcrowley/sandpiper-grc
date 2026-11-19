import type { FastifyInstance } from 'fastify';

/**
 * Calls the application's own /api routes in-process with the caller's personal access token, so
 * every MCP tool goes through exactly the same authentication, permission, restricted-record,
 * validation, rate-limit and audit rules as the REST API. Nothing here reads the database itself.
 */
export class ToolError extends Error {
  constructor(message: string, public code = 'error', public status = 400, public fields?: Record<string, string>) {
    super(message);
  }
}

export interface Caller {
  get<T = any>(url: string): Promise<T>;
  post<T = any>(url: string, body: unknown): Promise<T>;
  patch<T = any>(url: string, body: unknown): Promise<T>;
  /** Like get, but answers undefined for 403 and 404 (a part the person cannot see, or a module not loaded). */
  tryGet<T = any>(url: string): Promise<T | undefined>;
}

/**
 * `headers` go with every call: the request id of the /mcp request (so the audit events a tool
 * causes carry the same id, E13-14) and, for OAuth access tokens, the in-process marker that lets
 * those tokens through (they are not accepted on /api from outside, see oauth.ts).
 */
export function makeCaller(app: FastifyInstance, authorization: string, remoteAddress: string, headers: Record<string, string> = {}): Caller {
  async function call(method: 'GET' | 'POST' | 'PATCH', url: string, body?: unknown) {
    const res = await app.inject({
      method, url, remoteAddress,
      headers: { ...headers, authorization, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });
    let parsed: any = null;
    try { parsed = res.json(); } catch { /* not JSON */ }
    if (res.statusCode >= 400) {
      const e = parsed?.error ?? {};
      throw new ToolError(String(e.message ?? `The request failed (${res.statusCode}).`), String(e.code ?? 'error'), res.statusCode, e.fields);
    }
    return parsed;
  }
  return {
    get: (url) => call('GET', url),
    post: (url, body) => call('POST', url, body),
    patch: (url, body) => call('PATCH', url, body),
    async tryGet(url) {
      try {
        return await call('GET', url);
      } catch (err) {
        if (err instanceof ToolError && (err.status === 403 || err.status === 404)) return undefined;
        throw err;
      }
    },
  };
}

/** `?a=1&b=2` from an object, leaving out empty values. */
export function qs(params: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(Array.isArray(v) ? v.join(',') : String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}
