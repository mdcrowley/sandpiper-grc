import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { addDays, addMonths } from './dates.ts';
import { cleanSettings, factorOfValue, scoreOf, timeFactor } from './plan.ts';
import { samePerson } from './workpapers.ts';

// Wave 25 (E45-13 to E45-16): the risk-ranked audit plan and its approval, workpapers with preparer and reviewer
// sign-off, the auditor's verification before a finding closes, and control tests that are part of an
// audit. Invented data only.

/** The shared evidence library (module `evidence`), when it is part of this tree. */
const HAS_EVIDENCE = existsSync(join(import.meta.dirname, '..', 'evidence', 'index.ts'));
let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let lead: Client;      // audit lead: audits.*, controls.*, actions.*
let second: Client;    // another audit lead, the reviewer
let compliance: Client; // compliance officer: controls.*, audits.view only
let today = dayInZone();
// Worked out again before each test, so a run that crosses midnight compares with the day the server uses.
beforeEach(() => { today = dayInZone(); });
const loadMode = (on: boolean) => (on
  ? t.db.query(`insert into settings (key, value) values ('data_load.mode', $1::jsonb) on conflict (key) do update set value = excluded.value`,
    [JSON.stringify({ until: new Date(Date.now() + 86_400_000).toISOString() })])
  : t.db.query(`delete from settings where key = 'data_load.mode'`));

beforeAll(async () => {
  process.env.GRC_MODULES = `audits,risks,controls,workflows,notifications,attachments,work${HAS_EVIDENCE ? ',evidence,people' : ''}`;
  t = await testApp();
  lead = await t.as('audit_lead');
  second = await t.as('audit_lead');
  compliance = await t.as('compliance_officer');
}, 120_000);
afterAll(async () => { delete process.env.GRC_MODULES; await t?.close(); });

async function auditWithSteps(prompts: string[], extra: Record<string, unknown> = {}) {
  const tpl = (await lead.post('/api/checklist-templates', { name: `Invented program ${Math.random().toString(36).slice(2, 7)}`, kind: 'audit' })).body;
  const items = (await lead.put(`/api/checklist-templates/${tpl.id}/items`, { items: prompts.map((prompt) => ({ prompt })) })).body.items as { id: string }[];
  const audit = (await lead.post('/api/audits', { title: 'Invented audit of fuel card use', audit_type: 'internal_audit', template_id: tpl.id, lead_auditor_id: lead.userId, ...extra })).body;
  await lead.patch(`/api/audits/${audit.id}`, { status: 'fieldwork' });
  return { audit, items };
}

