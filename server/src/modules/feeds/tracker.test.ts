import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signWebhook } from '../../core/webhooks.ts';
import { ADMIN, testApp } from '../../test/helpers.ts';
import { trackerPusher } from './tracker.ts';

// The work-tracker bridge (E36-06): signed JSON out, claimed before sending; signed status updates in,
// refused alike when anything is wrong; restricted records never sent unless the connection says so.

let t: Awaited<ReturnType<typeof testApp>>;
let receiver: Server;
let port = 0;
const received: { headers: IncomingMessage['headers']; body: string }[] = [];
let connector: { id: string; secret: string; inboundSecret: string; inboundAddress: string };
let actionId: string;
let restrictedId: string;

const confirm = () => t.api.post('/api/auth/confirm', { password: ADMIN.password });

beforeAll(async () => {
  process.env.GRC_MODULES = 'feeds,attachments,notifications,risks,admin';
  receiver = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { received.push({ headers: req.headers, body }); res.writeHead(201); res.end('{}'); });
  });
  await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', () => r()));
  port = (receiver.address() as AddressInfo).port;
  t = await testApp();
  await t.db.query(`insert into settings (key, value) values ('integrations.outbound_enabled', 'true'), ('integrations.allowed_hosts', $1::jsonb)
    on conflict (key) do update set value = excluded.value`, [JSON.stringify([`127.0.0.1:${port}`])]);
  actionId = (await t.api.post('/api/actions', { title: 'Renew the depot certificate', status: 'open', due_on: '2026-12-31' })).body.id;
  const risk = (await t.api.post('/api/risks', { title: 'Secret risk', scale_key: 'cyber_5x5' })).body;
  restrictedId = (await t.api.post('/api/actions', { title: 'Restricted work', status: 'open', source: 'risk', source_type: 'risk', source_id: risk.id })).body.id;
});
afterAll(async () => {
  await t?.close();
  await new Promise<void>((r) => receiver.close(() => r()));
});

const runPush = () => t.app.jobs.runDue();

