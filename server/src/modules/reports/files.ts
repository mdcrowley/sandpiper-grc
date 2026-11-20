// Server-made files for reports, dashboards and packs: a PDF (core/export/pdf.ts) and an Excel
// workbook (core/export/xlsx.ts), built from the same sections as the print-ready document, so
// the figures, the "not included" notes and the restricted watermark are the same in every format.
import { PdfBuilder, type ChartPoint } from '../../core/export/pdf.ts';
import { formatStamp } from '../../core/export/zone.ts';
import { writeXlsx, type CellType, type Sheet } from '../../core/export/xlsx.ts';
import type { ModuleContext, ResourceDef } from '../../core/module.ts';
import type { BuiltDocument } from './documents.ts';
import type { ReportResult, ResultColumn } from './query.ts';
import { cellText, watermark, type DocInput, type DocSection } from './render.ts';
import { STD_FIELDS, type Condition, type FilterGroup, type ReportSpec } from './spec.ts';

// ---------- the report's own filters, in words ----------

const OPS: Record<string, string> = {
  eq: 'is', ne: 'is not', in: 'is any of', nin: 'is none of', lt: 'before', lte: 'on or before', gt: 'after', gte: 'on or after',
  between: 'between', contains: 'contains', ncontains: 'does not contain', starts: 'starts with', empty: 'is empty', nempty: 'is not empty',
  me: 'is me', last_days: 'in the last', next_days: 'in the next', this_month: 'is this month', this_quarter: 'is this quarter',
  this_year: 'is this year', past: 'is in the past', future: 'is in the future', true: 'is yes', false: 'is no',
};
/** Operators that take no value. */
const BARE = ['empty', 'nempty', 'me', 'this_month', 'this_quarter', 'this_year', 'past', 'future', 'true', 'false'];

/** "Status is any of New, Open; Priority is High", from a report's filter tree. */
export async function describeSpecFilters(ctx: ModuleContext, spec: ReportSpec | undefined): Promise<string[]> {
  const def = spec?.type ? ctx.resources.get(spec.type) : undefined;
  if (!def || !spec?.filters?.items?.length) return [];
  const out: string[] = [];
  const label = async (d: ResourceDef, c: Condition) => {
    const [name] = String(c.field ?? '').split('.');
    const f = d.fields[name] ?? STD_FIELDS[name];
    const fieldLabel = f?.label ?? c.field;
    const op = OPS[c.op] ?? c.op;
    if (BARE.includes(c.op)) return `${fieldLabel} ${op}`;
    if (c.op === 'last_days' || c.op === 'next_days') return `${fieldLabel} ${op} ${c.value} days`;
    let values = (Array.isArray(c.value) ? c.value : [c.value]).map((v) => String(v ?? ''));
    if (f?.type === 'lookup' && f.list) {
      const list = await ctx.lookups.values(f.list);
      values = values.map((v) => list.find((x) => x.value === v)?.label ?? v);
    } else if (f?.type === 'user' || f?.type === 'ref') {
      values = [`${values.length} chosen`];
    }
    return `${fieldLabel} ${op} ${values.join(c.op === 'between' ? ' and ' : ', ')}`;
  };
  const walk = async (g: FilterGroup): Promise<string> => {
    const parts: string[] = [];
    for (const item of g.items ?? []) {
      if ((item as FilterGroup).items) parts.push(`(${await walk(item as FilterGroup)})`);
      else parts.push(await label(def, item as Condition));
    }
    return parts.join(g.op === 'or' ? ' or ' : '; ');
  };
  out.push(await walk(spec.filters));
  return out.filter(Boolean);
}

// ---------- shared helpers ----------

const numeric = (c: ResultColumn) => c.role === 'agg' || c.type === 'number' || c.type === 'currency';

/** The chart a section draws on paper, from the report's chosen chart kind. */
export function chartKind(kind: string | undefined): 'bar' | 'line' | 'pie' | null {
  if (!kind || kind === 'table' || kind === 'number' || kind === 'gauge') return null;
  if (kind === 'line' || kind === 'area' || kind === 'calendar') return 'line';
  if (kind === 'pie' || kind === 'donut') return 'pie';
  return 'bar';
}

