import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Row } from './api';
import { useResource } from './meta';

export interface FetchState<T> {
  data: T | undefined;
  /** True while a request is in flight. Earlier data stays available during a reload. */
  loading: boolean;
  error: unknown;
  reload: () => void;
}

export interface FetchOptions {
  /**
   * Keep showing the last result while a *different* URL loads (lists: the table stays in
   * place between pages and filters instead of flashing a skeleton). `loading` is true meanwhile.
   */
  keepPrevious?: boolean;
}

/** GET a URL and keep the result. Pass `null` to skip the request. Refetches when the URL changes. */
export function useFetch<T = unknown>(url: string | null, options: FetchOptions = {}): FetchState<T> {
  const keep = Boolean(options.keepPrevious);
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean; url: string | null }>({
    loading: url !== null,
    url,
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (url === null) {
      setState({ loading: false, url });
      return;
    }
    let stale = false;
    setState((s) => ({ data: s.url === url || (keep && s.url !== null) ? s.data : undefined, loading: true, url }));
    api.get<T>(url).then(
      (data) => { if (!stale) setState({ data, loading: false, url }); },
      (error: unknown) => { if (!stale) setState((s) => ({ data: keep ? s.data : undefined, error, loading: false, url })); },
    );
    return () => { stale = true; };
  }, [url, tick, keep]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const current = state.url === url;
  return {
    data: current || (keep && url !== null) ? state.data : undefined,
    loading: state.loading || !current,
    error: current ? state.error : undefined,
    reload,
  };
}

export interface RecordState {
  row: Row | undefined;
  loading: boolean;
  error: unknown;
  reload: () => void;
  /** PATCH the record and keep the returned row. Rejects with ApiError. */
  save: (patch: Record<string, unknown>) => Promise<Row>;
}

/** Load one record of a registered resource type. */
export function useRecord(type: string, id: string | undefined): RecordState {
  const resource = useResource(type);
  const url = resource && id ? `${resource.path}/${id}` : null;
  const { data, loading, error, reload } = useFetch<Row>(url);
  const [saved, setSaved] = useState<{ url: string; row: Row } | null>(null);

  // A fresh load always wins over an earlier save result.
  useEffect(() => setSaved(null), [data]);

  const save = useCallback(async (patch: Record<string, unknown>) => {
    if (!url) throw new Error(`Unknown record type "${type}"`);
    const row = await api.patch<Row>(url, patch);
    setSaved({ url, row });
    return row;
  }, [url, type]);

  const row = saved && saved.url === url ? saved.row : data;
  const unknownType = !resource ? new Error(`Unknown record type "${type}"`) : undefined;
  return { row, loading, error: error ?? unknownType, reload, save };
}

/** The value, delayed until it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** Calls `onAway` on a pointer press outside the element or on Escape, while `active`. */
export function useDismiss<T extends HTMLElement>(active: boolean, onAway: () => void) {
  const ref = useRef<T>(null);
  const handler = useRef(onAway);
  handler.current = onAway;
  useEffect(() => {
    if (!active) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) handler.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault(); // keep an enclosing dialog open
        handler.current();
      }
    };
    document.addEventListener('pointerdown', onDown);
    ref.current?.addEventListener('keydown', onKey);
    const el = ref.current;
    return () => {
      document.removeEventListener('pointerdown', onDown);
      el?.removeEventListener('keydown', onKey);
    };
  }, [active]);
  return ref;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
