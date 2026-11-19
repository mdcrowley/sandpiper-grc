// E15-06: email-to-ticket.
//
// Off by default. An administrator sets it up under Service desk settings > Email to ticket:
//   - POP3: the service desk mailbox is read on a schedule (POP3 over TLS, or STARTTLS; plain
//     only for a relay on the same machine), each message once, and removed unless asked not to.
//   - Relay: a mail server posts each message to POST /api/tickets/email/inbound with the relay
//     key in the `X-GRC-Relay-Key` header (and `X-GRC-CSRF: 1`), as message/rfc822.
//
// A new message becomes a ticket (channel "email") with the sender as requester: a user when the
// address belongs to one, otherwise an outside requester (name and address), or nothing, as the
// administrator chooses; a domain list can limit who may write. A message with a ticket reference
// in the subject ("[TKT-00042]") or in its threading headers adds a public comment instead, when
// it comes from the requester, the affected person or an agent. Files go through the same checks
// as any upload. The application's own messages, auto-replies, bounces, mailing lists and senders
// writing too often are never turned into tickets. Every message is logged.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { loadUser, requireRecentAuth, secretBox } from '../../core/auth.ts';
import { ensureJobs } from '../../core/jobs/index.ts';
import { parseMessage, stripQuoted, type ParsedMessage } from '../../core/mail/mime.ts';
import { Pop3, Pop3Error, type Pop3Tls } from '../../core/mail/pop3.ts';
import { EMAIL_RE } from '../../core/mail/service.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';
import { canStoreFiles, storeTicketFile } from './mail-files.ts';
import type { TicketNotify } from './notify.ts';

export const INTAKE_KEY = 'tickets.email_intake';
const SECRET_CONTEXT = 'tickets:email_intake';
const A = 'admin.administer';
const MAX_MESSAGE_BYTES = 30 * 1024 * 1024;
const MAX_PER_POLL = 50;
const MAX_FILES = 10;
/** Small inline images (signature logos) are left out; larger ones are usually pasted photos. */
const INLINE_KEEP_BYTES = 30 * 1024;
const TLS_MODES: Pop3Tls[] = ['tls', 'starttls', 'none'];

export interface IntakeSettings {
  enabled: boolean;
  source: 'pop3' | 'relay';
  host: string;
  port: number;
  tls: Pop3Tls;
  username: string;
  password_sealed: string | null;
  poll_minutes: number;
  leave_on_server: boolean;
  /** The service desk address people write to; also used as the reply-to of messages sent about these tickets. */
  address: string;
  unknown_senders: 'create' | 'ignore';
  allowed_domains: string[];
  ticket_type: string;
  assignment_group: string | null;
  acknowledge: boolean;
  reply_by_email: boolean;
  max_per_hour: number;
  relay_key_hash: string | null;
  relay_key_hint: string | null;
  last_poll_at: string | null;
  last_poll_error: string | null;
}

export const INTAKE_DEFAULTS: IntakeSettings = {
  enabled: false, source: 'pop3', host: '', port: 995, tls: 'tls', username: '', password_sealed: null, poll_minutes: 5,
  leave_on_server: false, address: '', unknown_senders: 'create', allowed_domains: [], ticket_type: 'incident',
  assignment_group: null, acknowledge: true, reply_by_email: true, max_per_hour: 20,
  relay_key_hash: null, relay_key_hint: null, last_poll_at: null, last_poll_error: null,
};

export interface Outcome { outcome: 'created' | 'commented' | 'ignored' | 'refused' | 'failed'; reason: string | null; ticket_id: string | null; ref?: string | null }

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const domainOf = (address: string) => address.split('@')[1]?.toLowerCase() ?? '';

