import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureMail } from '../../core/mail/index.ts';
import { startFakePop3, type FakePop3 } from '../../core/mail/pop3-fake.ts';
import { startSmtpSink, type SmtpSink } from '../../core/mail/smtp-sink.ts';
import type { ModuleDef } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';
import { automaticReason } from './email.ts';
import { parseMessage } from '../../core/mail/mime.ts';

// E15-06: email-to-ticket against a fake mailbox and a fake mail server on 127.0.0.1. No network.
// Invented people, addresses and messages only.
const mailOn: ModuleDef = { key: 'test_mail_on', async seedDefaults(ctx) { await ensureMail(ctx); } };

let t: Awaited<ReturnType<typeof testApp>>;
let box: FakePop3;
let sink: SmtpSink;
let agent: Awaited<ReturnType<typeof t.as>>;
let jordanId: string;

const msg = (headers: Record<string, string>, body: string) =>
  `${Object.entries({ 'Message-ID': `<${Math.random().toString(36).slice(2)}@mail.example.org>`, Date: 'Wed, 18 Nov 2026 09:00:00 -0500', ...headers })
    .map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n${body}\r\n`;
const check = () => t.api.post('/api/tickets/email/check');
const sendMail = () => t.app.jobs.runDue({ types: ['mail.send'] });

beforeAll(async () => {
  t = await testApp({ extraModules: [mailOn] });
  box = await startFakePop3();
  sink = await startSmtpSink();
  agent = await t.as('agent');
  jordanId = (await t.db.one<{ id: string }>(
    `insert into users (username, email, display_name, status) values ('jordan', 'Jordan.Driver@example.org', 'Jordan Driver', 'active') returning id`))!.id;
  await t.api.put('/api/admin/mail/settings', {
    enabled: true, host: '127.0.0.1', port: sink.port, tlsMode: 'none', fromAddress: 'grc@example.org', baseUrl: 'https://grc.example.org',
  });
});
afterAll(async () => { await t.close(); await box.close(); await sink.close(); });

describe('settings', () => {
  it('are for administrators, need a mailbox to switch on, and never return the password', async () => {
    expect((await agent.get('/api/tickets/email/settings')).status).toBe(403);
    const s = (await t.api.get('/api/tickets/email/settings')).body;
    expect(s).toMatchObject({ enabled: false, source: 'pop3', unknown_senders: 'create', password_set: false, relay_key_set: false });
    const refused = await t.api.put('/api/tickets/email/settings', { enabled: true });
    expect(Object.keys(refused.body.error.fields).sort()).toEqual(['host', 'password', 'username']);
    expect((await t.api.put('/api/tickets/email/settings', { port: 0, tls: 'maybe', allowed_domains: 'not a domain' })).body.error.fields)
      .toMatchObject({ port: expect.any(String), tls: expect.any(String), allowed_domains: expect.any(String) });
    const saved = await t.api.put('/api/tickets/email/settings', {
      enabled: true, host: '127.0.0.1', port: box.port, tls: 'none', username: 'desk', password: 'mailbox secret', address: 'desk@example.org',
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ enabled: true, password_set: true });
    expect(JSON.stringify(saved.body)).not.toContain('mailbox secret');
    const audits = await t.db.query<any>(`select before, after from audit_events where action = 'tickets.email_settings'`);
    expect(JSON.stringify(audits)).not.toContain('mailbox secret');
    expect((await t.api.post('/api/tickets/email/test')).body).toEqual({ ok: true, messages: 0 });
  });
});

