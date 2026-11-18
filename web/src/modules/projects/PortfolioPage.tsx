import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Button, Card, EmptyState, ErrorState, formatCurrency, Icon, Loading, PageHeader, Stat, useAuth, useFetch,
} from '../../core';
import { PortfolioBudget } from './PortfolioBudget';
import { PortfolioKanban } from './PortfolioKanban';
import { PortfolioTable } from './PortfolioTable';
import { PortfolioTimeline } from './PortfolioTimeline';
import type { Portfolio } from './types';

const VIEWS = [
  { key: 'table', label: 'Table' },
  { key: 'kanban', label: 'Kanban' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'budget', label: 'Budget' },
] as const;
type ViewKey = (typeof VIEWS)[number]['key'];

export function PortfolioPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const view = (VIEWS.find((v) => v.key === search.get('view'))?.key ?? 'table') as ViewKey;
  const { data, error, reload } = useFetch<Portfolio>('/api/projects/portfolio');

  const setView = (key: ViewKey) => {
    const next = new URLSearchParams(search);
    if (key === 'table') next.delete('view'); else next.set('view', key);
    setSearch(next, { replace: true });
  };

  return (
    <div className="stack">
      <PageHeader
        title="Project portfolio"
        subtitle="Every technology project, its tier, stage, latest status and spend."
        actions={
          <>
            {can('projects.administer') && (
              <Button icon="settings" onClick={() => navigate('/projects/settings')}>Settings</Button>
            )}
            {can('projects.create') && (
              <Button variant="primary" icon="plus" onClick={() => navigate('/projects/new')}>New project request</Button>
            )}
          </>
        }
      />

      {error ? <ErrorState title="The portfolio summary could not be loaded" error={error} onRetry={reload} /> : !data ? <Loading lines={3} /> : (
        <>
          {data.wipWarning && (
            <div className="prj-banner" role="status">
              <Icon name="alert" />
              <div>
                <p><strong>Work-in-progress limit exceeded.</strong></p>
                <p>{data.wipWarning}</p>
              </div>
            </div>
          )}

          <div className="grid-stats">
            <Stat label="Projects" value={data.totals.projects} />
            <Stat
              label="In delivery"
              value={`${data.wip.inDelivery} of ${data.wip.limit}`}
              color={data.wip.exceeded ? 'red' : 'blue'}
            />
            <Stat label="Gate decisions due" value={data.gatesDue.length} color={data.gatesDue.length ? 'amber' : 'gray'} />
            <Stat label="Total budget" value={formatCurrency(data.totals.budget)} />
            <Stat label="Spend to date" value={formatCurrency(data.totals.spend)} />
          </div>

          <Card title="Stage funnel">
            {data.totals.projects === 0 ? <p className="muted">No projects yet.</p> : (
              <ol className="prj-funnel">
                {data.funnel.map((f) => (
                  <li key={f.stage} className="prj-funnel-step" style={{ borderTopColor: `var(--c-${f.color}-solid)` }}>
                    <span className="prj-funnel-count">{f.count}</span>
                    <span className="prj-funnel-label">{f.label}</span>
                    <span className="prj-funnel-sub">{formatCurrency(f.budget)}</span>
                    {f.stage === data.wip.stage && (
                      <span className={`prj-funnel-sub${data.wip.exceeded ? ' prj-funnel-warn' : ''}`}>
                        {f.active} active, limit {data.wip.limit}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Card>

          {data.gatesDue.length > 0 && (
            <Card title="Gate decisions due" flush>
              <div className="table-wrap">
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
                        <td>{g.ready ? 'Ready for a decision' : 'Deferred; items outstanding'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="prj-switch" role="group" aria-label="Portfolio view">
          {VIEWS.map((v) => (
            <button key={v.key} type="button" aria-pressed={view === v.key} onClick={() => setView(v.key)}>{v.label}</button>
          ))}
        </div>
      </div>

      {view === 'table' ? <PortfolioTable /> : error ? null : !data ? <Loading /> : data.register.length === 0 ? (
        <Card>
          <EmptyState
            title="No projects yet"
            message="Start with a one-page project request. It enters the portfolio as an idea."
            action={can('projects.create') ? <Button variant="primary" onClick={() => navigate('/projects/new')}>New project request</Button> : undefined}
          />
        </Card>
      ) : view === 'kanban' ? <PortfolioKanban data={data} />
        : view === 'timeline' ? <PortfolioTimeline rows={data.register} />
        : <PortfolioBudget rows={data.register} />}
    </div>
  );
}
