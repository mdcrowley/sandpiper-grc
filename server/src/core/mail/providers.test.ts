import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ModuleDef } from '../module.ts';
import { testApp } from '../../test/helpers.ts';
import { setCloudEndpointsForTests } from './cloud.ts';
import { selfSignedCertificate, serviceAccountKeyJson, startFakeCloud, type FakeCloud } from './cloud-fake.ts';
import { ensureMail, openServiceMailbox } from './index.ts';

// E14-25: sending through Microsoft Graph and the Gmail API, against stand-in services on
// 127.0.0.1 (cloud-fake.ts). No network. Invented names and addresses only.
const mailOn: ModuleDef = { key: 'test_mail_providers', async seedDefaults(ctx) { await ensureMail(ctx); } };

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

const put = (patch: Record<string, unknown>) => t.api.put('/api/admin/mail/settings', patch);
const testTo = () => t.api.post('/api/admin/mail/test', { to: 'checker@example.org' });
const log = (id: string) => t.db.one<any>('select * from mail_log where id = $1', [id]);
const run = () => t.app.jobs.runDue({ types: ['mail.send'] });
const due = (logId: string) => t.db.query(`update jobs set run_at = now() - interval '1 second' where id = (select job_id from mail_log where id = $1)`, [logId]);
const base = { fromAddress: 'grc@example.org', fromName: 'Sandpiper', baseUrl: 'https://grc.example.org' };

