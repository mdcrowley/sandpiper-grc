// Shared hooks of the record screens. Owner: APP-WORK.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { errorText, loadMeta } from './api';
import type { Meta } from './types';

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Loads again; `quiet` keeps the current data on screen while it does (pull to refresh). */
  reload: (quiet?: boolean) => Promise<void>;
  /** True while a quiet reload runs. */
  refreshing: boolean;
  setData: (d: T | null) => void;
}

/** Runs `load` once at start and whenever `reload` is called; keeps the last good answer on errors. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = [], options: { auto?: boolean } = {}): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(options.auto !== false);
  const [refreshing, setRefreshing] = useState(false);
  const live = useRef(true);
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);

  const reload = useCallback(async (quiet = false) => {
    const mine = ++seq.current;
    if (quiet) setRefreshing(true); else setLoading(true);
    try {
      const d = await run();
      if (live.current && mine === seq.current) { setData(d); setError(null); }
    } catch (err) {
      if (live.current && mine === seq.current) setError(errorText(err));
    } finally {
      if (live.current && mine === seq.current) { setLoading(false); setRefreshing(false); }
    }
  }, [run]);

  useEffect(() => {
    live.current = true;
    if (options.auto !== false) void reload();
    return () => { live.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  return { data, error, loading, reload, refreshing, setData };
}

/** The record types the person may view (GET /api/meta, cached). */
export function useMeta(): { meta: Meta | null; error: string | null } {
  const { data, error } = useLoad(() => loadMeta(), []);
  return { meta: data, error };
}

/** Calls `fn` when the app comes back to the foreground. */
export function useOnForeground(fn: () => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    let state = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      if (state !== 'active' && next === 'active') ref.current();
      state = next;
    });
    return () => sub?.remove?.();
  }, []);
}
