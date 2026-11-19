// The steps of an exercise: copied from a security incident scenario checklist (or added by
// hand), each with how it went and a note. Rehearses exactly what would be done for real.
import { useState } from 'react';
import {
  api, ApiError, Button, Card, EmptyState, errorMessage, ErrorState, Icon, IconButton, Loading, LookupSelect, ProgressBar, Select, TextArea,
  TextField, useAuth, useFetch, useToast,
} from '../../core';

interface Step {
  id: string; phase: string | null; phase_label: string | null; step: string; outcome: string | null; notes: string | null; source_scenario: string | null;
  /** The finding raised from this step, if any (E10-17). */
  finding_id: string | null;
}

/** Step outcomes that can raise a finding. */
const GAPS = ['not_done', 'with_issues'];
interface Steps { steps: Step[]; summary: { total: number; went_well: number; with_issues: number; not_done: number; not_tested: number; unrecorded: number } }
interface Lists { available: boolean; scenarios: { value: string; label: string; steps: number }[] }

function StepRow({ exerciseId, step, canEdit, onChanged, onFinding }: {
  exerciseId: string; step: Step; canEdit: boolean; onChanged: () => void; onFinding?: () => void;
}) {
  const toast = useToast();
  const [notes, setNotes] = useState(step.notes ?? '');
  const [raising, setRaising] = useState(false);
  const raise = async () => {
    setRaising(true);
    try {
      // Unsaved notes go into the finding too.
      if (notes !== (step.notes ?? '')) await api.patch(`/api/exercises/${exerciseId}/steps/${step.id}`, { notes });
      await api.post(`/api/exercises/${exerciseId}/steps/${step.id}/finding`, {});
      toast.success('Finding raised. It is on the Findings tab, where a follow-up action can be raised from it.');
      onChanged();
      onFinding?.();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRaising(false);
    }
  };
  const save = async (patch: Record<string, unknown>) => {
    try {
      await api.patch(`/api/exercises/${exerciseId}/steps/${step.id}`, patch);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <li className="trn-step">
      <div className="trn-step-text">
        <p>{step.step}</p>
        {canEdit ? (
          <TextArea label="Notes" hideLabel rows={1} maxRows={4} value={notes} placeholder="What happened at this step (optional)"
            onChange={setNotes} />
        ) : step.notes ? <p className="muted">{step.notes}</p> : null}
        {canEdit && notes !== (step.notes ?? '') && (
          <span className="row"><Button size="sm" variant="primary" onClick={() => void save({ notes })}>Save note</Button></span>
        )}
      </div>
      <div className="trn-step-side">
        <LookupSelect label="How it went" hideLabel list="exercise_step_outcome" value={step.outcome ?? ''} disabled={!canEdit}
          onChange={(outcome) => void save({ outcome: outcome || null })} />
        {step.finding_id ? (
          <span className="trn-step-finding"><Icon name="check" size={14} /> Finding raised</span>
        ) : canEdit && step.outcome && GAPS.includes(step.outcome) && (
          <Button size="sm" variant="secondary" loading={raising} onClick={() => void raise()}>
            Raise finding<span className="sr-only">: {step.step}</span>
          </Button>
        )}
        {canEdit && (
          <IconButton icon="trash" variant="ghost" size="sm" label={`Remove step: ${step.step}`}
            onClick={() => void api.del(`/api/exercises/${exerciseId}/steps/${step.id}`).then(onChanged, (e) => toast.error(errorMessage(e)))} />
        )}
      </div>
    </li>
  );
}

export function ExerciseSteps({ exerciseId }: { exerciseId: string }) {
  const toast = useToast();
  const { can } = useAuth();
  const canEdit = can('exercises.edit');
  const { data, error, reload } = useFetch<Steps>(`/api/exercises/${exerciseId}/steps`, { keepPrevious: true });
  const lists = useFetch<Lists>('/api/exercises/scenario-checklists');
  const [scenario, setScenario] = useState('');
  const [step, setStep] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState('');

  if (error && !data) return <ErrorState title="The steps could not be loaded" error={error} onRetry={reload} />;
  if (!data) return <Loading lines={5} label="Loading the steps" />;

  const copy = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ copied: number }>(`/api/exercises/${exerciseId}/steps/copy`, { scenario });
      toast.success(`${res.copied} steps copied from the checklist.`);
      setScenario('');
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const add = async () => {
    setFieldError('');
    try {
      await api.post(`/api/exercises/${exerciseId}/steps`, { step });
      setStep('');
      reload();
    } catch (err) {
      setFieldError(err instanceof ApiError && err.fields?.step ? err.fields.step : errorMessage(err));
    }
  };

  const s = data.summary;
  const recorded = s.total - s.unrecorded;
  const groups = new Map<string, Step[]>();
  for (const x of data.steps) groups.set(x.phase_label ?? 'Steps', [...(groups.get(x.phase_label ?? 'Steps') ?? []), x]);

  return (
    <div className="stack">
      {canEdit && lists.data?.available && (
        <Card title="Rehearse an incident checklist">
          <div className="row trn-copy">
            <Select label="Incident scenario" value={scenario} onChange={setScenario} placeholder="Choose a scenario"
              options={lists.data.scenarios.map((x) => ({ value: x.value, label: `${x.label} (${x.steps} steps)` }))}
              hint="Copies the scenario's checklist from Security incidents, so the exercise follows what the team would do for real." />
            <Button variant="primary" icon="plus" disabled={!scenario} loading={busy} onClick={() => void copy()}>Copy checklist</Button>
          </div>
        </Card>
      )}
      <Card title="Steps" actions={s.total > 0 ? <span className="muted">{recorded} of {s.total} recorded</span> : undefined}>
        {s.total === 0 ? (
          <EmptyState icon="check-square" title="No steps yet"
            message={lists.data?.available
              ? 'Copy an incident scenario checklist above, or add the steps of the exercise below. Then record how each one went.'
              : 'Add the steps of the exercise below, then record how each one went.'} />
        ) : (
          <div className="stack">
            <ProgressBar label="Steps recorded" value={recorded} max={s.total} color={s.not_done ? 'amber' : 'green'}
              valueText={`${s.went_well} went well, ${s.with_issues} with issues, ${s.not_done} not done, ${s.not_tested} not tested`} />
            {[...groups.entries()].map(([phase, steps]) => (
              <section key={phase} aria-label={phase}>
                <h3 className="trn-phase">{phase}</h3>
                <ul className="trn-steps">
                  {steps.map((x) => <StepRow key={`${x.id}:${x.notes ?? ''}`} exerciseId={exerciseId} step={x} canEdit={canEdit} onChanged={reload} />)}
                </ul>
              </section>
            ))}
          </div>
        )}
        {canEdit && (
          <div className="row trn-copy trn-add-step">
            <TextField label="Add a step" value={step} onChange={setStep} error={fieldError} placeholder="For example: brief the duty manager" />
            <Button icon="plus" disabled={!step.trim()} onClick={() => void add()}>Add step</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
