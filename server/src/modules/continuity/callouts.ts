// Call-tree messages with acknowledgment (E41-14). During an activation, someone who may edit it
// sends one of the activated plans' call trees a short message, by email and by text message, through
// the application's own alert channels (core/mail: the email settings, people's email-to-text
// addresses and the administrator's text-message webhook; no paid service). Each person gets a link
// of their own to acknowledge it without signing in, and the activation shows who has acknowledged and
// who has not. Someone who acknowledges by phone is marked by staff. A reminder can be sent to those
// who have not acknowledged.
//
// The link: a random secret (32 bytes) that only acknowledges this one message for this one person;
// only its SHA-256 hash is stored, it stops working when the message expires (1 to 168 hours, 72 by
// default) or the activation is closed, and the public routes are rate limited per address and answer
// the same "not valid" for an unknown, expired or closed link. Only a link that matches nothing ever
// sent counts toward an address's wrong-link limit (a replaced, expired or closed one does not). In an
// email the link is sealed in the queued message like an account set-up link. A text message has to carry the link in its text, so
// the link is also in the delivery log of texts, which only administrators read; it can do nothing but
// acknowledge. Who is reached: an entry linked to an account gets email at the account's address and
// texts at the person's alert contacts; an entry linked to a roster person without an account gets
// email at the roster address (text messages go only to people with an account); a typed name and
// phone is listed as "call them".
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import { configuredBase, loopbackBase } from '../../core/identity/base.ts';
import { ensureMail } from '../../core/mail/index.ts';
import { expiresText } from '../../core/mail/links.ts';
import { EMAIL_RE, loadConfig } from '../../core/mail/service.ts';
import { TEXT_MAX, textSettings } from '../../core/mail/texts.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { actorOf } from '../../core/dataload.ts';
import { organizationName, readOrganization } from '../../core/organization.ts';
import { makeDbLimiter } from '../../core/ratelimit.ts';
import { clientIp } from '../../core/request.ts';
import { activationFor } from './activations.ts';
import { callTreeOf, inTreeOrder } from './plans.ts';
import { invalid, text } from './shared.ts';

export const DEFAULT_HOURS = 72;
export const MAX_HOURS = 168;
const MESSAGE_MAX = 1000;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const NOT_VALID = 'This link is not valid. It may have expired, the emergency may be over, or a newer message replaced it.';
export const ackPath = (token: string) => `/call-out/${token}`;
const hash = (token: string) => createHash('sha256').update(`callout:${token}`).digest('hex');

type Reach = 'email' | 'text' | 'both' | 'none';

