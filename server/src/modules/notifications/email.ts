// Email delivery is NOT built. The prototype makes no outbound connections, so this file
// holds only the contract a provider will have to meet when delivery is added (roadmap
// E14-04). Nothing imports it at run time.
//
// How it is meant to fit:
//   - Delivery stays off until an administrator configures a provider; it is the one
//     deliberate exception to "no outbound connections" and must be documented as such.
//   - After `notify` stores an in-app notification, a delivery step would hand each
//     recipient's message to the configured provider, unless that person has chosen the
//     daily digest (`notification_preferences.daily_digest`), in which case one summary a
//     day is sent instead.
//   - A message carries the title and a link back to the application, never restricted
//     detail: the recipient signs in to read the record.
//   - Failures are retried with a back-off and recorded; a provider must never throw.

export interface EmailMessage {
  /** The recipient's address, from their user account. */
  to: string;
  subject: string;
  /** Plain text. One or two lines and the link; no record content beyond the title. */
  text: string;
  /** Absolute link back to the record or the notifications page. */
  link?: string;
}

export interface EmailResult {
  ok: boolean;
  /** For the delivery log when `ok` is false. */
  error?: string;
  /** True when trying again later might succeed (a time-out, a busy server). */
  retryable?: boolean;
}

export interface EmailProvider {
  /** Shown in settings and written to the delivery log, for example "smtp". */
  name: string;
  /** Sends one message. Resolves with the outcome; never rejects. */
  send(message: EmailMessage): Promise<EmailResult>;
  /** Checks the configuration without sending to a user (the "send a test message" button). */
  verify?(): Promise<EmailResult>;
}

/** The provider in force today: delivers nothing and says so. */
export const noEmail: EmailProvider = {
  name: 'none',
  async send() {
    return { ok: false, error: 'Email delivery is not configured.', retryable: false };
  },
};
