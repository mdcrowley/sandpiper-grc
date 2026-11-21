import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../test/helpers.ts';
import { calendarSources, defineCalendarSource } from './calendar.ts';
import { invalidateFeatures } from './features.ts';
import type { ModuleDef, SessionUser } from './module.ts';

// The calendar source registry (wave 11, contract C3): modules offer dated work to calendar feeds.

const probe: ModuleDef = {
  key: 'calprobe',
  async seedDefaults(ctx) {
    await ctx.db.exec(`create table if not exists cal_probes (
      id uuid primary key default gen_random_uuid(), name text not null, due_on date, owner_id uuid,
      restricted boolean not null default false,
      created_at timestamptz not null default now(), created_by uuid,
      updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
  },
  async register(ctx) {
    // Its permission module is the service desk's, so switching that area off hides it.
    ctx.defineResource({
      type: 'cal_probe', table: 'cal_probes', module: 'tickets', label: 'Probe', plural: 'Probes',
      path: '/api/cal-probes', route: '/cal-probes', titleField: 'name', restricted: 'flag',
      fields: {
        name: { label: 'Name', type: 'text', required: true },
        due_on: { label: 'Due', type: 'date' },
        owner_id: { label: 'Owner', type: 'user' },
        restricted: { label: 'Restricted', type: 'boolean', readOnly: true },
      },
    });
    defineCalendarSource(ctx.app, {
      key: 'probe.due', label: 'My probes due', recordType: 'cal_probe', permission: 'tickets.view',
      async events(c, user, from, to) {
        // The rule every source follows: only what the person may see and is involved in.
        const rows = await c.db.query<{ id: string; name: string; due_on: string }>(
          `select id, name, to_char(due_on, 'YYYY-MM-DD') as due_on from cal_probes
           where deleted_at is null and owner_id = $1 and due_on between $2::date and $3::date
             and ${c.resources.visibleWhere('cal_probe', user)}`, [user.id, from, to]);
        return rows.map((r) => ({
          uid: `probe.due:${r.id}`, title: r.name, start: r.due_on, allDay: true,
          url: `/cal-probes/${r.id}`, recordType: 'cal_probe', recordId: r.id,
        }));
      },
    });
  },
};

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp({ extraModules: [probe] }); });
afterAll(async () => { await t.close(); });

const userWith = (id: string, permissions: string[]): SessionUser => ({
  id, username: 'u', displayName: 'U', email: 'u@example.test', roles: [], permissions,
});

describe('calendar source registry', () => {
  it('refuses a malformed or duplicate key and a malformed permission', () => {
    const base = { label: 'x', recordType: 'cal_probe', permission: 'tickets.view', events: async () => [] };
    expect(() => defineCalendarSource(t.app, { ...base, key: 'Bad key' })).toThrow(/module/);
    expect(() => defineCalendarSource(t.app, { ...base, key: 'probe.due' })).toThrow(/twice/);
    expect(() => defineCalendarSource(t.app, { ...base, key: 'probe.other', permission: 'tickets' })).toThrow(/permission/);
  });

  it('lists a source only to people who hold its permission', () => {
    expect(calendarSources(t.app, t.ctx.resources, userWith('a', ['*'])).map((s) => s.key)).toContain('probe.due');
    expect(calendarSources(t.app, t.ctx.resources, userWith('b', ['safety.view'])).map((s) => s.key)).not.toContain('probe.due');
    expect(calendarSources(t.app, t.ctx.resources, null)).toEqual([]);
  });

  it('gives a person only the visible events they are involved in', async () => {
    const owner = (await t.db.one<{ id: string }>('select id from users order by created_at limit 1'))!.id;
    const mine = await t.ctx.resources.create('cal_probe', { name: 'Mine', due_on: '2026-06-10', owner_id: owner });
    await t.ctx.resources.create('cal_probe', { name: 'Someone else', due_on: '2026-06-10' });
    const secret = await t.ctx.resources.create('cal_probe', { name: 'Restricted', due_on: '2026-06-11', owner_id: owner });
    await t.db.query('update cal_probes set restricted = true where id = $1', [secret.id]);
    const src = calendarSources(t.app, t.ctx.resources, userWith(owner, ['tickets.view'])).find((s) => s.key === 'probe.due')!;
    const plain = await src.events(t.ctx, userWith(owner, ['tickets.view']), '2026-06-01', '2026-06-30');
    expect(plain.map((e) => e.recordId)).toEqual([mine.id]);
    expect(plain[0]).toMatchObject({ uid: `probe.due:${mine.id}`, start: '2026-06-10', allDay: true, url: `/cal-probes/${mine.id}` });
    const cleared = await src.events(t.ctx, userWith(owner, ['tickets.view', 'security.view']), '2026-06-01', '2026-06-30');
    expect(cleared.map((e) => e.recordId).sort()).toEqual([mine.id, secret.id].sort());
  });

  it('leaves out a source whose record type is switched off', async () => {
    const switchTickets = async (on: boolean) => { await t.ctx.settings.set('features', { tickets: on }); invalidateFeatures(t.db); };
    await switchTickets(false);
    try {
      // A request refreshes the cached switch state the registry reads outside a request.
      await t.api.get('/api/auth/state');
      expect(calendarSources(t.app, t.ctx.resources, userWith('a', ['*'])).map((s) => s.key)).not.toContain('probe.due');
    } finally {
      await switchTickets(true);
    }
  });
});
