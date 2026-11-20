// Text messages (E09-25): short alerts to a person's phone, with no paid service built in.
//
// Two ways out, each switched on by an administrator (Administration > Email > Text messages):
//   - email-to-text: the message is emailed (through the email settings) to the person's
//     email-to-text address, which many carriers and enterprise messaging systems offer;
//   - a webhook: the message is posted, signed, to an address the organization chooses, in the
//     documented format below, so any text-message system it already has can send it on. It is an
//     outbound connection: it obeys `integrations.outbound_enabled` and `integrations.allowed_hosts`
//     exactly as webhooks do, and never follows a redirect.
//
// Webhook format (docs/installation.md): POST, `content-type: application/json`, body
//   { "type": "text_message", "id": "<delivery id>", "to": "+15550100", "text": "...", "purpose": "security", "test": false, "createdAt": "<ISO time>" }
// with the headers `X-GRC-Event: text.message`, `X-GRC-Delivery`, `X-GRC-Timestamp` and
// `X-GRC-Signature: sha256=<hex HMAC-SHA256(secret, timestamp + "." + body)>`. Any 2xx answer is
// success; 408, 429 and 5xx are tried again; any other answer is final.
//
// A text never carries restricted detail: callers write it so ("Security incident SEC-0042 needs
// attention. Open the application."). Each message is one row of the delivery log (`mail_log`,
// purpose as given, template `text_message`). Who receives it is checked again when it is sent:
// an inactive person, or one who no longer holds `permission`, gets nothing.
import type { FastifyRequest } from 'fastify';
import { loadUser, requireRecentAuth, secretBox } from '../auth.ts';
import { DEFAULT_APP_NAME } from '../config.ts';
import { UUID_RE } from '../errors.ts';
import { PermanentJobError, RetryLaterError, type JobQueue } from '../jobs/index.ts';
import type { ModuleContext, Row, SessionUser } from '../module.ts';
import { AddressBlockedError, hostAllowed, postWebhook, signWebhook } from '../webhooks.ts';
import { providerSecret, sealedSecret, secretContext } from './accounts.ts';
import { EMAIL_RE, loadConfig, type MailService, type StoredMailConfig } from './service.ts';

export interface TextSettings {
  /** Texts may go to people's email-to-text addresses (needs email switched on). */
  gateway: boolean;
  /** Texts may go to the webhook. */
  webhook: boolean;
  /** The webhook address (https). */
  url: string;
}
export const TEXT_DEFAULTS: TextSettings = { gateway: false, webhook: false, url: '' };
/** The webhook's signing secret, kept encrypted in `mail_config.provider_secrets` (context "mail:text_webhook"). */
export const TEXT_SECRET = 'text_webhook';
/** A text is cut to this length: one or two text messages. */
export const TEXT_MAX = 300;

export const textSettings = (c: Pick<StoredMailConfig, 'provider_settings'>): TextSettings =>
  ({ ...TEXT_DEFAULTS, ...((c.provider_settings?.text ?? {}) as Partial<TextSettings>) });

export interface AlertContact { mobile: string; smsAddress: string }

export interface SendTextInput {
  userIds: (string | null | undefined)[];
  /** The message: short, and with nothing a restricted record would hide. */
  text: string;
  /** Shown in the delivery log, for example "security". */
  purpose: string;
  /** Each recipient must hold this when the text is sent (for example "security.view"). */
  permission?: string;
}
export interface SendTextResult {
  /** Messages queued (a person with both an address and a number gets two). */
  queued: number;
  /** People who received nothing: no contact details, inactive, or without the permission. */
  skipped: number;
  logIds: string[];
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Queues text messages. Present when mail is loaded: guard with `app.hasDecorator('sendText')`. Never throws. */
    sendText(input: SendTextInput): Promise<SendTextResult>;
  }
}

const MOBILE_RE = /^\+?[0-9]{6,15}$/;
/** "+1 (555) 010-0123" → "+15550100123"; empty stays empty; null when it is not a phone number. */
export function cleanMobile(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (!/^[+0-9 ().-]+$/.test(s)) return null;
  const n = s.replace(/[ ().-]/g, '');
  return MOBILE_RE.test(n) ? n : null;
}
/** "+15550100123" → "+1•••••••0123" for the delivery log shown to administrators of other things. */
export const maskMobile = (m: string) => (m.length > 6 ? `${m.slice(0, 2)}${'•'.repeat(m.length - 6)}${m.slice(-4)}` : m);

