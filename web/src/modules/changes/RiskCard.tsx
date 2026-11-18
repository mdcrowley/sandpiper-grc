import { useState } from 'react';
import {
  ApiError, Button, Card, DefinitionList, errorMessage, ErrorState, Loading, LookupChip, LookupSelect, Modal, TextField, useFetch, useToast,
  type RecordContext,
} from '../../core';
import { Banner, RiskQuestions, RiskResult } from './bits';
import type { ChangeSettings } from './types';
import { computeRisk } from './util';

/** The risk level of a change, the answers behind it, and (while it is a draft) the form to change them. */
export function RiskCard({ row, save, canEdit, onSaved }: RecordContext & { onSaved: () => void }) {
  const toast = useToast();
  const { data, error, reload } = useFetch<ChangeSettings>('/api/changes/settings');
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [override, setOverride] = useState('');
  const [reason, setReason] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const standard = Boolean(row.template_id);
  const editable = canEdit && row.status === 'draft' && !standard;
  const saved = (row.risk_answers ?? {}) as Record<string, string>;

  const begin = () => {
    setAnswers({ ...saved }); setOverride(String(row.risk_override ?? '')); setReason(String(row.risk_override_reason ?? ''));
    setFields({}); setFormError(''); setOpen(true);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (override && !reason.trim()) { setFields({ risk_override_reason: 'Give a reason for overriding the risk level.' }); return; }
    setBusy(true);
    setFields({});
    setFormError('');
    try {
      await save({ risk_answers: answers, risk_override: override || null, risk_override_reason: override ? reason : null });
      toast.success('Risk assessment saved.');
      setOpen(false);
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const q = data?.questionnaire;
  return (
    <Card title="Risk" actions={editable && q && <Button size="sm" icon="edit" onClick={begin}>Edit</Button>}>
      {error ? <ErrorState title="The questionnaire could not be loaded" error={error} onRetry={reload} />
        : !q ? <Loading lines={3} label="Loading the risk questionnaire" />
        : (
          <div className="stack">
            <div className="row">
              {row.risk_level ? <LookupChip list="change_risk" value={row.risk_level} /> : <span className="muted">Not assessed yet</span>}
              {row.risk_score !== null && row.risk_score !== undefined && !standard && <span className="muted">Score {row.risk_score} of 100</span>}
              {standard && <span className="muted">Set by the template</span>}
            </div>
            {row.risk_override && (
              <Banner>
                The risk was set by hand to <strong>{row._display?.risk_override ?? row.risk_override}</strong>
                {row.risk_computed ? <>; the questionnaire gives {String(row._display?.risk_computed ?? row.risk_computed).toLowerCase()}</> : null}. Reason: {row.risk_override_reason}
              </Banner>
            )}
            {!standard && (
              <DefinitionList
                items={q.questions.map((question) => ({
                  label: question.label, wide: true,
                  value: question.options.find((o) => o.value === saved[question.key])?.label ?? <span className="muted">Not answered</span>,
                }))}
              />
            )}
            {!standard && row.status !== 'draft' && <p className="muted">The risk assessment is fixed once a change has been submitted. Return the change to draft to alter it.</p>}
          </div>
        )}

      {q && (
        <Modal open={open} title="Risk assessment" onClose={() => setOpen(false)} size="lg">
          <form className="form" onSubmit={submit} noValidate>
            <RiskQuestions questionnaire={q} answers={answers} onChange={setAnswers} />
            <RiskResult preview={computeRisk(answers, q)} total={q.questions.length} />
            {fields.risk_answers && <p className="form-error" role="alert">{fields.risk_answers}</p>}
            <div className="form-grid">
              <LookupSelect label="Risk override" list="change_risk" value={override} onChange={setOverride} placeholder="None: use the questionnaire" hint="Only when the questionnaire gives the wrong answer for this change." error={fields.risk_override} />
              <TextField label="Reason for override" required={Boolean(override)} disabled={!override} value={reason} onChange={setReason} error={fields.risk_override_reason} />
            </div>
            {formError && !Object.keys(fields).length && <p className="form-error" role="alert">{formError}</p>}
            <div className="form-actions">
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" variant="primary" loading={busy}>Save risk assessment</Button>
            </div>
          </form>
        </Modal>
      )}
    </Card>
  );
}
