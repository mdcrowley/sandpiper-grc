/**
 * Pure service-level maths: working time in a calendar's own time zone.
 * No database access here, so everything is unit-testable.
 */

export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export interface CalendarDef {
  timezone: string;
  /** 24 by 7: every minute counts and holidays are ignored. */
  always_open: boolean;
  /** Opening hours per weekday as ["HH:MM", "HH:MM"]; missing or null = closed. */
  hours: Partial<Record<DayKey, [string, string] | null>>;
  /** Closed days as YYYY-MM-DD in the calendar's time zone. */
  holidays: string[];
}

const MIN = 60_000;
const MAX_DAYS = 3660;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

interface LocalParts { y: number; m: number; d: number; hh: number; mm: number; ss: number }

/** Wall-clock parts of an instant in a time zone. */
export function localParts(tz: string, utcMs: number): LocalParts {
  const out: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(new Date(utcMs))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return { y: out.year, m: out.month, d: out.day, hh: out.hour % 24, mm: out.minute, ss: out.second };
}

function offsetMs(tz: string, utcMs: number): number {
  const whole = Math.floor(utcMs / 1000) * 1000;
  const p = localParts(tz, whole);
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - whole;
}

/** The instant at which the wall clock in `tz` reads the given date and minutes after midnight. */
export function zonedToUtc(tz: string, y: number, m: number, d: number, minutes: number): number {
  const local = Date.UTC(y, m - 1, d, 0, minutes);
  let utc = local - offsetMs(tz, local);
  utc = local - offsetMs(tz, utc); // second pass settles days on which the clocks change
  return utc;
}

