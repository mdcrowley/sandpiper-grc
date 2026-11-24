// Vendor intake with risk tiers and required checks (E41-10): the vendor's "Intake and checks" tab
// (its tier, why, and the checks the tier needs) and the settings page where the organization writes
// its questionnaire, its tier rules and the checks of each tier.
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  api, ApiError, Badge, Button, Card, Checkbox, ChoicesField, ConfirmDialog, DateField, EmptyState, ErrorState, errorMessage, formatDate,
  IconButton, Loading, LookupChip, Modal, useLookup, Notice, PageHeader, Select, StatusChip, Switch, TableWrap, TextArea, TextField, todayInZone, useAuth, useFetch,
  useToast, useUnsavedChanges,
} from '../../core';
import type { ColorName, LookupValue, Row } from '../../core';

/* ---------- types ---------- */

export interface IntakeOption { value: string; label: string }
export interface IntakeQuestion { key: string; text: string; help: string | null; options: IntakeOption[] }
interface TierRule { question: string; answers: string[]; tier: string }
interface IntakeConfig { questions: IntakeQuestion[]; rules: TierRule[]; default_tier: string; required_checks: Record<string, string[]> }
interface Reason { question: string; question_text: string; answer: string; answer_label: string; tier: string }

interface IntakeRecord {
  id: string; completed_on: string; completed_by_name: string | null; tier: string; tier_label: string; tier_color: string;
  questions: IntakeQuestion[]; answers: Record<string, string>; reasons: Reason[]; notes: string | null;
}
interface IntakeData {
  tier: string | null; tier_on: string | null; tier_label: string | null; tier_color: string | null;
  latest: IntakeRecord | null;
  history: { id: string; completed_on: string; completed_by_name: string | null; tier: string; tier_label: string; tier_color: string }[];
  questions: IntakeQuestion[];
  can_complete: boolean;
}
type CheckState = 'done' | 'waived' | 'expired' | 'missing';
interface CheckRecord {
  id: string; check_key: string; check_label?: string; outcome: 'done' | 'waived'; done_on: string; expires_on: string | null;
  reference: string | null; note: string | null; recorded_by_name: string | null;
}
interface ChecksData {
  tier: string | null;
  required: { key: string; label: string; state: CheckState; latest: CheckRecord | null }[];
  outstanding: number;
  history: CheckRecord[];
  checks: { value: string; label: string }[];
  intake_before_contract: boolean;
  can_record: boolean;
  can_waive: boolean;
}
interface Preview { tier: string; tier_label: string; tier_color: string; reasons: Reason[]; required_checks: { key: string; label: string }[] }
interface Settings { config: IntakeConfig; tiers: LookupValue[]; checks: LookupValue[]; intake_before_contract: boolean; can_edit: boolean }

export const CHECK_STATE: Record<CheckState, { label: string; color: ColorName }> = {
  done: { label: 'Done', color: 'green' },
  waived: { label: 'Waived', color: 'purple' },
  expired: { label: 'Expired', color: 'red' },
  missing: { label: 'Not done', color: 'amber' },
};

const tierChip = (label: string | null, color: string | null) => <StatusChip color={(color ?? 'gray') as ColorName} label={label ?? 'No tier'} />;

/* ---------- the questionnaire ---------- */

