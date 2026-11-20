// Alerts by email and text message to named responders (E09-25).
//
// When an incident is declared, and when one of its notification clocks turns amber or red, the
// people named under Notification deadlines > Alerts by email and text are told by email and by
// text message, besides the in-app notifications everyone with security.view receives. Each
// clock state is alerted once (the sweep stamps it), and one alert goes per incident and state
// however many clocks change together.
//
// Nothing restricted leaves the application: the email and the text name the incident's reference
// and what needs attention ("a notification deadline has passed"), never its title, the party to
// notify or any detail, and link to the application. Every recipient must hold security.view
// when the message is sent. Without email set up, or without text messages switched on, that
// channel sends nothing; while the security incidents area is switched off, nothing runs at all.
import type { FastifyRequest } from 'fastify';
import { requireRecentAuth } from '../../core/auth.ts';
import { DEFAULT_APP_NAME } from '../../core/config.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';

export type AlertEvent = 'declared' | 'amber' | 'red' | 'test';

export interface AlertOptions {
  /** The named responders (user ids). */
  responders: string[];
  /** Also the incident's lead. */
  includeLead: boolean;
  email: boolean;
  text: boolean;
  /** Which events are sent. */
  declared: boolean;
  amber: boolean;
  red: boolean;
}

export const ALERTS_KEY = 'security.alerts';
export const ALERT_DEFAULTS: AlertOptions = { responders: [], includeLead: false, email: true, text: true, declared: true, amber: true, red: true };
const MAX_RESPONDERS = 50;

