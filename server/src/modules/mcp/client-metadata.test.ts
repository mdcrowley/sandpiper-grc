import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeSelfSigned } from '../../core/tls-selfsigned.ts';
import { testApp } from '../../test/helpers.ts';
import {
  CACHE_MAX_SECONDS, CACHE_MIN_SECONDS, cacheSeconds, clientIdUrlProblem, fetchClientMetadata, MAX_DOCUMENT_BYTES, MetadataError,
  setClientMetadataTestHooks, validateClientMetadata,
} from './client-metadata.ts';
import { parseScope, redirectProblem } from './oauth.ts';

// Client ID metadata documents (E21-21). A local HTTPS server with a certificate made at test time
// plays the connector's web site; every refusal path is tried (private address, redirects, size,
// time, mismatched client_id, unknown redirect address, forbidden fields), then the whole sign-in.

let t: Awaited<ReturnType<typeof testApp>>;
let base = '';
let site: Server;
let sitePort = 0;
let siteBase = '';
const hits: Record<string, number> = {};
let siteHooks: Parameters<typeof setClientMetadataTestHooks>[0] = null;
const REDIRECT = 'http://127.0.0.1:33418/callback';
/** Documents the fake site serves, by path; a function may answer by hand. */
const docs: Record<string, unknown> = {};
const settings = (body: unknown) => t.api.put('/api/mcp/admin/settings', body);
const doc = (path: string, extra: Record<string, unknown> = {}) => ({
  client_id: `${siteBase}${path}`, client_name: 'Yard planning assistant', redirect_uris: [REDIRECT],
  grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', ...extra,
});
const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};
const authorizeParams = (clientId: string, challenge = pkce().challenge, extra: Record<string, string> = {}) => ({
  response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256',
  state: 'st', resource: `${base}/mcp`, ...extra,
});
const authorize = (clientId: string, extra: Record<string, string> = {}) => t.api.post('/api/mcp/oauth/authorize', authorizeParams(clientId, undefined, extra));
const form = (body: Record<string, string>) =>
  fetch(`${base}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
const rows = (clientId: string) => t.db.query<any>('select * from mcp_oauth_clients where client_id = $1', [clientId]);

beforeAll(async () => {
  const { cert, key } = makeSelfSigned(['127.0.0.1', 'localhost', 'connectors.example.test', 'sneaky.example.test', 'mixed.example.test']);
  site = createServer({ cert, key }, (req, res) => {
    const path = String(req.url);
    hits[path] = (hits[path] ?? 0) + 1;
    const answer = docs[path];
    if (typeof answer === 'function') { (answer as (r: typeof res) => void)(res); return; }
    if (answer === undefined) { res.writeHead(404, { 'content-type': 'application/json' }).end('{}'); return; }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'max-age=600' }).end(JSON.stringify(answer));
  });
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', () => r()));
  sitePort = (site.address() as AddressInfo).port;
  siteBase = `https://127.0.0.1:${sitePort}`;
  // Trust the test certificate; answer the test names without DNS.
  siteHooks = {
    ca: cert,
    resolve: (host, cb) => {
      const table: Record<string, string[]> = {
        'connectors.example.test': ['127.0.0.1'], 'sneaky.example.test': ['10.20.30.40'], 'mixed.example.test': ['11.22.33.44', '127.0.0.1'],
      };
      const list = table[host];
      if (!list) { cb(Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' }), []); return; }
      cb(null, list.map((address) => ({ address, family: 4 })));
    },
  };
  setClientMetadataTestHooks(siteHooks);

  t = await testApp();
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`;
  await t.ctx.settings.set('auth.public_url', base);
  await settings({ enabled: true, oauthEnabled: true });
});
afterAll(async () => {
  setClientMetadataTestHooks(null);
  await t.close();
  await new Promise((r) => site.close(r));
});
beforeEach(async () => {
  await t.db.query("delete from rate_limit_hits where bucket = 'mcp_oauth_metadata'");
});

describe('pieces', () => {
  it('accepts only https addresses with a path as client ids', () => {
    expect(clientIdUrlProblem('https://assistant.example.org/client.json')).toBeNull();
    expect(clientIdUrlProblem('https://assistant.example.org/oauth/client?v=2')).toBeNull();
    for (const bad of [
      'http://assistant.example.org/client.json', 'https://assistant.example.org/', 'https://assistant.example.org',
      'https://assistant.example.org/client.json#x', 'https://u:p@assistant.example.org/client.json', 'https://Assistant.Example.org/client.json',
      'https://assistant.example.org:443/client.json', 'https://assistant.example.org/a/../client.json', 'https://assistant.example.org/./client.json',
      `https://assistant.example.org/${'x'.repeat(400)}`, 'https://',
    ]) expect(clientIdUrlProblem(bad), bad).not.toBeNull();
  });

  it('keeps a document as long as its Cache-Control says, within bounds', () => {
    expect(cacheSeconds(undefined)).toBe(3600);
    expect(cacheSeconds('public, max-age=600')).toBe(600);
    expect(cacheSeconds('s-maxage=7200')).toBe(7200);
    expect(cacheSeconds('max-age=5')).toBe(CACHE_MIN_SECONDS);
    expect(cacheSeconds('max-age=99999999')).toBe(CACHE_MAX_SECONDS);
    expect(cacheSeconds('no-store')).toBe(CACHE_MIN_SECONDS);
  });

  it('checks the document: exact client_id, redirect addresses, known fields, no secrets', () => {
    const url = 'https://assistant.example.org/client.json';
    const check = (d: Record<string, unknown>) => validateClientMetadata(Buffer.from(JSON.stringify(d)), url, redirectProblem, parseScope);
    const good = { client_id: url, client_name: 'Shift report helper', redirect_uris: ['https://assistant.example.org/cb'], 'client_name#es': 'Ayudante' };
    expect(check(good)).toEqual({ name: 'Shift report helper', redirectUris: ['https://assistant.example.org/cb'], clientUri: null, scope: null });
    const reason = (d: Record<string, unknown>) => { try { check(d); return 'accepted'; } catch (e) { return (e as MetadataError).reason; } };
    expect(reason({ ...good, client_id: `${url}?x` })).toBe('client_id_mismatch');
    expect(reason({ ...good, client_id: undefined })).toBe('client_id_mismatch');
    expect(reason({ ...good, client_secret: 'shh' })).toBe('forbidden_field');
    expect(reason({ ...good, client_secret_expires_at: 0 })).toBe('forbidden_field');
    expect(reason({ ...good, token_endpoint_auth_method: 'client_secret_basic' })).toBe('auth_method');
    expect(reason({ ...good, token_endpoint_auth_method: 'private_key_jwt' })).toBe('auth_method');
    expect(reason({ ...good, jwks: { keys: [{ kty: 'EC', crv: 'P-256', x: 'a', y: 'b', d: 'private' }] } })).toBe('forbidden_field');
    expect(reason({ ...good, jwks: { keys: [{ kty: 'EC', crv: 'P-256', x: 'a', y: 'b' }] } })).toBe('accepted');
    expect(reason({ ...good, admin: true })).toBe('unknown_field');
    expect(reason({ ...good, client_name: '' })).toBe('missing_field');
    expect(reason({ ...good, redirect_uris: [] })).toBe('redirect_uris');
    expect(reason({ ...good, redirect_uris: ['javascript:alert(1)'] })).toBe('redirect_uris');
    expect(reason({ ...good, redirect_uris: ['http://assistant.example.org/cb'] })).toBe('redirect_uris');
    expect(reason({ ...good, grant_types: ['client_credentials'] })).toBe('grant_types');
    expect(reason({ ...good, response_types: ['token'] })).toBe('response_types');
    expect(reason({ ...good, scope: 'admin' })).toBe('scope');
    expect(reason({ ...good, client_uri: 'http://assistant.example.org' })).toBe('client_uri');
    expect(() => validateClientMetadata(Buffer.from('not json'), url, redirectProblem, parseScope)).toThrow(/not valid JSON/);
    expect(() => validateClientMetadata(Buffer.from('[]'), url, redirectProblem, parseScope)).toThrow(/JSON object/);
  });
});

