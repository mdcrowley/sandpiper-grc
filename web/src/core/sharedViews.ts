// Views shared with everyone who can see a list (server: core/views.ts), and views a person saved in
// this browser before saved views followed them (E01-24). Kept apart from listState.ts, which stays
// free of React data hooks so it can be tested on its own.
import { useMemo } from 'react';
import { useFetch } from './hooks';
import { EMPTY_VIEW, loadViews, type SavedView, type View } from './listState';
import { serverPreference, usePreferences } from './preferences';

export interface SharedView {
  id: string;
  name: string;
  view: View;
  createdBy: { id: string; label: string } | null;
  mine: boolean;
  canManage: boolean;
}

/**
 * The views shared on a record type's list. `available` is false when the server has no shared
 * views (an older server), so the list offers none.
 */
export function useSharedViews(type: string, enabled = true): { views: SharedView[]; available: boolean; reload: () => void } {
  type Raw = Omit<SharedView, 'view'> & { view: Partial<View> };
  const { data, error, reload } = useFetch<{ views: Raw[] }>(enabled ? `/api/views?record_type=${encodeURIComponent(type)}` : null);
  // Shared views keep no labels: the filter pills look names up with the viewer's own permissions.
  const views = useMemo(() => (data?.views ?? []).map((v) => ({ ...v, view: { ...EMPTY_VIEW, ...v.view, labels: {} } })), [data]);
  return { views, available: enabled && !error, reload };
}

/**
 * Views saved in this browser before saved views followed the person (E01-24): offered once so they
 * can be kept in the person's account. Empty when the server already holds this list's views, or when
 * the server's preferences have not arrived (or there is no such service).
 */
export function useBrowserOnlyViews(type: string): SavedView[] {
  const store = usePreferences();
  return useMemo(() => {
    if (!store || serverPreference(`views:${type}`) !== undefined) return [];
    return loadViews(type);
  }, [store, type]);
}
