import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Collapse, Group, Paper, Progress, SegmentedControl, SimpleGrid, Text, UnstyledButton } from '@mantine/core';
import {
  Button, Card, ColorDot, EmptyState, ErrorState, formatCurrency, Icon, Loading, MultiSelect, PageHeader, StatusChip,
  TableWrap, TextField, toColorName, useAuth, useFetch, useLookup,
} from '../../core';
import type { IconName } from '../../core';
import { compactCurrency } from './bits';
import { PortfolioBoard } from './PortfolioBoard';
import { PortfolioBudget } from './PortfolioBudget';
import { activeCount, applyFilters, clearFilters, readFilters, writeFilter, type ViewFilter } from './portfolioFilters';
import { PortfolioTable } from './PortfolioTable';
import { PortfolioTimeline } from './PortfolioTimeline';
import type { Portfolio } from './types';

const VIEWS: { key: string; label: string; icon: IconName }[] = [
  { key: 'table', label: 'Table', icon: 'menu' },
  { key: 'board', label: 'Board', icon: 'clipboard' },
  { key: 'timeline', label: 'Timeline', icon: 'calendar' },
  { key: 'budget', label: 'Budget', icon: 'chart' },
];

function Tile({ icon, label, children, sub, tone }: { icon: IconName; label: string; children: React.ReactNode; sub?: React.ReactNode; tone?: 'bad' }) {
  return (
    <div className="prj-tile">
      <Text size="sm" c="dimmed" fw={500} className="prj-tile-label"><Icon name={icon} size={15} /> {label}</Text>
      <div className={`prj-tile-value${tone === 'bad' ? ' prj-tile-bad' : ''}`}>{children}</div>
      {sub && <Text size="sm" c="dimmed" component="div">{sub}</Text>}
    </div>
  );
}

/** Count, rating split, money, gates due and work in progress, in one strip. */
function Summary({ data, onShowGates, gatesOpen }: { data: Portfolio; onShowGates: () => void; gatesOpen: boolean }) {
  const { totals, wip } = data;
  const rated = totals.rag.red + totals.rag.amber + totals.rag.green;
  const pct = totals.budget ? Math.round((totals.spend / totals.budget) * 100) : null;
  const over = totals.budget > 0 && totals.spend > totals.budget;
  const ragText = `${totals.rag.red} red, ${totals.rag.amber} amber, ${totals.rag.green} green${totals.rag.none ? `, ${totals.rag.none} with no report` : ''}`;
  return (
    <Paper withBorder radius="md" className="prj-summary">
      <SimpleGrid cols={{ base: 1, xs: 2, md: 3, xl: 5 }} spacing={0}>
        <Tile icon="folder" label="Projects" sub={`${totals.active} active`}>{totals.projects}</Tile>
        <Tile
          icon="target"
          label="Overall rating"
          sub={(
            // Drawing only: the counts beside it say the same in words (a split bar has no single value to announce).
            <Progress.Root size="sm" radius="xl" aria-hidden="true" mt={6}>
              {(['red', 'amber', 'green'] as const).map((k) => totals.rag[k] > 0 && (
                <Progress.Section key={k} value={(totals.rag[k] / Math.max(1, totals.projects)) * 100} color={k} />
              ))}
            </Progress.Root>
          )}
        >
          <span className="prj-ragsplit" title={ragText}>
            {(['red', 'amber', 'green'] as const).map((k) => (
              <span key={k}><ColorDot color={k} /> {totals.rag[k]} <small>{k}</small></span>
            ))}
          </span>
          {rated === 0 && <span className="sr-only">No status reports yet</span>}
        </Tile>
        <Tile
          icon="scale"
          label="Spend against budget"
          tone={over ? 'bad' : undefined}
          sub={(
            <>
              <span title={`${formatCurrency(totals.spend)} of ${formatCurrency(totals.budget)}`}>
                of {compactCurrency(totals.budget)} budget{pct !== null ? ` · ${pct}%` : ''}{over ? ' · over' : ''}
              </span>
              <Progress value={Math.min(100, pct ?? 0)} color={over ? 'red' : 'blue'} size="sm" radius="xl" mt={6} aria-label={`${pct ?? 0}% of the total budget spent`} />
            </>
          )}
        >
          {compactCurrency(totals.spend)}
        </Tile>
        <Tile
          icon="check-square"
          label="Gate decisions due"
          sub={data.gatesDue.length ? (
            <UnstyledButton className="prj-linkbtn" onClick={onShowGates} aria-expanded={gatesOpen}>
              {gatesOpen ? 'Hide the list' : 'Show which'} <Icon name={gatesOpen ? 'chevron-up' : 'chevron-down'} size={14} />
            </UnstyledButton>
          ) : 'Nothing is waiting'}
        >
          {data.gatesDue.length}
        </Tile>
        <Tile
          icon="refresh"
          label="In delivery"
          tone={wip.exceeded ? 'bad' : undefined}
          sub={wip.exceeded ? <><Icon name="alert" size={14} /> Over the limit of {wip.limit}</> : `Work-in-progress limit ${wip.limit}`}
        >
          {wip.inDelivery} <small>of {wip.limit}</small>
        </Tile>
      </SimpleGrid>
    </Paper>
  );
}

