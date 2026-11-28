// The strategic plan register: the plans, one plan with its goals, objectives and quarterly matrix, and
// the record pages of goals, objectives, measures, initiatives and status updates.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Button, Card, Chart, chartColor, ErrorState, errorMessage, formatNumber, Loading, LookupSelect, Modal, PageHeader, RecordPage, ResourceList,
  Select, Stat, todayInZone, useAuth, useFetch, useResource, useToast, type Crumb, type Row,
} from '../../core';
import { Matrix } from './Matrix';
import { UpdateDialog } from './UpdateDialog';
import { periodLabel, type Summary } from './shared';
import './strategy.css';

const PLAN_FIELDS = ['title', 'description', 'period_start', 'period_end', 'status', 'adopted_on', 'decision_id', 'document_id', 'owner_id'];
const OBJECTIVE_FIELDS = ['goal_id', 'code', 'title', 'description', 'owner_id', 'department_id', 'target_date', 'sort'];
const MEASURE_FIELDS = ['objective_id', 'title', 'description', 'unit', 'direction', 'tolerance_pct', 'frequency', 'baseline_value', 'baseline_period', 'owner_id'];
const INITIATIVE_FIELDS = ['objective_id', 'title', 'description', 'owner_id', 'stage', 'start_on', 'end_on', 'project_id', 'budget_line_id', 'budget_reference', 'budget_amount'];

/** Leaves out fields the server does not offer (a switched-off area's links, a budget line type that is not installed). */
function useFields(type: string, fields: string[]): string[] {
  const resource = useResource(type);
  return resource ? fields.filter((f) => resource.fields[f]) : fields;
}

export function Figures({ s }: { s: Summary }) {
  const o = s.objectives;
  return (
    <div className="grid-stats">
      <Stat label="Objectives on track" icon="target" value={`${o.on_track} of ${o.total}`} color={o.total && o.on_track === o.total ? 'green' : undefined}
        hint={`${s.plans_in_force} plan${s.plans_in_force === 1 ? '' : 's'} in force`} to="/strategy/scorecard" />
      <Stat label="At risk" icon="alert" value={o.at_risk} color={o.at_risk ? 'amber' : undefined} hint="Objectives, latest update" />
      <Stat label="Off track" icon="alert-circle" value={o.off_track} color={o.off_track ? 'red' : undefined} hint="Objectives, latest update" />
      <Stat label="Measures meeting target" icon="chart" value={`${s.measures.met} of ${s.measures.total}`} hint={s.measures.missed ? `${s.measures.missed} missing their target` : 'Latest actuals'} to="/strategy/measures" />
      <Stat label="Statistical reports due" icon="upload" value={s.submissions.due_soon} color={s.submissions.overdue ? 'red' : s.submissions.due_soon ? 'amber' : undefined}
        hint={s.submissions.overdue ? `${s.submissions.overdue} overdue` : `Within ${s.due_soon_days} days`} to="/strategy/submissions" />
    </div>
  );
}

export function PlanHome() {
  const { data: s } = useFetch<Summary>('/api/strategy/summary');
  return (
    <div className="stack">
      <PageHeader title="Strategy" subtitle="The organization's strategic plans: goals, objectives, measures and the initiatives that deliver them, with a status update each quarter." />
      {s ? <Figures s={s} /> : <Loading lines={2} label="Loading the figures" />}
      <ResourceList
        type="strategic_plan"
        title="Strategic plans"
        urlState
        columns={['ref', 'title', 'period_start', 'period_end', 'status', 'adopted_on', { field: 'owner_id', priority: 3 }]}
        filters={['status', 'owner_id', 'period_start', 'period_end']}
        createFields={PLAN_FIELDS}
      />
    </div>
  );
}

function PlanActions({ row }: { row: Row }) {
  const { can } = useAuth();
  return (
    <>
      <Link className="btn btn-secondary" to={`/strategy/scorecard?plan=${row.id}`}>Scorecard</Link>
      {can('strategy.export') && <a className="btn btn-secondary" href={`/api/strategy/plans/${row.id}/scorecard.pdf`} download>Board PDF</a>}
    </>
  );
}

