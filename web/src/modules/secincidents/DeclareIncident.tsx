import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ApiError, api, Badge, Button, Card, Checkbox, DateTimeField, EmptyState, ErrorState, errorMessage, formatDateTime,
  LookupSelect, PageHeader, TextArea, TextField, useFetch, useToast,
} from '../../core';
import type { Row } from '../../core';
import type { PreviewResult, Questions } from './types';
import { answersToFields, deadlineText } from './types';
import { PilotNotice } from './Workspace';

/**
 * Declare flow: a short form, then a preview of the notifications the answers will require,
 * then confirmation. Nothing is saved until the user confirms.
 */
export function DeclareIncident() {
  const navigate = useNavigate();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [scenario, setScenario] = useState('');
  const [severity, setSeverity] = useState('moderate');
  const [discovered, setDiscovered] = useState(() => new Date().toISOString());
  const asked = useFetch<Questions>('/api/security-incidents/questions');
  const questions = asked.data?.questions ?? [];
  const [answers, setFlags] = useState<Record<string, boolean>>({ is_cyber_incident: true });
  const flags = answersToFields(questions, answers);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<unknown>(null);
  const [busy, setBusy] = useState<'' | 'preview' | 'declared' | 'reported'>('');

  // Any change to the answers makes the preview stale.
  const edit = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setPreview(null); };

  function validate(): boolean {
    const found: Record<string, string> = {};
    if (!title.trim()) found.title = 'Title is required.';
    if (!discovered) found.discovered_at = 'Discovered is required: the notification deadlines count from it.';
    else if (new Date(discovered).getTime() > Date.now() + 5 * 60_000) found.discovered_at = 'Discovered cannot be in the future.';
    setErrors(found);
    return !Object.keys(found).length;
  }

  async function review(e?: React.FormEvent) {
    e?.preventDefault();
    if (!validate()) return;
    setBusy('preview');
    setPreviewError(null);
    try {
      setPreview(await api.post<PreviewResult>('/api/security-incidents/notification-preview', { ...flags, discovered_at: discovered }));
    } catch (err) {
      setPreviewError(err);
    } finally {
      setBusy('');
    }
  }

  async function save(status: 'declared' | 'reported') {
    if (!validate()) return;
    setBusy(status);
    try {
      const row = await api.post<Row>('/api/security-incidents', {
        title, summary: summary || undefined, scenario: scenario || undefined, severity, discovered_at: discovered, status, ...flags,
      });
      toast.success(status === 'declared' ? 'Incident declared. The notification clocks are running.' : 'Incident saved as reported. No clocks yet.');
      navigate(`/security-incidents/${row.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.fields) { setErrors(err.fields); setPreview(null); }
      toast.error(errorMessage(err));
      setBusy('');
    }
  }

  return (
    <div className="stack">
      <PageHeader title="Declare a security incident"
        breadcrumbs={[{ label: 'Security incidents', to: '/security-incidents' }, { label: 'Declare' }]} />
      <PilotNotice />
      <div className="grid-2">
        <Card title="1. What do we know?">
          <form className="form" onSubmit={review} noValidate>
            <TextField label="Title" required value={title} onChange={edit(setTitle)} error={errors.title} autoFocus
              hint="A short plain description, for example: ransom note on the scheduling server" />
            <TextArea label="Summary" value={summary} onChange={edit(setSummary)} rows={3} error={errors.summary} />
            <div className="form-grid">
              <LookupSelect label="Scenario" list="security_incident_scenario" value={scenario} onChange={edit(setScenario)} error={errors.scenario}
                hint="Brings the matching containment and recovery checklists" />
              <LookupSelect label="Severity" list="security_incident_severity" value={severity} onChange={edit(setSeverity)} error={errors.severity} />
              <DateTimeField label="Discovered" required value={discovered} onChange={edit(setDiscovered)} error={errors.discovered_at}
                hint="When the organisation first became aware. Every deadline counts from this time" />
            </div>
            <fieldset className="si-questions">
              <legend><strong>Questions that decide who must be told</strong></legend>
              {asked.error ? <ErrorState title="The questions could not be loaded" error={asked.error} onRetry={asked.reload} /> : null}
              {questions.map((q) => (
                <Checkbox key={q.key} label={q.question} hint={q.hint} checked={!!answers[q.key]} error={errors[q.value]}
                  onChange={(v) => { setFlags((old) => ({ ...old, [q.key]: v })); setPreview(null); }} />
              ))}
              <p className="muted">If unsure, answer yes. An answer can be changed later and the clocks follow.</p>
            </fieldset>
            <div className="form-actions">
              <Button onClick={() => navigate('/security-incidents')}>Cancel</Button>
              <Button variant="primary" type="submit" loading={busy === 'preview'} disabled={!asked.data}>Review notifications</Button>
            </div>
          </form>
        </Card>

        <Card title="2. Notifications this will require">
          {previewError ? <ErrorState title="The preview could not be loaded" error={previewError} onRetry={() => review()} />
            : !preview ? (
              <EmptyState icon="clock" title="Nothing to review yet"
                message="Fill in the form and choose Review notifications. Nothing is saved until you confirm." />
            ) : (
              <div className="stack">
                {preview.notifications.length ? (
                  <ul className="si-preview">
                    {preview.notifications.map((n) => (
                      <li key={n.rule_id}>
                        <span className="row">
                          <strong>{n.party}</strong>
                          <Badge color={n.required ? 'blue' : 'gray'}>{n.required ? 'Required' : 'Recommended'}</Badge>
                        </span>
                        <span>{deadlineText(n.deadline_hours)} from discovery: by {formatDateTime(n.due_at)}</span>
                        {n.guidance && <span className="muted">{n.guidance}</span>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState icon="check" title="No notifications with a deadline" message="No active rule matches these answers." />
                )}
                {preview.not_configured.length > 0 && (
                  <>
                    <h3 className="si-section-title">Also consider (no deadline configured, so no clock)</h3>
                    <ul className="si-preview">
                      {preview.not_configured.map((n) => (
                        <li key={n.rule_id} className="si-preview-off">
                          <strong>{n.party}</strong>
                          {n.guidance && <span className="muted">{n.guidance}</span>}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <div className="form-actions">
                  <Button onClick={() => save('reported')} loading={busy === 'reported'} disabled={busy !== ''}>Save as reported only</Button>
                  <Button variant="primary" onClick={() => save('declared')} loading={busy === 'declared'} disabled={busy !== ''}>
                    Confirm and declare incident
                  </Button>
                </div>
              </div>
            )}
        </Card>
      </div>
    </div>
  );
}
