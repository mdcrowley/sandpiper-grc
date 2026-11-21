import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, SESSION_COOKIE } from '../../core/auth.ts';
import { ADMIN, testApp, type TestApi } from '../../test/helpers.ts';

// Invented people and data only.
let t: Awaited<ReturnType<typeof testApp>>;
let pat: TestApi & { userId: string; token: string };
let lee: TestApi & { userId: string; token: string };
let agent: TestApi & { userId: string };
let itemId: string;
let plainItemId: string;

/** A signed-in client holding the given roles, with its session token (for raw uploads). */
async function person(name: string, roles: string[]) {
  const user = (await t.db.one<{ id: string }>(
    `insert into users (username, email, display_name, status) values ($1,$2,$3,'active') returning id`,
    [name.toLowerCase().replace(/\W/g, ''), `${name.toLowerCase().replace(/\W/g, '')}@example.test`, name]))!;
  for (const r of roles) await t.db.query('insert into user_roles (user_id, role_id) select $1, id from roles where key = $2', [user.id, r]);
  const token = await createSession(t.db, user.id);
  const call = async (method: string, url: string, body?: unknown) => {
    const res = await t.app.inject({ method: method as 'GET', url, headers: { cookie: `${SESSION_COOKIE}=${token}`, 'x-grc-csrf': '1' }, ...(body !== undefined ? { payload: body as object } : {}) });
    let parsed: any = null;
    try { parsed = res.json(); } catch { /* not JSON */ }
    return { status: res.statusCode, body: parsed, text: res.body };
  };
  return {
    userId: user.id, token,
    get: (u: string) => call('GET', u), post: (u: string, b?: unknown) => call('POST', u, b ?? {}),
    patch: (u: string, b?: unknown) => call('PATCH', u, b ?? {}), put: (u: string, b?: unknown) => call('PUT', u, b ?? {}),
    del: (u: string) => call('DELETE', u),
  } as TestApi & { userId: string; token: string };
}

const upload = (token: string, ticketId: string, name: string, data: Buffer) => t.app.inject({
  method: 'PUT', url: `/api/attachments/upload?${new URLSearchParams({ record_type: 'ticket', record_id: ticketId, name })}`,
  headers: { cookie: `${SESSION_COOKIE}=${token}`, 'x-grc-csrf': '1', 'content-type': 'application/octet-stream' },
  payload: data,
});

beforeAll(async () => {
  t = await testApp();
  pat = await person('Pat Example', ['requester']);
  lee = await person('Lee Sample', ['requester']);
  agent = await t.as('agent');
  // "Show in the portal" is a field of the portal: it is offered (and written) only while the portal is on.
  expect((await t.api.patch('/api/admin/features', { features: { portal: true } })).status).toBe(200);
  const item = await t.api.post('/api/catalog-items', {
    name: 'Driver tablet not working', category: 'equipment', active: true, portal: true,
    defaults: { type: 'incident', category: 'hardware', title: 'Driver tablet fault: ', impact: 'individual', urgency: 'high' },
    questions: [{ key: 'vehicle', label: 'Vehicle number', type: 'text', required: true }, { key: 'in_service', label: 'In service?', type: 'yes_no' }],
  });
  itemId = item.body.id;
  plainItemId = (await t.api.post('/api/catalog-items', { name: 'Agent-only item', active: true })).body.id;
  expect((await t.api.patch('/api/admin/features', { features: { portal: false } })).status).toBe(200);
});
afterAll(async () => { await t.close(); });

