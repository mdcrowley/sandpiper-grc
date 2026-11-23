import { createHash, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';
import { matchRedirect, parseScope, pkceMatches, redirectProblem, secureBase } from './oauth.ts';

// OAuth 2.1 for remote connectors (E21-16): the SDK's own client runs the whole MCP authorization
// flow against the real server on port 0 (discovery, dynamic registration, PKCE, consent, tokens,
// refresh), then every failure path is tried by hand.

const stand: ModuleDef = {
  key: 'oauthstand',
  async seedDefaults(ctx) {
    await ctx.db.exec(`create table if not exists oauth_test_notes (
      id uuid primary key default gen_random_uuid(), title text not null,
      created_at timestamptz not null default now(), created_by uuid,
      updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'oauthnote', table: 'oauth_test_notes', module: 'tickets', label: 'Note', plural: 'Notes',
      path: '/api/oauth-notes', route: '/oauth-notes', titleField: 'title', searchable: ['title'],
      fields: { title: { label: 'Title', type: 'text', required: true } },
    });
  },
};

let t: Awaited<ReturnType<typeof testApp>>;
let base = '';
const REDIRECT = 'http://127.0.0.1:33418/callback';
const settings = (body: unknown) => t.api.put('/api/mcp/admin/settings', body);
const form = (body: Record<string, string>, headers: Record<string, string> = {}) =>
  fetch(`${base}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(body).toString() });
const verifierPair = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};
async function register(meta: Record<string, unknown> = {}, keepLimit = false) {
  if (!keepLimit) await t.db.query("delete from rate_limit_hits where bucket = 'mcp_oauth_register'");
  const res = await fetch(`${base}/oauth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Depot desk assistant', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], ...meta }),
  });
  return { status: res.status, body: (await res.json()) as any };
}
/** Approves an authorization request as the signed-in administrator; answers the code. */
async function consent(params: Record<string, string>, access: 'read' | 'write' = 'read', api = t.api) {
  const check = await api.post('/api/mcp/oauth/authorize', params);
  expect(check.status, JSON.stringify(check.body)).toBe(200);
  const res = await api.post('/api/mcp/oauth/decision', { ...params, approve: true, access, expiresInDays: 30 });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return new URL(res.body.redirect);
}
async function codeFor(clientId: string, extra: Record<string, string> = {}) {
  const { verifier, challenge } = verifierPair();
  const back = await consent({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'st-1', resource: `${base}/mcp`, ...extra });
  return { code: back.searchParams.get('code')!, verifier, back };
}
async function tokensFor(clientId: string) {
  const { code, verifier } = await codeFor(clientId);
  const res = await form({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT, client_id: clientId, resource: `${base}/mcp` });
  expect(res.status).toBe(200);
  return (await res.json()) as any;
}
const mcpInit = (token: string) => fetch(`${base}/mcp`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '1' } } }),
});

beforeAll(async () => {
  t = await testApp({ extraModules: [stand] });
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`;
  // The address people and connectors use (the test client's own Host header differs).
  await t.ctx.settings.set('auth.public_url', base);
  await t.api.post('/api/oauth-notes', { title: 'Platform display outage at the river terminal' });
});
afterAll(async () => { await t.close(); });

describe('pieces', () => {
  it('checks redirect addresses, scopes, PKCE and secure addresses', () => {
    expect(redirectProblem('https://connector.example.org/cb')).toBeNull();
    expect(redirectProblem('http://localhost:9999/cb')).toBeNull();
    expect(redirectProblem('com.example.app:/oauth')).toBeNull();
    for (const bad of ['http://connector.example.org/cb', 'javascript:alert(1)', 'data:text/html,x', 'https://x.example/cb#frag', 'https://u:p@x.example/cb', 'not a url', 'file:///etc/passwd']) {
      expect(redirectProblem(bad), bad).not.toBeNull();
    }
    expect(matchRedirect(['http://127.0.0.1/callback'], 'http://127.0.0.1:5555/callback')).toBe('http://127.0.0.1:5555/callback');
    expect(matchRedirect(['https://a.example/cb'], 'https://a.example/cb2')).toBeNull();
    expect(matchRedirect(['http://127.0.0.1/callback'], 'http://127.0.0.1:5555/other')).toBeNull();
    expect(parseScope('')).toEqual(['mcp:read']);
    expect(parseScope('mcp:read mcp:write')).toEqual(['mcp:read', 'mcp:write']);
    expect(parseScope('mcp:read admin')).toBeNull();
    const { verifier, challenge } = verifierPair();
    expect(pkceMatches(verifier, challenge)).toBe(true);
    expect(pkceMatches(`${verifier}x`, challenge)).toBe(false);
    expect(pkceMatches('short', challenge)).toBe(false);
    expect(secureBase('https://grc.example.org')).toBe(true);
    expect(secureBase('http://127.0.0.1:8080')).toBe(true);
    expect(secureBase('http://grc.example.org')).toBe(false);
  });
});

describe('off by default', () => {
  it('publishes no metadata and answers no OAuth endpoint until switched on', async () => {
    for (const p of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource', '/.well-known/oauth-authorization-server']) {
      expect((await fetch(`${base}${p}`)).status, p).toBe(404);
    }
    expect((await form({ grant_type: 'refresh_token', refresh_token: 'x', client_id: 'y' })).status).toBe(404);
    expect((await register()).status).toBe(404);
    await settings({ enabled: true });
    expect((await fetch(`${base}/.well-known/oauth-authorization-server`)).status).toBe(404);
    // With OAuth off the 401 from /mcp points nowhere.
    const res = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).not.toMatch(/resource_metadata/);
    const refused = await t.api.post('/api/mcp/oauth/authorize', { response_type: 'code', client_id: 'grc_cli_x' });
    expect([refused.status, refused.body.error.code]).toEqual([409, 'oauth_disabled']);
  });
});

