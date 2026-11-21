// Stand-ins for approvals (E14-32), on the Approvals page: an approver names someone to stand in
// for them for a period; administrators can set one for anyone. While it runs, steps that go to the
// approver also go to the stand-in, and either may decide.
import { useState } from 'react';
import {
  api, ApiError, Button, Card, ConfirmDialog, DateField, EmptyState, ErrorState, errorMessage, formatDate, Loading, StatusChip,
  TextField, useAuth, useFetch, UserPicker, useToast,
} from '../../core';
import type { Standin } from './data';
import './workflows.css';

/** Today in the browser's zone as YYYY-MM-DD (the server checks the dates against the organization's day). */
const localDay = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function Row({ s, onEnd }: { s: Standin; onEnd: (s: Standin) => void }) {
  const who = s.mine ? <>You → <strong>{s.standin_name}</strong></> : s.for_me ? <><strong>{s.user_name}</strong> → you</> : <><strong>{s.user_name}</strong> → <strong>{s.standin_name}</strong></>;
  return (
    <li className="wf-standin">
      <div className="wf-standin-main">
        <span>{who}</span>
        <span className="muted wf-small">{formatDate(s.starts_on)} to {formatDate(s.ends_on)}{s.note ? ` · ${s.note}` : ''}</span>
      </div>
      <span className="wf-your-turn-buttons">
        <StatusChip color={s.active ? 'green' : 'gray'} label={s.active ? 'Running now' : 'Planned'} size="sm" />
        {!s.for_me && <Button size="sm" variant="ghost" onClick={() => onEnd(s)}>End<span className="sr-only"> the stand-in of {s.standin_name} for {s.user_name}</span></Button>}
      </span>
    </li>
  );
}

export function Standins() {
  const toast = useToast();
  const { can } = useAuth();
  const admin = can('admin.administer');
  const [all, setAll] = useState(false);
  const list = useFetch<{ rows: Standin[] }>(`/api/workflows/standins${all ? '?all=1' : ''}`);
  const [forWhom, setForWhom] = useState<string | null>(null);
  const [standin, setStandin] = useState<string | null>(null);
  const [from, setFrom] = useState(localDay());
  const [to, setTo] = useState(localDay(7));
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [ending, setEnding] = useState<Standin | null>(null);

  async function save() {
    setBusy(true);
    setErrors({});
    try {
      await api.post('/api/workflows/standins', { user_id: admin && forWhom ? forWhom : undefined, standin_id: standin, starts_on: from, ends_on: to, note: note.trim() || null });
      toast.success('Stand-in saved. They have been told.');
      setStandin(null);
      setNote('');
      list.reload();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
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

  const rows = list.data?.rows ?? [];
  return (
    <div className="wf-standins">
      <Card title="Name a stand-in">
        <p className="muted wf-small">
          While you are away, the approvals that come to you also go to your stand-in, and either of you may decide. Their decision is
          recorded as made on your behalf. A stand-in never decides their own request, and only sees restricted records they may already see.
        </p>
        <div className="wf-standin-form">
          {admin && <UserPicker label="For (administrators: anyone)" value={forWhom} onChange={(id) => setForWhom(id)} placeholder="Yourself" error={errors.user_id} />}
          <UserPicker label="Stand-in" required value={standin} onChange={(id) => setStandin(id)} placeholder="Search people" error={errors.standin_id} />
          <DateField label="From" required value={from} onChange={setFrom} error={errors.starts_on} />
          <DateField label="To" required value={to} onChange={setTo} error={errors.ends_on} />
          <TextField label="Note (optional)" value={note} onChange={setNote} placeholder="For example: annual leave" />
          <div><Button variant="primary" loading={busy} disabled={!standin} onClick={() => void save()}>Save stand-in</Button></div>
        </div>
      </Card>
      <Card title={all ? 'Everyone\'s stand-ins' : 'Your stand-ins'} actions={admin ? <Button size="sm" variant="ghost" onClick={() => setAll(!all)}>{all ? 'Show only yours' : 'Show everyone\'s'}</Button> : undefined}>
        {list.error ? <ErrorState title="Stand-ins could not be loaded" error={list.error} onRetry={list.reload} />
          : !list.data ? <Loading label="Loading stand-ins" lines={2} />
            : !rows.length ? <EmptyState icon="users" title="No stand-ins" message="Stand-ins you name, and those naming you, are listed here until they end." />
              : <ul className="wf-standin-list" aria-label="Stand-ins">{rows.map((s) => <Row key={s.id} s={s} onEnd={setEnding} />)}</ul>}
      </Card>
      <ConfirmDialog
        open={Boolean(ending)}
        title="End this stand-in?"
        message={`${ending?.standin_name ?? ''} will no longer decide approvals for ${ending?.mine ? 'you' : ending?.user_name ?? ''}.`}
        confirmLabel="End stand-in"
        busy={busy}
        onConfirm={() => void end()}
        onCancel={() => setEnding(null)}
      />
    </div>
  );
}
