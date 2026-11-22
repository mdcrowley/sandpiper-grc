// The app's connection to its server (E38-03). Owner: APP-CORE. Every screen reaches the server only
// through what is exported here. Request and response shapes are in ../../../shared (mobile-api.ts,
// asset-tags-api.ts) and, for the rest of the API, in the generated packages/api-client (E38-01).
import { useSyncExternalStore } from 'react';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import type { MobileSettings } from '../../../shared/mobile-api.ts';
import {
  accessToken, authStore, confirmIdentity as confirmIdentityInBrowser, SessionEnded, sessionRefused, setSettingsLoader, signOut as endSession,
  type AuthState,
} from '../auth/session';

/** An answer the server refused: `{ error: { code, message, fields? } }` with its HTTP status. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fields: Record<string, string> = {}) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface Session {
  /** The server's base address, for example https://grc.example.org (HTTPS; http only in development builds). */
  server: string;
  user: { id: string; displayName: string; username: string };
  deviceId: string;
  /** Permissions and switched-on areas from GET /api/mobile/settings. */
  permissions: string[];
  areas: Record<string, boolean>;
}

export interface SessionState {
  /** `loading` while the stored session is read at start; `signed-out` before connecting or after signing out. */
  status: 'loading' | 'signed-out' | 'signed-in';
  session: Session | null;
  /** Whether the person holds a permission (false for a switched-off area's permissions). */
  can(permission: string): boolean;
  areaOn(area: string): boolean;
  signOut(): Promise<void>;
}

export interface ApiFetchInit {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Sent as JSON. */
  body?: unknown;
  headers?: Record<string, string>;
  /** Sent as If-Match (the record's ETag) on PATCH and DELETE. */
  ifMatch?: string;
  /** Sent as Idempotency-Key on creates (the outbox, wave 15). */
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Called with the status and ETag header of the answer before its body is returned, also for an error answer. */
  onResponse?: (info: { status: number; etag: string | null }) => void;
}

/** Error codes the app makes itself (status 0): no session, or the server could not be reached. */
export const CLIENT_ERRORS = { notConnected: 'not_connected', offline: 'offline', badResponse: 'bad_response' } as const;

function serverOf(): string {
  // Signing in loads the settings before the status turns signed-in; the token check follows in bearer().
  const { server } = authStore.get();
  if (!server) throw new ApiError(0, CLIENT_ERRORS.notConnected, 'Not signed in to a server.');
  return server;
}

/** The access token; after a 401, `refused` is the token the server refused (refreshed unless already replaced). */
async function bearer(refused?: string): Promise<string> {
  try {
    return await accessToken(refused !== undefined, refused);
  } catch (e) {
    if (e instanceof SessionEnded) {
      throw e.offline
        ? new ApiError(0, CLIENT_ERRORS.offline, 'The server cannot be reached.')
        : new ApiError(401, CLIENT_ERRORS.notConnected, 'You were signed out.');
    }
    throw e;
  }
}

async function errorOf(status: number, text: string): Promise<ApiError> {
  let body: { error?: { code?: string; message?: string; fields?: Record<string, string> } | string; message?: string } | null = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  const e = body?.error;
  if (e && typeof e === 'object') return new ApiError(status, e.code ?? 'error', e.message ?? `HTTP ${status}`, e.fields ?? {});
  return new ApiError(status, typeof e === 'string' ? e : 'error', body?.message ?? `HTTP ${status}`);
}

function parse<T>(status: number, text: string): T {
  if (status === 204 || !text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(status, CLIENT_ERRORS.badResponse, 'The server sent an answer the app cannot read.');
  }
}

/** A 401 the server gives for a token it no longer accepts: refresh once, then give up. */
const isTokenRefused = (e: ApiError) => e.status === 401;

/**
 * Calls the signed-in server: `path` starts with `/api/`. Adds the access token (refreshing it when it
 * has expired), parses JSON, and throws ApiError for an error answer. A refresh the server refuses
 * signs the app out and wipes local data (E38-03).
 */
