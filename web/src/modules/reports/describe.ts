// A report in one plain sentence, shown above the preview so that what the report does can be
// read at a glance: "The number of tickets, grouped by priority, where status is any of New or
// In progress." Pure, so it is tested without a browser.
import { opsFor } from './ops';
import { isGroup, type CatalogField, type CatalogType, type Condition, type FilterGroup, type ReportSpec } from './types';

/** How to name a value of a lookup list (the application's own `lookupLabel` in the builder). */
export type LabelFor = (list: string, value: unknown) => string;

const lower = (s: string) => (s && s.charAt(0) === s.charAt(0).toUpperCase() && s.slice(1, 2) !== s.slice(1, 2).toUpperCase() ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const list = (items: string[], joiner = 'or') => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} ${joiner} ${items[items.length - 1]}`);
const BUCKET: Record<string, string> = { day: 'day', week: 'week', month: 'month', quarter: 'quarter', year: 'year' };

function value(c: Condition & { label?: string }, f: CatalogField, labelFor: LabelFor, joiner: string): string {
  const v = c.value;
  const many = Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v];
  if (f.type === 'lookup') return list(many.map((x) => labelFor(f.list ?? '', x)), joiner);
  if (f.type === 'user' || f.type === 'ref') return c.label ? c.label : f.type === 'user' ? 'a chosen person' : 'a chosen record';
  if (f.type === 'text' || f.type === 'longtext') return `“${String(v ?? '')}”`;
  return String(v ?? '');
}

function condition(c: Condition & { label?: string }, fields: CatalogField[], labelFor: LabelFor): string | null {
  const f = fields.find((x) => x.path === c.field);
  const op = f ? opsFor(f.type, f.multiple).find((o) => o.op === c.op) : undefined;
  if (!f || !op) return null;
  const name = lower(f.label);
  const pair = Array.isArray(c.value) ? c.value : [];
  switch (op.input) {
    case 'none': return `${name} ${op.label}`;
    case 'days': return `${name} ${op.label.replace('…', String(c.value ?? '…'))}`;
    case 'numbers': case 'dates': return `${name} ${op.label} ${pair[0] ?? '…'} and ${pair[1] ?? '…'}`;
    default: return `${name} ${op.label} ${value(c, f, labelFor, 'or')}`;
  }
}

function group(g: FilterGroup, fields: CatalogField[], labelFor: LabelFor, nested = false): string | null {
  const parts = g.items.map((item) => (isGroup(item) ? group(item, fields, labelFor, true) : condition(item, fields, labelFor))).filter((p): p is string => Boolean(p));
  if (!parts.length) return null;
  const joiner = g.op === 'or' ? 'or' : 'and';
  const shown = parts.length > 4 ? [...parts.slice(0, 3), `${parts.length - 3} more conditions`] : parts;
  const text = list(shown, joiner);
  return nested && parts.length > 1 ? `(${text})` : text;
}

export function describeReport(spec: ReportSpec, type: CatalogType, labelFor: LabelFor): string {
  const fields = type.fields;
  const label = (path?: string) => lower(fields.find((f) => f.path === path)?.label ?? path ?? '');
  const plural = type.plural.toLowerCase();
  const where = spec.filters ? group(spec.filters, fields, labelFor) : null;
  const summary = Boolean(spec.groupBy?.length || spec.aggregates?.length);
  let out: string;
  if (summary) {
    const aggs = spec.aggregates?.length ? spec.aggregates : [{ fn: 'count' as const }];
    const what = aggs.map((a) => {
      const f = fields.find((x) => x.path === a.field);
      const dated = f?.type === 'date' || f?.type === 'datetime';
      switch (a.fn) {
        case 'count': return `the number of ${plural}`;
        case 'pct': return a.field ? `each group's share of the total ${label(a.field)}` : 'each group\'s share of them';
        case 'sum': return `the total ${label(a.field)}`;
        case 'avg': return `the average ${label(a.field)}`;
        case 'min': return `the ${dated ? 'earliest' : 'lowest'} ${label(a.field)}`;
        case 'max': return `the ${dated ? 'latest' : 'highest'} ${label(a.field)}`;
        default: return '';
      }
    }).filter(Boolean);
    const groups = (spec.groupBy ?? []).filter((g) => g.field).map((g) => `${label(g.field)}${g.bucket ? ` (by ${BUCKET[g.bucket]})` : ''}`);
    out = `${list(what, 'and')}${aggs.some((a) => a.fn !== 'count') && !aggs.some((a) => a.fn === 'count') ? ` of ${plural}` : ''}`;
    if (groups.length) out += `, grouped by ${groups.join(' then ')}${spec.pivot && groups.length === 2 ? ' as a pivot table' : ''}`;
  } else {
    const cols = spec.columns?.length ?? 0;
    out = `a list of ${plural}${cols ? ` (${cols} ${cols === 1 ? 'column' : 'columns'})` : ''}`;
  }
  if (where) out += `, where ${where}`;
  const s = spec.sort?.[0];
  if (s && !summary) out += `, sorted by ${label(s.by)}${s.dir === 'desc' ? ', highest or newest first' : ''}`;
  return `${out.charAt(0).toUpperCase()}${out.slice(1)}.`;
}

/**
 * The search box's example words, from the record types actually offered (BW-05): a fixed list would
 * name types of switched-off areas, or types this person may not report on.
 */
export function typeSearchPlaceholder(types: { plural: string }[]): string {
  const names = types.slice(0, 3).map((t) => t.plural.toLowerCase());
  return names.length ? `Search: ${names.join(', ')}…` : 'Search record types';
}
