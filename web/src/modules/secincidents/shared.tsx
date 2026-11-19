import { useEffect, useState } from 'react';
import { formatDuration, Icon, timeZone, useAuth, useFetch } from '../../core';
import type { ColorName, IconName } from '../../core';
import type { Clock, Lifecycle } from './types';

/** Shown only while an administrator has pilot mode switched on (Administration > Settings). */
export function PilotNotice() {
  const { pilot } = useAuth();
  if (!pilot) return null;
  return (
    <div className="notice notice-pilot si-no-print" role="note">
      <Icon name="flask" size={16} />
      <span>Pilot mode: do not record live incident details here yet. Use exercise or invented data only.</span>
    </div>
  );
}

/** The current time, re-read every `intervalMs`. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** The incident lifecycle as the server describes it: statuses with the stage each stands for. */
export function useLifecycle() {
  return useFetch<Lifecycle>('/api/security-incidents/lifecycle');
}

export type ClockState = Clock['state'];

/** The state of a clock at `now`: the server's answer moves on as time passes without a reload. */
export function stateAt(clock: Clock, now: number): ClockState {
  if (clock.status !== 'pending' || !clock.due_at) return clock.state;
  if (new Date(clock.due_at).getTime() <= now) return 'red';
  if (clock.amber_at && new Date(clock.amber_at).getTime() <= now) return 'amber';
  return 'green';
}

export const STATE_COLOR: Record<ClockState, ColorName> = { red: 'red', amber: 'amber', green: 'green', met: 'green', not_required: 'gray' };
export const STATE_ICON: Record<ClockState, IconName> = { red: 'alert', amber: 'clock', green: 'clock', met: 'check-circle', not_required: 'minus' };
export const STATE_WORD: Record<ClockState, string> = { red: 'Overdue', amber: 'Due soon', green: 'On track', met: 'Notified', not_required: 'Not required' };

const ORDER: Record<ClockState, number> = { red: 0, amber: 1, green: 2, met: 3, not_required: 4 };
const FAR = 8.64e15;
/** Most urgent first. */
export function sortClocks(clocks: Clock[], now: number): Clock[] {
  return [...clocks].sort((a, b) =>
    (ORDER[stateAt(a, now)] - ORDER[stateAt(b, now)]) || (new Date(a.due_at ?? FAR).getTime() - new Date(b.due_at ?? FAR).getTime()));
}

/** "2d 4h left", "Overdue by 3h 12m". */
export function remainingText(dueAt: string | null, now: number): string {
  if (!dueAt) return 'No deadline';
  const left = new Date(dueAt).getTime() - now;
  return left <= 0 ? `Overdue by ${formatDuration(-left)}` : `${formatDuration(left)} left`;
}

/** Just the amount: "2d 4h" (time left, or time overdue). */
export function remainingAmount(dueAt: string | null, now: number): string {
  if (!dueAt) return '—';
  return formatDuration(Math.abs(new Date(dueAt).getTime() - now));
}

/** How a finished notification compares with its deadline. */
export function metText(clock: Clock): string {
  if (!clock.due_at || !clock.notified_at) return 'Notified';
  const late = new Date(clock.notified_at).getTime() - new Date(clock.due_at).getTime();
  return late > 0 ? `Notified ${formatDuration(late)} late` : 'Notified in time';
}

const fmt = (options: Intl.DateTimeFormatOptions) => {
  try { return new Intl.DateTimeFormat('en-US', { ...options, timeZone: timeZone() }); } catch { return new Intl.DateTimeFormat('en-US', options); }
};

/** "14:05" in the organization's time zone. */
export function formatTime(value: string | number | Date): string {
  return fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
}

/** "Wednesday 18 November 2026" in the organization's time zone. */
export function formatDay(value: string | number | Date): string {
  return fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(value));
}

/** "2026-11-18" in the organization's time zone: a key to group entries by day. */
export function dayKey(value: string | number | Date): string {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone() }).format(new Date(value)); } catch { return String(value).slice(0, 10); }
}

/** Short name of the organization's time zone for labels, e.g. "Europe/London". */
export const zoneName = (): string => timeZone().replace(/_/g, ' ');
