// The mobile app's server contract (wave 13, E38-02, E38-03, E38-04, E38-09): request and response
// shapes shared by the server (modules/mobile, modules/mcp/oauth.ts, ops/version.ts), the web
// application (Account > Devices) and the app (mobile/src/api). Types and constants only.
//
// Import it as:
//   server  (server/src/modules/mobile/x.ts):  import type { MobileHome } from '../../../../shared/mobile-api.ts';
//   web     (web/src/modules/<m>/x.tsx):        import type { DeviceView } from '../../../../shared/mobile-api.ts';
//   mobile  (mobile/src/api/x.ts):              import type { MobileHome } from '../../../shared/mobile-api.ts';

import type { TagFormat } from './tag-format.ts';

// ---------- identity of the app ----------

/** The app's own OAuth client: registered by the application itself, needs no administrator step. */
export const MOBILE_CLIENT_ID = 'com.sandpipergrc';
/** The only redirect address the mobile client may use (the app's private-use scheme). */
export const MOBILE_REDIRECT_URI = 'com.sandpipergrc:/oauth';
/** The scope a mobile token carries: the person's own permissions, as the web application. */
export const MOBILE_SCOPE = 'mobile';
/** Bearer prefixes (core/tokens.ts registerBearerResolver): access and refresh tokens of the app. */
export const MOBILE_ACCESS_PREFIX = 'grc_mat_';
export const MOBILE_REFRESH_PREFIX = 'grc_mrt_';

/** The app versions this server works with (§5.9). Raised when the server needs a newer app. */
export const MOBILE_COMPAT: MobileCompat = { minVersion: '0.1.0', recommendedVersion: '0.1.0' };

export interface MobileCompat {
  /** The app refuses to connect, and asks to be updated, when it is older than this. */
  minVersion: string;
  /** The app suggests an update when it is older than this. */
  recommendedVersion: string;
}

/** Settings of the Mobile app area (Administration > Features > Mobile app; read with ctx.settings.get). */
export const MOBILE_SETTINGS = {
  /** Access token life in minutes (default 15). */
  accessMinutes: { key: 'mobile.access_minutes', fallback: 15 },
  /** A refresh token lapses after this many days without use (default 30). */
  refreshDays: { key: 'mobile.refresh_days', fallback: 30 },
  /** Face ID, fingerprint or the device credential required to open the app. */
  requireUnlock: { key: 'mobile.require_unlock', fallback: false },
  /** Minutes in the background before the unlock is asked again. */
  unlockAfterMinutes: { key: 'mobile.unlock_after_minutes', fallback: 5 },
  /** Days an offline package is kept (wave 15). */
  offlineDays: { key: 'mobile.offline_days', fallback: 7 },
} as const;

// ---------- before signing in ----------

/**
 * `GET /api/mobile/hello` (public; 404 `switched_off` while the Mobile app area is off). What the app
 * needs before signing in: no version of the server is revealed, only the app range it accepts.
 * The signed-in `GET /api/version` also carries `mobile: MobileCompat` while the area is on.
 */
export interface MobileHello {
  product: 'sandpiper-grc';
  /** The mobile API's version; the app refuses a server whose apiVersion it does not know. */
  apiVersion: 1;
  mobile: MobileCompat;
  /** Name shown on the connect screen (public branding, `appName`). */
  appName: string;
  oauth: {
    /** The web page that signs the person in: open it in the system browser sheet. */
    authorizationEndpoint: string;
    tokenEndpoint: string;
    revocationEndpoint: string;
    clientId: typeof MOBILE_CLIENT_ID;
    redirectUri: typeof MOBILE_REDIRECT_URI;
    scope: typeof MOBILE_SCOPE;
  };
}

export type DevicePlatform = 'ios' | 'android';

/**
 * Query of the authorization request the app opens in the system browser:
 * `GET {authorizationEndpoint}?response_type=code&client_id=...&redirect_uri=...&scope=mobile&state=...
 *  &code_challenge=...&code_challenge_method=S256&installation_id=...&device_name=...&device_platform=ios&app_version=0.1.0`
 * Add `prompt=login` to sign in again for a sensitive action (§5.2 step 6).
 */
export interface MobileAuthorizeQuery {
  response_type: 'code';
  client_id: typeof MOBILE_CLIENT_ID;
  redirect_uri: typeof MOBILE_REDIRECT_URI;
  scope: typeof MOBILE_SCOPE;
  state: string;
  code_challenge: string;
  code_challenge_method: 'S256';
  /** A random UUID the app makes once per installation and keeps in the Keychain or Keystore. */
  installation_id: string;
  /** Shown on Account > Devices, for example "Field phone 12" (at most 80 characters). */
  device_name: string;
  device_platform: DevicePlatform;
  app_version: string;
  prompt?: 'login';
}

/** The redirect back to the app: `com.sandpipergrc:/oauth?code=...&state=...` (or `error=...&state=...`). */
export interface MobileRedirectParams { code?: string; state: string; error?: string; error_description?: string }

