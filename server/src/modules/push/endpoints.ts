// The push services' addresses. Fixed in code: an administrator enters credentials, never an address,
// so a credential can only ever be sent to Apple or Google. Tests replace them with fake services
// running in the test process (setPushEndpointsForTests); nothing else may.

export interface PushEndpoints {
  /** Apple Push Notification service, HTTP/2 (production and development builds). */
  apns: { production: string; sandbox: string };
  /** Google's OAuth token endpoint for the service account's signed assertion. */
  googleToken: string;
  /** Firebase Cloud Messaging HTTP v1: `${fcm}/v1/projects/<project>/messages:send`. */
  fcm: string;
  /** UnifiedPush endpoints over plain http are refused, except in tests. */
  unifiedpushAllowHttp: boolean;
  /** Abandon one request after this long. */
  timeoutMs: number;
}

export const REAL_ENDPOINTS: PushEndpoints = {
  apns: { production: 'https://api.push.apple.com', sandbox: 'https://api.sandbox.push.apple.com' },
  googleToken: 'https://oauth2.googleapis.com/token',
  fcm: 'https://fcm.googleapis.com',
  unifiedpushAllowHttp: false,
  timeoutMs: 15_000,
};

let current: PushEndpoints = REAL_ENDPOINTS;

export const pushEndpoints = (): PushEndpoints => current;

/** Tests only: point the push clients at fake services (pass null to restore the real ones). */
export function setPushEndpointsForTests(e: Partial<PushEndpoints> | null): void {
  if (e && process.env.VITEST === undefined && process.env.NODE_ENV !== 'test') throw new Error('Push endpoints can be replaced only in tests.');
  current = e ? { ...REAL_ENDPOINTS, ...e } : REAL_ENDPOINTS;
}
