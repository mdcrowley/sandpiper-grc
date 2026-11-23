// Apple Push Notification service (APNs) over HTTP/2 with token-based authentication: the
// organization's .p8 signing key, its key id and team id; the topic is the app's bundle id.
// https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns
import { connect, constants, type ClientHttp2Session } from 'node:http2';
import type { KeyObject } from 'node:crypto';
import { PUSH_COLLAPSE_KEY, PUSH_ROUTE, type ApnsEnvironment } from '../../../../shared/push-api.ts';
import { pushEndpoints } from './endpoints.ts';
import { signJwt } from './jwt.ts';
import { parseRetryAfter, temporaryStatus } from './retry.ts';
import type { PushMessage, SendOutcome } from './types.ts';

export interface ApnsCredentials { keyId: string; teamId: string; bundleId: string; key: KeyObject; fingerprint: string }

/** A device token as Apple gives it: hexadecimal (32 bytes today; up to 100 allowed for the future). */
export const APNS_TOKEN_RE = /^[0-9a-fA-F]{64,200}$/;

// Apple wants the provider token reused for up to an hour and refused when renewed more than once
// in 20 minutes, so one token per key is kept across runs and renewed after 50 minutes.
const tokens = new Map<string, { jwt: string; at: number }>();
const RENEW_MS = 50 * 60_000;

function providerToken(c: ApnsCredentials): string {
  const id = `${c.teamId}:${c.keyId}:${c.fingerprint}`;
  const found = tokens.get(id);
  if (found && Date.now() - found.at < RENEW_MS) return found.jwt;
  const jwt = signJwt({ alg: 'ES256', kid: c.keyId }, { iss: c.teamId, iat: Math.floor(Date.now() / 1000) }, c.key);
  tokens.set(id, { jwt, at: Date.now() });
  return jwt;
}

/** Forget a provider token Apple refused (it is made again at the next send). */
const forgetToken = (c: ApnsCredentials) => tokens.delete(`${c.teamId}:${c.keyId}:${c.fingerprint}`);

/** Reasons that mean this device token will never work again for this app: the registration is removed. */
const GONE = new Set(['BadDeviceToken', 'DeviceTokenNotForTopic', 'Unregistered', 'ExpiredToken']);
/** Reasons that mean the key, team or topic is wrong: an administrator must fix the settings. */
const SETTINGS = new Set(['InvalidProviderToken', 'MissingProviderToken', 'ExpiredProviderToken', 'BadCertificate', 'BadCertificateEnvironment', 'TopicDisallowed', 'BadTopic', 'Forbidden']);

export function apnsPayload(m: PushMessage): string {
  return JSON.stringify({
    aps: { alert: { title: m.title, body: m.body }, badge: m.count, sound: 'default' },
    kind: 'unread', count: m.count, route: PUSH_ROUTE,
  });
}

/** One APNs connection per environment for a delivery run; close() ends them. */
export function apnsClient(c: ApnsCredentials) {
  const sessions = new Map<ApnsEnvironment, ClientHttp2Session>();
  const sessionFor = (env: ApnsEnvironment) => {
    let s = sessions.get(env);
    if (!s || s.closed || s.destroyed) {
      s = connect(pushEndpoints().apns[env]);
      s.on('error', () => sessions.delete(env));
      sessions.set(env, s);
    }
    return s;
  };

  async function send(token: string, env: ApnsEnvironment, m: PushMessage): Promise<SendOutcome> {
    if (!APNS_TOKEN_RE.test(token)) return { ok: false, gone: true, message: 'Not an Apple device token.' };
    const timeoutMs = pushEndpoints().timeoutMs;
    const answer = await new Promise<{ status: number; body: string; retryAfter?: unknown }>((resolve, reject) => {
      let req;
      try {
        req = sessionFor(env).request({
          [constants.HTTP2_HEADER_METHOD]: 'POST',
          [constants.HTTP2_HEADER_PATH]: `/3/device/${token.toLowerCase()}`,
          authorization: `bearer ${providerToken(c)}`,
          'apns-topic': c.bundleId,
          'apns-push-type': 'alert',
          'apns-priority': '10',
          'apns-collapse-id': PUSH_COLLAPSE_KEY,
          'apns-expiration': String(Math.floor(Date.now() / 1000) + 86_400),
          'content-type': 'application/json',
        });
      } catch (err) {
        reject(err);
        return;
      }
      let status = 0;
      let body = '';
      let retryAfter: unknown;
      req.setEncoding('utf8');
      req.on('response', (h) => { status = Number(h[constants.HTTP2_HEADER_STATUS] ?? 0); retryAfter = h['retry-after']; });
      req.on('data', (d: string) => { if (body.length < 4000) body += d; });
      req.on('end', () => resolve({ status, body, retryAfter }));
      req.on('error', reject);
      req.setTimeout(timeoutMs, () => {
        req.close(constants.NGHTTP2_CANCEL);
        reject(new Error('Apple\'s push service did not answer in time.'));
      });
      req.end(apnsPayload(m));
    }).catch((err: Error) => ({ status: 0, body: err.message, retryAfter: undefined }));

    if (answer.status === 200) return { ok: true };
    let reason = '';
    try {
      reason = String((JSON.parse(answer.body) as { reason?: string }).reason ?? '');
    } catch {
      reason = '';
    }
    // Not reached, or no answer in time: tried again later.
    if (answer.status === 0) return { ok: false, gone: false, temporary: true, message: `Apple's push service could not be reached: ${answer.body.slice(0, 200)}` };
    if (answer.status === 410 || GONE.has(reason)) return { ok: false, gone: true, message: `Apple no longer accepts this phone's token (${reason || answer.status}).` };
    if (answer.status === 403 || SETTINGS.has(reason)) {
      forgetToken(c);
      return { ok: false, gone: false, settings: true, message: `Apple refused the push settings (${reason || answer.status}): check the key, key id, team id and bundle id.` };
    }
    const message = `Apple's push service answered ${answer.status}${reason ? ` (${reason})` : ''}.`;
    // 429 TooManyRequests is about this one device token; 500 and 503 (ServiceUnavailable, Shutdown)
    // are about the service, so the rest of the run leaves Apple alone too.
    if (temporaryStatus(answer.status)) {
      return { ok: false, gone: false, temporary: true, retryAfterSeconds: parseRetryAfter(answer.retryAfter), pauseService: answer.status >= 500, message };
    }
    return { ok: false, gone: false, message };
  }

  function close() {
    for (const s of sessions.values()) s.close();
    sessions.clear();
  }

  return { send, close };
}
