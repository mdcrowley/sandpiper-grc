// Evidence requests: the auditor's list across audits, one request, and the page where the person
// asked sees and answers their own requests (they need no audit permission and never see the audit).
import { useState } from 'react';
import {
  api, Badge, Button, Card, EmptyState, errorMessage, ErrorState, formatDate, formatDateTime, Loading, PageHeader, RecordPage, ResourceList,
  TextArea, useFetch, useToast,
} from '../../core';
import type { RecordContext } from '../../core';
import { AuditTabs } from './shared';

export function RequestList() {
  return (
    <div className="stack">
      <PageHeader title="Evidence requests" subtitle="What auditors have asked auditees for, across every audit: due, provided, accepted or returned for more." />
      <AuditTabs active="requests" />
      <ResourceList
        type="audit_request"
        urlState
        columns={['ref', 'request', 'audit_id', 'owner_id', 'due_on', 'status', 'provided_at']}
        filters={['status', 'owner_id', 'audit_id', 'due_on']}
      />
    </div>
  );
}

function Decide({ row, save, canEdit, reload }: RecordContext) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!canEdit || row.status !== 'provided') return null;
  const set = async (status: string, done: string) => {
    setBusy(true);
    try { await save({ status }); toast.success(done); reload(); } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <>
      <Button variant="primary" loading={busy} onClick={() => set('accepted', 'Evidence accepted.')}>Accept</Button>
      <Button loading={busy} onClick={() => set('returned', 'Returned to the auditee for more.')}>Return for more</Button>
    </>
  );
}

export function RequestDetail() {
  return (
    <RecordPage
      type="audit_request"
      title={(row) => row.ref ?? 'Evidence request'}
      actions={(rec) => <Decide {...rec} />}
      summaryFields={['audit_id', 'request', 'owner_id', 'due_on', 'status', 'response_note', 'provided_at']}
    />
  );
}

interface Mine {
  id: string; ref: string; request: string; due_on: string | null; status: string; status_label: string;
  response_note: string | null; provided_at: string | null; overdue: boolean; answerable: boolean;
}

function Answer({ r, onDone }: { r: Mine; onDone: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState(r.response_note ?? '');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try { await api.post(`/api/audit-requests/${r.id}/respond`, { response_note: note }); toast.success('Answer sent to the auditor.'); onDone(); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <TextArea label="What you are providing, and where the auditor can find it" value={note} onChange={setNote} rows={3} required />
      <div className="form-actions"><Button type="submit" variant="primary" loading={busy} disabled={!note.trim()}>{r.status === 'provided' ? 'Update my answer' : 'Send my answer'}</Button></div>
    </form>
  );
}

export function MyRequests() {
  const { data, error, reload } = useFetch<{ today: string; open: Mine[]; answered: Mine[] }>('/api/audit-requests/mine');
  const header = <PageHeader title="My evidence requests" subtitle="What auditors have asked you to provide. Say what you are providing and where they can find it." />;
  if (error) return <div className="stack">{header}<ErrorState error={error} onRetry={reload} /></div>;
  if (!data) return <div className="stack">{header}<Loading lines={4} label="Loading your evidence requests" /></div>;
  const card = (r: Mine) => (
    <Card key={r.id} title={r.ref} actions={<>{r.overdue && <Badge color="red">Overdue</Badge>} <Badge color={r.status === 'accepted' ? 'green' : r.status === 'returned' ? 'orange' : 'blue'}>{r.status_label}</Badge></>}>
      <div className="stack">
        <p className="prose">{r.request}</p>
        <p className="muted">{r.due_on ? `Due ${formatDate(r.due_on)}` : 'No due date'}{r.provided_at ? ` · Answered ${formatDateTime(r.provided_at)}` : ''}</p>
        {r.status === 'returned' && <p className="notice notice-warn">The auditor needs more. Add to your answer below.</p>}
        {r.answerable ? <Answer r={r} onDone={reload} /> : r.response_note ? <p className="prose">{r.response_note}</p> : null}
      </div>
    </Card>
  );
  return (
    <div className="stack">
      {header}
      {data.open.length === 0 && data.answered.length === 0 ? (
        <EmptyState icon="check-circle" title="No evidence requests" message="Nobody has asked you for audit evidence." />
      ) : (
        <>
          <h2 className="au-h2">Waiting for you ({data.open.length})</h2>
          {data.open.length ? data.open.map(card) : <p className="muted">Nothing waiting for you.</p>}
          {data.answered.length > 0 && <h2 className="au-h2">Answered</h2>}
          {data.answered.map(card)}
        </>
      )}
    </div>
  );
}
