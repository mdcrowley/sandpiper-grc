// The organization's tag formats for the camera (GET /api/mobile/settings → tags.formats; null while
// the Asset tags area is off). None is assumed: with no formats, codes are taken as they are and text
// is only offered for confirmation (spec §9 decision 3).
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api/client';
import { authStore, onWipe } from '../auth/session';
import { offlinePackage } from '../offline';
import type { MobileSettings } from '../../../shared/mobile-api.ts';
import type { TagFormat } from '../../../shared/tag-format.ts';

export interface TagSettings { on: boolean; formats: TagFormat[] }

let cached: { at: number; value: TagSettings } | null = null;
const FRESH_MS = 5 * 60_000;

export async function loadTagSettings(force = false): Promise<TagSettings> {
  if (!force && cached && Date.now() - cached.at < FRESH_MS) return cached.value;
  let s: MobileSettings;
  try {
    s = await apiFetch<MobileSettings>('/api/mobile/settings');
  } catch (e) {
    // Without a connection, the formats of the offline package (wave 15), not kept as fresh.
    const status = (e as { status?: unknown })?.status;
    const p = typeof status !== 'number' || status === 0 || status >= 500
      ? await offlinePackage().current(authStore.get().profile?.user.id).catch(() => null) : null;
    if (p?.tags) return { on: true, formats: p.tags.formats.filter((f) => f.active) };
    throw e;
  }
  const value: TagSettings = { on: s.tags !== null && s.areas?.tags !== false, formats: (s.tags?.formats ?? []).filter((f) => f.active) };
  cached = { at: Date.now(), value };
  return value;
}

/** Forgets the cached formats (sign-out). */
export function clearTagSettings(): void {
  cached = null;
}

export function useTagSettings(): { settings: TagSettings | null; error: string | null; reload: () => void } {
  const [settings, setSettings] = useState<TagSettings | null>(cached?.value ?? null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback((force = false) => {
    loadTagSettings(force).then((s) => { setSettings(s); setError(null); }, (e: Error) => setError(e.message));
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { settings, error, reload: () => reload(true) };
}

onWipe(clearTagSettings);