/** `POST {tokenEndpoint}` (form-encoded, as OAuth requires): the code exchange. */
export interface MobileTokenCodeRequest {
  grant_type: 'authorization_code';
  code: string;
  redirect_uri: typeof MOBILE_REDIRECT_URI;
  client_id: typeof MOBILE_CLIENT_ID;
  code_verifier: string;
  /** Must equal the one sent to the authorization endpoint: the tokens are bound to this installation. */
  installation_id: string;
}

/** `POST {tokenEndpoint}`: a refresh. The refresh token rotates; using an old one signs the device out. */
export interface MobileTokenRefreshRequest {
  grant_type: 'refresh_token';
  refresh_token: string;
  client_id: typeof MOBILE_CLIENT_ID;
  installation_id: string;
}

export interface MobileTokenResponse {
  access_token: string;
  token_type: 'Bearer';
  /** Seconds (default 900). */
  expires_in: number;
  refresh_token: string;
  scope: typeof MOBILE_SCOPE;
  /** The device session these tokens belong to (Account > Devices). */
  device_id: string;
  /** With prompt=login: the time of the fresh sign-in (ISO), which sensitive actions accept for a few minutes. */
  auth_time?: string;
}

/** OAuth errors are `{ error, error_description }` with status 400 or 401 (RFC 6749 §5.2). */
export interface OAuthError { error: 'invalid_request' | 'invalid_grant' | 'invalid_client' | 'unauthorized_client' | 'unsupported_grant_type' | 'access_denied' | 'switched_off'; error_description?: string }

/** `POST {revocationEndpoint}` (form-encoded): `token`, `client_id`. Always answers 200. Signing out revokes the device. */
export interface MobileRevokeRequest { token: string; client_id: typeof MOBILE_CLIENT_ID; token_type_hint?: 'refresh_token' | 'access_token' }

// ---------- devices ----------

/**
 * One signed-in installation. `GET /api/me/devices` (signed in, Mobile app area on) → DeviceView[];
 * `DELETE /api/me/devices/:id` signs one out. Administrators: `GET /api/admin/users/:id/devices`,
 * `DELETE /api/admin/users/:id/devices/:deviceId` (admin.administer). Deactivating a user (SCIM
 * included) or switching the area off signs out every device.
 */
export interface DeviceView {
  id: string;
  name: string;
  platform: DevicePlatform;
  appVersion: string;
  createdAt: string;
  lastUsedAt: string | null;
  /** Coarse, as the web's sign-in list shows it; never a location. */
  lastUsedIp: string | null;
  /** True for the device making this request (from the app). */
  current: boolean;
  revokedAt: string | null;
}

// ---------- My work ----------

/** One item of a My work section: enough for a row, opened by `route` (web) or the app's record view. */
export interface MobileWorkItem {
  /**
   * What the item is, and so what `id` names:
   * - `workflow_step`: a waiting approval; id = the workflow step id (the app opens its approval screen)
   * - `policy_acknowledgment`: a policy to acknowledge; id = the acknowledgment request id
   * - `course`: training due; id = the course id (opened on the web, `/training/mine`)
   * - otherwise a record type (`ticket`, `action`, `inspection`, and `asset`/`vehicle`/`site` for
   *   condition assessments due); id = the record id
   */
  type: string;
  id: string;
  label: string;
  ref: string | null;
  /** The web route of the record, for example `/tickets/<id>`. */
  route: string;
  /** The status label, when the record has one. */
  status: string | null;
  /** Due date (YYYY-MM-DD) or time (ISO), when there is one. */
  due: string | null;
  overdue: boolean;
}

export type MobileWorkKey = 'tickets' | 'actions' | 'approvals' | 'inspections' | 'condition' | 'acknowledgments' | 'training';

export interface MobileWorkSection {
  key: MobileWorkKey;
  label: string;
  /** Everything waiting, counted as the web counts it for the same person. */
  count: number;
  /** The first few (at most 5), most urgent first. */
  items: MobileWorkItem[];
  /** Where the full list is on the web. */
  webRoute: string;
}

/** `GET /api/mobile/home` (signed in, Mobile app area on). Sections of switched-off areas are left out. */
export interface MobileHome {
  sections: MobileWorkSection[];
  /** Unread in-app notifications (`GET /api/notifications/unread-count`). */
  unreadNotifications: number;
  generatedAt: string;
}

// ---------- settings ----------

/** `GET /api/mobile/settings` (signed in, Mobile app area on): what the app needs to work for this person. */
export interface MobileSettings {
  /** Asset tags (null while the Asset tags area is off): the active formats for reading tags. */
  tags: {
    formats: TagFormat[];
    /** Text read without any format is offered only for the person to confirm (§5.5). */
    confirmTextWithoutFormat: true;
  } | null;
  unlock: { required: boolean; afterMinutes: number };
  /** Areas switched on (Administration > Features), so the app hides the rest. */
  areas: Record<string, boolean>;
  /** The person's permissions (as /api/auth/state gives them). */
  permissions: string[];
  user: { id: string; displayName: string; username: string };
  server: { appName: string; timeZone: string };
}

// ---------- offline work: the package and the outbox (wave 14, E38-10) ----------

