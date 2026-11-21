import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ApiError, api, Badge, Button, Card, DateTimeField, EmptyState, ErrorState, errorMessage, formatDateTime, Icon, Loading,
  lookupLabel, LookupSelect, PageHeader, Stepper, Switch, TextArea, TextField, useCustomFieldInputs, useDebounced, useFetch, useLookup, useResource, useToast,
} from '../../core';
import { editableLifecycle, moveBlockedReason } from '../../core/lifecycleMenus';
import type { Row } from '../../core';
import { PilotNotice, remainingText, useLifecycle, useNow, zoneName } from './shared';
import type { PreviewItem, PreviewResult, Questions } from './types';
import { answersToFields, deadlineText } from './types';

const STEPS = [
  { key: 'what', label: 'What happened' },
  { key: 'involved', label: 'What is involved' },
  { key: 'confirm', label: 'Review and declare' },
];

function PreviewLine({ item, now }: { item: PreviewItem; now: number }) {
  const overdue = !!item.due_at && new Date(item.due_at).getTime() <= now;
  return (
    <li className={overdue ? 'si-preview-item is-overdue' : 'si-preview-item'}>
      <div className="si-preview-top">
        <strong>{item.party}</strong>
        <Badge color={item.required ? 'blue' : 'gray'}>{item.required ? 'Required' : 'Recommended'}</Badge>
      </div>
      <div className="si-preview-when">
        <Icon name={overdue ? 'alert' : 'clock'} size={14} />
        <span>{deadlineText(item.deadline_hours)}{Number(item.deadline_hours) === 0 ? '' : ' from discovery'}: by <strong>{formatDateTime(item.due_at)}</strong></span>
        <span className="si-preview-left">{remainingText(item.due_at, now)}</span>
      </div>
      {item.guidance && (
        <details className="si-clock-guidance">
          <summary>Guidance</summary>
          <p>{item.guidance}</p>
        </details>
      )}
    </li>
  );
}

/** The live preview: which notifications the answers so far would require. Nothing is saved to produce it. */
function Preview({ preview, error, loading, onRetry }: { preview: PreviewResult | null; error: unknown; loading: boolean; onRetry: () => void }) {
  const now = useNow(30_000);
  return (
    <Card title="Notifications this will require" className="si-preview-card"
      actions={preview ? <span className="si-count">{preview.notifications.length} with a deadline</span> : undefined}>
      {error ? <ErrorState title="The preview could not be loaded" error={error} onRetry={onRetry} />
        : !preview ? <Loading lines={3} label="Working out the notifications" />
        : (
          <div className={loading ? 'stack si-preview is-stale' : 'stack si-preview'} aria-live="polite">
            {preview.notifications.length ? (
              <ul className="si-preview-list">
                {[...preview.notifications].sort((a, b) => Number(a.deadline_hours) - Number(b.deadline_hours)).map((n) => <PreviewLine key={n.rule_id} item={n} now={now} />)}
              </ul>
            ) : (
              <EmptyState icon="check" title="No notifications with a deadline" message="No active rule matches these answers, so declaring will start no clocks." />
            )}
            {preview.not_configured.length > 0 && (
              <div className="si-preview-also">
                <h3>Also consider (no deadline configured, so no clock)</h3>
                <ul>
                  {preview.not_configured.map((n) => <li key={n.rule_id}>{n.party}</li>)}
                </ul>
                <p>These rules match your answers but are switched off. Decide for yourself whether these parties must be told.</p>
              </div>
            )}
            <p className="si-preview-foot">Deadlines count from the discovery time, not from now. This preview updates as you answer; nothing is saved until you confirm.</p>
          </div>
        )}
    </Card>
  );
}

/**
 * Declare flow: three short steps with a live preview of the notifications the answers will
 * require. Nothing is saved until the user confirms on the last step.
 */
