// Client ID metadata documents (E21-21): a connector may use an https address as its client_id; the
// address serves a small JSON document describing it (draft-ietf-oauth-client-id-metadata-document,
// preferred by the 2025-11-25 MCP authorization specification).
//
// Fetching that document is an outbound connection chosen by whoever starts the sign-in, so it is
// fenced like webhooks (core/webhooks.ts) and more tightly:
// - https only, on port 443 unless the administrator's host list names another port for that host;
// - the name is resolved at connection time and every address is checked: private, loopback,
//   link-local and reserved addresses are refused unless that exact address is on the host list;
// - redirects are never followed; only a 200 answer with a JSON media type counts;
// - at most 5 KB is read, and the whole exchange is limited to 5 seconds;
// - no cookies or credentials are sent.
// The document must name the address as its client_id, list its redirect addresses, and carry only
// known registration fields (never a secret or private key material).
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import type { IncomingMessage, RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { addressRefusal, AddressBlockedError, hostAllowed } from '../../core/webhooks.ts';

export const MAX_DOCUMENT_BYTES = 5 * 1024;
export const FETCH_TIMEOUT_MS = 5_000;
export const MAX_CLIENT_ID_LENGTH = 400;
/** How long a fetched document is trusted: its Cache-Control max-age, kept within these bounds. */
export const CACHE_DEFAULT_SECONDS = 3600;
export const CACHE_MIN_SECONDS = 60;
export const CACHE_MAX_SECONDS = 86_400;

/** Fields a document may carry (RFC 7591 and the OpenID registration fields clients commonly send). */
const KNOWN_FIELDS = new Set([
  'client_id', 'client_name', 'client_uri', 'logo_uri', 'redirect_uris', 'grant_types', 'response_types',
  'token_endpoint_auth_method', 'scope', 'contacts', 'tos_uri', 'policy_uri', 'software_id', 'software_version',
  'jwks_uri', 'jwks', 'application_type', 'post_logout_redirect_uris',
]);
/** Human-readable fields may come in other languages (RFC 7591 2.2), for example client_name#fr. */
const LOCALIZED = /^(client_name|client_uri|logo_uri|tos_uri|policy_uri)#[A-Za-z0-9-]{1,35}$/;
/** Never in a metadata document: the client has no secret here, and keys must be public. */
const FORBIDDEN_FIELDS = ['client_secret', 'client_secret_expires_at'];
const PRIVATE_JWK_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'k', 'oth'];

/** True when a client_id is meant as a metadata document address (anything starting with https://). */
export const isUrlClientId = (clientId: unknown) => typeof clientId === 'string' && /^https:\/\//i.test(clientId);

/** Why a client_id cannot be a metadata document address (draft section 3), or null when it can. */
export function clientIdUrlProblem(raw: string): string | null {
  if (raw.length > MAX_CLIENT_ID_LENGTH) return `A client_id address may have at most ${MAX_CLIENT_ID_LENGTH} characters.`;
  let u: URL;
  try { u = new URL(raw); } catch { return 'The client_id is not a valid address.'; }
  if (u.protocol !== 'https:') return 'A client_id address must use https.';
  if (u.username || u.password) return 'A client_id address may not contain a user name or password.';
  if (raw.includes('#')) return 'A client_id address may not contain a fragment (#).';
  if (u.pathname === '/' || !u.pathname) return 'A client_id address must have a path, for example https://assistant.example.org/client.json.';
  // Dot segments are removed by the URL parser; refuse them in the original so the address is the document's own.
  if (/\/\.{1,2}(\/|$|\?)/.test(raw.replace(/^https:\/\/[^/]+/i, ''))) return 'A client_id address may not contain "." or ".." path segments.';
  if (u.href !== raw) return 'Write the client_id address in its normal form (lower-case scheme and host, no default port).';
  return null;
}

/** Seconds to keep a document, from its Cache-Control header. */
export function cacheSeconds(cacheControl: string | undefined): number {
  const cc = String(cacheControl ?? '').toLowerCase();
  if (/\b(no-store|no-cache)\b/.test(cc)) return CACHE_MIN_SECONDS;
  const m = /\b(?:s-maxage|max-age)\s*=\s*"?(\d+)/.exec(cc);
  const n = m ? Number(m[1]) : CACHE_DEFAULT_SECONDS;
  return Math.min(CACHE_MAX_SECONDS, Math.max(CACHE_MIN_SECONDS, Number.isFinite(n) ? n : CACHE_DEFAULT_SECONDS));
}

export class MetadataError extends Error {
  constructor(message: string, readonly reason: string) { super(message); this.name = 'MetadataError'; }
}

