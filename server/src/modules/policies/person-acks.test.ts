import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { localDate } from './dates.ts';

// Document types (C6) and acknowledgments by roster people (E29-08 to E29-10).
let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let author: Client;
let approver: Client;
let reader: Client;     // policies.view, no people.view
let policyId: string;
let positionId: string;
const people: Record<string, string> = {};

async function publish(id: string, body = 'Invented bulletin text.') {
  const v = await author.post(`/api/policies/${id}/versions`, { body });
  await author.post(`/api/policies/${id}/versions/${v.body.id}/submit`);
  await approver.post(`/api/policies/${id}/versions/${v.body.id}/approve`, {});
  return author.post(`/api/policies/${id}/versions/${v.body.id}/publish`);
}

beforeAll(async () => {
  process.env.GRC_MODULES = 'people,policies';
  t = await testApp();
  // Security leads write and approve policies and see the roster (people.view).
  author = await t.as('security_lead');
  approver = await t.as('security_lead');
  reader = await t.as('agent');
  const pos = await t.api.post('/api/positions', { name: 'Invented rail operator' });
  positionId = pos.body.id;
  await t.api.post('/api/positions', { name: 'Invented office worker' });
  for (const [name, no, position] of [['Ana Example', 'R1', positionId], ['Ben Example', 'R2', positionId], ['Cy Example', 'R3', null]] as const) {
    people[no] = (await t.api.post('/api/people', { full_name: name, employee_number: no, position_id: position })).body.id;
  }
});
afterAll(async () => { await t.close(); });

describe('document types (contract C6)', () => {
  it('offers the document types with their review cycles; plan is a plan', async () => {
    const list = (await t.api.get('/api/lookups/policy_document_type')).body as any[];
    expect(list.map((v) => v.value)).toEqual(['policy', 'plan', 'charter', 'standard', 'program', 'procedure', 'sop', 'rulebook_section', 'bulletin', 'work_instruction', 'guideline', 'form_template', 'external', 'reference']);
    expect(list.find((v) => v.value === 'plan').meta).toEqual({ tier: 1, prefix: 'PLN', plan: true, review_months: 12 });
  });

  it('defaults to policy and moves the review date by the type\'s cycle on publishing', async () => {
    const plain = await author.post('/api/policies', { title: 'Invented policy' });
    expect(plain.body.document_type).toBe('policy');
    const res = await author.post('/api/policies', {
      title: 'Invented bulletin 7', document_type: 'bulletin', ack_roster: true, audience_positions: [positionId],
    });
    expect(res.status).toBe(201);
    policyId = res.body.id;
    expect((await author.post('/api/policies', { title: 'x', audience_positions: ['00000000-0000-4000-8000-000000000000'] })).status).toBe(400);
    const pub = await publish(policyId);
    expect(pub.status).toBe(200);
    expect(pub.body.roster_requested).toBe(2);
    const after = (await author.get(`/api/policies/${policyId}`)).body;
    const today = localDate();
    const sixMonths = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 + 6, 1)).toISOString().slice(0, 7);
    expect(String(after.review_date).slice(0, 7)).toBe(sixMonths);
  });
});

