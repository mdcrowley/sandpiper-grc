import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setCloudEndpointsForTests } from '../../core/mail/cloud.ts';
import { serviceAccountKeyJson, startFakeCloud, type FakeCloud, type FakeMessage } from '../../core/mail/cloud-fake.ts';
import { ensureMail } from '../../core/mail/index.ts';
import type { ModuleDef } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';

// E14-25: email to ticket from a mailbox read through Microsoft Graph or the Gmail API, against
// stand-in services on 127.0.0.1. No network. Invented people, addresses and messages only.
const mailOn: ModuleDef = { key: 'test_mail_services', async seedDefaults(ctx) { await ensureMail(ctx); } };

let t: Awaited<ReturnType<typeof testApp>>;
let fake: FakeCloud;

beforeAll(async () => {
  t = await testApp({ extraModules: [mailOn] });
  fake = await startFakeCloud();
  setCloudEndpointsForTests(fake.endpoints);
});
afterAll(async () => {
  setCloudEndpointsForTests(null);
  await t.close();
  await fake.close();
});

let n = 0;
const message = (from: string, subject: string, body: string): FakeMessage => {
  n += 1;
  return {
    id: `m${n}`, read: false, folder: 'inbox',
    raw: `From: ${from}\r\nTo: desk@example.org\r\nSubject: ${subject}\r\nMessage-ID: <svc${n}@mail.example.org>\r\nDate: Wed, 18 Nov 2026 09:00:00 -0500\r\n\r\n${body}\r\n`,
  };
};
const intake = (patch: Record<string, unknown>) => t.api.put('/api/tickets/email/settings', patch);
const check = () => t.api.post('/api/tickets/email/check');

describe('a mailbox read through Microsoft Graph', () => {
  it('needs the Graph sign-in saved under Email first, even while email is sent over SMTP', async () => {
    const refused = await intake({ enabled: true, source: 'graph', username: 'desk@example.org' });
    expect(refused.status).toBe(400);
    expect(refused.body.error.fields.source).toMatch(/Microsoft Graph sign-in under Administration > Email/);
    expect((await intake({ source: 'graph', username: 'not an address' })).body.error.fields.username).toMatch(/email address/);

    // Sending stays on SMTP; the Graph sign-in is saved beside it.
    const saved = await t.api.put('/api/admin/mail/settings', {
      graph: { tenantId: fake.microsoft.tenantId, clientId: fake.microsoft.clientId, authMethod: 'secret' }, graphCredential: fake.microsoft.clientSecret,
    });
    expect(saved.body).toMatchObject({ provider: 'smtp', graph: { credentialSet: true } });
    expect((await t.api.get('/api/tickets/email/settings')).body.service_accounts).toEqual({ graph: true, gmail: false });

    const on = await intake({ enabled: true, source: 'graph', username: 'desk@example.org', address: 'desk@example.org' });
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({ enabled: true, source: 'graph' });
    expect((await t.api.post('/api/tickets/email/test')).body).toEqual({ ok: true, messages: 0 });
  });

  it('turns unread messages into tickets and moves them to Deleted Items', async () => {
    fake.microsoft.inbox.set('desk@example.org', [
      message('Morgan Planner <morgan@example.org>', 'Timetable display blank at the depot', 'The screen in the drivers’ room is blank.'),
      { ...message('Morgan Planner <morgan@example.org>', 'Old message', 'Seen before.'), read: true },
    ]);
    const r = await check();
    expect(r.body).toMatchObject({ ok: true, fetched: 1, created: 1 });
    const box = fake.microsoft.inbox.get('desk@example.org')!;
    expect(box.map((m) => [m.folder, m.read])).toEqual([['deleted', false], ['inbox', true]]);
    const log = (await t.api.get('/api/tickets/email/log')).body.rows;
    expect(log[0]).toMatchObject({ source: 'graph', outcome: 'created', from_address: 'morgan@example.org' });
    const ticket = (await t.api.get(`/api/tickets/${log[0].ticket_id}`)).body;
    expect(ticket).toMatchObject({ title: 'Timetable display blank at the depot', channel: 'email', requester_email: 'morgan@example.org' });
  });

  it('marks messages read instead when they are left in the mailbox, and reads each once', async () => {
    await intake({ leave_on_server: true });
    fake.microsoft.inbox.get('desk@example.org')!.push(message('morgan@example.org', 'Radio channel noisy on route 12', 'Static all morning.'));
    expect((await check()).body).toMatchObject({ fetched: 1, created: 1 });
    expect(fake.microsoft.inbox.get('desk@example.org')!.at(-1)).toMatchObject({ folder: 'inbox', read: true });
    // Someone marks it unread again: it is recognized and not made into a second ticket.
    fake.microsoft.inbox.get('desk@example.org')!.at(-1)!.read = false;
    expect((await check()).body).toMatchObject({ fetched: 0, created: 0 });
    expect(fake.microsoft.inbox.get('desk@example.org')!.at(-1)!.read).toBe(true);
  });

  it('reports a missing permission on the settings page', async () => {
    fake.microsoft.allowed.delete('desk@example.org');
    const r = await check();
    expect(r.body.ok).toBe(false);
    expect(r.body.error).toMatch(/Mail\.ReadWrite/);
    expect((await t.api.get('/api/tickets/email/settings')).body.last_poll_error).toMatch(/Mail\.ReadWrite/);
    fake.microsoft.allowed.add('desk@example.org');
  });
});

describe('a mailbox read through the Gmail API', () => {
  it('reads with the saved service account, acting as the mailbox', async () => {
    await t.api.put('/api/admin/mail/settings', { gmailKey: serviceAccountKeyJson(fake) });
    await intake({ source: 'gmail', username: 'desk@example.org', leave_on_server: false });
    fake.google.inbox.set('desk@example.org', [message('Sam Signals <sam@example.org>', 'Crossing gate slow to lower', 'At the yard entrance.')]);
    expect((await check()).body).toMatchObject({ ok: true, fetched: 1, created: 1 });
    expect(fake.google.inbox.get('desk@example.org')![0].folder).toBe('deleted');
    expect(fake.google.subjects.at(-1)).toBe('desk@example.org');
    const log = (await t.api.get('/api/tickets/email/log')).body.rows;
    expect(log[0]).toMatchObject({ source: 'gmail', outcome: 'created', from_address: 'sam@example.org' });
  });
});
