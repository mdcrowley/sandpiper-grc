import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ApiError, Button, Card, DateField, EmptyState, ErrorState, Loading, Modal, PageHeader, Select, Stat, TableWrap, TextArea, TextField,
  api, errorMessage, formatDate, todayInZone, useAuth, useCustomFieldInputs, useFetch, useToast, useUnsavedChanges,
} from '../../core';
import { useFrameworkChoice } from './Board';
import { rememberFramework } from './boardState';
import { ComparePanel } from './Compare';
import { ProgressChart } from './ProgressChart';
import { StatusBar, StatusLegend } from './StatusBar';
import type { Progress } from './types';
import { frameworkTitle } from './types';

function TakeSnapshot({ frameworkId, onDone, onCancel }: { frameworkId: string; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // The administrator's custom fields on snapshots (E18-34), under the built-in ones.
  const custom = useCustomFieldInputs('assessment_snapshot', { flat: true });
  // Tells the enclosing dialog, so closing it with something typed asks first.
  useUnsavedChanges(Boolean(name.trim() || date || notes.trim()) || custom.dirty);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!name.trim()) found.name = 'Name is required.';
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) found.date = 'Enter a date.';
    else if (date > todayInZone()) found.date = 'Date cannot be in the future.';
    else if (date && date < '2000-01-01') found.date = 'Date cannot be before 2000-01-01.';
    setErrors(found);
    const extra = custom.collect();
    if (Object.keys(found).length || !extra) return;
    setBusy(true);
    try {
      await api.post('/api/assessments', { name, date: date || undefined, notes, framework_id: frameworkId, ...extra });
      toast.success('Snapshot taken.');
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        setErrors({ ...err.fields, date: err.fields.taken_on ?? err.fields.date });
        custom.showErrors(err.fields);
      } else toast.error(errorMessage(err));
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
      {custom.inputs}
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
    <TableWrap fit label="Snapshots, newest first">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Snapshot</th><th scope="col">Date</th><th scope="col" style={{ minWidth: 180 }} data-priority={3}>Outcomes by status</th>
            <th scope="col" className="num" data-priority={1}>Score, priority</th><th scope="col" className="num">Score, all</th><th scope="col" className="num">Priority at target</th>
            <th scope="col" data-priority={1}><span className="sr-only">Report</span></th>
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
              <td className="num">{p.id && <Link to={`/assessments/${p.id}/report`}>Report</Link>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function AssessmentsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const choice = useFrameworkChoice(search.get('framework') ?? undefined);
  const progress = useFetch<Progress>(choice.id ? `/api/frameworks/${choice.id}/progress` : null);
  const [taking, setTaking] = useState(search.get('new') === '1');

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
  const now = data.series[data.series.length - 1];
  const last = snapshots[snapshots.length - 1];
  const hasOutcomes = now.all.total > 0;
  const targetLabel = data.statuses.find((s) => s.value === data.target.status)?.label ?? data.target.status;
  const takeButton = can('frameworks.create') && hasOutcomes
    && <Button variant="primary" icon="plus" onClick={() => setTaking(true)}>Take snapshot</Button>;
  const since = (n: number, unit: string) => (last ? {
    direction: n > 0 ? 'up' as const : n < 0 ? 'down' as const : 'flat' as const,
    label: n === 0 ? `No change since ${last.name}` : `${n > 0 ? '+' : '−'}${Math.abs(n)} ${unit} since ${last.name}`,
    tone: n > 0 ? 'good' as const : n < 0 ? 'bad' as const : 'neutral' as const,
  } : undefined);

  return (
    <div className="stack fw-page">
      <PageHeader
        title="Assessments"
        subtitle={`Point-in-time snapshots of ${frameworkTitle(data.framework)}, so progress can be shown between dates`}
        actions={
          <div className="row">
            {choice.frameworks.length > 1 && (
              <Select label="Framework" hideLabel required value={choice.id}
                options={choice.frameworks.map((f) => ({ value: f.id, label: frameworkTitle(f) }))}
                onChange={(v) => { if (v) { rememberFramework(v); setSearch({ framework: v }); } }} />
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
          <div className="grid-stats">
            <Stat label="Score now, all outcomes" value={now.all.score} hint={last ? undefined : `Target ${data.target.score}`}
              trend={since(now.all.score - (last?.all.score ?? 0), 'points')} />
            <Stat label="Score now, priority outcomes" value={now.priority.score} hint={last ? undefined : `Target ${data.target.score}`}
              trend={since(now.priority.score - (last?.priority.score ?? 0), 'points')} />
            <Stat label={`Priority outcomes at “${targetLabel}” or better`} value={`${now.priority.atTarget} of ${now.priority.total}`} color="green"
              trend={since(now.priority.atTarget - (last?.priority.atTarget ?? 0), 'outcomes')} />
            <Stat label="Snapshots taken" value={snapshots.length} icon="history"
              hint={last ? `Latest: ${last.name}, ${formatDate(last.date)}` : 'Take the first one to set a baseline'} />
          </div>

          <Card title="Progress over time">
            {snapshots.length === 0 ? (
              <EmptyState icon="chart" title="No snapshots yet"
                message="Take the first snapshot to set a baseline. Each later snapshot adds a point to this chart."
                action={takeButton || undefined} />
            ) : (
              <figure className="fw-figure">
                <figcaption>
                  <strong>
                    {now.all.score === snapshots[0].all.score ? `The score for all outcomes is unchanged at ${now.all.score}`
                      : `The score for all outcomes has ${now.all.score > snapshots[0].all.score ? 'risen' : 'fallen'} from ${snapshots[0].all.score} to ${now.all.score}`}
                  </strong>{' '}
                  since {snapshots[0].name} ({formatDate(snapshots[0].date)}). The target is {data.target.score}.
                </figcaption>
                <ProgressChart progress={data} />
                <p className="fw-figure-note">
                  The score weights each outcome by its status ({data.statuses.map((s) => `${s.label} ${Math.round(s.weight * 100)}`).join(', ')})
                  and averages them. The dashed line is the score with every outcome at “{targetLabel}”. The open circle is today’s position, which is not saved until a snapshot is taken.
                </p>
              </figure>
            )}
          </Card>

          <Card title="Snapshots" flush>
            <SnapshotTable progress={data} />
          </Card>
          <StatusLegend scale={data.statuses} />

          <ComparePanel points={data.series} />
        </>
      )}

      <Modal open={taking} title="Take snapshot" onClose={() => setTaking(false)}>
        <TakeSnapshot
          frameworkId={choice.id}
          onCancel={() => setTaking(false)}
          onDone={() => { setTaking(false); progress.reload(); }}
        />
      </Modal>
    </div>
  );
}
