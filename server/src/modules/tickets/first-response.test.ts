import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { clock } from './clock.ts';

// E18-74: assigning is not a response; starting work or a public comment by staff is. E18-84: the
// requester is found among the accounts and the roster. Invented data only.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { clock.set(null); await t.close(); });

const base = { title: 'Invented first-response probe', requester_name: 'Pat Example', impact: 'individual', urgency: 'high' };
const comment = (api: { post: (u: string, b: unknown) => Promise<{ status: number }> }, id: string, internal: boolean) =>
  api.post('/api/comments', { record_type: 'ticket', record_id: id, body: 'Invented comment', internal });

describe('first response (E18-74)', () => {
  it('is not met by logging a ticket already assigned, nor by the requester\'s own comment', async () => {
    clock.set('2026-11-18T15:00:00Z');
    const agent = await t.as('agent');
    const requester = await t.as('agent');
    const made = (await agent.post('/api/tickets', { ...base, assignee_id: agent.userId, status: 'assigned', requester_id: requester.userId })).body;
    expect(made.first_responded_at).toBeNull();
    // The requester writing on their own ticket is not an answer to them.
    clock.set('2026-11-18T15:05:00Z');
    expect((await comment(requester, made.id, false)).status).toBe(201);
    expect((await t.api.get(`/api/tickets/${made.id}`)).body.first_responded_at).toBeNull();
    // Staff answering in public is; it is audited.
    clock.set('2026-11-18T15:07:00Z');
    expect((await comment(agent, made.id, false)).status).toBe(201);
    const after = (await t.api.get(`/api/tickets/${made.id}`)).body;
    expect(after.first_responded_at).toBe('2026-11-18T15:07:00.000Z');
    expect(after.response_breached).toBe(false);
    expect(await t.db.one(`select 1 as ok from audit_events where action = 'ticket.first_response' and record_id = $1`, [made.id])).toEqual({ ok: 1 });
  });

  it('is met at once by a ticket logged as already in progress, and late answers keep the breach', async () => {
    clock.set('2026-11-18T15:00:00Z');
    const working = (await t.api.post('/api/tickets', { ...base, status: 'in_progress' })).body;
    expect(working.first_responded_at).toBe('2026-11-18T15:00:00.000Z');
    const late = (await t.api.post('/api/tickets', { ...base, impact: 'organisation' })).body; // P1: respond in 15 minutes
    clock.set('2026-11-18T16:00:00Z');
    expect((await comment(t.api, late.id, false)).status).toBe(201);
    expect((await t.api.get(`/api/tickets/${late.id}`)).body).toMatchObject({ first_responded_at: '2026-11-18T16:00:00.000Z', response_breached: true });
  });

});

describe('finding the requester (E18-84)', () => {
  it('finds accounts for agents, and roster people only for those who may see the roster', async () => {
    const someone = await t.as('agent');
    await t.db.query(`update users set display_name = 'Invented Quill Marrow', email = 'quill.marrow@example.test' where id = $1`, [someone.userId]);
    const dept = (await t.db.one<{ id: string }>(`insert into departments (name) values ('Invented requester department') returning id`))!.id;
    await t.db.query('update users set department_id = $2 where id = $1', [someone.userId, dept]);
    const hasPeople = !!t.ctx.resources.get('person');
    if (hasPeople) {
      expect((await t.api.post('/api/people', { full_name: 'Invented Quill Rostered', email: 'quill.roster@example.test', employee_number: 'INV-77' })).status).toBe(201);
    }
    const admin = (await t.api.get('/api/tickets/requesters?q=quill')).body.rows;
    expect(admin.find((r: any) => r.kind === 'user')).toMatchObject({ id: someone.userId, name: 'Invented Quill Marrow', email: 'quill.marrow@example.test', department: 'Invented requester department', user_id: someone.userId });
    if (hasPeople) expect(admin.find((r: any) => r.kind === 'person')).toMatchObject({ name: 'Invented Quill Rostered', number: 'INV-77', user_id: null });
    // By employee number too.
    if (hasPeople) expect((await t.api.get('/api/tickets/requesters?q=INV-77')).body.rows.map((r: any) => r.name)).toEqual(['Invented Quill Rostered']);
    // An agent has no roster access: accounts only.
    const agent = await t.as('agent');
    const seen = (await agent.get('/api/tickets/requesters?q=quill')).body.rows;
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((r: any) => r.kind === 'user')).toBe(true);
    // Too short a search finds nothing; someone who cannot log tickets is refused.
    expect((await t.api.get('/api/tickets/requesters?q=q')).body.rows).toEqual([]);
    const viewer = await t.as('executive_viewer');
    expect((await viewer.get('/api/tickets/requesters?q=quill')).status).toBe(403);
  });
});