/** Why a message must not become a ticket because a machine sent it, or null for a person's message. */
export function automaticReason(m: ParsedMessage): string | null {
  const h = (name: string) => m.header(name).trim().toLowerCase();
  if (m.headers.has('x-grc-mail')) return 'Sent by this application';
  const auto = h('auto-submitted');
  if (auto && auto !== 'no') return 'Automatic message (auto-reply)';
  if (/^(bulk|junk|list|auto_reply)$/.test(h('precedence'))) return 'Bulk or automatic message';
  if (m.headers.has('x-autoreply') || m.headers.has('x-autorespond') || m.headers.has('x-autoresponder')) return 'Automatic message (auto-reply)';
  if (m.headers.has('list-id') || m.headers.has('list-unsubscribe')) return 'Mailing list message';
  if (m.contentType === 'multipart/report' || h('return-path') === '<>') return 'Delivery report (bounce)';
  const local = m.from?.address.split('@')[0] ?? '';
  if (/^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounces?)([+.-]|$)/i.test(local)) return 'Sent from an address that takes no replies';
  if (/^(auto(matic)?[ -]?reply|out of (the )?office|undeliverable|undelivered|delivery status notification|returned mail)\b/i.test(m.subject)) {
    return 'Automatic reply';
  }
  return null;
}