export async function alertOptions(ctx: ModuleContext): Promise<AlertOptions> {
  const raw = await ctx.settings.get<Partial<AlertOptions>>(ALERTS_KEY, {});
  const o = { ...ALERT_DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
  return { ...o, responders: Array.isArray(o.responders) ? o.responders.filter((x) => typeof x === 'string' && UUID_RE.test(x)) : [] };
}

/** Active people, with the permissions their enabled roles grant (as a session user is loaded). */
async function people(ctx: ModuleContext, ids: string[] | null): Promise<SessionUser[]> {
  const rows = await ctx.db.query<Row>(
    `select u.id, u.username, u.display_name, u.email,
        coalesce(array_agg(distinct r.key) filter (where r.enabled), '{}') as roles,
        coalesce(array_agg(distinct rp.permission) filter (where r.enabled and rp.permission is not null), '{}') as permissions
     from users u
     left join user_roles ur on ur.user_id = u.id
     left join roles r on r.id = ur.role_id
     left join role_permissions rp on rp.role_id = r.id
     where u.status = 'active' and u.deleted_at is null and ($1::uuid[] is null or u.id = any($1::uuid[]))
     group by u.id order by u.display_name`, [ids]);
  return rows.map((r) => ({ id: r.id, username: r.username, displayName: r.display_name, email: r.email, roles: r.roles, permissions: r.permissions }) as SessionUser);
}

const mayReceive = (ctx: ModuleContext, u: SessionUser) => ctx.can(u, 'security.view');

/** The words of an alert: the reference and what needs attention, nothing restricted. */
export function alertWords(event: AlertEvent, ref: string, appName: string): { subject: string; message: string; text: string } {
  const what = {
    declared: 'has been declared',
    amber: 'needs attention: a notification deadline is close',
    red: 'needs attention: a notification deadline has passed',
    test: 'alert test: no incident needs attention',
  }[event];
  if (event === 'test') {
    return {
      subject: `Test: security incident alerts from ${appName}`,
      message: `This is a test of the security incident alerts from ${appName}. No incident needs attention. When one does, you are told here and by text message, without its details: open the application to see them.`,
      text: `${appName}: test of security incident alerts. No incident needs attention.`,
    };
  }
  return {
    subject: `Security incident ${ref} ${event === 'declared' ? 'declared' : 'needs attention'}`,
    message: `Security incident ${ref} ${what}. Open ${appName} to see it; the details are not sent by email.`,
    text: `${appName}: security incident ${ref} ${what}. Open the app.`,
  };
}

export interface AlertResult { people: number; email: number; text: number }

/**
 * Sends one alert to the responders (and the lead, when chosen). `incident` needs `id`, `ref` and
 * `lead_id`. Never throws: an alert that cannot be sent must not stop the clock sweep.
 */
export async function alertResponders(ctx: ModuleContext, incident: Row, event: AlertEvent, opts: { req?: FastifyRequest; userIds?: string[] } = {}): Promise<AlertResult> {
  const out: AlertResult = { people: 0, email: 0, text: 0 };
  try {
    const o = await alertOptions(ctx);
    if (event !== 'test' && !o[event]) return out;
    const ids = [...new Set([...(opts.userIds ?? o.responders), ...(o.includeLead && event !== 'test' && typeof incident.lead_id === 'string' ? [incident.lead_id] : [])])];
    if (!ids.length) return out;
    const recipients = (await people(ctx, ids)).filter((u) => mayReceive(ctx, u)).map((u) => u.id);
    out.people = recipients.length;
    if (!recipients.length) return out;
    const appName = await ctx.settings.get('app.name', DEFAULT_APP_NAME);
    const words = alertWords(event, String(incident.ref ?? ''), appName);
    const link = event === 'test' ? '/security-incidents/notifications' : `/security-incidents/${incident.id}`;
    if (o.email && ctx.app.hasDecorator('sendMail')) {
      const r = await ctx.app.sendMail({
        userIds: recipients, requirePermission: 'security.view', template: 'message', purpose: 'security',
        data: { subject: words.subject, message: words.message, link },
      });
      out.email = r.queued;
    }
    if (o.text && ctx.app.hasDecorator('sendText')) {
      const r = await ctx.app.sendText({ userIds: recipients, text: words.text, purpose: 'security', permission: 'security.view' });
      out.text = r.queued;
    }
    if (out.email || out.text) {
      await ctx.audit(opts.req ?? null, {
        action: 'security_incident.alert_sent', recordType: event === 'test' ? undefined : 'security_incident', recordId: event === 'test' ? undefined : incident.id,
        summary: `${event === 'test' ? 'Test alert' : `Alert (${event === 'declared' ? 'declared' : `clock ${event}`})`} sent to ${out.people} responder${out.people === 1 ? '' : 's'}: ${out.email} by email, ${out.text} by text message`,
      });
    }
  } catch (err) {
    console.error('[secincidents] alert to responders failed:', err);
  }
  return out;
}

interface Guards {
  view: { preHandler: (req: FastifyRequest) => Promise<void> };
  administer: { preHandler: (req: FastifyRequest) => Promise<void> };
}

export function registerAlertRoutes(ctx: ModuleContext, g: Guards) {
  const { app, db } = ctx;
  const TAG = 'Security incidents';

  async function state(user: SessionUser) {
    const o = await alertOptions(ctx);
    const admin = ctx.can(user, 'security.administer');
    const named = await people(ctx, o.responders);
    const contacts = o.responders.length
      ? await db.query<Row>('select user_id, mobile, sms_address from user_alert_contacts where user_id = any($1::uuid[])', [o.responders]).catch(() => [])
      : [];
    const mailOn = ctx.app.hasDecorator('mailEnabled') ? await ctx.app.mailEnabled() : false;
    const textOn = await db.one<Row>(`select provider_settings->'text' as text, enabled from mail_config where id = 1`).catch(() => undefined);
    return {
      ...o,
      responders: o.responders.map((id) => {
        const p = named.find((u) => u.id === id);
        const c = contacts.find((r) => r.user_id === id);
        return { id, label: p?.displayName ?? 'Inactive or removed user', eligible: Boolean(p && mayReceive(ctx, p)), hasEmail: Boolean(p?.email), hasText: Boolean(c && (c.mobile || c.sms_address)) };
      }),
      eligible: admin ? (await people(ctx, null)).filter((u) => mayReceive(ctx, u)).map((u) => ({ id: u.id, label: u.displayName })) : undefined,
      mail_on: mailOn,
      text_on: Boolean(textOn?.text && ((textOn.text.gateway && textOn.enabled) || textOn.text.webhook)),
      can_administer: admin,
    };
  }

  app.get('/api/security-incidents/alerts/settings', g.view, async (req) => state(req.user!));
  ctx.describeRoute({
    method: 'GET', path: '/api/security-incidents/alerts/settings', tag: TAG, permission: 'security.view',
    summary: 'Who is alerted by email and text message when an incident is declared or a notification clock turns amber or red',
    response: '{ responders: [{ id, label, eligible, hasEmail, hasText }], includeLead, email, text, declared, amber, red, eligible?, mail_on, text_on, can_administer }',
  });

  app.patch('/api/security-incidents/alerts/settings', g.administer, async (req) => {
    const b = (req.body ?? {}) as Row;
    const before = await alertOptions(ctx);
    const next: AlertOptions = { ...before };
    const fields: Record<string, string> = {};
    for (const k of ['includeLead', 'email', 'text', 'declared', 'amber', 'red'] as const) {
      if (b[k] === undefined) continue;
      if (typeof b[k] !== 'boolean') fields[k] = 'Choose yes or no.';
      else next[k] = b[k];
    }
    if (b.responders !== undefined) {
      if (!Array.isArray(b.responders) || b.responders.some((x: unknown) => typeof x !== 'string' || !UUID_RE.test(x))) fields.responders = 'Choose people from the list.';
      else {
        const ids = [...new Set(b.responders as string[])];
        if (ids.length > MAX_RESPONDERS) fields.responders = `Name at most ${MAX_RESPONDERS} people.`;
        else {
          const found = await people(ctx, ids);
          // People already named who have since lost access may stay (they are skipped when sending); new ones must qualify.
          const bad = ids.filter((id) => !before.responders.includes(id) && !found.some((u) => u.id === id && mayReceive(ctx, u)));
          if (bad.length) fields.responders = 'Only active people with security.view can be alerted.';
          next.responders = ids;
        }
      }
    }
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    if (JSON.stringify(next) === JSON.stringify(before)) return state(req.user!);
    const added = next.responders.some((id) => !before.responders.includes(id));
    // Alerts leave the application: confirm who is asking before more people receive them.
    if (added || (next.includeLead && !before.includeLead)) await requireRecentAuth({ db, audit: ctx.audit, settings: ctx.settings }, req, 'change who receives security incident alerts by email and text message');
    await ctx.settings.set(ALERTS_KEY, next, req);
    await ctx.audit(req, { action: 'security_incident.alert_settings', summary: 'Security incident alerts by email and text message changed', before, after: next });
    return state(req.user!);
  });
  ctx.describeRoute({
    method: 'PATCH', path: '/api/security-incidents/alerts/settings', tag: TAG, permission: 'security.administer',
    summary: 'Change who is alerted by email and text message, and for which events',
    description: 'Needs `security.view` and `security.administer`. Responders must be active and hold `security.view`. Adding a responder, or the incident lead, needs a recent password confirmation (403 `reauth_required`). Audited.',
    body: '{ responders?: [uuid], includeLead?, email?, text?, declared?, amber?, red? }',
  });

  app.post('/api/security-incidents/alerts/test', g.administer, async (req) => {
    const o = await alertOptions(ctx);
    if (!o.responders.length) ctx.fail(409, 'no_responders', 'Name at least one responder first.');
    const r = await alertResponders(ctx, { id: null, ref: null }, 'test', { req });
    if (!r.email && !r.text) {
      await ctx.audit(req, { action: 'security_incident.alert_sent', summary: `Test alert: nothing sent (${r.people} responder${r.people === 1 ? '' : 's'} could receive it)` });
    }
    return r;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/security-incidents/alerts/test', tag: TAG, permission: 'security.administer',
    summary: 'Send the responders a test alert by email and text message now', response: '{ people, email, text }',
    description: 'Messages are queued (and sent within seconds while the server runs). Audited.',
  });
}
