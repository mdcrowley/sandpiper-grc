// Pieces shared by the inventory pages: date helpers, callouts, and the "Changes and issues" tab.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Badge, Group, Paper, SimpleGrid, Stack, Text } from '@mantine/core';
import {
  EmptyState, ErrorState, FieldValue, formatDate, Icon, Loading, timeZone, useAuth, useFetch, useResource,
} from '../../core';
import type { ColorName, IconName, ListResult, Row } from '../../core';

/** Today as YYYY-MM-DD in the organisation's time zone. */
export function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone() }).format(new Date());
}

/** Whole days from today to a YYYY-MM-DD date (negative when it has passed), or null without a date. */
export function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  const utc = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((utc(String(date).slice(0, 10)) - utc(todayIso())) / 86_400_000);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "in 43 days", "today", "12 days ago". */
export function daysPhrase(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${plural(days, 'day')}` : `${plural(-days, 'day')} ago`;
}

const CALLOUT_ICON: Record<string, IconName> = { blue: 'info', amber: 'alert', red: 'lock', green: 'check-circle', gray: 'info' };

/** A short message box in one of the status colours. */
export function Callout({ color = 'blue', title, children, action }: { color?: ColorName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <Alert role="note" color={color} variant="light" title={title} icon={<Icon name={CALLOUT_ICON[color] ?? 'info'} size={18} />} className="inv-callout">
      {children}
      {action && <div className="inv-callout-action">{action}</div>}
    </Alert>
  );
}

/* ---------- Changes and issues ---------- */

interface WorkList {
  type: string;
  title: string;
  /** Extra list filter that narrows to open records, by field that must exist. */
  open?: { field: string; query: string };
  columns: string[];
  sort: string;
  empty: string;
}

const WORK: WorkList[] = [
  { type: 'change', title: 'Changes', columns: ['status', 'planned_start'], sort: 'sort=planned_start&dir=desc', empty: 'No change records name this' },
  { type: 'ticket', title: 'Open tickets', open: { field: 'resolved_at', query: 'f.resolved_at.null=true' }, columns: ['status', 'priority'], sort: 'sort=opened_at&dir=desc', empty: 'No open tickets for this' },
  { type: 'vulnerability', title: 'Open vulnerabilities', open: { field: 'closed', query: 'f.closed=false' }, columns: ['severity', 'due_on'], sort: 'sort=first_seen&dir=desc', empty: 'No open vulnerabilities on this' },
];

function WorkCard({ list, field, id, noun }: { list: WorkList; field: string; id: string; noun: string }) {
  const resource = useResource(list.type);
  const { can } = useAuth();
  const allowed = !!resource && can(`${resource.module}.view`) && !!resource.fields[field];
  const openQuery = resource && list.open && resource.fields[list.open.field] ? `&${list.open.query}` : '';
  const sort = resource && resource.fields[list.sort.split(/[=&]/)[1]] ? `&${list.sort}` : '';
  const { data, error, reload } = useFetch<ListResult<Row>>(allowed ? `${resource.path}?f.${field}=${id}${openQuery}${sort}&pageSize=6` : null);
  if (!resource || !allowed) return null;
  const all = `${resource.route}?f.${field}=${id}${openQuery}`;
  return (
    <Paper withBorder radius="md" className="inv-work">
      <Group justify="space-between" wrap="nowrap" className="inv-work-head">
        <Text fw={650} size="sm" component="h3">{list.title}</Text>
        {data && <Badge color={data.total ? 'blue' : 'gray'} variant="light" aria-label={`${data.total} in total`}>{data.total}</Badge>}
      </Group>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={3} />
        : data.rows.length === 0 ? <Text c="dimmed" size="sm" className="inv-work-empty">{list.empty} {noun}.</Text>
        : (
          <ul className="inv-work-list">
            {data.rows.map((r) => (
              <li key={r.id}>
                <Link to={`${resource.route}/${r.id}`} className="inv-work-title">
                  {resource.refField && r[resource.refField] ? <><span className="ref">{String(r[resource.refField])}</span>{" "}</> : null}
                  {String(r[resource.titleField] ?? '')}
                </Link>
                <span className="inv-work-meta">
                  {list.columns.filter((c) => resource.fields[c] && r[c] != null && r[c] !== '').map((c) => (
                    resource.fields[c].type === 'lookup'
                      ? <FieldValue key={c} resource={resource} field={c} row={r} compact />
                      : <span key={c} className="muted">{resource.fields[c].label} {resource.fields[c].type === 'date' || resource.fields[c].type === 'datetime' ? formatDate(r[c]) : String(r[c])}</span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      {data && data.total > 0 && <Link className="inv-work-all" to={all}>{data.total > data.rows.length ? `See all ${data.total}` : 'Open as a list'}</Link>}
    </Paper>
  );
}

/**
 * Change records, open tickets and open vulnerabilities that name this system or asset. Each
 * list appears only when that module is installed and the reader may see its records.
 */
export function RelatedWork({ field, id, noun }: { field: 'system_id' | 'asset_id'; id: string; noun: string }) {
  const { can } = useAuth();
  const change = useResource('change');
  const ticket = useResource('ticket');
  const vulnerability = useResource('vulnerability');
  const any = [change, ticket, vulnerability].some((r) => r && can(`${r.module}.view`) && r.fields[field]);
  if (!any) {
    return <EmptyState icon="refresh" title="Nothing to show here" message="Changes, tickets and vulnerabilities appear here when those parts of the application are in use and you may see them." />;
  }
  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
        {WORK.map((w) => <WorkCard key={w.type} list={w} field={field} id={id} noun={noun} />)}
      </SimpleGrid>
      <Text c="dimmed" size="sm">
        A record is listed when its {field === 'system_id' ? 'system' : 'asset'} field names this {noun}. Other records linked by hand are on the Related tab.
      </Text>
    </Stack>
  );
}
