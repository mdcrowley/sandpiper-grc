import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';

// E45-66: a change linked to an incident it caused counts as not successful in the change success rate,
// whatever its outcome says: a link from the change ("caused") to a ticket, security incident or safety
// event, or from one of those to the change ("caused by"). A deleted incident no longer counts. Invented data.

let t: Awaited<ReturnType<typeof testApp>>;
const confirm = () => t.db.query('update sessions set confirmed_at = now()');
const finished = async (title: string, outcome: string) => {
  const res = await t.api.post('/api/changes', {
    title, description: 'x', reason: 'y', implementation_plan: 'a', test_plan: 'b', backout_plan: 'c',
    status: 'completed', outcome, planned_start: `${dayInZone(-3)}T18:00:00Z`, planned_end: `${dayInZone(-3)}T20:00:00Z`, actual_end: `${dayInZone(-3)}T20:00:00Z`,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
};
const rate = async () => (await t.api.get(`/api/changes/success-rate?from=${dayInZone(-10)}`)).body;

beforeAll(async () => {
  t = await testApp();
  await confirm();
  expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('change success and the incidents changes caused', () => {
  it('counts a successful change that caused an incident as not successful', async () => {
    const a = await finished('Invented router firmware update', 'successful');
    const b = await finished('Invented timetable import', 'successful');
    await finished('Invented printer swap', 'failed');
    const before = await rate();
    expect(before).toMatchObject({ finished: 3, successful: 2, unsuccessful: 1, caused_incident: 0 });

    const inc = (await t.api.post('/api/security-incidents', { title: 'Invented outage after an update', scenario: 'ransomware', severity: 'high', discovered_at: `${dayInZone(-2)}T08:00:00Z` })).body;
    expect((await t.api.post('/api/links', { from_type: 'change', from_id: a, to_type: 'security_incident', to_id: inc.id, relation: 'caused' })).status).toBe(201);
    // From the incident's side, "caused by" counts too.
    const ticket = (await t.api.post('/api/tickets', { title: 'Invented timetable missing', type: 'incident' })).body;
    expect((await t.api.post('/api/links', { from_type: 'ticket', from_id: ticket.id, to_type: 'change', to_id: b, relation: 'caused by' })).status).toBe(201);
    const after = await rate();
    expect(after).toMatchObject({ finished: 3, successful: 0, unsuccessful: 3, caused_incident: 2, success_pct: 0 });

    // A related link does not count; a deleted incident no longer does.
    await t.api.post('/api/links', { from_type: 'change', from_id: a, to_type: 'ticket', to_id: ticket.id, relation: 'related' });
    expect((await t.api.del(`/api/tickets/${ticket.id}`)).status).toBe(200);
    expect(await rate()).toMatchObject({ successful: 1, caused_incident: 1 });
  });
});
