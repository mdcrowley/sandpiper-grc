// Administration of email: settings, test message, templates and the delivery log.
import type { FastifyRequest } from 'fastify';
import { requireRecentAuth, secretBox } from '../auth.ts';
import { DEFAULT_APP_NAME } from '../config.ts';
import type { ModuleContext, Row } from '../module.ts';
import { providerNames } from './provider.ts';
import { EMAIL_RE, loadConfig, SECRET_CONTEXT, type MailService } from './service.ts';
import { DEFAULT_TEMPLATES, render, textToHtml, validateTemplate } from './templates.ts';

const A = 'admin.administer';
const TAG = 'Email';
const TLS_MODES = ['none', 'starttls', 'tls'];
const LOG_STATUSES = ['queued', 'sent', 'failed', 'dead', 'skipped'];

const publicConfig = (c: Row) => ({
  enabled: c.enabled, provider: c.provider, host: c.host, port: c.port, tlsMode: c.tls_mode, username: c.username,
  passwordSet: Boolean(c.password_sealed), fromAddress: c.from_address, fromName: c.from_name, replyTo: c.reply_to,
  baseUrl: c.base_url, updatedAt: c.updated_at,
});

/** Sample values for a template preview. */
const SAMPLE: Row = {
  appName: '', recipientName: 'Alex Example', senderName: 'Sam Administrator', title: 'Ticket assigned to you: Depot printer offline',
  body: 'Priority high, raised by the service desk.', kindLabel: 'Assigned to me', link: '/tickets', preferencesLink: '/notifications?tab=preferences',
  username: 'alex.example', expiresAt: 'in 24 hours', count: 3, subject: 'Monthly service report', message: 'The report you subscribed to is ready.',
};

