// How a message leaves the application: SMTP (here), Microsoft Graph (graph.ts) and the Gmail
// API (gmail.ts), E14-25.
//
// Adding another (for example a cloud mail service's HTTP API) needs no change elsewhere:
//   1. Write a file that calls `registerMailProvider('name', (config, secret) => provider)`,
//      where `provider` implements `MailProvider` below. `send` resolves with the outcome and
//      never rejects; it says whether trying again could help (`retryable`).
//   2. Import that file once (for example from a module's index.ts).
//   3. An administrator chooses it as the provider; `config` is the stored mail settings
//      (host, port and user name may be reused as endpoint, region and key id; or the provider's
//      own section of `provider_settings`) and `secret` the decrypted password, or the provider's
//      own credential from `provider_secrets`, decrypted with the context "mail:<name>".
// The queue, the delivery log, the templates and every caller stay as they are.
import nodemailer from 'nodemailer';

export interface MailAttachment {
  filename: string;
  /** File content, base64. */
  contentBase64: string;
  contentType?: string;
  /**
   * Set for a picture shown inside the HTML body (`<img src="cid:...">`, such as the organization's
   * logo, E14-36): the part is sent inline with this Content-ID rather than as a file to save.
   */
  cid?: string;
}

export interface OutgoingMessage {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: MailAttachment[];
  /**
   * Extra header lines. Every message carries `Auto-Submitted: auto-generated` and
   * `X-GRC-Mail`, so that auto-replies are suppressed and the application never takes its own
   * messages back in as tickets (E15-06); callers may add `References` to thread a conversation.
   */
  headers?: Record<string, string>;
}

export interface MailResult {
  ok: boolean;
  /** The server's id for the message, when it gives one. */
  messageId?: string;
  /** For the delivery log when `ok` is false. Never contains the password. */
  error?: string;
  /** True when trying again later might succeed (a time-out, a busy server, a 4xx reply). */
  retryable?: boolean;
  /**
   * How long the service asked to wait before trying again, in seconds (HTTP `Retry-After`, or a
   * "try again in N seconds" SMTP reply), when it said (E14-30). The queue waits that long.
   */
  retryAfterSeconds?: number;
  /**
   * True when the server could not be reached at all (no connection, no answer). Several in a row
   * pause sending for a few minutes (breaker.ts, OP-09).
   */
  unreachable?: boolean;
}

export interface MailProvider {
  /** Shown in settings and written to the delivery log, for example "smtp". */
  name: string;
  send(message: OutgoingMessage): Promise<MailResult>;
  /** Checks the connection and sign-in without sending. */
  verify?(): Promise<MailResult>;
  close?(): void;
}

export interface MailConfig {
  enabled: boolean;
  provider: string;
  host: string;
  port: number;
  tls_mode: 'none' | 'starttls' | 'tls';
  username: string;
  from_address: string;
  from_name: string;
  reply_to: string;
  base_url: string;
  /** Each web-interface provider's own settings (never secrets), by provider name. */
  provider_settings?: Record<string, Record<string, unknown>>;
}

export type ProviderFactory = (config: MailConfig, secret: string | null) => MailProvider;

const providers = new Map<string, ProviderFactory>();

export function registerMailProvider(name: string, factory: ProviderFactory): void {
  providers.set(name, factory);
}
export const providerNames = () => [...providers.keys()].sort();
export function makeProvider(config: MailConfig, secret: string | null): MailProvider | null {
  const factory = providers.get(config.provider);
  return factory ? factory(config, secret) : null;
}

/** An attachment as nodemailer takes it; one with a Content-ID goes inline in a multipart/related part. */
export function nodemailerAttachment(a: MailAttachment) {
  return {
    filename: a.filename, content: Buffer.from(a.contentBase64, 'base64'), contentType: a.contentType,
    ...(a.cid ? { cid: a.cid, contentDisposition: 'inline' as const } : {}),
  };
}

/**
 * SMTP time-outs, in milliseconds (OP-09): a server that does not accept the connection is given
 * up on after 5 seconds (it was 15), one that connects but does not greet after 10, and a
 * connection that goes quiet mid-message after 30.
 */
export const SMTP_TIMEOUTS = { connection: 5_000, greeting: 10_000, socket: 30_000 };

/**
 * The wait a busy SMTP server names in its 4xx reply, in seconds, or null. SMTP has no standard
 * field for it; servers write it in words: "try again in 5 minutes", "retry after 300 seconds",
 * "try again later (60s)".
 */
export function smtpRetryAfter(text: string): number | null {
  const m = /(?:try(?:ing)? again|retry|wait)\b[^0-9]{0,20}?(\d{1,5})\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\b/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  return unit.startsWith('h') ? n * 3600 : unit.startsWith('m') ? n * 60 : n;
}

/** Turns a nodemailer error into a log line and a retry decision. */
export function describeSmtpError(err: unknown): MailResult {
  const e = err as { code?: string; responseCode?: number; response?: string; message?: string };
  const code = e?.responseCode;
  const text = String(e?.response ?? e?.message ?? err).replace(/\s+/g, ' ').slice(0, 400);
  if (e?.code === 'EAUTH' || e?.code === 'ENOAUTH') return { ok: false, retryable: false, error: `The mail server refused the user name or password: ${text}` };
  if (typeof code === 'number') {
    // 4xx: try again later; 5xx: the server will not take this message.
    const wait = code < 500 ? smtpRetryAfter(text) : null;
    return { ok: false, retryable: code < 500, error: `The mail server answered ${code}: ${text}`, ...(wait !== null ? { retryAfterSeconds: wait } : {}) };
  }
  if (e?.code === 'ETLS') return { ok: false, retryable: false, error: `The secure connection failed (check the TLS setting): ${text}` };
  return { ok: false, retryable: true, unreachable: true, error: `Could not reach the mail server: ${text}` };
}

registerMailProvider('smtp', (config, secret) => {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.tls_mode === 'tls',
    requireTLS: config.tls_mode === 'starttls',
    ignoreTLS: config.tls_mode === 'none',
    auth: config.username ? { user: config.username, pass: secret ?? '' } : undefined,
    connectionTimeout: SMTP_TIMEOUTS.connection,
    greetingTimeout: SMTP_TIMEOUTS.greeting,
    socketTimeout: SMTP_TIMEOUTS.socket,
    name: 'localhost',
  });
  return {
    name: 'smtp',
    async send(m) {
      try {
        const info = await transport.sendMail({
          from: m.from, to: m.to, replyTo: m.replyTo || undefined, subject: m.subject, text: m.text, html: m.html, headers: m.headers,
          attachments: m.attachments?.map(nodemailerAttachment),
          disableUrlAccess: true, disableFileAccess: true,
        });
        return { ok: true, messageId: info.messageId };
      } catch (err) {
        return describeSmtpError(err);
      }
    },
    async verify() {
      try {
        await transport.verify();
        return { ok: true };
      } catch (err) {
        return describeSmtpError(err);
      }
    },
    close: () => transport.close(),
  };
});
