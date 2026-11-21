import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef, Row } from './module.ts';
import { LOG_RETENTION, REDACTED_PAYLOAD } from './retention.ts';
import { testApp } from '../test/helpers.ts';

// OP-08: webhook deliveries kept the record's fields for ever and survived anonymizing and removal
// at the end of the retention period; the outgoing and incoming mail logs were never pruned.
const fixtures: ModuleDef = {
  key: 'testretentionlogs',
  async seedDefaults(ctx) {
    await ctx.db.exec(`
      create table if not exists test_lockers (
        id uuid primary key default gen_random_uuid(), ref text, title text not null, notes text,
        owner_name text, custom jsonb,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'locker', table: 'test_lockers', module: 'tickets', label: 'Locker', plural: 'Lockers',
      path: '/api/test-lockers', route: '/test-lockers', titleField: 'title', ref: { field: 'ref', prefix: 'L-' },
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true },
        title: { label: 'Title', type: 'text', required: true },
        notes: { label: 'Notes', type: 'longtext' },
        owner_name: { label: 'Owner', type: 'text' },
      },
    });
  },
};

const SECRET = 'Kept a spare uniform for Avery Placeholder';

let t: Awaited<ReturnType<typeof testApp>>;
let hook: string;
const deliveriesOf = (id: string) =>
  t.db.query<Row>('select id, event, status, payload, last_error from webhook_deliveries where record_id = $1 order by created_at, event', [id]);

async function lockerPastRetention(): Promise<{ id: string; review: string }> {
  const created = await t.api.post('/api/test-lockers', { title: 'Locker 14', notes: SECRET, owner_name: 'Avery Placeholder' });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = created.body.id;
  await t.api.patch(`/api/test-lockers/${id}`, { notes: `${SECRET}, and boots` });
  await t.db.query(`update test_lockers set updated_at = now() - interval '40 months' where id = $1`, [id]);
  await t.core.retention.sweep();
  const review = (await t.api.get('/api/admin/retention/reviews?record_type=locker')).body.rows.find((r: Row) => r.record_id === id);
  expect(review).toBeTruthy();
  return { id, review: review.id };
}

beforeAll(async () => {
  t = await testApp({ extraModules: [fixtures] });
  await t.ctx.settings.set('integrations.outbound_enabled', true);
  const res = await t.api.post('/api/admin/webhooks', { name: 'mirror', url: 'https://hooks.example.test/in', events: ['locker.*'] });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  hook = res.body.id;
  await t.api.put('/api/admin/retention/locker', { periodMonths: 24, disposal: 'delete' });
});
afterAll(async () => { await t.close(); });

describe('webhook deliveries after a retention decision (OP-08)', () => {
  it('anonymizing empties the content of every earlier delivery of the record and stops those still waiting', async () => {
    const { id, review } = await lockerPastRetention();
    const before = await deliveriesOf(id);
    expect(before.map((d) => d.event)).toEqual(['locker.create', 'locker.update']);
    expect(JSON.stringify(before)).toContain(SECRET);
    // One of them already failed for good: it would otherwise be sent again by "Retry".
    await t.db.query(`update webhook_deliveries set status = 'failed' where id = $1`, [before[0].id]);

    await t.db.query('update sessions set confirmed_at = now()');
    const done = await t.api.post(`/api/admin/retention/reviews/${review}/anonymize`, { reason: 'End of the schedule.', confirm: true });
    expect(done.status, JSON.stringify(done.body)).toBe(200);

    const after = await deliveriesOf(id);
    expect(JSON.stringify(after)).not.toContain(SECRET);
    const earlier = after.filter((d) => before.some((b) => b.id === d.id));
    expect(earlier).toHaveLength(2);
    for (const d of earlier) expect(d.payload).toEqual(REDACTED_PAYLOAD);
    expect(earlier.find((d) => d.id === before[0].id)!.status).toBe('failed');
    expect(earlier.find((d) => d.id === before[1].id)).toMatchObject({ status: 'blocked', last_error: expect.stringContaining('retention') });
    // The anonymizing itself is still sent, with the new values only.
    expect(after.filter((d) => !earlier.includes(d)).map((d) => d.status)).toEqual(['pending']);

    // A delivery whose content was removed cannot be sent again.
    const retry = await t.api.post(`/api/admin/webhook-deliveries/${before[0].id}/retry`, {});
    expect(retry.status).toBe(404);
  });

  it('removing a record for good empties its earlier deliveries too', async () => {
    const { id, review } = await lockerPastRetention();
    await t.db.query('update sessions set confirmed_at = now()');
    const done = await t.api.post(`/api/admin/retention/reviews/${review}/delete`, { reason: 'End of the schedule.', confirm: true });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const after = await deliveriesOf(id);
    expect(JSON.stringify(after)).not.toContain(SECRET);
    expect(after.filter((d) => d.event !== 'locker.delete').every((d) => d.payload.redacted === true && d.status === 'blocked')).toBe(true);
    expect(after.find((d) => d.event === 'locker.delete')).toMatchObject({ status: 'pending', payload: { purged: true } });
  });
});

describe('delivery-log housekeeping (OP-08)', () => {
  const insertDelivery = (status: string, daysAgo: number, payload: Row = { data: { notes: SECRET } }) => t.db.one<{ id: string }>(
    `insert into webhook_deliveries (webhook_id, event, payload, status, created_at, last_attempt_at, delivered_at)
     values ($1, 'locker.update', $2::jsonb, $3, now() - make_interval(days => $4::int), now() - make_interval(days => $4::int),
             case when $3 = 'delivered' then now() - make_interval(days => $4::int) end) returning id`,
    [hook, JSON.stringify(payload), status, daysAgo]).then((r) => r!.id);
  const insertMail = (status: string, daysAgo: number) => t.db.one<{ id: string }>(
    `insert into mail_log (to_address, subject, status, created_at) values ('someone@example.test', 'Your ticket', $1, now() - make_interval(days => $2::int)) returning id`,
    [status, daysAgo]).then((r) => r!.id);
  const insertInbound = (daysAgo: number) => t.db.one<{ id: string }>(
    `insert into mail_inbound_log (source, from_address, subject, outcome, received_at) values ('pop3', 'someone@example.test', 'Help', 'created', now() - make_interval(days => $1::int)) returning id`,
    [daysAgo]).then((r) => r!.id);
  const exists = async (table: string, id: string) => !!(await t.db.one(`select 1 from ${table} where id = $1`, [id]));

  it('has settings for the three periods, with defaults', async () => {
    const values = (await t.api.get('/api/admin/settings')).body.values;
    for (const [key, spec] of Object.entries(LOG_RETENTION)) expect(values[key]).toBe(spec.fallback);
    expect((await t.api.patch('/api/admin/settings', { 'retention.mail_log_days': 3 })).status).toBe(400);
  });

  it('removes finished deliveries and messages past their period, keeps what still waits, and empties delivered content', async () => {
    await t.db.query('delete from webhook_deliveries');
    const oldDelivered = await insertDelivery('delivered', 40);
    const oldFailed = await insertDelivery('failed', 40);
    const oldPending = await insertDelivery('pending', 400);
    const recentDelivered = await insertDelivery('delivered', 2);
    const recentFailed = await insertDelivery('failed', 2);
    const oldSent = await insertMail('sent', 200);
    const oldQueued = await insertMail('queued', 200);
    const recentSent = await insertMail('sent', 10);
    const oldInbound = await insertInbound(200);
    const recentInbound = await insertInbound(10);

    const out = await t.core.retention.housekeeping();
    expect(out).toMatchObject({ webhookDeliveries: 2, mailLog: 1, mailInboundLog: 1 });
    expect(await exists('webhook_deliveries', oldDelivered)).toBe(false);
    expect(await exists('webhook_deliveries', oldFailed)).toBe(false);
    expect(await exists('webhook_deliveries', oldPending)).toBe(true);
    expect((await t.db.one<Row>('select payload from webhook_deliveries where id = $1', [recentDelivered]))!.payload).toEqual({});
    expect(JSON.stringify((await t.db.one<Row>('select payload from webhook_deliveries where id = $1', [recentFailed]))!.payload)).toContain(SECRET);
    expect(await exists('mail_log', oldSent)).toBe(false);
    expect(await exists('mail_log', oldQueued)).toBe(true);
    expect(await exists('mail_log', recentSent)).toBe(true);
    expect(await exists('mail_inbound_log', oldInbound)).toBe(false);
    expect(await exists('mail_inbound_log', recentInbound)).toBe(true);
    expect(await t.db.one(`select 1 from audit_events where action = 'retention.housekeeping'`)).toBeTruthy();
  });

  it('follows the periods set by an administrator', async () => {
    await t.db.query('update sessions set confirmed_at = now()');
    const set = await t.api.patch('/api/admin/settings', { 'retention.webhook_delivery_days': 1, 'retention.mail_inbound_log_days': 365 });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    const twoDays = await insertDelivery('failed', 2);
    const inbound = await insertInbound(200);
    await t.core.retention.housekeeping();
    expect(await exists('webhook_deliveries', twoDays)).toBe(false);
    expect(await exists('mail_inbound_log', inbound)).toBe(true);
  });

  it('runs with the daily retention job', async () => {
    const old = await insertMail('dead', 400);
    const jobs = (t.app as unknown as { jobs: { enqueue(type: string): Promise<{ id: string }>; runNow(id: string): Promise<Row> } }).jobs;
    const { id } = await jobs.enqueue('core.retention_sweep');
    const done = await jobs.runNow(id);
    expect(done.status, JSON.stringify(done)).toBe('done');
    expect(done.result.logs).toMatchObject({ mailLog: 1 });
    expect(await exists('mail_log', old)).toBe(false);
  });
});

describe('a delivered webhook keeps no content (OP-08)', () => {
  it('empties the payload once the receiver accepted it', async () => {
    const { createServer } = await import('node:http');
    const server = createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(204); res.end(); }); });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const port = (server.address() as { port: number }).port;
    try {
      await t.ctx.settings.set('integrations.allowed_hosts', [`127.0.0.1:${port}`]);
      await t.db.query(`update webhooks set url = $2 where id = $1`, [hook, `http://127.0.0.1:${port}/in`]);
      await t.db.query('delete from webhook_deliveries');
      const created = await t.api.post('/api/test-lockers', { title: 'Locker 15', notes: SECRET });
      expect(created.status).toBe(201);
      await t.core.webhooks.processDue();
      const [d] = await deliveriesOf(created.body.id);
      expect(d.status, d.last_error).toBe('delivered');
      expect(d.payload).toEqual({});
    } finally {
      server.close();
    }
  });
});
