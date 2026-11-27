import { lazy, Suspense, useState } from 'react';
import type { ComponentType } from 'react';
import { Button, Card, EditableSummary, formatDateTime, ErrorState, errorMessage, LinksPanel, Loading, Switch, useAuth, useFetch, useToast } from '../../core';
import type { RecordContext } from '../../core';
import type { RecordLink } from '../../core/RecordLinks';
import type { Questions } from './types';

// The fleet module's panel of affected vehicles and services, when that module is built in. Found
// by file name, so this page still builds, and simply leaves the panel out, without it.
const fleetLoaders = import.meta.glob<{ AffectedPanel: ComponentType<{ systemIds: string[] }> }>('../fleet/AffectedPanel.tsx');
const loadFleet = Object.values(fleetLoaders)[0];
const AffectedPanel = loadFleet ? lazy(() => loadFleet().then((m) => ({ default: m.AffectedPanel }))) : null;

/** What is involved: the yes/no answers that drive the notification rules, the affected systems and data, and linked records. */
export function AffectedTab({ rec, onSaved }: { rec: RecordContext; onSaved: () => void }) {
  const { row, save, canEdit } = rec;
  const toast = useToast();
  const asked = useFetch<Questions>('/api/security-incidents/questions');
  const { can } = useAuth();
  const [saving, setSaving] = useState<string | null>(null);
  // One request for the links, shared by the links card and the vehicles and services they reach.
  const links = useFetch<RecordLink[]>(`/api/links?record_type=security_incident&record_id=${encodeURIComponent(row.id)}`);
  const systemIds = (links.data ?? []).filter((l) => l.type === 'system').map((l) => l.recordId);
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

  // E18-77: confirming the answers as they stand (every "No" included) records that they were answered.
  async function confirmAnswers() {
    setSaving('confirm');
    try {
      await save({ data_kinds: held });
      toast.success('Answers confirmed.');
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
      <Card title="Questions that decide who must be told"
        actions={canEdit && !row.answers_confirmed_at
          ? <Button size="sm" loading={saving === 'confirm'} disabled={saving !== null} onClick={() => void confirmAnswers()}>The answers are complete</Button>
          : undefined}>
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
                {row.answers_confirmed_at ? `Answered ${formatDateTime(row.answers_confirmed_at)}. ` : 'Not answered yet: answer each question, or confirm that the answers shown are complete. '}
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
        <LinksPanel type="security_incident" id={row.id} linksState={links} />
      </Card>
      {AffectedPanel && can('fleet.view') && (
        <section className="si-fleet" aria-labelledby="si-fleet-title">
          <div className="si-fleet-head">
            <h2 id="si-fleet-title">Services and vehicles affected</h2>
            <p className="muted">Services that depend on the linked systems, and vehicles that carry their equipment.</p>
          </div>
          {systemIds.length === 0 ? (
            <p className="muted si-fleet-empty">Link the affected systems above to see the services and vehicles they reach.</p>
          ) : (
            <Suspense fallback={<Loading lines={3} label="Loading affected vehicles and services" />}>
              <AffectedPanel systemIds={systemIds} />
            </Suspense>
          )}
        </section>
      )}
    </div>
  );
}
