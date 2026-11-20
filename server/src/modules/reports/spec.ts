// The report query specification and its compiler. Everything a client sends is checked against
// the resource registry here: a field name reaches SQL only after it has been found among the
// declared fields of a record type the caller may view, and every value travels as a parameter.
import { TIME_ZONE, todayInZone } from '../../core/config.ts';
import { UUID_RE } from '../../core/errors.ts';
import { DETAIL_TYPES, MASKED_SQL } from '../../core/resource.ts';
import type { FieldDef, FieldType, ModuleContext, ResourceDef, SessionUser } from '../../core/module.ts';
import { customDefs, customSql, type CustomDefs } from './custom.ts';

export const LIMITS = {
  columns: 30, conditions: 40, depth: 3, aggregates: 6, inValues: 200,
  rows: 1000, exportRows: 20000, groups: 2000, pivotColumns: 60, textLength: 200,
  timeoutMs: 15000, concurrent: 4,
};

export type Bucket = 'day' | 'week' | 'month' | 'quarter' | 'year';
export const BUCKETS: Bucket[] = ['day', 'week', 'month', 'quarter', 'year'];
export type AggFn = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'pct';
export const AGG_FNS: AggFn[] = ['count', 'sum', 'avg', 'min', 'max', 'pct'];

export interface Condition { field: string; op: string; value?: unknown }
export interface FilterGroup { op: 'and' | 'or'; items: (Condition | FilterGroup)[] }
export interface GroupSpec { field: string; bucket?: Bucket }
export interface AggSpec { fn: AggFn; field?: string }
export interface SortSpec { by: string; dir?: 'asc' | 'desc' }

export interface ReportSpec {
  type: string;
  columns?: string[];
  filters?: FilterGroup;
  groupBy?: GroupSpec[];
  aggregates?: AggSpec[];
  pivot?: boolean;
  sort?: SortSpec[];
  limit?: number;
}

/** Dashboard-wide filters. Each applies to a report only when its record type has a matching field. */
export interface GlobalFilters { from?: string; to?: string; department?: string; site?: string; system?: string; owner?: string }
export const GLOBAL_KINDS = ['date', 'department', 'site', 'system', 'owner'] as const;

export const STD_FIELDS: Record<string, FieldDef> = {
  created_at: { label: 'Created', type: 'datetime' },
  updated_at: { label: 'Updated', type: 'datetime' },
  created_by: { label: 'Created by', type: 'user' },
};

/** Fields of a person that can be reached through a `user` field. */
export const USER_SUBFIELDS: Record<string, { label: string; type: FieldType; sql: (a: string) => string }> = {
  email: { label: 'email', type: 'text', sql: (a) => `${a}.email` },
  department: { label: 'department', type: 'text', sql: (a) => `(select d.name from departments d where d.id = ${a}.department_id)` },
};

const IDENT = /^[a-z_][a-z0-9_]*$/;
/** Stands for the record-count subquery until the FROM and WHERE clauses are known. */
const RECORDS = '__records__';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RELATED_TYPES: FieldType[] = ['text', 'number', 'currency', 'date', 'datetime', 'boolean', 'lookup'];

export class SpecError extends Error {
  field?: string;
  constructor(message: string, field?: string) { super(message); this.field = field; }
}

/** May `user` (null = the system) report on this record type at all? The same rule as the generic list. */
export function mayView(ctx: ModuleContext, user: SessionUser | null, def: ResourceDef, action = 'view'): boolean {
  if (!user) return true;
  return ctx.can(user, `${def.module}.${action}`) && (def.restricted !== true || ctx.can(user, 'security.view'));
}

/** Record types of this module are not reportable: their sharing rules are not row rules the engine knows. */
export const reportable = (def: ResourceDef) => def.module !== 'reports' && def.module !== 'dashboards';

export interface ResolvedField {
  path: string;
  label: string;
  def: FieldDef;
  /** SQL expression (aliases only; never client text). */
  sql: string;
  /** Set when the field lives on a related record. */
  related?: { via: string; target: ResourceDef | null };
  /**
   * Figures only: SQL that is true when this value is a detail of a restricted record. Such a
   * value is never matched by a condition and is grouped as "Restricted records".
   */
  mask?: string;
}

