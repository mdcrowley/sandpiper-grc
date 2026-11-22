// Control tests: the list across every control, and one test with its sampled items, the
// reviewer's sign-off and, when it was not effective, its corrective action plan.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  api, Button, Card, ConfirmDialog, EditableSummary, EmptyState, ErrorState, errorMessage, IconButton, Loading, LookupChip, LookupSelect,
  Modal, PageHeader, RecordPage, ResourceList, TableWrap, TextArea, TextField, useAuth, useFetch, useResource, useToast,
} from '../../core';
import type { RecordContext } from '../../core';
import { capsInBuild, ControlCaps, ControlsTabs } from './shared';

// The statuses and results with a meaning (Administration > Lists can rename them, not change what they mean).
const REVIEWED = 'reviewed';
const INEFFECTIVE = 'ineffective';

export function TestList() {
  return (
    <div className="stack">
      <PageHeader title="Control tests" subtitle="Tests of each control's design and operation: planned, in progress, awaiting review and reviewed." />
      <ControlsTabs active="tests" />
      <ResourceList
        type="control_test"
        urlState
        columns={['ref', 'control_id', 'test_type', 'status', 'result', 'planned_on', 'performed_on', 'tester_id', 'reviewer_id', { field: 'reviewed_on', hidden: true }, { field: 'method', hidden: true }]}
        filters={['status', 'result', 'test_type', 'method', 'control_id', 'tester_id', 'reviewer_id', 'planned_on', 'performed_on']}
        createFields={['control_id', 'test_type', 'planned_on', 'period_start', 'period_end', 'tester_id', 'method', 'population']}
      />
    </div>
  );
}

interface Sample { id: string; item: string; result: string | null; note: string | null }
interface SampleData { rows: Sample[]; sample_size: number | null; exceptions_found: number | null }

