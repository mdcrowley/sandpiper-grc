import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';

// Solicitations, offers, evaluation and award (E46). Invented names only.

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let officer: Client;   // Procurement officer: procurement.*, contracts.create
let viewer: Client;    // procurement.view only
let member: Client;    // procurement.view only, then on a committee
let outsider: Client;  // no procurement permission: a committee member from another department

async function roleWith(key: string, perms: string[]) {
  const role = await t.db.one<Row>(`insert into roles (key, name, enabled) values ($1, $1, true) returning id`, [key]);
  for (const p of perms) await t.db.query('insert into role_permissions (role_id, permission) values ($1, $2)', [role!.id, p]);
}

beforeAll(async () => {
  t = await testApp();
  await roleWith('proc_viewer', ['procurement.view']);
  await roleWith('proc_nobody', ['actions.view']);
  officer = await t.as('procurement_officer');
  viewer = await t.as('proc_viewer');
  member = await t.as('proc_viewer');
  outsider = await t.as('proc_nobody');
}, 60_000);
afterAll(async () => { await t?.close(); });

const solicitation = async (c: Client | typeof t.api, data: Row) => {
  const r = await c.post('/api/procurements', { method: 'competitive_proposals', ...data });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
};
const offer = async (procurementId: string, bidder: string, amount: number) => {
  const r = await officer.post('/api/procurement-offers', { procurement_id: procurementId, bidder_name: bidder, amount, status: 'responsive' });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
};

describe('solicitations', () => {
  it('belong to their buyer, check their schedule and the method\'s own limit', async () => {
    const p = await solicitation(officer, { title: 'Invented shelter cleaning services', estimated_value: 120000 });
    expect(p).toMatchObject({ ref: expect.stringMatching(/^PRC-/), buyer_id: officer.userId, status: 'planning' });
    const dates = await officer.post('/api/procurements', { title: 'Backwards', method: 'sealed_bid', issued_on: dayInZone(0), questions_due_on: dayInZone(-3) });
    expect(dates.body.error.fields.questions_due_on).toBeTruthy();
    // No limit is built in; the organization sets its own.
    expect((await officer.post('/api/procurements', { title: 'Big micro', method: 'micro_purchase', estimated_value: 900000 })).status).toBe(201);
    await t.db.query(`update lookups set meta = meta || '{"max_value": 10000}'::jsonb where list_key = 'procurement_method' and value = 'micro_purchase'`);
    const over = await officer.post('/api/procurements', { title: 'Too big for a micro-purchase', method: 'micro_purchase', estimated_value: 25000 });
    expect(over.status).toBe(400);
    expect(over.body.error.fields.estimated_value).toMatch(/limit/);
  });

  it('need a written justification for a sole source before leaving planning', async () => {
    const p = await solicitation(officer, { title: 'Invented proprietary radio parts', method: 'sole_source' });
    const moved = await officer.patch(`/api/procurements/${p.id}`, { status: 'issued' });
    expect(moved.status).toBe(400);
    expect(moved.body.error.fields.justification).toBeTruthy();
    expect((await officer.patch(`/api/procurements/${p.id}`, { status: 'issued', justification: 'Only the original manufacturer makes compatible parts.' })).status).toBe(200);
  });

  it('keep addenda, protests and the required clauses checklist', async () => {
    const p = await solicitation(officer, { title: 'Invented uniform supply' });
    const a1 = await officer.post(`/api/procurements/${p.id}/addenda`, { issued_on: dayInZone(-2), summary: 'Sizes chart corrected.' });
    const a2 = await officer.post(`/api/procurements/${p.id}/addenda`, { issued_on: dayInZone(-1), summary: 'Due date moved by a week.' });
    expect([a1.body.number, a2.body.number]).toEqual([1, 2]);
    expect((await viewer.get(`/api/procurements/${p.id}/addenda`)).body).toHaveLength(2);
    expect((await viewer.post(`/api/procurements/${p.id}/addenda`, { issued_on: dayInZone(0), summary: 'x' })).status).toBe(403);

    const pr = await officer.post(`/api/procurements/${p.id}/protests`, { protester: 'Invented Garment Co', received_on: dayInZone(0), grounds: 'Specification favors one brand.' });
    expect(pr.status).toBe(201);
    expect((await officer.patch(`/api/procurements/${p.id}/protests/${pr.body.id}`, { status: 'denied' })).body.error.fields.decision).toBeTruthy();
    const decided = await officer.patch(`/api/procurements/${p.id}/protests/${pr.body.id}`, { status: 'denied', decision: 'The specification allows equivalents.' });
    expect(decided.body).toMatchObject({ status: 'denied', decided_on: dayInZone(0), decided_by_name: expect.stringContaining('procurement_officer') });

    const clauses = (await viewer.get(`/api/procurements/${p.id}/clauses`)).body;
    expect(clauses.length).toBeGreaterThan(5);
    const saved = await officer.put(`/api/procurements/${p.id}/clauses`, { checks: [{ clause_key: clauses[0].clause_key, status: 'included' }] });
    expect(saved.body.changed).toBe(1);
    expect(saved.body.checklist[0].status).toBe('included');
  });
});

