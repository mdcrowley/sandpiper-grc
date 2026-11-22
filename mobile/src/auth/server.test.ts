import { checkServer, compareVersions, compatibility, ConnectError, normalizeServer } from './server';

const hello = (over: Record<string, unknown> = {}) => ({
  product: 'sandpiper-grc', apiVersion: 1, appName: 'Sandpiper GRC',
  mobile: { minVersion: '0.1.0', recommendedVersion: '0.1.0' },
  oauth: {
    authorizationEndpoint: 'https://grc.example.org/oauth/authorize', tokenEndpoint: 'https://grc.example.org/oauth/token',
    revocationEndpoint: 'https://grc.example.org/oauth/revoke', clientId: 'com.sandpipergrc', redirectUri: 'com.sandpipergrc:/oauth', scope: 'mobile',
  },
  ...over,
});

const answer = (status: number, body: unknown) => (async () => ({ ok: status < 300, status, json: async () => body })) as unknown as typeof fetch;
const failing = (async () => {
  throw new TypeError('Network request failed');
}) as unknown as typeof fetch;

describe('normalizeServer', () => {
  it('adds https and drops the trailing slash, keeping a base path', () => {
    expect(normalizeServer(' grc.example.org/ ', false)).toBe('https://grc.example.org');
    expect(normalizeServer('HTTPS://GRC.Example.org:8443/grc/', false)).toBe('https://grc.example.org:8443/grc');
  });
  it('refuses plain HTTP except in development builds', () => {
    expect(() => normalizeServer('http://10.0.2.2:8146', false)).toThrow(ConnectError);
    expect(normalizeServer('http://10.0.2.2:8146', true)).toBe('http://10.0.2.2:8146');
  });
  it('refuses empty, other schemes and credentials', () => {
    for (const bad of ['', 'ftp://x.org', 'https://user:pw@x.org', 'https://']) {
      expect(() => normalizeServer(bad, true)).toThrow(ConnectError);
    }
  });
});

describe('versions', () => {
  it('compares dotted versions numerically', () => {
    expect(compareVersions('0.10.0', '0.9.3')).toBe(1);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.1.0-beta.2', '0.1.1')).toBe(-1);
  });
  it('refuses an app older than the minimum and an unknown API version', () => {
    expect(compatibility({ apiVersion: 1, mobile: { minVersion: '0.2.0', recommendedVersion: '0.2.0' } }, '0.1.0').verdict).toBe('app_too_old');
    expect(compatibility({ apiVersion: 2 as 1, mobile: { minVersion: '0.1.0', recommendedVersion: '0.1.0' } }, '0.1.0').verdict).toBe('server_too_old');
    expect(compatibility({ apiVersion: 1, mobile: { minVersion: '0.1.0', recommendedVersion: '0.3.0' } }, '0.1.0'))
      .toEqual({ verdict: 'ok', updateSuggested: true });
  });
});

describe('checkServer', () => {
  const problem = async (f: typeof fetch) => checkServer('https://grc.example.org', '0.1.0', f).catch((e: ConnectError) => e.problem);

  it('accepts a compatible server', async () => {
    const r = await checkServer('https://grc.example.org', '0.1.0', answer(200, hello()));
    expect(r.hello.appName).toBe('Sandpiper GRC');
    expect(r.updateSuggested).toBe(false);
  });
  it('words the switched-off area, a stranger, an unreachable address and an old app', async () => {
    expect(await problem(answer(404, { error: { code: 'switched_off', message: 'off' } }))).toBe('switched_off');
    expect(await problem(answer(200, { hello: 'world' }))).toBe('not_sandpiper');
    expect(await problem(failing)).toBe('unreachable');
    expect(await problem(answer(200, hello({ mobile: { minVersion: '9.0.0', recommendedVersion: '9.0.0' } })))).toBe('app_too_old');
  });
  it('refuses endpoints that would leave HTTPS', async () => {
    const h = hello();
    (h.oauth as Record<string, string>).tokenEndpoint = 'http://grc.example.org/oauth/token';
    expect(await problem(answer(200, h))).toBe('not_sandpiper');
  });
});
