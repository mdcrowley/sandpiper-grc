import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { ANONYMIZED_TEXT } from '../../core/retention.ts';
import { testApp } from '../../test/helpers.ts';

// The committee figures for the assistants (wave 11 contract C5) and anonymizing a committee's typed
// member names at the end of retention (E28-12). Invented data only. Runs alone
// (GRC_MODULES=governance) and with every module.

let t: Awaited<ReturnType<typeof testApp>>;
let secretary: Awaited<ReturnType<typeof t.as>>;
let viewer: Awaited<ReturnType<typeof t.as>>;
let committeeId = '';
const DAY = 86_400_000;

beforeAll(async () => {
  t = await testApp();
  secretary = await t.as('compliance_officer'); // governance.*
  viewer = await t.as('safety_manager');        // governance.view, no security.view
  committeeId = (await secretary.post('/api/committees', { name: 'Invented summary committee', kind: 'risk', secretary_id: secretary.userId })).body.id;
});
afterAll(async () => { await t.close(); });

describe('GET /api/governance/summary', () => {
  it('counts meetings, minutes and decisions for everyone alike, and names nothing', async () => {
    const meeting = async (title: string, at: number) =>
      (await secretary.post('/api/meetings', { committee_id: committeeId, title, scheduled_at: new Date(Date.now() + at).toISOString() })).body;
    await meeting('Invented upcoming meeting Kestrel', 10 * DAY);
    await meeting('Invented later meeting Osprey', 60 * DAY);
    const held = await meeting('Invented held meeting Plover', -20 * DAY);
    expect((await secretary.patch(`/api/meetings/${held.id}`, { status: 'held' })).status).toBe(200);
    const d1 = await secretary.post('/api/meeting-decisions', { meeting_id: held.id, title: 'Invented decision Tern', outcome: 'approved' });
    expect(d1.status, JSON.stringify(d1.body)).toBe(201);
    expect((await secretary.post('/api/meeting-decisions', { meeting_id: held.id, title: 'Invented decision Gannet', outcome: 'noted' })).status).toBe(201);
    // A decision about a restricted record: hidden from the viewer's lists, still counted.
    await t.db.query(`update meeting_decisions set restricted = true where id = $1`, [d1.body.id]);
    expect((await viewer.get(`/api/meeting-decisions/${d1.body.id}`)).status).toBe(404);

    const res = await viewer.get('/api/governance/summary');
    expect(res.status).toBe(200);
    const s = res.body;
    expect(s.committees).toEqual({ active: 1, total: 1 });
    expect(s.meetings).toMatchObject({ upcoming_30_days: 1, upcoming_90_days: 2, upcoming_30_days_without_pack: 1, held_last_12_months: 1 });
    expect(s.minutes).toMatchObject({ to_write: 1, late: 1, awaiting_approval: 0, late_after_days: 7 });
    expect(s.decisions.total).toBe(2);
    expect(s.decisions.last_12_months).toBe(2);
    expect(s.decisions.by_outcome.find((o: Row) => o.value === 'approved').count).toBe(1);
    expect(s.decisions.by_outcome.find((o: Row) => o.value === 'noted').count).toBe(1);
    // The same figures for the administrator.
    expect((await t.api.get('/api/governance/summary')).body.decisions).toEqual(s.decisions);
    // Figures only.
    const text = JSON.stringify(s);
    for (const word of ['Kestrel', 'Osprey', 'Plover', 'Tern', 'Gannet', 'Invented']) expect(text).not.toContain(word);
  });

  it('needs governance.view', async () => {
    const agent = await t.as('agent');
    expect((await agent.get('/api/governance/summary')).status).toBe(403);
    expect((await t.anon.get('/api/governance/summary')).status).toBe(401);
  });
});

describe('anonymizing a committee (E28-12)', () => {
  it('clears the names typed for members with no account or roster person, and only those', async () => {
    const c = (await secretary.post('/api/committees', { name: 'Invented committee to anonymize', kind: 'other' })).body;
    const add = (b: Row) => secretary.post(`/api/committees/${c.id}/members`, b);
    expect((await add({ name: 'Invented Typed Member', side: 'labor' })).status).toBe(201);
    expect((await add({ user_id: viewer.userId, side: 'management' })).status).toBe(201);
    const other = (await add({ name: 'Invented Second Typed Member' })).body;
    const keep = (await secretary.post(`/api/committees/${committeeId}/members`, { name: 'Invented Member Of Another Committee' })).body;

    await t.core.retention.anonymize(t.ctx.resources.get('committee')!, c.id);

    const rows = await t.db.query<Row>('select id, name, user_id from committee_members where committee_id = $1 order by created_at', [c.id]);
    expect(rows.filter((r) => !r.user_id).map((r) => r.name)).toEqual([ANONYMIZED_TEXT, ANONYMIZED_TEXT]);
    expect(rows.find((r) => r.user_id)!.name).toBeNull();
    expect((await t.db.one<Row>('select name from committee_members where id = $1', [other.id]))!.name).toBe(ANONYMIZED_TEXT);
    expect((await t.db.one<Row>('select name from committee_members where id = $1', [keep.id]))!.name).toBe('Invented Member Of Another Committee');
    expect(JSON.stringify(await t.db.query('select * from committee_members where committee_id = $1', [c.id]))).not.toContain('Invented Typed Member');
  });
});
