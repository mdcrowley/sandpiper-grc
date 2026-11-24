// Written test steps (E41-12): the steps on a control, and each step's result in a control test.
import { useState } from 'react';
import {
  api, Button, Card, ConfirmDialog, EmptyState, ErrorState, errorMessage, formatDateTime, IconButton, Loading, LookupChip, LookupSelect,
  Modal, ProgressBar, TextArea, TextField, useAuth, useFetch, useToast,
} from '../../core';
import type { RecordContext, Row } from '../../core';

interface Step { id: string; sort: number; step: string; expected: string | null }

/** The steps a tester follows to test this control, in order, with what they should find. */
export function ControlSteps({ control }: { control: Row }) {
  const { can } = useAuth();
  const toast = useToast();
  const url = `/api/controls/${control.id}/steps`;
  const { data, error, reload } = useFetch<{ rows: Step[] }>(url);
  const [editing, setEditing] = useState<Step | 'new' | null>(null);
  const [form, setForm] = useState({ step: '', expected: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Step | null>(null);
  const canEdit = can('controls.edit');

  if (error) return <Card><ErrorState error={error} onRetry={reload} /></Card>;
  if (!data) return <Card><Loading lines={4} label="Loading the test steps" /></Card>;
  const rows = data.rows;

  const open = (s: Step | 'new') => {
    setEditing(s);
    setErrors({});
    setForm(s === 'new' ? { step: '', expected: '' } : { step: s.step, expected: s.expected ?? '' });
  };
  const save = async () => {
    setBusy(true); setErrors({});
    try {
      if (editing === 'new') await api.post(url, form);
      else if (editing) await api.patch(`${url}/${editing.id}`, form);
      toast.success(editing === 'new' ? 'Step added.' : 'Step saved.');
      setEditing(null);
      reload();
    } catch (err) {
      setErrors((err as { fields?: Record<string, string> }).fields ?? {});
      toast.error(errorMessage(err));
    } finally { setBusy(false); }
  };
  const move = async (i: number, by: -1 | 1) => {
    const ids = rows.map((r) => r.id);
    [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
    try { await api.put(`${url}/order`, { ids }); reload(); } catch (err) { toast.error(errorMessage(err)); }
  };
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try { await api.del(`${url}/${removing.id}`); setRemoving(null); reload(); } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <Card title="Test steps" flush={rows.length > 0}
      actions={canEdit ? <Button size="sm" icon="plus" onClick={() => open('new')}>Add a step</Button> : undefined}>
      {rows.length === 0 ? (
        <EmptyState icon="clipboard" title="No written steps"
          message={canEdit ? 'Write down how this control is tested, step by step, so every tester does it the same way. Each new test starts with these steps.' : 'No one has written down how this control is tested.'} />
      ) : (
        <ol className="ctl-steps">
          {rows.map((s, i) => (
            <li key={s.id}>
              <span className="ctl-step-n num" aria-hidden="true">{i + 1}</span>
              <div className="ctl-step-text">
                <p>{s.step}</p>
                {s.expected && <p className="muted"><span className="ctl-step-label">Expected:</span> {s.expected}</p>}
              </div>
              {canEdit && (
                <div className="ctl-step-actions">
                  <IconButton icon="arrow-up" label={`Move step ${i + 1} up`} size="sm" disabled={i === 0} onClick={() => void move(i, -1)} />
                  <IconButton icon="arrow-down" label={`Move step ${i + 1} down`} size="sm" disabled={i === rows.length - 1} onClick={() => void move(i, 1)} />
                  <IconButton icon="edit" label={`Change step ${i + 1}`} size="sm" onClick={() => open(s)} />
                  <IconButton icon="x" label={`Remove step ${i + 1}`} size="sm" onClick={() => setRemoving(s)} />
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      {rows.length > 0 && <p className="muted ctl-hint ctl-pad">Each new test of this control starts with these steps. Changing them later does not change tests already recorded.</p>}
      <Modal open={!!editing} title={editing === 'new' ? 'Add a test step' : 'Change the test step'} onClose={() => setEditing(null)}
        dirty={editing === 'new' ? Boolean(form.step || form.expected) : Boolean(editing && (form.step !== editing.step || form.expected !== (editing.expected ?? '')))}
        footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
        <div className="stack">
          <TextArea label="What the tester does" required value={form.step} error={errors.step} rows={3}
            onChange={(v) => setForm((f) => ({ ...f, step: v }))} hint="For example: pick ten shifts at random from the roster." />
          <TextArea label="What they should find" value={form.expected} error={errors.expected} rows={2}
            onChange={(v) => setForm((f) => ({ ...f, expected: v }))} hint="Optional: the result that shows the control works." />
        </div>
      </Modal>
      <ConfirmDialog open={!!removing} busy={busy} title="Remove this step?"
        message="It is taken off the control. Tests already recorded keep their own copy." confirmLabel="Remove step"
        onCancel={() => setRemoving(null)} onConfirm={remove} />
    </Card>
  );
}

interface TestStep { id: string; step: string; expected: string | null; result: string | null; note: string | null; done_by_name: string | null; done_at: string | null }
interface TestStepData { rows: TestStep[]; total: number; done: number; failed: number; not_copied: number }

/** Each written step of a control test, with its result and note. */
export function TestSteps({ row, reload: reloadTest }: RecordContext) {
  const { can } = useAuth();
  const toast = useToast();
  const url = `/api/control-tests/${row.id}/steps`;
  const { data, error, reload } = useFetch<TestStepData>(url);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const locked = row.status === 'reviewed';
  const canEdit = can('controls.edit') && !locked;

  if (error) return <Card><ErrorState error={error} onRetry={reload} /></Card>;
  if (!data) return <Card><Loading lines={4} label="Loading the test steps" /></Card>;

  const save = async (s: TestStep, patch: { result?: string | null; note?: string | null }) => {
    setSaving(s.id);
    try { await api.patch(`${url}/${s.id}`, patch); reload(); reloadTest(); } catch (err) { toast.error(errorMessage(err)); } finally { setSaving(null); }
  };
  const copy = async () => {
    try {
      const res = await api.post<{ added: number }>(`${url}/copy`, {});
      toast.success(res.added ? `${res.added} step${res.added === 1 ? '' : 's'} copied from the control.` : 'No new steps on the control.');
      reload();
    } catch (err) { toast.error(errorMessage(err)); }
  };

  return (
    <Card title="Test steps" flush={data.total > 0}
      actions={canEdit && data.not_copied > 0 ? <Button size="sm" icon="plus" onClick={copy}>Copy {data.not_copied} new step{data.not_copied === 1 ? '' : 's'} from the control</Button> : undefined}>
      {data.total === 0 ? (
        <EmptyState icon="clipboard" title="No written steps"
          message={data.not_copied > 0 && canEdit ? 'The control has written steps this test does not have yet. Copy them to record a result for each.' : 'The control had no written test steps when this test was recorded. Record what was done in the population, items sampled and conclusion.'} />
      ) : (
        <div className="stack">
          <div className="ctl-pad">
            <ProgressBar label="Steps with a result" value={data.done} max={data.total} color={data.failed ? 'red' : data.done === data.total ? 'green' : 'blue'}
              valueText={`${data.done} of ${data.total} done${data.failed ? `, ${data.failed} failed` : ''}`} />
          </div>
          <ol className="ctl-steps">
            {data.rows.map((s, i) => {
              const note = notes[s.id] ?? s.note ?? '';
              return (
                <li key={s.id}>
                  <span className="ctl-step-n num" aria-hidden="true">{i + 1}</span>
                  <div className="ctl-step-text">
                    <p>{s.step}</p>
                    {s.expected && <p className="muted"><span className="ctl-step-label">Expected:</span> {s.expected}</p>}
                    {canEdit ? (
                      <div className="ctl-step-result">
                        <LookupSelect label={`Result of step ${i + 1}`} list="control_step_result" value={s.result ?? ''} disabled={saving === s.id}
                          onChange={(v) => void save(s, { result: v || null })} />
                        {/* The note is saved when focus leaves it. */}
                        <div onBlur={() => { if (note !== (s.note ?? '')) void save(s, { note }); }}>
                          <TextField label={`Note on step ${i + 1}`} value={note} maxLength={4000}
                            onChange={(v) => setNotes((n) => ({ ...n, [s.id]: v }))} placeholder="What you found" />
                        </div>
                      </div>
                    ) : (
                      <p>
                        {s.result ? <LookupChip list="control_step_result" value={s.result} /> : <span className="muted">No result</span>}
                        {s.note && <> {s.note}</>}
                      </p>
                    )}
                    {s.done_at && <p className="muted ctl-hint">{s.done_by_name ?? 'Someone'} · {formatDateTime(s.done_at)}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
          {!locked && data.done < data.total && <p className="muted ctl-hint ctl-pad">Every step needs a result before the testing can be marked finished.</p>}
        </div>
      )}
    </Card>
  );
}
