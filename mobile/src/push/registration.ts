// Registering this phone for push notifications (E38-14), as plain logic with its dependencies passed
// in, so it is tested without a phone. index.ts wires it to expo-notifications and the server.
//
// iPhone: Apple's push service with the native device token. Android: Firebase Cloud Messaging with the
// native token when the app was built with the organization's google-services.json; otherwise
// UnifiedPush through a distributor app, when the app carries the UnifiedPush connector. Never Expo's
// push service: the token goes only to the organization's own server.
import type { PushProvider, PushRegistrationInput, PushStatus } from '../../../shared/push-api.ts';

export interface UnifiedPushConnector {
  /** Asks the distributor for an endpoint tied to the server's VAPID key; resolves with it and the message keys. */
  register(vapidPublicKey: string): Promise<{ endpoint: string; p256dh: string; auth: string }>;
  unregister(): Promise<void>;
}

export interface RegistrationDeps {
  platform: 'ios' | 'android';
  /** A development build: Apple's sandbox environment. */
  dev: boolean;
  status(): Promise<PushStatus>;
  register(input: PushRegistrationInput): Promise<PushStatus>;
  /** The native APNs or FCM token (expo-notifications getDevicePushTokenAsync); throws when there is none. */
  deviceToken(): Promise<string>;
  /** Present only when the app was built with the UnifiedPush connector. */
  unifiedPush: UnifiedPushConnector | null;
}

export type RegisterResult =
  | { ok: true; provider: PushProvider }
  /** unavailable: the server or this build cannot push to this phone; failed: something went wrong (try again later). */
  | { ok: false; reason: 'unavailable' | 'failed'; message?: string };

/** The token in the form the server wants it (APNs tokens are sent as lower-case hexadecimal). */
export const normalizeToken = (provider: 'apns' | 'fcm', token: string) => (provider === 'apns' ? token.replace(/[<>\s]/g, '').toLowerCase() : token.trim());

/** Registers this phone with the first service that works for it. */
export async function registerPhone(deps: RegistrationDeps): Promise<RegisterResult> {
  let status: PushStatus;
  try {
    status = await deps.status();
  } catch (e) {
    return { ok: false, reason: 'failed', message: (e as Error)?.message };
  }
  if (!status.available) return { ok: false, reason: 'unavailable' };

  if (deps.platform === 'ios') {
    if (!status.providers.apns) return { ok: false, reason: 'unavailable' };
    try {
      const token = normalizeToken('apns', await deps.deviceToken());
      await deps.register({ provider: 'apns', token, environment: deps.dev ? 'sandbox' : 'production' });
      return { ok: true, provider: 'apns' };
    } catch (e) {
      return { ok: false, reason: 'failed', message: (e as Error)?.message };
    }
  }

  let lastError: string | undefined;
  if (status.providers.fcm) {
    try {
      // Fails at once in a build without google-services.json: then UnifiedPush is tried.
      const token = normalizeToken('fcm', await deps.deviceToken());
      await deps.register({ provider: 'fcm', token });
      return { ok: true, provider: 'fcm' };
    } catch (e) {
      lastError = (e as Error)?.message;
    }
  }
  if (status.providers.unifiedpush && status.vapidPublicKey && deps.unifiedPush) {
    try {
      const sub = await deps.unifiedPush.register(status.vapidPublicKey);
      await deps.register({ provider: 'unifiedpush', ...sub });
      return { ok: true, provider: 'unifiedpush' };
    } catch (e) {
      lastError = (e as Error)?.message;
    }
  }
  return lastError ? { ok: false, reason: 'failed', message: lastError } : { ok: false, reason: 'unavailable' };
}

/** Whether a tapped push should open the Notifications screen (every push this app gets does). */
export function opensNotifications(data: unknown): boolean {
  const d = data as { kind?: unknown; route?: unknown } | null | undefined;
  return !d || d.kind === 'unread' || d.route === '/notifications' || d.kind === undefined;
}
