import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { createServer as createTcpServer, type AddressInfo, type Server } from 'node:net';
import { createServer as createTlsServer } from 'node:tls';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RetryLaterError } from '../../core/jobs/index.ts';
import type { Row } from '../../core/module.ts';
import { makeSelfSigned } from '../../core/tls-selfsigned.ts';
import { testApp } from '../../test/helpers.ts';
import { actionIncluded, forwardTuning, makeForwarding, scrubEvent, syslogLine } from './forwarding.ts';

// E36-02: audit-log forwarding. Off by default, only to allowed hosts, TLS verified, no secret in
// what is sent, claimed so overlapping runs send each event once, the cursor moves only on success.

let t: Awaited<ReturnType<typeof testApp>>;
let fwd: ReturnType<typeof makeForwarding>;
const pki = makeSelfSigned(['localhost', '127.0.0.1']);

/** A collector: every connection's bytes, joined. */
function collector(kind: 'tcp' | 'tls') {
  const received: string[] = [];
  const onConn = (sock: NodeJS.ReadWriteStream & { on: (e: string, f: (...a: any[]) => void) => void }) => {
    let data = '';
    sock.on('data', (c: Buffer) => { data += c.toString('utf8'); });
    sock.on('end', () => { received.push(data); });
    sock.on('error', () => { /* a refused handshake */ });
  };
  const server: Server = kind === 'tls' ? createTlsServer({ cert: pki.cert, key: pki.key }, onConn as never) : createTcpServer(onConn as never);
  return { server, received };
}
const listen = (s: Server | HttpsServer) => new Promise<number>((resolve) => s.listen(0, '127.0.0.1', () => resolve((s.address() as AddressInfo).port)));

/** Splits RFC 6587 octet-counted frames. */
function frames(raw: string): string[] {
  const out: string[] = [];
  let rest = Buffer.from(raw, 'utf8');
  while (rest.length) {
    const sp = rest.indexOf(0x20);
    const n = Number(rest.subarray(0, sp).toString());
    out.push(rest.subarray(sp + 1, sp + 1 + n).toString('utf8'));
    rest = rest.subarray(sp + 1 + n);
  }
  return out;
}

const tcp = collector('tcp');
const tls = collector('tls');
let tcpPort = 0;
let tlsPort = 0;
let httpsPort = 0;
const httpsReceived: { headers: Row; body: string }[] = [];
const https = createHttpsServer({ cert: pki.cert, key: pki.key }, (req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => { httpsReceived.push({ headers: req.headers, body }); res.writeHead(202); res.end(); });
});

const allow = (hosts: string[]) => t.db.query(`insert into settings (key, value) values ('integrations.allowed_hosts', $1::jsonb)
  on conflict (key) do update set value = excluded.value`, [JSON.stringify(hosts)]);
const setOutbound = (on: boolean) => t.db.query(`insert into settings (key, value) values ('integrations.outbound_enabled', $1::jsonb)
  on conflict (key) do update set value = excluded.value`, [JSON.stringify(on)]);
const event = (action: string, after: Row = {}) => t.db.query(`insert into audit_events (action, summary, actor_name, after) values ($1, $2, 'Test Admin', $3::jsonb)`,
  [action, `${action} (sample)`, JSON.stringify(after)]);
const forwarderRow = (id: string) => t.db.one<Row>('select * from audit_forwarders where id = $1', [id]);

beforeAll(async () => {
  // Below zero, so an event written just before a run is always picked up: with 0, a coarse clock
  // (seen on macOS runners) can give the event and the run's now() the same time, and `at < now()` skips it.
  forwardTuning.settleSeconds = -1;
  t = await testApp();
  fwd = makeForwarding(t.ctx);
  tcpPort = await listen(tcp.server);
  tlsPort = await listen(tls.server);
  httpsPort = await listen(https);
  await allow([`127.0.0.1:${tcpPort}`, `127.0.0.1:${tlsPort}`, `127.0.0.1:${httpsPort}`]);
});
afterAll(async () => {
  forwardTuning.settleSeconds = 5;
  await t.close();
  tcp.server.close();
  tls.server.close();
  https.close();
});
beforeEach(() => { tcp.received.length = 0; tls.received.length = 0; httpsReceived.length = 0; });