export function DeclareIncident() {
  const navigate = useNavigate();
  const toast = useToast();
  const lifecycle = useLifecycle().data;
  const severities = useLookup('security_incident_severity') as { value: string; label: string; color: string; meta?: { guide?: string } }[];
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [scenario, setScenario] = useState('');
  const [severity, setSeverity] = useState('moderate');
  const [discovered, setDiscovered] = useState(() => new Date().toISOString());
  const asked = useFetch<Questions>('/api/security-incidents/questions');
  const questions = asked.data?.questions ?? [];
  const [answers, setAnswers] = useState<Record<string, boolean>>({ is_cyber_incident: true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<unknown>(null);
  const [previewing, setPreviewing] = useState(false);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState<'' | 'declared' | 'reported'>('');
  // A new incident may start only in a status the lifecycle rules allow for a new record (E14-31).
  const rules = editableLifecycle(useResource('security_incident')?.lifecycle, 'status');
  const startBlocked = (as: 'declared' | 'reported') => {
    const to = lifecycle?.statuses.find((s) => s.stage === as);
    return moveBlockedReason(rules, '', to?.value ?? as, to?.label ?? as, lifecycle?.statuses.map((s) => s.value));
  };
  // The administrator's custom fields on security incidents (E18-34), asked on the first step.
  const custom = useCustomFieldInputs('security_incident');

  const flags = answersToFields(questions, answers);
  const loaded = !!asked.data;
  const key = useDebounced(JSON.stringify({ ...flags, discovered_at: discovered || null }), 250);

  // The preview follows the answers and the discovery time.
  useEffect(() => {
    if (!loaded) return;
    let stale = false;
    setPreviewing(true);
    api.post<PreviewResult>('/api/security-incidents/notification-preview', JSON.parse(key)).then(
      (res) => { if (!stale) { setPreview(res); setPreviewError(null); setPreviewing(false); } },
      (err: unknown) => { if (!stale) { setPreviewError(err); setPreviewing(false); } },
    );
    return () => { stale = true; };
  }, [key, loaded, retry]);

  function validate(): boolean {
    const found: Record<string, string> = {};
    if (!title.trim()) found.title = 'Give the incident a short title.';
    if (!discovered) found.discovered_at = 'Discovered is required: the notification deadlines count from it.';
    else if (new Date(discovered).getTime() > Date.now() + 5 * 60_000) found.discovered_at = 'Discovered cannot be in the future.';
    setErrors(found);
    const customOk = custom.collect() !== null;
    if (Object.keys(found).length || !customOk) setStep(0);
    return !Object.keys(found).length && customOk;
  }

  function go(next: number) {
    if (next > 0 && !validate()) return;
    setStep(next);
  }

  async function save(as: 'declared' | 'reported') {
    if (!validate()) return;
    const extra = custom.collect() ?? {};
    const status = lifecycle?.statuses.find((s) => s.stage === as)?.value ?? as;
    setBusy(as);
    try {
      const row = await api.post<Row>('/api/security-incidents', {
        title, summary: summary || undefined, scenario: scenario || undefined, severity, discovered_at: discovered, status, ...flags, ...extra,
      });
      toast.success(as === 'declared' ? 'Incident declared. The notification clocks are running.' : 'Incident saved as reported. No clocks yet.');
      navigate(`/security-incidents/${row.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.fields) { setErrors(err.fields); custom.showErrors(err.fields); setStep(0); }
      toast.error(errorMessage(err));
      setBusy('');
    }
  }

  const yes = questions.filter((q) => answers[q.key]);

  return (
    <div className="stack si-declare">
      <PageHeader title="Declare a security incident"
        subtitle="Three short steps. Nothing is saved until you confirm, and every answer can be corrected afterwards."
        breadcrumbs={[{ label: 'Security incidents', to: '/security-incidents' }, { label: 'Declare' }]} />
      <PilotNotice />
      <div className="si-declare-steps">
        <Stepper label="Declare an incident" current={STEPS[step].key} steps={STEPS} onStepClick={(k) => go(STEPS.findIndex((s) => s.key === k))} />
      </div>
      <div className="si-declare-grid">
        <Card title={`${step + 1}. ${STEPS[step].label}`}>
          <form className="form" noValidate onSubmit={(e) => { e.preventDefault(); if (step < 2) go(step + 1); }}>
            {step === 0 && (
              <>
                <TextField label="Title" required value={title} onChange={setTitle} error={errors.title} autoFocus
                  hint="A short plain description, for example: ransom note on the scheduling server" />
                <TextArea label="Summary" value={summary} onChange={setSummary} rows={3} error={errors.summary}
                  hint="What is known so far. It can be added to later" />
                <div className="form-grid">
                  <DateTimeField label="Discovered" required value={discovered} onChange={setDiscovered} error={errors.discovered_at}
                    hint={`When the organization first became aware (${zoneName()}). Every deadline counts from this time`} />
                  <LookupSelect label="Scenario" list="security_incident_scenario" value={scenario} onChange={setScenario} error={errors.scenario}
                    hint="Brings the matching containment and recovery checklists" />
                </div>
                <fieldset className="si-severity">
                  <legend>Severity</legend>
                  <div className="si-severity-grid" role="radiogroup" aria-label="Severity">
                    {severities.map((s) => (
                      <button key={s.value} type="button" role="radio" aria-checked={severity === s.value}
                        className={`si-sev si-sev-${s.color}`} onClick={() => setSeverity(s.value)}>
                        <span className="si-sev-name"><span className="si-kind-dot" aria-hidden="true" />{s.label}</span>
                        {s.meta?.guide && <span className="si-sev-guide">{s.meta.guide}</span>}
                      </button>
                    ))}
                  </div>
                  {errors.severity && <p className="field-error">{errors.severity}</p>}
                </fieldset>
                {custom.inputs}
              </>
            )}

            {step === 1 && (
              <fieldset className="si-answers">
                <legend>Questions that decide who must be told</legend>
                {asked.error ? <ErrorState title="The questions could not be loaded" error={asked.error} onRetry={asked.reload} />
                  : !asked.data ? <Loading lines={3} label="Loading questions" /> : null}
                {questions.map((q) => (
                  <Switch key={q.key} label={q.question} hint={q.hint || undefined} checked={!!answers[q.key]} error={errors[q.value]}
                    onChange={(v) => setAnswers((old) => ({ ...old, [q.key]: v }))} />
                ))}
                <p className="muted">If unsure, answer yes. An answer can be changed later and the clocks follow.</p>
              </fieldset>
            )}

            {step === 2 && (
              <div className="stack">
                <dl className="si-review">
                  <div><dt>Title</dt><dd>{title}</dd></div>
                  {summary && <div><dt>Summary</dt><dd className="prose">{summary}</dd></div>}
                  <div><dt>Discovered</dt><dd>{formatDateTime(discovered)}</dd></div>
                  <div><dt>Severity</dt><dd>{lookupLabel('security_incident_severity', severity)}</dd></div>
                  <div><dt>Scenario</dt><dd>{scenario ? lookupLabel('security_incident_scenario', scenario) : 'Not chosen: no checklist will be copied'}</dd></div>
                  <div><dt>Answered yes</dt><dd>{yes.length ? <ul className="si-yes">{yes.map((q) => <li key={q.key}>{q.question}</li>)}</ul> : 'None of the questions'}</dd></div>
                </dl>
                <div className="si-callout si-callout-calm" role="note">
                  <Icon name="info" size={20} />
                  <div>
                    <strong>What happens when you declare</strong>
                    <p>
                      {preview?.notifications.length
                        ? `${preview.notifications.length} notification clock${preview.notifications.length === 1 ? ' starts' : 's start'}, counted from the discovery time. `
                        : 'No notification clocks start. '}
                      The roles and the scenario checklist are copied onto the incident, the log begins, and everyone who can see security incidents is told.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="form-actions">
              {step === 0 ? <Button onClick={() => navigate('/security-incidents')}>Cancel</Button> : <Button icon="chevron-left" onClick={() => setStep(step - 1)}>Back</Button>}
              {step < 2 && <Button variant="primary" type="submit">Continue</Button>}
              {step === 2 && (
                <>
                  <Button onClick={() => save('reported')} loading={busy === 'reported'} disabled={busy !== '' || Boolean(startBlocked('reported'))} title={startBlocked('reported') || undefined}>Save as reported only</Button>
                  <Button variant="primary" icon="alert" onClick={() => save('declared')} loading={busy === 'declared'} disabled={busy !== '' || Boolean(startBlocked('declared'))} title={startBlocked('declared') || undefined}>
                    Confirm and declare incident
                  </Button>
                </>
              )}
            </div>
          </form>
        </Card>
        <Preview preview={preview} error={previewError} loading={previewing} onRetry={() => setRetry((n) => n + 1)} />
      </div>
    </div>
  );
}