export function PlanDetail() {
  const objectiveFields = useFields('strategic_objective', OBJECTIVE_FIELDS);
  return (
    <RecordPage
      type="strategic_plan"
      breadcrumbs={CRUMBS}
      actions={({ row }) => <PlanActions row={row} />}
      summaryFields={[...PLAN_FIELDS, 'notes']}
      tabs={[
        {
          key: 'goals', label: 'Goals',
          content: ({ row }) => (
            <ResourceList type="strategic_goal" baseFilter={{ plan_id: row.id }} urlState={false} defaultSort={{ field: 'sort', dir: 'asc' }}
              columns={['code', 'title', 'owner_id', 'sort']} createFields={['code', 'title', 'description', 'owner_id', 'sort']} createInitial={{ plan_id: row.id }} />
          ),
        },
        {
          key: 'objectives', label: 'Objectives',
          content: ({ row }) => (
            <ResourceList type="strategic_objective" baseFilter={{ plan_id: row.id }} urlState={false} defaultSort={{ field: 'sort', dir: 'asc' }}
              columns={['ref', 'code', 'title', 'goal_id', 'status', 'status_period', { field: 'owner_id', priority: 3 }, { field: 'target_date', priority: 3 }]}
              filters={['goal_id', 'status', 'owner_id', 'department_id']} createFields={objectiveFields} />
          ),
        },
        { key: 'matrix', label: 'By quarter', content: ({ row }) => <Matrix planId={row.id} start={row.period_start} end={row.period_end} /> },
      ]}
    />
  );
}

/** The record pages of the plan's parts lead back to the Strategy page (they have no list of their own). */
const CRUMBS: Crumb[] = [{ label: 'Strategy', to: '/strategy' }];

export function GoalDetail() {
  const objectiveFields = useFields('strategic_objective', OBJECTIVE_FIELDS).filter((f) => f !== 'goal_id');
  return (
    <RecordPage
      type="strategic_goal"
      breadcrumbs={CRUMBS}
      subtitle={(row) => (row.plan_id ? <>Goal of <Link to={`/strategy/plans/${row.plan_id}`}>{row._display?.plan_id ?? 'the plan'}</Link></> : null)}
      summaryFields={['plan_id', 'code', 'title', 'description', 'owner_id', 'sort']}
      tabs={[{
        key: 'objectives', label: 'Objectives',
        content: ({ row }) => (
          <ResourceList type="strategic_objective" baseFilter={{ goal_id: row.id }} urlState={false} defaultSort={{ field: 'sort', dir: 'asc' }}
            columns={['ref', 'code', 'title', 'status', 'owner_id', 'target_date']} createFields={objectiveFields} createInitial={{ goal_id: row.id }} />
        ),
      }]}
    />
  );
}

function Updates({ subject }: { subject: { objective_id?: string; initiative_id?: string; label: string } }) {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(0);
  const filter: Record<string, string> = subject.objective_id ? { objective_id: subject.objective_id } : { initiative_id: subject.initiative_id ?? '' };
  return (
    <div className="stack">
      {can('strategy.create') && <div><Button variant="primary" onClick={() => setOpen(true)}>Add a status update</Button></div>}
      <ResourceList key={n} type="strategy_update" baseFilter={filter} urlState={false} defaultSort={{ field: 'period', dir: 'desc' }}
        columns={['period', 'status', 'narrative', 'reported_on', 'reported_by_name']} extras={false} />
      {open && <UpdateDialog subject={subject} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); setN((x) => x + 1); }} />}
    </div>
  );
}

export function ObjectiveDetail() {
  const measureFields = useFields('strategic_measure', MEASURE_FIELDS).filter((f) => f !== 'objective_id');
  const initiativeFields = useFields('strategic_initiative', INITIATIVE_FIELDS).filter((f) => f !== 'objective_id');
  return (
    <RecordPage
      type="strategic_objective"
      breadcrumbs={CRUMBS}
      subtitle={(row) => (row.goal_id ? <>Under goal <Link to={`/strategy/goals/${row.goal_id}`}>{row._display?.goal_id ?? 'goal'}</Link></> : null)}
      summaryFields={['goal_id', 'plan_id', 'code', 'title', 'description', 'owner_id', 'department_id', 'target_date', 'status', 'status_period', 'sort']}
      tabs={[
        {
          key: 'measures', label: 'Measures',
          content: ({ row }) => (
            <ResourceList type="strategic_measure" baseFilter={{ objective_id: row.id }} urlState={false}
              columns={['ref', 'title', 'unit', 'baseline_value', 'latest_period', 'latest_target', 'latest_value', 'latest_state']}
              createFields={measureFields} createInitial={{ objective_id: row.id }} />
          ),
        },
        {
          key: 'initiatives', label: 'Initiatives',
          content: ({ row }) => (
            <ResourceList type="strategic_initiative" baseFilter={{ objective_id: row.id }} urlState={false}
              columns={['ref', 'title', 'stage', 'status', 'owner_id', 'end_on', { field: 'project_id', priority: 3 }]}
              createFields={initiativeFields} createInitial={{ objective_id: row.id }} />
          ),
        },
        { key: 'updates', label: 'Status updates', content: ({ row }) => <Updates subject={{ objective_id: row.id, label: String(row.title) }} /> },
      ]}
    />
  );
}

