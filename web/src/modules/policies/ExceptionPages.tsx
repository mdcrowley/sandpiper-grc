// Exceptions: the register with tiles and saved views, what is expiring, and the exception record.
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ApiError, Button, Card, ConfirmDialog, Countdown, cx, DateField, EditableSummary, EmptyState, ErrorState, errorMessage, formatDate,
  Loading, Modal, PageHeader, RecordPage, ResourceList, Select, Stat, StatusChip, TableWrap, Tabs, TextField, toColorName, useAuth, useFetch, useResource,
  useLookup, useToast,
} from '../../core';
import type { RecordContext, Row, StatsResult } from '../../core';
import { canMoveTo, editableLifecycle } from '../../core/lifecycleMenus';
import { ensureStarterViews } from './views';
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
        <TableWrap label="Exceptions that have expired or are about to, soonest first" className={cx(loading && 'table-loading')}>
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
        </TableWrap>
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
  const [params, setParams] = useSearchParams();
  useMemo(() => ensureStarterViews('policy_exception', [
    { name: 'Awaiting decision', filters: { status: 'requested' } },
    { name: 'In force', filters: { status: 'approved' }, sort: 'expires_on', dir: 'asc' },
    { name: 'Expired', filters: { status: 'expired' } },
    { name: 'Requested by me', filters: { requested_by: 'me' }, labels: { requested_by: 'Me' } },
  ]), []);
  const section = params.get('section') === 'expiring' ? 'expiring' : 'register';
  const stats = useFetch<StatsResult>('/api/exceptions/stats?group=status');
  const count = (s: string) => stats.data?.groups.find((g) => g.value === s)?.count ?? 0;
  return (
    <div className="stack">
      <PageHeader title="Exceptions" subtitle="Time-limited, approved deviations from a policy or standard." />
      <div className="grid-stats">
        <Stat label="Awaiting decision" icon="clock" value={stats.data ? count('requested') : '–'} color="blue" to="/exceptions?f.status=requested" />
        <Stat label="In force" icon="check-circle" value={stats.data ? count('approved') : '–'} color="green" to="/exceptions?f.status=approved&sort=expires_on&dir=asc" />
        <Stat label="Expired" icon="alert" value={stats.data ? count('expired') : '–'} color={count('expired') ? 'red' : undefined} to="/exceptions?f.status=expired" />
      </div>
      <Tabs label="Exceptions sections" active={section}
        onChange={(key) => setParams(key === 'expiring' ? { section: 'expiring' } : {}, { replace: true })}
        tabs={[{ key: 'register', label: 'Register' }, { key: 'expiring', label: 'Expiring soon' }]} />
      {section === 'expiring' ? <ExpiringExceptions /> : (
        <ResourceList
          type="policy_exception"
          urlState
          columns={[
            'ref', 'title', 'policy_id', 'status',
            { field: 'expires_on', label: 'Expiry', sortable: true, render: (row) => <ExpiryChip date={row.expires_on} status={row.status} /> },
            { field: 'requested_by', hidden: true },
            { field: 'approver_name', hidden: true },
          ]}
          filters={['status', 'policy_id', 'requested_by', 'expires_on']}
          bulkFields={['requested_by']}
          createFields={['title', 'policy_id', 'description', 'justification', 'compensating_controls', 'expires_on']}
        />
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
  const [start, setStart] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const canApprove = can('exceptions.approve');
  const canEdit = can('exceptions.edit');
  // A decision the lifecycle rules do not allow from the current status is not offered (E14-31).
  const rules = editableLifecycle(rec.resource.lifecycle, 'status');
  const values = useLookup('exception_status').map((v) => v.value);
  const may = (to: string) => canMoveTo(rules, row.status, to, values);

  const open = (next: Step) => {
    setErrors({});
    if (next === 'approve') {
      const start = { expires_on: row.expires_on ?? '', approver_name: row.approver_name ?? '', approver_role: row.approver_role ?? '', approved_on: isoDay() };
      setForm(start);
      setStart(JSON.stringify(start));
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
      {row.status === 'requested' && canApprove && may('approved') && <Button variant="primary" onClick={() => open('approve')}>Approve</Button>}
      {row.status === 'requested' && canApprove && may('rejected') && <Button variant="danger" onClick={() => open('reject')}>Reject</Button>}
      {['requested', 'approved'].includes(row.status) && canEdit && may('withdrawn') && <Button onClick={() => open('withdraw')}>Withdraw</Button>}
      {['rejected', 'withdrawn', 'expired'].includes(row.status) && canEdit && may('requested') && <Button onClick={() => open('again')}>Request again</Button>}

      <Modal
        open={step === 'approve'} title="Approve this exception" onClose={() => setStep(null)} size="sm"
        dirty={step === 'approve' && JSON.stringify(form) !== start}
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
