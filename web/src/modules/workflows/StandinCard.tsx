// "Stand-in for approvals" on the person's own Account security page (wave 8): name someone to
// decide your approvals while you are away, and see or end the stand-ins that name you or that you
// named. The same periods as Approvals > Stand-ins (Standins.tsx, E14-32), where administrators can
// also set one for anyone.
import { useState } from 'react';
import {
  api, ApiError, Button, Card, ConfirmDialog, DateField, errorMessage, formatDate, Loading, StatusChip, TextField, useFetch, UserPicker, useToast,
} from '../../core';
import type { Standin } from './data';
import './workflows.css';

const localDay = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function StandinCard() {
  const toast = useToast();
  const list = useFetch<{ rows: Standin[] }>('/api/workflows/standins');
  const [adding, setAdding] = useState(false);
  const [standin, setStandin] = useState<string | null>(null);
  const [from, setFrom] = useState(localDay());
  const [to, setTo] = useState(localDay(7));
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [ending, setEnding] = useState<Standin | null>(null);

  // The workflows module is not on this server: no card.
  if (list.error instanceof ApiError && list.error.status === 404) return null;
  const rows = (list.data?.rows ?? []).filter((s) => s.mine || s.for_me);

  async function save() {
    setBusy(true);
    setErrors({});
    try {
      await api.post('/api/workflows/standins', { standin_id: standin, starts_on: from, ends_on: to, note: note.trim() || null });
      toast.success('Stand-in saved. They have been told.');
      setStandin(null);
      setNote('');
      setAdding(false);
      list.reload();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields ?? {}).length) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function end() {
    if (!ending) return;
    setBusy(true);
    try {
      await api.del(`/api/workflows/standins/${ending.id}`);
      toast.success('The stand-in has ended.');
      setEnding(null);
      list.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Stand-in for approvals" actions={!adding ? <Button size="sm" icon="users" onClick={() => setAdding(true)}>Name a stand-in</Button> : undefined}>
      <p className="muted wf-small">
        While you are away, the approvals that come to you also go to your stand-in, and either of you may decide; their decision is
        recorded as made on your behalf. Also under Approvals &gt; Stand-ins.
      </p>
      {list.error ? <p className="notice notice-warn">{errorMessage(list.error)}</p>
        : !list.data ? <Loading label="Loading stand-ins" lines={1} />
          : !rows.length ? <p className="muted">No stand-in is set.</p>
            : (
              <ul className="wf-standin-list" aria-label="Your stand-ins">
                {rows.map((s) => (
                  <li key={s.id} className="wf-standin">
                    <div className="wf-standin-main">
                      <span>{s.mine ? <>You → <strong>{s.standin_name}</strong></> : <><strong>{s.user_name}</strong> → you</>}</span>
                      <span className="muted wf-small">{formatDate(s.starts_on)} to {formatDate(s.ends_on)}{s.note ? ` · ${s.note}` : ''}</span>
                    </div>
                    <span className="wf-your-turn-buttons">
                      <StatusChip color={s.active ? 'green' : 'gray'} label={s.active ? 'Running now' : 'Planned'} size="sm" />
                      {s.mine && <Button size="sm" variant="ghost" onClick={() => setEnding(s)}>End<span className="sr-only"> the stand-in of {s.standin_name}</span></Button>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
      {adding && (
        <div className="wf-standin-form">
          <UserPicker label="Stand-in" required value={standin} onChange={(id) => setStandin(id)} placeholder="Search people" error={errors.standin_id} />
          <DateField label="From" required value={from} onChange={setFrom} error={errors.starts_on} />
          <DateField label="To" required value={to} onChange={setTo} error={errors.ends_on} />
          <TextField label="Note (optional)" value={note} onChange={setNote} placeholder="For example: annual leave" />
          <div className="wf-your-turn-buttons">
            <Button variant="primary" loading={busy} disabled={!standin} onClick={() => void save()}>Save stand-in</Button>
            <Button variant="ghost" onClick={() => { setAdding(false); setErrors({}); }}>Cancel</Button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(ending)}
        title="End this stand-in?"
        message={`${ending?.standin_name ?? ''} will no longer decide approvals for you.`}
        confirmLabel="End stand-in"
        busy={busy}
        onConfirm={() => void end()}
        onCancel={() => setEnding(null)}
      />
    </Card>
  );
}
