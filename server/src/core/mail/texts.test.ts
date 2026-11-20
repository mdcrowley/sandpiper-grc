import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef } from '../module.ts';
import { testApp } from '../../test/helpers.ts';
import { ensureMail } from './index.ts';
import { startSmtpSink, type SmtpSink } from './smtp-sink.ts';
import { cleanMobile, maskMobile } from './texts.ts';

// E09-25: text messages through an email-to-text address (a stand-in SMTP server) and through the
// webhook (a stand-in receiver on 127.0.0.1). No network. Invented names, numbers and addresses only.
const mailOn: ModuleDef = { key: 'test_texts', async seedDefaults(ctx) { await ensureMail(ctx); } };

interface Received { headers: IncomingMessage['headers']; body: string }
let t: Awaited<ReturnType<typeof testApp>>;
let sink: SmtpSink;
let receiver: Server;
let port = 0;
const received: Received[] = [];
let answer = 200;
const SECRET = 'text-webhook-signing-secret-1';

beforeAll(async () => {
  t = await testApp({ extraModules: [mailOn] });
  sink = await startSmtpSink();
  receiver = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(answer);
      res.end();
    });
  });
  await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', () => resolve()));
  port = (receiver.address() as AddressInfo).port;
});
afterAll(async () => {
  await t.close();
  await sink.close();
  await new Promise<void>((resolve) => receiver.close(() => resolve()));
});

const run = () => t.app.jobs.runDue({ types: ['mail.send', 'text.webhook'] });
const log = (id: string) => t.db.one<any>('select * from mail_log where id = $1', [id]);

describe('contact details for alerts', () => {
  it('are each person\'s own to change, and administrators\'; the audit trail never holds the numbers', async () => {
    const agent = await t.as('agent');
    expect((await agent.get('/api/me/alert-contact')).body).toMatchObject({ mobile: '', smsAddress: '', channels: { gateway: false, webhook: false } });
    const bad = await agent.put('/api/me/alert-contact', { mobile: 'call me', smsAddress: 'not an address' });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['mobile', 'smsAddress']);
    const saved = await agent.put('/api/me/alert-contact', { mobile: '+1 (555) 010-0123', smsAddress: '5550100123@Text.Example.net' });
    expect(saved.body).toMatchObject({ mobile: '+15550100123', smsAddress: '5550100123@text.example.net' });
    const audit = await t.db.query<any>(`select summary, before, after from audit_events where action = 'user.alert_contact'`);
    expect(audit.at(-1).summary).toMatch(/mobile number and email-to-text address changed/);
    expect(JSON.stringify(audit)).not.toContain('5550100123');

    // Another person's details: administrators only.
    const other = await t.as('agent');
    expect((await other.get(`/api/admin/users/${agent.userId}/alert-contact`)).status).toBe(403);
    expect((await t.api.get(`/api/admin/users/${agent.userId}/alert-contact`)).body.mobile).toBe('+15550100123');
    expect((await t.api.put(`/api/admin/users/${agent.userId}/alert-contact`, { mobile: '' })).body).toMatchObject({ mobile: '', smsAddress: '5550100123@text.example.net' });
    expect((await t.api.get('/api/admin/users/00000000-0000-0000-0000-000000000000/alert-contact')).status).toBe(404);
    // Nothing is set up yet: a test says so.
    expect((await agent.post('/api/me/alert-contact/test')).body.error.code).toBe('not_configured');

    expect(cleanMobile('555 01')).toBeNull();
    expect(cleanMobile('+44 20 7946 0000')).toBe('+442079460000');
    expect(maskMobile('+15550100123')).toBe('+1••••••0123');
  });
});

describe('text-message settings', () => {
  it('need an https (or this machine\'s) address and a secret for the webhook, keep the secret encrypted, and are audited', async () => {
    const off = await t.api.get('/api/admin/text/settings');
    expect(off.body).toMatchObject({ gateway: false, webhook: false, url: '', secretSet: false, emailOn: false, outboundOn: false });
    const refused = await t.api.put('/api/admin/text/settings', { webhook: true, url: 'http://sms.example.org/hook' });
    expect(Object.keys(refused.body.error.fields).sort()).toEqual(['secret', 'url']);
    expect((await t.api.put('/api/admin/text/settings', { secret: 'short' })).body.error.fields.secret).toBeTruthy();
    const saved = await t.api.put('/api/admin/text/settings', { webhook: true, url: `http://127.0.0.1:${port}/texts`, secret: SECRET, gateway: true });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ webhook: true, gateway: true, secretSet: true, hostAllowed: false });
    expect(JSON.stringify(saved.body)).not.toContain(SECRET);
    const row = await t.db.one<any>('select provider_secrets, provider_settings from mail_config');
    expect(row.provider_secrets.text_webhook).toMatch(/^enc:v1:/);
    expect(row.provider_settings.text).toEqual({ gateway: true, webhook: true, url: `http://127.0.0.1:${port}/texts` });
    const audits = await t.db.query<any>(`select summary, before, after from audit_events where action = 'text.settings'`);
    expect(audits.at(-1).summary).toMatch(/signing secret changed/);
    expect(JSON.stringify(audits)).not.toContain(SECRET);
    expect((await (await t.as('agent')).get('/api/admin/text/settings')).status).toBe(403);
    // Saving the email settings keeps the text settings and secret.
    await t.api.put('/api/admin/mail/settings', { host: '127.0.0.1', port: sink.port, tlsMode: 'none', fromAddress: 'grc@example.test', baseUrl: 'https://grc.example.test', enabled: true });
    expect((await t.db.one<any>('select provider_secrets from mail_config')).provider_secrets.text_webhook).toMatch(/^enc:v1:/);
  });
});

