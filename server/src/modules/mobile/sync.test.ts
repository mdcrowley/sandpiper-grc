import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { MOBILE_CLIENT_ID, MOBILE_REDIRECT_URI, type MobilePackage, type SyncAnswer } from '../../../../shared/mobile-api.ts';
import { stableJson, STALE_MS } from './sync.ts';

// Offline work for the mobile app (wave 14, E38-10): the offline package and the outbox. The outbox's
// promise is "each item at most once": the same batch sent twice creates nothing twice, a photo sent
// twice is attached once, refusals come back per item with the route's own reason, and a signed-out
// device cannot send at all.

let t: Awaited<ReturnType<typeof testApp>>;
type Api = typeof t.api;

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

/** Signs the app in as the person behind `api`; answers the access token and device id. */
async function signIn(api: Api = t.api): Promise<{ token: string; deviceId: string }> {
  const { verifier, challenge } = pkce();
  const installation = randomUUID();
  const params = {
    response_type: 'code', client_id: MOBILE_CLIENT_ID, redirect_uri: MOBILE_REDIRECT_URI, scope: 'mobile', state: 'st-1',
    code_challenge: challenge, code_challenge_method: 'S256', installation_id: installation, device_name: 'Field phone 7',
    device_platform: 'android', app_version: '0.1.0',
  };
  const decision = await api.post('/api/mobile/oauth/decision', { ...params, approve: true });
  expect(decision.status, JSON.stringify(decision.body)).toBe(200);
  const code = new URL(decision.body.redirect).searchParams.get('code')!;
  const res = await t.app.inject({
    method: 'POST', url: '/oauth/token', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: MOBILE_REDIRECT_URI, client_id: MOBILE_CLIENT_ID, installation_id: installation }).toString(),
  });
  expect(res.statusCode, res.body).toBe(200);
  return { token: res.json().access_token, deviceId: res.json().device_id };
}

const bearer = async (token: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown, headers: Record<string, string> = {}) => {
  const res = await t.app.inject({ method, url, headers: { authorization: `Bearer ${token}`, ...headers }, ...(payload !== undefined ? { payload: payload as any } : {}) });
  let body: any = null;
  try { body = res.json(); } catch { /* empty */ }
  return { status: res.statusCode, body };
};
const sync = (token: string, items: unknown[]) => bearer(token, 'POST', '/api/mobile/sync', { items });
const photo = (token: string, q: Record<string, string>, bytes: Buffer, key = q.clientId) =>
  bearer(token, 'PUT', `/api/mobile/sync/attachment?${new URLSearchParams(q)}`, bytes, { 'content-type': 'application/octet-stream', 'idempotency-key': key });

const ticketItem = (title: string, clientId = randomUUID()) => ({
  clientId, kind: 'record.create', payload: { path: '/api/tickets', recordType: 'ticket', body: { title, description: 'Invented: water on the floor at bay 3.' } },
});
const ticketsTitled = async (title: string) => (await t.db.query<{ id: string }>('select id from tickets where title = $1 and deleted_at is null', [title])).length;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]), randomBytes(400), Buffer.from([0xff, 0xd9])]);

beforeAll(async () => {
  t = await testApp();
  const on = await t.api.patch('/api/admin/features', { features: { mobile: true } });
  expect(on.status, JSON.stringify(on.body)).toBe(200);
  await t.api.get('/api/auth/state');
});
afterAll(async () => { await t.close(); });

describe('pieces', () => {
  it('fingerprints content, not key order', () => {
    expect(stableJson({ b: 1, a: [{ d: 2, c: null }] })).toBe(stableJson({ a: [{ c: null, d: 2 }], b: 1 }));
  });
});

