import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, ErrorState, formatDate, Loading, PageHeader, ResourceList, Stat, useFetch, useMeta } from '../../core';
import type { Row } from '../../core';
import { ActionStatus } from './ActionStatus';

interface Group { value: string | null; label: string; open: number; overdue: number; owner_id?: string | null }
interface ActionSummary {
  open: number;
  overdue: number;
  due_this_week: number;
  unassigned: number;
  today: string;
  week_end: string;
  open_statuses: string[];
  by_owner: Group[];
  by_source: Group[];
  by_department: Group[];
}

type ViewKey = 'open' | 'mine' | 'overdue' | 'week' | 'requests' | 'all';
const VIEWS: { key: ViewKey; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'mine', label: 'My actions' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'week', label: 'Due this week' },
  { key: 'requests', label: 'Information requests' },
  { key: 'all', label: 'All' },
];

function GroupTable({ title, heading, groups, active, onPick }: {
  title: string; heading: string; groups: Group[]; active: string | null | undefined; onPick: (g: Group) => void;
}) {
  return (
    <Card title={title} flush={groups.length > 0}>
      {groups.length === 0 ? <p className="muted">No open actions.</p> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">{heading}</th><th scope="col" className="num">Open</th><th scope="col" className="num">Overdue</th></tr></thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.value ?? 'none'}>
                  <td>
                    <Button variant="ghost" size="sm" aria-pressed={active === (g.value ?? 'none')} onClick={() => onPick(g)}>{g.label}</Button>
                  </td>
                  <td className="num">{g.open}</td>
                  <td className={`num${g.overdue > 0 ? ' is-overdue' : ''}`}>{g.overdue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** The cross-module list the CIO reviews weekly. */
export function ActionTracker() {
  const { resources } = useMeta();
  const { data, error, reload } = useFetch<ActionSummary>('/api/actions/summary');
  const [view, setView] = useState<ViewKey>('open');
  const [group, setGroup] = useState<{ field: 'owner_id' | 'source'; value: string | null; label: string } | null>(null);
  const [version, setVersion] = useState(0);

  const baseFilter = useMemo(() => {
    if (!data) return undefined;
    const open = data.open_statuses.join(',');
    const f: Record<string, string> = {};
    if (view === 'open') f.status = open;
    if (view === 'mine') { f.owner_id = 'me'; f.status = open; }
    if (view === 'overdue') { f['due_on.lt'] = data.today; f.status = open; }
    if (view === 'week') { f['due_on.gte'] = data.today; f['due_on.lte'] = data.week_end; f.status = open; }
    if (view === 'requests') f.source = 'information_request';
    if (group) {
      if (group.value === null) f[`${group.field}.null`] = 'true'; else f[group.field] = group.value;
      if (!f.status && view !== 'all' && view !== 'requests') f.status = open;
    }
    return f;
  }, [data, view, group]);

  if (error) return <><PageHeader title="Action tracker" /><ErrorState error={error} onRetry={reload} /></>;
  if (!data) return <><PageHeader title="Action tracker" /><Loading /></>;

  const pick = (field: 'owner_id' | 'source') => (g: Group) =>
    setGroup(group?.field === field && group.value === g.value ? null : { field, value: g.value, label: g.label });
  const sourceLink = (row: Row) => {
    const target = row.source_type ? resources[row.source_type] : undefined;
    return target && row.source_id
      ? <Link to={`${target.route}/${row.source_id}`} onClick={(e) => e.stopPropagation()}>{target.label}</Link>
      : null;
  };

  return (
    <div className="stack">
      <PageHeader title="Action tracker" subtitle="Actions arising from risks, assessments, incidents, audits, exercises and information requests." />
      <div className="grid-stats">
        <Stat label="Open" value={data.open} color="blue" />
        <Stat label="Overdue" value={data.overdue} color={data.overdue > 0 ? 'red' : 'green'} />
        <Stat label="Due this week" value={data.due_this_week} color="amber" />
        <Stat label="Unassigned" value={data.unassigned} color="gray" />
      </div>
      <div className="grid-2">
        <GroupTable title="Open by owner" heading="Owner" groups={data.by_owner} active={group?.field === 'owner_id' ? group.value ?? 'none' : undefined} onPick={pick('owner_id')} />
        <GroupTable title="Open by source" heading="Source" groups={data.by_source} active={group?.field === 'source' ? group.value ?? 'none' : undefined} onPick={pick('source')} />
      </div>

      <div className="view-tabs" role="group" aria-label="Views">
        {VIEWS.map((v) => (
          <Button key={v.key} size="sm" variant={view === v.key ? 'primary' : 'secondary'} aria-pressed={view === v.key} onClick={() => setView(v.key)}>
            {v.label}
          </Button>
        ))}
        {group && <Button size="sm" variant="ghost" icon="x" onClick={() => setGroup(null)}>{group.label}: clear</Button>}
      </div>

      <Card flush>
        <ResourceList
          key={`${view}-${group?.field ?? ''}-${group?.value ?? ''}-${version}`}
          type="action"
          columns={[
            'ref', 'title',
            { field: 'status', label: 'Status', sortable: true, render: (row) => <ActionStatus row={row} onChanged={reload} /> },
            'priority', 'owner_id', 'department',
            {
              field: 'due_on', label: 'Due', sortable: true,
              render: (row) => {
                const overdue = Boolean(row.due_on) && row.due_on < data.today && data.open_statuses.includes(row.status);
                return <span className={overdue ? 'is-overdue' : undefined}>{formatDate(row.due_on)}{overdue ? ' (overdue)' : ''}</span>;
              },
            },
            'source',
            { field: 'source_type', label: 'Arose from', render: sourceLink },
          ]}
          filters={['status', 'priority', 'source', 'owner_id', 'due_on']}
          baseFilter={baseFilter}
          createFields={['title', 'description', 'priority', 'owner_id', 'due_on', 'source', 'department', 'notes']}
          onCreated={() => { reload(); setVersion((n) => n + 1); }}
        />
      </Card>
    </div>
  );
}
