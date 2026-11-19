// What an exercise showed, and the follow-up action raised from each finding.
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  api, ApiError, Button, Card, ConfirmDialog, DateField, EmptyState, ErrorState, errorMessage, formatDate, IconButton, Loading,
  LookupChip, LookupSelect, Modal, StatusChip, TextArea, TextField, toColorName, UserPicker, useAuth, useFetch, useToast,
} from '../../core';

interface Finding {
  id: string; finding: string; severity: string | null; recommendation: string | null; action_id: string | null;
  action: { id: string; ref: string | null; title: string; status: string; status_label: string; status_color: string; due_on: string | null } | null;
}
interface Findings { actions_available: boolean; findings: Finding[] }

function FindingForm({ exerciseId, finding, onDone, onCancel }: { exerciseId: string; finding: Finding | null; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [text, setText] = useState(finding?.finding ?? '');
  const [severity, setSeverity] = useState(finding?.severity ?? 'medium');
  const [recommendation, setRecommendation] = useState(finding?.recommendation ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) { setErrors({ finding: 'Describe the finding.' }); return; }
    setErrors({});
    setMessage(null);
    setSaving(true);
    try {
      const body = { finding: text, severity, recommendation };
      if (finding) await api.patch(`/api/exercises/${exerciseId}/findings/${finding.id}`, body);
      else await api.post(`/api/exercises/${exerciseId}/findings`, body);
      toast.success(finding ? 'Finding saved.' : 'Finding added.');
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else setMessage(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      {message && <div className="form-error" role="alert">{message}</div>}
      <TextArea label="Finding" required rows={3} value={text} error={errors.finding} onChange={setText} hint="What went wrong, was missing or was slower than expected." />
      <LookupSelect label="Severity" list="exercise_finding_severity" value={severity} error={errors.severity} onChange={setSeverity} />
      <TextArea label="Recommendation" rows={3} value={recommendation} error={errors.recommendation} onChange={setRecommendation} />
      <div className="form-actions">
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" loading={saving}>{finding ? 'Save changes' : 'Add finding'}</Button>
      </div>
    </form>
  );
}

function ActionForm({ exerciseId, finding, onDone, onCancel }: { exerciseId: string; finding: Finding; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const first = finding.finding.split(/\r?\n/)[0];
  const [title, setTitle] = useState(first.length > 140 ? `${first.slice(0, 137)}...` : first);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [dueOn, setDueOn] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setErrors({ title: 'Title is required.' }); return; }
    setErrors({});
    setMessage(null);
    setSaving(true);
    try {
      const res = await api.post<{ action: { ref: string | null } }>(`/api/exercises/${exerciseId}/findings/${finding.id}/action`, {
        title, owner_id: ownerId ?? undefined, due_on: dueOn || undefined,
      });
      toast.success(`Action ${res.action.ref ?? ''} created.`.replace('  ', ' '));
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else setMessage(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      {message && <div className="form-error" role="alert">{message}</div>}
      <p className="muted">The action goes on the action tracker with this exercise as its source. The finding and recommendation are copied into its description.</p>
      <TextField label="Action title" required value={title} error={errors.title} onChange={setTitle} />
      <div className="form-grid">
        <UserPicker label="Owner" value={ownerId} error={errors.owner_id} onChange={(id) => setOwnerId(id)} hint="Leave empty to use the exercise owner." />
        <DateField label="Due" value={dueOn} error={errors.due_on} onChange={setDueOn} />
      </div>
      <div className="form-actions">
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" loading={saving}>Create action</Button>
      </div>
    </form>
  );
}

export function ExerciseFindings({ exerciseId }: { exerciseId: string }) {
  const { can } = useAuth();
  const toast = useToast();
  const editable = can('exercises.edit');
  const { data, error, reload } = useFetch<Findings>(`/api/exercises/${exerciseId}/findings`);
  const [editing, setEditing] = useState<Finding | 'new' | null>(null);
  const [raising, setRaising] = useState<Finding | null>(null);
  const [removing, setRemoving] = useState<Finding | null>(null);
  const [busy, setBusy] = useState(false);
  const canRaise = editable && can('actions.create') && !!data?.actions_available;

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await api.del(`/api/exercises/${exerciseId}/findings/${removing.id}`);
      toast.success('Finding removed.');
      setRemoving(null);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const add = editable ? <Button size="sm" icon="plus" onClick={() => setEditing('new')}>Add finding</Button> : undefined;
  let body;
  if (error) body = <ErrorState error={error} onRetry={reload} />;
  else if (!data) body = <Loading lines={4} label="Loading findings" />;
  else if (!data.findings.length) {
    body = (
      <EmptyState icon="clipboard" title="No findings recorded"
        message="After the exercise, record what it showed. Each finding can raise a follow-up action." action={add} />
    );
  } else {
    body = (
      <ul className="trn-findings">
        {data.findings.map((f) => (
          <li key={f.id}>
            <div className="trn-finding-head">
              {f.severity ? <LookupChip list="exercise_finding_severity" value={f.severity} /> : <span />}
              {editable && (
                <span className="row">
                  <IconButton icon="edit" label="Edit this finding" variant="ghost" size="sm" onClick={() => setEditing(f)} />
                  <IconButton icon="trash" label="Remove this finding" variant="ghost" size="sm" onClick={() => setRemoving(f)} />
                </span>
              )}
            </div>
            <p className="prose trn-finding-text">{f.finding}</p>
            {f.recommendation && <p className="prose"><span className="muted">Recommendation: </span>{f.recommendation}</p>}
            <div className="row trn-finding-action">
              {f.action ? (
                <>
                  <span className="muted">Follow-up action:</span>
                  <Link to={`/actions/${f.action.id}`}>{f.action.ref ? `${f.action.ref} ` : ''}{f.action.title}</Link>
                  <StatusChip color={toColorName(f.action.status_color)} label={f.action.status_label} />
                  {f.action.due_on && <span className="muted">due {formatDate(f.action.due_on)}</span>}
                </>
              ) : f.action_id ? (
                <span className="muted">A follow-up action was raised, but you cannot see it.</span>
              ) : canRaise ? (
                <Button size="sm" icon="check-square" onClick={() => setRaising(f)}>Create follow-up action</Button>
              ) : (
                <span className="muted">No follow-up action.</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Card title="Findings" actions={data?.findings.length ? add : undefined}>
      {data && !data.actions_available && data.findings.length > 0 && (
        <p className="muted">The action tracker is not switched on, so follow-up actions cannot be created here. Record the follow-up in each recommendation.</p>
      )}
      {body}
      <Modal open={editing !== null} title={editing === 'new' ? 'Add finding' : 'Edit finding'} onClose={() => setEditing(null)}>
        {editing !== null && (
          <FindingForm exerciseId={exerciseId} finding={editing === 'new' ? null : editing}
            onCancel={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} />
        )}
      </Modal>
      <Modal open={raising !== null} title="Create follow-up action" onClose={() => setRaising(null)}>
        {raising && <ActionForm exerciseId={exerciseId} finding={raising} onCancel={() => setRaising(null)} onDone={() => { setRaising(null); reload(); }} />}
      </Modal>
      <ConfirmDialog
        open={removing !== null} danger busy={busy} title="Remove finding"
        message={removing?.action_id ? 'Remove this finding? Its follow-up action stays on the action tracker.' : 'Remove this finding? The removal is kept in the exercise\'s history.'}
        confirmLabel="Remove" onConfirm={remove} onCancel={() => setRemoving(null)}
      />
    </Card>
  );
}
