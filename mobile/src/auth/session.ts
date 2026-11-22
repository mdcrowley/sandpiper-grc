// The signed-in session (spec §5.2, E38-03): connecting, signing in through the system browser with
// PKCE, tokens and their rotation, the unlock and signing out. One store for the whole app; screens see
// it only through ../api/client.ts (useSession, apiFetch, confirmIdentity).
import Constants from 'expo-constants';
import * as ExpoCrypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as LocalAuthentication from 'expo-local-authentication';
import * as WebBrowser from 'expo-web-browser';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import type { MobileHello, MobileSettings, MobileTokenResponse } from '../../../shared/mobile-api.ts';
import {
  authorizeUrl, exchangeCode, makePkce, parseRedirect, refreshTokens, revokeToken, TokenError, type Crypto, type DeviceInfo,
} from './oauth';
import { checkServer, ConnectError, normalizeServer } from './server';
import { storage, type Prefs, type StoredProfile, type StoredTokens } from './storage';
import { shouldLock } from './unlock';

/** Why the app is on the connect screen with a message: the server ended the session, or it was refused. */
export type SignedOutReason = 'refresh_failed' | 'switched_off' | null;

export interface AuthState {
  status: 'loading' | 'signed-out' | 'signed-in';
  /** The remembered server address (also while signed out, to fill the connect screen). */
  server: string | null;
  hello: MobileHello | null;
  profile: StoredProfile | null;
  deviceId: string | null;
  prefs: Prefs;
  /** The unlock is on: the person must unlock with Face ID, fingerprint or the device credential. */
  locked: boolean;
  /** A newer app is recommended by the server (§5.9). */
  updateSuggested: boolean;
  signedOutReason: SignedOutReason;
}

const INITIAL: AuthState = {
  status: 'loading', server: null, hello: null, profile: null, deviceId: null, prefs: { unlock: false },
  locked: false, updateSuggested: false, signedOutReason: null,
};

let state: AuthState = INITIAL;
let tokens: StoredTokens | null = null;
const listeners = new Set<() => void>();
const wipeHooks = new Set<() => Promise<void> | void>();
const unsentCounters = new Set<() => Promise<number> | number>();
let backgroundAt: number | null = null;

function set(patch: Partial<AuthState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export const authStore = {
  get: (): AuthState => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

// ---------- the phone ----------

/** Plain HTTP (for a server on the developer's computer) only in development builds. */
export const allowHttp = (): boolean => typeof __DEV__ !== 'undefined' && __DEV__;

export const appVersion = (): string => Constants.expoConfig?.version ?? '0.0.0';

const crypto: Crypto = {
  randomBytes: (n) => ExpoCrypto.getRandomBytes(n),
  async sha256(text) {
    const hex = await ExpoCrypto.digestStringAsync(ExpoCrypto.CryptoDigestAlgorithm.SHA256, text, { encoding: ExpoCrypto.CryptoEncoding.HEX });
    return Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));
  },
};

async function deviceInfo(): Promise<DeviceInfo> {
  return {
    installationId: await storage.installationId(() => ExpoCrypto.randomUUID()),
    deviceName: (Device.deviceName || Device.modelName || (Platform.OS === 'ios' ? 'iPhone' : 'Android phone')).slice(0, 80),
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    appVersion: appVersion(),
  };
}

// ---------- extension points ----------

/** Other parts of the app register what to remove when local data is wiped (caches, photos, the outbox). */
export function onWipe(hook: () => Promise<void> | void): () => void {
  wipeHooks.add(hook);
  return () => wipeHooks.delete(hook);
}

/** The outbox (wave 15) registers how many items are not sent yet, so signing out can warn first. */
export function registerUnsentWork(count: () => Promise<number> | number): () => void {
  unsentCounters.add(count);
  return () => unsentCounters.delete(count);
}

export async function unsentWorkCount(): Promise<number> {
  let total = 0;
  for (const c of unsentCounters) total += await c();
  return total;
}

// ---------- start ----------

let started = false;

/** Reads what was stored at the last launch. Called once by the root layout. */
export async function start(): Promise<void> {
  if (started) return;
  started = true;
  AppState.addEventListener('change', onAppState);
  const [server, hello, stored, profile, prefs] = await Promise.all([
    storage.server(), storage.hello(), storage.tokens(), storage.profile(), storage.prefs(),
  ]);
  tokens = stored;
  if (!server || !hello || !stored || !profile) {
    set({ status: 'signed-out', server, prefs });
    return;
  }
  const locked = shouldLock({ prefs, profile, backgroundAt: null, now: Date.now(), coldStart: true });
  set({ status: 'signed-in', server, hello, profile, deviceId: stored.deviceId, prefs, locked });
  void refreshProfile();
}

