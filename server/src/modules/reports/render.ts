// Export renderers: CSV, and a self-contained print-ready HTML document (no scripts, no outside
// resources) that the browser saves as PDF. Restricted content is watermarked as the core export is.
import { CURRENCY } from '../../core/config.ts';
import { guardFormula } from '../../core/export/csv.ts';
import type { PrintBranding } from '../../core/organization.ts';
import type { ReportResult, ResultColumn, ResultRow } from './query.ts';
import { formatStamp } from './query.ts';

/** Byte-order mark: tells spreadsheet programs the CSV is UTF-8 (as the core export does). */
const BOM = String.fromCharCode(0xfeff);

export const esc =(s: unknown) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  s = guardFormula(s); // stop spreadsheet formula injection (core/export/csv.ts, W17-5)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: /^[A-Z]{3}$/.test(CURRENCY) ? CURRENCY : 'USD' });
const plain = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** A cell as a person reads it. */
export function cellText(col: ResultColumn, row: ResultRow): string {
  const v = row.v[col.key];
  if (row.d[col.key] !== undefined) return row.d[col.key];
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return col.fn === 'pct' ? `${plain.format(v)}%` : col.type === 'currency' ? money.format(v) : plain.format(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}
const num = (v: number | null, fn?: string) => (v === null ? '' : fn === 'pct' ? `${plain.format(v)}%` : plain.format(v));

export const watermark = (who: string, at: string) => `Restricted export by ${who} at ${at}`;

export function toCsv(r: ReportResult, who: string): string {
  const lines: string[] = [];
  if (r.pivot) {
    const p = r.pivot;
    lines.push([r.columns[0].label, ...p.cols.map((c) => c.label), 'Total'].map(csvCell).join(','));
    p.rows.forEach((row, i) => lines.push([row.label, ...p.cells[i].map((c) => c?.v ?? ''), p.rowTotals[i] ?? ''].map(csvCell).join(',')));
    lines.push(['Total', ...p.colTotals.map((v) => v ?? ''), p.grand ?? ''].map(csvCell).join(','));
  } else {
    lines.push(r.columns.map((c) => csvCell(c.label)).join(','));
    // Numbers stay raw in CSV so that a spreadsheet can add them up.
    for (const row of r.rows) lines.push(r.columns.map((c) => csvCell(row.d[c.key] ?? row.v[c.key])).join(','));
  }
  if (r.restricted) lines.push(csvCell(watermark(who, r.generatedAt)));
  return BOM + lines.join('\r\n');
}

// ---------- safe text ----------

const inline = (s: string) => esc(s)
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');

/** A small, safe subset of Markdown: headings, paragraphs, bullet and numbered lists, bold and italic. No HTML passes through. */
export function markdownToHtml(source: unknown): string {
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const block of String(source ?? '').slice(0, 20000).split(/\r?\n/)) {
    const line = block.trim();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const li = /^(?:[-*]|(\d+)[.)])\s+(.*)$/.exec(line);
    if (li) {
      const kind = li[1] ? 'ol' : 'ul';
      if (list !== kind) { close(); out.push(`<${kind}>`); list = kind; }
      out.push(`<li>${inline(li[2])}</li>`);
      continue;
    }
    close();
    if (h) out.push(`<h${h[1].length + 2}>${inline(h[2])}</h${h[1].length + 2}>`);
    else if (line) out.push(`<p>${inline(line)}</p>`);
  }
  close();
  return out.join('\n');
}

// ---------- HTML document ----------

export interface DocSection {
  title: string;
  description?: string | null;
  result?: ReportResult;
  /** Chart kind chosen for the report; anything grouped gets bars in print. */
  chart?: string;
  markdown?: string;
  /** Shown instead of content: "not available" and the like. */
  note?: string;
  /** The report's own filters in words ("Status is any of New, Open"). */
  filters?: string[];
  /** Dashboards: the band of the grid the widget sits in; the PDF starts a new page for each band. */
  group?: number;
}
export interface DocInput {
  title: string;
  subtitle?: string | null;
  cover?: boolean;
  sections: DocSection[];
  preparedFor: string;
  generatedAt: string;
  appName?: string;
  /** The organization for the PDF's footer and logo (Administration > Organization). */
  branding?: PrintBranding | null;
  filtersNote?: string;
}

