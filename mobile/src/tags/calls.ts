// Server calls of the tag screens besides the lookup (./lookup.ts): attach, replace, count, notes,
// quick updates and the pickers they need. Everything goes through ../api/client.ts.
import * as WebBrowser from 'expo-web-browser';
import { apiFetch } from '../api/client';
import { accessToken, authStore } from '../auth/session';
import type { CountFoundResult, RecordTags, TagAssignmentView } from '../../../shared/asset-tags-api.ts';
import type { TagSource } from '../../../shared/tag-format.ts';

export interface Option { id: string; label: string; ref?: string | null }

export const attachTag = (recordType: string, recordId: string, value: string, source: TagSource) =>
  apiFetch<TagAssignmentView>('/api/asset-tags/attach', { method: 'POST', body: { recordType, recordId, value, source } });

export const recordTags = (type: string, id: string) =>
  apiFetch<RecordTags>(`/api/asset-tags/record?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`);

export const replaceTag = (assignmentId: string, value: string, source: TagSource, reason: string) =>
  apiFetch<TagAssignmentView>('/api/asset-tags/replace', { method: 'POST', body: { assignmentId, value, source, reason: reason || undefined } });

export const countFound = (countId: string, recordType: string, recordId: string) =>
  apiFetch<CountFoundResult>(`/api/inventory-counts/${encodeURIComponent(countId)}/found`, { method: 'POST', body: { recordType, recordId } });

export const addNote = (recordType: string, recordId: string, body: string) =>
  apiFetch('/api/comments', { method: 'POST', body: { record_type: recordType, record_id: recordId, body } });

export const recordOptions = (type: string, q: string) =>
  apiFetch<Option[]>(`/api/records/lookup?type=${encodeURIComponent(type)}&q=${encodeURIComponent(q)}`);

export const userOptions = (q: string) => apiFetch<Option[]>(`/api/users/options?q=${encodeURIComponent(q)}`);

export async function lookupOptions(list: string): Promise<Option[]> {
  const rows = await apiFetch<{ value: string; label: string; active?: boolean }[]>(`/api/lookups/${encodeURIComponent(list)}`);
  return rows.filter((r) => r.active !== false).map((r) => ({ id: r.value, label: r.label }));
}

let paths: { at: number; map: Record<string, string> } | null = null;

/** A record type's API path (from GET /api/meta), for quick updates. */
export async function apiPathOf(type: string): Promise<string | null> {
  if (!paths || Date.now() - paths.at > 300_000) {
    const meta = await apiFetch<{ resources: Record<string, { path: string }> }>('/api/meta');
    paths = { at: Date.now(), map: Object.fromEntries(Object.entries(meta.resources).map(([k, v]) => [k, v.path])) };
  }
  return paths.map[type] ?? null;
}

/** Saves quick updates with the version the person saw (If-Match); 409 version_conflict when changed meanwhile. */
export async function quickUpdate(type: string, id: string, version: string, patch: Record<string, unknown>): Promise<void> {
  const path = await apiPathOf(type);
  if (!path) throw new Error('This record cannot be changed from the app.');
  await apiFetch(`${path}/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch, ifMatch: version });
}

/** An image source for the record's photo (the download needs the access token). */
export async function photoSource(url: string): Promise<{ uri: string; headers: Record<string, string> } | null> {
  const server = authStore.get().server;
  if (!server) return null;
  // The token goes to the signed-in server only.
  if (/^https?:/i.test(url) && !url.startsWith(`${server.replace(/\/+$/, '')}/`)) return null;
  const token = await accessToken();
  return { uri: /^https?:/i.test(url) ? url : `${server.replace(/\/+$/, '')}${url}`, headers: { Authorization: `Bearer ${token}` } };
}

/** Opens a web page of the signed-in server in the browser sheet (for what the app does not do itself). */
export async function openOnWeb(path: string): Promise<void> {
  const server = authStore.get().server;
  if (!server) return;
  await WebBrowser.openBrowserAsync(`${server.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`);
}