function Samples({ row, reload: reloadTest }: RecordContext) {
  const { can } = useAuth();
  const toast = useToast();
  const url = `/api/control-tests/${row.id}/samples`;
  const { data, error, reload } = useFetch<SampleData>(url);
  const [item, setItem] = useState('');
  const [result, setResult] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Sample | null>(null);
  const locked = row.status === REVIEWED;
  const canEdit = can('controls.edit') && !locked;

  const done = () => { reload(); reloadTest(); };
  const add = async () => {
    setBusy(true);
    try {
      await api.post(url, { item, result: result || null, note: note || null });
      setItem(''); setResult(''); setNote('');
      done();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const setOne = async (s: Sample, value: string) => {
    try { await api.patch(`${url}/${s.id}`, { result: value || null }); done(); } catch (err) { toast.error(errorMessage(err)); }
  };
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try { await api.del(`${url}/${removing.id}`); setRemoving(null); done(); } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <Card title="Items sampled" flush={!!data?.rows.length && !canEdit}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={3} label="Loading the sampled items" />
        : (
          <div className="stack">
            {canEdit && (
              <form className="ctl-add" onSubmit={(e) => { e.preventDefault(); if (item.trim()) void add(); }}>
                <TextField label="Item looked at" value={item} onChange={setItem} placeholder="For example: gate log, 3 March" maxLength={500} />
                <LookupSelect label="Result" list="control_sample_result" value={result} onChange={setResult} />
                <TextField label="Note" value={note} onChange={setNote} maxLength={2000} />
                <Button type="submit" variant="primary" icon="plus" disabled={!item.trim()} loading={busy && !removing}>Add item</Button>
              </form>
            )}
            {data.rows.length === 0 ? (
              <EmptyState icon="clipboard" title="No items listed"
                message={locked ? 'This test was recorded with totals only.' : 'List each item the test looked at; the sample size and exceptions then follow the list.'} />
            ) : (
              <TableWrap label="Items this test sampled">
                <table className="table">
                  <caption className="sr-only">Items this test sampled</caption>
                  <thead><tr><th scope="col">Item</th><th scope="col">Result</th><th scope="col">Note</th>{canEdit && <th scope="col"><span className="sr-only">Remove</span></th>}</tr></thead>
                  <tbody>
                    {data.rows.map((s) => (
                      <tr key={s.id}>
                        <td className="ctl-wrap">{s.item}</td>
                        <td>{canEdit
                          ? <LookupSelect label={`Result for ${s.item}`} list="control_sample_result" value={s.result ?? ''} onChange={(v) => void setOne(s, v)} />
                          : s.result ? <LookupChip list="control_sample_result" value={s.result} /> : <span className="muted">—</span>}</td>
                        <td className="ctl-wrap">{s.note ?? <span className="muted">—</span>}</td>
                        {canEdit && <td><IconButton icon="x" label={`Remove ${s.item}`} variant="ghost" size="sm" onClick={() => setRemoving(s)} /></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
            <p className="muted ctl-hint">{data.sample_size ?? 0} item{data.sample_size === 1 ? '' : 's'} sampled, {data.exceptions_found ?? 0} exception{data.exceptions_found === 1 ? '' : 's'}.</p>
          </div>
        )}
      <ConfirmDialog open={!!removing} busy={busy} title="Remove this item?" message={`${removing?.item ?? ''} will be taken off the sample.`}
        confirmLabel="Remove item" onCancel={() => setRemoving(null)} onConfirm={remove} />
    </Card>
  );
}

/** Header buttons: review and sign off (someone other than the tester), and raise a corrective action plan. */
function TestActions({ row, reload }: RecordContext) {
  const { can, user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const capType = useResource('cap');
  const [reviewing, setReviewing] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const final = row.status === REVIEWED;
  const finished = row.status === 'complete' || final;
  const notEffective = row.result === INEFFECTIVE || row.result === 'partly_effective';
  const tester = row.tester_id ?? row.created_by;
  const mayReview = can('controls.approve') && finished && !final;

  const review = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ flagged: number }>(`/api/control-tests/${row.id}/review`, { note });
      setReviewing(false);
      setNote('');
      toast.success(res.flagged ? `Test signed off. ${res.flagged} covered record${res.flagged === 1 ? ' is' : 's are'} now due for review.` : 'Test signed off.');
      reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const raise = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ cap: { id: string; ref: string | null } }>(`/api/control-tests/${row.id}/cap`, {});
      toast.success(`${res.cap.ref ?? 'Plan'} raised. Add its actions, then submit it for approval.`);
      navigate(`/caps/${res.cap.id}`);
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <>
      {mayReview && (
        tester === user?.id
          ? <span className="muted ctl-note">Someone other than the tester reviews this test.</span>
          : <Button variant="primary" icon="check-circle" onClick={() => setReviewing(true)}>Review and sign off</Button>
      )}
      {capType && capsInBuild && notEffective && finished && !row.cap_id && can('controls.edit') && can('actions.create') && (
        <Button icon="clipboard" loading={busy && !reviewing} onClick={raise}>Raise a corrective action plan</Button>
      )}
      <Modal open={reviewing} title="Review and sign off this test" onClose={() => setReviewing(false)} dirty={!!note}
        footer={<><Button onClick={() => setReviewing(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={review}>Sign off</Button></>}>
        <div className="stack">
          <p>
            Result: {row.result ? <LookupChip list="control_test_result" value={row.result} /> : '—'}.
            {' '}Signing off makes the test final and rolls its result up to the control.
            {row.result === INEFFECTIVE && ' Because it is ineffective, every risk and hazard the control covers becomes due for review today, and their owners are told.'}
          </p>
          <TextArea label="Review note" hint="Optional: what you checked." value={note} onChange={setNote} rows={3} />
        </div>
      </Modal>
    </>
  );
}

export function TestDetail() {
  const { can } = useAuth();
  const caps = capsInBuild && can('actions.view');
  return (
    <RecordPage
      type="control_test"
      actions={(rec) => <TestActions {...rec} />}
      summary={(rec) => (
        <div className="stack">
          <EditableSummary type="control_test" row={rec.row} onSaved={rec.reload} title="Test" editable={rec.canEdit && rec.row.status !== REVIEWED}
            fields={['title', 'control_id', 'test_type', 'status', 'planned_on', 'period_start', 'period_end', 'performed_on', 'tester_id', 'method', 'population', 'sample_size', 'exceptions_found', 'result', 'conclusion', 'reviewer_id', 'reviewed_on', 'review_note', 'flagged_on']} />
          {rec.row.cap_id && rec.row._display?.cap_id && (
            <p className="notice">Corrective action plan: <Link to={`/caps/${rec.row.cap_id}`}>{rec.row._display.cap_id}</Link></p>
          )}
        </div>
      )}
      tabs={[
        { key: 'samples', label: 'Items sampled', content: (rec) => <Samples {...rec} /> },
        ...(caps ? [{ key: 'caps', label: 'Corrective action plans', content: ({ row }: RecordContext) => <ControlCaps sourceType="control_test" sourceId={row.id} source="control" /> }] : []),
      ]}
      evidence
    />
  );
}