describe('what is sent', () => {
  it('leaves secrets out and shows webhook addresses as host and fingerprint', () => {
    const ev = scrubEvent({ id: '7', at: new Date('2030-01-02T03:04:05Z'), action: 'webhook.update', actor_name: 'Ann (sample)',
      before: { url: 'https://chat.example.test/services/s3cr3t' }, after: { url: 'https://chat.example.test/services/n3w', secret: 'abc', nested: { password: 'pw', token_hash: 'h' } } });
    const text = JSON.stringify(ev);
    expect(text).not.toContain('s3cr3t');
    expect(text).not.toContain('n3w');
    expect(text).not.toContain('"abc"');
    expect(text).not.toContain('"pw"');
    expect((ev.after as Row).secret).toBe('[removed]');
    expect(((ev.after as Row).nested as Row).token_hash).toBe('[removed]');
    const line = syslogLine(ev, 'grc-host');
    expect(line).toMatch(/^<110>1 2030-01-02T03:04:05.000Z grc-host grc - webhook.update \[grc@32473 eventId="7" actor="Ann \(sample\)"\] \{/);
    expect(actionIncluded('signin.failure', ['signin.'])).toBe(true);
    expect(actionIncluded('user.create', ['user.*'])).toBe(true);
    expect(actionIncluded('user.create', ['user.update'])).toBe(false);
    expect(actionIncluded('anything', [])).toBe(true);
  });
});

describe('forwarders', () => {
  let syslogId = '';

  it('are added switched off, keep their address and secret sealed, and are for administrators only', async () => {
    const agent = await t.as('agent');
    expect((await agent.get('/api/admin/audit-forwarders')).status).toBe(403);
    const bad = await t.api.post('/api/admin/audit-forwarders', { name: '', kind: 'https_json', url: 'http://collector.example.test/in' });
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['name', 'url']);
    const made = await t.api.post('/api/admin/audit-forwarders', { name: 'Collector (sample)', kind: 'https_json', url: `https://127.0.0.1:${httpsPort}/ingest?key=s3cr3t`, secret: 'collector-secret-1', caCert: pki.cert });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ active: false, has_url: true, has_secret: true, has_ca: true, kind: 'https_json' });
    const row = (await forwarderRow(made.body.id))!;
    expect(row.url_sealed).toMatch(/^enc:v1:/);
    expect(row.secret_sealed).toMatch(/^enc:v1:/);
    const listed = JSON.stringify((await t.api.get('/api/admin/audit-forwarders')).body);
    expect(listed).not.toContain('s3cr3t');
    expect(listed).not.toContain('collector-secret-1');
    const audited = JSON.stringify(await t.db.query(`select summary, after from audit_events where action like 'audit_forwarder.%'`));
    expect(audited).not.toContain('s3cr3t');
    expect(audited).not.toContain('collector-secret-1');

    const syslog = await t.api.post('/api/admin/audit-forwarders', { name: 'Syslog (sample)', kind: 'syslog_tcp', host: '127.0.0.1', port: tcpPort });
    syslogId = syslog.body.id;
    expect(syslog.body.active).toBe(false);
  });

  it('sends nothing while switched off or while outbound connections are off', async () => {
    await event('test.off');
    expect((await fwd.runAll()).runs).toEqual([]);
    await t.api.patch(`/api/admin/audit-forwarders/${syslogId}`, { active: true });
    await setOutbound(false);
    expect((await fwd.runOne(syslogId)).status).toBe('skipped');
    expect(tcp.received).toEqual([]);
    expect((await forwarderRow(syslogId))!.last_error).toMatch(/switched off/);
  });

  it('sends every event after its cursor, once, even with overlapping runs', async () => {
    await setOutbound(true);
    const start = (await forwarderRow(syslogId))!.cursor_id;
    await event('test.one', { password: 'never-sent' });
    await event('test.two');
    const [a, b] = await Promise.all([fwd.runOne(syslogId), fwd.runOne(syslogId)]);
    // One run sends; the other either finds it running ('skipped') or, when the first has already
    // finished (as on a fast database server), finds nothing left ('idle'). Never two sends.
    const statuses = [a.status, b.status].sort();
    expect(statuses).toContain('sent');
    expect(statuses.filter((s) => s === 'sent')).toHaveLength(1);
    expect(statuses.every((s) => s === 'sent' || s === 'skipped' || s === 'idle')).toBe(true);
    await new Promise((r) => setTimeout(r, 100));
    const sent = tcp.received.flatMap(frames);
    const actions = sent.map((l) => l.split(' ')[5]);
    expect(actions).toContain('test.one');
    expect(actions).toContain('test.two');
    expect(new Set(actions).size).toBe(actions.length); // each once
    expect(sent.join('\n')).not.toContain('never-sent');
    const after = (await forwarderRow(syslogId))!;
    expect(Number(after.cursor_id)).toBeGreaterThan(Number(start));
    expect(after.claimed_until).toBeNull();
    // Nothing new: nothing sent.
    tcp.received.length = 0;
    expect((await fwd.runOne(syslogId)).status).toBe('idle');
    const log = (await t.api.get(`/api/admin/audit-forwarders/${syslogId}/log`)).body;
    expect(log.rows[0]).toMatchObject({ status: 'sent' });
  });

  it('keeps the cursor on failure, logs it and waits; the job asks to be retried later', async () => {
    const cursor = (await forwarderRow(syslogId))!.cursor_id;
    const closed = createTcpServer();
    const port = await listen(closed);
    closed.close();
    await allow([`127.0.0.1:${port}`, `127.0.0.1:${tcpPort}`, `127.0.0.1:${tlsPort}`, `127.0.0.1:${httpsPort}`]);
    await t.db.query('update audit_forwarders set port = $2 where id = $1', [syslogId, port]);
    await event('test.failing');
    await expect(fwd.runAll()).rejects.toBeInstanceOf(RetryLaterError);
    const row = (await forwarderRow(syslogId))!;
    expect(row.cursor_id).toBe(cursor);
    expect(row.failures).toBe(1);
    expect(row.retry_at).not.toBeNull();
    expect(row.last_error).toMatch(/Could not send/);
    // It waits: the next run skips it.
    expect((await fwd.runOne(syslogId)).status).toBe('skipped');
    // Back to a working port, after the wait: everything since the cursor goes, the failed one included.
    await t.db.query('update audit_forwarders set port = $2, retry_at = null where id = $1', [syslogId, tcpPort]);
    expect((await fwd.runOne(syslogId)).status).toBe('sent');
    await new Promise((r) => setTimeout(r, 100));
    expect(tcp.received.flatMap(frames).some((l) => l.includes(' test.failing '))).toBe(true);
  });

  it('refuses a host that is not allowed', async () => {
    await allow([`127.0.0.1:${tlsPort}`, `127.0.0.1:${httpsPort}`]);
    await event('test.blocked');
    const run = await fwd.runOne(syslogId);
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/allow-list/);
    await allow([`127.0.0.1:${tcpPort}`, `127.0.0.1:${tlsPort}`, `127.0.0.1:${httpsPort}`]);
    await t.db.query('update audit_forwarders set active = false where id = $1', [syslogId]);
  });

  it('verifies TLS: an unknown certificate is refused; with its authority given, events go', async () => {
    const made = await t.api.post('/api/admin/audit-forwarders', { name: 'TLS (sample)', kind: 'syslog_tls', host: '127.0.0.1', port: tlsPort, active: true });
    expect(made.status).toBe(201);
    await event('test.tls');
    const refused = await fwd.runOne(made.body.id);
    expect(refused.status).toBe('failed');
    expect(refused.error).toMatch(/certificate/);
    await t.api.patch(`/api/admin/audit-forwarders/${made.body.id}`, { caCert: pki.cert });
    await t.db.query('update audit_forwarders set retry_at = null where id = $1', [made.body.id]);
    expect((await fwd.runOne(made.body.id)).status).toBe('sent');
    await new Promise((r) => setTimeout(r, 100));
    expect(tls.received.flatMap(frames).some((l) => l.includes(' test.tls '))).toBe(true);
    await t.api.del(`/api/admin/audit-forwarders/${made.body.id}`);
  });

  it('posts JSON lines over HTTPS with the bearer secret and a signature, and sends a test event on request', async () => {
    const list = (await t.api.get('/api/admin/audit-forwarders')).body.forwarders as Row[];
    const https = list.find((f) => f.kind === 'https_json')!;
    const test = await t.api.post(`/api/admin/audit-forwarders/${https.id}/test`);
    expect(test.body).toEqual({ ok: true });
    expect(httpsReceived[0].headers.authorization).toBe('Bearer collector-secret-1');
    expect(httpsReceived[0].headers['x-grc-signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(JSON.parse(httpsReceived[0].body.trim())).toMatchObject({ action: 'audit_forward.test' });
    await t.api.patch(`/api/admin/audit-forwarders/${https.id}`, { active: true, includeActions: ['test.json'] });
    await event('test.json');
    await event('test.other');
    expect((await fwd.runOne(https.id)).status).toBe('sent');
    const lines = httpsReceived.slice(1).flatMap((r) => r.body.trim().split('\n')).map((l) => JSON.parse(l));
    expect(lines.map((l) => l.action)).toEqual(['test.json']);
    expect(String(httpsReceived[1].headers['content-type'])).toBe('application/x-ndjson');
  });

  it('removes its delivery log after the retention period', async () => {
    await t.db.query(`update audit_forward_log set attempted_at = now() - interval '40 days' where status = 'sent'`);
    const { removed } = await fwd.housekeeping();
    expect(removed).toBeGreaterThan(0);
    expect((await t.db.one<{ c: number }>(`select count(*)::int c from audit_forward_log where status = 'sent' and attempted_at < now() - interval '30 days'`))!.c).toBe(0);
  });
});
