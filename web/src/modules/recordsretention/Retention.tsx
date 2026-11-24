// The retention schedule (record series) and the destruction log (E41-15). A destruction is proposed
// for a batch of records of one series, submitted for approval once its records are past their period
// (the Records destruction approval workflow, or someone who may approve records work), recorded as
// carried out with its certificate, and kept in the log. A legal hold on the series stops it.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Button, Card, DateField, DefinitionList, ErrorState, errorMessage, formatDate, formatDateTime, Loading, Modal, Notice, PageHeader,
  RecordPage, ResourceList, Select, TextArea, TextField, useAuth, useFetch, useLookup, UserPicker, useToast,
} from '../../core';
import type { Row } from '../../core';
import './retention.css';

const SERIES_CREATE = [
  'title', 'code', 'description', 'category', 'medium', 'owner_id', 'department_id', 'location', 'system_id',
  'retention_value', 'retention_unit', 'permanent', 'trigger_event', 'trigger_note', 'disposition', 'authority', 'vital', 'personal_data', 'review_on',
];
const DESTRUCTION_CREATE = ['title', 'series_id', 'description', 'records_from', 'records_to', 'trigger_date', 'quantity', 'location', 'method', 'medium'];
const DESTRUCTION_COLUMNS = ['ref', 'title', 'series_id', 'status', 'eligible_on', 'quantity', 'method', 'carried_out_on'];

export function SeriesList() {
  return (
    <div className="stack">
      <PageHeader title="Retention schedule" subtitle="The organization's record series, paper and electronic: how long each is kept, counted from which event, and what happens at the end." />
      <ResourceList
        type="record_series"
        urlState
        columns={['ref', 'code', 'title', 'medium', 'retention_value', 'retention_unit', 'permanent', 'trigger_event', 'disposition', 'status', 'owner_id', 'review_on']}
        filters={['status', 'medium', 'category', 'trigger_event', 'disposition', 'owner_id', 'department_id', 'vital', 'personal_data']}
        createFields={SERIES_CREATE}
      />
    </div>
  );
}

export function SeriesDetail() {
  return (
    <RecordPage
      type="record_series"
      summaryFields={[
        'code', 'title', 'description', 'category', 'medium', 'status', 'owner_id', 'department_id', 'location', 'system_id',
        'retention_value', 'retention_unit', 'permanent', 'trigger_event', 'trigger_note', 'disposition', 'authority', 'vital', 'personal_data', 'review_on', 'notes',
      ]}
      tabs={[{
        key: 'destructions', label: 'Destructions',
        content: ({ row }) => (
          <ResourceList type="records_destruction" baseFilter={{ series_id: row.id }} urlState={false}
            columns={DESTRUCTION_COLUMNS.filter((c) => c !== 'series_id')}
            createFields={DESTRUCTION_CREATE.filter((c) => c !== 'series_id')} createInitial={{ series_id: row.id }} />
        ),
      }]}
    />
  );
}

export function DestructionList() {
  return (
    <div className="stack">
      <PageHeader title="Destruction log" subtitle="Each batch of records destroyed or transferred at the end of its retention period: approved first, then recorded with its certificate." />
      <ResourceList
        type="records_destruction"
        urlState
        columns={DESTRUCTION_COLUMNS}
        filters={['status', 'series_id', 'method', 'eligible_on', 'carried_out_on']}
        createFields={DESTRUCTION_CREATE}
        bulkFields={[]}
      />
    </div>
  );
}

interface DestructionState {
  status: string; today: string; eligible_on: string | null; eligible: boolean; period: string | null;
  held: boolean; holds: { id: string; ref: string }[]; workflow_available: boolean; can_approve: boolean;
  request: { id: string; workflow: string; status: string; started_at: string; finished_at: string | null } | null;
}

