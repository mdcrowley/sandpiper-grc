import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SegmentedControl } from '@mantine/core';
import { Icon, PageHeader, ResourceList, Stat, useAuth, useFetch, useResource, qs } from '../../core';
import type { Overview } from './types';
import { thisWeek } from './util';

const PRESETS = [
  { value: 'all', label: 'All changes' },
  { value: 'mine', label: 'My changes' },
  { value: 'awaiting', label: 'Awaiting approval' },
  { value: 'week', label: 'This week' },
  { value: 'emergency', label: 'Emergency' },
];

/** The register of changes, with ready-made views above the generic list. */
export function ChangeList() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const hasSystems = Boolean(useResource('system'));
  const week = useMemo(() => thisWeek(), []);
  const { data: overview } = useFetch<Overview>(`/api/changes/overview${qs({ week_from: week.from, week_to: week.to })}`);

  const view = PRESETS.some((p) => p.value === params.get('view')) ? params.get('view')! : 'all';
  const baseFilter = useMemo((): Record<string, string> | undefined => ({
    mine: { owner_id: 'me' },
    awaiting: { status: 'submitted' },
    week: { 'planned_start.gte': week.from, 'planned_start.lt': week.to },
    emergency: { change_type: 'emergency' },
  } as Record<string, Record<string, string>>)[view], [view, week]);

  const setView = (next: string) => setParams(next === 'all' ? {} : { view: next }, { replace: true });

  return (
    <div className="stack">
      <PageHeader
        title="Changes"
        subtitle="Planned, current and past changes to systems."
        actions={(
          <>
            <Link className="btn btn-secondary" to="/changes/calendar"><Icon name="calendar" /> Calendar</Link>
            {can('changes.create') && <Link className="btn btn-primary" to="/changes/new"><Icon name="plus" /> New change</Link>}
          </>
        )}
      />

      {overview && (
        <div className="grid-stats">
          <Stat label="Awaiting approval" value={overview.awaiting_approval} color="blue" to="/changes?view=awaiting" />
          <Stat label="Planned this week" value={overview.this_week} color="purple" to="/changes?view=week" />
          <Stat label="In progress" value={overview.in_progress} color="amber" to="/changes?f.status=in_progress" />
          <Stat label="Review due" value={overview.review_due} color={overview.review_due ? 'red' : 'gray'} to="/changes?f.status=completed&f.pir_required=true" />
          <Stat label="Open emergency changes" value={overview.emergency_open} color={overview.emergency_open ? 'red' : 'gray'} to="/changes?view=emergency" />
        </div>
      )}

      <SegmentedControl
        className="chg-presets"
        aria-label="Ready-made views"
        data={PRESETS}
        value={view}
        onChange={setView}
      />

      <ResourceList
        key={`${view}|${params.toString()}`}
        type="change"
        baseFilter={baseFilter}
        columns={[
          'ref', 'title', 'change_type', 'status', 'risk_level', 'planned_start',
          ...(hasSystems ? ['system_id'] : []),
          'assignee_id',
          {
            field: 'approvals', label: 'Approvals',
            render: (row) => (Number(row.approvals_required) > 0 ? `${row.approvals_received} of ${row.approvals_required}` : 'None needed'),
          },
        ]}
        filters={['status', 'change_type', 'risk_level', 'owner_id', 'assignee_id', ...(hasSystems ? ['system_id'] : []), 'planned_start', 'pir_required']}
      />
    </div>
  );
}
