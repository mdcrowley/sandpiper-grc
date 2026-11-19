// Notification types and the shared unread count.
//
// The count is polled politely: once a minute, and only while the tab is visible and the
// person has used the application in the last five minutes. Pausing when idle matters for
// more than politeness: a background request would otherwise keep the session alive and
// defeat the idle time-out.
import { useEffect, useSyncExternalStore } from 'react';
import { api } from '../../core';

export interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  /** In-app path to open, or null when there is nowhere to go. */
  route: string | null;
  record_type: string | null;
  record_id: string | null;
  created_at: string;
  read_at: string | null;
  /** True when the record it was about can no longer be opened by this person. */
  unavailable: boolean;
}

export interface NotificationPage {
  rows: Notification[];
  total: number;
  page: number;
  pageSize: number;
  unread: number;
}

const POLL_MS = 60_000;
const IDLE_MS = 5 * 60_000;

let unread = 0;
let users = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let lastFetch = 0;
let lastActivity = Date.now();
const listeners = new Set<() => void>();

/** Sets the count from any response that carries it (list, mark read). */
export function setUnread(next: number): void {
  if (next === unread) return;
  unread = next;
  for (const l of listeners) l();
}

/** Asks the server for the count now. Failures are silent: the bell simply keeps its last value. */
export async function refreshUnread(): Promise<void> {
  lastFetch = Date.now();
  try {
    setUnread((await api.get<{ unread: number }>('/api/notifications/unread-count')).unread);
  } catch {
    // A 401 is handled by the api client (it re-checks the session); anything else can wait a minute.
  }
}

const active = () => document.visibilityState === 'visible' && Date.now() - lastActivity < IDLE_MS;
const stale = () => Date.now() - lastFetch >= POLL_MS;

function onVisible() {
  if (document.visibilityState === 'visible' && active() && stale()) void refreshUnread();
}
function onActivity() {
  const wasIdle = Date.now() - lastActivity >= IDLE_MS;
  lastActivity = Date.now();
  if (wasIdle && stale()) void refreshUnread();
}

function start() {
  lastActivity = Date.now();
  void refreshUnread();
  timer = setInterval(() => { if (active()) void refreshUnread(); }, POLL_MS);
  document.addEventListener('visibilitychange', onVisible);
  document.addEventListener('pointerdown', onActivity, { passive: true });
  document.addEventListener('keydown', onActivity, { passive: true });
}
function stop() {
  clearInterval(timer);
  timer = undefined;
  document.removeEventListener('visibilitychange', onVisible);
  document.removeEventListener('pointerdown', onActivity);
  document.removeEventListener('keydown', onActivity);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** The unread count, kept fresh while at least one component is using it. */
export function useUnreadCount(): number {
  useEffect(() => {
    users += 1;
    if (users === 1) start();
    return () => {
      users -= 1;
      if (users === 0) stop();
    };
  }, []);
  return useSyncExternalStore(subscribe, () => unread);
}

export const markRead = async (id: string) => {
  setUnread((await api.post<{ unread: number }>(`/api/notifications/${id}/read`)).unread);
};

export const markAllRead = async () => {
  setUnread((await api.post<{ unread: number }>('/api/notifications/read-all')).unread);
};
