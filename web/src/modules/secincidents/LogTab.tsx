import { useEffect, useMemo, useRef, useState } from 'react';
import {
  api, Button, DateTimeField, EmptyState, ErrorState, errorMessage, Loading, LookupChip, TextArea, useFetch, useLookup, useToast,
} from '../../core';
import { dayKey, formatDay, formatTime, zoneName } from './shared';
import type { LogEntry } from './types';

/** True when the key press came from somewhere text is being typed. */
function typingIn(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

/**
 * Append-only incident log: a fast composer above a newest-first timeline grouped by day.
 * Press L to start typing, Ctrl+Enter to add. Entries cannot be edited or deleted.
 */
export function LogTab({ incidentId, canEdit, version, onAdded }: { incidentId: string; canEdit: boolean; version: string; onAdded?: () => void }) {
  const toast = useToast();
  const kinds = useLookup('incident_log_kind');
  const { data, error, reload } = useFetch<LogEntry[]>(`/api/security-incidents/${incidentId}/log`);
  const [entry, setEntry] = useState('');
  const [kind, setKind] = useState('note');
  const [timed, setTimed] = useState(false);
  const [at, setAt] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState('all');
  const form = useRef<HTMLFormElement>(null);

  // Status changes, alerts and recorded notifications add entries of their own.
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [version]);

  // "L" anywhere on the page (outside a text box or a dialog) starts a log entry.
  useEffect(() => {
    if (!canEdit) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'l' || e.ctrlKey || e.metaKey || e.altKey || typingIn(e.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
      const box = form.current?.querySelector('textarea');
      if (!box) return;
      e.preventDefault();
      box.focus();
      box.scrollIntoView({ block: 'center' });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [canEdit]);

  async function add(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    if (!entry.trim()) { setProblem('Write the entry first.'); return; }
    if (timed && !at) { setProblem('Give the time it happened, or choose Now.'); return; }
    setProblem('');
    setBusy(true);
    try {
      await api.post(`/api/security-incidents/${incidentId}/log`, { entry, kind: kind || 'note', ...(timed && at ? { at } : {}) });
      setEntry('');
      setTimed(false);
      setAt('');
      reload();
      onAdded?.();
    } catch (err) {
      setProblem(errorMessage(err));
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // The kinds people write; "System" is what the application uses for its own entries.
  const writable = kinds.filter((k) => k.value !== 'system');
  const days = useMemo(() => {
    const rows = (data ?? []).filter((e) => show === 'all' || e.kind === show);
    const out: { key: string; entries: LogEntry[] }[] = [];
    for (const e of rows) {
      const key = dayKey(e.at);
      const last = out[out.length - 1];
      if (last && last.key === key) last.entries.push(e); else out.push({ key, entries: [e] });
    }
    return out;
  }, [data, show]);

  return (
    <div className="si-log">
      {canEdit && (
        <form className="si-composer" ref={form} onSubmit={add} noValidate
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void add(); } }}>
          <TextArea label="Add a log entry" value={entry} onChange={(v) => { setEntry(v); if (problem) setProblem(''); }} rows={2} maxRows={10} error={problem}
            placeholder="What happened, what was decided or done, and by whom" />
          <div className="si-composer-row">
            <div className="si-kinds" role="radiogroup" aria-label="Kind of entry">
              {writable.map((k) => (
                <button key={k.value} type="button" role="radio" aria-checked={kind === k.value}
                  className={`si-kind si-kind-${k.color}`} onClick={() => setKind(k.value)}>
                  <span className="si-kind-dot" aria-hidden="true" />{k.label}
                </button>
              ))}
            </div>
            <div className="si-composer-send">
              <span className="si-composer-hint"><kbd className="kbd">L</kbd> to write · <kbd className="kbd">Ctrl</kbd> <kbd className="kbd">Enter</kbd> to add</span>
              <Button variant="primary" type="submit" loading={busy} icon="plus">Add to log</Button>
            </div>
          </div>
          <div className="si-composer-time">
            {timed ? (
              <>
                <DateTimeField label="When it happened" value={at} onChange={setAt} size="xs" />
                <Button size="sm" variant="ghost" onClick={() => { setTimed(false); setAt(''); }}>Use the time now</Button>
              </>
            ) : (
              <span>
                Stamped with your name and the time now ({zoneName()}).{' '}
                <button type="button" className="si-link" onClick={() => { setTimed(true); setAt(new Date().toISOString()); }}>It happened earlier</button>
              </span>
            )}
          </div>
        </form>
      )}

      {error ? <ErrorState title="The log could not be loaded" error={error} onRetry={reload} />
        : !data ? <Loading label="Loading log" />
        : !data.length ? <EmptyState icon="history" title="Nothing in the log yet" message="Start with how and when the incident was discovered." />
        : (
          <>
            <div className="si-log-bar">
              <div className="si-filter" role="radiogroup" aria-label="Show entries">
                {[{ value: 'all', label: 'Everything' }, ...kinds.map((k) => ({ value: k.value, label: k.label }))].map((k) => (
                  <button key={k.value} type="button" role="radio" aria-checked={show === k.value} className="si-filter-item" onClick={() => setShow(k.value)}>
                    {k.label}
                  </button>
                ))}
              </div>
              <span className="si-log-note">Newest first. Entries cannot be changed or removed; to correct one, add another.</span>
            </div>
            {!days.length && <EmptyState icon="filter" title="No entries of this kind" />}
            {days.map((d) => (
              <section key={d.key} className="si-day" aria-label={formatDay(d.entries[0].at)}>
                <h3 className="si-day-title">{formatDay(d.entries[0].at)}</h3>
                <ol className="si-entries">
                  {d.entries.map((e) => (
                    <li key={e.id} className={`si-entry si-entry-${e.kind}`}>
                      <time className="si-entry-time" dateTime={e.at}>{formatTime(e.at)}</time>
                      <div className="si-entry-body">
                        <div className="si-entry-head">
                          <LookupChip list="incident_log_kind" value={e.kind} />
                          {(e.author_name ?? 'System') !== 'System' && <span className="si-entry-author">{e.author_name}</span>}
                        </div>
                        <p className="si-entry-text">{e.entry}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </>
        )}
    </div>
  );
}
