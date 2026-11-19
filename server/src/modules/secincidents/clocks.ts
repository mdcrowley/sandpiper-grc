import type { ModuleContext, Row } from '../../core/module.ts';
import { TIME_ZONE } from '../../core/timezone.ts';

// Clock arithmetic shared by the routes, the alert sweep and the incident report.

/** A clock turns amber when this fraction (or less) of its window remains. Setting: security.clock_amber_fraction. */
export const DEFAULT_AMBER_FRACTION = 0.25;

export async function amberFraction(ctx: ModuleContext): Promise<number> {
  const f = Number(await ctx.settings.get('security.clock_amber_fraction', DEFAULT_AMBER_FRACTION));
  return Number.isFinite(f) && f > 0 && f < 1 ? f : DEFAULT_AMBER_FRACTION;
}

/**
 * Clock state for one task. Open: red when overdue, amber when the amber fraction
 * (default one quarter) or less of the window from discovery remains, otherwise green.
 * Done: "met" (with `late` when the notification was after the deadline).
 */
export function clockOf(task: Row, discoveredAt: unknown, now: Date, fraction: number): Row {
  const due = task.due_at ? new Date(task.due_at) : null;
  let state = 'green';
  let seconds: number | null = null;
  let late = false;
  let amberAt: string | null = null;
  if (task.status === 'done') {
    state = 'met';
    late = !!(due && task.notified_at && new Date(task.notified_at).getTime() > due.getTime());
  } else if (task.status === 'not_required') {
    state = 'not_required';
  } else if (due) {
    seconds = Math.floor((due.getTime() - now.getTime()) / 1000);
    const windowSeconds = task.deadline_hours !== null && task.deadline_hours !== undefined
      ? Number(task.deadline_hours) * 3600
      : Math.max(0, (due.getTime() - new Date(discoveredAt as string).getTime()) / 1000);
    state = seconds <= 0 ? 'red' : seconds <= windowSeconds * fraction ? 'amber' : 'green';
    amberAt = new Date(due.getTime() - windowSeconds * fraction * 1000).toISOString();
  }
  return {
    task_id: task.id, ref: task.ref, incident_id: task.incident_id, rule_id: task.rule_id, party: task.party, title: task.title,
    required: task.required, deadline_hours: task.deadline_hours, guidance: task.guidance, due_at: task.due_at, amber_at: amberAt,
    status: task.status, state, seconds_remaining: seconds, overdue: state === 'red', late,
    notified_who: task.notified_who, notified_how: task.notified_how, notified_at: task.notified_at,
    reference_received: task.reference_received, completed_at: task.completed_at, completed_by: task.completed_by,
    completed_by_name: task.completed_by_name ?? null,
  };
}

const ORDER = { red: 0, amber: 1, green: 2, met: 3, not_required: 4 } as Record<string, number>;
const FAR = 8.64e15;
/** Most urgent first: overdue, then close, then the rest by deadline; finished clocks last. */
export const byUrgency = (a: Row, b: Row) =>
  (ORDER[a.state] - ORDER[b.state]) || (new Date(a.due_at ?? FAR).getTime() - new Date(b.due_at ?? FAR).getTime());

const stampFmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TIME_ZONE,
});
/** "18 Nov 2026, 14:05" in the organization's time zone, for text written into the log and notifications. */
export function stamp(value: unknown): string {
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? '' : stampFmt.format(d);
}

/** "2d 4h", "3h 12m", "45m". */
export function duration(seconds: number): string {
  const m = Math.max(0, Math.round(Math.abs(seconds) / 60));
  const d = Math.floor(m / 1440); const h = Math.floor((m % 1440) / 60); const min = m % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${min}m`;
  return `${min}m`;
}
