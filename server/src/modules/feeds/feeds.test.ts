import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { calendarSources } from '../../core/calendar.ts';
import { dayInZone } from '../../core/timezone.ts';
import { ADMIN, testApp } from '../../test/helpers.ts';
import { escapeText, fold, writeCalendar } from './ics.ts';

// Calendar feeds (E36-03): off by default, a secret address per feed that can be replaced and revoked,
// only what the feed's person may see now, restricted records masked, switched-off areas left out.

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let agent: Client;  // actions.* without security.view
let lead: Client;   // security lead: security.view, risks.*
let openAction: string;

const pathOf = (address: string) => new URL(address).pathname;
const fetchFeed = (path: string) => t.app.inject({ method: 'GET', url: path });

beforeAll(async () => {
  process.env.GRC_MODULES = 'feeds,attachments,notifications,risks,admin';
  t = await testApp();
  agent = await t.as('agent');
  lead = await t.as('security_lead');
  const soon = dayInZone(10);
  // The agent's own open action, a done one, someone else's, and one on a restricted risk.
  openAction = (await t.api.post('/api/actions', { title: 'Replace the depot badge readers', owner_id: agent.userId, due_on: soon, status: 'open' })).body.id;
  await t.api.post('/api/actions', { title: 'Finished work', owner_id: agent.userId, due_on: soon, status: 'done' });
  await t.api.post('/api/actions', { title: 'Not the agent\'s', owner_id: lead.userId, due_on: soon, status: 'open' });
  await t.api.post('/api/actions', { title: 'Far in the future', owner_id: agent.userId, due_on: dayInZone(500), status: 'open' });
  const risk = (await t.api.post('/api/risks', { title: 'Secret risk', scale_key: 'cyber_5x5' })).body;
  expect(risk.id).toBeTruthy();
  for (const owner of [agent.userId, lead.userId]) {
    const a = await t.api.post('/api/actions', { title: 'Patch the hidden server', owner_id: owner, due_on: soon, status: 'open', source: 'risk', source_type: 'risk', source_id: risk.id });
    expect(a.body.restricted).toBe(true);
  }
});
afterAll(async () => { await t?.close(); });