describe('portal switch', () => {
  it('is off by default, and every portal route says so, its settings included (E14-34)', async () => {
    for (const url of ['/api/portal/config', '/api/portal/requests', '/api/portal/catalog', '/api/portal/knowledge', '/api/portal/assets', '/api/portal/approvals', '/api/portal/settings']) {
      const r = await pat.get(url);
      expect(r.status, url).toBe(404);
      expect(r.body.error.code).toBe('switched_off');
    }
    expect((await t.api.get('/api/portal/settings')).status).toBe(404);
    expect((await pat.post('/api/portal/requests', { title: 'x' })).status).toBe(404);
    // Nobody holds the portal permissions while it is off; the Requester role keeps its grants.
    expect((await pat.get('/api/auth/state')).body.permissions.some((p: string) => p.startsWith('portal.'))).toBe(true);
    expect((await pat.get('/api/auth/state')).body.areasOff).toContain('portal');
    // The catalog's "show in the portal" field is hidden, and its value kept.
    expect((await t.api.get('/api/meta')).body.resources.catalog_item.fields.portal).toBeUndefined();
  });

  it('is switched on under Administration > Features; other settings need tickets.administer', async () => {
    expect((await t.api.patch('/api/admin/features', { features: { portal: true } })).status).toBe(200);
    expect((await t.api.get('/api/meta')).body.resources.catalog_item.fields.portal).toBeDefined();
    expect((await agent.put('/api/portal/settings', { enabled: false })).status).toBe(403);
    expect((await pat.put('/api/portal/settings', { title: 'Mine' })).status).toBe(403);
    const bad = await t.api.put('/api/portal/settings', { title: '', reopen_days: 400, banner: { message: 'x', tone: 'loud' } });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['banner.tone', 'reopen_days', 'title']);
    const ok = await t.api.put('/api/portal/settings', {
      enabled: true, title: 'Depot help', reopen_days: 5,
      banner: { message: 'Real-time arrival screens are down at the central station; we are working on it.', tone: 'outage' },
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ enabled: true, title: 'Depot help', reopen_days: 5, banner: { tone: 'outage' } });
    const cfg = (await pat.get('/api/portal/config')).body;
    expect(cfg).toMatchObject({ enabled: true, allowed: true, title: 'Depot help', can_create: true, banner: { message: expect.stringContaining('arrival screens') } });
    // An agent can change the banner but not the switch.
    expect((await agent.put('/api/portal/settings', { banner: null })).status).toBe(200);
    expect((await pat.get('/api/portal/config')).body.banner).toBeNull();
    // The shared feature switch moved too.
    expect((await t.api.get('/api/auth/state')).body.features.portal).toBe(true);
  });

  it('asks to confirm your identity before switching, as Administration > Features does (E01-33)', async () => {
    const token = (await t.api.post('/api/me/tokens', { name: 'Portal script', scopes: ['*'], expiresInDays: 1 })).body.token;
    await t.db.query(`update sessions set confirmed_at = now() - interval '1 day'`);
    const refused = await t.api.put('/api/portal/settings', { enabled: false });
    expect([refused.status, refused.body.error.code]).toEqual([403, 'reauth_required']);
    // The other settings do not ask, and saving the switch unchanged does not either.
    expect((await t.api.put('/api/portal/settings', { enabled: true, title: 'Depot help' })).status).toBe(200);
    // A token never carries a confirmation.
    const viaToken = await t.app.inject({ method: 'PUT', url: '/api/portal/settings', headers: { authorization: `Bearer ${token}` }, payload: { enabled: false } });
    expect([viaToken.statusCode, viaToken.json().error.code]).toEqual([403, 'reauth_required']);
    expect((await t.api.get('/api/auth/state')).body.features.portal).toBe(true);
    expect((await t.api.post('/api/auth/confirm', { password: ADMIN.password })).status).toBe(200);
    expect((await t.api.put('/api/portal/settings', { enabled: false })).body.enabled).toBe(false);
    // Once off, its settings answer "switched off" too: it comes back on under Administration > Features.
    expect((await t.api.put('/api/portal/settings', { enabled: true })).status).toBe(404);
    expect((await t.api.patch('/api/admin/features', { features: { portal: true } })).status).toBe(200);
    expect((await t.api.get('/api/portal/settings')).body.enabled).toBe(true);
  });

  it('refuses people without portal permissions', async () => {
    const viewer = await t.as('executive_viewer');
    expect((await viewer.get('/api/portal/requests')).status).toBe(403);
    expect((await viewer.get('/api/portal/config')).body).toEqual({ enabled: true, allowed: false });
  });
});