function onAppState(next: AppStateStatus): void {
  if (state.status !== 'signed-in') return;
  if (next === 'background') {
    backgroundAt = Date.now();
    return;
  }
  if (next === 'active') {
    if (!state.locked && shouldLock({ prefs: state.prefs, profile: state.profile, backgroundAt, now: Date.now(), coldStart: false })) {
      set({ locked: true });
    }
    backgroundAt = null;
    void refreshProfile();
  }
}

// ---------- connect and sign in ----------

/** Checks the typed address (GET /api/mobile/hello) and remembers it. Throws ConnectError. */
export async function connect(typed: string): Promise<{ server: string; hello: MobileHello; updateSuggested: boolean }> {
  const server = normalizeServer(typed, allowHttp());
  const { hello, updateSuggested } = await checkServer(server, appVersion());
  await storage.setServer(server);
  set({ server, hello, updateSuggested, signedOutReason: null });
  return { server, hello, updateSuggested };
}

export type SignInResult = { ok: true } | { ok: false; reason: 'canceled' | 'refused' | 'failed'; message?: string };

async function browserSignIn(hello: MobileHello, promptLogin: boolean): Promise<{ result: SignInResult; tokens?: MobileTokenResponse }> {
  const device = await deviceInfo();
  const pkce = await makePkce(crypto);
  const url = authorizeUrl(hello, pkce, device, { promptLogin });
  // ASWebAuthenticationSession on iOS, Custom Tabs on Android: the person signs in on the server's own page.
  const answer = await WebBrowser.openAuthSessionAsync(url, hello.oauth.redirectUri, { preferEphemeralSession: promptLogin });
  if (answer.type !== 'success') return { result: { ok: false, reason: 'canceled' } };
  const redirect = parseRedirect(answer.url, pkce.state);
  if (!redirect.ok) {
    if (redirect.error === 'access_denied') return { result: { ok: false, reason: 'canceled' } };
    return { result: { ok: false, reason: 'refused', message: redirect.description ?? redirect.error } };
  }
  try {
    const t = await exchangeCode(hello, redirect.code, pkce.verifier, device.installationId);
    return { result: { ok: true }, tokens: t };
  } catch (e) {
    const message = e instanceof TokenError ? e.message : undefined;
    return { result: { ok: false, reason: e instanceof TokenError && e.status > 0 ? 'refused' : 'failed', message } };
  }
}

async function keepTokens(t: MobileTokenResponse): Promise<void> {
  tokens = { access: t.access_token, refresh: t.refresh_token, expiresAt: Date.now() + t.expires_in * 1000, deviceId: t.device_id };
  await storage.setTokens(tokens);
}

/** Opens the server's sign-in page in the system browser sheet and keeps the tokens it gives. */
export async function signIn(): Promise<SignInResult> {
  const hello = state.hello;
  if (!hello) return { ok: false, reason: 'failed', message: 'not_connected' };
  const { result, tokens: t } = await browserSignIn(hello, false);
  if (!result.ok || !t) return result;
  await keepTokens(t);
  try {
    await refreshProfile(true);
  } catch {
    await wipeLocal(null);
    return { ok: false, reason: 'failed' };
  }
  await storage.setHello(hello);
  set({ status: 'signed-in', deviceId: t.device_id, locked: false, signedOutReason: null });
  return { ok: true };
}

/**
 * A sensitive action asked for a fresh sign-in (403 `reauth_required`): signs in again with
 * `prompt=login`. The new tokens carry the recent sign-in, so the retried request is accepted.
 * False when the person cancels.
 */
export async function confirmIdentity(): Promise<boolean> {
  const hello = state.hello;
  if (!hello || state.status !== 'signed-in') return false;
  const { result, tokens: t } = await browserSignIn(hello, true);
  if (!result.ok || !t) return false;
  await keepTokens(t);
  set({ deviceId: t.device_id });
  return true;
}

// ---------- tokens ----------

let refreshing: Promise<string> | null = null;

/** Thrown to apiFetch when there is no usable session (the app is then on the connect screen). */
export class SessionEnded extends Error {
  constructor(public offline = false) {
    super(offline ? 'offline' : 'signed_out');
    this.name = 'SessionEnded';
  }
}

/** How soon a refresh lost to the network is tried again (same refresh token: the server allows a repeat). */
export const REFRESH_RETRY_MS = 1500;

const isTransient = (e: unknown) => e instanceof TokenError && (e.error === 'network' || e.status === 0 || e.status >= 500);

