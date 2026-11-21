import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef, Row } from './module.ts';
import { ANONYMIZED_TEXT } from './retention.ts';
import { WEBHOOK_EVENTS } from './webhooks.ts';
import { testApp } from '../test/helpers.ts';

// E14-33: anonymizing or removing a record from the retention review raises webhook events that
// carry no personal value from before the change. Deliveries are only queued (no receiver).
const fixtures: ModuleDef = {
  key: 'testretentionhooks',
  async seedDefaults(ctx) {
    await ctx.db.exec(`
      create table if not exists test_parcels (
        id uuid primary key default gen_random_uuid(), ref text, title text not null, notes text,
        sender_name text, sender_email text, weight int, restricted boolean not null default false, custom jsonb,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'parcel', table: 'test_parcels', module: 'tickets', label: 'Parcel', plural: 'Parcels',
      path: '/api/test-parcels', route: '/test-parcels', titleField: 'title', ref: { field: 'ref', prefix: 'P-' }, restricted: 'flag',
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true },
        title: { label: 'Title', type: 'text', required: true },
        notes: { label: 'Notes', type: 'longtext' },
        sender_name: { label: 'Sender', type: 'text' },
        sender_email: { label: 'Sender email', type: 'text' },
        weight: { label: 'Weight', type: 'number' },
        restricted: { label: 'Restricted', type: 'boolean', default: false },
      },
    });
  },
};

const SECRETS = ['Robin Placeholder', 'robin@example.test', 'Left at the north gate by Robin', 'Robin prefers mornings'];

let t: Awaited<ReturnType<typeof testApp>>;
const hooks: Record<string, string> = {};
const queued = async (hook: string) =>
  t.db.query<Row>('select event, record_type, record_id, payload from webhook_deliveries where webhook_id = $1 order by created_at, event', [hooks[hook]]);
const confirmNow = () => t.db.query(`update sessions set confirmed_at = now()`);
const noSecrets = (deliveries: Row[]) => {
  const text = JSON.stringify(deliveries);
  for (const s of SECRETS) expect(text).not.toContain(s);
};

async function flagged(fields: Row): Promise<{ id: string; review: string }> {
  const id = (await t.api.post('/api/test-parcels', { title: 'Lost property', notes: SECRETS[2], sender_name: SECRETS[0], sender_email: SECRETS[1], weight: 4, ...fields })).body.id;
  await t.db.query(`update test_parcels set updated_at = now() - interval '40 months' where id = $1`, [id]);
  await t.core.retention.sweep();
  const review = (await t.api.get('/api/admin/retention/reviews?record_type=parcel')).body.rows.find((r: Row) => r.record_id === id);
  expect(review).toBeTruthy();
  return { id, review: review.id };
}

beforeAll(async () => {
  t = await testApp({ extraModules: [fixtures] });
  expect((await t.api.post('/api/admin/custom-fields', { record_type: 'parcel', key: 'pickup_notes', label: 'Pickup notes', type: 'longtext' })).status).toBe(201);
  const add = async (name: string, events: string[], includeRestricted = false) => {
    const res = await t.api.post('/api/admin/webhooks', { name, url: 'https://hooks.example.test/in', events, includeRestricted });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    hooks[name] = res.body.id;
  };
  await add('mirror', ['parcel.*']);
  await add('retention', ['retention.*']);
  await add('restricted mirror', ['parcel.*'], true);
  await add('other type', ['ticket.*']);
  await t.api.put('/api/admin/retention/parcel', { periodMonths: 24, disposal: 'delete' });
  await t.ctx.settings.set('integrations.outbound_enabled', true);
});
afterAll(async () => { await t.close(); });

describe('retention decisions raise webhook events (E14-33)', () => {
  it('lists the two events in the catalog', async () => {
    const names = WEBHOOK_EVENTS.map((e) => e.event);
    expect(names).toEqual(expect.arrayContaining(['retention.anonymized', 'retention.deleted']));
    expect((await t.api.get('/api/admin/webhooks')).body.otherEvents.map((e: Row) => e.event)).toContain('retention.deleted');
  });

  it('anonymizing sends a record update with the replaced fields only, and no earlier values', async () => {
    const { id, review } = await flagged({ cf_pickup_notes: SECRETS[3] });
    await t.db.query('delete from webhook_deliveries');
    await confirmNow();
    const done = await t.api.post(`/api/admin/retention/reviews/${review}/anonymize`, { reason: 'End of the schedule.', confirm: true });
    expect(done.status, JSON.stringify(done.body)).toBe(200);

    const mirror = await queued('mirror');
    expect(mirror.map((d) => d.event)).toEqual(['parcel.update']);
    const p = mirror[0].payload;
    expect(p.record).toMatchObject({ type: 'parcel', id, label: expect.any(String), route: `/test-parcels/${id}` });
    expect(p.changes.fields.sort()).toEqual(['cf_pickup_notes', 'notes', 'sender_email', 'sender_name']);
    expect(p.changes.before).toBeUndefined();
    expect(p.data).toEqual({ notes: ANONYMIZED_TEXT, sender_name: ANONYMIZED_TEXT, sender_email: ANONYMIZED_TEXT, 'cf_pickup_notes': ANONYMIZED_TEXT });
    expect(p.retention).toEqual({ decision: 'anonymized' });
    expect(p.actor).toMatchObject({ name: 'Test Admin' });

    const event = await queued('retention');
    expect(event.map((d) => d.event)).toEqual(['retention.anonymized']);
    expect(event[0].payload.data).toMatchObject({ recordType: 'parcel', comments: 0, files: 0 });
    expect(event[0].payload.data.fields).toHaveLength(4);
    expect(await queued('other type')).toEqual([]);
    noSecrets([...mirror, ...event]);
  });

  it('removing sends a record delete with no field values', async () => {
    const { id, review } = await flagged({});
    const ref = (await t.db.one<Row>('select ref from test_parcels where id = $1', [id]))!.ref;
    await t.db.query('delete from webhook_deliveries');
    await confirmNow();
    const done = await t.api.post(`/api/admin/retention/reviews/${review}/delete`, { reason: 'End of the schedule.', confirm: true });
    expect(done.status, JSON.stringify(done.body)).toBe(200);

    const [d] = await queued('mirror');
    expect(d).toMatchObject({ event: 'parcel.delete', record_type: 'parcel', record_id: id });
    expect(d.payload).toMatchObject({ record: { type: 'parcel', id, ref, label: ref, route: null }, data: {}, purged: true, retention: { decision: 'deleted' } });
    const [e] = await queued('retention');
    expect(e.payload).toMatchObject({ event: 'retention.deleted', data: { recordType: 'parcel', purged: true } });
    noSecrets([d, e]);
  });

  it('holds back a restricted record from webhooks that do not include restricted records', async () => {
    const { review } = await flagged({ restricted: true });
    await t.db.query('delete from webhook_deliveries');
    await confirmNow();
    expect((await t.api.post(`/api/admin/retention/reviews/${review}/delete`, { reason: 'End of the schedule.', confirm: true })).status).toBe(200);
    expect(await queued('mirror')).toEqual([]);
    expect(await queued('retention')).toEqual([]);
    expect((await queued('restricted mirror')).map((d) => d.event)).toEqual(['parcel.delete']);
  });

  it('sends nothing while outbound connections are off', async () => {
    await t.ctx.settings.set('integrations.outbound_enabled', false);
    const { review } = await flagged({});
    await t.db.query('delete from webhook_deliveries');
    await confirmNow();
    expect((await t.api.post(`/api/admin/retention/reviews/${review}/delete`, { reason: 'End of the schedule.', confirm: true })).status).toBe(200);
    expect(await t.db.query('select 1 from webhook_deliveries')).toEqual([]);
  });
});
