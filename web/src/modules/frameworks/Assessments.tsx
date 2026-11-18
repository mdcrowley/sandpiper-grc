import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ApiError, Button, Card, DateField, EmptyState, ErrorState, Loading, Modal, PageHeader, Select, TextArea, TextField,
  api, errorMessage, formatDate, todayInZone, useAuth, useFetch, useToast,
} from '../../core';
import { useFrameworkChoice } from './Board';
import { ComparePanel } from './Compare';
import { ProgressChart } from './ProgressChart';
import { StatusBar, StatusLegend } from './StatusBar';
import type { Progress } from './types';

function TakeSnapshot({ frameworkId, onDone, onCancel }: { frameworkId: string; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErrors({ name: 'Name is required.' }); return; }
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) { setErrors({ date: 'Enter a date.' }); return; }
    if (date > todayInZone()) { setErrors({ date: 'Date cannot be in the future.' }); return; }
    if (date && date < '2000-01-01') { setErrors({ date: 'Date cannot be before 2000-01-01.' }); return; }
    setBusy(true);
    setErrors({});
    try {
      await api.post('/api/assessments', { name, date: date || undefined, notes, framework_id: frameworkId });
      toast.success('Snapshot taken.');
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors({ ...err.fields, date: err.fields.taken_on ?? err.fields.date });
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <p className="muted" style={{ margin: 0 }}>
        A snapshot records the status of every outcome as it stands right now. It cannot be changed afterwards.
      </p>
      <TextField label="Name" required autoFocus value={name} onChange={setName} error={errors.name}
        placeholder="For example: Quarter 1 review" />
      <DateField label="Date" value={date} onChange={setDate} error={errors.date} hint="Leave empty for today." />
      <TextArea label="Notes" rows={3} value={notes} onChange={setNotes} error={errors.notes} />
      <div className="form-actions">
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy}>Take snapshot</Button>
      </div>
    </form>
  );
}

function SnapshotTable({ progress }: { progress: Progress }) {
  const rows = [...progress.series].reverse();
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Snapshot</th><th>Date</th><th style={{ minWidth: 180 }}>Outcomes by status</th>
            <th className="num">Score, priority</th><th className="num">Score, all</th><th className="num">Priority at target</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id ?? 'now'}>
              <td className="row-title">
                {p.id ? <Link to={`/assessments/${p.id}`}>{p.name}</Link> : <span>Now <span className="muted">(not saved)</span></span>}
              </td>
              <td>{formatDate(p.date)}</td>
              <td><StatusBar tally={p.all} scale={progress.statuses} label={`${p.name}: outcomes by status`} /></td>
              <td className="num">{p.priority.score}</td>
              <td className="num">{p.all.score}</td>
              <td className="num">{p.priority.atTarget} of {p.priority.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AssessmentsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const choice = useFrameworkChoice(search.get('framework') ?? undefined);
  const progress = useFetch<Progress>(choice.id ? `/api/frameworks/${choice.id}/progress` : null);
  const [taking, setTaking] = useState(search.get('new') === '1');
  const [version, setVersion] = useState(0);

  if (choice.error) return <ErrorState error={choice.error} onRetry={choice.reload} />;
  if (!choice.data) return <Loading lines={8} label="Loading assessments" />;
  if (!choice.id) {
    return (
      <>
        <PageHeader title="Assessments" />
        <EmptyState icon="shield" title="No framework has been loaded yet"
          message="Assessments record the status of a framework's outcomes at a point in time. Load a framework first."
          action={<Button onClick={() => navigate('/frameworks')}>Go to framework outcomes</Button>} />
      </>
    );
  }
  if (progress.error) return <ErrorState error={progress.error} onRetry={progress.reload} />;
  const data = progress.data;
  if (!data) return <Loading lines={10} label="Loading assessments" />;

  const snapshots = data.series.filter((p) => p.id !== null);
  const hasOutcomes = data.series[data.series.length - 1].all.total > 0;
  const takeButton = can('frameworks.create') && hasOutcomes
    && <Button variant="primary" icon="plus" onClick={() => setTaking(true)}>Take snapshot</Button>;

  return (
    <div className="stack">
      <PageHeader
        title="Assessments"
        subtitle={`Point-in-time snapshots of ${data.framework.name}${data.framework.version ? ` ${data.framework.version}` : ''}, so progress can be shown between dates`}
        actions={
          <div className="row">
            {choice.frameworks.length > 1 && (
              <Select label="Framework" hideLabel value={choice.id}
                options={choice.frameworks.map((f) => ({ value: f.id, label: f.name }))}
                onChange={(v) => v && setSearch({ framework: v })} />
            )}
            {takeButton}
          </div>
        }
      />

      {!hasOutcomes ? (
        <EmptyState icon="target" title="This framework has no outcomes yet"
          message="Add outcomes before taking a snapshot."
          action={<Button onClick={() => navigate('/frameworks')}>Go to framework outcomes</Button>} />
      ) : (
        <>
          <Card title="Progress over time">
            {snapshots.length === 0 ? (
              <EmptyState icon="chart" title="No snapshots yet"
                message="Take the first snapshot to set a baseline. Each later snapshot adds a point to this chart."
                action={takeButton || undefined} />
            ) : (
              <>
                <ProgressChart progress={data} />
                <p className="muted" style={{ margin: 0, fontSize: 'var(--fs-sm)' }}>
                  The score weights each outcome by its status ({data.statuses.map((s) => `${s.label} ${Math.round(s.weight * 100)}`).join(', ')})
                  and averages them. The target line is every outcome at "{data.statuses.find((s) => s.value === data.target.status)?.label ?? data.target.status}".
                </p>
              </>
            )}
          </Card>

          <Card title="Snapshots" flush>
            <SnapshotTable progress={data} />
          </Card>
          <StatusLegend scale={data.statuses} />

          <ComparePanel key={version} points={data.series} />
        </>
      )}

      <Modal open={taking} title="Take snapshot" onClose={() => setTaking(false)}>
        <TakeSnapshot
          frameworkId={choice.id}
          onCancel={() => setTaking(false)}
          onDone={() => { setTaking(false); setVersion((v) => v + 1); progress.reload(); }}
        />
      </Modal>
    </div>
  );
}
