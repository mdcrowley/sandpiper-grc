import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { readSampleAreas } from './reviews.ts';

// Funders, and funder compliance reviews connected to awards, controls and the evidence library (E45-10):
// awards under review, what areas rely on, evidence per area and per document request (file upload by
// the assignee), carrying a review forward, and the restriction rules. Invented data only.

// A stand-in control type, so the review links are tested without the control library module.
const standIn: ModuleDef = {
  key: 'fundinglinkstandins',
  async seedDefaults(ctx) {
    await ctx.db.exec(`create table if not exists t_controls (
      id uuid primary key default gen_random_uuid(), ref text, title text not null, operating_rating text, design_rating text, last_tested_on date, status text,
      created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz)`);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'control', table: 't_controls', module: 'controls', label: 'Control', plural: 'Controls', path: '/api/controls', route: '/controls',
      titleField: 'title', ref: { field: 'ref', prefix: 'CTL-' },
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true }, title: { label: 'Control', type: 'text', required: true },
        operating_rating: { label: 'Operating rating', type: 'text' }, design_rating: { label: 'Design rating', type: 'text' },
        last_tested_on: { label: 'Last tested', type: 'date' }, status: { label: 'Status', type: 'text' },
      },
    });
  },
};

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let officer: Client;   // funding.*, controls.view, evidence.*
let assignee: Client;  // funding.view, evidence.view: answers the requests assigned to them
let viewer: Client;    // funding.view, evidence.view: no controls
let reviewId: string;
let controlId: string;

async function roleWith(key: string, perms: string[]) {
  const role = await t.db.one<Row>(`insert into roles (key, name, enabled) values ($1, $1, true) returning id`, [key]);
  for (const p of perms) await t.db.query('insert into role_permissions (role_id, permission) values ($1, $2)', [role!.id, p]);
}

async function upload(c: Client, name: string, text: string): Promise<string> {
  const bytes = Buffer.from(text);
  const start = await c.post('/api/attachments/uploads', { file_name: name, size: bytes.length });
  expect(start.status, JSON.stringify(start.body)).toBe(201);
  expect((await c.post(`/api/attachments/uploads/${start.body.id}/parts/1`, { data: bytes.toString('base64') })).status).toBe(200);
  expect((await c.post(`/api/attachments/uploads/${start.body.id}/finish`, {})).status).toBe(200);
  return start.body.id;
}

