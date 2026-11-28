// Monitoring reports of the civil rights programs, with their due dates and submission log.
import { useState } from 'react';
import {
  api, Button, Card, DateField, EmptyState, ErrorState, errorMessage, formatDate, Loading, Modal, PageHeader, RecordPage, ResourceList, TableWrap,
  TextArea, TextField, todayInZone, useAuth, useFetch, useToast,
} from '../../core';
import type { Row } from '../../core';
import { REPORT_CREATE } from './Programs';
import { DueChip } from './shared';
import './civilrights.css';

export function ReportList() {
  return (
    <div className="stack">
      <PageHeader title="Civil rights reports" subtitle="Monitoring reports due under each program, and when each was sent." />
      <ResourceList type="civil_rights_report" urlState
        columns={[
          'ref', 'title', 'program_id', 'report_type', 'period_label',
          { field: 'due_on', label: 'Due', priority: 1, sortable: true, render: (r) => <DueChip date={r.due_on} done={['submitted', 'accepted'].includes(r.status)} /> },
          'status', 'submitted_on', 'owner_id',
        ]}
        filters={['status', 'report_type', 'program_id', 'owner_id', 'due_on']} createFields={REPORT_CREATE} />
    </div>
  );
}

interface Submission { id: string; submitted_on: string; submitted_by_name: string | null; recipient: string | null; reference: string | null; note: string | null }

function SubmitDialog({ report, onClose, onDone }: { report: Row; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ submitted_on: todayInZone(), recipient: String(report.recipient ?? ''), reference: '', note: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErrors({});
    try {
      const res = await api.post<{ next: { ref: string; due_on: string } | null }>(`/api/civil-rights/reports/${report.id}/submit`, form);
      toast.success(res.next ? `Submission recorded. The next report, ${res.next.ref}, is due on ${formatDate(res.next.due_on)}.` : 'Submission recorded.');
      onDone();
    } catch (err) { setErrors((err as { fields?: Record<string, string> }).fields ?? {}); toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  return (
    <Modal open title="Record a submission" onClose={onClose} dirty={Boolean(form.reference || form.note)}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Record</Button></>}>
      <div className="form-grid">
        <DateField label="Sent on" required value={form.submitted_on} error={errors.submitted_on} onChange={(v) => setForm((f) => ({ ...f, submitted_on: v }))} />
        <TextField label="Sent to" value={form.recipient} onChange={(v) => setForm((f) => ({ ...f, recipient: v }))} />
        <TextField label="Reference" value={form.reference} hint="A confirmation number or file reference, if there is one." onChange={(v) => setForm((f) => ({ ...f, reference: v }))} />
        <TextArea label="Note" value={form.note} onChange={(v) => setForm((f) => ({ ...f, note: v }))} />
      </div>
    </Modal>
  );
}

function SubmissionsTab({ report }: { report: Row }) {
  const { data, error, reload } = useFetch<Submission[]>(`/api/civil-rights/reports/${report.id}/submissions?v=${report.updated_at}`);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={3} />;
  return (
    <Card title="Submission log" flush>
      {data.length === 0 ? <EmptyState icon="file-text" title="Not sent yet" message="Record each time the report is sent, with who it went to." /> : (
        <TableWrap fit label="Submission log">
          <table className="table">
            <caption className="sr-only">Submission log</caption>
            <thead><tr><th scope="col" data-priority={1}>Sent on</th><th scope="col" data-priority={1}>Sent to</th><th scope="col" data-priority={2}>By</th><th scope="col" data-priority={2}>Reference</th><th scope="col" data-priority={3}>Note</th></tr></thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id}>
                  <td>{formatDate(s.submitted_on)}</td><td className="cr-wrap">{s.recipient ?? ''}</td><td>{s.submitted_by_name ?? ''}</td>
                  <td>{s.reference ?? ''}</td><td className="cr-wrap">{s.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}

export function ReportDetail() {
  const { can } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  return (
    <RecordPage
      type="civil_rights_report"
      actions={({ row, reload }) => (
        <>
          {can('civilrights.edit') && <Button variant="primary" icon="upload" onClick={() => setSubmitting(true)}>Record a submission</Button>}
          {submitting && <SubmitDialog report={row} onClose={() => setSubmitting(false)} onDone={() => { setSubmitting(false); reload(); }} />}
        </>
      )}
      summaryFields={['title', 'program_id', 'report_type', 'period_label', 'due_on', 'every_months', 'status', 'owner_id', 'submitted_on', 'recipient', 'notes']}
      tabs={[{ key: 'submissions', label: 'Submission log', content: ({ row }) => <SubmissionsTab report={row} /> }]}
    />
  );
}
