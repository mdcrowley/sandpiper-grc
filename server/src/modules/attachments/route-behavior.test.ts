import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, SESSION_COOKIE } from '../../core/auth.ts';
import { ADMIN, testApp } from '../../test/helpers.ts';

// Behavior test for POST /api/attachments/admin/purge/run (E40-05): destructive, so it must remove only
// removed files past the purge period, skip the files of records under a legal hold, need
// admin.administer and a recent password confirmation, and audit each purge.

let t: Awaited<ReturnType<typeof testApp>>;
let adminId = '';
let adminToken = '';

async function upload(recordId: string, name: string, data: string) {
  const res = await t.app.inject({
    method: 'PUT', url: `/api/attachments/upload?${new URLSearchParams({ record_type: 'system', record_id: recordId, name })}`,
    headers: { cookie: `${SESSION_COOKIE}=${adminToken}`, 'x-grc-csrf': '1', 'content-type': 'application/octet-stream' },
    payload: Buffer.from(data),
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}
const system = async (name: string) => (await t.api.post('/api/systems', { name })).body;
const row = (id: string) => t.db.one<any>('select * from attachments where id = $1', [id]);
const removedDaysAgo = (id: string, days: number) =>
  t.db.query(`update attachments set deleted_at = now() - make_interval(days => $2::int) where id = $1`, [id, days]);

beforeAll(async () => {
  t = await testApp();
  adminId = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
  adminToken = await createSession(t.db, adminId);
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('POST /api/attachments/admin/purge/run', () => {
  it('needs admin.administer and a recent password confirmation, and purges nothing when refused', async () => {
    const sys = await system('Purge refusal system');
    const file = await upload(sys.id, 'refused.txt', 'not yet');
    expect((await t.api.del(`/api/attachments/${file.id}`)).status).toBe(200);
    await removedDaysAgo(file.id, 400);

    const agent = await t.as('agent');
    expect((await agent.post('/api/attachments/admin/purge/run')).status).toBe(403);
    const security = await t.as('security_lead');
    expect((await security.post('/api/attachments/admin/purge/run')).status).toBe(403);
    expect((await t.anon.post('/api/attachments/admin/purge/run')).status).toBe(401);

    // An administrator whose password was not confirmed recently is asked to confirm first.
    const stale = await createSession(t.db, adminId);
    await t.db.query(`update sessions set confirmed_at = now() - interval '2 hours' where user_id = $1`, [adminId]);
    const fresh = await t.app.inject({
      method: 'POST', url: '/api/attachments/admin/purge/run', payload: {},
      headers: { cookie: `${SESSION_COOKIE}=${stale}`, 'x-grc-csrf': '1' },
    });
    expect(fresh.statusCode).toBe(403);
    expect(fresh.json().error.code).toBe('reauth_required');
    expect((await row(file.id)).purged_at).toBeNull();

    // Clean up so the next test counts only its own files.
    await t.db.query('update attachments set deleted_at = now() where id = $1', [file.id]);
  });

  it('removes only removed files past the period, keeps held records\' files, and audits each purge', async () => {
    const free = await system('Retired depot camera');
    const held = await system('Camera under hold');
    const recent = await system('Recently cleaned camera');
    const live = await system('Live camera');

    const due = await upload(free.id, 'due.txt', 'purge me now');
    const onHold = await upload(held.id, 'held.txt', 'keep me for counsel');
    const tooNew = await upload(recent.id, 'recent.txt', 'too new');
    const kept = await upload(live.id, 'live.txt', 'still attached');
    for (const f of [due, onHold, tooNew]) expect((await t.api.del(`/api/attachments/${f.id}`)).status).toBe(200);
    await removedDaysAgo(due.id, 45);
    await removedDaysAgo(onHold.id, 45);
    await removedDaysAgo(tooNew.id, 2);

    const h = (await t.api.post('/api/legal-holds', { matter: 'Invented matter: camera footage' })).body;
    expect((await t.api.post(`/api/legal-holds/${h.id}/records`, { records: [{ type: 'system', id: held.id }] })).status).toBe(201);

    const keys = Object.fromEntries(await Promise.all([due, onHold, tooNew, kept].map(async (f) => [f.id, (await row(f.id)).storage_key])));
    expect((await t.api.post('/api/auth/confirm', { password: ADMIN.password })).status).toBe(200);
    const res = await t.api.post('/api/attachments/admin/purge/run');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ purged: 1, bytes: 'purge me now'.length, failed: 0, days: 30 });

    expect((await row(due.id)).purged_at).not.toBeNull();
    expect(await t.app.attachmentStores.local.stat(keys[due.id])).toBeNull();
    for (const f of [onHold, tooNew, kept]) {
      expect((await row(f.id)).purged_at).toBeNull();
      expect(await t.app.attachmentStores.local.stat(keys[f.id])).not.toBeNull();
    }
    const events = await t.db.query<any>(`select record_id, summary from audit_events where action = 'attachment.purge'`);
    expect(events).toEqual([{ record_id: free.id, summary: 'Removed file purged from storage after 30 days: due.txt (12 bytes)' }]);

    // Nothing more is due: a second run purges nothing.
    expect((await t.api.post('/api/attachments/admin/purge/run')).body).toMatchObject({ purged: 0, failed: 0 });
  });

  it('purges nothing at all when the period is 0 (keep removed files forever)', async () => {
    const sys = await system('Keep forever system');
    const file = await upload(sys.id, 'forever.txt', 'forever');
    await t.api.del(`/api/attachments/${file.id}`);
    await removedDaysAgo(file.id, 4000);
    expect((await t.api.patch('/api/attachments/admin/purge', { purgeDays: 0 })).status).toBe(200);
    expect((await t.api.post('/api/attachments/admin/purge/run')).body).toEqual({ purged: 0, bytes: 0, failed: 0, days: 0 });
    expect((await row(file.id)).purged_at).toBeNull();
  });
});