// ---------- test hooks ----------

type Resolver = (hostname: string, callback: (err: Error | null, addresses: LookupAddress[]) => void) => void;
interface TestHooks { ca?: string; resolve?: Resolver }
let hooks: TestHooks = {};
/** Tests only: trust a test certificate authority, or answer name lookups without DNS. */
export function setClientMetadataTestHooks(h: TestHooks | null): void { hooks = h ?? {}; }

const bare = (host: string) => host.replace(/^\[|\]$/g, '').toLowerCase();

/**
 * Fetches a client ID metadata document. `hostList` is the administrator's list of client id hosts;
 * besides narrowing hosts (checked by the caller), an exact address or `host:port` entry on it is
 * what allows a non-public address or another port.
 */
export function fetchClientMetadata(url: URL, hostList: string[], timeoutMs = FETCH_TIMEOUT_MS): Promise<{ body: Buffer; cacheControl: string | undefined }> {
  return new Promise((resolve, reject) => {
    const host = bare(url.hostname);
    const port = url.port || '443';
    if (url.protocol !== 'https:') { reject(new MetadataError('Only https addresses are fetched.', 'not_https')); return; }
    if (port !== '443' && !hostList.some((e) => String(e).trim().toLowerCase() === `${host}:${port}` || String(e).trim().toLowerCase() === `[${host}]:${port}`)) {
      reject(new MetadataError(`Port ${port} is not fetched unless the host list names ${url.host} with that port.`, 'port'));
      return;
    }
    if (isIP(host)) {
      const refusal = addressRefusal(host, host, port, hostList);
      if (refusal) { reject(new MetadataError(refusal.replace(/ Add that exact address.*$/, ''), 'private_address')); return; }
    }
    const lookup = ((hostname: string, options: { all?: boolean; family?: number } | undefined, callback: (...args: unknown[]) => void) => {
      const done = (err: Error | null, addresses: LookupAddress[]) => {
        if (err) { callback(err); return; }
        if (!addresses.length) { callback(new Error(`Host ${hostname} has no address.`)); return; }
        for (const a of addresses) {
          const refusal = addressRefusal(hostname, a.address, port, hostList);
          if (refusal) { callback(new AddressBlockedError(refusal)); return; }
        }
        if (options?.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      };
      if (hooks.resolve) hooks.resolve(hostname, done);
      else dnsLookup(hostname, { all: true, family: options?.family ?? 0 }, (err, addresses) => done(err, addresses as LookupAddress[]));
    }) as unknown as RequestOptions['lookup'];

    let settled = false;
    const finish = (err: Error | null, value?: { body: Buffer; cacheControl: string | undefined }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err); else resolve(value!);
    };
    const req = httpsRequest(url, {
      method: 'GET', lookup, timeout: timeoutMs, agent: false,
      headers: { accept: 'application/json', 'user-agent': 'sandpiper-grc-oauth/1', 'accept-encoding': 'identity' },
      ...(hooks.ca ? { ca: hooks.ca } : {}),
    }, (res: IncomingMessage) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) { res.resume(); req.destroy(); finish(new MetadataError(`The address answered with a redirect (${status}); redirects are not followed.`, 'redirect')); return; }
      if (status !== 200) { res.resume(); req.destroy(); finish(new MetadataError(`The address answered ${status} instead of 200.`, 'status')); return; }
      const type = String(res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (type !== 'application/json' && !/^application\/[a-z0-9.+-]+\+json$/.test(type)) {
        res.resume(); req.destroy(); finish(new MetadataError(`The document is served as "${type || 'no type'}", not as JSON.`, 'content_type')); return;
      }
      const declared = Number(res.headers['content-length']);
      if (Number.isFinite(declared) && declared > MAX_DOCUMENT_BYTES) { req.destroy(); finish(new MetadataError(`The document is larger than ${MAX_DOCUMENT_BYTES / 1024} KB.`, 'too_large')); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_DOCUMENT_BYTES) { req.destroy(); finish(new MetadataError(`The document is larger than ${MAX_DOCUMENT_BYTES / 1024} KB.`, 'too_large')); return; }
        chunks.push(c);
      });
      res.on('end', () => finish(null, { body: Buffer.concat(chunks), cacheControl: res.headers['cache-control'] as string | undefined }));
      res.on('error', (err) => finish(err));
    });
    // The whole exchange, not only each pause, is limited.
    const timer = setTimeout(() => { req.destroy(); finish(new MetadataError(`No complete answer within ${timeoutMs / 1000} seconds.`, 'timeout')); }, timeoutMs);
    timer.unref?.();
    req.on('timeout', () => { req.destroy(); finish(new MetadataError(`No complete answer within ${timeoutMs / 1000} seconds.`, 'timeout')); });
    req.on('error', (err: Error & { code?: string }) => {
      if (err instanceof AddressBlockedError || err.code === 'GRC_ADDRESS_BLOCKED') finish(new MetadataError(err.message.replace(/ Add that exact address.*$/, ''), 'private_address'));
      else if (/certificate|self.signed|unable to verify|ERR_TLS|CERT_/i.test(`${err.code ?? ''} ${err.message}`)) finish(new MetadataError('The address does not have a valid HTTPS certificate.', 'tls'));
      else finish(new MetadataError(`The address could not be reached (${err.code ?? err.message}).`, 'unreachable'));
    });
    req.end();
  });
}

