// Offline work in the app (wave 14, E38-10; spec §5.6). The one outbox and the one offline package of
// the app, started once by the session (auth/session.ts `start`), and the hooks screens use.
//
// While signed in: the outbox is sent and the package refreshed when the app starts, when it comes
// back to the front, when the network comes back (expo-network), and every 30 seconds while open; an
// expired package is deleted when noticed. Signing out, or being signed out (a refused refresh, the
// device signed out on the web, the account deactivated), deletes the database and every kept file.
//
// - types.ts: the item and store shapes; kinds.ts: kinds of work (the extension point)
// - outbox.ts: ordering, retries, Needs attention; package.ts: the package and its expiry
// - sqlite.ts: storage in the app's protected folder; transport.ts: the server routes
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as Network from 'expo-network';
import type { MobilePackage } from '../../../shared/mobile-api.ts';
import { authStore, onWipe, registerUnsentWork } from '../auth/session';
import { Outbox } from './outbox';
import { PackageCache } from './package';
import { sqliteDrafts, sqliteOutbox, sqlitePackage, wipeOfflineStorage, type DraftStore } from './sqlite';
import { fetchPackage, serverTransport } from './transport';
import type { OutboxItem } from './types';

export { defineOutboxKind } from './kinds';
export { packageList, packageSites } from './package';
export type { OutboxItem } from './types';
export type { DraftStore } from './sqlite';

/** Field work in progress kept on the phone (an inspection half done, the counts joined): wiped with the rest. */
export const drafts = (): DraftStore => sqliteDrafts;

/** How often the outbox is tried while the app is open. */
export const TICK_MS = 30_000;

/** Whether the phone has a connection at all (a failed check counts as connected: the send decides). */
export async function online(): Promise<boolean> {
  try {
    const s = await Network.getNetworkStateAsync();
    return s.isConnected !== false && s.isInternetReachable !== false;
  } catch {
    return true;
  }
}

let box: Outbox | null = null;
let pkg: PackageCache | null = null;

export function outbox(): Outbox {
  box ??= new Outbox(sqliteOutbox, serverTransport, { newId: () => Crypto.randomUUID(), online });
  return box;
}

export function offlinePackage(): PackageCache {
  pkg ??= new PackageCache(sqlitePackage, fetchPackage);
  return pkg;
}

/** Deletes everything offline work kept on the phone (also what was never loaded in this run). */
export async function wipeOffline(): Promise<void> {
  const b = box;
  const p = pkg;
  box = null;
  pkg = null;
  try { await p?.clear(); } catch { /* the database goes anyway */ }
  try { await b?.wipe(); } catch { /* the database goes anyway */ }
  await wipeOfflineStorage();
}

let booted = false;
let stopWork: (() => void) | null = null;

function startWork(): () => void {
  const tick = () => {
    const userId = authStore.get().profile?.user.id;
    void outbox().process().then(() => outbox().prune()).catch(() => undefined);
    void offlinePackage().refreshIfStale(userId).catch(() => undefined);
  };
  tick();
  const timer = setInterval(tick, TICK_MS);
  const app = AppState.addEventListener('change', (s) => { if (s === 'active') tick(); });
  let net: { remove(): void } | null = null;
  try { net = Network.addNetworkStateListener((s) => { if (s.isConnected) tick(); }); } catch { net = null; }
  return () => { clearInterval(timer); app.remove(); net?.remove(); };
}

/** Called once by the session at start: registers the wipe and the unsent count, and starts the work while signed in. */
export function bootOffline(): void {
  if (booted) return;
  booted = true;
  onWipe(wipeOffline);
  registerUnsentWork(() => outbox().unsent());
  const react = () => {
    const signedIn = authStore.get().status === 'signed-in';
    if (signedIn && !stopWork) stopWork = startWork();
    else if (!signedIn && stopWork) { stopWork(); stopWork = null; }
  };
  authStore.subscribe(react);
  react();
}

/** Sends now (after saving work, or when the person asks). */
export function sendNow(): void {
  void outbox().process().catch(() => undefined);
}

/**
 * Asks the server, and when it cannot be reached (or refuses) answers from the offline package instead.
 * Throws the server's error when the package has nothing either.
 */
export async function orOffline<T>(fromServer: () => Promise<T>, fromPackage: (p: MobilePackage) => T | null | undefined): Promise<T> {
  try {
    return await fromServer();
  } catch (e) {
    const p = await offlinePackage().current(authStore.get().profile?.user.id).catch(() => null);
    const v = p ? fromPackage(p) : null;
    if (v !== null && v !== undefined) return v;
    throw e;
  }
}

/** The outbox's items, for screens. */
export function useOutbox(): OutboxItem[] {
  const [items, setItems] = useState<OutboxItem[]>([]);
  useEffect(() => outbox().subscribe(setItems), []);
  return items;
}

/** The offline package (null when there is none or it expired), for screens. */
export function useOfflinePackage(): MobilePackage | null {
  const [p, setP] = useState<MobilePackage | null>(null);
  useEffect(() => offlinePackage().subscribe(setP), []);
  return p;
}
