// The app's side of the UnifiedPush connector (E38-14): the native module SandpiperUnifiedPush
// (mobile/modules/sandpiper-unifiedpush) stands in here as a fake, so this runs without a phone. The
// Kotlin side has its own unit tests (PushContentTest) and is proven linked by the release build.
import { registerPhone, NO_DISTRIBUTOR, type UnifiedPushConnector } from './registration';

type Listener = (payload: unknown) => void;

function fakeConnector(over: Partial<UnifiedPushConnector> = {}) {
  const listeners = new Map<string, Listener[]>();
  const calls: string[] = [];
  const connector = {
    register: jest.fn(async (key: string) => {
      calls.push(`register:${key}`);
      return { endpoint: `https://push.example.org/up/${key}`, p256dh: 'P'.repeat(87), auth: 'A'.repeat(22), extra: 'never sent' };
    }),
    unregister: jest.fn(async () => { calls.push('unregister'); }),
    currentDistributor: jest.fn(() => ({ id: 'org.example.distributor', name: 'Example distributor' })),
    distributors: jest.fn(() => [{ id: 'org.example.distributor', name: 'Example distributor' }]),
    pickDistributor: jest.fn(async () => { calls.push('pick'); return true; }),
    takeOpened: jest.fn(() => false),
    addListener: jest.fn((event: string, l: Listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), l]);
      return { remove: () => undefined };
    }),
    ...over,
  };
  const fire = (event: string) => { for (const l of listeners.get(event) ?? []) l({}); };
  return { connector, calls, fire };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('registerPhone with the UnifiedPush connector', () => {
  const status = { available: true, providers: { apns: false, fcm: false, unifiedpush: true }, vapidPublicKey: 'BKEY', registered: false, provider: null };

  it('sends only the endpoint and the two message keys', async () => {
    const { connector } = fakeConnector();
    const sent: unknown[] = [];
    const r = await registerPhone({
      platform: 'android', dev: false, status: async () => status, register: async (i) => { sent.push(i); return status; },
      deviceToken: async () => { throw new Error('no Firebase'); }, unifiedPush: connector,
    });
    expect(r).toEqual({ ok: true, provider: 'unifiedpush' });
    expect(sent).toEqual([{ provider: 'unifiedpush', endpoint: 'https://push.example.org/up/BKEY', p256dh: 'P'.repeat(87), auth: 'A'.repeat(22) }]);
  });

  it('says when the phone has no distributor app', async () => {
    const { connector } = fakeConnector({
      register: async () => { throw Object.assign(new Error('No UnifiedPush distributor app is installed on this phone.'), { code: NO_DISTRIBUTOR }); },
    });
    const r = await registerPhone({
      platform: 'android', dev: false, status: async () => status, register: async () => status,
      deviceToken: async () => 'x', unifiedPush: connector,
    });
    expect(r).toMatchObject({ ok: false, reason: 'no-distributor' });
  });

  it('reports a distributor that does not answer as a failure', async () => {
    const { connector } = fakeConnector({ register: async () => { throw Object.assign(new Error('The push app did not answer in time.'), { code: 'ERR_UNIFIEDPUSH_TIMEOUT' }); } });
    const r = await registerPhone({ platform: 'android', dev: false, status: async () => status, register: async () => status, deviceToken: async () => 'x', unifiedPush: connector });
    expect(r).toEqual({ ok: false, reason: 'failed', message: 'The push app did not answer in time.' });
  });
});