describe('reading the mailbox', () => {
  let ticketId = '';
  let ref = '';

  it('makes tickets of people’s messages and ignores machines', async () => {
    box.add(msg({
      From: 'Jordan Driver <jordan.driver@example.org>', To: 'desk@example.org', Subject: 'Validator on bus 3310 not reading cards',
      'MIME-Version': '1.0', 'Content-Type': 'multipart/mixed; boundary="b1"',
    }, [
      '--b1', 'Content-Type: text/plain; charset=utf-8', '', 'Since this morning the front validator shows an error.', '',
      '--b1', 'Content-Type: text/plain; name="error.txt"', 'Content-Disposition: attachment; filename="error.txt"', '', 'Error 42 on the validator display',
      '--b1', 'Content-Type: application/x-msdownload; name="tool.exe"', 'Content-Disposition: attachment; filename="tool.exe"', 'Content-Transfer-Encoding: base64', '',
      Buffer.from('MZ fake program').toString('base64'), '--b1--',
    ].join('\r\n')));
    box.add(msg({ From: 'Casey Visitor <casey@partner.example.net>', Subject: 'Ticket machine at the north stop' }, 'The machine does not give change.'));
    box.add(msg({ From: 'jordan.driver@example.org', Subject: 'Out of office', 'Auto-Submitted': 'auto-replied' }, 'I am away.'));
    box.add(msg({ From: 'MAILER-DAEMON@mail.example.org', Subject: 'Undeliverable: hello', 'Content-Type': 'multipart/report; boundary=x' }, '--x--'));
    box.add(msg({ From: 'grc@example.org', Subject: 'Our own notice' }, 'A notice.'));

    const r = await check();
    expect(r.body).toMatchObject({ ok: true, fetched: 5, created: 2, ignored: 3 });
    expect(box.messages).toHaveLength(0); // read messages are removed from the mailbox

    const log = (await t.api.get('/api/tickets/email/log')).body.rows;
    expect(log.map((l: any) => l.reason).filter(Boolean)).toEqual(expect.arrayContaining([
      'Automatic message (auto-reply)', 'Delivery report (bounce)', 'Sent from the service desk’s own address',
    ]));
    const made = log.find((l: any) => l.from_address === 'jordan.driver@example.org' && l.outcome === 'created');
    expect(made.reason).toContain('tool.exe: type not allowed');
    expect(made.attachments).toBe(1);

    const ticket = (await t.api.get(`/api/tickets/${made.ticket_id}`)).body;
    expect(ticket).toMatchObject({
      title: 'Validator on bus 3310 not reading cards', channel: 'email', requester_id: jordanId, requester_name: 'Jordan Driver',
      requester_email: 'jordan.driver@example.org', description: expect.stringContaining('front validator'),
    });
    ticketId = ticket.id;
    ref = ticket.ref;
    const files = (await t.api.get(`/api/attachments?record_type=ticket&record_id=${ticketId}`)).body.rows;
    expect(files.map((f: any) => f.file_name)).toEqual(['error.txt']);
    const outside = (await t.api.get(`/api/tickets/${log.find((l: any) => l.from_address === 'casey@partner.example.net').ticket_id}`)).body;
    expect(outside).toMatchObject({ requester_id: null, requester_name: 'Casey Visitor', requester_email: 'casey@partner.example.net' });
  });

  it('acknowledges by email, threaded, and never takes its own message back in', async () => {
    const before = sink.messages.length;
    await sendMail();
    const ack = sink.messages.slice(before).find((m) => m.to.some((a) => a.toLowerCase() === 'jordan.driver@example.org'));
    expect(ack?.subject).toContain(`[${ref}]`);
    expect(ack?.raw).toMatch(/X-GRC-Mail: tickets/i);
    expect(ack?.raw).toMatch(/Auto-Submitted: auto-generated/i);
    expect(ack?.raw).toContain(`<ticket.${ticketId}@grc.invalid>`);
    expect(ack?.raw).toMatch(/Reply-To: desk@example.org/i);
    // The acknowledgment bounced back into the mailbox by a misconfigured forward is ignored.
    box.add(ack!.raw);
    expect((await check()).body).toMatchObject({ fetched: 1, ignored: 1, created: 0 });
  });

  it('adds a reply from the requester as a public comment, without the quoted text', async () => {
    await agent.patch(`/api/tickets/${ticketId}`, { status: 'waiting_requester', assignee_id: agent.userId });
    box.add(msg({ From: 'jordan.driver@example.org', Subject: `RE: [${ref}] Validator on bus 3310 not reading cards`, 'In-Reply-To': '<other@mail.example.org>' },
      'It works again after the restart.\r\n\r\nOn Wed, 18 Nov 2026, Service Desk <desk@example.org> wrote:\r\n> Please restart it.'));
    box.add(msg({ From: 'stranger@example.org', Subject: `Re: [${ref}] hello` }, 'Let me in.'));
    expect((await check()).body).toMatchObject({ fetched: 2, commented: 1, ignored: 1 });
    const comments = (await t.api.get(`/api/comments?record_type=ticket&record_id=${ticketId}`)).body;
    const list = Array.isArray(comments) ? comments : comments.rows;
    expect(list.map((c: any) => c.body)).toContain('It works again after the restart.');
    expect(list.find((c: any) => c.body.startsWith('It works')).internal).toBe(false);
    // A reply to "waiting for you" hands the ticket back.
    expect((await t.api.get(`/api/tickets/${ticketId}`)).body.status).toBe('in_progress');
  });

  it('emails an agent’s public reply to the requester', async () => {
    const before = sink.messages.length;
    expect((await agent.post('/api/comments', { record_type: 'ticket', record_id: ticketId, body: 'Glad it works. Closing soon.', internal: false })).status).toBe(201);
    await agent.post('/api/comments', { record_type: 'ticket', record_id: ticketId, body: 'Internal note only.', internal: true });
    await sendMail();
    const sent = sink.messages.slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toContain('Glad it works');
    expect(sent[0].subject).toContain(`[${ref}]`);
  });

  it('follows the rules for unknown senders, accepted domains and floods', async () => {
    await t.api.put('/api/tickets/email/settings', { unknown_senders: 'ignore' });
    box.add(msg({ From: 'someone@elsewhere.example.com', Subject: 'Hello' }, 'Hi.'));
    expect((await check()).body).toMatchObject({ ignored: 1, created: 0 });
    await t.api.put('/api/tickets/email/settings', { unknown_senders: 'create', allowed_domains: ['example.org'] });
    box.add(msg({ From: 'someone@elsewhere.example.com', Subject: 'Hello again' }, 'Hi.'));
    box.add(msg({ From: 'colleague@depot.example.org', Subject: 'Printer jam at the depot' }, 'Jammed.'));
    expect((await check()).body).toMatchObject({ ignored: 1, created: 1 });
    await t.api.put('/api/tickets/email/settings', { max_per_hour: 2 });
    for (let i = 0; i < 3; i++) box.add(msg({ From: 'colleague@depot.example.org', Subject: `Loop ${i}` }, 'Again.'));
    expect((await check()).body).toMatchObject({ created: 1, ignored: 2 });
    const reasons = (await t.api.get('/api/tickets/email/log?outcome=ignored')).body.rows.map((r: any) => r.reason);
    expect(reasons).toEqual(expect.arrayContaining([expect.stringContaining('unknown senders'), expect.stringContaining('domain'), expect.stringContaining('loop guard')]));
    await t.api.put('/api/tickets/email/settings', { max_per_hour: 20, allowed_domains: [] });
  });
});

