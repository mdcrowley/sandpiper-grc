// apiFetch and the session: the bearer token, refresh with rotation, a refused refresh wiping local
// data, and grants. The phone's modules are replaced by in-memory fakes.
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
jest.mock('expo-crypto', () => ({ randomUUID: () => '7b0e0d4c-5f7a-4b0e-9a55-0c1d2e3f4a5b', getRandomBytes: (n: number) => new Uint8Array(n) }));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock('expo-local-authentication', () => ({ SecurityLevel: { NONE: 0 } }));
jest.mock('expo-device', () => ({ deviceName: 'Test phone', modelName: 'Test' }));
jest.mock('expo-file-system/legacy', () => ({ createUploadTask: jest.fn(), FileSystemUploadType: { BINARY_CONTENT: 0 } }));

import { act, renderHook } from '@testing-library/react-native';
import { apiFetch, ApiError, grants, useSession } from './client';
import { authStore, onWipe, start } from '../auth/session';

const SERVER = 'https://grc.example.org';
const hello = {
  product: 'sandpiper-grc', apiVersion: 1, appName: 'Sandpiper GRC', mobile: { minVersion: '0.1.0', recommendedVersion: '0.1.0' },
  oauth: {
    authorizationEndpoint: `${SERVER}/oauth/authorize`, tokenEndpoint: `${SERVER}/oauth/token`, revocationEndpoint: `${SERVER}/oauth/revoke`,
    clientId: 'com.sandpipergrc', redirectUri: 'com.sandpipergrc:/oauth', scope: 'mobile',
  },
};
const profile = {
  user: { id: 'u1', displayName: 'Dana Field', username: 'dfield' }, permissions: ['tickets.*', 'tags.view'],
  areas: { tags: true, safety: false }, unlock: { required: false, afterMinutes: 5 }, appName: 'Sandpiper GRC',
};

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
let handler: (url: string, init: RequestInit) => { status: number; body: unknown; headers?: Record<string, string> };

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h: string) => headers[h] ?? headers[h.toLowerCase()] ?? null },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
    json: async () => body,
  };
}

beforeAll(async () => {
  mockStore.set('grc.server', SERVER);
  mockStore.set('grc.hello', JSON.stringify(hello));
  mockStore.set('grc.profile', JSON.stringify(profile));
  mockStore.set('grc.installation', '7b0e0d4c-5f7a-4b0e-9a55-0c1d2e3f4a5b');
  mockStore.set('grc.tokens', JSON.stringify({ access: 'grc_mat_1', refresh: 'grc_mrt_1', expiresAt: Date.now() + 600_000, deviceId: 'd1' }));
  (globalThis as { fetch: unknown }).fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const r = handler(url, init);
    return json(r.status, r.body, r.headers);
  });
  handler = (url) => (url.endsWith('/api/mobile/settings')
    ? { status: 200, body: { ...profile, server: { appName: 'Sandpiper GRC', timeZone: 'UTC' }, tags: null } }
    : { status: 404, body: { error: { code: 'not_found', message: 'Not found' } } });
  await start();
});

beforeEach(() => {
  calls = [];
});

describe('apiFetch', () => {
  it('sends the access token, If-Match and JSON, and reports the ETag', async () => {
    handler = () => ({ status: 200, body: { id: 't1' }, headers: { ETag: 'W/"3"' } });
    const seen: { status: number; etag: string | null }[] = [];
    const r = await apiFetch<{ id: string }>('/api/tickets/t1', { method: 'PATCH', body: { status: 'open' }, ifMatch: 'W/"2"', onResponse: (i) => seen.push(i) });
    expect(r.id).toBe('t1');
    expect(seen).toEqual([{ status: 200, etag: 'W/"3"' }]);
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(calls[0]!.url).toBe(`${SERVER}/api/tickets/t1`);
    expect(h.Authorization).toBe('Bearer grc_mat_1');
    expect(h['If-Match']).toBe('W/"2"');
    expect(h['Content-Type']).toBe('application/json');
  });

  it('throws ApiError with the server\'s code and fields', async () => {
    handler = () => ({ status: 400, body: { error: { code: 'validation', message: 'Check the fields', fields: { title: 'Required.' } } } });
    const e = await apiFetch('/api/tickets', { method: 'POST', body: {} }).catch((x: ApiError) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 400, code: 'validation', fields: { title: 'Required.' } });
  });

  it('refreshes once on a 401, keeping the rotated tokens', async () => {
    let first = true;
    handler = (url, init) => {
      if (url.endsWith('/oauth/token')) {
        expect(String(init.body)).toContain('refresh_token=grc_mrt_1');
        return { status: 200, body: { access_token: 'grc_mat_2', refresh_token: 'grc_mrt_2', expires_in: 900, token_type: 'Bearer', scope: 'mobile', device_id: 'd1' } };
      }
      if (first) {
        first = false;
        return { status: 401, body: { error: { code: 'invalid_token', message: 'Expired' } } };
      }
      return { status: 200, body: { ok: true } };
    };
    await expect(apiFetch('/api/me/devices')).resolves.toEqual({ ok: true });
    expect((calls[2]!.init.headers as Record<string, string>).Authorization).toBe('Bearer grc_mat_2');
    expect(JSON.parse(mockStore.get('grc.tokens')!).refresh).toBe('grc_mrt_2');
  });

  it('a refused refresh signs out and wipes local data, keeping the server address', async () => {
    const wiped = jest.fn();
    onWipe(wiped);
    mockStore.set('grc.tokens', JSON.stringify({ access: 'grc_mat_2', refresh: 'grc_mrt_2', expiresAt: 0, deviceId: 'd1' }));
    // Reload the stored (expired) tokens the way a fresh launch would.
    handler = (url) => (url.endsWith('/oauth/token')
      ? { status: 400, body: { error: 'invalid_grant' } }
      : { status: 200, body: {} });
    const { result } = await renderHook(() => useSession());
    // The in-memory tokens are still valid: expire them through a 401 instead.
    handler = (url) => (url.endsWith('/oauth/token')
      ? { status: 400, body: { error: 'invalid_grant' } }
      : { status: 401, body: { error: { code: 'invalid_token', message: 'Revoked' } } });
    await act(async () => {
      await expect(apiFetch('/api/notifications')).rejects.toBeInstanceOf(ApiError);
    });
    expect(wiped).toHaveBeenCalled();
    expect(authStore.get()).toMatchObject({ status: 'signed-out', signedOutReason: 'refresh_failed', server: SERVER });
    expect(result.current.status).toBe('signed-out');
    expect(mockStore.has('grc.tokens')).toBe(false);
    expect(mockStore.has('grc.profile')).toBe(false);
    expect(mockStore.get('grc.server')).toBe(SERVER);
    await expect(apiFetch('/api/notifications')).rejects.toMatchObject({ code: 'not_connected' });
  });
});

describe('grants', () => {
  it('reads *, module.* and exact permissions', () => {
    expect(grants(['*'], 'admin.administer')).toBe(true);
    expect(grants(['tickets.*'], 'tickets.edit')).toBe(true);
    expect(grants(['tags.view'], 'tags.view')).toBe(true);
    expect(grants(['tags.view'], 'tags.manage')).toBe(false);
    expect(grants([], 'tickets.view')).toBe(false);
  });
});