describe('raising requests', () => {
  it('lists only catalog items marked for the portal', async () => {
    const items = (await pat.get('/api/portal/catalog')).body;
    expect(items.map((i: any) => i.id)).toContain(itemId);
    expect(items.map((i: any) => i.id)).not.toContain(plainItemId);
    expect(items.find((i: any) => i.id === itemId)).toMatchObject({ type: 'incident', category_label: 'Equipment', questions: [{ key: 'vehicle' }, { key: 'in_service' }] });
    // The agent catalog can flag the item off again.
    expect((await t.api.get(`/api/catalog-items/${itemId}`)).body.portal).toBe(true);
  });

  it('raises a request from a catalog item, with me as the requester and nothing I should not set', async () => {
    const missing = await pat.post('/api/portal/requests', { catalog_item_id: itemId, answers: {} });
    expect(missing.status).toBe(400);
    expect(missing.body.error.fields).toHaveProperty('catalog_answers.vehicle');
    expect((await pat.post('/api/portal/requests', { catalog_item_id: plainItemId })).status).toBe(404);

    const made = await pat.post('/api/portal/requests', {
      catalog_item_id: itemId, answers: { vehicle: '4127', in_service: true }, details: 'Screen stays black.', where: 'North depot',
      priority: 'p1', assignee_id: agent.userId, requester_id: lee.userId, channel: 'agent',
    });
    expect(made.status).toBe(201);
    expect(made.body.ref).toMatch(/^TKT-/);
    const row = (await t.api.get(`/api/tickets/${made.body.id}`)).body;
    expect(row).toMatchObject({
      title: 'Driver tablet fault: 4127', requester_id: pat.userId, requester_name: 'Pat Example', channel: 'portal',
      type: 'incident', category: 'hardware', urgency: 'high', priority: 'p3', priority_overridden: false, assignee_id: null, catalog_item_id: itemId,
      catalog_answers: [{ key: 'vehicle', value: '4127' }, { key: 'in_service', value: 'Yes' }],
    });
    expect(row.description).toContain('Where: North depot');
  });

  it('reports a problem in plain words, mapped to impact and urgency', async () => {
    const bad = await pat.post('/api/portal/requests', { title: ' ' });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['affects', 'how_urgent', 'title']);
    const made = await pat.post('/api/portal/requests', {
      title: 'Validator on bus 3310 shows an error', details: 'Error E42', where: 'Bus 3310', affects: 'service', how_urgent: 'stopped',
    });
    expect(made.status).toBe(201);
    const row = (await t.api.get(`/api/tickets/${made.body.id}`)).body;
    expect(row).toMatchObject({ type: 'incident', impact: 'organisation', urgency: 'high', priority: 'p1', channel: 'portal', requester_id: pat.userId });
    expect(row.description).toContain('Who is affected: Passengers, safety or the whole service');
  });

  it('needs portal.create to raise one', async () => {
    await t.db.query(`insert into roles (key, name, enabled) values ('portal_reader', 'Portal reader', true)`);
    await t.db.query(`insert into role_permissions (role_id, permission) select id, 'portal.view' from roles where key = 'portal_reader'`);
    const reader = await t.as('portal_reader');
    expect((await reader.get('/api/portal/requests')).status).toBe(200);
    expect((await reader.post('/api/portal/requests', { title: 'x', affects: 'me', how_urgent: 'can_wait' })).status).toBe(403);
  });
});

