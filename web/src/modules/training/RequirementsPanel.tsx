// What a position needs (E29-02): courses and certifications, mandatory or not, with grace days.
// Shown on the position page of the people module, which loads it only when training is in the build.
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  api, ApiError, Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, ErrorState, errorMessage, IconButton, Loading, LookupChip,
  LookupSelect, Modal, NumberField, Select, useAuth, useFetch, useToast,
} from '../../core';

interface Requirement {
  id: string; kind: 'course' | 'certification'; course_id: string | null; course_title: string | null; course_ref: string | null;
  certification_type: string | null; mandatory: boolean; grace_days: number;
}

function AddForm({ positionId, onDone, onCancel }: { positionId: string; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const courses = useFetch<{ rows: { id: string; ref: string; title: string }[] }>('/api/courses?pageSize=500&sort=title&f.status=active');
  const [kind, setKind] = useState<'course' | 'certification'>('certification');
  const [courseId, setCourseId] = useState('');
  const [type, setType] = useState('');
  const [mandatory, setMandatory] = useState(true);
  const [grace, setGrace] = useState<number | null>(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({}); setMessage(''); setSaving(true);
    try {
      await api.post(`/api/positions/${positionId}/requirements`, {
        kind, mandatory, grace_days: grace ?? 0, ...(kind === 'course' ? { course_id: courseId } : { certification_type: type }),
      });
      toast.success('Requirement added.');
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields); else setMessage(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="form" onSubmit={submit} noValidate>
      {message && <div className="form-error" role="alert">{message}</div>}
      <Select label="Kind" required value={kind} onChange={(v) => setKind((v || 'certification') as 'course' | 'certification')} error={errors.kind}
        options={[{ value: 'certification', label: 'A certification' }, { value: 'course', label: 'A course' }]} />
      {kind === 'course'
        ? <Select label="Course" required searchable value={courseId} onChange={setCourseId} error={errors.course_id} placeholder="Choose a course"
            options={(courses.data?.rows ?? []).map((c) => ({ value: c.id, label: `${c.ref} ${c.title}` }))} />
        : <LookupSelect label="Certification" required list="certification_type" value={type} onChange={setType} error={errors.certification_type} />}
      <Checkbox label="Mandatory" hint="Only mandatory requirements decide whether someone is qualified." checked={mandatory} onChange={setMandatory} />
      <NumberField label="Grace days" min={0} max={365} step={1} value={grace} onChange={setGrace} error={errors.grace_days}
        hint="Days after a certification expires, or a repeating course falls due, that still count as in date." />
      <div className="form-actions">
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" loading={saving}>Add requirement</Button>
      </div>
    </form>
  );
}

export function RequirementsPanel({ positionId }: { positionId: string }) {
  const { can } = useAuth();
  const toast = useToast();
  const editable = can('training.edit');
  const { data, error, reload } = useFetch<Requirement[]>(can('training.view') ? `/api/positions/${positionId}/requirements` : null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Requirement | null>(null);

  if (!can('training.view')) return <Card title="Requirements"><p className="muted">Requirements are part of training, which you cannot open.</p></Card>;
  const label = (r: Requirement) => (r.kind === 'course' ? `${r.course_ref ?? ''} ${r.course_title ?? 'Course removed'}`.trim() : r.certification_type ?? '');
  const add = editable ? <Button size="sm" icon="plus" onClick={() => setAdding(true)}>Add requirement</Button> : undefined;
  let body;
  if (error) body = <ErrorState error={error} onRetry={reload} />;
  else if (!data) body = <Loading lines={3} label="Loading requirements" />;
  else if (!data.length) body = <EmptyState icon="graduation" title="No requirements" message="Add the courses and certifications people in this position need." action={add} />;
  else {
    body = (
      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">Requirements of this position</caption>
          <thead><tr><th scope="col">Requirement</th><th scope="col">Kind</th><th scope="col">Mandatory</th><th scope="col" className="num">Grace days</th>{editable && <th scope="col"><span className="sr-only">Actions</span></th>}</tr></thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id}>
                <td>{r.kind === 'course'
                  ? <Link to={`/training/courses/${r.course_id}`}>{label(r)}</Link>
                  : <LookupChip list="certification_type" value={r.certification_type} />}</td>
                <td><Badge color="gray">{r.kind === 'course' ? 'Course' : 'Certification'}</Badge></td>
                <td>{r.mandatory ? 'Yes' : 'No'}</td>
                <td className="num">{r.grace_days}</td>
                {editable && <td className="num"><IconButton icon="trash" variant="ghost" size="sm" label={`Remove ${r.kind === 'course' ? label(r) : 'this certification'}`} onClick={() => setRemoving(r)} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <Card title="Requirements" actions={data?.length ? add : undefined} flush={!!data?.length}>
      {body}
      <Modal open={adding} title="Add requirement" onClose={() => setAdding(false)}>
        {adding && <AddForm positionId={positionId} onCancel={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />}
      </Modal>
      <ConfirmDialog
        open={!!removing} title="Remove requirement" danger confirmLabel="Remove"
        message="People in this position will no longer need it to be qualified. Their records are kept."
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          try { await api.del(`/api/positions/${positionId}/requirements/${removing!.id}`); toast.success('Requirement removed.'); setRemoving(null); reload(); }
          catch (err) { toast.error(errorMessage(err)); }
        }}
      />
    </Card>
  );
}
