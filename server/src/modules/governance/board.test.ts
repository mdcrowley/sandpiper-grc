import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, SESSION_COOKIE } from '../../core/auth.ts';
import { checkPdfUa } from '../../core/export/pdfua.ts';
import type { Row } from '../../core/module.ts';
import { dayInZone, todayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { makeDocx, makePdf, para, pdfText } from '../policies/convert/fixtures.ts';
import { printableMarkdown } from './book.ts';
import { carried, voteSummary } from './motions.ts';

// Wave 25: the board book, structured minutes, motions and votes, closed sessions, the member reading
// view and loading past meetings. Invented committees, people and papers only.

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof user>>;
let secretary: Client; // compliance officer: governance.*
let chair: Client;     // audit lead: governance.view, chairs the committee
let viewer: Client;    // audit lead: governance.view, sits on no committee
let member: Client;    // no role at all: a member of the committee by account
let outsider: Client;  // no role, sits on no committee

let committeeId: string;
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
    return { status: res.statusCode, body: parsed, raw: res.rawPayload, headers: res.headers };
  };
  return {
    id: row.id, cookie,
    get: (url: string) => call('GET', url), post: (url: string, body: unknown = {}) => call('POST', url, body),
    patch: (url: string, body: unknown = {}) => call('PATCH', url, body), put: (url: string, body: unknown = {}) => call('PUT', url, body),
    del: (url: string) => call('DELETE', url),
    upload: async (meetingId: string, name: string, data: Buffer) => {
      const res = await t.app.inject({
        method: 'PUT', url: `/api/attachments/upload?${new URLSearchParams({ record_type: 'meeting', record_id: meetingId, name })}`,
        headers: { cookie: `${SESSION_COOKIE}=${cookie}`, 'x-grc-csrf': '1', 'content-type': 'application/octet-stream' }, payload: data,
      });
      return { status: res.statusCode, body: res.json() };
    },
  };
}

