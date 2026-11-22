// Retention (/admin/retention): how long each kind of record is kept, and the records past that age.
// The daily check only flags records. Removing one is a separate, explicit, password-confirmed step.
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { SegmentedControl } from '@mantine/core';
import {
  api, ApiError, Button, Card, Checkbox, DateField, EmptyState, ErrorState, errorMessage, formatDate, formatDateTime, Loading, Modal,
  NumberField, PageHeader, qs, relativeTime, Select, StatusChip, Tabs, TextArea, todayInZone, useFetch, useToast,
} from '../../core';
import { Notice, Pager } from './common';
import { adminApi, withReauth } from './reauth';
import { Switch } from './Switch';

interface Policy {
  type: string;
  label: string;
  plural: string;
  restricted: boolean | 'flag';
  periodMonths: number | null;
  category: string | null;
  basis: string;
  active: boolean;
  notes: string | null;
  updatedAt: string | null;
  pendingReviews: number;
  disposal: Disposal;
  personalFields: string[];
}
type Disposal = 'keep' | 'anonymize' | 'delete';
interface RetentionResponse { types: Policy[]; categories: { value: string; label: string }[]; bases: string[]; disposals: Disposal[] }
interface Review {
  id: string;
  record_type: string;
  record_id: string;
  record_label: string | null;
  flagged_at: string;
  basis_at: string | null;
  status: 'pending' | 'extended' | 'anonymized' | 'deleted';
  extended_until: string | null;
  reason: string | null;
  decided_at: string | null;
  decided_by_name: string | null;
  typeLabel: string;
  route: string | null;
  label: string;
  ref: string | null;
  /** Under an active legal hold (flagged before the hold was placed): nothing can be anonymized or removed. */
  held?: boolean;
  holds?: string[];
}
interface ReviewPage { rows: Review[]; total: number; page: number; pageSize: number }

const BASIS_NAMES: Record<string, string> = { updated_at: 'Last change', created_at: 'Creation' };
const REVIEW_STATUS = [
  { value: 'pending', label: 'Waiting for a decision' },
  { value: 'extended', label: 'Kept longer' },
  { value: 'anonymized', label: 'Anonymized' },
  { value: 'deleted', label: 'Removed for good' },
];
const HELD_OPTIONS = [
  { value: 'only', label: 'Held only' },
  { value: 'none', label: 'Not held' },
];
const PAGE_SIZE = 25;
const DISPOSAL_OPTIONS: { value: Disposal; label: string; hint: string }[] = [
  { value: 'keep', label: 'Only keep longer', hint: 'Records past their period can only be kept for longer: nothing is anonymized or removed.' },
  { value: 'anonymize', label: 'Keep longer or anonymize', hint: 'A flagged record can be kept longer, or anonymized: its personal details, comments’ text and files are removed, and the record and its figures stay.' },
  { value: 'delete', label: 'Keep longer, anonymize or remove for good', hint: 'A flagged record can also be removed for good, with its comments, tags and links.' },
];
const DISPOSAL_SHORT: Record<Disposal, string> = { keep: 'Keep only', anonymize: 'Anonymize', delete: 'Remove' };

export function periodText(months: number | null): string {
  if (!months) return 'Not set';
  if (months % 12 === 0) return `${months / 12} ${months === 12 ? 'year' : 'years'}`;
  return `${months} months`;
}

const fieldErrors = (err: unknown) => (err instanceof ApiError ? err.fields : {});

