import { useEffect, useState } from 'react';
import {
  api, Button, EmptyState, ErrorState, errorMessage, formatDateTime, Loading, LookupChip, LookupSelect, TextArea,
  useFetch, useToast,
} from '../../core';
import type { LogEntry } from './types';

/** Append-only incident log: a quick-add box above a newest-first timeline. Entries cannot be edited or deleted. */
export function LogTab({ incidentId, canEdit, version }: { incidentId: string; canEdit: boolean; version: string }) {
  const toast = useToast();
  const { data, error, reload } = useFetch<LogEntry[]>(`/api/security-incidents/${incidentId}/log`);
  const [entry, setEntry] = useState('');
  const [kind, setKind] = useState('note');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  // Status changes and recorded notifications add system entries.
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [version]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!entry.trim()) { setProblem('Write the entry first.'); return; }
    setProblem('');
    setBusy(true);
    try {
      await api.post(`/api/security-incidents/${incidentId}/log`, { entry, kind: kind || 'note' });
      setEntry('');
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {canEdit && (
        <form className="si-log-add" onSubmit={add} noValidate>
          <TextArea label="Add a log entry" value={entry} onChange={setEntry} rows={3} error={problem}
            hint="What happened, what was decided or done, and by whom. Entries are time-stamped and cannot be changed after saving."
            placeholder="14:05 call with the technical lead: server isolated from the network" />
          <div className="si-log-add-row">
            <LookupSelect label="Kind" list="incident_log_kind" value={kind} onChange={setKind} />
            <Button variant="primary" type="submit" loading={busy} icon="plus">Add to log</Button>
          </div>
        </form>
      )}
      {error ? <ErrorState title="The log could not be loaded" error={error} onRetry={reload} />
        : !data ? <Loading label="Loading log" />
        : !data.length ? <EmptyState icon="history" title="Nothing in the log yet" message="Start with how and when the incident was discovered." />
        : (
          <ol className="timeline" aria-label="Incident log, newest first">
            {data.map((e) => (
              <li key={e.id} className="timeline-item">
                <div className="timeline-head">
                  <LookupChip list="incident_log_kind" value={e.kind} />
                  <strong>{e.author_name ?? 'System'}</strong>
                  <time dateTime={e.at}>{formatDateTime(e.at)}</time>
                </div>
                <div className="si-log-entry">{e.entry}</div>
              </li>
            ))}
          </ol>
        )}
    </div>
  );
}