export interface CompiledDim extends ResolvedField { key: string; bucket?: Bucket; expr: string }
export interface CompiledAgg { key: string; fn: AggFn; label: string; expr: string; type: FieldType; field?: ResolvedField }

export interface Compiled {
  def: ResourceDef;
  spec: ReportSpec;
  mode: 'rows' | 'groups' | 'total';
  from: string;
  where: string;
  params: unknown[];
  columns: ResolvedField[];
  dims: CompiledDim[];
  aggs: CompiledAgg[];
  /** ORDER BY terms built from validated fields and keys only. */
  order: string[];
  /**
   * Grouped by a multi-choice field (E12-15): the FROM clause with each record repeated once per
   * value (a record with no value appears once, as "None"). `from` stays one row per record, for
   * the count of records.
   */
  groupFrom?: string;
  /** Filters expressed as generic-list address parameters, for drill-down. */
  drill: { params: [string, string][]; exact: boolean };
  globalsApplied: string[];
  /** Every record type whose data can appear (the base type and joined ones). */
  types: ResourceDef[];
  /**
   * A figure (grouped or totalled, not about "me"): worked out over every record, the same for
   * everyone who may run it. Rows (a list of records) are worked out as the caller.
   */
  figures: boolean;
}

/** Whether a filter group uses "me" anywhere: the figure is then the caller's own. */
function usesMe(g: unknown, depth = 0): boolean {
  if (!g || typeof g !== 'object' || depth > LIMITS.depth + 1) return false;
  const items = (g as FilterGroup).items;
  if (!Array.isArray(items)) return (g as Condition).op === 'me';
  return items.some((item) => usesMe(item, depth + 1));
}

/** Which field of a record type a dashboard-wide filter applies to, or null when it has none. */
export function globalField(def: ResourceDef, kind: string, dateField?: string): string | null {
  const fields = { ...def.fields, ...STD_FIELDS };
  const first = (names: string[]) => names.find((n) => fields[n]) ?? null;
  if (kind === 'date') {
    if (dateField && fields[dateField] && ['date', 'datetime'].includes(fields[dateField].type)) return dateField;
    return 'created_at';
  }
  if (kind === 'department') return first(['department', 'requester_department']);
  if (kind === 'site') return Object.keys(def.fields).find((n) => def.fields[n].type === 'ref' && def.fields[n].to === 'site') ?? null;
  if (kind === 'system') return Object.keys(def.fields).find((n) => def.fields[n].type === 'ref' && def.fields[n].to === 'system') ?? null;
  if (kind === 'owner') {
    return first(['owner_id', 'assignee_id', 'business_owner_id', 'project_manager_id', 'lead_id'])
      ?? Object.keys(def.fields).find((n) => def.fields[n].type === 'user') ?? null;
  }
  return null;
}

