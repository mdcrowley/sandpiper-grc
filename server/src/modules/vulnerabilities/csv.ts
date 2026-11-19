/** CSV reading and value normalization for the findings import. Pure functions, no database. */

export class CsvError extends Error {}

/**
 * RFC 4180-style parser: quoted cells, doubled quotes, delimiters and line breaks inside
 * quotes. Returns each non-empty record with the line it started on. Throws CsvError for
 * text that is not a delimited file.
 */
export function parseCsv(input: string, delimiter: string): { line: number; cells: string[] }[] {
  const text = input.replace(/^﻿/, '');
  if (text.includes('\u0000')) throw new CsvError('This does not look like a text file. Export the findings as CSV (comma-separated values) and try again.');
  const rows: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  let quoteLine = 0;
  const endRow = () => {
    cells.push(cell);
    cell = '';
    if (cells.some((v) => v.trim() !== '')) rows.push({ line: rowLine, cells });
    cells = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else { if (c === '\n') line++; cell += c; }
    } else if (c === '"' && cell === '') { quoted = true; quoteLine = line; }
    else if (c === delimiter) { cells.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRow();
      line++;
      rowLine = line;
    } else cell += c;
  }
  if (quoted) throw new CsvError(`A quotation mark opened on line ${quoteLine} is never closed. Check that line, or export the file again.`);
  if (cell !== '' || cells.length) endRow();
  return rows;
}

/** The most likely delimiter, judged from the header line. */
export function detectDelimiter(input: string): string {
  const header = input.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  let best = ',';
  let most = 0;
  for (const d of [',', ';', '\t', '|']) {
    const n = header.split(d).length - 1;
    if (n > most) { most = n; best = d; }
  }
  return best;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Accepts YYYY-MM-DD (with or without a time), YYYY/MM/DD, "5 Mar 2030", "Mar 5, 2030",
 * a Unix time in seconds, and numeric day/month/year or month/day/year (`dayFirst` decides
 * when both readings are possible). Returns YYYY-MM-DD or null.
 */
export function parseDate(raw: string, dayFirst = true): string | null {
  const v = raw.trim();
  const p = (n: string | number) => String(n).padStart(2, '0');
  let out: string | null = null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(v);
  if (m) out = `${m[1]}-${p(m[2])}-${p(m[3])}`;
  if (!out && (m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[T ].*)?$/.exec(v))) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const isDayFirst = a > 12 ? true : b > 12 ? false : dayFirst;
    out = `${m[3]}-${p(isDayFirst ? b : a)}-${p(isDayFirst ? a : b)}`;
  }
  if (!out && (m = /^(\d{1,2})[ -]([A-Za-z]{3})[A-Za-z]*\.?,?[ -](\d{4})(?:[T ].*)?$/.exec(v))) {
    const mon = MONTHS.indexOf(m[2].toLowerCase());
    if (mon >= 0) out = `${m[3]}-${p(mon + 1)}-${p(m[1])}`;
  }
  if (!out && (m = /^([A-Za-z]{3})[A-Za-z]*\.? (\d{1,2}),? (\d{4})(?:[T ].*)?$/.exec(v))) {
    const mon = MONTHS.indexOf(m[1].toLowerCase());
    if (mon >= 0) out = `${m[3]}-${p(mon + 1)}-${p(m[2])}`;
  }
  if (!out && /^\d{9,10}$/.test(v)) out = new Date(Number(v) * 1000).toISOString().slice(0, 10);
  if (!out) return null;
  const d = new Date(`${out}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === out ? out : null;
}

const SEVERITY_WORDS: Record<string, string> = {
  critical: 'critical', crit: 'critical', urgent: 'critical', severe: 'critical',
  high: 'high', important: 'high', serious: 'high',
  medium: 'medium', moderate: 'medium', med: 'medium',
  low: 'low', minor: 'low',
  informational: 'informational', info: 'informational', information: 'informational', none: 'informational', note: 'informational', log: 'informational',
};
const SEVERITY_NUMBERS = ['informational', 'low', 'medium', 'high', 'critical'];

export function severityFromCvss(score: number): string {
  return score >= 9 ? 'critical' : score >= 7 ? 'high' : score >= 4 ? 'medium' : score > 0 ? 'low' : 'informational';
}

/**
 * Turns a scanner's severity text or number into a value of the severity list.
 * Words in any letter case, the list's own values and labels, and the numbers 0 (informational)
 * to 4 (critical) are understood. Returns null when it cannot tell.
 */
export function normalizeSeverity(raw: string, allowed: { value: string; label: string }[]): string | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  const own = allowed.find((a) => a.value.toLowerCase() === v || a.label.toLowerCase() === v);
  if (own) return own.value;
  let guess: string | undefined = SEVERITY_WORDS[v];
  if (!guess && /^\d+(\.0+)?$/.test(v)) guess = SEVERITY_NUMBERS[Math.min(Number(v), 4)];
  return guess && allowed.some((a) => a.value === guess) ? guess : null;
}

export function parseBoolean(raw: string): boolean | null {
  if (/^(y|yes|true|1|x)$/i.test(raw.trim())) return true;
  if (/^(n|no|false|0)$/i.test(raw.trim())) return false;
  return null;
}

/** Keeps only well-formed CVE identifiers. */
export function pickCves(raw: string): string {
  const found = raw.toUpperCase().match(/CVE-\d{4}-\d{4,}/g) ?? [];
  return [...new Set(found)].sort().join(', ');
}
