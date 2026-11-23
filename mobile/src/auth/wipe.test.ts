// Local data never outlives a session (wave 16, E38-15): when the app starts signed out it finishes any
// wipe an earlier sign-out did not (the app closed half-way, a clean-up that failed), and a new sign-in
// starts from an empty phone, so one person's outbox, package or drafts can never be sent or read as
// another's.
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
  openAuthSessionAsync: async (url: string) => {
    const state = /[?&]state=([^&]+)/.exec(url)![1];
    return { type: 'success', url: `com.sandpipergrc:/oauth?code=fresh-code&state=${state}` };
  },
}));
jest.mock('expo-local-authentication', () => ({ SecurityLevel: { NONE: 0 } }));
jest.mock('expo-device', () => ({ deviceName: 'Test phone', modelName: 'Test' }));
jest.mock('expo-file-system/legacy', () => ({ createUploadTask: jest.fn(), FileSystemUploadType: { BINARY_CONTENT: 0 } }));
// Offline work registers its wipe through onWipe (src/offline bootOffline); a stand-in records each wipe and what was stored then.
const mockWipes: { tokens: string | null }[] = [];
jest.mock('../offline', () => ({ bootOffline: () => undefined }));
// The installation check is tested in src/offline/security.test.ts; here it is an existing installation.
jest.mock('./install', () => ({ forgetEarlierInstallation: async () => false }));

import '../api/client';
import { authStore, connect, onWipe, signIn, start } from './session';

onWipe(() => { mockWipes.push({ tokens: mockStore.get('grc.tokens') ?? null }); });

const SERVER = 'https://grc.example.org';
const hello = {
  product: 'sandpiper-grc', apiVersion: 1, appName: 'Sandpiper GRC', mobile: { minVersion: '0.0.0', recommendedVersion: '0.0.0' },
  oauth: {
    authorizationEndpoint: `${SERVER}/oauth/authorize`, tokenEndpoint: `${SERVER}/oauth/token`, revocationEndpoint: `${SERVER}/oauth/revoke`,
    clientId: 'com.sandpipergrc', redirectUri: 'com.sandpipergrc:/oauth', scope: 'mobile',
  },
};
const settings = {
  user: { id: 'u2', displayName: 'Robin Depot', username: 'rdepot' }, permissions: ['*'], areas: {},
  unlock: { required: false, afterMinutes: 5 }, server: { appName: 'Sandpiper GRC', timeZone: 'UTC' }, tags: null,
};
const reply = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => JSON.stringify(body), json: async () => body,
});

beforeAll(() => {
  // A sign-out the app was closed in the middle of: the tokens were removed, the offline data not yet.
  mockStore.set('grc.server', SERVER);
  (globalThis as { fetch: unknown }).fetch = jest.fn(async (url: string) => {
    if (url.endsWith('/api/mobile/hello')) return reply(200, hello);
    if (url.endsWith('/oauth/token')) {
      return reply(200, { access_token: 'grc_mat_9', refresh_token: 'grc_mrt_9', expires_in: 900, token_type: 'Bearer', scope: 'mobile', device_id: 'd9' });
    }
    if (url.endsWith('/api/mobile/settings')) return reply(200, settings);
    return reply(404, { error: { code: 'not_found', message: 'Not found' } });
  });
});

it('finishes an unfinished wipe when the app starts signed out', async () => {
  await start();
  expect(authStore.get().status).toBe('signed-out');
  expect(mockWipes).toEqual([{ tokens: null }]);
});

it('starts a new sign-in from an empty phone: the wipe runs before the new tokens are kept', async () => {
  mockWipes.length = 0;
  await connect(SERVER);
  await expect(signIn()).resolves.toEqual({ ok: true });
  expect(mockWipes).toEqual([{ tokens: null }]);
  expect(authStore.get().status).toBe('signed-in');
  expect(JSON.parse(mockStore.get('grc.tokens')!).refresh).toBe('grc_mrt_9');
});
