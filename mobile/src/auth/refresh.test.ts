// Token refresh under pressure: one refresh in flight however many requests need it, a newer pair kept
// when an older refresh is refused, and a refresh lost to the network repeated once with the same token.
const mockStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 0,
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => {
    mockStore.set(k, v);
  },
  deleteItemAsync: async (k: string) => {
    mockStore.delete(k);
  },
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => '7b0e0d4c-5f7a-4b0e-9a55-0c1d2e3f4a5b',
  getRandomBytes: (n: number) => Uint8Array.from({ length: n }, (_, i) => i),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { HEX: 'hex' },
  digestStringAsync: async () => '00'.repeat(32),
}));
jest.mock('expo-web-browser', () => ({
  // The browser sign-in succeeds at once: the redirect carries back the state it was given.
  openAuthSessionAsync: async (url: string) => {
    const state = /[?&]state=([^&]+)/.exec(url)![1];
    return { type: 'success', url: `com.sandpipergrc:/oauth?code=fresh-code&state=${state}` };
  },
}));
jest.mock('expo-local-authentication', () => ({ SecurityLevel: { NONE: 0 } }));
jest.mock('expo-device', () => ({ deviceName: 'Test phone', modelName: 'Test' }));
jest.mock('expo-file-system/legacy', () => ({ createUploadTask: jest.fn(), FileSystemUploadType: { BINARY_CONTENT: 0 } }));

import { apiFetch } from '../api/client';
import { authStore, confirmIdentity, start } from './session';

const SERVER = 'https://grc.example.org';
const hello = {
  product: 'sandpiper-grc', apiVersion: 1, appName: 'Sandpiper GRC', mobile: { minVersion: '0.1.0', recommendedVersion: '0.1.0' },
  oauth: {
    authorizationEndpoint: `${SERVER}/oauth/authorize`, tokenEndpoint: `${SERVER}/oauth/token`, revocationEndpoint: `${SERVER}/oauth/revoke`,
    clientId: 'com.sandpipergrc', redirectUri: 'com.sandpipergrc:/oauth', scope: 'mobile',
  },
};
const profile = {
  user: { id: 'u1', displayName: 'Dana Field', username: 'dfield' }, permissions: ['*'], areas: {},
  unlock: { required: false, afterMinutes: 5 }, appName: 'Sandpiper GRC',
};
const pair = (n: number) => ({
  access_token: `grc_mat_${n}`, refresh_token: `grc_mrt_${n}`, expires_in: 900, token_type: 'Bearer', scope: 'mobile', device_id: 'd1',
});

type Answer = { status: number; body: unknown } | 'network';
let tokenCalls: string[] = [];
let onToken: (form: URLSearchParams) => Promise<Answer>;
let validAccess = 'grc_mat_1';

function reply(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

beforeAll(async () => {
  mockStore.set('grc.server', SERVER);
  mockStore.set('grc.hello', JSON.stringify(hello));
  mockStore.set('grc.profile', JSON.stringify(profile));
  mockStore.set('grc.tokens', JSON.stringify({ access: 'grc_mat_1', refresh: 'grc_mrt_1', expiresAt: Date.now() + 600_000, deviceId: 'd1' }));
  (globalThis as { fetch: unknown }).fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    if (url.endsWith('/oauth/token')) {
      const form = new URLSearchParams(String(init.body));
      tokenCalls.push(form.get('grant_type') === 'refresh_token' ? form.get('refresh_token')! : `code:${form.get('code')}`);
      const a = await onToken(form);
      if (a === 'network') throw new TypeError('Network request failed');
      if (a.status === 200) validAccess = (a.body as { access_token: string }).access_token;
      return reply(a.status, a.body);
    }
    if (url.endsWith('/api/mobile/settings')) return reply(200, { ...profile, server: { appName: 'Sandpiper GRC', timeZone: 'UTC' }, tags: null });
    const auth = (init.headers as Record<string, string>).Authorization;
    return auth === `Bearer ${validAccess}` ? reply(200, { ok: true }) : reply(401, { error: { code: 'invalid_token', message: 'Expired' } });
  });
  await start();
});

beforeEach(() => {
  tokenCalls = [];
});

it('(1) keeps one refresh in flight: concurrent 401s wait for it', async () => {
  validAccess = 'grc_mat_server_moved_on';
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  onToken = async () => {
    await gate;
    return { status: 200, body: pair(2) };
  };
  const all = Promise.all([apiFetch('/api/a'), apiFetch('/api/b'), apiFetch('/api/c')]);
  await new Promise((r) => setTimeout(r, 50));
  release();
  await expect(all).resolves.toEqual([{ ok: true }, { ok: true }, { ok: true }]);
  expect(tokenCalls).toEqual(['grc_mrt_1']);
});

it('(2) keeps a newer pair stored while an older refresh is refused, and carries on with it', async () => {
  validAccess = 'grc_mat_server_moved_on';
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  onToken = async (form) => {
    if (form.get('grant_type') === 'authorization_code') return { status: 200, body: pair(3) };
    await gate; // the refresh with grc_mrt_2 is answered only after the sign-in again
    return { status: 400, body: { error: 'invalid_grant' } };
  };
  const call = apiFetch('/api/d');
  await new Promise((r) => setTimeout(r, 50));
  await expect(confirmIdentity()).resolves.toBe(true); // stores grc_mat_3 / grc_mrt_3
  release();
  await expect(call).resolves.toEqual({ ok: true });
  expect(authStore.get().status).toBe('signed-in');
  expect(JSON.parse(mockStore.get('grc.tokens')!).refresh).toBe('grc_mrt_3');
});

it('(3) repeats a refresh lost to the network once, promptly, with the same refresh token', async () => {
  validAccess = 'grc_mat_server_moved_on';
  let first = true;
  onToken = async () => {
    if (first) {
      first = false;
      return 'network';
    }
    return { status: 200, body: pair(4) };
  };
  const started = Date.now();
  await expect(apiFetch('/api/e')).resolves.toEqual({ ok: true });
  expect(tokenCalls).toEqual(['grc_mrt_3', 'grc_mrt_3']);
  expect(Date.now() - started).toBeLessThan(5000);
  expect(authStore.get().status).toBe('signed-in');
});

it('a refused refresh with no newer pair signs out', async () => {
  validAccess = 'grc_mat_server_moved_on';
  onToken = async () => ({ status: 400, body: { error: 'invalid_grant' } });
  await expect(apiFetch('/api/f')).rejects.toMatchObject({ status: 401 });
  expect(authStore.get()).toMatchObject({ status: 'signed-out', signedOutReason: 'refresh_failed' });
});