const at = (days: number, hour = 18) => `${dayInZone(days)}T${String(hour).padStart(2, '0')}:00:00Z`;
async function meeting(title: string, days: number, extra: Row = {}) {
  const res = await secretary.post('/api/meetings', { committee_id: committeeId, title, scheduled_at: at(days), ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Row;
}
const item = async (meetingId: string, body: Row) => {
  const res = await secretary.post(`/api/meetings/${meetingId}/agenda`, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Row;
};
const present = (meetingId: string, names: string[]) => secretary.put(`/api/meetings/${meetingId}/attendance`, {
  attendance: Object.entries(memberIds).map(([n, id]) => ({ member_id: id, present: names.includes(n) })),
});

beforeAll(async () => {
  process.env.GRC_MODULES = 'governance,attachments,policies,workflows,notifications';
  t = await testApp();
  secretary = await user('compliance_officer', 'Invented Secretary');
  chair = await user('audit_lead', 'Invented Chair');
  viewer = await user('audit_lead', 'Invented Viewer');
  member = await user(null, 'Invented Member');
  outsider = await user(null, 'Invented Outsider');

  const c = await secretary.post('/api/committees', { name: 'Invented board of directors', kind: 'governing_body', chair_id: chair.id, secretary_id: secretary.id, resolution_prefix: 'R-' });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  committeeId = c.body.id;
  for (const [name, body] of [
    ['chair', { user_id: chair.id, role: 'chair' }], ['member', { user_id: member.id }],
    ['jordan', { name: 'Jordan Example' }], ['avery', { name: 'Avery Example' }], ['observer', { name: 'Quinn Observer', voting: false }],
  ] as const) {
    const m = await secretary.post(`/api/committees/${committeeId}/members`, body);
    expect(m.status, JSON.stringify(m.body)).toBe(201);
    memberIds[name] = m.body.id;
  }
}, 120_000);
afterAll(async () => { delete process.env.GRC_MODULES; await t?.close(); });

describe('helpers', () => {
  it('summarizes and decides a vote on a simple majority, and prints Markdown tables and images as words', () => {
    expect(voteSummary({ for: 3, against: 1, abstain: 0, absent: 1 })).toBe('For 3, against 1, abstaining 0, absent 1');
    expect(carried({ for: 2, against: 2 })).toBe(false);
    expect(carried({ for: 3, against: 2 })).toBe(true);
    expect(printableMarkdown('| A | B |\n|---|---|\n| 1 | 2 |\n![Route map](attachment:x) [see](http://x.test)')).toBe('A · B\n\n1 · 2\n[Image: Route map] see');
  });
});

describe('motions, votes and quorum', () => {
  it('records a motion with mover and seconder by name, a vote per member, the outcome worked out and a resolution number', async () => {
    const m = await meeting('Invented regular meeting', -20);
    const a = await item(m.id, { title: 'Fare policy update', presenter: 'Invented Planner', minutes_allotted: 20 });
    expect(a).toMatchObject({ session: 'open', consent: false, minutes_allotted: 20, presenter_label: 'Invented Planner', papers: [] });
    const att = await present(m.id, ['chair', 'member', 'jordan']);
    expect(att.body.quorum).toMatchObject({ voting: 4, present: 3, needed: 3, met: true });

    const res = await secretary.post(`/api/meetings/${m.id}/motions`, {
      agenda_item_id: a.id, motion_text: 'That the fare policy update be adopted.', mover: 'Jordan Example', seconder: { member_id: memberIds.member },
      vote: { mode: 'members', votes: [{ member_id: memberIds.chair, vote: 'for' }, { name: 'Jordan Example', vote: 'for' }, { member_id: memberIds.member, vote: 'against' }, { name: 'Avery Example', vote: 'absent' }] },
      assign_resolution: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const year = todayInZone(new Date(m.scheduled_at)).slice(0, 4);
    expect(res.body).toMatchObject({
      title: 'That the fare policy update be adopted.', outcome: 'approved', mover_name: 'Jordan Example', mover_member_id: memberIds.jordan,
      seconder_name: 'Invented Member', seconder_user_id: member.id, vote_mode: 'members', votes_for: 2, votes_against: 1, votes_abstain: 0, votes_absent: 1,
      vote_summary: 'For 2, against 1, abstaining 0, absent 1', resolution_number: `R-${year}-01`, closed_session: false,
      quorum: { met: true }, recorded_by: secretary.id,
    });
    expect(res.body.votes.map((v: Row) => [v.name, v.vote])).toEqual([['Invented Chair', 'for'], ['Invented Member', 'against'], ['Jordan Example', 'for'], ['Avery Example', 'absent']]);

    // Counts only, failing on a tie; the next number; a number already used is refused.
    const tie = await secretary.post(`/api/meetings/${m.id}/motions`, { agenda_item_id: a.id, motion_text: 'That the item be deferred.', vote: { mode: 'counts', for: 2, against: 2, abstain: 0, absent: 0 } });
    expect(tie.body).toMatchObject({ outcome: 'rejected', vote_mode: 'counts', votes_for: 2, votes_against: 2, votes: [] });
    expect((await secretary.post(`/api/meeting-decisions/${tie.body.id}/resolution-number`)).status).toBe(409);
    const next = await secretary.post(`/api/meetings/${m.id}/motions`, { motion_text: 'That the minutes clerk be thanked.', outcome: 'approved' });
    expect((await secretary.post(`/api/meeting-decisions/${next.body.id}/resolution-number`)).body.resolution_number).toBe(`R-${year}-02`);
    const dup = await secretary.patch(`/api/meetings/${m.id}/motions/${tie.body.id}`, { resolution_number: `r-${year}-01` });
    expect(dup.status).toBe(400);
    expect(dup.body.error.fields.resolution_number).toContain('already used');

    // The register lists them with the motion.
    const register = await viewer.get(`/api/meeting-decisions?f.meeting_id=${m.id}&sort=created_at&dir=asc`);
    expect(register.body.rows[0]).toMatchObject({ resolution_number: `R-${year}-01`, mover_name: 'Jordan Example', vote_summary: 'For 2, against 1, abstaining 0, absent 1' });
  });

  it('refuses a non-voting member\'s vote, a vote listed twice, the mover seconding, a stranger by name and a bad count', async () => {
    const m = await meeting('Invented special meeting', -18);
    const bad = async (body: Row, field: string) => {
      const res = await secretary.post(`/api/meetings/${m.id}/motions`, { motion_text: 'That something be done.', ...body });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(Object.keys(res.body.error.fields)).toContain(field);
    };
    await bad({ vote: { mode: 'members', votes: [{ name: 'Quinn Observer', vote: 'for' }] } }, 'vote');
    await bad({ vote: { mode: 'members', votes: [{ name: 'Jordan Example', vote: 'for' }, { member_id: memberIds.jordan, vote: 'against' }] } }, 'vote');
    await bad({ vote: { mode: 'members', votes: [{ name: 'Jordan Example', vote: 'maybe' }] } }, 'vote');
    await bad({ mover: 'Jordan Example', seconder: { member_id: memberIds.jordan } }, 'seconder');
    await bad({ mover: 'Nobody Known' }, 'mover');
    await bad({ vote: { mode: 'counts', for: -1 } }, 'vote.for');
    await bad({ motion_text: '' }, 'motion_text');
    // Only people who may record decisions record motions.
    expect((await viewer.post(`/api/meetings/${m.id}/motions`, { motion_text: 'That nothing happen.' })).status).toBe(403);
    expect(await t.db.one(`select count(*)::int as n from meeting_decisions where meeting_id = $1`, [m.id])).toEqual({ n: 0 });
  });
});

describe('minutes approved at a later meeting, then published', () => {
  it('writes minutes per item, approves them by a motion at the next meeting with its date, locks the meeting and publishes them', async () => {
    const first = await meeting('Invented first meeting', -14);
    const a = await item(first.id, { title: 'Safety report' });
    expect((await secretary.patch(`/api/meetings/${first.id}/agenda/${a.id}`, { discussion: 'The board discussed the quarterly safety figures.' })).body.discussion)
      .toBe('The board discussed the quarterly safety figures.');
    await secretary.patch(`/api/meetings/${first.id}`, { status: 'held' });
    const next = await meeting('Invented second meeting', -7);
    const draft = await secretary.get(`/api/meetings/${first.id}/minutes/pdf`);
    expect(draft.status).toBe(200);
    expect(await pdfText(draft.raw)).toContain('Draft: not yet approved');

    // Not yet: no decision; one at an earlier meeting; one that was rejected.
    expect((await secretary.post(`/api/meetings/${first.id}/minutes/approve`, {})).status).toBe(400);
    const earlier = await meeting('Invented earlier meeting', -30);
    const old = await secretary.post(`/api/meetings/${earlier.id}/motions`, { motion_text: 'That an earlier thing be approved.', outcome: 'approved' });
    expect((await secretary.post(`/api/meetings/${first.id}/minutes/approve`, { decision_id: old.body.id })).body.error.fields.decision_id).toContain('later meeting');
    const no = await secretary.post(`/api/meetings/${next.id}/motions`, { motion_text: 'That the minutes be approved.', outcome: 'rejected', record_type: 'meeting', record_id: first.id });
    expect((await secretary.post(`/api/meetings/${first.id}/minutes/approve`, { decision_id: no.body.id })).status).toBe(400);
    // Publishing waits for approval.
    expect((await secretary.post(`/api/meetings/${first.id}/minutes/publish`)).status).toBe(409);

    const yes = await secretary.post(`/api/meetings/${next.id}/motions`, {
      motion_text: 'That the minutes of the first meeting be approved as presented.', mover: 'Avery Example', seconder: 'Jordan Example',
      vote: { mode: 'counts', for: 4, against: 0, abstain: 0, absent: 0 }, record_type: 'meeting', record_id: first.id,
    });
    expect(yes.status, JSON.stringify(yes.body)).toBe(201);
    const options = await chair.get(`/api/meetings/${first.id}/minutes/approvals`);
    expect(options.body.map((o: Row) => o.id)).toContain(yes.body.id);
    const approved = await secretary.post(`/api/meetings/${first.id}/minutes/approve`, { decision_id: yes.body.id, approved_on: '2020-01-01' });
    expect(approved.status).toBe(400); // the date is the approving meeting's, except in a data load
    const ok = await secretary.post(`/api/meetings/${first.id}/minutes/approve`, { decision_id: yes.body.id });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ status: 'minutes_approved', minutes_approved_on: todayInZone(new Date(next.scheduled_at)), minutes_approved_meeting_id: next.id, minutes_approved_decision_id: yes.body.id });
    expect((await secretary.patch(`/api/meetings/${first.id}/agenda/${a.id}`, { discussion: 'Changed later.' })).status).toBe(409);
    expect((await t.db.one<Row>(`select summary from audit_events where action = 'meeting.minutes_approved' and record_id = $1`, [first.id]))!.summary)
      .toContain(`approved at ${next.ref}`);

    // Members read published minutes only.
    expect((await member.get(`/api/governance/my-meetings/${first.id}/minutes`)).status).toBe(409);
    const pub = await secretary.post(`/api/meetings/${first.id}/minutes/publish`);
    expect(pub.body).toMatchObject({ minutes_published_by: secretary.id, minutes_published_by_name: 'Invented Secretary' });
    expect(pub.body.minutes_published_at).toBeTruthy();
    const minutes = await member.get(`/api/governance/my-meetings/${first.id}/minutes`);
    expect(minutes.status).toBe(200);
    const text = await pdfText(minutes.raw);
    expect(text).toContain('The board discussed the quarterly safety figures.');
    expect(text).toContain(`at meeting ${next.ref}`);
    expect((await checkPdfUa(minutes.raw)).failures).toEqual([]);
    const view = await member.get(`/api/governance/my-meetings/${first.id}`);
    expect(view.body.agenda[0].discussion).toBe('The board discussed the quarterly safety figures.');
  });
});

describe('closed sessions', () => {
  let m: Row;
  let closed: Row;
  beforeAll(async () => {
    m = await meeting('Invented meeting with an executive session', 10, { location: 'Invented boardroom' });
    await item(m.id, { title: 'Consent: minutes of the last meeting', consent: true });
    await item(m.id, { title: 'Open budget discussion', minutes_allotted: 30 });
    closed = await item(m.id, { title: 'Invented property negotiation', session: 'closed', notes: 'Confidential terms.' });
    await secretary.post(`/api/meetings/${m.id}/motions`, { agenda_item_id: closed.id, motion_text: 'That the negotiator be authorized.', outcome: 'approved' });
    await secretary.patch(`/api/meetings/${m.id}`, { status: 'agenda_published' });
  });

  it('refuses a closed item on the consent agenda', async () => {
    const res = await secretary.post(`/api/meetings/${m.id}/agenda`, { title: 'Bad', session: 'closed', consent: true });
    expect(res.body.error.fields.consent).toBeDefined();
  });

  it('shows non-members that a closed item exists, never its title, papers, minutes or decisions; counts stay the same', async () => {
    const agenda = (await viewer.get(`/api/meetings/${m.id}/agenda`)).body;
    expect(agenda).toHaveLength(3);
    expect(agenda[2]).toEqual({ id: closed.id, meeting_id: m.id, sort: closed.sort, session: 'closed', consent: false, title: 'Closed session item', hidden: true, papers: [] });
    expect(JSON.stringify(agenda)).not.toContain('property negotiation');
    expect((await chair.get(`/api/meetings/${m.id}/agenda`)).body[2].title).toBe('Invented property negotiation');
    expect((await viewer.patch(`/api/meetings/${m.id}/agenda/${closed.id}`, { title: 'x' })).status).toBe(403);

    const mine = await viewer.get(`/api/meetings/${m.id}/decisions`);
    expect(mine.body).toHaveLength(0);
    expect((await chair.get(`/api/meetings/${m.id}/decisions`)).body).toHaveLength(1);
    const statsViewer = await viewer.get(`/api/meeting-decisions/stats?group=outcome&f.meeting_id=${m.id}`);
    const statsChair = await chair.get(`/api/meeting-decisions/stats?group=outcome&f.meeting_id=${m.id}`);
    expect(statsViewer.body.total).toBe(1);
    expect(statsViewer.body.total).toBe(statsChair.body.total);
  });

  it('leaves closed items out of the public book and keeps the members\' version for members', async () => {
    expect((await viewer.get(`/api/meetings/${m.id}/book?version=members`)).status).toBe(403);
    const pub = await viewer.get(`/api/meetings/${m.id}/book`);
    expect(pub.status).toBe(200);
    expect(pub.headers['content-type']).toBe('application/pdf');
    const text = await pdfText(pub.raw);
    expect(text).toContain('Open budget discussion');
    expect(text).toContain('1 closed-session item is not included in this version.');
    expect(text).not.toContain('property negotiation');
    const full = await chair.get(`/api/meetings/${m.id}/book?version=members`);
    const fullText = await pdfText(full.raw);
    expect(fullText).toContain('Invented property negotiation');
    expect(fullText).toContain('Confidential terms.');
    const publicMinutes = await pdfText((await secretary.get(`/api/meetings/${m.id}/minutes/pdf`)).raw);
    expect(publicMinutes).not.toContain('negotiator');
  });

  it('gives members their reading view with closed items, and nothing to people who do not sit on the committee', async () => {
    const list = await member.get('/api/governance/my-meetings');
    expect(list.status).toBe(200);
    expect(list.body.upcoming.map((x: Row) => x.id)).toContain(m.id);
    expect(list.body.upcoming.find((x: Row) => x.id === m.id)).toMatchObject({ book_ready: true, committee_name: 'Invented board of directors', location: 'Invented boardroom' });
    const view = await member.get(`/api/governance/my-meetings/${m.id}`);
    expect(view.body.agenda.map((a: Row) => a.title)).toEqual(['Consent: minutes of the last meeting', 'Open budget discussion', 'Invented property negotiation']);
    const book = await member.get(`/api/governance/my-meetings/${m.id}/book`);
    expect(book.status).toBe(200);
    expect(await pdfText(book.raw)).toContain('Invented property negotiation');
    // No permission to the governance pages at all.
    expect((await member.get(`/api/meetings/${m.id}/agenda`)).status).toBe(403);

    expect((await outsider.get('/api/governance/my-meetings')).body).toEqual({ upcoming: [], recent: [] });
    expect((await outsider.get(`/api/governance/my-meetings/${m.id}`)).status).toBe(404);
    expect((await outsider.get(`/api/governance/my-meetings/${m.id}/book`)).status).toBe(404);
    expect((await viewer.get(`/api/governance/my-meetings/${m.id}`)).status).toBe(404);
  });

  it('keeps the book from members until the agenda is published', async () => {
    const later = await meeting('Invented meeting still being planned', 40);
    await item(later.id, { title: 'Draft item' });
    expect((await member.get(`/api/governance/my-meetings/${later.id}`)).body).toMatchObject({ agenda: [], agenda_published: false });
    expect((await member.get(`/api/governance/my-meetings/${later.id}/book`)).status).toBe(409);
  });
});

describe('the board book', () => {
  it('prints documents and Word and text papers, appends PDF papers, and passes the PDF/UA check', async () => {
    const m = await meeting('Invented meeting with papers', 12);
    const a = await item(m.id, { title: 'Staff report on service changes', presenter_id: secretary.id });
    expect(a.presenter_label).toBe('Invented Secretary');
    const report = await secretary.upload(m.id, 'Staff report.pdf', await makePdf(['Invented staff report page one', 'Invented staff report page two']));
    expect(report.status, JSON.stringify(report.body)).toBe(201);
    const notes = await secretary.upload(m.id, 'Briefing notes.md', Buffer.from('# Briefing\n\n- Invented point one\n- Invented point two\n'));
    const word = await secretary.upload(m.id, 'Memo.docx', makeDocx([para('Invented memo text from Word.')]));
    expect(word.status, JSON.stringify(word.body)).toBe(201);
    for (const f of [report, notes, word]) {
      const p = await secretary.post(`/api/meetings/${m.id}/agenda/${a.id}/papers`, { kind: 'file', attachment_id: f.body.id });
      expect(p.status, JSON.stringify(p.body)).toBe(201);
    }
    expect((await secretary.post(`/api/meetings/${m.id}/agenda/${a.id}/papers`, { kind: 'file', attachment_id: report.body.id })).status).toBe(409);
    expect((await secretary.post(`/api/meetings/${m.id}/agenda/${a.id}/papers`, { kind: 'file', attachment_id: '00000000-0000-4000-8000-000000000999' })).status).toBe(400);
    const doc = await t.api.post('/api/policies', { title: 'Invented fare policy', type: 'policy' });
    if (doc.status === 201) {
      const added = await secretary.post(`/api/meetings/${m.id}/agenda/${a.id}/papers`, { kind: 'document', record_id: doc.body.id });
      expect(added.status, JSON.stringify(added.body)).toBe(201);
      expect(added.body).toMatchObject({ kind: 'document', record: { type: 'policy', id: doc.body.id } });
    }
    const agenda = (await chair.get(`/api/meetings/${m.id}/agenda`)).body;
    expect(agenda[0].papers.slice(0, 3).map((p: Row) => p.file_name)).toEqual(['Staff report.pdf', 'Briefing notes.md', 'Memo.docx']);

    const book = await chair.get(`/api/meetings/${m.id}/book`);
    expect(book.status).toBe(200);
    const text = await pdfText(book.raw);
    expect(text).toContain('Invented point one');
    expect(text).toContain('Invented memo text from Word.');
    expect(text).toContain('Appended as appendix A: 2 pages');
    expect(text).toContain('Invented staff report page two');
    const ua = await checkPdfUa(book.raw);
    expect(ua.failures).toEqual([]);
    expect(ua.headings[0]).toBe('H1');
    // The text of PDF papers is read by the attachments module's background job.
    for (let i = 0; i < 5; i++) await (t.app as unknown as { jobs: { runDue(): Promise<unknown> } }).jobs.runDue();
    const own = await chair.get(`/api/meetings/${m.id}/book?text=1`);
    expect((await checkPdfUa(own.raw)).failures).toEqual([]);
    // The text-only book prints the PDF's text instead of appending its two pages and listing them.
    expect(await pdfText(own.raw)).toContain('Invented staff report page one');
    expect(ua.pages).toBeGreaterThan((await checkPdfUa(own.raw)).pages);

    // A member downloads a file paper; a paper of another meeting is not theirs to fetch.
    await secretary.patch(`/api/meetings/${m.id}`, { status: 'agenda_published' });
    const view = await member.get(`/api/governance/my-meetings/${m.id}`);
    const paper = view.body.agenda[0].papers.find((p: Row) => p.file_name === 'Briefing notes.md');
    const file = await member.get(`/api/governance/my-meetings/${m.id}/papers/${paper.id}`);
    expect(file.status).toBe(200);
    expect(file.raw.toString('utf8')).toContain('Invented point one');
    expect(file.headers['content-security-policy']).toContain('sandbox');
    expect((await outsider.get(`/api/governance/my-meetings/${m.id}/papers/${paper.id}`)).status).toBe(404);
  }, 120_000);
});

describe('data load', () => {
  it('loads a past meeting with its approved minutes, motions with named movers, votes by name and the dates given', async () => {
    await t.db.query(`insert into settings (key, value) values ('data_load.mode', $1::jsonb) on conflict (key) do update set value = excluded.value`,
      [JSON.stringify({ until: new Date(Date.now() + 3600_000).toISOString(), startedAt: new Date().toISOString(), startedBy: null })]);
    try {
      const past = await t.api.post('/api/meetings', {
        committee_id: committeeId, title: 'Invented meeting of long ago', scheduled_at: '2019-03-05T23:00:00Z', status: 'minutes_approved',
        created_at: '2019-02-20T12:00:00Z', on_behalf_of: 'name:Former Secretary',
      });
      expect(past.status, JSON.stringify(past.body)).toBe(201);
      expect(past.body).toMatchObject({ status: 'minutes_approved' });
      const a = await t.api.post(`/api/meetings/${past.body.id}/agenda`, { title: 'Invented depot lease', discussion: 'The lease was discussed.', on_behalf_of: 'name:Former Secretary' });
      expect(a.status, JSON.stringify(a.body)).toBe(201);
      const motion = await t.api.post(`/api/meetings/${past.body.id}/motions`, {
        agenda_item_id: a.body.id, motion_text: 'That the depot lease be renewed.', mover: 'name:Pat Former', seconder: 'Jordan Example',
        vote: { mode: 'members', votes: [{ name: 'Jordan Example', vote: 'for' }, { name: 'Avery Example', vote: 'for' }, { name: 'Invented Chair', vote: 'abstain' }] },
        resolution_number: 'R-2019-07', created_at: '2019-03-05T23:30:00Z', on_behalf_of: 'name:Former Secretary',
      });
      expect(motion.status, JSON.stringify(motion.body)).toBe(201);
      expect(motion.body).toMatchObject({
        mover_name: 'Pat Former', mover_member_id: null, mover_user_id: null, seconder_name: 'Jordan Example', seconder_member_id: memberIds.jordan,
        outcome: 'approved', votes_for: 2, votes_abstain: 1, resolution_number: 'R-2019-07', recorded_by_name: 'Former Secretary', recorded_by: null,
      });
      expect(new Date(motion.body.created_at).toISOString()).toBe('2019-03-05T23:30:00.000Z');
      expect((await t.db.one<Row>(`select count(*)::int as n from data_load_records where record_id = $1`, [motion.body.id]))!.n).toBe(1);
      const pub = await t.api.post(`/api/meetings/${past.body.id}/minutes/publish`, { published_at: '2019-04-10T15:00:00Z', on_behalf_of: 'name:Former Secretary' });
      expect(pub.status, JSON.stringify(pub.body)).toBe(200);
      expect(pub.body).toMatchObject({ minutes_published_by_name: 'Former Secretary', minutes_published_by: null });
      expect(new Date(pub.body.minutes_published_at).toISOString()).toBe('2019-04-10T15:00:00.000Z');
      // Outside a load, a time in the past and a named person are refused.
      await t.db.query(`delete from settings where key = 'data_load.mode'`);
      const later = await meeting('Invented meeting after the load', -3);
      await secretary.patch(`/api/meetings/${later.id}`, { status: 'held' });
      expect((await secretary.post(`/api/meetings/${later.id}/motions`, { motion_text: 'That x.', on_behalf_of: 'name:Someone' })).status).toBe(400);
      expect((await secretary.post(`/api/meetings/${past.body.id}/agenda`, { title: 'Too late' })).status).toBe(409);
    } finally {
      await t.db.query(`delete from settings where key = 'data_load.mode'`);
    }
  });
});
