import { useState } from 'react';
import { Card, EditableSummary, ErrorState, errorMessage, LinksPanel, Loading, Switch, useFetch, useToast } from '../../core';
import type { RecordContext } from '../../core';
import type { Questions } from './types';

/** What is involved: the yes/no answers that drive the notification rules, the affected systems and data, and linked records. */
export function AffectedTab({ rec, onSaved }: { rec: RecordContext; onSaved: () => void }) {
  const { row, save, canEdit } = rec;
  const toast = useToast();
  const asked = useFetch<Questions>('/api/security-incidents/questions');
  const [saving, setSaving] = useState<string | null>(null);
  const held: string[] = Array.isArray(row.data_kinds) ? row.data_kinds : [];

  async function answer(q: Questions['questions'][number], yes: boolean) {
    setSaving(q.key);
    try {
      await save(q.kind === 'flag' ? { [q.value]: yes } : { data_kinds: yes ? [...held, q.value] : held.filter((v) => v !== q.value) });
      if (row.declared_at) toast.info('Answer saved. The notification clocks have been brought up to date.');
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(null);
    }
  }

  // A kind retired from the list stays visible on incidents that already carry it.
  const known = new Set((asked.data?.questions ?? []).filter((q) => q.kind === 'data_kind').map((q) => q.value));
  const retired = held.filter((v) => !known.has(v));

  return (
    <div className="stack">
      <Card title="Questions that decide who must be told">
        {asked.error ? <ErrorState title="The questions could not be loaded" error={asked.error} onRetry={asked.reload} />
          : !asked.data ? <Loading lines={3} label="Loading questions" />
          : (
            <div className="si-answers">
              {asked.data.questions.map((q) => (
                <Switch key={q.key} label={q.question} hint={q.hint || undefined} disabled={!canEdit || saving !== null}
                  checked={q.kind === 'flag' ? row[q.value] === true : held.includes(q.value)} onChange={(v) => void answer(q, v)} />
              ))}
              {retired.map((v) => (
                <Switch key={v} label={`${v} (a kind of data no longer on the list)`} checked disabled={!canEdit || saving !== null}
                  onChange={() => void save({ data_kinds: held.filter((x) => x !== v) }).then(onSaved).catch((err) => toast.error(errorMessage(err)))} />
              ))}
              <p className="muted">
                {row.declared_at
                  ? 'Changing an answer adds or stands down the matching clocks straight away. Completed notifications are never removed.'
                  : 'These answers decide which clocks start when the incident is declared.'}
              </p>
            </div>
          )}
      </Card>
      <EditableSummary type="security_incident" row={row} onSaved={onSaved} title="Affected systems and data"
        fields={['affected_systems', 'affected_data']} />
      <Card title="Linked systems, data categories and other records">
        <LinksPanel type="security_incident" id={row.id} />
      </Card>
    </div>
  );
}
