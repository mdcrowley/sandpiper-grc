// Evidence requests: the auditor's list across audits, one request, and the page where the person
// asked sees and answers their own requests (they need no audit permission and never see the audit),
// attaching the evidence files themselves (E41-09).
import { useRef, useState } from 'react';
import {
  api, ApiError, Badge, Button, Card, ConfirmDialog, EmptyState, errorMessage, ErrorState, formatDate, formatDateTime, Icon, Loading, PageHeader,
  RecordPage, ResourceList, TextArea, useFetch, useToast,
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

interface MineFile { id: string; file_name: string; size_bytes: number; description: string | null; uploaded_at: string; uploaded_by_name: string | null; mine: boolean; scan_status: string }

interface Mine {
  id: string; ref: string; request: string; due_on: string | null; status: string; status_label: string;
  response_note: string | null; provided_at: string | null; overdue: boolean; answerable: boolean; files: MineFile[];
}

const sizeText = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/** One file as the raw request body, with the same security header as every other change. */
async function sendFile(requestId: string, file: File): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/audit-requests/${requestId}/files?${new URLSearchParams({ name: file.name })}`, {
      method: 'PUT', body: file, credentials: 'same-origin',
      headers: { 'X-GRC-CSRF': '1', 'Content-Type': 'application/octet-stream', Accept: 'application/json' },
    });
  } catch {
    throw new ApiError(0, 'network', 'The file could not be sent. Check your connection and try again.');
  }
  if (res.ok) return;
  const body = await res.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
  throw new ApiError(res.status, body.error?.code ?? `http_${res.status}`, body.error?.message ?? `The file could not be sent (${res.status}).`);
}

/** The files on one of my requests: download, attach more, remove my own until the evidence is accepted. */
function RequestFiles({ r, canAttach, onChange }: { r: Mine; canAttach: boolean; onChange: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<MineFile | null>(null);
  const open = r.status !== 'accepted';
  const choose = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    try {
      for (const f of Array.from(list)) await sendFile(r.id, f);
      toast.success(list.length === 1 ? 'File attached.' : `${list.length} files attached.`);
      onChange();
    } catch (err) { toast.error(errorMessage(err)); onChange(); } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  const remove = async () => {
    if (!removing) return;
    try { await api.del(`/api/audit-requests/${r.id}/files/${removing.id}`); toast.success('File removed.'); setRemoving(null); onChange(); }
    catch (err) { toast.error(errorMessage(err)); }
  };
  if (!r.files.length && !(canAttach && open)) return null;
  return (
    <div className="stack">
      {r.files.length > 0 && (
        <ul className="rq-files" aria-label={`Files on ${r.ref}`}>
          {r.files.map((f) => (
            <li key={f.id}>
              <Icon name="paperclip" size={16} />
              <a href={`/api/audit-requests/${r.id}/files/${f.id}`} download>{f.file_name}</a>
              <span className="muted">{sizeText(f.size_bytes)} · {f.mine ? 'you' : f.uploaded_by_name ?? 'the auditor'} · {formatDate(f.uploaded_at)}</span>
              {f.mine && open && <Button size="sm" variant="ghost" icon="trash" onClick={() => setRemoving(f)} aria-label={`Remove ${f.file_name}`}>Remove</Button>}
            </li>
          ))}
        </ul>
      )}
      {canAttach && open && (
        <div className="rq-upload">
          <input ref={input} type="file" multiple hidden onChange={(e) => void choose(e.currentTarget.files)} aria-label={`Choose files for ${r.ref}`} />
          <Button icon="upload" loading={busy} onClick={() => input.current?.click()}>Attach files</Button>
          <span className="muted">The auditor sees them on the request as evidence.</span>
        </div>
      )}
      <ConfirmDialog open={Boolean(removing)} title="Remove this file?" danger confirmLabel="Remove"
        message={removing ? `${removing.file_name} will be removed from ${r.ref}.` : ''} onConfirm={() => void remove()} onCancel={() => setRemoving(null)} />
    </div>
  );
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
  const { data, error, reload } = useFetch<{ today: string; files_available: boolean; open: Mine[]; answered: Mine[] }>('/api/audit-requests/mine');
  const header = <PageHeader title="My evidence requests" subtitle="What auditors have asked you to provide. Attach the files, and say what you are providing." />;
  if (error) return <div className="stack">{header}<ErrorState error={error} onRetry={reload} /></div>;
  if (!data) return <div className="stack">{header}<Loading lines={4} label="Loading your evidence requests" /></div>;
  const card = (r: Mine) => (
    <Card key={r.id} title={r.ref} actions={<>{r.overdue && <Badge color="red">Overdue</Badge>} <Badge color={r.status === 'accepted' ? 'green' : r.status === 'returned' ? 'orange' : 'blue'}>{r.status_label}</Badge></>}>
      <div className="stack">
        <p className="prose">{r.request}</p>
        <p className="muted">{r.due_on ? `Due ${formatDate(r.due_on)}` : 'No due date'}{r.provided_at ? ` · Answered ${formatDateTime(r.provided_at)}` : ''}</p>
        {r.status === 'returned' && <p className="notice notice-warn">The auditor needs more. Add to your answer below.</p>}
        <RequestFiles r={r} canAttach={data.files_available} onChange={reload} />
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
