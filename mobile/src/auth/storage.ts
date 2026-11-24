// Everything the app keeps between launches, only in the iOS Keychain or the Android Keystore
// (expo-secure-store, readable only while the phone is unlocked and never copied to another device).
// Nothing is written to plain files or AsyncStorage.
import * as SecureStore from 'expo-secure-store';
import type { MobileHello } from '../../../shared/mobile-api.ts';

const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

/** Keys (letters, digits, `.`, `-`, `_` only, as SecureStore requires). */
const KEY = {
  installation: 'grc.installation',
  server: 'grc.server',
  hello: 'grc.hello',
  tokens: 'grc.tokens',
  prefs: 'grc.prefs',
  profile: 'grc.profile',
  // The person's language (E41-07), also kept on their account on the server.
  language: 'grc.language',
} as const;

/** Who is signed in and what they may do: the last `GET /api/mobile/settings`, so the app opens offline. */
export interface StoredProfile {
  user: { id: string; displayName: string; username: string };
  permissions: string[];
  areas: Record<string, boolean>;
  unlock: { required: boolean; afterMinutes: number };
  appName: string;
}

export interface StoredTokens {
  access: string;
  refresh: string;
  /** Epoch milliseconds when the access token lapses. */
  expiresAt: number;
  deviceId: string;
}

export interface Prefs {
  /** The person chose to unlock the app with Face ID, fingerprint or the device credential. */
  unlock: boolean;
}

async function readJson<T>(key: string): Promise<T | null> {
  const raw = await SecureStore.getItemAsync(key, OPTIONS);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function write(key: string, value: unknown): Promise<void> {
  if (value === null || value === undefined) await SecureStore.deleteItemAsync(key, OPTIONS);
  else await SecureStore.setItemAsync(key, typeof value === 'string' ? value : JSON.stringify(value), OPTIONS);
}

export const storage = {
  /** A random identifier made once per installation; tokens are bound to it (MobileAuthorizeQuery). */
  async installationId(makeId: () => string): Promise<string> {
    const found = await SecureStore.getItemAsync(KEY.installation, OPTIONS);
    if (found) return found;
    const id = makeId();
    await write(KEY.installation, id);
    return id;
  },
  server: () => SecureStore.getItemAsync(KEY.server, OPTIONS),
  setServer: (server: string | null) => write(KEY.server, server),
  hello: () => readJson<MobileHello>(KEY.hello),
  setHello: (hello: MobileHello | null) => write(KEY.hello, hello),
  tokens: () => readJson<StoredTokens>(KEY.tokens),
  setTokens: (tokens: StoredTokens | null) => write(KEY.tokens, tokens),
  async prefs(): Promise<Prefs> {
    return { unlock: false, ...(await readJson<Partial<Prefs>>(KEY.prefs)) };
  },
  setPrefs: (prefs: Prefs) => write(KEY.prefs, prefs),
  profile: () => readJson<StoredProfile>(KEY.profile),
  setProfile: (profile: StoredProfile | null) => write(KEY.profile, profile),
  language: () => SecureStore.getItemAsync(KEY.language, OPTIONS),
  setLanguage: (code: string | null) => write(KEY.language, code),
  /**
   * Signing out or a refused refresh: removes tokens, the server's answers and preferences. The typed
   * server address stays (it is remembered, §5.2) and so does the installation identifier.
   */
  async wipe(): Promise<void> {
    await Promise.all([write(KEY.tokens, null), write(KEY.hello, null), write(KEY.prefs, null), write(KEY.profile, null), write(KEY.language, null)]);
  },
  /**
   * A new installation (install.ts, iPhone, where the Keychain outlives the app): removes everything,
   * the installation identifier and the server address too, so the app starts as never used.
   */
  async forgetEverything(): Promise<void> {
    await Promise.all(Object.values(KEY).map((k) => write(k, null)));
  },
};
