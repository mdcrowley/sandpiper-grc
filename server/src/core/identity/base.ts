// The application's own address for addresses handed to programs (W17-7): the MCP OAuth issuer and
// resource, the address the MCP tools link to, calendar feed addresses and the work-tracker callback.
//
// The setting `auth.public_url` (Administration > Sign-in providers, "Application address") when it
// is set. Without it, the request's Host header is believed only when it names this machine
// (localhost, 127.x.x.x or [::1], with any port): the default local installation, which nobody else
// can reach. On an installation other machines can reach, a Host header is whatever the caller sent,
// and an address built from it could be kept by a shared cache and handed to someone else, so these
// features answer 409 `public_url_required` until an administrator sets the application address.
import type { FastifyRequest } from 'fastify';
import { fail } from '../errors.ts';
import { isLoopback } from '../http.ts';
import { isHttps } from '../request.ts';

const HOST_RE = /^([A-Za-z0-9.-]+|\[[0-9a-fA-F:]+\])(:\d{1,5})?$/;

export const PUBLIC_URL_REQUIRED = 'Set the application address (Administration > Sign-in providers, "Application address", auth.public_url) first: '
  + 'without it, addresses given to other programs are made only for an installation used on this computer.';

/** The configured application address, without a trailing slash, or '' when none is set. */
export async function configuredBase(settings: { get<T>(key: string, fallback: T): Promise<T> }): Promise<string> {
  const configured = String(await settings.get<unknown>('auth.public_url', '') ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s]+$/.test(configured) ? configured : '';
}

/** The base from the Host header when it names this machine (loopback), else null. */
export function loopbackBase(req: FastifyRequest): string | null {
  const host = String(req.headers.host ?? '').trim();
  const m = HOST_RE.exec(host);
  if (!m || !isLoopback(m[1])) return null;
  return `${isHttps(req) ? 'https' : 'http'}://${host}`;
}

/**
 * `auth.public_url`, else the loopback Host of a local installation; otherwise refuses with 409
 * `public_url_required` and a message saying what to set.
 */
export async function trustedBase(settings: { get<T>(key: string, fallback: T): Promise<T> }, req: FastifyRequest): Promise<string> {
  const configured = await configuredBase(settings);
  if (configured) return configured;
  return loopbackBase(req) ?? fail(409, 'public_url_required', PUBLIC_URL_REQUIRED);
}
