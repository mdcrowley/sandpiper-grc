// How a message leaves the application. SMTP is the one provider supplied.
//
// Adding another (for example a cloud mail service's HTTP API) needs no change elsewhere:
//   1. Write a file that calls `registerMailProvider('name', (config, secret) => provider)`,
//      where `provider` implements `MailProvider` below. `send` resolves with the outcome and
//      never rejects; it says whether trying again could help (`retryable`).
//   2. Import that file once (for example from a module's index.ts).
//   3. An administrator chooses it as the provider; `config` is the stored mail settings
//      (host, port and user name may be reused as endpoint, region and key id) and `secret`
//      the decrypted password or API key.
// The queue, the delivery log, the templates and every caller stay as they are.
import nodemailer from 'nodemailer';

export interface MailAttachment {
  filename: string;
  /** File content, base64. */
  contentBase64: string;
  contentType?: string;
}

export interface OutgoingMessage {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: MailAttachment[];
}

export interface MailResult {
  ok: boolean;
  /** The server's id for the message, when it gives one. */
  messageId?: string;
  /** For the delivery log when `ok` is false. Never contains the password. */
  error?: string;
  /** True when trying again later might succeed (a time-out, a busy server, a 4xx reply). */
  retryable?: boolean;
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

const TIMEOUT_MS = 15_000;

/** Turns a nodemailer error into a log line and a retry decision. */
export function describeSmtpError(err: unknown): MailResult {
  const e = err as { code?: string; responseCode?: number; response?: string; message?: string };
  const code = e?.responseCode;
  const text = String(e?.response ?? e?.message ?? err).replace(/\s+/g, ' ').slice(0, 400);
  if (e?.code === 'EAUTH' || e?.code === 'ENOAUTH') return { ok: false, retryable: false, error: `The mail server refused the user name or password: ${text}` };
  if (typeof code === 'number') {
    // 4xx: try again later; 5xx: the server will not take this message.
    return { ok: false, retryable: code < 500, error: `The mail server answered ${code}: ${text}` };
  }
  if (e?.code === 'ETLS') return { ok: false, retryable: false, error: `The secure connection failed (check the TLS setting): ${text}` };
  return { ok: false, retryable: true, error: `Could not reach the mail server: ${text}` };
}

registerMailProvider('smtp', (config, secret) => {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.tls_mode === 'tls',
    requireTLS: config.tls_mode === 'starttls',
    ignoreTLS: config.tls_mode === 'none',
    auth: config.username ? { user: config.username, pass: secret ?? '' } : undefined,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS * 2,
    name: 'localhost',
  });
  return {
    name: 'smtp',
    async send(m) {
      try {
        const info = await transport.sendMail({
          from: m.from, to: m.to, replyTo: m.replyTo || undefined, subject: m.subject, text: m.text, html: m.html,
          attachments: m.attachments?.map((a) => ({ filename: a.filename, content: Buffer.from(a.contentBase64, 'base64'), contentType: a.contentType })),
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
