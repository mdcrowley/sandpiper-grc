// Spreadsheet (XLSX) and PDF exports of a generic record list. The rows arrive already filtered,
// sorted and cut to what the caller may see by the list route (core/resource.ts), exactly as for
// the CSV export; this file chooses the columns, types the cells, adds the watermark for
// restricted content and writes the file.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CURRENCY, DEFAULT_APP_NAME } from '../config.ts';
import type { Db } from '../db.ts';
import { fail } from '../errors.ts';
import type { AuditInput, FieldDef, ResourceDef, Row } from '../module.ts';
import { printBranding } from '../organization.ts';
import { PdfBuilder, PDF_TYPE } from './pdf.ts';
import { formatDay, formatStamp } from './zone.ts';
import { writeXlsx, XLSX_TYPE, type CellType } from './xlsx.ts';

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';
export const EXPORT_FORMATS: ExportFormat[] = ['csv', 'xlsx', 'pdf'];
/** The most rows a PDF list export prints; the spreadsheet takes every row (up to the list limit). */
export const PDF_ROW_LIMIT = 2000;
/**
 * The most columns a PDF list export prints (OP-01: 65 columns of 10,000 tickets ran the server
 * out of memory). More are refused with a message pointing to CSV or Excel.
 */
export const PDF_MAX_COLUMNS = 12;
/** The most cells (rows times columns) a PDF list export lays out; past it, fewer rows are printed. */
export const PDF_CELL_BUDGET = 16_000;
/** Columns a PDF prints when none are chosen: the reference, the title and the first short fields. */
export const PDF_DEFAULT_COLUMNS = 8;
/** The most rows a CSV, Excel or PDF export of a list takes (OP-10). The file and a response header say when it was cut. */
export const EXPORT_ROW_LIMIT = 50_000;
/** Response header set when an export stopped at EXPORT_ROW_LIMIT; its value is the limit. */
export const TRUNCATED_HEADER = 'x-grc-export-truncated';

/** The line written into an export that stopped at the row limit. */
export const truncatedLine = (limit = EXPORT_ROW_LIMIT) =>
  `Only the first ${limit.toLocaleString('en-US')} rows were exported (the export limit). Narrow the list with filters to export the rest.`;

/** How many rows a PDF of `columns` columns prints. */
export const pdfRowLimit = (columns: number) => Math.max(1, Math.min(PDF_ROW_LIMIT, Math.floor(PDF_CELL_BUDGET / Math.max(1, columns))));

const STD: Record<string, FieldDef> = {
  created_at: { label: 'Created', type: 'datetime' },
  updated_at: { label: 'Updated', type: 'datetime' },
};

/**
 * The columns of an export: the fields named in `columns` (comma-separated, in that order) that
 * the type has, or every exported field when none is named.
 */
export function exportColumns(fields: Record<string, FieldDef>, columns?: string): [string, FieldDef][] {
  const wanted = String(columns ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const all = { ...fields, ...STD };
  const chosen = [...new Set(wanted)].filter((n) => n in all).map((n): [string, FieldDef] => [n, all[n]]);
  return chosen.length ? chosen : Object.entries(fields);
}

/**
 * The columns of a PDF list export: the chosen ones (refused past PDF_MAX_COLUMNS), or when none
 * are chosen the reference, the title and the first short built-in fields (lookups, people,
 * dates, numbers, yes/no), up to PDF_DEFAULT_COLUMNS. Long text and data fields are left out.
 */
export function pdfColumns(def: Pick<ResourceDef, 'titleField' | 'ref'>, fields: Record<string, FieldDef>, columns?: string): [string, FieldDef][] {
  const named = String(columns ?? '').split(',').some((s) => s.trim());
  if (named) {
    const cols = exportColumns(fields, columns);
    if (cols.length > PDF_MAX_COLUMNS) {
      fail(422, 'too_many_columns', `A PDF can hold at most ${PDF_MAX_COLUMNS} columns; ${cols.length} were chosen. Choose fewer columns, or export to CSV or Excel, which take every column.`);
    }
    return cols;
  }
  const out: [string, FieldDef][] = [];
  const add = (n: string | undefined) => { if (n && fields[n] && !out.some(([k]) => k === n)) out.push([n, fields[n]]); };
  add(def.ref?.field);
  add(def.titleField);
  const short = new Set(['lookup', 'user', 'date', 'datetime', 'number', 'currency', 'boolean']);
  for (const [n, f] of Object.entries(fields)) {
    if (out.length >= PDF_DEFAULT_COLUMNS) break;
    if (!f.custom && short.has(f.type) && !f.multiple && n !== 'restricted') add(n);
  }
  return out.length ? out : Object.entries(fields).slice(0, PDF_DEFAULT_COLUMNS);
}

const money = (() => {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: CURRENCY }); } catch { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }); }
})();
const plain = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

