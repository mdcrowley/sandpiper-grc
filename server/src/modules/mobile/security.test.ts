import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { MOBILE_CLIENT_ID, MOBILE_REDIRECT_URI, type SyncAnswer } from '../../../../shared/mobile-api.ts';

// The security review of the mobile app's server side (wave 16, E38-15): which credential reaches which
// route (the app's own token, a browser session, a personal access token), that an outbox item's
// idempotency answer is never given to another person, and that a photo larger than the organization's
// attachment limit is refused before it is read into memory.

let t: Awaited<ReturnType<typeof testApp>>;
type Api = typeof t.api;

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};
const authorizeRequest = (installation: string, challenge: string) => ({
  response_type: 'code', client_id: MOBILE_CLIENT_ID, redirect_uri: MOBILE_REDIRECT_URI, scope: 'mobile', state: 'st-1',
  code_challenge: challenge, code_challenge_method: 'S256', installation_id: installation, device_name: 'Invented phone',
  device_platform: 'android', app_version: '0.1.0',
});

/** Signs the app in as the person behind `api`; answers the access token and device id. */
async function signIn(api: Api = t.api): Promise<{ token: string; deviceId: string }> {
  const { verifier, challenge } = pkce();
  const installation = randomUUID();
  const decision = await api.post('/api/mobile/oauth/decision', { ...authorizeRequest(installation, challenge), approve: true });
  expect(decision.status, JSON.stringify(decision.body)).toBe(200);
  const code = new URL(decision.body.redirect).searchParams.get('code')!;
  const res = await t.app.inject({
    method: 'POST', url: '/oauth/token', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: MOBILE_REDIRECT_URI, client_id: MOBILE_CLIENT_ID, installation_id: installation }).toString(),
  });
  expect(res.statusCode, res.body).toBe(200);
  return { token: res.json().access_token, deviceId: res.json().device_id };
}

const bearer = async (token: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, headers: Record<string, string> = {}) => {
  const res = await t.app.inject({ method, url, headers: { authorization: `Bearer ${token}`, ...headers }, ...(payload !== undefined ? { payload: payload as any } : {}) });
  let body: any = null;
  try { body = res.json(); } catch { /* empty */ }
  return { status: res.statusCode, body };
};
const ticketItem = (title: string, clientId = randomUUID()) => ({
  clientId, kind: 'record.create', payload: { path: '/api/tickets', recordType: 'ticket', body: { title, description: 'Invented: a loose panel at bay 2.' } },
});
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]), randomBytes(400), Buffer.from([0xff, 0xd9])]);
const photo = (token: string, q: Record<string, string>, bytes: Buffer) =>
  bearer(token, 'PUT', `/api/mobile/sync/attachment?${new URLSearchParams(q)}`, bytes, { 'content-type': 'application/octet-stream', 'idempotency-key': q.clientId });

beforeAll(async () => {
  t = await testApp();
  const on = await t.api.patch('/api/admin/features', { features: { mobile: true } });
  expect(on.status, JSON.stringify(on.body)).toBe(200);
  await t.api.get('/api/auth/state');
});
afterAll(async () => { await t.close(); });

