import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef } from '../../core/module.ts';
import { dayInZone, todayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { runCertificationRollover } from './certifications.ts';
import mod from './index.ts';
import { readSampleAreas, validateAreaSet } from './reviews.ts';

// Stand-ins for the contracts other wave 10 modules provide, so funding is tested on its own:
// C1 the corrective action plan (`cap`, risks module) and C5 the obligation's type and frequency.
const standIn: ModuleDef = {
  key: 'fundingstandins',
  async seedDefaults(ctx) {
    await ctx.db.exec(`
      create table if not exists t_caps (
        id uuid primary key default gen_random_uuid(), ref text, title text not null, source text, source_type text, source_id uuid,
        problem_statement text, responsible_id uuid, due_on date, status text, restricted boolean not null default false,
        created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);
      create table if not exists t_obligations (
        id uuid primary key default gen_random_uuid(), ref text, title text not null, source text, requirement text, owner_id uuid,
        next_due_on date, status text, type text, frequency text,
        created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
    await ctx.lookups.ensure('cap_status', [
      { value: 'draft', label: 'Draft', sort: 10 }, { value: 'in_progress', label: 'In progress', sort: 20 },
      { value: 'closed', label: 'Closed', sort: 30, meta: { closed: true } },
    ], { module: 'actions' });
    await ctx.lookups.ensure('obligation_type', [{ value: 'funding_condition', label: 'Funding condition', sort: 10 }], { module: 'obligations' });
    await ctx.lookups.ensure('obligation_frequency', ['once', 'monthly', 'quarterly', 'half_yearly', 'yearly'].map((v, i) => ({ value: v, label: v, sort: i })), { module: 'obligations' });
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'cap', table: 't_caps', module: 'actions', label: 'Corrective action plan', plural: 'Corrective action plans',
      path: '/api/caps', route: '/caps', titleField: 'title', ref: { field: 'ref', prefix: 'CAP-' },
      restricted: 'flag', restrictedFrom: { typeField: 'source_type', idField: 'source_id' },
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true }, title: { label: 'Title', type: 'text', required: true },
        source: { label: 'Source', type: 'text' }, source_type: { label: 'Source type', type: 'text' }, source_id: { label: 'Source id', type: 'text' },
        problem_statement: { label: 'Problem', type: 'longtext' }, responsible_id: { label: 'Responsible', type: 'user' },
        due_on: { label: 'Due', type: 'date' }, status: { label: 'Status', type: 'lookup', list: 'cap_status', default: 'draft' },
        restricted: { label: 'Restricted', type: 'boolean', readOnly: true },
      },
    });
    ctx.defineResource({
      type: 'obligation', table: 't_obligations', module: 'obligations', label: 'Obligation', plural: 'Obligations',
      path: '/api/obligations', route: '/obligations', titleField: 'title', ref: { field: 'ref', prefix: 'OBL-' },
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true }, title: { label: 'Obligation', type: 'text', required: true },
        source: { label: 'Source', type: 'text' }, requirement: { label: 'Requirement', type: 'longtext' }, owner_id: { label: 'Owner', type: 'user' },
        next_due_on: { label: 'Next due', type: 'date' }, status: { label: 'Status', type: 'text' },
        type: { label: 'Type', type: 'lookup', list: 'obligation_type' }, frequency: { label: 'Frequency', type: 'lookup', list: 'obligation_frequency' },
      },
    });
  },
};

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let officer: Client;   // compliance officer: funding.*, obligations.*, actions.*, contracts.view, assets.view
let signer: Client;    // a second compliance officer, the authorized official
let auditor: Client;   // funding.view only
let agent: Client;     // no funding permissions
let awardId: string;
let certId: string;
let reviewId: string;
let setId: string;

const audit = (action: string, recordId: string) =>
  t.db.query<any>('select * from audit_events where action = $1 and record_id = $2 order by id', [action, recordId]);

beforeAll(async () => {
  process.env.GRC_MODULES = 'funding,workflows,inventory,vendors';
  t = await testApp({ extraModules: [standIn] });
  officer = await t.as('compliance_officer');
  signer = await t.as('compliance_officer');
  auditor = await t.as('auditor');
  agent = await t.as('agent');
}, 60_000);
afterAll(async () => { await t.close(); });

describe('awards', () => {
  it('creates an award with a reference and checks its numbers', async () => {
    expect((await officer.post('/api/funding-awards', { title: 'Invented award', amount: -5 })).body.error.fields.amount).toBeTruthy();
    expect((await officer.post('/api/funding-awards', { title: 'Invented award', period_start: '2027-01-01', period_end: '2026-01-01' })).body.error.fields.period_end).toBeTruthy();
    const res = await officer.post('/api/funding-awards', {
      title: 'Invented bus award', funder_name: 'Invented Fund', status: 'applied', amount: 1000000, local_share: 250000,
      reporting_frequency: 'quarterly', next_report_due: dayInZone(10), closeout_due: dayInZone(400), manager_id: officer.userId,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.ref).toBe('AWD-00001');
    awardId = res.body.id;
  });

  it('makes the reporting and close-out obligations once the award is awarded, and only once', async () => {
    expect((await officer.get(`/api/funding-awards/${awardId}/obligations`)).body.rows).toEqual([]);
    expect((await officer.patch(`/api/funding-awards/${awardId}`, { status: 'active' })).status).toBe(200);
    const list = (await officer.get(`/api/funding-awards/${awardId}/obligations`)).body;
    expect(list.available).toBe(true);
    expect(list.rows).toHaveLength(2);
    const report = list.rows.find((r: any) => r.frequency === 'quarterly');
    expect(report.next_due_on).toBe(dayInZone(10));
    expect(list.rows.find((r: any) => r.frequency === 'once').next_due_on).toBe(dayInZone(400));
    const ob = await t.db.one<any>('select * from t_obligations where id = $1', [report.id]);
    expect(ob.type).toBe('funding_condition');
    expect(ob.owner_id).toBe(officer.userId);
    await officer.patch(`/api/funding-awards/${awardId}`, { notes: 'Changed' });
    expect((await officer.post(`/api/funding-awards/${awardId}/obligations`)).body.created).toEqual([]);
    expect((await t.db.query('select * from t_obligations')).length).toBe(2);
  });

  it('records what the award paid for', async () => {
    const asset = await t.api.post('/api/assets', { name: 'Invented depot charger' });
    expect(asset.status).toBe(201);
    expect((await officer.post(`/api/funding-awards/${awardId}/funded-items`, { type: 'policy', id: asset.body.id })).status).toBe(400);
    expect((await officer.post(`/api/funding-awards/${awardId}/funded-items`, { type: 'asset', id: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
    const linked = await officer.post(`/api/funding-awards/${awardId}/funded-items`, { type: 'asset', id: asset.body.id });
    expect(linked.status).toBe(201);
    expect((await officer.post(`/api/funding-awards/${awardId}/funded-items`, { type: 'asset', id: asset.body.id })).status).toBe(200);
    const items = (await officer.get(`/api/funding-awards/${awardId}/funded-items`)).body;
    expect(items.items).toHaveLength(1);
    expect(items.items[0]).toMatchObject({ type: 'asset', title: 'Invented depot charger', route: `/assets/${asset.body.id}` });
    // The link is the generic relation, so the asset's own Related panel shows it too.
    const related = (await t.api.get(`/api/links?record_type=asset&record_id=${asset.body.id}`)).body;
    expect(related.some((l: any) => l.relation === 'funded_by' && l.recordId === awardId)).toBe(true);
    expect((await agent.post(`/api/funding-awards/${awardId}/funded-items`, { type: 'asset', id: asset.body.id })).status).toBe(403);
    expect((await auditor.del(`/api/funding-awards/${awardId}/funded-items/${linked.body.link_id}`)).status).toBe(403);
    expect((await officer.del(`/api/funding-awards/${awardId}/funded-items/${linked.body.link_id}`)).status).toBe(200);
    expect((await officer.get(`/api/funding-awards/${awardId}/funded-items`)).body.items).toHaveLength(0);
    expect((await audit('funding_award.unfund', awardId)).length).toBe(1);
  });

  it('keeps funding records from people without the permission', async () => {
    expect((await agent.get('/api/funding-awards')).status).toBe(403);
    expect((await agent.get('/api/funding/summary')).status).toBe(403);
    expect((await auditor.get('/api/funding-awards')).body.total).toBe(1);
    expect((await auditor.patch(`/api/funding-awards/${awardId}`, { title: 'x' })).status).toBe(403);
  });
});

describe('yearly certifications', () => {
  let items: any[] = [];
  it('builds a checklist on a draft', async () => {
    const res = await officer.post('/api/funding-certifications', { year: 2026, title: 'Invented yearly certifications', funder_name: 'Invented Fund', signer_id: signer.userId, status: 'signed' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe('draft');
    expect(res.body.ref).toBe('CER-00001');
    certId = res.body.id;
    expect((await officer.post('/api/funding-certifications', { year: 12, title: 'x' })).body.error.fields.year).toBeTruthy();
    expect((await officer.post(`/api/funding-certifications/${certId}/items`, {})).body.error.fields.statement).toBeTruthy();
    expect((await officer.post(`/api/funding-certifications/${certId}/items`, { statement: 'x', category: 'nope' })).body.error.fields.category).toBeTruthy();
    for (const [statement, responsible] of [['Invented statement one', signer.userId], ['Invented statement two', officer.userId], ['Invented statement three', null]]) {
      expect((await officer.post(`/api/funding-certifications/${certId}/items`, { statement, category: 'general', responsible_id: responsible })).status).toBe(201);
    }
    items = (await officer.get(`/api/funding-certifications/${certId}/items`)).body.items;
    expect(items.map((i) => i.sort)).toEqual([10, 20, 30]);
    expect((await officer.patch(`/api/funding-certifications/${certId}/items/${items[2].id}`, { applies: false })).body.applies).toBe(false);
  });

  it('needs every applicable item confirmed before signing', async () => {
    const before = await officer.post(`/api/funding-certifications/${certId}/sign-request`);
    expect(before.status).toBe(409);
    expect(before.body.error.code).toBe('unconfirmed');
    // The person responsible confirms their own item; someone else without edit rights cannot.
    expect((await auditor.post(`/api/funding-certifications/${certId}/items/${items[0].id}/confirm`)).status).toBe(403);
    expect((await signer.post(`/api/funding-certifications/${certId}/items/${items[0].id}/confirm`, { note: 'Checked' })).body.confirmed_by).toBe(signer.userId);
    expect((await officer.post(`/api/funding-certifications/${certId}/items/${items[2].id}/confirm`)).status).toBe(409); // not applicable
    expect((await officer.post(`/api/funding-certifications/${certId}/items/${items[1].id}/confirm`)).body.confirmed_on).toBe(todayInZone());
    // Changing a confirmed statement needs it confirmed again.
    expect((await officer.patch(`/api/funding-certifications/${certId}/items/${items[1].id}`, { statement: 'Invented statement two, reworded' })).body.confirmed_on).toBeNull();
    expect((await officer.post(`/api/funding-certifications/${certId}/sign-request`)).status).toBe(409);
    await officer.post(`/api/funding-certifications/${certId}/items/${items[1].id}/confirm`);
    const progress = (await officer.get(`/api/funding-certifications/${certId}/sign-request`)).body;
    expect(progress).toMatchObject({ available: true, applicable: 2, confirmed: 2, request: null });
  });

  it('is signed by the authorized official through the approval workflow', async () => {
    const req = await officer.post(`/api/funding-certifications/${certId}/sign-request`, { note: 'Ready' });
    expect(req.status, JSON.stringify(req.body)).toBe(201);
    expect((await officer.get(`/api/funding-certifications/${certId}`)).body.status).toBe('in_review');
    // The checklist is locked while it waits.
    expect((await officer.post(`/api/funding-certifications/${certId}/items`, { statement: 'Late' })).status).toBe(409);
    expect((await officer.patch(`/api/funding-certifications/${certId}`, { signer_id: officer.userId })).status).toBe(400);
    expect((await officer.patch(`/api/funding-certifications/${certId}`, { status: 'signed' })).status).toBe(400);
    const wf = (await signer.get(`/api/workflows/records/funding_certification/${certId}`)).body;
    const step = wf.instances[0].steps[0];
    // Only the named official decides.
    expect((await officer.post(`/api/workflows/steps/${step.id}/decision`, { decision: 'approved' })).status).toBe(403);
    const decided = await signer.post(`/api/workflows/steps/${step.id}/decision`, { decision: 'approved' });
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
    const signed = (await officer.get(`/api/funding-certifications/${certId}`)).body;
    expect(signed.status).toBe('signed');
    expect(signed.signed_on).toBe(todayInZone());
    expect((await officer.patch(`/api/funding-certifications/${certId}`, { status: 'draft' })).status).toBe(400);
    expect((await officer.patch(`/api/funding-certifications/${certId}`, { status: 'submitted' })).body.status).toBe('submitted');
    expect((await audit('funding_certification.signed', certId)).length).toBe(1);
  });

  it('copies the items forward into next year\'s draft', async () => {
    const copy = await officer.post(`/api/funding-certifications/${certId}/copy-forward`);
    expect(copy.status).toBe(201);
    const next = (await officer.get(`/api/funding-certifications/${copy.body.id}`)).body;
    expect(next).toMatchObject({ year: 2027, status: 'draft', signer_id: signer.userId });
    const nextItems = (await officer.get(`/api/funding-certifications/${copy.body.id}/items`)).body.items;
    expect(nextItems).toHaveLength(3);
    expect(nextItems.every((i: any) => i.confirmed_on === null)).toBe(true);
    expect(nextItems[2].applies).toBe(false);
    expect((await officer.post(`/api/funding-certifications/${certId}/copy-forward`)).body).toMatchObject({ id: copy.body.id, created: false });
    // The daily job: before the month in the setting the coming year is this one (nothing to do);
    // from that month on it makes the next year's draft from the newest one.
    expect((await runCertificationRollover(t.ctx, '2027-03-10')).created).toBe(0);
    expect((await officer.put('/api/funding/settings', { certification_month: 13 })).status).toBe(400);
    expect((await auditor.put('/api/funding/settings', { certification_month: 3 })).status).toBe(403);
    expect((await officer.put('/api/funding/settings', { certification_month: 3 })).body.certification_month).toBe(3);
    expect((await auditor.get('/api/funding/settings')).body.certification_month).toBe(3);
    const rolled = await runCertificationRollover(t.ctx, '2027-03-10');
    expect(rolled).toEqual({ year: 2028, created: 1 });
    expect((await t.db.one<any>(`select count(*)::int as n from funding_certifications where year = 2028`)).n).toBe(1);
    expect((await runCertificationRollover(t.ctx, '2027-03-11')).created).toBe(0);
  });
});

describe('compliance reviews', () => {
  it('loads review areas from a file, checking it first', async () => {
    const bad = await officer.post('/api/funding/review-area-sets/import', { name: '', areas: [{ code: 'A A', title: '' }, { code: 'B' , title: 'B', questions: 'no' }] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.problems.length).toBeGreaterThanOrEqual(3);
    expect(validateAreaSet(readSampleAreas()).set?.areas).toHaveLength(12);
    const sample = (await officer.get('/api/funding/review-area-sets/sample')).body;
    const dry = await officer.post('/api/funding/review-area-sets/import', { file: sample, dryRun: true });
    expect(dry.body).toMatchObject({ dry_run: true, created: true, areas: { total: 12, added: 12 } });
    expect((await officer.get('/api/funding/review-area-sets')).body).toHaveLength(0);
    const loaded = await officer.post('/api/funding/review-area-sets/import', { file: sample, source_file: 'review-areas.sample.json' });
    expect(loaded.status).toBe(201);
    setId = loaded.body.set_id;
    const again = await officer.post('/api/funding/review-area-sets/import', sample);
    expect(again.body).toMatchObject({ created: false, areas: { unchanged: 12 } });
    expect((await auditor.post('/api/funding/review-area-sets/import', sample)).status).toBe(403);
    expect((await auditor.get(`/api/funding/review-area-sets/${setId}`)).body.areas).toHaveLength(12);
  });

  it('copies the areas into a review and records the self-assessment', async () => {
    const res = await officer.post('/api/compliance-reviews', { title: 'Invented funder review', funder_name: 'Invented Fund', lead_id: officer.userId });
    expect(res.status).toBe(201);
    expect(res.body.ref).toBe('CRV-00001');
    reviewId = res.body.id;
    expect((await officer.post(`/api/compliance-reviews/${reviewId}/areas/load`, { set_id: 'nope' })).status).toBe(400);
    expect((await officer.post(`/api/compliance-reviews/${reviewId}/areas/load`, { set_id: setId })).body.added).toBe(12);
    expect((await officer.post(`/api/compliance-reviews/${reviewId}/areas/load`, { set_id: setId })).body.added).toBe(0);
    const areas = (await auditor.get(`/api/compliance-reviews/${reviewId}/areas`)).body;
    expect(areas.set.id).toBe(setId);
    const fm = areas.areas.find((a: any) => a.area_code === 'FM');
    expect(fm.self_assessment).toBe('not_assessed');
    expect((await officer.put(`/api/compliance-reviews/${reviewId}/areas/FM`, { self_assessment: 'great' })).status).toBe(400);
    expect((await officer.put(`/api/compliance-reviews/${reviewId}/areas/FM`, { answers: ['a', 'b', 'c', 'd'] })).status).toBe(400);
    const saved = await officer.put(`/api/compliance-reviews/${reviewId}/areas/FM`, { self_assessment: 'deficient', answers: ['Yes', ' No '], owner_id: officer.userId, notes: 'Invented' });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.answers).toEqual(['Yes', 'No']);
    expect((await officer.put(`/api/compliance-reviews/${reviewId}/areas/ZZ`, { notes: 'x' })).status).toBe(404);
    expect((await auditor.put(`/api/compliance-reviews/${reviewId}/areas/FM`, { notes: 'x' })).status).toBe(403);
  });

  it('tracks document requests; the person asked may answer', async () => {
    const r = await officer.post(`/api/compliance-reviews/${reviewId}/requests`, { request: 'Invented ledger extract', area_code: 'FM', owner_id: auditor.userId, due_on: dayInZone(7) });
    expect(r.status).toBe(201);
    expect((await officer.post(`/api/compliance-reviews/${reviewId}/requests`, { request: 'x', area_code: 'ZZ' })).status).toBe(400);
    const answered = await auditor.patch(`/api/compliance-reviews/${reviewId}/requests/${r.body.id}`, { status: 'provided', response_note: 'Sent', request: 'Changed' });
    expect(answered.status).toBe(200);
    expect(answered.body).toMatchObject({ status: 'provided', response_note: 'Sent', request: 'Invented ledger extract' });
    const other = await officer.post(`/api/compliance-reviews/${reviewId}/requests`, { request: 'Invented second request' });
    expect((await auditor.patch(`/api/compliance-reviews/${reviewId}/requests/${other.body.id}`, { status: 'provided' })).status).toBe(403);
    expect((await officer.del(`/api/compliance-reviews/${reviewId}/requests/${other.body.id}`)).status).toBe(200);
    expect((await officer.get(`/api/compliance-reviews/${reviewId}/requests`)).body).toHaveLength(1);
  });

  it('raises a corrective action plan for a deficiency and closes the review only when all are closed', async () => {
    const d = await officer.post('/api/review-deficiencies', { title: 'Invented missing reconciliation', review_id: reviewId, area_code: 'FM', owner_id: officer.userId, due_on: dayInZone(30) });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    expect(d.body.ref).toBe('DEF-00001');
    expect((await officer.post('/api/review-deficiencies', { title: 'x', review_id: reviewId, area_code: 'ZZ' })).body.error.fields.area_code).toBeTruthy();
    // The review cannot close while the deficiency is open.
    const closing = await officer.patch(`/api/compliance-reviews/${reviewId}`, { status: 'closed' });
    expect(closing.status).toBe(400);
    expect(closing.body.error.fields.status).toMatch(/still open/);
    expect((await auditor.post(`/api/review-deficiencies/${d.body.id}/cap`)).status).toBe(403);
    const cap = await officer.post(`/api/review-deficiencies/${d.body.id}/cap`);
    expect(cap.status, JSON.stringify(cap.body)).toBe(201);
    const plan = await t.db.one<any>('select * from t_caps where id = $1', [cap.body.cap_id]);
    expect(plan).toMatchObject({ source: 'funding', source_type: 'review_deficiency', source_id: d.body.id, responsible_id: officer.userId });
    expect((await officer.post(`/api/review-deficiencies/${d.body.id}/cap`)).status).toBe(409);
    const def = (await officer.get(`/api/review-deficiencies/${d.body.id}`)).body;
    expect(def).toMatchObject({ cap_id: cap.body.cap_id, status: 'in_progress' });
    // The deficiency waits for its plan.
    expect((await officer.patch(`/api/review-deficiencies/${d.body.id}`, { status: 'closed' })).status).toBe(400);
    // Closing the plan closes the deficiency.
    await t.api.patch(`/api/caps/${cap.body.cap_id}`, { status: 'closed' });
    const after = (await officer.get(`/api/review-deficiencies/${d.body.id}`)).body;
    expect(after.status).toBe('closed');
    expect(after.closed_on).toBe(todayInZone());
    // A plan raised from the plan panel (the generic record type) is linked the same way.
    const d2 = await officer.post('/api/review-deficiencies', { title: 'Invented second gap', review_id: reviewId });
    const direct = await officer.post('/api/caps', { title: 'Invented plan', source: 'funding', source_type: 'review_deficiency', source_id: d2.body.id });
    expect(direct.status, JSON.stringify(direct.body)).toBe(201);
    expect((await officer.get(`/api/review-deficiencies/${d2.body.id}`)).body).toMatchObject({ cap_id: direct.body.id, status: 'in_progress' });
    await t.api.patch(`/api/caps/${direct.body.id}`, { status: 'closed' });
    expect((await officer.get(`/api/review-deficiencies/${d2.body.id}`)).body.status).toBe('closed');
    const closed = await officer.patch(`/api/compliance-reviews/${reviewId}`, { status: 'closed' });
    expect(closed.status).toBe(200);
    expect(closed.body.closed_on).toBe(todayInZone());
    // A closed review takes no new deficiencies or changes to its areas.
    expect((await officer.post('/api/review-deficiencies', { title: 'Late', review_id: reviewId })).status).toBe(400);
    expect((await officer.put(`/api/compliance-reviews/${reviewId}/areas/FM`, { notes: 'x' })).status).toBe(409);
  });
});

describe('funder-required contract clauses', () => {
  it('keeps a checklist per contract and award', async () => {
    const vendor = await t.api.post('/api/vendors', { name: 'Invented Builder' });
    const contract = await t.api.post('/api/contracts', { title: 'Invented station works', vendor_id: vendor.body.id });
    expect(contract.status, JSON.stringify(contract.body)).toBe(201);
    await officer.post(`/api/funding-awards/${awardId}/funded-items`, { type: 'contract', id: contract.body.id });
    const empty = (await officer.get(`/api/funding/contracts/${contract.body.id}/clauses`)).body;
    expect(empty.awards).toHaveLength(1);
    expect(empty.awards[0].checklist.every((c: any) => c.status === null)).toBe(true);
    expect((await officer.put(`/api/funding/contracts/${contract.body.id}/clauses`, { award_id: awardId, clause_key: 'nope', status: 'present' })).status).toBe(400);
    expect((await officer.put(`/api/funding/contracts/${contract.body.id}/clauses`, { award_id: awardId, clause_key: 'termination', status: 'maybe' })).status).toBe(400);
    expect((await officer.put(`/api/funding/contracts/${contract.body.id}/clauses`, { award_id: awardId, clause_key: 'termination', status: 'partial', note: 'Convenience only' })).status).toBe(200);
    const list = (await auditor.get(`/api/funding/contracts/${contract.body.id}/clauses`)).body;
    expect(list.awards[0].checklist.find((c: any) => c.clause_key === 'termination')).toMatchObject({ status: 'partial', note: 'Convenience only' });
    expect((await auditor.put(`/api/funding/contracts/${contract.body.id}/clauses`, { award_id: awardId, clause_key: 'termination', status: 'present' })).status).toBe(403);
    expect((await audit('contract.funding_clause', contract.body.id)).length).toBe(1);
    expect((await officer.get('/api/funding/contracts/00000000-0000-4000-8000-000000000000/clauses')).status).toBe(404);
  });
});

describe('dashboard and sample data', () => {
  it('sums awards, reports due, deficiencies, certifications and reviews', async () => {
    const s = (await auditor.get('/api/funding/summary')).body;
    expect(s.awards.by_status.find((x: any) => x.value === 'active')).toMatchObject({ count: 1, amount: 1000000 });
    expect(s.awards.open_amount).toBe(1000000);
    expect(s.reports.due_soon).toBe(1);
    expect(s.deficiencies.open).toBe(0);
    expect(s.reviews).toHaveLength(0); // the only review is closed
  });

  it('loads invented sample data once', async () => {
    const ctx = t.ctx;
    const first = await mod.seed!(ctx, { profile: 'dev', seedDir: 'none', organization: {} });
    expect(first).toMatch(/awards 4/);
    expect(first).toMatch(/20 items/);
    expect(first).toMatch(/1 plan/);
    const second = await mod.seed!(ctx, { profile: 'dev', seedDir: 'none', organization: {} });
    expect(second).not.toMatch(/awards 4/);
    expect((await t.db.one<any>(`select count(*)::int as n from funding_awards where title like '[Sample] %'`)).n).toBe(4);
    expect(await mod.seed!(ctx, { profile: 'pilot', seedDir: 'none', organization: {} })).toMatch(/dev profile only/);
  });
});