/** Labeled values for a chart: one dimension and its first measure, or a pivot's row totals. */
export function chartPoints(r: ReportResult): ChartPoint[] {
  if (r.pivot) return r.pivot.rows.map((row, i) => ({ label: row.label, value: r.pivot!.rowTotals[i] ?? 0 }));
  const dims = r.columns.filter((c) => c.role === 'dim');
  const agg = r.columns.find((c) => c.role === 'agg');
  if (dims.length !== 1 || !agg) return [];
  return r.rows.filter((row) => typeof row.v[agg.key] === 'number').map((row) => ({ label: row.d[dims[0].key] ?? String(row.v[dims[0].key] ?? 'None'), value: row.v[agg.key] as number }));
}

const metaLines = (doc: DocInput) => [
  `As at ${formatStamp(doc.generatedAt)} · prepared for ${doc.preparedFor}`,
  ...(doc.filtersNote ? [doc.filtersNote] : []),
];

// ---------- PDF ----------

function pdfSection(pdf: PdfBuilder, s: DocSection) {
  pdf.heading(s.title);
  if (s.description) pdf.paragraph(s.description, { muted: true });
  if (s.filters?.length) pdf.paragraph(`Filters: ${s.filters.join('; ')}`, { muted: true, size: 9 });
  if (s.note) { pdf.note(s.note); return; }
  if (s.markdown !== undefined) { pdf.markdown(s.markdown); return; }
  const r = s.result;
  if (!r) return;
  if (r.mode === 'total') {
    pdf.figures(r.columns.map((c) => ({ label: c.label, value: cellText(c, r.rows[0] ?? { v: {}, d: {} }) || '0' })));
  } else if (!r.rows.length && !r.pivot?.rows.length) {
    pdf.note('No records match.');
  } else {
    const kind = r.mode === 'groups' ? chartKind(s.chart ?? 'bar') : null;
    if (kind) pdf.chart(kind, chartPoints(r), `${r.columns.find((c) => c.role === 'agg')?.label ?? 'Count'} by ${r.columns[0]?.label ?? ''}`.trim());
    if (r.pivot) {
      const p = r.pivot;
      pdf.table(
        [{ header: r.columns[0].label }, ...p.cols.map((c) => ({ header: c.label, align: 'right' as const })), { header: 'Total', align: 'right' }],
        [
          ...p.rows.map((row, i) => [row.label, ...p.cells[i].map((c) => (c ? fmt(c.v) : '')), fmt(p.rowTotals[i])]),
          ['Total', ...p.colTotals.map(fmt), fmt(p.grand)],
        ],
        { boldLast: true, boldFirstColumn: true },
      );
    } else {
      pdf.table(r.columns.map((c) => ({ header: c.label, align: numeric(c) ? 'right' : 'left' })), r.rows.map((row) => r.columns.map((c) => cellText(c, row))));
    }
  }
  if (r.countingNote) pdf.paragraph(r.countingNote, { muted: true, size: 8.5 });
  pdf.paragraph(`${r.total} ${(r.total === 1 ? r.typeLabel : r.plural).toLowerCase()}${r.truncated ? ' (the list is cut short; export to Excel for every row)' : ''}`, { muted: true, size: 8.5 });
}

const plain = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const fmt = (v: number | null | undefined) => (v === null || v === undefined ? '' : plain.format(v));

/**
 * The PDF of a report, a dashboard or a pack. Packs get a cover page and each section starts a new
 * page; dashboards start a new page for each band of widgets (`group`).
 */
export async function documentPdf(doc: DocInput, opts: { kind: 'report' | 'dashboard' | 'pack' }): Promise<Buffer> {
  const restricted = doc.sections.some((s) => s.result?.restricted);
  const wide = doc.sections.some((s) => (s.result?.pivot ? s.result.pivot.cols.length + 2 : s.result?.columns.length ?? 0) > 6);
  const pdf = new PdfBuilder({
    title: doc.title, subtitle: doc.subtitle, appName: doc.appName, author: doc.preparedFor,
    cover: opts.kind === 'pack', landscape: wide && opts.kind === 'report',
    watermark: restricted ? watermark(doc.preparedFor, doc.generatedAt) : null,
    meta: metaLines(doc),
  });
  // Dashboards: a group of widgets (the widgets sharing rows of the grid) with a chart or table gets
  // a page of its own; groups of only figures, text and notes run on together.
  const heavy = new Set(doc.sections.filter((s) => s.result && s.result.mode !== 'total' && (s.result.rows.length || s.result.pivot)).map((s) => s.group));
  let group: number | undefined;
  doc.sections.forEach((s, i) => {
    const newPage = i > 0 && (opts.kind === 'pack' || (opts.kind === 'dashboard' && s.group !== group && (heavy.has(s.group) || heavy.has(group))));
    if (newPage) pdf.doc.addPage();
    group = s.group;
    pdfSection(pdf, s);
  });
  if (!doc.sections.length) pdf.note('Nothing to show.');
  return pdf.finish();
}

