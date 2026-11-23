// Outbound calls to identity providers. Made only for a provider an administrator has switched on,
// when an administrator selects "Test connection", or when an administrator fetches SAML metadata
// by address (outbound connections on, host allowed: providers.ts). HTTPS only, except to this machine's own
// loopback address (for a provider run locally, and for tests). Redirects are never followed, each
// call times out, and answers are size-limited.
//
// Fenced like webhooks (W17-6): the host name is resolved when the connection is made, and a private,
// loopback, link-local or otherwise non-public address is refused unless that exact address (or
// address:port) is on the allowed hosts (`integrations.allowed_hosts`, Administration > Settings), so a
// provider address cannot be pointed at an internal service. A provider run on this machine or on the
// inside network is therefore allowed by listing its address there, for example "127.0.0.1:8443" or
// "10.20.0.5". The list is read through `setProviderAllowList` (registered by the sign-in routes).
import type { IncomingMessage } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { AddressBlockedError, checkedLookup, literalRefusal } from '../webhooks.ts';
import { IdentityError } from './types.ts';

export const TIMEOUT_MS = 10_000;
const MAX_BYTES = 512 * 1024;

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Where the allowed hosts come from (the application's settings); none until registered. */
let allowList: () => Promise<unknown> = async () => [];

/** Registers how the allowed hosts are read (`integrations.allowed_hosts`). Called once by the sign-in routes. */
export function setProviderAllowList(read: () => Promise<unknown>): void {
  allowList = read;
}

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

interface Answer { status: number; contentLength: number; text: string }

/**
 * One call to a provider: the address checks above, every resolved address checked against the
 * private-address fence, certificates verified, no redirects, the whole exchange limited to
 * TIMEOUT_MS and the answer to `maxBytes`.
 */
async function call(
  raw: string, what: string, init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string }, maxBytes: number,
): Promise<Answer> {
  assertAddress(raw, what);
  const url = new URL(raw);
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  const allowed = await allowList();
  const blocked = (err: AddressBlockedError) => new IdentityError(`${what} blocked: ${err.message}`,
    `The ${what} is at a private, loopback or reserved address, which sign-in providers may not use unless an administrator `
    + 'adds that exact address to the allowed hosts (Administration > Settings, integrations.allowed_hosts).');
  const literal = literalRefusal(url.hostname, port, allowed);
  if (literal) throw blocked(literal);
  return new Promise<Answer>((resolve, reject) => {
    const https = url.protocol === 'https:';
    const send = https ? httpsRequest : httpRequest;
    const body = init.body === undefined ? undefined : Buffer.from(init.body);
    let settled = false;
    const done = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };
    const req = send(url, {
      method: init.method, lookup: checkedLookup(port, allowed), timeout: TIMEOUT_MS,
      ...(https ? { rejectUnauthorized: true } : {}),
      headers: { ...init.headers, ...(body ? { 'content-length': String(body.length) } : {}) },
    }, (res: IncomingMessage) => {
      const status = res.statusCode ?? 0;
      const contentLength = Number(res.headers['content-length'] ?? 0);
      if (status >= 300 && status < 400) {
        res.resume();
        done(() => reject(new IdentityError(`${what} redirected`, `The ${what} answered with a redirect, which is not followed. Check the address.`)));
        return;
      }
      const tooLarge = () => new IdentityError(`${what} answer too large`, `The ${what} answer is larger than ${Math.round(maxBytes / 1024)} KB.`);
      if (contentLength > maxBytes) { res.destroy(); done(() => reject(tooLarge())); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) { res.destroy(); done(() => reject(tooLarge())); return; }
        chunks.push(c);
      });
      res.on('end', () => done(() => resolve({ status, contentLength, text: Buffer.concat(chunks).toString('utf8') })));
      res.on('error', (err) => done(() => reject(err)));
    });
    const timer = setTimeout(() => req.destroy(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), TIMEOUT_MS);
    timer.unref?.();
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { name: 'TimeoutError' })));
    req.on('error', (err) => done(() => {
      if (err instanceof AddressBlockedError || (err as { code?: string }).code === 'GRC_ADDRESS_BLOCKED') { reject(blocked(err as AddressBlockedError)); return; }
      const timedOut = (err as Error)?.name === 'TimeoutError';
      reject(new IdentityError(`${what} ${timedOut ? 'timed out' : 'could not be reached'}`,
        `The ${what} ${timedOut ? `did not answer within ${TIMEOUT_MS / 1000} seconds` : 'could not be reached'}.`));
    }));
    req.end(body);
  });
}

/** Calls an address and returns its JSON answer. Throws IdentityError with a plain reason. */
export async function fetchJson(
  url: string, what: string,
  init: { method?: 'GET' | 'POST'; headers?: Record<string, string>; form?: Record<string, string> } = {},
): Promise<{ status: number; json: any }> {
  const res = await call(url, what, {
    method: init.method ?? 'GET',
    headers: {
      accept: 'application/json',
      ...(init.form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      ...init.headers,
    },
    body: init.form ? new URLSearchParams(init.form).toString() : undefined,
  }, MAX_BYTES);
  let json: any = null;
  try {
    json = res.text ? JSON.parse(res.text) : null;
  } catch {
    throw new IdentityError(`${what} answer not JSON`, `The ${what} did not answer with JSON (status ${res.status}).`);
  }
  return { status: res.status, json };
}

/**
 * Fetches a text document (SAML metadata, E02-10), with the same rules: https only, no redirects,
 * a time limit, at most `maxBytes`. The caller decides first whether the call may be made at all.
 */
export async function fetchText(url: string, what: string, maxBytes = 1024 * 1024): Promise<string> {
  const res = await call(url, what, { method: 'GET', headers: { accept: 'application/samlmetadata+xml, application/xml, text/xml' } }, maxBytes);
  if (res.status !== 200) throw new IdentityError(`${what} answered ${res.status}`, `The ${what} answered with status ${res.status}.`);
  return res.text;
}