describe('requester scoping', () => {
  let mine: string;
  let theirs: string;
  let affected: string;

  beforeAll(async () => {
    mine = (await pat.post('/api/portal/requests', { title: 'My printer at the depot office jams', affects: 'me', how_urgent: 'slowed' })).body.id;
    theirs = (await lee.post('/api/portal/requests', { title: 'Lee confidential payroll question', affects: 'me', how_urgent: 'can_wait' })).body.id;
    affected = (await t.api.post('/api/tickets', { title: 'Radio handset swap for Pat', affected_user_id: pat.userId, requester_name: 'Depot supervisor' })).body.id;
  });

  it('lists only my requests, including those where I am the affected person', async () => {
    const list = (await pat.get('/api/portal/requests')).body;
    const ids = list.rows.map((r: any) => r.id);
    expect(ids).toContain(mine);
    expect(ids).toContain(affected);
    expect(ids).not.toContain(theirs);
    expect(list.rows.every((r: any) => typeof r.status.label === 'string')).toBe(true);
    expect((await lee.get('/api/portal/requests')).body.rows.map((r: any) => r.id)).toEqual([theirs]);
    expect((await pat.get('/api/portal/requests?q=printer')).body.rows.map((r: any) => r.id)).toEqual([mine]);
  });

  it('answers "not found" for someone else\'s request on every portal route', async () => {
    for (const r of [
      await pat.get(`/api/portal/requests/${theirs}`),
      await pat.post(`/api/portal/requests/${theirs}/messages`, { body: 'hello' }),
      await pat.post(`/api/portal/requests/${theirs}/reopen`, { reason: 'x' }),
      await pat.post(`/api/portal/requests/${theirs}/rating`, { score: 5 }),
      await pat.get('/api/portal/requests/not-a-uuid'),
    ]) expect(r.status).toBe(404);
  });

  it('keeps every agent route closed to a requester: list, one ticket, stats, export, search, comments, history, links, pickers', async () => {
    const term = 'payroll';
    expect((await pat.get('/api/tickets')).status).toBe(403);
    expect((await pat.get(`/api/tickets?q=${term}`)).status).toBe(403);
    expect((await pat.get(`/api/tickets/${mine}`)).status).toBe(403);
    expect((await pat.get(`/api/tickets/${theirs}`)).status).toBe(403);
    expect((await pat.get('/api/tickets/stats?group=status')).status).toBe(403);
    expect((await pat.get('/api/tickets?format=csv')).status).toBe(403);
    expect((await pat.get(`/api/tickets/${mine}/sla`)).status).toBe(403);
    expect((await pat.patch(`/api/tickets/${mine}`, { priority: 'p1' })).status).toBe(403);
    expect((await pat.post('/api/tickets', { title: 'direct' })).status).toBe(403);
    const search = await pat.get(`/api/search?q=${term}`);
    expect(search.status).toBe(200);
    expect(search.body.filter((r: any) => r.type === 'ticket')).toEqual([]);
    expect((await pat.get(`/api/search?q=printer`)).body.filter((r: any) => r.type === 'ticket')).toEqual([]);
    expect([403, 404]).toContain((await pat.get(`/api/comments?record_type=ticket&record_id=${mine}`)).status);
    expect([403, 404]).toContain((await pat.post('/api/comments', { record_type: 'ticket', record_id: theirs, body: 'x', internal: false })).status);
    expect([403, 404]).toContain((await pat.get(`/api/history?record_type=ticket&record_id=${mine}`)).status);
    expect([403, 404]).toContain((await pat.get(`/api/links?record_type=ticket&record_id=${mine}`)).status);
    expect((await pat.get('/api/records/lookup?type=ticket&q=')).body).toEqual([]);
    expect((await pat.post('/api/records/labels', { records: { ticket: [mine, theirs] } })).body.ticket).toEqual({});
    const meta = (await pat.get('/api/meta')).body;
    expect(meta.resources.ticket).toBeUndefined();
    expect((await pat.get('/api/tickets/metrics')).status).toBe(403);
  });

  it('never shows internal notes, and shows public replies from IT', async () => {
    await t.api.post('/api/comments', { record_type: 'ticket', record_id: mine, body: 'Internal: suspect user error', internal: true });
    await t.api.post('/api/comments', { record_type: 'ticket', record_id: mine, body: 'Can you send a photo of the error?', internal: false });
    const detail = (await pat.get(`/api/portal/requests/${mine}`)).body;
    expect(detail.messages.map((m: any) => m.body)).toEqual(['Can you send a photo of the error?']);
    expect(JSON.stringify(detail)).not.toContain('suspect user error');
    expect(detail.messages[0]).toMatchObject({ mine: false, author_name: 'Test Admin' });
    if (t.app.hasDecorator('notify')) {
      // Pat is told about the public reply (with a link into the portal), not about the internal note.
      const told = (await pat.get('/api/notifications')).body.rows.filter((n: any) => n.route === `/portal/requests/${mine}`);
      expect(told).toHaveLength(1);
      expect(told[0].body).toBe('Can you send a photo of the error?');
    }
    // Fields an agent keeps to themselves are not part of the answer.
    for (const k of ['priority', 'assignment_group', 'resolution_code', 'catalog_answers', 'fulfilment_tasks', 'breach_reason']) {
      expect(detail).not.toHaveProperty(k);
    }
  });

  it('adds my reply as a public comment, and hands a "waiting for you" request back to IT', async () => {
    await t.api.patch(`/api/tickets/${mine}`, { status: 'waiting_requester', assignee_id: agent.userId });
    expect((await pat.get(`/api/portal/requests/${mine}`)).body.status).toMatchObject({ key: 'waiting_you', waiting_on_you: true });
    expect((await pat.post(`/api/portal/requests/${mine}/messages`, { body: '  ' })).status).toBe(400);
    const sent = await pat.post(`/api/portal/requests/${mine}/messages`, { body: 'Photo attached, error E7.' });
    expect(sent.status).toBe(201);
    const comments = (await t.api.get(`/api/comments?record_type=ticket&record_id=${mine}`)).body;
    expect(comments.find((c: any) => c.body === 'Photo attached, error E7.')).toMatchObject({ internal: false, author_id: pat.userId });
    expect((await t.api.get(`/api/tickets/${mine}`)).body.status).toBe('in_progress');
  });

  it('lets me rate a resolved request once; nobody overwrites my answer', async () => {
    expect((await pat.post(`/api/portal/requests/${mine}/rating`, { score: 4 })).status).toBe(409); // not finished yet
    await t.api.patch(`/api/tickets/${mine}`, { status: 'resolved', resolution_code: 'fixed', resolution_notes: 'Cleared the paper path.' });
    const done = (await pat.get(`/api/portal/requests/${mine}`)).body;
    expect(done).toMatchObject({ can_rate: true, can_reply: false, can_reopen: true, status: { key: 'resolved', done: true }, resolution: { label: 'Fixed', notes: 'Cleared the paper path.' } });
    expect((await pat.post(`/api/portal/requests/${mine}/messages`, { body: 'more' })).status).toBe(409);
    expect((await pat.post(`/api/portal/requests/${mine}/rating`, { score: 9 })).status).toBe(400);
    expect((await pat.post(`/api/portal/requests/${mine}/rating`, { score: 4, comment: 'Quick, thanks' })).status).toBe(200);
    expect((await pat.post(`/api/portal/requests/${mine}/rating`, { score: 1 })).status).toBe(409);
    const row = (await t.api.get(`/api/tickets/${mine}`)).body;
    expect(row).toMatchObject({ satisfaction_score: 4, satisfaction_comment: 'Quick, thanks', satisfaction_by_requester: true });
    const overwrite = await t.api.patch(`/api/tickets/${mine}`, { satisfaction_score: 5 });
    expect(overwrite.status).toBe(400);
    expect(overwrite.body.error.fields.satisfaction_score).toMatch(/requester/);
    expect((await pat.get(`/api/portal/requests/${mine}`)).body).toMatchObject({ can_rate: false, rating: { score: 4 } });
  });

  it('lets me reopen within the window, with a reason, and not after it', async () => {
    expect((await pat.post(`/api/portal/requests/${mine}/reopen`, {})).status).toBe(400);
    const ok = await pat.post(`/api/portal/requests/${mine}/reopen`, { reason: 'Jammed again this morning.' });
    expect(ok.status).toBe(200);
    const row = (await t.api.get(`/api/tickets/${mine}`)).body;
    expect(row).toMatchObject({ status: 'in_progress', reopened_count: 1, resolved_at: null });
    // Resolved again, but long ago: the window has closed.
    await t.api.patch(`/api/tickets/${mine}`, { status: 'resolved', resolution_code: 'fixed' });
    await t.db.query(`update tickets set resolved_at = now() - interval '6 days' where id = $1`, [mine]);
    expect((await pat.get(`/api/portal/requests/${mine}`)).body.can_reopen).toBe(false);
    expect((await pat.post(`/api/portal/requests/${mine}/reopen`, { reason: 'again' })).status).toBe(409);
  });

  it('hides a canceled request\'s rating and reopen', async () => {
    await t.api.patch(`/api/tickets/${affected}`, { status: 'cancelled' });
    expect((await pat.get(`/api/portal/requests/${affected}`)).body).toMatchObject({ can_rate: false, can_reopen: false, status: { key: 'cancelled' } });
  });

  it('lets me add files to my own request and fetch only my own files back', async () => {
    if (!t.app.hasDecorator('fileScanner')) return; // attachments module not loaded
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const fresh = (await pat.post('/api/portal/requests', { title: 'Screen cracked', affects: 'me', how_urgent: 'slowed' })).body.id;
    const up = await upload(pat.token, fresh, 'photo.png', png);
    expect(up.statusCode).toBe(201);
    const fileId = up.json().id;
    expect((await upload(pat.token, theirs, 'photo.png', png)).statusCode).toBe(404);
    expect((await pat.get(`/api/portal/requests/${fresh}`)).body.files).toEqual([expect.objectContaining({ id: fileId, file_name: 'photo.png' })]);
    // A file an agent adds to the same ticket is neither listed for the requester nor downloadable by them.
    const ari = await person('Ari Agent', ['agent']);
    const agentFile = await upload(ari.token, fresh, 'internal-notes.png', png);
    expect(agentFile.statusCode).toBe(201);
    expect((await pat.get(`/api/portal/requests/${fresh}`)).body.files.map((f: any) => f.id)).toEqual([fileId]);
    const dl = (token: string, id: string) => t.app.inject({ method: 'GET', url: `/api/attachments/${id}/download`, headers: { cookie: `${SESSION_COOKIE}=${token}` } });
    expect((await dl(pat.token, fileId)).statusCode).toBe(200);
    expect((await dl(pat.token, agentFile.json().id)).statusCode).toBe(404);
    expect((await dl(lee.token, fileId)).statusCode).toBe(404);
    // The agent listing and changes stay closed.
    expect((await pat.get(`/api/attachments?record_type=ticket&record_id=${fresh}`)).status).toBe(404);
    expect([403, 404]).toContain((await pat.del(`/api/attachments/${fileId}`)).status);
    expect([403, 404]).toContain((await pat.patch(`/api/attachments/${fileId}`, { description: 'x' })).status);
    // Agents see the requester's file as usual.
    expect((await t.api.get(`/api/attachments?record_type=ticket&record_id=${fresh}`)).body.rows.map((r: any) => r.id)).toContain(fileId);
  });
});

