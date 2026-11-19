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
