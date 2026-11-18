import { useEffect, useState } from 'react';
import {
  api, Button, Card, Checkbox, EmptyState, ErrorState, errorMessage, formatDateTime, Loading, lookupLabel, ProgressBar,
  Select, TextField, useFetch, useToast,
} from '../../core';
import type { ChecklistItem } from './types';

const PHASES: { key: ChecklistItem['phase']; label: string }[] = [
  { key: 'containment', label: 'Containment' },
  { key: 'recovery', label: 'Recovery' },
];

/** Containment and recovery checklists copied from the scenario's template; steps are ticked with who and when. */
export function ChecklistTab({ incidentId, scenario, canEdit }: { incidentId: string; scenario: string | null; canEdit: boolean }) {
  const toast = useToast();
  const { data, error, reload } = useFetch<ChecklistItem[]>(`/api/security-incidents/${incidentId}/checklist`);
  const [step, setStep] = useState('');
  const [phase, setPhase] = useState<string>('containment');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  // A new scenario brings its own checklist.
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [scenario]);

  async function tick(item: ChecklistItem, done: boolean) {
    setSaving(item.id);
    try {
      await api.patch(`/api/security-incidents/${incidentId}/checklist/${item.id}`, { done });
      reload();
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
      await api.post(`/api/security-incidents/${incidentId}/checklist`, { phase, step });
      setStep('');
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorState title="The checklists could not be loaded" error={error} onRetry={reload} />;
  if (!data) return <Loading label="Loading checklists" />;

  return (
    <div className="stack">
      {!data.length && (
        <EmptyState icon="check-square" title="No checklist yet"
          message={scenario
            ? 'There is no checklist template for this scenario. Add steps below, or ask an administrator to add a template.'
            : 'Choose a scenario in the details above and its containment and recovery steps are copied here.'} />
      )}
      {PHASES.map((p) => {
        const items = data.filter((i) => i.phase === p.key);
        if (!items.length) return null;
        const done = items.filter((i) => i.done).length;
        return (
          <Card key={p.key} title={p.label}>
            <div className="stack">
              <ProgressBar label={`${p.label} steps done`} value={done} max={items.length} color={done === items.length ? 'green' : 'blue'}
                valueText={`${done} of ${items.length}`} />
              <ul className="si-checklist">
                {items.map((i) => (
                  <li key={i.id}>
                    <Checkbox label={i.step} checked={i.done} disabled={!canEdit || saving === i.id} onChange={(v) => tick(i, v)} />
                    {i.done && (
                      <span className="si-checklist-done">
                        Done by {i.done_by_name ?? 'unknown'}, {formatDateTime(i.done_at)}
                        {i.scenario && scenario && i.scenario !== scenario ? ` (from the ${lookupLabel('security_incident_scenario', i.scenario)} checklist)` : ''}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        );
      })}
      {canEdit && (
        <form className="si-add-step" onSubmit={add}>
          <TextField label="Add a step for this incident" value={step} onChange={setStep} />
          <Select label="Phase" value={phase} onChange={setPhase} options={PHASES.map((p) => ({ value: p.key, label: p.label }))} />
          <Button type="submit" loading={busy} icon="plus" disabled={!step.trim()}>Add step</Button>
        </form>
      )}
    </div>
  );
}
