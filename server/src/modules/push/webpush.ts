// UnifiedPush on Android: Web Push (RFC 8030) to the endpoint the phone's distributor gave, the
// message encrypted for the phone (RFC 8291, aes128gcm, RFC 8188) and the server identified with
// VAPID (RFC 8292). The endpoint must be on the administrator's list of push servers; the connection
// is checked like every other outbound one (core/webhooks.ts: private addresses only when listed
// exactly, redirects never followed).
import { createCipheriv, createDecipheriv, createECDH, hkdfSync, randomBytes, type KeyObject } from 'node:crypto';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { AddressBlockedError, checkedLookup, hostAllowed, literalRefusal } from '../../core/webhooks.ts';
import { PUSH_COLLAPSE_KEY, PUSH_ROUTE } from '../../../../shared/push-api.ts';
import { pushEndpoints } from './endpoints.ts';
import { signJwt } from './jwt.ts';
import { parseRetryAfter, temporaryStatus } from './retry.ts';
import type { PushMessage, SendOutcome } from './types.ts';

export interface UnifiedPushCredentials {
  allowedHosts: string[];
  contact: string;
  vapidKey: KeyObject;
  /** base64url of the uncompressed public point. */
  vapidPublicKey: string;
}

export interface WebPushTarget { endpoint: string; p256dh: string; auth: string }

const RECORD_SIZE = 4096;

// ---------- RFC 8291 message encryption ----------

/**
 * Encrypts one message for a subscriber: `uaPublic` is its P-256 public key (65 bytes), `authSecret`
 * its 16-byte authentication secret. `fixed` is for tests only (the RFC's example keys and salt).
 */
export function encryptWebPush(plaintext: Buffer, uaPublic: Buffer, authSecret: Buffer, fixed?: { asPrivate: Buffer; salt: Buffer }): Buffer {
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('The phone\'s public key is not an uncompressed P-256 point.');
  if (authSecret.length !== 16) throw new Error('The phone\'s authentication secret is not 16 bytes.');
  const ecdh = createECDH('prime256v1');
  if (fixed) ecdh.setPrivateKey(fixed.asPrivate);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const salt = fixed?.salt ?? randomBytes(16);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'latin1'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'latin1'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0', 'latin1'), 12));
  // One record: the message followed by the last-record delimiter 0x02 (no padding).
  if (plaintext.length + 17 > RECORD_SIZE) throw new Error('The message is too long for one record.');
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

/** The phone's side (used by tests and the fake push server): decrypts one aes128gcm message. */
export function decryptWebPush(message: Buffer, uaPrivate: Buffer, authSecret: Buffer): Buffer {
  const salt = message.subarray(0, 16);
  const idLength = message.readUInt8(20);
  const asPublic = message.subarray(21, 21 + idLength);
  const body = message.subarray(21 + idLength);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(uaPrivate);
  const uaPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'latin1'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'latin1'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0', 'latin1'), 12));
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(body.subarray(body.length - 16));
  const plain = Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]);
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end -= 1; // padding
  if (plain[end] !== 2) throw new Error('Not a last record.');
  return plain.subarray(0, end);
}

// ---------- checks of what a phone sends ----------

const B64URL_RE = /^[A-Za-z0-9_-]+={0,2}$/;

/** Why a UnifiedPush registration is refused, or null when it may be used. */
export function targetRefusal(t: WebPushTarget, allowedHosts: string[]): string | null {
  let url: URL;
  try {
    url = new URL(t.endpoint);
  } catch {
    return 'The push address is not a web address.';
  }
  if (t.endpoint.length > 1000) return 'The push address is too long.';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && pushEndpoints().unifiedpushAllowHttp)) return 'The push address must start with https://.';
  if (url.username || url.password || url.hash) return 'The push address may not carry a user name or a fragment.';
  if (!hostAllowed(url, allowedHosts)) return `The push server ${url.host} is not on this server's list of UnifiedPush servers. Ask your administrator.`;
  if (!B64URL_RE.test(t.p256dh) || Buffer.from(t.p256dh, 'base64url').length !== 65) return 'The phone\'s public key is not a P-256 key.';
  if (!B64URL_RE.test(t.auth) || Buffer.from(t.auth, 'base64url').length !== 16) return 'The phone\'s authentication secret is not 16 bytes.';
  return null;
}