function parseHm(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim());
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Opening window (as instants) for one local calendar day, or null when closed. */
function windowFor(cal: CalendarDef, holidays: Set<string>, y: number, m: number, d: number): [number, number] | null {
  const noon = new Date(Date.UTC(y, m - 1, d, 12));
  // Normalise overflow such as day 32.
  const yy = noon.getUTCFullYear(), mo = noon.getUTCMonth() + 1, dd = noon.getUTCDate();
  if (holidays.has(`${yy}-${pad(mo)}-${pad(dd)}`)) return null;
  const hours = cal.hours?.[DAY_KEYS[noon.getUTCDay()]];
  if (!hours) return null;
  const start = parseHm(hours[0]);
  const end = parseHm(hours[1]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return [zonedToUtc(cal.timezone, yy, mo, dd, start), zonedToUtc(cal.timezone, yy, mo, dd, end)];
}

/** True when the calendar has at least one working day in a week (ignoring holidays). */
export function hasWorkingTime(cal: CalendarDef): boolean {
  if (cal.always_open) return true;
  return DAY_KEYS.some((k) => {
    const h = cal.hours?.[k];
    return !!h && parseHm(h[1]) > parseHm(h[0]);
  });
}

/**
 * The instant reached after `minutes` of working time from `from`.
 * A due time that lands exactly on closing time stays there (it does not roll to the next morning).
 */
export function addWorkingMinutes(cal: CalendarDef, from: Date, minutes: number): Date {
  if (!(minutes > 0)) return new Date(from.getTime());
  if (cal.always_open || !hasWorkingTime(cal)) return new Date(from.getTime() + minutes * MIN);
  const holidays = new Set(cal.holidays ?? []);
  const start = from.getTime();
  const p = localParts(cal.timezone, start);
  let remaining = minutes * MIN;
  // Start one day early: a window opened on the previous local day cannot extend past midnight,
  // but this keeps the walk safe for any time-zone edge.
  for (let i = -1; i < MAX_DAYS; i++) {
    const w = windowFor(cal, holidays, p.y, p.m, p.d + i);
    if (!w) continue;
    const cursor = Math.max(start, w[0]);
    if (cursor >= w[1]) continue;
    const available = w[1] - cursor;
    if (remaining <= available) return new Date(cursor + remaining);
    remaining -= available;
  }
  return new Date(start + minutes * MIN);
}

/** Working minutes between two instants (0 when `to` is not after `from`). */
export function workingMinutesBetween(cal: CalendarDef, from: Date, to: Date): number {
  const a = from.getTime();
  const b = to.getTime();
  if (b <= a) return 0;
  if (cal.always_open || !hasWorkingTime(cal)) return Math.round((b - a) / MIN);
  const holidays = new Set(cal.holidays ?? []);
  const p = localParts(cal.timezone, a);
  let total = 0;
  for (let i = -1; i < MAX_DAYS; i++) {
    const dayStart = zonedToUtc(cal.timezone, p.y, p.m, p.d + i, 0);
    if (dayStart > b) break;
    const w = windowFor(cal, holidays, p.y, p.m, p.d + i);
    if (!w) continue;
    const lo = Math.max(a, w[0]);
    const hi = Math.min(b, w[1]);
    if (hi > lo) total += hi - lo;
  }
  return Math.round(total / MIN);
}

export type StatusCategory = 'open' | 'paused' | 'resolved' | 'closed';

/** A status with no (or an unknown) category behaves as an open, clock-running status. */
export function categoryOf(meta: Record<string, unknown> | undefined | null): StatusCategory {
  const c = meta?.category;
  return c === 'paused' || c === 'resolved' || c === 'closed' ? c : 'open';
}

export interface PriorityMatrix {
  /** Used when an impact or urgency has no cell (for example a value added later). */
  default: string;
  /** cells[impact][urgency] = priority */
  cells: Record<string, Record<string, string>>;
}

export const DEFAULT_MATRIX: PriorityMatrix = {
  default: 'p3',
  cells: {
    organisation: { high: 'p1', medium: 'p2', low: 'p3' },
    department: { high: 'p2', medium: 'p3', low: 'p4' },
    individual: { high: 'p3', medium: 'p4', low: 'p4' },
  },
};

export function priorityFor(matrix: PriorityMatrix, impact: unknown, urgency: unknown): string {
  return matrix.cells?.[String(impact ?? '')]?.[String(urgency ?? '')] ?? matrix.default;
}

export type ClockState = 'none' | 'running' | 'paused' | 'met' | 'breached';

export interface ClockInput {
  dueAt: Date | null;
  /** When the target was met (first response or resolution), if it has been. */
  metAt: Date | null;
  breached: boolean;
  pausedAt: Date | null;
}

export interface ClockView {
  state: ClockState;
  due_at: string | null;
  /** While paused: when the target would fall due if work resumed now. */
  projected_due_at: string | null;
  met_at: string | null;
  breached: boolean;
  /** Working minutes left (negative = working minutes overdue). Null when met or no target. */
  remaining_minutes: number | null;
}

/** Current state of one SLA clock. */
export function clockView(cal: CalendarDef | null, c: ClockInput, now: Date): ClockView {
  const base = {
    due_at: c.dueAt ? c.dueAt.toISOString() : null,
    projected_due_at: null as string | null,
    met_at: c.metAt ? c.metAt.toISOString() : null,
    breached: c.breached,
  };
  if (!c.dueAt || !cal) return { ...base, state: c.metAt ? 'met' : 'none', remaining_minutes: null };
  if (c.metAt) return { ...base, state: c.breached ? 'breached' : 'met', remaining_minutes: null };
  if (c.pausedAt) {
    const left = workingMinutesBetween(cal, c.pausedAt, c.dueAt);
    return {
      ...base,
      state: c.breached ? 'breached' : 'paused',
      projected_due_at: left > 0 ? addWorkingMinutes(cal, now, left).toISOString() : base.due_at,
      remaining_minutes: left > 0 ? left : -workingMinutesBetween(cal, c.dueAt, c.pausedAt),
    };
  }
  const overdue = now.getTime() > c.dueAt.getTime();
  return {
    ...base,
    state: overdue || c.breached ? 'breached' : 'running',
    breached: c.breached || overdue,
    remaining_minutes: overdue ? -workingMinutesBetween(cal, c.dueAt, now) : workingMinutesBetween(cal, now, c.dueAt),
  };
}
