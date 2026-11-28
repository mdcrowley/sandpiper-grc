import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, SESSION_COOKIE } from '../../core/auth.ts';
import { calendarSources, checkedEvents } from '../../core/calendar.ts';
import { checkPdfUa } from '../../core/export/pdfua.ts';
import type { Row, SessionUser } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { addDays } from '../../../../shared/dates.ts';
import { pdfText } from '../policies/convert/fixtures.ts';
import { agendaDueOn, remindAgendaDeadlines } from './workplan.ts';

// Wave 26: declarations of interest and recused votes (E45-60), the agenda posting deadline and the annual
// work plan (E45-62), members' meetings in their calendar feeds (E45-67), and a committee decision as the
// approval of the audit plan (E45-64) and of the risk appetite (E45-56). Invented committees and people.

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof user>>;
let secretary: Client;
let member: Client;
let committeeId = '';
const memberIds: Record<string, string> = {};

async function user(roleKey: string | null, name: string) {
  const row = (await t.db.one<{ id: string }>(
    `insert into users (username, email, display_name, status) values ($1, $2, $3, 'active') returning id`,
    [name.toLowerCase().replace(/\W+/g, '.'), `${name.toLowerCase().replace(/\W+/g, '.')}@example.test`, name]))!;
  if (roleKey) await t.db.query('insert into user_roles (user_id, role_id) select $1, id from roles where key = $2', [row.id, roleKey]);
  const cookie = await createSession(t.db, row.id);
  const call = async (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, body?: unknown) => {
    const res = await t.app.inject({ method, url, headers: { cookie: `${SESSION_COOKIE}=${cookie}`, 'x-grc-csrf': '1' }, ...(body !== undefined ? { payload: body as object } : {}) });
    let parsed: any = null;
    try { parsed = res.json(); } catch { /* a file */ }
    return { status: res.statusCode, body: parsed, raw: res.rawPayload };
  };
  return {
    id: row.id, name,
    get: (url: string) => call('GET', url), post: (url: string, body: unknown = {}) => call('POST', url, body),
    patch: (url: string, body: unknown = {}) => call('PATCH', url, body), put: (url: string, body: unknown = {}) => call('PUT', url, body),
    del: (url: string) => call('DELETE', url),
  };
}
const at = (days: number) => `${dayInZone(days)}T18:00:00Z`;
async function meeting(title: string, days: number) {
  const res = await secretary.post('/api/meetings', { committee_id: committeeId, title, scheduled_at: at(days) });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Row;
}

beforeAll(async () => {
  t = await testApp();
  secretary = await user('compliance_officer', 'Invented Secretary');
  member = await user(null, 'Invented Member');
  const c = await secretary.post('/api/committees', { name: 'Invented audit committee', kind: 'audit', secretary_id: secretary.id, agenda_posting_days: 3 });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  committeeId = c.body.id;
  for (const [key, body] of [['member', { user_id: member.id }], ['jordan', { name: 'Jordan Example' }], ['avery', { name: 'Avery Example' }]] as const) {
    memberIds[key] = (await secretary.post(`/api/committees/${committeeId}/members`, body)).body.id;
  }
  expect((await secretary.patch(`/api/committees/${committeeId}`, { agenda_posting_days: 99 })).status).toBe(400);
}, 120_000);
afterAll(async () => { await t?.close(); });

