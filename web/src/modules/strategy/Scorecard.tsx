// The scorecard of one strategic plan: each goal with its objectives (status and latest update), their
// measures against target and their initiatives, then the status of each by quarter. The same content
// downloads as the board PDF.
import { Link, useSearchParams } from 'react-router-dom';
import {
  Card, EmptyState, ErrorState, formatDate, formatNumber, Loading, LookupChip, PageHeader, Select, Stat, TableWrap, useAuth, useFetch, type Row,
} from '../../core';
import { Matrix } from './Matrix';
import { periodLabel, type ScoreObjective, type Scorecard } from './shared';
import './strategy.css';

const value = (v: number | null, unit: string | null) => (v === null ? '—' : `${formatNumber(v)}${unit ? ` ${unit}` : ''}`);

function Objective({ o }: { o: ScoreObjective }) {
  return (
    <div className="stg-objective">
      <div className="stg-objective-head">
        <Link to={`/strategy/objectives/${o.id}`} className="stg-objective-title">{[o.code, o.title].filter(Boolean).join(' ')}</Link>
        {o.status ? <LookupChip list="strategy_rag" value={o.status} /> : <span className="muted">Not reported yet</span>}
      </div>
      {o.latest && (
        <p className="stg-narrative">
          <span className="muted">{periodLabel(o.latest.period)}{o.latest.reported_by ? `, ${o.latest.reported_by}` : ''}{o.latest.reported_on ? `, ${formatDate(o.latest.reported_on)}` : ''}: </span>
          {o.latest.narrative ?? 'No narrative given.'}
        </p>
      )}
      {o.measures.length > 0 && (
        <TableWrap label={`Measures of ${o.title}`} fit>
          <table className="table">
            <thead>
              <tr>
                <th scope="col" data-priority="1">Measure</th>
                <th scope="col" data-priority="3">Baseline</th>
                <th scope="col" data-priority="2">Period</th>
                <th scope="col" data-priority="1">Target</th>
                <th scope="col" data-priority="1">Actual</th>
                <th scope="col" data-priority="1">Against target</th>
              </tr>
            </thead>
            <tbody>
              {o.measures.map((m) => (
                <tr key={m.id}>
                  <td data-priority="1"><Link to={`/strategy/measures/${m.id}`}>{m.title}</Link></td>
                  <td data-priority="3">{value(m.baseline_value, m.unit)}{m.baseline_period ? <span className="muted"> ({m.baseline_period})</span> : null}</td>
                  <td data-priority="2">{m.latest_period ? periodLabel(m.latest_period) : '—'}</td>
                  <td data-priority="1">{value(m.latest_target, m.unit)}</td>
                  <td data-priority="1">{value(m.latest_value, m.unit)}</td>
                  <td data-priority="1">{m.latest_state ? <LookupChip list="measure_state" value={m.latest_state} /> : <span className="muted">No actual yet</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {o.initiatives.length > 0 && (
        <ul className="stg-initiatives" aria-label={`Initiatives of ${o.title}`}>
          {o.initiatives.map((i) => (
            <li key={i.id}>
              <Link to={`/strategy/initiatives/${i.id}`}>{i.ref} {i.title}</Link>
              <LookupChip list="initiative_stage" value={i.stage} />
              {i.status && <LookupChip list="strategy_rag" value={i.status} />}
              {i.project && i.project_id && <span className="muted">Project <Link to={`/projects/${i.project_id}`}>{i.project}</Link></span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PlanScorecard({ id }: { id: string }) {
  const { can } = useAuth();
  const { data, error, reload } = useFetch<Scorecard>(`/api/strategy/plans/${id}/scorecard`);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={8} label="Loading the scorecard" />;
  const t = data.totals;
  return (
    <div className="stack">
      <div className="stg-plan-line">
        <span><Link to={`/strategy/plans/${data.plan.id}`}>{data.plan.ref} {data.plan.title}</Link></span>
        <LookupChip list="strategy_plan_status" value={data.plan.status} />
        {data.plan.period_start && <span className="muted">{formatDate(data.plan.period_start)} to {formatDate(data.plan.period_end)}</span>}
        {can('strategy.export') && <a className="btn btn-secondary btn-sm" href={`/api/strategy/plans/${data.plan.id}/scorecard.pdf`} download>Board PDF</a>}
      </div>
      <div className="grid-stats">
        <Stat label="Objectives on track" icon="target" value={`${t.objectives.on_track} of ${t.objectives.total}`} color={t.objectives.total && t.objectives.on_track === t.objectives.total ? 'green' : undefined} />
        <Stat label="At risk" icon="alert" value={t.objectives.at_risk} color={t.objectives.at_risk ? 'amber' : undefined} />
        <Stat label="Off track" icon="alert-circle" value={t.objectives.off_track} color={t.objectives.off_track ? 'red' : undefined} />
        <Stat label="Measures meeting target" icon="chart" value={`${t.measures.met} of ${t.measures.total}`} hint={t.measures.no_value ? `${t.measures.no_value} with no actual yet` : undefined} />
      </div>
      {data.goals.length === 0 && <EmptyState icon="target" title="No goals yet" message="Open the plan and add its goals, then the objectives under each goal." />}
      {data.goals.map((g) => (
        <Card key={g.id} title={[g.code, g.title].filter(Boolean).join(' ')}>
          {g.description && <p className="muted">{g.description}</p>}
          {g.objectives.length === 0 ? <p className="muted">No objectives under this goal yet.</p> : g.objectives.map((o) => <Objective key={o.id} o={o} />)}
        </Card>
      ))}
      {data.goals.length > 0 && (
        <Card title="Status by quarter">
          <Matrix planId={data.plan.id} start={data.plan.period_start} end={data.plan.period_end} />
        </Card>
      )}
    </div>
  );
}

export function ScorecardPage() {
  const [params, setParams] = useSearchParams();
  const { data, error, reload } = useFetch<{ rows: Row[] }>('/api/strategy/plans?pageSize=200&sort=period_start&dir=desc');
  const header = <PageHeader title="Plan scorecard" subtitle="Each goal and objective with its status, its measures against target and its initiatives." />;
  if (error) return <div className="stack">{header}<ErrorState error={error} onRetry={reload} /></div>;
  if (!data) return <div className="stack">{header}<Loading lines={6} /></div>;
  if (!data.rows.length) {
    return (
      <div className="stack">{header}
        <EmptyState icon="target" title="No strategic plan yet" message="Add the plan on the Plan tab, with its goals and objectives; the scorecard is drawn from them." />
      </div>
    );
  }
  const chosen = params.get('plan') ?? (data.rows.find((r) => r.status === 'adopted') ?? data.rows[0]).id;
  return (
    <div className="stack">
      {header}
      <div className="stg-toolbar">
        <Select label="Plan" value={chosen} onChange={(v) => setParams({ plan: v }, { replace: true })}
          options={data.rows.map((r) => ({ value: String(r.id), label: `${r.ref ?? ''} ${r.title}`.trim() }))} />
      </div>
      <PlanScorecard key={chosen} id={chosen} />
    </div>
  );
}