// ---------- sending ----------

/** The VAPID header value for one push server (RFC 8292): a token for its origin, valid 12 hours. */
export function vapidAuthorization(endpoint: URL, c: UnifiedPushCredentials): string {
  const claims: Record<string, unknown> = { aud: endpoint.origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600 };
  if (c.contact) claims.sub = c.contact;
  return `vapid t=${signJwt({ typ: 'JWT', alg: 'ES256' }, claims, c.vapidKey)}, k=${c.vapidPublicKey}`;
}

export function webPushPayload(m: PushMessage): Buffer {
  return Buffer.from(JSON.stringify({ title: m.title, body: m.body, kind: 'unread', count: m.count, route: PUSH_ROUTE }), 'utf8');
}

function post(url: URL, body: Buffer, headers: Record<string, string>, allowList: string[], timeoutMs: number): Promise<{ status: number; retryAfter?: unknown }> {
  return new Promise((resolve, reject) => {
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    const blocked = literalRefusal(url.hostname, port, allowList);
    if (blocked) { reject(blocked); return; }
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = send(url, {
      method: 'POST', lookup: checkedLookup(port, allowList), timeout: timeoutMs,
      headers: { ...headers, 'content-length': String(body.length) },
    }, (res: IncomingMessage) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode ?? 0, retryAfter: res.headers['retry-after'] }));
      res.on('error', reject);
    });
    const timer = setTimeout(() => req.destroy(new Error('The push server did not answer in time.')), timeoutMs);
    timer.unref?.();
    req.on('timeout', () => req.destroy(new Error('The push server did not answer in time.')));
    req.on('error', (err) => { clearTimeout(timer); reject(err); });
    req.on('close', () => clearTimeout(timer));
    req.end(body);
  });
}

export function unifiedPushClient(c: UnifiedPushCredentials) {
  async function send(t: WebPushTarget, m: PushMessage): Promise<SendOutcome> {
    const refusal = targetRefusal(t, c.allowedHosts);
    if (refusal) return { ok: false, gone: true, message: refusal };
    const url = new URL(t.endpoint);
    const body = encryptWebPush(webPushPayload(m), Buffer.from(t.p256dh, 'base64url'), Buffer.from(t.auth, 'base64url'));
    let status: number;
    let retryAfter: unknown;
    try {
      ({ status, retryAfter } = await post(url, body, {
        'content-type': 'application/octet-stream', 'content-encoding': 'aes128gcm',
        ttl: '86400', urgency: 'high', topic: PUSH_COLLAPSE_KEY,
        authorization: vapidAuthorization(url, c),
      }, c.allowedHosts, pushEndpoints().timeoutMs));
    } catch (err) {
      // An address this server may not reach stays refused; anything else (no answer, a refused
      // connection, a name that did not resolve) is tried again later.
      const blocked = err instanceof AddressBlockedError;
      return { ok: false, gone: false, temporary: !blocked, message: `The UnifiedPush server could not be reached: ${(err as Error).message.slice(0, 200)}` };
    }
    if (status >= 200 && status < 300) return { ok: true };
    if (status === 404 || status === 410) return { ok: false, gone: true, message: `The UnifiedPush server no longer knows this phone (${status}).` };
    if (status === 401 || status === 403) return { ok: false, gone: false, settings: true, message: `The UnifiedPush server refused this server's key (${status}).` };
    // 429 and 5xx: wait (as long as the push server says), and leave that push server alone for the rest of the run.
    if (temporaryStatus(status)) {
      return { ok: false, gone: false, temporary: true, retryAfterSeconds: parseRetryAfter(retryAfter), pauseService: true, message: `The UnifiedPush server answered ${status}.` };
    }
    return { ok: false, gone: false, message: `The UnifiedPush server answered ${status}.` };
  }
  return { send };
}
