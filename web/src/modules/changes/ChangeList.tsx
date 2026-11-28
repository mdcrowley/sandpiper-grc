import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  AgendaList, Card, Icon, PageHeader, ResourceList, Stat, useAuth, useFetch, useResource, qs, type AgendaItem,
} from '../../core';
import type { Overview, WaitingChange } from './types';
import { thisWeek } from './util';

/** Ready-made saved views, put in the list's View menu once per browser; people can rename or delete them like their own. */
const STARTER_VIEWS: { name: string; filters: Record<string, string>; labels?: Record<string, string> }[] = [
  { name: 'Owned by me', filters: { owner_id: 'me' }, labels: { owner_id: 'Me' } },
  { name: 'Implemented by me', filters: { assignee_id: 'me' }, labels: { assignee_id: 'Me' } },
  { name: 'Awaiting approval', filters: { status: 'submitted' } },
  { name: 'Scheduled and in progress', filters: { status: 'approved,scheduled,in_progress' } },
  { name: 'Review due', filters: { status: 'completed', pir_required: 'true' } },
  { name: 'Emergency', filters: { change_type: 'emergency' } },
];
const VIEWS_KEY = 'grc.views.change';

function ensureStarterViews(): void {
  try {
    if (localStorage.getItem(`${VIEWS_KEY}.starter`) === '2') return;
    const existing: { name: string }[] = JSON.parse(localStorage.getItem(VIEWS_KEY) ?? '[]');
    const starters = STARTER_VIEWS.filter((s) => !existing.some((e) => e.name === s.name)).map((s) => ({
      name: s.name,
      view: {
        q: '', sort: '', dir: 'asc',
        filters: Object.fromEntries(Object.entries(s.filters).map(([k, v]) => [k, v.split(',')])),
        labels: s.labels ?? {},
      },
    }));
    localStorage.setItem(VIEWS_KEY, JSON.stringify([...existing, ...starters]));
    localStorage.setItem(`${VIEWS_KEY}.starter`, '2');
  } catch {
    // Storage unavailable: the tiles above the list lead to the same changes.
  }
}

/** Changes waiting for the reader's own decision. Shown only to approvers who have something to decide. */
function WaitingForMe() {
  const { can } = useAuth();
  const { data } = useFetch<{ rows: WaitingChange[] }>(can('changes.approve') ? '/api/changes/waiting' : null);
  if (!data?.rows.length) return null;
  const items: AgendaItem[] = data.rows.map((c) => ({
    key: c.id, date: c.planned_start ?? new Date().toISOString(), title: c.title, reference: c.ref,
    to: `/changes/${c.id}?tab=approvals`, color: c.change_type === 'emergency' ? 'red' : 'blue',
    meta: `${c.retrospective ? 'Approval after the fact · ' : ''}${c.approvals_received} of ${c.approvals_required} approvals`,
  }));
  return (
    <Card title={`Waiting for your decision (${data.rows.length})`}>
      <AgendaList label="Changes waiting for your decision" items={items} limit={5} />
    </Card>
  );
}

/** The register of changes: tiles, what is waiting for me, then the list with saved views. */
export function ChangeList() {
  const { can } = useAuth();
  useMemo(ensureStarterViews, []);
  const hasSystems = Boolean(useResource('system'));
  const week = useMemo(() => thisWeek(), []);
  const { data: overview } = useFetch<Overview>(`/api/changes/overview${qs({ week_from: week.from, week_to: week.to })}`);
  const weekLink = `/changes?f.planned_start.gt=${encodeURIComponent(new Date(Date.parse(week.from) - 1).toISOString())}&f.planned_start.lt=${encodeURIComponent(week.to)}&sort=planned_start&dir=asc`;

  return (
    <div className="stack">
      <PageHeader
        title="Changes"
        subtitle="Planned, current and past changes to systems."
        actions={(
          <>
            {can('changes.create') && <Link className="btn btn-primary" to="/changes/new"><Icon name="plus" /> New change</Link>}
          </>
        )}
      />

      <div className="grid-stats">
        <Stat label="Awaiting approval" icon="check-square" value={overview?.awaiting_approval ?? '–'} color="blue" to="/changes?f.status=submitted" />
        <Stat label="Planned this week" icon="calendar" value={overview?.this_week ?? '–'} color="purple" to={weekLink} />
        <Stat label="In progress" icon="refresh" value={overview?.in_progress ?? '–'} color="amber" to="/changes?f.status=in_progress" />
        <Stat label="Review due" icon="clipboard" value={overview?.review_due ?? '–'} color={overview?.review_due ? 'red' : undefined}
          to="/changes?f.status=completed&f.pir_required=true" />
        <Stat label="Open emergency changes" icon="alert" value={overview?.emergency_open ?? '–'} color={overview?.emergency_open ? 'red' : undefined}
          to="/changes?f.change_type=emergency" />
      </div>

      <WaitingForMe />

      <ResourceList
        type="change"
        urlState
        defaultSort={{ field: 'planned_start', dir: 'desc' }}
        bulkFields={['owner_id', 'assignee_id']}
        columns={[
          'ref', 'title', 'change_type', 'status', 'risk_level', 'planned_start',
          ...(hasSystems ? ['system_id'] : []),
          'assignee_id',
          {
            field: 'approvals', label: 'Approvals',
            render: (row) => (Number(row.approvals_required) > 0 ? `${row.approvals_received} of ${row.approvals_required}` : 'None needed'),
          },
          { field: 'owner_id', hidden: true },
          { field: 'planned_end', hidden: true },
          { field: 'outcome', hidden: true },
          { field: 'updated_at', hidden: true },
        ]}
        filters={['status', 'change_type', 'risk_level', 'owner_id', 'assignee_id', ...(hasSystems ? ['system_id'] : []), 'planned_start', 'pir_required']}
      />
    </div>
  );
}
