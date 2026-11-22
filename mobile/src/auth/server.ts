// The server address and the compatibility check before signing in (spec §5.2 step 1, §5.9; E38-03).
// Pure functions plus one fetch, so they are unit-tested without a phone.
import type { MobileHello } from '../../../shared/mobile-api.ts';

/** Why the app cannot connect to an address. The connect screen words each one (src/text/connect.ts). */
export type ConnectProblem =
  | 'empty'
  | 'invalid'
  | 'not_https'
  | 'unreachable'
  | 'not_sandpiper'
  | 'switched_off'
  | 'app_too_old'
  | 'server_too_old';

export class ConnectError extends Error {
  constructor(public problem: ConnectProblem, message = problem) {
    super(message);
    this.name = 'ConnectError';
  }
}

/** The mobile API versions this app understands (MobileHello.apiVersion). */
export const SUPPORTED_API_VERSIONS: readonly number[] = [1];

/**
 * Turns what the person typed into the server's base address: `grc.example.org` → `https://grc.example.org`.
 * Plain HTTP is refused unless `allowHttp` (development builds only). Paths, queries and fragments are
 * dropped except a base path (a server published under `/grc`).
 */
export function normalizeServer(input: string, allowHttp: boolean): string {
  const typed = input.trim();
  if (!typed) throw new ConnectError('empty');
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new ConnectError('invalid');
  }
  const scheme = url.protocol.toLowerCase();
  if (scheme !== 'https:' && scheme !== 'http:') throw new ConnectError('invalid');
  if (scheme === 'http:' && !allowHttp) throw new ConnectError('not_https');
  if (!url.hostname || url.username || url.password) throw new ConnectError('invalid');
  const path = url.pathname.replace(/\/+$/, '');
  return `${scheme}//${url.host.toLowerCase()}${path}`;
}

/** Compares dotted versions (`0.10.0` > `0.9.3`); missing parts count as 0, anything after `-` is ignored. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split('-')[0]!.split('.').map((p) => Number.parseInt(p, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export interface Compatibility {
  /** `ok`, or the reason the app refuses this server. */
  verdict: 'ok' | 'app_too_old' | 'server_too_old';
  /** The app works but a newer one is recommended. */
  updateSuggested: boolean;
}

/** §5.9: the app refuses a server whose mobile API it does not know, and asks to be updated when too old. */
export function compatibility(hello: Pick<MobileHello, 'apiVersion' | 'mobile'>, appVersion: string): Compatibility {
  if (!SUPPORTED_API_VERSIONS.includes(hello.apiVersion)) return { verdict: 'server_too_old', updateSuggested: false };
  if (compareVersions(appVersion, hello.mobile.minVersion) < 0) return { verdict: 'app_too_old', updateSuggested: true };
  return { verdict: 'ok', updateSuggested: compareVersions(appVersion, hello.mobile.recommendedVersion) < 0 };
}

function looksLikeHello(body: unknown): body is MobileHello {
  const b = body as Partial<MobileHello> | null;
  return !!b && b.product === 'sandpiper-grc' && typeof b.apiVersion === 'number' && !!b.mobile && !!b.oauth
    && typeof b.oauth.authorizationEndpoint === 'string' && typeof b.oauth.tokenEndpoint === 'string';
}

/**
 * Endpoints the server names are absolute addresses (from its public address, which may differ from the
 * address typed, for example a short internal name): they must use HTTPS whenever the typed address does.
 */
function safeEndpoint(endpoint: string, server: string): boolean {
  try {
    const e = new URL(endpoint);
    const s = new URL(server);
    return e.protocol === 'https:' || (e.protocol === 'http:' && s.protocol === 'http:');
  } catch {
    return false;
  }
}

/**
 * `GET /api/mobile/hello`: is this a Sandpiper GRC server with the Mobile app switched on, and does it
 * accept this app? Throws ConnectError; returns the hello and whether an update is suggested.
 */
export async function checkServer(
  server: string,
  appVersion: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 15000,
): Promise<{ hello: MobileHello; updateSuggested: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetcher(`${server}/api/mobile/hello`, { headers: { Accept: 'application/json' }, signal: controller.signal });
  } catch {
    throw new ConnectError('unreachable');
  } finally {
    clearTimeout(timer);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (res.status === 404 && (body as { error?: { code?: string } } | null)?.error?.code === 'switched_off') {
    throw new ConnectError('switched_off');
  }
  if (!res.ok || !looksLikeHello(body)) throw new ConnectError('not_sandpiper');
  for (const endpoint of [body.oauth.authorizationEndpoint, body.oauth.tokenEndpoint, body.oauth.revocationEndpoint]) {
    if (!safeEndpoint(endpoint, server)) throw new ConnectError('not_sandpiper');
  }
  const c = compatibility(body, appVersion);
  if (c.verdict !== 'ok') throw new ConnectError(c.verdict);
  return { hello: body, updateSuggested: c.updateSuggested };
}