function bars(r: ReportResult): string {
  const dim = r.columns.find((c) => c.role === 'dim');
  const agg = r.columns.find((c) => c.role === 'agg');
  if (!dim || !agg || r.columns.filter((c) => c.role === 'dim').length !== 1) return '';
  const rows = r.rows.slice(0, 24).filter((row) => typeof row.v[agg.key] === 'number');
  const max = Math.max(0, ...rows.map((row) => row.v[agg.key] as number));
  if (!rows.length || max <= 0) return '';
  return `<div class="bars" role="img" aria-label="${esc(agg.label)} by ${esc(dim.label)}">${rows.map((row) => {
    const v = row.v[agg.key] as number;
    return `<div class="bar"><span class="bar-name">${esc(row.d[dim.key])}</span><span class="bar-track"><span class="bar-fill" style="width:${Math.max(0.5, (v / max) * 100).toFixed(1)}%"></span></span><span class="bar-value">${esc(num(v, agg.fn))}</span></div>`;
  }).join('')}</div>`;
}

function table(r: ReportResult): string {
  if (r.pivot) {
    const p = r.pivot;
    return `<table><thead><tr><th>${esc(r.columns[0].label)}</th>${p.cols.map((c) => `<th class="n">${esc(c.label)}</th>`).join('')}<th class="n">Total</th></tr></thead><tbody>${
      p.rows.map((row, i) => `<tr><th>${esc(row.label)}</th>${p.cells[i].map((c) => `<td class="n">${c ? esc(num(c.v)) : ''}</td>`).join('')}<td class="n t">${esc(num(p.rowTotals[i]))}</td></tr>`).join('')
    }</tbody><tfoot><tr><th>Total</th>${p.colTotals.map((v) => `<td class="n">${esc(num(v))}</td>`).join('')}<td class="n">${esc(num(p.grand))}</td></tr></tfoot></table>`;
  }
  const numeric = (c: ResultColumn) => c.role === 'agg' || c.type === 'number' || c.type === 'currency';
  return `<table><thead><tr>${r.columns.map((c) => `<th${numeric(c) ? ' class="n"' : ''}>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${
    r.rows.map((row) => `<tr>${r.columns.map((c) => `<td${numeric(c) ? ' class="n"' : ''}>${esc(cellText(c, row))}</td>`).join('')}</tr>`).join('')
  }</tbody></table>`;
}

function section(s: DocSection): string {
  const head = `<h2>${esc(s.title)}</h2>${s.description ? `<p class="lede">${esc(s.description)}</p>` : ''}${s.filters?.length ? `<p class="meta">Filters: ${esc(s.filters.join('; '))}</p>` : ''}`;
  if (s.note) return `<section>${head}<p class="note">${esc(s.note)}</p></section>`;
  if (s.markdown !== undefined) return `<section class="text">${head}${markdownToHtml(s.markdown)}</section>`;
  const r = s.result;
  if (!r) return `<section>${head}</section>`;
  let body: string;
  if (r.mode === 'total') {
    body = `<div class="figures">${r.columns.map((c) => `<div class="figure"><span class="figure-value">${esc(cellText(c, r.rows[0] ?? { v: {}, d: {} }) || '0')}</span><span class="figure-label">${esc(c.label)}</span></div>`).join('')}</div>`;
  } else if (!r.rows.length) {
    body = '<p class="note">No records match.</p>';
  } else {
    body = `${r.mode === 'groups' && !r.pivot && s.chart !== 'table' ? bars(r) : ''}${table(r)}`;
  }
  const foot = `${r.total} ${(r.total === 1 ? r.typeLabel : r.plural).toLowerCase()}${r.truncated ? ' (the list is cut short; export to CSV for every row)' : ''}`;
  const counting = r.countingNote ? `<p class="foot">${esc(r.countingNote)}</p>` : '';
  return `<section>${head}${body}${counting}<p class="foot">${esc(foot)}</p></section>`;
}

const CSS = `
*{box-sizing:border-box}:root{--brand:#17656f}body{margin:0;font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#14252b;background:#f3f6f6}
main{max-width:960px;margin:0 auto;padding:32px 40px;background:#fff;min-height:100vh}
h1{font-size:28px;margin:0 0 4px;line-height:1.2}h2{font-size:18px;margin:0 0 6px}h3,h4,h5{font-size:15px;margin:16px 0 4px}
.meta,.lede,.foot,.note{color:#50626a}.meta{margin:0 0 4px}.foot{font-size:12px;margin:8px 0 0}
.note{padding:12px 16px;background:#edf2f3;border-radius:8px}
.cover{min-height:70vh;display:flex;flex-direction:column;justify-content:center;border-bottom:2px solid var(--brand);margin-bottom:32px;page-break-after:always}
.cover h1{font-size:40px}.cover .rule{width:72px;height:6px;border-radius:3px;background:var(--brand);margin:0 0 24px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.head{border-bottom:2px solid var(--brand);padding-bottom:12px;margin-bottom:24px}
.org{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:0 0 20px;color:var(--brand);font-weight:600}
.org img{display:block;max-height:48px;max-width:220px;width:auto;height:auto}.cover .org{margin-bottom:48px}.cover .org img{max-height:72px}
.org-foot{border-top:1px solid #dbe3e5;margin-top:40px;padding-top:12px;color:#50626a;font-size:12px}.org-foot p{margin:0}
section{margin:0 0 32px;page-break-inside:avoid}section.text{page-break-inside:auto}
table{border-collapse:collapse;width:100%;font-size:13px;margin-top:12px}th,td{text-align:left;padding:6px 10px;border-bottom:1px solid #dbe3e5;vertical-align:top}
thead th{background:#edf2f3;font-weight:600}tfoot td,tfoot th,td.t{font-weight:600}.n{text-align:right;font-variant-numeric:tabular-nums}
.bars{display:grid;gap:6px;margin:12px 0 4px}.bar{display:grid;grid-template-columns:minmax(120px,28%) 1fr 64px;gap:12px;align-items:center;font-size:13px}
.bar-track{height:14px;background:#edf2f3;border-radius:0 4px 4px 0}.bar-fill{display:block;height:100%;background:#2a78d6;border-radius:0 4px 4px 0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.bar-value{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}.bar-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.figures{display:flex;flex-wrap:wrap;gap:16px;margin-top:12px}.figure{border:1px solid #dbe3e5;border-radius:8px;padding:12px 20px;min-width:160px}
.figure-value{display:block;font-size:32px;font-weight:600;line-height:1.1}.figure-label{color:#50626a;font-size:13px}
.watermark{border:1px solid #d03b3b;color:#951b1b;background:#fde2e0;padding:8px 12px;border-radius:6px;margin:0 0 20px;font-weight:600;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.hint{color:#50626a;font-size:12px;margin:0 0 20px}
@page{margin:16mm}@media print{body{background:#fff}main{padding:0;max-width:none}.hint{display:none}thead{display:table-header-group}}
`;

const DATA_URI_RE = /^data:image[/](png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const HEX_RE = /^#[0-9a-f]{6}$/i;

/**
 * The organization on the document (Administration > Organization, E14-36), as on the PDF: its
 * logo and name at the top, its brand color for the rules, and its name, address and contacts
 * in a footer. The logo is carried in the file (a data: address), so the document still loads
 * nothing from outside.
 */
function organization(doc: DocInput) {
  const b = doc.branding;
  const logo = b?.logoDataUri && DATA_URI_RE.test(b.logoDataUri) ? b.logoDataUri : null;
  const name = b?.name || doc.appName || '';
  const color = b?.color && HEX_RE.test(b.color) ? b.color : null;
  const top = logo || b?.name
    ? `<div class="org">${logo ? `<img src="${logo}" alt="${esc(name)}">` : `<span>${esc(name)}</span>`}</div>`
    : '';
  const names = [...new Set([b?.name, doc.appName].filter((n): n is string => Boolean(n)))];
  const foot = names.length || b?.lines.length
    ? `<footer class="org-foot">${names.length ? `<p><strong>${esc(names.join(' · '))}</strong></p>` : ''}${(b?.lines ?? []).map((l) => `<p>${esc(l)}</p>`).join('')}</footer>`
    : '';
  return { top, foot, style: color ? `:root{--brand:${color}}` : '' };
}

export function htmlDocument(doc: DocInput): string {
  const restricted = doc.sections.some((s) => s.result?.restricted);
  const org = organization(doc);
  const when = formatStamp(doc.generatedAt);
  const meta = `<p class="meta">As at ${esc(when)} · prepared for ${esc(doc.preparedFor)}${doc.appName ? ` · ${esc(doc.appName)}` : ''}</p>${doc.filtersNote ? `<p class="meta">${esc(doc.filtersNote)}</p>` : ''}`;
  const mark = restricted ? `<p class="watermark">${esc(watermark(doc.preparedFor, doc.generatedAt))}. Contains restricted records: do not pass on.</p>` : '';
  const head = doc.cover
    ? `<div class="cover">${org.top}<div class="rule"></div><h1>${esc(doc.title)}</h1>${doc.subtitle ? `<p class="lede">${esc(doc.subtitle)}</p>` : ''}${meta}</div>`
    : `${org.top}<div class="head"><h1>${esc(doc.title)}</h1>${doc.subtitle ? `<p class="lede">${esc(doc.subtitle)}</p>` : ''}${meta}</div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(doc.title)}</title><style>${CSS}${org.style}</style></head>`
    + `<body><main>${head}${mark}<p class="hint">To save this as a PDF, use your browser's Print command and choose "Save as PDF".</p>${doc.sections.map(section).join('')}${org.foot}</main></body></html>`;
}
