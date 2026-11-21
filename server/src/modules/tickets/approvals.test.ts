import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// E03-21 and E03-22: catalog request approvals by more than one person, by named people, or only
// for some answers, running on the shared approval workflows (kind `ticket_approval`). Invented data.
let t: Awaited<ReturnType<typeof testApp>>;
let agent: Awaited<ReturnType<typeof t.as>>;
let first: Awaited<ReturnType<typeof t.as>>;
let second: Awaited<ReturnType<typeof t.as>>;
let third: Awaited<ReturnType<typeof t.as>>;

const loaded = !process.env.GRC_MODULES || process.env.GRC_MODULES.split(',').includes('workflows');

beforeAll(async () => {
  t = await testApp();
  agent = await t.as('agent');
  first = await t.as('approver');
  second = await t.as('approver');
  third = await t.as('approver');
});
afterAll(async () => { await t.close(); });

const base = { requester_name: 'Pat Example', type: 'request' };
const workflowOf = async (ticketId: string) => (await t.api.get(`/api/workflows/records/ticket/${ticketId}`)).body.instances as any[];

describe('approval settings on a catalog item', () => {
  it('checks the number of approvals, the approvers, the condition and the workflow', async () => {
    const bad = await t.api.post('/api/catalog-items', { name: 'Bad', requires_approval: true, approvals_needed: 9 });
    expect(bad.body.error.fields.approvals_needed).toBeTruthy();
    expect((await t.api.post('/api/catalog-items', { name: 'Bad', approver_ids: ['nobody'] })).body.error.fields.approver_ids).toBeTruthy();
    const noQuestion = await t.api.post('/api/catalog-items', {
      name: 'Bad', questions: [{ label: 'System' }], approval_condition: { question: 'other', answers: ['x'] },
    });
    expect(noQuestion.body.error.fields.approval_condition).toContain('does not ask');
    const noAnswers = await t.api.post('/api/catalog-items', { name: 'Bad', approval_condition: { question: 'system', answers: [] } });
    expect(noAnswers.body.error.fields.approval_condition).toBeTruthy();
    if (!loaded) return;
    const unknown = await t.api.post('/api/catalog-items', { name: 'Bad', requires_approval: true, approval_workflow_id: '00000000-0000-4000-8000-000000000000' });
    expect(unknown.body.error.fields.approval_workflow_id).toBeTruthy();
    // The workflows an item can name: the default one is there from the start.
    const offered = (await agent.get('/api/tickets/approval-workflows')).body.rows;
    expect(offered.map((w: any) => w.name)).toContain('Catalog request approval');
  });
});

