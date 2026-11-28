import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { addDays } from '../../../../shared/dates.ts';
import { testApp } from '../../test/helpers.ts';
import { runReminders } from './summary.ts';

// Civil rights programs (wave 26): programs from templates with elements, notices, language items and
// reports; complaints with their time limits; participation goals with attainment. Invented data only.
let t: Awaited<ReturnType<typeof testApp>>;
let adminId = '';

beforeAll(async () => {
  t = await testApp();
  adminId = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
  await t.db.query('update sessions set confirmed_at = now()');
  // A clerk who may see and work on the area but neither administers it nor is a named handler.
  const role = await t.db.one<{ id: string }>(`insert into roles (key, name, enabled) values ('cr_clerk', 'Invented clerk', true) returning id`);
  for (const p of ['civilrights.view', 'civilrights.create', 'civilrights.edit']) await t.db.query('insert into role_permissions (role_id, permission) values ($1, $2)', [role!.id, p]);
}, 60_000);
afterAll(async () => { await t?.close(); });

const ok = (res: { status: number; body: any }, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body;
};

describe('the area switch', () => {
  it('is off by default and answers switched_off until it is switched on', async () => {
    expect((await t.api.get('/api/auth/state')).body.features.civilrights).toBe(false);
    expect((await t.api.get('/api/civil-rights/summary')).status).toBe(404);
    expect((await t.api.get('/api/civil-rights/programs')).status).toBe(404);
    const meta = (await t.api.get('/api/meta')).body;
    expect(meta.resources.civil_rights_complaint).toBeUndefined();
    ok(await t.api.patch('/api/admin/features', { features: { civilrights: true } }));
    expect((await t.api.get('/api/civil-rights/summary')).status).toBe(200);
  });
});

describe('programs', () => {
  let template: Row;
  let program: Row;

  it('copies a template\'s elements and reports into a new program and works out the next update', async () => {
    template = ok(await t.api.post('/api/civil-rights/templates', {
      name: 'Invented nondiscrimination template', program_type: 'nondiscrimination', update_cycle_months: 36,
      elements: '- Policy statement\n- Notice to the public\n\nComplaint procedure', reports: 'Program update | 36\nOne-off baseline',
    }), 201);
    program = ok(await t.api.post('/api/civil-rights/programs', { name: 'Invented program', template_id: template.id, adopted_on: '2025-01-15' }), 201);
    expect(program.program_type).toBe('nondiscrimination');
    expect(program.update_cycle_months).toBe(36);
    expect(String(program.next_update_due).slice(0, 10)).toBe('2028-01-15');
    const items = ok(await t.api.get(`/api/civil-rights/programs/${program.id}/items?kind=element`)).rows;
    expect(items.map((i: Row) => i.title)).toEqual(['Policy statement', 'Notice to the public', 'Complaint procedure']);
    const reports = ok(await t.api.get(`/api/civil-rights/reports?f.program_id=${program.id}&sort=title`)).rows;
    expect(reports.map((r: Row) => r.title)).toEqual(['One-off baseline', 'Program update']);
    expect(String(reports.find((r: Row) => r.title === 'Program update').due_on).slice(0, 10)).toBe('2028-01-15');
    // A later update moves the next update date.
    const upd = ok(await t.api.patch(`/api/civil-rights/programs/${program.id}`, { last_updated_on: '2026-06-01' }));
    expect(String(upd.next_update_due).slice(0, 10)).toBe('2029-06-01');
  });

  it('keeps notices and language items, stamping who checked them', async () => {
    const notice = ok(await t.api.post(`/api/civil-rights/programs/${program.id}/items`, { kind: 'notice', title: 'Notice at the invented customer center', checked_on: dayInZone(0) }), 201);
    expect(notice.checked_by).toBe(adminId);
    expect(notice.checked_by_name).toBeTruthy();
    const lang = ok(await t.api.post(`/api/civil-rights/programs/${program.id}/items`, { kind: 'language', title: 'Translated notice', language: 'Spanish', status: 'in_progress' }), 201);
    const changed = ok(await t.api.patch(`/api/civil-rights/programs/${program.id}/items/${lang.id}`, { status: 'in_place' }));
    expect(changed.status).toBe('in_place');
    expect((await t.api.post(`/api/civil-rights/programs/${program.id}/items`, { kind: 'other', title: 'x' })).status).toBe(400);
    expect((await t.api.post(`/api/civil-rights/programs/${program.id}/items`, { kind: 'element', title: 'x', status: 'nope' })).status).toBe(400);
    ok(await t.api.del(`/api/civil-rights/programs/${program.id}/items/${lang.id}`));
    const history = ok(await t.api.get(`/api/history?record_type=civil_rights_program&record_id=${program.id}`));
    expect(JSON.stringify(history)).toContain('Language assistance item');
  });

  it('links evidence from the library to one required element', async () => {
    const element = ok(await t.api.get(`/api/civil-rights/programs/${program.id}/items?kind=element`)).rows[0];
    const e = ok(await t.api.post('/api/evidence-library', { title: 'Invented signed policy statement' }), 201);
    ok(await t.api.post('/api/evidence-links', { evidence_id: e.id, record_type: 'civil_rights_program', record_id: program.id, part: `element:${element.id}` }), 201);
    const links = ok(await t.api.get(`/api/evidence-links?record_type=civil_rights_program&record_id=${program.id}&part=element:${element.id}`));
    expect(links.rows[0].part_label).toContain('Policy statement');
    expect((await t.api.post('/api/evidence-links', { evidence_id: e.id, record_type: 'civil_rights_program', record_id: program.id, part: 'element:00000000-0000-4000-8000-000000000000' })).status).toBe(400);
  });

  it('logs each submission of a report and plans the next one of a repeating report', async () => {
    const r = ok(await t.api.post('/api/civil-rights/reports', { title: 'Invented monitoring report', program_id: program.id, due_on: '2026-03-31', every_months: 12, recipient: 'Invented board' }), 201);
    const res = ok(await t.api.post(`/api/civil-rights/reports/${r.id}/submit`, { submitted_on: '2026-03-30', reference: 'INV-1' }), 201);
    expect(res.report.status).toBe('submitted');
    expect(String(res.report.submitted_on).slice(0, 10)).toBe('2026-03-30');
    expect(res.next.due_on).toBe('2027-03-31');
    const log = ok(await t.api.get(`/api/civil-rights/reports/${r.id}/submissions`));
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ submitted_on: '2026-03-30', reference: 'INV-1', recipient: 'Invented board' });
    // Sending it again (after it was returned) adds to the log and plans nothing twice.
    ok(await t.api.post(`/api/civil-rights/reports/${r.id}/submit`, { submitted_on: '2026-04-10' }), 201);
    expect(ok(await t.api.get(`/api/civil-rights/reports/${r.id}/submissions`))).toHaveLength(2);
    expect(ok(await t.api.get(`/api/civil-rights/reports?q=${encodeURIComponent('Invented monitoring report')}`)).total).toBe(2);
    expect((await t.api.post(`/api/civil-rights/reports/${r.id}/submit`, { submitted_on: addDays(dayInZone(0), 3) })).status).toBe(400);
  });
});