export function InitiativeDetail() {
  const { can } = useAuth();
  const fields = useFields('strategic_initiative', INITIATIVE_FIELDS);
  const actionsOn = Boolean(useResource('action'));
  return (
    <RecordPage
      type="strategic_initiative"
      breadcrumbs={CRUMBS}
      subtitle={(row) => (row.objective_id ? <>For objective <Link to={`/strategy/objectives/${row.objective_id}`}>{row._display?.objective_id ?? 'objective'}</Link></> : null)}
      summaryFields={[...fields, 'plan_id', 'status', 'status_period']}
      tabs={[
        { key: 'updates', label: 'Status updates', content: ({ row }) => <Updates subject={{ initiative_id: row.id, label: String(row.title) }} /> },
        ...(actionsOn && can('actions.view') ? [{
          key: 'actions', label: 'Actions',
          content: ({ row }: { row: Row }) => (
            <ResourceList type="action" baseFilter={{ source_type: 'strategic_initiative', source_id: row.id }} urlState={false}
              columns={['ref', 'title', 'status', 'owner_id', 'due_on', 'priority']}
              createFields={['title', 'description', 'owner_id', 'due_on', 'priority']}
              createInitial={{ source: 'strategy', source_type: 'strategic_initiative', source_id: row.id }} />
          ),
        }] : []),
      ]}
    />
  );
}

/** A measure's targets and actuals over time. */
function MeasureChart({ measureId, unit }: { measureId: string; unit?: string | null }) {
  const { data, error, reload } = useFetch<{ rows: Row[] }>(`/api/strategy/measure-values?f.measure_id=${measureId}&sort=period_start&dir=asc&pageSize=60`);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={4} />;
  const rows = data.rows;
  const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
  const option = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['Target', 'Actual'], bottom: 0 },
    grid: { left: 48, right: 16, top: 16, bottom: 48 },
    xAxis: { type: 'category', data: rows.map((r) => periodLabel(String(r.period))) },
    yAxis: { type: 'value', name: unit ?? '', scale: true },
    series: [
      { name: 'Target', type: 'line', data: rows.map((r) => num(r.target)), lineStyle: { type: 'dashed' }, color: chartColor('gray') },
      { name: 'Actual', type: 'line', data: rows.map((r) => num(r.actual)), color: chartColor('blue'), connectNulls: false },
    ],
  };
  return <Chart label="Target and actual of the measure by period" option={option} height={240} empty={rows.length === 0} emptyMessage="No targets or actuals yet" />;
}

function PullButton({ row, onDone }: { row: Row; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const { can } = useAuth();
  if (!can('strategy.edit') || !['metric', 'figure'].includes(String(row.source))) return null;
  const pull = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ value: number | null }>(`/api/strategy/measures/${row.id}/pull`, { period: todayInZone() });
      toast.success(r.value === null ? 'No value is available for this period yet.' : `Taken: ${formatNumber(r.value)}.`);
      onDone();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return <Button loading={busy} onClick={() => void pull()}>Take the current value</Button>;
}

interface Sources { metrics: { key: string; label: string; unit: string; description: string }[]; figures: { id: string; name: string }[] }