describe('the outbox', () => {
  it('the same batch sent twice creates nothing twice', async () => {
    const { token } = await signIn();
    const items = [ticketItem('Invented leak A'), ticketItem('Invented leak B')];
    const first = await sync(token, items);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.items.map((a: SyncAnswer) => a.status)).toEqual(['done', 'done']);
    expect(first.body.items[0].result).toMatchObject({ recordType: 'ticket', ref: expect.stringMatching(/^TKT-/) });
    // The answer was lost: the phone sends the whole batch again.
    const again = await sync(token, items);
    expect(again.body.items.map((a: SyncAnswer) => [a.status, a.replayed])).toEqual([['done', true], ['done', true]]);
    expect(again.body.items[0].result.id).toBe(first.body.items[0].result.id);
    expect(await ticketsTitled('Invented leak A')).toBe(1);
    expect(await ticketsTitled('Invented leak B')).toBe(1);
    // Once in the audit log, under the person, from the app.
    const audits = await t.db.query<any>(`select id from audit_events where record_type = 'ticket' and record_id = $1 and action = 'ticket.create'`, [first.body.items[0].result.id]);
    expect(audits).toHaveLength(1);
  });

  it('refuses the same id with different content, and answers each item separately', async () => {
    const { token } = await signIn();
    const item = ticketItem('Invented door fault');
    expect((await sync(token, [item])).body.items[0].status).toBe('done');
    const changed = { ...item, payload: { ...item.payload, body: { title: 'Something else' } } };
    const reused = await sync(token, [changed]);
    expect(reused.body.items[0]).toMatchObject({ status: 'rejected', error: { code: 'idempotency_key_reused' } });

    const bad = { clientId: randomUUID(), kind: 'record.create', payload: { path: '/api/tickets', recordType: 'ticket', body: { description: 'No title' } } };
    const unknown = { clientId: randomUUID(), kind: 'inspection.teleport', payload: {} };
    const elsewhere = { clientId: randomUUID(), kind: 'record.create', payload: { path: '/api/admin/users', recordType: 'user', body: {} } };
    const ok = ticketItem('Invented light out');
    const res = await sync(token, [bad, unknown, elsewhere, ok, { clientId: 'nope', kind: 'record.create', payload: {} }]);
    const [a, b, c, d, e] = res.body.items as SyncAnswer[];
    expect(a).toMatchObject({ status: 'rejected', error: { code: 'validation' } });
    expect(a.error!.fields?.title).toBeTruthy();
    expect(b).toMatchObject({ status: 'rejected', error: { code: 'unknown_kind' } });
    expect(c).toMatchObject({ status: 'rejected', error: { code: 'bad_item' } });
    expect(d.status).toBe('done');
    expect(e).toMatchObject({ status: 'rejected', error: { code: 'bad_item' } });
    // A refusal is not remembered: corrected, the same id goes through.
    const fixed = await sync(token, [{ ...bad, payload: { ...bad.payload, body: { title: 'Invented corrected report' } } }]);
    expect(fixed.body.items[0].status).toBe('done');
  });

  it('links the new record to the one it was about, and reports a refused link as a warning', async () => {
    const { token } = await signIn();
    const site = await t.api.post('/api/sites', { name: 'Invented depot 4' });
    expect(site.status, JSON.stringify(site.body)).toBe(201);
    const linked = { ...ticketItem('Invented linked report'), payload: { ...ticketItem('x').payload, body: { title: 'Invented linked report' }, link: { type: 'site', id: site.body.id } } };
    const res = await sync(token, [linked]);
    expect(res.body.items[0]).toMatchObject({ status: 'done', result: { linked: true } });
    const links = await t.api.get(`/api/links?record_type=ticket&record_id=${res.body.items[0].result.id}`);
    expect(JSON.stringify(links.body)).toContain(site.body.id);
    const broken = { ...ticketItem('Invented unlinked report'), payload: { ...ticketItem('x').payload, body: { title: 'Invented unlinked report' }, link: { type: 'site', id: randomUUID() } } };
    const res2 = await sync(token, [broken]);
    expect(res2.body.items[0]).toMatchObject({ status: 'done', result: { linked: false, warning: expect.stringMatching(/not linked/) } });
  });

  it('a removed permission is refused with the server\'s reason, never dropped', async () => {
    const agent = await t.as('agent');
    const { token } = await signIn(agent);
    expect((await sync(token, [ticketItem('Invented agent report')])).body.items[0].status).toBe('done');
    // The person moves to a role that may not create tickets.
    await t.db.query(`delete from user_roles where user_id = $1`, [agent.userId]);
    await t.db.query(`insert into user_roles (user_id, role_id) select $1, id from roles where key = 'project_manager'`, [agent.userId]);
    const res = await sync(token, [ticketItem('Invented refused report')]);
    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({ status: 'rejected', error: { code: 'forbidden' } });
    expect(res.body.items[0].error.message).toBeTruthy();
    expect(await ticketsTitled('Invented refused report')).toBe(0);
  });

  it('a revoked device\'s sync is refused, and so is anything but the app', async () => {
    const { token, deviceId } = await signIn();
    expect((await t.api.del(`/api/me/devices/${deviceId}`)).status).toBeLessThan(300);
    const res = await sync(token, [ticketItem('Invented after sign-out')]);
    expect(res.status).toBe(401);
    expect(await ticketsTitled('Invented after sign-out')).toBe(0);
    // A browser session or a personal access token is not the app.
    expect((await t.api.post('/api/mobile/sync', { items: [ticketItem('Invented from web')] })).body.error.code).toBe('mobile_app_only');
    expect((await t.api.get('/api/mobile/package')).body.error.code).toBe('mobile_app_only');
  });

  it('keeps items in order: after one that must wait, the rest wait too', async () => {
    const { token } = await signIn();
    const busy = ticketItem('Invented busy report');
    // Another send of the same item is still running (claimed a moment ago).
    const me = await t.db.one<any>('select user_id from mobile_devices order by created_at desc limit 1');
    const real = createHash('sha256').update('record.create\n').update(stableJson({ ...busy.payload, link: null })).digest('hex');
    await t.db.query(
      `insert into mobile_sync_items (user_id, device_id, client_id, kind, fingerprint, state, expires_at)
       values ($1, $2, $3, 'record.create', $4, 'running', now() + interval '1 day')`,
      [me.user_id, randomUUID(), busy.clientId, real]);
    const later = ticketItem('Invented later report');
    const waiting = await sync(token, [busy, later]);
    expect(waiting.body.items.map((a: SyncAnswer) => [a.status, a.error?.code])).toEqual([['retry', 'idempotency_in_progress'], ['retry', 'not_tried']]);
    expect(await ticketsTitled('Invented later report')).toBe(0);
    // A claim the server never finished (it stopped part-way) is not redone by itself: the person checks.
    await t.db.query(`update mobile_sync_items set created_at = now() - make_interval(secs => $2::int) where client_id = $1`, [busy.clientId, STALE_MS / 1000 + 60]);
    const stale = await sync(token, [busy, later]);
    expect(stale.body.items.map((a: SyncAnswer) => a.status)).toEqual(['rejected', 'done']);
    expect(stale.body.items[0].error.code).toBe('uncertain');
    expect(await ticketsTitled('Invented busy report')).toBe(0);
  });

  it('attaches a photo once to the record an earlier item made, even when sent twice', async () => {
    const { token } = await signIn();
    const report = ticketItem('Invented report with photos');
    const made = (await sync(token, [report])).body.items[0];
    expect(made.status).toBe('done');
    const p1 = { clientId: randomUUID(), parent: report.clientId, name: 'photo-1.jpg' };
    const first = await photo(token, p1, JPEG);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({ status: 'done', result: { recordType: 'ticket', id: made.result.id, fileName: 'photo-1.jpg' } });
    const again = await photo(token, p1, JPEG);
    expect(again.body).toMatchObject({ status: 'done', replayed: true, result: { attachmentId: first.body.result.attachmentId } });
    const files = await t.db.query('select id from attachments where record_type = $1 and record_id = $2', ['ticket', made.result.id]);
    expect(files).toHaveLength(1);
    // Different bytes under the same id are refused; a different id is a second photo.
    expect((await photo(token, p1, Buffer.concat([JPEG, Buffer.from([0])]))).body.error.code).toBe('idempotency_key_reused');
    expect((await photo(token, { ...p1, clientId: randomUUID(), name: 'photo-2.jpg' }, JPEG)).body.status).toBe('done');
    // A photo whose report never arrived, a refused file type, and a key that does not match.
    expect((await photo(token, { clientId: randomUUID(), parent: randomUUID(), name: 'photo-3.jpg' }, JPEG)).body).toMatchObject({ status: 'rejected', error: { code: 'parent_missing' } });
    expect((await photo(token, { clientId: randomUUID(), parent: report.clientId, name: 'tool.exe' }, JPEG)).body.status).toBe('rejected');
    expect((await photo(token, { clientId: randomUUID(), parent: report.clientId, name: 'p.jpg' }, JPEG, randomUUID())).status).toBe(400);
  });

  it('forgets answers after seven days', async () => {
    const { token } = await signIn();
    const item = ticketItem('Invented old report');
    await sync(token, [item]);
    const row = await t.db.one<any>('select expires_at, created_at from mobile_sync_items where client_id = $1', [item.clientId]);
    const days = (new Date(row.expires_at).getTime() - new Date(row.created_at).getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(7);
  });
});

