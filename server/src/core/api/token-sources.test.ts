import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { checkSources, normalizeIp, parseSource, sourceAllowed } from '../tokens.ts';

// E02-18: a personal access token limited to source addresses and ranges.

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

const call = (token: string, remoteAddress: string, url = '/api/auth/state') =>
  t.app.inject({ method: 'GET', url, remoteAddress, headers: { authorization: `Bearer ${token}` } });

describe('source addresses', () => {
  it('parses addresses and ranges, and matches IPv4, IPv6 and IPv4-mapped addresses', () => {
    expect(parseSource('10.20.0.0/16')).toEqual({ address: '10.20.0.0', prefix: 16, family: 'ipv4' });
    expect(parseSource('2001:db8::/32')).toEqual({ address: '2001:db8::', prefix: 32, family: 'ipv6' });
    expect(parseSource('203.0.113.7')).toMatchObject({ prefix: 32 });
    for (const bad of ['10.0.0.0/33', '2001:db8::/129', 'example.org', '10.0.0', '1.2.3.4/-1', '']) expect(parseSource(bad), bad).toBeNull();
    expect(normalizeIp('::ffff:10.1.2.3')).toBe('10.1.2.3');
    expect(normalizeIp('[::1]')).toBe('::1');
    expect(sourceAllowed('10.20.4.5', ['10.20.0.0/16'])).toBe(true);
    expect(sourceAllowed('::ffff:10.20.4.5', ['10.20.0.0/16'])).toBe(true);
    expect(sourceAllowed('10.21.0.1', ['10.20.0.0/16'])).toBe(false);
    expect(sourceAllowed('2001:db8:1::9', ['2001:db8::/32'])).toBe(true);
    expect(sourceAllowed('2001:db9::1', ['2001:db8::/32'])).toBe(false);
    expect(sourceAllowed('anything', [])).toBe(true);
    expect(sourceAllowed('garbage', ['10.0.0.0/8'])).toBe(false);
    expect(checkSources('10.0.0.1, 10.0.0.1 192.168.0.0/24')).toEqual({ list: ['10.0.0.1', '192.168.0.0/24'] });
    expect(checkSources(Array.from({ length: 21 }, (_, i) => `10.0.0.${i}`))).toHaveProperty('error');
    expect(checkSources(['10.0.0.1', 'nope'])).toHaveProperty('error');
  });

  it('refuses a token used from elsewhere, audits it, and accepts it from an allowed address', async () => {
    const bad = await t.api.post('/api/me/tokens', { name: 'Bad list', scopes: ['tickets.view'], expiresInDays: 1, allowedSources: ['300.1.1.1'] });
    expect(bad.body.error.fields.allowedSources).toMatch(/not an address/);
    const made = await t.api.post('/api/me/tokens', { name: 'Nightly import', scopes: ['tickets.view'], expiresInDays: 1, allowedSources: ['198.51.100.0/24', '2001:db8::/32'] });
    expect(made.status).toBe(201);
    expect(made.body.allowed_sources).toEqual(['198.51.100.0/24', '2001:db8::/32']);
    expect((await call(made.body.token, '198.51.100.20')).statusCode).toBe(200);
    expect((await call(made.body.token, '2001:db8::20')).statusCode).toBe(200);
    const refused = await call(made.body.token, '192.0.2.9');
    expect([refused.statusCode, refused.json().error.code]).toEqual([403, 'token_source_not_allowed']);
    const ev = await t.db.one<any>(`select action, summary from audit_events where action = 'token.refused' order by id desc limit 1`);
    expect(ev.summary).toMatch(/Nightly import.*192\.0\.2\.9.*not among its allowed/);
    expect(ev.summary).not.toContain(made.body.token);
    // Listed with the token, for its owner and for administrators.
    expect((await t.api.get('/api/me/tokens')).body.tokens.find((x: any) => x.name === 'Nightly import').allowed_sources).toEqual(['198.51.100.0/24', '2001:db8::/32']);
    expect((await t.api.get('/api/admin/tokens')).body.tokens.find((x: any) => x.name === 'Nightly import').allowed_sources).toHaveLength(2);
    // A token without a list works from anywhere.
    const open = (await t.api.post('/api/me/tokens', { name: 'Anywhere', scopes: ['tickets.view'], expiresInDays: 1 })).body;
    expect(open.allowed_sources).toEqual([]);
    expect((await call(open.token, '192.0.2.9')).statusCode).toBe(200);
    expect((await t.api.get('/api/me/tokens')).body.yourAddress).toBeTruthy();
  });
});

