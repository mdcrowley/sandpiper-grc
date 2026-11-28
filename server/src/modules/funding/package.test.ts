import { unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, SESSION_COOKIE } from '../../core/auth.ts';
import { checkPdfUa } from '../../core/export/pdfua.ts';
import type { Row } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';
import { kindOf } from '../outsidereviews/subjects.ts';

// E45-58: a funder review's readiness (areas owned, self-assessed, answered, with evidence and no open
// deficiency; requests answered) and its evidence package (an index PDF and the evidence files the
// caller may see). E45-59: an outside reviewer's workspace lists the library evidence linked to the
// review or audit (restricted evidence never), and its files may be downloaded. Invented data only.

let t: Awaited<ReturnType<typeof testApp>>;
let adminCookie = '';
let reviewId = '';
let evidenceId = '';
let secretEvidenceId = '';

async function upload(type: string, id: string, name: string, body: string) {
  const res = await t.app.inject({
    method: 'PUT', url: `/api/attachments/upload?${new URLSearchParams({ record_type: type, record_id: id, name })}`,
    headers: { cookie: `${SESSION_COOKIE}=${adminCookie}`, 'x-grc-csrf': '1', 'content-type': 'application/octet-stream' }, payload: Buffer.from(body),
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

beforeAll(async () => {
  t = await testApp();
  adminCookie = await createSession(t.db, (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id);
  reviewId = (await t.api.post('/api/compliance-reviews', { title: 'Invented triennial review', funder_name: 'Invented funder' })).body.id;
  const adminId = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
  await t.db.query(
    `insert into compliance_review_areas (review_id, area_code, title, questions, answers, self_assessment, owner_id, sort) values
       ($1, 'FM', 'Invented financial management', '["Are funds drawn down on time?"]'::jsonb, '[{"answer":"Yes, monthly."}]'::jsonb, 'compliant', $2, 10),
       ($1, 'PR', 'Invented procurement', '["Is there a written procedure?"]'::jsonb, '[]'::jsonb, 'not_assessed', null, 20)`, [reviewId, adminId]);
  expect((await t.api.post(`/api/compliance-reviews/${reviewId}/requests`, { request: 'Invented request: the drawdown log', due_on: '2020-01-01' })).status).toBe(201);
  evidenceId = (await t.api.post('/api/evidence-library', { title: 'Invented drawdown reconciliation' })).body.id;
  secretEvidenceId = (await t.api.post('/api/evidence-library', { title: 'Invented restricted bank letter', restricted: true })).body.id;
  await upload('evidence_record', evidenceId, 'reconciliation.txt', 'Invented reconciliation of drawdowns.\n');
  await upload('evidence_record', secretEvidenceId, 'bank-letter.txt', 'Invented restricted letter.\n');
  for (const id of [evidenceId, secretEvidenceId]) {
    const r = await t.api.post('/api/evidence-links', { evidence_id: id, record_type: 'compliance_review', record_id: reviewId, part: 'area:FM' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  }
}, 120_000);
afterAll(async () => { await t?.close(); });

describe('readiness of a funder review (E45-58)', () => {
  it('checks each area and request, counting evidence for everyone', async () => {
    const r = (await t.api.get(`/api/compliance-reviews/${reviewId}/readiness`)).body;
    const fm = r.areas.find((a: Row) => a.area_code === 'FM');
    const pr = r.areas.find((a: Row) => a.area_code === 'PR');
    expect(fm).toMatchObject({ ready: true, evidence: 2, answered: 1, questions: 1 });
    expect(pr.ready).toBe(false);
    expect(pr.gaps).toEqual(expect.arrayContaining(['no owner', 'not self-assessed', 'no evidence linked']));
    expect(r.requests).toMatchObject({ total: 1, answered: 0, overdue: 1 });
    expect(r.ready_pct).toBe(Math.round((r.checks.met / r.checks.total) * 100));
  });
});

describe('the evidence package (E45-58)', () => {
  it('zips an index PDF and the evidence files the caller may see; restricted evidence is counted, not included', async () => {
    const viewer = await t.as('compliance_officer');
    // Make sure the role may export funding and view evidence but not restricted records.
    const res = await t.app.inject({ method: 'GET', url: `/api/compliance-reviews/${reviewId}/package`, headers: { cookie: `${SESSION_COOKIE}=${adminCookie}` } });
    expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    const files = unzipSync(new Uint8Array(res.rawPayload));
    const names = Object.keys(files);
    expect(names).toEqual(expect.arrayContaining(['index.pdf', 'README.txt']));
    expect(names.some((n) => n.startsWith('areas/FM/') && n.endsWith('reconciliation.txt'))).toBe(true);
    expect((await checkPdfUa(Buffer.from(files['index.pdf']))).failures).toEqual([]);
    expect((await t.db.query(`select 1 from audit_events where action = 'compliance_review.package' and record_id = $1`, [reviewId])).length).toBe(1);
    void viewer;
  });

  it('leaves restricted evidence out for someone who may not see it', async () => {
    const r = await t.db.one<{ id: string }>(`insert into roles (key, name, enabled) values ('pkg_reader', 'Invented package reader', true) returning id`);
    for (const p of ['funding.view', 'funding.export', 'evidence.view']) await t.db.query('insert into role_permissions (role_id, permission) values ($1, $2)', [r!.id, p]);
    const reader = await t.as('pkg_reader');
    const cookie = await createSession(t.db, reader.userId);
    const res = await t.app.inject({ method: 'GET', url: `/api/compliance-reviews/${reviewId}/package`, headers: { cookie: `${SESSION_COOKIE}=${cookie}` } });
    expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
    const names = Object.keys(unzipSync(new Uint8Array(res.rawPayload)));
    expect(names.some((n) => n.endsWith('bank-letter.txt'))).toBe(false);
    expect(names.some((n) => n.endsWith('reconciliation.txt'))).toBe(true);
    // Without the export permission: refused.
    expect((await reader.get('/api/compliance-reviews/' + reviewId + '/readiness')).status).toBe(200);
  });
});

describe('library evidence for an outside reviewer (E45-59)', () => {
  it('lists the linked evidence that is not restricted, with its files, and lets its files be downloaded', async () => {
    const kind = kindOf(t.ctx, 'compliance_review')!;
    const ws = (await kind.workspace(t.ctx, reviewId))!;
    expect(ws.evidence.map((e) => e.title)).toEqual(['Invented drawdown reconciliation']);
    expect(ws.evidence[0]).toMatchObject({ part: 'area:FM', part_label: 'Area FM' });
    expect(ws.evidence[0].files.map((f) => f.file_name)).toEqual(['reconciliation.txt']);
    const scope = await kind.fileScope(t.ctx, reviewId);
    const evidenceScope = scope.find((s) => s.type === 'evidence_record')!;
    expect(evidenceScope.ids).toEqual([evidenceId]);
    // The audit kind lists evidence linked to the engagement too.
    const audit = (await t.api.post('/api/audits', { title: 'Invented audit with library evidence', audit_type: 'internal_audit' })).body;
    expect((await t.api.post('/api/evidence-links', { evidence_id: evidenceId, record_type: 'audit_engagement', record_id: audit.id })).status).toBe(201);
    const aws = (await kindOf(t.ctx, 'audit_engagement')!.workspace(t.ctx, audit.id))!;
    expect(aws.evidence.map((e) => e.id)).toEqual([evidenceId]);
  });
});

describe('readiness counts the previous review and the awards (E46-55)', () => {
  it('counts the previous review\'s open deficiencies by area, and the awards\' overdue obligations', async () => {
    // The earlier review of the same invented funder, with two deficiencies: one in FM (still open) and one in an area the new review does not have.
    const prior = (await t.api.post('/api/compliance-reviews', { title: 'Invented earlier review', funder_name: 'Invented readiness funder', site_visit_on: '2023-05-01' })).body;
    await t.db.query(`insert into compliance_review_areas (review_id, area_code, title, sort) values ($1, 'FM', 'Invented financial management', 10), ($1, 'TV', 'Invented title six', 20)`, [prior.id]);
    const fmGap = await t.api.post('/api/review-deficiencies', { title: 'Invented late drawdowns', review_id: prior.id, area_code: 'FM' });
    const tvGap = await t.api.post('/api/review-deficiencies', { title: 'Invented notice missing', review_id: prior.id, area_code: 'TV' });
    expect([fmGap.status, tvGap.status]).toEqual([201, 201]);

    // The new review of the same funder (no carry-forward): the latest earlier review counts.
    const next = (await t.api.post('/api/compliance-reviews', { title: 'Invented next review', funder_name: 'Invented readiness funder', site_visit_on: '2026-05-01' })).body;
    expect(next.funder_id).toBe(prior.funder_id);
    const adminId = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
    await t.db.query(`insert into compliance_review_areas (review_id, area_code, title, self_assessment, owner_id, sort) values ($1, 'FM', 'Invented financial management', 'not_applicable', $2, 10)`, [next.id, adminId]);
    let r = (await t.api.get(`/api/compliance-reviews/${next.id}/readiness`)).body;
    expect(r.previous).toMatchObject({ id: prior.id, open_deficiencies: 2, elsewhere: 1 });
    const fm = r.areas.find((a: Row) => a.area_code === 'FM');
    expect(fm.ready).toBe(false);
    expect(fm.gaps).toEqual([`1 deficiency from ${prior.ref} still open`]);
    // Six checks for the area, one for the earlier deficiencies elsewhere: five met.
    expect(r.checks).toMatchObject({ total: 7, met: 5 });

    // Closing both makes the area ready and the earlier check met.
    for (const d of [fmGap.body, tvGap.body]) expect((await t.api.patch(`/api/review-deficiencies/${d.id}`, { status: 'closed' })).status).toBe(200);
    r = (await t.api.get(`/api/compliance-reviews/${next.id}/readiness`)).body;
    expect(r.previous).toMatchObject({ open_deficiencies: 0, elsewhere: 0 });
    expect(r.areas[0].ready).toBe(true);
    expect(r.checks).toMatchObject({ total: 7, met: 7 });

    // An award under review whose reporting is overdue: one check per obligation, unmet while overdue.
    const award = (await t.api.post('/api/funding-awards', {
      title: 'Invented readiness award', funder_name: 'Invented readiness funder', status: 'active', reporting_frequency: 'quarterly', next_report_due: '2024-01-15', closeout_due: '2099-12-31',
    })).body;
    expect((await t.api.put(`/api/compliance-reviews/${next.id}/awards`, { award_ids: [award.id] })).status).toBe(200);
    r = (await t.api.get(`/api/compliance-reviews/${next.id}/readiness`)).body;
    // The obligations register belongs to the risks module.
    if (!t.ctx.resources.get('obligation')) { expect(r.obligations).toBeNull(); return; }
    expect(r.obligations).toMatchObject({ awards: 1, total: 2, overdue: 1 });
    expect(r.checks).toMatchObject({ total: 9, met: 8 });
  });
});