describe('which credential reaches which route', () => {
  it('the app-only routes refuse a browser session and a personal access token', async () => {
    const pat = await t.api.post('/api/me/tokens', { name: 'Invented script', scopes: ['*'], expiresInDays: 1 });
    expect(pat.status, JSON.stringify(pat.body)).toBe(201);
    const script = pat.body.token as string;
    for (const [method, url, body] of [
      ['POST', '/api/mobile/sync', { items: [ticketItem('Invented from a script')] }],
      ['GET', '/api/mobile/package', undefined],
      ['GET', '/api/me/push', undefined],
      ['PUT', '/api/me/push', { provider: 'fcm', token: 'x'.repeat(150) }],
    ] as const) {
      const res = await bearer(script, method, url, body);
      expect(res.status, `${method} ${url}`).toBe(403);
      expect(['mobile_app_only', 'mobile_only']).toContain(res.body.error.code);
    }
    const file = await bearer(script, 'PUT', `/api/mobile/sync/attachment?clientId=${randomUUID()}&name=a.jpg`, JPEG, { 'content-type': 'application/octet-stream' });
    expect(file.body.error.code).toBe('mobile_app_only');
    // A browser session is not the app either.
    expect((await t.api.post('/api/mobile/sync', { items: [ticketItem('Invented from the web')] })).body.error.code).toBe('mobile_app_only');
    expect((await t.api.get('/api/me/push')).body.error.code).toBe('mobile_only');
    expect((await t.db.query('select 1 from tickets where title like $1', ['Invented from %'])).length).toBe(0);
  });

  it('the sign-in page\'s API takes only a browser session: neither the app\'s token nor a personal access token can make a code', async () => {
    const { token } = await signIn();
    const pat = (await t.api.post('/api/me/tokens', { name: 'Invented script 2', scopes: ['*'], expiresInDays: 1 })).body.token as string;
    const params = { ...authorizeRequest(randomUUID(), pkce().challenge), approve: true };
    for (const credential of [token, pat]) {
      const res = await bearer(credential, 'POST', '/api/mobile/oauth/decision', params);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('token_not_allowed');
    }
  });

  it('the app\'s token cannot make credentials, change account security or use the AI assistant endpoint', async () => {
    const { token } = await signIn();
    expect((await bearer(token, 'POST', '/api/me/tokens', { name: 'From the phone', scopes: ['*'], expiresInDays: 1 })).status).toBe(403);
    expect((await bearer(token, 'POST', '/api/me/calendar-feeds', { name: 'From the phone', sources: [], detail: 'busy' })).status).toBeGreaterThanOrEqual(400);
    expect((await bearer(token, 'POST', '/api/auth/password', { current: 'x', password: 'y' })).status).toBe(403);
    const mcp = await t.app.inject({
      method: 'POST', url: '/mcp', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(mcp.statusCode).toBeGreaterThanOrEqual(400);
    // A made-up token of the app's form is refused like any wrong token.
    expect((await bearer(`grc_mat_${randomBytes(32).toString('base64url')}`, 'GET', '/api/mobile/settings')).status).toBe(401);
  });

  it('a revoked device\'s token stops at once on every route, including push registration', async () => {
    const { token, deviceId } = await signIn();
    expect((await bearer(token, 'GET', '/api/mobile/settings')).status).toBe(200);
    expect((await t.api.del(`/api/me/devices/${deviceId}`)).status).toBeLessThan(300);
    for (const url of ['/api/mobile/settings', '/api/mobile/package', '/api/me/push', '/api/mobile/home']) {
      expect((await bearer(token, 'GET', url)).status, url).toBe(401);
    }
  });
});

describe('the outbox between people', () => {
  it('never answers one person\'s item from another person\'s idempotency record', async () => {
    const alice = await signIn();
    const other = await t.as('agent');
    const bob = await signIn(other);
    const item = ticketItem('Invented report of the first person');
    const first = (await bearer(alice.token, 'POST', '/api/mobile/sync', { items: [item] })).body.items[0] as SyncAnswer;
    expect(first.status).toBe('done');
    // The same id from someone else is that person's own new work: done for them, never a replay of the first answer.
    const second = (await bearer(bob.token, 'POST', '/api/mobile/sync', { items: [{ ...item, payload: { ...item.payload, body: { ...item.payload.body, title: 'Invented report of the second person' } } }] })).body.items[0] as SyncAnswer;
    expect(second.replayed).toBeUndefined();
    expect(second.status).toBe('done');
    expect(second.result?.id).not.toBe(first.result?.id);
    // And the first person's photo id cannot pull the first person's record into the second person's item.
    const pic = { clientId: randomUUID(), parent: item.clientId, name: 'photo.jpg' };
    const mine = await photo(alice.token, pic, JPEG);
    expect(mine.body.status).toBe('done');
    const theirs = await photo(bob.token, pic, JPEG);
    expect(theirs.body.replayed).toBeUndefined();
    // It is attached to the second person's own report (their item of that id), never to the first person's.
    expect(theirs.body).toMatchObject({ status: 'done', result: { id: second.result?.id } });
    expect(theirs.body.result.attachmentId).not.toBe(mine.body.result.attachmentId);
  });
});

describe('photo size', () => {
  it('refuses a photo larger than the organization\'s attachment limit before reading it into memory', async () => {
    const { token } = await signIn();
    const set = await t.api.patch('/api/attachments/settings', { maxMb: 1 });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    try {
      const report = ticketItem('Invented report with a large photo');
      expect((await bearer(token, 'POST', '/api/mobile/sync', { items: [report] })).body.items[0].status).toBe('done');
      const big = Buffer.concat([JPEG, Buffer.alloc(1024 * 1024 + 10)]);
      const res = await photo(token, { clientId: randomUUID(), parent: report.clientId, name: 'large.jpg' }, big);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'rejected', error: { code: 'too_large' } });
      expect(res.body.error.message).toContain('1 MB');
      // A photo within the limit still goes.
      expect((await photo(token, { clientId: randomUUID(), parent: report.clientId, name: 'small.jpg' }, JPEG)).body.status).toBe('done');
    } finally {
      await t.api.patch('/api/attachments/settings', { maxMb: 25 });
    }
  });
});
