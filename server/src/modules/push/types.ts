// Shapes the push clients share.

/** What a push says: the application's name and "You have N new notifications", nothing else. */
export interface PushMessage { title: string; body: string; count: number }

/**
 * The result of one send. `gone`: the phone's token or endpoint will never work again, so its
 * registration is removed. `settings`: the service refused the credentials, which an administrator
 * must fix (Administration > Push notifications shows it).
 */
export type SendOutcome = { ok: true } | { ok: false; gone: boolean; settings?: boolean; message: string };