describe('sending', () => {
  it('sends by email-to-text and by the signed webhook, rechecking the person when it is sent', async () => {
    const lead = await t.as('security_lead');
    await lead.put('/api/me/alert-contact', { mobile: '+15550100777', smsAddress: '5550100777@text.example.net' });

    // Outbound connections off: the webhook text is refused (dead), the email-to-text one goes.
    let res = await t.app.sendText({ userIds: [lead.userId], text: 'Security incident SEC-0001 needs attention. Open the app.', purpose: 'security', permission: 'security.view' });
    expect(res.queued).toBe(2);
    const before = sink.messages.length;
    await run();
    const [mailRow, hookRow] = await Promise.all(res.logIds.map(log));
    expect(mailRow).toMatchObject({ status: 'sent', template: 'text_message', purpose: 'security', to_address: '5550100777@text.example.net' });
    expect(sink.messages.length).toBe(before + 1);
    expect(sink.messages.at(-1)!.to).toEqual(['5550100777@text.example.net']);
    expect(sink.messages.at(-1)!.body).toContain('Security incident SEC-0001 needs attention. Open the app.');
    expect(sink.messages.at(-1)!.body).not.toContain('Hello');
    expect(hookRow).toMatchObject({ status: 'dead', provider: 'webhook', to_address: '+1••••••0777' });
    expect(hookRow.error).toMatch(/Outbound connections are switched off/);

    // On, but the host is not on the allow-list.
    await t.ctx.settings.set('integrations.outbound_enabled', true);
    res = await t.app.sendText({ userIds: [lead.userId], text: 'Second.', purpose: 'security' });
    await run();
    expect((await log(res.logIds[1])).error).toMatch(/not on the allow-list/);

    // Allowed: delivered, signed, in the documented format.
    await t.ctx.settings.set('integrations.allowed_hosts', [`127.0.0.1:${port}`]);
    res = await t.app.sendText({ userIds: [lead.userId], text: 'Third.', purpose: 'security', permission: 'security.view' });
    await run();
    expect(await log(res.logIds[1])).toMatchObject({ status: 'sent' });
    const got = received.at(-1)!;
    const body = JSON.parse(got.body);
    expect(body).toMatchObject({ type: 'text_message', id: res.logIds[1], to: '+15550100777', text: 'Third.', purpose: 'security', test: false });
    expect(got.headers['x-grc-event']).toBe('text.message');
    const expected = `sha256=${createHmac('sha256', SECRET).update(`${got.headers['x-grc-timestamp']}.${got.body}`).digest('hex')}`;
    expect(got.headers['x-grc-signature']).toBe(expected);

    // A busy receiver is tried again; a refusal is final.
    answer = 503;
    res = await t.app.sendText({ userIds: [lead.userId], text: 'Fourth.', purpose: 'security' });
    await run();
    expect(await log(res.logIds[1])).toMatchObject({ status: 'failed' });
    answer = 400;
    res = await t.app.sendText({ userIds: [lead.userId], text: 'Fifth.', purpose: 'security' });
    await run();
    expect(await log(res.logIds[1])).toMatchObject({ status: 'dead' });
    answer = 200;

    // Someone who loses the permission before it is sent gets nothing.
    res = await t.app.sendText({ userIds: [lead.userId], text: 'Sixth.', purpose: 'security', permission: 'security.view' });
    await t.db.query('delete from user_roles where user_id = $1', [lead.userId]);
    const count = received.length;
    await run();
    expect((await Promise.all(res.logIds.map(log))).map((r) => r.status)).toEqual(['skipped', 'skipped']);
    expect(received.length).toBe(count);
    // People with no details, or unknown, are counted as skipped.
    const plain = await t.as('agent');
    expect(await t.app.sendText({ userIds: [plain.userId, 'nobody'], text: 'x', purpose: 'security' })).toMatchObject({ queued: 0, skipped: 1 });
  });

  it('sends a test text to oneself at once, through each way that is on, and audits it', async () => {
    const agent = await t.as('agent');
    await agent.put('/api/me/alert-contact', { mobile: '+15550100888', smsAddress: '5550100888@text.example.net' });
    const res = await agent.post('/api/me/alert-contact/test');
    expect(res.status).toBe(200);
    expect(res.body.results.map((r: any) => [r.provider, r.status])).toEqual([['smtp', 'sent'], ['webhook', 'sent']]);
    expect(JSON.parse(received.at(-1)!.body)).toMatchObject({ to: '+15550100888', test: true, purpose: 'test' });
    const audit = await t.db.query<any>(`select summary from audit_events where action = 'text.test'`);
    expect(audit.at(-1).summary).toMatch(/email-to-text sent, webhook sent/);
  });
});