beforeAll(async () => {
  process.env.GRC_MODULES = 'funding,evidence,attachments,notifications,workflows';
  t = await testApp({ extraModules: [standIn] });
  await roleWith('fl_officer', ['funding.*', 'controls.view', 'evidence.*']);
  await roleWith('fl_assignee', ['funding.view', 'evidence.view']);
  officer = await t.as('fl_officer');
  assignee = await t.as('fl_assignee');
  viewer = await t.as('fl_assignee');
  expect((await t.api.post('/api/funding/review-area-sets/import', readSampleAreas())).status).toBe(201);
  controlId = (await t.api.post('/api/controls', { title: 'Price analysis before award', operating_rating: 'effective', last_tested_on: dayInZone(-30) })).body.id;
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('funders', () => {
  it('are shared records: a typed name finds or files the funder, and a rename follows everywhere', async () => {
    const a1 = (await officer.post('/api/funding-awards', { title: 'Invented capital award', funder_name: 'Invented Transit Fund' })).body;
    const a2 = (await officer.post('/api/funding-awards', { title: 'Invented operating award', funder_name: '  invented transit fund ' })).body;
    expect(a1.funder_id).toBeTruthy();
    expect(a2.funder_id).toBe(a1.funder_id);
    const funder = (await officer.get(`/api/funders/${a1.funder_id}`)).body;
    expect(funder).toMatchObject({ name: 'Invented Transit Fund', ref: expect.stringMatching(/^FDR-/) });
    const cert = (await officer.post('/api/funding-certifications', { year: 2031, title: 'Invented assurances', funder_id: funder.id })).body;
    expect(cert.funder_name).toBe('Invented Transit Fund');
    expect((await officer.patch(`/api/funders/${funder.id}`, { name: 'Invented Regional Transit Fund' })).status).toBe(200);
    expect((await officer.get(`/api/funding-awards/${a2.id}`)).body.funder_name).toBe('Invented Regional Transit Fund');
    expect((await officer.get(`/api/funders/${funder.id}/summary`)).body).toEqual({ awards: 2, certifications: 1, reviews: 0 });
    expect((await officer.post('/api/funders', { name: 'Bad site', website: 'ftp://x' })).body.error.fields.website).toBeTruthy();
    const review = await officer.post('/api/compliance-reviews', { title: 'Invented triennial review', funder_id: funder.id, period: 'Three years' });
    expect(review.status).toBe(201);
    reviewId = review.body.id;
    expect(review.body.funder_name).toBe('Invented Regional Transit Fund');
    // The review covers the funder's awards.
    const set = await officer.put(`/api/compliance-reviews/${reviewId}/awards`, { award_ids: [a1.id, a2.id] });
    expect(set.body.map((a: Row) => a.title).sort()).toEqual(['Invented capital award', 'Invented operating award']);
    expect((await officer.get(`/api/funding-awards/${a1.id}/reviews`)).body.map((r: Row) => r.id)).toEqual([reviewId]);
    expect((await viewer.put(`/api/compliance-reviews/${reviewId}/awards`, { award_ids: [] })).status).toBe(403);
    expect((await officer.put(`/api/compliance-reviews/${reviewId}/awards`, { award_ids: ['nope'] })).status).toBe(400);
  });
});

describe('review areas connected to controls and evidence', () => {
  it('records what an area relies on, with the control\'s ratings, hidden from people who may not see controls', async () => {
    const sets = (await officer.get('/api/funding/review-area-sets')).body;
    expect((await officer.post(`/api/compliance-reviews/${reviewId}/areas/load`, { set_id: sets[0].id })).status).toBe(200);
    const linked = await officer.post(`/api/compliance-reviews/${reviewId}/areas/PR/links`, { record_type: 'control', record_id: controlId });
    expect(linked.status).toBe(201);
    expect(linked.body[0]).toMatchObject({ record_type: 'control', title: 'Price analysis before award', operating_rating: 'effective', route: `/controls/${controlId}` });
    expect((await officer.post(`/api/compliance-reviews/${reviewId}/areas/PR/links`, { record_type: 'risk', record_id: controlId })).status).toBe(400);
    expect((await officer.post(`/api/compliance-reviews/${reviewId}/areas/XX/links`, { record_type: 'control', record_id: controlId })).status).toBe(404);
    const pr = (await viewer.get(`/api/compliance-reviews/${reviewId}/areas`)).body.areas.find((a: Row) => a.area_code === 'PR');
    expect(pr).toMatchObject({ links: [], links_hidden: 1 });
    const mine = (await officer.get(`/api/compliance-reviews/${reviewId}/areas`)).body.areas.find((a: Row) => a.area_code === 'PR');
    expect(mine.links).toHaveLength(1);
  });

  it('suggests the evidence the related control uses, and counts the evidence of each area', async () => {
    const e = (await officer.post('/api/evidence-library', { title: 'Procurement procedure', source: 'link', url: 'https://intranet.example.test/proc' })).body;
    // The control uses it (controls.edit is needed to link to a control: the administrator does it).
    expect((await t.api.post('/api/evidence-links', { evidence_id: e.id, record_type: 'control', record_id: controlId })).status).toBe(201);
    const suggested = (await officer.get(`/api/compliance-reviews/${reviewId}/areas/PR/suggested-evidence`)).body;
    expect(suggested.rows).toEqual([expect.objectContaining({ id: e.id, via: [expect.objectContaining({ title: 'Price analysis before award' })] })]);
    expect((await officer.post('/api/evidence-links', { evidence_id: e.id, record_type: 'compliance_review', record_id: reviewId, part: 'area:PR', relation: 'demonstrates' })).status).toBe(201);
    expect((await officer.get(`/api/compliance-reviews/${reviewId}/areas/PR/suggested-evidence`)).body.rows).toEqual([]);
    expect((await officer.post('/api/evidence-links', { evidence_id: e.id, record_type: 'compliance_review', record_id: reviewId, part: 'area:ZZ' })).status).toBe(400);
    const areas = (await viewer.get(`/api/compliance-reviews/${reviewId}/areas`)).body.areas;
    expect(areas.find((a: Row) => a.area_code === 'PR').evidence).toBe(1);
    expect(areas.find((a: Row) => a.area_code === 'FM').evidence).toBe(0);
    const onArea = (await viewer.get(`/api/evidence-links?record_type=compliance_review&record_id=${reviewId}&part=area:PR`)).body;
    expect(onArea.rows[0]).toMatchObject({ part_label: expect.stringMatching(/^Review area: PR /), evidence: { id: e.id } });
  });
});

describe('document requests answered with files', () => {
  let requestId: string;

  it('lets the assignee upload a file: it is filed in the library, linked to the request, and the request is provided', async () => {
    requestId = (await officer.post(`/api/compliance-reviews/${reviewId}/requests`, { request: 'Inventory of funded equipment', area_code: 'AM', owner_id: assignee.userId, due_on: dayInZone(14) })).body.id;
    const otherUpload = await upload(viewer, 'not-mine.txt', 'someone else');
    expect((await viewer.post(`/api/compliance-reviews/${reviewId}/requests/${requestId}/files`, { upload_id: otherUpload })).status).toBe(403);
    const up = await upload(assignee, 'funded-equipment.txt', 'Invented inventory of funded equipment');
    const r = await assignee.post(`/api/compliance-reviews/${reviewId}/requests/${requestId}/files`, { upload_id: up, valid_until: dayInZone(300) });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ status: 'provided', ref: expect.stringMatching(/^EVD-/) });
    const ev = (await assignee.get(`/api/evidence-library/${r.body.evidence_id}`)).body;
    expect(ev).toMatchObject({ owner_id: assignee.userId, source: 'file', valid_until: dayInZone(300) });
    const files = (await assignee.get(`/api/attachments?record_type=evidence_record&record_id=${ev.id}`)).body.rows;
    expect(files.map((f: Row) => f.file_name)).toEqual(['funded-equipment.txt']);
    const requests = (await viewer.get(`/api/compliance-reviews/${reviewId}/requests`)).body;
    expect(requests.find((q: Row) => q.id === requestId)).toMatchObject({ status: 'provided', evidence: 1 });
    // The same upload cannot be used twice.
    expect((await assignee.post(`/api/compliance-reviews/${reviewId}/requests/${requestId}/files`, { upload_id: up })).status).toBeGreaterThanOrEqual(400);
    // The assignee may also answer with evidence already in the library, but only on their own request.
    const existing = (await officer.post('/api/evidence-library', { title: 'Asset register extract' })).body;
    expect((await assignee.post('/api/evidence-links', { evidence_id: existing.id, record_type: 'compliance_review', record_id: reviewId, part: `request:${requestId}`, relation: 'responds' })).status).toBe(201);
    expect((await assignee.post('/api/evidence-links', { evidence_id: existing.id, record_type: 'compliance_review', record_id: reviewId, part: 'area:AM' })).status).toBe(403);
    expect((await viewer.post('/api/evidence-links', { evidence_id: existing.id, record_type: 'compliance_review', record_id: reviewId, part: `request:${requestId}` })).status).toBe(403);
  });
});

