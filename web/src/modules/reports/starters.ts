// Ready-made shapes for a new report, offered as one-click starts in the builder: a count by
// status, a monthly trend, who carries what, and a breakdown by two choices. Each keeps the
// filters already set, and Undo brings back what was there.
import type { CatalogField, CatalogType, ChartSpec, ReportSpec } from './types';

export interface Starter { key: string; label: string; hint: string; spec: Omit<ReportSpec, 'type' | 'filters'>; chart: ChartSpec }

const own = (f: CatalogField) => !f.via && !f.multiple && f.group;

export function startersFor(type: CatalogType): Starter[] {
  const fields = type.fields.filter(own);
  const pick = (names: string[], kind: CatalogField['type'][]) =>
    names.map((n) => fields.find((f) => f.path === n && kind.includes(f.type))).find(Boolean) ?? fields.find((f) => kind.includes(f.type));
  const status = pick(['status', 'stage', 'state'], ['lookup']);
  const second = pick(['priority', 'severity', 'criticality', 'category', 'type'], ['lookup']);
  const other = second && second.path !== status?.path ? second : fields.find((f) => f.type === 'lookup' && f.path !== status?.path);
  const when = pick(['opened_at', 'reported_at', 'occurred_at', 'discovered_at', 'created_at'], ['datetime', 'date']);
  const owner = pick(['owner_id', 'assignee_id', 'technical_owner_id', 'business_owner_id', 'project_manager_id'], ['user']);
  const lowerLabel = (f: CatalogField) => f.label.charAt(0).toLowerCase() + f.label.slice(1);
  const out: Starter[] = [];
  if (status) {
    out.push({ key: 'count', label: `Count by ${lowerLabel(status)}`, hint: `How many ${type.plural.toLowerCase()} there are at each ${lowerLabel(status)}.`, spec: { groupBy: [{ field: status.path }], aggregates: [{ fn: 'count' }] }, chart: { kind: 'bar' } });
  }
  if (when) {
    out.push({ key: 'trend', label: `${type.plural} each month`, hint: `By ${lowerLabel(when)}, month by month.`, spec: { groupBy: [{ field: when.path, bucket: 'month' }], aggregates: [{ fn: 'count' }] }, chart: { kind: 'line' } });
  }
  if (owner) {
    out.push({ key: 'owner', label: `By ${lowerLabel(owner)}`, hint: 'Who carries the most, largest first.', spec: { groupBy: [{ field: owner.path }], aggregates: [{ fn: 'count' }], sort: [{ by: 'a0', dir: 'desc' }] }, chart: { kind: 'hbar' } });
  }
  if (status && other) {
    out.push({ key: 'split', label: `${status.label} by ${lowerLabel(other)}`, hint: 'Each bar split by a second choice.', spec: { groupBy: [{ field: status.path }, { field: other.path }], aggregates: [{ fn: 'count' }] }, chart: { kind: 'stacked' } });
  }
  return out;
}
