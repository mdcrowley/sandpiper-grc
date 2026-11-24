import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../test/helpers.ts';
import { afterCommit, inTrial } from './db.ts';
import type { ModuleDef, Row } from './module.ts';

// E40-03: a record save (create, update, delete) is one transaction: the row, its custom values, its
// history and audit event, and the hooks' own writes are kept together or not at all. Effects outside
// the database (record-change listeners: webhooks, watchers) wait for the commit.
// E40-13: linking a record also needs view permission on the linked record's area.

/** Hooks fail on purpose when a name asks them to, after the row is written. */
const crates: ModuleDef = {
  key: 'atomiccrates',
  async seedDefaults(ctx) {
    await ctx.db.exec(`create table if not exists atomic_crates (
      id uuid primary key default gen_random_uuid(), ref text, name text not null, shelf text, parent_id uuid, custom jsonb not null default '{}',
      created_at timestamptz not null default now(), created_by uuid,
      updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);
      create table if not exists atomic_crate_log (crate_id uuid, note text);`);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'atomic_crate', table: 'atomic_crates', module: 'tickets', label: 'Crate', plural: 'Crates',
      path: '/api/atomic-crates', route: '/atomic-crates', titleField: 'name', ref: { field: 'ref', prefix: 'CRT-' },
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true },
        name: { label: 'Name', type: 'text', required: true },
        shelf: { label: 'Shelf', type: 'text' },
        parent_id: { label: 'Parent', type: 'ref', to: 'atomic_crate' },
      },
      hooks: {
        afterCreate: async (req, row) => {
          await ctx.db.query('insert into atomic_crate_log (crate_id, note) values ($1, $2)', [row.id, 'created']);
          // A nested save: a child crate, then a transaction of the hook's own (a savepoint now).
          if (String(row.name).includes('with child')) await ctx.resources.create('atomic_crate', { name: `Child of ${row.name}`.replace('with child', 'kid') }, req);
          await ctx.db.tx(async (tx) => { await tx.query('insert into atomic_crate_log (crate_id, note) values ($1, $2)', [row.id, 'in tx']); });
          if (String(row.name).includes('fail after')) throw new Error('An invented failure after the row was written.');
        },
        afterUpdate: async (_req, _before, row) => {
          await ctx.db.query('insert into atomic_crate_log (crate_id, note) values ($1, $2)', [row.id, 'updated']);
          if (row.shelf === 'fail after') throw new Error('An invented failure after the update was written.');
        },
      },
    });
  },
};

let t: Awaited<ReturnType<typeof testApp>>;
const heard: { action: string; name: string; inTrial: boolean }[] = [];
const count = async (sql: string, params: unknown[] = []) => (await t.db.one<{ c: number }>(`select count(*)::int c from ${sql}`, params))!.c;

beforeAll(async () => {
  t = await testApp({ extraModules: [crates] });
  t.core.resources.onChange(({ action, row }) => { heard.push({ action, name: String(row.name), inTrial: inTrial() }); });
  const cf = await t.api.post('/api/admin/custom-fields', { record_type: 'atomic_crate', label: 'Seal number', type: 'text' });
  expect(cf.status, JSON.stringify(cf.body)).toBe(201);
}, 120_000);
afterAll(async () => { await t?.close(); });

