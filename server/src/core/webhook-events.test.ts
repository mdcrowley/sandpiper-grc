import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef, Row } from './module.ts';
import { testApp } from '../test/helpers.ts';
import { emitWebhookEvent, WEBHOOK_EVENTS } from './webhooks.ts';

// E13-19: webhook events other than record changes. Deliveries are only queued here (no receiver):
// what is queued, for whom, and with which payload is what these tests check.

const crates: ModuleDef = {
  key: 'testcrates',
  async seedDefaults(ctx) {
    await ctx.db.exec(`create table if not exists test_event_crates (
      id uuid primary key default gen_random_uuid(), title text not null, restricted boolean not null default false,
      created_at timestamptz not null default now(), created_by uuid,
      updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz)`);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'event_crate', table: 'test_event_crates', module: 'tickets', label: 'Crate', plural: 'Crates',
      path: '/api/test-event-crates', route: '/test-event-crates', titleField: 'title', restricted: 'flag',
      fields: { title: { label: 'Title', type: 'text', required: true }, restricted: { label: 'Restricted', type: 'boolean' } },
    });
  },
};

let t: Awaited<ReturnType<typeof testApp>>;
const hooks: Record<string, string> = {};
const queued = async (hook: string) =>
  t.db.query<Row>('select event, record_type, record_id, payload from webhook_deliveries where webhook_id = $1 order by created_at', [hooks[hook]]);
const clear = () => t.db.query('delete from webhook_deliveries');

beforeAll(async () => {
  t = await testApp({ extraModules: [crates] });
  const add = async (name: string, events: string[], includeRestricted = false) => {
    const res = await t.api.post('/api/admin/webhooks', { name, url: 'https://hooks.example.test/in', events, includeRestricted });
    expect(res.status).toBe(201);
    hooks[name] = res.body.id;
  };
  await add('everything', ['*']);
  await add('everything restricted too', ['*'], true);
  await add('clocks', ['notification_clock.*'], true);
  await add('backups', ['backup.failed']);
  await add('crate changes', ['event_crate.*']);
});
afterAll(async () => { await t.close(); });

describe('webhook events other than record changes', () => {
  it('offers the catalog on the webhook screen and accepts its names and families only', async () => {
    const list = (await t.api.get('/api/admin/webhooks')).body;
    expect(list.otherEvents.map((e: Row) => e.event)).toEqual(WEBHOOK_EVENTS.map((e) => e.event));
    expect(list.otherEvents.find((e: Row) => e.event === 'backup.failed')).toMatchObject({ restricted: 'never', recordType: null });
    for (const events of [['backup.create'], ['nothing.*'], ['backup.exploded']]) {
      const res = await t.api.post('/api/admin/webhooks', { name: 'Bad', url: 'https://hooks.example.test/x', events });
      expect(res.body.error.fields.events, events.join()).toBeTruthy();
    }
    const ok = await t.api.post('/api/admin/webhooks', { name: 'Families', url: 'https://hooks.example.test/x', events: ['backup.*', 'security_incident.declared'] });
    expect(ok.status).toBe(201);
    await t.api.del(`/api/admin/webhooks/${ok.body.id}`);
  });

  it('queues nothing while outbound connections are off', async () => {
    expect(await emitWebhookEvent(t.app, { event: 'backup.failed', data: { message: 'Disk full' } })).toBe(0);
    expect(await queued('backups')).toEqual([]);
  });

  it('queues an event for the webhooks that ask for it, with the documented payload', async () => {
    await t.ctx.settings.set('integrations.outbound_enabled', true);
    await clear();
    const n = await emitWebhookEvent(t.app, { event: 'backup.failed', data: { runId: 'r1', trigger: 'scheduled', destination: 'folder', message: 'Disk full' } });
    expect(n).toBe(3); // everything, everything restricted too, backups (not clocks, not crate changes)
    const [d] = await queued('backups');
    expect(d).toMatchObject({ event: 'backup.failed', record_type: null, record_id: null });
    expect(d.payload).toMatchObject({ event: 'backup.failed', record: null, actor: null, data: { message: 'Disk full', trigger: 'scheduled' } });
    expect(typeof d.payload.occurredAt).toBe('string');
    expect(await queued('crate changes')).toEqual([]);
  });

  it('sends a restricted event only to webhooks that include restricted records', async () => {
    await clear();
    await emitWebhookEvent(t.app, { event: 'notification_clock.overdue', data: { party: 'Regulator', required: true } });
    expect(await queued('everything')).toEqual([]);
    expect((await queued('everything restricted too')).map((d) => d.event)).toEqual(['notification_clock.overdue']);
    expect((await queued('clocks')).map((d) => d.event)).toEqual(['notification_clock.overdue']);
  });

  it('takes the restriction from the record for an event that follows its record, and names the record', async () => {
    await clear();
    const open = (await t.api.post('/api/test-event-crates', { title: 'Open crate' })).body;
    const sealed = (await t.api.post('/api/test-event-crates', { title: 'Sealed crate', restricted: true })).body;
    await clear(); // the record changes themselves
    await emitWebhookEvent(t.app, { event: 'change.approval_decided', record: { type: 'event_crate', id: open.id }, data: { decision: 'approved' } });
    await emitWebhookEvent(t.app, { event: 'change.approval_decided', record: { type: 'event_crate', id: sealed.id }, data: { decision: 'rejected' } });
    const plain = await queued('everything');
    expect(plain.map((d) => d.payload.data.decision)).toEqual(['approved']);
    expect(plain[0].payload.record).toMatchObject({ type: 'event_crate', id: open.id, label: 'Open crate', route: `/test-event-crates/${open.id}` });
    expect((await queued('everything restricted too')).map((d) => d.payload.data.decision)).toEqual(['approved', 'rejected']);
    // A record that does not exist (or was removed) sends nothing.
    expect(await emitWebhookEvent(t.app, { event: 'change.approval_decided', record: { type: 'event_crate', id: '00000000-0000-4000-8000-000000000000' }, data: {} })).toBe(0);
  });

  it('emits nothing for a switched-off area, and stops offering its events', async () => {
    await clear();
    await t.ctx.settings.set('features', { secincidents: false });
    expect(await emitWebhookEvent(t.app, { event: 'notification_clock.warning', data: {} })).toBe(0);
    expect(await emitWebhookEvent(t.app, { event: 'security_incident.declared', data: {} })).toBe(0);
    const offered = (await t.api.get('/api/admin/webhooks')).body.otherEvents.map((e: Row) => e.event);
    expect(offered).not.toContain('notification_clock.warning');
    expect(offered).toContain('backup.failed');
    await t.ctx.settings.set('features', {});
    expect(await emitWebhookEvent(t.app, { event: 'notification_clock.warning', data: {} })).toBe(2);
  });

  it('refuses an event that is not in the catalog without breaking the caller', async () => {
    expect(await emitWebhookEvent(t.app, { event: 'made.up', data: {} })).toBe(0);
  });
});
