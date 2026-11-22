// Sub-recipients and their monitoring (E35-07, E27-11: /funding/subrecipients and /:id): the
// organizations that receive part of an award, monitored on a cadence, with findings that may raise a
// corrective action plan.
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  api, ApiError, Button, Card, DateField, EmptyState, ErrorState, errorMessage, formatDate, Loading, Modal, PageHeader,
  RecordPage, ResourceList, Select, StatusChip, TableWrap, TextArea, todayInZone, useFetch, useResource, useToast, useUnsavedChanges,
} from '../../core';
import type { ColorName, Row } from '../../core';
import { capsInBuild, FundingTabs } from './shared';

interface Monitoring {
  id: string;
  monitored_on: string;
  method: string;
  method_label: string;
  result: string;
  result_label: string;
  result_color: ColorName;
  findings: string | null;
  cap_id: string | null;
  cap_ref: string | null;
  by_name: string | null;
}

interface History {
  rows: Monitoring[];
  next_monitoring_due: string | null;
  last_monitored_on: string | null;
  can_record: boolean;
  can_raise_cap: boolean;
}

export function SubrecipientList() {
  return (
    <div className="stack">
      <PageHeader title="Sub-recipients" subtitle="Organizations that receive part of an award to carry out its work, and when each is next monitored." />
      <FundingTabs active="subrecipients" />
      <ResourceList
        type="subrecipient"
        urlState
        columns={['ref', 'name', 'award_id', 'amount', 'risk_level', 'monitoring_frequency', 'last_monitored_on', 'next_monitoring_due', 'status', { field: 'owner_id', hidden: true }]}
        filters={['status', 'award_id', 'risk_level', 'monitoring_frequency', 'next_monitoring_due', 'owner_id']}
        bulkFields={['status', 'risk_level', 'owner_id']}
        createFields={['name', 'award_id', 'vendor_id', 'amount', 'risk_level', 'monitoring_frequency', 'owner_id', 'notes']}
      />
    </div>
  );
}

const METHODS = [{ value: 'desk_review', label: 'Desk review' }, { value: 'site_visit', label: 'Site visit' }, { value: 'report_review', label: 'Report review' }];
const RESULTS = [{ value: 'satisfactory', label: 'Satisfactory', color: 'green' }, { value: 'findings', label: 'Findings', color: 'amber' }, { value: 'unsatisfactory', label: 'Unsatisfactory', color: 'red' }];

function RecordMonitoring({ subId, onDone, onCancel }: { subId: string; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const blank = { monitored_on: todayInZone(), method: '', result: '', findings: '' };
  const [v, setV] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(v) !== JSON.stringify(blank);
  const unsaved = useUnsavedChanges(dirty);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!v.method) found.method = 'Choose how it was monitored.';
    if (!v.result) found.result = 'Choose the result.';
    if (v.result && v.result !== 'satisfactory' && !v.findings.trim()) found.findings = 'Describe what was found.';
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      await api.post(`/api/subrecipients/${subId}/monitoring`, v);
      unsaved.release();
      toast.success('Monitoring recorded.');
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally { setSaving(false); }
  }
  return (
    <Modal open title="Record monitoring" onClose={onCancel} dirty={dirty}>
      <form className="form" onSubmit={submit} noValidate>
        <div className="form-grid">
          <DateField label="Monitored on" required value={v.monitored_on} max={todayInZone()} error={errors.monitored_on} onChange={(monitored_on) => setV({ ...v, monitored_on })} />
          <Select label="Method" required value={v.method} options={METHODS} error={errors.method} onChange={(method) => setV({ ...v, method })} />
          <Select label="Result" required value={v.result} options={RESULTS} error={errors.result} onChange={(result) => setV({ ...v, result })} />
        </div>
        <TextArea label="Findings" required={v.result !== '' && v.result !== 'satisfactory'} rows={4} value={v.findings} error={errors.findings} onChange={(findings) => setV({ ...v, findings })} />
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={unsaved.guard(onCancel)}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>Record</Button>
        </div>
      </form>
    </Modal>
  );
}

function MonitoringTab({ row, reload: reloadRecord }: { row: Row; reload: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { data, error, reload } = useFetch<History>(`/api/subrecipients/${row.id}/monitoring`);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={4} label="Loading the monitoring history" />;
  const raise = async (m: Monitoring) => {
    setBusy(m.id);
    try {
      const res = await api.post<{ cap: { route: string | null } }>(`/api/subrecipients/${row.id}/monitoring/${m.id}/cap`);
      toast.success('Corrective action plan raised. Add its actions there.');
      if (res.cap.route) navigate(res.cap.route); else reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(null); }
  };
  const add = data.can_record ? <Button size="sm" icon="plus" onClick={() => setAdding(true)}>Record monitoring</Button> : undefined;
  const due = data.next_monitoring_due;
  return (
    <Card title="Monitoring" actions={data.rows.length ? add : undefined} flush={data.rows.length > 0}>
      <p className="fund-sub-due">
        <span>Next monitoring due</span>{' '}
        {due ? <StatusChip color={due < todayInZone() ? 'red' : 'green'} label={formatDate(due)} /> : <StatusChip color="gray" label="Not scheduled" />}
      </p>
      {data.rows.length === 0 ? (
        <EmptyState icon="clipboard" title="Not monitored yet" message="Record each desk review, site visit or report review with its result." action={add} />
      ) : (
        <TableWrap label="Monitoring history, newest first">
          <table className="table">
            <caption className="sr-only">Monitoring history, newest first</caption>
            <thead><tr><th scope="col">Date</th><th scope="col">Method</th><th scope="col">Result</th><th scope="col">Findings</th><th scope="col">By</th><th scope="col">Corrective action plan</th></tr></thead>
            <tbody>
              {data.rows.map((m) => (
                <tr key={m.id}>
                  <td>{formatDate(m.monitored_on)}</td>
                  <td>{m.method_label}</td>
                  <td><StatusChip color={m.result_color} label={m.result_label} /></td>
                  <td className="fund-wrap">{m.findings || <span className="muted">—</span>}</td>
                  <td>{m.by_name || <span className="muted">—</span>}</td>
                  <td>
                    {m.cap_id
                      ? <Link to={`/caps/${m.cap_id}`}>{m.cap_ref ?? 'Open the plan'}</Link>
                      : m.result !== 'satisfactory' && data.can_raise_cap && capsInBuild
                        ? <Button size="sm" variant="secondary" loading={busy === m.id} onClick={() => raise(m)}>Raise a plan</Button>
                        : <span className="muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {adding && <RecordMonitoring subId={row.id} onCancel={() => setAdding(false)} onDone={() => { setAdding(false); reload(); reloadRecord(); }} />}
    </Card>
  );
}

export function SubrecipientDetail() {
  const vendor = useResource('vendor');
  return (
    <RecordPage
      type="subrecipient"
      breadcrumbs={[{ label: 'Funding', to: '/funding' }, { label: 'Sub-recipients', to: '/funding/subrecipients' }]}
      subtitle={(row) => (row.award_id ? <>Award: <Link to={`/funding/awards/${row.award_id}`}>{row._display?.award_id ?? 'Open award'}</Link></> : null)}
      summaryFields={['name', 'award_id', ...(vendor ? ['vendor_id'] : []), 'amount', 'risk_level', 'monitoring_frequency', 'last_monitored_on', 'next_monitoring_due', 'status', 'owner_id', 'notes']}
      tabs={[{ key: 'monitoring', label: 'Monitoring', content: ({ row, reload }) => <MonitoringTab row={row} reload={reload} /> }]}
    />
  );
}
