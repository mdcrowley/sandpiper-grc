// The vendor assessment questionnaire on a vendor's page: the latest score and its gaps, an
// assessment in progress, and the history. Answers are saved as they are chosen.
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { RingProgress, SegmentedControl } from '@mantine/core';
import {
  api, ApiError, Badge, Button, Card, Checkbox, ConfirmDialog, DateField, EmptyState, ErrorState, errorMessage, formatDate,
  Loading, Modal, StatusChip, TextArea, TextField, todayInZone, useAuth, useFetch, useToast,
} from '../../core';
import type { ColorName } from '../../core';
import { ResponseLinkPanel } from './ResponseLink';

export interface Question { key: string; section: string | null; text: string; guidance: string | null; weight: number }
type Answer = 'yes' | 'partial' | 'no' | 'na';
interface AnswerEntry { answer?: Answer | null; note?: string | null; action_id?: string | null }
interface Gap { key: string; section: string | null; text: string; weight: number; answer: Answer; note: string | null; action_id: string | null }

interface AssessmentRow {
  id: string;
  status: 'draft' | 'completed';
  assessed_on: string | null;
  score: number | null;
  version: number;
  answered: number;
  total: number;
  gaps: number;
  notes: string | null;
  evidence_item_id: string | null;
  completed_by_name: string | null;
}
interface AssessmentFull extends AssessmentRow { questions: Question[]; answers: Record<string, AnswerEntry>; gap_list: Gap[] }

const ANSWERS: { value: Answer; label: string }[] = [
  { value: 'yes', label: 'Yes' }, { value: 'partial', label: 'Partly' }, { value: 'no', label: 'No' }, { value: 'na', label: 'Not applicable' },
];
const ANSWER_COLOR: Record<Answer, ColorName> = { yes: 'green', partial: 'amber', no: 'red', na: 'gray' };
const ANSWER_LABEL: Record<Answer, string> = { yes: 'Yes', partial: 'Partly', no: 'No', na: 'Not applicable' };

export const scoreColor = (score: number | null): ColorName => (score === null ? 'gray' : score >= 80 ? 'green' : score >= 50 ? 'amber' : 'red');
export const scoreWord = (score: number | null) => (score === null ? 'Not scored' : score >= 80 ? 'Strong' : score >= 50 ? 'Some gaps' : 'Weak');

export function ScoreRing({ score, size = 96 }: { score: number | null; size?: number }) {
  return (
    <RingProgress
      size={size} thickness={Math.round(size / 10)} roundCaps
      aria-label={score === null ? 'Not scored' : `Score ${score} out of 100`}
      sections={[{ value: score ?? 0, color: `var(--c-${scoreColor(score)}-solid)` }]}
      rootColor="var(--surface-2)"
      label={<span className="vnd-score" style={{ fontSize: size / 3.4 }}>{score ?? '–'}</span>}
    />
  );
}

/* ---------- the form ---------- */