describe('the whole flow with the SDK client', () => {
  it('discovers, registers itself, signs in with PKCE, calls tools, and refreshes', async () => {
    await settings({ oauthEnabled: true, oauthRegistration: true });
    // Metadata
    const prm = (await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json()) as any;
    expect(prm).toMatchObject({ resource: `${base}/mcp`, authorization_servers: [base], bearer_methods_supported: ['header'], scopes_supported: ['mcp:read', 'mcp:write'] });
    const asm = (await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json()) as any;
    expect(asm).toMatchObject({
      issuer: base, authorization_endpoint: `${base}/oauth/authorize`, token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`, revocation_endpoint: `${base}/oauth/revoke`,
      code_challenge_methods_supported: ['S256'], grant_types_supported: ['authorization_code', 'refresh_token'], response_types_supported: ['code'],
    });
    const challenge = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(challenge.headers.get('www-authenticate')).toContain(`resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`);

    // The SDK's client, with a provider that "opens the browser" by approving through the consent API.
    let stored: any;
    let tokens: any;
    let verifier = '';
    let authUrl: URL | null = null;
    const provider: OAuthClientProvider = {
      get redirectUrl() { return REDIRECT; },
      get clientMetadata() { return { client_name: 'Night shift assistant', redirect_uris: [REDIRECT], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }; },
      state: () => 'sdk-state',
      clientInformation: () => stored,
      saveClientInformation: (c) => { stored = c; },
      tokens: () => tokens,
      saveTokens: (x) => { tokens = x; },
      redirectToAuthorization: (u) => { authUrl = u; },
      saveCodeVerifier: (v) => { verifier = v; },
      codeVerifier: () => verifier,
    };
    const first = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { authProvider: provider });
    await expect(new Client({ name: 'oauth-test', version: '1' }).connect(first)).rejects.toThrow(/Unauthorized/i);
    expect(stored.client_id).toMatch(/^grc_cli_/);
    expect(authUrl).not.toBeNull();
    const url = authUrl! as URL;
    expect(url.origin + url.pathname).toBe(`${base}/oauth/authorize`);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('resource')).toBe(`${base}/mcp`);
    const params = Object.fromEntries(url.searchParams.entries());
    const check = (await t.api.post('/api/mcp/oauth/authorize', params)).body;
    expect(check).toMatchObject({ ok: true, client: { name: 'Night shift assistant', redirectHost: '127.0.0.1:33418', registeredBy: 'dynamic' }, requestedWrite: true, mayConnect: true });
    const back = await consent(params, 'read');
    expect(back.searchParams.get('state')).toBe('sdk-state');
    expect(back.searchParams.get('iss')).toBe(base);
    await first.finishAuth(back.searchParams.get('code')!);
    expect(tokens.access_token).toMatch(/^grc_oat_/);
    expect(tokens.refresh_token).toMatch(/^grc_ort_/);
    expect(tokens.scope).toBe('mcp:read'); // the person chose read only although write was asked for
    expect(tokens.expires_in).toBeLessThanOrEqual(3600);

    const client = new Client({ name: 'oauth-test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { authProvider: provider }));
    const names = (await client.listTools()).tools.map((x) => x.name);
    expect(names).toContain('search');
    expect(names).not.toContain('create_record');
    const found = await client.callTool({ name: 'search', arguments: { query: 'river terminal' } });
    expect(JSON.stringify(found.structuredContent)).toMatch(/Platform display outage/);
    const status = (await t.api.get('/api/mcp/status')).body;
    expect(status.connections).toEqual([expect.objectContaining({ client_name: 'Night shift assistant', scope: 'mcp:read' })]);
    // Calls are logged under the connection, and audited with its name.
    const log = (await t.api.get('/api/mcp/admin')).body;
    expect(log.usage.find((u: any) => u.token_name === 'Night shift assistant (connector)')).toMatchObject({ active: true });
    expect(log.oauth.clients.find((c: any) => c.name === 'Night shift assistant')).toMatchObject({ connections: 1, registered_by: 'dynamic' });

    // Refresh rotates; the old refresh token used again revokes the whole connection.
    const oldRefresh = tokens.refresh_token;
    const refreshed = await form({ grant_type: 'refresh_token', refresh_token: oldRefresh, client_id: stored.client_id });
    expect(refreshed.status).toBe(200);
    expect(refreshed.headers.get('cache-control')).toBe('no-store');
    const next = (await refreshed.json()) as any;
    expect(next.refresh_token).not.toBe(oldRefresh);
    expect((await mcpInit(next.access_token)).status).toBe(200);
    const reuse = await form({ grant_type: 'refresh_token', refresh_token: oldRefresh, client_id: stored.client_id });
    expect([reuse.status, ((await reuse.json()) as any).error]).toEqual([400, 'invalid_grant']);
    expect((await mcpInit(next.access_token)).status).toBe(401);
    expect((await form({ grant_type: 'refresh_token', refresh_token: next.refresh_token, client_id: stored.client_id })).status).toBe(400);
    const ev = await t.db.one<any>(`select summary from audit_events where action = 'mcp.oauth.refresh_reuse' order by id desc limit 1`);
    expect(ev.summary).toMatch(/revoked/);
    expect((await t.api.get('/api/mcp/status')).body.connections).toEqual([]);
  }, 30_000);
});

describe('failure paths', () => {
  let clientId = '';
  beforeAll(async () => {
    await settings({ enabled: true, oauthEnabled: true, oauthRegistration: true });
    const made = await register();
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    clientId = made.body.client_id;
    expect(made.body.client_secret).toBeUndefined();
  });

  it('refuses bad registrations, and registration when it is not allowed', async () => {
    for (const [meta, error] of [
      [{ redirect_uris: ['javascript:alert(1)'] }, 'invalid_redirect_uri'],
      [{ redirect_uris: ['http://connector.example.org/cb'] }, 'invalid_redirect_uri'],
      [{ redirect_uris: [] }, 'invalid_redirect_uri'],
      [{ token_endpoint_auth_method: 'private_key_jwt' }, 'invalid_client_metadata'],
      [{ grant_types: ['client_credentials'] }, 'invalid_client_metadata'],
      [{ response_types: ['token'] }, 'invalid_client_metadata'],
      [{ scope: 'admin' }, 'invalid_client_metadata'],
    ] as const) {
      const r = await register(meta as Record<string, unknown>);
      expect([JSON.stringify(meta), r.status, r.body.error]).toEqual([JSON.stringify(meta), 400, error]);
    }
    // Registrations are limited by address.
    const statuses = [];
    await t.db.query("delete from rate_limit_hits where bucket = 'mcp_oauth_register'");
    for (let i = 0; i < 11; i++) statuses.push((await register({}, true)).status);
    expect(statuses.slice(-2)).toEqual([201, 429]);
    // A confidential client gets a secret, once.
    const conf = await register({ token_endpoint_auth_method: 'client_secret_basic' });
    expect(conf.body.client_secret).toMatch(/^grc_cls_/);
    await settings({ oauthRegistration: false });
    expect((await register()).status).toBe(403);
    const asm = (await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json()) as any;
    expect(asm.registration_endpoint).toBeUndefined();
    await settings({ oauthRegistration: true });
  });

  it('never redirects to an unregistered address, and reports other request errors to the connector', async () => {
    const { challenge } = verifierPair();
    const good = { response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'abc' };
    const unknown = await t.api.post('/api/mcp/oauth/authorize', { ...good, client_id: 'grc_cli_unknown' });
    expect([unknown.status, unknown.body.error.code]).toEqual([400, 'invalid_client']);
    const elsewhere = await t.api.post('/api/mcp/oauth/authorize', { ...good, redirect_uri: 'https://attacker.example/cb' });
    expect([elsewhere.status, elsewhere.body.error.code]).toEqual([400, 'invalid_redirect_uri']);
    expect(JSON.stringify(elsewhere.body)).not.toMatch(/attacker/);
    const elsewhereDecision = await t.api.post('/api/mcp/oauth/decision', { ...good, redirect_uri: 'https://attacker.example/cb', approve: true });
    expect(elsewhereDecision.status).toBe(400);
    for (const [change, error] of [
      [{ response_type: 'token' }, 'unsupported_response_type'],
      [{ code_challenge_method: 'plain' }, 'invalid_request'],
      [{ code_challenge: undefined }, 'invalid_request'],
      [{ code_challenge: 'too-short' }, 'invalid_request'],
      [{ scope: 'mcp:read admin' }, 'invalid_scope'],
      [{ resource: 'https://other.example/mcp' }, 'invalid_target'],
    ] as const) {
      const r = (await t.api.post('/api/mcp/oauth/authorize', { ...good, ...change })).body;
      expect(r.ok).toBe(false);
      const u = new URL(r.redirect);
      expect([u.origin + u.pathname, u.searchParams.get('error'), u.searchParams.get('state'), u.searchParams.get('iss')]).toEqual([REDIRECT, error, 'abc', base]);
    }
    // Declining sends access_denied back.
    const no = await t.api.post('/api/mcp/oauth/decision', { ...good, approve: false });
    expect(new URL(no.body.redirect).searchParams.get('error')).toBe('access_denied');
  });

  it('is for signed-in people only, with a recent password confirmation to approve', async () => {
    const { challenge } = verifierPair();
    const good = { response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256' };
    expect((await t.anon.post('/api/mcp/oauth/authorize', good)).status).toBe(401);
    const pat = (await t.api.post('/api/me/tokens', { name: 'Script', scopes: ['*'], expiresInDays: 1 })).body.token;
    const withToken = await t.app.inject({ method: 'POST', url: '/api/mcp/oauth/decision', headers: { authorization: `Bearer ${pat}` }, payload: { ...good, approve: true } });
    expect(withToken.statusCode).toBe(403);
    await t.db.query(`update sessions set confirmed_at = now() - interval '1 hour'`);
    const stale = await t.api.post('/api/mcp/oauth/decision', { ...good, approve: true, access: 'read', expiresInDays: 7 });
    expect(stale.body.error.code).toBe('reauth_required');
    await t.db.query('update sessions set confirmed_at = now()');
  });

  it('refuses every wrong token request', async () => {
    const { code, verifier } = await codeFor(clientId);
    const ok = { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT, client_id: clientId };
    const err = async (body: Record<string, string>, headers?: Record<string, string>) => {
      const r = await form(body, headers);
      return [r.status, ((await r.json()) as any).error];
    };
    expect(await err({ ...ok, grant_type: 'password' })).toEqual([400, 'unsupported_grant_type']);
    expect(await err({ ...ok, client_id: 'grc_cli_nobody' })).toEqual([401, 'invalid_client']);
    expect(await err({ ...ok, client_secret: 'guess' })).toEqual([401, 'invalid_client']);
    expect(await err({ ...ok, resource: 'https://other.example/mcp' })).toEqual([400, 'invalid_target']);
    // A wrong verifier or redirect burns the code: it is single use whatever happens.
    expect(await err({ ...ok, code_verifier: randomBytes(32).toString('base64url') })).toEqual([400, 'invalid_grant']);
    expect(await err(ok)).toEqual([400, 'invalid_grant']);

    const second = await codeFor(clientId);
    expect(await err({ ...ok, code: second.code, code_verifier: second.verifier, redirect_uri: 'http://127.0.0.1:33418/other' })).toEqual([400, 'invalid_grant']);

    // A code from another client is refused.
    const other = await register();
    const third = await codeFor(clientId);
    expect(await err({ ...ok, code: third.code, code_verifier: third.verifier, client_id: other.body.client_id })).toEqual([400, 'invalid_grant']);

    // An expired code.
    const fourth = await codeFor(clientId);
    await t.db.query(`update mcp_oauth_codes set expires_at = now() - interval '1 second' where used_at is null`);
    expect(await err({ ...ok, code: fourth.code, code_verifier: fourth.verifier })).toEqual([400, 'invalid_grant']);

    // A code exchanged twice revokes the connection made the first time.
    const fifth = await codeFor(clientId);
    const good = await form({ ...ok, code: fifth.code, code_verifier: fifth.verifier });
    const tok = (await good.json()) as any;
    expect((await mcpInit(tok.access_token)).status).toBe(200);
    expect(await err({ ...ok, code: fifth.code, code_verifier: fifth.verifier })).toEqual([400, 'invalid_grant']);
    expect((await mcpInit(tok.access_token)).status).toBe(401);
  });

  it('authenticates confidential clients by secret (basic or post)', async () => {
    const conf = await register({ token_endpoint_auth_method: 'client_secret_basic' });
    const id = conf.body.client_id;
    const secret = conf.body.client_secret;
    const basic = (s: string) => ({ authorization: `Basic ${Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(s)}`).toString('base64')}` });
    const a = await codeFor(id);
    const wrong = await form({ grant_type: 'authorization_code', code: a.code, code_verifier: a.verifier, redirect_uri: REDIRECT }, basic('nope'));
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get('www-authenticate')).toMatch(/Basic/);
    const b = await codeFor(id);
    expect((await form({ grant_type: 'authorization_code', code: b.code, code_verifier: b.verifier, redirect_uri: REDIRECT }, basic(secret))).status).toBe(200);
    const c = await codeFor(id);
    expect((await form({ grant_type: 'authorization_code', code: c.code, code_verifier: c.verifier, redirect_uri: REDIRECT, client_id: id })).status).toBe(401);
    const d = await codeFor(id);
    expect((await form({ grant_type: 'authorization_code', code: d.code, code_verifier: d.verifier, redirect_uri: REDIRECT, client_id: id, client_secret: secret })).status).toBe(200);
  });

  it('keeps access tokens to /mcp, and stops them when revoked, switched off or the person leaves', async () => {
    const tok = await tokensFor(clientId);
    // Not accepted on the REST API, even with a guessed marker header.
    for (const headers of [{}, { 'x-grc-mcp-internal': 'guess' }]) {
      const rest = await t.app.inject({ method: 'GET', url: '/api/oauth-notes', headers: { authorization: `Bearer ${tok.access_token}`, ...headers } });
      expect([rest.statusCode, rest.json().error.code]).toEqual([401, 'invalid_token']);
    }
    expect((await mcpInit(tok.access_token)).status).toBe(200);
    // The refresh token is not an access token.
    expect((await mcpInit(tok.refresh_token)).status).toBe(401);
    // Expired access token.
    const second = await tokensFor(clientId);
    await t.db.query(`update mcp_oauth_tokens set expires_at = now() - interval '1 second' where kind = 'access' and grant_id = (select grant_id from mcp_oauth_tokens where token_hash = $1)`, [createHash('sha256').update(second.access_token).digest('hex')]);
    expect((await mcpInit(second.access_token)).status).toBe(401);
    // Revocation by the connector (RFC 7009): unknown tokens answer 200 too.
    expect((await fetch(`${base}/oauth/revoke`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: 'grc_ort_unknown', client_id: clientId }) })).status).toBe(200);
    const revoked = await fetch(`${base}/oauth/revoke`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: tok.refresh_token, client_id: clientId, token_type_hint: 'refresh_token' }) });
    expect(revoked.status).toBe(200);
    expect((await mcpInit(tok.access_token)).status).toBe(401);
    // Switching OAuth off stops every connection at once.
    const third = await tokensFor(clientId);
    await settings({ oauthEnabled: false });
    expect((await mcpInit(third.access_token)).status).toBe(401);
    await settings({ oauthEnabled: true });
    expect((await mcpInit(third.access_token)).status).toBe(200);
    // The person disconnects it on their page.
    const mine = (await t.api.get('/api/mcp/status')).body.connections;
    for (const c of mine) expect((await t.api.del(`/api/mcp/oauth/grants/${c.id}`)).status).toBe(200);
    expect((await mcpInit(third.access_token)).status).toBe(401);
    // An administrator removes the connector: its connections end.
    const fourth = await tokensFor(clientId);
    const row = (await t.api.get('/api/mcp/admin')).body.oauth.clients.find((c: any) => c.client_id === clientId);
    expect((await t.api.del(`/api/mcp/admin/oauth/clients/${row.id}`)).body).toMatchObject({ ok: true, connectionsEnded: 1 });
    expect((await mcpInit(fourth.access_token)).status).toBe(401);
    expect((await t.api.post('/api/mcp/oauth/authorize', { response_type: 'code', client_id: clientId })).status).toBe(400);
  });

  it('lets an administrator add a connector by hand, and keeps secrets out of the database and logs', async () => {
    const made = await t.api.post('/api/mcp/admin/oauth/clients', { name: 'Fleet desk connector', redirectUris: ['https://connector.example.org/callback'], confidential: true });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.clientSecret).toMatch(/^grc_cls_/);
    const bad = await t.api.post('/api/mcp/admin/oauth/clients', { name: 'x', redirectUris: ['javascript:alert(1)'] });
    expect(bad.body.error.fields.redirectUris).toBeTruthy();
    const dump = JSON.stringify(await t.db.query('select * from mcp_oauth_clients')) + JSON.stringify(await t.db.query('select * from mcp_oauth_tokens'))
      + JSON.stringify(await t.db.query('select * from mcp_oauth_codes')) + JSON.stringify(await t.db.query('select summary, before, after from audit_events'));
    expect(dump).not.toContain(made.body.clientSecret);
    expect(dump).not.toMatch(/grc_oat_|grc_ort_|grc_cls_/);
  });

  it('applies who may connect to the consent screen', async () => {
    await settings({ allowedRoles: ['security_lead'] });
    const fresh = await register();
    const { challenge } = verifierPair();
    const params = { response_type: 'code', client_id: fresh.body.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256' };
    expect((await t.api.post('/api/mcp/oauth/authorize', params)).body.mayConnect).toBe(false);
    const refused = await t.api.post('/api/mcp/oauth/decision', { ...params, approve: true, access: 'read', expiresInDays: 7 });
    expect([refused.status, refused.body.error.code]).toEqual([403, 'mcp_not_allowed']);
    await settings({ allowedRoles: null });
  });

  it('limits failed token requests by address', async () => {
    await t.db.query(`delete from rate_limit_hits where bucket = 'mcp_oauth'`);
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await form({ grant_type: 'refresh_token', refresh_token: `grc_ort_wrong${i}`, client_id: clientId })).status;
    expect(last).toBe(429);
    await t.db.query(`delete from rate_limit_hits where bucket = 'mcp_oauth'`);
  });
});

describe('the issuer address (W17-7)', () => {
  it('never takes the issuer from a Host header that is not this machine', async () => {
    await settings({ oauthEnabled: true });
    const meta = (host: string) => t.app.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server', headers: { host } });
    const kept = await t.ctx.settings.get<string>('auth.public_url', '');
    await t.ctx.settings.set('auth.public_url', '');
    try {
      expect((await meta('evil.example')).statusCode).toBe(404);
      const local = await meta('localhost:8080');
      expect(local.statusCode).toBe(200);
      expect(local.json().issuer).toBe('http://localhost:8080');
      await t.ctx.settings.set('auth.public_url', 'https://grc.example.org');
      expect((await meta('evil.example')).json().issuer).toBe('https://grc.example.org');
    } finally {
      await t.ctx.settings.set('auth.public_url', kept);
    }
  });
});