export async function apiFetch<T = unknown>(path: string, init: ApiFetchInit = {}): Promise<T> {
  if (!path.startsWith('/api/')) throw new ApiError(0, 'bad_path', `apiFetch paths start with /api/ (${path}).`);
  const server = serverOf();
  const send = async (token: string) => {
    const headers: Record<string, string> = { Accept: 'application/json', ...init.headers, Authorization: `Bearer ${token}` };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (init.ifMatch) headers['If-Match'] = init.ifMatch;
    if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;
    try {
      return await fetch(`${server}${path}`, {
        method: init.method ?? 'GET',
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: init.signal,
      });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e;
      throw new ApiError(0, CLIENT_ERRORS.offline, 'The server cannot be reached.');
    }
  };
  const first = await bearer();
  let res = await send(first);
  if (res.status === 401) res = await send(await bearer(first));
  const text = await res.text();
  init.onResponse?.({ status: res.status, etag: res.headers.get('ETag') });
  if (!res.ok) {
    const error = await errorOf(res.status, text);
    if (isTokenRefused(error)) await sessionRefused();
    throw error;
  }
  return parse<T>(res.status, text);
}

export interface ApiUploadInit {
  /** A local file (file:// URI), sent as the raw request body. */
  fileUri: string;
  method?: 'PUT' | 'POST';
  /** Default application/octet-stream. */
  contentType?: string;
  signal?: AbortSignal;
  onProgress?: (sentBytes: number, totalBytes: number) => void;
}

/** Sends a local file (file:// URI) as the raw request body (PUT, application/octet-stream unless contentType is given) and parses the JSON answer. */
export async function apiUpload<T = unknown>(path: string, init: ApiUploadInit): Promise<T> {
  if (!path.startsWith('/api/')) throw new ApiError(0, 'bad_path', `apiUpload paths start with /api/ (${path}).`);
  const server = serverOf();
  const send = async (token: string) => {
    const task = LegacyFileSystem.createUploadTask(
      `${server}${path}`,
      init.fileUri,
      {
        httpMethod: init.method ?? 'PUT',
        uploadType: LegacyFileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: { Accept: 'application/json', 'Content-Type': init.contentType ?? 'application/octet-stream', Authorization: `Bearer ${token}` },
      },
      init.onProgress ? (p) => init.onProgress!(p.totalBytesSent, p.totalBytesExpectedToSend) : undefined,
    );
    const abort = () => void task.cancelAsync();
    init.signal?.addEventListener('abort', abort);
    try {
      const r = await task.uploadAsync();
      if (!r) throw Object.assign(new Error('Upload canceled'), { name: 'AbortError' });
      return r;
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e;
      throw new ApiError(0, CLIENT_ERRORS.offline, 'The server cannot be reached.');
    } finally {
      init.signal?.removeEventListener('abort', abort);
    }
  };
  const first = await bearer();
  let r = await send(first);
  if (r.status === 401) r = await send(await bearer(first));
  if (r.status < 200 || r.status >= 300) {
    const error = await errorOf(r.status, r.body);
    if (isTokenRefused(error)) await sessionRefused();
    throw error;
  }
  return parse<T>(r.status, r.body);
}

/**
 * A sensitive action answered 403 `reauth_required`: signs in again in the browser (`prompt=login`).
 * Resolves true when the person signed in (retry the request once), false when they canceled.
 */
export function confirmIdentity(): Promise<boolean> {
  return confirmIdentityInBrowser();
}

setSettingsLoader(() => apiFetch<MobileSettings>('/api/mobile/settings'));

/** Whether a permission list grants `permission` (`*`, `module.*` or the exact name). */
export function grants(permissions: readonly string[], permission: string): boolean {
  if (permissions.includes('*') || permissions.includes(permission)) return true;
  const dot = permission.indexOf('.');
  return dot > 0 && permissions.includes(`${permission.slice(0, dot)}.*`);
}

let lastState: AuthState | null = null;
let lastSession: SessionState | null = null;

function toSessionState(a: AuthState): SessionState {
  if (a === lastState && lastSession) return lastSession;
  const session: Session | null = a.status === 'signed-in' && a.server && a.profile
    ? {
      server: a.server, user: a.profile.user, deviceId: a.deviceId ?? '', permissions: a.profile.permissions, areas: a.profile.areas,
    }
    : null;
  lastState = a;
  lastSession = {
    status: a.status === 'signed-in' && !session ? 'loading' : a.status,
    session,
    can: (p) => !!session && grants(session.permissions, p),
    areaOn: (area) => !!session && session.areas[area] === true,
    signOut: endSession,
  };
  return lastSession;
}

/** The session, for screens (a React hook). */
export function useSession(): SessionState {
  return useSyncExternalStore(authStore.subscribe, () => toSessionState(authStore.get()));
}

/** The full sign-in state (server, unlock, reasons), for the app's own sign-in and Account screens. */
export function useAuthState(): AuthState {
  return useSyncExternalStore(authStore.subscribe, authStore.get);
}
