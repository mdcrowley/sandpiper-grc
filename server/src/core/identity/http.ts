// Outbound calls to identity providers. Made only for a provider an administrator has switched on,
// or when an administrator selects "Test connection". HTTPS only, except to this machine's own
// loopback address (for a provider run locally, and for tests). Redirects are never followed, each
// call times out, and answers are size-limited.
import { IdentityError } from './types.ts';

export const TIMEOUT_MS = 10_000;
const MAX_BYTES = 512 * 1024;

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Null when the address may be called; otherwise why not. */
export function addressProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'is not a web address';
  }
  if (url.username || url.password) return 'must not contain a user name or password';
  if (url.protocol === 'https:') return null;
  if (url.protocol === 'http:' && LOOPBACK.has(url.hostname.toLowerCase())) return null;
  return 'must use https (plain http is allowed only to this machine)';
}

export function assertAddress(raw: string, what: string): void {
  const problem = addressProblem(raw);
  if (problem) throw new IdentityError(`${what} ${problem}`, `The ${what} ${problem}.`);
}

/** Calls an address and returns its JSON answer. Throws IdentityError with a plain reason. */
export async function fetchJson(
  url: string, what: string,
  init: { method?: 'GET' | 'POST'; headers?: Record<string, string>; form?: Record<string, string> } = {},
): Promise<{ status: number; json: any }> {
  assertAddress(url, what);
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        accept: 'application/json',
        ...(init.form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
        ...init.headers,
      },
      body: init.form ? new URLSearchParams(init.form).toString() : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = (err as Error)?.name === 'TimeoutError';
    throw new IdentityError(`${what} ${timedOut ? 'timed out' : 'could not be reached'}`,
      `The ${what} ${timedOut ? `did not answer within ${TIMEOUT_MS / 1000} seconds` : 'could not be reached'}.`);
  }
  if (res.status >= 300 && res.status < 400) {
    throw new IdentityError(`${what} redirected`, `The ${what} answered with a redirect, which is not followed. Check the address.`);
  }
  const text = await readLimited(res, what);
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new IdentityError(`${what} answer not JSON`, `The ${what} did not answer with JSON (status ${res.status}).`);
  }
  return { status: res.status, json };
}

async function readLimited(res: Response, what: string): Promise<string> {
  const length = Number(res.headers.get('content-length') ?? 0);
  if (length > MAX_BYTES) throw new IdentityError(`${what} answer too large`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new IdentityError(`${what} answer too large`);
  return buf.toString('utf8');
}
