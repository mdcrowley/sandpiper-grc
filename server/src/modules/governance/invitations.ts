// Meeting invitations by email (E41-17): the committee's members in office on the meeting's day are
// sent the meeting as an iCalendar (RFC 5545 and 5546) attachment, `invitation.ics`, that calendar
// programs add to the person's calendar. Sending again after a change (a new time or place) sends an
// update with a higher SEQUENCE, so calendars move the event rather than add a second one; a canceled
// meeting sends a cancellation (METHOD:CANCEL), which removes it. Replies are not collected
// (RSVP=FALSE): attendance is recorded on the meeting as before.
//
// Members are reached by their account's email address, or by the email of their roster person (the
// people module, when loaded). A member known only by a typed name is listed as not invited.
// `GET /api/meetings/:id/invitation.ics` gives the same event to add by hand.
//
// Sending is limited to INVITES_PER_HOUR sends for one meeting in an hour (wave 23 security review,
// S6): each send emails every member, roster addresses included, so a loop must not flood them.
import type { FastifyRequest } from 'fastify';
import { configuredBase, loopbackBase } from '../../core/identity/base.ts';
import { EMAIL_RE } from '../../core/mail/service.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { makeDbLimiter } from '../../core/ratelimit.ts';
import { TIME_ZONE, todayInZone } from '../../core/timezone.ts';
import { escapeText, fold, utcStamp } from '../feeds/ics.ts';
import { membersOn } from './committees.ts';
import { meetingFor } from './meetings.ts';

const PROD_ID = '-//Sandpiper GRC//Meetings//EN';
export const DEFAULT_MINUTES = 60;
/** Invitations (updates and cancellations included) sent for one meeting in an hour. */
export const INVITES_PER_HOUR = 10;

export interface Invitee { name: string; email: string | null; userId: string | null; how: 'account' | 'roster' | null }

