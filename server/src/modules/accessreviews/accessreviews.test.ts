import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadUser } from '../../core/auth.ts';
import { calendarSources, checkedEvents } from '../../core/calendar.ts';
import { AREAS } from '../../core/features.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { columnsOf, matchHolder } from './accounts.ts';
import { runReminders } from './overview.ts';

// User access reviews (E41-02): the account register with holders matched to the staff roster and
// leavers flagged, imports per system, campaigns with decisions by the named reviewer, removals tracked
// to done, the finished campaign recorded as a control test, and the feature switch.
let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let agent: Client;      // systems.* (sets campaigns up)
let reviewer: Client;   // training coordinator: people.*, no systems permission; owns the system
let outsider: Client;   // project manager: systems.view only
let auditor: Client;    // audit lead: controls.*, no systems permission
let systemId = '';
let otherSystemId = '';
const people: Record<string, string> = {};
const accounts: Record<string, string> = {};

const setFeatures = (features: Record<string, boolean>) => t.api.patch('/api/admin/features', { features });
const notes = async (userId: string) => (await t.db.query<{ title: string; kind: string }>('select title, kind from notifications where user_id = $1', [userId]));

beforeAll(async () => {
  process.env.GRC_MODULES = 'admin,inventory,people,accessreviews,controls,risks,notifications,feeds,work';
  t = await testApp();
  agent = await t.as('agent');
  reviewer = await t.as('training_coordinator');
  outsider = await t.as('project_manager');
  auditor = await t.as('audit_lead');
  systemId = (await t.api.post('/api/systems', { name: 'Invented dispatch system', business_owner_id: reviewer.userId, technical_owner_id: agent.userId })).body.id;
  otherSystemId = (await t.api.post('/api/systems', { name: 'Invented timekeeping system', technical_owner_id: agent.userId })).body.id;
  const person = async (key: string, data: Record<string, unknown>) => {
    const res = await t.api.post('/api/people', data);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    people[key] = res.body.id;
  };
  await person('active', { full_name: 'Invented Avery Lane', employee_number: 'E-100', email: 'avery.lane@example.test' });
  await person('leaving', { full_name: 'Invented Blake Moss', employee_number: 'E-200' });
  await person('leave', { full_name: 'Invented Casey Rowe', employee_number: 'E-300', status: 'on_leave' });
  await person('emailOnly', { full_name: 'Invented Drew Hale', email: 'drew.hale@example.test' });
  // The reviewer is on the roster too (linked to their account by email).
  await person('reviewer', { full_name: 'Invented Reviewer Person', email: `${(await t.db.one<{ email: string }>('select email from users where id = $1', [reviewer.userId]))!.email}` });
}, 60_000);
afterAll(async () => { await t?.close(); delete process.env.GRC_MODULES; });

