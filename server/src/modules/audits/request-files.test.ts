import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, SESSION_COOKIE } from '../../core/auth.ts';
import { testApp } from '../../test/helpers.ts';

// E41-09: the person asked for evidence attaches files to their request without `audits.edit`.

let t: Awaited<ReturnType<typeof testApp>>;
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj\n<< /Type /Catalog >>\nendobj\n', 'latin1'), Buffer.alloc(300, 0x20)]);

async function send(token: string, method: 'PUT' | 'GET' | 'DELETE', url: string, payload?: Buffer) {
  const res = await t.app.inject({
    method, url,
    headers: { cookie: `${SESSION_COOKIE}=${token}`, 'x-grc-csrf': '1', ...(payload ? { 'content-type': 'application/octet-stream' } : {}) },
    ...(payload ? { payload } : {}),
  });
  let body: any = null;
  try { body = res.json(); } catch { /* a file */ }
  return { status: res.statusCode, body, raw: res.rawPayload };
}

let asked: { userId: string; token: string };
let other: { userId: string; token: string };
let requestId = '';
let restrictedRequest = '';

beforeAll(async () => {
  t = await testApp();
  const person = async (name: string) => {
    const u = (await t.db.one<{ id: string }>(`insert into users (username, email, display_name, status) values ($1, $2, $3, 'active') returning id`,
      [name, `${name}@example.test`, `Invented ${name}`]))!;
    return { userId: u.id, token: await createSession(t.db, u.id) };
  };
  asked = await person('asked');
  other = await person('other');
  const audit = (await t.api.post('/api/audits', { title: 'Invented audit of depot keys', audit_type: 'internal_audit' })).body.id;
  requestId = (await t.api.post('/api/audit-requests', { audit_id: audit, request: 'The key register', owner_id: asked.userId })).body.id;
  const secret = (await t.api.post('/api/audits', { title: 'Invented restricted audit', audit_type: 'internal_audit', restricted: true })).body.id;
  restrictedRequest = (await t.api.post('/api/audit-requests', { audit_id: secret, request: 'Restricted request', owner_id: asked.userId })).body.id;
}, 120_000);
afterAll(async () => { await t?.close(); });

describe('evidence files from the person asked (E41-09)', () => {
  it('attaches, lists and downloads a file on their own request, with no audit permission', async () => {
    const up = await send(asked.token, 'PUT', `/api/audit-requests/${requestId}/files?name=Key%20register.pdf&description=Signed%20copy`, PDF);
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    expect(up.body).toMatchObject({ file_name: 'Key register.pdf', description: 'Signed copy', mine: true });
    const mine = await send(asked.token, 'GET', '/api/audit-requests/mine');
    expect(mine.body.files_available).toBe(true);
    expect(mine.body.open[0].files.map((f: any) => f.id)).toEqual([up.body.id]);
    // Not the restricted request: the person may not see restricted records.
    expect(mine.body.open.map((r: any) => r.id)).toEqual([requestId]);
    expect((await send(asked.token, 'GET', `/api/audit-requests/${requestId}/files/${up.body.id}`)).raw.equals(PDF)).toBe(true);
    // The auditor sees it as an evidence file on the request.
    const files = await t.api.get(`/api/attachments?record_type=audit_request&record_id=${requestId}`);
    expect(files.body.rows).toEqual([expect.objectContaining({ id: up.body.id, kind: 'evidence', uploaded_by_name: 'Invented asked' })]);
    expect((await t.db.query(`select 1 from audit_events where action = 'attachment.upload' and record_id = $1`, [requestId])).length).toBe(1);
  });

  it('refuses anyone else, restricted requests, bad files and accepted evidence', async () => {
    expect((await send(other.token, 'PUT', `/api/audit-requests/${requestId}/files?name=x.pdf`, PDF)).status).toBe(404);
    expect((await send(asked.token, 'PUT', `/api/audit-requests/${restrictedRequest}/files?name=x.pdf`, PDF)).status).toBe(404);
    const exe = await send(asked.token, 'PUT', `/api/audit-requests/${requestId}/files?name=tool.exe`, PDF);
    expect(exe.status).toBe(415);
    const fileId = (await send(asked.token, 'GET', '/api/audit-requests/mine')).body.open[0].files[0].id;
    expect((await send(other.token, 'GET', `/api/audit-requests/${requestId}/files/${fileId}`)).status).toBe(404);
    expect((await send(other.token, 'DELETE', `/api/audit-requests/${requestId}/files/${fileId}`)).status).toBe(404);
    // Accepted evidence stays as it is.
    await t.api.patch(`/api/audit-requests/${requestId}`, { status: 'accepted' });
    expect((await send(asked.token, 'PUT', `/api/audit-requests/${requestId}/files?name=late.pdf`, PDF)).status).toBe(409);
    expect((await send(asked.token, 'DELETE', `/api/audit-requests/${requestId}/files/${fileId}`)).status).toBe(409);
    await t.api.patch(`/api/audit-requests/${requestId}`, { status: 'returned' });
    const removed = await send(asked.token, 'DELETE', `/api/audit-requests/${requestId}/files/${fileId}`);
    expect(removed.status).toBe(200);
    expect((await send(asked.token, 'GET', '/api/audit-requests/mine')).body.open[0].files).toEqual([]);
  });

  it('keeps a file the auditor added out of the person\'s reach to remove', async () => {
    const res = await t.app.inject({
      method: 'PUT', url: `/api/attachments/upload?record_type=audit_request&record_id=${requestId}&name=Auditor%20note.pdf`,
      headers: { cookie: `${SESSION_COOKIE}=${await createSession(t.db, (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id)}`, 'x-grc-csrf': '1', 'content-type': 'application/octet-stream' },
      payload: PDF,
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().id;
    const listed = (await send(asked.token, 'GET', '/api/audit-requests/mine')).body.open[0].files;
    expect(listed).toEqual([expect.objectContaining({ id, mine: false })]);
    expect((await send(asked.token, 'DELETE', `/api/audit-requests/${requestId}/files/${id}`)).status).toBe(403);
  });
});