/** How long the server remembers each outbox item's answer, so a repeat never creates twice (days). */
export const SYNC_KEEP_DAYS = 7;
/** At most this many items in one `POST /api/mobile/sync`. */
export const SYNC_MAX_ITEMS = 50;

/**
 * Kinds of outbox item. Each is sent once, in order, with a client-made UUID (`clientId`) that is also
 * its idempotency key; the server answers each separately. New kinds (inspections, condition
 * assessments, inventory counts) are added here, in the server's sync kinds (modules/mobile/sync.ts
 * `defineSyncKind`) and in the app's outbox kinds (mobile/src/offline/kinds.ts); see docs/mobile.md.
 */
export type SyncKind = 'record.create' | 'attachment';

/**
 * `record.create`: creates one record through its normal create route (or the portal's report routes),
 * so validation, permissions, hooks and audit apply as on the web. Optionally links it to another record.
 */
export interface SyncRecordCreate {
  /** A record type's create path (`/api/tickets`, `/api/safety-events`, ...) or `/api/portal/requests`, `/api/portal/safety-reports`. */
  path: string;
  recordType: string;
  body: Record<string, unknown>;
  /** A record to link the new one to afterward (POST /api/links); a refused link is a warning, not a refusal. */
  link?: { type: string; id: string } | null;
}

/** One item of `POST /api/mobile/sync`. */
export interface SyncItem {
  /** A UUID the app made when the work was saved; the same item sent again is answered from memory. */
  clientId: string;
  kind: SyncKind | string;
  payload: unknown;
}

export interface SyncRequest { items: SyncItem[] }

/**
 * The answer to one item:
 * - `done`: the server did it (or did it before: `replayed`); `result` says what was made.
 * - `rejected`: the server refused it (the reason is in `error`; `fields` per field). The app keeps it in
 *   "Needs attention"; sending it again needs a change or the person's choice.
 * - `retry`: not done now (the server was busy, an earlier item must go first, or the connection to
 *   the record's area failed); the app sends it again later, unchanged.
 */
export interface SyncAnswer {
  clientId: string;
  status: 'done' | 'rejected' | 'retry';
  replayed?: boolean;
  result?: SyncResult;
  error?: { code: string; message: string; fields?: Record<string, string> };
}

/** What a `done` item made. */
export interface SyncResult {
  recordType?: string;
  id?: string;
  ref?: string | null;
  /** For `record.create` with a link: whether the link was made. */
  linked?: boolean;
  /** Something that did not stop the item (for example a refused link). */
  warning?: string;
  /** For `attachment`: the new attachment's id and file name. */
  attachmentId?: string;
  fileName?: string;
}

export interface SyncResponse { items: SyncAnswer[] }

/**
 * `PUT /api/mobile/sync/attachment?clientId=&parent=&name=` (or `record_type=&record_id=` instead of
 * `parent`), header `Idempotency-Key: <clientId>`, the photo as the body (application/octet-stream).
 * `parent` is the clientId of a `record.create` item already done. Answers a SyncAnswer with status 200.
 */
export interface SyncAttachmentQuery { clientId: string; parent?: string; record_type?: string; record_id?: string; name: string; description?: string }

/** A choice in a list (a lookup value, a site). */
export interface PackageOption { value: string; label: string; ref?: string | null }

/** A tag value of a record in the package, for looking tags up offline. */
export interface PackageTag { value: string; valueKey: string; recordType: string; recordId: string; label: string }

/**
 * `GET /api/mobile/package` (the app's token only): what the person needs to work offline for the next
 * days. Expires at `expiresAt` (Administration > Mobile app, "Days offline work is kept", default 7);
 * the app deletes it then, on sign-out and when the device is signed out.
 */
export interface MobilePackage {
  id: string;
  generatedAt: string;
  expiresAt: string;
  user: { id: string; displayName: string };
  /** My work at the time of download (the same sections as GET /api/mobile/home). */
  work: MobileHome;
  /** Lists the app's forms need offline, only those the person may read: `safety_event_type`, `safety_event_severity`. */
  lookups: Record<string, PackageOption[]>;
  /** Sites the person may see (for "where"), at most 2000. */
  sites: PackageOption[];
  /** The portal's report choices, for people who report through the portal (null without portal.create). */
  portal: { safetyTypes: PackageOption[]; harm: PackageOption[] } | null;
  /** The server's attachment limits (null when the person may not read them). */
  attachments: { maxBytes: number; allowedExtensions: string[] } | null;
  /** Asset tags (null while the area is off): the formats and the tag values of the records in this package. */
  tags: { formats: TagFormat[]; values: PackageTag[] } | null;
  /**
   * Parts added by later work (inspections with their checklists, condition assessments, inventory
   * counts): `{ [key]: data }`, each built by a server package part (modules/mobile/package.ts
   * `definePackagePart`). This wave: `inspections` (assigned to me, due within the package's days).
   */
  parts: Record<string, unknown>;
}

/** The `inspections` part of a package (wave 14: the list; the checklists follow with E38-11). */
export interface PackageInspection {
  id: string;
  ref: string | null;
  title: string;
  status: string | null;
  dueOn: string | null;
  target: { type: string; id: string; label: string | null } | null;
}