function AssessmentForm({ id, onClose, onCompleted }: { id: string; onClose: () => void; onCompleted: () => void }) {
  const toast = useToast();
  const { can } = useAuth();
  const { data, error, reload } = useFetch<AssessmentFull>(`/api/vendor-assessments/${id}`);
  const [local, setLocal] = useState<AssessmentFull | null>(null);
  const [assessedOn, setAssessedOn] = useState(todayInZone());
  const [saveEvidence, setSaveEvidence] = useState(true);
  const [expiresOn, setExpiresOn] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
  const a = local ?? data;

  const sections = useMemo(() => {
    const out: { title: string; questions: Question[] }[] = [];
    for (const q of a?.questions ?? []) {
      const title = q.section ?? 'Questions';
      const last = out[out.length - 1];
      if (last && last.title === title) last.questions.push(q);
      else out.push({ title, questions: [q] });
    }
    return out;
  }, [a?.questions]);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!a) return <Loading lines={8} label="Loading the assessment" />;

  function answer(key: string, patch: AnswerEntry) {
    // Show the choice at once. Saves go one after another, so the copy that comes back
    // (with the score so far) is never older than the one on screen.
    setLocal((now) => {
      const base = now ?? a!;
      return { ...base, answers: { ...base.answers, [key]: { ...base.answers[key], ...patch } } };
    });
    pending.current += 1;
    chain.current = chain.current
      .then(() => api.patch<AssessmentFull>(`/api/vendor-assessments/${id}`, { answers: { [key]: patch } }))
      .then((saved) => {
        pending.current -= 1;
        if (pending.current === 0) setLocal(saved);
      })
      .catch((err) => {
        pending.current -= 1;
        toast.error(errorMessage(err));
        reload();
        setLocal(null);
      });
  }

  async function saveNotes(notes: string) {
    if (notes.trim() === (a!.notes ?? '')) return;
    try {
      setLocal(await api.patch<AssessmentFull>(`/api/vendor-assessments/${id}`, { notes }));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function complete() {
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      await api.post(`/api/vendor-assessments/${id}/complete`, {
        assessed_on: assessedOn, save_evidence: saveEvidence && can('vendors.create'), evidence_expires_on: saveEvidence ? expiresOn || null : null,
      });
      toast.success('Assessment completed.');
      onCompleted();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else setMessage(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    setBusy(true);
    try {
      await api.del(`/api/vendor-assessments/${id}`);
      toast.success('Draft discarded.');
      onCompleted();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      setDiscarding(false);
    }
  }

  const left = a.total - a.answered;
  return (
    <div className="vnd-assess">
      <div className="vnd-assess-progress" aria-live="polite">
        <ScoreRing score={a.score} size={64} />
        <div>
          <strong>{a.answered} of {a.total} answered</strong>
          <span className="muted"> · score so far {a.score ?? '–'} out of 100 · questions version {a.version}</span>
          <p className="muted">Answers are saved as you choose them. You can close this and carry on later.</p>
        </div>
      </div>
      <ResponseLinkPanel assessmentId={id} questions={a.questions} answers={a.answers} onAccepted={() => { setLocal(null); reload(); }} />
      {sections.map((s) => (
        <fieldset key={s.title} className="vnd-assess-section">
          <legend>{s.title}</legend>
          {s.questions.map((q) => {
            const entry = a.answers[q.key] ?? {};
            const showNote = entry.answer === 'no' || entry.answer === 'partial' || Boolean(entry.note);
            return (
              <div key={q.key} className="vnd-assess-q">
                <div className="vnd-assess-text">
                  <span id={`vnd-q-${q.key}`}>{q.text}</span>
                  {q.guidance && <span className="vnd-clause-hint">{q.guidance}</span>}
                  <span className="vnd-assess-weight muted">Weight {q.weight}</span>
                </div>
                <SegmentedControl
                  size="xs" aria-labelledby={`vnd-q-${q.key}`} data={ANSWERS} value={entry.answer ?? ''}
                  color={entry.answer ? ANSWER_COLOR[entry.answer] : undefined}
                  onChange={(v) => void answer(q.key, { answer: v as Answer })}
                />
                {showNote && (
                  <NoteBox
                    label={`Note on: ${q.text}`} value={entry.note ?? ''}
                    onSave={(note) => { if (note.trim() !== (entry.note ?? '')) void answer(q.key, { note }); }}
                  />
                )}
              </div>
            );
          })}
        </fieldset>
      ))}
      <NotesBox value={a.notes ?? ''} onSave={(v) => void saveNotes(v)} />
      <div className="vnd-assess-finish">
        <span className="vnd-eyebrow">Finish</span>
        {message && <div className="form-error" role="alert">{message}</div>}
        <div className="form-grid">
          <DateField label="Assessed on" value={assessedOn} onChange={setAssessedOn} max={todayInZone()} error={errors.assessed_on} />
          {can('vendors.create') && (
            <div>
              <Checkbox
                label="Save as an evidence item" checked={saveEvidence} onChange={setSaveEvidence}
                hint="Adds a Questionnaire evidence item for this vendor with the score and the number of gaps."
              />
            </div>
          )}
          {saveEvidence && can('vendors.create') && (
            <DateField
              label="Evidence expires on" value={expiresOn} onChange={setExpiresOn} min={assessedOn || undefined}
              error={errors.evidence_expires_on} hint="Optional: when the vendor should be assessed again."
            />
          )}
        </div>
        <div className="form-actions">
          <Button variant="ghost" onClick={() => setDiscarding(true)} disabled={busy}>Discard draft</Button>
          <Button onClick={onClose} disabled={busy}>Close and carry on later</Button>
          <Button variant="primary" loading={busy} disabled={left > 0} onClick={() => void complete()}>
            {left > 0 ? `Complete assessment (${left} to answer)` : 'Complete assessment'}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={discarding} danger busy={busy} title="Discard draft"
        message="Discard this assessment and the answers given so far? Completed assessments are not affected."
        confirmLabel="Discard draft" onConfirm={() => void discard()} onCancel={() => setDiscarding(false)}
      />
    </div>
  );
}

function NoteBox({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <div className="vnd-assess-note" onBlur={() => onSave(v)}>
      <TextField label={label} hideLabel placeholder="What is missing, or what they said" value={v} onChange={setV} />
    </div>
  );
}

function NotesBox({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <div onBlur={() => onSave(v)}>
      <TextArea label="Overall notes" rows={2} placeholder="Who answered, and anything that does not fit a question" value={v} onChange={setV} />
    </div>
  );
}

/* ---------- a completed assessment ---------- */

function Completed({ id, canRaise, onChanged }: { id: string; canRaise: boolean; onChanged?: () => void }) {
  const toast = useToast();
  const { data, error, reload } = useFetch<AssessmentFull>(`/api/vendor-assessments/${id}`);
  const [raising, setRaising] = useState<string | null>(null);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={4} label="Loading the assessment" />;

  async function raise(gap: Gap) {
    setRaising(gap.key);
    try {
      const made = await api.post<{ ref: string | null }>(`/api/vendor-assessments/${id}/gaps/${gap.key}/action`, {});
      toast.success(`Action ${made.ref ?? ''} raised.`.replace('  ', ' '));
      reload();
      onChanged?.();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRaising(null);
    }
  }

  return (
    <div className="vnd-result">
      <div className="vnd-result-head">
        <ScoreRing score={data.score} />
        <div>
          <span className="vnd-eyebrow">Score</span>
          <p className="vnd-result-word">
            <StatusChip color={scoreColor(data.score)} label={scoreWord(data.score)} />
            <span> {data.score === null ? 'Every question was not applicable' : `${data.score} out of 100`}</span>
          </p>
          <p className="muted">
            Assessed {formatDate(data.assessed_on)}{data.completed_by_name ? ` by ${data.completed_by_name}` : ''} · {data.total} questions, version {data.version}
            {data.evidence_item_id && <> · <Link to={`/evidence/${data.evidence_item_id}`}>Evidence item</Link></>}
          </p>
          {data.notes && <p className="prose">{data.notes}</p>}
        </div>
      </div>
      <h3 className="vnd-result-title">Outstanding gaps <span className="tab-count">{data.gap_list.length}</span></h3>
      {data.gap_list.length === 0 ? <p className="muted">No gaps: every applicable question was answered Yes.</p> : (
        <ul className="vnd-gaps">
          {data.gap_list.map((g) => (
            <li key={g.key} className="vnd-gap">
              <div className="vnd-gap-main">
                <span>{g.text}</span>
                {g.note && <span className="vnd-clause-hint">{g.note}</span>}
              </div>
              <div className="vnd-gap-meta">
                <StatusChip color={ANSWER_COLOR[g.answer]} label={ANSWER_LABEL[g.answer]} />
                <Badge color="gray">Weight {g.weight}</Badge>
                {g.action_id
                  ? <Link className="btn btn-ghost btn-sm" to={`/actions/${g.action_id}`}>Open action</Link>
                  : canRaise && <Button size="sm" icon="plus" loading={raising === g.key} onClick={() => void raise(g)}>Raise action</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- the tab ---------- */

export function AssessmentTab({ vendorId, onChanged }: { vendorId: string; onChanged?: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const editable = can('vendors.edit');
  const { data, error, reload } = useFetch<{ rows: AssessmentRow[]; can_raise_actions: boolean }>(`/api/vendors/${vendorId}/assessments`);
  const [formId, setFormId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<AssessmentRow | null>(null);
  const [starting, setStarting] = useState(false);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={5} label="Loading assessments" />;
  const draft = data.rows.find((r) => r.status === 'draft');
  const completed = data.rows.filter((r) => r.status === 'completed');
  const latest = completed[0];

  async function start() {
    setStarting(true);
    try {
      const made = await api.post<AssessmentRow>(`/api/vendors/${vendorId}/assessments`, {});
      setFormId(made.id);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setStarting(false);
    }
  }
  const refresh = () => { reload(); onChanged?.(); };

  const startButton = editable && (
    draft
      ? <Button variant="primary" onClick={() => setFormId(draft.id)}>Continue assessment</Button>
      : <Button variant="primary" icon="plus" loading={starting} onClick={() => void start()}>{latest ? 'Assess again' : 'Start assessment'}</Button>
  );

  return (
    <div className="stack">
      <Card
        title="Security assessment"
        actions={(
          <>
            {can('vendors.view') && <Link className="btn btn-ghost btn-sm" to="/vendors/questions">Assessment questions</Link>}
            {startButton}
          </>
        )}
      >
        {draft && (
          <p className="notice">
            An assessment is in progress: {draft.answered} of {draft.total} questions answered.
            {editable ? ' Select Continue assessment to carry on.' : ''}
          </p>
        )}
        {latest
          ? <Completed key={latest.id} id={latest.id} canRaise={data.can_raise_actions && editable} onChanged={onChanged} />
          : !draft && (
            <EmptyState
              icon="clipboard" title="Not assessed yet"
              message="Work through the security questions with the vendor, or from what they have sent. The answers give a score out of 100 and a list of gaps."
            />
          )}
      </Card>
      {completed.length > 0 && (
        <Card title="History" flush>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Completed assessments, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">Assessed</th><th scope="col">Score</th><th scope="col">Gaps</th><th scope="col">Questions</th>
                  <th scope="col">Completed by</th><th scope="col"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {completed.map((r) => (
                  <tr key={r.id}>
                    <th scope="row">{formatDate(r.assessed_on)}</th>
                    <td><StatusChip color={scoreColor(r.score)} label={r.score === null ? 'Not scored' : `${r.score} out of 100`} /></td>
                    <td>{r.gaps}</td>
                    <td>Version {r.version} ({r.total})</td>
                    <td>{r.completed_by_name ?? <span className="muted">—</span>}</td>
                    <td className="num"><Button size="sm" variant="ghost" onClick={() => setViewing(r)}>View</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <Modal open={formId !== null} size="lg" title="Security assessment" onClose={() => { setFormId(null); refresh(); }}>
        {formId && (
          <AssessmentForm
            id={formId} onClose={() => { setFormId(null); refresh(); }}
            onCompleted={() => { setFormId(null); refresh(); }}
          />
        )}
      </Modal>
      <Modal open={viewing !== null} size="lg" title={viewing ? `Assessment of ${formatDate(viewing.assessed_on)}` : ''} onClose={() => setViewing(null)}>
        {viewing && <Completed id={viewing.id} canRaise={data.can_raise_actions && editable} onChanged={onChanged} />}
      </Modal>
    </div>
  );
}
