// Registering this phone for push notifications (E38-14), as plain logic with its dependencies passed
// in, so it is tested without a phone. index.ts wires it to expo-notifications and the server.
//
// iPhone: Apple's push service with the native device token. Android: Firebase Cloud Messaging with the
// native token when the app was built with the organization's google-services.json; otherwise
// UnifiedPush through a distributor app, when the app carries the UnifiedPush connector. Never Expo's
// push service: the token goes only to the organization's own server.
import type { PushProvider, PushRegistrationInput, PushStatus } from '../../../shared/push-api.ts';

/** A UnifiedPush distributor app on the phone (its package name and its name as the phone shows it). */
export interface Distributor { id: string; name: string }

/**
 * The app's UnifiedPush connector: the native module SandpiperUnifiedPush
 * (mobile/modules/sandpiper-unifiedpush), present only in Android builds.
 */
export interface UnifiedPushConnector {
  /**
   * Asks the person's distributor for an endpoint tied to the server's VAPID key; resolves with it and
   * the RFC 8291 message keys the connector made on this phone. The first time, the distributor set as
   * default (or the only one) is used, or the phone asks the person to choose. Rejects with code
   * ERR_NO_DISTRIBUTOR when none is installed or chosen.
   */
  register(vapidPublicKey: string): Promise<{ endpoint: string; p256dh: string; auth: string }>;
  unregister(): Promise<void>;
  /** Distributor apps installed on the phone. */
  distributors?(): Distributor[];
  /** The distributor in use, if one has been chosen. */
  currentDistributor?(): Distributor | null;
  /** Lets the person choose another distributor (the phone's own screen); true when one was chosen. */
  pickDistributor?(): Promise<boolean>;
  /** Whether the app was opened by tapping a UnifiedPush notification (asked once at start). */
  takeOpened?(): boolean;
  /** onNewEndpoint: the distributor gave a new address (register again); onUnregistered; onOpened: a push was tapped. */
  addListener?(event: 'onNewEndpoint' | 'onUnregistered' | 'onOpened', listener: (payload: unknown) => void): { remove(): void };
}

/** The error code the connector rejects with when the phone has no UnifiedPush distributor app (or none was chosen). */
export const NO_DISTRIBUTOR = 'ERR_NO_DISTRIBUTOR';

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
  /**
   * unavailable: the server or this build cannot push to this phone; no-distributor: UnifiedPush would work
   * but the phone has no distributor app (or the person chose none); failed: something went wrong (try again later).
   */
  | { ok: false; reason: 'unavailable' | 'no-distributor' | 'failed'; message?: string };

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
    let sub: { endpoint: string; p256dh: string; auth: string };
    try {
      sub = await deps.unifiedPush.register(status.vapidPublicKey);
    } catch (e) {
      if ((e as { code?: string })?.code === NO_DISTRIBUTOR) return { ok: false, reason: 'no-distributor', message: (e as Error)?.message };
      return { ok: false, reason: 'failed', message: (e as Error)?.message };
    }
    try {
      // Only the three values the server wants, whatever else the connector returns.
      await deps.register({ provider: 'unifiedpush', endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth });
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
