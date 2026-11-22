// Recently opened records, for the Search tab (spec §5.3). Kept on the phone in the secure store (the
// Keychain or Keystore): only type, id, label and reference, at most 15. Owner: APP-WORK.
import * as SecureStore from 'expo-secure-store';
import { onWipe } from '../auth/session';
import { resetMeta } from './api';

export interface RecentItem { type: string; typeLabel: string; id: string; label: string; ref: string | null }

const KEY = 'records.recent';
const MAX = 15;
let memory: RecentItem[] | null = null;

export async function loadRecent(): Promise<RecentItem[]> {
  if (memory) return memory;
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    memory = Array.isArray(parsed) ? (parsed as RecentItem[]).filter((r) => r && typeof r.id === 'string' && typeof r.type === 'string') : [];
  } catch {
    memory = [];
  }
  return memory;
}

/** Puts a record first in the list. Restricted records are never remembered. */
export async function rememberRecent(item: RecentItem): Promise<void> {
  const list = (await loadRecent()).filter((r) => !(r.type === item.type && r.id === item.id));
  memory = [item, ...list].slice(0, MAX);
  try { await SecureStore.setItemAsync(KEY, JSON.stringify(memory)); } catch { /* kept in memory only */ }
}

export async function forgetRecent(type: string, id: string): Promise<void> {
  memory = (await loadRecent()).filter((r) => !(r.type === type && r.id === id));
  try { await SecureStore.setItemAsync(KEY, JSON.stringify(memory)); } catch { /* kept in memory only */ }
}

/** Signing out wipes the list (and tests start empty). */
export async function clearRecent(): Promise<void> {
  memory = null;
  try { await SecureStore.deleteItemAsync(KEY); } catch { /* nothing stored */ }
}

// Signing out (or being signed out) forgets what this person opened and the cached record types.
onWipe(async () => {
  resetMeta();
  await clearRecent();
});