describe('offers and evaluation', () => {
  let p: Row;
  let offers: Row[];
  let criteria: Row[];

  beforeAll(async () => {
    p = await solicitation(officer, { title: 'Invented scheduling software', proposals_due_at: `${dayInZone(-1)}T12:00:00Z` });
    offers = [await offer(p.id, 'Invented Alpha Systems', 300000), await offer(p.id, 'Invented Beta Software', 250000)];
    criteria = (await officer.put(`/api/procurements/${p.id}/criteria`, { criteria: [{ name: 'Technical', weight: 60, max_score: 10 }, { name: 'Price', weight: 40, max_score: 10 }] })).body;
  });

  it('are read only by procurement staff and the committee until the award; counts are the same for everyone', async () => {
    expect((await officer.get(`/api/procurement-offers?f.procurement_id=${p.id}`)).body.total).toBe(2);
    expect((await viewer.get(`/api/procurement-offers?f.procurement_id=${p.id}`)).body.total).toBe(0);
    expect((await viewer.get(`/api/procurement-offers/${offers[0].id}`)).status).toBe(404);
    expect((await viewer.get(`/api/procurements/${p.id}/offers-summary`)).body).toEqual({ total: 2, responsive: 2, hidden: 2 });
    const stats = (await viewer.get(`/api/procurement-offers/stats?group=status&f.procurement_id=${p.id}`)).body;
    expect(stats.total).toBe(2);
    const ev = (await viewer.get(`/api/procurements/${p.id}/evaluation`)).body;
    expect(ev).toMatchObject({ restricted: true, offers: [], scores: [], counts: { offers: 2 } });
    // A committee member reads them.
    expect((await officer.post(`/api/procurements/${p.id}/evaluators`, { user_id: member.userId })).status).toBe(201);
    expect((await member.get(`/api/procurement-offers?f.procurement_id=${p.id}`)).body.total).toBe(2);
    expect((await officer.post(`/api/procurements/${p.id}/evaluators`, { user_id: member.userId })).status).toBe(409);
  });

  it('let a committee member without procurement permission declare and score from their own page', async () => {
    expect((await outsider.get(`/api/procurements/${p.id}`)).status).toBe(403);
    expect((await outsider.get(`/api/procurement/my-evaluations/${p.id}`)).status).toBe(404);
    await officer.post(`/api/procurements/${p.id}/evaluators`, { user_id: outsider.userId });
    const mine = (await outsider.get('/api/procurement/my-evaluations')).body;
    expect(mine.map((m: Row) => m.id)).toContain(p.id);
    const page = (await outsider.get(`/api/procurement/my-evaluations/${p.id}`)).body;
    expect(page.offers).toHaveLength(2);
    expect(page.me.coi_status).toBe('pending');
    // In My work, before scoring.
    const work = (await outsider.get('/api/work/mine')).body;
    expect(JSON.stringify(work)).toContain(`/procurement/evaluate/${p.id}`);

    const score = (offerId: string, criterionId: string, s: number) => ({ offer_id: offerId, criterion_id: criterionId, score: s });
    const early = await outsider.put(`/api/procurement/my-evaluations/${p.id}/scores`, { scores: [score(offers[0].id, criteria[0].id, 8)] });
    expect(early.status).toBe(409);
    expect((await outsider.post(`/api/procurement/my-evaluations/${p.id}/declaration`, { conflict: true })).body.error.fields.note).toBeTruthy();
    expect((await outsider.post(`/api/procurement/my-evaluations/${p.id}/declaration`, { conflict: false })).status).toBe(200);
    expect((await outsider.put(`/api/procurement/my-evaluations/${p.id}/scores`, { scores: [score(offers[0].id, criteria[0].id, 11)] })).status).toBe(400);
    const part = await outsider.put(`/api/procurement/my-evaluations/${p.id}/scores`, { scores: [score(offers[0].id, criteria[0].id, 8)], submit: true });
    expect(part.status).toBe(400);
    const all = await outsider.put(`/api/procurement/my-evaluations/${p.id}/scores`, {
      scores: [score(offers[0].id, criteria[0].id, 8), score(offers[0].id, criteria[1].id, 6), score(offers[1].id, criteria[0].id, 7), score(offers[1].id, criteria[1].id, 9)], submit: true,
    });
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    expect(all.body.submitted_at).toBeTruthy();
    expect((await outsider.put(`/api/procurement/my-evaluations/${p.id}/scores`, { scores: [score(offers[0].id, criteria[0].id, 9)] })).status).toBe(409);
    // Scores are not in the audit log.
    const hist = await t.db.query<Row>(`select summary, after from audit_events where record_id = $1 and action like 'procurement.scores%'`, [p.id]);
    expect(JSON.stringify(hist)).not.toContain('"score"');
  });

  it('rank the offers by weighted score for staff, and a member who declared a conflict sees no offers', async () => {
    await member.post(`/api/procurement/my-evaluations/${p.id}/declaration`, { conflict: true, note: 'Former employer of one bidder.' });
    expect((await member.get(`/api/procurement/my-evaluations/${p.id}`)).body.offers).toEqual([]);
    expect((await member.put(`/api/procurement/my-evaluations/${p.id}/scores`, { scores: [] })).status).toBe(409);
    const ev = (await officer.get(`/api/procurements/${p.id}/evaluation`)).body;
    expect(ev.restricted).toBe(false);
    const alpha = ev.offers.find((o: Row) => o.offer_id === offers[0].id);
    const beta = ev.offers.find((o: Row) => o.offer_id === offers[1].id);
    // Alpha: 8/10*60 + 6/10*40 = 72; Beta: 7/10*60 + 9/10*40 = 78.
    expect([alpha.total, beta.total]).toEqual([72, 78]);
    expect([beta.rank, alpha.rank]).toEqual([1, 2]);
    expect(ev.evaluators.find((e: Row) => e.user_id === member.userId).coi_status).toBe('conflict');
    expect((await officer.put(`/api/procurements/${p.id}/criteria`, { use_template: true })).status).toBe(409);
  });

  it('record the award, open the evaluation to every viewer and make the contract, linked both ways', async () => {
    expect((await viewer.post(`/api/procurements/${p.id}/award`, { offer_id: offers[1].id, reason: 'x' })).status).toBe(403);
    expect((await officer.post(`/api/procurements/${p.id}/award`, { offer_id: offers[1].id })).body.error.fields.reason).toBeTruthy();
    const won = await officer.post(`/api/procurements/${p.id}/award`, { offer_id: offers[1].id, reason: 'Highest weighted score and lowest price.' });
    expect(won.status, JSON.stringify(won.body)).toBe(200);
    expect(won.body).toMatchObject({ status: 'awarded', awarded_on: dayInZone(0), award_amount: expect.anything(), awarded_by: officer.userId });
    const statuses = (await officer.get(`/api/procurement-offers?f.procurement_id=${p.id}`)).body.rows.map((o: Row) => [o.bidder_name, o.status]).sort();
    expect(statuses).toEqual([['Invented Alpha Systems', 'not_selected'], ['Invented Beta Software', 'awarded']]);
    expect((await viewer.get(`/api/procurement-offers?f.procurement_id=${p.id}`)).body.total).toBe(2);
    expect((await viewer.get(`/api/procurements/${p.id}/evaluation`)).body.restricted).toBe(false);
    expect((await officer.post(`/api/procurements/${p.id}/award`, { offer_id: offers[0].id, reason: 'again' })).status).toBe(409);
    expect((await officer.post('/api/procurement-offers', { procurement_id: p.id, bidder_name: 'Late Co' })).status).toBe(400);

    // The contract needs a vendor record on the awarded offer.
    expect((await officer.post(`/api/procurements/${p.id}/contract`, {})).status).toBe(400);
    const vendor = (await t.api.post('/api/vendors', { name: 'Invented Beta Software' })).body;
    await officer.patch(`/api/procurement-offers/${offers[1].id}`, { vendor_id: vendor.id });
    const made = await officer.post(`/api/procurements/${p.id}/contract`, { start_date: dayInZone(1) });
    expect(made.status, JSON.stringify(made.body)).toBe(200);
    const contract = (await t.api.get(`/api/contracts/${made.body.contract_id}`)).body;
    expect(contract).toMatchObject({ vendor_id: vendor.id, status: 'draft' });
    expect((await officer.get(`/api/procurements/${p.id}`)).body.contract_id).toBe(contract.id);
    const links = (await t.api.get(`/api/links?record_type=contract&record_id=${contract.id}`)).body;
    expect(JSON.stringify(links)).toContain(p.id);
  });
});