async function doRefresh(): Promise<string> {
  const hello = state.hello;
  if (!tokens || !hello) throw new SessionEnded();
  const installationId = await storage.installationId(() => ExpoCrypto.randomUUID());
  const used = tokens.refresh;
  const attempt = () => refreshTokens(hello.oauth.tokenEndpoint, hello.oauth.clientId, used, installationId);
  try {
    let t: MobileTokenResponse;
    try {
      t = await attempt();
    } catch (e) {
      // The answer may have been lost on the way back: repeat the same refresh once, promptly (the
      // server accepts the same refresh token again for a short time).
      if (!isTransient(e)) throw e;
      await new Promise((r) => setTimeout(r, REFRESH_RETRY_MS));
      t = await attempt();
    }
    await keepTokens(t);
    return t.access_token;
  } catch (e) {
    // A newer pair was stored meanwhile (a sign-in again): keep it and carry on with it.
    if (tokens && tokens.refresh !== used) return tokens.access;
    // Offline, the server failing, or too many token requests (429): try again later, still signed in.
    if (isTransient(e) || (e instanceof TokenError && e.status === 429)) throw new SessionEnded(true);
    // invalid_grant (revoked, reused, lapsed), switched_off, unknown client: the session is over.
    await wipeLocal(e instanceof TokenError && e.error === 'switched_off' ? 'switched_off' : 'refresh_failed');
    throw new SessionEnded();
  }
}

/**
 * A valid access token, refreshed when about to lapse. Only one refresh is ever in flight: every
 * request that needs one waits for it. `staleAccess` (the token a 401 refused) forces a refresh unless the token
 * that was refused has already been replaced, in which case the newer one is returned.
 */
export async function accessToken(force = false, staleAccess?: string): Promise<string> {
  if (!tokens) throw new SessionEnded();
  if (force && staleAccess !== undefined && tokens.access !== staleAccess && !refreshing) return tokens.access;
  if (!force && tokens.expiresAt - 30_000 > Date.now() && !refreshing) return tokens.access;
  refreshing ??= doRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

// ---------- profile (GET /api/mobile/settings) ----------

/** Plugged in by client.ts so the session can call the server with the same handling as screens. */
let settingsLoader: (() => Promise<MobileSettings>) | null = null;
export function setSettingsLoader(loader: () => Promise<MobileSettings>): void {
  settingsLoader = loader;
}

export async function refreshProfile(strict = false): Promise<void> {
  if (!settingsLoader) return;
  try {
    const s = await settingsLoader();
    const profile: StoredProfile = {
      user: s.user, permissions: s.permissions, areas: s.areas, unlock: s.unlock, appName: s.server.appName,
    };
    await storage.setProfile(profile);
    set({ profile });
  } catch (e) {
    if (strict) throw e;
  }
}

// ---------- unlock ----------

/** Asks for Face ID, fingerprint or the device credential. True when unlocked. */
export async function unlock(promptMessage: string): Promise<boolean> {
  const has = await LocalAuthentication.hasHardwareAsync().catch(() => false);
  const enrolled = has && (await LocalAuthentication.isEnrolledAsync().catch(() => false));
  const level = await LocalAuthentication.getEnrolledLevelAsync().catch(() => LocalAuthentication.SecurityLevel.NONE);
  if (!enrolled && level === LocalAuthentication.SecurityLevel.NONE) {
    // Nothing set up on the phone: the unlock cannot be asked, so the app stays usable (the Account screen says so).
    set({ locked: false });
    return true;
  }
  const r = await LocalAuthentication.authenticateAsync({ promptMessage, disableDeviceFallback: false });
  if (r.success) set({ locked: false });
  return r.success;
}

/** Whether the phone can ask for an unlock (a biometric or a device credential is set up). */
export async function unlockAvailable(): Promise<boolean> {
  const level = await LocalAuthentication.getEnrolledLevelAsync().catch(() => LocalAuthentication.SecurityLevel.NONE);
  return level !== LocalAuthentication.SecurityLevel.NONE;
}

export async function setUnlockPreference(on: boolean): Promise<void> {
  const prefs = { ...state.prefs, unlock: on };
  await storage.setPrefs(prefs);
  set({ prefs });
}

// ---------- sign out ----------

async function wipeLocal(reason: SignedOutReason): Promise<void> {
  tokens = null;
  await storage.wipe();
  for (const hook of wipeHooks) {
    try {
      await hook();
    } catch {
      // A hook that fails must not keep the person signed in.
    }
  }
  set({ ...INITIAL, status: 'signed-out', server: state.server, signedOutReason: reason });
}

/** Signs this device out on the server (best effort) and wipes local data. Ask about unsent work first. */
export async function signOut(): Promise<void> {
  const hello = state.hello;
  const refresh = tokens?.refresh;
  await wipeLocal(null);
  if (hello && refresh) await revokeToken(hello.oauth.revocationEndpoint, hello.oauth.clientId, refresh);
}

/** The server said the device is no longer signed in (a 401 that a refresh did not cure). */
export async function sessionRefused(): Promise<void> {
  await wipeLocal('refresh_failed');
}

export { ConnectError };
