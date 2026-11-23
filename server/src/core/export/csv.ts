// The spreadsheet formula guard every CSV export uses (W17-5).
//
// A spreadsheet program may treat a cell that starts with = + - or @ as a formula. Such a cell is
// prefixed with an apostrophe, which shows it as text. The test looks past leading white space
// (spaces, tabs, line breaks, no-break and ideographic spaces), which some programs skip, and also
// catches the full-width forms of the four characters (＝ ＋ － ＠), which some programs read as the
// plain ones. A cell that itself starts with a tab, carriage return or line feed is prefixed too.

/** A cell a spreadsheet program could read as a formula. */
export const FORMULA_START = /^(?:[\t\r\n]|[\s 　﻿]*[=+\-@＝＋－＠])/;

/** `s`, prefixed with an apostrophe when a spreadsheet program could read it as a formula. */
export const guardFormula = (s: string): string => (FORMULA_START.test(s) ? `'${s}` : s);

/** One CSV cell: dates as ISO text, objects as JSON, the formula guard, quoted when needed. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = guardFormula(v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