export async function contactOf(ctx: Pick<ModuleContext, 'db'>, userId: string): Promise<AlertContact> {
  const r = await ctx.db.one<Row>('select mobile, sms_address from user_alert_contacts where user_id = $1', [userId]);
  return { mobile: r?.mobile ?? '', smsAddress: r?.sms_address ?? '' };
}

export function makeTexts(ctx: ModuleContext, jobs: JobQueue, mail: MailService) {
  const { db } = ctx;

  async function channels(config?: StoredMailConfig) {
    const c = config ?? await loadConfig(ctx);
    const s = textSettings(c);
    return {
      gateway: s.gateway && c.enabled,
      webhook: s.webhook && Boolean(s.url) && Boolean(sealedSecret(c, TEXT_SECRET)),
      outbound: (await ctx.settings.get<unknown>('integrations.outbound_enabled', false)) === true,
    };
  }

  async function logRow(id: string, status: string, fields: { error?: string | null; attempts?: number } = {}) {
    await db.query(
      `update mail_log set status = $2, error = $3, attempts = coalesce($4, attempts), sent_at = case when $2 = 'sent' then now() else sent_at end where id = $1`,
      [id, status, fields.error ? fields.error.slice(0, 1000) : null, fields.attempts ?? null],
    );
  }

  /** The person as they are now, if they may still receive it. */
  async function recipient(userId: unknown, permission: unknown): Promise<{ user: SessionUser | null; why?: string }> {
    const user = typeof userId === 'string' ? await loadUser(db, userId) : null;
    if (!user) return { user: null, why: 'The person is no longer an active user.' };
    if (typeof permission === 'string' && permission && !ctx.can(user, permission)) return { user: null, why: `The person no longer holds ${permission}.` };
    return { user };
  }

  // ---------- the webhook job ----------

  jobs.register('text.webhook', async (p: Row, job) => {
    const logId: string = p.logId;
    const last = job.attempt >= job.maxAttempts;
    const stop = async (status: 'skipped' | 'dead', why: string) => {
      await logRow(logId, status, { error: why, attempts: job.attempt });
      if (status === 'dead') throw new PermanentJobError(why);
      return { status };
    };
    const who = await recipient(p.userId, p.permission);
    if (!who.user) return stop('skipped', who.why!);
    const { mobile } = await contactOf(ctx, who.user.id);
    if (!mobile) return stop('skipped', 'The person has no mobile number for text messages.');
    const config = await loadConfig(ctx);
    const s = textSettings(config);
    if (!s.webhook || !s.url) return stop('dead', 'Text messages through the webhook were switched off before this one was sent.');
    if ((await ctx.settings.get<unknown>('integrations.outbound_enabled', false)) !== true) {
      return stop('dead', 'Outbound connections are switched off (integrations.outbound_enabled).');
    }
    const allowList = await ctx.settings.get<unknown>('integrations.allowed_hosts', []);
    let url: URL;
    try { url = new URL(s.url); } catch { return stop('dead', 'The text-message webhook address is not a valid URL.'); }
    if (!hostAllowed(url, allowList)) return stop('dead', `Host ${url.host} is not on the allow-list (integrations.allowed_hosts).`);
    let secret: string | null;
    try { secret = providerSecret(db, config, TEXT_SECRET); } catch { return stop('dead', 'The text-message webhook secret could not be decrypted (the secret key has changed). Enter it again.'); }
    if (!secret) return stop('dead', 'No signing secret is saved for the text-message webhook.');

    const body = JSON.stringify({
      type: 'text_message', id: logId, to: mobile, text: String(p.text ?? '').slice(0, TEXT_MAX), purpose: p.purpose ?? 'other',
      test: p.test === true, createdAt: p.createdAt ?? new Date().toISOString(),
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    let error: string;
    let retry = true;
    try {
      const res = await postWebhook(url, body, {
        'content-type': 'application/json', 'user-agent': 'grc-text/1', 'x-grc-event': 'text.message', 'x-grc-delivery': logId,
        'x-grc-timestamp': timestamp, 'x-grc-signature': signWebhook(secret, timestamp, body),
      }, allowList);
      if (res.status >= 200 && res.status < 300) {
        await logRow(logId, 'sent', { attempts: job.attempt });
        return { status: 'sent', code: res.status };
      }
      error = `The text-message system answered ${res.status}.`;
      retry = res.status === 408 || res.status === 429 || res.status >= 500;
    } catch (err) {
      if (err instanceof AddressBlockedError || (err as { code?: string })?.code === 'GRC_ADDRESS_BLOCKED') return stop('dead', (err as Error).message);
      error = (err as Error).name === 'TimeoutError' ? 'The text-message system did not answer in time.' : `Could not reach the text-message system: ${(err as Error).message}`;
    }
    await logRow(logId, !retry || last ? 'dead' : 'failed', { error, attempts: job.attempt });
    if (!retry) throw new PermanentJobError(error);
    throw new Error(error);
  }, { maxAttempts: 4, backoffSeconds: 60 });

  // ---------- queuing ----------

  async function queue(input: SendTextInput, opts: { test?: boolean; maxAttempts?: number } = {}): Promise<SendTextResult> {
    const out: SendTextResult = { queued: 0, skipped: 0, logIds: [] };
    const text = String(input.text ?? '').replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX);
    const purpose = /^[a-z][a-z0-9_.-]{0,39}$/.test(input.purpose) ? input.purpose : 'other';
    if (!text) return out;
    const config = await loadConfig(ctx);
    const on = await channels(config);
    const testRun = opts.test === true;
    const ids = [...new Set(input.userIds.filter((i): i is string => typeof i === 'string' && UUID_RE.test(i)))];
    for (const id of ids) {
      const who = await recipient(id, input.permission);
      if (!who.user) { out.skipped += 1; continue; }
      const c = await contactOf(ctx, id);
      let sent = 0;
      if (c.smsAddress && (on.gateway || (testRun && textSettings(config).gateway))) {
        const logId = await mail.queueOne(
          { template: 'text_message', purpose, data: { subject: '', message: text } },
          { userId: id, to: c.smsAddress },
          { textUserId: id, permission: input.permission ?? null, ...(testRun ? { test: true } : {}) },
          opts.maxAttempts ? { maxAttempts: opts.maxAttempts } : {},
        );
        out.logIds.push(logId);
        sent += 1;
      }
      if (c.mobile && on.webhook) {
        const log = await db.one<{ id: string }>(
          `insert into mail_log (template, purpose, user_id, to_address, subject, provider) values ('text_message', $1, $2, $3, $4, 'webhook') returning id`,
          [purpose, id, maskMobile(c.mobile), text.slice(0, 300)],
        );
        const job = await jobs.enqueue('text.webhook', {
          logId: log!.id, userId: id, permission: input.permission ?? null, text, purpose, test: testRun, createdAt: new Date().toISOString(),
        }, opts.maxAttempts ? { maxAttempts: opts.maxAttempts } : {});
        await db.query('update mail_log set job_id = $2 where id = $1', [log!.id, job.id]);
        out.logIds.push(log!.id);
        sent += 1;
      }
      if (sent) out.queued += sent; else out.skipped += 1;
    }
    return out;
  }

  async function sendText(input: SendTextInput): Promise<SendTextResult> {
    try {
      return await queue(input);
    } catch (err) {
      console.error('[mail] sendText failed:', err);
      return { queued: 0, skipped: 0, logIds: [] };
    }
  }

  /** A test text to one person, sent at once; returns the delivery-log rows. */
  async function sendTest(userId: string): Promise<Row[]> {
    const appName = await ctx.settings.get('app.name', DEFAULT_APP_NAME);
    const res = await queue({ userIds: [userId], text: `Test text message from ${appName}. Alerts can reach you this way.`, purpose: 'test' }, { test: true, maxAttempts: 1 });
    const rows: Row[] = [];
    for (const id of res.logIds) {
      const job = await db.one<{ job_id: string }>('select job_id from mail_log where id = $1', [id]);
      if (job?.job_id) await jobs.runNow(job.job_id);
      rows.push((await db.one<Row>('select id, status, error, provider, to_address, template, purpose, sent_at from mail_log where id = $1', [id]))!);
    }
    return rows;
  }

  return { sendText, sendTest, channels };
}

export type TextService = ReturnType<typeof makeTexts>;

// ---------- routes ----------

const A = 'admin.administer';
const TAG = 'Text messages';

export function registerTextRoutes(ctx: ModuleContext, texts: TextService) {
  const { app, db } = ctx;
  const admin = { preHandler: ctx.requirePerm(A) };
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  const recentAuth = (req: FastifyRequest, what: string) => requireRecentAuth({ db, audit: ctx.audit, settings: ctx.settings }, req, what);

  // ---------- each person's contact details (personal data) ----------

  const contactView = async (userId: string) => {
    const c = await contactOf(ctx, userId);
    const on = await texts.channels();
    return { ...c, channels: { gateway: on.gateway, webhook: on.webhook && on.outbound } };
  };

  async function saveContact(req: FastifyRequest, userId: string, label: string) {
    const b = (req.body ?? {}) as Row;
    const before = await contactOf(ctx, userId);
    const mobile = b.mobile === undefined ? before.mobile : cleanMobile(b.mobile);
    const smsAddress = b.smsAddress === undefined ? before.smsAddress : String(b.smsAddress ?? '').trim().toLowerCase();
    const fields: Record<string, string> = {};
    if (mobile === null) fields.mobile = 'Enter the mobile number with its country code, such as +1 555 010 0123, or leave it empty.';
    if (smsAddress && (!EMAIL_RE.test(smsAddress) || smsAddress.length > 200)) fields.smsAddress = 'Enter the email-to-text address, such as 5550100123@text.example.net, or leave it empty.';
    if (Object.keys(fields).length) invalid(fields);
    if (mobile === before.mobile && smsAddress === before.smsAddress) return;
    await db.query(
      `insert into user_alert_contacts (user_id, mobile, sms_address, updated_at, updated_by) values ($1, $2, $3, now(), $4)
       on conflict (user_id) do update set mobile = excluded.mobile, sms_address = excluded.sms_address, updated_at = now(), updated_by = excluded.updated_by`,
      [userId, mobile, smsAddress, req.user!.id],
    );
    // Personal data: the audit trail says what changed, not the numbers themselves.
    const changed = [mobile !== before.mobile ? 'mobile number' : '', smsAddress !== before.smsAddress ? 'email-to-text address' : ''].filter(Boolean);
    await ctx.audit(req, {
      action: 'user.alert_contact', recordType: 'user', recordId: userId, summary: `${label}: ${changed.join(' and ')} changed`,
      before: { mobile: Boolean(before.mobile), smsAddress: Boolean(before.smsAddress) }, after: { mobile: Boolean(mobile), smsAddress: Boolean(smsAddress) },
    });
  }

  async function test(req: FastifyRequest, userId: string, label: string) {
    const c = await contactOf(ctx, userId);
    if (!c.mobile && !c.smsAddress) ctx.fail(409, 'no_contact', 'Save a mobile number or an email-to-text address first.');
    const config = await loadConfig(ctx);
    const s = textSettings(config);
    const on = await texts.channels(config);
    if (!(c.smsAddress && s.gateway) && !(c.mobile && on.webhook)) {
      ctx.fail(409, 'not_configured', 'Text messages are not set up for the details saved: an administrator switches them on under Administration > Email.');
    }
    const rows = await texts.sendTest(userId);
    await ctx.audit(req, {
      action: 'text.test', recordType: 'user', recordId: userId,
      summary: `Test text message to ${label}: ${rows.map((r) => `${r.provider === 'webhook' ? 'webhook' : 'email-to-text'} ${r.status}`).join(', ') || 'nothing sent'}`,
    });
    return { results: rows };
  }

  const userLabel = async (id: string) => (await db.one<{ display_name: string }>('select display_name from users where id = $1 and deleted_at is null', [id]))?.display_name;
  const userParam = async (req: FastifyRequest) => {
    const id = String((req.params as Row).id ?? '');
    const label = UUID_RE.test(id) ? await userLabel(id) : undefined;
    return label ? { id, label } : ctx.fail(404, 'not_found', 'User not found.');
  };

  app.get('/api/me/alert-contact', async (req) => contactView(req.user!.id));
  ctx.describeRoute({
    method: 'GET', path: '/api/me/alert-contact', tag: TAG, summary: 'Your contact details for urgent alerts by text message',
    response: '{ mobile, smsAddress, channels: { gateway, webhook } }',
    description: '`channels` says which ways of sending text messages an administrator has switched on.',
  });
  app.put('/api/me/alert-contact', async (req) => {
    await saveContact(req, req.user!.id, 'Own alert contact details');
    return contactView(req.user!.id);
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/me/alert-contact', tag: TAG, summary: 'Change your contact details for urgent alerts (audited)',
    body: '{ mobile?: "+15550100123" or "", smsAddress?: email-to-text address or "" }',
  });
  app.post('/api/me/alert-contact/test', async (req) => test(req, req.user!.id, req.user!.displayName));
  ctx.describeRoute({ method: 'POST', path: '/api/me/alert-contact/test', tag: TAG, summary: 'Send yourself a test text message now', response: '{ results: [delivery-log rows] }' });

  app.get('/api/admin/users/:id/alert-contact', admin, async (req) => contactView((await userParam(req)).id));
  ctx.describeRoute({ method: 'GET', path: '/api/admin/users/:id/alert-contact', tag: TAG, permission: A, summary: 'A person\'s contact details for urgent alerts' });
  app.put('/api/admin/users/:id/alert-contact', admin, async (req) => {
    const u = await userParam(req);
    await saveContact(req, u.id, `Alert contact details of ${u.label}`);
    return contactView(u.id);
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/admin/users/:id/alert-contact', tag: TAG, permission: A, summary: 'Change a person\'s contact details for urgent alerts (audited)',
    body: '{ mobile?, smsAddress? }',
  });
  app.post('/api/admin/users/:id/alert-contact/test', admin, async (req) => {
    const u = await userParam(req);
    return test(req, u.id, u.label);
  });
  ctx.describeRoute({ method: 'POST', path: '/api/admin/users/:id/alert-contact/test', tag: TAG, permission: A, summary: 'Send a person a test text message now' });

  // ---------- administration: how texts leave ----------

  const publicSettings = async () => {
    const c = await loadConfig(ctx);
    const s = textSettings(c);
    const on = await texts.channels(c);
    return {
      gateway: s.gateway, webhook: s.webhook, url: s.url, secretSet: Boolean(sealedSecret(c, TEXT_SECRET)),
      emailOn: c.enabled, outboundOn: on.outbound,
      hostAllowed: null as boolean | null,
    };
  };
  const withHost = async () => {
    const view = await publicSettings();
    if (!view.url) return view;
    const list = await ctx.settings.get<unknown>('integrations.allowed_hosts', []);
    try { return { ...view, hostAllowed: hostAllowed(new URL(view.url), list) }; } catch { return { ...view, hostAllowed: false }; }
  };

  app.get('/api/admin/text/settings', admin, async () => withHost());
  ctx.describeRoute({
    method: 'GET', path: '/api/admin/text/settings', tag: TAG, permission: A, summary: 'How text messages are sent (the webhook secret is never returned)',
    response: '{ gateway, webhook, url, secretSet, emailOn, outboundOn, hostAllowed }',
  });

  app.put('/api/admin/text/settings', admin, async (req) => {
    const b = (req.body ?? {}) as Row;
    const config = await loadConfig(ctx);
    const before = textSettings(config);
    const next: TextSettings = {
      gateway: b.gateway === undefined ? before.gateway : b.gateway === true,
      webhook: b.webhook === undefined ? before.webhook : b.webhook === true,
      url: b.url === undefined ? before.url : String(b.url ?? '').trim(),
    };
    const secret = typeof b.secret === 'string' && b.secret.trim() ? b.secret.trim() : undefined;
    const clear = b.clearSecret === true;
    const fields: Record<string, string> = {};
    if (next.url) {
      let u: URL | null = null;
      try { u = new URL(next.url); } catch { /* reported below */ }
      // https, or plain http to this machine only (a relay running beside the application).
      const local = u && u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
      if (!u || (u.protocol !== 'https:' && !local) || u.username || u.password || next.url.length > 500) fields.url = 'Enter the https address of your text-message system\'s webhook.';
    }
    if (secret !== undefined && (secret.length < 16 || secret.length > 200)) fields.secret = 'Use a signing secret of 16 to 200 characters.';
    if (next.webhook && !next.url) fields.url ??= 'Enter the webhook address to send text messages through it.';
    if (next.webhook && !secret && (clear || !sealedSecret(config, TEXT_SECRET))) fields.secret ??= 'Enter a signing secret: your text-message system checks each message with it.';
    if (Object.keys(fields).length) invalid(fields);
    const changed = JSON.stringify(next) !== JSON.stringify(before) || secret !== undefined || clear;
    if (!changed) return withHost();
    await recentAuth(req, 'changing how text messages are sent');
    const secrets: Record<string, string> = { ...config.provider_secrets };
    if (clear) delete secrets[TEXT_SECRET];
    if (secret !== undefined) secrets[TEXT_SECRET] = secretBox(db).encrypt(secret, secretContext(TEXT_SECRET));
    await db.query(
      `update mail_config set provider_settings = jsonb_set(provider_settings, '{text}', $1::jsonb), provider_secrets = $2::jsonb where id = 1`,
      [JSON.stringify(next), JSON.stringify(secrets)],
    );
    await ctx.audit(req, {
      action: 'text.settings', recordType: 'mail',
      summary: `Text-message settings changed${secret !== undefined || clear ? ' (webhook signing secret changed)' : ''}`,
      before, after: next,
    });
    return withHost();
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/admin/text/settings', tag: TAG, permission: A, summary: 'Change how text messages are sent',
    description: 'Needs a recent password confirmation. `gateway`: texts may go to people\'s email-to-text addresses (through the email settings). `webhook`: texts are posted to `url` (https), signed with `secret` (kept encrypted, never returned; `clearSecret: true` removes it); the host must be on the allow-list and outbound connections switched on. Audited.',
    body: '{ gateway?, webhook?, url?, secret?, clearSecret? }',
  });
}
