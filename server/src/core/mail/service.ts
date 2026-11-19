// Queuing and sending messages: `app.sendMail(...)` and the `mail.send` job.
//
// Every message is one job (so each recipient is retried and logged on their own) and one row
// of `mail_log`. What a recipient may see is checked when the message is sent, not when it is
// queued: a recipient who has lost access to the record gets nothing, and a restricted record
// is never described â€” its recipients get the content-free "security notification" message.
import { loadUser, secretBox } from '../auth.ts';
import { DEFAULT_APP_NAME } from '../config.ts';
import { UUID_RE } from '../errors.ts';
import { PermanentJobError, type JobQueue } from '../jobs/index.ts';
import type { ModuleContext, Row, SessionUser } from '../module.ts';
import { makeProvider, type MailAttachment, type MailConfig } from './provider.ts';
import { DEFAULT_TEMPLATES, escapeHtml, render, textToHtml } from './templates.ts';

export interface SendMailInput {
  /** Recipients by user id. Only active users with an email address receive anything. */
  userIds?: (string | null | undefined)[];
  /** Also everyone whose roles grant this permission now, for example "security.edit". */
  permission?: string;
  /** Addresses that are not users (for example a report's outside recipients). Not checked against any record. */
  to?: string | string[];
  /** Template key (default "message"). */
  template?: string;
  /** Short form for the "message" template: its subject, text and in-app link. */
  subject?: string;
  text?: string;
  link?: string;
  /**
   * Placeholder values. `link` and `preferencesLink` may be in-app paths ("/tickets/â€¦"): they
   * are made absolute with the application address. For "message": `subject`, `message`, `link`.
   */
  data?: Record<string, string | number | null | undefined>;
  /** A list for the `items` placeholder (the daily summary). */
  items?: { title: string; link?: string | null }[];
  /**
   * The record the message is about. Each user recipient must be able to see it when the message
   * is sent; if it is restricted they get the content-free security message instead (no attachments).
   * Outside addresses (`to`) never receive a message about a restricted record.
   */
  record?: { type: string; id: string };
  /** Files to attach (at most 10 MB in all), as base64 or as a Buffer in `content`. */
  attachments?: (MailAttachment | { filename: string; content: Buffer; contentType?: string })[];
  /** Shown in the delivery log: "notification", "reports", "security", ... */
  purpose?: string;
  /**
   * Threading headers for a conversation (E15-06): only `References`, `In-Reply-To` and `X-GRC-*`
   * names are kept, values without line breaks, at most 900 characters each.
   */
  headers?: Record<string, string>;
  /** Where replies should go, instead of the reply-to address in the email settings (for example the service desk mailbox). */
  replyTo?: string;
}

/** Marks every message the application sends, so auto-replies are suppressed and inbound mail can recognize it. */
export const OWN_MAIL_HEADER = 'X-GRC-Mail';
const SAFE_HEADER = /^(References|In-Reply-To|X-GRC-[A-Za-z0-9-]{1,40})$/i;

export function safeHeaders(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!SAFE_HEADER.test(k) || typeof v !== 'string' || /[\r\n]/.test(v) || !v.trim()) continue;
    out[k] = v.trim().slice(0, 900);
  }
  return Object.keys(out).length ? out : undefined;
}

export interface SendMailResult {
  /** Messages queued. */
  queued: number;
  /** Recipients left out (no address, inactive, unknown). */
  skipped: number;
  /** False when email is switched off: nothing was queued. */
  enabled: boolean;
  /** Ids of the delivery-log rows, one per message queued. */
  logIds: string[];
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Queues email. Present when mail is loaded: guard with `app.hasDecorator('sendMail')`. Never throws. */
    sendMail(input: SendMailInput): Promise<SendMailResult>;
    /** Whether email is switched on. */
    mailEnabled(): Promise<boolean>;
  }
}

type Normalized = Omit<SendMailInput, 'to' | 'attachments'> & { to?: string[]; attachments?: MailAttachment[] };

export const EMAIL_RE =/^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;
const MAX_ATTACH_BYTES = 10 * 1024 * 1024;
const PURPOSE_RE = /^[a-z][a-z0-9_.-]{0,39}$/;

export const SECRET_CONTEXT = 'mail:smtp';

export async function loadConfig(ctx: ModuleContext): Promise<MailConfig & { password_sealed: string | null }> {
  const row = await ctx.db.one<Row>('select * from mail_config where id = 1');
  return row as MailConfig & { password_sealed: string | null };
}

export const absolute = (base: string, link: unknown) => {
  const s = typeof link === 'string' ? link.trim() : '';
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (/^\/(?!\/)/.test(s) && base) return `${base.replace(/\/+$/, '')}${s}`;
  return '';
};