describe('data load', () => {
  it('loads a past procurement with its committee\'s scores and award by the people named', async () => {
    await t.db.query(`insert into users (username, email, display_name, status) values ('pastbuyer', 'past.buyer@example.test', 'Pat Pastbuyer', 'disabled')`);
    const evalr = (await t.db.one<Row>(`insert into users (username, email, display_name, status) values ('pasteval', 'past.eval@example.test', 'Eve Pasteval', 'disabled') returning id`))!.id;
    await t.db.query('update sessions set confirmed_at = now()');
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    try {
      const p = (await t.api.post('/api/procurements', {
        title: 'Invented 2019 paratransit vans', method: 'sealed_bid', status: 'evaluation', issued_on: '2019-02-01', proposals_due_at: '2019-03-01T15:00:00Z', created_at: '2019-01-15T10:00:00Z',
      })).body;
      expect(p.created_at).toMatch(/^2019-01-15/);
      const o = (await t.api.post('/api/procurement-offers', { procurement_id: p.id, bidder_name: 'Invented Van Co', amount: 410000, received_at: '2019-02-28T10:00:00Z' })).body;
      const c = (await t.api.put(`/api/procurements/${p.id}/criteria`, { criteria: [{ name: 'Price', weight: 100 }] })).body;
      await t.api.post(`/api/procurements/${p.id}/evaluators`, { user_id: evalr });
      const dec = await t.api.post(`/api/procurement/my-evaluations/${p.id}/declaration`, { conflict: false, declared_at: '2019-03-02T09:00:00Z', on_behalf_of: 'pasteval' });
      expect(dec.status, JSON.stringify(dec.body)).toBe(200);
      const sc = await t.api.put(`/api/procurement/my-evaluations/${p.id}/scores`, { scores: [{ offer_id: o.id, criterion_id: c[0].id, score: 9 }], submit: true, scored_at: '2019-03-03T09:00:00Z', on_behalf_of: 'pasteval' });
      expect(sc.status, JSON.stringify(sc.body)).toBe(200);
      const s = await t.db.one<Row>('select evaluator_id, scored_at from procurement_scores where procurement_id = $1', [p.id]);
      expect(s!.evaluator_id).toBe(evalr);
      expect(new Date(s!.scored_at).toISOString()).toMatch(/^2019-03-03/);
      const aw = await t.api.post(`/api/procurements/${p.id}/award`, { offer_id: o.id, reason: 'Lowest responsive bid.', awarded_on: '2019-03-20', on_behalf_of: 'pastbuyer' });
      expect(aw.status, JSON.stringify(aw.body)).toBe(200);
      expect(aw.body).toMatchObject({ awarded_on: '2019-03-20', awarded_by_name: 'Pat Pastbuyer' });
    } finally {
      await t.api.post('/api/admin/data-load', { on: false });
    }
  });
});

describe('switched off', () => {
  it('answers switched off and drops the area\'s types', async () => {
    expect((await t.api.patch('/api/admin/features', { features: { procurement: false } })).status).toBe(200);
    try {
      expect((await t.api.get('/api/procurements')).status).toBe(404);
      expect((await outsider.get('/api/procurement/my-evaluations')).status).toBe(404);
      const meta = (await t.api.get('/api/meta')).body;
      expect(meta.resources.procurement).toBeUndefined();
      expect(meta.resources.purchase_order).toBeUndefined();
    } finally {
      await t.api.patch('/api/admin/features', { features: { procurement: true } });
    }
  });
});
