// API client: JSON in and out, same-origin cookies, CSRF header on mutating calls.

export class ApiError extends Error {
  status: number;
  code: string;
  fields: Record<string, string>;

  constructor(status: number, code: string, message: string, fields: Record<string, string> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

/** Best human-readable message for anything thrown by the client. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return 'Something went wrong. Check your connection and try again.';
}

let onUnauthorized: (() => void) | null = null;

/** AuthProvider registers its refresh here, so a 401 anywhere re-checks the session. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

const isAuthCall = (url: string) => url.startsWith('/api/auth/') || url.startsWith('/api/setup');

async function send(method: string, url: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') headers['X-GRC-CSRF'] = '1';
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', 'The server could not be reached. Check that it is running and try again.');
  }
  if (res.ok) return res;

  let error: { code?: string; message?: string; fields?: Record<string, string> } = {};
  try {
    error = (await res.json()).error ?? {};
  } catch {
    // Not a JSON error body; fall through to the generic message.
  }
  if (res.status === 401 && !isAuthCall(url)) onUnauthorized?.();
  throw new ApiError(
    res.status,
    error.code ?? `http_${res.status}`,
    error.message ?? `The request failed (${res.status}).`,
    error.fields ?? {},
  );
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await send(method, url, body);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T = unknown>(url: string) => request<T>('GET', url),
  post: <T = unknown>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  patch: <T = unknown>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
  /** Replace a whole value, for example a preference (`PUT /api/me/preferences/:key`). */
  put: <T = unknown>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  del: <T = unknown>(url: string) => request<T>('DELETE', url),
  /** GET a non-JSON response (CSV export) as a Blob. */
  blob: async (url: string) => (await send('GET', url)).blob(),
};

type QueryValue = string | number | boolean | null | undefined;

/** Builds `?a=1&b=2`, skipping empty values. Returns '' when there is nothing to send. */
export function qs(params: Record<string, QueryValue>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') sp.set(key, String(value));
  }
  const out = sp.toString();
  return out ? `?${out}` : '';
}

export interface ListQuery {
  q?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
  /**
   * Keyed by what follows `f.` in the list contract: `status` (any of the values),
   * `due_at.gt`, `due_at.lt`, `assignee_id.null`.
   */
  filters?: Record<string, string | string[] | boolean | undefined>;
  format?: 'csv';
}

/** Query string for a resource list or stats route. */
export function listQuery(query: ListQuery, extra: Record<string, QueryValue> = {}): string {
  const { filters = {}, ...rest } = query;
  const params: Record<string, QueryValue> = { ...rest, ...extra };
  for (const [key, value] of Object.entries(filters)) {
    params[`f.${key}`] = Array.isArray(value) ? value.join(',') : value;
  }
  return qs(params);
}

/** A list response from any resource route. */
export interface ListResult<T = Row> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** A stats response: `GET {path}/stats?group=<field>`. */
export interface StatsResult {
  groups: { value: string | null; label: string; color: string; count: number }[];
  total: number;
}

/** A record row. Field names are column names; `_display` holds labels for user, ref and lookup fields. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any> & { id: string; _display?: Record<string, string> };
