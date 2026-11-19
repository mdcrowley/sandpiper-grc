// Formatting helpers. All times are shown in the organization's time zone, which the server
// reports in /api/auth/state (GRC_TIMEZONE); until then the browser's own zone is used.

export const EMPTY = '—';

type DateInput = string | number | Date | null | undefined;

let zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
let currencyCode = 'USD';
let dateFmt: Intl.DateTimeFormat;
let dateTimeFmt: Intl.DateTimeFormat;
let partsFmt: Intl.DateTimeFormat;
let currencyFmt: Intl.NumberFormat;

function build() {
  dateFmt = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: zone });
  dateTimeFmt = new Intl.DateTimeFormat('en-US', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: zone,
  });
  partsFmt = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: zone,
  });
  currencyFmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode });
}
build();

/** The organization's IANA time zone, e.g. "Europe/London". */
export const timeZone = (): string => zone;
/** The organization's ISO 4217 currency code, e.g. "USD". */
export const currency = (): string => currencyCode;

/** Called by AuthProvider when the server reports its settings. Invalid values are ignored. */
export function setLocaleSettings(next: { timeZone?: string; currency?: string }) {
  const before = [zone, currencyCode];
  try {
    if (next.timeZone) { new Intl.DateTimeFormat('en-US', { timeZone: next.timeZone }); zone = next.timeZone; }
    if (next.currency) { new Intl.NumberFormat(undefined, { style: 'currency', currency: next.currency }); currencyCode = next.currency; }
    build();
  } catch {
    [zone, currencyCode] = before;
    build();
  }
}

/** Today's calendar date (YYYY-MM-DD) in the organization's time zone. */
export const todayInZone = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date());

const calendarFmt = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const relativeFmt = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });
const numberFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// A calendar date with no time of day: "2026-11-18", or the same at midnight UTC.
const CALENDAR = /^(\d{4}-\d{2}-\d{2})(T00:00:00(\.0+)?(Z|\+00:00))?$/;

/** "18 Nov 2026". Date-only values are never shifted by time zone. */
export function formatDate(value: DateInput): string {
  if (typeof value === 'string') {
    const m = CALENDAR.exec(value);
    if (m) return calendarFmt.format(new Date(`${m[1]}T00:00:00Z`));
  }
  const d = toDate(value);
  return d ? dateFmt.format(d) : EMPTY;
}

/** "18 Nov 2026, 14:05" (24-hour, organization time zone). */
export function formatDateTime(value: DateInput): string {
  const d = toDate(value);
  return d ? dateTimeFmt.format(d) : EMPTY;
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000_000], ['month', 2_592_000_000], ['day', 86_400_000], ['hour', 3_600_000], ['minute', 60_000],
];

/** "3 hours ago", "in 2 days", "yesterday". */
export function relativeTime(value: DateInput, now: number = Date.now()): string {
  const d = toDate(value);
  if (!d) return EMPTY;
  const diff = d.getTime() - now;
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return relativeFmt.format(Math.round(diff / ms), unit);
  }
  return 'just now';
}

/** "2d 4h", "3h 12m", "45m", "30s" for a length of time in milliseconds. */
export function formatDuration(ms: number): string {
  const s = Math.floor(Math.abs(ms) / 1000);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return h ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** "$1,234.50" */
export function formatCurrency(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return EMPTY;
  const n = Number(value);
  return Number.isFinite(n) ? currencyFmt.format(n) : EMPTY;
}

/** "1,234.5" */
export function formatNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return EMPTY;
  const n = Number(value);
  return Number.isFinite(n) ? numberFmt.format(n) : EMPTY;
}

/** "status_reason" becomes "Status reason". Used when a field has no metadata label. */
export function humanize(name: string): string {
  const words = name.replace(/_id$/, '').replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function zonedParts(d: Date): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of partsFmt.formatToParts(d)) out[p.type] = p.value;
  return out;
}

/** ISO instant to the "YYYY-MM-DDTHH:mm" wall-clock value a datetime-local input needs, in the organization's time zone. */
export function toZonedInput(value: DateInput): string {
  const d = toDate(value);
  if (!d) return '';
  const p = zonedParts(d);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Organization-zone wall-clock "YYYY-MM-DDTHH:mm" back to an ISO instant. */
export function fromZonedInput(local: string): string {
  // Only what a datetime-local input gives (E18-46): anything else could be read as some other date.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return '';
  const asUtc = new Date(`${local}:00Z`).getTime();
  if (Number.isNaN(asUtc)) return '';
  const offsetAt = (t: number) => new Date(`${toZonedInput(new Date(t))}:00Z`).getTime() - t;
  let t = asUtc - offsetAt(asUtc);
  t = asUtc - offsetAt(t); // second pass settles times next to a daylight-saving change
  return new Date(t).toISOString();
}
