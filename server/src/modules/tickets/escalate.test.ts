import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { fillCatalogStarters } from './defaults.ts';

// E45-28 to E45-32: one-click paths out of a ticket, and linking tickets from the problem's side. Invented data only.
let t: Awaited<ReturnType<typeof testApp>>;
let systemId: string;
beforeAll(async () => {
  t = await testApp();
  systemId = (await t.api.post('/api/systems', { name: 'Example depot booking system' })).body.id;
});
afterAll(async () => { await t.close(); });

const ticket = async (extra: Record<string, unknown> = {}) => {
  const res = await t.api.post('/api/tickets', {
    title: 'Suspicious email with an attachment', description: 'Opened the attachment, then the screen flickered.',
    requester_name: 'Sam Sample', requester_email: 'sam@example.test', requester_department: 'Scheduling', system_id: systemId, ...extra,
  });
  expect(res.status).toBe(201);
  return res.body;
};
const links = async (type: string, id: string) => (await t.api.get(`/api/links?record_type=${type}&record_id=${id}`)).body as any[];

describe('raise a security incident from a ticket', () => {
  it('carries title, description, requester and system, counts from the ticket opening, and links both ways', async () => {
    const tk = await ticket();
    const res = await t.api.post(`/api/tickets/${tk.id}/security-incident`, { severity: 'high' });
    expect(res.status).toBe(201);
    expect(res.body.route).toBe(`/security-incidents/${res.body.id}`);
    const inc = (await t.api.get(`/api/security-incidents/${res.body.id}`)).body;
    expect(inc.title).toBe(tk.title);
    expect(inc.severity).toBe('high');
    expect(inc.summary).toContain('screen flickered');
    expect(inc.summary).toContain(`Raised from ticket ${tk.ref}`);
    expect(inc.summary).toContain('Sam Sample <sam@example.test> (Scheduling)');
    expect(inc.affected_systems).toContain('Example depot booking system');
    expect(new Date(inc.discovered_at).getTime()).toBe(new Date(tk.opened_at).getTime());
    const fromTicket = await links('ticket', tk.id);
    expect(fromTicket.find((l) => l.type === 'security_incident')?.relation).toBe('escalated_to');
    expect((await links('security_incident', inc.id)).find((l) => l.type === 'ticket')?.recordId).toBe(tk.id);
    // The ticket's history does not tell that a restricted incident exists; the incident's does.
    const history = (await t.api.get(`/api/history?record_type=ticket&record_id=${tk.id}`)).body;
    expect(JSON.stringify(history)).not.toContain('security_incident');
  });

  it('needs permission to create security incidents', async () => {
    const tk = await ticket();
    const agent = await t.as('agent');
    expect((await agent.post(`/api/tickets/${tk.id}/security-incident`, {})).status).toBe(403);
    expect((await agent.post('/api/tickets/00000000-0000-4000-8000-000000000000/change', {})).status).toBe(404);
  });
});

describe('raise a change from a ticket', () => {
  it('creates a draft change with the system and the ticket in its reason, linked as the fix', async () => {
    const tk = await ticket({ title: 'Booking screen times out at shift change' });
    const res = await t.api.post(`/api/tickets/${tk.id}/change`, {});
    expect(res.status).toBe(201);
    const change = (await t.api.get(`/api/changes/${res.body.id}`)).body;
    expect(change.title).toBe('Booking screen times out at shift change');
    expect(change.status).toBe('draft');
    expect(change.system_id).toBe(systemId);
    expect(change.reason).toContain(`Raised from ticket ${tk.ref}`);
    const fromTicket = await links('ticket', tk.id);
    expect(fromTicket.find((l) => l.type === 'change')).toMatchObject({ relation: 'fixes', direction: 'in', recordId: change.id });
  });
});

