import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startSmtpSink, type SmtpSink } from '../../core/mail/smtp-sink.ts';
import { testApp } from '../../test/helpers.ts';
import { INVITES_PER_HOUR, meetingCalendar } from './invitations.ts';

// E41-17: meeting invitations by email, as an .ics attachment. Invented data only.
let t: Awaited<ReturnType<typeof testApp>>;
let sink: SmtpSink;
let meetingId: string;

beforeAll(async () => {
  t = await testApp();
  sink = await startSmtpSink();
});
afterAll(async () => { await t.close(); await sink.close(); });

const soon = () => new Date(Date.now() + 7 * 86_400_000).toISOString();
async function send() {
  const before = sink.messages.length;
  const r = await t.api.post(`/api/meetings/${meetingId}/invitations`, {});
  await t.db.query(`update jobs set run_at = now() - interval '1 second' where type = 'mail.send' and status = 'queued'`);
  await t.app.jobs.runDue({ types: ['mail.send'] });
  if (r.status === 200) await sink.waitFor(before + r.body.queued);
  return { r, messages: sink.messages.slice(before) };
}

describe('meeting invitations', () => {
  it('writes a calendar invitation that calendar programs read', () => {
    const ics = meetingCalendar({
      meeting: { id: 'm1', ref: 'MTG-1', title: 'Safety committee, Q4', scheduled_at: '2030-03-04T15:00:00Z', duration_minutes: 90, location: 'Room 2; North depot' },
      committeeName: 'Invented safety committee', method: 'REQUEST', sequence: 2,
      organizer: { name: 'Invented Secretary', email: 'secretary@example.test' }, attendees: [{ name: 'Invented Member', email: 'member@example.test' }],
      link: 'https://grc.example.test/governance/meetings/m1', now: new Date('2030-03-01T00:00:00Z'),
    });
    expect(ics).toContain('METHOD:REQUEST\r\n');
    expect(ics).toContain('UID:meeting-m1@sandpiper-grc\r\n');
    expect(ics).toContain('SEQUENCE:2\r\n');
    expect(ics).toContain('DTSTART:20300304T150000Z\r\nDTEND:20300304T163000Z\r\n');
    expect(ics).toContain('LOCATION:Room 2\\; North depot\r\n');
    expect(ics).toContain('ORGANIZER;CN="Invented Secretary":mailto:secretary@example.test\r\n');
    expect(ics.replace(/\r\n /g, '')).toMatch(/ATTENDEE;CN="Invented Member";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:member@example\.test/);
    expect(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
  });

  it('emails the members in office as an .ics attachment, updates it after a change and cancels it', async () => {
    const lead = await t.as('security_lead');
    await t.db.query(`update users set email = 'invented.chair@example.test' where id = $1`, [lead.userId]);
    await t.db.query(`update users set email = 'invented.admin@example.test' where username = 'admin' or id = (select id from users order by created_at limit 1)`);
    const committee = (await t.api.post('/api/committees', { name: 'Invented risk committee', kind: 'risk' })).body;
    await t.api.post(`/api/committees/${committee.id}/members`, { user_id: lead.userId, side: 'management', role: 'chair' });
    await t.api.post(`/api/committees/${committee.id}/members`, { name: 'Invented Outside Member', side: 'independent' });
    const person = t.ctx.resources.get('person') ? (await t.api.post('/api/people', { full_name: 'Invented Roster Member', email: 'roster.member@example.test' })).body : null;
    if (person) await t.api.post(`/api/committees/${committee.id}/members`, { person_id: person.id, side: 'labor' });
    const meeting = (await t.api.post('/api/meetings', { committee_id: committee.id, title: 'Quarterly risk review', scheduled_at: soon(), location: 'Board room', duration_minutes: 45 })).body;
    meetingId = meeting.id;

    const who = (await t.api.get(`/api/meetings/${meetingId}/invitations`)).body;
    expect(who.invitees).toEqual(expect.arrayContaining([
      { name: expect.stringMatching(/security_lead/), reachable: true, how: 'account' },
      { name: 'Invented Outside Member', reachable: false, how: null },
    ]));
    // Email off: refused, and the file can still be downloaded.
    expect((await t.api.post(`/api/meetings/${meetingId}/invitations`, {})).body.error.code).toBe('mail_off');
    const file = await t.api.get(`/api/meetings/${meetingId}/invitation.ics`);
    expect(file.status).toBe(200);
    expect(file.text).toContain('METHOD:PUBLISH');

    expect((await t.api.put('/api/admin/mail/settings', {
      enabled: true, host: '127.0.0.1', port: sink.port, tlsMode: 'none', fromAddress: 'grc@example.test', baseUrl: 'https://grc.example.test',
    })).status).toBe(200);
    expect((await (await t.as('safety_manager')).post(`/api/meetings/${meetingId}/invitations`, {})).status).toBe(403);

    const first = await send();
    expect(first.r.status).toBe(200);
    expect(first.r.body).toMatchObject({ method: 'REQUEST', sequence: 0, invited: person ? 2 : 1, not_invited: ['Invented Outside Member'] });
    const to = first.messages.flatMap((m) => m.to);
    expect(to).toContain('invented.chair@example.test');
    if (person) expect(to).toContain('roster.member@example.test');
    const body = first.messages[0].body;
    expect(first.messages[0].subject).toBe('Invitation: Quarterly risk review');
    expect(body).toMatch(/Content-Type: text\/calendar; ?method/i);
    expect(body).toContain('METHOD:REQUEST');
    expect(body).toMatch(/invitation\.ics/);

    // A change, then sent again: an update of the same event.
    expect((await t.api.patch(`/api/meetings/${meetingId}`, { location: 'Room 4' })).status).toBe(200);
    const second = await send();
    expect(second.r.body).toMatchObject({ method: 'REQUEST', sequence: 1 });
    expect(second.messages[0].subject).toBe('Updated: Quarterly risk review');

    // Canceled: a cancellation.
    expect((await t.api.patch(`/api/meetings/${meetingId}`, { status: 'canceled' })).status).toBe(200);
    const third = await send();
    expect(third.r.body).toMatchObject({ method: 'CANCEL', sequence: 2 });
    expect(third.messages[0].subject).toBe('Canceled: Quarterly risk review');
    expect(third.messages[0].body).toContain('METHOD:CANCEL');
    const events = await t.db.query<{ action: string }>(`select action from audit_events where record_id = $1 and action like 'meeting.invitations%' order by id`, [meetingId]);
    expect(events.map((e) => e.action)).toEqual(['meeting.invitations', 'meeting.invitations', 'meeting.invitations_canceled']);
  });

  it(`sends one meeting's invitation at most ${INVITES_PER_HOUR} times an hour (wave 23 security review, S6)`, async () => {
    const committee = (await t.api.post('/api/committees', { name: 'Invented audit committee', kind: 'audit' })).body;
    const lead = await t.as('security_lead');
    await t.db.query(`update users set email = 'invented.member@example.test' where id = $1`, [lead.userId]);
    await t.api.post(`/api/committees/${committee.id}/members`, { user_id: lead.userId, side: 'management', role: 'chair' });
    const busy = (await t.api.post('/api/meetings', { committee_id: committee.id, title: 'Invented audit review', scheduled_at: soon() })).body;
    const other = (await t.api.post('/api/meetings', { committee_id: committee.id, title: 'Invented audit follow-up', scheduled_at: soon() })).body;
    const post = (id: string) => t.api.post(`/api/meetings/${id}/invitations`, {});
    // Nine sends already made in the last hour, as from a loop: the tenth goes, the eleventh does not.
    await t.db.query(`insert into rate_limit_hits (bucket, key) select 'meeting_invite', $1 from generate_series(1, $2::int)`, [busy.id, INVITES_PER_HOUR - 1]);
    expect((await post(busy.id)).status).toBe(200);
    const refused = await post(busy.id);
    expect(refused.status).toBe(429);
    expect(refused.body.error).toMatchObject({ code: 'rate_limited', message: expect.stringMatching(/sent 10 times in the last hour/) });
    // Nothing went out for the refused send, and another meeting is not affected.
    expect((await t.db.one<{ invite_sequence: number }>('select invite_sequence from meetings where id = $1', [busy.id]))!.invite_sequence).toBe(0);
    expect((await post(other.id)).status).toBe(200);
  });
});
