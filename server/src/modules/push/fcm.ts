// Firebase Cloud Messaging HTTP v1 for Android: the organization's service account signs an OAuth
// assertion (RFC 7523) exchanged for a short-lived access token, which sends each message.
// https://firebase.google.com/docs/cloud-messaging/send/v1-api
import type { KeyObject } from 'node:crypto';
import { PUSH_ANDROID_CHANNEL, PUSH_COLLAPSE_KEY, PUSH_ROUTE } from '../../../../shared/push-api.ts';
import { pushEndpoints } from './endpoints.ts';
import { signJwt } from './jwt.ts';
import type { PushMessage, SendOutcome } from './types.ts';

export interface FcmCredentials { projectId: string; clientEmail: string; key: KeyObject; fingerprint: string }

/** A registration token as Firebase gives it (opaque; letters, digits and `:-_`). */
export const FCM_TOKEN_RE = /^[A-Za-z0-9:_-]{20,4096}$/;

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const accessTokens = new Map<string, { token: string; expiresAt: number }>();
const cacheKey = (c: FcmCredentials) => `${c.clientEmail}:${c.fingerprint}`;

async function accessToken(c: FcmCredentials): Promise<string> {
  const found = accessTokens.get(cacheKey(c));
  if (found && found.expiresAt - 60_000 > Date.now()) return found.token;
  const e = pushEndpoints();
  const iat = Math.floor(Date.now() / 1000);
  const assertion = signJwt({ alg: 'RS256', typ: 'JWT' }, { iss: c.clientEmail, scope: SCOPE, aud: e.googleToken, iat, exp: iat + 3600 }, c.key);
  const res = await fetch(e.googleToken, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(e.timeoutMs),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    throw Object.assign(new Error(`Google refused the service account (${body.error ?? res.status}${body.error_description ? `: ${body.error_description.slice(0, 200)}` : ''}).`), { settings: res.status === 400 || res.status === 401 || res.status === 403 });
  }
  accessTokens.set(cacheKey(c), { token: body.access_token, expiresAt: Date.now() + Math.max(60, Number(body.expires_in) || 3600) * 1000 });
  return body.access_token;
}

export function fcmBody(token: string, m: PushMessage) {
  return {
    message: {
      token,
      notification: { title: m.title, body: m.body },
      data: { kind: 'unread', count: String(m.count), route: PUSH_ROUTE },
      android: {
        priority: 'HIGH', collapse_key: PUSH_COLLAPSE_KEY, ttl: '86400s',
        notification: { tag: PUSH_COLLAPSE_KEY, channel_id: PUSH_ANDROID_CHANNEL, notification_count: m.count },
      },
    },
  };
}

export function fcmClient(c: FcmCredentials) {
  async function send(token: string, m: PushMessage): Promise<SendOutcome> {
    if (!FCM_TOKEN_RE.test(token)) return { ok: false, gone: true, message: 'Not a Firebase registration token.' };
    const e = pushEndpoints();
    let bearer: string;
    try {
      bearer = await accessToken(c);
    } catch (err) {
      return { ok: false, gone: false, settings: Boolean((err as { settings?: boolean }).settings), message: (err as Error).message };
    }
    let res: Response;
    try {
      res = await fetch(`${e.fcm}/v1/projects/${encodeURIComponent(c.projectId)}/messages:send`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(e.timeoutMs),
        headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
        body: JSON.stringify(fcmBody(token, m)),
      });
    } catch (err) {
      return { ok: false, gone: false, message: `Firebase Cloud Messaging could not be reached: ${(err as Error).message.slice(0, 200)}` };
    }
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as { error?: { status?: string; message?: string; details?: { errorCode?: string }[] } };
    const code = body.error?.details?.find((d) => d.errorCode)?.errorCode ?? body.error?.status ?? '';
    const message = String(body.error?.message ?? '').slice(0, 200);
    if (res.status === 404 || code === 'UNREGISTERED' || (code === 'INVALID_ARGUMENT' && /registration token/i.test(message))) {
      return { ok: false, gone: true, message: `Firebase no longer accepts this phone's token (${code || res.status}).` };
    }
    if (res.status === 401 || res.status === 403 || code === 'SENDER_ID_MISMATCH' || code === 'THIRD_PARTY_AUTH_ERROR') {
      accessTokens.delete(cacheKey(c));
      return { ok: false, gone: false, settings: true, message: `Firebase refused the push settings (${code || res.status}): check the service account and its project.` };
    }
    return { ok: false, gone: false, message: `Firebase Cloud Messaging answered ${res.status}${code ? ` (${code})` : ''}.` };
  }
  return { send };
}
