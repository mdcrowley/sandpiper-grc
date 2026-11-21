// The control library: the list, and one control with what it covers and its tests.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Button, Card, ConfirmDialog, EditableSummary, EmptyState, ErrorState, errorMessage, formatDate, IconButton, Loading, LookupChip,
  PageHeader, RecordPage, RecordPicker, ResourceList, Select, todayInZone, useAuth, useFetch, useToast,
} from '../../core';
import type { RecordContext, Row } from '../../core';
import { ControlsTabs, StateChip } from './shared';

const CREATE_FIELDS = ['title', 'objective', 'description', 'control_type', 'automation', 'frequency', 'domain', 'owner_id', 'operator_id', 'key_control', 'status', 'test_every_months', 'next_test_due'];

export function ControlList() {
  return (
    <div className="stack">
      <PageHeader title="Controls" subtitle="The control library: what each control does, who owns it, how it rates and when it is next tested." />
      <ControlsTabs active="controls" />
      <ResourceList
        type="control"
        urlState
        columns={[
          'ref', 'title', 'status', 'domain', 'control_type', 'operating_rating', 'design_rating', 'next_test_due', 'owner_id',
          { field: 'key_control', hidden: true }, { field: 'automation', hidden: true }, { field: 'frequency', hidden: true }, { field: 'last_tested_on', hidden: true },
        ]}
        filters={['status', 'domain', 'control_type', 'automation', 'frequency', 'key_control', 'operating_rating', 'design_rating', 'owner_id', 'next_test_due']}
        createFields={CREATE_FIELDS}
      />
    </div>
  );
}

interface Covered { link_id: string; type: string; typeLabel: string; id: string; ref: string | null; title: string; route: string; status: string | null; status_list: string | null; review_on: string | null }
interface CoverageData { types: { type: string; label: string; plural: string }[]; rows: Covered[] }