export function RetentionPage() {
  const toast = useToast();
  const policies = useFetch<RetentionResponse>('/api/admin/retention');
  const [tab, setTab] = useState('review');
  const [sweeping, setSweeping] = useState(false);
  const [reviewKey, setReviewKey] = useState(0);
  const pending = policies.data?.types.reduce((n, t) => n + t.pendingReviews, 0);

  const sweep = async () => {
    setSweeping(true);
    try {
      const res = await api.post<{ flagged: number }>('/api/admin/retention/sweep');
      toast.success(res.flagged === 0 ? 'Check finished. No more records are past their retention period.' : `Check finished. ${res.flagged} ${res.flagged === 1 ? 'record was' : 'records were'} flagged for review.`);
      policies.reload();
      setReviewKey((k) => k + 1);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSweeping(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Retention"
        subtitle="How long each kind of record is kept, and the records past that age waiting for a decision."
        actions={<Button icon="refresh" loading={sweeping} onClick={() => void sweep()}>Run the check now</Button>}
      />
      <div className="adm-notices"><Notice icon="clock">
        <p>
          <strong>The daily check flags records. It never deletes anything.</strong> Once a day the application looks for records older than their
          retention period and lists them under <strong>Waiting for a decision</strong>. Each stays there until an administrator keeps it for longer,
          anonymizes it or removes it for good, as far as the record type’s period allows. Anonymizing and removing cannot be undone and ask you to
          confirm your identity. The audit log is never changed: it keeps who changed what.
        </p>
      </Notice></div>
      {policies.error ? <ErrorState error={policies.error} onRetry={policies.reload} />
        : !policies.data ? <Loading lines={8} label="Loading retention periods" />
        : (
          <Tabs
            label="Retention" active={tab} onChange={setTab}
            tabs={[
              { key: 'review', label: 'Review', count: pending, content: <ReviewList key={reviewKey} data={policies.data} onDecided={policies.reload} /> },
              { key: 'periods', label: 'Retention periods', content: <PolicyTable data={policies.data} onSaved={policies.reload} /> },
            ]}
          />
        )}
    </>
  );
}

// ---------- periods ----------

function PolicyTable({ data, onSaved }: { data: RetentionResponse; onSaved: () => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState<Policy | null>(null);
  const set = data.types.filter((t) => t.periodMonths);
  const categoryName = (v: string | null) => (v ? data.categories.find((c) => c.value === v)?.label ?? v : null);

  return (
    <div className="stack">
      <p className="muted adm-tab-lead">
        {set.length === 0
          ? 'No retention periods are set yet, so nothing is ever flagged. Set a period for each kind of record your schedule covers.'
          : `${set.length} of ${data.types.length} record types have a retention period.`}{' '}
        The audit log has its own period under <Link to="/admin/settings#settings-retention">Settings</Link>. It is recorded, not enforced: audit
        events are never deleted or changed, so the log keeps who changed what even after a record is anonymized.
      </p>
      <Card flush>
        {data.types.length === 0 ? <EmptyState icon="clock" title="No record types" message="This installation has no record types to keep." /> : (
          <div className="table-wrap adm-table-frame">
            <table className="table adm-retention">
              <thead>
                <tr>
                  <th scope="col">Record type</th><th scope="col">Kept for</th><th scope="col">Counted from</th>
                  <th scope="col">Schedule category</th><th scope="col">At the end</th><th scope="col">State</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {data.types.map((t) => (
                  <tr key={t.type}>
                    <td className="adm-wrap">
                      <strong>{t.plural}</strong>
                      {t.restricted === true && <span className="muted adm-small"> · restricted</span>}
                      {t.notes && <div className="muted adm-small">{t.notes}</div>}
                    </td>
                    <td>{t.periodMonths ? periodText(t.periodMonths) : <span className="muted">Not set</span>}</td>
                    <td>{t.periodMonths ? BASIS_NAMES[t.basis] ?? t.basis : <span className="muted">—</span>}</td>
                    <td className="adm-wrap">{categoryName(t.category) ?? <span className="muted">—</span>}</td>
                    <td>{t.periodMonths ? DISPOSAL_SHORT[t.disposal] : <span className="muted">—</span>}</td>
                    <td>
                      {!t.periodMonths ? <span className="muted">—</span>
                        : t.active ? <StatusChip color="green" label="Checked" /> : <StatusChip color="gray" label="Paused" />}
                      {t.pendingReviews > 0 && <div className="adm-small">{t.pendingReviews} waiting</div>}
                    </td>
                    <td className="adm-row-actions">
                      <Button size="sm" aria-label={`${t.periodMonths ? 'Change' : 'Set'} the retention period for ${t.plural.toLowerCase()}`} onClick={() => setEditing(t)}>
                        {t.periodMonths ? 'Change' : 'Set period'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && (
        <PolicyDialog
          key={editing.type} policy={editing} data={data} onClose={() => setEditing(null)}
          onSaved={() => { toast.success(`Retention for ${editing.plural.toLowerCase()} saved.`); setEditing(null); onSaved(); }}
        />
      )}
    </div>
  );
}

function PolicyDialog({ policy, data, onClose, onSaved }: { policy: Policy; data: RetentionResponse; onClose: () => void; onSaved: () => void }) {
  const [months, setMonths] = useState<number | null>(policy.periodMonths);
  const [basis, setBasis] = useState(policy.basis || 'updated_at');
  const [category, setCategory] = useState(policy.category ?? '');
  const [active, setActive] = useState(policy.periodMonths ? policy.active : true);
  const [notes, setNotes] = useState(policy.notes ?? '');
  const [disposal, setDisposal] = useState<Disposal>(policy.disposal ?? 'delete');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (months === null || !Number.isInteger(months) || months < 1 || months > 1200) found.periodMonths = 'Enter a whole number of months from 1 to 1200.';
    setErrors(found);
    setFormError('');
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      await withReauth(() => api.put(`/api/admin/retention/${encodeURIComponent(policy.type)}`, { periodMonths: months, basis, category: category || null, active, notes: notes.trim(), disposal }));
      onSaved();
    } catch (err) {
      const fields = fieldErrors(err);
      setErrors(fields);
      if (Object.keys(fields).length === 0) setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title={`Retention for ${policy.plural.toLowerCase()}`} onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <div className="form-grid">
          <NumberField
            label="Keep for (months)" required min={1} max={1200} step={1} value={months} onChange={setMonths} error={errors.periodMonths}
            hint={months && months >= 12 ? `${periodText(months)}. From 1 to 1200 months.` : 'From 1 to 1200 months. 84 months is 7 years.'}
          />
          <Select
            label="Counted from" required value={basis} onChange={(v) => setBasis(v || 'updated_at')} error={errors.basis}
            options={data.bases.map((b) => ({ value: b, label: BASIS_NAMES[b] ?? b }))}
            hint={basis === 'created_at' ? 'When the record was first entered.' : 'When the record was last changed, so records still in use are not flagged.'}
          />
          <Select
            className="form-cell-wide" label="Schedule category" placeholder="None" value={category} onChange={setCategory} error={errors.category}
            options={data.categories.map((c) => ({ value: c.value, label: c.label }))}
            hint="The heading in your records schedule this falls under. The choices are the list “Retention category” under Lists."
          />
          <Select
            className="form-cell-wide" label="At the end of the period, the review may" required value={disposal}
            onChange={(v) => setDisposal((v || 'delete') as Disposal)} error={errors.disposal}
            options={DISPOSAL_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            hint={`${DISPOSAL_OPTIONS.find((o) => o.value === disposal)?.hint ?? ''}${disposal !== 'keep'
              ? ` Personal fields of ${policy.plural.toLowerCase()}: ${policy.personalFields.length ? policy.personalFields.join(', ') : 'none declared'}, plus long-text and person custom fields.`
              : ''}`}
          />
          <TextArea className="form-cell-wide" label="Notes" rows={2} maxRows={6} value={notes} onChange={setNotes} error={errors.notes} hint="Optional: where the period comes from, for example the schedule item. Up to 500 characters." />
        </div>
        <Switch label="Check these records every day" checked={active} onChange={setActive} />
        {!active && <p className="field-hint">While paused, no more records of this type are flagged. Records already flagged stay on the review list.</p>}
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- review ----------

function ReviewList({ data, onDecided }: { data: RetentionResponse; onDecided: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState('pending');
  const [type, setType] = useState('');
  const [held, setHeld] = useState('');
  const [page, setPage] = useState(1);
  const [keeping, setKeeping] = useState<Review | null>(null);
  const [removing, setRemoving] = useState<Review | null>(null);
  const [anonymizing, setAnonymizing] = useState<Review | null>(null);
  const { data: list, error, reload, loading } = useFetch<ReviewPage>(
    `/api/admin/retention/reviews${qs({ status, record_type: type, held, page, pageSize: PAGE_SIZE })}`, { keepPrevious: true },
  );
  const pages = list ? Math.max(1, Math.ceil(list.total / PAGE_SIZE)) : 1;
  const policyOf = (t: string) => data.types.find((p) => p.type === t);
  const decided = (message: string) => { toast.success(message); setKeeping(null); setRemoving(null); setAnonymizing(null); reload(); onDecided(); };

  return (
    <div className="stack">
      <div className="adm-toolbar adm-toolbar-flush">
        <Select label="Show" options={REVIEW_STATUS} required value={status} onChange={(v) => { setStatus(v || 'pending'); setPage(1); }} />
        <Select
          label="Record type" placeholder="Every record type" searchable value={type} onChange={(v) => { setType(v); setPage(1); }}
          options={data.types.map((t) => ({ value: t.type, label: t.plural }))}
        />
        <Select label="Legal hold" placeholder="Held or not" value={held} onChange={(v) => { setHeld(v); setPage(1); }} options={HELD_OPTIONS} />
      </div>
      <Card flush>
        {error ? <ErrorState error={error} onRetry={reload} />
          : !list ? <div className="card-body"><Loading lines={5} label="Loading the review list" /></div>
          : list.rows.length === 0 ? (
            <EmptyState
              icon={status === 'pending' ? 'check-circle' : 'history'}
              title={status === 'pending' ? 'Nothing is waiting for a decision' : status === 'extended' ? 'No records have been kept longer'
                : status === 'anonymized' ? 'No records have been anonymized' : 'No records have been removed'}
              message={status === 'pending'
                ? (data.types.some((t) => t.periodMonths && t.active)
                  ? 'No record is past its retention period. The check runs every day; use Run the check now after changing a period.'
                  : 'Set retention periods first: with none set, nothing is ever flagged.')
                : undefined}
            />
          ) : (
            <>
              <div className={`table-wrap adm-table-frame${loading ? ' table-loading' : ''}`} aria-busy={loading}>
                <table className="table adm-reviews">
                  <thead>
                    <tr>
                      <th scope="col">Record</th>
                      {status === 'pending' && <><th scope="col">Period ended</th><th scope="col">Flagged</th></>}
                      {status !== 'pending' && <><th scope="col">Decision</th><th scope="col">Reason</th></>}
                      {status === 'pending' && <th scope="col"><span className="sr-only">Actions</span></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {list.rows.map((r) => {
                      const p = policyOf(r.record_type);
                      const due = r.basis_at && p?.periodMonths ? new Date(new Date(r.basis_at).setMonth(new Date(r.basis_at).getMonth() + p.periodMonths)) : null;
                      return (
                        <tr key={r.id}>
                          <td className="adm-wrap">
                            {r.route ? <Link to={r.route}>{r.ref ? <span className="ref">{r.ref}</span> : null} {r.label}</Link> : <span>{r.label}</span>}
                            {r.held && (
                              <div><StatusChip color="red" size="sm" label={`Held: ${(r.holds ?? []).join(', ') || 'legal hold'}`} title="Under a legal hold: it can be kept longer, but not anonymized or removed until the hold is released." /></div>
                            )}
                            <div className="muted adm-small">
                              {r.typeLabel}
                              {r.basis_at && ` · ${p?.basis === 'created_at' ? 'created' : 'last changed'} ${formatDate(r.basis_at)}`}
                            </div>
                          </td>
                          {status === 'pending' && (
                            <>
                              <td>{due ? <span title={formatDate(due.toISOString())}>{relativeTime(due.toISOString())}</span> : <span className="muted">—</span>}</td>
                              <td title={formatDateTime(r.flagged_at)}>{formatDate(r.flagged_at)}</td>
                              <td className="adm-row-actions">
                                <span className="row adm-row-buttons">
                                  <Button size="sm" aria-label={`Keep ${r.label} longer`} onClick={() => setKeeping(r)}>Keep longer</Button>
                                  {p && p.disposal !== 'keep' && !r.held && (
                                    <Button size="sm" aria-label={`Anonymize ${r.label}`} onClick={() => setAnonymizing(r)}>Anonymize…</Button>
                                  )}
                                  {(!p || p.disposal === 'delete') && !r.held && (
                                    <Button size="sm" variant="danger" aria-label={`Remove ${r.label} for good`} onClick={() => setRemoving(r)}>Remove…</Button>
                                  )}
                                </span>
                              </td>
                            </>
                          )}
                          {status !== 'pending' && (
                            <>
                              <td className="adm-wrap">
                                {r.status === 'extended' ? <>Kept until <strong>{formatDate(r.extended_until)}</strong></>
                                  : r.status === 'anonymized' ? <strong>Anonymized</strong> : <strong>Removed for good</strong>}
                                <div className="muted adm-small">{r.decided_by_name ?? 'Unknown user'}{r.decided_at ? `, ${formatDate(r.decided_at)}` : ''}</div>
                              </td>
                              <td className="adm-wrap adm-reason">{r.reason ?? <span className="muted">—</span>}</td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pager summary={`${list.total} ${list.total === 1 ? 'record' : 'records'}`} page={page} pages={pages} onPage={setPage} />
            </>
          )}
      </Card>
      {keeping && <KeepDialog review={keeping} onClose={() => setKeeping(null)} onDone={(until) => decided(`Kept until ${formatDate(until)}. It will be flagged again after that.`)} />}
      {anonymizing && (
        <AnonymizeDialog
          review={anonymizing} policy={policyOf(anonymizing.record_type)} onClose={() => setAnonymizing(null)}
          onDone={() => decided('Anonymized. The record and its figures stay; the audit log records the change and your reason.')}
        />
      )}
      {removing && <RemoveDialog review={removing} onClose={() => setRemoving(null)} onDone={() => decided('Removed for good. The audit log records the removal and your reason.')} />}
    </div>
  );
}

function KeepDialog({ review, onClose, onDone }: { review: Review; onClose: () => void; onDone: (until: string) => void }) {
  const [by, setBy] = useState<'months' | 'date'>('months');
  const [months, setMonths] = useState<number | null>(12);
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  // Tomorrow on the organization's calendar, not the UTC one (BW-12).
  const tomorrow = new Date(Date.parse(`${todayInZone()}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (by === 'months' && (months === null || !Number.isInteger(months) || months < 1 || months > 1200)) found.until = 'Enter a whole number of months from 1 to 1200.';
    if (by === 'date' && (!until || until < tomorrow)) found.until = 'Choose a date in the future.';
    if (reason.trim().length < 5) found.reason = 'Give a reason (at least 5 characters).';
    setErrors(found);
    setFormError('');
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const res = await adminApi.post<{ extended_until: string }>(`/api/admin/retention/reviews/${review.id}/extend`, {
        reason: reason.trim(), ...(by === 'months' ? { months } : { until }),
      });
      onDone(res.extended_until);
    } catch (err) {
      const fields = fieldErrors(err);
      setErrors(fields);
      if (Object.keys(fields).length === 0) setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open size="sm" title="Keep this record longer" onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <p><strong>{review.ref ? `${review.ref} ` : ''}{review.label}</strong> <span className="muted">({review.typeLabel})</span></p>
        <SegmentedControl
          aria-label="Keep it for" fullWidth value={by} onChange={(v) => { setBy(v as 'months' | 'date'); setErrors({}); }}
          data={[{ value: 'months', label: 'For a number of months' }, { value: 'date', label: 'Until a date' }]}
        />
        {by === 'months'
          ? <NumberField label="Months" required min={1} max={1200} step={1} value={months} onChange={setMonths} error={errors.until} />
          : <DateField label="Keep until" required min={tomorrow} value={until} onChange={setUntil} error={errors.until} />}
        <TextArea label="Reason" required rows={3} value={reason} onChange={setReason} error={errors.reason} hint="Why it is still needed, for example a legal hold or an open matter. Recorded in the audit log." />
        <p className="field-hint">The record leaves the list now and is flagged again once that date has passed.</p>
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>Keep longer</Button>
        </div>
      </form>
    </Modal>
  );
}

function RemoveDialog({ review, onClose, onDone }: { review: Review; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [sure, setSure] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (reason.trim().length < 5) found.reason = 'Give a reason (at least 5 characters).';
    if (!sure) found.confirm = 'Check the box to confirm that the record is to be removed for good.';
    setErrors(found);
    setFormError('');
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      await adminApi.post(`/api/admin/retention/reviews/${review.id}/delete`, { reason: reason.trim(), confirm: true });
      onDone();
    } catch (err) {
      const fields = fieldErrors(err);
      setErrors(fields);
      if (Object.keys(fields).length === 0) {
        setFormError(err instanceof ApiError && err.code === 'has_attachments'
          ? 'This record still has files attached. Open the record, remove its files, then try again.'
          : errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open size="sm" title="Remove this record for good?" onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <p><strong>{review.ref ? `${review.ref} ` : ''}{review.label}</strong> <span className="muted">({review.typeLabel})</span></p>
        <Notice tone="danger" role="alert">
          <p>
            The record, its comments, tags and links to other records are deleted permanently and <strong>cannot be brought back</strong>, not even by an
            administrator. A record with files attached cannot be removed until the files are. The audit log keeps the record’s history and a note of
            this removal with your reason.
          </p>
        </Notice>
        <TextArea label="Reason" required rows={3} value={reason} onChange={setReason} error={errors.reason} hint="For example the schedule item that allows disposal. Recorded in the audit log." />
        <Checkbox label="I understand that this record will be deleted permanently" checked={sure} onChange={setSure} error={errors.confirm} />
        <p className="field-hint">You will be asked for your password if you have not given it in the last few minutes.</p>
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="danger" loading={busy}>Remove for good</Button>
        </div>
      </form>
    </Modal>
  );
}

function AnonymizeDialog({ review, policy, onClose, onDone }: { review: Review; policy: Policy | undefined; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [sure, setSure] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const fields = policy?.personalFields ?? [];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (reason.trim().length < 5) found.reason = 'Give a reason (at least 5 characters).';
    if (!sure) found.confirm = 'Check the box to confirm that the personal details are to be removed for good.';
    setErrors(found);
    setFormError('');
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      await adminApi.post(`/api/admin/retention/reviews/${review.id}/anonymize`, { reason: reason.trim(), confirm: true });
      onDone();
    } catch (err) {
      const fieldErrs = fieldErrors(err);
      setErrors(fieldErrs);
      if (Object.keys(fieldErrs).length === 0) setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open size="sm" title="Anonymize this record?" onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <p><strong>{review.ref ? `${review.ref} ` : ''}{review.label}</strong> <span className="muted">({review.typeLabel})</span></p>
        <Notice tone="danger" role="alert">
          <p>
            The personal details are removed and <strong>cannot be brought back</strong>, not even by an administrator:
            {' '}{fields.length ? fields.join(', ') : 'no fields of this type are declared personal'}, long-text and person custom fields, the text and
            authors of its comments, the names and contents of its files, and the titles of notifications about it. The record, its status, dates,
            numbers, tags and links stay, so counts and charts do not change. The audit log is not changed: it keeps who changed what.
          </p>
        </Notice>
        <TextArea label="Reason" required rows={3} value={reason} onChange={setReason} error={errors.reason} hint="For example the schedule item that allows disposal. Recorded in the audit log." />
        <Checkbox label="I understand that the personal details will be removed permanently" checked={sure} onChange={setSure} error={errors.confirm} />
        <p className="field-hint">You will be asked to confirm your identity if you have not done so in the last few minutes.</p>
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="danger" loading={busy}>Anonymize</Button>
        </div>
      </form>
    </Modal>
  );
}
