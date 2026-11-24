// Access review campaigns (E41-02): the list with the figures, and one campaign with its systems and
// reviewers, its removals, and the steps that move it on (launch, complete, record as a control test).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Button, Card, ConfirmDialog, EmptyState, ErrorState, errorMessage, formatDate, formatDateTime, Loading, Menu, Modal, Notice,
  PageHeader, ProgressBar, RecordPage, RecordPicker, ResourceList, Select, StatusChip, TableWrap, TextArea, todayInZone, UserPicker, useAuth, useFetch, useToast,
} from '../../core';
import type { MenuItem, RecordContext, RecordTab, Row } from '../../core';
import { AttentionChip } from './Accounts';
import { AccessTabs, SummaryTiles } from './shared';

export function ReviewList() {
  return (
    <div className="stack">
      <PageHeader title="Access reviews"
        subtitle="Campaigns in which each system's owner keeps or removes every account on their system, with removals tracked until they are done." />
      <AccessTabs active="reviews" />
      <SummaryTiles />
      <ResourceList
        type="access_review"
        urlState
        columns={['ref', 'title', 'status', 'owner_id', 'starts_on', 'due_on', 'completed_on', { field: 'control_test_id', hidden: true }]}
        filters={['status', 'owner_id', 'due_on', 'completed_on']}
        createFields={['title', 'description', 'owner_id', 'starts_on', 'due_on', 'remind_days_before', 'removal_days', 'control_id']}
      />
    </div>
  );
}

interface SystemRow {
  review_system_id: string; system_id: string; system_name: string | null; system_ref: string | null; reviewer_id: string | null; reviewer_name: string | null;
  signed_off_at: string | null; signed_off_by_name: string | null; total: number; decided: number; removals: number; removed: number; flagged: number; active_accounts: number;
}
export interface Totals { accounts: number; kept: number; removals: number; removed: number; leavers: number; onLeave: number; unmatched: number; systems: number }

