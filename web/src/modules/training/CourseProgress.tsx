// A course's completion tracking: progress bar, people outstanding, people who have completed.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  api, Button, Card, ConfirmDialog, EmptyState, ErrorState, errorMessage, IconButton, Loading, ProgressBar, Stat,
  useAuth, useFetch, useToast,
} from '../../core';
import { RecordDialog } from './RecordDialog';
import { rateColor, recordsLink, RecordStatusChip, ResultCell, SOURCE, WhenCell } from './shared';
import type { Progress, TrainingRecord } from './shared';

export function CourseProgressBar({ courseId }: { courseId: string }) {
  const { data, error, reload } = useFetch<Progress>(`/api/courses/${courseId}/progress`);
  if (error) return <ErrorState title="Completion could not be loaded" error={error} onRetry={reload} />;
  if (!data) return <Loading lines={2} label="Loading completion" />;
  const link = (status?: string) => recordsLink({ course_id: courseId, status });
  return (
    <div className="stack">
      <ProgressBar
        label="Completed" value={data.complete} max={Math.max(1, data.total)} color={rateColor(data.rate)}
        valueText={data.total ? `${data.complete} of ${data.total} people (${data.rate}%)` : 'Nobody has been given this course yet'}
      />
      <div className="grid-stats">
        <Stat label="People" value={data.total} to={link()} />
        <Stat label="Completed" value={data.complete} color="green" to={link('complete')} />
        <Stat label="To do" value={data.due} color="blue" to={link('due')} />
        <Stat label="Overdue" value={data.overdue} color={data.overdue ? 'red' : 'gray'} to={link('overdue')} />
      </div>
    </div>
  );
}

function PeopleTable({ caption, rows, today, selected, onToggle, onComplete, onRemove }: {
  caption: string; rows: TrainingRecord[]; today: string; selected?: Set<string>; onToggle?: (id: string) => void;
  onComplete?: (r: TrainingRecord) => void; onRemove?: (r: TrainingRecord) => void;
}) {
  const outstanding = !!selected;
  return (
    <div className="table-wrap trn-tw">
      <table className="table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {onToggle && <th scope="col"><span className="sr-only">Select</span></th>}
            <th scope="col">Person</th><th scope="col">Department</th><th scope="col">Status</th>
            <th scope="col">{outstanding ? 'Due' : 'Completed'}</th>
            <th scope="col">{outstanding ? 'How it was assigned' : 'Result'}</th>
            {!outstanding && <th scope="col">Evidence</th>}
            {(onComplete || onRemove) && <th scope="col"><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              {onToggle && (
                <td className="trn-check">
                  <input type="checkbox" aria-label={`Select ${r.person}`} checked={selected!.has(r.id)} onChange={() => onToggle(r.id)} />
                </td>
              )}
              <td>
                <span className="row-title">{r.person}</span>
                {!r.has_account && <span className="muted trn-tag">no account</span>}
              </td>
              <td>{r.department ?? <span className="muted">—</span>}</td>
              <td><RecordStatusChip record={r} today={today} /></td>
              <td><WhenCell record={r} today={today} /></td>
              <td>{outstanding ? <span className="muted">{SOURCE[r.source]}</span> : <ResultCell record={r} />}</td>
              {!outstanding && <td className="trn-note">{r.evidence_note ?? <span className="muted">—</span>}</td>}
              {(onComplete || onRemove) && (
                <td className="num">
                  {onComplete && <Button size="sm" onClick={() => onComplete(r)}>Record completion</Button>}
                  {onRemove && <IconButton icon="trash" label={`Remove the record for ${r.person}`} variant="ghost" size="sm" onClick={() => onRemove(r)} />}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CoursePeople({ courseId, courseTitle, onChanged }: { courseId: string; courseTitle: string; onChanged: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { data, error, reload } = useFetch<Progress>(`/api/courses/${courseId}/progress`);
  const [dialog, setDialog] = useState<{ preset?: TrainingRecord[] } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState<TrainingRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const canRecord = can('training.create');
  const canDelete = can('training.delete');

  const refresh = () => { setSelected(new Set()); reload(); onChanged(); };
  const toggle = (id: string) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await api.del(`/api/training/records/${removing.id}`);
      toast.success('Record removed.');
      setRemoving(null);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={6} label="Loading people" />;

  const outstanding = data.people.filter((p) => p.status !== 'complete');
  const complete = data.people.filter((p) => p.status === 'complete');
  const chosen = outstanding.filter((p) => selected.has(p.id));
  const record = canRecord ? <Button size="sm" variant="primary" icon="plus" onClick={() => setDialog({})}>Record training</Button> : undefined;
  const importBtn = canRecord ? <Button size="sm" icon="upload" onClick={() => navigate(`/training/import?course=${courseId}`)}>Import</Button> : undefined;

  return (
    <div className="stack">
      {data.total === 0 ? (
        <Card>
          <EmptyState
            icon="users" title="Nobody has this course yet"
            message="Add an assignment rule so that people are given the course automatically, record who has completed it, or import completions from a file."
            action={<span className="row">{record}{importBtn}</span>}
          />
        </Card>
      ) : (
        <>
          <Card
            title={`People outstanding (${outstanding.length})`} flush={outstanding.length > 0}
            actions={(
              <>
                {canRecord && chosen.length > 0 && (
                  <Button size="sm" variant="primary" onClick={() => setDialog({ preset: chosen })}>Record completion for {chosen.length} selected</Button>
                )}
                {canRecord && outstanding.length > 1 && (
                  <Button size="sm" variant="ghost" onClick={() => setSelected(chosen.length === outstanding.length ? new Set() : new Set(outstanding.map((p) => p.id)))}>
                    {chosen.length === outstanding.length ? 'Clear selection' : 'Select all'}
                  </Button>
                )}
                {importBtn}{chosen.length === 0 && record}
              </>
            )}
          >
            {outstanding.length === 0
              ? <EmptyState icon="check" title="Nobody is outstanding" message="Everyone given this course has completed it." />
              : (
                <PeopleTable
                  caption="People who have not completed this course" rows={outstanding} today={data.today}
                  selected={canRecord ? selected : new Set()} onToggle={canRecord ? toggle : undefined}
                  onComplete={canRecord ? (r) => setDialog({ preset: [r] }) : undefined} onRemove={canDelete ? setRemoving : undefined}
                />
              )}
          </Card>
          <Card title={`Completed (${complete.length})`} flush={complete.length > 0}>
            {complete.length === 0
              ? <EmptyState icon="graduation" title="No completions yet" message="Completions appear here as they are recorded or imported." />
              : <PeopleTable caption="People who have completed this course" rows={complete} today={data.today} onRemove={canDelete ? setRemoving : undefined} />}
          </Card>
        </>
      )}
      <RecordDialog
        courseId={courseId} courseTitle={courseTitle} open={dialog !== null} preset={dialog?.preset}
        onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }}
      />
      <ConfirmDialog
        open={removing !== null} danger busy={busy} title="Remove training record"
        message={`Remove the record for ${removing?.person ?? 'this person'}? The removal is kept in the course's history.`}
        confirmLabel="Remove" onConfirm={remove} onCancel={() => setRemoving(null)}
      />
    </div>
  );
}
