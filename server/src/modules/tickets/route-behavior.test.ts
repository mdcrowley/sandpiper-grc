import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// Behavior test for POST /api/tickets/:id/approval/ask [tickets.edit] (E40-05): a rejected request gets
// a new approval workflow; a request already waiting, or one that needs no approval, is refused.

let t: Awaited<ReturnType<typeof testApp>>;
const MISSING = '00000000-0000-4000-8000-0000000000ee';
const loaded = !process.env.GRC_MODULES || process.env.GRC_MODULES.split(',').includes('workflows');
const base = { requester_name: 'Invented requester', type: 'request' };
const instances = async (id: string) => (await t.api.get(`/api/workflows/records/ticket/${id}`)).body.instances as any[];

beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(async () => { await t?.close(); });

describe.runIf(loaded)('POST /api/tickets/:id/approval/ask', () => {
  it('asks again after a rejection, starting a new workflow, and audits it', async () => {
    const agent = await t.as('agent');
    const approver = await t.as('approver');
    const item = (await t.api.post('/api/catalog-items', { name: 'Invented radio console access', requires_approval: true })).body;
    const made = (await agent.post('/api/tickets', { ...base, title: 'Console access for the night desk', catalog_item_id: item.id })).body;
    expect(made.approval_status).toBe('pending');

    // While the first approval waits, asking again is refused.
    const early = await agent.post(`/api/tickets/${made.id}/approval/ask`);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('already_running');

    expect((await approver.post(`/api/tickets/${made.id}/approval`, { decision: 'rejected', note: 'Missing the invented supervisor sign-off.' })).body.approval_status).toBe('rejected');

    // Someone who may approve but not edit tickets cannot ask again.
    expect((await approver.post(`/api/tickets/${made.id}/approval/ask`)).status).toBe(403);
    expect((await (await t.as('project_manager')).post(`/api/tickets/${made.id}/approval/ask`)).status).toBe(403); // tickets.view

    const res = await agent.post(`/api/tickets/${made.id}/approval/ask`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: made.id, approval_status: 'pending', approval_by: null });
    const runs = await instances(made.id);
    expect(runs).toHaveLength(2);
    expect(runs.filter((r) => r.status === 'running')).toHaveLength(1);
    const ev = await t.db.query<any>(`select * from audit_events where action = 'ticket.approval_asked' and record_id = $1`, [made.id]);
    expect(ev).toHaveLength(1);
    expect(ev[0].before).toEqual({ approval_status: 'rejected' });
    expect(ev[0].after).toEqual({ approval_status: 'pending' });

    // And the new request can be approved.
    expect((await approver.post(`/api/tickets/${made.id}/approval`, { decision: 'approved' })).body.approval_status).toBe('approved');
    // An approved request is not waiting for approval.
    expect((await agent.post(`/api/tickets/${made.id}/approval/ask`)).body.error.code).toBe('no_approval');
  });

  it('refuses a ticket that needs no approval and one that does not exist', async () => {
    const plain = (await t.api.post('/api/tickets', { ...base, title: 'Plain invented request' })).body;
    expect(plain.approval_status).toBeNull();
    const res = await t.api.post(`/api/tickets/${plain.id}/approval/ask`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('no_approval');
    expect(await t.db.query(`select 1 from audit_events where action = 'ticket.approval_asked' and record_id = $1`, [plain.id])).toHaveLength(0);
    expect((await t.api.post(`/api/tickets/${MISSING}/approval/ask`)).status).toBe(404);
  });
});