describe('carrying a review forward', () => {
  it('starts the next review from this one: areas with draft answers, related records, the same evidence, requests and awards', async () => {
    await officer.put(`/api/compliance-reviews/${reviewId}/areas/PR`, { self_assessment: 'compliant', answers: ['Written procedure, revised last year.'], notes: 'See the procedure.' });
    const def = await officer.post('/api/review-deficiencies', { title: 'Price analysis missing in two files', review_id: reviewId, area_code: 'PR' });
    expect(def.status).toBe(201);
    const next = await officer.post(`/api/compliance-reviews/${reviewId}/next`, { period: 'Next three years' });
    expect(next.status, JSON.stringify(next.body)).toBe(201);
    expect(next.body).toMatchObject({ requests: 1, awards: 2 });
    expect(next.body.areas_added).toBeGreaterThan(5);
    expect(next.body.evidence).toBe(1);
    const nid = next.body.id;
    const review = (await officer.get(`/api/compliance-reviews/${nid}`)).body;
    expect(review).toMatchObject({ previous_review_id: reviewId, funder_id: expect.any(String), status: 'preparing', period: 'Next three years' });
    const pr = (await officer.get(`/api/compliance-reviews/${nid}/areas`)).body.areas.find((a: Row) => a.area_code === 'PR');
    expect(pr).toMatchObject({ self_assessment: 'not_assessed', answers: ['Written procedure, revised last year.'], notes: 'See the procedure.', evidence: 1 });
    expect(pr.links.map((l: Row) => l.record_id)).toEqual([controlId]);
    const requests = (await officer.get(`/api/compliance-reviews/${nid}/requests`)).body;
    expect(requests).toEqual([expect.objectContaining({ request: 'Inventory of funded equipment', status: 'open', owner_id: assignee.userId, due_on: null, evidence: 0 })]);
    expect((await officer.get(`/api/compliance-reviews/${nid}/awards`)).body).toHaveLength(2);
    const prev = (await officer.get(`/api/compliance-reviews/${nid}/previous`)).body;
    expect(prev.review.id).toBe(reviewId);
    expect(prev.deficiencies.map((d: Row) => d.title)).toEqual(['Price analysis missing in two files']);
    // Carrying forward again adds nothing twice.
    const again = (await officer.post(`/api/compliance-reviews/${nid}/carry-forward`, { from_review_id: reviewId })).body;
    expect(again).toMatchObject({ areas_added: 0, requests: 0, evidence: 0, related: 0, awards: 0 });
    expect((await officer.post(`/api/compliance-reviews/${nid}/carry-forward`, { from_review_id: nid })).status).toBe(400);
    expect((await viewer.post(`/api/compliance-reviews/${nid}/carry-forward`, { from_review_id: reviewId })).status).toBe(403);
    const history = (await t.api.get(`/api/history?record_type=compliance_review&record_id=${nid}`)).body;
    expect(history.map((h: Row) => h.action)).toContain('compliance_review.carry_forward');
  });
});