function GatesDue({ data }: { data: Portfolio }) {
  return (
    <Card title="Gate decisions due" flush>
      <TableWrap label="Gate decisions due" className="prj-scroll">
        <table className="table">
          <thead>
            <tr><th scope="col">Project</th><th scope="col">Gate</th><th scope="col">Checklist</th><th scope="col">State</th></tr>
          </thead>
          <tbody>
            {data.gatesDue.map((g) => (
              <tr key={g.gate_id}>
                <td><Link to={`/projects/${g.project_id}?tab=gate`}><span className="ref">{g.ref}</span> {g.name}</Link></td>
                <td>{g.gate_name}</td>
                <td>{g.checked} of {g.total} complete</td>
                <td>{g.ready ? <StatusChip color="green" label="Ready for a decision" /> : <StatusChip color="amber" label="Deferred; work outstanding" />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  );
}

export function PortfolioPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const view = VIEWS.find((v) => v.key === search.get('view'))?.key ?? 'table';
  const { data, error, reload } = useFetch<Portfolio>('/api/projects/portfolio');
  const [gatesOpen, setGatesOpen] = useState(false);
  const tiers = useLookup('project_tier');
  const stages = useLookup('project_stage');
  const statuses = useLookup('project_status');
  const ratings = useLookup('rag_rating');

  const filters = useMemo(() => readFilters(search), [search]);
  const rows = useMemo(() => (data ? applyFilters(data.register, filters) : []), [data, filters]);
  const active = activeCount(filters);

  const setView = (key: string) => {
    const next = new URLSearchParams(search);
    if (key === 'table') next.delete('view'); else next.set('view', key);
    for (const k of ['sort', 'dir', 'page']) if (key !== 'table') next.delete(k);
    setSearch(next);
  };
  const setFilter = (field: ViewFilter | 'q', value: string[] | string) => setSearch(writeFilter(search, field, value), { replace: field === 'q' });
  const toggleStage = (stage: string) => {
    const now = filters.values.stage ?? [];
    setFilter('stage', now.includes(stage) ? now.filter((s) => s !== stage) : [...now, stage]);
  };
  const pick = (field: ViewFilter, label: string, options: { value: string; label: string }[]) => (
    <MultiSelect label={label} size="sm" options={options} value={filters.values[field] ?? []} onChange={(v) => setFilter(field, v)} />
  );
  // Who may send a request is a setting; the server grants "projects.request" accordingly (BW-06).
  const mayRequest = can('projects.request');

  return (
    <div className="stack">
      <PageHeader
        title="Project portfolio"
        subtitle="Every project in one place: its stage, how it is going and what it costs."
        actions={(
          <>
            {can('projects.administer') && <Button icon="settings" onClick={() => navigate('/projects/settings')}>Settings</Button>}
            {mayRequest && <Button variant="primary" icon="plus" onClick={() => navigate('/projects/new')}>New project request</Button>}
          </>
        )}
      />

      {error ? <ErrorState title="The portfolio could not be loaded" error={error} onRetry={reload} /> : !data ? <Loading lines={4} label="Loading the portfolio" /> : (
        <>
          {data.wipWarning && (
            <Alert color="red" variant="light" title="Work-in-progress limit exceeded" icon={<Icon name="alert" />}>
              {data.wipWarning}
            </Alert>
          )}
          <Summary data={data} gatesOpen={gatesOpen} onShowGates={() => setGatesOpen((o) => !o)} />
          <Collapse expanded={gatesOpen && data.gatesDue.length > 0}><GatesDue data={data} /></Collapse>

          {data.totals.projects > 0 && (
            <div className="prj-funnel" role="group" aria-label="Projects by stage. Select a stage to filter.">
              {data.funnel.map((f) => {
                const on = (filters.values.stage ?? []).includes(f.stage);
                const warn = f.stage === data.wip.stage && data.wip.exceeded;
                return (
                  <UnstyledButton
                    key={f.stage}
                    className="prj-funnel-step"
                    aria-pressed={on}
                    onClick={() => toggleStage(f.stage)}
                    style={{ '--stage': `var(--c-${toColorName(f.color)}-solid)` } as React.CSSProperties}
                  >
                    <span className="prj-funnel-label">{f.label}</span>
                    <span className="prj-funnel-count">{f.count}</span>
                    <span className={`prj-funnel-sub${warn ? ' prj-funnel-warn' : ''}`}>
                      {f.budget ? compactCurrency(f.budget) : 'No budget'}
                      {f.stage === data.wip.stage ? ` · ${f.active} active, limit ${data.wip.limit}` : ''}
                    </span>
                  </UnstyledButton>
                );
              })}
            </div>
          )}
        </>
      )}

      <Group justify="space-between" align="flex-end" gap="sm">
        <SegmentedControl
          aria-label="Portfolio view"
          value={view}
          onChange={setView}
          data={VIEWS.map((v) => ({
            value: v.key,
            label: <span className="prj-viewopt"><Icon name={v.icon} size={15} /> {v.label}</span>,
          }))}
        />
        {view !== 'table' && (
          <Group gap="xs" align="flex-end" className="prj-filters">
            <TextField
              label="Search projects" hideLabel type="search" placeholder="Search projects" value={filters.q}
              onChange={(q) => setFilter('q', q)} leftSection={<Icon name="search" size={15} />}
            />
            {pick('tier', 'Tier', tiers)}
            {pick('stage', 'Stage', stages)}
            {pick('status', 'Status', statuses)}
            {pick('rag_overall', 'Rating', ratings)}
            {active > 0 && <Button variant="ghost" size="sm" icon="x" onClick={() => setSearch(clearFilters(search))}>Clear filters</Button>}
          </Group>
        )}
      </Group>
      {view !== 'table' && filters.tableOnly.length > 0 && (
        <Text size="sm" c="dimmed">
          {filters.tableOnly.length === 1 ? 'One filter' : `${filters.tableOnly.length} filters`} set in the table view
          {filters.tableOnly.length === 1 ? ' applies' : ' apply'} only there.
        </Text>
      )}

      {view === 'table' ? <PortfolioTable /> : error ? null : !data ? <Loading /> : data.register.length === 0 ? (
        <Card>
          <EmptyState
            icon="folder"
            title="No projects yet"
            message="Start with a one-page project request. It joins the portfolio as an idea."
            action={mayRequest ? <Button variant="primary" onClick={() => navigate('/projects/new')}>New project request</Button> : undefined}
          />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon="filter"
            title="No projects match these filters"
            action={<Button onClick={() => setSearch(clearFilters(search))}>Clear filters</Button>}
          />
        </Card>
      ) : view === 'board' ? <PortfolioBoard data={data} rows={rows} onChanged={reload} />
        : view === 'timeline' ? <PortfolioTimeline rows={rows} today={data.today} />
        : <PortfolioBudget rows={rows} />}
    </div>
  );
}
