// Administration > Approval workflows (/admin/workflows): the workflows by record type, those
// running now, and the head of each department for "department head" steps.
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  api, Button, Card, EmptyState, ErrorState, errorMessage, formatDateTime, Loading, PageHeader, relativeTime, StatusChip, Tabs,
  UserPicker, useFetch, useToast,
} from '../../core';
import { FlowDiagram } from './FlowDiagram';
import { plural, type Definition, type Options } from './data';
import { conditionsText, makeLabels, triggerText } from './describe';
import './workflows.css';

interface RunningRow {
  id: string; workflow: string; record_type_label: string; record_label: string | null; route: string; requested_by_name: string | null;
  started_at: string; step_name: string | null; due_at: string | null; problem: string | null;
}

function WorkflowCard({ def, options }: { def: Definition; options: Options }) {
  const labels = useMemo(() => makeLabels(options, def.record_type, def.people ?? {}), [options, def]);
  return (
    <li className={`wf-def${def.active ? '' : ' is-inactive'}`}>
      <div className="wf-def-head">
        <Link to={`/admin/workflows/${def.id}`} className="wf-def-name">{def.name}</Link>
        <span className="wf-def-chips">
          {!def.active && <StatusChip color="gray" label="Inactive" size="sm" />}
          {def.available === false && <StatusChip color="amber" label="Area switched off" size="sm" />}
          {(def.running ?? 0) > 0 && <StatusChip color="blue" label={`${def.running} running`} size="sm" />}
        </span>
      </div>
      <p className="muted wf-small">
        {triggerText(def, labels)}{def.conditions.length ? `, only if ${conditionsText(def.conditions, labels)}` : ''} · {plural(def.steps.length, 'step')}
        {def.started ? ` · started ${def.started} ${def.started === 1 ? 'time' : 'times'}` : ''}
      </p>
      <FlowDiagram def={def} labels={labels} compact />
    </li>
  );
}

function Definitions({ options }: { options: Options }) {
  const navigate = useNavigate();
  const { data, error, reload } = useFetch<{ rows: Definition[] }>('/api/workflows/definitions');
  if (error) return <ErrorState title="Workflows could not be loaded" error={error} onRetry={reload} />;
  if (!data) return <Loading label="Loading workflows" lines={6} />;
  if (!data.rows.length) {
    return (
      <EmptyState
        icon="check-square"
        title="No approval workflows yet"
        message="A workflow sends a record through ordered approval steps: named people, a role, the record's owner or a department head, with optional conditions, due times and escalation."
        action={<Button variant="primary" icon="plus" onClick={() => navigate('/admin/workflows/new')}>New workflow</Button>}
      />
    );
  }
  const groups = new Map<string, Definition[]>();
  for (const d of data.rows) groups.set(d.record_type_label ?? d.record_type, [...(groups.get(d.record_type_label ?? d.record_type) ?? []), d]);
  return (
    <div className="wf-groups">
      {[...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, defs]) => (
        <Card key={label} title={label}>
          <ul className="wf-defs">{defs.map((d) => <WorkflowCard key={d.id} def={d} options={options} />)}</ul>
        </Card>
      ))}
    </div>
  );
}

function Running() {
  const { data, error, reload } = useFetch<{ rows: RunningRow[] }>('/api/workflows/running');
  const toast = useToast();
  if (error) return <ErrorState title="Running workflows could not be loaded" error={error} onRetry={reload} />;
  if (!data) return <Loading label="Loading running workflows" lines={4} />;
  if (!data.rows.length) return <EmptyState icon="check-circle" title="Nothing is running" message="Workflows waiting for approval on any record are listed here." />;
  const cancel = async (id: string) => {
    try {
      await api.post(`/api/workflows/instances/${id}/cancel`, { reason: 'Canceled by an administrator.' });
      toast.success('Workflow canceled.');
      reload();
    } catch (err) { toast.error(errorMessage(err)); }
  };
  return (
    <Card flush>
      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">Workflows running now</caption>
          <thead><tr><th scope="col">Record</th><th scope="col">Workflow</th><th scope="col">Waiting at</th><th scope="col">Asked by</th><th scope="col">Started</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id}>
                <td>{r.record_label ? <Link to={r.route}>{r.record_type_label} {r.record_label}</Link> : <span className="muted">{r.record_type_label} (restricted)</span>}</td>
                <td>{r.workflow}</td>
                <td>
                  {r.step_name ?? '—'}
                  {r.problem && <div className="wf-table-problem">{r.problem}</div>}
                </td>
                <td>{r.requested_by_name ?? 'The system'}</td>
                <td title={formatDateTime(r.started_at)}>{relativeTime(r.started_at)}</td>
                <td className="num"><Button size="sm" variant="ghost" onClick={() => void cancel(r.id)}>Cancel<span className="sr-only"> {r.workflow}</span></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function DepartmentHeads({ options, reload }: { options: Options; reload: () => void }) {
  const toast = useToast();
  const [saving, setSaving] = useState<string | null>(null);
  if (!options.departments.length) {
    return <EmptyState icon="building" title="No departments yet" message="Departments are added under Administration > Settings > Departments. Each can then have a head who approves department-head steps." />;
  }
  const set = async (departmentId: string, userId: string | null) => {
    setSaving(departmentId);
    try {
      await api.put(`/api/workflows/department-heads/${departmentId}`, { user_id: userId });
      toast.success(userId ? 'Department head saved.' : 'Department head cleared.');
      reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setSaving(null); }
  };
  return (
    <Card title="Department heads" actions={<span className="muted wf-small">Used by steps approved by &quot;the head of a department&quot;</span>}>
      <ul className="wf-heads">
        {options.departments.map((d) => (
          <li key={d.id} className="wf-head">
            <span className="wf-head-name">{d.name}</span>
            <UserPicker
              label={`Head of ${d.name}`}
              hideLabel
              value={d.head_id}
              display={d.head_name ?? undefined}
              placeholder="No head set"
              disabled={saving === d.id}
              onChange={(id) => void set(d.id, id)}
            />
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function WorkflowsAdmin() {
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const options = useFetch<Options>('/api/workflows/options');
  const tab = (['workflows', 'running', 'heads'] as const).find((v) => v === search.get('tab')) ?? 'workflows';
  const body = (content: (o: Options) => ReactNode) => (options.error
    ? <ErrorState title="Workflow options could not be loaded" error={options.error} onRetry={options.reload} />
    : !options.data ? <Loading lines={5} /> : content(options.data));
  return (
    <div className="wf-page">
      <PageHeader
        title="Approval workflows"
        subtitle="Ordered approval steps for any kind of record: who approves, when, and what happens at the end."
        actions={<Button variant="primary" icon="plus" onClick={() => navigate('/admin/workflows/new')}>New workflow</Button>}
      />
      <Tabs
        label="Approval workflows"
        active={tab}
        onChange={(key) => setSearch((p) => { p.set('tab', key); return p; }, { replace: true })}
        tabs={[
          { key: 'workflows', label: 'Workflows', content: tab === 'workflows' ? body((o) => <Definitions options={o} />) : null },
          { key: 'running', label: 'Running now', content: tab === 'running' ? <Running /> : null },
          { key: 'heads', label: 'Department heads', content: tab === 'heads' ? body((o) => <DepartmentHeads options={o} reload={options.reload} />) : null },
        ]}
      />
    </div>
  );
}