describe('the account register', () => {
  it('matches holders to the roster by employee number, email and name, and flags leave and unknown holders', async () => {
    const make = async (key: string, data: Record<string, unknown>) => {
      const res = await agent.post('/api/system-accounts', { system_id: systemId, ...data });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      accounts[key] = res.body.id;
      return res.body;
    };
    const a = await make('active', { account_name: 'alane', employee_number: 'E-100', role_on_system: 'Dispatcher' });
    expect(a).toMatchObject({ holder_person_id: people.active, match_method: 'employee_number', attention: null });
    expect(a.ref).toMatch(/^ACC-\d{5}$/);
    expect(await make('leaving', { account_name: 'bmoss', employee_number: 'E-200', privileged: true })).toMatchObject({ holder_person_id: people.leaving, attention: null });
    expect(await make('leave', { account_name: 'crowe', display_name: 'Invented Casey Rowe' })).toMatchObject({ holder_person_id: people.leave, match_method: 'name', attention: 'on_leave' });
    expect(await make('email', { account_name: 'drew.hale@example.test' })).toMatchObject({ holder_person_id: people.emailOnly, match_method: 'email' });
    expect(await make('unknown', { account_name: 'zz-unknown', display_name: 'Nobody we know' })).toMatchObject({ holder_person_id: null, attention: 'unmatched' });
    expect(await make('service', { account_name: 'svc-interface', account_kind: 'service' })).toMatchObject({ attention: null });
    expect(await make('own', { account_name: 'reviewer1', email: (await t.db.one<{ email: string }>('select email from users where id = $1', [reviewer.userId]))!.email }))
      .toMatchObject({ holder_person_id: people.reviewer });
    // One account name per system, whatever the case.
    const dup = await agent.post('/api/system-accounts', { system_id: systemId, account_name: 'ALANE' });
    expect(dup.status).toBe(400);
    expect(dup.body.error.fields.account_name).toMatch(/already/);
  });

  it('keeps a holder chosen by hand', async () => {
    const res = await t.api.patch(`/api/system-accounts/${accounts.unknown}`, { holder_person_id: people.active });
    expect(res.body).toMatchObject({ holder_person_id: people.active, match_method: 'manual', attention: null });
    const again = await t.api.patch(`/api/system-accounts/${accounts.unknown}`, { display_name: 'Invented Casey Rowe' });
    expect(again.body.holder_person_id).toBe(people.active);
    await t.api.patch(`/api/system-accounts/${accounts.unknown}`, { holder_person_id: null });
  });

  it('flags the accounts of a person who leaves, and tells the system owners once', async () => {
    expect((await t.api.patch(`/api/people/${people.leaving}`, { status: 'left' })).status).toBe(200);
    const acc = await t.api.get(`/api/system-accounts/${accounts.leaving}`);
    expect(acc.body.attention).toBe('leaver');
    const told = (await notes(agent.userId)).filter((n) => n.kind === 'access_review' && /has left/.test(n.title));
    expect(told).toHaveLength(1);
    const summary = await outsider.get('/api/access-reviews/summary');
    expect(summary.status).toBe(200);
    expect(summary.body.accounts).toMatchObject({ leavers: 1, onLeave: 1, privileged: 1 });
  });

  it('finds the columns of a system export by their headers', () => {
    const cols = columnsOf(['User Name', 'Full name', 'E-mail', 'Groups', 'Last Logon', 'Enabled']);
    expect(cols).toMatchObject({ account_name: 0, display_name: 1, email: 2, role_on_system: 3, last_seen_on: 4, status: 5 });
  });

  it('matches nobody when two people share a name', async () => {
    await t.api.post('/api/people', { full_name: 'Invented Twin Name' });
    await t.api.post('/api/people', { full_name: 'Invented Twin Name' });
    expect(await matchHolder(t.ctx, { display_name: 'Invented Twin Name' })).toBeNull();
  });
});

describe('importing a system\'s accounts', () => {
  const csv = [
    'Username,Full name,E-mail,Role,Last login,Enabled',
    'alane,Invented Avery Lane,,Supervisor,2026-01-15,yes',
    'newperson,Invented New Starter,,User,,yes',
    'drew.hale@example.test,,,User,15/01/2026,no',
    ',missing name,,,,',
  ].join('\n');

  it('reports what would change on a dry run and changes nothing', async () => {
    const res = await agent.post('/api/system-accounts/import', { system_id: otherSystemId, text: csv, dryRun: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ dryRun: true, created: 3, updated: 0, missing: 0 });
    expect(res.body.errors).toHaveLength(1);
    expect((await t.db.query('select 1 from system_accounts where system_id = $1', [otherSystemId]))).toHaveLength(0);
  });

  it('creates, updates and marks missing accounts removed', async () => {
    const first = await agent.post('/api/system-accounts/import', { system_id: otherSystemId, text: csv });
    expect(first.body).toMatchObject({ created: 3 });
    const rows = await t.db.query<any>('select account_name, status, source, holder_person_id, last_seen_on::text as seen, role_on_system from system_accounts where system_id = $1 order by account_name', [otherSystemId]);
    expect(rows.find((r) => r.account_name === 'alane')).toMatchObject({ source: 'import', holder_person_id: people.active, seen: '2026-01-15', role_on_system: 'Supervisor' });
    expect(rows.find((r) => r.account_name === 'drew.hale@example.test')).toMatchObject({ status: 'disabled', seen: '2026-01-15' });
    const second = await agent.post('/api/system-accounts/import', { system_id: otherSystemId, text: 'Username,Role\nalane,Dispatcher\n' });
    expect(second.body).toMatchObject({ created: 0, updated: 1, missing: 2 });
    const gone = await t.db.one<any>(`select status, removed_on from system_accounts where system_id = $1 and account_name = 'newperson'`, [otherSystemId]);
    expect(gone.status).toBe('removed');
    expect(gone.removed_on).toBeTruthy();
    // Needs systems.edit.
    expect((await outsider.post('/api/system-accounts/import', { system_id: otherSystemId, text: csv })).status).toBe(403);
    expect((await agent.post('/api/system-accounts/import', { system_id: otherSystemId, text: 'Full name\nSomeone\n' })).body.error.code).toBe('bad_file');
  });
});