describe('calendar feeds', () => {
  it('are off until an administrator switches them on, with a password confirmation', async () => {
    const mine = await agent.get('/api/me/calendar-feeds');
    expect(mine.body.enabled).toBe(false);
    // The menu under the person's name reads this to offer the page only while feeds are on.
    expect((await agent.get('/api/me/calendar-feeds/enabled')).body).toEqual({ enabled: false });
    expect(mine.body.sources.map((s: any) => s.key)).toContain('actions.due');
    expect((await agent.post('/api/me/calendar-feeds', { name: 'Work', sources: ['actions.due'] })).body.error.code).toBe('feeds_off');
    expect((await agent.put('/api/admin/feeds/settings', { calendarEnabled: true })).status).toBe(403);
    await t.db.query(`update sessions set confirmed_at = null where user_id = (select id from users where username = 'admin')`);
    expect((await t.api.put('/api/admin/feeds/settings', { calendarEnabled: true })).body.error.code).toBe('reauth_required');
    expect((await t.api.post('/api/auth/confirm', { password: ADMIN.password })).status).toBe(200);
    expect((await t.api.put('/api/admin/feeds/settings', { calendarEnabled: true })).body.calendarEnabled).toBe(true);
    expect((await agent.get('/api/me/calendar-feeds/enabled')).body).toEqual({ enabled: true });
  });

  it('offers only the sources the person may use, and refuses others', async () => {
    const keys = (await agent.get('/api/me/calendar-feeds')).body.sources.map((s: any) => s.key);
    expect(keys).not.toContain('risks.review'); // the agent has no risks.view
    const r = await agent.post('/api/me/calendar-feeds', { name: 'Work', sources: ['risks.review'] });
    expect(r.status).toBe(400);
    expect(r.body.error.fields.sources).toBeTruthy();
  });

  it('shows the address once and the person\'s own visible work only', async () => {
    const made = await agent.post('/api/me/calendar-feeds', { name: 'Work', sources: ['actions.due'], detail: 'titles' });
    expect(made.status).toBe(201);
    expect(made.body.address).toMatch(/\/api\/calendar\/grc_cal_[A-Za-z0-9_-]{43}\.ics$/);
    const listed = (await agent.get('/api/me/calendar-feeds')).body.feeds;
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain('grc_cal_');
    const stored = await t.db.one<any>('select token_hash from calendar_feeds where id = $1', [made.body.id]);
    expect(stored.token_hash).toMatch(/^[0-9a-f]{64}$/);

    const res = await fetchFeed(pathOf(made.body.address));
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/calendar');
    const ics = res.body;
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('Replace the depot badge readers');
    expect(ics).toContain(`/actions/${openAction}`);
    expect(ics).not.toContain('Finished work');
    expect(ics).not.toContain('Not the agent');
    expect(ics).not.toContain('Far in the future'); // beyond 365 days
    // The restricted action is the agent's own, but the agent may not see restricted records: left out.
    expect(ics).not.toContain('Patch the hidden server');
    expect(ics).not.toContain('Restricted record');
    expect((await t.db.one<any>('select last_used_at from calendar_feeds where id = $1', [made.body.id])).last_used_at).toBeTruthy();
  });

  it('shows restricted records to a security.view holder: titles only when the feed shows titles', async () => {
    const titles = (await lead.post('/api/me/calendar-feeds', { name: 'Titles', sources: ['actions.due'], detail: 'titles' })).body;
    const busy = (await lead.post('/api/me/calendar-feeds', { name: 'Busy', sources: ['actions.due', 'risks.review'], detail: 'busy' })).body;
    const a = (await fetchFeed(pathOf(titles.address))).body;
    expect(a).toContain('Patch the hidden server');
    expect(a).toContain('Not the agent');
    const b = (await fetchFeed(pathOf(busy.address))).body;
    expect(b).not.toContain('Patch the hidden server');
    expect(b).toContain('SUMMARY:Restricted record');
    expect(b).not.toContain('Not the agent'); // busy: no titles at all
    expect(b).toContain('SUMMARY:My actions due');
  });

  it('answers the same 404 for an unknown, revoked or replaced address, a disabled person, and while switched off', async () => {
    const one = (await agent.post('/api/me/calendar-feeds', { name: 'Second', sources: ['actions.due'] })).body;
    const path = pathOf(one.address);
    expect((await fetchFeed(path)).statusCode).toBe(200);
    const unknown = await fetchFeed(`/api/calendar/grc_cal_${'x'.repeat(43)}.ics`);
    expect(unknown.statusCode).toBe(404);
    const malformed = await fetchFeed('/api/calendar/not-a-token.ics');
    expect(malformed.statusCode).toBe(404);

    // Replacing the address: the old one stops at once, the new one works.
    const rotated = (await agent.post(`/api/me/calendar-feeds/${one.id}/rotate`)).body;
    expect((await fetchFeed(path)).body).toBe(unknown.body);
    expect((await fetchFeed(pathOf(rotated.address))).statusCode).toBe(200);

    // Another person cannot revoke it; its owner can.
    expect((await lead.del(`/api/me/calendar-feeds/${one.id}`)).status).toBe(404);
    expect((await agent.del(`/api/me/calendar-feeds/${one.id}`)).status).toBe(200);
    const revoked = await fetchFeed(pathOf(rotated.address));
    expect(revoked.statusCode).toBe(404);
    expect(revoked.body).toBe(unknown.body);

    // A disabled account.
    const other = await t.as('agent');
    const feed = (await other.post('/api/me/calendar-feeds', { name: 'Leaver', sources: ['actions.due'] })).body;
    expect((await fetchFeed(pathOf(feed.address))).statusCode).toBe(200);
    await t.db.query(`update users set status = 'disabled' where id = $1`, [other.userId]);
    const disabled = await fetchFeed(pathOf(feed.address));
    expect(disabled.statusCode).toBe(404);
    expect(disabled.body).toBe(unknown.body);

    // Switched off: every feed answers 404 until switched on again.
    const mine = (await agent.post('/api/me/calendar-feeds', { name: 'Third', sources: ['actions.due'] })).body;
    expect((await t.api.put('/api/admin/feeds/settings', { calendarEnabled: false })).status).toBe(200);
    const off = await fetchFeed(pathOf(mine.address));
    expect(off.statusCode).toBe(404);
    expect(off.body).toBe(unknown.body);
    expect((await t.api.post('/api/auth/confirm', { password: ADMIN.password })).status).toBe(200);
    await t.api.put('/api/admin/feeds/settings', { calendarEnabled: true });
    expect((await fetchFeed(pathOf(mine.address))).statusCode).toBe(200);
  });

  it('lets an administrator list and revoke anyone\'s feeds', async () => {
    const feed = (await agent.post('/api/me/calendar-feeds', { name: 'To revoke', sources: ['actions.due'] })).body;
    const all = (await t.api.get('/api/admin/calendar-feeds')).body.feeds;
    expect(all.some((f: any) => f.id === feed.id && f.user_name)).toBe(true);
    expect((await agent.get('/api/admin/calendar-feeds')).status).toBe(403);
    expect((await t.api.del(`/api/admin/calendar-feeds/${feed.id}`)).status).toBe(200);
    expect((await fetchFeed(pathOf(feed.address))).statusCode).toBe(404);
  });

  it('leaves out the sources of a switched-off area', async () => {
    const feed = (await lead.post('/api/me/calendar-feeds', { name: 'Risks', sources: ['actions.due', 'risks.review'], detail: 'titles' })).body;
    const risk = (await lead.post('/api/risks', { title: 'Reviewed soon', scale_key: 'cyber_5x5', owner_id: lead.userId, review_on: dayInZone(5) })).body;
    expect(risk.id).toBeTruthy();
    expect((await fetchFeed(pathOf(feed.address))).body).toContain('Risk review');
    expect((await t.api.post('/api/auth/confirm', { password: ADMIN.password })).status).toBe(200);
    expect((await t.api.patch('/api/admin/features', { features: { risks: false } })).status).toBe(200);
    try {
      expect((await lead.get('/api/me/calendar-feeds')).body.sources.map((s: any) => s.key)).not.toContain('risks.review');
      const ics = (await fetchFeed(pathOf(feed.address))).body;
      expect(ics).not.toContain('Risk review');
      expect(ics).toContain('Action due'); // actions are always on
    } finally {
      await t.api.post('/api/auth/confirm', { password: ADMIN.password });
      await t.api.patch('/api/admin/features', { features: { risks: true } });
    }
  });

  it('cannot be managed with an API token', async () => {
    await t.api.post('/api/auth/confirm', { password: ADMIN.password });
    const tok = await t.api.post('/api/me/tokens', { name: 'feeds', scopes: ['*'], expiresInDays: 5 });
    expect(tok.body.token).toMatch(/^grc_pat_/);
    const res = await t.app.inject({ method: 'GET', url: '/api/me/calendar-feeds', headers: { authorization: `Bearer ${tok.body.token}` } });
    expect(res.statusCode).toBe(403);
  });

  it('limits how often one address may ask, whatever the token', async () => {
    const feed = (await agent.post('/api/me/calendar-feeds', { name: 'Busy caller', sources: ['actions.due'] })).body;
    await t.db.query(`insert into rate_limit_hits (bucket, key) select 'calendar_feed', '127.0.0.1' from generate_series(1, 120)`);
    try {
      expect((await fetchFeed(pathOf(feed.address))).statusCode).toBe(429);
      expect((await fetchFeed(`/api/calendar/grc_cal_${'y'.repeat(43)}.ics`)).statusCode).toBe(429);
    } finally {
      await t.db.query(`delete from rate_limit_hits where bucket = 'calendar_feed'`);
    }
    expect((await fetchFeed(pathOf(feed.address))).statusCode).toBe(200);
  });

  it('asks for a recent password confirmation to make a feed or replace its address (W17-3)', async () => {
    const person = await t.as('agent');
    const feed = (await person.post('/api/me/calendar-feeds', { name: 'Fresh sign-in', sources: ['actions.due'] })).body;
    expect(feed.address).toBeTruthy();
    await t.db.query('update sessions set confirmed_at = null where user_id = $1', [person.userId]);
    const refused = await person.post('/api/me/calendar-feeds', { name: 'Unattended browser', sources: ['actions.due'] });
    expect([refused.status, refused.body.error.code]).toEqual([403, 'reauth_required']);
    expect((await person.post(`/api/me/calendar-feeds/${feed.id}/rotate`)).body.error.code).toBe('reauth_required');
    // Renaming and revoking only narrow, and need no confirmation.
    expect((await person.patch(`/api/me/calendar-feeds/${feed.id}`, { name: 'Renamed' })).status).toBe(200);
    expect((await person.del(`/api/me/calendar-feeds/${feed.id}`)).status).toBe(200);
  });

  it('are revoked when the person changes their password, audited (W17-3)', async () => {
    const { setPassword } = await import('../../core/auth.ts');
    const person = await t.as('agent');
    await setPassword({ db: t.db } as never, person.userId, 'a long sample passphrase 4');
    const feed = (await person.post('/api/me/calendar-feeds', { name: 'Before the change', sources: ['actions.due'] })).body;
    expect((await fetchFeed(pathOf(feed.address))).statusCode).toBe(200);
    const changed = await person.post('/api/auth/change-password', { currentPassword: 'a long sample passphrase 4', newPassword: 'another sample passphrase 5' });
    expect(changed.status).toBe(200);
    expect(changed.body.revoked.feeds).toBe(1);
    expect((await fetchFeed(pathOf(feed.address))).statusCode).toBe(404);
    const ev = await t.db.one<{ summary: string }>(`select summary from audit_events where action = 'password.change' and record_id = $1`, [person.userId]);
    expect(ev?.summary).toContain('1 calendar feed(s) revoked');
    const { revokeProgramAccess } = await import('../../core/tokens.ts');
    // A second-factor reset or a reset link goes through the same call.
    await t.db.query(`insert into calendar_feeds (user_id, name, token_hash) values ($1, 'After', $2)`, [person.userId, 'f'.repeat(64)]);
    expect((await revokeProgramAccess(t.db, person.userId, null, 'second factor reset')).feeds).toBe(1);
  });

  it('never makes a feed address from a Host header that is not this machine (W17-7)', async () => {
    const { createSession, SESSION_COOKIE } = await import('../../core/auth.ts');
    const person = await t.as('agent');
    const cookie = `${SESSION_COOKIE}=${await createSession(t.db, person.userId)}`;
    const make = (host: string) => t.app.inject({
      method: 'POST', url: '/api/me/calendar-feeds', headers: { host, cookie, 'x-grc-csrf': '1' },
      payload: { name: `From ${host}`, sources: ['actions.due'] },
    });
    const refused = await make('evil.example');
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('public_url_required');
    expect((await t.db.query('select 1 from calendar_feeds where user_id = $1', [person.userId])).length).toBe(0);
    expect(new URL((await make('localhost:8080')).json().address).host).toBe('localhost:8080');
    await t.db.query(`insert into settings (key, value) values ('auth.public_url', '"https://grc.example.org"') on conflict (key) do update set value = excluded.value`);
    try {
      expect((await make('evil.example')).json().address).toMatch(/^https:\/\/grc\.example\.org\/api\/calendar\/grc_cal_/);
    } finally {
      await t.db.query(`delete from settings where key = 'auth.public_url'`);
    }
  });

  it('registers the existing modules\' sources by permission', async () => {
    const admin = { id: 'x', username: 'a', displayName: 'A', email: '', roles: [], permissions: ['*'], off: [] };
    const keys = calendarSources(t.app, t.ctx.resources, admin as never).map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(['actions.due', 'obligations.due', 'risks.review']));
    // Modules that are not loaded in this test leave their sources out.
    expect(keys).not.toContain('governance.meetings');
  });
});

describe('ICS writer', () => {
  it('escapes text and folds long lines', () => {
    expect(escapeText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    const long = `SUMMARY:${'é'.repeat(80)}`;
    const folded = fold(long);
    for (const line of folded.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, '')).toBe(long);
    const cal = writeCalendar({
      name: 'Test', prodId: '-//x//y//EN', now: new Date('2026-11-21T10:00:00Z'),
      events: [
        { uid: 'a@x', title: 'Day', start: '2026-11-25', allDay: true },
        { uid: 'b@x', title: 'Timed', start: '2026-11-25T14:00:00.000Z', end: '2026-11-25T15:00:00.000Z', allDay: false, url: 'https://grc.example.test/x' },
      ],
    });
    expect(cal).toContain('DTSTART;VALUE=DATE:20261125\r\nDTEND;VALUE=DATE:20261126');
    expect(cal).toContain('DTSTART:20261125T140000Z\r\nDTEND:20261125T150000Z');
    expect(cal.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
});
