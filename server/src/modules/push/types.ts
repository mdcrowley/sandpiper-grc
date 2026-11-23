// Shapes the push clients share.

/** What a push says: the application's name and "You have N new notifications", nothing else. */
export interface PushMessage { title: string; body: string; count: number }

/**
 * The result of one send. `gone`: the phone's token or endpoint will never work again, so its
 * registration is removed. `settings`: the service refused the credentials, which an administrator
 * must fix (Administration > Push notifications shows it). `temporary`: the service could not be
 * reached, was too slow, answered 5xx or asked to slow down (429); the push is tried again later
 * (retry.ts), after `retryAfterSeconds` when the service said how long to wait (Retry-After).
 * `pauseService`: the wait applies to every phone of this service (or UnifiedPush server), not only
 * this one, so the rest of the run does not call it either.
 */
export type SendOutcome =
  | { ok: true }
  | { ok: false; gone: boolean; settings?: boolean; temporary?: boolean; retryAfterSeconds?: number | null; pauseService?: boolean; message: string };
