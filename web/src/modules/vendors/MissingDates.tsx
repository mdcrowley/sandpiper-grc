// "Complete the dates": a guided queue of open contracts with no end date or notice period.
// One contract at a time, with the text as recorded beside the fields to fill in.
import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  api, ApiError, Badge, Button, Card, cx, DateField, EmptyState, ErrorState, errorMessage, formatDate, Loading,
  LookupSelect, NumberField, PageHeader, ProgressBar, useAuth, useFetch, useToast,
} from '../../core';
import { addDays, daysPhrase, daysUntil } from './shared';

interface QueueRow {
  id: string;
  ref: string | null;
  title: string;
  vendor_id: string;
  vendor_name: string | null;
  renewal_mechanism: string | null;
  start_date: string | null;
  end_date: string | null;
  notice_days: number | null;
  term: string | null;
  owner_name: string | null;
  term_and_renewal: string | null;
  date_and_resolution: string | null;
  document_on_file: string | null;
  missing: ('end_date' | 'notice_days')[];
}

const MISSING_LABEL = { end_date: 'No end date', notice_days: 'No notice period' } as const;

function Recorded({ row }: { row: QueueRow }) {
  const items = [
    { label: 'Term and renewal (as recorded)', value: row.term_and_renewal },
    { label: 'Date and resolution (as recorded)', value: row.date_and_resolution },
    { label: 'Term', value: row.term },
    { label: 'Document on file', value: row.document_on_file },
  ].filter((i) => i.value);
  return (
    <div className="vnd-recorded">
      <span className="vnd-eyebrow">As recorded</span>
      {items.length === 0 ? (
        <p className="muted">
          Nothing was written down about this contract's term. Read the document itself: it may be on the
          contract's <Link to={`/contracts/${row.id}?tab=attachments`}>Attachments</Link> tab.
        </p>
      ) : (
        <dl>
          {items.map((i) => (
            <div key={i.label}>
              <dt>{i.label}</dt>
              <dd>{i.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function DatesForm({ row, onSaved, onSkip, last }: { row: QueueRow; onSaved: () => void; onSkip: () => void; last: boolean }) {
  const toast = useToast();
  const [start, setStart] = useState(row.start_date ?? '');
  const [end, setEnd] = useState(row.end_date ?? '');
  const [days, setDays] = useState<number | null>(row.notice_days);
  const [renewal, setRenewal] = useState(row.renewal_mechanism ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const notice = end ? addDays(end, -(days ?? 0)) : null;
  const changed = start !== (row.start_date ?? '') || end !== (row.end_date ?? '') || days !== row.notice_days || renewal !== (row.renewal_mechanism ?? '');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await api.patch(`/api/contracts/${row.id}`, {
        start_date: start || null, end_date: end || null, notice_days: days, renewal_mechanism: renewal || null,
      });
      toast.success(`${row.ref ?? row.title} saved.`);
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <div className="form-grid">
        <DateField label="Start date" value={start} onChange={setStart} error={errors.start_date} />
        <DateField label="End date" value={end} onChange={setEnd} error={errors.end_date} min={start || undefined} />
        <NumberField
          label="Notice period (days)" value={days} onChange={setDays} min={0} max={3650} step={1} decimals={0}
          error={errors.notice_days} hint="How many days before the end date notice must be given. Enter 0 if none is needed."
        />
        <LookupSelect
          label="Renewal" list="contract_renewal" value={renewal} onChange={setRenewal} error={errors.renewal_mechanism}
          hint="A contract that runs until ended needs no end date."
        />
      </div>
      <p className={cx('vnd-preview', notice && 'vnd-preview-set')} aria-live="polite">
        {notice
          ? <>Notice date will be <strong>{formatDate(notice)}</strong> ({daysPhrase(daysUntil(notice))}){days === null ? '; with no notice period the end date is used' : ''}.</>
          : renewal === 'evergreen'
            ? 'This contract runs until ended, so it has no notice date and stays off the calendar. Record the notice period so it leaves this list.'
            : 'Enter an end date to see the notice date.'}
      </p>
      <div className="form-actions">
        <Button onClick={onSkip} disabled={busy}>{last ? 'Skip' : 'Skip for now'}</Button>
        <Button type="submit" variant="primary" loading={busy} disabled={!changed}>{last ? 'Save' : 'Save and next'}</Button>
      </div>
    </form>
  );
}

export function MissingDates() {
  const { can } = useAuth();
  const { data, error, reload } = useFetch<{ rows: QueueRow[] }>('/api/contracts/missing-dates');
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [startTotal, setStartTotal] = useState<number | null>(null);
  const rows = useMemo(() => data?.rows ?? [], [data]);
  useEffect(() => {
    if (data && startTotal === null) setStartTotal(data.rows.length);
  }, [data, startTotal]);

  const index = Math.max(0, rows.findIndex((r) => r.id === currentId));
  const current = rows[index];
  const editable = can('contracts.edit');

  // After a save the contract leaves the queue; carry on with the one that followed it.
  const advance = (saved: boolean) => {
    const next = rows[index + 1] ?? rows[index === 0 ? 1 : 0];
    setCurrentId(next && next.id !== current?.id ? next.id : null);
    if (saved) reload();
  };

  let body;
  if (error) body = <ErrorState error={error} onRetry={reload} />;
  else if (!data) body = <Loading lines={8} label="Loading contracts" />;
  else if (!rows.length) {
    body = (
      <Card>
        <EmptyState
          icon="check-circle" title="Every contract has its dates"
          message="All open contracts have an end date and a notice period, so each one is on the renewal calendar and gets reminders."
          action={<Link className="btn btn-secondary" to="/contracts/renewals">Open the renewal calendar</Link>}
        />
      </Card>
    );
  } else {
    const total = Math.max(startTotal ?? rows.length, rows.length);
    const done = total - rows.length;
    body = (
      <div className="vnd-queue">
        <Card title="To do" flush className="vnd-queue-list">
          <div className="vnd-queue-progress">
            <ProgressBar label="Completed in this visit" value={done} max={total} color="green" valueText={`${done} of ${total}`} />
          </div>
          <ol aria-label="Contracts with missing dates">
            {rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button" className={cx('vnd-queue-item', r.id === current.id && 'vnd-queue-current')}
                  aria-current={r.id === current.id ? 'true' : undefined} onClick={() => setCurrentId(r.id)}
                >
                  <span className="vnd-queue-title">{r.title}</span>
                  <span className="vnd-queue-sub">{[r.ref, r.vendor_name].filter(Boolean).join(' · ')}</span>
                  <span className="vnd-queue-chips">{r.missing.map((m) => <Badge key={m} color={m === 'end_date' ? 'red' : 'amber'}>{MISSING_LABEL[m]}</Badge>)}</span>
                </button>
              </li>
            ))}
          </ol>
        </Card>
        <Card
          className="vnd-queue-detail"
          title={<>{current.ref && <span className="ref">{current.ref} </span>}{current.title}</>}
          actions={<Link className="btn btn-ghost btn-sm" to={`/contracts/${current.id}`}>Open contract</Link>}
        >
          <p className="muted vnd-queue-meta">
            Contract {index + 1} of {rows.length}
            {current.vendor_name && <> · <Link to={`/vendors/${current.vendor_id}`}>{current.vendor_name}</Link></>}
            {' · '}{current.owner_name ? `Owner: ${current.owner_name}` : 'No owner'}
          </p>
          <div className="vnd-queue-cols">
            <Recorded row={current} />
            {editable
              ? <DatesForm key={current.id} row={current} last={rows.length === 1} onSaved={() => advance(true)} onSkip={() => advance(false)} />
              : <p className="muted">You can see this list but not change contracts.</p>}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="stack">
      <PageHeader
        title="Complete the dates"
        subtitle="Open contracts with no end date or no notice period. Without an end date a contract cannot go on the renewal calendar or get reminders; without a notice period its notice date is only its end date."
        breadcrumbs={[{ label: 'Contracts', to: '/contracts' }, { label: 'Complete the dates' }]}
        actions={<Link className="btn btn-secondary" to="/contracts/renewals">Renewal calendar</Link>}
      />
      {body}
    </div>
  );
}
