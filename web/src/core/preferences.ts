// Per-user preferences kept on the server (GET/PUT /api/me/preferences[/:key]), so saved views,
// column choices and the Overview layout follow a person from one browser to another.
//
// Everything is read in one request per session and kept here; writes go to the server and to
// localStorage. localStorage is also what draws the first render (no flash while the server
// answers) and what is used when the server has no preferences service.
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';

type Store = Record<string, unknown>;

let loaded: Promise<Store | null> | null = null;
let current: Store | null = null;
let available = true;
const listeners = new Set<() => void>();

/** Every preference of the signed-in person (null when the server has none to give). */
export function loadPreferences(): Promise<Store | null> {
  loaded ??= api.get<Store>('/api/me/preferences').then(
    (all) => { current = all ?? {}; listeners.forEach((l) => l()); return current; },
    (err) => {
      if (err instanceof ApiError && err.status === 404) available = false;
      else loaded = null; // try again later (offline, signed out)
      return null;
    },
  );
  return loaded;
}

/** Forget what was read (sign-out, a different person). */
export function resetPreferences(): void {
  loaded = null;
  current = null;
}

/** The server's value for a key, if it has been read and is set. */
export function serverPreference<T>(key: string): T | undefined {
  return current && key in current ? (current[key] as T) : undefined;
}

/** Store a value on the server (null removes it). Resolves false when it could not be kept there. */
export async function savePreference(key: string, value: unknown): Promise<boolean> {
  if (!available) return false;
  if (current) {
    if (value === null || value === undefined) delete current[key];
    else current[key] = value;
  }
  try {
    await api.put(`/api/me/preferences/${encodeURIComponent(key)}`, { value: value ?? null });
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) available = false;
    return false;
  }
}

/** Re-render when the server's preferences arrive; returns them once they have. */
export function usePreferences(): Store | null {
  const [, bump] = useState(0);
  useEffect(() => {
    const tell = () => bump((n) => n + 1);
    listeners.add(tell);
    void loadPreferences();
    return () => { listeners.delete(tell); };
  }, []);
  return current;
}

/* ---------- localStorage mirror ---------- */

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown): void {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: the choice lasts for this page only.
  }
}

/**
 * A preference kept on the server under `serverKey` and in this browser under `localKey`.
 * The browser's copy shows first; the server's replaces it when it arrives. With `synced` false
 * it is a plain localStorage value.
 */
export function useSyncedPreference<T>(serverKey: string, localKey: string, fallback: T, synced = true): [T, (value: T) => void] {
  const store = usePreferences();
  const [value, setValue] = useState<T>(() => (synced ? serverPreference<T>(serverKey) : undefined) ?? readLocal(localKey, fallback));
  const fromServer = store && synced ? (serverPreference<T>(serverKey) as T | undefined) : undefined;
  const serverJson = fromServer === undefined ? undefined : JSON.stringify(fromServer);
  useEffect(() => {
    if (serverJson === undefined) return;
    setValue(JSON.parse(serverJson) as T);
    writeLocal(localKey, JSON.parse(serverJson));
  }, [serverJson, localKey]);
  useEffect(() => {
    setValue((synced ? serverPreference<T>(serverKey) : undefined) ?? readLocal(localKey, fallback));
    // The fallback is fixed per key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey, localKey]);
  const set = useCallback((next: T) => {
    setValue(next);
    writeLocal(localKey, next);
    if (synced) void savePreference(serverKey, next);
  }, [serverKey, localKey, synced]);
  return [value, set];
}