describe('push on an Android phone with the connector', () => {
  let fake: ReturnType<typeof fakeConnector>;
  let push: typeof import('./index');
  let api: jest.Mock;
  let routerPush: jest.Mock;
  let auth: { status: string };
  let wipe: (() => Promise<void>) | null;
  let stored: string | null;

  beforeEach(() => {
    jest.resetModules();
    fake = fakeConnector();
    auth = { status: 'signed-in' };
    wipe = null;
    stored = 'on';
    routerPush = jest.fn();
    api = jest.fn(async (path: string, init?: { method?: string }) => {
      if (!init?.method) return { available: true, providers: { apns: false, fcm: false, unifiedpush: true }, vapidPublicKey: 'BKEY', registered: false, provider: null };
      return { ok: true };
    });
    jest.doMock('react-native', () => ({ Platform: { OS: 'android' } }));
    jest.doMock('expo', () => ({ requireOptionalNativeModule: (name: string) => (name === 'SandpiperUnifiedPush' ? fake.connector : null) }));
    jest.doMock('expo-router', () => ({ router: { push: routerPush } }));
    jest.doMock('expo-secure-store', () => ({
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
      getItemAsync: async () => stored,
      setItemAsync: async (_k: string, v: string) => { stored = v; },
      deleteItemAsync: async () => { stored = null; },
    }));
    jest.doMock('expo-notifications', () => ({
      DEFAULT_ACTION_IDENTIFIER: 'default',
      AndroidImportance: { DEFAULT: 3 },
      setAutoServerRegistrationEnabledAsync: async () => undefined,
      setNotificationHandler: () => undefined,
      setNotificationChannelAsync: async () => null,
      addNotificationResponseReceivedListener: () => ({ remove: () => undefined }),
      getLastNotificationResponseAsync: async () => null,
      clearLastNotificationResponseAsync: async () => undefined,
      addPushTokenListener: () => ({ remove: () => undefined }),
      setBadgeCountAsync: async () => true,
      unregisterForNotificationsAsync: async () => undefined,
      getPermissionsAsync: async () => ({ granted: true }),
      requestPermissionsAsync: async () => ({ granted: true }),
      getDevicePushTokenAsync: async () => { throw new Error('Default FirebaseApp is not initialized'); },
    }));
    jest.doMock('../api/client', () => ({ apiFetch: api }));
    jest.doMock('../auth/session', () => ({
      authStore: { get: () => auth, subscribe: () => () => undefined },
      onWipe: (h: () => Promise<void>) => { wipe = h; return () => undefined; },
    }));
    push = require('./index');
  });

  const puts = () => api.mock.calls.filter(([, init]) => init?.method === 'PUT').map(([, init]) => init.body);

  it('registers through the distributor at start and shows which one', async () => {
    push.startPush();
    await flush();
    await flush();
    expect(fake.calls).toEqual(['register:BKEY']);
    expect(puts()).toEqual([{ provider: 'unifiedpush', endpoint: 'https://push.example.org/up/BKEY', p256dh: 'P'.repeat(87), auth: 'A'.repeat(22) }]);
    expect(push.usePushState).toBeDefined();
  });

  it('opens Notifications from a tapped push only while signed in', async () => {
    (fake.connector.takeOpened as jest.Mock).mockReturnValue(true);
    push.startPush();
    expect(routerPush).toHaveBeenCalledWith('/notifications');
    routerPush.mockClear();
    auth.status = 'signed-out';
    fake.fire('onOpened');
    expect(routerPush).not.toHaveBeenCalled();
    auth.status = 'signed-in';
    fake.fire('onOpened');
    expect(routerPush).toHaveBeenCalledWith('/notifications');
  });

  it('registers again when the distributor gives a new address or ends the registration', async () => {
    push.startPush();
    await flush();
    await flush();
    fake.fire('onNewEndpoint');
    await flush();
    await flush();
    fake.fire('onUnregistered');
    await flush();
    await flush();
    expect(fake.calls).toEqual(['register:BKEY', 'register:BKEY', 'register:BKEY']);
    // Not when the person has switched push off.
    stored = null;
    fake.fire('onNewEndpoint');
    await flush();
    expect(fake.calls.length).toBe(3);
  });

  it('lets the person choose another distributor app', async () => {
    push.startPush();
    await flush();
    await flush();
    const after = await push.changeDistributor();
    expect(fake.calls).toEqual(['register:BKEY', 'pick', 'register:BKEY']);
    expect(after).toEqual({ status: 'on', provider: 'unifiedpush', distributor: { id: 'org.example.distributor', name: 'Example distributor' } });
  });

  it('tells the person to install a distributor app when there is none', async () => {
    (fake.connector.register as jest.Mock).mockRejectedValue(Object.assign(new Error('none'), { code: NO_DISTRIBUTOR }));
    stored = null;
    push.startPush();
    const state = await push.setPushEnabled(true);
    expect(state).toEqual({ status: 'unavailable', message: expect.stringContaining('install a UnifiedPush distributor app') });
  });

  it('ends the registration on the phone when push is switched off or the phone is signed out', async () => {
    push.startPush();
    await flush();
    await push.setPushEnabled(false);
    expect(fake.calls).toContain('unregister');
    expect(api.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true);
    fake.calls.length = 0;
    await wipe!();
    expect(fake.calls).toEqual(['unregister']);
  });
});