describe('risk score', () => {
  it('weights the factors and stays between 0 and 100', () => {
    const w = { residual: 50, time: 50, result: 0, change: 0, significance: 0 };
    expect(scoreOf({ residual: 1, time: 0, result: 1, change: 1, significance: 1 }, w)).toBe(50);
    expect(scoreOf({ residual: 1, time: 1, result: 0, change: 0, significance: 0 }, w)).toBe(100);
    expect(scoreOf({ residual: 2, time: -1, result: 0, change: 0, significance: 0 }, w)).toBe(50);
    expect(timeFactor(null, 12, today, 36)).toBe(1);
    expect(timeFactor(addMonths(today, -6), 12, today, 36)).toBeGreaterThan(0.45);
    expect(timeFactor(addMonths(today, -6), 12, today, 36)).toBeLessThan(0.55);
    expect(timeFactor(addMonths(today, -30), 12, today, 36)).toBe(1);
    expect(factorOfValue([{ value: 'high', label: 'High', meta: { factor: 0.9 } }], 'high', 0)).toBe(0.9);
    expect(factorOfValue([], 'medium', 0)).toBe(0.6);
    expect(factorOfValue([], null, 0.5)).toBe(0.5);
    expect(cleanSettings({ weights: { residual: 0, time: 0, result: 0, change: 0, significance: 0 } }).weights.residual).toBe(35);
  });

  it('ranks areas by risk, with linked risks\' residual rating, and proposes up to the capacity', async () => {
    const quiet = (await lead.post('/api/audit-areas', { name: 'Invented stationery ordering', cycle_months: 36, significance: 'low', change_level: 'none', risk_level: 'low' })).body;
    await t.db.query('update audit_areas set last_audited_on = $2 where id = $1', [quiet.id, addMonths(today, -3)]);
    const hot = (await lead.post('/api/audit-areas', { name: 'Invented depot fuel management', cycle_months: 12, significance: 'high', change_level: 'high', risk_level: 'low' })).body;
    // A linked risk with a high residual rating lifts the area, whatever its own risk level says.
    const risk = (await t.api.post('/api/risks', { title: 'Invented fuel theft', category: 'cyber', inherent_likelihood: 5, inherent_impact: 5, residual_likelihood: 5, residual_impact: 4 })).body;
    expect(risk.id).toBeTruthy();
    expect((await t.api.post('/api/links', { from_type: 'audit_area', from_id: hot.id, to_type: 'risk', to_id: risk.id, relation: 'covered by' })).status).toBe(201);
    expect((await lead.put('/api/audits/plan/settings', { weights: { residual: 40, time: 20, result: 10, change: 20, significance: 10 }, capacity: 1 })).status).toBe(200);
    const plan = await lead.get(`/api/audits/plan?year=${Number(today.slice(0, 4)) + 1}`);
    expect(plan.status).toBe(200);
    const h = plan.body.areas.find((a: any) => a.id === hot.id);
    const q = plan.body.areas.find((a: any) => a.id === quiet.id);
    expect(h.score).toBeGreaterThan(q.score);
    expect(h.rank).toBeLessThan(q.rank);
    expect(h.linked_risks).toBe(1);
    expect(h.highest_residual).toEqual({ score: 20, max: 25 });
    expect(h.factors.residual).toBeCloseTo(0.8);
    expect(h.never_audited).toBe(true);
    expect(plan.body.areas.filter((a: any) => a.proposed)).toHaveLength(1);
    expect(plan.body.areas[0].proposed).toBe(true);
    // Someone who may not see restricted risks gets the same score (figures are the same for everyone).
    const other = await compliance.get(`/api/audits/plan?year=${Number(today.slice(0, 4)) + 1}`);
    expect(other.body.areas.find((a: any) => a.id === hot.id).score).toBe(h.score);
    expect(JSON.stringify(other.body)).not.toContain('Invented fuel theft');
    // The score is stored on the area for the universe list.
    expect(Number((await lead.get(`/api/audit-areas/${hot.id}`)).body.risk_score)).toBe(h.score);
    // Only someone who administers audits changes the weights.
    expect((await compliance.put('/api/audits/plan/settings', { weights: { residual: 1, time: 1, result: 1, change: 1, significance: 1 } })).status).toBe(403);
    expect((await lead.put('/api/audits/plan/settings', { weights: { residual: 0, time: 0, result: 0, change: 0, significance: 0 } })).status).toBe(400);
  });

  it('saves the year\'s plan as versions, approved by someone other than its preparer', async () => {
    const year = Number(today.slice(0, 4)) + 1;
    const v1 = await lead.post('/api/audits/plans', { year, note: 'First draft.' });
    expect(v1.status).toBe(201);
    expect(v1.body).toMatchObject({ plan_year: year, version: 1, status: 'draft', included: 1 });
    expect((await lead.post(`/api/audits/plans/${v1.body.id}/approve`, {})).status).toBe(403); // the preparer
    const areas = (await lead.get(`/api/audits/plan?year=${year}`)).body.areas.map((a: any) => a.id);
    const v2 = await lead.post('/api/audits/plans', { year, included: areas });
    expect(v2.body.version).toBe(2);
    expect((await second.post(`/api/audits/plans/${v1.body.id}/approve`, {})).status).toBe(409); // not the newest
    expect((await second.post(`/api/audits/plans/${v2.body.id}/approve`, { approved_on: '2020-01-01' })).status).toBe(400); // only in a data load
    const ok = await second.post(`/api/audits/plans/${v2.body.id}/approve`, { note: 'Approved by the committee.' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'approved', approved_on: today, approval_note: 'Approved by the committee.' });
    expect(ok.body.approved_by_name).toBeTruthy();
    expect((await second.post(`/api/audits/plans/${v2.body.id}/approve`, {})).status).toBe(409); // never changed again
    const listed = (await lead.get(`/api/audits/plan?year=${year}`)).body.versions;
    expect(listed.map((v: any) => [v.version, v.status])).toEqual([[2, 'approved'], [1, 'superseded']]);
    const made = await lead.post(`/api/audits/plans/${v2.body.id}/create-audits`, {});
    expect(made.status).toBe(201);
    expect(made.body.created.length).toBe(areas.length);
    expect((await lead.post(`/api/audits/plans/${v2.body.id}/create-audits`, {})).body.created).toHaveLength(0);
  });
});