describe('roster acknowledgments', () => {
  it('tracks who on the roster was asked, and needs people.view to see names', async () => {
    const res = await author.get(`/api/policies/${policyId}/person-acknowledgments`);
    expect(res.body.counts).toMatchObject({ total: 2, acknowledged: 0, outstanding: 2 });
    expect(res.body.rows.map((r: any) => r.person)).toEqual(['Ana Example', 'Ben Example']);
    expect((await reader.get(`/api/policies/${policyId}/person-acknowledgments`)).status).toBe(403);
  });

  it('records a sign-in sheet by employee number, adding someone not asked, and skips repeats', async () => {
    const bad = await author.post(`/api/policies/${policyId}/person-acknowledgments`, { employee_numbers: ['R1'], method: 'sign_in_sheet', acknowledged_on: '2999-01-01' });
    expect(bad.status).toBe(400);
    const res = await author.post(`/api/policies/${policyId}/person-acknowledgments`, { employee_numbers: ['r1', 'R3', 'NOPE'], method: 'sign_in_sheet' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ recorded: 2, already: 0, unknown: ['NOPE'] });
    expect((await author.post(`/api/policies/${policyId}/person-acknowledgments`, { people: [people.R1], method: 'recorded' })).body).toMatchObject({ recorded: 0, already: 1 });
    const track = await author.get(`/api/policies/${policyId}/person-acknowledgments`);
    expect(track.body.counts).toMatchObject({ total: 3, acknowledged: 2, outstanding: 1 });
    const ana = track.body.rows.find((r: any) => r.person === 'Ana Example');
    expect(ana).toMatchObject({ method: 'sign_in_sheet', state: 'acknowledged' });
    expect(ana.recorded_by_name).toBeTruthy();
    const ev = await t.db.query<any>(`select * from audit_events where action = 'policy.person_acknowledge' and record_id = $1`, [policyId]);
    expect(ev.length).toBe(2);
    expect(ev[0].actor_id ?? ev[0].user_id).toBe(author.userId);
  });

  it('the kiosk needs a signed-in policies.edit user and the right employee number', async () => {
    expect((await t.anon.get('/api/policies/kiosk/people')).status).toBe(401);
    expect((await reader.get('/api/policies/kiosk/people')).status).toBe(403);
    const names = await author.get('/api/policies/kiosk/people');
    expect(names.body).toEqual([expect.objectContaining({ id: people.R2, name: 'Ben Example' })]);
    expect(names.body[0].employee_number).toBeUndefined();
    const wrong = await author.get(`/api/policies/kiosk/pending?person_id=${people.R2}&employee_number=R1`);
    expect(wrong.status).toBe(403);
    const pending = await author.get(`/api/policies/kiosk/pending?person_id=${people.R2}&employee_number=r2`);
    expect(pending.status).toBe(200);
    expect(pending.body.items).toHaveLength(1);
    expect(pending.body.items[0].body_html).toContain('Invented bulletin text.');
    const ack = await author.post('/api/policies/kiosk/acknowledge', { person_id: people.R2, employee_number: 'R2', ack_ids: [pending.body.items[0].id] });
    expect(ack.body).toEqual({ acknowledged: 1 });
    const row = await t.db.one<any>('select * from policy_person_acknowledgements where person_id = $1', [people.R2]);
    expect(row).toMatchObject({ method: 'kiosk', recorded_by: author.userId });
    expect((await author.get('/api/policies/kiosk/people')).body).toEqual([]);
  });

  it('stops after too many wrong numbers', async () => {
    for (let i = 0; i < 4; i++) expect((await author.get(`/api/policies/kiosk/pending?person_id=${people.R3}&employee_number=X${i}`)).status).toBe(403);
    // A right number clears the count.
    expect((await author.get(`/api/policies/kiosk/pending?person_id=${people.R3}&employee_number=R3`)).status).toBe(200);
    for (let i = 0; i < 5; i++) expect((await author.get(`/api/policies/kiosk/pending?person_id=${people.R3}&employee_number=X${i}`)).status).toBe(403);
    expect((await author.get(`/api/policies/kiosk/pending?person_id=${people.R3}&employee_number=R3`)).status).toBe(429);
    // Counted in the database, so every server process (and a restart) sees the same count.
    const kept = await t.db.one<{ c: number }>(`select count(*)::int as c from rate_limit_hits where bucket = 'kiosk' and key = $1`, [people.R3]);
    expect(kept!.c).toBe(5);
    // Fifteen minutes after the wrong numbers, the kiosk tries again.
    await t.db.query(`update rate_limit_hits set at = at - interval '16 minutes' where bucket = 'kiosk' and key = $1`, [people.R3]);
    expect((await author.get(`/api/policies/kiosk/pending?person_id=${people.R3}&employee_number=R3`)).status).toBe(200);
  });

  it('a burst of parallel wrong numbers is still stopped after five (W17 review)', async () => {
    const id = (await t.api.post('/api/people', { full_name: 'Dee Example', employee_number: 'R7' })).body.id;
    // Bursts of wrong guesses at once. Before the fix every guess was compared ({"403":40}), so a
    // right number hidden among them got through; now at most five are compared in the window and
    // the rest are refused unseen (each attempt is claimed before the number is compared).
    const compared = async (n: number, from: number) => {
      const res = await Promise.all(Array.from({ length: n }, (_, i) => author.get(`/api/policies/kiosk/pending?person_id=${id}&employee_number=X${from + i}`)));
      expect(res.every((r) => r.status === 403 || r.status === 429)).toBe(true);
      return res.filter((r) => r.status === 403).length;
    };
    let wrong = await compared(40, 0);
    for (let burst = 1; burst <= 4; burst++) wrong += await compared(5, burst * 100);
    for (let i = 0; i < 6; i++) wrong += await compared(1, 900 + i);
    expect(wrong).toBe(5);
    expect((await author.get(`/api/policies/kiosk/pending?person_id=${id}&employee_number=R7`)).status).toBe(429);
    const kept = await t.db.one<{ c: number }>(`select count(*)::int as c from rate_limit_hits where bucket = 'kiosk' and key = $1`, [id]);
    expect(kept!.c).toBe(5);
  });

  it('a new version closes the roster requests not answered and asks again', async () => {
    const pub = await publish(policyId, 'Second issue.');
    expect(pub.body.roster_requested).toBe(2);
    const track = await author.get(`/api/policies/${policyId}/person-acknowledgments`);
    expect(track.body.counts.total).toBe(2);
    const mine = await author.get(`/api/policies/person-acknowledgments/person/${people.R1}`);
    expect(mine.body.rows.map((r: any) => r.state).sort()).toEqual(['acknowledged', 'outstanding']);
    const retired = await approver.post(`/api/policies/${policyId}/retire`);
    expect(retired.body.closed).toBe(2);
  });
});