describe('Microsoft Graph', () => {
  const graph = () => ({ tenantId: fake.microsoft.tenantId, clientId: fake.microsoft.clientId, authMethod: 'secret', mailbox: '', cloud: 'global' });

  it('needs the app registration and a secret to switch on, and keeps the secret encrypted and out of answers and the audit trail', async () => {
    const refused = await put({ ...base, provider: 'graph', enabled: true });
    expect(refused.status).toBe(400);
    expect(Object.keys(refused.body.error.fields).sort()).toEqual(['graph.clientId', 'graph.tenantId', 'graphCredential']);
    expect((await put({ provider: 'graph', graph: { tenantId: 'not a tenant', clientId: 'nope', cloud: 'moon' } })).body.error.fields)
      .toMatchObject({ 'graph.tenantId': expect.any(String), 'graph.clientId': expect.any(String), 'graph.cloud': expect.any(String) });
    expect((await put({ provider: 'graph', graph: graph(), graphCredential: selfSignedCertificate().pem })).body.error.fields.graphCredential).toMatch(/looks like a certificate/);

    const saved = await put({ ...base, provider: 'graph', graph: graph(), graphCredential: fake.microsoft.clientSecret });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ provider: 'graph', enabled: false, graph: { credentialSet: true, authMethod: 'secret' }, providerLabels: { graph: 'Microsoft Graph' } });
    expect(JSON.stringify(saved.body)).not.toContain(fake.microsoft.clientSecret);
    const row = await t.db.one<any>('select provider_secrets from mail_config');
    expect(row.provider_secrets.graph).toMatch(/^enc:v1:/);
    const audits = await t.db.query<any>(`select summary, before, after from audit_events where action = 'mail.settings'`);
    expect(JSON.stringify(audits)).not.toContain(fake.microsoft.clientSecret);
    expect(audits.at(-1).summary).toMatch(/Email now sent through Microsoft Graph \(Microsoft Graph client secret changed\)/);
  });

  it('sends a test message as MIME through the named mailbox, with every header kept', async () => {
    const res = await testTo();
    expect(res.body).toMatchObject({ status: 'sent', provider: 'graph', to_address: 'checker@example.org' });
    const sent = fake.microsoft.sent.at(-1)!;
    expect(sent.mailbox).toBe('grc@example.org');
    expect(sent.mime).toMatch(/^Subject: Test message from Sandpiper GRC/m);
    expect(sent.mime).toMatch(/^To: checker@example.org/m);
    expect(sent.mime).toMatch(/^Auto-Submitted: auto-generated/m);
    expect(sent.mime).toMatch(/^X-GRC-Mail: test/im);
    const audits = await t.db.query<any>(`select summary from audit_events where action = 'mail.test'`);
    expect(audits.map((a) => a.summary)).toContain('Test email to checker@example.org through Microsoft Graph: sent');
  });

  it('reuses the access token, and replaces one Graph refuses', async () => {
    await put({ enabled: true });
    const first = await t.app.sendMail({ to: 'one@example.org', subject: 'One', text: 'First.' });
    await run();
    const issued = fake.microsoft.tokensIssued;
    const a = await t.app.sendMail({ to: 'one@example.org', subject: 'One again', text: 'Again.' });
    await run();
    expect((await log(first.logIds[0])).status).toBe('sent');
    expect((await log(a.logIds[0])).status).toBe('sent');
    expect(fake.microsoft.tokensIssued).toBe(issued);
    fake.failNext('/sendMail', { status: 401, body: { error: { code: 'InvalidAuthenticationToken', message: 'Lifetime validation failed, the token is expired.' } } });
    const b = await t.app.sendMail({ to: 'two@example.org', subject: 'Two', text: 'Second.' });
    await run();
    expect((await log(b.logIds[0])).status).toBe('sent');
    expect(fake.microsoft.tokensIssued).toBe(issued + 1);
  });

  it('retries a throttled message through the queue', async () => {
    fake.failNext('/sendMail', { status: 429, body: { error: { code: 'ApplicationThrottled', message: 'Application is over its MailboxConcurrency limit.' } }, headers: { 'retry-after': '7' } });
    const res = await t.app.sendMail({ to: 'later@example.org', subject: 'Later', text: 'Busy.' });
    await run();
    const failed = await log(res.logIds[0]);
    expect(failed).toMatchObject({ status: 'failed', attempts: 1 });
    expect(failed.error).toMatch(/throttled.*7 seconds/);
    await due(res.logIds[0]);
    await run();
    expect(await log(res.logIds[0])).toMatchObject({ status: 'sent', attempts: 2 });
  });

  it('says plainly what is wrong: the secret, the mailbox, the permission', async () => {
    await put({ graphCredential: 'wrong~secret' });
    let res = await testTo();
    expect(res.body).toMatchObject({ status: 'dead' });
    expect(res.body.error).toMatch(/client secret is wrong.*AADSTS7000215/);

    await put({ graphCredential: fake.microsoft.clientSecret, graph: { mailbox: 'nobody@example.org' } });
    res = await testTo();
    expect(res.body.error).toMatch(/Wrong mailbox: nobody@example.org/);

    fake.microsoft.mailboxes.add('locked@example.org');
    await put({ graph: { mailbox: 'locked@example.org' } });
    res = await testTo();
    expect(res.body.error).toMatch(/Permission missing.*Mail\.Send application permission.*administrator consent/);

    await put({ graph: { tenantId: '99999999-2222-3333-4444-555555555555', mailbox: '' } });
    res = await testTo();
    expect(res.body.error).toMatch(/tenant\) ID was not found/);
    await put({ graph: { tenantId: fake.microsoft.tenantId } });
  });

  it('signs in with a certificate', async () => {
    const registered = selfSignedCertificate('Sandpiper mail');
    const other = selfSignedCertificate('Someone else');
    fake.microsoft.certificateKey = registered.publicKey;

    expect((await put({ graph: { authMethod: 'certificate' } })).body.error.fields.graphCredential).toMatch(/new sign-in method/);
    expect((await put({ graph: { authMethod: 'certificate' }, graphCredential: 'not a certificate' })).body.error.fields.graphCredential).toMatch(/certificate and its private key/);
    expect((await put({ graph: { authMethod: 'certificate' }, graphCredential: selfSignedCertificate('Old', -10).pem })).body.error.fields.graphCredential).toMatch(/expired/);
    const mismatched = `${registered.pem.split('-----BEGIN PRIVATE KEY-----')[0]}${other.pem.slice(other.pem.indexOf('-----BEGIN PRIVATE KEY-----'))}`;
    expect((await put({ graph: { authMethod: 'certificate' }, graphCredential: mismatched })).body.error.fields.graphCredential).toMatch(/does not belong/);

    const saved = await put({ graph: { authMethod: 'certificate' }, graphCredential: other.pem });
    expect(saved.body.graph).toMatchObject({ authMethod: 'certificate', thumbprint: expect.stringMatching(/^[0-9A-F]{40}$/), certExpires: expect.any(String) });
    let res = await testTo();
    expect(res.body.error).toMatch(/certificate was not accepted.*AADSTS700027/);

    await put({ graphCredential: registered.pem });
    res = await testTo();
    expect(res.body.status).toBe('sent');
  });

  it('refuses a message too large for one Graph request', async () => {
    const big = Buffer.alloc(3_500_000, 1);
    const res = await t.app.sendMail({ to: 'big@example.org', subject: 'Big', text: 'Files.', attachments: [{ filename: 'big.bin', content: big }] });
    await run();
    const row = await log(res.logIds[0]);
    expect(row.status).toBe('dead');
    expect(row.error).toMatch(/at most about 3 MB/);
  });
});

// Each test starts with full delegation and no cached tokens.
beforeEach(() => {
  if (!fake) return;
  fake.google.scopes = new Set(['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.modify']);
  setCloudEndpointsForTests(fake.endpoints);
});