describe('workpaper sign-off', () => {
  it('records procedure, sample and result, then preparer and reviewer sign-off by different people, and locks the step', async () => {
    const { audit, items } = await auditWithSteps(['Fuel cards are issued only to named drivers']);
    const step = items[0].id;
    const url = `/api/audits/${audit.id}/checklist`;
    // Nothing to sign before there is a result.
    expect((await lead.post(`/api/audits/${audit.id}/steps/${step}/prepare`, {})).status).toBe(400);
    const saved = await lead.put(url, { item_id: step, procedure: 'Compare the card list with the roster.', sample: 'All 40 cards.', result: 'exceptions', note: 'Two cards held by people who left.' });
    expect(saved.status).toBe(200);
    expect(saved.body.responses[step]).toMatchObject({ result: 'exceptions', answer: 'no', procedure: 'Compare the card list with the roster.', sample: 'All 40 cards.' });
    expect((await lead.put(url, { item_id: step, result: 'not-a-result' })).status).toBe(400);
    // The reviewer cannot sign before the preparer.
    expect((await second.post(`/api/audits/${audit.id}/steps/${step}/review`, {})).status).toBe(409);
    expect((await lead.post(`/api/audits/${audit.id}/steps/${step}/prepare`, {})).status).toBe(200);
    // The preparer cannot review their own step.
    const own = await lead.post(`/api/audits/${audit.id}/steps/${step}/review`, {});
    expect(own.status).toBe(403);
    expect(own.body.error.code).toBe('not_independent');
    // A change withdraws the preparer's sign-off.
    await lead.put(url, { item_id: step, sample: 'All 41 cards.' });
    expect((await second.post(`/api/audits/${audit.id}/steps/${step}/review`, {})).status).toBe(409);
    await lead.post(`/api/audits/${audit.id}/steps/${step}/prepare`, {});
    const reviewed = await second.post(`/api/audits/${audit.id}/steps/${step}/review`, {});
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.responses[step]).toMatchObject({ locked: true, prepared_by: lead.userId, reviewed_by: second.userId });
    expect(reviewed.body.reviewed).toBe(1);
    // Locked: no more changes, notes or signatures.
    expect((await lead.put(url, { item_id: step, note: 'Late change.' })).status).toBe(409);
    expect((await second.post(`/api/audits/${audit.id}/steps/${step}/notes`, { note: 'x' })).status).toBe(409);
    expect((await lead.post(`/api/audits/${audit.id}/steps/${step}/prepare`, {})).status).toBe(409);
  });

  it('sends a step back with a review note that only its preparer clears', async () => {
    const { audit, items } = await auditWithSteps(['Monthly fuel reconciliations are signed']);
    const step = items[0].id;
    await lead.put(`/api/audits/${audit.id}/checklist`, { item_id: step, result: 'satisfactory' });
    await lead.post(`/api/audits/${audit.id}/steps/${step}/prepare`, {});
    expect((await lead.post(`/api/audits/${audit.id}/steps/${step}/notes`, { note: 'Self note' })).status).toBe(403);
    expect((await second.post(`/api/audits/${audit.id}/steps/${step}/notes`, {})).status).toBe(400);
    const raised = await second.post(`/api/audits/${audit.id}/steps/${step}/notes`, { note: 'Which months did you look at?' });
    expect(raised.status).toBe(201);
    const r = raised.body.responses[step];
    expect(r.prepared_at).toBeNull();
    expect(r.notes).toHaveLength(1);
    expect(raised.body.open_notes).toBe(1);
    const noteId = r.notes[0].id;
    // In the preparer's My work.
    const mine = await lead.get('/api/work/mine?limit=50');
    expect(mine.status).toBe(200);
    expect(mine.body.sections.map((s: any) => s.key)).toContain('audits.review_notes');
    expect(mine.body.sections.find((s: any) => s.key === 'audits.review_notes')?.items.length).toBeGreaterThanOrEqual(1);
    // Signing again, or reviewing, waits for the note; only the preparer clears it.
    expect((await lead.post(`/api/audits/${audit.id}/steps/${step}/prepare`, {})).status).toBe(409);
    expect((await second.post(`/api/audits/${audit.id}/steps/${step}/notes/${noteId}/clear`, { response: 'Done' })).status).toBe(403);
    expect((await lead.post(`/api/audits/${audit.id}/steps/${step}/notes/${noteId}/clear`, {})).status).toBe(400);
    expect((await lead.post(`/api/audits/${audit.id}/steps/${step}/notes/${noteId}/clear`, { response: 'January to June; added to the sample.' })).status).toBe(200);
    expect((await lead.post(`/api/audits/${audit.id}/steps/${step}/prepare`, {})).status).toBe(200);
    expect((await second.post(`/api/audits/${audit.id}/steps/${step}/review`, {})).status).toBe(200);
  });

  it('keeps the audit open until every worked step is reviewed', async () => {
    const { audit, items } = await auditWithSteps(['Step one', 'Step two']);
    await lead.put(`/api/audits/${audit.id}/checklist`, { responses: items.map((i) => ({ item_id: i.id, result: 'satisfactory' })) });
    await lead.patch(`/api/audits/${audit.id}`, { status: 'reporting', report_summary: 'Invented summary.' });
    const state = await lead.get(`/api/audits/${audit.id}/report-approval`);
    expect(state.body.problems.join(' ')).toContain('2 workpaper steps still need');
    const status = await lead.get(`/api/audits/${audit.id}/workpaper-status`);
    expect(status.body.steps).toEqual({ total: 2, worked: 2, prepared: 0, reviewed: 0 });
    for (const i of items) {
      await lead.post(`/api/audits/${audit.id}/steps/${i.id}/prepare`, {});
      await second.post(`/api/audits/${audit.id}/steps/${i.id}/review`, {});
    }
    expect((await lead.get(`/api/audits/${audit.id}/report-approval`)).body.problems).toEqual([]);
  });

  it('loads a past audit with sign-offs by the people named, keeping them apart', async () => {
    const { audit, items } = await auditWithSteps(['Invented historic step']);
    const step = items[0].id;
    await loadMode(true);
    try {
      expect((await t.api.put(`/api/audits/${audit.id}/checklist`, { item_id: step, result: 'satisfactory', on_behalf_of: 'name:Invented Former Auditor' })).status).toBe(200);
      const prep = await t.api.post(`/api/audits/${audit.id}/steps/${step}/prepare`, { prepared_at: '2023-03-01T10:00:00Z', on_behalf_of: 'name:Invented Former Auditor' });
      expect(prep.status).toBe(200);
      // The same named person cannot also review.
      expect((await t.api.post(`/api/audits/${audit.id}/steps/${step}/review`, { on_behalf_of: 'name:Invented Former Auditor' })).status).toBe(403);
      const rev = await t.api.post(`/api/audits/${audit.id}/steps/${step}/review`, { reviewed_at: '2023-03-05T10:00:00Z', on_behalf_of: 'name:Invented Former Audit Manager' });
      expect(rev.status).toBe(200);
      expect(rev.body.responses[step]).toMatchObject({ prepared_by_name: 'Invented Former Auditor', reviewed_by_name: 'Invented Former Audit Manager', prepared_by: null });
      expect(new Date(rev.body.responses[step].reviewed_at).toISOString()).toBe('2023-03-05T10:00:00.000Z');
    } finally { await loadMode(false); }
    // Outside a load the time is now.
    const other = await auditWithSteps(['Another step']);
    await lead.put(`/api/audits/${other.audit.id}/checklist`, { item_id: other.items[0].id, result: 'satisfactory' });
    expect((await lead.post(`/api/audits/${other.audit.id}/steps/${other.items[0].id}/prepare`, { prepared_at: '2023-03-01T10:00:00Z' })).status).toBe(400);
    expect(samePerson({ id: null, name: 'A Person' }, { id: null, name: 'a person ' })).toBe(true);
    expect(samePerson({ id: 'x', name: 'A' }, { id: 'y', name: 'A' })).toBe(false);
  });
});