describe('knowledge for staff', () => {
  let staff: string;
  let agents: string;
  let draft: string;
  beforeAll(async () => {
    staff = (await t.api.post('/api/knowledge', { title: 'Restart a driver tablet', body: 'Hold the power button for ten seconds.', audience: 'staff', status: 'published' })).body.id;
    agents = (await t.api.post('/api/knowledge', { title: 'Tablet admin console reset', body: 'Use the admin console to wipe a tablet.', audience: 'agents', status: 'published' })).body.id;
    draft = (await t.api.post('/api/knowledge', { title: 'Tablet draft notes', body: 'Unfinished tablet guide.', audience: 'staff', status: 'draft' })).body.id;
  });

  it('suggests only published articles for all staff', async () => {
    const found = (await pat.get('/api/portal/knowledge?q=tablet')).body.map((a: any) => a.id);
    expect(found).toContain(staff);
    expect(found).not.toContain(agents);
    expect(found).not.toContain(draft);
    expect((await pat.get(`/api/portal/knowledge/${agents}`)).status).toBe(404);
    expect((await pat.get(`/api/portal/knowledge/${draft}`)).status).toBe(404);
    expect((await pat.get('/api/knowledge')).status).toBe(403);
  });

  it('records "was this helpful"', async () => {
    expect((await pat.post(`/api/portal/knowledge/${staff}/feedback`, { helpful: 'yes' })).status).toBe(400);
    expect((await pat.post(`/api/portal/knowledge/${staff}/feedback`, { helpful: true })).body).toMatchObject({ helpful_yes: 1, your_vote: true });
    expect((await pat.get(`/api/portal/knowledge/${staff}`)).body.your_vote).toBe(true);
  });
});