export function compile(
  ctx: ModuleContext, user: SessionUser | null, raw: unknown,
  opts: { globals?: GlobalFilters; dateField?: string; now?: Date; custom?: CustomDefs } = {},
): Compiled {
  const spec = (raw && typeof raw === 'object' ? raw : {}) as ReportSpec;
  const def = typeof spec.type === 'string' ? ctx.resources.get(spec.type) : undefined;
  if (!def || !reportable(def)) throw new SpecError('Choose what to report on.', 'type');

  const params: unknown[] = [];
  const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
  // A literal, not a parameter: it comes from validated server configuration (as core/db.ts uses it),
  // and every parameter must be used by every query built from this compilation (data and count).
  const tz = () => `'${TIME_ZONE.replace(/[^A-Za-z0-9_+\-/]/g, '')}'`;
  const today = todayInZone(opts.now ?? new Date());
  const joins: string[] = [];
  const joined = new Map<string, string>();
  const types = new Map<string, ResourceDef>([[def.type, def]]);
  const custom = opts.custom ?? {};
  const baseFields: Record<string, FieldDef> = { ...STD_FIELDS, ...def.fields, ...custom };
  const columnSql = (name: string, f: FieldDef) => (custom[name] && !def.fields[name] ? customSql('t', name, f) : `t.${name}`);

  // Figures are the same for everyone (docs/security.md, "Figures"): grouped and totalled reports
  // count every record, and a restricted record's details are masked for everyone rather than
  // left out for some. A list of records, or a figure about "me", is worked out as the caller.
  const aggregate = (Array.isArray(spec.groupBy) && spec.groupBy.length > 0) || (Array.isArray(spec.aggregates) && spec.aggregates.length > 0);
  const figures = aggregate && !usesMe(spec.filters) && opts.globals?.owner !== 'me';
  const viewer = figures ? null : user;
  /** Figures only: true for a restricted row of `d` under `alias` (rows of a wholly restricted type are seen only by people who may see them all). */
  const flagged = (d: ResourceDef, alias: string) => (figures && d.restricted === 'flag' ? `coalesce(${alias}.restricted, false)` : undefined);

  function resolve(path: unknown): ResolvedField {
    if (typeof path !== 'string' || path.length > 130) throw new SpecError('A field name is not valid.');
    const [name, sub, extra] = path.split('.');
    const f = baseFields[name];
    if (extra !== undefined || !f || !IDENT.test(name)) throw new SpecError(`"${path}" is not a field of ${def!.plural.toLowerCase()}.`, path);
    if (sub === undefined) return { path, label: f.label, def: f, sql: columnSql(name, f), mask: DETAIL_TYPES.has(f.type) ? flagged(def!, 't') : undefined };
    if (!IDENT.test(sub)) throw new SpecError(`"${path}" is not a field that can be used.`, path);
    if (f.type === 'user') {
      const uf = USER_SUBFIELDS[sub];
      if (!uf) throw new SpecError(`"${path}" is not a field that can be used.`, path);
      let alias = joined.get(name);
      if (!alias) {
        alias = `u${joined.size}`;
        joined.set(name, alias);
        joins.push(`left join users ${alias} on ${alias}.id::text = ${columnSql(name, f)}::text`);
      }
      return { path, label: `${f.label}: ${uf.label}`, def: { label: uf.label, type: uf.type }, sql: uf.sql(alias), related: { via: name, target: null }, mask: flagged(def!, 't') };
    }
    if (f.type === 'ref') {
      const target = ctx.resources.get(f.to!);
      const tf = target ? ({ ...STD_FIELDS, ...target.fields } as Record<string, FieldDef>)[sub] : undefined;
      if (!target || !tf || !RELATED_TYPES.includes(tf.type)) throw new SpecError(`"${path}" is not a field that can be used.`, path);
      if (!mayView(ctx, user, target)) throw new SpecError(`You do not have access to ${target.plural.toLowerCase()}, so "${f.label}: ${tf.label}" cannot be used.`, path);
      let alias = joined.get(name);
      if (!alias) {
        alias = `j${joined.size}`;
        joined.set(name, alias);
        // In a list, a related record the caller may not see joins as "nothing": no value, no group, no count.
        // In a figure every related record joins, and its words are masked when it is restricted.
        joins.push(`left join ${target.table} ${alias} on ${alias}.id::text = ${columnSql(name, f)}::text and ${alias}.deleted_at is null`
          + ` and ${ctx.resources.visibleWhere(target.type, viewer, alias)}`);
      }
      types.set(target.type, target);
      return { path, label: `${f.label}: ${tf.label}`, def: tf, sql: `${alias}.${sub}`, related: { via: name, target }, mask: DETAIL_TYPES.has(tf.type) ? flagged(target, alias) : undefined };
    }
    throw new SpecError(`"${path}" is not a field that can be used.`, path);
  }

  // ---------- filters ----------

  let conditions = 0;
  const dateExpr = (f: ResolvedField) => (f.def.type === 'datetime' ? `(${f.sql} at time zone ${tz()})::date` : f.sql);
  const dateValue = (v: unknown, f: ResolvedField): string => {
    const raw = String(v ?? '');
    const s = raw.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(raw) || !DATE_RE.test(s) || Number.isNaN(Date.parse(s))) throw new SpecError(`${f.label}: give a date.`, f.path);
    return s;
  };
  const numberValue = (v: unknown, f: ResolvedField): number => {
    const n = typeof v === 'number' ? v : Number(String(v ?? '').trim() || NaN);
    if (!Number.isFinite(n)) throw new SpecError(`${f.label}: give a number.`, f.path);
    return n;
  };
  const listValue = (v: unknown, f: ResolvedField): string[] => {
    const arr = (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]).map((x) => String(x));
    if (!arr.length) throw new SpecError(`${f.label}: choose at least one value.`, f.path);
    if (arr.length > LIMITS.inValues || arr.some((x) => x.length > LIMITS.textLength)) throw new SpecError(`${f.label}: too many values.`, f.path);
    return arr;
  };
  const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

  /** A date condition as a half-open range of calendar days in the organization time zone. */
  function dateRange(c: Condition, f: ResolvedField): { from?: string; to?: string } | null {
    const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
    const ymd = (yy: number, mm: number) => `${yy + Math.floor((mm - 1) / 12)}-${String(((mm - 1) % 12 + 12) % 12 + 1).padStart(2, '0')}-01`;
    const days = () => { const n = numberValue(c.value, f); if (n < 0 || n > 36500) throw new SpecError(`${f.label}: give a number of days.`, f.path); return Math.round(n); };
    switch (c.op) {
      case 'eq': { const d = dateValue(c.value, f); return { from: d, to: shift(d, 1) }; }
      case 'lt': return { to: dateValue(c.value, f) };
      case 'lte': return { to: shift(dateValue(c.value, f), 1) };
      case 'gt': return { from: shift(dateValue(c.value, f), 1) };
      case 'gte': return { from: dateValue(c.value, f) };
      case 'between': {
        const [a, b] = Array.isArray(c.value) ? c.value : [];
        return { from: dateValue(a, f), to: shift(dateValue(b, f), 1) };
      }
      case 'last_days': return { from: shift(today, -days() + 1), to: shift(today, 1) };
      case 'next_days': return { from: today, to: shift(today, days() + 1) };
      case 'this_month': return { from: ymd(y, m), to: ymd(y, m + 1) };
      case 'this_quarter': { const q = Math.floor((m - 1) / 3) * 3 + 1; return { from: ymd(y, q), to: ymd(y, q + 3) }; }
      case 'this_year': return { from: `${y}-01-01`, to: `${y + 1}-01-01` };
      case 'past': return { to: today };
      case 'future': return { from: shift(today, 1) };
      default: return null;
    }
  }

  type Drill = [string, string][] | null;
  /** A condition; in a figure, one that reads a restricted record's details never matches it (blank or not still does). */
  function condition(c: Condition): { sql: string; drill: Drill } {
    const mask = resolve(c?.field).mask;
    const out = conditionOf(c);
    const op = String(c.op ?? '');
    return mask && op !== 'empty' && op !== 'nempty' ? { sql: `(not ${mask} and ${out.sql})`, drill: out.drill } : out;
  }
  function conditionOf(c: Condition): { sql: string; drill: Drill } {
    conditions += 1;
    if (conditions > LIMITS.conditions) throw new SpecError(`A report can have at most ${LIMITS.conditions} conditions.`);
    const f = resolve(c.field);
    const t = f.def.type;
    const simple = !f.related;
    const key = `f.${f.path}`;
    const op = String(c.op ?? '');
    if (f.def.multiple) {
      // A multi-choice field (a JSON list of values): has any of, has none of, has none at all, has some.
      if (op === 'empty' || op === 'nempty') return { sql: `jsonb_array_length(${f.sql}) ${op === 'empty' ? '=' : '>'} 0`, drill: null };
      if (op !== 'in' && op !== 'nin') throw new SpecError(`${f.label}: that comparison is not available for a field with several values.`, f.path);
      const values = listValue(c.value, f);
      const any = `jsonb_exists_any(${f.sql}, ${add(values)}::text[])`;
      return op === 'in'
        ? { sql: any, drill: simple && !values.some((v) => v.includes(',')) ? [[key, values.join(',')]] : null }
        : { sql: `not ${any}`, drill: null };
    }
    if (op === 'empty' || op === 'nempty') {
      const blank = t === 'text' || t === 'longtext' ? `(${f.sql} is null or ${f.sql}::text = '')` : `${f.sql} is null`;
      return { sql: op === 'empty' ? blank : `not ${blank}`, drill: simple ? [[`${key}.null`, String(op === 'empty')]] : null };
    }
    if (t === 'json') throw new SpecError(`${f.label} can only be tested for being empty.`, f.path);
    if (t === 'boolean') {
      if (op !== 'true' && op !== 'false') throw new SpecError(`${f.label}: choose yes or no.`, f.path);
      return { sql: `coalesce(${f.sql}, false) = ${op}`, drill: simple ? [[key, op]] : null };
    }
    if (t === 'date' || t === 'datetime') {
      const r = dateRange(c, f);
      if (!r) throw new SpecError(`${f.label}: that comparison is not available for dates.`, f.path);
      const parts: string[] = [];
      const drill: [string, string][] = [];
      if (r.from) { parts.push(`${dateExpr(f)} >= ${add(r.from)}::date`); drill.push([`${key}.gte`, r.from]); }
      if (r.to) { parts.push(`${dateExpr(f)} < ${add(r.to)}::date`); drill.push([`${key}.lt`, r.to]); }
      return { sql: `(${parts.join(' and ')})`, drill: simple ? drill : null };
    }
    if (t === 'number' || t === 'currency') {
      const sym: Record<string, string> = { eq: '=', ne: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };
      if (op === 'between') {
        const [a, b] = Array.isArray(c.value) ? c.value : [];
        const lo = numberValue(a, f); const hi = numberValue(b, f);
        return { sql: `(${f.sql} >= ${add(lo)}::numeric and ${f.sql} <= ${add(hi)}::numeric)`, drill: simple ? [[`${key}.gte`, String(lo)], [`${key}.lte`, String(hi)]] : null };
      }
      if (!sym[op]) throw new SpecError(`${f.label}: that comparison is not available for numbers.`, f.path);
      const n = numberValue(c.value, f);
      return {
        sql: `${f.sql} ${sym[op]} ${add(n)}::numeric`,
        drill: !simple || op === 'ne' ? null : op === 'eq' ? [[key, String(n)]] : [[`${key}.${op}`, String(n)]],
      };
    }
    if (op === 'me') {
      if (t !== 'user' || f.related) throw new SpecError(`${f.label}: "me" only applies to people.`, f.path);
      return { sql: `${f.sql}::text = ${add(user?.id ?? '')}`, drill: [[key, 'me']] };
    }
    if (op === 'eq' || op === 'in' || op === 'ne' || op === 'nin') {
      const values = listValue(c.value, f);
      if ((t === 'user' || t === 'ref') && values.some((v) => !UUID_RE.test(v))) throw new SpecError(`${f.label}: choose from the list.`, f.path);
      const positive = op === 'eq' || op === 'in';
      const sql = positive ? `${f.sql}::text = any(${add(values)}::text[])` : `(${f.sql} is null or not (${f.sql}::text = any(${add(values)}::text[])))`;
      return { sql, drill: simple && positive && !values.some((v) => v.includes(',')) ? [[key, values.join(',')]] : null };
    }
    if (t === 'text' || t === 'longtext') {
      const text = String(c.value ?? '').trim().slice(0, LIMITS.textLength);
      if (!text) throw new SpecError(`${f.label}: type some text to look for.`, f.path);
      const esc = text.replace(/[%_\\]/g, '\\$&');
      if (op === 'contains') return { sql: `${f.sql}::text ilike ${add(`%${esc}%`)}`, drill: null };
      if (op === 'ncontains') return { sql: `(${f.sql} is null or ${f.sql}::text not ilike ${add(`%${esc}%`)})`, drill: null };
      if (op === 'starts') return { sql: `${f.sql}::text ilike ${add(`${esc}%`)}`, drill: null };
    }
    throw new SpecError(`${f.label}: that comparison is not available.`, f.path);
  }

  function group(g: FilterGroup, depth: number): { sql: string; drill: Drill } {
    if (depth > LIMITS.depth) throw new SpecError('Condition groups are nested too deeply.');
    if (!g || !Array.isArray(g.items)) throw new SpecError('The conditions are not valid.');
    const op = g.op === 'or' ? 'or' : 'and';
    const parts = g.items.map((item) => (item && Array.isArray((item as FilterGroup).items) ? group(item as FilterGroup, depth + 1) : condition(item as Condition)));
    if (!parts.length) return { sql: 'true', drill: [] };
    const exact = (op === 'and' || parts.length === 1) && parts.every((p) => p.drill !== null);
    return { sql: `(${parts.map((p) => p.sql).join(` ${op} `)})`, drill: exact ? parts.flatMap((p) => p.drill!) : null };
  }

  const where = [`t.deleted_at is null`, ctx.resources.visibleWhere(def.type, viewer, 't')];
  const drill: Compiled['drill'] = { params: [], exact: true };
  if (spec.filters !== undefined && spec.filters !== null) {
    const g = group(spec.filters, 1);
    where.push(g.sql);
    if (g.drill) drill.params.push(...g.drill); else drill.exact = false;
  }

  // ---------- dashboard-wide filters ----------

  const globalsApplied: string[] = [];
  const g = opts.globals ?? {};
  const applyGlobal = (kind: string, c: (field: string) => Condition | null) => {
    const field = globalField(def, kind, opts.dateField);
    const cond = field ? c(field) : null;
    if (!cond) return;
    const out = condition(cond);
    where.push(out.sql);
    if (out.drill) drill.params.push(...out.drill);
    globalsApplied.push(kind);
  };
  if (g.from || g.to) {
    applyGlobal('date', (field) => (g.from && g.to ? { field, op: 'between', value: [g.from, g.to] } : g.from ? { field, op: 'gte', value: g.from } : { field, op: 'lte', value: g.to }));
  }
  if (g.department) applyGlobal('department', (field) => ({ field, op: 'eq', value: String(g.department) }));
  if (g.site) applyGlobal('site', (field) => ({ field, op: 'eq', value: String(g.site) }));
  if (g.system) applyGlobal('system', (field) => ({ field, op: 'eq', value: String(g.system) }));
  if (g.owner) applyGlobal('owner', (field) => (g.owner === 'me' ? { field, op: 'me' } : { field, op: 'eq', value: String(g.owner) }));

  // ---------- grouping and aggregates ----------

  const groupBy = Array.isArray(spec.groupBy) ? spec.groupBy : [];
  const laterals: string[] = [];
  if (groupBy.length > 2) throw new SpecError('Group by one or two fields.', 'groupBy');
  const dims: CompiledDim[] = groupBy.map((gs, i) => {
    const f = resolve(gs?.field);
    const t = f.def.type;
    if (t === 'json' || t === 'longtext') throw new SpecError(`${f.label} cannot be used for grouping.`, f.path);
    if (f.def.multiple) {
      // Each record counts once under each of its values (E12-15); the result says so.
      if (f.related) throw new SpecError(`${f.label} cannot be used for grouping.`, f.path);
      laterals.push(`left join lateral jsonb_array_elements_text(${f.sql}) mv${i}(v) on true`);
      return { ...f, key: `g${i}`, expr: `mv${i}.v` };
    }
    const isDate = t === 'date' || t === 'datetime';
    let bucket = isDate ? gs.bucket ?? (t === 'datetime' ? 'month' : undefined) : undefined;
    if (gs.bucket !== undefined && (!isDate || !BUCKETS.includes(gs.bucket))) throw new SpecError(`${f.label}: that date grouping is not available.`, f.path);
    if (isDate && !bucket) bucket = 'day';
    const expr = isDate
      // Bucket boundaries fall on the organization's calendar, not the server's or the browser's.
      ? `date_trunc('${bucket}', ${t === 'datetime' ? `(${f.sql} at time zone ${tz()})` : `${f.sql}::timestamp`})`
      : f.mask ? `case when ${f.mask} and ${f.sql} is not null then ${MASKED_SQL} else ${f.sql}::text end`
      : `${f.sql}::text`;
    return { ...f, key: `g${i}`, bucket, expr };
  });
  if (dims.length === 2 && dims[0].path === dims[1].path && dims[0].bucket === dims[1].bucket) throw new SpecError('Choose two different fields to group by.', 'groupBy');

  const rawAggs = Array.isArray(spec.aggregates) ? spec.aggregates : [];
  if (rawAggs.length > LIMITS.aggregates) throw new SpecError(`A report can have at most ${LIMITS.aggregates} totals.`, 'aggregates');
  const aggList: AggSpec[] = rawAggs.length ? rawAggs : dims.length ? [{ fn: 'count' }] : [];
  const aggs: CompiledAgg[] = aggList.map((a, i) => {
    const key = `a${i}`;
    if (!a || !AGG_FNS.includes(a.fn)) throw new SpecError('A total is not valid.', 'aggregates');
    if (a.fn === 'count') return { key, fn: a.fn, label: `Number of ${def.plural.toLowerCase()}`, expr: laterals.length ? 'count(distinct t.id)::int' : 'count(*)::int', type: 'number' };
    if (a.fn === 'pct' && !a.field) {
      // Grouped by a multi-choice field, a share is of the records (the shares may add up to more than 100).
      if (laterals.length) return { key, fn: a.fn, label: 'Share of records', expr: `round(count(distinct t.id) * 100.0 / nullif(${RECORDS}, 0), 1)`, type: 'number' };
      return { key, fn: a.fn, label: 'Share of total', expr: 'round(count(*) * 100.0 / nullif(sum(count(*)) over (), 0), 1)', type: 'number' };
    }
    const f = resolve(a.field);
    const t = f.def.type;
    const numeric = t === 'number' || t === 'currency';
    const dated = t === 'date' || t === 'datetime';
    if (!(numeric || (dated && (a.fn === 'min' || a.fn === 'max')))) throw new SpecError(`${f.label} cannot be totalled that way.`, f.path);
    if (a.fn === 'pct' && laterals.length) throw new SpecError(`A share of ${f.label.toLowerCase()} cannot be worked out while grouping by a field with several values: a record would be shared more than once.`, f.path);
    const names: Record<string, string> = { sum: 'Total', avg: 'Average', min: dated ? 'Earliest' : 'Lowest', max: dated ? 'Latest' : 'Highest', pct: 'Share of' };
    const expr = a.fn === 'pct' ? `round(sum(${f.sql}) * 100.0 / nullif(sum(sum(${f.sql})) over (), 0), 1)`
      : a.fn === 'avg' ? `round(avg(${f.sql})::numeric, 2)`
      : dated ? `${a.fn}(${f.sql})`
      : `${a.fn}(${f.sql})::numeric`;
    return { key, fn: a.fn, label: `${names[a.fn]} ${f.label.charAt(0).toLowerCase()}${f.label.slice(1)}`, expr, type: a.fn === 'pct' ? 'number' : t, field: f };
  });

  // ---------- columns ----------

  const mode: Compiled['mode'] = dims.length ? 'groups' : aggs.length ? 'total' : 'rows';
  let columns: ResolvedField[] = [];
  if (mode === 'rows') {
    const wanted = Array.isArray(spec.columns) && spec.columns.length
      ? spec.columns
      : [...(def.ref ? [def.ref.field] : []), def.titleField, ...Object.keys(def.fields).filter((n) => ['status', 'owner_id'].includes(n))];
    if (wanted.length > LIMITS.columns) throw new SpecError(`A report can have at most ${LIMITS.columns} columns.`, 'columns');
    columns = [...new Set(wanted)].map(resolve);
  }
  if (spec.pivot && dims.length !== 2) throw new SpecError('A pivot table needs two fields to group by.', 'pivot');

  // ---------- sort (resolved here so that a related sort field adds its join before FROM is built) ----------

  const order = (Array.isArray(spec.sort) ? spec.sort.slice(0, 3) : []).map((s) => {
    const dir = s?.dir === 'desc' ? 'desc' : 'asc';
    if (mode === 'rows') {
      const f = resolve(s?.by);
      if (f.def.type === 'json') throw new SpecError(`${f.label} cannot be used for sorting.`, f.path);
      return `${f.sql} ${dir} nulls last`;
    }
    const k = [...dims, ...aggs].find((x) => x.key === s?.by);
    if (!k) throw new SpecError('The sort order is not valid.', 'sort');
    return `${k.key} ${dir} nulls last`;
  });

  const from = `${def.table} t ${joins.join(' ')}`;
  const whereSql = where.join(' and ');
  // The number of records (one row each), for shares when grouped by a multi-choice field.
  for (const a of aggs) a.expr = a.expr.replace(RECORDS, `(select count(*) from ${from} where ${whereSql})`);
  return {
    order,
    def, spec, mode, from, where: whereSql, params,
    ...(laterals.length ? { groupFrom: `${from} ${laterals.join(' ')}` } : {}),
    columns, dims, aggs, drill, globalsApplied, types: [...types.values()], figures,
  };
}

/** `compile`, with the record type's custom fields loaded first so that `cf_<key>` fields can be used. */
export async function compileWithCustom(
  ctx: ModuleContext, user: SessionUser | null, raw: unknown,
  opts: { globals?: GlobalFilters; dateField?: string; now?: Date } = {},
): Promise<Compiled> {
  const type = (raw as { type?: unknown } | null)?.type;
  const custom = typeof type === 'string' && ctx.resources.get(type) ? await customDefs(ctx, type) : {};
  return compile(ctx, user, raw, { ...opts, custom });
}
