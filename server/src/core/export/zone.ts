// Wall-clock time in the organisation's time zone, for files that carry dates without a zone
// (spreadsheets): a date and time is written as the organisation's clocks read it, and read back
// the same way.
import { TIME_ZONE } from '../timezone.ts';

const partsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export interface WallClock { y: number; m: number; d: number; h: number; mi: number; s: number }

/** The organisation's wall-clock reading of an instant. */
export function wallClock(at: Date): WallClock {
  const p = Object.fromEntries(partsFmt.formatToParts(at).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute), s: Number(p.second) };
}

/** The instant at which the organisation's clocks read this date and time. */
export function wallToInstant(w: WallClock): Date {
  const target = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const z = wallClock(new Date(guess));
    const diff = target - Date.UTC(z.y, z.m - 1, z.d, z.h, z.mi, z.s);
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

/** Days since 30 Dec 1899: the spreadsheet date serial of a wall-clock reading. */
export function wallToSerial(w: WallClock): number {
  return (Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

/** The wall-clock reading a spreadsheet date serial stands for. */
export function serialToWall(serial: number): WallClock {
  const ms = Math.round(serial * 86_400_000) + Date.UTC(1899, 11, 30);
  const d = new Date(ms);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
}

const pad = (n: number) => String(n).padStart(2, '0');
export const wallDate = (w: WallClock) => `${w.y}-${pad(w.m)}-${pad(w.d)}`;

/** "18 Nov 2026, 14:05" in the organisation's time zone. */
const stampFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const dateFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
export const formatStamp = (v: unknown) => { const d = v instanceof Date ? v : new Date(String(v)); return Number.isNaN(d.getTime()) ? String(v ?? '') : stampFmt.format(d); };
/** A calendar date (YYYY-MM-DD, never shifted by time zone) as "18 Nov 2026". */
export const formatDay = (v: unknown) => {
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10);
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? String(v ?? '') : dateFmt.format(d);
};
export { TIME_ZONE };