describe('a review campaign', () => {
  let review = '';
  let items: any[] = [];

  it('is set up and launched by someone who may edit systems', async () => {
    const res = await agent.post('/api/access-reviews', { title: 'Invented quarterly review', due_on: '2099-01-31', removal_days: 10 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ status: 'draft', owner_id: agent.userId });
    expect(res.body.ref).toMatch(/^UAR-\d{5}$/);
    review = res.body.id;
    expect((await agent.post(`/api/access-reviews/${review}/launch`)).body.error.code).toBe('no_systems');
    const added = await agent.post(`/api/access-reviews/${review}/systems`, { system_ids: [systemId, otherSystemId] });
    expect(added.status).toBe(201);
    expect(added.body.find((s: any) => s.system_id === systemId).reviewer_id).toBe(reviewer.userId);
    // The other system has no business owner: its technical owner reviews it.
    expect(added.body.find((s: any) => s.system_id === otherSystemId).reviewer_id).toBe(agent.userId);
    expect((await outsider.post(`/api/access-reviews/${review}/launch`)).status).toBe(403);
    const launched = await agent.post(`/api/access-reviews/${review}/launch`);
    expect(launched.status, JSON.stringify(launched.body)).toBe(200);
    expect(launched.body.accounts).toBe(8); // 7 active on the first system, 1 on the other
    expect(launched.body.review.status).toBe('in_progress');
    expect((await notes(reviewer.userId)).some((n) => /Review the accounts on Invented dispatch system/.test(n.title))).toBe(true);
  });

  it('shows the reviewer their system even without the systems permission, and nobody else', async () => {
    const mine = await reviewer.get('/api/access-reviews/mine');
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0]).toMatchObject({ system_id: systemId, total: 7, decided: 0 });
    const res = await reviewer.get(`/api/access-reviews/${review}/systems/${systemId}/items`);
    expect(res.status).toBe(200);
    items = res.body.items;
    expect(items[0].attention_now).toBe('leaver'); // flagged accounts first
    expect(items.find((i: any) => i.account_name === 'reviewer1')).toMatchObject({ own: true, mayDecide: false });
    expect((await reviewer.get(`/api/access-reviews/${review}/systems/${otherSystemId}/items`)).status).toBe(404);
    const stranger = await t.as('requester');
    expect((await stranger.get(`/api/access-reviews/${review}/systems/${systemId}/items`)).status).toBe(404);
    expect((await reviewer.get(`/api/access-reviews/${review}`)).status).toBe(403);
  });

  it('lets only the named reviewer decide, with a reason to keep a leaver, and never on their own account', async () => {
    const id = (name: string) => items.find((i: any) => i.account_name === name).id;
    expect((await agent.post(`/api/access-reviews/${review}/decisions`, { items: [id('alane')], decision: 'keep' })).status).toBe(403);
    const leaver = await reviewer.post(`/api/access-reviews/${review}/decisions`, { items: [id('bmoss')], decision: 'keep' });
    expect(leaver.status).toBe(400);
    expect(leaver.body.error.fields.comment).toMatch(/left/);
    const own = await reviewer.post(`/api/access-reviews/${review}/decisions`, { items: [id('reviewer1')], decision: 'keep' });
    expect(own.body.error.code).toBe('own_account');
    expect((await reviewer.post(`/api/access-reviews/${review}/decisions`, { items: [id('alane'), id('drew.hale@example.test'), id('svc-interface'), id('crowe')], decision: 'keep' })).body.saved).toBe(4);
    expect((await reviewer.post(`/api/access-reviews/${review}/decisions`, { items: [id('bmoss'), id('zz-unknown')], decision: 'remove', comment: 'No longer needed' })).body.saved).toBe(2);
    // Sign-off waits for every decision; the campaign owner decides on the reviewer's own account.
    expect((await reviewer.post(`/api/access-reviews/${review}/systems/${systemId}/sign-off`)).body.error.code).toBe('undecided');
    expect((await agent.post(`/api/access-reviews/${review}/decisions`, { items: [id('reviewer1')], decision: 'keep' })).body.saved).toBe(1);
    expect((await agent.post(`/api/access-reviews/${review}/systems/${systemId}/sign-off`)).status).toBe(403);
    const signed = await reviewer.post(`/api/access-reviews/${review}/systems/${systemId}/sign-off`);
    expect(signed.status, JSON.stringify(signed.body)).toBe(200);
    expect(signed.body.removals).toBe(2);
    expect((await reviewer.post(`/api/access-reviews/${review}/decisions`, { items: [id('alane')], decision: 'remove' })).body.error.code).toBe('signed_off');
  });

  it('tracks removals to done: by hand, through the action, and through the next import', async () => {
    const removals = (await agent.get(`/api/access-reviews/${review}/removals`)).body;
    expect(removals).toHaveLength(2);
    const bmoss = removals.find((r: any) => r.account_name === 'bmoss');
    const unknown = removals.find((r: any) => r.account_name === 'zz-unknown');
    expect(bmoss).toMatchObject({ removal_status: 'pending' });
    expect(bmoss.action_id).toBeTruthy();
    const action = await t.api.get(`/api/actions/${bmoss.action_id}`);
    expect(action.body).toMatchObject({ source: 'access_review', source_type: 'access_review', source_id: review, owner_id: agent.userId, priority: 'high' });
    expect((await outsider.post(`/api/access-reviews/${review}/items/${bmoss.id}/removed`, {})).status).toBe(403);
    expect((await reviewer.post(`/api/access-reviews/${review}/items/${bmoss.id}/removed`, { note: 'Disabled in the admin console' })).status).toBe(200);
    expect((await t.api.get(`/api/system-accounts/${accounts.leaving}`)).body).toMatchObject({ status: 'removed', attention: null });
    expect((await t.api.get(`/api/actions/${bmoss.action_id}`)).body.status).toBe('done');
    // Finishing the action finishes the removal.
    expect((await t.api.patch(`/api/actions/${unknown.action_id}`, { status: 'done' })).status).toBe(200);
    const after = (await agent.get(`/api/access-reviews/${review}/removals`)).body;
    expect(after.every((r: any) => r.removal_status === 'done')).toBe(true);
  });

  it('completes once every system is signed off, and is recorded as a control test', async () => {
    expect((await agent.post(`/api/access-reviews/${review}/complete`)).body.error.code).toBe('not_signed_off');
    const other = (await agent.get(`/api/access-reviews/${review}/systems/${otherSystemId}/items`)).body.items;
    await agent.post(`/api/access-reviews/${review}/decisions`, { items: other.map((i: any) => i.id), decision: 'keep' });
    expect((await agent.post(`/api/access-reviews/${review}/systems/${otherSystemId}/sign-off`)).status).toBe(200);
    expect((await notes(agent.userId)).some((n) => /signed off/.test(n.title))).toBe(true);
    const done = await agent.post(`/api/access-reviews/${review}/complete`);
    expect(done.status).toBe(200);
    expect(done.body.totals).toMatchObject({ accounts: 8, kept: 6, removals: 2, removed: 2, systems: 2 });
    expect((await agent.patch(`/api/access-reviews/${review}`, { title: 'Changed' })).status).toBe(409);

    const control = await t.api.post('/api/controls', { title: 'Invented user access is reviewed every quarter' });
    expect(control.status, JSON.stringify(control.body)).toBe(201);
    // Recording needs controls.create; the audit lead also needs to see the review (systems.view).
    expect((await agent.post(`/api/access-reviews/${review}/control-test`, { control_id: control.body.id })).status).toBe(403);
    expect((await auditor.post(`/api/access-reviews/${review}/control-test`, { control_id: control.body.id })).status).toBe(404);
    const rec = await t.api.post(`/api/access-reviews/${review}/control-test`, { control_id: control.body.id });
    expect(rec.status, JSON.stringify(rec.body)).toBe(201);
    expect(rec.body.test).toMatchObject({ control_id: control.body.id, test_type: 'operating', status: 'complete', sample_size: 8, exceptions_found: 2, result: 'partly_effective' });
    expect(rec.body.test.conclusion).toMatch(/8 accounts on 2 systems/);
    expect((await t.api.get(`/api/access-reviews/${review}`)).body.control_test_id).toBe(rec.body.test.id);
    expect((await t.api.post(`/api/access-reviews/${review}/control-test`, { control_id: control.body.id })).body.error.code).toBe('recorded');
    const links = await t.api.get(`/api/links?record_type=control_test&record_id=${rec.body.test.id}`);
    expect(links.body.some((l: any) => l.type === 'access_review' && l.recordId === review)).toBe(true);
  });

  it('exports the decision file for people who may export systems', async () => {
    const res = await agent.get(`/api/access-reviews/${review}/export`);
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Decision/);
    expect(res.text).toMatch(/bmoss/);
    expect((await outsider.get(`/api/access-reviews/${review}/export`)).status).toBe(403);
  });

  it('confirms a pending removal when the account is missing from the next import', async () => {
    const r2 = (await agent.post('/api/access-reviews', { title: 'Invented follow-up review', due_on: '2099-02-28' })).body.id;
    await agent.post(`/api/access-reviews/${r2}/systems`, { system_id: otherSystemId });
    await agent.post(`/api/access-reviews/${r2}/launch`);
    const list = (await agent.get(`/api/access-reviews/${r2}/systems/${otherSystemId}/items`)).body.items;
    await agent.post(`/api/access-reviews/${r2}/decisions`, { items: list.map((i: any) => i.id), decision: 'remove' });
    await agent.post(`/api/access-reviews/${r2}/systems/${otherSystemId}/sign-off`);
    const res = await agent.post('/api/system-accounts/import', { system_id: otherSystemId, text: 'Username\nsomeone-else\n' });
    expect(res.body.removedConfirmed).toBe(1);
    expect((await agent.get(`/api/access-reviews/${r2}/removals`)).body[0]).toMatchObject({ removal_status: 'done', removal_note: "No longer in the system's account file" });
  });
});