describe('the offline package', () => {
  it('holds my work, the report choices, sites, my inspections and their tag values, and expires', async () => {
    const { token } = await signIn();
    await t.api.post('/api/sites', { name: 'Invented depot 9' });
    const res = await bearer(token, 'GET', '/api/mobile/package');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const p = res.body as MobilePackage;
    const days = (Date.parse(p.expiresAt) - Date.parse(p.generatedAt)) / 86_400_000;
    expect(Math.round(days)).toBe(7);
    expect(p.work.sections.length).toBeGreaterThan(0);
    expect(p.lookups.safety_event_type?.length).toBeGreaterThan(0);
    expect(p.sites.some((s) => s.label === 'Invented depot 9')).toBe(true);
    expect(p.attachments?.allowedExtensions).toContain('jpg');
    expect(Array.isArray(p.parts.inspections)).toBe(true);

    // The administrator's setting decides the expiry.
    await t.db.query(`insert into settings (key, value) values ('mobile.offline_days', '3') on conflict (key) do update set value = excluded.value`);
    const short = (await bearer(token, 'GET', '/api/mobile/package')).body as MobilePackage;
    expect(Math.round((Date.parse(short.expiresAt) - Date.parse(short.generatedAt)) / 86_400_000)).toBe(3);
  });

  it('holds only what the person may see', async () => {
    const pm = await t.as('project_manager');
    const { token } = await signIn(pm);
    const p = (await bearer(token, 'GET', '/api/mobile/package')).body as MobilePackage;
    // No sites.view, no safety lists: left out, not refused.
    expect(p.sites).toEqual([]);
    expect(p.lookups.safety_event_type).toBeUndefined();
    expect(p.parts.inspections).toBeUndefined();
  });

  it('carries the tag values of the records my inspections cover', async () => {
    const { token } = await signIn();
    const me = (await t.api.get('/api/auth/state')).body.user;
    const asset = await t.api.post('/api/assets', { name: 'Invented pump 12' });
    expect(asset.status, JSON.stringify(asset.body)).toBe(201);
    const tpl = await t.api.post('/api/checklist-templates', { name: 'Invented pump check', status: 'active' });
    expect(tpl.status, JSON.stringify(tpl.body)).toBe(201);
    const ins = await t.api.post('/api/inspections', { template_id: tpl.body.id, target_type: 'asset', target_id: asset.body.id, inspector_id: me.id, due_on: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) });
    expect(ins.status, JSON.stringify(ins.body)).toBe(201);
    const p = (await bearer(token, 'GET', '/api/mobile/package')).body as MobilePackage;
    const mine = (p.parts.inspections as any[]).find((i) => i.id === ins.body.id);
    expect(mine).toMatchObject({ target: { type: 'asset', id: asset.body.id } });
    expect(p.tags?.values).toContainEqual(expect.objectContaining({ value: asset.body.tag, recordType: 'asset', recordId: asset.body.id, label: 'Invented pump 12' }));
  });
});