/** What this server keeps from a valid document. */
export interface ClientMetadata {
  name: string;
  redirectUris: string[];
  clientUri: string | null;
  scope: string | null;
}

/**
 * Checks a fetched document against its address. `redirectProblem` and `parseScope` come from
 * oauth.ts (passed in to keep this file free of the OAuth routes).
 */
export function validateClientMetadata(
  body: Buffer, url: string, redirectProblem: (u: unknown) => string | null, parseScope: (s: unknown) => string[] | null,
): ClientMetadata {
  let doc: unknown;
  try { doc = JSON.parse(body.toString('utf8')); } catch { throw new MetadataError('The document is not valid JSON.', 'json'); }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new MetadataError('The document must be a JSON object.', 'json');
  const d = doc as Record<string, unknown>;
  if (d.client_id !== url) throw new MetadataError('The document\'s client_id is not exactly the address it was fetched from.', 'client_id_mismatch');
  for (const f of FORBIDDEN_FIELDS) if (f in d) throw new MetadataError(`A metadata document may not contain ${f}.`, 'forbidden_field');
  const unknown = Object.keys(d).filter((k) => !KNOWN_FIELDS.has(k) && !LOCALIZED.test(k));
  if (unknown.length) throw new MetadataError(`Unknown fields in the document: ${unknown.slice(0, 5).join(', ')}.`, 'unknown_field');
  const method = d.token_endpoint_auth_method;
  if (method !== undefined && method !== 'none') {
    throw new MetadataError(`token_endpoint_auth_method "${String(method).slice(0, 40)}" is not supported for these connectors; use "none" (with PKCE).`, 'auth_method');
  }
  if (d.jwks !== undefined) {
    const keys = (d.jwks as { keys?: unknown })?.keys;
    if (!Array.isArray(keys) || keys.some((k) => !k || typeof k !== 'object' || PRIVATE_JWK_MEMBERS.some((m) => m in (k as object)))) {
      throw new MetadataError('jwks must hold public keys only.', 'forbidden_field');
    }
  }
  if (typeof d.client_name !== 'string' || !d.client_name.trim()) throw new MetadataError('The document must give a client_name.', 'missing_field');
  const uris = d.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 10) throw new MetadataError('The document must list one to ten redirect_uris.', 'redirect_uris');
  for (const u of uris) {
    const p = redirectProblem(u);
    if (p) throw new MetadataError(p, 'redirect_uris');
  }
  const grants = d.grant_types ?? ['authorization_code'];
  if (!Array.isArray(grants) || !grants.length || grants.some((g) => !['authorization_code', 'refresh_token'].includes(String(g)))) {
    throw new MetadataError('grant_types may contain only authorization_code and refresh_token.', 'grant_types');
  }
  if (d.response_types !== undefined && (!Array.isArray(d.response_types) || d.response_types.some((r) => r !== 'code'))) {
    throw new MetadataError('response_types may contain only code.', 'response_types');
  }
  if (d.scope !== undefined && d.scope !== null && !parseScope(d.scope)) throw new MetadataError('scope may contain only mcp:read and mcp:write.', 'scope');
  let clientUri: string | null = null;
  if (typeof d.client_uri === 'string' && d.client_uri) {
    try {
      const u = new URL(d.client_uri);
      if (u.protocol !== 'https:') throw new Error('scheme');
      clientUri = u.href.slice(0, 300);
    } catch {
      throw new MetadataError('client_uri must be an https address.', 'client_uri');
    }
  }
  return {
    name: d.client_name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 100),
    redirectUris: [...new Set(uris.map(String))],
    clientUri,
    scope: typeof d.scope === 'string' && d.scope ? d.scope : null,
  };
}

/** Whether the client id's host is on the administrator's list (an empty list allows any public host). */
export const clientHostAllowed = (url: URL, hostList: string[]) => !hostList.length || hostAllowed(url, hostList);