describe('a mail relay', () => {
  it('posts messages with its key; a wrong key or the wrong source is not found', async () => {
    const post = (key: string, raw: string) => t.app.inject({
      method: 'POST', url: '/api/tickets/email/inbound', payload: raw,
      headers: { 'content-type': 'message/rfc822', 'x-grc-csrf': '1', 'x-grc-relay-key': key },
    });
    const raw = msg({ From: 'jordan.driver@example.org', Subject: 'Radio handset will not charge' }, 'The charger light stays off.');
    expect((await post('grc_relay_nothing', raw)).statusCode).toBe(404);
    const made = await t.api.post('/api/tickets/email/relay-key');
    expect(made.body.key).toMatch(/^grc_relay_[0-9a-f]{48}$/);
    expect(JSON.stringify((await t.api.get('/api/tickets/email/settings')).body)).not.toContain(made.body.key);
    expect((await post(made.body.key, raw)).statusCode).toBe(404); // still reading the mailbox
    await t.api.put('/api/tickets/email/settings', { source: 'relay' });
    expect((await post('grc_relay_wrong', raw)).statusCode).toBe(404);
    const ok = await post(made.body.key, raw);
    expect(ok.statusCode).toBe(202);
    expect(ok.json()).toMatchObject({ outcome: 'created', ref: expect.stringMatching(/^TKT-/) });
    expect((await post(made.body.key, raw)).json()).toMatchObject({ outcome: 'ignored', reason: 'Already received' });
  });
});

describe('loop guard', () => {
  it('recognizes automatic messages by their headers and subject', () => {
    const of = (h: Record<string, string>) => automaticReason(parseMessage(msg({ From: 'a@example.org', Subject: 'Hello', ...h }, 'x')));
    expect(of({})).toBeNull();
    expect(of({ 'Auto-Submitted': 'no' })).toBeNull();
    expect(of({ Precedence: 'bulk' })).toBeTruthy();
    expect(of({ 'List-Id': '<news.example.org>' })).toBe('Mailing list message');
    expect(of({ 'Return-Path': '<>' })).toBe('Delivery report (bounce)');
    expect(of({ From: 'no-reply@example.org' })).toBeTruthy();
    expect(of({ Subject: 'Automatic reply: Hello' })).toBe('Automatic reply');
    expect(of({ 'X-GRC-Mail': 'notification' })).toBe('Sent by this application');
  });
});
