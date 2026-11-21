import { describe, expect, it } from 'vitest';
import { describeReport, typeSearchPlaceholder } from './describe';
import { startersFor } from './starters';
import type { CatalogField, CatalogType } from './types';

const f = (path: string, label: string, type: CatalogField['type'], extra: Partial<CatalogField> = {}): CatalogField =>
  ({ path, label, type, group: type !== 'longtext' && type !== 'json', sum: type === 'number' || type === 'currency', column: true, ...extra });

const tickets: CatalogType = {
  type: 'ticket', label: 'Ticket', plural: 'Tickets', route: '/tickets', module: 'tickets', description: '', restricted: false,
  titleField: 'title', refField: 'ref', canExport: true, globals: {},
  fields: [
    f('ref', 'Reference', 'text'), f('title', 'Title', 'text'),
    f('status', 'Status', 'lookup', { list: 'ticket_status' }), f('priority', 'Priority', 'lookup', { list: 'ticket_priority' }),
    f('assignee_id', 'Assignee', 'user'), f('cost', 'Cost', 'currency'), f('opened_at', 'Opened', 'datetime'),
    f('cf_lines', 'Lines served', 'lookup', { list: 'cf_lines', multiple: true, group: false }),
    f('site_id.name', 'Site: Name', 'text', { via: 'Site' }),
  ],
};
const labels: Record<string, string> = { new: 'New', open: 'In progress', high: 'High', red: 'Red line', blue: 'Blue line' };
const labelFor = (_list: string, v: unknown) => labels[String(v)] ?? String(v);

describe('a report in one plain sentence (E12-13)', () => {
  it('describes a list with its filters and order', () => {
    expect(describeReport({ type: 'ticket', columns: ['ref', 'title', 'status'], sort: [{ by: 'opened_at', dir: 'desc' }],
      filters: { op: 'and', items: [{ field: 'status', op: 'in', value: ['new', 'open'] }, { field: 'opened_at', op: 'last_days', value: 30 }] } }, tickets, labelFor))
      .toBe('A list of tickets (3 columns), where status is any of New or In progress and opened in the last 30 days, sorted by opened, highest or newest first.');
  });

  it('describes a summary with its totals, groups and nested conditions', () => {
    expect(describeReport({
      type: 'ticket', groupBy: [{ field: 'opened_at', bucket: 'month' }, { field: 'priority' }], aggregates: [{ fn: 'count' }, { fn: 'sum', field: 'cost' }],
      filters: { op: 'and', items: [{ field: 'assignee_id', op: 'me' }, { op: 'or', items: [{ field: 'priority', op: 'in', value: ['high'] }, { field: 'cf_lines', op: 'in', value: ['red', 'blue'] }] }] },
    }, tickets, labelFor)).toBe('The number of tickets and the total cost, grouped by opened (by month) then priority, where assignee is me and (priority is any of High or lines served has any of Red line or Blue line).');
    expect(describeReport({ type: 'ticket', aggregates: [{ fn: 'avg', field: 'cost' }] }, tickets, labelFor)).toBe('The average cost of tickets.');
  });

  it('offers one-click starts that suit the record type', () => {
    const starts = startersFor(tickets);
    expect(starts.map((s) => s.label)).toEqual(['Count by status', 'Tickets each month', 'By assignee', 'Status by priority']);
    expect(starts[1].spec.groupBy).toEqual([{ field: 'opened_at', bucket: 'month' }]);
    // Multi-choice and related fields are never offered as groups.
    expect(starts.flatMap((s) => s.spec.groupBy ?? []).some((g) => g.field === 'cf_lines' || g.field.includes('.'))).toBe(false);
  });
});

describe('the record type search box (BW-05)', () => {
  it('names only the record types offered here', () => {
    expect(typeSearchPlaceholder([{ plural: 'Risks' }, { plural: 'Assets' }, { plural: 'Systems' }, { plural: 'Policies' }])).toBe('Search: risks, assets, systems…');
    expect(typeSearchPlaceholder([])).toBe('Search record types');
  });
});