function Progress({ row, onChanged }: { row: Row; onChanged: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<DestructionState>(`/api/records-destructions/${row.id}/state`);
  const [dialog, setDialog] = useState<'submit' | 'done' | 'cancel' | null>(null);
  const changed = () => { setDialog(null); reload(); onChanged(); };
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={3} />;
  const mayEdit = can('records.edit');
  const submit = async () => {
    try {
      const res = await api.post<{ status: string }>(`/api/records-destructions/${row.id}/submit`, {});
      toast.success(res.status === 'approved' ? 'Approved: it can now be carried out.' : 'Submitted: it waits for approval.');
      changed();
    } catch (err) { toast.error(errorMessage(err)); }
  };
  const open = data.status === 'proposed' || data.status === 'rejected';
  return (
    <Card title="Progress">
      <div className="stack">
        {data.held && (
          <Notice tone="warning" title="Under a legal hold">
            The record series or this destruction is under a legal hold{data.holds.length ? ` (${data.holds.map((h) => h.ref).join(', ')})` : ''}: it cannot be submitted, approved or carried out until the hold is released.
          </Notice>
        )}
        <DefinitionList items={[
          { label: 'Retention period', value: data.period ?? '—' },
          { label: 'May be destroyed from', value: data.eligible_on ? `${formatDate(data.eligible_on)}${data.eligible ? '' : ' (not yet)'}` : 'Give the trigger date or the last date the records cover' },
          ...(data.request ? [{ label: 'Approval', value: `${data.request.workflow}: ${data.request.status === 'running' ? 'waiting since' : data.request.status}${data.request.status === 'running' ? ` ${formatDateTime(data.request.started_at)}` : ''}` }] : []),
        ]} />
        {data.status === 'rejected' && row.decision_note && <Notice tone="warning" title="Rejected">{row.decision_note}</Notice>}
        {data.status === 'done' && <Notice tone="success" title="Carried out">On {formatDate(row.carried_out_on)} by {row.carried_out_by}{row.certificate_ref ? `, certificate ${row.certificate_ref}` : ''}. Attach the certificate under Evidence files.</Notice>}
        {data.status === 'canceled' && <Notice tone="neutral" title="Canceled">{row.decision_note}</Notice>}
        {!data.workflow_available && open && <p className="muted">No Records destruction workflow is set up, so someone who may approve records work approves it when it is submitted.</p>}
        {mayEdit && (
          <div className="rtn-actions">
            {open && <Button variant="primary" disabled={!data.eligible || data.held} onClick={() => setDialog('submit')}>Submit for approval</Button>}
            {data.status === 'approved' && <Button variant="primary" disabled={data.held} onClick={() => setDialog('done')}>Record as carried out…</Button>}
            {data.status !== 'done' && data.status !== 'canceled' && <Button onClick={() => setDialog('cancel')}>Cancel the destruction…</Button>}
          </div>
        )}
      </div>
      {dialog === 'submit' && (
        <Modal open title="Submit for approval" onClose={() => setDialog(null)}
          footer={<><Button onClick={() => setDialog(null)}>Back</Button><Button variant="primary" onClick={() => void submit()}>Submit</Button></>}>
          <p>Once submitted, the details of this destruction are fixed. {data.workflow_available ? 'The Records destruction workflow asks its approvers.' : 'With no workflow set up, it is approved at once if you may approve records work.'}</p>
        </Modal>
      )}
      {dialog === 'done' && <CarriedOutDialog row={row} onClose={() => setDialog(null)} onSaved={changed} />}
      {dialog === 'cancel' && <CancelDialog row={row} onClose={() => setDialog(null)} onSaved={changed} />}
    </Card>
  );
}

function CarriedOutDialog({ row, onClose, onSaved }: { row: Row; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const methods = useLookup('destruction_method');
  const [on, setOn] = useState('');
  const [by, setBy] = useState('');
  const [method, setMethod] = useState<string>(row.method ?? '');
  const [witness, setWitness] = useState<string | null>(null);
  const [certificate, setCertificate] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/api/records-destructions/${row.id}/carried-out`, { carried_out_on: on, carried_out_by: by, method, witness_id: witness, certificate_ref: certificate });
      toast.success('Recorded as carried out.');
      onSaved();
    } catch (err) {
      setErrors((err as { fields?: Record<string, string> }).fields ?? {});
      toast.error(errorMessage(err));
    } finally { setBusy(false); }
  };
  return (
    <Modal open title="Record as carried out" onClose={onClose} dirty={Boolean(on || by || certificate)}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Record</Button></>}>
      <div className="form-grid">
        <DateField label="Carried out on" required value={on} onChange={setOn} error={errors.carried_out_on} />
        <TextField label="Carried out by" required value={by} onChange={setBy} error={errors.carried_out_by} hint="A person, or the destruction service." />
        <Select label="Method" required value={method} onChange={setMethod} error={errors.method} options={methods.map((m) => ({ value: m.value, label: m.label }))} />
        <UserPicker label="Witness" value={witness} onChange={(v) => setWitness(v)} error={errors.witness_id} />
        <TextField label="Certificate" value={certificate} onChange={setCertificate} hint="The reference of the certificate of destruction. Attach the certificate itself under Evidence files." />
      </div>
    </Modal>
  );
}

function CancelDialog({ row, onClose, onSaved }: { row: Row; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/api/records-destructions/${row.id}/cancel`, { reason });
      toast.success('Canceled. It stays in the log.');
      onSaved();
    } catch (err) {
      setError((err as { fields?: Record<string, string> }).fields?.reason ?? '');
      toast.error(errorMessage(err));
    } finally { setBusy(false); }
  };
  return (
    <Modal open title="Cancel the destruction" onClose={onClose} dirty={Boolean(reason)}
      footer={<><Button onClick={onClose}>Back</Button><Button variant="danger" loading={busy} onClick={() => void save()}>Cancel the destruction</Button></>}>
      <TextArea label="Why will it not go ahead?" required value={reason} onChange={setReason} error={error} />
    </Modal>
  );
}

export function DestructionDetail() {
  return (
    <RecordPage
      type="records_destruction"
      banner={({ row, reload }) => <Progress row={row} onChanged={reload} />}
      summaryFields={[
        'title', 'series_id', 'description', 'medium', 'records_from', 'records_to', 'trigger_date', 'eligible_on', 'quantity', 'location', 'method',
        'requested_by', 'approved_on', 'approved_by_name', 'carried_out_on', 'carried_out_by', 'witness_id', 'certificate_ref', 'notes',
      ]}
      subtitle={(row) => (row.series_id ? <>Series <Link to={`/retention-schedule/${row.series_id}`}>{row._display?.series_id ?? 'record series'}</Link></> : null)}
    />
  );
}