describe('declarations of interest and recused votes (E45-60)', () => {
  it('records declarations, refuses a vote from a member who took no part, and counts recused votes', async () => {
    const m = await meeting('Invented contract award meeting', 5);
    const item = (await secretary.post(`/api/meetings/${m.id}/agenda`, { title: 'Award of the depot cleaning contract' })).body;
    // A member declares their own interest from their member view.
    const own = await member.post(`/api/governance/my-meetings/${m.id}/declarations`, { agenda_item_id: item.id, interest: 'A relative works for one bidder.' });
    expect(own.status, JSON.stringify(own.body)).toBe(201);
    expect(own.body).toMatchObject({ name: 'Invented Member', action: 'recused', item_title: 'Award of the depot cleaning contract' });
    // The secretary records another, by name; staying is allowed.
    const other = await secretary.post(`/api/meetings/${m.id}/declarations`, { member: 'Jordan Example', interest: 'Former employee of a bidder.', action: 'stayed', agenda_item_id: item.id });
    expect(other.status, JSON.stringify(other.body)).toBe(201);
    expect((await secretary.post(`/api/meetings/${m.id}/declarations`, { member: 'Jordan Example' })).body.error.fields.interest).toBeTruthy();
    expect((await member.post(`/api/meetings/${m.id}/declarations`, { member: 'Jordan Example', interest: 'x' })).status).toBe(403);

    const motion = (vote: string) => secretary.post(`/api/meetings/${m.id}/motions`, {
      agenda_item_id: item.id, motion_text: 'That the contract be awarded.',
      vote: { mode: 'members', votes: [{ member_id: memberIds.member, vote }, { name: 'Jordan Example', vote: 'for' }, { name: 'Avery Example', vote: 'for' }] },
    });
    const refused = await motion('for');
    expect(refused.status).toBe(400);
    expect(refused.body.error.fields.vote).toMatch(/recused/);
    const ok = await motion('recused');
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body).toMatchObject({ votes_for: 2, votes_recused: 1, outcome: 'approved', vote_summary: 'For 2, against 0, abstaining 0, absent 0, recused 1' });

    const list = (await secretary.get(`/api/meetings/${m.id}/declarations`)).body;
    expect(list.map((d: Row) => d.name).sort()).toEqual(['Invented Member', 'Jordan Example']);
    // The minutes list the declarations and the recused vote.
    const pdf = await secretary.get(`/api/meetings/${m.id}/minutes/pdf`);
    expect(pdf.status).toBe(200);
    const text = await pdfText(pdf.raw);
    expect(text).toMatch(/Declarations of interest/);
    expect(text).toMatch(/Recused/);
    expect((await checkPdfUa(pdf.raw)).failures).toEqual([]);
  });
});

describe('agenda posting deadline and annual work plan (E45-62)', () => {
  it('works out the posting deadline and reminds the secretary while the agenda is not posted', async () => {
    const soon = await meeting('Invented meeting in four days', 4);
    expect(agendaDueOn(soon, 3)).toBe(addDays(dayInZone(4), -3));
    const wp = (await secretary.get(`/api/meetings/${soon.id}/work-plan`)).body;
    expect(wp).toMatchObject({ agenda_due_on: addDays(dayInZone(4), -3), agenda_posting_days: 3, agenda_late: false });
    if (t.app.hasDecorator('notify')) {
      const run = await remindAgendaDeadlines(t.ctx);
      expect(run.due).toBeGreaterThanOrEqual(1);
      const again = await remindAgendaDeadlines(t.ctx);
      expect(again.notified).toBe(0);
    }
  });

  it('keeps standing items by month, lists those due at a meeting and puts them on its agenda', async () => {
    const m = await meeting('Invented work plan meeting', 40);
    const month = Number(dayInZone(40).slice(5, 7));
    const other = month === 12 ? 1 : month + 1;
    const a = await secretary.post(`/api/committees/${committeeId}/work-plan`, { title: 'Internal audit progress report', months: [] });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    await secretary.post(`/api/committees/${committeeId}/work-plan`, { title: 'Annual audit plan approval', months: [month] });
    await secretary.post(`/api/committees/${committeeId}/work-plan`, { title: 'External auditor engagement', months: [other] });
    expect((await secretary.post(`/api/committees/${committeeId}/work-plan`, { title: 'x', months: [13] })).status).toBe(400);
    expect((await member.post(`/api/committees/${committeeId}/work-plan`, { title: 'x' })).status).toBe(403);

    const due = (await secretary.get(`/api/meetings/${m.id}/work-plan`)).body.standing_items;
    expect(due.map((d: Row) => d.title).sort()).toEqual(['Annual audit plan approval', 'Internal audit progress report']);
    const added = await secretary.post(`/api/meetings/${m.id}/agenda/from-work-plan`, {});
    expect(added.body.added).toBe(2);
    expect((await secretary.post(`/api/meetings/${m.id}/agenda/from-work-plan`, {})).body.added).toBe(0);
    const agenda = (await secretary.get(`/api/meetings/${m.id}/agenda`)).body;
    const titles = (Array.isArray(agenda) ? agenda : agenda.items ?? agenda.rows ?? []).map((i: Row) => i.title);
    expect(titles).toEqual(expect.arrayContaining(['Annual audit plan approval', 'Internal audit progress report']));
    const year = Number(dayInZone(40).slice(0, 4));
    const plan = (await secretary.get(`/api/committees/${committeeId}/work-plan?year=${year}`)).body;
    expect(plan.items.find((i: Row) => i.title === 'Annual audit plan approval').taken).toEqual([expect.objectContaining({ meeting_id: m.id, month })]);
  });
});

