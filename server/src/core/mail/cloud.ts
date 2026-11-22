// What the mail services' web interfaces (E14-25: Microsoft Graph, the Gmail API) share: the fixed
// addresses they are reached at, HTTPS calls with a time-out and no redirects, a cache of access
// tokens, signed JSON Web Tokens, and the message built as MIME so that every header the
// application sets (threading, Auto-Submitted, X-GRC-Mail) reaches the recipient unchanged.
//
// These are outbound connections, made only for the provider an administrator chose (or for the
// email-to-ticket mailbox they chose), and only to the provider's own published addresses: the
// addresses are fixed here, never taken from settings or from an uploaded key file. Tests point
// them at a stand-in server on this machine with `setCloudEndpointsForTests`.
import { createHash, createPrivateKey, createSign, X509Certificate, type KeyObject } from 'node:crypto';
import nodemailer from 'nodemailer';
import { nodemailerAttachment, type OutgoingMessage } from './provider.ts';

export const TIMEOUT_MS = 20_000;
/** A received message read through the API, with room for its encoding. */
const MAX_ANSWER_BYTES = 45 * 1024 * 1024;

/** Microsoft's national clouds: GCC uses the worldwide addresses; GCC High and DoD have their own. */
export const MICROSOFT_CLOUDS = {
  global: { label: 'Worldwide (including GCC)', login: 'https://login.microsoftonline.com', graph: 'https://graph.microsoft.com' },
  usgov: { label: 'US Government (GCC High)', login: 'https://login.microsoftonline.us', graph: 'https://graph.microsoft.us' },
  usgov_dod: { label: 'US Government (DoD)', login: 'https://login.microsoftonline.us', graph: 'https://dod-graph.microsoft.us' },
} as const;
export type MicrosoftCloud = keyof typeof MICROSOFT_CLOUDS;
const GOOGLE = { token: 'https://oauth2.googleapis.com/token', gmail: 'https://gmail.googleapis.com' };

interface TestEndpoints { microsoftLogin?: string; graph?: string; googleToken?: string; gmail?: string }
let testEndpoints: TestEndpoints | null = null;

/** Tests only: send every call to a stand-in on this machine (plain http to 127.0.0.1 or localhost). `null` restores the real addresses. */
export function setCloudEndpointsForTests(e: TestEndpoints | null): void {
  for (const url of Object.values(e ?? {})) {
    const u = new URL(url);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) throw new Error('Test endpoints must be on this machine.');
  }
  testEndpoints = e;
  tokens.clear();
}

export function microsoftEndpoints(cloud: string): { login: string; graph: string } {
  const c = MICROSOFT_CLOUDS[(cloud in MICROSOFT_CLOUDS ? cloud : 'global') as MicrosoftCloud];
  return { login: testEndpoints?.microsoftLogin ?? c.login, graph: testEndpoints?.graph ?? c.graph };
}
export function googleEndpoints(): { token: string; gmail: string } {
  return { token: testEndpoints?.googleToken ?? GOOGLE.token, gmail: testEndpoints?.gmail ?? GOOGLE.gmail };
}

/** A failed call, in words an administrator can act on. Never contains a secret. */
export class CloudError extends Error {
  /** Seconds the service asked to wait before the next attempt (Retry-After), when it said. */
  retryAfterSeconds?: number;
  constructor(message: string, readonly retryable: boolean, readonly status = 0) { super(message); }
}

/** The "throttled" error, carrying the wait the service asked for (E14-30). */
export function throttledError(headers: Headers, status: number): CloudError {
  const err = new CloudError(throttledText(headers), true, status);
  const wait = retryAfter(headers);
  if (wait !== null) err.retryAfterSeconds = wait;
  return err;
}

export interface CloudAnswer { status: number; headers: Headers; body: Buffer; json: any }

/** One HTTPS call. Throws CloudError when the service cannot be reached, redirects, or answers too much. */
export async function cloudFetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: string | Buffer }, what: string): Promise<CloudAnswer> {
  const u = new URL(url);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback && testEndpoints)) throw new CloudError(`${what}: only https addresses are called.`, false);
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? 'GET', headers: { accept: 'application/json', ...init.headers },
      body: init.body as RequestInit['body'], redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = (err as Error)?.name === 'TimeoutError';
    throw new CloudError(`${what} ${timedOut ? `did not answer within ${TIMEOUT_MS / 1000} seconds` : `could not be reached (${u.host})`}.`, true);
  }
  if (res.status >= 300 && res.status < 400) {
    throw new CloudError(`${what} answered with a redirect (${res.status}), which is not followed.`, false, res.status);
  }
  const length = Number(res.headers.get('content-length') ?? 0);
  if (length > MAX_ANSWER_BYTES) throw new CloudError(`${what} answered with more than ${MAX_ANSWER_BYTES / 1024 / 1024} MB.`, false, res.status);
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > MAX_ANSWER_BYTES) throw new CloudError(`${what} answered with more than ${MAX_ANSWER_BYTES / 1024 / 1024} MB.`, false, res.status);
  let json: any = null;
  if (/json/i.test(res.headers.get('content-type') ?? '') && body.length) {
    try { json = JSON.parse(body.toString('utf8')); } catch { json = null; }
  }
  return { status: res.status, headers: res.headers, body, json };
}

