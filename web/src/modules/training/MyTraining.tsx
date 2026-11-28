// The signed-in user's own training: what is to do, what has been completed, and (on courses
// that allow it) marking a course complete yourself with a note of the evidence.
import { useState } from 'react';
import {
  api, ApiError, Badge, Button, Card, DateField, EmptyState, ErrorState, errorMessage, formatDate, Loading, Modal, Notice, PageHeader, Select, Stat,
  TableWrap, TextArea, todayInZone, useFetch, useToast,
} from '../../core';
import { RecordStatusChip, ResultCell, WhenCell } from './shared';
import type { TrainingRecord } from './shared';

interface Mine { today: string; rows: TrainingRecord[] }
interface SelfCourse { id: string; ref: string | null; title: string; description: string | null; duration_minutes: number | null }

/** Records the person's own completion of a self-certified course. */
function CompleteDialog({ courseId, courses, onClose, onDone }: {
  courseId: string | null; courses: SelfCourse[]; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [course, setCourse] = useState(courseId ?? '');
  const [startDate] = useState(todayInZone);
  const [date, setDate] = useState(startDate);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const missing: Record<string, string> = {};
    if (!course) missing.course_id = 'Choose the course.';
    if (!note.trim()) missing.evidence_note = 'Say how you completed it, for example where the certificate is.';
    setErrors(missing);
    if (Object.keys(missing).length) return;
    setBusy(true);
    try {
      await api.post('/api/training/mine/complete', { course_id: course, completed_on: date, evidence_note: note });
      toast.success('Recorded. Thank you.');
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title="Mark training complete" onClose={onClose} size="md"
      dirty={course !== (courseId ?? '') || date !== startDate || !!note}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon="check" loading={busy} onClick={() => void save()}>Mark complete</Button></>}>
      <div className="stack trn-mine">
        <p className="muted">Only for courses that allow it. Your note is kept with the record, and the course owner can see it.</p>
        <Select label="Course" required value={course} onChange={setCourse} error={errors.course_id}
          options={courses.map((c) => ({ value: c.id, label: [c.ref, c.title].filter(Boolean).join(' ') }))} />
        <DateField label="Completed on" required value={date} max={todayInZone()} onChange={setDate} error={errors.completed_on} />
        <TextArea label="Evidence" required value={note} onChange={setNote} rows={3} error={errors.evidence_note}
          hint="How you completed it: for example the certificate number, or where the signed attendance sheet is kept." />
      </div>
    </Modal>
  );
}

