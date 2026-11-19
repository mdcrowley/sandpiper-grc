import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Chip, SegmentedControl } from '@mantine/core';
import {
  Button, EmptyState, ErrorState, Icon, Loading, Menu, PageHeader, ResourceList, Select, TextField,
  api, cx, errorMessage, useAuth, useDebounced, useFetch, useToast,
} from '../../core';
import type { ListResult, MenuItem } from '../../core';
import {
  NO_FILTERS, NO_PHASE, isFiltered, matches, rememberFramework, rememberedFramework, useBoardFilters, useDensity,
} from './boardState';
import type { BoardFilters, Density } from './boardState';
import { ViewsMenu } from './BoardViews';
import { BoardView } from './BoardView';
import { StatusBar, TargetRing } from './StatusBar';
import type { Board, BoardOutcome, FrameworkRef } from './types';
import { frameworkTitle, statusVars } from './types';

/** Picks the framework to show: the one in the address, else the one last looked at, else the first. */
export function useFrameworkChoice(explicitId?: string) {
  const list = useFetch<ListResult<FrameworkRef & { id: string }>>('/api/frameworks?pageSize=100&sort=name');
  const frameworks = list.data?.rows ?? [];
  const remembered = rememberedFramework();
  const id = explicitId ?? (frameworks.some((f) => f.id === remembered) ? remembered! : frameworks[0]?.id);
  useEffect(() => { if (id) rememberFramework(id); }, [id]);
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

const DENSITY_OPTIONS: { value: Density; label: string }[] = [
  { value: 'detailed', label: 'Detailed' }, { value: 'compact', label: 'Compact' }, { value: 'map', label: 'Map' },
];

const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

export function BoardPage({ view = 'board' }: { view?: 'board' | 'table' }) {
  const params = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const choice = useFrameworkChoice(params.id);
  const board = useFetch<Board>(choice.id ? `/api/frameworks/${choice.id}/board` : null);
  const [filters, setFilters] = useBoardFilters();
  const [density, setDensity] = useDensity();
  const [savingId, setSavingId] = useState<string | null>(null);
  /** Statuses changed on the board, shown at once while the board is read again. */
  const [changed, setChanged] = useState<Record<string, string>>({});
  const [search, setSearch] = useState(filters.q);
  const debounced = useDebounced(search, 250);
  const canEdit = can('frameworks.edit');

  // The search box writes to the address after a pause; Back and saved views write to the box.
  useEffect(() => { if (view === 'board' && debounced !== filters.q) setFilters({ ...filters, q: debounced }, true); }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSearch(filters.q); }, [filters.q]);
  useEffect(() => { setChanged({}); }, [board.data]);

  const data = useMemo(() => {
    const raw = board.data;
    if (!raw || !Object.keys(changed).length) return raw;
    return {
      ...raw,
      functions: raw.functions.map((fn) => ({
        ...fn,
        categories: fn.categories.map((c) => ({ ...c, outcomes: c.outcomes.map((o) => (changed[o.id] ? { ...o, status: changed[o.id] } : o)) })),
      })),
    };
  }, [board.data, changed]);

  const all = useMemo(() => (data ? data.functions.flatMap((fn) => fn.categories.flatMap((c) => c.outcomes)) : []), [data]);
  const owners = useMemo(() => {
    const seen = new Map<string, string>();
    for (const o of all) if (o.owner_id) seen.set(o.owner_id, o.owner_name ?? 'Unknown user');
    return [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [all]);
  const shown = useMemo(() => all.filter((o) => matches(o, filters)).length, [all, filters]);

  const reload = board.reload;
  const onStatus = useCallback(async (o: BoardOutcome, status: string) => {
    setSavingId(o.id);
    try {
      await api.patch(`/api/framework-outcomes/${o.id}`, { status });
      setChanged((c) => ({ ...c, [o.id]: status }));
      toast.success(`${o.code} set to ${data?.statuses.find((s) => s.value === status)?.label ?? status}.`);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSavingId(null);
    }
  }, [data?.statuses, reload, toast]);

  if (choice.error) return <ErrorState error={choice.error} onRetry={choice.reload} />;
  if (!choice.data) return <Loading lines={8} label="Loading frameworks" />;
  if (!choice.id) {
    return (
      <>
        <PageHeader title="Framework outcomes" />
        <EmptyState
          icon="shield"
          title="No framework has been loaded yet"
          message="Load a framework from a reference file, or run the seed command to load NIST CSF 2.0."
          action={can('frameworks.create') ? <Button variant="primary" onClick={() => navigate('/frameworks/manage')}>Add a framework</Button> : undefined}
        />
      </>
    );
  }
  if (board.error) return <ErrorState error={board.error} onRetry={board.reload} />;
  if (!data) return <Loading lines={10} label="Loading the outcomes board" />;

  const { summary, statuses, target } = data;
  const targetLabel = statuses.find((s) => s.value === target.status)?.label ?? target.status;
  const total = summary.all.total;
  const patch = (p: Partial<BoardFilters>) => setFilters({ ...filters, ...p });
  const filtered = isFiltered(filters);
  const headline = filters.priority || summary.priority.total > 0 ? summary.priority : summary.all;
  const headlineWhat = headline === summary.priority ? 'priority outcomes' : 'outcomes';

  const more: MenuItem[] = [
    { label: 'Coverage of other frameworks', icon: 'link', to: '/frameworks/coverage' },
    { label: 'Assessments', icon: 'chart', to: '/assessments' },
    { label: 'Frameworks and structure', icon: 'settings', to: '/frameworks/manage', separated: true },
    { label: 'Framework settings', icon: 'settings', to: '/frameworks/settings' },
    ...(view === 'board' ? [{ label: 'Print this board', icon: 'file-text' as const, onSelect: () => window.print() }] : []),
  ];

  return (
    <div className="stack fw-page">
      <PageHeader
        title="Framework outcomes"
        subtitle={`${frameworkTitle(data.framework)} · ${total} outcomes, ${summary.priority.total} priority`}
        actions={
          <div className="row">
            {choice.frameworks.length > 1 && (
              <Select
                label="Framework" hideLabel required value={choice.id}
                options={choice.frameworks.map((f) => ({ value: f.id, label: frameworkTitle(f) }))}
                onChange={(v) => { if (v) { rememberFramework(v); navigate(view === 'table' ? '/frameworks/outcomes' : `/frameworks/board/${v}`); } }}
              />
            )}
            <SegmentedControl
              size="sm" aria-label="View" value={view}
              data={[{ value: 'board', label: 'Board' }, { value: 'table', label: 'Table' }]}
              onChange={(v) => navigate(v === 'table' ? '/frameworks/outcomes' : `/frameworks/board/${choice.id}`)}
            />
            <Menu label="More" icon="more" items={more} align="end" />
          </div>
        }
      />

      {total === 0 ? (
        <EmptyState
          icon="target"
          title="This framework has no outcomes yet"
          message="Add outcomes one at a time in the table view, or load them from a reference file."
          action={view === 'board' ? <Button onClick={() => navigate('/frameworks/outcomes')}>Open table view</Button> : undefined}
        />
      ) : (
        <section className="fw-hero" aria-label="Summary">
          <div className="fw-hero-main">
            <TargetRing tally={headline} size={112} label={`All functions, ${headlineWhat}`} />
            <div>
              <div className="fw-hero-figure"><strong>{headline.atTarget}</strong> of {headline.total}</div>
              <div className="fw-hero-label">{headlineWhat} at “{targetLabel}” or better</div>
              <div className="fw-hero-sub">Score {headline.score} of 100 · target {target.score}</div>
            </div>
          </div>
          <div className="fw-hero-side">
            <StatusBar tally={filters.priority ? summary.priority : summary.all} scale={statuses} thick
              label={`${filters.priority ? 'Priority outcomes' : 'All outcomes'} by status`} />
            <div className="fw-hero-counts">
              {statuses.map((s) => {
                const on = filters.statuses.includes(s.value);
                return (
                  <button
                    key={s.value} type="button" className={cx('fw-count', on && 'is-on')} style={statusVars(s.color) as CSSProperties}
                    aria-pressed={view === 'board' ? on : undefined}
                    title={view === 'board' ? `Show only ${s.label.toLowerCase()} outcomes on the board` : `Open the table filtered to ${s.label.toLowerCase()}`}
                    onClick={() => (view === 'board' ? patch({ statuses: toggle(filters.statuses, s.value) }) : navigate(`/frameworks/outcomes?f.status=${s.value}`))}
                  >
                    <span className="fw-count-value">{summary.all.counts[s.value] ?? 0}</span>
                    <span className="fw-count-label"><span className="fw-pill-dot" />{s.label}</span>
                    <span className="fw-count-sub">{summary.priority.counts[s.value] ?? 0} priority</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {view === 'table' ? (
        <OutcomeTable frameworkId={data.framework.id} />
      ) : total > 0 && (
        <>
          <div className="fw-filters" role="group" aria-label="Board filters">
            <div className="fw-filters-row">
              <Chip size="xs" variant="outline" checked={filters.priority} onChange={(v) => patch({ priority: v })} color="amber"
                title="Show only priority outcomes, and count only them in each function">
                <span className="fw-chip-in"><Icon name="star" size={13} />Priority focus</span>
              </Chip>
              <span className="fw-filters-sep" aria-hidden="true" />
              <span className="fw-filters-label" id="fw-f-status">Status</span>
              <div className="fw-chipset" role="group" aria-labelledby="fw-f-status">
                {statuses.map((s) => (
                  <Chip key={s.value} size="xs" variant="outline" checked={filters.statuses.includes(s.value)}
                    onChange={() => patch({ statuses: toggle(filters.statuses, s.value) })}>
                    <span className="fw-chip-in"><span className="fw-swatch" style={{ background: `var(--c-${s.color}-solid)` }} />{s.label}</span>
                  </Chip>
                ))}
              </div>
              <span className="fw-filters-sep" aria-hidden="true" />
              <span className="fw-filters-label" id="fw-f-phase">Phase</span>
              <div className="fw-chipset" role="group" aria-labelledby="fw-f-phase">
                {[...data.phases.map((p) => ({ value: p.value, label: p.label })), { value: NO_PHASE, label: 'No phase' }].map((p) => (
                  <Chip key={p.value} size="xs" variant="outline" checked={filters.phases.includes(p.value)}
                    onChange={() => patch({ phases: toggle(filters.phases, p.value) })}>{p.label}</Chip>
                ))}
              </div>
            </div>
            <div className="fw-filters-row">
              <span className="fw-filters-label" id="fw-f-fn">Function</span>
              <div className="fw-chipset" role="group" aria-labelledby="fw-f-fn">
                {data.functions.map((f) => (
                  <Chip key={f.code} size="xs" variant="outline" checked={filters.functions.includes(f.code)}
                    onChange={() => patch({ functions: toggle(filters.functions, f.code) })}>
                    <span className="fw-chip-in"><span className="fw-swatch" style={{ background: `var(--c-${f.color}-solid)` }} />{f.name}</span>
                  </Chip>
                ))}
              </div>
              <Select label="Owner" hideLabel size="xs" className="fw-owner" value={filters.owner} placeholder="Any owner"
                onChange={(v) => patch({ owner: v })} options={[{ value: 'none', label: 'No owner' }, ...owners]} />
              <TextField label="Search the board" hideLabel size="xs" type="search" className="fw-search" value={search} onChange={setSearch}
                placeholder="Search code or wording" leftSection={<Icon name="search" size={14} />} />
              <div className="fw-filters-end">
                <span className="fw-shown" aria-live="polite">{filtered ? `${shown} of ${total} shown` : `${total} outcomes`}</span>
                {filtered && <Button size="sm" variant="ghost" icon="x" onClick={() => { setSearch(''); setFilters(NO_FILTERS); }}>Clear filters</Button>}
                <ViewsMenu filters={filters} onApply={(query) => navigate({ search: query })} />
                <SegmentedControl size="xs" aria-label="Density" value={density} data={DENSITY_OPTIONS} onChange={(v) => setDensity(v as Density)} />
              </div>
            </div>
          </div>
          <BoardView
            board={data} filters={filters} density={density} canEdit={canEdit} savingId={savingId}
            onClear={() => { setSearch(''); setFilters(NO_FILTERS); }} onStatus={onStatus}
          />
          <p className="fw-keys muted">
            <kbd className="kbd">←</kbd> <kbd className="kbd">→</kbd> <kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> move between outcomes ·{' '}
            <kbd className="kbd">Enter</kbd> opens one{canEdit && <> · <kbd className="kbd">S</kbd> changes its status</>}
          </p>
        </>
      )}
    </div>
  );
}