describe('Gmail API', () => {
  it('takes a service account key, never returns it, and never uses the token address inside it', async () => {
    expect((await put({ provider: 'gmail', enabled: true, clearGmailKey: true })).body.error.fields.gmailKey).toMatch(/JSON key/);
    expect((await put({ gmailKey: '{"type":"authorized_user"}' })).body.error.fields.gmailKey).toMatch(/not a service account key/);
    expect((await put({ gmailKey: 'nonsense' })).body.error.fields.gmailKey).toMatch(/whole JSON key/);
    const key = serviceAccountKeyJson(fake);
    const saved = await put({ provider: 'gmail', gmailKey: key, gmail: { mailbox: '' } });
    expect(saved.status).toBe(200);
    expect(saved.body.gmail).toMatchObject({ credentialSet: true, clientEmail: fake.google.clientEmail, clientId: '100000000000000000001' });
    expect(JSON.stringify(saved.body)).not.toContain('PRIVATE KEY');
    expect((await t.db.one<any>('select provider_secrets from mail_config')).provider_secrets.gmail).toMatch(/^enc:v1:/);
    expect(JSON.stringify(await t.db.query('select before, after from audit_events'))).not.toContain('PRIVATE KEY');

    const res = await testTo();
    expect(res.body).toMatchObject({ status: 'sent', provider: 'gmail' });
    expect(fake.google.subjects.at(-1)).toBe('grc@example.org');
    const sent = fake.google.sent.at(-1)!;
    expect(sent.mime).toMatch(/^X-GRC-Mail: test/im);
    expect(sent.mime).toMatch(/^Subject: Test message from Sandpiper GRC/m);
    expect(fake.calls.every((c) => !c.path.includes('attacker'))).toBe(true);
  });

  it('explains missing delegation and a wrong mailbox, and retries when rate-limited', async () => {
    fake.google.scopes = new Set();
    let res = await testTo();
    expect(res.body.error).toMatch(/Domain-wide delegation is missing.*100000000000000000001.*gmail\.send/);
    fake.google.scopes = new Set(['https://www.googleapis.com/auth/gmail.send']);

    await put({ gmail: { mailbox: 'nobody@example.org' } });
    res = await testTo();
    expect(res.body.error).toMatch(/Wrong mailbox: nobody@example.org/);
    await put({ gmail: { mailbox: '' } });

    fake.failNext('/messages/send', { status: 429, body: { error: { code: 429, message: 'User-rate limit exceeded', errors: [{ reason: 'userRateLimitExceeded' }] } } });
    const queued = await t.app.sendMail({ to: 'later@example.org', subject: 'Later', text: 'Busy.' });
    await run();
    expect(await log(queued.logIds[0])).toMatchObject({ status: 'failed' });
    await due(queued.logIds[0]);
    await run();
    expect(await log(queued.logIds[0])).toMatchObject({ status: 'sent', provider: 'gmail' });
  });
});

describe('reading a mailbox through the web interfaces', () => {
  const raw = (subject: string) => `From: Riley Rider <riley@example.org>\r\nTo: desk@example.org\r\nSubject: ${subject}\r\nMessage-ID: <${subject.replace(/\W/g, '')}@example.org>\r\n\r\nHello.\r\n`;

  it('lists unread inbox messages, reads them raw, marks read or moves them away', async () => {
    const ctx = { db: t.db } as any;
    for (const provider of ['graph', 'gmail'] as const) {
      const store = provider === 'graph' ? fake.microsoft.inbox : fake.google.inbox;
      store.set('desk@example.org', [
        { id: `${provider}-1`, raw: raw('Bus stop sign down'), read: false, folder: 'inbox' },
        { id: `${provider}-2`, raw: raw('Already read'), read: true, folder: 'inbox' },
        { id: `${provider}-3`, raw: raw('Fare machine jammed'), read: false, folder: 'inbox' },
      ]);
      const box = await openServiceMailbox(ctx, provider, 'desk@example.org');
      const items = await box.list();
      expect(items.map((i) => i.uid)).toEqual([`${provider}:${provider}-1`, `${provider}:${provider}-3`]);
      expect((await box.retrieve(items[0])).toString()).toContain('Subject: Bus stop sign down');
      await box.delete(items[0]);
      await box.keep!(items[1]);
      expect(store.get('desk@example.org')!.map((m) => [m.folder, m.read])).toEqual([['deleted', false], ['inbox', true], ['inbox', true]]);
      expect(await box.list()).toEqual([]);
    }
  });

  it('says when the permission to read is missing', async () => {
    fake.google.scopes = new Set(['https://www.googleapis.com/auth/gmail.send']);
    const box = await openServiceMailbox({ db: t.db } as any, 'gmail', 'desk@example.org');
    await expect(box.list()).rejects.toThrow(/Domain-wide delegation is missing.*gmail\.modify/);
    fake.microsoft.allowed.delete('desk@example.org');
    const g = await openServiceMailbox({ db: t.db } as any, 'graph', 'desk@example.org');
    await expect(g.list()).rejects.toThrow(/Mail\.ReadWrite application permission/);
    fake.microsoft.allowed.add('desk@example.org');
  });
});
