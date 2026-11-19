import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { runHousekeeping } from './housekeeping.ts';

// Notification housekeeping (E14-17), `once` keys and the reminder settings page.
// Uses only the notifications module and routes that are not about records, so it runs with
// GRC_MODULES=notifications as well as with every module.
let t: Awaited<ReturnType<typeof testApp>>;
let adminId: string;
beforeAll(async () => {
  t = await testApp();
  adminId = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
});
afterAll(async () => { await t.close(); });

const send = (title: string, extra: Record<string, unknown> = {}) =>
  t.app.notify({ userIds: [adminId], kind: 'general', title, route: '/notifications', ...extra });
const titles = async () => (await t.api.get('/api/notifications?pageSize=100')).body.rows.map((r: any) => r.title);

describe('deleting notifications', () => {
  it('deletes one, and all read ones, for the owner only', async () => {
    await send('Housekeeping one');
    await send('Housekeeping two');
    await send('Housekeeping three');
    const rows = (await t.api.get('/api/notifications?pageSize=100')).body.rows;
    const one = rows.find((r: any) => r.title === 'Housekeeping one');
    const two = rows.find((r: any) => r.title === 'Housekeeping two');

    // Someone else cannot delete it: "not found".
    const other = await t.as('agent');
    expect((await other.del(`/api/notifications/${one.id}`)).status).toBe(404);
    expect((await t.api.del('/api/notifications/not-a-uuid')).status).toBe(404);

    const del = await t.api.del(`/api/notifications/${one.id}`);
    expect(del.status).toBe(200);
    expect(await titles()).not.toContain('Housekeeping one');
    expect((await t.api.del(`/api/notifications/${one.id}`)).status).toBe(404);

    await t.api.post(`/api/notifications/${two.id}/read`);
    const cleared = await t.api.post('/api/notifications/delete-read');
    expect(cleared.body.deleted).toBeGreaterThanOrEqual(1);
    const left = await titles();
    expect(left).not.toContain('Housekeeping two');
    expect(left).toContain('Housekeeping three');
  });

  it('still counts a deleted notification for reminders sent once a day', async () => {
    expect((await send('Daily thing', { oncePerDay: true })).sent).toBe(1);
    const row = (await t.api.get('/api/notifications?pageSize=100')).body.rows.find((r: any) => r.title === 'Daily thing');
    await t.api.del(`/api/notifications/${row.id}`);
    expect((await send('Daily thing', { oncePerDay: true })).sent).toBe(0);
  });
});

describe('reminders sent once', () => {
  it('sends a once key to each person one time only, even after the notification is deleted', async () => {
    expect((await send('Due soon: once', { once: 'test.once:1' })).sent).toBe(1);
    expect((await send('Due soon: once', { once: 'test.once:1' })).sent).toBe(0);
    await t.db.query(`delete from notifications where title = 'Due soon: once'`);
    expect((await send('Due soon: once', { once: 'test.once:1' })).sent).toBe(0);
    // A different occasion is a different key.
    expect((await send('Due soon: once', { once: 'test.once:2' })).sent).toBe(1);
  });

  it('does not record someone who was not told (muted), so a later run can tell them', async () => {
    await t.api.patch('/api/notifications/preferences', { kinds: { reminder: false } });
    expect((await send('Muted reminder', { kind: 'reminder', once: 'test.once:muted' })).sent).toBe(0);
    await t.api.patch('/api/notifications/preferences', { kinds: { reminder: true } });
    expect((await send('Muted reminder', { kind: 'reminder', once: 'test.once:muted' })).sent).toBe(1);
  });
});