/** Whether `user` may see this record now (the module's view permission and restriction rules), and whether it is restricted. */
async function access(ctx: ModuleContext, user: SessionUser | null, record: { type: string; id: string }) {
  const def = ctx.resources.get(record.type);
  if (!def || !UUID_RE.test(record.id)) return { visible: false, restricted: true };
  const row = await ctx.resources.find(def.type, record.id, null);
  if (!row) return { visible: false, restricted: true };
  const restricted = def.restricted === true || (def.restricted === 'flag' && row.restricted === true);
  if (!user) return { visible: !restricted, restricted };
  const visible = ctx.can(user, `${def.module}.view`) && (!restricted || ctx.can(user, 'security.view'))
    && (await ctx.resources.find(def.type, record.id, user)) !== undefined;
  return { visible, restricted };
}

export async function templateRow(ctx: ModuleContext, key: string): Promise<{ key: string; subject: string; text_body: string; html_body: string }> {
  const row = await ctx.db.one<{ key: string; subject: string; text_body: string; html_body: string }>(
    'select key, subject, text_body, html_body from mail_templates where key = $1', [key]);
  if (row) return row;
  const def = DEFAULT_TEMPLATES.find((t) => t.key === key) ?? DEFAULT_TEMPLATES.find((t) => t.key === 'message')!;
  return { key: def.key, subject: def.subject, text_body: def.text, html_body: textToHtml(def.text) };
}