describe('members\' meetings in calendar feeds (E45-67)', () => {
  it('offers the meetings source to a member without governance.view, linking to their member view', async () => {
    const m = await meeting('Invented feed meeting', 10);
    const me = { id: member.id, username: 'invented.member', displayName: 'Invented Member', email: '', roles: [], permissions: [], off: [] } as unknown as SessionUser;
    const sources = calendarSources(t.app, t.ctx.resources, me).filter((s) => s.key === 'governance.meetings');
    expect(sources).toHaveLength(1);
    const events = await checkedEvents(t.ctx, me, sources, dayInZone(0), dayInZone(30));
    expect(events.map((e) => e.event.url)).toContain(`/governance/my-meetings/${m.id}`);
    // Someone who sits on no committee gets none.
    const outsider = { ...me, id: secretary.id === me.id ? '' : (await user(null, 'Invented Outsider')).id } as SessionUser;
    expect(await checkedEvents(t.ctx, outsider, sources, dayInZone(0), dayInZone(30))).toEqual([]);
  });
});

describe('a committee decision as an approval (E45-64, E45-56)', () => {
  let decisionId = '';
  beforeAll(async () => {
    const m = await meeting('Invented approval meeting', -2);
    const d = await secretary.post(`/api/meetings/${m.id}/motions`, { motion_text: 'That the plan and the appetite be approved.', outcome: 'approved', assign_resolution: true });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    decisionId = d.body.id;
  });

  it('approves the audit plan by a decision: the committee is the approver and the meeting\'s date the date', async () => {
    const year = Number(dayInZone().slice(0, 4)) + 1;
    const lead = await t.as('audit_lead');
    const saved = await lead.post('/api/audits/plans', { year });
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    const bad = await t.api.post(`/api/audits/plans/${saved.body.id}/approve`, { decision_id: '00000000-0000-4000-8000-000000000000' });
    expect(bad.status).toBe(400);
    const res = await t.api.post(`/api/audits/plans/${saved.body.id}/approve`, { decision_id: decisionId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ status: 'approved', approved_by_name: 'Invented audit committee', approved_on: dayInZone(-2), approval_decision_id: decisionId });
    expect(res.body.approval_reference).toMatch(/^Invented audit committee, (resolution|decision) /);
  });

  it('records a new risk appetite version approved by the decision', async () => {
    const res = await t.api.put('/api/risks/appetite', { reason: 'Invented annual review', categories: [{ category: 'cyber', statement: 'Low appetite for service loss.', max_rating: 'low', decision_id: decisionId }] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const cat = res.body.categories.find((c: Row) => c.category === 'cyber');
    expect(cat).toMatchObject({ approved_by_name: 'Invented audit committee', approval_body: 'Invented audit committee', approved_on: dayInZone(-2), decision_id: decisionId });
    const versions = (await t.api.get('/api/risks/appetite/versions?category=cyber')).body;
    expect(versions[0].decision_id).toBe(decisionId);
  });
});