describe('housekeeping job', () => {
  it('removes old read and deleted notifications, keeps unread ones, and is scheduled', async () => {
    await send('Old read');
    await send('Old unread');
    await send('Old deleted');
    await send('Old digest');
    await t.db.query(`update notifications set created_at = now() - interval '200 days' where title like 'Old %'`);
    await t.db.query(`update notifications set read_at = now() where title in ('Old read', 'Old digest')`);
    await t.db.query(`update notifications set email_state = 'digest' where title = 'Old digest'`);
    await t.db.query(`update notifications set dismissed_at = now() - interval '3 days', read_at = now() where title = 'Old deleted'`);
    await t.db.query(`insert into notification_once (user_id, once_key, created_at) values ($1, 'ancient', now() - interval '500 days')`, [adminId]);

    const r = await runHousekeeping(t.ctx);
    expect(r).toMatchObject({ keepReadDays: 90 });
    expect(r.read).toBeGreaterThanOrEqual(1);
    expect(r.deleted).toBeGreaterThanOrEqual(1);
    expect(r.once).toBeGreaterThanOrEqual(1);
    const left = (await t.db.query<{ title: string }>(`select title from notifications where title like 'Old %'`)).map((x) => x.title).sort();
    expect(left).toEqual(['Old digest', 'Old unread']);

    expect(await t.db.one(`select every_seconds from job_schedules where name = 'notifications.housekeeping'`)).toEqual({ every_seconds: 86400 });
    expect(t.app.jobs.types()).toContain('notifications.housekeeping');
  });
});

describe('notification kinds added by an administrator', () => {
  it('appear in everyone’s preferences', async () => {
    const added = await t.api.post('/api/lookups', { list_key: 'notification_kind', value: 'depot_notice', label: 'Depot notices', sort: 95 });
    expect(added.status).toBe(201);
    const agent = await t.as('agent');
    const prefs = await agent.get('/api/notifications/preferences');
    expect(prefs.body.kinds.find((k: any) => k.value === 'depot_notice')).toMatchObject({ label: 'Depot notices', enabled: true, channel: 'app' });
    expect((await agent.patch('/api/notifications/preferences', { kinds: { depot_notice: false } })).status).toBe(200);
  });
});

describe('reminder settings page', () => {
  it('lists the settings of loaded modules, validates and audits changes, administrators only', async () => {
    const agent = await t.as('agent');
    expect((await agent.get('/api/notifications/reminder-settings')).status).toBe(403);

    const got = await t.api.get('/api/notifications/reminder-settings');
    expect(got.status).toBe(200);
    const all = got.body.groups.flatMap((g: any) => g.settings);
    const keep = all.find((s: any) => s.key === 'notifications.keep_read_days');
    expect(keep).toMatchObject({ kind: 'number', value: 90, default: 90, min: 7, max: 730 });
    // A setting about a record type that is not loaded is not offered.
    for (const s of all) if (s.key === 'safety.hazard_review_reminder_days') expect(t.ctx.resources.get('hazard')).toBeTruthy();

    const bad = await t.api.patch('/api/notifications/reminder-settings', { values: { 'notifications.keep_read_days': 2, 'nothing.here': 1 } });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['nothing.here', 'notifications.keep_read_days']);

    const ok = await t.api.patch('/api/notifications/reminder-settings', { values: { 'notifications.keep_read_days': 30, 'notifications.digest_hour': 7 } });
    expect(ok.status).toBe(200);
    expect(ok.body.groups.flatMap((g: any) => g.settings).find((s: any) => s.key === 'notifications.keep_read_days').value).toBe(30);
    const audits = await t.db.query<{ record_id: string }>(`select record_id from audit_events where action = 'setting.change' and record_id like 'notifications.%'`);
    // Only the value that changed is written (the digest hour was already 7).
    expect(audits.map((a) => a.record_id)).toEqual(['notifications.keep_read_days']);
    expect((await runHousekeeping(t.ctx)).keepReadDays).toBe(30);
  });

  it('keeps reminder steps as a sorted list without repeats', async () => {
    if (!t.ctx.resources.get('asset')) return; // inventory not loaded
    const res = await t.api.patch('/api/notifications/reminder-settings', { values: { 'inventory.reminder_days': [7, 60, 7, 0] } });
    expect(res.status).toBe(200);
    expect(await t.ctx.settings.get('inventory.reminder_days', null)).toEqual([60, 7, 0]);
    expect((await t.api.patch('/api/notifications/reminder-settings', { values: { 'inventory.reminder_days': [] } })).status).toBe(400);
    expect((await t.api.patch('/api/notifications/reminder-settings', { values: { 'inventory.reminder_days': [400] } })).status).toBe(400);
  });
});