export function registerCallouts(ctx: ModuleContext) {
  const { app, db } = ctx;
  // Public routes: 60 requests a minute from one address; a link that matches nothing ever sent counts
  // again (20 in 15 minutes).
  const perMinute = makeDbLimiter(db, 'callout_ack', 60, 60_000);
  const wrong = makeDbLimiter(db, 'callout_ack_bad', 20, 15 * 60_000);
  // Sending: at most 20 messages (and reminders) an hour for one activation.
  const perActivation = makeDbLimiter(db, 'callout_send', 20, 60 * 60_000);
  const mailReady = ensureMail(ctx);

  const byOf = (req: FastifyRequest) => ({ id: actorOf(req).id, name: actorOf(req).name ?? 'System' });
  const addLog = (activationId: string, entry: string, by: { id: string | null; name: string | null }) =>
    db.query('insert into activation_log_entries (activation_id, entry, by_id, by_name) values ($1, $2, $3, $4)', [activationId, entry, by.id, by.name]);

  /** The application's address for links in text messages: the email settings', the configured one, or this machine's. */
  async function linkBase(req: FastifyRequest): Promise<string> {
    const mailBase = String((await loadConfig(ctx)).base_url ?? '').trim().replace(/\/+$/, '');
    return (/^https?:\/\/\S+$/.test(mailBase) ? mailBase : '') || (await configuredBase(ctx.settings)) || loopbackBase(req) || '';
  }

  async function channels() {
    const mail = await mailReady;
    // Text messages are set up when email-to-text is on (with email) or the webhook has an address.
    const config = await loadConfig(ctx);
    const s = textSettings(config);
    return { email: await mail.enabled(), text: app.hasDecorator('sendText') && ((s.gateway && config.enabled === true) || (s.webhook && Boolean(s.url))) };
  }

  /** The people a call tree reaches: account, roster person and email for each entry, in tree order, each person once. */
  async function recipientsOf(planId: string) {
    const nodes = inTreeOrder(await callTreeOf(ctx, planId));
    const people = Boolean(ctx.resources.get('person'));
    const seen = new Set<string>();
    const out: (typeof nodes[number] & { userId: string | null; userEmail: string | null; personEmail: string | null })[] = [];
    for (const n of nodes) {
      let userId = n.user_id;
      let personEmail: string | null = null;
      if (n.person_id && people) {
        const p = await db.one<Row>('select user_id, email from people where id = $1 and deleted_at is null', [n.person_id]);
        userId = userId ?? p?.user_id ?? null;
        personEmail = p?.email && EMAIL_RE.test(String(p.email).trim()) ? String(p.email).trim().toLowerCase() : null;
      }
      const user = userId ? await db.one<Row>(`select id, email from users where id = $1 and deleted_at is null and status = 'active'`, [userId]) : undefined;
      const key = user ? `u:${user.id}` : n.person_id ? `p:${n.person_id}` : `n:${n.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...n, userId: user?.id ?? null, userEmail: user?.email && EMAIL_RE.test(user.email) ? user.email : null, personEmail });
    }
    return out;
  }

  /** Queues one person's email and text message with a new link; returns what was queued. */
  async function deliver(r: Row, callout: Row, activation: Row, token: string, base: string, org: string, reminder: boolean) {
    const ch = await channels();
    const mail = await mailReady;
    const expires = expiresText(callout.expires_at).replace(/^on /, '');
    let emailLogId: string | null = null;
    const textLogIds: string[] = [];
    const address = r.user_email ?? r.person_email ?? null;
    if (callout.by_email && ch.email && address) {
      const subject = `${reminder ? 'Reminder: ' : ''}${org}: ${activation.title}`.slice(0, 200);
      const message = [
        callout.message,
        `You are on the call tree${r.role ? ` as ${r.role}` : ''}. Open the link below to say you have received this message. No sign-in is needed. The link works until ${expires}.`,
        'The link is meant for you: please do not forward it.',
      ].join('\n\n');
      emailLogId = await mail.queueOne(
        { template: 'message', purpose: 'continuity', data: { subject, message, link: ackPath(token) } },
        r.user_id && r.user_email ? { userId: r.user_id, to: r.user_email } : { to: address },
        { accountLink: true }, { maxAttempts: 5 },
      );
    }
    if (callout.by_text && ch.text && r.user_id) {
      const link = base ? ` Acknowledge: ${base}${ackPath(token)}` : '';
      const head = `${reminder ? 'Reminder. ' : ''}${org}: `;
      const room = Math.max(40, TEXT_MAX - head.length - link.length);
      const body = callout.message.length > room ? `${callout.message.slice(0, room - 1)}…` : callout.message;
      const res = await app.sendText({ userIds: [r.user_id], text: `${head}${body}${link}`, purpose: 'continuity' });
      textLogIds.push(...res.logIds);
    }
    return { emailLogId, textLogIds };
  }

  const reachOf = (r: Row): Reach => {
    const email = Boolean(r.email_log_id);
    const textSent = Array.isArray(r.text_log_ids) && r.text_log_ids.length > 0;
    return email && textSent ? 'both' : email ? 'email' : textSent ? 'text' : 'none';
  };

  // ---------- staff: send, list, record by phone, remind ----------

  app.post('/api/emergency-activations/:id/call-outs', { preHandler: ctx.requirePerm('continuity.edit') }, async (req, reply) => {
    const a = await activationFor(ctx, req);
    if (a.status !== 'active') ctx.fail(409, 'not_active', 'Messages go out only while the activation is active.');
    const b = (req.body ?? {}) as Row;
    const errors: Record<string, string> = {};
    const planId = String(b.plan_id ?? '');
    const planIds: string[] = Array.isArray(a.plan_ids) ? a.plan_ids : [];
    const plan = UUID_RE.test(planId) && planIds.includes(planId) ? await ctx.resources.find('continuity_plan', planId, req.user) : undefined;
    if (!plan) errors.plan_id = 'Choose one of the plans activated.';
    const message = text(b.message, MESSAGE_MAX + 1);
    if (!message) errors.message = 'Write the message: what is happening and what people should do.';
    else if (message.length > MESSAGE_MAX) errors.message = `Keep the message to ${MESSAGE_MAX} characters; a text message carries only the first part.`;
    const byEmail = b.email !== false;
    const byText = b.text !== false;
    if (!byEmail && !byText) errors.email = 'Choose email, text message or both.';
    const hours = b.hours === undefined || b.hours === null || b.hours === '' ? DEFAULT_HOURS : Number(b.hours);
    if (!Number.isInteger(hours) || hours < 1 || hours > MAX_HOURS) errors.hours = `Enter a whole number of hours from 1 to ${MAX_HOURS}.`;
    if (Object.keys(errors).length) invalid(ctx, errors);
    const ch = await channels();
    if (!(byEmail && ch.email) && !(byText && ch.text)) {
      ctx.fail(409, 'no_channels', 'Neither email nor text messages are set up, so nothing can be sent. Call the people on the call tree, or ask an administrator to set up email (Administration > Email).');
    }
    if (await perActivation.blocked(a.id)) ctx.fail(429, 'rate_limited', 'Many messages have gone out for this activation in the last hour. Wait a while, or call people.');
    const people = await recipientsOf(plan!.id);
    if (!people.length) ctx.fail(409, 'empty_tree', 'This plan\'s call tree has nobody on it yet.');
    await perActivation.hit(a.id);

    const callout = (await db.one<Row>(
      `insert into activation_callouts (activation_id, plan_id, message, by_email, by_text, expires_at, sent_by, sent_by_name)
       values ($1, $2, $3, $4, $5, now() + make_interval(hours => $6::int), $7, $8) returning *`,
      [a.id, plan!.id, message, byEmail, byText, hours, actorOf(req).id, actorOf(req).name]))!;
    const base = await linkBase(req);
    const org = organizationName(await readOrganization(db));
    const counts = { email: 0, text: 0, none: 0 };
    for (const [i, p] of people.entries()) {
      const token = randomBytes(32).toString('base64url');
      const row = { user_id: p.userId, user_email: p.userEmail, person_email: p.personEmail, role: p.role };
      const sent = await deliver(row, callout, a, token, base, org, false);
      await db.query(
        `insert into activation_callout_recipients (callout_id, activation_id, node_id, sort, depth, role, name, user_id, person_id, email_log_id, text_log_ids, token_hash)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)`,
        [callout.id, a.id, p.id, (i + 1) * 10, p.depth, p.role, p.name, p.userId, p.person_id, sent.emailLogId, JSON.stringify(sent.textLogIds), hash(token)]);
      if (sent.emailLogId) counts.email += 1;
      if (sent.textLogIds.length) counts.text += 1;
      if (!sent.emailLogId && !sent.textLogIds.length) counts.none += 1;
    }
    const summary = `Call-out sent to the call tree of ${plan!.ref ?? 'the plan'}: ${people.length} ${people.length === 1 ? 'person' : 'people'}, ${counts.email} by email, ${counts.text} by text message${counts.none ? `, ${counts.none} not reachable this way (call them)` : ''}.`;
    await addLog(a.id, summary, byOf(req));
    await ctx.audit(req, {
      action: 'emergency_activation.call_out', recordType: 'emergency_activation', recordId: a.id, summary,
      after: { callout_id: callout.id, plan_id: plan!.id, people: people.length, ...counts, expires_at: callout.expires_at },
    });
    reply.code(201);
    return { id: callout.id, people: people.length, ...counts, text_links: Boolean(base), expires_at: callout.expires_at };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/emergency-activations/:id/call-outs', tag: 'Continuity', permission: 'continuity.edit',
    summary: 'Send an activated plan\'s call tree a message by email and text message, each person with a link to acknowledge it (logged)',
    description: 'Only while the activation is active. Email goes to the account\'s or roster person\'s address (when email is set up); text messages go to the alert contacts of people with an account (when text messages are set up). Each person gets their own link, valid for `hours` (default 72, at most 168). 409 `no_channels` when neither way is set up; 409 `empty_tree`; 429 after 20 sends an hour for one activation. `text_links` is false when no application address is known, so texts went without the link.',
    body: '{ plan_id, message, email?: boolean (default true), text?: boolean (default true), hours?: 1-168 }',
    response: '{ id, people, email, text, none, text_links, expires_at }',
  });

  /** Delivery states of the delivery-log rows, by id. */
  async function deliveries(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await db.query<Row>('select id, status from mail_log where id = any($1::uuid[])', [ids]);
    return new Map(rows.map((r) => [String(r.id), String(r.status)]));
  }

  app.get('/api/emergency-activations/:id/call-outs', { preHandler: ctx.requirePerm('continuity.view') }, async (req) => {
    const a = await activationFor(ctx, req);
    const callouts = await db.query<Row>(
      `select c.id, c.plan_id, p.ref as plan_ref, p.title as plan_title, c.message, c.by_email, c.by_text, c.expires_at, c.sent_at, c.sent_by_name
       from activation_callouts c left join continuity_plans p on p.id = c.plan_id where c.activation_id = $1 order by c.sent_at desc`, [a.id]);
    const recipients = await db.query<Row>(
      `select id, callout_id, depth, role, name, user_id, person_id, email_log_id, text_log_ids, acknowledged_at, ack_via, ack_by_name, ack_note
       from activation_callout_recipients where activation_id = $1 order by sort`, [a.id]);
    const states = await deliveries(recipients.flatMap((r) => [r.email_log_id, ...(Array.isArray(r.text_log_ids) ? r.text_log_ids : [])]).filter(Boolean).map(String));
    const ch = await channels();
    return {
      channels: ch,
      rows: callouts.map((c) => {
        const mine = recipients.filter((r) => r.callout_id === c.id).map((r) => ({
          id: r.id, depth: r.depth, role: r.role, name: r.name, reach: reachOf(r),
          email_status: r.email_log_id ? states.get(String(r.email_log_id)) ?? null : null,
          text_status: (Array.isArray(r.text_log_ids) ? r.text_log_ids : []).map((id: string) => states.get(String(id))).filter(Boolean)[0] ?? null,
          acknowledged_at: r.acknowledged_at, ack_via: r.ack_via, ack_by_name: r.ack_by_name, ack_note: r.ack_note,
        }));
        return {
          ...c, expired: new Date(c.expires_at).getTime() <= Date.now(), recipients: mine,
          total: mine.length, acknowledged: mine.filter((r) => r.acknowledged_at).length,
          waiting: mine.filter((r) => !r.acknowledged_at).length, unreachable: mine.filter((r) => r.reach === 'none' && !r.acknowledged_at).length,
        };
      }),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/emergency-activations/:id/call-outs', tag: 'Continuity', permission: 'continuity.view',
    summary: 'The call-tree messages of an activation, newest first, with who has acknowledged and who has not',
    response: '{ channels: { email, text }, rows: [{ id, plan_id, plan_ref, plan_title, message, by_email, by_text, expires_at, expired, sent_at, sent_by_name, total, acknowledged, waiting, unreachable, recipients: [{ id, depth, role, name, reach: email | text | both | none, email_status, text_status, acknowledged_at, ack_via: link | staff, ack_by_name, ack_note }] }] }',
  });

  const calloutOf = async (req: FastifyRequest, a: Row): Promise<Row> => {
    const cid = String((req.params as Row).cid ?? '');
    return (UUID_RE.test(cid) ? await db.one<Row>('select * from activation_callouts where id = $1 and activation_id = $2', [cid, a.id]) : undefined)
      ?? ctx.fail(404, 'not_found', 'Message not found.');
  };

  app.post('/api/emergency-activations/:id/call-outs/:cid/recipients/:rid/acknowledge', { preHandler: ctx.requirePerm('continuity.edit') }, async (req) => {
    const a = await activationFor(ctx, req);
    if (a.status === 'closed') ctx.fail(409, 'closed', 'The activation is closed, so nothing more can be recorded.');
    const c = await calloutOf(req, a);
    const rid = String((req.params as Row).rid ?? '');
    const r = (UUID_RE.test(rid) ? await db.one<Row>('select * from activation_callout_recipients where id = $1 and callout_id = $2', [rid, c.id]) : undefined)
      ?? ctx.fail(404, 'not_found', 'That person is not on this message.');
    if (r.acknowledged_at) ctx.fail(409, 'acknowledged', 'This person has already acknowledged.');
    const note = text((req.body as Row | null)?.note, 500);
    await db.query(`update activation_callout_recipients set acknowledged_at = now(), ack_via = 'staff', ack_by = $2, ack_by_name = $3, ack_note = $4 where id = $1`,
      [r.id, actorOf(req).id, actorOf(req).name, note]);
    await addLog(a.id, `${r.name ?? 'Someone'} acknowledged the call-out (recorded by ${actorOf(req).name}${note ? `: ${note}` : ''}).`, byOf(req));
    await ctx.audit(req, { action: 'emergency_activation.call_out_ack', recordType: 'emergency_activation', recordId: a.id, summary: `Call-out acknowledgment recorded for ${r.name ?? 'someone'}`, after: { recipient_id: r.id, via: 'staff', note } });
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/emergency-activations/:id/call-outs/:cid/recipients/:rid/acknowledge', tag: 'Continuity', permission: 'continuity.edit',
    summary: 'Record that someone acknowledged a call-tree message another way, such as by phone (logged)', body: '{ note? }',
  });

  app.post('/api/emergency-activations/:id/call-outs/:cid/remind', { preHandler: ctx.requirePerm('continuity.edit') }, async (req) => {
    const a = await activationFor(ctx, req);
    if (a.status !== 'active') ctx.fail(409, 'not_active', 'Messages go out only while the activation is active.');
    const c = await calloutOf(req, a);
    if (new Date(c.expires_at).getTime() <= Date.now()) ctx.fail(409, 'expired', 'This message has expired. Send a new one.');
    if (await perActivation.blocked(a.id)) ctx.fail(429, 'rate_limited', 'Many messages have gone out for this activation in the last hour. Wait a while, or call people.');
    const waiting = await db.query<Row>(
      `select r.*, u.email as user_email, ${ctx.resources.get('person') ? '(select p.email from people p where p.id = r.person_id and p.deleted_at is null)' : 'null'} as person_email
       from activation_callout_recipients r left join users u on u.id = r.user_id and u.deleted_at is null and u.status = 'active'
       where r.callout_id = $1 and r.acknowledged_at is null order by r.sort`, [c.id]);
    await perActivation.hit(a.id);
    const base = await linkBase(req);
    const org = organizationName(await readOrganization(db));
    let reached = 0;
    for (const r of waiting) {
      const row: Row = { ...r, user_email: r.user_email && EMAIL_RE.test(r.user_email) ? r.user_email : null, person_email: r.person_email && EMAIL_RE.test(String(r.person_email).trim()) ? String(r.person_email).trim().toLowerCase() : null };
      if (!row.user_id && !row.person_email) continue;
      // A new link replaces the earlier one, which stops working.
      const token = randomBytes(32).toString('base64url');
      const sent = await deliver(row, c, a, token, base, org, true);
      if (!sent.emailLogId && !sent.textLogIds.length) continue;
      await db.tx(async (tx) => {
        // The replaced link is remembered, so opening it later is not counted as a wrong link.
        if (r.token_hash) {
          await tx.query('insert into activation_callout_replaced_links (token_hash, recipient_id) values ($1, $2) on conflict (token_hash) do nothing', [r.token_hash, r.id]);
        }
        await tx.query('update activation_callout_recipients set token_hash = $2, email_log_id = coalesce($3, email_log_id), text_log_ids = $4::jsonb where id = $1',
          [r.id, hash(token), sent.emailLogId, JSON.stringify(sent.textLogIds.length ? sent.textLogIds : (r.text_log_ids ?? []))]);
      });
      reached += 1;
    }
    const summary = `Reminder sent to ${reached} of the ${waiting.length} ${waiting.length === 1 ? 'person' : 'people'} who had not acknowledged.`;
    await addLog(a.id, summary, byOf(req));
    await ctx.audit(req, { action: 'emergency_activation.call_out_remind', recordType: 'emergency_activation', recordId: a.id, summary, after: { callout_id: c.id, reached, waiting: waiting.length } });
    return { reached, waiting: waiting.length };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/emergency-activations/:id/call-outs/:cid/remind', tag: 'Continuity', permission: 'continuity.edit',
    summary: 'Send the message again to those who have not acknowledged it, each with a new link (the earlier link stops working; logged)',
    response: '{ reached, waiting }',
  });

  // ---------- public: the person's acknowledgment link ----------

  async function openLink(req: FastifyRequest): Promise<Row> {
    const ip = clientIp(req);
    if (await wrong.blocked(ip) || await perMinute.blocked(ip)) ctx.fail(429, 'rate_limited', 'Too many requests. Wait a few minutes and try again.');
    await perMinute.hit(ip);
    const token = String((req.params as Row).token ?? '');
    const r = TOKEN_RE.test(token)
      ? await db.one<Row>(
        `select r.id, r.name, r.role, r.acknowledged_at, r.activation_id, c.message, c.sent_at, c.expires_at, a.title, a.status, a.deleted_at
         from activation_callout_recipients r join activation_callouts c on c.id = r.callout_id
         join emergency_activations a on a.id = r.activation_id where r.token_hash = $1`, [hash(token)])
      : undefined;
    if (r && !r.deleted_at && r.status !== 'closed' && new Date(r.expires_at).getTime() > Date.now()) return r;
    // The same answer whatever the reason. Only a link that matches nothing ever sent counts toward the
    // wrong-link limit: an expired link, one whose emergency is over, or one a reminder replaced is a
    // real link that people at one shared address may well open (wave 23 security review, S5).
    const known = Boolean(r) || (TOKEN_RE.test(token)
      && Boolean(await db.one('select 1 from activation_callout_replaced_links where token_hash = $1', [hash(token)])));
    if (!known) await wrong.hit(ip);
    return ctx.fail(404, 'not_found', NOT_VALID);
  }

  const publicView = async (r: Row) => ({
    organization: organizationName(await readOrganization(db)),
    title: r.title, message: r.message, name: r.name, role: r.role,
    sent_at: r.sent_at, expires_at: r.expires_at, acknowledged_at: r.acknowledged_at,
  });

  app.get('/api/call-out/:token', { config: { public: true } }, async (req, reply) => {
    const r = await openLink(req);
    reply.header('cache-control', 'no-store').header('x-robots-tag', 'noindex').header('referrer-policy', 'no-referrer');
    return publicView(r);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/call-out/:token', tag: 'Continuity', public: true,
    summary: 'A call-tree message, by the acknowledgment link\'s secret (no sign-in)',
    description: 'Opening it does not acknowledge (mail scanners open links). 404 not_found, always the same, for an unknown, replaced or expired link, a closed activation, or while business continuity is switched off. 429 rate_limited past 60 requests a minute from one address or after many wrong links.',
    response: '{ organization, title, message, name, role, sent_at, expires_at, acknowledged_at }',
  });

  app.post('/api/call-out/:token', { config: { public: true } }, async (req, reply) => {
    const r = await openLink(req);
    reply.header('cache-control', 'no-store');
    if (r.acknowledged_at) return publicView(r);
    const note = text((req.body as Row | null)?.note, 500);
    const done = await db.one<Row>(
      `update activation_callout_recipients set acknowledged_at = now(), ack_via = 'link', ack_note = $2 where id = $1 and acknowledged_at is null returning acknowledged_at`,
      [r.id, note]);
    if (done) {
      await addLog(r.activation_id, `${r.name ?? 'Someone'} acknowledged the call-out through their link${note ? `: ${note}` : ''}.`, { id: null, name: r.name ?? 'Call tree' });
      await ctx.audit(req, {
        action: 'emergency_activation.call_out_ack', recordType: 'emergency_activation', recordId: r.activation_id,
        summary: `${r.name ?? 'Someone'} acknowledged the call-out through their link`, after: { recipient_id: r.id, via: 'link', note },
      });
    }
    return publicView({ ...r, acknowledged_at: done?.acknowledged_at ?? r.acknowledged_at });
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/call-out/:token', tag: 'Continuity', public: true,
    summary: 'Acknowledge a call-tree message through its link (no sign-in; logged on the activation)',
    description: 'Acknowledging again changes nothing. The same 404 and 429 answers as the GET.',
    body: '{ note?: up to 500 characters, such as "On my way" }',
    response: '{ organization, title, message, name, role, sent_at, expires_at, acknowledged_at }',
  });
}