export const cellType = (f: FieldDef): CellType =>
  f.multiple ? 'text'
    : f.type === 'number' ? 'number' : f.type === 'currency' ? 'currency'
    : f.type === 'date' ? 'date' : f.type === 'datetime' ? 'datetime' : f.type === 'boolean' ? 'boolean' : 'text';

/** The value a cell holds: display labels for lookups, people and records; typed values otherwise. */
export function cellValue(row: Row, name: string, f: FieldDef): unknown {
  const shown = row._display?.[name];
  if (shown !== undefined) return shown;
  const v = row[name];
  if (v === null || v === undefined) return null;
  if (f.type === 'boolean') return v === true || v === 'true';
  if (f.type === 'json' || (typeof v === 'object' && !(v instanceof Date))) return Array.isArray(v) && f.multiple ? v.join(', ') : JSON.stringify(v);
  return v;
}

/** The value as a person reads it on paper. */
export function cellString(row: Row, name: string, f: FieldDef): string {
  const v = cellValue(row, name, f);
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (f.type === 'date' && row._display?.[name] === undefined) return formatDay(v);
  if (f.type === 'datetime' && row._display?.[name] === undefined) return formatStamp(v);
  if (f.type === 'currency' && typeof v === 'number') return money.format(v);
  if (f.type === 'number' && typeof v === 'number') return plain.format(v);
  return String(v);
}

export interface ListExportInput {
  req: FastifyRequest;
  reply: FastifyReply;
  db: Db;
  audit: (req: FastifyRequest | null, ev: AuditInput) => Promise<void>;
  def: ResourceDef;
  /** Decorated rows (with `_display`), already filtered and sorted. */
  rows: Row[];
  /** Built-in and custom fields of the type. */
  fields: Record<string, FieldDef>;
  query: Record<string, string>;
  format: 'xlsx' | 'pdf';
  /** Lookup labels by list, for describing the filters. */
  lookupLabels?: (list: string, value: string) => Promise<string | undefined>;
  /** True when the list had more than EXPORT_ROW_LIMIT rows and `rows` holds only the first ones. */
  truncated?: boolean;
}

export async function appName(db: Db): Promise<string> {
  try {
    const row = await db.one<{ value: unknown }>("select value from settings where key = 'app.name'");
    return typeof row?.value === 'string' && row.value.trim() ? row.value : DEFAULT_APP_NAME;
  } catch {
    return DEFAULT_APP_NAME;
  }
}

/** "Search: printer · Status: New, Open · Due before 2026-12-01", from the list query. */
export async function describeFilters(def: ResourceDef, fields: Record<string, FieldDef>, query: Record<string, string>, db: Db, lookupLabel?: ListExportInput['lookupLabels']): Promise<string[]> {
  const parts: string[] = [];
  if (query.q?.trim()) parts.push(`Search: "${query.q.trim().slice(0, 100)}"`);
  const users = async (ids: string[]) => {
    const rows = await db.query<{ id: string; display_name: string }>('select id, display_name from users where id::text = any($1::text[])', [ids]);
    return ids.map((id) => (id === 'me' ? 'Me' : rows.find((r) => r.id === id)?.display_name ?? 'a person'));
  };
  for (const [key, raw] of Object.entries(query)) {
    if (!key.startsWith('f.')) continue;
    const [, name, op] = key.split('.');
    const f = name === 'tags' ? { label: 'Tags', type: 'text' as const } : fields[name] ?? STD[name];
    if (!f) continue;
    const values = String(raw).split(',').filter(Boolean);
    if (op === 'null') { parts.push(`${f.label}: ${raw === 'true' ? 'empty' : 'not empty'}`); continue; }
    if (op && ['gt', 'gte'].includes(op)) { parts.push(`${f.label} after ${raw}`); continue; }
    if (op && ['lt', 'lte'].includes(op)) { parts.push(`${f.label} before ${raw}`); continue; }
    if (op === 'all') { parts.push(`${f.label}: all of ${values.join(', ')}`); continue; }
    let shown = values;
    if (f.type === 'lookup' && f.list && lookupLabel) shown = await Promise.all(values.map(async (v) => (await lookupLabel(f.list!, v)) ?? v));
    else if (f.type === 'user') shown = await users(values);
    else if (f.type === 'ref') shown = [`${values.length} chosen ${values.length === 1 ? 'record' : 'records'}`];
    else if (f.type === 'boolean') shown = values.map((v) => (v === 'true' ? 'Yes' : 'No'));
    parts.push(`${f.label}: ${shown.join(', ')}`);
  }
  const sortField = query.sort && (fields[query.sort] ?? STD[query.sort]);
  if (sortField) parts.push(`Sorted by ${sortField.label.toLowerCase()}${query.dir === 'desc' ? ' (descending)' : ''}`);
  if (!parts.length) return [`All ${def.plural.toLowerCase()}`];
  return parts;
}

