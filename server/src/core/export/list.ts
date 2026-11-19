// Spreadsheet (XLSX) and PDF exports of a generic record list. The rows arrive already filtered,
// sorted and cut to what the caller may see by the list route (core/resource.ts), exactly as for
// the CSV export; this file chooses the columns, types the cells, adds the watermark for
// restricted content and writes the file.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CURRENCY, DEFAULT_APP_NAME } from '../config.ts';
import type { Db } from '../db.ts';
import type { AuditInput, FieldDef, ResourceDef, Row } from '../module.ts';
import { PdfBuilder, PDF_TYPE } from './pdf.ts';
import { formatDay, formatStamp } from './zone.ts';
import { writeXlsx, XLSX_TYPE, type CellType } from './xlsx.ts';

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';
export const EXPORT_FORMATS: ExportFormat[] = ['csv', 'xlsx', 'pdf'];
/** The most rows a PDF list export prints; the spreadsheet takes every row (up to the list limit). */
export const PDF_ROW_LIMIT = 2000;

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

const money = (() => {
  try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: CURRENCY }); } catch { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'USD' }); }
})();
const plain = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });

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
  const cols = exportColumns(x.fields, x.query.columns);
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
        watermark: mark ?? undefined,
      }],
    }));
  } else {
    const pdf = new PdfBuilder({
      title: def.plural, appName: name, author: user.displayName, watermark: mark,
      landscape: cols.length > 5,
      meta: [`Generated ${formatStamp(now)} for ${user.displayName}`, `Filters: ${filters.join(' · ')}`,
        `${rows.length} ${(rows.length === 1 ? def.label : def.plural).toLowerCase()}`],
    });
    const shown = rows.slice(0, PDF_ROW_LIMIT);
    printed = shown.length;
    if (!shown.length) pdf.note(`No ${def.plural.toLowerCase()} match.`);
    else {
      pdf.table(
        cols.map(([, f]) => ({ header: f.label, align: f.type === 'number' || f.type === 'currency' ? 'right' : 'left' })),
        shown.map((r) => cols.map(([n, f]) => cellString(r, n, f))),
      );
    }
    if (rows.length > shown.length) pdf.note(`The first ${PDF_ROW_LIMIT} of ${rows.length} rows are printed. Export to Excel for every row.`);
    body = await pdf.finish();
  }
  await x.audit(req, {
    action: `${def.type}.export`, recordType: def.type,
    summary: `Exported ${printed} ${def.plural.toLowerCase()} to ${format === 'xlsx' ? 'Excel (XLSX)' : 'PDF'}${restricted ? ' (includes restricted records)' : ''}`,
    after: { format, rows: printed, columns: cols.map(([n]) => n), restricted },
  });
  reply.header('content-type', format === 'xlsx' ? XLSX_TYPE : PDF_TYPE);
  reply.header('content-disposition', `attachment; filename="${slug(def.plural)}.${format}"`);
  reply.header('cache-control', 'no-store');
  return body;
}
