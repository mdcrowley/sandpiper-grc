import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { secretBox } from '../../core/auth.ts';
import type { Row } from '../../core/module.ts';
import { makeSecretBox } from '../../core/secretbox.ts';
import { resealStoredSecrets } from '../../core/secretkey-reseal.ts';
import { presetBody, signWebhook, webhookUrlContext } from '../../core/webhooks.ts';
import { testApp } from '../../test/helpers.ts';

// E22-45: webhook addresses kept encrypted, shown by host and fingerprint, revealed only after a
// password confirmation; E36-04: chat presets, signed like any other body.

let t: Awaited<ReturnType<typeof testApp>>;
let server: Server;
let port = 0;
const received: { headers: IncomingMessage['headers']; body: string }[] = [];

beforeAll(async () => {
  t = await testApp();
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { received.push({ headers: req.headers, body }); res.writeHead(200); res.end('ok'); });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  await t.api.patch('/api/admin/settings', { 'integrations.outbound_enabled': true, 'integrations.allowed_hosts': [`127.0.0.1:${port}`] });
});
afterAll(async () => { await t.close(); server.close(); });

describe('webhook addresses at rest (E22-45)', () => {
  let id = '';
  const address = () => `http://127.0.0.1:${port}/services/T0K3N/s3cr3t-path`;

  it('stores the address sealed, lists host and fingerprint only, and still delivers', async () => {
    const made = await t.api.post('/api/admin/webhooks', { name: 'Sealed', url: address(), events: ['*'] });
    expect(made.status).toBe(201);
    id = made.body.id;
    const row = (await t.db.one<Row>('select url, url_sealed, url_host, url_fingerprint from webhooks where id = $1', [id]))!;
    expect(row.url).toBe('');
    expect(row.url_sealed).toMatch(/^enc:v1:/);
    expect(row.url_host).toBe(`http://127.0.0.1:${port}`);
    expect(row.url_fingerprint).toMatch(/^[0-9a-f]{12}$/);
    const list = (await t.api.get('/api/admin/webhooks')).body;
    expect(JSON.stringify(list)).not.toContain('s3cr3t');
    const hook = list.webhooks.find((w: Row) => w.id === id);
    expect(hook).toMatchObject({ url_host: `http://127.0.0.1:${port}`, host_allowed: true });
    expect(hook.url_display).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/… \(sha256:[0-9a-f]{12}\)$/);
    expect(hook).not.toHaveProperty('url');
    expect(hook).not.toHaveProperty('url_sealed');
    const test = await t.api.post(`/api/admin/webhooks/${id}/test`);
    expect(test.body.status).toBe('delivered');
    expect(received.at(-1)!.body).toContain('webhook.test');
  });

  it('keeps the address when a change leaves it empty, and reveals it only after a confirmation, audited', async () => {
    const kept = await t.api.patch(`/api/admin/webhooks/${id}`, { name: 'Sealed again', url: '' });
    expect(kept.status).toBe(200);
    const reveal = await t.api.post(`/api/admin/webhooks/${id}/reveal`);
    expect(reveal.status).toBe(200);
    expect(reveal.body.url).toBe(address());
    const audit = (await t.db.one<Row>(`select summary from audit_events where action = 'webhook.reveal' order by id desc limit 1`))!;
    expect(audit.summary).not.toContain('s3cr3t');
    // Without a recent confirmation: refused.
    await t.db.query('update sessions set confirmed_at = null');
    expect((await t.api.post(`/api/admin/webhooks/${id}/reveal`)).body.error.code).toBe('reauth_required');
    const agent = await t.as('agent');
    expect((await agent.post(`/api/admin/webhooks/${id}/reveal`)).status).toBe(403);
    await t.api.post('/api/auth/confirm', { password: 'a long test passphrase 1' });
  });

  it('seals addresses left in the clear at start-up, and reseals them with the rest after a key change', async () => {
    const old = (await t.db.one<{ id: string }>(
      `insert into webhooks (name, url, secret, events) values ('Old one', 'https://old.example.test/hook/k3y', '', '["*"]'::jsonb) returning id`))!;
    const sealed = await t.core.webhooks.sealClearUrls();
    expect(sealed).toBe(1);
    const row = (await t.db.one<Row>('select url, url_sealed, url_host from webhooks where id = $1', [old.id]))!;
    expect(row).toMatchObject({ url: '', url_host: 'https://old.example.test' });
    expect(secretBox(t.db).decrypt(row.url_sealed, webhookUrlContext(old.id))).toBe('https://old.example.test/hook/k3y');
    // A value sealed with a retired key is resealed with the current one.
    const retired = randomBytes(32);
    const previous = makeSecretBox(retired);
    await t.db.query('update webhooks set url_sealed = $2 where id = $1', [old.id, previous.encrypt('https://old.example.test/hook/k3y', webhookUrlContext(old.id))]);
    const current = randomBytes(32);
    const counts = await resealStoredSecrets(t.db, makeSecretBox(current, [retired]), { write: true });
    expect(counts.find((c) => c.key === 'webhook_url')).toMatchObject({ changed: 1 });
    await t.db.query('delete from webhooks where id = $1', [old.id]);
  });
});

describe('chat presets (E36-04)', () => {
  it('builds generic chat bodies with a summary and no field values, signed like any other', async () => {
    const payload = {
      event: 'ticket.update', occurredAt: '2030-01-01T00:00:00.000Z',
      record: { type: 'ticket', id: 'x', ref: 'TKT-00012', label: 'Printer jam (sample)', route: '/tickets/x' },
      data: { title: 'Printer jam (sample)', notes: 'private words' },
      changes: { before: { status: 'new' }, after: { status: 'open', updated_at: 'now' } },
      actor: { id: 'u', name: 'Ann (sample)' },
    };
    const text = JSON.parse(presetBody('chat_text', 'd1', payload, 'https://grc.example.test'));
    expect(text).toEqual({ text: 'Ticket changed: TKT-00012 "Printer jam (sample)" by Ann (sample). Changed: status. https://grc.example.test/tickets/x' });
    const card = JSON.parse(presetBody('chat_card', 'd1', payload));
    expect(card).toMatchObject({ title: 'Ticket changed', link: null });
    expect(card.facts).toEqual(expect.arrayContaining([{ name: 'Reference', value: 'TKT-00012' }, { name: 'Changed', value: 'status' }]));
    expect(JSON.stringify(card)).not.toContain('private words');
    expect(JSON.parse(presetBody('plain_json', 'd1', payload))).toMatchObject({ id: 'd1', data: { notes: 'private words' } });

    const made = await t.api.post('/api/admin/webhooks', { name: 'Chat', url: `http://127.0.0.1:${port}/chat`, events: ['*'], preset: 'chat_text' });
    expect(made.body.preset).toBe('chat_text');
    expect((await t.api.post('/api/admin/webhooks', { name: 'Bad', url: `http://127.0.0.1:${port}/x`, events: ['*'], preset: 'branded' })).body.error.fields.preset).toBeTruthy();
    const delivery = await t.api.post(`/api/admin/webhooks/${made.body.id}/test`);
    expect(delivery.body.status).toBe('delivered');
    const got = received.at(-1)!;
    expect(JSON.parse(got.body)).toEqual({ text: 'Test delivery for "Chat".' });
    const secretRow = (await t.db.one<Row>('select secret from webhooks where id = $1', [made.body.id]))!;
    const secret = secretBox(t.db).decrypt(secretRow.secret, `webhook:${made.body.id}`);
    expect(got.headers['x-grc-signature']).toBe(signWebhook(secret, String(got.headers['x-grc-timestamp']), got.body));
  });
});