describe('complaints', () => {
  it('works out the time limits from the settings and the day received', async () => {
    ok(await t.api.put('/api/civil-rights/settings', { ackDays: 5, investigationDays: 60, appealDays: 20 }));
    expect((await t.api.put('/api/civil-rights/settings', { ackDays: 0 })).status).toBe(400);
    const c = ok(await t.api.post('/api/civil-rights/complaints', { subject: 'Invented ramp complaint', received_on: '2026-01-10', basis: 'disability', complainant_name: 'Pat Example' }), 201);
    expect(c.confidential).toBe(true);
    expect(String(c.ack_due_on).slice(0, 10)).toBe('2026-01-15');
    expect(String(c.investigation_due_on).slice(0, 10)).toBe('2026-03-11');
    expect(String(c.next_due_on).slice(0, 10)).toBe('2026-01-15');
    const clock = ok(await t.api.get(`/api/civil-rights/complaints/${c.id}/clock`));
    expect(clock.overdue).toBe(true);
    expect(clock.limits[0]).toMatchObject({ key: 'ack', state: 'overdue' });
    // Acknowledging moves the next limit to the investigation.
    const ack = ok(await t.api.patch(`/api/civil-rights/complaints/${c.id}`, { status: 'acknowledged' }));
    expect(String(ack.acknowledged_on).slice(0, 10)).toBe(dayInZone(0));
    expect(String(ack.next_due_on).slice(0, 10)).toBe('2026-03-11');
    // Findings need words; closing needs an outcome.
    expect((await t.api.patch(`/api/civil-rights/complaints/${c.id}`, { status: 'findings_issued' })).status).toBe(400);
    ok(await t.api.patch(`/api/civil-rights/complaints/${c.id}`, { findings: 'Invented findings.', status: 'findings_issued' }));
    const appeal = ok(await t.api.patch(`/api/civil-rights/complaints/${c.id}`, { appeal_received_on: '2026-05-01', status: 'appealed' }));
    expect(String(appeal.appeal_due_on).slice(0, 10)).toBe('2026-05-21');
    expect(String(appeal.next_due_on).slice(0, 10)).toBe('2026-05-21');
    expect((await t.api.patch(`/api/civil-rights/complaints/${c.id}`, { status: 'closed' })).status).toBe(400);
    const closed = ok(await t.api.patch(`/api/civil-rights/complaints/${c.id}`, { status: 'closed', outcome: 'not_substantiated', appeal_decided_on: '2026-05-15' }));
    expect(String(closed.closed_on).slice(0, 10)).toBe(dayInZone(0));
    expect(closed.next_due_on).toBeNull();
    ok(await t.api.put('/api/civil-rights/settings', { ackDays: 10, investigationDays: 90, appealDays: 30 }));
  });

  it('keeps no name or contact for an anonymous complaint and refuses a future date', async () => {
    const c = ok(await t.api.post('/api/civil-rights/complaints', { subject: 'Invented anonymous complaint', anonymous: true, complainant_name: 'Should go', complainant_contact: 'x@example.test' }), 201);
    expect(c.complainant_name).toBeNull();
    expect(c.complainant_contact).toBeNull();
    expect((await t.api.post('/api/civil-rights/complaints', { subject: 'Invented', received_on: addDays(dayInZone(0), 2) })).status).toBe(400);
  });

  it('records investigation steps and letters with who did them, in the investigator\'s work', async () => {
    const officer = await t.as('civil_rights_officer');
    const c = ok(await t.api.post('/api/civil-rights/complaints', { subject: 'Invented interpreter complaint', investigator_id: officer.userId }), 201);
    const step = ok(await t.api.post(`/api/civil-rights/complaints/${c.id}/steps`, { kind: 'step', title: 'Interview the complainant', due_on: addDays(dayInZone(0), 3) }), 201);
    expect(step.done_by).toBeNull();
    const letter = ok(await t.api.post(`/api/civil-rights/complaints/${c.id}/steps`, { kind: 'letter', title: 'Acknowledgment letter', done_on: dayInZone(0) }), 201);
    expect(letter.done_by).toBe(adminId);
    // The investigator sees the confidential complaint and has it in My work.
    expect((await officer.get(`/api/civil-rights/complaints/${c.id}`)).status).toBe(200);
    const done = ok(await officer.patch(`/api/civil-rights/complaints/${c.id}/steps/${step.id}`, { done_on: dayInZone(0) }));
    expect(done.done_by).toBe(officer.userId);
    const work = ok(await officer.get('/api/work/mine?days=60'));
    expect(JSON.stringify(work)).toContain(c.id);
  });

  it('sends each reminder once to the investigator', async () => {
    const officer = await t.as('civil_rights_officer');
    const c = ok(await t.api.post('/api/civil-rights/complaints', { subject: 'Invented overdue complaint', received_on: addDays(dayInZone(0), -30), investigator_id: officer.userId }), 201);
    const first = await runReminders(t.ctx);
    expect(first.complaints).toBeGreaterThanOrEqual(1);
    const again = await runReminders(t.ctx);
    expect(again.complaints).toBe(0);
    const n = await t.db.one<{ n: number }>(`select count(*)::int n from notifications where user_id = $1 and record_id = $2`, [officer.userId, c.id]);
    expect(n!.n).toBe(1);
  });
});