export function registerMailRoutes(ctx: ModuleContext, mail: MailService) {
  const { app, db } = ctx;
  const admin = { preHandler: ctx.requirePerm(A) };
  const recentAuth = (req: FastifyRequest, what: string) => requireRecentAuth({ db, audit: ctx.audit, settings: ctx.settings }, req, what);
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

  // ---------- settings ----------

  app.get('/api/admin/mail/settings', admin, async () => ({
    ...publicConfig(await loadConfig(ctx)), providers: providerNames(), tlsModes: TLS_MODES,
  }));
  ctx.describeRoute({ method: 'GET', path: '/api/admin/mail/settings', tag: TAG, permission: A, summary: 'Email settings (the password is never returned)' });

  app.put('/api/admin/mail/settings', admin, async (req) => {
    const b = (req.body ?? {}) as Row;
    const before = await loadConfig(ctx);
    const str = (v: unknown, fallback: string) => (v === undefined ? fallback : String(v ?? '').trim());
    const next = {
      enabled: b.enabled === undefined ? before.enabled : b.enabled === true,
      provider: str(b.provider, before.provider),
      host: str(b.host, before.host),
      port: b.port === undefined ? before.port : Number(b.port),
      tls_mode: str(b.tlsMode, before.tls_mode),
      username: str(b.username, before.username),
      from_address: str(b.fromAddress, before.from_address),
      from_name: str(b.fromName, before.from_name),
      reply_to: str(b.replyTo, before.reply_to),
      base_url: str(b.baseUrl, before.base_url).replace(/\/+$/, ''),
    };
    const fields: Record<string, string> = {};
    if (!providerNames().includes(next.provider)) fields.provider = `Choose one of: ${providerNames().join(', ')}.`;
    if (next.host.length > 253 || /[\s/]/.test(next.host)) fields.host = 'Enter a host name or address, with no spaces or slashes.';
    if (!Number.isInteger(next.port) || next.port < 1 || next.port > 65535) fields.port = 'Enter a port from 1 to 65535.';
    if (!TLS_MODES.includes(next.tls_mode)) fields.tlsMode = 'Choose none, STARTTLS or TLS.';
    if (next.username.length > 200) fields.username = 'Keep the user name under 200 characters.';
    if (next.from_address && !EMAIL_RE.test(next.from_address)) fields.fromAddress = 'Enter an email address.';
    if (next.from_name.length > 100 || /["\r\n]/.test(next.from_name)) fields.fromName = 'Use up to 100 characters, without quotation marks.';
    if (next.reply_to && !EMAIL_RE.test(next.reply_to)) fields.replyTo = 'Enter an email address, or leave it empty.';
    if (next.base_url) {
      let u: URL | null = null;
      try { u = new URL(next.base_url); } catch { /* reported below */ }
      if (!u || !['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) {
        fields.baseUrl = 'Enter the address people use to open the application, such as https://grc.example.org.';
      }
    }
    if (next.enabled) {
      if (!next.host) fields.host ??= 'Enter the mail server to switch email on.';
      if (!next.from_address) fields.fromAddress ??= 'Enter the address messages come from to switch email on.';
      if (!next.base_url) fields.baseUrl ??= 'Enter the application address to switch email on: messages link back to it.';
    }
    const password = b.password === undefined || b.password === null || b.password === '' ? undefined : String(b.password);
    if (password !== undefined && password.length > 500) fields.password = 'Keep the password under 500 characters.';
    if (Object.keys(fields).length) invalid(fields);

    const pick = (c: Row) => ({ ...publicConfig(c), updatedAt: undefined });
    const passwordChange = password !== undefined || b.clearPassword === true;
    const changed = JSON.stringify(pick({ ...before, ...next })) !== JSON.stringify(pick(before)) || passwordChange;
    if (!changed) return { ...publicConfig(before), providers: providerNames(), tlsModes: TLS_MODES };
    await recentAuth(req, 'changing the email settings');

    const sealed = password !== undefined ? secretBox(db).encrypt(password, SECRET_CONTEXT) : b.clearPassword === true ? null : before.password_sealed;
    await db.query(
      `update mail_config set enabled = $1, provider = $2, host = $3, port = $4, tls_mode = $5, username = $6, from_address = $7,
         from_name = $8, reply_to = $9, base_url = $10, password_sealed = $11, updated_at = now(), updated_by = $12 where id = 1`,
      [next.enabled, next.provider, next.host, next.port, next.tls_mode, next.username, next.from_address, next.from_name,
        next.reply_to, next.base_url, sealed, req.user!.id],
    );
    const after = await loadConfig(ctx);
    await ctx.audit(req, {
      action: 'mail.settings', recordType: 'mail', summary: before.enabled !== after.enabled
        ? `Email ${after.enabled ? 'switched on' : 'switched off'}${passwordChange ? '; password changed' : ''}`
        : `Email settings changed${passwordChange ? ' (password changed)' : ''}`,
      before: pick(before), after: pick(after),
    });
    return { ...publicConfig(after), providers: providerNames(), tlsModes: TLS_MODES };
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/admin/mail/settings', tag: TAG, permission: A, summary: 'Change the email settings',
    description: 'Needs a recent password confirmation. `password` replaces the stored password (kept encrypted); leave it out to keep it, or send `clearPassword: true`.',
    body: '{ enabled, provider, host, port, tlsMode: none|starttls|tls, username, password?, clearPassword?, fromAddress, fromName, replyTo, baseUrl }',
  });

  app.post('/api/admin/mail/test', admin, async (req) => {
    const b = (req.body ?? {}) as Row;
    const to = String(b.to ?? req.user!.email ?? '').trim();
    if (!EMAIL_RE.test(to)) invalid({ to: 'Enter the email address to send the test to.' });
    const config = await loadConfig(ctx);
    if (!config.host || !config.from_address) ctx.fail(409, 'not_configured', 'Save the mail server and the from address first.');
    const result = await mail.sendTest(to, req.user!);
    await ctx.audit(req, { action: 'mail.test', recordType: 'mail', summary: `Test email to ${to}: ${result.status}` });
    return result;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/admin/mail/test', tag: TAG, permission: A, summary: 'Send a test email now',
    description: 'Works while email is switched off, so the settings can be checked first. Returns the delivery-log row.', body: '{ to? }',
  });

  // ---------- delivery log ----------

  app.get('/api/admin/mail/log', admin, async (req) => {
    const q = req.query as Record<string, string>;
    const status = LOG_STATUSES.includes(q.status) ? q.status : null;
    const purpose = typeof q.purpose === 'string' && q.purpose ? q.purpose.slice(0, 40) : null;
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 50));
    const page = Math.min(100000, Math.max(1, Math.trunc(Number(q.page)) || 1));
    const where = '($1::text is null or status = $1) and ($2::text is null or purpose = $2)';
    const total = (await db.one<{ c: number }>(`select count(*)::int c from mail_log where ${where}`, [status, purpose]))!.c;
    const rows = await db.query(
      `select id, created_at, job_id, template, purpose, user_id, to_address, subject, status, attempts, error, provider, sent_at
       from mail_log where ${where} order by created_at desc, id limit ${pageSize} offset ${(page - 1) * pageSize}`,
      [status, purpose],
    );
    return { rows, total, page, pageSize };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/admin/mail/log', tag: TAG, permission: A, summary: 'Messages the application tried to send, newest first',
    query: { status: 'queued, sent, failed, dead or skipped', purpose: 'test, notification, digest, setup_link, reset_link, ...', page: 'Page', pageSize: 'Rows a page' },
  });

  // ---------- templates ----------

  const defOf = (key: string) => DEFAULT_TEMPLATES.find((t) => t.key === key) ?? ctx.fail(404, 'not_found', 'Template not found.');
  const shape = (r: Row) => {
    const def = DEFAULT_TEMPLATES.find((t) => t.key === r.key)!;
    return {
      key: r.key, name: r.name, description: r.description, subject: r.subject, text: r.text_body, html: r.html_body,
      customised: r.customised, updatedAt: r.updated_at, placeholders: def?.placeholders ?? [],
    };
  };

  app.get('/api/admin/mail/templates', admin, async () =>
    (await db.query<Row>('select * from mail_templates')).filter((r) => DEFAULT_TEMPLATES.some((t) => t.key === r.key))
      .sort((a, b) => DEFAULT_TEMPLATES.findIndex((t) => t.key === a.key) - DEFAULT_TEMPLATES.findIndex((t) => t.key === b.key))
      .map(shape));
  ctx.describeRoute({ method: 'GET', path: '/api/admin/mail/templates', tag: TAG, permission: A, summary: 'Message templates with their placeholders' });

  const cleanTemplate = (b: Row) => ({ subject: String(b.subject ?? ''), text: String(b.text ?? ''), html: String(b.html ?? '') });

  app.put('/api/admin/mail/templates/:key', admin, async (req) => {
    const def = defOf(String((req.params as Row).key));
    const t = cleanTemplate((req.body ?? {}) as Row);
    const fields = validateTemplate(def, t);
    if (Object.keys(fields).length) invalid(fields);
    const before = (await db.one<Row>('select * from mail_templates where key = $1', [def.key]))!;
    await db.query(
      `update mail_templates set subject = $2, text_body = $3, html_body = $4, customised = true, updated_at = now(), updated_by = $5 where key = $1`,
      [def.key, t.subject, t.text, t.html, req.user!.id],
    );
    await ctx.audit(req, {
      action: 'mail.template', recordType: 'mail', summary: `Email template "${def.name}" changed`,
      before: { subject: before.subject, text: before.text_body, html: before.html_body }, after: t,
    });
    return shape((await db.one<Row>('select * from mail_templates where key = $1', [def.key]))!);
  });
  ctx.describeRoute({ method: 'PUT', path: '/api/admin/mail/templates/:key', tag: TAG, permission: A, summary: 'Change a template', body: '{ subject, text, html }' });

  app.post('/api/admin/mail/templates/:key/reset', admin, async (req) => {
    const def = defOf(String((req.params as Row).key));
    await db.query(
      `update mail_templates set subject = $2, text_body = $3, html_body = $4, customised = false, updated_at = now(), updated_by = $5 where key = $1`,
      [def.key, def.subject, def.text, textToHtml(def.text), req.user!.id],
    );
    await ctx.audit(req, { action: 'mail.template', recordType: 'mail', summary: `Email template "${def.name}" put back to the default` });
    return shape((await db.one<Row>('select * from mail_templates where key = $1', [def.key]))!);
  });
  ctx.describeRoute({ method: 'POST', path: '/api/admin/mail/templates/:key/reset', tag: TAG, permission: A, summary: 'Put a template back to the default' });

  app.post('/api/admin/mail/templates/:key/preview', admin, async (req) => {
    const def = defOf(String((req.params as Row).key));
    const t = cleanTemplate((req.body ?? {}) as Row);
    const fields = validateTemplate(def, t);
    if (Object.keys(fields).length) invalid(fields);
    const base = (await loadConfig(ctx)).base_url || 'https://grc.example.org';
    const abs = (p: string) => `${base}${p}`;
    const values = { ...SAMPLE, appName: await ctx.settings.get('app.name', DEFAULT_APP_NAME), link: abs(SAMPLE.link), preferencesLink: abs(SAMPLE.preferencesLink) };
    const sample = ['Action overdue: Replace depot gate controller', 'Approval waiting: Timetable server patch', 'Contract notice date: Fare system support'];
    return render({ subject: t.subject, text_body: t.text, html_body: t.html }, values, {
      items: { text: sample.map((s) => `- ${s}`).join('\n'), html: `<ul>${sample.map((s) => `<li><a href="${abs('/notifications')}">${s}</a></li>`).join('')}</ul>` },
    });
  });
  ctx.describeRoute({ method: 'POST', path: '/api/admin/mail/templates/:key/preview', tag: TAG, permission: A, summary: 'Render a template with sample values', body: '{ subject, text, html }', response: '{ subject, text, html }' });
}

/** Writes the default templates; an administrator's edits are kept. */
export async function ensureTemplates(ctx: ModuleContext) {
  for (const t of DEFAULT_TEMPLATES) {
    await ctx.db.query(
      `insert into mail_templates (key, name, description, subject, text_body, html_body) values ($1, $2, $3, $4, $5, $6)
       on conflict (key) do update set name = excluded.name, description = excluded.description,
         subject = case when mail_templates.customised then mail_templates.subject else excluded.subject end,
         text_body = case when mail_templates.customised then mail_templates.text_body else excluded.text_body end,
         html_body = case when mail_templates.customised then mail_templates.html_body else excluded.html_body end`,
      [t.key, t.name, t.description, t.subject, t.text, textToHtml(t.text)],
    );
  }
}