/** The committee's members in office on the meeting's day, with the address each is reached at. */
export async function inviteesOf(ctx: ModuleContext, meeting: Row): Promise<Invitee[]> {
  const members = await membersOn(ctx, meeting.committee_id, todayInZone(new Date(meeting.scheduled_at)));
  const userIds = members.map((m) => m.user_id).filter(Boolean);
  const users = new Map((await ctx.db.query<{ id: string; email: string | null; status: string }>(
    `select id::text as id, email, status from users where id::text = any($1::text[]) and deleted_at is null`, [userIds])).map((u) => [u.id, u]));
  const person = ctx.resources.get('person');
  const personIds = members.filter((m) => !m.user_id && m.person_id).map((m) => String(m.person_id));
  const emails = new Map<string, string>();
  if (person && personIds.length && person.fields.email) {
    for (const p of await ctx.db.query<{ id: string; email: string | null }>(
      `select id::text as id, email from ${person.table} where id::text = any($1::text[]) and deleted_at is null`, [personIds])) {
      if (p.email && EMAIL_RE.test(p.email)) emails.set(p.id, p.email);
    }
  }
  const seen = new Set<string>();
  const out: Invitee[] = [];
  for (const m of members) {
    const u = m.user_id ? users.get(String(m.user_id)) : undefined;
    const email = u && u.status === 'active' && u.email && EMAIL_RE.test(u.email) ? u.email : !m.user_id && m.person_id ? emails.get(String(m.person_id)) ?? null : null;
    const key = email?.toLowerCase() ?? `name:${m.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: String(m.name), email, userId: email && u ? String(m.user_id) : null, how: email ? (u ? 'account' : 'roster') : null });
  }
  return out;
}

/** One meeting as an iCalendar object: an invitation (REQUEST), a cancellation (CANCEL) or a plain event (PUBLISH). */
export function meetingCalendar(opts: {
  meeting: Row; committeeName: string; method: 'REQUEST' | 'CANCEL' | 'PUBLISH'; sequence: number;
  organizer: { name: string; email: string } | null; attendees: { name: string; email: string }[]; link: string; now?: Date;
}): string {
  const { meeting } = opts;
  const start = new Date(meeting.scheduled_at);
  const minutes = Number(meeting.duration_minutes) > 0 ? Number(meeting.duration_minutes) : DEFAULT_MINUTES;
  const end = new Date(start.getTime() + minutes * 60_000);
  const cn = (s: string) => `"${s.replace(/["\r\n]/g, '')}"`;
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${PROD_ID}`, 'CALSCALE:GREGORIAN', `METHOD:${opts.method}`,
    'BEGIN:VEVENT',
    `UID:meeting-${meeting.id}@sandpiper-grc`,
    `SEQUENCE:${opts.sequence}`,
    `DTSTAMP:${utcStamp(opts.now ?? new Date())}`,
    `DTSTART:${utcStamp(start)}`,
    `DTEND:${utcStamp(end)}`,
    `SUMMARY:${escapeText(`${meeting.title}${meeting.ref ? ` (${meeting.ref})` : ''}`)}`,
    ...(meeting.location ? [`LOCATION:${escapeText(String(meeting.location))}`] : []),
    `DESCRIPTION:${escapeText(`${opts.committeeName}. Agenda and papers: ${opts.link}`)}`,
    ...(/^https?:/.test(opts.link) ? [`URL:${opts.link}`] : []),
    `STATUS:${opts.method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    ...(opts.organizer ? [`ORGANIZER;CN=${cn(opts.organizer.name)}:mailto:${opts.organizer.email}`] : []),
    ...opts.attendees.map((a) => `ATTENDEE;CN=${cn(a.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:${a.email}`),
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

export function registerInvitations(ctx: ModuleContext): void {
  const { app, db } = ctx;
  const perMeeting = makeDbLimiter(db, 'meeting_invite', INVITES_PER_HOUR, 60 * 60_000);

  const committeeName = async (meeting: Row) =>
    (await db.one<{ name: string }>('select name from committees where id = $1', [meeting.committee_id]))?.name ?? 'Committee';
  // The application address (auth.public_url), or this computer's own; never a Host header a caller chose.
  const linkOf = async (req: FastifyRequest, meeting: Row) =>
    `${(await configuredBase(ctx.settings)) || loopbackBase(req) || ''}/governance/meetings/${meeting.id}`;

  app.get('/api/meetings/:id/invitations', { preHandler: ctx.requirePerm('governance.view') }, async (req) => {
    const meeting = await meetingFor(ctx, req);
    const invitees = await inviteesOf(ctx, meeting);
    return {
      invited_at: meeting.invited_at ?? null, sequence: Number(meeting.invite_sequence ?? 0),
      mail: app.hasDecorator('mailEnabled') ? await app.mailEnabled() : false,
      invitees: invitees.map((i) => ({ name: i.name, reachable: Boolean(i.email), how: i.how })),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/meetings/:id/invitations', permission: 'governance.view',
    summary: 'Who a meeting invitation goes to (members in office on the day, and whether each has an address), and when it was last sent',
    response: '{ invited_at, sequence, mail, invitees: [{ name, reachable, how: account | roster | null }] }',
  });

  app.post('/api/meetings/:id/invitations', { preHandler: ctx.requirePerm('governance.edit') }, async (req) => {
    const meeting = await meetingFor(ctx, req);
    if (!app.hasDecorator('sendMail') || !(await app.mailEnabled())) ctx.fail(409, 'mail_off', 'Email is not set up, so invitations cannot be sent. Download the calendar file instead.');
    const cancel = meeting.status === 'canceled';
    if (cancel && !meeting.invited_at) ctx.fail(409, 'not_invited', 'No invitation was sent for this meeting, so there is nothing to cancel.');
    if (!cancel && meeting.status === 'minutes_approved') ctx.fail(409, 'minutes_approved', 'The minutes of this meeting are approved; it is over.');
    if (!cancel && new Date(meeting.scheduled_at).getTime() < Date.now()) ctx.fail(409, 'meeting_past', 'The meeting has already taken place.');
    const invitees = (await inviteesOf(ctx, meeting)).filter((i) => i.email);
    if (!invitees.length) ctx.fail(409, 'nobody', 'No member of the committee has an email address to send the invitation to.');
    const claim = await perMeeting.take(meeting.id);
    if (!claim.ok) {
      ctx.fail(429, 'rate_limited', `Invitations for this meeting have been sent ${INVITES_PER_HOUR} times in the last hour. Wait a while before sending again, or download the calendar file.`);
    }
    const sequence = meeting.invited_at ? Number(meeting.invite_sequence ?? 0) + 1 : 0;
    const me = await db.one<{ email: string | null }>('select email from users where id = $1', [req.user!.id]);
    const organizer = me?.email && EMAIL_RE.test(me.email) ? { name: req.user!.displayName, email: me.email } : null;
    // A request needs an organizer; without the sender's address the event is published instead.
    const method = cancel ? 'CANCEL' : organizer ? 'REQUEST' : 'PUBLISH';
    const name = await committeeName(meeting);
    const link = await linkOf(req, meeting);
    const ics = meetingCalendar({ meeting, committeeName: name, method, sequence, organizer, attendees: invitees.map((i) => ({ name: i.name, email: i.email! })), link });
    const when = new Date(meeting.scheduled_at);
    const subject = `${cancel ? 'Canceled' : sequence > 0 ? 'Updated' : 'Invitation'}: ${meeting.title}`;
    const message = [
      cancel ? `The ${name} meeting "${meeting.title}" is canceled.` : `You are invited to the ${name} meeting "${meeting.title}".`,
      `When: ${when.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short', timeZone: TIME_ZONE })} (${TIME_ZONE})`,
      meeting.location ? `Where: ${meeting.location}` : '',
      cancel ? 'Open the attached file to remove it from your calendar.' : 'Open the attached file to add it to your calendar.',
    ].filter(Boolean).join('\n');
    const attachment = { filename: cancel ? 'cancellation.ics' : 'invitation.ics', content: Buffer.from(ics, 'utf8'), contentType: `text/calendar; method=${method}; charset=UTF-8` };
    const accounts = invitees.filter((i) => i.userId).map((i) => i.userId!);
    const outside = invitees.filter((i) => !i.userId).map((i) => i.email!);
    const base = { template: 'message', purpose: 'governance', record: { type: 'meeting', id: meeting.id }, data: { subject, message, link: `/governance/meetings/${meeting.id}` }, attachments: [attachment] };
    let queued = 0;
    if (accounts.length) queued += (await app.sendMail({ ...base, userIds: accounts })).queued;
    if (outside.length) queued += (await app.sendMail({ ...base, to: outside })).queued;
    await db.query('update meetings set invited_at = now(), invite_sequence = $2 where id = $1', [meeting.id, sequence]);
    await ctx.audit(req, {
      action: cancel ? 'meeting.invitations_canceled' : 'meeting.invitations', recordType: 'meeting', recordId: meeting.id,
      summary: `${cancel ? 'Cancellation' : sequence > 0 ? 'Updated invitation' : 'Invitation'} for ${meeting.ref ?? meeting.title} emailed to ${invitees.length} ${invitees.length === 1 ? 'member' : 'members'}`,
      after: { sequence, method, recipients: invitees.length },
    });
    return { queued, method, sequence, invited: invitees.length, not_invited: (await inviteesOf(ctx, meeting)).filter((i) => !i.email).map((i) => i.name) };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/meetings/:id/invitations', permission: 'governance.edit',
    summary: 'Email the meeting to the committee\'s members as a calendar invitation (.ics): again after a change as an update, or a cancellation once it is canceled',
    description: `At most ${INVITES_PER_HOUR} sends for one meeting in an hour: 429 rate_limited past that.`,
    response: '{ queued, method: REQUEST | PUBLISH | CANCEL, sequence, invited, not_invited: [name] }',
  });

  app.get('/api/meetings/:id/invitation.ics', { preHandler: ctx.requirePerm('governance.view') }, async (req, reply) => {
    const meeting = await meetingFor(ctx, req);
    const ics = meetingCalendar({
      meeting, committeeName: await committeeName(meeting), method: meeting.status === 'canceled' ? 'CANCEL' : 'PUBLISH',
      sequence: Number(meeting.invite_sequence ?? 0), organizer: null, attendees: [], link: await linkOf(req, meeting),
    });
    reply.header('content-type', 'text/calendar; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="${String(meeting.ref ?? 'meeting').replace(/[^A-Za-z0-9._-]/g, '_')}.ics"`);
    reply.header('cache-control', 'no-store');
    return ics;
  });
  ctx.describeRoute({ method: 'GET', path: '/api/meetings/:id/invitation.ics', permission: 'governance.view', summary: 'The meeting as a calendar file (.ics) to add by hand' });
}