describe('confidential complaints', () => {
  it('show counts only to people who are not named handlers, the investigator or who entered them', async () => {
    const entered = ok(await t.api.post('/api/civil-rights/complaints', { subject: 'Invented confidential complaint', complainant_name: 'Sam Example', description: 'Invented words' }), 201);
    const open = ok(await t.api.post('/api/civil-rights/complaints', { subject: 'Invented open complaint', confidential: false }), 201);
    const officer = await t.as('cr_clerk');
    // Not named: the list leaves confidential complaints out, the figures count them.
    const list = ok(await officer.get('/api/civil-rights/complaints?pageSize=500'));
    const ids = list.rows.map((r: Row) => r.id);
    expect(ids).toContain(open.id);
    expect(ids).not.toContain(entered.id);
    expect((await officer.get(`/api/civil-rights/complaints/${entered.id}`)).status).toBe(404);
    expect((await officer.get(`/api/civil-rights/complaints/${entered.id}/steps`)).status).toBe(404);
    expect((await officer.get(`/api/civil-rights/complaints/${entered.id}/clock`)).status).toBe(404);
    expect((await officer.patch(`/api/civil-rights/complaints/${entered.id}`, { subject: 'x' })).status).toBe(404);
    const search = ok(await officer.get('/api/search?q=Invented%20confidential'));
    expect(JSON.stringify(search)).not.toContain(entered.id);
    const mine = ok(await officer.get('/api/civil-rights/summary'));
    const theirs = ok(await t.api.get('/api/civil-rights/summary'));
    expect(mine.complaints).toEqual(theirs.complaints);
    const stats = ok(await officer.get('/api/civil-rights/complaints/stats?group=status'));
    const all = ok(await t.api.get('/api/civil-rights/complaints/stats?group=status'));
    expect(stats.total).toBe(all.total);
    expect(stats.total).toBeGreaterThan(list.total);
    // A metric is a figure too.
    const month = dayInZone(0).slice(0, 7);
    const m1 = ok(await officer.get(`/api/metrics?month=${month}`));
    const m2 = ok(await t.api.get(`/api/metrics?month=${month}`));
    const val = (b: any) => JSON.stringify((b.metrics ?? b).find?.((x: Row) => x.key === 'civilrights.complaints_open'));
    expect(val(m1)).toBe(val(m2));
    // A person who works in the area but neither administers it nor is named cannot change who sees a complaint.
    expect((await officer.patch(`/api/civil-rights/complaints/${open.id}`, { confidential: true })).status).toBe(403);

    // Someone with no civil rights permission sees nothing at all.
    const agent = await t.as('agent');
    expect((await agent.get('/api/civil-rights/summary')).status).toBe(403);
    expect((await agent.get('/api/civil-rights/complaints')).status).toBe(403);

    // Named as a handler (recent password confirmation), the officer sees every complaint.
    const before = ok(await t.api.get('/api/civil-rights/complaint-handlers'));
    expect(before.eligible.some((p: Row) => p.id === officer.userId)).toBe(true);
    ok(await t.api.put('/api/civil-rights/complaint-handlers', { handlers: [officer.userId] }));
    expect((await officer.get(`/api/civil-rights/complaints/${entered.id}`)).status).toBe(200);
    expect(ok(await officer.get('/api/civil-rights/complaint-handlers')).named).toBe(true);
    // Someone who cannot see the area cannot be named.
    expect((await t.api.put('/api/civil-rights/complaint-handlers', { handlers: [officer.userId, agent.userId] })).status).toBe(400);
    ok(await t.api.put('/api/civil-rights/complaint-handlers', { handlers: [] }));
    expect((await officer.get(`/api/civil-rights/complaints/${entered.id}`)).status).toBe(404);
  });

  it('anonymizes the complainant and the notes of steps at the end of retention', async () => {
    const c = ok(await t.api.post('/api/civil-rights/complaints', { subject: 'Invented retention complaint', complainant_name: 'Lee Example', complainant_contact: 'lee@example.test' }), 201);
    ok(await t.api.post(`/api/civil-rights/complaints/${c.id}/steps`, { kind: 'step', title: 'Call back', note: 'Spoke with Lee Example' }), 201);
    const def = t.ctx.resources.get('civil_rights_complaint')!;
    expect(def.fields.complainant_name.personal).toBe(true);
    expect(def.fields.description.personal).toBe(true);
    expect(def.fields.subject.personal).toBe(false);
  });
});

