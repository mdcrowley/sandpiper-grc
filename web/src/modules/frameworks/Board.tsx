import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Button, Card, Checkbox, EmptyState, ErrorState, Loading, MultiSelect, PageHeader, ResourceList, Select, Stat,
  useFetch,
} from '../../core';
import type { ListResult } from '../../core';
import { BoardView, NO_FILTERS, matches } from './BoardView';
import type { BoardFilters } from './BoardView';
import { StatusLegend } from './StatusBar';
import type { Board, FrameworkRef } from './types';

/** Picks the framework to show: the one in the address, else the first one loaded. */
export function useFrameworkChoice(explicitId?: string) {
  const list = useFetch<ListResult<FrameworkRef & { id: string }>>('/api/frameworks?pageSize=100&sort=name');
  const frameworks = list.data?.rows ?? [];
  const id = explicitId ?? frameworks[0]?.id;
  return { ...list, frameworks, id };
}

function OutcomeTable({ frameworkId }: { frameworkId: string }) {
  return (
    <ResourceList
      type="framework_outcome"
      columns={['code', 'title', 'status', 'priority', 'phase', 'owner_id', 'function_code', 'category_code', 'review_on']}
      filters={['status', 'phase', 'priority', 'owner_id', 'review_on']}
      baseFilter={{ framework_id: frameworkId }}
      createFields={['code', 'official_text', 'description', 'category_code', 'priority', 'status', 'phase', 'owner_id', 'target', 'first_action', 'review_on']}
      createInitial={{ framework_id: frameworkId }}
      pageSize={50}
    />
  );
}

export function BoardPage({ view: fixedView }: { view?: 'board' | 'table' }) {
  const params = useParams();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const choice = useFrameworkChoice(params.id);
  const board = useFetch<Board>(choice.id ? `/api/frameworks/${choice.id}/board` : null);
  const [filters, setFilters] = useState<BoardFilters>(NO_FILTERS);
  const view = fixedView ?? (search.get('view') === 'table' || search.get('new') ? 'table' : 'board');
  const setView = (v: 'board' | 'table') => {
    if (fixedView) navigate(v === 'table' ? '/frameworks/outcomes' : '/frameworks');
    else setSearch(v === 'table' ? { view: 'table' } : {}, { replace: true });
  };
  const patch = (p: Partial<BoardFilters>) => setFilters((f) => ({ ...f, ...p }));

  const data = board.data;
  const owners = useMemo(() => {
    const seen = new Map<string, string>();
    for (const fn of data?.functions ?? []) {
      for (const c of fn.categories) for (const o of c.outcomes) if (o.owner_id) seen.set(o.owner_id, o.owner_name ?? 'Unknown user');
    }
    return [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [data]);
  const shown = useMemo(
    () => (data ? data.functions.flatMap((fn) => fn.categories.flatMap((c) => c.outcomes)).filter((o) => matches(o, filters)).length : 0),
    [data, filters],
  );
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);

  if (choice.error) return <ErrorState error={choice.error} onRetry={choice.reload} />;
  if (!choice.data) return <Loading lines={8} label="Loading frameworks" />;
  if (!choice.id) {
    return (
      <>
        <PageHeader title="Framework outcomes" />
        <EmptyState
          icon="shield"
          title="No framework has been loaded yet"
          message="Run the seed command to load NIST CSF 2.0 and the target profile, or ask an administrator to add a framework."
        />
      </>
    );
  }
  if (board.error) return <ErrorState error={board.error} onRetry={board.reload} />;
  if (!data) return <Loading lines={10} label="Loading the outcomes board" />;

  const { summary, statuses, target } = data;
  const targetLabel = statuses.find((s) => s.value === target.status)?.label ?? target.status;
  const total = summary.all.total;

  return (
    <div className="stack">
      <PageHeader
        title="Framework outcomes"
        subtitle={`${data.framework.name}${data.framework.version ? ` ${data.framework.version}` : ''} · ${total} outcomes, ${summary.priority.total} priority`}
        actions={
          <div className="row">
            {choice.frameworks.length > 1 && (
              <Select
                label="Framework" hideLabel value={choice.id}
                options={choice.frameworks.map((f) => ({ value: f.id, label: f.name }))}
                onChange={(v) => v && navigate(`/frameworks/board/${v}`)}
              />
            )}
            <div className="fw-view-toggle" role="group" aria-label="View">
              <button type="button" aria-pressed={view === 'board'} onClick={() => setView('board')}>Board</button>
              <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}>Table</button>
            </div>
          </div>
        }
      />

      {total === 0 ? (
        <EmptyState
          icon="target"
          title="This framework has no outcomes yet"
          message="Switch to the table view to add outcomes one at a time, or load them with the seed command."
          action={view === 'board' ? <Button onClick={() => setView('table')}>Open table view</Button> : undefined}
        />
      ) : (
        <>
          <div className="grid-stats">
            <Stat
              label={`Priority outcomes at "${targetLabel}" or better`}
              value={`${summary.priority.atTargetPct}%`}
              color="green"
              trend={{ direction: 'flat', label: `${summary.priority.atTarget} of ${summary.priority.total}`, tone: 'neutral' }}
            />
            {statuses.map((s) => (
              <Stat
                key={s.value}
                label={s.label}
                value={summary.all.counts[s.value] ?? 0}
                color={s.color}
                to={`/frameworks/outcomes?f.status=${s.value}`}
                trend={{ direction: 'flat', label: `${summary.priority.counts[s.value] ?? 0} priority`, tone: 'neutral' }}
              />
            ))}
          </div>
        </>
      )}

      {view === 'table' ? (
        <OutcomeTable frameworkId={data.framework.id} />
      ) : total > 0 && (
        <>
          <Card>
            <div className="fw-toolbar">
              <Checkbox label="Priority only" checked={filters.priorityOnly} onChange={(v) => patch({ priorityOnly: v })} />
              <MultiSelect label="Status" value={filters.statuses} onChange={(v) => patch({ statuses: v })}
                options={statuses.map((s) => ({ value: s.value, label: s.label }))} />
              <MultiSelect label="Phase" value={filters.phases} onChange={(v) => patch({ phases: v })}
                options={[...data.phases.map((p) => ({ value: p.value, label: p.label })), { value: '', label: 'No phase' }]} />
              <MultiSelect label="Function" value={filters.functions} onChange={(v) => patch({ functions: v })}
                options={data.functions.map((f) => ({ value: f.code, label: f.name }))} />
              <Select label="Owner" hideLabel value={filters.owner} placeholder="Any owner" onChange={(v) => patch({ owner: v })}
                options={[{ value: 'none', label: 'No owner' }, ...owners]} />
              <div className="fw-toolbar-end">
                <span className="muted" aria-live="polite">{filtered ? `${shown} of ${total} shown` : `${total} outcomes`}</span>
                {filtered && <Button size="sm" variant="ghost" onClick={() => setFilters(NO_FILTERS)}>Clear filters</Button>}
              </div>
            </div>
            <StatusLegend scale={statuses} />
          </Card>
          <BoardView board={data} filters={filters} onClear={() => setFilters(NO_FILTERS)} />
        </>
      )}
    </div>
  );
}