describe('problems from a ticket and from the problem side', () => {
  it('creates a problem from a ticket, or links an existing one', async () => {
    const tk = await ticket({ title: 'Printer at the depot jams' });
    const made = await t.api.post(`/api/tickets/${tk.id}/problem`, {});
    expect(made.status).toBe(200);
    expect(made.body.created).toBe(true);
    const problem = (await t.api.get(`/api/problems/${made.body.id}`)).body;
    expect(problem.title).toBe('Printer at the depot jams');
    expect(problem.description).toContain(`Raised from ticket ${tk.ref}`);
    expect((await t.api.get(`/api/tickets/${tk.id}`)).body.problem_id).toBe(problem.id);

    const other = await ticket({ title: 'Printer jams again' });
    const linked = await t.api.post(`/api/tickets/${other.id}/problem`, { problem_id: problem.id });
    expect(linked.body.created).toBe(false);
    expect((await t.api.get(`/api/tickets/${other.id}`)).body.problem_id).toBe(problem.id);
    expect((await t.api.post(`/api/tickets/${other.id}/problem`, { problem_id: 'nope' })).status).toBe(400);
  });

  it('links several tickets at once, skips those already linked, and unlinks one', async () => {
    const problem = (await t.api.post('/api/problems', { title: 'Card readers drop off the network' })).body;
    const a = await ticket({ title: 'Card reader offline at gate 1' });
    const b = await ticket({ title: 'Card reader offline at gate 2' });
    const res = await t.api.post(`/api/problems/${problem.id}/tickets`, { ticket_ids: [a.id, b.id] });
    expect(res.status).toBe(200);
    expect(res.body.linked).toBe(2);
    const again = await t.api.post(`/api/problems/${problem.id}/tickets`, { ticket_ids: [a.id, '00000000-0000-4000-8000-000000000000'] });
    expect(again.body.linked).toBe(0);
    expect(again.body.skipped.map((s: any) => s.reason).sort()).toEqual(['already linked', 'not found']);
    const list = (await t.api.get(`/api/tickets?f.problem_id=${problem.id}`)).body;
    expect(list.total).toBe(2);
    expect((await t.api.post(`/api/problems/${problem.id}/tickets`, { ticket_ids: [] })).status).toBe(400);

    expect((await t.api.del(`/api/problems/${problem.id}/tickets/${a.id}`)).status).toBe(200);
    expect((await t.api.get(`/api/tickets/${a.id}`)).body.problem_id).toBeNull();
    expect((await t.api.del(`/api/problems/${problem.id}/tickets/${a.id}`)).status).toBe(404);
  });
});

describe('mark as duplicate', () => {
  it('links to the original, resolves with the code Duplicate, and refuses loops and itself', async () => {
    const original = await ticket({ title: 'Wi-Fi down in the dispatch office' });
    const dup = await ticket({ title: 'No wireless in dispatch' });
    const res = await t.api.post(`/api/tickets/${dup.id}/duplicate`, { of_id: original.id });
    expect(res.status).toBe(200);
    expect(res.body.of.ref).toBe(original.ref);
    const after = (await t.api.get(`/api/tickets/${dup.id}`)).body;
    expect(after.status).toBe('resolved');
    expect(after.resolution_code).toBe('duplicate');
    expect(after.resolution_notes).toContain(`Duplicate of ${original.ref}`);
    expect((await links('ticket', original.id)).find((l) => l.recordId === dup.id)).toMatchObject({ relation: 'duplicate_of', direction: 'in' });

    const loop = await t.api.post(`/api/tickets/${original.id}/duplicate`, { of_id: dup.id });
    expect(loop.status).toBe(400);
    expect(loop.body.error.fields.of_id).toContain('already marked as a duplicate');
    expect((await t.api.post(`/api/tickets/${original.id}/duplicate`, { of_id: original.id })).status).toBe(400);
    expect((await t.api.post(`/api/tickets/${original.id}/duplicate`, {})).status).toBe(400);
  });
});

describe('built-in catalog items', () => {
  it('ship with questions and fulfillment tasks', async () => {
    const items = (await t.api.get('/api/catalog-items?pageSize=100')).body.rows as any[];
    for (const name of ['Access request', 'Hardware', 'Software', 'Equipment fault', 'Leaver', 'Vendor access', 'New starter']) {
      const item = items.find((i) => i.name === name);
      expect(item, name).toBeTruthy();
      expect(item.questions?.length, name).toBeGreaterThan(2);
      expect(item.tasks?.length, name).toBeGreaterThan(1);
    }
  });

  it('fills only the empty parts of an item installed before they had any', async () => {
    const access = (await t.db.one<{ id: string }>(`select id from catalog_items where name = 'Access request'`))!;
    const hardware = (await t.db.one<{ id: string }>(`select id from catalog_items where name = 'Hardware'`))!;
    await t.db.query('update catalog_items set questions = null, tasks = null where id = $1', [access.id]);
    await t.db.query(`update catalog_items set questions = null, tasks = '["Our own task"]'::jsonb where id = $1`, [hardware.id]);
    expect(await fillCatalogStarters(t.ctx)).toBe(2);
    const a = (await t.api.get(`/api/catalog-items/${access.id}`)).body;
    expect(a.questions.map((q: any) => q.key)).toContain('level');
    expect(a.tasks).toContain('Confirm with the requester');
    const h = (await t.api.get(`/api/catalog-items/${hardware.id}`)).body;
    expect(h.tasks).toEqual(['Our own task']);
    expect(h.questions.length).toBeGreaterThan(2);
    expect(await fillCatalogStarters(t.ctx)).toBe(0);
  });
});
