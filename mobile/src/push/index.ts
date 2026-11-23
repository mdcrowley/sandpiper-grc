// Push notifications on this phone (E38-14). Owner: W14-PUSH.
//
// - The person switches push on under Account (setPushEnabled); the choice is kept per phone in the
//   Keychain or Keystore. While it is on, the phone registers after every sign-in and app start, and
//   again whenever Apple or Google give it a new token (addPushTokenListener).
// - The phone's native token (or UnifiedPush endpoint) goes only to the organization's server
//   (PUT /api/me/push). Expo's push service is never used: no getExpoPushTokenAsync, and the library's
//   automatic registration with Expo stays off.
// - Tapping a push opens Notifications. A push carries only "You have N new notifications".
// - Android without Firebase: UnifiedPush through the native module SandpiperUnifiedPush
//   (mobile/modules/sandpiper-unifiedpush). The connector shows its pushes itself; a tap, a new endpoint
//   from the distributor and the end of a registration come back as events.
// - Signing out (or being signed out) forgets the choice and the token on the phone; the server drops
//   the registration with the device.
//
// startPush() is called once by the root layout (app/_layout.tsx).
import { requireOptionalNativeModule } from 'expo';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { PUSH_ANDROID_CHANNEL, PUSH_ROUTE, type PushRegistrationInput, type PushStatus } from '../../../shared/push-api.ts';
import { apiFetch } from '../api/client';
import { authStore, onWipe } from '../auth/session';
import { opensNotifications, registerPhone, type Distributor, type RegisterResult, type UnifiedPushConnector } from './registration';
import { pushText } from './text';

const KEY = 'grc.push';
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export type PushState =
  | { status: 'off' }
  | { status: 'working' }
  /** distributor: the UnifiedPush distributor app in use (UnifiedPush only). */
  | { status: 'on'; provider: string; distributor?: Distributor | null }
  | { status: 'unavailable' | 'denied' | 'failed'; message?: string };

let state: PushState = { status: 'off' };
const listeners = new Set<() => void>();
function setState(next: PushState) {
  state = next;
  for (const l of listeners) l();
}
const store = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/** The Account screen's view of push on this phone. */
export const usePushState = (): PushState => useSyncExternalStore(store.subscribe, store.get, store.get);

const wanted = async () => (await SecureStore.getItemAsync(KEY, OPTIONS)) === 'on';
const setWanted = (on: boolean) => (on ? SecureStore.setItemAsync(KEY, 'on', OPTIONS) : SecureStore.deleteItemAsync(KEY, OPTIONS));

/** The UnifiedPush connector, when the app was built with it (a native module; absent in builds without it). */
function unifiedPush(): UnifiedPushConnector | null {
  if (Platform.OS !== 'android') return null;
  return requireOptionalNativeModule<UnifiedPushConnector>('SandpiperUnifiedPush');
}

const deps = (token?: string) => ({
  platform: (Platform.OS === 'ios' ? 'ios' : 'android') as 'ios' | 'android',
  dev: typeof __DEV__ !== 'undefined' && __DEV__,
  status: () => apiFetch<PushStatus>('/api/me/push'),
  register: (input: PushRegistrationInput) => apiFetch<PushStatus>('/api/me/push', { method: 'PUT', body: input }),
  deviceToken: async () => token ?? String((await Notifications.getDevicePushTokenAsync()).data),
  unifiedPush: unifiedPush(),
});

function currentDistributor(): Distributor | null {
  try {
    return unifiedPush()?.currentDistributor?.() ?? null;
  } catch {
    return null;
  }
}

function show(r: RegisterResult) {
  if (r.ok) setState({ status: 'on', provider: r.provider, ...(r.provider === 'unifiedpush' ? { distributor: currentDistributor() } : {}) });
  else if (r.reason === 'no-distributor') setState({ status: 'unavailable', message: pushText.noDistributor });
  else setState({ status: r.reason, message: r.reason === 'unavailable' ? pushText.unavailable : pushText.failed });
}

/** Ends the UnifiedPush registration on the phone (the distributor stops; the server forgets it separately). */
async function unregisterUnifiedPush() {
  await unifiedPush()?.unregister().catch(() => undefined);
}