describe.runIf(loaded)('two approvals from named people', () => {
  it('waits for both, refuses others and the requester, and audits each decision', async () => {
    const item = await t.api.post('/api/catalog-items', {
      name: 'Access to the dispatch system', requires_approval: true, approvals_needed: 2,
      approver_ids: [first.userId, second.userId, third.userId], questions: [{ label: 'Reason', required: true }],
    });
    expect(item.status).toBe(201);
    // The settings sent through the API name a workflow with exactly that step.
    expect(item.body.approval_workflow_id).toBeTruthy();
    const made = await agent.post('/api/tickets', { ...base, title: 'Dispatch access for a new controller', catalog_item_id: item.body.id, catalog_answers: { reason: 'New starter' } });
    expect(made.body.approval_status).toBe('pending');
    expect((await t.api.get(`/api/tickets/${made.body.id}`)).body.approvals_needed).toBe(2);
    const url = `/api/tickets/${made.body.id}`;
    expect((await workflowOf(made.body.id))[0]).toMatchObject({ kind: 'ticket_approval', status: 'running' });

    // Someone who may approve in general, but is not named.
    const other = await t.as('approver');
    expect((await other.post(`${url}/approval`, { decision: 'approved' })).status).toBe(403);
    expect((await other.get(`${url}/approvals`)).body).toMatchObject({ can_decide: false, cannot_decide_reason: expect.stringContaining('other approvers') });

    const one = await first.post(`${url}/approval`, { decision: 'approved', note: 'Fine by me' });
    expect(one.status).toBe(200);
    expect(one.body.approval_status).toBe('pending');
    expect((await first.post(`${url}/approval`, { decision: 'approved' })).status).toBe(409);
    const view = (await second.get(`${url}/approvals`)).body;
    expect(view).toMatchObject({ needed: 2, approved: 1, can_decide: true });

    // The shared Approvals page (and so the assistant tools my_approvals / decide_approval) lists it.
    const waiting = (await second.get('/api/workflows/approvals')).body.rows.find((r: any) => r.record_id === made.body.id);
    expect(waiting).toMatchObject({ kind: 'ticket_approval', record_type: 'ticket', approvals: 1, required: 2 });
    const two = await second.post(`/api/workflows/steps/${waiting.step_id}/decision`, { decision: 'approved' });
    expect(two.status).toBe(200);
    const after = (await t.api.get(url)).body;
    expect(after).toMatchObject({ approval_status: 'approved', approval_by: second.userId });
    const history = (await t.api.get(`/api/history?record_type=ticket&record_id=${made.body.id}`)).body;
    expect(history.filter((h: any) => h.action === 'workflow.decide')).toHaveLength(2);
    expect(history.some((h: any) => h.action === 'ticket.approval' && /approved by/.test(h.summary))).toBe(true);
    // Work can start now.
    expect((await agent.patch(url, { status: 'in_progress' })).status).toBe(200);
  });

  it('is rejected by one rejection, keeps work blocked, and can be asked again', async () => {
    const item = await t.api.post('/api/catalog-items', { name: 'Two approvals, anyone', requires_approval: true, approvals_needed: 2 });
    const made = await agent.post('/api/tickets', { ...base, title: 'Shared mailbox', catalog_item_id: item.body.id });
    const url = `/api/tickets/${made.body.id}`;
    expect((await first.post(`${url}/approval`, { decision: 'approved' })).body.approval_status).toBe('pending');
    expect((await second.post(`${url}/approval`, { decision: 'rejected' })).status).toBe(400); // a reason is needed
    expect((await second.post(`${url}/approval`, { decision: 'rejected', note: 'Not for this team' })).body).toMatchObject({ approval_status: 'rejected', approval_note: 'Not for this team' });
    // Rejected: nobody decides any more, and work cannot start.
    expect((await third.post(`${url}/approval`, { decision: 'approved' })).status).toBe(409);
    const blocked = await agent.patch(url, { status: 'in_progress' });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.fields.status).toContain('rejected');
    expect((await agent.get(`${url}/approvals`)).body.can_ask_again).toBe(true);
    // An agent asks again: a new workflow starts and the request waits again.
    const again = await agent.post(`${url}/approval/ask`, {});
    expect(again.body.approval_status).toBe('pending');
    expect((await agent.post(`${url}/approval/ask`, {})).status).toBe(409);
    expect((await workflowOf(made.body.id)).map((i) => i.status)).toEqual(['running', 'rejected']);
    await first.post(`${url}/approval`, { decision: 'approved' });
    expect((await third.post(`${url}/approval`, { decision: 'approved', note: 'Agreed with the team lead' })).body.approval_status).toBe('approved');
  });

  it('never lets the requester approve their own request', async () => {
    const item = await t.api.post('/api/catalog-items', { name: 'Own approval', requires_approval: true });
    const made = await t.api.post('/api/tickets', { ...base, title: 'Mine', requester_id: first.userId, catalog_item_id: item.body.id });
    const r = await first.post(`/api/tickets/${made.body.id}/approval`, { decision: 'approved' });
    expect(r.status).toBe(403);
    expect(r.body.error.message).toContain('your own request');
    expect((await first.get('/api/workflows/approvals')).body.rows.some((x: any) => x.record_id === made.body.id)).toBe(false);
  });

  it('stops the approval when the request is canceled', async () => {
    const item = await t.api.post('/api/catalog-items', { name: 'Cancel me', requires_approval: true });
    const made = await agent.post('/api/tickets', { ...base, title: 'Not needed after all', catalog_item_id: item.body.id });
    expect((await agent.patch(`/api/tickets/${made.body.id}`, { status: 'cancelled' })).status).toBe(200);
    expect((await workflowOf(made.body.id))[0].status).toBe('canceled');
  });
});

