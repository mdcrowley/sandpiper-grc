import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, ApiError, Button, Card, DateField, EmptyState, errorMessage, ErrorState, formatDate, formatDateTime, IconButton, Loading,
  LookupChip, Modal, TextArea, TextField, useAuth, useFetch, useResource, UserPicker, useToast, type ListResult, type Row,
} from '../../core';
import { Banner, TextBlock } from './bits';
import { useWorkflow } from './workflowContext';

interface Draft { title: string; owner_id: string | null; owner_label?: string; due_on: string }
const blank = (): Draft => ({ title: '', owner_id: null, due_on: '' });

/** Follow-up actions raised from this change, through the shared Actions list. */
function FollowUpActions({ row, canEdit }: { row: Row; canEdit: boolean }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<ListResult>(`/api/actions?f.source_type=change&f.source_id=${row.id}&pageSize=100`);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(blank());
  const [titleError, setTitleError] = useState('');
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.title.trim()) { setTitleError('Title is required.'); return; }
    setBusy(true);
    try {
      await api.post(`/api/changes/${row.id}/actions`, { title: draft.title, owner_id: draft.owner_id, due_on: draft.due_on || undefined });
      toast.success('Action raised.');
      setOpen(false);
      reload();
    } catch (err) {
      setTitleError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Follow-up actions"
      flush
      actions={canEdit && can('actions.create') && (
        <Button size="sm" icon="plus" onClick={() => { setDraft(blank()); setTitleError(''); setOpen(true); }}>Raise action</Button>
      )}
    >
      {error ? <ErrorState title="The actions could not be loaded" error={error} onRetry={reload} />
        : !data ? <Loading lines={2} label="Loading actions" />
        : data.rows.length === 0 ? <EmptyState icon="check-square" title="No follow-up actions" message="Work that comes out of the review can be raised here and tracked in the Actions list." />
        : (
          <div className="table-wrap chg-tw">
            <table className="table">
              <thead><tr><th>Action</th><th>Status</th><th>Owner</th><th>Due</th></tr></thead>
              <tbody>
                {data.rows.map((a) => (
                  <tr key={a.id}>
                    <td><Link to={`/actions/${a.id}`}>{[a.ref, a.title].filter(Boolean).join(' ')}</Link></td>
                    <td><LookupChip list="action_status" value={a.status} /></td>
                    <td>{a._display?.owner_id ?? '—'}</td>
                    <td>{formatDate(a.due_on)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      <Modal open={open} title="Raise a follow-up action" onClose={() => setOpen(false)} size="sm"
        dirty={open && Boolean(draft.title.trim() || draft.owner_id || draft.due_on)}>
        <form className="form" onSubmit={add} noValidate>
          <TextField label="Title" required value={draft.title} onChange={(title) => setDraft({ ...draft, title })} error={titleError} />
          <UserPicker label="Owner" value={draft.owner_id} display={draft.owner_label} onChange={(id, o) => setDraft({ ...draft, owner_id: id, owner_label: o?.label })} />
          <DateField label="Due date" value={draft.due_on} onChange={(due_on) => setDraft({ ...draft, due_on })} />
          <div className="form-actions">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={busy}>Raise action</Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}

/** The post-implementation review: what happened, the cause and the follow-up. */
export function ReviewTab({ row, canEdit, onChanged }: { row: Row; canEdit: boolean; onChanged: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, reload } = useWorkflow();
  const hasActions = Boolean(useResource('action'));
  const [editing, setEditing] = useState(false);
  const [what, setWhat] = useState('');
  const [cause, setCause] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const done = Boolean(row.pir_completed_at);
  const open = ['completed', 'reviewed'].includes(row.status);
  const required = data?.review.required ?? row.pir_required === true;
  const mayRaise = hasActions && can('actions.create');

  const begin = () => {
    setWhat(String(row.pir_what_happened ?? '')); setCause(String(row.pir_cause ?? '')); setFollowUp(String(row.pir_follow_up ?? ''));
    setDrafts([]); setFields({}); setFormError(''); setEditing(true);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const missing: Record<string, string> = {};
    if (!what.trim()) missing.what_happened = 'Say what happened.';
    if (!cause.trim()) missing.cause = 'Say what caused it.';
    setFields(missing);
    setFormError('');
    if (Object.keys(missing).length) return;
    setBusy(true);
    try {
      await api.post(`/api/changes/${row.id}/review`, {
        what_happened: what, cause, follow_up: followUp,
        actions: drafts.filter((d) => d.title.trim()).map((d) => ({ title: d.title, owner_id: d.owner_id, due_on: d.due_on || undefined })),
      });
      toast.success('Review recorded.');
      setEditing(false);
      reload();
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const setDraft = (i: number, patch: Partial<Draft>) => setDrafts((list) => list.map((d, n) => (n === i ? { ...d, ...patch } : d)));

  return (
    <div className="stack">
      <Card
        title="Post-implementation review"
        actions={open && canEdit && !editing && <Button size="sm" variant={done ? 'secondary' : 'primary'} icon="edit" onClick={begin}>{done ? 'Edit review' : 'Record review'}</Button>}
      >
        {editing ? (
          <form className="form" onSubmit={submit} noValidate>
            <TextArea label="What happened" required value={what} onChange={setWhat} rows={4} error={fields.what_happened} hint="What was done, what went as planned and what did not." />
            <TextArea label="Cause" required value={cause} onChange={setCause} rows={3} error={fields.cause} hint="Why it went the way it did." />
            <TextArea label="Follow-up" value={followUp} onChange={setFollowUp} rows={3} error={fields.follow_up} hint="What will be done differently next time." />
            {mayRaise && (
              <fieldset className="chg-fieldset">
                <legend>Follow-up actions</legend>
                <p className="muted">Each line becomes a record in the Actions list, linked to this change.</p>
                {drafts.map((d, i) => (
                  <div key={i} className="chg-action-row">
                    <TextField label="Action" value={d.title} onChange={(title) => setDraft(i, { title })} />
                    <UserPicker label="Owner" value={d.owner_id} display={d.owner_label} onChange={(id, o) => setDraft(i, { owner_id: id, owner_label: o?.label })} />
                    <DateField label="Due date" value={d.due_on} onChange={(due_on) => setDraft(i, { due_on })} />
                    <IconButton icon="trash" label="Remove this action" variant="ghost" onClick={() => setDrafts((list) => list.filter((_, n) => n !== i))} />
                  </div>
                ))}
                <div><Button size="sm" icon="plus" onClick={() => setDrafts((list) => [...list, blank()])}>Add an action</Button></div>
              </fieldset>
            )}
            {formError && <p className="form-error" role="alert">{formError}</p>}
            <div className="form-actions">
              <Button onClick={() => setEditing(false)}>Cancel</Button>
              <Button type="submit" variant="primary" loading={busy}>Save review</Button>
            </div>
          </form>
        ) : done ? (
          <div className="stack">
            <p className="muted">Recorded by {row.pir_completed_by_name ?? 'an unknown user'} on {formatDateTime(row.pir_completed_at)}.</p>
            <TextBlock label="What happened" value={row.pir_what_happened} />
            <TextBlock label="Cause" value={row.pir_cause} />
            <TextBlock label="Follow-up" value={row.pir_follow_up} empty="None recorded." />
          </div>
        ) : (
          <div className="stack">
            {required && open && <Banner tone="danger">A review is required before this change can be closed.</Banner>}
            {required && !open && <Banner>A review will be required once this change is completed, because {row.change_type === 'emergency' ? 'it is an emergency change' : 'the approval rules ask for one'}.</Banner>}
            <EmptyState
              icon="clipboard"
              title="No review recorded"
              message={open
                ? 'Record what happened, the cause and any follow-up.'
                : ['closed', 'cancelled'].includes(row.status) ? 'This change was closed without a review.' : 'The review is recorded once the change has been completed.'}
            />
          </div>
        )}
      </Card>
      {hasActions && can('actions.view') && <FollowUpActions row={row} canEdit={canEdit && !['draft', 'cancelled'].includes(row.status)} />}
    </div>
  );
}