export function makeEmailIntake(ctx: ModuleContext, notify: TicketNotify) {
  const { app, db } = ctx;

  async function read(): Promise<IntakeSettings> {
    const raw = await ctx.settings.get<Partial<IntakeSettings>>(INTAKE_KEY, {});
    return { ...INTAKE_DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
  }
  const write = (s: IntakeSettings) => ctx.settings.set(INTAKE_KEY, s);

  const publicView = (s: IntakeSettings) => {
    const { password_sealed: sealed, relay_key_hash: hash, ...rest } = s;
    return { ...rest, password_set: Boolean(sealed), relay_key_set: Boolean(hash) };
  };

  async function log(base: Row, o: Outcome, extra: Row = {}): Promise<Outcome> {
    await db.query(
      `insert into mail_inbound_log (source, message_id, from_address, from_name, subject, outcome, reason, ticket_id, attachments, size_bytes)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [base.source, base.message_id || null, base.from_address || null, base.from_name || null, String(base.subject ?? '').slice(0, 300),
        o.outcome, o.reason ? o.reason.slice(0, 500) : null, o.ticket_id, Number(extra.attachments ?? 0), base.size_bytes ?? null]);
    return o;
  }

  async function ownAddresses(s: IntakeSettings): Promise<Set<string>> {
    const set = new Set<string>();
    if (s.address) set.add(s.address.toLowerCase());
    if (s.username.includes('@')) set.add(s.username.toLowerCase());
    try {
      const mail = await db.one<{ from_address: string; reply_to: string }>('select from_address, reply_to from mail_config where id = 1');
      if (mail?.from_address) set.add(mail.from_address.toLowerCase());
      if (mail?.reply_to) set.add(mail.reply_to.toLowerCase());
    } catch { /* email is not set up here */ }
    return set;
  }

  /** The ticket a message answers: a reference in the subject, or our threading id in its headers. */
  async function threadOf(m: ParsedMessage): Promise<Row | undefined> {
    const prefix = (ctx.resources.get('ticket')?.ref?.prefix ?? 'TKT-').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const ref = new RegExp(`\\b(${prefix}\\d{3,})\\b`, 'i').exec(m.subject)?.[1];
    if (ref) {
      const row = await db.one<Row>('select * from tickets where upper(ref) = upper($1) and deleted_at is null', [ref]);
      if (row) return row;
    }
    for (const id of [...m.inReplyTo, ...m.references]) {
      const uuid = /^<ticket\.([0-9a-f-]{36})@/i.exec(id)?.[1];
      if (uuid) {
        const row = await db.one<Row>('select * from tickets where id = $1 and deleted_at is null', [uuid]);
        if (row) return row;
      }
    }
    const earlier = [...m.inReplyTo, ...m.references];
    if (earlier.length) {
      const row = await db.one<Row>(
        `select t.* from mail_inbound_log l join tickets t on t.id = l.ticket_id and t.deleted_at is null
         where l.message_id = any($1::text[]) order by l.received_at desc limit 1`, [earlier]);
      if (row) return row;
    }
    return undefined;
  }

  async function storeFiles(m: ParsedMessage, ticket: Row, by: { userId: string | null; name: string }): Promise<{ stored: number; refused: string[] }> {
    const wanted = m.attachments.filter((a) => !a.inline || a.content.length >= INLINE_KEEP_BYTES).slice(0, MAX_FILES);
    const refused: string[] = m.attachments.length > MAX_FILES ? [`only the first ${MAX_FILES} files were kept`] : [];
    if (!wanted.length) return { stored: 0, refused };
    if (!canStoreFiles(ctx)) return { stored: 0, refused: ['files cannot be stored here'] };
    let stored = 0;
    for (const a of wanted) {
      const r = await storeTicketFile(ctx, { id: String(ticket.id), ref: ticket.ref }, a, by);
      if (r.ok) stored += 1; else refused.push(`${r.fileName}: ${r.reason}`);
    }
    return { stored, refused };
  }

  /** Sends one message about an email ticket to its requester, threaded so a reply comes back to it. */
  async function mailRequester(ticket: Row, subjectLead: string, message: string, s: IntakeSettings): Promise<void> {
    if (!app.hasDecorator('sendMail') || !(await app.mailEnabled())) return;
    const to = String(ticket.requester_email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(to)) return;
    await app.sendMail({
      to, purpose: 'tickets', template: 'message',
      data: { subject: `[${ticket.ref}] ${subjectLead}`.slice(0, 250), message },
      headers: { References: `<ticket.${ticket.id}@grc.invalid>`, 'X-GRC-Ticket': String(ticket.ref) },
      ...(s.address ? { replyTo: s.address } : {}),
    });
  }

  // ---------- one message ----------

  async function processMessage(raw: Buffer, source: 'pop3' | 'relay'): Promise<Outcome> {
    const s = await read();
    let m: ParsedMessage;
    try {
      m = parseMessage(raw);
    } catch (err) {
      return log({ source, size_bytes: raw.length }, { outcome: 'refused', reason: `The message could not be read: ${(err as Error).message}`, ticket_id: null });
    }
    const from = m.from;
    const base: Row = { source, message_id: m.messageId, from_address: from?.address, from_name: from?.name, subject: m.subject, size_bytes: raw.length };
    const ignore = (reason: string) => log(base, { outcome: 'ignored', reason, ticket_id: null });
    if (!from) return ignore('No sender address');

    // Loop guards: our own messages, machines, ourselves, repeats, and floods.
    const machine = automaticReason(m);
    if (machine) return ignore(machine);
    if ((await ownAddresses(s)).has(from.address)) return ignore('Sent from the service desk’s own address');
    if (m.messageId && await db.one(`select 1 from mail_inbound_log where message_id = $1 and outcome in ('created', 'commented')`, [m.messageId])) {
      return ignore('Already received');
    }
    const recent = (await db.one<{ c: number }>(
      `select count(*)::int c from mail_inbound_log where from_address = $1 and outcome in ('created', 'commented') and received_at > now() - interval '1 hour'`,
      [from.address]))!.c;
    if (recent >= s.max_per_hour) return ignore(`More than ${s.max_per_hour} messages from this sender in an hour (loop guard)`);

    // Who wrote.
    const userRow = await db.one<Row>(
      `select u.id, u.display_name, d.name as department from users u left join departments d on d.id = u.department_id
       where lower(u.email) = $1 and u.deleted_at is null and u.status = 'active' limit 1`, [from.address]);
    const user: SessionUser | null = userRow ? await loadUser(db, userRow.id) : null;
    const name = user?.displayName || from.name || from.address;

    // A reply to a ticket we know.
    const ticket = await threadOf(m);
    if (ticket) {
      const onTicket = (user && (user.id === ticket.requester_id || user.id === ticket.affected_user_id || ctx.can(user, 'tickets.edit')))
        || String(ticket.requester_email ?? '').toLowerCase() === from.address;
      if (!onTicket) return log(base, { outcome: 'ignored', reason: `The sender is not the requester of ${ticket.ref}`, ticket_id: ticket.id });
      const body = stripQuoted(m.text).slice(0, 10000) || '(no text: files only)';
      await db.query(
        `insert into comments (record_type, record_id, body, internal, author_id, author_name) values ('ticket', $1, $2, false, $3, $4)`,
        [ticket.id, body, user?.id ?? null, user ? user.displayName : `${name} (by email)`]);
      await ctx.audit(null, { action: 'comment.add', recordType: 'ticket', recordId: ticket.id, summary: `Reply by email from ${from.address} added as a public comment` });
      const files = await storeFiles(m, ticket, { userId: user?.id ?? null, name });
      const status = (await ctx.lookups.values('ticket_status')).find((x) => x.value === ticket.status);
      const done = ['resolved', 'closed'].includes(String(status?.meta?.category ?? ''));
      if (ticket.status === 'waiting_requester') await ctx.resources.update('ticket', ticket.id, { status: ticket.assignee_id ? 'in_progress' : 'new' });
      await notify.send({
        ...(await notify.owners(ticket)), ...notify.about(ticket), kind: 'general',
        title: `${done ? 'Reply by email on a finished request' : 'Reply by email'}: ${notify.name(ticket)}`, body: body.slice(0, 300),
      });
      const notes = [done ? 'the ticket is already resolved or closed' : '', ...files.refused].filter(Boolean);
      return log(base, { outcome: 'commented', reason: notes.length ? notes.join('; ') : null, ticket_id: ticket.id, ref: ticket.ref }, { attachments: files.stored });
    }

    // A new request.
    if (!user) {
      if (s.allowed_domains.length && !s.allowed_domains.some((d) => domainOf(from.address) === d || domainOf(from.address).endsWith(`.${d}`))) {
        return ignore('The sender’s domain is not on the accepted list');
      }
      if (s.unknown_senders === 'ignore') return ignore('The sender is not a user, and messages from unknown senders are ignored');
    }
    const types = new Set((await ctx.lookups.values('ticket_type')).map((v) => v.value));
    const groups = new Set((await ctx.lookups.values('assignment_group')).map((v) => v.value));
    const text = m.text.trim();
    const row = await ctx.resources.create('ticket', {
      title: (m.subject || `Email from ${name}`).slice(0, 200),
      description: text ? text.slice(0, 20000) : null,
      type: types.has(s.ticket_type) ? s.ticket_type : 'incident',
      ...(s.assignment_group && groups.has(s.assignment_group) ? { assignment_group: s.assignment_group } : {}),
      channel: 'email',
      requester_id: user?.id ?? null,
      requester_name: name.slice(0, 200),
      requester_email: from.address,
      requester_department: userRow?.department ?? null,
    });
    await ctx.audit(null, {
      action: 'ticket.email_in', recordType: 'ticket', recordId: row.id,
      summary: `Created from an email from ${from.address}${user ? '' : ' (not a user: recorded as an outside requester)'}`,
    });
    const files = await storeFiles(m, row, { userId: user?.id ?? null, name });
    await notify.send({
      ...(await notify.owners(row)), ...notify.about(row), kind: 'assignment',
      title: `New ticket by email: ${notify.name(row)}`, body: `From ${name}.`,
    });
    if (s.acknowledge) {
      await mailRequester(row, row.title, [
        `We have your request and will be in touch.`,
        `Your reference is ${row.ref}. To add to it, reply to this message and keep the reference in the subject.`,
      ].join('\n\n'), s);
    }
    return log(base, { outcome: 'created', reason: files.refused.length ? files.refused.join('; ') : null, ticket_id: row.id, ref: row.ref }, { attachments: files.stored });
  }

  async function processSafely(raw: Buffer, source: 'pop3' | 'relay'): Promise<Outcome> {
    try {
      return await processMessage(raw, source);
    } catch (err) {
      console.error('[tickets] email could not be processed:', err);
      let m: ParsedMessage | null = null;
      try { m = parseMessage(raw); } catch { /* logged as unreadable */ }
      return log({ source, message_id: m?.messageId, from_address: m?.from?.address, from_name: m?.from?.name, subject: m?.subject, size_bytes: raw.length },
        { outcome: 'failed', reason: (err as Error).message ?? 'error', ticket_id: null });
    }
  }

  // ---------- the mailbox ----------

  function password(s: IntakeSettings): string {
    if (!s.password_sealed) return '';
    try {
      return secretBox(db).decrypt(s.password_sealed, SECRET_CONTEXT);
    } catch {
      throw new Pop3Error('The stored mailbox password could not be decrypted (the secret key has changed). Enter it again.', false);
    }
  }

  async function connect(s: IntakeSettings): Promise<Pop3> {
    return Pop3.connect({ host: s.host, port: s.port, tls: s.tls, username: s.username, password: password(s) });
  }

  let running: Promise<Row> | null = null;
  /** Reads the mailbox once. Never two at a time in this process. */
  async function poll(): Promise<Row> {
    running ??= (async () => {
      const s = await read();
      const result = { fetched: 0, created: 0, commented: 0, ignored: 0, refused: 0, failed: 0 };
      try {
        const box = await connect(s);
        try {
          const list = await box.list();
          for (const item of list.slice(0, MAX_PER_POLL)) {
            const seen = await db.one('select 1 from mail_inbound_seen where uid = $1', [item.uid]);
            if (seen) {
              if (!s.leave_on_server) await box.delete(item.number);
              continue;
            }
            let outcome: Outcome;
            if (item.size > MAX_MESSAGE_BYTES) {
              outcome = await log({ source: 'pop3', size_bytes: item.size }, { outcome: 'refused', reason: 'The message is larger than 30 MB', ticket_id: null });
            } else {
              const raw = await box.retrieve(item.number, MAX_MESSAGE_BYTES * 2);
              outcome = await processSafely(raw, 'pop3');
            }
            result.fetched += 1;
            result[outcome.outcome] += 1;
            await db.query('insert into mail_inbound_seen (uid) values ($1) on conflict do nothing', [item.uid]);
            // A message that failed is kept on the server for another look; everything else is done with.
            if (!s.leave_on_server && outcome.outcome !== 'failed') await box.delete(item.number);
          }
          await box.quit();
        } finally {
          box.close();
        }
        await db.query(`delete from mail_inbound_seen where seen_at < now() - interval '180 days'`);
        await write({ ...(await read()), last_poll_at: new Date().toISOString(), last_poll_error: null });
        return result;
      } catch (err) {
        await write({ ...(await read()), last_poll_at: new Date().toISOString(), last_poll_error: (err as Error).message.slice(0, 300) });
        throw err;
      }
    })().finally(() => { running = null; });
    return running;
  }

  // ---------- routes ----------

  function register() {
    const admin = { preHandler: ctx.requirePerm(A) };
    const recentAuth = (req: FastifyRequest, what: string) => requireRecentAuth({ db, audit: ctx.audit, settings: ctx.settings }, req, what);
    const TAG = 'Email to ticket';

    app.get('/api/tickets/email/settings', admin, async () => ({
      ...publicView(await read()),
      mail_enabled: app.hasDecorator('mailEnabled') ? await app.mailEnabled() : false,
      files: canStoreFiles(ctx),
    }));
    ctx.describeRoute({ method: 'GET', path: '/api/tickets/email/settings', tag: TAG, permission: A, summary: 'Email-to-ticket settings (the mailbox password and relay key are never returned)' });

    app.put('/api/tickets/email/settings', admin, async (req) => {
      const b = (req.body ?? {}) as Row;
      const before = await read();
      const next: IntakeSettings = { ...before };
      const fields: Record<string, string> = {};
      const str = (k: string) => String(b[k] ?? '').trim();
      const bool = (k: keyof IntakeSettings) => { if (b[k] !== undefined) { if (typeof b[k] !== 'boolean') fields[k] = 'Choose on or off.'; else (next as unknown as Row)[k] = b[k]; } };
      bool('enabled'); bool('leave_on_server'); bool('acknowledge'); bool('reply_by_email');
      if (b.source !== undefined) { if (b.source !== 'pop3' && b.source !== 'relay') fields.source = 'Choose a mailbox or a mail relay.'; else next.source = b.source; }
      if (b.host !== undefined) { const h = str('host'); if (h.length > 253 || /[\s/]/.test(h)) fields.host = 'Enter a host name or address, with no spaces or slashes.'; else next.host = h; }
      if (b.port !== undefined) { const p = Number(b.port); if (!Number.isInteger(p) || p < 1 || p > 65535) fields.port = 'Enter a port from 1 to 65535.'; else next.port = p; }
      if (b.tls !== undefined) { if (!TLS_MODES.includes(b.tls)) fields.tls = 'Choose TLS, STARTTLS or none.'; else next.tls = b.tls; }
      if (b.username !== undefined) { const u = str('username'); if (u.length > 200) fields.username = 'Keep the user name under 200 characters.'; else next.username = u; }
      if (b.poll_minutes !== undefined) { const n = Number(b.poll_minutes); if (!Number.isInteger(n) || n < 1 || n > 60) fields.poll_minutes = 'Enter a whole number of minutes from 1 to 60.'; else next.poll_minutes = n; }
      if (b.max_per_hour !== undefined) { const n = Number(b.max_per_hour); if (!Number.isInteger(n) || n < 1 || n > 500) fields.max_per_hour = 'Enter a whole number from 1 to 500.'; else next.max_per_hour = n; }
      if (b.address !== undefined) { const a = str('address').toLowerCase(); if (a && !EMAIL_RE.test(a)) fields.address = 'Enter an email address, or leave it empty.'; else next.address = a; }
      if (b.unknown_senders !== undefined) { if (b.unknown_senders !== 'create' && b.unknown_senders !== 'ignore') fields.unknown_senders = 'Choose create or ignore.'; else next.unknown_senders = b.unknown_senders; }
      if (b.allowed_domains !== undefined) {
        const list = (Array.isArray(b.allowed_domains) ? b.allowed_domains : String(b.allowed_domains ?? '').split(/[\s,;]+/))
          .map((d: unknown) => String(d).trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
        if (list.some((d: string) => !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d))) fields.allowed_domains = 'Enter domain names such as example.org, separated by commas.';
        else if (list.length > 50) fields.allowed_domains = 'Enter at most 50 domains.';
        else next.allowed_domains = [...new Set<string>(list)];
      }
      if (b.ticket_type !== undefined) {
        if (!(await ctx.lookups.values('ticket_type')).some((v) => v.value === b.ticket_type)) fields.ticket_type = 'Choose a ticket type.';
        else next.ticket_type = String(b.ticket_type);
      }
      if (b.assignment_group !== undefined) {
        const g = b.assignment_group === null || b.assignment_group === '' ? null : String(b.assignment_group);
        if (g && !(await ctx.lookups.values('assignment_group')).some((v) => v.value === g)) fields.assignment_group = 'Choose an assignment group.';
        else next.assignment_group = g;
      }
      const pw = b.password === undefined || b.password === null || b.password === '' ? undefined : String(b.password);
      if (pw !== undefined && pw.length > 500) fields.password = 'Keep the password under 500 characters.';
      if (next.enabled && next.source === 'pop3') {
        if (!next.host) fields.host ??= 'Enter the mail server to switch email to ticket on.';
        if (!next.username) fields.username ??= 'Enter the mailbox user name to switch email to ticket on.';
        if (!next.password_sealed && pw === undefined) fields.password ??= 'Enter the mailbox password to switch email to ticket on.';
      }
      if (next.enabled && next.source === 'relay' && !next.relay_key_hash) fields.source ??= 'Create a relay key first, then switch email to ticket on.';
      if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
      if (pw !== undefined) next.password_sealed = secretBox(db).encrypt(pw, SECRET_CONTEXT);
      const changed = JSON.stringify(publicView(next)) !== JSON.stringify(publicView(before)) || pw !== undefined;
      if (!changed) return publicView(before);
      await recentAuth(req, 'changing the email-to-ticket settings');
      await write(next);
      const shown = (x: IntakeSettings) => { const { last_poll_at: _a, last_poll_error: _b, ...rest } = publicView(x); return rest; };
      await ctx.audit(req, {
        action: 'tickets.email_settings', recordType: 'mail',
        summary: before.enabled !== next.enabled ? `Email to ticket ${next.enabled ? 'switched on' : 'switched off'}` : `Email-to-ticket settings changed${pw !== undefined ? ' (mailbox password changed)' : ''}`,
        before: shown(before), after: shown(next),
      });
      await schedule(next);
      return publicView(next);
    });
    ctx.describeRoute({
      method: 'PUT', path: '/api/tickets/email/settings', tag: TAG, permission: A, summary: 'Change the email-to-ticket settings',
      description: 'Needs a recent password confirmation. `password` replaces the stored mailbox password (kept encrypted); leave it out to keep it.',
      body: '{ enabled, source: pop3|relay, host, port, tls: tls|starttls|none, username, password?, poll_minutes, leave_on_server, address, unknown_senders: create|ignore, allowed_domains: [], ticket_type, assignment_group, acknowledge, reply_by_email, max_per_hour }',
    });

    app.post('/api/tickets/email/relay-key', admin, async (req) => {
      await recentAuth(req, 'creating a mail relay key');
      const key = `grc_relay_${randomBytes(24).toString('hex')}`;
      const s = await read();
      await write({ ...s, relay_key_hash: sha(key), relay_key_hint: key.slice(-4) });
      await ctx.audit(req, { action: 'tickets.email_relay_key', recordType: 'mail', summary: s.relay_key_hash ? 'Mail relay key replaced' : 'Mail relay key created' });
      return { key, hint: key.slice(-4) };
    });
    ctx.describeRoute({ method: 'POST', path: '/api/tickets/email/relay-key', tag: TAG, permission: A, summary: 'Create (or replace) the mail relay key; it is shown in this answer only', response: '{ key, hint }' });

    app.post('/api/tickets/email/test', admin, async () => {
      const s = await read();
      if (!s.host || !s.username) ctx.fail(409, 'not_configured', 'Save the mail server, user name and password first.');
      try {
        const box = await connect(s);
        const list = await box.list();
        await box.quit();
        return { ok: true, messages: list.length };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    });
    ctx.describeRoute({ method: 'POST', path: '/api/tickets/email/test', tag: TAG, permission: A, summary: 'Sign in to the mailbox and count its messages, without reading any', response: '{ ok, messages?, error? }' });

    app.post('/api/tickets/email/check', admin, async (req) => {
      const s = await read();
      if (!s.enabled || s.source !== 'pop3') ctx.fail(409, 'not_enabled', 'Switch email to ticket on with a mailbox first.');
      try {
        const result = await poll();
        await ctx.audit(req, { action: 'tickets.email_check', recordType: 'mail', summary: `Mailbox read by hand: ${result.fetched} message(s)` });
        return { ok: true, ...result };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    });
    ctx.describeRoute({ method: 'POST', path: '/api/tickets/email/check', tag: TAG, permission: A, summary: 'Read the mailbox now', response: '{ ok, fetched, created, commented, ignored, refused, failed } or { ok: false, error }' });

    app.get('/api/tickets/email/log', admin, async (req) => {
      const q = req.query as Record<string, string>;
      const outcome = ['created', 'commented', 'ignored', 'refused', 'failed'].includes(q.outcome) ? q.outcome : null;
      const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 50));
      const page = Math.min(100000, Math.max(1, Math.trunc(Number(q.page)) || 1));
      const total = (await db.one<{ c: number }>('select count(*)::int c from mail_inbound_log where ($1::text is null or outcome = $1)', [outcome]))!.c;
      const rows = await db.query<Row>(
        `select l.id, l.received_at, l.source, l.from_address, l.from_name, l.subject, l.outcome, l.reason, l.ticket_id, l.attachments, t.ref as ticket_ref
         from mail_inbound_log l left join tickets t on t.id = l.ticket_id
         where ($1::text is null or l.outcome = $1) order by l.received_at desc, l.id limit ${pageSize} offset ${(page - 1) * pageSize}`, [outcome]);
      return { rows, total, page, pageSize };
    });
    ctx.describeRoute({
      method: 'GET', path: '/api/tickets/email/log', tag: TAG, permission: A, summary: 'Messages received, newest first, and what became of each',
      query: { outcome: 'created, commented, ignored, refused or failed', page: 'Page', pageSize: 'Rows a page (max 200)' },
    });

    // The mail relay's way in: no session, a key of its own.
    void app.register(async (scoped) => {
      scoped.addContentTypeParser(['message/rfc822', 'application/octet-stream'], { parseAs: 'buffer', bodyLimit: MAX_MESSAGE_BYTES }, (_req, body, done) => done(null, body));
      scoped.post('/api/tickets/email/inbound', { config: { public: true }, bodyLimit: MAX_MESSAGE_BYTES }, async (req, reply) => {
        const s = await read();
        const given = String(req.headers['x-grc-relay-key'] ?? '');
        const ok = s.enabled && s.source === 'relay' && s.relay_key_hash && given
          && timingSafeEqual(Buffer.from(sha(given), 'hex'), Buffer.from(s.relay_key_hash, 'hex'));
        if (!ok) ctx.fail(404, 'not_found', 'Not found.');
        if (!Buffer.isBuffer(req.body) || !req.body.length) ctx.fail(415, 'unsupported_media_type', 'Send the message as the request body with the content type message/rfc822.');
        const outcome = await processSafely(req.body as Buffer, 'relay');
        reply.code(outcome.outcome === 'failed' ? 500 : 202);
        return { outcome: outcome.outcome, reason: outcome.reason, ref: outcome.ref ?? null };
      });
    });
    ctx.describeRoute({
      method: 'POST', path: '/api/tickets/email/inbound', tag: TAG, public: true, summary: 'A mail relay hands over one received message',
      description: 'Only while email to ticket is on with the relay source. Headers: `X-GRC-Relay-Key: <key>` and `X-GRC-CSRF: 1`; body: the raw message, content type `message/rfc822` (at most 30 MB). Answers 202 with what became of it; 404 for a wrong key or when switched off.',
      response: '{ outcome: created|commented|ignored|refused|failed, reason, ref }',
    });

    // Public replies by an agent on an email ticket go to the requester by email.
    app.addHook('onResponse', async (req, reply) => {
      if (req.method !== 'POST' || reply.statusCode !== 201 || req.url.split('?')[0] !== '/api/comments' || !req.user) return;
      const b = (req.body ?? {}) as Row;
      if (b.record_type !== 'ticket' || b.internal !== false) return;
      try {
        const s = await read();
        if (!s.enabled || !s.reply_by_email) return;
        const t = await db.one<Row>(`select id, ref, title, channel, requester_email, requester_id from tickets where id::text = $1 and deleted_at is null`, [String(b.record_id)]);
        if (!t || t.channel !== 'email' || t.requester_id === req.user.id) return;
        await mailRequester(t, t.title, `${req.user.displayName} wrote:\n\n${String(b.body ?? '').trim()}\n\nReply to this message to answer. Keep [${t.ref}] in the subject.`, s);
      } catch (err) {
        console.error('[tickets] could not email the requester:', err);
      }
    });
  }

  /** The mailbox is read on the job queue at the chosen interval (Administration > Background jobs). */
  async function schedule(s?: IntakeSettings): Promise<void> {
    const settings = s ?? await read();
    const jobs = await ensureJobs(ctx);
    await jobs.schedule('tickets.email_poll', { type: 'tickets.email_poll', every: settings.poll_minutes * 60_000, firstRunInMs: 60_000 });
  }

  async function start(): Promise<void> {
    const jobs = await ensureJobs(ctx);
    jobs.register('tickets.email_poll', async () => {
      const s = await read();
      if (!s.enabled || s.source !== 'pop3') return { skipped: 'email to ticket is off' };
      return poll();
    }, { maxAttempts: 2, backoffSeconds: 60 });
    await schedule();
  }

  return { read, processMessage: processSafely, poll, register, start };
}