export function makeMail(ctx: ModuleContext, jobs: JobQueue) {
  const { db } = ctx;

  async function enabled() {
    return (await db.one<{ enabled: boolean }>('select enabled from mail_config where id = 1'))?.enabled === true;
  }

  async function logStatus(id: string, status: string, fields: { error?: string | null; attempts?: number; messageId?: string; provider?: string; subject?: string; to?: string } = {}) {
    await db.query(
      `update mail_log set status = $2, error = $3, attempts = coalesce($4, attempts), message_id = coalesce($5, message_id),
         provider = coalesce($6, provider), subject = coalesce($7, subject), to_address = coalesce($8, to_address),
         sent_at = case when $2 = 'sent' then now() else sent_at end
       where id = $1`,
      [id, status, fields.error ? fields.error.slice(0, 1000) : null, fields.attempts ?? null, fields.messageId ?? null,
        fields.provider ?? null, fields.subject ? fields.subject.slice(0, 300) : null, fields.to ?? null],
    );
  }

  // ---------- the job ----------

  jobs.register('mail.send', async (p: Row, job) => {
    const logId: string = p.logId;
    const last = job.attempt >= job.maxAttempts;
    const giveUp = async (status: 'skipped' | 'dead', why: string): Promise<{ status: string }> => {
      await logStatus(logId, status, { error: why, attempts: job.attempt });
      if (status === 'dead') throw new PermanentJobError(why);
      return { status };
    };

    const config = await loadConfig(ctx);
    if (!config.enabled && !p.test) return giveUp('dead', 'Email was switched off before this message was sent.');

    // The recipient, as they are now.
    let user: SessionUser | null = null;
    let to: string = typeof p.to === 'string' ? p.to : '';
    if (p.userId && p.accountLink) {
      // A set-up link goes to someone who has not signed in yet (status "pending"); never to a disabled account.
      const u = await db.one<Row>(`select id, username, display_name, email from users where id = $1 and deleted_at is null and status <> 'disabled'`, [p.userId]);
      if (!u) return giveUp('skipped', 'The account is disabled or removed.');
      user = { id: u.id, username: u.username, displayName: u.display_name, email: u.email, roles: [], permissions: [] };
      to = u.email;
    } else if (p.userId) {
      user = await loadUser(db, p.userId);
      if (!user) return giveUp('skipped', 'The person is no longer an active user.');
      to = user.email;
    }
    if (!EMAIL_RE.test(to)) return giveUp('skipped', 'No valid email address.');

    let template: string = p.template ?? 'message';
    let data: Row = { ...(p.data ?? {}) };
    if (typeof p.sealedLink === 'string') {
      try {
        data.link = secretBox(db).decrypt(p.sealedLink, `mail:link:${logId}`);
      } catch {
        return giveUp('dead', 'The link in this message could not be decrypted (the secret key has changed). Issue a new link.');
      }
    }
    let attachments: MailAttachment[] | undefined = p.attachments;
    let items: { title: string; link?: string | null }[] = Array.isArray(p.items) ? p.items : [];
    if (p.record) {
      const a = await access(ctx, user, p.record);
      if (!a.visible) return giveUp('skipped', 'The recipient cannot see the record this message is about.');
      if (a.restricted) {
        // Content-free: no title, text, items or files; the link goes to the notifications page.
        template = 'notification_restricted';
        data = { link: '/notifications' };
        attachments = undefined;
        items = [];
      }
    }

    const base = config.base_url;
    const appName = await ctx.settings.get('app.name', DEFAULT_APP_NAME);
    const values: Row = {
      ...data, appName, recipientName: user?.displayName ?? to,
      link: absolute(base, data.link), preferencesLink: absolute(base, '/notifications?tab=preferences'),
    };
    const block = {
      text: items.map((i) => `- ${i.title}${absolute(base, i.link) ? `\n  ${absolute(base, i.link)}` : ''}`).join('\n'),
      html: `<ul>${items.map((i) => {
        const href = absolute(base, i.link);
        return `<li>${href ? `<a href="${escapeHtml(href)}">${escapeHtml(i.title)}</a>` : escapeHtml(i.title)}</li>`;
      }).join('')}</ul>`,
    };
    const message = render(await templateRow(ctx, template), values, { items: block });

    let secret: string | null = null;
    try {
      secret = config.password_sealed ? secretBox(db).decrypt(config.password_sealed, SECRET_CONTEXT) : null;
    } catch {
      return giveUp('dead', 'The stored mail password could not be decrypted (the secret key has changed). Enter it again.');
    }
    const provider = makeProvider(config, secret);
    if (!provider) return giveUp('dead', `Unknown mail provider "${config.provider}".`);
    const from = config.from_name ? `"${config.from_name.replace(/["\\\r\n]/g, '')}" <${config.from_address}>` : config.from_address;
    try {
      const headers = {
        ...(safeHeaders(p.headers) ?? {}),
        'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All', [OWN_MAIL_HEADER]: String(p.purpose ?? 'message'),
      };
      const replyTo = typeof p.replyTo === 'string' && EMAIL_RE.test(p.replyTo) ? p.replyTo : config.reply_to || undefined;
      const result = await provider.send({ to, from, replyTo, subject: message.subject, text: message.text, html: message.html, attachments, headers });
      if (result.ok) {
        await logStatus(logId, 'sent', { attempts: job.attempt, messageId: result.messageId, provider: provider.name, subject: message.subject, to });
        return { status: 'sent', messageId: result.messageId ?? null };
      }
      const final = last || result.retryable === false;
      await logStatus(logId, final ? 'dead' : 'failed', { error: result.error, attempts: job.attempt, provider: provider.name, subject: message.subject, to });
      if (result.retryable === false) throw new PermanentJobError(result.error ?? 'The message was refused.');
      throw new Error(result.error ?? 'The message could not be sent.');
    } finally {
      provider.close?.();
    }
  }, { maxAttempts: 5, backoffSeconds: 60 });

  // ---------- queuing ----------

  /**
   * Also accepts the plain shape `{ to: 'a@b' | ['a@b'], subject, text, link?, attachments: [{ filename, content: Buffer, contentType }] }`
   * (the "General message" template), so a caller written against a simple mailer works unchanged.
   */
  function normalize(input: SendMailInput): Normalized {
    const out: Normalized = {
      ...input, to: typeof input.to === 'string' ? [input.to] : input.to, attachments: undefined,
    };
    if (!out.template && (typeof input.subject === 'string' || typeof input.text === 'string')) {
      out.template = 'message';
      out.data = { subject: input.subject, message: input.text, link: input.link, ...(input.data ?? {}) };
    }
    if (Array.isArray(input.attachments)) {
      out.attachments = input.attachments.map((a) => ({
        filename: String(a.filename ?? 'file').slice(0, 200),
        contentType: a.contentType,
        contentBase64: 'contentBase64' in a ? a.contentBase64 : Buffer.isBuffer(a.content) ? a.content.toString('base64') : Buffer.from(String(a.content ?? ''), 'utf8').toString('base64'),
      }));
    }
    return out;
  }

  async function recipients(input: SendMailInput): Promise<{ users: { id: string; email: string }[]; skipped: number }> {
    const ids = new Set((input.userIds ?? []).filter((i): i is string => typeof i === 'string' && UUID_RE.test(i)));
    const rows = await db.query<Row>(
      `select u.id, u.email, coalesce(array_agg(distinct rp.permission) filter (where r.enabled and rp.permission is not null), '{}') as permissions,
              coalesce(array_agg(distinct r.key) filter (where r.enabled), '{}') as roles
       from users u left join user_roles ur on ur.user_id = u.id left join roles r on r.id = ur.role_id
       left join role_permissions rp on rp.role_id = r.id
       where u.status = 'active' and u.deleted_at is null and (u.id = any($1::uuid[]) or $2::text is not null)
       group by u.id`,
      [[...ids], input.permission ?? null],
    );
    const users = rows.filter((u) => ids.has(u.id) || (input.permission && ctx.can(u as SessionUser, input.permission)));
    const withEmail = users.filter((u) => EMAIL_RE.test(String(u.email ?? '')));
    return { users: withEmail.map((u) => ({ id: u.id, email: u.email })), skipped: ids.size - users.filter((u) => ids.has(u.id)).length + (users.length - withEmail.length) };
  }

  async function queueOne(input: SendMailInput, target: { userId?: string; to: string }, extra: Row = {}, opts: { maxAttempts?: number } = {}): Promise<string> {
    const purpose = PURPOSE_RE.test(String(input.purpose ?? '')) ? input.purpose! : 'other';
    const template = input.template ?? 'message';
    const log = await db.one<{ id: string }>(
      `insert into mail_log (template, purpose, user_id, to_address, subject) values ($1, $2, $3, $4, $5) returning id`,
      [template, purpose, target.userId ?? null, target.to, String(input.data?.subject ?? '').slice(0, 300)],
    );
    // A one-time set-up or reset link is a password in all but name: it is kept encrypted in the
    // job (never readable on the Background jobs page or in the database), and opened only to send.
    const data = { ...(input.data ?? {}) };
    let sealedLink: string | undefined;
    if (extra.accountLink && typeof data.link === 'string') {
      sealedLink = secretBox(db).encrypt(data.link, `mail:link:${log!.id}`);
      delete data.link;
    }
    const job = await jobs.enqueue('mail.send', {
      logId: log!.id, userId: target.userId, to: target.userId ? undefined : target.to, template,
      data, items: input.items, record: input.record, attachments: input.attachments, headers: safeHeaders(input.headers),
      replyTo: typeof input.replyTo === 'string' && EMAIL_RE.test(input.replyTo.trim()) ? input.replyTo.trim() : undefined, purpose, ...extra, sealedLink,
    }, opts);
    await db.query('update mail_log set job_id = $2 where id = $1', [log!.id, job.id]);
    return log!.id;
  }

  async function sendMail(raw: SendMailInput): Promise<SendMailResult> {
    const none = (on: boolean, skipped = 0): SendMailResult => ({ queued: 0, skipped, enabled: on, logIds: [] });
    try {
      const input = normalize(raw);
      if (!(await enabled())) return none(false);
      const size = (input.attachments ?? []).reduce((n, a) => n + Math.floor(String(a.contentBase64 ?? '').length * 3 / 4), 0);
      if (size > MAX_ATTACH_BYTES) {
        console.warn('[mail] not sent: attachments larger than 10 MB');
        return none(true);
      }
      const { users, skipped } = await recipients(input);
      const addresses = [...new Set((input.to ?? []).map((a) => String(a).trim().toLowerCase()))].filter((a) => EMAIL_RE.test(a));
      // An address that belongs to an active user is treated as that user (checked again when sent).
      const known = addresses.length ? await db.query<{ id: string; email: string }>(
        `select distinct on (lower(email)) id, lower(email) as email from users where status = 'active' and deleted_at is null and lower(email) = any($1::text[])`,
        [addresses],
      ) : [];
      for (const k of known) if (!users.some((u) => u.id === k.id)) users.push({ id: k.id, email: k.email });
      const outside = addresses.filter((a) => !known.some((k) => k.email === a));
      // An outside address cannot be checked against a record: it gets nothing about a restricted one.
      let outsideAllowed = outside;
      if (input.record && outside.length) {
        const a = await access(ctx, null, input.record);
        if (!a.visible) outsideAllowed = [];
      }
      const logIds: string[] = [];
      for (const u of users) logIds.push(await queueOne(input, { userId: u.id, to: u.email }));
      for (const to of outsideAllowed) logIds.push(await queueOne(input, { to }));
      return { queued: logIds.length, skipped: skipped + (outside.length - outsideAllowed.length) + ((input.to ?? []).length - addresses.length), enabled: true, logIds };
    } catch (err) {
      console.error('[mail] sendMail failed:', err);
      return none(true);
    }
  }

  /** The test message: sent at once (not waiting for the poller), even while email is switched off. */
  async function sendTest(to: string, sender: SessionUser): Promise<Row> {
    const logId = await queueOne({ template: 'test', purpose: 'test', data: { senderName: sender.displayName, link: '/' } }, { to }, { test: true }, { maxAttempts: 1 });
    const job = await db.one<{ job_id: string }>('select job_id from mail_log where id = $1', [logId]);
    await jobs.runNow(job!.job_id);
    return (await db.one<Row>('select * from mail_log where id = $1', [logId]))!;
  }

  return { sendMail, sendTest, enabled, queueOne };
}

export type MailService = ReturnType<typeof makeMail>;
