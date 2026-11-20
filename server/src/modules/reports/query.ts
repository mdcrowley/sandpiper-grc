// Runs a compiled report: one parameterised query for the data, one for the count, then labels.
// The caller's permissions and the restricted-record rules were applied by the compiler: rows get
// the same visibility condition as the generic list; figures count every record and mask the
// details of restricted ones (spec.ts). Labels of related records are checked again here.
import { TIME_ZONE } from '../../core/config.ts';
import { UUID_RE } from '../../core/errors.ts';
import { MASKED_LABEL, MASKED_VALUE } from '../../core/resource.ts';
import type { FieldDef, FieldType, ModuleContext, ResourceDef, Row, SessionUser } from '../../core/module.ts';
import { compileWithCustom, LIMITS, mayView, SpecError, type Bucket, type Compiled, type GlobalFilters } from './spec.ts';

export interface ResultColumn {
  key: string; label: string; type: FieldType; role: 'column' | 'dim' | 'agg';
  field?: string; bucket?: Bucket; fn?: string; list?: string; to?: string;
  /** A grouping's values (display labels) in their natural order. */
  values?: string[];
  /** A multi-choice field: a record can hold several values. */
  multiple?: boolean;
}
export interface ResultRow {
  id?: string;
  /** Raw values by column key. */
  v: Record<string, unknown>;
  /** Display labels by column key, where the raw value is not what a person should read. */
  d: Record<string, string>;
  /** Configured color names (lookup values) by column key. */
  c?: Record<string, string>;
  /** Address parameters of the generic list that show the records behind this row. */
  drill?: string;
}
export interface Pivot {
  rows: { value: string | null; label: string; drill: string }[];
  cols: { value: string | null; label: string; color?: string; drill: string }[];
  cells: ({ v: number; drill: string } | null)[][];
  rowTotals: (number | null)[]; colTotals: (number | null)[]; grand: number | null;
  measure: string;
}
export interface ReportResult {
  type: string; typeLabel: string; plural: string; route: string;
  mode: 'rows' | 'groups' | 'total';
  columns: ResultColumn[];
  rows: ResultRow[];
  /** Records matching the filters (before grouping, before the row limit). */
  total: number;
  truncated: boolean;
  pivot?: Pivot;
  /** Address parameters for all matching records; `drillExact` is false when some filter has no list equivalent. */
  drill: string; drillExact: boolean;
  globalsApplied: string[];
  /**
   * Grouped by a multi-choice field (E12-15): how the figures count, in words, shown under the
   * table and chart and in every export. Absent otherwise.
   */
  countingNote?: string;
  /** True when restricted records are (or may be) among the figures: exports carry a watermark. */
  restricted: boolean;
  recordTypes: string[];
  generatedAt: string;
}

export interface RunOptions { globals?: GlobalFilters; dateField?: string; now?: Date; limit?: number; forExport?: boolean }

// ---------- limits ----------

let running = 0;
const waiting: (() => void)[] = [];

/** At most LIMITS.concurrent report queries at once, and none waits for an answer for ever. */
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  if (running >= LIMITS.concurrent) {
    if (waiting.length >= 20) throw new SpecError('The server is busy running other reports. Try again in a moment.');
    await new Promise<void>((res) => waiting.push(res));
  }
  running += 1;
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new SpecError('This report took too long to run. Add a filter or group by fewer values.')), LIMITS.timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    running -= 1;
    waiting.shift()?.();
  }
}

// ---------- labels ----------

const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dmy = (s: string) => `${MONTHS[Number(s.slice(5, 7)) - 1]} ${Number(s.slice(8, 10))}, ${s.slice(0, 4)}`;

