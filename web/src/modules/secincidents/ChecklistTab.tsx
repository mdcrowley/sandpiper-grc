import { useEffect, useState } from 'react';
import {
  api, Button, Card, Checkbox, EmptyState, ErrorState, errorMessage, formatDateTime, Loading, lookupLabel, ProgressBar,
  Select, TextField, useFetch, useLookup, useToast,
} from '../../core';
import type { ChecklistItem } from './types';

/** Checklists copied from the scenario's template, one card per phase; steps are ticked with who and when. */
export function ChecklistTab({ incidentId, scenario, canEdit, onChanged }: { incidentId: string; scenario: string | null; canEdit: boolean; onChanged?: () => void }) {
  const toast = useToast();
  const phases = useLookup('incident_checklist_phase');
  const { data, error, reload } = useFetch<ChecklistItem[]>(`/api/security-incidents/${incidentId}/checklist`);
  const [step, setStep] = useState('');
  const [phase, setPhase] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  // A new scenario brings its own checklist.
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [scenario]);

  async function tick(item: ChecklistItem, done: boolean) {
    setSaving(item.id);
    try {
      await api.patch(`/api/security-incidents/${incidentId}/checklist/${item.id}`, { done });
      reload();
      onChanged?.();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(null);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!step.trim()) return;
    setBusy(true);
    try {
      await api.post(`/api/security-incidents/${incidentId}/checklist`, { phase: phase || phases[0]?.value, step });
      setStep('');
      reload();
      onChanged?.();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorState title="The checklists could not be loaded" error={error} onRetry={reload} />;
  if (!data) return <Loading label="Loading checklists" />;

  const total = data.length;
  const doneAll = data.filter((i) => i.done).length;

  return (
    <div className="stack">
      {!total ? (
        <EmptyState icon="check-square" title="No checklist yet"
          message={scenario
            ? 'There is no checklist template for this scenario. Add steps below, or ask an administrator to add a template.'
            : 'Choose a scenario with Edit details and its containment and recovery steps are copied here.'} />
      ) : (
        <ProgressBar label="All steps" value={doneAll} max={total} color={doneAll === total ? 'green' : 'blue'} valueText={`${doneAll} of ${total} done`} />
      )}
      <div className="si-phases">
        {phases.map((p) => {
          const items = data.filter((i) => i.phase === p.value);
          if (!items.length) return null;
          const done = items.filter((i) => i.done).length;
          return (
            <Card key={p.value} title={p.label} actions={<span className={done === items.length ? 'si-count si-count-done' : 'si-count'}>{done} of {items.length}</span>} flush>
              <ul className="si-checklist">
                {items.map((i) => (
                  <li key={i.id} className={i.done ? 'is-done' : undefined}>
                    <Checkbox label={i.step} checked={i.done} disabled={!canEdit || saving === i.id} onChange={(v) => tick(i, v)} />
                    {i.done && (
                      <span className="si-checklist-done">
                        {i.done_by_name ?? 'Unknown'} · {formatDateTime(i.done_at)}
                        {i.scenario && scenario && i.scenario !== scenario ? ` · from the ${lookupLabel('security_incident_scenario', i.scenario)} checklist` : ''}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
      {canEdit && (
        <form className="si-add-step" onSubmit={add}>
          <TextField label="Add a step for this incident" value={step} onChange={setStep} />
          <Select label="Phase" required value={phase || phases[0]?.value || ''} onChange={setPhase} options={phases.map((p) => ({ value: p.value, label: p.label }))} />
          <Button type="submit" loading={busy} icon="plus" disabled={!step.trim()}>Add step</Button>
        </form>
      )}
    </div>
  );
}