function Table({ caption, rows, today, done, selfCourses, onComplete }: {
  caption: string; rows: TrainingRecord[]; today: string; done: boolean; selfCourses: Set<string>; onComplete: (courseId: string) => void;
}) {
  return (
    <TableWrap label={caption} className="trn-tw">
      <table className="table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Course</th><th scope="col">Status</th>
            <th scope="col">{done ? 'Completed' : 'Due'}</th><th scope="col">{done ? 'Result' : 'Assigned'}</th>
            {!done && <th scope="col"><span className="sr-only">Action</span></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.course_ref && <span className="ref">{r.course_ref}</span>} <span className="row-title">{r.course_title}</span></td>
              <td><RecordStatusChip record={r} today={today} /></td>
              <td><WhenCell record={r} today={today} /></td>
              <td>{done ? <ResultCell record={r} /> : formatDate(r.assigned_on)}</td>
              {!done && (
                <td className="num">
                  {selfCourses.has(r.course_id) && <Button size="sm" icon="check" onClick={() => onComplete(r.course_id)}>Mark complete</Button>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function MyTraining() {
  const { data, error, reload } = useFetch<Mine>('/api/training/mine');
  const self = useFetch<SelfCourse[]>('/api/training/mine/self-certify');
  const [completing, setCompleting] = useState<string | null | undefined>(undefined);
  const selfCourses = new Set((self.data ?? []).map((c) => c.id));
  const header = (
    <PageHeader title="My training" subtitle="Courses you have been given, the ones you have completed, and your certifications."
      actions={self.data?.length ? <Button icon="check" onClick={() => setCompleting(null)}>Record a completed course</Button> : undefined} />
  );
  const dialog = completing !== undefined && (
    <CompleteDialog courseId={completing} courses={self.data ?? []} onClose={() => setCompleting(undefined)}
      onDone={() => { setCompleting(undefined); reload(); }} />
  );
  if (error) return <div className="stack trn-mine">{header}<ErrorState error={error} onRetry={reload} /></div>;
  if (!data) return <div className="stack trn-mine">{header}<Loading lines={6} label="Loading your training" /></div>;
  if (!data.rows.length) {
    return (
      <div className="stack trn-mine">
        {header}
        <EmptyState icon="graduation" title="You have no training to do" message="When a course is assigned to you it appears here with its due date." />
        <MyCertifications />
        {dialog}
      </div>
    );
  }
  const todo = data.rows.filter((r) => r.status === 'due' || r.status === 'overdue');
  const done = data.rows.filter((r) => r.status === 'complete' || r.status === 'not_passed');
  const overdue = todo.filter((r) => r.status === 'overdue').length;
  const retakes = todo.filter((r) => r.attempted_on).length;
  return (
    <div className="stack trn-mine">
      {header}
      <div className="grid-stats">
        <Stat label="To do" icon="graduation" value={todo.length} color={todo.length ? 'blue' : 'green'} hint={retakes ? `${retakes} to retake` : undefined} />
        <Stat label="Overdue" icon="clock" value={overdue} color={overdue ? 'red' : 'green'} />
        <Stat label="Completed" icon="check-circle" value={done.filter((r) => r.status === 'complete').length} color="green" />
      </div>
      <Card title="To do" flush={todo.length > 0}>
        {todo.length
          ? <Table caption="Training you still have to complete" rows={todo} today={data.today} done={false} selfCourses={selfCourses} onComplete={setCompleting} />
          : <EmptyState icon="check" title="You are up to date" message="There is nothing for you to complete at the moment." />}
        {todo.length > 0 && (
          <p className="muted trn-more">
            {todo.some((r) => selfCourses.has(r.course_id))
              ?'Where a course shows Mark complete, you can record it yourself with a note of the evidence. For the others, tell the course owner or your manager so that it can be recorded.'
              : 'When you have finished a course, tell the course owner or your manager so that it can be recorded.'}
            {retakes > 0 && ' A course you did not pass stays here until a pass is recorded.'}
          </p>
        )}
      </Card>
      {done.length > 0 && (
        <Card title="Completed" flush>
          <Table caption="Training you have completed" rows={done} today={data.today} done selfCourses={selfCourses} onComplete={setCompleting} />
        </Card>
      )}
      <MyCertifications />
      {dialog}
    </div>
  );
}

// ---------- my certifications (E46-70) ----------

type CertState = 'current' | 'expiring' | 'expired' | 'renewed' | 'inactive';
interface MineCert {
  id: string; ref: string | null; certification_type: string; label: string; number: string | null; issuing_body: string | null;
  issued_on: string | null; expires_on: string | null; status: string; days_left: number | null; state: CertState;
}
interface MineCerts {
  today: string;
  person: { id: string; full_name: string; position: string | null; department: string | null } | null;
  rows: MineCert[];
  missing: { key: string; label: string; mandatory: boolean; state: 'missing' | 'expired' }[];
}

const CERT_STATE: Record<CertState, { label: string; color: 'green' | 'amber' | 'red' | 'gray' | 'blue' }> = {
  current: { label: 'In date', color: 'green' },
  expiring: { label: 'Expiring', color: 'amber' },
  expired: { label: 'Expired', color: 'red' },
  renewed: { label: 'Renewed', color: 'blue' },
  inactive: { label: 'Not active', color: 'gray' },
};

function Expiry({ cert }: { cert: MineCert }) {
  if (!cert.expires_on || cert.days_left === null) return <span className="muted">Does not expire</span>;
  const d = cert.days_left;
  const when = d < 0 ? `${-d} ${d === -1 ? 'day' : 'days'} ago` : d === 0 ? 'today' : `in ${d} ${d === 1 ? 'day' : 'days'}`;
  return <span>{formatDate(cert.expires_on)} <span className={cert.state === 'expired' ? 'trn-late' : 'muted'}>({when})</span></span>;
}

/** The person's own certifications from the roster, with their expiry and what their position still needs. */
export function MyCertifications() {
  const { data, error, reload } = useFetch<MineCerts>('/api/training/mine/certifications');
  if (error) return <Card title="My certifications"><ErrorState error={error} onRetry={reload} /></Card>;
  if (!data) return <Card title="My certifications"><Loading lines={3} label="Loading your certifications" /></Card>;
  if (!data.person) return null; // not on the roster: nothing to show
  const held = data.rows;
  return (
    <Card title="My certifications" flush={held.length > 0}>
      {data.missing.length > 0 && (
        <div className="trn-more">
          <Notice tone="warning" title="Your position needs">
            {data.missing.map((m) => `${m.label} (${m.state === 'expired' ? 'expired' : 'not on record'})`).join(', ')}.
            {' '}Arrange it and give the certificate to your supervisor.
          </Notice>
        </div>
      )}
      {held.length === 0 ? (
        <EmptyState icon="star" title="No certifications on record" message="When a certification of yours is recorded, it appears here with its expiry date." />
      ) : (
        <TableWrap label="Your certifications" fit>
          <table className="table">
            <caption className="sr-only">Your certifications</caption>
            <thead>
              <tr><th scope="col">Certification</th><th scope="col">State</th><th scope="col">Expires</th><th scope="col" data-priority="2">Issued</th><th scope="col" data-priority="3">Issued by</th></tr>
            </thead>
            <tbody>
              {held.map((c) => (
                <tr key={c.id}>
                  <td>{c.ref && <span className="ref">{c.ref}</span>} <span className="row-title">{c.label}</span></td>
                  <td><Badge color={CERT_STATE[c.state].color}>{CERT_STATE[c.state].label}</Badge></td>
                  <td><Expiry cert={c} /></td>
                  <td data-priority="2">{c.issued_on ? formatDate(c.issued_on) : <span className="muted">Not recorded</span>}</td>
                  <td data-priority="3">{c.issuing_body ?? <span className="muted">Not recorded</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {held.length > 0 && (
        <p className="muted trn-more">
          You are reminded before each one expires. When you renew one, give the new certificate to your supervisor so that it can be recorded.
        </p>
      )}
    </Card>
  );
}
