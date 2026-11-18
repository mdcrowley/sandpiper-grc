import type { FastifyRequest } from 'fastify';

// Deployment switches read from the environment at the time of use, so nothing here is fixed at import.

const on = (v: string | undefined) => ['1', 'true', 'yes', 'on'].includes(String(v ?? '').trim().toLowerCase());

/**
 * GRC_TRUST_PROXY=1 says the server sits behind ONE reverse proxy that it trusts, which sets
 * X-Forwarded-Proto and appends the caller's address to X-Forwarded-For. Off by default: on
 * 127.0.0.1 those headers could be set by anyone and must be ignored.
 */
export const trustProxy = () => on(process.env.GRC_TRUST_PROXY);

/** GRC_COOKIE_SECURE: `off` (default, plain http on 127.0.0.1), `auto` (when the request is HTTPS) or `always`. */
export function cookieSecureMode(): 'off' | 'auto' | 'always' {
  const v = String(process.env.GRC_COOKIE_SECURE ?? 'off').trim().toLowerCase();
  return v === 'auto' || v === 'always' ? v : on(v) ? 'always' : 'off';
}

const lastOf = (header: string | string[] | undefined) =>
  String(Array.isArray(header) ? header[header.length - 1] : header ?? '').split(',').pop()!.trim();

/** True when the browser reached the application over HTTPS (directly, or through the trusted proxy). */
export function isHttps(req: FastifyRequest): boolean {
  if (req.protocol === 'https') return true;
  return trustProxy() && lastOf(req.headers['x-forwarded-proto']).toLowerCase() === 'https';
}

/** Whether the session cookie should carry the `Secure` attribute for this request. */
export function cookieSecure(req: FastifyRequest): boolean {
  const mode = cookieSecureMode();
  return mode === 'always' || (mode === 'auto' && isHttps(req));
}

/** The caller's address: the entry the trusted proxy appended, else the connection's own address. */
export function clientIp(req: FastifyRequest): string {
  if (trustProxy()) {
    const forwarded = lastOf(req.headers['x-forwarded-for']);
    if (forwarded && forwarded.length <= 64) return forwarded;
  }
  return req.ip;
}