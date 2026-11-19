// Data helpers for the reporting screens.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, formatCurrency, formatNumber, useFetch } from '../../core';
import type { CatalogueType, ResultColumn, ResultRow } from './types';

export function useCatalogue() {
  const state = useFetch<{ types: CatalogueType[] }>('/api/reports/catalogue');
  return { ...state, types: state.data?.types };
}

export interface PostState<T> { data: T | undefined; loading: boolean; error: unknown; reload: () => void }

/**
 * POSTs `body` to `url` and keeps the answer; asks again whenever the body changes (compared as
 * JSON) or `tick` changes. The last answer stays on screen while the next one loads, so a live
 * preview never flashes empty. `null` skips the request.
 */
export function usePost<T>(url: string, body: unknown | null, tick = 0): PostState<T> {
  const key = body === null ? null : JSON.stringify(body);
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({ loading: key !== null });
  const [again, setAgain] = useState(0);
  const latest = useRef(0);
  useEffect(() => {
    if (key === null) { setState({ loading: false }); return; }
    const mine = ++latest.current;
    setState((s) => ({ data: s.data, loading: true }));
    api.post<T>(url, JSON.parse(key)).then(
      (data) => { if (latest.current === mine) setState({ data, loading: false }); },
      (error: unknown) => { if (latest.current === mine) setState({ error, loading: false }); },
    );
  }, [url, key, tick, again]);
  const reload = useCallback(() => setAgain((n) => n + 1), []);
  return { data: state.data, loading: state.loading, error: state.error, reload };
}

async function blobOf(method: 'GET' | 'POST', url: string, body?: unknown): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(url, {
      method, credentials: 'same-origin',
      headers: { ...(method === 'POST' ? { 'X-GRC-CSRF': '1', 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', 'The server could not be reached. Check that it is running and try again.');
  }
  if (!res.ok) {
    let error: { code?: string; message?: string } = {};
    try { error = (await res.json()).error ?? {}; } catch { /* not JSON */ }
    throw new ApiError(res.status, error.code ?? `http_${res.status}`, error.message ?? `The request failed (${res.status}).`);
  }
  return res.blob();
}

/** Saves a server export as a file. */
export async function downloadFile(name: string, method: 'GET' | 'POST', url: string, body?: unknown): Promise<void> {
  const href = URL.createObjectURL(await blobOf(method, url, body));
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/** Opens a print-ready document in a new tab (the browser's Print command saves it as a PDF). */
export async function openDocument(method: 'GET' | 'POST', url: string, body?: unknown): Promise<void> {
  // Opened before the request so that the browser treats it as the result of the click.
  const tab = window.open('', '_blank');
  try {
    const href = URL.createObjectURL(await blobOf(method, url, body));
    if (tab) tab.location.href = href; else window.location.href = href;
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
  } catch (err) {
    tab?.close();
    throw err;
  }
}

export const fileName = (name: string, ext: string) => `${name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60) || 'report'}.${ext}`;

/** A number as people read it, by what it measures. */
export function formatValue(v: unknown, col?: Pick<ResultColumn, 'type' | 'fn'>): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') {
    if (col?.fn === 'pct') return `${formatNumber(v)}%`;
    if (col?.type === 'currency' && col.fn !== 'count') return formatCurrency(v);
    return formatNumber(v);
  }
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

export function cellText(col: ResultColumn, row: ResultRow): string {
  return row.d[col.key] ?? formatValue(row.v[col.key], col);
}

/** Large figures in a tile: 1,234 stays, 1,234,567 becomes 1.2M. */
export function compact(v: number, currency = false): string {
  if (Math.abs(v) < 100000) return currency ? formatCurrency(v) : formatNumber(v);
  const short = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
  return currency ? formatCurrency(0).replace(/[\d.,\s]+/, short) : short;
}