describe('a record save is one transaction (E40-03)', () => {
  it('a hook failing after the row is written leaves no row, custom value, history, audit event, reference number or hook write', async () => {
    const before = { crates: await count('atomic_crates'), log: await count('atomic_crate_log'), audit: await count(`audit_events where record_type = 'atomic_crate'`) };
    heard.length = 0;
    const res = await t.api.post('/api/atomic-crates', { name: 'Spare mirrors, fail after', cf_seal_number: 'S-1', shelf: 'A1' });
    expect(res.status).toBe(500);
    expect(await count('atomic_crates')).toBe(before.crates);
    expect(await count(`atomic_crates where custom->>'seal_number' = 'S-1'`)).toBe(0);
    expect(await count('atomic_crate_log')).toBe(before.log);
    expect(await count(`audit_events where record_type = 'atomic_crate'`)).toBe(before.audit);
    expect((await t.api.get('/api/history?record_type=atomic_crate&record_id=00000000-0000-4000-8000-000000000000')).status).not.toBe(500);
    expect(heard).toEqual([]); // nobody was told
    // The reference number was rolled back with it: the next crate takes it.
    const next = await t.api.post('/api/atomic-crates', { name: 'Spare mirrors' });
    expect(next.status).toBe(201);
    expect(next.body.ref).toBe('CRT-00001');
    expect(heard).toEqual([{ action: 'create', name: 'Spare mirrors', inTrial: false }]);
    expect(await count('atomic_crate_log where crate_id = $1', [next.body.id])).toBe(2);
  });

  it('a nested save made by a hook is undone with the save that made it', async () => {
    const crates = await count('atomic_crates');
    heard.length = 0;
    expect((await t.api.post('/api/atomic-crates', { name: 'Tools with child fail after' })).status).toBe(500);
    expect(await count('atomic_crates')).toBe(crates);
    expect(heard).toEqual([]);
    const ok = await t.api.post('/api/atomic-crates', { name: 'Tools with child' });
    expect(ok.status).toBe(201);
    expect(await count('atomic_crates')).toBe(crates + 2);
    // The child's listeners heard of it after the commit too, before the parent's.
    expect(heard.map((h) => h.action + ':' + h.name)).toEqual(['create:Child of Tools kid', 'create:Tools with child']);
    expect(heard.every((h) => !h.inTrial)).toBe(true);
  });

  it('an update whose hook fails keeps the row, its custom values and its history as they were', async () => {
    const made = (await t.api.post('/api/atomic-crates', { name: 'Fare boxes', shelf: 'B1', cf_seal_number: 'S-9' })).body as Row;
    const audits = await count(`audit_events where record_id = $1`, [made.id]);
    const log = await count('atomic_crate_log where crate_id = $1', [made.id]);
    heard.length = 0;
    const res = await t.api.patch(`/api/atomic-crates/${made.id}`, { shelf: 'fail after', cf_seal_number: 'S-10' });
    expect(res.status).toBe(500);
    const row = await t.db.one<Row>('select shelf, custom, updated_at from atomic_crates where id = $1', [made.id]);
    expect(row).toMatchObject({ shelf: 'B1', custom: { seal_number: 'S-9' } });
    expect(await count(`audit_events where record_id = $1`, [made.id])).toBe(audits);
    expect(await count('atomic_crate_log where crate_id = $1', [made.id])).toBe(log);
    expect(heard).toEqual([]);
    expect((await t.api.patch(`/api/atomic-crates/${made.id}`, { shelf: 'B2' })).status).toBe(200);
    expect(heard).toEqual([{ action: 'update', name: 'Fare boxes', inTrial: false }]);
  });

  it('a delete whose audit event cannot be written leaves the record in place', async () => {
    const made = (await t.api.post('/api/atomic-crates', { name: 'Seat covers' })).body as Row;
    // The audit insert fails for this one record: the failure comes after the row was marked deleted.
    await t.db.exec(`create or replace function atomic_refuse_audit() returns trigger language plpgsql as $$
      begin if new.action = 'atomic_crate.delete' and new.record_id = '${made.id}' then raise exception 'invented audit failure'; end if; return new; end $$;
      create trigger atomic_refuse_audit before insert on audit_events for each row execute function atomic_refuse_audit();`);
    try {
      heard.length = 0;
      expect((await t.api.del(`/api/atomic-crates/${made.id}`)).status).toBe(500);
      expect((await t.db.one<Row>('select deleted_at from atomic_crates where id = $1', [made.id]))!.deleted_at).toBeNull();
      expect(heard).toEqual([]);
    } finally {
      await t.db.exec('drop trigger atomic_refuse_audit on audit_events; drop function atomic_refuse_audit();');
    }
    expect((await t.api.del(`/api/atomic-crates/${made.id}`)).status).toBe(200);
    expect(heard).toEqual([{ action: 'delete', name: 'Seat covers', inTrial: false }]);
  });

  it('runs work left for the commit only after it, and never for a rolled-back save or inside a check', async () => {
    const order: string[] = [];
    await t.db.atomic!(async () => {
      await t.db.query('insert into atomic_crate_log (note) values ($1)', ['atomic']);
      await afterCommit(() => { order.push(`after:${inTrial()}`); });
      order.push(`inside:${inTrial()}`);
    });
    expect(order).toEqual(['inside:true', 'after:false']);

    order.length = 0;
    await expect(t.db.atomic!(async () => {
      await afterCommit(() => { order.push('never'); });
      throw new Error('rolled back');
    })).rejects.toThrow('rolled back');
    // A savepoint rolled back inside a save that commits: its own work is dropped, the rest runs.
    await t.db.atomic!(async () => {
      await t.db.atomic!(async () => { await afterCommit(() => { order.push('inner kept'); }); });
      await t.db.atomic!(async () => { await afterCommit(() => { order.push('inner dropped'); }); throw new Error('part'); }).catch(() => undefined);
      await afterCommit(() => { order.push('outer'); });
    });
    await t.db.trial!(async () => { await afterCommit(() => { order.push('trial'); }); });
    await afterCommit(() => { order.push('no transaction: at once'); });
    expect(order).toEqual(['inner kept', 'outer', 'no transaction: at once']);
    expect(await count(`atomic_crate_log where note = 'atomic'`)).toBe(1);
  });

  it('a save in an import check (a rolled-back trial) is a savepoint, and tells nobody', async () => {
    heard.length = 0;
    const before = await count('atomic_crates');
    await t.db.trial!(async () => {
      await t.core.resources.registry.create('atomic_crate', { name: 'Checked only' }, null);
      expect(await count('atomic_crates')).toBe(before + 1);
    });
    expect(await count('atomic_crates')).toBe(before);
    expect(heard).toEqual([]);
  });
});

