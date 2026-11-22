// Record a completion (or assign the course) for one person or a list of people.
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  api, ApiError, Badge, Button, Checkbox, DateField, errorMessage, IconButton, LookupSelect, Modal, NumberField, TextArea,
  todayInZone, UserPicker, useToast,
} from '../../core';
import type { TrainingRecord } from './shared';

interface Result { created: number; completed: number; assigned: number; duplicate: number; exists: number; skipped: number; attempted?: number }

/** "Name, email, department" per line; email and department are optional. */
function parsePeople(text: string): { name?: string; email?: string; department?: string }[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
    const [a = '', b = '', c = ''] = line.split(/[,;\t]/).map((p) => p.trim());
    if (a.includes('@') && !b.includes('@')) return { email: a, name: b || undefined, department: c || undefined };
    return { name: a || undefined, email: b || undefined, department: c || undefined };
  });
}

export function RecordDialog({ courseId, courseTitle, open, preset, onClose, onDone }: {
  courseId: string; courseTitle: string; open: boolean; preset?: TrainingRecord[]; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [users, setUsers] = useState<{ id: string; label: string }[]>([]);
  const [others, setOthers] = useState('');
  const [completed, setCompleted] = useState(true);
  const [completedOn, setCompletedOn] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [score, setScore] = useState<number | null>(null);
  const [result, setResult] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUsers([]); setOthers(''); setCompleted(true); setCompletedOn(todayInZone()); setDueOn('');
    setScore(null); setResult(''); setNote(''); setErrors({}); setMessage(null);
  }, [open]);

  const fixed = preset && preset.length > 0;
  const dirty = open && (users.length > 0 || !!others || !completed || completedOn !== todayInZone() || !!dueOn || score !== null || !!result || !!note);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const people = fixed
      ? preset!.map((r) => (r.user_id ? { user_id: r.user_id } : { name: r.person, email: r.email ?? undefined, department: r.department ?? undefined }))
      : [...users.map((u) => ({ user_id: u.id })), ...parsePeople(others)];
    const found: Record<string, string> = {};
    if (!people.length) found.people = 'Add at least one person.';
    if (completed && !completedOn) found.completed_on = 'Enter the date the training was completed.';
    setErrors(found);
    setMessage(null);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      const res = await api.post<Result>('/api/training/records', {
        course_id: courseId, people,
        ...(completed
          ? { completed_on: completedOn, score: score ?? undefined, result: result || undefined, evidence_note: note || undefined }
          : { due_on: dueOn || undefined, evidence_note: note || undefined }),
      });
      const done = res.created + res.completed;
      const main = res.attempted
        ? `Attempt recorded for ${res.attempted} ${res.attempted === 1 ? 'person' : 'people'}: the training stays due until a pass is recorded.`
        : completed
        ? `Completion recorded for ${done} ${done === 1 ? 'person' : 'people'}.`
        : `Assigned to ${res.assigned} ${res.assigned === 1 ? 'person' : 'people'}.`;
      toast.success(res.skipped ? `${main} ${res.skipped} skipped: already recorded.` : main);
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else setMessage(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} title={fixed ? 'Record completion' : 'Record training'} onClose={onClose} size="md" dirty={dirty}>
      <form className="form" onSubmit={submit} noValidate>
        <p className="muted">{courseTitle}</p>
        {message && <div className="form-error" role="alert">{message}</div>}

        {fixed ? (
          <div className="row" aria-label="People">
            {preset!.slice(0, 12).map((r) => <Badge key={r.id} color="gray">{r.person}</Badge>)}
            {preset!.length > 12 && <span className="muted">and {preset!.length - 12} more</span>}
          </div>
        ) : (
          <>
            <UserPicker
              label="People with an account" value={null} placeholder="Search by name, then choose to add"
              onChange={(id, option) => {
                if (id && !users.some((u) => u.id === id)) setUsers([...users, { id, label: option?.label ?? 'User' }]);
              }}
            />
            {users.length > 0 && (
              <ul className="trn-picked">
                {users.map((u) => (
                  <li key={u.id}>
                    {u.label}
                    <IconButton icon="x" label={`Remove ${u.label}`} variant="ghost" size="sm" onClick={() => setUsers(users.filter((x) => x.id !== u.id))} />
                  </li>
                ))}
              </ul>
            )}
            <TextArea
              label="People without an account" rows={4} value={others} onChange={setOthers}
              placeholder={'Jo Example, jo@example.org, Finance\nSam Example'}
              hint="One person per line: name, then optionally email and department, separated by commas."
            />
            {errors.people && <p className="field-error" role="alert">{errors.people}</p>}
          </>
        )}

        {!fixed && <Checkbox label="They have completed the course" hint="Clear this to assign the course without recording a completion." checked={completed} onChange={setCompleted} />}
        {completed ? (
          <div className="form-grid">
            <DateField label="Completed on" required value={completedOn} max={todayInZone()} error={errors.completed_on} onChange={setCompletedOn} />
            <LookupSelect label="Result" list="training_result" value={result} error={errors.result} onChange={setResult} />
            <NumberField label="Score (%)" value={score} min={0} max={100} error={errors.score} onChange={setScore} />
            {result === 'failed' && (
              <p className="notice notice-warn form-cell-wide trn-failed-note" role="status">
                A result of Did not pass is recorded as an attempt. It does not count as complete: the training stays due until a pass is recorded.
              </p>
            )}
          </div>
        ) : (
          <DateField label="Due on" value={dueOn} error={errors.due_on} hint="Leave empty to use the course's days allowed." onChange={setDueOn} />
        )}
        <TextArea label="Evidence note" rows={2} value={note} onChange={setNote} hint="Where the proof is: a sign-in sheet, a certificate, a report from the provider." />

        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>{!completed ? 'Assign' : result === 'failed' ? 'Record attempt' : 'Record completion'}</Button>
        </div>
      </form>
    </Modal>
  );
}