/** What a control covers: records of the types this person may see, grouped by type. */
export function CoverageTab({ control }: { control: Row }) {
  const { can } = useAuth();
  const toast = useToast();
  const url = `/api/controls/${control.id}/coverage`;
  const { data, error, reload } = useFetch<CoverageData>(url);
  const [type, setType] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Covered | null>(null);

  if (error) return <Card><ErrorState error={error} onRetry={reload} /></Card>;
  if (!data) return <Card><Loading lines={4} label="Loading what this control covers" /></Card>;
  const canEdit = can('controls.edit');
  const chosen = type || data.types[0]?.type || '';
  const name = (r: Covered) => [r.ref, r.title].filter(Boolean).join(' ');

  const add = async () => {
    if (!picked || !chosen) return;
    setBusy(true);
    try {
      const res = await api.post<{ added: boolean }>(url, { type: chosen, id: picked });
      toast.success(res.added ? 'Coverage added.' : 'The control already covers that record.');
      setPicked(null);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await api.del(`${url}/${removing.link_id}`);
      toast.success('Coverage removed.');
      setRemoving(null);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="What this control covers" flush={data.rows.length > 0 && !canEdit}>
      <div className="stack">
        {canEdit && data.types.length > 0 && (
          <div className="ctl-add">
            <Select label="Kind of record" value={chosen} options={data.types.map((t) => ({ value: t.type, label: t.label }))}
              onChange={(v) => { setType(v); setPicked(null); }} />
            <RecordPicker key={`${chosen}-${data.rows.length}`} label="Record" type={chosen} value={picked} placeholder="Search by reference or words" onChange={(id) => setPicked(id)} />
            <Button variant="primary" icon="plus" disabled={!picked} loading={busy && !removing} onClick={add}>Add coverage</Button>
          </div>
        )}
        {data.rows.length === 0 ? (
          <EmptyState icon="shield" title="Covers nothing you can see"
            message={data.types.length === 0
              ? 'None of the kinds of record a control can cover are open to you.'
              : canEdit ? 'Choose a kind of record and search for it above, to show which risks, hazards, outcomes, obligations or policies rely on this control.'
              : 'This control has not been linked to any record you can see.'} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Records this control covers</caption>
              <thead>
                <tr><th scope="col">Kind</th><th scope="col">Record</th><th scope="col">Status</th><th scope="col">Next review</th>{canEdit && <th scope="col"><span className="sr-only">Remove</span></th>}</tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.link_id}>
                    <td>{r.typeLabel}</td>
                    <td className="ctl-wrap"><Link to={`${r.route}/${r.id}`}>{r.ref && <span className="ref">{r.ref}</span>} {r.title}</Link></td>
                    <td>{r.status && r.status_list ? <LookupChip list={r.status_list} value={r.status} /> : <span className="muted">—</span>}</td>
                    <td>{r.review_on ? formatDate(r.review_on) : <span className="muted">—</span>}</td>
                    {canEdit && <td><IconButton icon="x" label={`Stop covering ${name(r)}`} variant="ghost" size="sm" onClick={() => setRemoving(r)} /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={!!removing} busy={busy} title="Stop covering this record?"
        message={`${removing ? name(removing) : ''} will no longer be shown as relying on this control. Neither record is otherwise changed.`}
        confirmLabel="Remove coverage" onCancel={() => setRemoving(null)} onConfirm={remove}
      />
    </Card>
  );
}

function TestsTab({ control }: { control: Row }) {
  return (
    <ResourceList
      type="control_test"
      baseFilter={{ control_id: control.id }}
      columns={['ref', 'test_type', 'status', 'result', 'performed_on', 'tester_id', 'reviewer_id', { field: 'planned_on', hidden: true }]}
      filters={['test_type', 'status', 'result', 'performed_on']}
      createFields={['test_type', 'planned_on', 'period_start', 'period_end', 'tester_id', 'method', 'population']}
      createInitial={{ control_id: control.id }}
      defaultSort={{ field: 'created_at', dir: 'desc' }}
    />
  );
}

function Ratings({ row }: RecordContext) {
  const overdue = row.next_test_due && row.next_test_due < todayInZone() && row.status !== 'retired';
  return (
    <Card title="Ratings and testing">
      <div className="ctl-ratings">
        <div><span className="muted">Design</span>{row.design_rating ? <LookupChip list="control_test_result" value={row.design_rating} /> : <span className="muted">Not tested yet</span>}</div>
        <div><span className="muted">Operation</span>{row.operating_rating ? <LookupChip list="control_test_result" value={row.operating_rating} /> : <span className="muted">Not tested yet</span>}</div>
        <div><span className="muted">Last tested</span><span>{row.last_tested_on ? formatDate(row.last_tested_on) : '—'}</span></div>
        <div><span className="muted">Next test due</span><span>{row.next_test_due ? formatDate(row.next_test_due) : '—'}{overdue && <> <StateChip state="overdue" /></>}</span></div>
      </div>
      <p className="muted ctl-hint">Ratings come from the newest reviewed design and operating tests; the next test is due {row.test_every_months ? `${row.test_every_months} months` : 'a set time'} after the last one.</p>
    </Card>
  );
}

export function ControlDetail() {
  return (
    <RecordPage
      type="control"
      summary={(rec) => (
        <div className="ctl-summary">
          <EditableSummary type="control" row={rec.row} onSaved={rec.reload} title="Control"
            fields={['title', 'objective', 'description', 'control_type', 'automation', 'frequency', 'domain', 'owner_id', 'operator_id', 'key_control', 'status', 'test_every_months', 'next_test_due', 'notes']} />
          <Ratings {...rec} />
        </div>
      )}
      tabs={[
        { key: 'coverage', label: 'Coverage', content: ({ row }) => <CoverageTab control={row} /> },
        { key: 'tests', label: 'Tests', content: ({ row }) => <TestsTab control={row} /> },
      ]}
      evidence
    />
  );
}