describe('participation goals', () => {
  it('works out attainment against the goal and exports the period\'s report data', async () => {
    const goal = ok(await t.api.post('/api/civil-rights/goals', { title: 'Invented goal', period_start: '2026-01-01', period_end: '2026-12-31', goal_pct: 15 }), 201);
    expect((await t.api.post('/api/civil-rights/goals', { title: 'Bad', goal_pct: 120 })).status).toBe(400);
    expect((await t.api.post('/api/civil-rights/goals', { title: 'Bad', period_start: '2026-02-01', period_end: '2026-01-01' })).status).toBe(400);
    const vendor = ok(await t.api.post('/api/vendors', { name: 'Invented Paving Co.' }), 201);
    const a1 = ok(await t.api.post('/api/civil-rights/awards', { title: 'Invented paving', goal_id: goal.id, award_amount: 100000, prime_vendor_id: vendor.id, awarded_on: '2026-02-01' }), 201);
    const a2 = ok(await t.api.post('/api/civil-rights/awards', { title: '=cmd() invented', goal_id: goal.id, award_amount: 100000, awarded_on: '2026-03-01' }), 201);
    ok(await t.api.post(`/api/civil-rights/awards/${a1.id}/firms`, { vendor_id: vendor.id, certified: true, role: 'Prime', amount: 20000 }), 201);
    ok(await t.api.post(`/api/civil-rights/awards/${a2.id}/firms`, { firm_name: 'Invented Supply LLC', certified: false, amount: 50000 }), 201);
    expect((await t.api.post(`/api/civil-rights/awards/${a2.id}/firms`, { firm_name: 'x', amount: -5 })).status).toBe(400);
    const at = ok(await t.api.get(`/api/civil-rights/goals/${goal.id}/attainment`));
    expect(at).toMatchObject({ award_total: 200000, certified_total: 20000, participation_total: 70000, attainment_pct: 10, shortfall_pct: 5, met: false });
    const csv = await t.api.get(`/api/civil-rights/goals/${goal.id}/export`);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('Invented Paving Co.');
    expect(csv.text).toContain('Attainment (%),10');
    expect(csv.text).toContain("'=cmd() invented");
    const month = ok(await t.api.get('/api/metrics?month=2026-06'));
    expect(JSON.stringify(month)).toContain('civilrights.goal_attainment_pct');
  });
});