describe('linking needs view on the linked record\'s area (E40-13)', () => {
  it('refuses a reference to a record of an area the person may not view, as "not found"; system work is exempt', async () => {
    // A role that may create crates (tickets.create) but, at first, view nothing.
    await t.db.query(`insert into roles (key, name, enabled) values ('atomic_crate_editor', 'Crate editor', true) on conflict do nothing`);
    await t.db.query(`insert into role_permissions (role_id, permission) select id, 'tickets.create' from roles where key = 'atomic_crate_editor'`);
    const editor = await t.as('atomic_crate_editor');
    const parent = (await t.api.post('/api/atomic-crates', { name: 'Parent crate' })).body as Row;
    // Without view on the crates' own area, not even another crate can be linked.
    expect((await editor.post('/api/atomic-crates', { name: 'Linked crate', parent_id: parent.id })).status).toBe(400);
    await t.db.query(`insert into role_permissions (role_id, permission) select id, 'tickets.view' from roles where key = 'atomic_crate_editor'`);
    const viewer = await t.as('atomic_crate_editor');
    expect((await viewer.post('/api/atomic-crates', { name: 'Linked crate', parent_id: parent.id })).status).toBe(201);

    // A reference custom field to another area: tickets.view is not enough to link a site.
    const cf = await t.api.post('/api/admin/custom-fields', { record_type: 'atomic_crate', label: 'Depot', type: 'ref', to: 'site' });
    expect(cf.status, JSON.stringify(cf.body)).toBe(201);
    const site = (await t.api.post('/api/sites', { name: 'Invented Heron Yard' })).body as Row;
    const refused = await viewer.post('/api/atomic-crates', { name: 'Crate at a depot', cf_depot: site.id });
    expect(refused.status).toBe(400);
    expect(refused.body.error.fields).toEqual({ cf_depot: 'Site not found.' });
    const missing = await viewer.post('/api/atomic-crates', { name: 'Crate at a depot', cf_depot: '00000000-0000-4000-8000-000000000000' });
    expect(missing.body.error.fields).toEqual(refused.body.error.fields); // the same answer: nothing is revealed
    // With sites.view it links; system work (no person) is exempt.
    await t.db.query(`insert into role_permissions (role_id, permission) select id, 'sites.view' from roles where key = 'atomic_crate_editor'`);
    expect((await (await t.as('atomic_crate_editor')).post('/api/atomic-crates', { name: 'Crate at a depot', cf_depot: site.id })).status).toBe(201);
    const system = await t.core.resources.registry.create('atomic_crate', { name: 'System crate', cf_depot: site.id }, null as FastifyRequest | null);
    expect(system.custom).toMatchObject({ depot: site.id });
  });
});
