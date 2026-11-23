// Push notifications on the phone (E38-14): request and response shapes shared by the server
// (modules/push), the web application (Administration > Push notifications) and the app
// (mobile/src/push). Types, constants and the one message text only.
//
// A push never carries record details: only "You have N new notifications". The app opens its
// Notifications screen when the person taps it and fetches the rest from the server.

/** The push services the server can use. No Expo push service and no other relay. */
export const PUSH_PROVIDERS = ['apns', 'fcm', 'unifiedpush'] as const;
export type PushProvider = (typeof PUSH_PROVIDERS)[number];

/** Apple's two push environments: TestFlight and App Store builds use `production`, development builds `sandbox`. */
export type ApnsEnvironment = 'production' | 'sandbox';

/** The bundle identifier of the app (Apple's push topic) unless the organization builds its own copy. */
export const DEFAULT_APNS_BUNDLE_ID = 'com.sandpipergrc';

/** Where tapping a push goes in the app. */
export const PUSH_ROUTE = '/notifications';

/** Replaces an earlier push still on the lock screen (APNs collapse id, Android tag, Web Push topic). */
export const PUSH_COLLAPSE_KEY = 'grcunread';

/** The Android notification channel the app creates for pushes. */
export const PUSH_ANDROID_CHANNEL = 'notifications';

/** The only text a push carries. */
export function pushMessageText(count: number): string {
  const n = Math.max(1, Math.floor(count));
  return n === 1 ? 'You have 1 new notification' : `You have ${n} new notifications`;
}

/** The data a push carries besides its text (also the decrypted UnifiedPush message, with title and body). */
export interface PushData {
  kind: 'unread';
  count: number;
  route: typeof PUSH_ROUTE;
}

// ---------- the app: GET/PUT/DELETE /api/me/push (the app's own token only) ----------

/** `GET /api/me/push`: which services this server uses, and whether this phone is registered. */
export interface PushStatus {
  /** Push is set up for this platform at all. */
  available: boolean;
  providers: Record<PushProvider, boolean>;
  /** The server's UnifiedPush (VAPID) public key, base64url, when UnifiedPush is on. */
  vapidPublicKey: string | null;
  registered: boolean;
  provider: PushProvider | null;
}

/**
 * `PUT /api/me/push`: registers this phone. APNs (iPhone) and FCM (Android) send the native device
 * token from expo-notifications' getDevicePushTokenAsync; UnifiedPush (Android) sends the endpoint the
 * distributor gave and the message encryption keys (RFC 8291).
 */
export type PushRegistrationInput =
  | { provider: 'apns'; token: string; environment: ApnsEnvironment }
  | { provider: 'fcm'; token: string }
  | { provider: 'unifiedpush'; endpoint: string; p256dh: string; auth: string };

// ---------- Administration > Push notifications ----------

/** What the administrator sees: never a key, only whether one is stored and its fingerprint. */
export interface PushConfigView {
  apns: {
    enabled: boolean;
    keyId: string;
    teamId: string;
    bundleId: string;
    keySet: boolean;
    keyFingerprint: string | null;
  };
  fcm: {
    enabled: boolean;
    projectId: string;
    clientEmail: string;
    keySet: boolean;
    keyFingerprint: string | null;
  };
  unifiedpush: {
    enabled: boolean;
    /** Push servers phones may register with (`host`, `host:port`, `*.domain`). */
    allowedHosts: string[];
    vapidPublicKey: string | null;
    /** `mailto:` or `https:` contact sent to the push server (optional). */
    contact: string;
  };
  updatedAt: string | null;
}

/** Phones registered per service, and the latest delivery problem of each. */
export interface PushStats {
  registrations: Record<PushProvider, number>;
  failing: Record<PushProvider, number>;
  /** Phones whose last push failed for a while only (service unreachable, busy or 5xx) and waits to be tried again. */
  retrying: Record<PushProvider, number>;
  lastError: Record<PushProvider, { message: string; at: string } | null>;
  lastSentAt: string | null;
}

/** `PUT /api/push/admin/config`: each part optional; a key is replaced only when a new one is given. */
export interface PushConfigInput {
  apns?: { enabled?: boolean; keyId?: string; teamId?: string; bundleId?: string; key?: string; removeKey?: boolean };
  /** `serviceAccount`: the service account file's JSON text, as downloaded from the Firebase console. */
  fcm?: { enabled?: boolean; serviceAccount?: string; removeKey?: boolean };
  unifiedpush?: { enabled?: boolean; allowedHosts?: string[]; contact?: string };
}