/** Choose where a measure's actuals come from: entered by hand, a metric, or a figure recorded over time. */
function SourceDialog({ row, onClose, onSaved }: { row: Row; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { data, error, reload } = useFetch<Sources>('/api/strategy/measure-sources');
  const [source, setSource] = useState<string>(String(row.source ?? 'manual'));
  const [metric, setMetric] = useState<string>(String(row.metric_key ?? ''));
  const [figure, setFigure] = useState<string>(String(row.figure_id ?? ''));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/api/strategy/measures/${row.id}`, { source, ...(source === 'metric' ? { metric_key: metric } : {}), ...(source === 'figure' ? { figure_id: figure } : {}) });
      toast.success('Data source saved.');
      onSaved();
    } catch (err) {
      setErrors((err as { fields?: Record<string, string> }).fields ?? {});
      toast.error(errorMessage(err));
    } finally { setBusy(false); }
  };
  const chosen = data?.metrics.find((m) => m.key === metric);
  return (
    <Modal open title="Data source" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!data} onClick={() => void save()}>Save</Button></>}>
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loading lines={3} /> : (
        <div className="stack">
          <LookupSelect label="Actuals come from" list="measure_source" required value={source} onChange={setSource} error={errors.source} />
          {source === 'metric' && (
            <Select label="Metric" required searchable value={metric} onChange={setMetric} error={errors.metric_key}
              hint={chosen?.description} options={data.metrics.map((m) => ({ value: m.key, label: m.label }))} />
          )}
          {source === 'figure' && (data.figures.length
            ? <Select label="Figure over time" required searchable value={figure} onChange={setFigure} error={errors.figure_id} options={data.figures.map((f) => ({ value: f.id, label: f.name }))} />
            : <p className="muted">No figures over time are available to you. They are kept under Reports.</p>)}
          {source !== 'manual' && <p className="muted">The actual of the current and the previous period is taken from it each day.</p>}
        </div>
      )}
    </Modal>
  );
}

function SourceButton({ row, onDone }: { row: Row; onDone: () => void }) {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  if (!can('strategy.edit')) return null;
  return (
    <>
      <Button onClick={() => setOpen(true)}>Data source…</Button>
      {open && <SourceDialog row={row} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); onDone(); }} />}
    </>
  );
}

export function MeasureDetail() {
  const fields = useFields('strategic_measure', MEASURE_FIELDS);
  const [n, setN] = useState(0);
  return (
    <RecordPage
      type="strategic_measure"
      breadcrumbs={CRUMBS}
      subtitle={(row) => (row.objective_id ? <>Measures objective <Link to={`/strategy/objectives/${row.objective_id}`}>{row._display?.objective_id ?? 'objective'}</Link></> : null)}
      actions={({ row, reload }) => (
        <>
          <PullButton row={row} onDone={() => { reload(); setN((x) => x + 1); }} />
          <SourceButton row={row} onDone={reload} />
        </>
      )}
      summaryFields={[...fields, 'source', 'metric_key', 'figure_id', 'plan_id', 'latest_period', 'latest_target', 'latest_value', 'latest_state']}
      tabs={[{
        key: 'values', label: 'Targets and actuals',
        content: ({ row }) => (
          <div className="stack" key={n}>
            <Card title="Over time"><MeasureChart measureId={row.id} unit={row.unit} /></Card>
            <ResourceList type="measure_value" baseFilter={{ measure_id: row.id }} urlState={false} defaultSort={{ field: 'period_start', dir: 'desc' }}
              columns={['period', 'target', 'actual', 'state', 'value_source', { field: 'entered_by_name', priority: 3 }, { field: 'entered_at', priority: 3 }]}
              createFields={['period', 'target', 'actual', 'note']} createInitial={{ measure_id: row.id }} />
          </div>
        ),
      }]}
    />
  );
}

export function MeasureValueDetail() {
  return (
    <RecordPage
      type="measure_value"
      breadcrumbs={CRUMBS}
      title={(row) => `${row._display?.measure_id ?? 'Measure'}: ${periodLabel(String(row.period))}`}
      subtitle={(row) => <>Value of <Link to={`/strategy/measures/${row.measure_id}`}>{row._display?.measure_id ?? 'the measure'}</Link></>}
      summaryFields={['measure_id', 'period', 'target', 'actual', 'state', 'note', 'value_source', 'entered_by', 'entered_by_name', 'entered_at', 'period_start', 'period_end']}
    />
  );
}

export function UpdateDetail() {
  return (
    <RecordPage
      type="strategy_update"
      title={(row) => `${row._display?.objective_id ?? row._display?.initiative_id ?? 'Status update'}: ${periodLabel(String(row.period))}`}
      breadcrumbs={CRUMBS}
      subtitle={(row) => (row.objective_id
        ? <>Update of objective <Link to={`/strategy/objectives/${row.objective_id}`}>{row._display?.objective_id ?? 'objective'}</Link></>
        : row.initiative_id ? <>Update of initiative <Link to={`/strategy/initiatives/${row.initiative_id}`}>{row._display?.initiative_id ?? 'initiative'}</Link></> : null)}
      summaryFields={['objective_id', 'initiative_id', 'plan_id', 'period', 'status', 'narrative', 'reported_on', 'reported_by', 'reported_by_name']}
    />
  );
}