describe('reminders, calendar and the switch', () => {
  it('reminds reviewers when a review is due and lists it on their calendar', async () => {
    const r = (await agent.post('/api/access-reviews', { title: 'Invented review due soon', due_on: dayInZone(), remind_days_before: 5 })).body.id;
    await agent.post(`/api/access-reviews/${r}/systems`, { system_id: systemId });
    await agent.post(`/api/access-reviews/${r}/launch`);
    const run = await runReminders(t.ctx);
    expect(run.reviewers).toBeGreaterThanOrEqual(1);
    const sources = calendarSources(t.app, t.ctx.resources, { id: reviewer.userId, permissions: ['systems.view'] } as any);
    expect(sources.map((s) => s.key)).toContain('accessreviews.decisions');
  });

  it('puts the reviewer\'s system in their My work, compliance calendar and calendar feed without systems.view, and nobody else\'s', async () => {
    const mine = (await reviewer.get('/api/access-reviews/mine')).body.find((m: any) => m.title === 'Invented review due soon');
    const review = mine.review_id;
    const ref = (await t.api.get(`/api/access-reviews/${review}`)).body.ref;
    const page = (await reviewer.get(`/api/access-reviews/${review}/systems/${systemId}/items`)).body;
    const open = page.items.filter((i: any) => i.mayDecide && !i.decision).length;
    expect(open).toBeGreaterThan(0);
    const title = `Access review ${ref}: Invented dispatch system, ${open} account${open === 1 ? '' : 's'} to decide`;
    const url = `/access-reviews/${review}/systems/${systemId}`;
    // The reviewer holds no systems permission.
    expect((await reviewer.get('/api/system-accounts')).status).toBe(403);
    const work = await reviewer.get('/api/work/mine');
    expect(work.status).toBe(200);
    const section = work.body.sections.find((s: any) => s.key === 'accessreviews.decisions');
    expect(section, JSON.stringify(work.body)).toBeTruthy();
    expect(section.items.find((i: any) => i.recordId === review)).toMatchObject({ title, url, kind: 'Access reviews', area: 'accessreviews', personId: reviewer.userId });
    const day = dayInZone();
    const cal = await reviewer.get(`/api/work/calendar?from=${day}&to=${day}`);
    expect(cal.body.items.some((i: any) => i.title === title && i.url === url)).toBe(true);
    // The calendar feed offers the source and its checked events keep the item.
    expect((await reviewer.get('/api/me/calendar-feeds')).body.sources.map((s: any) => s.key)).toContain('accessreviews.decisions');
    const user = (await loadUser(t.db, reviewer.userId))!;
    const events = await checkedEvents(t.ctx, user, calendarSources(t.app, t.ctx.resources, user), day, day);
    expect(events.filter((e) => e.source.key === 'accessreviews.decisions').map((e) => e.event.title)).toEqual([title]);
    // Someone who may view systems but reviews nothing gets none of it, nor anything through another person's calendar.
    const other = await outsider.get('/api/work/mine');
    expect(other.body.sections.some((s: any) => s.key === 'accessreviews.decisions')).toBe(false);
    const theirs = await outsider.get(`/api/work/calendar?from=${day}&to=${day}&person=${reviewer.userId}`);
    expect(theirs.body.items.some((i: any) => i.source === 'accessreviews.decisions')).toBe(false);
    // Signed off: gone.
    const left = page.items.filter((i: any) => i.mayDecide && !i.decision).map((i: any) => i.id);
    await reviewer.post(`/api/access-reviews/${review}/decisions`, { items: left, decision: 'keep' });
    const ownItem = page.items.find((i: any) => i.own);
    if (ownItem) await agent.post(`/api/access-reviews/${review}/decisions`, { items: [ownItem.id], decision: 'keep' });
    const ready = await reviewer.get('/api/work/mine');
    expect(ready.body.sections.find((s: any) => s.key === 'accessreviews.decisions').items[0].title).toBe(`Access review ${ref}: Invented dispatch system, ready to sign off`);
    expect((await reviewer.post(`/api/access-reviews/${review}/systems/${systemId}/sign-off`)).status).toBe(200);
    expect((await reviewer.get('/api/work/mine')).body.sections.some((s: any) => s.key === 'accessreviews.decisions')).toBe(false);
  });

  it('hides everything while the area is off', async () => {
    expect(AREAS.find((a) => a.key === 'accessreviews')).toBeTruthy();
    const running = (await agent.post('/api/access-reviews', { title: 'Invented review before the switch', due_on: dayInZone() })).body.id;
    await agent.post(`/api/access-reviews/${running}/systems`, { system_id: systemId });
    expect((await agent.post(`/api/access-reviews/${running}/launch`)).status).toBe(200);
    expect((await reviewer.get('/api/work/mine')).body.sections.some((s: any) => s.area === 'accessreviews')).toBe(true);
    expect((await setFeatures({ accessreviews: false })).status).toBe(200);
    try {
      const res = await t.api.get('/api/access-reviews/summary');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('switched_off');
      expect((await t.api.get('/api/system-accounts')).body.error.code).toBe('switched_off');
      const meta = await t.api.get('/api/meta');
      expect(meta.body.resources.system_account).toBeUndefined();
      expect(meta.body.resources.access_review).toBeUndefined();
      expect(meta.body.lookups.system_account_attention).toBeUndefined();
      expect((meta.body.lookups.action_source ?? []).some((v: any) => v.value === 'access_review')).toBe(false);
      // A running review's reviewer finds nothing of it in My work, the calendar or the feed's sources.
      expect((await reviewer.get('/api/work/mine')).body.sections.some((s: any) => s.area === 'accessreviews')).toBe(false);
      const day = dayInZone();
      expect((await reviewer.get(`/api/work/calendar?from=${day}&to=${day}`)).body.kinds.some((k: any) => k.key === 'accessreviews.decisions')).toBe(false);
      expect((await reviewer.get('/api/me/calendar-feeds')).body.sources.map((s: any) => s.key)).not.toContain('accessreviews.decisions');
    } finally {
      await setFeatures({ accessreviews: true });
    }
  });
});

