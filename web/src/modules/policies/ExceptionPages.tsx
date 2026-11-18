// Exceptions: the register with presets (including what is expiring) and the exception record.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ApiError, Button, Card, ConfirmDialog, Countdown, cx, DateField, EditableSummary, EmptyState, ErrorState, errorMessage, formatDate,
  Loading, Modal, PageHeader, RecordPage, ResourceList, Select, Stat, StatusChip, TextField, toColorName, useAuth, useFetch, useResource, useToast,
} from '../../core';
import type { RecordContext, Row } from '../../core';
import { usePresets } from './PolicyLibrary';
import { ExpiryChip, daysPhrase, daysUntil, isoDay } from './shared';

const DAY = 24 * 3600 * 1000;

interface Expiring {
  id: string; ref: string | null; title: string; status: string; status_label: string; status_color: string;
  policy_id: string | null; policy_ref: string | null; policy_title: string | null;
  approver_name: string | null; expires_on: string; days_left: number; expired: boolean;
}

const WINDOWS = [30, 60, 90, 180].map((d) => ({ value: String(d), label: `Next ${d} days` }));

function ExpiringExceptions() {
  const [days, setDays] = useState('30');
  const { data, error, loading, reload } = useFetch<{ today: string; days: number; rows: Expiring[] }>(`/api/exceptions/expiring?days=${days}`);

  let body;
  if (error) body = <ErrorState error={error} onRetry={reload} />;
  else if (!data) body = <Loading lines={6} label="Loading expiring exceptions" />;
  else if (!data.rows.length) {
    body = <EmptyState icon="check-square" title="Nothing is expiring" message={`No approved exception has expired or runs out in the next ${data.days} days.`} />;
  } else {
    const expired = data.rows.filter((r) => r.expired).length;
    body = (
      <>
        <div className="grid-stats">
          <Stat label="Already expired" value={expired} color={expired ? 'red' : 'green'} />
          <Stat label={`Expiring in ${data.days} days`} value={data.rows.length - expired} color="amber" />
        </div>
        <div className={cx('table-wrap', loading && 'table-loading')}>
          <table className="table">
            <caption className="sr-only">Exceptions that have expired or are about to, soonest first</caption>
            <thead>
              <tr><th scope="col">Exception</th><th scope="col">Policy</th><th scope="col">Status</th><th scope="col">Approver</th><th scope="col">Expires</th><th scope="col">Time left</th></tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td className="pol-rowhead"><Link to={`/exceptions/${r.id}`} className="row-title"><span className="ref">{r.ref}</span> {r.title}</Link></td>
                  <td>{r.policy_id ? <Link to={`/policies/${r.policy_id}`}>{r.policy_title}</Link> : <span className="muted">—</span>}</td>
                  <td><StatusChip color={toColorName(r.status_color)} label={r.status_label} /></td>
                  <td>{r.approver_name ?? <span className="muted">—</span>}</td>
                  <td>{formatDate(r.expires_on)}</td>
                  <td><StatusChip color={r.expired ? 'red' : r.days_left <= 14 ? 'orange' : 'amber'} label={r.expired ? `Expired ${daysPhrase(r.days_left)}` : `Expires ${daysPhrase(r.days_left)}`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }
  return (
    <Card>
      <div className="stack">
        <div className="row"><Select label="Show exceptions expiring in" options={WINDOWS} value={days} onChange={(v) => setDays(v || '30')} /></div>
        <p className="muted">An expired exception no longer covers the deviation: renew it with a new approval, or bring the system back in line with the policy.</p>
        {body}
      </div>
    </Card>
  );
}

export function ExceptionList() {
  const [preset, bar] = usePresets([
    { key: 'all', label: 'All exceptions' },
    { key: 'requested', label: 'Awaiting decision', filter: { status: 'requested' } },
    { key: 'approved', label: 'In force', filter: { status: 'approved' } },
    { key: 'expiring', label: 'Expiring exceptions' },
  ], 'Show exceptions');
  return (
    <div className="stack">
      <PageHeader title="Exceptions" subtitle="Time-limited, approved deviations from a policy or standard." />
      {bar}
      {preset.key === 'expiring' ? <ExpiringExceptions /> : (
        <Card flush>
          <ResourceList
            key={preset.key}
            type="policy_exception"
            columns={[
              'ref', 'title', 'policy_id', 'status', 'requested_by', 'approver_name',
              { field: 'expires_on', label: 'Expiry', sortable: true, render: (row) => <ExpiryChip date={row.expires_on} status={row.status} /> },
            ]}
            filters={['status', 'policy_id', 'requested_by', 'expires_on']}
            baseFilter={preset.filter}
            createFields={['title', 'policy_id', 'description', 'justification', 'compensating_controls', 'expires_on']}
          />
        </Card>
      )}
    </div>
  );
}

type Step = 'approve' | 'reject' | 'withdraw' | 'again' | null;

function ExceptionActions({ rec }: { rec: RecordContext }) {
  const { row } = rec;
  const { can } = useAuth();
  const toast = useToast();
  const [step, setStep] = useState<Step>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ expires_on: '', approver_name: '', approver_role: '', approved_on: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const canApprove = can('exceptions.approve');
  const canEdit = can('exceptions.edit');

  const open = (next: Step) => {
    setErrors({});
    if (next === 'approve') {
      setForm({ expires_on: row.expires_on ?? '', approver_name: row.approver_name ?? '', approver_role: row.approver_role ?? '', approved_on: isoDay() });
    }
    setStep(next);
  };
  const run = async (patch: Record<string, unknown>, done: string) => {
    setBusy(true);
    try {
      await rec.save(patch);
      toast.success(done);
      setStep(null);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const approve = () => {
    if (!form.expires_on) { setErrors({ expires_on: 'Give the date the exception expires.' }); return; }
    void run({ status: 'approved', ...form }, 'Exception approved.');
  };
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <>
      {row.status === 'requested' && canApprove && <Button variant="primary" onClick={() => open('approve')}>Approve</Button>}
      {row.status === 'requested' && canApprove && <Button variant="danger" onClick={() => open('reject')}>Reject</Button>}
      {['requested', 'approved'].includes(row.status) && canEdit && <Button onClick={() => open('withdraw')}>Withdraw</Button>}
      {['rejected', 'withdrawn', 'expired'].includes(row.status) && canEdit && <Button onClick={() => open('again')}>Request again</Button>}

      <Modal
        open={step === 'approve'} title="Approve this exception" onClose={() => setStep(null)} size="sm"
        footer={<><Button onClick={() => setStep(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={approve}>Approve exception</Button></>}
      >
        <div className="stack">
          <p className="muted">An exception is always time-limited. When the expiry date passes it is marked expired automatically.</p>
          <TextField label="Approver" value={form.approver_name} error={errors.approver_name} hint="Leave empty to record your own name." onChange={set('approver_name')} />
          <TextField label="Approver role" value={form.approver_role} error={errors.approver_role} onChange={set('approver_role')} />
          <DateField label="Expires on" required min={isoDay()} value={form.expires_on} error={errors.expires_on} onChange={set('expires_on')} />
          <DateField label="Approved on" value={form.approved_on} error={errors.approved_on} onChange={set('approved_on')} />
        </div>
      </Modal>
      <ConfirmDialog
        open={step === 'reject'} busy={busy} danger title="Reject this exception?"
        message="The request will be marked as rejected. The deviation it describes is not permitted." confirmLabel="Reject"
        onCancel={() => setStep(null)} onConfirm={() => run({ status: 'rejected' }, 'Exception rejected.')}
      />
      <ConfirmDialog
        open={step === 'withdraw'} busy={busy} title="Withdraw this exception?"
        message={row.status === 'approved' ? 'The approval will no longer apply. Use this when the deviation has ended before the expiry date.' : 'The request will be closed without a decision.'}
        confirmLabel="Withdraw" onCancel={() => setStep(null)} onConfirm={() => run({ status: 'withdrawn' }, 'Exception withdrawn.')}
      />
      <ConfirmDialog
        open={step === 'again'} busy={busy} title="Request this exception again?"
        message="The exception goes back to Requested and needs a new approval with a new expiry date."
        confirmLabel="Request again" onCancel={() => setStep(null)} onConfirm={() => run({ status: 'requested' }, 'Exception requested again.')}
      />
    </>
  );
}

/** The expiry date, large, with a live countdown while the exception is in force. */
function ExpiryBanner({ row }: { row: Row }) {
  if (row.status === 'requested') {
    return (
      <div className="pol-notice pol-notice-info" role="status">
        <p><strong>Awaiting a decision.</strong> The deviation is not permitted until someone with approval rights approves it and sets an expiry date.</p>
      </div>
    );
  }
  if (!row.expires_on || !['approved', 'expired'].includes(row.status)) return null;
  const left = daysUntil(row.expires_on);
  const over = row.status === 'expired' || left < 0;
  return (
    <div className="pol-notice" role="status" style={over ? { borderInlineStartColor: 'var(--c-red-solid)' } : left > 30 ? { borderInlineStartColor: 'var(--c-green-solid)' } : undefined}>
      <p>
        <strong>{over ? 'This exception has expired.' : `In force until ${formatDate(row.expires_on)}.`}</strong>{' '}
        {over
          ? `It ran out on ${formatDate(row.expires_on)} (${daysPhrase(left)}). Request it again or bring things back in line with the policy.`
          : `Approved by ${row.approver_name ?? 'the approver'}${row.approved_on ? ` on ${formatDate(row.approved_on)}` : ''}.`}
      </p>
      {!over && <Countdown label="Expires in" deadline={`${row.expires_on}T23:59:59`} warnMs={30 * DAY} />}
    </div>
  );
}

export function ExceptionDetail() {
  const { can } = useAuth();
  const risks = useResource('risk');
  return (
    <RecordPage
      type="policy_exception"
      subtitle={(row) => (row.policy_id
        ? <>Exception to <Link to={`/policies/${row.policy_id}`}>{row._display?.policy_id ?? 'a policy'}</Link></>
        : 'Not tied to a policy in the library')}
      actions={(rec) => <ExceptionActions rec={rec} />}
      banner={({ row }) => <ExpiryBanner row={row} />}
      summary={({ row, reload }) => (
        <div className="grid-2 pol-exc">
          <EditableSummary
            type="policy_exception" row={row} onSaved={reload} title="The exception"
            fields={['title', 'policy_id', 'description', 'justification', 'compensating_controls', 'requested_by', ...(risks ? ['risk_id'] : [])]}
          />
          <EditableSummary
            type="policy_exception" row={row} onSaved={reload} title="Approval and expiry"
            editable={can('exceptions.approve') || (can('exceptions.edit') && row.status !== 'approved')}
            fields={['approver_name', 'approver_role', 'approved_on', 'expires_on']}
          />
        </div>
      )}
    />
  );
}