describe('changing the source addresses of a token', () => {
  const confirm = (minutesAgo = 0) => t.db.query(`update sessions set confirmed_at = now() - make_interval(mins => $1)`, [minutesAgo]);

  it('lets the owner narrow, widen and clear the list, with a recent confirmation, audited', async () => {
    const made = (await t.api.post('/api/me/tokens', { name: 'Depot sync', scopes: ['tickets.view'], expiresInDays: 1 })).body;
    expect((await call(made.token, '192.0.2.9')).statusCode).toBe(200);

    expect((await t.api.patch(`/api/me/tokens/${made.id}`, { allowedSources: ['10.0.0.0/33'] })).body.error.fields.allowedSources).toMatch(/not an address/);
    expect((await t.api.patch(`/api/me/tokens/${made.id}`, {})).body.error.fields.allowedSources).toBeTruthy();
    await confirm(30);
    expect((await t.api.patch(`/api/me/tokens/${made.id}`, { allowedSources: ['203.0.113.0/24'] })).body.error.code).toBe('reauth_required');
    await confirm();
    const changed = await t.api.patch(`/api/me/tokens/${made.id}`, { allowedSources: '203.0.113.0/24, 2001:db8::7' });
    expect(changed.status).toBe(200);
    expect(changed.body.allowed_sources).toEqual(['203.0.113.0/24', '2001:db8::7']);
    expect(changed.body.token).toBeUndefined();
    expect((await call(made.token, '192.0.2.9')).json().error.code).toBe('token_source_not_allowed');
    expect((await call(made.token, '203.0.113.50')).statusCode).toBe(200);
    const ev = await t.db.one<any>(`select summary, before, after from audit_events where action = 'token.update' order by id desc limit 1`);
    expect(ev.summary).toMatch(/Depot sync.*203\.0\.113\.0\/24/);
    expect(ev.before).toEqual({ allowed_sources: [] });
    expect(ev.after).toEqual({ allowed_sources: ['203.0.113.0/24', '2001:db8::7'] });

    // An empty list allows any address again.
    expect((await t.api.patch(`/api/me/tokens/${made.id}`, { allowedSources: [] })).body.allowed_sources).toEqual([]);
    expect((await call(made.token, '192.0.2.9')).statusCode).toBe(200);
    // A token cannot change itself, and a revoked token cannot be changed.
    expect((await t.app.inject({ method: 'PATCH', url: `/api/me/tokens/${made.id}`, headers: { authorization: `Bearer ${made.token}` }, payload: { allowedSources: [] } })).statusCode).toBe(403);
    await t.api.del(`/api/me/tokens/${made.id}`);
    expect((await t.api.patch(`/api/me/tokens/${made.id}`, { allowedSources: [] })).status).toBe(404);
  });

  it('lets an administrator change anyone\'s token, and nobody else', async () => {
    const agent = await t.as('agent');
    const theirs = await agent.post('/api/me/tokens', { name: 'Agent script', scopes: ['tickets.view'], expiresInDays: 1 });
    expect(theirs.status, JSON.stringify(theirs.body)).toBe(201);
    const mine = (await t.api.post('/api/me/tokens', { name: 'Admin script', scopes: ['tickets.view'], expiresInDays: 1 })).body;
    expect((await agent.patch(`/api/me/tokens/${mine.id}`, { allowedSources: ['10.0.0.1'] })).status).toBe(404);
    expect((await agent.patch(`/api/admin/tokens/${mine.id}`, { allowedSources: ['10.0.0.1'] })).status).toBe(403);
    await confirm();
    const res = await t.api.patch(`/api/admin/tokens/${theirs.body.id}`, { allowedSources: ['10.0.0.1'] });
    expect(res.status).toBe(200);
    expect((await t.db.one<any>(`select summary from audit_events where action = 'token.update' order by id desc limit 1`)).summary).toMatch(/Agent script.*by an administrator/);
  });

  it('uses the address the trusted proxy forwarded, and ignores the header otherwise', async () => {
    const made = (await t.api.post('/api/me/tokens', { name: 'Behind proxy', scopes: ['tickets.view'], expiresInDays: 1, allowedSources: ['198.51.100.7'] })).body;
    const via = (forwarded: string) => t.app.inject({ method: 'GET', url: '/api/auth/state', remoteAddress: '127.0.0.1', headers: { authorization: `Bearer ${made.token}`, 'x-forwarded-for': forwarded } });
    const saved = process.env.GRC_TRUST_PROXY;
    try {
      delete process.env.GRC_TRUST_PROXY;
      expect((await via('198.51.100.7')).statusCode).toBe(403); // the header alone proves nothing
      process.env.GRC_TRUST_PROXY = '1';
      expect((await via('192.0.2.1, 198.51.100.7')).statusCode).toBe(200); // the entry the proxy appended
      expect((await via('198.51.100.7, 192.0.2.1')).statusCode).toBe(403);
    } finally {
      if (saved === undefined) delete process.env.GRC_TRUST_PROXY; else process.env.GRC_TRUST_PROXY = saved;
    }
  });
});