function IntakeForm({ vendorId, questions, previous, onDone, onCancel }: {
  vendorId: string; questions: IntakeQuestion[]; previous: Record<string, string> | null; onDone: () => void; onCancel: () => void;
}) {
  const toast = useToast();
  // A new intake starts from the earlier answers that still fit the questions in use.
  const start = Object.fromEntries(questions.map((q) => [q.key, previous?.[q.key] && q.options.some((o) => o.value === previous[q.key]) ? previous[q.key] : '']));
  const [answers, setAnswers] = useState<Record<string, string>>(start);
  const [notes, setNotes] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(answers) !== JSON.stringify(start) || notes !== '';
  const unsaved = useUnsavedChanges(dirty);
  const missing = questions.filter((q) => !answers[q.key]);

  useEffect(() => {
    let live = true;
    api.post<Preview>('/api/vendors/intake/preview', { answers }).then((p) => { if (live) setPreview(p); }).catch(() => { if (live) setPreview(null); });
    return () => { live = false; };
  }, [answers]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (missing.length) { setError(`Answer every question. ${missing.length} still to answer.`); return; }
    setSaving(true);
    setError(null);
    try {
      const made = await api.post<IntakeRecord>(`/api/vendors/${vendorId}/intake`, { answers, notes });
      unsaved.release();
      toast.success(`Intake saved: ${made.tier_label} risk tier.`);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError && err.fields?.answers ? err.fields.answers : errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title="Intake questionnaire" size="lg" onClose={onCancel} dirty={dirty}>
      <form className="form" onSubmit={submit} noValidate>
        <p className="muted">Your answers set the vendor&apos;s risk tier by your organization&apos;s rules, and the tier decides which checks are needed before a contract becomes active.</p>
        {questions.map((q, i) => (
          <fieldset key={q.key} className="vnd-intake-q" role="radiogroup" aria-labelledby={`intake-${q.key}`} aria-required="true">
            <legend id={`intake-${q.key}`}>{i + 1}. {q.text}</legend>
            {q.help && <p className="muted vnd-intake-help">{q.help}</p>}
            <div className="vnd-intake-options">
              {q.options.map((o) => (
                <label key={o.value} className={`vnd-intake-option${answers[q.key] === o.value ? ' is-on' : ''}`}>
                  <input type="radio" name={`intake-${q.key}`} value={o.value} checked={answers[q.key] === o.value} onChange={() => setAnswers({ ...answers, [q.key]: o.value })} />
                  <span>{o.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <TextArea label="Notes" hint="Anything that explains the answers (optional)." value={notes} onChange={setNotes} rows={2} />
        {preview && (
          <div className="vnd-intake-preview" aria-live="polite">
            <span>Risk tier from these answers:</span> {tierChip(preview.tier_label, preview.tier_color)}
            <span className="muted">
              {preview.required_checks.length ? `Checks needed: ${preview.required_checks.map((c) => c.label).join(', ')}.` : 'No checks needed for this tier.'}
            </span>
          </div>
        )}
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={unsaved.guard(onCancel)}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>Save the intake</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- recording a check ---------- */

function CheckForm({ vendorId, data, initialKey, onDone, onCancel }: {
  vendorId: string; data: ChecksData; initialKey: string; onDone: () => void; onCancel: () => void;
}) {
  const toast = useToast();
  const start = { check_key: initialKey, outcome: 'done', done_on: todayInZone(), expires_on: '', reference: '', note: '' };
  const [v, setV] = useState(start);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(v) !== JSON.stringify(start);
  const unsaved = useUnsavedChanges(dirty);
  const waiving = v.outcome === 'waived';

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!v.check_key) found.check_key = 'Choose a check.';
    if (waiving && !v.note.trim()) found.note = 'Give the reason for the waiver.';
    setErrors(found);
    setMessage(null);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      await api.post(`/api/vendors/${vendorId}/checks`, { ...v, expires_on: v.expires_on || null });
      unsaved.release();
      toast.success(waiving ? 'Check waived.' : 'Check recorded.');
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.fields && Object.keys(err.fields).length) setErrors(err.fields);
      else setMessage(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title={waiving ? 'Waive a check' : 'Record a check'} onClose={onCancel} dirty={dirty}>
      <form className="form" onSubmit={submit} noValidate>
        {message && <div className="form-error" role="alert">{message}</div>}
        <div className="form-grid">
          <Select label="Check" required value={v.check_key} error={errors.check_key} options={data.checks} onChange={(check_key) => setV({ ...v, check_key })} />
          {data.can_waive && (
            <Select
              label="Outcome" required value={v.outcome} error={errors.outcome}
              options={[{ value: 'done', label: 'Done' }, { value: 'waived', label: 'Waived, with a reason' }]}
              onChange={(outcome) => setV({ ...v, outcome })}
            />
          )}
          <DateField label={waiving ? 'Waived on' : 'Done on'} required value={v.done_on} max={todayInZone()} error={errors.done_on} onChange={(done_on) => setV({ ...v, done_on })} />
          <DateField label="Needed again after" hint="Leave empty when it does not expire." value={v.expires_on} error={errors.expires_on} onChange={(expires_on) => setV({ ...v, expires_on })} />
          <TextField label="Reference" hint="A document number, certificate number or file name." value={v.reference} error={errors.reference} onChange={(reference) => setV({ ...v, reference })} />
        </div>
        <TextArea
          label={waiving ? 'Reason for the waiver' : 'Note'} required={waiving} rows={3} value={v.note} error={errors.note}
          hint={waiving ? 'Say why the check is not needed and who agreed. It is kept in the history.' : undefined}
          onChange={(note) => setV({ ...v, note })}
        />
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={unsaved.guard(onCancel)}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>{waiving ? 'Waive the check' : 'Record the check'}</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- the vendor's tab ---------- */

function TierCard({ intake, onFill }: { intake: IntakeData; onFill: () => void }) {
  const latest = intake.latest;
  const fill = intake.can_complete && intake.questions.length > 0
    ? <Button size="sm" icon="clipboard" onClick={onFill}>{latest ? 'Fill in again' : 'Fill in the intake'}</Button>
    : undefined;
  return (
    <Card title="Risk tier" actions={latest ? fill : undefined}>
      {!latest ? (
        <EmptyState
          icon="clipboard" title="No intake yet"
          message="Answer the intake questionnaire to set this vendor's risk tier and the checks it needs."
          action={fill}
        />
      ) : (
        <div className="stack">
          <dl className="vnd-about">
            <div><dt>Risk tier</dt><dd>{tierChip(intake.tier_label, intake.tier_color)}</dd></div>
            <div><dt>Set on</dt><dd>{formatDate(intake.tier_on ?? latest.completed_on)}</dd></div>
            <div><dt>By</dt><dd>{latest.completed_by_name ?? <span className="muted">—</span>}</dd></div>
          </dl>
          <div>
            <h3 className="vnd-intake-h">Why this tier</h3>
            {latest.reasons.length === 0 ? (
              <p className="muted">No rule applied, so the vendor has the default tier.</p>
            ) : (
              <ul className="vnd-intake-reasons">
                {latest.reasons.map((r, i) => (
                  <li key={i}><span>{r.question_text}</span> <strong>{r.answer_label}</strong> <span className="muted">gives at least</span> <LookupChip list="vendor_risk_tier" value={r.tier} /></li>
                ))}
              </ul>
            )}
            {latest.notes && <p className="vnd-wrap">{latest.notes}</p>}
          </div>
          <details className="vnd-intake-answers">
            <summary>All answers</summary>
            <dl>
              {latest.questions.map((q) => (
                <div key={q.key}><dt>{q.text}</dt><dd>{q.options.find((o) => o.value === latest.answers[q.key])?.label ?? <span className="muted">Not answered</span>}</dd></div>
              ))}
            </dl>
          </details>
        </div>
      )}
    </Card>
  );
}

function ChecksCard({ vendorId, data, reload, onChanged }: { vendorId: string; data: ChecksData; reload: () => void; onChanged?: () => void }) {
  const toast = useToast();
  const [recording, setRecording] = useState<string | null>(null);
  const [removing, setRemoving] = useState<CheckRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const changed = () => { reload(); onChanged?.(); };

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await api.del(`/api/vendors/${vendorId}/checks/${removing.id}`);
      toast.success('Check record removed.');
      setRemoving(null);
      changed();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const record = data.can_record ? <Button size="sm" icon="plus" onClick={() => setRecording(data.required.find((r) => r.state === 'missing' || r.state === 'expired')?.key ?? '')}>Record a check</Button> : undefined;
  return (
    <>
      <Card title="Required checks" actions={data.tier ? record : undefined} flush={data.required.length > 0}>
        {!data.tier ? (
          <EmptyState
            icon="shield" title="No risk tier yet"
            message={data.intake_before_contract
              ? 'Fill in the intake first: no contract with this vendor can become active until it is done.'
              : 'Fill in the intake to see which checks this vendor needs.'}
          />
        ) : data.required.length === 0 ? (
          <EmptyState icon="shield" title="No checks needed" message="This vendor's risk tier needs no checks." />
        ) : (
          <>
            {data.outstanding > 0 ? (
              <Notice tone="warning" className="vnd-intake-notice">
                {data.outstanding} check{data.outstanding === 1 ? '' : 's'} still to do. No contract with this vendor can become active until every required check is done or waived.
              </Notice>
            ) : (
              <Notice tone="success" className="vnd-intake-notice">Every required check is done or waived.</Notice>
            )}
            <TableWrap label="Required checks">
              <table className="table">
                <caption className="sr-only">Checks this vendor&apos;s risk tier needs</caption>
                <thead>
                  <tr><th scope="col">Check</th><th scope="col">State</th><th scope="col">Date</th><th scope="col">Needed again after</th><th scope="col">Reference or reason</th>{data.can_record && <th scope="col"><span className="sr-only">Actions</span></th>}</tr>
                </thead>
                <tbody>
                  {data.required.map((r) => (
                    <tr key={r.key}>
                      <td className="vnd-intake-name">{r.label}</td>
                      <td><StatusChip color={CHECK_STATE[r.state].color} label={CHECK_STATE[r.state].label} /></td>
                      <td>{r.latest ? formatDate(r.latest.done_on) : <span className="muted">—</span>}</td>
                      <td>{r.latest?.expires_on ? formatDate(r.latest.expires_on) : <span className="muted">—</span>}</td>
                      <td className="vnd-wrap">{r.latest ? [r.latest.reference, r.latest.note].filter(Boolean).join(' · ') || <span className="muted">—</span> : <span className="muted">—</span>}</td>
                      {data.can_record && (
                        <td className="vnd-intake-act">
                          <Button size="sm" variant="ghost" onClick={() => setRecording(r.key)} aria-label={`Record ${r.label}`}>Record</Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </>
        )}
      </Card>
      {data.history.length > 0 && (
        <Card title="Checks recorded" flush>
          <TableWrap label="Checks recorded, newest first">
            <table className="table">
              <caption className="sr-only">Every check recorded for this vendor, newest first</caption>
              <thead>
                <tr><th scope="col">Check</th><th scope="col">Outcome</th><th scope="col">Date</th><th scope="col">Needed again after</th><th scope="col">Reference</th><th scope="col">Note or reason</th><th scope="col">By</th>{data.can_record && <th scope="col"><span className="sr-only">Actions</span></th>}</tr>
              </thead>
              <tbody>
                {data.history.map((h) => (
                  <tr key={h.id}>
                    <td>{h.check_label ?? h.check_key}</td>
                    <td><StatusChip color={h.outcome === 'waived' ? 'purple' : 'green'} label={h.outcome === 'waived' ? 'Waived' : 'Done'} /></td>
                    <td>{formatDate(h.done_on)}</td>
                    <td>{h.expires_on ? formatDate(h.expires_on) : <span className="muted">—</span>}</td>
                    <td>{h.reference || <span className="muted">—</span>}</td>
                    <td className="vnd-wrap">{h.note || <span className="muted">—</span>}</td>
                    <td>{h.recorded_by_name || <span className="muted">—</span>}</td>
                    {data.can_record && (
                      <td className="vnd-intake-act">
                        {(h.outcome === 'done' || data.can_waive) && (
                          <IconButton icon="trash" size="sm" label={`Remove ${h.check_label ?? h.check_key} of ${formatDate(h.done_on)}`} onClick={() => setRemoving(h)} />
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}
      {recording !== null && (
        <CheckForm vendorId={vendorId} data={data} initialKey={recording} onCancel={() => setRecording(null)} onDone={() => { setRecording(null); changed(); }} />
      )}
      <ConfirmDialog
        open={removing !== null} danger busy={busy} title="Remove this check record?"
        message="Remove it only when it was recorded in error. The removal is kept in the vendor's history."
        confirmLabel="Remove" onConfirm={() => void remove()} onCancel={() => setRemoving(null)}
      />
    </>
  );
}

export function IntakeTab({ vendorId, onChanged }: { vendorId: string; onChanged?: () => void }) {
  const intake = useFetch<IntakeData>(`/api/vendors/${vendorId}/intake`);
  const checks = useFetch<ChecksData>(`/api/vendors/${vendorId}/checks`);
  const [filling, setFilling] = useState(false);
  if (intake.error) return <ErrorState error={intake.error} onRetry={intake.reload} />;
  if (checks.error) return <ErrorState error={checks.error} onRetry={checks.reload} />;
  if (!intake.data || !checks.data) return <Loading lines={5} label="Loading the intake and checks" />;
  return (
    <div className="stack">
      <TierCard intake={intake.data} onFill={() => setFilling(true)} />
      <ChecksCard vendorId={vendorId} data={checks.data} reload={checks.reload} onChanged={onChanged} />
      {intake.data.history.length > 1 && (
        <Card title="Earlier intakes" flush>
          <TableWrap label="Intakes, newest first">
            <table className="table">
              <thead><tr><th scope="col">Completed</th><th scope="col">Risk tier</th><th scope="col">By</th></tr></thead>
              <tbody>
                {intake.data.history.map((h) => (
                  <tr key={h.id}><td>{formatDate(h.completed_on)}</td><td>{tierChip(h.tier_label, h.tier_color)}</td><td>{h.completed_by_name ?? <span className="muted">—</span>}</td></tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}
      <p className="muted"><Link to="/vendors/intake">The intake questions, tier rules and checks</Link></p>
      {filling && (
        <IntakeForm
          vendorId={vendorId} questions={intake.data.questions} previous={intake.data.latest?.answers ?? null}
          onCancel={() => setFilling(false)}
          onDone={() => { setFilling(false); intake.reload(); checks.reload(); onChanged?.(); }}
        />
      )}
    </div>
  );
}

/* ---------- the settings page ---------- */

let nextId = 1;
const freshKey = (prefix: string, taken: string[]) => {
  let key = `${prefix}${nextId++}`;
  while (taken.includes(key)) key = `${prefix}${nextId++}`;
  return key;
};

export function IntakeSettings() {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<Settings>('/api/vendors/intake-settings');
  const [config, setConfig] = useState<IntakeConfig | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ field: string; message: string } | null>(null);
  const editable = Boolean(data?.can_edit) && can('vendors.administer');
  useUnsavedChanges(dirty);

  useEffect(() => {
    if (!data) return;
    setConfig(structuredClone(data.config));
    setDirty(false);
  }, [data]);

  const change = (next: IntakeConfig) => { setConfig(next); setDirty(true); };

  async function save() {
    if (!config) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.put('/api/vendors/intake-settings', { config });
      toast.success('Intake questions saved. Intakes already completed keep their answers and tier.');
      setDirty(false);
      reload();
    } catch (err) {
      const fields = err instanceof ApiError ? err.fields : {};
      const [field, message] = Object.entries(fields ?? {})[0] ?? ['', errorMessage(err)];
      setProblem({ field, message });
    } finally {
      setBusy(false);
    }
  }

  async function setBefore(on: boolean) {
    try {
      await api.put('/api/vendors/intake-settings', { intake_before_contract: on });
      toast.success(on ? 'A contract now needs a completed intake before it becomes active.' : 'A contract no longer needs an intake before it becomes active.');
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  let body;
  if (error) body = <ErrorState error={error} onRetry={reload} />;
  else if (!data || !config) body = <Loading lines={8} label="Loading the intake questions" />;
  else {
    const tierOptions = data.tiers.map((t) => ({ value: t.value, label: t.label, color: t.color }));
    const tierLabel = (v: string) => data.tiers.find((t) => t.value === v)?.label ?? v;
    const setQuestion = (i: number, q: IntakeQuestion) => change({ ...config, questions: config.questions.map((x, j) => (j === i ? q : x)) });
    const removeQuestion = (i: number) => {
      const key = config.questions[i].key;
      change({ ...config, questions: config.questions.filter((_, j) => j !== i), rules: config.rules.filter((r) => r.question !== key) });
    };
    const setRule = (i: number, r: TierRule) => change({ ...config, rules: config.rules.map((x, j) => (j === i ? r : x)) });
    const error = (field: string) => (problem?.field === field ? <div className="form-error" role="alert">{problem.message}</div> : null);

    body = (
      <>
        <Card
          title={<>Questions <Badge color="blue">{config.questions.length}</Badge></>}
          actions={editable && (
            <Button size="sm" icon="plus" onClick={() => change({
              ...config,
              questions: [...config.questions, {
                key: freshKey('q', config.questions.map((q) => q.key)), text: '', help: null,
                options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
              }],
            })}>Add question</Button>
          )}
        >
          {error('questions')}
          <ol className="vnd-q-list">
            {config.questions.map((q, i) => (
              <li key={q.key} className="vnd-q">
                <span className="vnd-q-num" aria-hidden="true">{i + 1}</span>
                {editable ? (
                  <div className="vnd-q-fields">
                    <TextArea label={`Question ${i + 1}`} hideLabel rows={1} placeholder="The question" value={q.text} onChange={(text) => setQuestion(i, { ...q, text })} />
                    <TextField label={`Help for question ${i + 1}`} hideLabel placeholder="Help for the person answering (optional)" value={q.help ?? ''} onChange={(help) => setQuestion(i, { ...q, help: help || null })} />
                    <div className="vnd-intake-opts-edit">
                      {q.options.map((o, j) => (
                        <span key={o.value} className="vnd-intake-opt-edit">
                          <TextField label={`Answer ${j + 1} of question ${i + 1}`} hideLabel placeholder={`Answer ${j + 1}`} value={o.label}
                            onChange={(label) => setQuestion(i, { ...q, options: q.options.map((x, k) => (k === j ? { ...x, label } : x)) })} />
                          <IconButton icon="x" size="sm" label={`Remove answer ${j + 1} of question ${i + 1}`} disabled={q.options.length <= 2}
                            onClick={() => {
                              change({
                                ...config,
                                questions: config.questions.map((x, k) => (k === i ? { ...q, options: q.options.filter((_, m) => m !== j) } : x)),
                                rules: config.rules.map((r) => (r.question === q.key ? { ...r, answers: r.answers.filter((a) => a !== o.value) } : r)),
                              });
                            }} />
                        </span>
                      ))}
                      <Button size="sm" variant="ghost" icon="plus" disabled={q.options.length >= 12}
                        onClick={() => setQuestion(i, { ...q, options: [...q.options, { value: freshKey('a', q.options.map((x) => x.value)), label: '' }] })}>
                        Add answer
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="vnd-q-fields">
                    <span>{q.text}</span>
                    {q.help && <span className="vnd-clause-hint">{q.help}</span>}
                    <span className="muted">{q.options.map((o) => o.label).join(' · ')}</span>
                  </div>
                )}
                {editable && (
                  <span className="vnd-q-tools">
                    <IconButton icon="trash" size="sm" label={`Remove question ${i + 1}`} onClick={() => removeQuestion(i)} />
                  </span>
                )}
              </li>
            ))}
          </ol>
        </Card>

        <Card
          title="Tier rules"
          actions={editable && config.questions.length > 0 && (
            <Button size="sm" icon="plus" onClick={() => change({ ...config, rules: [...config.rules, { question: config.questions[0].key, answers: [], tier: data.tiers[data.tiers.length - 1]?.value ?? '' }] })}>Add rule</Button>
          )}
        >
          <p className="muted">A vendor gets the highest tier of any rule its answers match. When no rule matches, it gets the default tier. Tiers rank in the order of the Risk tier list under Administration &gt; Lists.</p>
          {error('rules')}
          {error('default_tier')}
          <div className="vnd-intake-default">
            {editable
              ? <Select label="Default tier" required value={config.default_tier} options={tierOptions} onChange={(default_tier) => change({ ...config, default_tier })} />
              : <p>Default tier: <strong>{tierLabel(config.default_tier)}</strong></p>}
          </div>
          {config.rules.length === 0 ? (
            <EmptyState icon="target" title="No rules" message="Every vendor gets the default tier until you add a rule." />
          ) : (
            <ol className="vnd-intake-rules">
              {config.rules.map((r, i) => {
                const q = config.questions.find((x) => x.key === r.question);
                return (
                  <li key={i} className="vnd-intake-rule">
                    {editable ? (
                      <>
                        <Select label={`Rule ${i + 1}: question`} value={r.question} options={config.questions.map((x, n) => ({ value: x.key, label: x.text || `Question ${n + 1}` }))}
                          onChange={(question) => setRule(i, { ...r, question, answers: [] })} />
                        <ChoicesField label="Any of these answers" value={r.answers} options={(q?.options ?? []).map((o) => ({ value: o.value, label: o.label || '(no text yet)' }))}
                          onChange={(answers) => setRule(i, { ...r, answers })} />
                        <Select label="Gives at least" value={r.tier} options={tierOptions} onChange={(tier) => setRule(i, { ...r, tier })} />
                        <IconButton icon="trash" size="sm" label={`Remove rule ${i + 1}`} onClick={() => change({ ...config, rules: config.rules.filter((_, j) => j !== i) })} />
                      </>
                    ) : (
                      <span>
                        {q?.text ?? r.question}: <strong>{r.answers.map((a) => q?.options.find((o) => o.value === a)?.label ?? a).join(' or ')}</strong> gives at least <strong>{tierLabel(r.tier)}</strong>
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </Card>

        <Card title="Checks each tier needs" flush>
          {error('required_checks')}
          <TableWrap label="Checks each tier needs">
            <table className="table vnd-intake-matrix">
              <caption className="sr-only">Which checks each risk tier needs before a contract becomes active</caption>
              <thead>
                <tr><th scope="col">Check</th>{data.tiers.map((t) => <th key={t.value} scope="col">{t.label}</th>)}</tr>
              </thead>
              <tbody>
                {data.checks.map((c) => (
                  <tr key={c.value}>
                    <td className="vnd-intake-name">{c.label}</td>
                    {data.tiers.map((t) => {
                      const on = (config.required_checks[t.value] ?? []).includes(c.value);
                      return (
                        <td key={t.value}>
                          {editable ? (
                            <Checkbox
                              label={`${c.label} for ${t.label}`} checked={on} className="vnd-intake-check"
                              onChange={(yes) => {
                                const list = config.required_checks[t.value] ?? [];
                                change({ ...config, required_checks: { ...config.required_checks, [t.value]: yes ? [...list, c.value] : list.filter((x) => x !== c.value) } });
                              }}
                            />
                          ) : on ? <Badge color="blue">Needed</Badge> : <span className="muted">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <p className="muted vnd-intake-foot">Name your tiers and checks under Administration &gt; Lists (Vendor risk tier, Vendor check).</p>
        </Card>

        {editable && (
          <div className="form-actions vnd-q-actions">
            {problem && !['questions', 'rules', 'default_tier', 'required_checks'].includes(problem.field) && <div className="form-error" role="alert">{problem.message}</div>}
            {dirty && <Button onClick={reload} disabled={busy}>Undo changes</Button>}
            <Button variant="primary" loading={busy} disabled={!dirty} onClick={() => void save()}>Save the intake questions</Button>
          </div>
        )}

        <Card title="Before a contract becomes active">
          <p className="muted">A contract never becomes active while a check its vendor&apos;s tier needs is neither done nor waived. You can also require every vendor to have an intake first.</p>
          <Switch
            label="Require a completed intake before a contract becomes active"
            checked={data.intake_before_contract} disabled={!editable}
            onChange={(on) => void setBefore(on)}
          />
        </Card>
      </>
    );
  }

  return (
    <div className="stack">
      <PageHeader
        title="Intake questions and risk tiers"
        subtitle="The questions asked about every new vendor, the rules that turn the answers into a risk tier, and the checks each tier needs before a contract becomes active."
        breadcrumbs={[{ label: 'Vendors', to: '/vendors' }, { label: 'Intake questions' }]}
        actions={<Link className="btn btn-secondary" to="/vendors">Vendors</Link>}
      />
      {data && !editable && <p className="notice">You can read the intake questions. Changing them needs permission to administer vendors.</p>}
      {body}
    </div>
  );
}

/* ---------- on a contract that is not active yet ---------- */

/** Tells the people working on a draft contract which of the vendor's required checks still stand in the way. */
export function VendorChecksNotice({ contract }: { contract: Row }) {
  const { can } = useAuth();
  const wanted = Boolean(contract.vendor_id) && can('vendors.view') && ['draft', 'not_on_file'].includes(String(contract.status ?? ''));
  const { data } = useFetch<ChecksData>(wanted ? `/api/vendors/${contract.vendor_id}/checks` : null);
  if (!wanted || !data) return null;
  const missing = data.required.filter((r) => r.state === 'missing' || r.state === 'expired');
  if (missing.length === 0 && (data.tier || !data.intake_before_contract)) return null;
  return (
    <Notice tone="warning" title="This contract cannot become active yet" className="vnd-intake-notice">
      {data.tier
        ? <>The vendor&apos;s risk tier needs these checks done or waived first: {missing.map((m) => m.label).join(', ')}.</>
        : <>The vendor needs a completed intake questionnaire first.</>}{' '}
      <Link to={`/vendors/${contract.vendor_id}?tab=intake`}>Open the vendor&apos;s checks</Link>
    </Notice>
  );
}

/** A vendor's risk tier as a chip that says what it is, beside the criticality chip that may share its words. */
export function RiskTierChip({ value }: { value: string | null | undefined }) {
  const tiers = useLookup('vendor_risk_tier');
  if (!value) return null;
  const t = tiers.find((x) => x.value === value);
  return <StatusChip color={(t?.color ?? 'gray') as ColorName} label={`${t?.label ?? value} risk tier`} title="Set by the intake questionnaire" />;
}