describe('approvals and assets', () => {
  it('shows approvers the requests waiting for them, and nobody else', async () => {
    // The approvers are worked out when the approval starts (E03-22), so the manager exists first.
    const boss = await person('Sam Manager', ['requester', 'approver']);
    const item = (await t.api.post('/api/catalog-items', { name: 'Scheduling access', active: true, portal: true, requires_approval: true, defaults: { type: 'request' } })).body.id;
    const req = (await pat.post('/api/portal/requests', { catalog_item_id: item })).body.id;
    expect((await pat.get(`/api/portal/requests/${req}`)).body.status.key).toBe('approval');
    const waiting = (await boss.get('/api/portal/approvals')).body.rows;
    expect(waiting.map((r: any) => r.id)).toContain(req);
    expect((await boss.get('/api/portal/config')).body.has.ticket_approvals).toBe(true);
    expect((await pat.get('/api/portal/approvals')).body.rows).toEqual([]);
    // Pat cannot approve her own request.
    expect((await pat.post(`/api/tickets/${req}/approval`, { decision: 'approved' })).status).toBe(403);
    expect((await boss.post(`/api/tickets/${req}/approval`, { decision: 'approved' })).status).toBe(200);
    expect((await boss.get('/api/portal/approvals')).body.rows.map((r: any) => r.id)).not.toContain(req);
  });

  it('lists equipment recorded as used by me', async () => {
    if (!t.ctx.resources.get('asset')) {
      expect((await pat.get('/api/portal/assets')).body).toEqual({ available: false, rows: [] });
      return;
    }
    await t.api.post('/api/assets', { name: 'Supervisor laptop', user_id: pat.userId });
    await t.api.post('/api/assets', { name: 'Someone else laptop', user_id: lee.userId });
    const mine = (await pat.get('/api/portal/assets')).body;
    expect(mine.rows.map((r: any) => r.name)).toEqual(['Supervisor laptop']);
  });
});