describe('fetching', () => {
  const reasonOf = async (url: string, list: string[], timeout?: number) => {
    try { await fetchClientMetadata(new URL(url), list, timeout); return 'fetched'; } catch (e) { return e instanceof MetadataError ? e.reason : String(e); }
  };

  it('refuses private addresses, literal or after name resolution, unless that exact address is listed', async () => {
    docs['/ok.json'] = doc('/ok.json');
    expect(await reasonOf(`${siteBase}/ok.json`, [])).toBe('port');
    expect(await reasonOf(`${siteBase}/ok.json`, [`127.0.0.2:${sitePort}`])).toBe('port');
    // The port is allowed by the list, but the address is still private unless listed exactly.
    expect(await reasonOf(`https://connectors.example.test:${sitePort}/ok.json`, [`connectors.example.test:${sitePort}`])).toBe('private_address');
    expect(await reasonOf(`https://sneaky.example.test:${sitePort}/ok.json`, [`sneaky.example.test:${sitePort}`])).toBe('private_address');
    // One public and one private address: refused too.
    expect(await reasonOf(`https://mixed.example.test:${sitePort}/ok.json`, [`mixed.example.test:${sitePort}`])).toBe('private_address');
    expect(await reasonOf('https://10.0.0.1/ok.json', [])).toBe('private_address');
    expect(await reasonOf('https://[::1]/ok.json', [])).toBe('private_address');
    expect(await reasonOf('https://169.254.169.254/latest/meta-data', [])).toBe('private_address');
    expect(await reasonOf('https://[::ffff:127.0.0.1]/ok.json', [])).toBe('private_address');
    expect(await reasonOf('https://nowhere.example.test/ok.json', [])).toBe('unreachable');
    // Listed exactly: reached.
    expect(await reasonOf(`${siteBase}/ok.json`, [`127.0.0.1:${sitePort}`])).toBe('fetched');
    expect(await reasonOf(`https://connectors.example.test:${sitePort}/ok.json`, [`connectors.example.test:${sitePort}`, `127.0.0.1:${sitePort}`])).toBe('fetched');
  });

  it('follows no redirect, reads at most 5 KB, wants JSON and 200, and gives up after the time limit', async () => {
    const list = [`127.0.0.1:${sitePort}`];
    docs['/to-private.json'] = (res: any) => res.writeHead(302, { location: 'https://10.0.0.1/admin' }).end();
    docs['/to-same.json'] = (res: any) => res.writeHead(301, { location: `${siteBase}/ok.json` }).end();
    docs['/big.json'] = (res: any) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ...doc('/big.json'), software_id: 'x'.repeat(MAX_DOCUMENT_BYTES) }));
    docs['/big-stream.json'] = (res: any) => {
      res.writeHead(200, { 'content-type': 'application/json', 'transfer-encoding': 'chunked' });
      for (let i = 0; i < 20; i++) res.write('x'.repeat(1024));
      res.end();
    };
    docs['/page.html'] = (res: any) => res.writeHead(200, { 'content-type': 'text/html' }).end('<html></html>');
    docs['/slow.json'] = () => { /* never answers */ };
    expect(await reasonOf(`${siteBase}/to-private.json`, list)).toBe('redirect');
    expect(await reasonOf(`${siteBase}/to-same.json`, list)).toBe('redirect');
    expect(await reasonOf(`${siteBase}/big.json`, list)).toBe('too_large');
    expect(await reasonOf(`${siteBase}/big-stream.json`, list)).toBe('too_large');
    expect(await reasonOf(`${siteBase}/page.html`, list)).toBe('content_type');
    expect(await reasonOf(`${siteBase}/missing.json`, list)).toBe('status');
    expect(await reasonOf(`${siteBase}/slow.json`, list, 300)).toBe('timeout');
  });

  it('refuses a certificate it does not trust', async () => {
    setClientMetadataTestHooks({ ca: makeSelfSigned(['127.0.0.1']).cert });
    try {
      expect(await reasonOf(`${siteBase}/ok.json`, [`127.0.0.1:${sitePort}`])).toBe('tls');
    } finally {
      setClientMetadataTestHooks(siteHooks);
    }
  });
});