describe.runIf(loaded)('approval only for some answers', () => {
  it('asks for approval when the answer matches, and not otherwise', async () => {
    const item = await t.api.post('/api/catalog-items', {
      name: 'System access', requires_approval: true,
      questions: [{ label: 'Restricted system', type: 'yes_no', required: true }],
      approval_condition: { question: 'restricted_system', answers: ['Yes'] },
    });
    expect(item.status).toBe(201);
    expect(item.body.approval_condition).toEqual({ question: 'restricted_system', answers: ['Yes'] });
    const yes = await agent.post('/api/tickets', { ...base, title: 'Access: yes', catalog_item_id: item.body.id, catalog_answers: { restricted_system: true } });
    expect(yes.body.approval_status).toBe('pending');
    expect(await workflowOf(yes.body.id)).toHaveLength(1);
    const no = await agent.post('/api/tickets', { ...base, title: 'Access: no', catalog_item_id: item.body.id, catalog_answers: { restricted_system: false } });
    expect(no.body.approval_status).toBeNull();
    expect(await workflowOf(no.body.id)).toHaveLength(0);
  });
});

describe.runIf(loaded)('upgrade from the approvals before workflows', () => {
  it('turns item settings into workflows and adopts a waiting request with its earlier approval', async () => {
    const item = await t.api.post('/api/catalog-items', { name: 'Radio programming access', requires_approval: true });
    const made = await agent.post('/api/tickets', { ...base, title: 'Radio access', catalog_item_id: item.body.id });
    // Put it back as it was before E03-22: item settings, the ticket's own approvers and one approval given.
    const q = (sql: string, params: unknown[] = []) => t.db.query(sql, params);
    await q('delete from workflow_instances where record_id = $1', [made.body.id]);
    await q('update catalog_items set approval_workflow_id = null, approvals_needed = 2, approver_ids = $2::jsonb where id = $1', [item.body.id, JSON.stringify([first.userId, second.userId])]);
    await q(`update tickets set approval_status = 'pending', approvals_needed = 2, approver_ids = $2::jsonb where id = $1`, [made.body.id, JSON.stringify([first.userId, second.userId])]);
    await q(`insert into ticket_approvals (ticket_id, user_id, user_name, decision, note) values ($1, $2, 'First approver', 'approved', 'Given before the upgrade')`, [made.body.id, first.userId]);
    await q(`delete from workflow_kind_installs where kind = 'ticket_approval'`);

    expect(await t.app.workflows!.installKinds()).toContain('ticket_approval');
    const converted = (await t.api.get(`/api/catalog-items/${item.body.id}`)).body;
    expect(converted.approval_workflow_id).toBeTruthy();
    const def = (await t.api.get(`/api/workflows/definitions/${converted.approval_workflow_id}`)).body;
    expect(def).toMatchObject({ kind: 'ticket_approval', trigger: 'module' });
    expect(def.steps[0]).toMatchObject({ quorum: 2, approvers: { kind: 'users', users: [first.userId, second.userId] } });

    const [running] = await workflowOf(made.body.id);
    expect(running).toMatchObject({ status: 'running', kind: 'ticket_approval' });
    expect(running.steps[0].decisions).toEqual([expect.objectContaining({ user_id: first.userId, decision: 'approved', adopted: true })]);
    // The earlier decision still shows on the ticket, and the second approval finishes it.
    expect((await t.api.get(`/api/tickets/${made.body.id}/approvals`)).body.decisions[0]).toMatchObject({ user_name: 'First approver', earlier: true });
    expect((await second.post(`/api/tickets/${made.body.id}/approval`, { decision: 'approved' })).body.approval_status).toBe('approved');
  });
});