export const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60) || 'export';
export const restrictedLine = (who: string, at: Date | string) => `Restricted export by ${who} at ${at instanceof Date ? at.toISOString() : at}`;

/** Writes the XLSX or PDF export of a list, audits it and returns the file. */
export async function sendListExport(x: ListExportInput): Promise<Buffer> {
  const { req, reply, def, rows, format } = x;
  const user = req.user!;
  const now = new Date();
  const cols = format === 'pdf' ? pdfColumns(def, x.fields, x.query.columns) : exportColumns(x.fields, x.query.columns);
  const truncated = x.truncated === true;
  const restricted = def.restricted === true || rows.some((r) => r.restricted === true);
  const mark = restricted ? restrictedLine(user.displayName, now) : null;
  const filters = await describeFilters(def, x.fields, x.query, x.db, x.lookupLabels);
  const name = await appName(x.db);
  let body: Buffer;
  let printed = rows.length;
  if (format === 'xlsx') {
    body = Buffer.from(writeXlsx({
      title: def.plural, author: user.displayName,
      sheets: [{
        name: def.plural,
        preface: undefined,
        columns: cols.map(([, f]) => ({ header: f.label, type: cellType(f) })),
        rows: rows.map((r) => cols.map(([n, f]) => cellValue(r, n, f))),
        notes: truncated ? [truncatedLine()] : undefined,
        watermark: mark ?? undefined,
      }],
    }));
  } else {
    const pdf = new PdfBuilder({
      title: def.plural, appName: name, author: user.displayName, watermark: mark, branding: await printBranding(x.db),
      landscape: cols.length > 5,
      meta: [`Generated ${formatStamp(now)} for ${user.displayName}`, `Filters: ${filters.join(' · ')}`,
        `${truncated ? 'More than ' : ''}${rows.length} ${(rows.length === 1 ? def.label : def.plural).toLowerCase()}`],
    });
    const limit = pdfRowLimit(cols.length);
    const shown = rows.slice(0, limit);
    printed = shown.length;
    if (!shown.length) pdf.note(`No ${def.plural.toLowerCase()} match.`);
    else {
      // Laid out a few rows at a time, so other requests are answered meanwhile (OP-01).
      await pdf.tableAsync(
        cols.map(([, f]) => ({ header: f.label, align: f.type === 'number' || f.type === 'currency' ? 'right' : 'left' })),
        shown.map((r) => cols.map(([n, f]) => cellString(r, n, f))),
      );
    }
    if (rows.length > shown.length) {
      pdf.note(`The first ${limit.toLocaleString('en-US')} of ${truncated ? 'more than ' : ''}${rows.length.toLocaleString('en-US')} rows are printed (a PDF of ${cols.length} columns holds at most ${limit.toLocaleString('en-US')}). Export to CSV or Excel for every row, or choose fewer columns.`);
    }
    body = await pdf.finish();
  }
  await x.audit(req, {
    action: `${def.type}.export`, recordType: def.type,
    summary: `Exported ${printed} ${def.plural.toLowerCase()} to ${format === 'xlsx' ? 'Excel (XLSX)' : 'PDF'}${restricted ? ' (includes restricted records)' : ''}${truncated ? ` (stopped at the ${EXPORT_ROW_LIMIT.toLocaleString('en-US')}-row export limit)` : ''}`,
    after: { format, rows: printed, columns: cols.map(([n]) => n), restricted, ...(truncated ? { truncated_at: EXPORT_ROW_LIMIT } : {}) },
  });
  if (truncated) reply.header(TRUNCATED_HEADER, String(EXPORT_ROW_LIMIT));
  reply.header('content-type', format === 'xlsx' ? XLSX_TYPE : PDF_TYPE);
  reply.header('content-disposition', `attachment; filename="${slug(def.plural)}.${format}"`);
  reply.header('cache-control', 'no-store');
  return body;
}

/** Rows read with `limit EXPORT_ROW_LIMIT + 1`, cut to the limit, and whether there were more. */
export function capExportRows<T>(rows: T[], limit = EXPORT_ROW_LIMIT): { rows: T[]; truncated: boolean } {
  return rows.length > limit ? { rows: rows.slice(0, limit), truncated: true } : { rows, truncated: false };
}