function SystemsTab({ rec }: { rec: RecordContext }) {
  const { can } = useAuth();
  const toast = useToast();
  const review = rec.row;
  const { data, error, reload } = useFetch<SystemRow[]>(`/api/access-reviews/${review.id}/systems?v=${encodeURIComponent(String(review.updated_at ?? ''))}`);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState<SystemRow | null>(null);
  const [reviewer, setReviewer] = useState<string | null>(null);
  const open = review.status === 'draft' || review.status === 'in_progress';
  const manage = can('systems.edit') && open;
  if (error) return <Card><ErrorState error={error} onRetry={reload} /></Card>;
  if (!data) return <Card><Loading lines={4} label="Loading the systems" /></Card>;

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await fn(); toast.success(done); reload(); rec.reload(); } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const add = () => picked && run(async () => { await api.post(`/api/access-reviews/${review.id}/systems`, { system_id: picked }); setPicked(null); }, 'System added.');
  const takeOut = (s: SystemRow) => run(() => api.del(`/api/access-reviews/${review.id}/systems/${s.system_id}`), `${s.system_name ?? 'System'} taken out of the review.`);
  const saveReviewer = () => changing && reviewer && run(async () => {
    await api.patch(`/api/access-reviews/${review.id}/systems/${changing.system_id}`, { reviewer_id: reviewer });
    setChanging(null);
  }, 'Reviewer changed.');

  return (
    <div className="stack">
      {manage && (
        <Card title="Add a system">
          <div className="ar-add">
            <RecordPicker label="System" type="system" value={picked} placeholder="Search by reference or name" onChange={(id) => setPicked(id)} />
            <Button variant="primary" icon="plus" disabled={!picked} loading={busy} onClick={add}>Add</Button>
          </div>
          <p className="muted ar-note">The system's business owner reviews it (else its technical owner); change the reviewer below.</p>
        </Card>
      )}
      <Card title={`Systems (${data.length})`} flush>
        {data.length === 0 ? <EmptyState icon="server" title="No systems yet" message="Add the systems whose accounts this campaign reviews." /> : (
          <TableWrap label="Systems in this review" fit>
            <table className="table">
              <caption className="sr-only">Systems in this review</caption>
              <thead>
                <tr>
                  <th scope="col" data-priority="1">System</th>
                  <th scope="col" data-priority="1">Reviewer</th>
                  <th scope="col" data-priority="1">{review.status === 'draft' ? 'Active accounts' : 'Decided'}</th>
                  <th scope="col" data-priority="2">Flagged</th>
                  <th scope="col" data-priority="2">Removals</th>
                  <th scope="col" data-priority="1">Signed off</th>
                  {manage && <th scope="col" data-priority="1"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {data.map((s) => (
                  <tr key={s.review_system_id}>
                    <td className="ar-wrap">
                      {review.status === 'draft'
                        ? <Link to={`/systems/${s.system_id}`}>{s.system_ref && <span className="ref">{s.system_ref}</span>} {s.system_name}</Link>
                        : <Link to={`/access-reviews/${review.id}/systems/${s.system_id}`}>{s.system_ref && <span className="ref">{s.system_ref}</span>} {s.system_name}</Link>}
                    </td>
                    <td>{s.reviewer_name ?? <StatusChip color="orange" label="None chosen" />}</td>
                    <td>
                      {review.status === 'draft' ? s.active_accounts : (
                        <ProgressBar value={s.decided} max={Math.max(1, s.total)} label={`Decided on ${s.system_name ?? 'system'}`} hideLabel valueText={`${s.decided} of ${s.total}`} size="sm" />
                      )}
                    </td>
                    <td>{s.flagged ? <StatusChip color="red" label={String(s.flagged)} title="Accounts whose holder has left or is on leave" /> : <span className="muted">0</span>}</td>
                    <td>{s.removals ? `${s.removed} of ${s.removals} done` : <span className="muted">None</span>}</td>
                    <td>{s.signed_off_at ? `${formatDate(s.signed_off_at)}${s.signed_off_by_name ? ` by ${s.signed_off_by_name}` : ''}` : <span className="muted">Not yet</span>}</td>
                    {manage && (
                      <td>
                        {!s.signed_off_at && (
                          <Menu label={`Change ${s.system_name ?? 'system'}`} iconOnly icon="more" variant="ghost" size="sm" align="end" items={[
                            { label: 'Change the reviewer', icon: 'user', onSelect: () => { setChanging(s); setReviewer(s.reviewer_id); } },
                            ...(s.decided === 0 ? [{ label: 'Take out of the review', icon: 'trash' as const, danger: true, onSelect: () => takeOut(s) }] : []),
                          ]} />
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      <Modal open={!!changing} title={`Reviewer of ${changing?.system_name ?? 'the system'}`} onClose={() => setChanging(null)} size="sm"
        footer={<div className="row ar-dialog-buttons"><Button variant="ghost" onClick={() => setChanging(null)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!reviewer} onClick={saveReviewer}>Save</Button></div>}>
        <UserPicker label="Reviewer" value={reviewer} display={changing?.reviewer_name ?? undefined} onChange={(id) => setReviewer(id)} required />
      </Modal>
    </div>
  );
}

function RemovalsTab({ review }: { review: Row }) {
  const toast = useToast();
  const { data, error, reload } = useFetch<Row[]>(`/api/access-reviews/${review.id}/removals`);
  const [busy, setBusy] = useState<string | null>(null);
  if (error) return <Card><ErrorState error={error} onRetry={reload} /></Card>;
  if (!data) return <Card><Loading lines={3} label="Loading the removals" /></Card>;
  const done = async (r: Row) => {
    setBusy(r.id);
    try {
      await api.post(`/api/access-reviews/${review.id}/items/${r.id}/removed`, {});
      toast.success(`Removal of ${r.account_name} recorded.`);
      reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(null); }
  };
  return (
    <Card title={`Removals (${data.length})`} flush>
      {data.length === 0 ? <EmptyState icon="check-square" title="No removals" message="Accounts decided &quot;remove&quot; appear here once their system is signed off." /> : (
        <TableWrap label="Removals decided in this review" fit>
          <table className="table">
            <caption className="sr-only">Removals decided in this review</caption>
            <thead><tr>
              <th scope="col" data-priority="1">Account</th><th scope="col" data-priority="2">System</th><th scope="col" data-priority="2">Holder</th>
              <th scope="col" data-priority="1">Due</th><th scope="col" data-priority="1">Done</th><th scope="col" data-priority="1"><span className="sr-only">Actions</span></th>
            </tr></thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id}>
                  <td className="ar-wrap"><Link to={`/access-reviews/accounts/${r.account_id}`}>{r.account_name}</Link> <AttentionChip value={r.attention} /></td>
                  <td className="ar-wrap">{r.system_name}</td>
                  <td className="ar-wrap">{r.holder_name ?? r.display_name ?? <span className="muted">Not on the roster</span>}</td>
                  <td>{formatDate(r.removal_due_on)}</td>
                  <td>{r.removal_status === 'done' ? `${formatDate(r.removed_at)}${r.removed_by_name ? ` by ${r.removed_by_name}` : ''}${r.removal_note ? `: ${r.removal_note}` : ''}` : <StatusChip color={String(r.removal_due_on) < todayInZone() ? 'red' : 'amber'} label="Pending" />}</td>
                  <td>{r.removal_status === 'pending' && <Button size="sm" loading={busy === r.id} onClick={() => done(r)}>Record as removed</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}

function ControlTestDialog({ review, open, onClose, onDone }: { review: Row; open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [control, setControl] = useState<string | null>(review.control_id ?? null);
  const [result, setResult] = useState<string>('');
  const [conclusion, setConclusion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ test: Row }>(`/api/access-reviews/${review.id}/control-test`, { control_id: control, result: result || undefined, conclusion });
      toast.success(`Recorded as control test ${res.test.ref ?? ''}.`);
      onDone();
      onClose();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} title="Record as a control test" onClose={onClose}
      footer={<div className="row ar-dialog-buttons"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!control} onClick={save}>Record the test</Button></div>}>
      <div className="stack">
        <p className="muted">An operating test of the control is recorded with the accounts reviewed as its population and the accounts decided &quot;remove&quot; as its exceptions. It then waits for review by someone other than you, like any other control test.</p>
        <RecordPicker label="Control" type="control" value={control} display={review._display?.control_id} required onChange={(id) => setControl(id)} />
        <Select label="Result" value={result} onChange={(v) => setResult(v ?? '')} placeholder="Worked out from the removals"
          options={[{ value: 'effective', label: 'Effective' }, { value: 'partly_effective', label: 'Partly effective' }, { value: 'ineffective', label: 'Ineffective' }]} />
        <TextArea label="Conclusion (added to the summary)" value={conclusion} onChange={setConclusion} rows={3} />
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}

function TotalsBanner({ review }: { review: Row }) {
  const { data } = useFetch<Totals>(review.status === 'draft' ? null : `/api/access-reviews/${review.id}/totals?v=${encodeURIComponent(String(review.updated_at ?? ''))}`);
  if (!data) return null;
  return (
    <p className="muted ar-totals">
      {data.accounts} account{data.accounts === 1 ? '' : 's'} on {data.systems} system{data.systems === 1 ? '' : 's'}: {data.kept} kept, {data.removals} to remove ({data.removed} done)
      {data.leavers ? `; ${data.leavers} belonged to people who had left` : ''}.
    </p>
  );
}

export function ReviewDetail() {
  const { can, areaOn } = useAuth();
  const toast = useToast();
  const [confirm, setConfirm] = useState<null | 'launch' | 'complete' | 'cancel'>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const step = async (rec: RecordContext, what: 'launch' | 'complete' | 'cancel') => {
    setBusy(true);
    try {
      await api.post(`/api/access-reviews/${rec.row.id}/${what}`, {});
      toast.success(what === 'launch' ? 'Review launched: each reviewer has been asked.' : what === 'complete' ? 'Review completed.' : 'Review canceled.');
      rec.reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); setConfirm(null); }
  };

  const tabs: RecordTab[] = [
    { key: 'systems', label: 'Systems and reviewers', content: (rec) => <SystemsTab rec={rec} /> },
    { key: 'removals', label: 'Removals', content: (rec) => <RemovalsTab review={rec.row} /> },
  ];

  return (
    <RecordPage
      type="access_review"
      subtitle={(row) => (row.due_on ? `Decisions due ${formatDate(row.due_on)}${row.launched_at ? `; launched ${formatDateTime(row.launched_at)}` : ''}` : 'No due date yet')}
      banner={(rec) => (
        <>
          {rec.row.status === 'draft' && <Notice tone="info">Add the systems and check each reviewer, then launch the review: the active accounts are copied in and each reviewer is asked to decide.</Notice>}
          <TotalsBanner review={rec.row} />
        </>
      )}
      actions={(rec) => {
        const row = rec.row;
        const edit = can('systems.edit');
        const menu: MenuItem[] = [];
        if (can('systems.export') && row.status !== 'draft') menu.push({ label: 'Export the decisions (CSV)', icon: 'download', onSelect: () => { window.location.href = `/api/access-reviews/${row.id}/export`; } });
        if (edit && (row.status === 'draft' || row.status === 'in_progress')) menu.push({ label: 'Cancel the review', icon: 'x', danger: true, onSelect: () => setConfirm('cancel') });
        return (
          <>
            {edit && row.status === 'draft' && <Button variant="primary" icon="enter" loading={busy} onClick={() => setConfirm('launch')}>Launch</Button>}
            {edit && row.status === 'in_progress' && <Button variant="primary" icon="check" loading={busy} onClick={() => setConfirm('complete')}>Complete</Button>}
            {row.status === 'complete' && !row.control_test_id && areaOn('controls') && can('controls.create') && (
              <Button variant="primary" icon="check-circle" onClick={() => setTesting(true)}>Record as a control test</Button>
            )}
            {row.control_test_id && areaOn('controls') && can('controls.view') && <Link className="btn btn-ghost" to={`/controls/tests/${row.control_test_id}`}>Open the control test</Link>}
            {menu.length > 0 && <Menu label="More actions" iconOnly icon="more" items={menu} align="end" />}
            <ConfirmDialog open={confirm !== null}
              title={confirm === 'launch' ? 'Launch the review?' : confirm === 'complete' ? 'Complete the review?' : 'Cancel the review?'}
              message={confirm === 'launch' ? 'The active accounts of each system are copied in and every reviewer is asked to keep or remove them.'
                : confirm === 'complete' ? 'Every system is signed off. Removals still under way stay tracked.' : 'Decisions already made are kept, but nobody can decide any more.'}
              confirmLabel={confirm === 'launch' ? 'Launch' : confirm === 'complete' ? 'Complete' : 'Cancel the review'} cancelLabel="Not now"
              danger={confirm === 'cancel'} busy={busy} onConfirm={() => confirm && step(rec, confirm)} onCancel={() => setConfirm(null)} />
            <ControlTestDialog review={row} open={testing} onClose={() => setTesting(false)} onDone={rec.reload} />
          </>
        );
      }}
      summaryFields={['title', 'description', 'owner_id', 'starts_on', 'due_on', 'remind_days_before', 'removal_days', 'completed_on', ...(areaOn('controls') ? ['control_id', 'control_test_id'] : []), 'notes']}
      tabs={tabs}
    />
  );
}