// ---------- XLSX ----------

function columnType(c: ResultColumn): CellType {
  if (c.role === 'agg') return c.fn === 'pct' ? 'percent' : c.type === 'currency' && c.fn !== 'count' ? 'currency' : 'number';
  if (c.role === 'dim' && c.bucket) return 'text';
  if (c.type === 'date') return 'date';
  if (c.type === 'datetime') return 'datetime';
  if (c.type === 'number') return 'number';
  if (c.type === 'currency') return 'currency';
  return 'text';
}

function sheetFor(s: DocSection, who: string, at: string): Sheet | null {
  const r = s.result;
  if (!r) return null;
  const mark = r.restricted ? watermark(who, at) : undefined;
  const preface = [s.title, ...(s.filters?.length ? [`Filters: ${s.filters.join('; ')}`] : []), `As at ${formatStamp(at)} · prepared for ${who}`, ...(r.countingNote ? [r.countingNote] : [])];
  if (r.pivot) {
    const p = r.pivot;
    return {
      name: s.title, preface, watermark: mark,
      columns: [{ header: r.columns[0].label, type: 'text' }, ...p.cols.map((c) => ({ header: c.label, type: 'number' as const })), { header: 'Total', type: 'number' }],
      rows: [...p.rows.map((row, i) => [row.label, ...p.cells[i].map((c) => c?.v ?? null), p.rowTotals[i]]), ['Total', ...p.colTotals, p.grand]],
    };
  }
  return {
    name: s.title, preface, watermark: mark,
    columns: r.columns.map((c) => ({ header: c.label, type: columnType(c) })),
    rows: r.rows.map((row) => r.columns.map((c) => {
      const t = columnType(c);
      // Labels (people, records, lookups, buckets) where they exist; raw values where the cell is typed.
      if (t === 'text') return row.d[c.key] ?? (row.v[c.key] === null || row.v[c.key] === undefined ? null : typeof row.v[c.key] === 'boolean' ? (row.v[c.key] ? 'Yes' : 'No') : row.v[c.key]);
      return row.v[c.key] ?? null;
    })),
  };
}

/** The workbook of a report, dashboard or pack: one sheet per section that has figures. */
export function documentXlsx(doc: DocInput): Buffer {
  const sheets = doc.sections.map((s) => sheetFor(s, doc.preparedFor, doc.generatedAt)).filter((s): s is Sheet => Boolean(s));
  const notes = doc.sections.filter((s) => !s.result && s.note);
  if (notes.length || !sheets.length) {
    sheets.push({
      name: 'Notes', preface: [doc.title, ...metaLines(doc)],
      columns: [{ header: 'Section', type: 'text' }, { header: 'Note', type: 'text' }],
      rows: notes.length ? notes.map((s) => [s.title, s.note]) : [[doc.title, 'Nothing to show.']],
    });
  }
  return Buffer.from(writeXlsx({ title: doc.title, author: doc.preparedFor, sheets }));
}

// ---------- one entry point for every format ----------

export type FileKind = 'csv' | 'html' | 'xlsx' | 'pdf';
export const EXPORT_KINDS: FileKind[] = ['csv', 'html', 'xlsx', 'pdf'];
export const FORMAT_NAMES: Record<FileKind, string> = { csv: 'CSV', html: 'a print-ready document', xlsx: 'Excel (XLSX)', pdf: 'PDF' };
export const FILE_TYPES: Record<FileKind, string> = {
  csv: 'text/csv; charset=utf-8', html: 'text/html; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pdf: 'application/pdf',
};

/** The document in one format. `sourceType` is the record type it was made from (report_definition, dashboard, report_pack). */
export async function renderFile(doc: BuiltDocument, kind: FileKind, sourceType: string): Promise<string | Buffer> {
  if (kind === 'csv' && doc.csv !== undefined) return doc.csv;
  if (kind === 'xlsx') return documentXlsx(doc.input);
  if (kind === 'pdf') return documentPdf(doc.input, { kind: sourceType === 'dashboard' ? 'dashboard' : sourceType === 'report_pack' ? 'pack' : 'report' });
  return doc.html;
}