export function bucketLabel(start: string, bucket: Bucket): string {
  const m = Number(start.slice(5, 7));
  if (bucket === 'year') return start.slice(0, 4);
  if (bucket === 'quarter') return `Q${Math.floor((m - 1) / 3) + 1} ${start.slice(0, 4)}`;
  if (bucket === 'month') return `${MONTHS[m - 1]} ${start.slice(0, 4)}`;
  if (bucket === 'week') return `Week of ${dmy(start)}`;
  return dmy(start);
}

/** The first day after a bucket that starts on `start`. */
export function bucketEnd(start: string, bucket: Bucket): string {
  const d = new Date(`${start}T00:00:00Z`);
  if (bucket === 'day') d.setUTCDate(d.getUTCDate() + 1);
  else if (bucket === 'week') d.setUTCDate(d.getUTCDate() + 7);
  else if (bucket === 'month') d.setUTCMonth(d.getUTCMonth() + 1);
  else if (bucket === 'quarter') d.setUTCMonth(d.getUTCMonth() + 3);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

const stamp = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
export const formatStamp = (v: unknown) => { const d = v instanceof Date ? v : new Date(String(v)); return Number.isNaN(d.getTime()) ? String(v) : stamp.format(d); };

interface Labeller {
  label(v: unknown): string | undefined; color?(v: unknown): string | undefined; order?(v: unknown): number;
  /** Set when a label names a restricted record the caller may see (the result then carries the export watermark). */
  revealed?: boolean;
}

async function labeller(ctx: ModuleContext, user: SessionUser | null, f: FieldDef, values: unknown[]): Promise<Labeller | null> {
  if (f.type === 'lookup') {
    const list = await ctx.lookups.values(f.list!);
    const find = (v: unknown) => list.find((x) => x.value === v);
    return { label: (v) => find(v)?.label, color: (v) => find(v)?.color ?? 'gray', order: (v) => { const i = list.findIndex((x) => x.value === v); return i < 0 ? 1e9 : i; } };
  }
  if (f.type === 'boolean') return { label: (v) => (v === true || v === 'true' ? 'Yes' : 'No') };
  const ids = [...new Set(values.filter((v): v is string => typeof v === 'string' && UUID_RE.test(v)))];
  if (f.type === 'user') {
    const rows = ids.length ? await ctx.db.query<{ id: string; display_name: string }>('select id, display_name from users where id = any($1::uuid[])', [ids]) : [];
    const names = new Map(rows.map((r) => [r.id, r.display_name]));
    return { label: (v) => names.get(String(v)) ?? 'Unknown user' };
  }
  if (f.type === 'ref') {
    const target = ctx.resources.get(f.to!);
    const names = new Map<string, string>();
    let revealed = false;
    if (target && ids.length) {
      // The label is a piece of the other record: without access to it the caller reads "Restricted".
      const open = mayView(ctx, user, target);
      const rows = await ctx.db.query<Row>(
        `select id, ${target.titleField}::text as label, (${ctx.resources.visibleWhere(target.type, user)}) as visible,
                ${target.restricted === 'flag' ? 'coalesce(restricted, false)' : target.restricted === true ? 'true' : 'false'} as flagged
         from ${target.table} where id::text = any($1::text[])`, [ids],
      );
      for (const r of rows) {
        const shown = open && r.visible;
        names.set(r.id, shown ? r.label ?? '' : 'Restricted');
        if (shown && r.flagged) revealed = true;
      }
    }
    return { label: (v) => names.get(String(v)) ?? 'Unknown', revealed };
  }
  return null;
}

const qsOf = (pairs: [string, string][]) => {
  const m = new Map<string, string>();
  for (const [k, v] of pairs) m.set(k, v); // a later (narrower) value for the same field wins
  return [...m].map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
};

// ---------- run ----------

export async function runCompiled(ctx: ModuleContext, user: SessionUser | null, c: Compiled, opts: RunOptions = {}): Promise<ReportResult> {
  const { def, dims, aggs, columns } = c;
  const cap = c.mode === 'rows' ? (opts.forExport ? LIMITS.exportRows : LIMITS.rows) : LIMITS.groups;
  const limit = Math.min(cap, Math.max(1, Math.floor(Number(opts.limit ?? c.spec.limit) || (c.mode === 'rows' && !opts.forExport ? 100 : cap))));

  let sql: string;
  if (c.mode === 'rows') {
    const order = [...c.order, `t.${def.defaultSort?.field ?? 'created_at'} ${def.defaultSort?.dir ?? 'desc'} nulls last`, 't.id'];
    sql = `select t.id${columns.map((f, i) => `, ${f.sql} as c${i}`).join('')}${def.restricted === 'flag' ? ', coalesce(t.restricted, false) as _restricted' : ''}
           from ${c.from} where ${c.where} order by ${order.join(', ')} limit ${limit + 1}`;
  } else if (c.mode === 'groups') {
    const dateDim = (i: number) => dims[i].bucket !== undefined;
    const order = c.order.length ? c.order : [dateDim(0) ? 'g0 asc' : 'a0 desc nulls last'];
    sql = `select ${dims.map((d, i) => (dateDim(i) ? `to_char(q.${d.key}, 'YYYY-MM-DD') as ${d.key}` : `q.${d.key}`)).join(', ')}, ${aggs.map((a) => `q.${a.key}`).join(', ')}
           from (select ${dims.map((d) => `${d.expr} as ${d.key}`).join(', ')}, ${aggs.map((a) => `${a.expr} as ${a.key}`).join(', ')}
                 from ${c.groupFrom ?? c.from} where ${c.where} group by ${dims.map((_, i) => i + 1).join(', ')}) q
           order by ${[...order, ...dims.map((d) => `q.${d.key} nulls last`)].join(', ')} limit ${limit + 1}`;
  } else {
    sql = `select ${aggs.map((a) => `${a.expr} as ${a.key}`).join(', ')} from ${c.from} where ${c.where}`;
  }

  const multi = c.mode === 'groups' && c.groupFrom !== undefined;
  const { data, total, flagged, distinct } = await guarded(async () => {
    const found = await ctx.db.query<Row>(sql, c.params);
    // A pivot grouped by a multi-choice field: its totals count each record once (E12-15).
    let once: { rows: Map<string, number>; cols: Map<string, number> } | undefined;
    if (multi && c.spec.pivot && dims.length === 2 && aggs[0]?.fn === 'count') {
      const by = async (d: typeof dims[number]) => {
        const sel = d.bucket ? `to_char(${d.expr}, 'YYYY-MM-DD')` : d.expr;
        const rows = await ctx.db.query<{ k: string | null; n: number }>(
          `select ${sel} as k, count(distinct t.id)::int as n from ${c.groupFrom} where ${c.where} group by 1`, c.params);
        return new Map(rows.map((r) => [r.k === null ? ' ' : String(r.k), r.n]));
      };
      once = { rows: await by(dims[0]), cols: await by(dims[1]) };
    }
    const count = (await ctx.db.one<{ n: number }>(`select count(*)::int n from ${c.from} where ${c.where}`, c.params))!.n;
    // A figure shows no restricted record's details (they are masked), so only rows decide this.
    const hasFlagged = def.restricted === 'flag' && !c.figures
      ? Boolean(await ctx.db.one(`select 1 from ${c.from} where ${c.where} and coalesce(t.restricted, false) limit 1`, c.params))
      : false;
    return { data: found, total: count, flagged: hasFlagged, distinct: once };
  });
  const truncated = data.length > limit;
  if (truncated) data.length = limit;

  const base = c.drill.params;
  const result: ReportResult = {
    type: def.type, typeLabel: def.label, plural: def.plural, route: def.route, mode: c.mode,
    columns: [], rows: [], total, truncated,
    drill: qsOf(base), drillExact: c.drill.exact && dims.every((d) => !d.related),
    globalsApplied: c.globalsApplied,
    restricted: c.types.some((t) => t.restricted === true) || flagged || data.some((r) => r._restricted === true),
    recordTypes: c.types.map((t) => t.type),
    generatedAt: (opts.now ?? new Date()).toISOString(),
  };

  if (c.mode === 'rows') {
    result.columns = columns.map((f, i) => ({ key: `c${i}`, label: f.label, type: f.def.type, role: 'column', field: f.path, list: f.def.list, to: f.def.to, ...(f.def.multiple ? { multiple: true } : {}) }));
    const labellers = await Promise.all(columns.map((f, i) => labeller(ctx, user, f.def, data.map((r) => r[`c${i}`]))));
    result.rows = data.map((r) => {
      const row: ResultRow = { id: r.id, v: {}, d: {} };
      columns.forEach((f, i) => {
        const k = `c${i}`;
        const v = r[k] instanceof Date ? r[k].toISOString() : r[k];
        row.v[k] = v ?? null;
        if (v === null || v === undefined) return;
        const lab = labellers[i];
        if (Array.isArray(v)) {
          // A multi-choice field: its labels, joined.
          if (!v.length) { row.v[k] = null; return; }
          row.d[k] = v.map((x) => lab?.label(x) ?? String(x)).join(', ');
        } else if (lab) {
          row.d[k] = lab.label(v) ?? String(v);
          const col = lab.color?.(v);
          if (col) (row.c ??= {})[k] = col;
        } else if (f.def.type === 'datetime') row.d[k] = formatStamp(v);
        else if (f.def.type === 'date') row.d[k] = dmy(String(v));
      });
      return row;
    });
    return result;
  }

  result.columns = [
    ...dims.map((d): ResultColumn => ({ key: d.key, label: d.label, type: d.def.type, role: 'dim', field: d.path, bucket: d.bucket, list: d.def.list, to: d.def.to, ...(d.def.multiple ? { multiple: true } : {}) })),
    ...aggs.map((a): ResultColumn => ({ key: a.key, label: a.label, type: a.type, role: 'agg', fn: a.fn, field: a.field?.path })),
  ];
  const labellers = await Promise.all(dims.map((d) => (d.bucket ? null : labeller(ctx, user, d.def, data.map((r) => r[d.key])))));
  if (labellers.some((l) => l?.revealed)) result.restricted = true;
  const dimDrill = (i: number, v: unknown): [string, string][] => {
    const d = dims[i];
    // Masked details: the list of the restricted records (which shows each person only those they may see).
    if (v === MASKED_VALUE) return def.fields.restricted ? [['f.restricted', 'true']] : [];
    if (d.related) return [];
    if (v === null || v === undefined) return [[`f.${d.path}.null`, 'true']];
    if (d.bucket) return [[`f.${d.path}.gte`, String(v)], [`f.${d.path}.lt`, bucketEnd(String(v), d.bucket)]];
    return [[`f.${d.path}`, String(v)]];
  };
  const dimLabel = (i: number, v: unknown) => (v === null || v === undefined ? 'None'
    : v === MASKED_VALUE ? MASKED_LABEL
    : dims[i].bucket ? bucketLabel(String(v), dims[i].bucket!)
    : labellers[i]?.label(v) ?? String(v));

  result.rows = data.map((r) => {
    const row: ResultRow = { v: {}, d: {} };
    const drill: [string, string][] = [...base];
    dims.forEach((d, i) => {
      row.v[d.key] = r[d.key] ?? null;
      row.d[d.key] = dimLabel(i, r[d.key]);
      const col = r[d.key] === null ? undefined : labellers[i]?.color?.(r[d.key]);
      if (col) (row.c ??= {})[d.key] = col;
      drill.push(...dimDrill(i, r[d.key]));
    });
    for (const a of aggs) {
      const v = r[a.key] instanceof Date ? r[a.key].toISOString() : r[a.key];
      row.v[a.key] = v ?? (a.fn === 'count' ? 0 : null);
      if (v !== null && v !== undefined && a.type === 'datetime') row.d[a.key] = formatStamp(v);
      if (v !== null && v !== undefined && a.type === 'date') row.d[a.key] = dmy(String(v));
    }
    if (dims.length) row.drill = qsOf(drill);
    return row;
  });

  // Lookup groups read best in their configured order (New, Open, Closed) unless a sort was asked for.
  if (c.mode === 'groups' && !c.order.length && labellers[0]?.order) {
    const pos = labellers[0].order;
    result.rows.sort((a, b) => (a.v.g0 === null ? 1e10 : pos(a.v.g0)) - (b.v.g0 === null ? 1e10 : pos(b.v.g0)));
  }

  // "Restricted records" (masked details) reads best last, like "None".
  if (result.rows.some((r) => r.v.g0 === MASKED_VALUE)) {
    result.rows = [...result.rows.filter((r) => r.v.g0 !== MASKED_VALUE), ...result.rows.filter((r) => r.v.g0 === MASKED_VALUE)];
  }

  // Each grouping's values in their natural order (a list's configured order, dates in time order,
  // words alphabetically; "None" and "Restricted records" last), so that the series of a chart and
  // the columns of a pivot read the same way whichever value happened to come first.
  dims.forEach((d, i) => {
    const seen = new Map<string, { v: unknown; label: string }>();
    for (const row of result.rows) if (!seen.has(row.d[d.key])) seen.set(row.d[d.key], { v: row.v[d.key], label: row.d[d.key] });
    const rank = (x: { v: unknown }) => (x.v === null || x.v === undefined ? 2 : x.v === MASKED_VALUE ? 1 : 0);
    const order = labellers[i]?.order;
    const sorted = [...seen.values()].sort((a, b) => rank(a) - rank(b)
      || (rank(a) ? 0 : d.bucket ? String(a.v).localeCompare(String(b.v)) : order ? order(a.v) - order(b.v) : a.label.localeCompare(b.label)));
    result.columns[i].values = sorted.map((x) => x.label);
  });
  // With no sort chosen, the second grouping follows that order inside each value of the first.
  if (dims.length === 2 && !c.order.length) {
    const first = new Map<string, number>();
    result.rows.forEach((r) => { if (!first.has(r.d.g0)) first.set(r.d.g0, first.size); });
    const pos = new Map((result.columns[1].values ?? []).map((label, i) => [label, i]));
    result.rows.sort((a, b) => first.get(a.d.g0)! - first.get(b.d.g0)! || (pos.get(a.d.g1) ?? 0) - (pos.get(b.d.g1) ?? 0));
  }

  if (c.spec.pivot && dims.length === 2) result.pivot = pivot(result, dims[1].bucket ? null : labellers[1], qsOf, base, dimDrill, multi ? { distinct, total } : undefined);
  if (multi) result.countingNote = countingNote(dims.filter((d) => d.def.multiple).map((d) => d.label), total, def.plural, Boolean(result.pivot));
  return result;
}

/**
 * The sentence that explains figures grouped by a multi-choice field. It is made from the report's
 * fields and the number of matching records only, so it reads the same for everyone.
 */
export function countingNote(fields: string[], total: number, plural: string, pivot: boolean): string {
  const names = fields.length === 1 ? fields[0] : fields.join(' and ');
  const things = plural.toLowerCase();
  return `A record with several values in ${names} is counted once under each of them, so the groups can add up to more than the ${total} ${things} that match.`
    + (pivot ? ' The totals count each record once.' : '')
    + ` Records with no value are counted under "None".`;
}

/** Turns two-dimension groups into a matrix of the first measure, with totals where they add up. */
function pivot(
  r: ReportResult, colLabeller: Labeller | null, qs: typeof qsOf, base: [string, string][],
  dimDrill: (i: number, v: unknown) => [string, string][],
  multi?: { distinct?: { rows: Map<string, number>; cols: Map<string, number> }; total: number },
): Pivot {
  const measure = r.columns.find((col) => col.role === 'agg')!;
  const keyOf = (v: unknown) => (v === null ? '\u0000' : String(v));
  const rows = new Map<string, Pivot['rows'][number]>();
  const cols = new Map<string, Pivot['cols'][number]>();
  for (const row of r.rows) {
    if (!rows.has(keyOf(row.v.g0))) rows.set(keyOf(row.v.g0), { value: row.v.g0 as string | null, label: row.d.g0, drill: qs([...base, ...dimDrill(0, row.v.g0)]) });
    if (!cols.has(keyOf(row.v.g1))) cols.set(keyOf(row.v.g1), { value: row.v.g1 as string | null, label: row.d.g1, color: row.c?.g1, drill: qs([...base, ...dimDrill(1, row.v.g1)]) });
  }
  const colList = [...cols.values()];
  const order = colLabeller?.order;
  colList.sort((a, b) => (a.value === null ? 1 : b.value === null ? -1
    : order ? order(a.value) - order(b.value)
    : r.columns[1].bucket ? String(a.value).localeCompare(String(b.value)) : a.label.localeCompare(b.label)));
  if (colList.length > LIMITS.pivotColumns) throw new SpecError(`The pivot table would have ${colList.length} columns. Choose a column field with fewer values, or a wider date grouping.`, 'pivot');
  const rowList = [...rows.values()];
  const ri = new Map(rowList.map((x, i) => [keyOf(x.value), i]));
  const ci = new Map(colList.map((x, i) => [keyOf(x.value), i]));
  const cells: Pivot['cells'] = rowList.map(() => colList.map(() => null));
  for (const row of r.rows) {
    const v = row.v[measure.key];
    if (typeof v === 'number') cells[ri.get(keyOf(row.v.g0))!][ci.get(keyOf(row.v.g1))!] = { v, drill: row.drill ?? '' };
  }
  // Grouped by a multi-choice field, cells do not add up: totals count distinct records, and are left
  // out for any other measure.
  if (multi) {
    const d = multi.distinct;
    return {
      rows: rowList, cols: colList, cells, measure: measure.label,
      rowTotals: rowList.map((x) => (d ? d.rows.get(keyOf(x.value)) ?? 0 : null)),
      colTotals: colList.map((x) => (d ? d.cols.get(keyOf(x.value)) ?? 0 : null)),
      grand: d ? multi.total : null,
    };
  }
  const adds = measure.fn === 'count' || measure.fn === 'sum';
  const sum = (xs: (number | undefined)[]) => (adds ? xs.reduce<number>((n, x) => n + (x ?? 0), 0) : null);
  return {
    rows: rowList, cols: colList, cells, measure: measure.label,
    rowTotals: cells.map((line) => sum(line.map((x) => x?.v))),
    colTotals: colList.map((_, j) => sum(cells.map((line) => line[j]?.v))),
    grand: sum(cells.flat().map((x) => x?.v)),
  };
}

/** Validate and run a specification as `user` (null = the system). Throws SpecError for anything the caller got wrong. */
export async function runReport(ctx: ModuleContext, user: SessionUser | null, spec: unknown, opts: RunOptions = {}): Promise<ReportResult> {
  // Access is decided before anything about the record type (its fields, its values) can be learned.
  const type = (spec as { type?: unknown } | null)?.type;
  const def = typeof type === 'string' ? ctx.resources.get(type) : undefined;
  if (def && !mayView(ctx, user, def)) throw new AccessError(def);
  return runCompiled(ctx, user, await compileWithCustom(ctx, user, spec, opts), opts);
}

/** The caller may not view the record type a report is built on. */
export class AccessError extends Error {
  def: ResourceDef;
  constructor(def: ResourceDef) { super(`You do not have access to ${def.plural.toLowerCase()}.`); this.def = def; }
}