describe('the reviewer\'s own account without a roster link (wave 23 A5)', () => {
  it('is recognized by its name or email on the system, so the campaign owner decides on it', async () => {
    const me = (await t.db.one<{ username: string; email: string }>('select username, email from users where id = $1', [auditor.userId]))!;
    const sys = (await t.api.post('/api/systems', { name: 'Invented crew scheduling system', business_owner_id: auditor.userId })).body.id;
    const make = async (data: Record<string, unknown>) => {
      const res = await agent.post('/api/system-accounts', { system_id: sys, ...data });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.holder_person_id).toBeNull(); // the roster does not know these
    };
    await make({ account_name: me.username.toUpperCase() });
    await make({ account_name: 'crew-admin-7', email: me.email.toUpperCase() });
    await make({ account_name: 'crew-planner-2', display_name: 'Nobody we know either' });
    const review = (await agent.post('/api/access-reviews', { title: 'Invented crew system review', due_on: '2099-03-31' })).body.id;
    const added = await agent.post(`/api/access-reviews/${review}/systems`, { system_ids: [sys] });
    expect(added.body[0].reviewer_id).toBe(auditor.userId);
    expect((await agent.post(`/api/access-reviews/${review}/launch`)).status).toBe(200);

    const page = (await auditor.get(`/api/access-reviews/${review}/systems/${sys}/items`)).body;
    const item = (name: string) => page.items.find((i: any) => i.account_name.toLowerCase() === name.toLowerCase());
    expect(item(me.username)).toMatchObject({ own: true, mayDecide: false });
    expect(item('crew-admin-7')).toMatchObject({ own: true, mayDecide: false });
    expect(item('crew-planner-2')).toMatchObject({ own: false, mayDecide: true });
    expect(page.items[0].same_user_ids).toBeUndefined();
    const own = await auditor.post(`/api/access-reviews/${review}/decisions`, { items: [item(me.username).id, item('crew-admin-7').id], decision: 'keep' });
    expect(own.status).toBe(403);
    expect(own.body.error.code).toBe('own_account');
    expect((await auditor.post(`/api/access-reviews/${review}/decisions`, { items: [item('crew-planner-2').id], decision: 'keep' })).body.saved).toBe(1);
    // The campaign owner decides on the reviewer's own accounts.
    expect((await agent.post(`/api/access-reviews/${review}/decisions`, { items: [item(me.username).id, item('crew-admin-7').id], decision: 'keep' })).body.saved).toBe(2);
  });
});