describe.skipIf(!HAS_EVIDENCE)('evidence library on workpapers and verifications', () => {
  it('lists evidence records linked to a step, refuses new links once it is reviewed, and verifies with linked evidence', async () => {
    const { audit, items } = await auditWithSteps(['Invented step with shared evidence'], { lead_auditor_id: second.userId });
    const step = items[0].id;
    const ev = await t.api.post('/api/evidence-library', { title: 'Invented fuel card register', source: 'link', url: 'https://documents.example.test/fuel-cards' });
    expect(ev.status, JSON.stringify(ev.body)).toBe(201);
    const link = await t.api.post('/api/evidence-links', { evidence_id: ev.body.id, record_type: 'audit_engagement', record_id: audit.id, part: `step:${step}` });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    await lead.put(`/api/audits/${audit.id}/checklist`, { item_id: step, result: 'satisfactory' });
    const view = await t.api.get(`/api/audits/${audit.id}/checklist`);
    expect(view.body.responses[step].evidence).toEqual([expect.objectContaining({ id: ev.body.id, label: 'Invented fuel card register' })]);
    await lead.post(`/api/audits/${audit.id}/steps/${step}/prepare`, {});
    await second.post(`/api/audits/${audit.id}/steps/${step}/review`, {});
    const ev2 = (await t.api.post('/api/evidence-library', { title: 'Invented later document', source: 'link', url: 'https://documents.example.test/later' })).body;
    expect((await t.api.post('/api/evidence-links', { evidence_id: ev2.id, record_type: 'audit_engagement', record_id: audit.id, part: `step:${step}` })).status).toBe(409);
    // ...and keeps the evidence it was reviewed with (E45-19).
    const unlink = await t.api.del(`/api/evidence-links/${link.body.id}`);
    expect(unlink.status).toBe(409);
    expect(unlink.body.error.code).toBe('part_locked');
    // Verification with an evidence record linked to the finding.
    const f = (await lead.post('/api/audit-findings', { title: 'Invented finding verified from the library', source_type: 'audit_engagement', source_id: audit.id, management_response: 'Fixed.' })).body;
    expect((await second.post(`/api/audit-findings/${f.id}/verify`, { note: 'Checked the register.', evidence_ids: [ev.body.id] })).status).toBe(400);
    expect((await t.api.post('/api/evidence-links', { evidence_id: ev.body.id, record_type: 'audit_finding', record_id: f.id })).status).toBe(201);
    const ok = await second.post(`/api/audit-findings/${f.id}/verify`, { note: 'Checked the register.', evidence_ids: [ev.body.id] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.verification_evidence_ids).toEqual([ev.body.id]);
  });
});

describe('finding verification', () => {
  it('closes a finding only after an auditor who does not own the fix records verification with evidence and a date', async () => {
    const { audit } = await auditWithSteps(['Invented step'], { lead_auditor_id: second.userId });
    const f = (await lead.post('/api/audit-findings', {
      title: 'Fuel cards not withdrawn on leaving', source_type: 'audit_engagement', source_id: audit.id, rating: 'minor_nonconformity', response_owner_id: lead.userId,
    })).body;
    expect(f.verifier_id).toBe(second.userId); // the audit's lead auditor
    // No closing without verification, and nothing to verify before a response.
    const refused = await lead.patch(`/api/audit-findings/${f.id}`, { status: 'closed' });
    expect(refused.status).toBe(400);
    expect(refused.body.error.fields.status).toContain('verification');
    expect((await second.post(`/api/audit-findings/${f.id}/verify`, { note: 'x', attachment_ids: [] })).status).toBe(400);
    await lead.patch(`/api/audit-findings/${f.id}`, { management_response: 'Cards are now withdrawn on the leaver checklist.' });
    const ready = await lead.post(`/api/audit-findings/${f.id}/ready-for-verification`, {});
    expect(ready.status).toBe(200);
    expect(ready.body).toMatchObject({ status: 'awaiting_verification', verification_due: addDays(today, 30) });
    // In the verifier's My work.
    const mine = await second.get('/api/work/mine?days=60&limit=50');
    expect(mine.body.sections.find((s: any) => s.key === 'audits.verifications')?.items.some((i: any) => i.recordId === f.id)).toBe(true);
    // The response owner may not verify their own fix.
    const self = await lead.post(`/api/audit-findings/${f.id}/verify`, { note: 'Fixed.', attachment_ids: [] });
    expect(self.status).toBe(403);
    // Evidence is required, and must be on the finding.
    expect((await second.post(`/api/audit-findings/${f.id}/verify`, { note: 'Checked.' })).status).toBe(400);
    expect((await second.post(`/api/audit-findings/${f.id}/verify`, { note: 'Checked.', verified_on: addDays(today, 2), attachment_ids: [] })).status).toBe(400);
    const file = await second.post('/api/attachments/link', { record_type: 'audit_finding', record_id: f.id, url: 'https://documents.example.test/leaver-checklist', title: 'Leaver checklist sample', evidence: true });
    expect(file.status).toBe(201);
    const done = await second.post(`/api/audit-findings/${f.id}/verify`, { note: 'Sampled five leavers: each card withdrawn.', attachment_ids: [file.body.id], verified_on: addDays(today, -1) });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: 'closed', verified_on: addDays(today, -1), verified_by: second.userId, verification_attachment_ids: [file.body.id] });
    expect((await second.post(`/api/audit-findings/${f.id}/verify`, { note: 'Again.', attachment_ids: [file.body.id] })).status).toBe(409);
  });

  it('shows overdue verification on the audit and the dashboard, and waits for the plan owners to step aside', async () => {
    const { audit } = await auditWithSteps(['Invented step'], { lead_auditor_id: second.userId });
    const f = (await lead.post('/api/audit-findings', { title: 'Invented late fix', source_type: 'audit_engagement', source_id: audit.id, response_owner_id: compliance.userId })).body;
    const cap = await lead.post(`/api/audit-findings/${f.id}/cap`, { responsible_id: lead.userId });
    expect(cap.status).toBe(201);
    await t.db.query(`update audit_findings set status = 'awaiting_verification', verification_due = $2 where id = $1`, [f.id, addDays(today, -3)]);
    const s = await lead.get(`/api/audits/${audit.id}/workpaper-status`);
    expect(s.body.findings).toMatchObject({ awaiting_verification: 1, verification_overdue: 1 });
    expect((await lead.get('/api/audits/summary')).body.findings.verification_overdue).toBeGreaterThanOrEqual(1);
    const mine = await second.get('/api/work/mine?limit=50');
    const item = mine.body.sections.find((x: any) => x.key === 'audits.verifications')?.items.find((i: any) => i.recordId === f.id);
    expect(item).toBeTruthy();
    // The plan's responsible person owns the fix too, so cannot verify it.
    const own = await lead.post(`/api/audit-findings/${f.id}/verify`, { note: 'Done.', attachment_ids: [] });
    expect(own.status).toBe(403);
  });

  it('makes a finding ready for verification when its corrective action plan reaches Verifying', async () => {
    const { audit } = await auditWithSteps(['Invented step'], { lead_auditor_id: second.userId });
    const f = (await lead.post('/api/audit-findings', { title: 'Invented plan-driven fix', source_type: 'audit_engagement', source_id: audit.id })).body;
    const cap = (await lead.post(`/api/audit-findings/${f.id}/cap`, {})).body.cap;
    // The plan's own steps are the risks module's: moved here as a data load, which skips them.
    await loadMode(true);
    try {
      const moved = await t.api.patch(`/api/caps/${cap.id}`, { status: 'verifying' });
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    } finally { await loadMode(false); }
    const after = (await lead.get(`/api/audit-findings/${f.id}`)).body;
    expect(after).toMatchObject({ status: 'awaiting_verification', verifier_id: second.userId });
    expect(after.verification_due).toBeTruthy();
  });
});

