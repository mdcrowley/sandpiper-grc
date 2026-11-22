// Values as people read them: labels of lists, people and records, dates in the phone's language.
// Owner: APP-WORK.
import type { FieldMeta, LookupValue, RecordRow } from './types';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar date (YYYY-MM-DD, no time zone) or the date part of a time. */
export function formatDate(value: string): string {
  if (DATE_ONLY.test(value)) {
    const d = new Date(`${value}T12:00:00Z`);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(value: string): string {
  if (DATE_ONLY.test(value)) return formatDate(value);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** "Due 3 Mar 2027" or the time, for rows. */
export function formatDue(value: string): string {
  return DATE_ONLY.test(value) ? formatDate(value) : formatDateTime(value);
}

export function lookupLabel(lookups: Record<string, LookupValue[]>, list: string | undefined, value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  const found = list ? lookups[list]?.find((v) => v.value === value) : undefined;
  return found?.label ?? String(value);
}

/** The text of one field of a row, or null when it has no value. */
export function displayValue(
  name: string, field: FieldMeta, row: RecordRow, lookups: Record<string, LookupValue[]> = {},
): string | null {
  const raw = row[name];
  if (raw === null || raw === undefined || raw === '') return null;
  const shown = row._display?.[name];
  switch (field.type) {
    case 'lookup':
      return shown ?? lookupLabel(lookups, field.list, raw);
    case 'user':
    case 'ref':
      return shown ?? 'Not visible to you';
    case 'boolean':
      return raw === true ? 'Yes' : 'No';
    case 'date':
      return formatDate(String(raw));
    case 'datetime':
      return formatDateTime(String(raw));
    case 'currency': {
      const n = Number(raw);
      return Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(raw);
    }
    case 'number': {
      const n = Number(raw);
      return Number.isFinite(n) ? n.toLocaleString() : String(raw);
    }
    case 'json':
      return null;
    default:
      return String(raw);
  }
}

/** The record's title line: "TKT-00012 Printer jammed". */
export function recordTitle(row: RecordRow, titleField: string, refField?: string): string {
  const title = String(row[titleField] ?? '').trim();
  const ref = refField ? String(row[refField] ?? '').trim() : '';
  return title || ref || 'Untitled';
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
