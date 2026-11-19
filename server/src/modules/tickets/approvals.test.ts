import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// E03-21: approval by more than one person, by named people, or only for some answers. Invented data.
let t: Awaited<ReturnType<typeof testApp>>;
let agent: Awaited<ReturnType<typeof t.as>>;
let first: Awaited<ReturnType<typeof t.as>>;
let second: Awaited<ReturnType<typeof t.as>>;
let third: Awaited<ReturnType<typeof t.as>>;

beforeAll(async () => {
  t = await testApp();
  agent = await t.as('agent');
  first = await t.as('approver');
  second = await t.as('approver');
  third = await t.as('approver');
});
afterAll(async () => { await t.close(); });

const base = { requester_name: 'Pat Example', type: 'request' };

describe('approval settings on a catalog item', () => {
  it('checks the number of approvals, the approvers and the condition', async () => {
    const bad = await t.api.post('/api/catalog-items', { name: 'Bad', requires_approval: true, approvals_needed: 9 });
    expect(bad.body.error.fields.approvals_needed).toBeTruthy();
    expect((await t.api.post('/api/catalog-items', { name: 'Bad', approver_ids: ['nobody'] })).body.error.fields.approver_ids).toBeTruthy();
    const noQuestion = await t.api.post('/api/catalog-items', {
      name: 'Bad', questions: [{ label: 'System' }], approval_condition: { question: 'other', answers: ['x'] },
    });
    expect(noQuestion.body.error.fields.approval_condition).toContain('does not ask');
    const noAnswers = await t.api.post('/api/catalog-items', { name: 'Bad', approval_condition: { question: 'system', answers: [] } });
    expect(noAnswers.body.error.fields.approval_condition).toBeTruthy();
  });
});

describe('two approvals from named people', () => {
  it('waits for both, refuses others and the requester, and audits each decision', async () => {
    const item = await t.api.post('/api/catalog-items', {
      name: 'Access to the dispatch system', requires_approval: true, approvals_needed: 2,
      approver_ids: [first.userId, second.userId, third.userId], questions: [{ label: 'Reason', required: true }],
    });
    expect(item.status).toBe(201);
    expect(item.body).toMatchObject({ approvals_needed: 2, approver_ids: [first.userId, second.userId, third.userId] });
    const made = await agent.post('/api/tickets', { ...base, title: 'Dispatch access for a new controller', catalog_item_id: item.body.id, catalog_answers: { reason: 'New starter' } });
    expect(made.body).toMatchObject({ approval_status: 'pending', approvals_needed: 2 });
    const url = `/api/tickets/${made.body.id}`;

    // Someone who may approve in general, but is not named.
    const other = await t.as('approver');
    expect((await other.post(`${url}/approval`, { decision: 'approved' })).status).toBe(403);
    expect((await other.get(`${url}/approvals`)).body).toMatchObject({ can_decide: false, cannot_decide_reason: expect.stringContaining('other approvers') });

    const one = await first.post(`${url}/approval`, { decision: 'approved', note: 'Fine by me' });
    expect(one.status).toBe(200);
    expect(one.body.approval_status).toBe('pending');
    expect((await first.post(`${url}/approval`, { decision: 'approved' })).status).toBe(409);
    const view = (await first.get(`${url}/approvals`)).body;
    expect(view).toMatchObject({ needed: 2, approved: 1, my_decision: 'approved', approvers: expect.arrayContaining([expect.objectContaining({ id: second.userId })]) });

    const two = await second.post(`${url}/approval`, { decision: 'approved' });
    expect(two.body.approval_status).toBe('approved');
    const history = (await t.api.get(`/api/history?record_type=ticket&record_id=${made.body.id}`)).body;
    expect(history.filter((h: any) => h.action === 'ticket.approval').map((h: any) => h.summary)).toEqual(expect.arrayContaining([
      expect.stringContaining('(1 of 2 approvals)'), expect.stringContaining('(2 of 2 approvals)'),
    ]));
  });

  it('is rejected by one rejection, and an approval afterwards overturns it', async () => {
    const item = await t.api.post('/api/catalog-items', { name: 'Two approvals, anyone', requires_approval: true, approvals_needed: 2 });
    const made = await agent.post('/api/tickets', { ...base, title: 'Shared mailbox', catalog_item_id: item.body.id });
    const url = `/api/tickets/${made.body.id}`;
    expect((await first.post(`${url}/approval`, { decision: 'approved' })).body.approval_status).toBe('pending');
    expect((await second.post(`${url}/approval`, { decision: 'rejected', note: 'Not for this team' })).body.approval_status).toBe('rejected');
    // Approving after a rejection overturns it; one more approval is still needed for two.
    expect((await third.post(`${url}/approval`, { decision: 'approved', note: 'Agreed with the team lead' })).body.approval_status).toBe('approved');
    const view = (await t.api.get(`${url}/approvals`)).body;
    expect(view.decisions.find((d: any) => d.decision === 'rejected')).toMatchObject({ superseded: true, counts: false });
  });

  it('never lets the requester approve their own request', async () => {
    const item = await t.api.post('/api/catalog-items', { name: 'Own approval', requires_approval: true });
    const made = await t.api.post('/api/tickets', { ...base, title: 'Mine', requester_id: first.userId, catalog_item_id: item.body.id });
    const r = await first.post(`/api/tickets/${made.body.id}/approval`, { decision: 'approved' });
    expect(r.status).toBe(403);
    expect(r.body.error.message).toContain('your own request');
  });
});

describe('approval only for some answers', () => {
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
    const no = await agent.post('/api/tickets', { ...base, title: 'Access: no', catalog_item_id: item.body.id, catalog_answers: { restricted_system: false } });
    expect(no.body.approval_status).toBeNull();
  });
});