describe('work-tracker bridge', () => {
  it('lets only an administrator who confirmed their password add a connection; secrets are shown once', async () => {
    const lead = await t.as('security_lead');
    expect((await lead.post('/api/admin/tracker-connectors', {})).status).toBe(403);
    await t.db.query('update sessions set confirmed_at = null');
    const body = { name: 'Work tracker (sample)', url: `http://127.0.0.1:${port}/hook`, record_types: ['action'], active: true, status_map: { action: { Resolved: 'done', Working: 'in_progress' } } };
    expect((await t.api.post('/api/admin/tracker-connectors', body)).body.error.code).toBe('reauth_required');
    await confirm();
    const made = await t.api.post('/api/admin/tracker-connectors', body);
    expect(made.status).toBe(201);
    expect(made.body.secret).toBeTruthy();
    expect(made.body.inboundAddress).toContain(`/api/integrations/tracker/${made.body.id}/status`);
    connector = made.body;
    expect((await t.api.get('/api/tracker/available?record_type=action')).body.available).toBe(true);
    expect((await t.api.get('/api/tracker/available?record_type=vulnerability')).body.available).toBe(false);
    expect((await (await t.as('training_coordinator')).get('/api/tracker/available?record_type=action')).body.available).toBe(false);
    const listed = await t.api.get('/api/admin/tracker-connectors');
    // Only the kinds of record that are there and switched on are offered (vulnerabilities are not loaded here).
    expect(listed.body.kinds).toEqual([{ type: 'action', label: 'Actions' }]);
    expect(JSON.stringify(listed.body)).not.toContain(made.body.secret);
    expect(JSON.stringify(listed.body)).not.toContain('/hook');
    expect(listed.body.connectors[0].url_host).toBe(`127.0.0.1:${port}`);
    const stored = await t.db.one<any>('select url_sealed, secret_sealed from ticket_connectors where id = $1', [made.body.id]);
    expect(stored.url_sealed).not.toContain('127.0.0.1');
    expect(stored.secret_sealed).not.toContain(made.body.secret);
  });

  it('refuses a kind of record that is not on, but keeps one already stored', async () => {
    await confirm();
    const bad = await t.api.post('/api/admin/tracker-connectors', { name: 'Other', url: `http://127.0.0.1:${port}/x`, record_types: ['vulnerability'] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.record_types).toBeTruthy();
    // A kind stored while its area was on stays through a save.
    await t.db.query(`update ticket_connectors set record_types = '["action", "vulnerability"]'::jsonb where id = $1`, [connector.id]);
    const kept = await t.api.patch(`/api/admin/tracker-connectors/${connector.id}`, { record_types: ['action', 'vulnerability'] });
    expect(kept.status).toBe(200);
    expect(kept.body.record_types).toEqual(['action', 'vulnerability']);
    expect((await t.api.get('/api/tracker/available?record_type=vulnerability')).body.available).toBe(false);
    await t.api.patch(`/api/admin/tracker-connectors/${connector.id}`, { record_types: ['action'] });
  });

  it('refuses restricted records unless the connection includes them', async () => {
    const offered = (await t.api.get(`/api/tracker/links?record_type=action&record_id=${restrictedId}`)).body;
    expect(offered.connectors).toEqual([]);
    const r = await t.api.post('/api/tracker/send', { record_type: 'action', record_id: restrictedId, connector_id: connector.id });
    expect(r.body.error.code).toBe('restricted');
    // Someone who cannot see the record gets "not found".
    const agent = await t.as('agent');
    expect((await agent.get(`/api/tracker/links?record_type=action&record_id=${restrictedId}`)).status).toBe(404);
    // Only a security.view holder may switch restricted records on.
    const adminNoSecurity = await t.as('agent');
    expect((await adminNoSecurity.patch(`/api/admin/tracker-connectors/${connector.id}`, { include_restricted: true })).status).toBe(403);
  });

  it('sends once, signed, even when two runs overlap', async () => {
    const sent = await t.api.post('/api/tracker/send', { record_type: 'action', record_id: actionId, connector_id: connector.id });
    expect(sent.status).toBe(202);
    expect((await t.api.post('/api/tracker/send', { record_type: 'action', record_id: actionId, connector_id: connector.id })).body.error.code).toBe('already_sent');
    received.length = 0;
    // Two pushes of the same link at once: the claim lets one through.
    const queued = await t.db.one<any>('select id from external_ticket_links where record_id = $1', [actionId]);
    const pusher = trackerPusher(t.app)!;
    const results = await Promise.all([pusher.pushOne(queued.id), pusher.pushOne(queued.id)]);
    expect(results.sort()).toEqual(['sent', 'skipped']);
    await runPush(); // and the scheduled run finds nothing left to send
    const link = await t.db.one<any>('select * from external_ticket_links where record_id = $1', [actionId]);
    expect(link.pushed_at).toBeTruthy();
    expect(received).toHaveLength(1);
    const { headers, body } = received[0];
    expect(headers['x-grc-signature']).toBe(signWebhook(connector.secret, String(headers['x-grc-timestamp']), body));
    const payload = JSON.parse(body);
    expect(payload.link_id).toBe(link.id);
    expect(payload.record.title).toBe('Renew the depot certificate');
  });

  it('asks a send that is already running to run once more for a record sent meanwhile (W17 review)', async () => {
    await t.db.query(`delete from jobs where type = 'feeds.tracker_push' and dedupe_key = 'feeds.tracker_push'`);
    const running = await t.app.jobs.enqueue('feeds.tracker_push', {}, { key: 'feeds.tracker_push', delayMs: 60_000 });
    // That run has been claimed by a process and has already read what is waiting.
    await t.db.query(`update jobs set status = 'running', locked_by = 'elsewhere:1', locked_until = now() + interval '5 minutes' where id = $1`, [running.id]);
    const another = (await t.api.post('/api/actions', { title: 'Replace the platform display', status: 'open' })).body.id;
    expect((await t.api.post('/api/tracker/send', { record_type: 'action', record_id: another, connector_id: connector.id })).status).toBe(202);
    // Before the fix the request was skipped and waited for the next scheduled run.
    const rows = await t.db.query<any>(`select id, status, rerun from jobs where type = 'feeds.tracker_push' and dedupe_key = 'feeds.tracker_push'`);
    expect(rows).toEqual([{ id: running.id, status: 'running', rerun: true }]);
    await t.db.query('delete from jobs where id = $1', [running.id]);
  });

  it('brings a status back only with a valid, fresh, unseen signature; every refusal looks the same', async () => {
    const link = await t.db.one<any>('select id from external_ticket_links where record_id = $1', [actionId]);
    const post = (id: string, body: object, opts: { secret?: string; ts?: number; raw?: string } = {}) => {
      const raw = opts.raw ?? JSON.stringify(body);
      const ts = opts.ts ?? Math.floor(Date.now() / 1000);
      return t.app.inject({
        method: 'POST', url: `/api/integrations/tracker/${id}/status`, payload: raw,
        headers: { 'content-type': 'application/json', 'x-grc-timestamp': String(ts), 'x-grc-signature': signWebhook(opts.secret ?? connector.inboundSecret, ts, raw) },
      });
    };
    const update = { link_id: link.id, external_id: 'EXT-1', external_url: 'https://tracker.example.test/EXT-1', status: 'Working' };

    const badSig = await post(connector.id, update, { secret: 'wrong' });
    const stale = await post(connector.id, update, { ts: Math.floor(Date.now() / 1000) - 3600 });
    const unknown = await post('00000000-0000-4000-8000-000000000000', update);
    for (const r of [badSig, stale, unknown]) {
      expect(r.statusCode).toBe(401);
      expect(r.body).toBe(badSig.body);
    }

    const ts = Math.floor(Date.now() / 1000);
    const raw = JSON.stringify(update);
    const ok = await post(connector.id, update, { ts, raw });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().applied).toBe('in_progress');
    expect((await t.api.get(`/api/actions/${actionId}`)).body.status).toBe('in_progress');
    const replay = await post(connector.id, update, { ts, raw });
    expect(replay.statusCode).toBe(401);
    expect(replay.body).toBe(badSig.body);

    const unmapped = await post(connector.id, { external_id: 'EXT-1', status: 'Waiting for vendor' });
    expect(unmapped.json()).toMatchObject({ applied: null, reason: 'not_mapped' });
    const shown = (await t.api.get(`/api/tracker/links?record_type=action&record_id=${actionId}`)).body.links[0];
    expect(shown).toMatchObject({ external_id: 'EXT-1', external_status: 'Waiting for vendor', external_url: 'https://tracker.example.test/EXT-1' });

    // A switched-off connection is refused the same way.
    await confirm();
    await t.api.patch(`/api/admin/tracker-connectors/${connector.id}`, { active: false });
    const off = await post(connector.id, { link_id: link.id, status: 'Resolved' });
    expect(off.statusCode).toBe(401);
    expect(off.body).toBe(badSig.body);
    expect((await t.api.get(`/api/actions/${actionId}`)).body.status).toBe('in_progress');
  });

  it('records a failure and does not send while outbound connections are off', async () => {
    await confirm();
    await t.api.patch(`/api/admin/tracker-connectors/${connector.id}`, { active: true });
    const other = (await t.api.post('/api/actions', { title: 'Second one', status: 'open' })).body.id;
    await t.db.query(`update settings set value = 'false' where key = 'integrations.outbound_enabled'`);
    received.length = 0;
    await t.api.post('/api/tracker/send', { record_type: 'action', record_id: other, connector_id: connector.id });
    await runPush();
    const link = await t.db.one<any>('select * from external_ticket_links where record_id = $1', [other]);
    expect(link.pushed_at).toBeNull();
    expect(link.push_error).toMatch(/switched off/);
    expect(received).toHaveLength(0);
  });
});