describe('control tests that are part of an audit', () => {
  it('needs a reviewer who is not the tester and may work on audits, and keeps the audit open until reviewed', async () => {
    const { audit } = await auditWithSteps(['Invented step']);
    const control = (await lead.post('/api/controls', { title: 'Invented fuel card approval', owner_id: lead.userId })).body;
    expect(control.id).toBeTruthy();
    const test = await lead.post('/api/control-tests', { control_id: control.id, audit_id: audit.id, tester_id: lead.userId, test_type: 'operating' });
    expect(test.status).toBe(201);
    expect(test.body.audit_id).toBe(audit.id);
    await lead.patch(`/api/control-tests/${test.body.id}`, { result: 'effective', performed_on: today, status: 'complete' });
    await lead.patch(`/api/audits/${audit.id}`, { status: 'reporting', report_summary: 'Invented.' });
    expect((await lead.get(`/api/audits/${audit.id}/report-approval`)).body.problems.join(' ')).toContain('control test');
    expect((await lead.post(`/api/control-tests/${test.body.id}/review`, {})).status).toBe(403); // the tester
    const noAudit = await compliance.post(`/api/control-tests/${test.body.id}/review`, {});
    expect(noAudit.status).toBe(403); // may review controls, but not work on audits
    const ok = await second.post(`/api/control-tests/${test.body.id}/review`, { note: 'Agreed.' });
    expect(ok.status).toBe(200);
    expect(ok.body.test).toMatchObject({ reviewer_id: second.userId, status: 'reviewed' });
    expect(ok.body.test.reviewer_name).toBeTruthy();
    expect((await lead.get(`/api/audits/${audit.id}/report-approval`)).body.problems).toEqual([]);
  });
});
