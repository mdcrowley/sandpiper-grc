import type { MobileHello } from '../../../shared/mobile-api.ts';
import { authorizeUrl, base64Url, exchangeCode, makePkce, parseRedirect, refreshTokens, TokenError, type Crypto } from './oauth';

// Node's crypto for the test (the app uses expo-crypto).
declare const require: (id: string) => any;
const { createHash } = require('crypto') as { createHash(a: string): { update(s: string): { digest(): Uint8Array } } };

const hello = {
  oauth: {
    authorizationEndpoint: 'https://grc.example.org/oauth/authorize', tokenEndpoint: 'https://grc.example.org/oauth/token',
    revocationEndpoint: 'https://grc.example.org/oauth/revoke', clientId: 'com.sandpipergrc', redirectUri: 'com.sandpipergrc:/oauth', scope: 'mobile',
  },
} as MobileHello;

let n = 0;
const fakeCrypto: Crypto = {
  randomBytes: (size) => Uint8Array.from({ length: size }, () => {
    n = (n + 37) % 256;
    return n;
  }),
  sha256: async (text) => new Uint8Array(createHash('sha256').update(text).digest()),
};

describe('PKCE', () => {
  it('encodes base64url without padding (RFC 4648 test vectors)', () => {
    const enc = (s: string) => base64Url(Uint8Array.from(s, (c) => c.charCodeAt(0)));
    expect(enc('f')).toBe('Zg');
    expect(enc('fo')).toBe('Zm8');
    expect(enc('foo')).toBe('Zm9v');
    expect(enc('foob')).toBe('Zm9vYg');
    expect(base64Url(Uint8Array.from([0xfb, 0xff]))).toBe('-_8');
  });
  it('makes an S256 challenge of the verifier (RFC 7636 appendix B)', async () => {
    const vector = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(base64Url(await fakeCrypto.sha256(vector))).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    const p = await makePkce(fakeCrypto);
    expect(p.verifier).toHaveLength(43);
    expect(p.challenge).toBe(base64Url(await fakeCrypto.sha256(p.verifier)));
  });
});

describe('authorization request and redirect', () => {
  const device = {
    installationId: '7b0e0d4c-5f7a-4b0e-9a55-0c1d2e3f4a5b', deviceName: 'Field phone 12', platform: 'android' as const, appVersion: '0.1.0',
  };
  it('carries PKCE, the installation and the device', () => {
    const url = authorizeUrl(hello, { verifier: 'v', challenge: 'c', state: 's' }, device, { promptLogin: true });
    expect(url.startsWith('https://grc.example.org/oauth/authorize?')).toBe(true);
    const q: Record<string, string> = {};
    for (const pair of url.split('?')[1]!.split('&')) {
      const [k, v] = pair.split('=');
      q[decodeURIComponent(k!)] = decodeURIComponent(v!);
    }
    expect(q).toEqual({
      response_type: 'code', client_id: 'com.sandpipergrc', redirect_uri: 'com.sandpipergrc:/oauth', scope: 'mobile', state: 's',
      code_challenge: 'c', code_challenge_method: 'S256', installation_id: device.installationId, device_name: 'Field phone 12',
      device_platform: 'android', app_version: '0.1.0', prompt: 'login',
    });
  });
  it('accepts the code only with the right state', () => {
    expect(parseRedirect('com.sandpipergrc:/oauth?code=abc&state=s1', 's1')).toEqual({ ok: true, code: 'abc' });
    expect(parseRedirect('com.sandpipergrc:/oauth?code=abc&state=forged', 's1')).toEqual({ ok: false, error: 'state_mismatch' });
    expect(parseRedirect('com.sandpipergrc:/oauth?error=access_denied&error_description=No+thanks&state=s1', 's1'))
      .toEqual({ ok: false, error: 'access_denied', description: 'No thanks' });
  });
});

describe('token endpoint', () => {
  it('sends a form-encoded code exchange with the verifier and installation', async () => {
    const seen: { body?: string; headers?: Record<string, string> } = {};
    const f = (async (_url: string, init: RequestInit) => {
      seen.body = String(init.body);
      seen.headers = init.headers as Record<string, string>;
      return {
        ok: true, status: 200,
        json: async () => ({ access_token: 'grc_mat_a', refresh_token: 'grc_mrt_r', expires_in: 900, token_type: 'Bearer', scope: 'mobile', device_id: 'd1' }),
      };
    }) as unknown as typeof fetch;
    const t = await exchangeCode(hello, 'code1', 'verifier1', 'inst1', f);
    expect(t.device_id).toBe('d1');
    expect(seen.headers!['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(seen.body).toBe('grant_type=authorization_code&code=code1&redirect_uri=com.sandpipergrc%3A%2Foauth&client_id=com.sandpipergrc&code_verifier=verifier1&installation_id=inst1');
  });
  it('reports a refused refresh with its OAuth error', async () => {
    const f = (async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant', error_description: 'Signed out' }) })) as unknown as typeof fetch;
    const e = await refreshTokens(hello.oauth.tokenEndpoint, 'com.sandpipergrc', 'grc_mrt_old', 'inst1', f).catch((x: TokenError) => x);
    expect(e).toBeInstanceOf(TokenError);
    expect((e as TokenError).error).toBe('invalid_grant');
    expect((e as TokenError).status).toBe(400);
  });
});