let registering: Promise<RegisterResult> | null = null;
/** Registers with the server (one attempt at a time). `token`: a new token Apple or Google just gave. */
async function register(token?: string): Promise<RegisterResult> {
  registering ??= (async () => {
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) {
      setState({ status: 'denied', message: pushText.denied });
      return { ok: false, reason: 'unavailable' } as RegisterResult;
    }
    const r = await registerPhone(deps(token));
    show(r);
    return r;
  })().finally(() => {
    registering = null;
  });
  return registering;
}

/**
 * Account > Push notifications > Push app: lets the person choose another UnifiedPush distributor app
 * (the phone's own chooser), then registers again through it.
 */
export async function changeDistributor(): Promise<PushState> {
  const up = unifiedPush();
  if (!up?.pickDistributor) return state;
  const chosen = await up.pickDistributor().catch(() => false);
  if (chosen && (await wanted())) {
    setState({ status: 'working' });
    await register();
  }
  return state;
}

/** Whether this phone could use UnifiedPush (an Android build with the connector). */
export const hasUnifiedPush = () => unifiedPush() !== null;

/** Account > Push notifications. Asks the phone's permission the first time; false when refused. */
export async function setPushEnabled(on: boolean): Promise<PushState> {
  if (!on) {
    await setWanted(false);
    setState({ status: 'off' });
    await unregisterUnifiedPush();
    try {
      await apiFetch('/api/me/push', { method: 'DELETE' });
    } catch {
      // The server forgets it anyway when the phone is signed out; nothing more to do offline.
    }
    return state;
  }
  setState({ status: 'working' });
  const asked = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } });
  if (!asked.granted) {
    setState({ status: 'denied', message: pushText.denied });
    return state;
  }
  await setWanted(true);
  await register();
  return state;
}

function openIfSignedIn() {
  if (authStore.get().status !== 'signed-in') return;
  router.push(PUSH_ROUTE);
}

function openNotifications(response: Notifications.NotificationResponse | null) {
  if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
  if (!opensNotifications(response.notification.request.content.data)) return;
  openIfSignedIn();
}

/** UnifiedPush: taps, a new address from the distributor, and the distributor ending the registration. */
function startUnifiedPush(up: UnifiedPushConnector) {
  const again = async () => {
    if (authStore.get().status === 'signed-in' && (await wanted())) await register();
  };
  up.addListener?.('onOpened', () => openIfSignedIn());
  up.addListener?.('onNewEndpoint', () => void again());
  up.addListener?.('onUnregistered', () => void again());
  try {
    if (up.takeOpened?.()) openIfSignedIn();
  } catch {
    // Not opened from a push.
  }
}

let started = false;

/** Called once at launch: the foreground behavior, the Android channel, taps, token changes and sign-in. */
export function startPush(): void {
  if (started) return;
  started = true;
  // The library's own registration with Expo's servers stays off (it is off unless switched on).
  void Notifications.setAutoServerRegistrationEnabledAsync(false).catch(() => undefined);
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: true }),
  });
  if (Platform.OS === 'android') {
    void Notifications.setNotificationChannelAsync(PUSH_ANDROID_CHANNEL, {
      name: pushText.channelName, description: pushText.channelDescription, importance: Notifications.AndroidImportance.DEFAULT,
    }).catch(() => undefined);
  }
  Notifications.addNotificationResponseReceivedListener(openNotifications);
  // The push that launched the app from closed.
  void Notifications.getLastNotificationResponseAsync().then((r) => {
    openNotifications(r);
    if (r) void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
  }).catch(() => undefined);
  const up = unifiedPush();
  if (up) startUnifiedPush(up);
  Notifications.addPushTokenListener((token) => {
    void (async () => {
      if (authStore.get().status === 'signed-in' && (await wanted())) await register(String(token.data));
    })();
  });
  onWipe(async () => {
    await setWanted(false);
    setState({ status: 'off' });
    await Notifications.setBadgeCountAsync(0).catch(() => false);
    await Notifications.unregisterForNotificationsAsync().catch(() => undefined);
    await unregisterUnifiedPush();
  });
  // After every sign-in and at start while signed in: register again (the server keeps one per phone).
  let last = authStore.get().status;
  const check = async () => {
    if (authStore.get().status !== 'signed-in') return;
    if (await wanted()) await register();
  };
  authStore.subscribe(() => {
    const now = authStore.get().status;
    if (now === 'signed-in' && last !== 'signed-in') void check();
    last = now;
  });
  void check();
}