describe('signing in with a client ID metadata document', () => {
  it('is off by default and needs outbound connections', async () => {
    docs['/assistant.json'] = doc('/assistant.json');
    const asm = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json() as any;
    expect(asm.client_id_metadata_document_supported).toBe(false);
    const off = await authorize(`${siteBase}/assistant.json`);
    expect([off.status, off.body.error.code]).toEqual([400, 'invalid_client']);
    expect(off.body.error.message).toMatch(/not switched on/);
    await settings({ clientMetadata: true });
    const noOutbound = await authorize(`${siteBase}/assistant.json`);
    expect([noOutbound.status, noOutbound.body.error.code]).toEqual([409, 'outbound_disabled']);
    expect((await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json() as any).client_id_metadata_document_supported).toBe(false);
    expect(hits['/assistant.json'] ?? 0).toBe(0);
    await t.ctx.settings.set('integrations.outbound_enabled', true);
    expect((await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json() as any).client_id_metadata_document_supported).toBe(true);
  });

  it('refuses the local test site until its exact address is listed (public addresses only)', async () => {
    const res = await authorize(`${siteBase}/assistant.json`);
    expect([res.status, res.body.error.code]).toEqual([400, 'invalid_client']);
    expect(hits['/assistant.json'] ?? 0).toBe(0); // refused before connecting: the port, then the address
    const notListed = await settings({ clientMetadataHosts: ['assistants.example.org'] });
    expect(notListed.status).toBe(200);
    const host = await authorize(`${siteBase}/assistant.json`);
    expect([host.status, host.body.error.code]).toEqual([403, 'client_host_not_allowed']);
    const audit = await t.db.one<any>(`select summary from audit_events where action = 'mcp.oauth.client_metadata_refused' order by id desc limit 1`);
    expect(audit.summary).toContain(`127.0.0.1:${sitePort}`);
    expect((await settings({ clientMetadataHosts: ['not a host!'] })).status).toBe(400);
  });

  it('fetches, checks and caches the document, shows its host, and completes the sign-in', async () => {
    await settings({ clientMetadataHosts: [`127.0.0.1:${sitePort}`] });
    const clientId = `${siteBase}/assistant.json`;
    const { verifier, challenge } = pkce();
    const check = await t.api.post('/api/mcp/oauth/authorize', authorizeParams(clientId, challenge));
    expect(check.status, JSON.stringify(check.body)).toBe(200);
    expect(check.body.client).toMatchObject({
      name: 'Yard planning assistant', registeredBy: 'metadata', clientId, clientIdHost: `127.0.0.1:${sitePort}`,
      redirectHost: '127.0.0.1:33418', localRedirect: true,
    });
    expect(hits['/assistant.json']).toBe(1);
    const [row] = await rows(clientId);
    expect(row).toMatchObject({ registered_by: 'metadata', auth_method: 'none', pending: false, secret_hash: null });
    const ttl = (new Date(row.metadata_expires_at).getTime() - new Date(row.metadata_fetched_at).getTime()) / 1000;
    expect(Math.round(ttl)).toBe(600);
    const first = await t.db.one<any>(`select summary from audit_events where action = 'mcp.oauth.client_metadata' order by id desc limit 1`);
    expect(first.summary).toContain('Yard planning assistant');

    // Cached: the decision does not fetch again.
    const decided = await t.api.post('/api/mcp/oauth/decision', { ...authorizeParams(clientId, challenge), approve: true, access: 'read', expiresInDays: 7 });
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
    expect(hits['/assistant.json']).toBe(1);
    const code = new URL(decided.body.redirect).searchParams.get('code')!;
    const tokenRes = await form({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT, client_id: clientId, resource: `${base}/mcp` });
    expect(tokenRes.status).toBe(200);
    const tokens = await tokenRes.json() as any;
    const c = new Client({ name: 'cimd-test', version: '1' });
    await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } } }));
    expect((await c.listTools()).tools.length).toBeGreaterThan(0);
    await c.close();
    // The token endpoint never fetches.
    expect(hits['/assistant.json']).toBe(1);

    // Redirect addresses match exactly: no port leeway on loopback for these connectors.
    const otherPort = await authorize(clientId, { redirect_uri: 'http://127.0.0.1:9999/callback' });
    expect([otherPort.status, otherPort.body.error.code]).toEqual([400, 'invalid_redirect_uri']);
    const unknown = await authorize(clientId, { redirect_uri: 'https://elsewhere.example.org/cb' });
    expect([unknown.status, unknown.body.error.code]).toEqual([400, 'invalid_redirect_uri']);

    // Once the cache expires the document is fetched again and a change is audited.
    docs['/assistant.json'] = doc('/assistant.json', { client_name: 'Yard planning assistant 2' });
    await t.db.query('update mcp_oauth_clients set metadata_expires_at = now() - interval \'1 second\' where client_id = $1', [clientId]);
    const again = await authorize(clientId);
    expect(again.body.client.name).toBe('Yard planning assistant 2');
    expect(hits['/assistant.json']).toBe(2);
    expect((await t.db.one<any>(`select summary from audit_events where action = 'mcp.oauth.client_metadata' order by id desc limit 1`)).summary).toMatch(/changed its metadata document/);

    // Switching the feature off ends these connections at once.
    await settings({ clientMetadata: false });
    expect((await form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId })).status).toBe(401);
    const refused = await fetch(`${base}/mcp`, {
      method: 'POST', headers: { authorization: `Bearer ${tokens.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '1' } } }),
    });
    expect(refused.status).toBe(401);
    await settings({ clientMetadata: true });
  });

  it('refuses bad documents without caching them, and never redirects to the connector', async () => {
    const cases: [string, unknown, RegExp][] = [
      ['/mismatch.json', { ...doc('/mismatch.json'), client_id: `${siteBase}/other.json` }, /client_id/],
      ['/secret.json', doc('/secret.json', { client_secret: 'abc' }), /client_secret/],
      ['/extra.json', doc('/extra.json', { is_admin: true }), /Unknown fields/],
      ['/basic.json', doc('/basic.json', { token_endpoint_auth_method: 'client_secret_basic' }), /not supported/],
      ['/no-redirects.json', doc('/no-redirects.json', { redirect_uris: [] }), /redirect_uris/],
      ['/redirect-private.json', (res: any) => res.writeHead(302, { location: 'https://10.0.0.1/' }).end(), /redirect/],
      ['/huge.json', (res: any) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(doc('/huge.json', { software_id: 'y'.repeat(6000) }))), /larger than/],
      ['/gone.json', undefined, /404/],
    ];
    for (const [path, body, message] of cases) {
      if (body !== undefined) docs[path] = body; else delete docs[path];
      const res = await authorize(`${siteBase}${path}`);
      expect([res.status, res.body.error?.code], path).toEqual([400, 'invalid_client']);
      expect(res.body.error.message, path).toMatch(message);
      expect(res.body.redirect, path).toBeUndefined();
      expect(await rows(`${siteBase}${path}`), path).toHaveLength(0);
    }
    // Not cached: a corrected document is accepted on the next try.
    docs['/mismatch.json'] = doc('/mismatch.json');
    expect((await authorize(`${siteBase}/mismatch.json`)).status).toBe(200);
  });

  it('rate-limits lookups per person', async () => {
    for (let i = 0; i < 20; i++) {
      docs[`/many-${i}.json`] = (res: any) => res.writeHead(500).end();
      await authorize(`${siteBase}/many-${i}.json`);
    }
    const limited = await authorize(`${siteBase}/many-0.json`);
    expect([limited.status, limited.body.error.code]).toEqual([429, 'rate_limited']);
  });

  it('can wait for an administrator to approve a new connector; removal blocks it until allowed again', async () => {
    await settings({ clientMetadataApproval: true });
    docs['/new.json'] = doc('/new.json', { client_name: 'Depot roster helper' });
    const clientId = `${siteBase}/new.json`;
    const waiting = await authorize(clientId);
    expect([waiting.status, waiting.body.error.code]).toEqual([403, 'client_pending']);
    const admin = (await t.api.get('/api/mcp/admin')).body;
    const listed = admin.oauth.clients.find((c: any) => c.client_id === clientId);
    expect(listed).toMatchObject({ pending: true, registered_by: 'metadata', name: 'Depot roster helper' });
    expect(admin.oauth.outboundEnabled).toBe(true);
    // A pending connector cannot use the token endpoint either.
    expect((await form({ grant_type: 'authorization_code', code: 'x', code_verifier: 'y', redirect_uri: REDIRECT, client_id: clientId })).status).toBe(401);
    const agent = await t.as('agent');
    expect((await agent.post(`/api/mcp/admin/oauth/clients/${listed.id}/approve`)).status).toBe(403);
    expect((await t.api.post(`/api/mcp/admin/oauth/clients/${listed.id}/approve`)).status).toBe(200);
    expect((await authorize(clientId)).status).toBe(200);

    expect((await t.api.del(`/api/mcp/admin/oauth/clients/${listed.id}`)).status).toBe(200);
    const blocked = await authorize(clientId);
    expect([blocked.status, blocked.body.error.code]).toEqual([403, 'client_blocked']);
    const view = (await t.api.get('/api/mcp/admin')).body.oauth;
    expect(view.blocked.map((b: any) => b.client_id)).toContain(clientId);
    expect((await t.api.del(`/api/mcp/admin/oauth/blocked/${listed.id}`)).status).toBe(200);
    // Looked up afresh, and waiting for approval again.
    expect((await authorize(clientId)).body.error.code).toBe('client_pending');
    await settings({ clientMetadataApproval: false });
  });
});