/** "Retry-After" in seconds, when the service gave one. */
export function retryAfter(headers: Headers): number | null {
  const v = headers.get('retry-after');
  if (!v) return null;
  const n = Number(v);
  if (Number.isFinite(n)) return Math.max(0, Math.round(n));
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, Math.round((at - Date.now()) / 1000)) : null;
}

export const throttledText = (headers: Headers) => {
  const s = retryAfter(headers);
  return `The mail service is busy or limiting how fast messages are sent (throttled)${s !== null ? `; it asked to wait ${s} seconds` : ''}. The message will be tried again later.`;
};

// ---------- access tokens ----------

const tokens = new Map<string, { token: string; expires: number }>();
export const cacheKey = (...parts: string[]) => createHash('sha256').update(parts.join('\u0000')).digest('hex');

/** An access token, reused until a minute before it expires. */
export async function cachedToken(key: string, fetchToken: () => Promise<{ token: string; expiresIn: number }>): Promise<string> {
  const known = tokens.get(key);
  if (known && known.expires > Date.now() + 60_000) return known.token;
  const t = await fetchToken();
  tokens.set(key, { token: t.token, expires: Date.now() + Math.max(60, t.expiresIn || 3600) * 1000 });
  if (tokens.size > 50) tokens.delete(tokens.keys().next().value!);
  return t.token;
}
export const forgetToken = (key: string) => { tokens.delete(key); };

// ---------- signed tokens ----------

const b64url = (v: Buffer | string) => Buffer.from(v).toString('base64url');

/** A JSON Web Token signed with RS256. */
export function signJwt(header: Record<string, unknown>, claims: Record<string, unknown>, key: KeyObject | string): string {
  const input = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', ...header }))}.${b64url(JSON.stringify(claims))}`;
  const signature = createSign('RSA-SHA256').update(input).sign(key);
  return `${input}.${b64url(signature)}`;
}

function rsaKey(pem: string, what: string): KeyObject {
  if (/-----BEGIN ENCRYPTED PRIVATE KEY-----/.test(pem)) throw new Error(`The ${what} is protected with a passphrase. Export it without one; it is kept encrypted here.`);
  let key: KeyObject;
  try {
    key = createPrivateKey(pem);
  } catch {
    throw new Error(`The ${what} could not be read. Paste the whole PEM text, including the BEGIN and END lines.`);
  }
  if (key.asymmetricKeyType !== 'rsa') throw new Error(`The ${what} must be an RSA key.`);
  return key;
}

export interface CertificateCredential { key: KeyObject; x5t: string; thumbprint: string; expires: string }

/**
 * A certificate and its private key, pasted together as PEM text (the certificate uploaded to the
 * app registration, and its key). Throws an Error with a plain reason.
 */
export function readCertificate(pem: string): CertificateCredential {
  const certPem = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/.exec(pem)?.[0];
  const keyPem = /-----BEGIN (?:RSA |ENCRYPTED )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |ENCRYPTED )?PRIVATE KEY-----/.exec(pem)?.[0];
  if (!certPem || !keyPem) throw new Error('Paste the certificate and its private key together as PEM text (both BEGIN CERTIFICATE and BEGIN PRIVATE KEY blocks).');
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(certPem);
  } catch {
    throw new Error('The certificate could not be read.');
  }
  const key = rsaKey(keyPem, 'private key');
  if (!cert.checkPrivateKey(key)) throw new Error('The private key does not belong to the certificate.');
  if (Date.parse(cert.validTo) < Date.now()) throw new Error(`The certificate expired on ${cert.validTo}.`);
  const sha1 = Buffer.from(cert.fingerprint.replace(/:/g, ''), 'hex');
  return { key, x5t: b64url(sha1), thumbprint: sha1.toString('hex').toUpperCase(), expires: new Date(cert.validTo).toISOString() };
}

export interface ServiceAccountKey { clientEmail: string; clientId: string; keyId: string; key: KeyObject }

/** A Google service account's JSON key file. Throws an Error with a plain reason. Its `token_uri` is never used. */
export function readServiceAccountKey(text: string): ServiceAccountKey {
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error('Paste the whole JSON key file of the service account.');
  }
  if (!j || j.type !== 'service_account') throw new Error('This is not a service account key (its "type" should be "service_account").');
  if (typeof j.client_email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(j.client_email)) throw new Error('The key file has no client_email.');
  if (typeof j.private_key !== 'string') throw new Error('The key file has no private_key.');
  return { clientEmail: j.client_email, clientId: String(j.client_id ?? ''), keyId: String(j.private_key_id ?? ''), key: rsaKey(j.private_key, 'key file\'s private key') };
}

// ---------- the message as MIME ----------

const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });

/** The whole message as MIME (with its Message-ID), as an SMTP server would receive it. */
export async function composeMime(m: OutgoingMessage): Promise<{ raw: Buffer; messageId: string }> {
  const info = await composer.sendMail({
    from: m.from, to: m.to, replyTo: m.replyTo || undefined, subject: m.subject, text: m.text, html: m.html, headers: m.headers,
    attachments: m.attachments?.map(nodemailerAttachment),
    disableUrlAccess: true, disableFileAccess: true,
  });
  return { raw: (info as unknown as { message: Buffer }).message, messageId: info.messageId };
}

/** The bare address in "Name <address>". */
export const bareAddress = (from: string) => (/<([^>]+)>\s*$/.exec(from)?.[1] ?? from).trim().toLowerCase();
