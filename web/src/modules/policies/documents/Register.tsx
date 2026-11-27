// The document register (E43-12): every document the person may see, whatever its state, for the
// people who keep documents. The tiles are figures from /api/documents/summary, the same for every
// viewer (restricted documents are counted, never named); the list below shows only rows the viewer
// may read. The external documents view is the same register limited to documents of outside origin.
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Button, Card, EmptyState, ErrorState, formatDate, Loading, PageHeader, ResourceList, Stat, StatusChip, TableWrap, useAuth, useFetch,
} from '../../../core';
import type { Row } from '../../../core';
import { ReviewChip } from '../shared';
import { ensureStarterViews } from '../views';
import { DocumentsTabs } from './DocumentsTabs';
import { NewDocumentDialog } from './NewDocument';
import { docNumber, recordPath, type ApprovalRow, type DocSummary } from './types';

/** The New document dialog, also opened by `?new=1` (the Create menu); the list keeps the rest of the address. */
function useNewDialog() {
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(() => params.get('new') === '1');
  useEffect(() => {
    if (params.get('new') !== '1') return;
    setOpen(true);
    const next = new URLSearchParams(params);
    next.delete('new');
    setParams(next, { replace: true });
  }, [params, setParams]);
  return [open, setOpen] as const;
}

const accessColumn = {
  field: 'access', label: 'Readers', sortable: true, priority: 2 as const,
  render: (row: Row) => (row.access === 'restricted' ? <StatusChip color="amber" label="Restricted" /> : <span className="muted">Everyone</span>),
};

export function Register() {
  const { can } = useAuth();
  const [creating, setCreating] = useNewDialog();
  const summary = useFetch<DocSummary>('/api/documents/summary');
  useMemo(() => ensureStarterViews('policy', [
    { name: 'Effective', filters: { status: 'published' } },
    { name: 'Being written or approved', filters: { status: 'draft,in_review,approved' } },
    { name: 'Owned by me', filters: { owner_id: 'me' }, labels: { owner_id: 'Me' } },
    { name: 'Restricted distribution', filters: { access: 'restricted' } },
    { name: 'Obsolete', filters: { status: 'retired' } },
  ], '2'), []);
  const s = summary.data;
  const n = (v: number | undefined) => (v === undefined ? '–' : v);

  return (
    <div className="stack">
      <PageHeader
        title="Document register"
        subtitle="Every controlled document with its number, owner, version in force and next review. The figures count every document, including ones you cannot open."
        actions={can('policies.create') ? <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New document</Button> : undefined}
      />
      <DocumentsTabs active="register" />
      {summary.error ? <ErrorState error={summary.error} onRetry={summary.reload} /> : (
        <div className="grid-stats">
          <Stat label="Effective" icon="check-circle" value={n(s?.effective)} color="green" to="/documents/register?f.status=published" />
          <Stat label="In review" icon="edit" value={n(s?.in_review)} color={s?.in_review ? 'amber' : undefined} to="/documents/register?f.status=in_review,approved" />
          <Stat label="Review overdue" icon="clock" value={n(s?.review_overdue)} color={s?.review_overdue ? 'red' : undefined} to="/documents/reviews?state=overdue" />
          <Stat label="Review due in 90 days" icon="calendar" value={n(s?.review_due_90)} color={s?.review_due_90 ? 'amber' : undefined} to="/documents/reviews?state=due" />
          <Stat label="Obsolete" icon="history" value={n(s?.obsolete)} to="/documents/register?f.status=retired" />
          <Stat label="Without owner" icon="user" value={n(s?.without_owner)} color={s?.without_owner ? 'red' : undefined} to="/documents/register?f.owner_id.null=1" />
        </div>
      )}
      <ResourceList
        type="policy"
        urlState
        columns={[
          { field: 'doc_number', label: 'Number', sortable: true, priority: 1, render: (row) => docNumber(row) || <span className="muted">—</span> },
          'title',
          { field: 'document_type', priority: 2 },
          { field: 'owning_department_id', priority: 3 },
          { field: 'owner_id', priority: 3 },
          { field: 'current_version', label: 'Version', sortable: true, priority: 2, render: (row) => (row.current_version ? String(row.current_version) : <span className="muted">None</span>) },
          { field: 'review_date', label: 'Next review', sortable: true, priority: 2, render: (row) => <ReviewChip date={row.review_date} status={row.status} /> },
          'status',
          accessColumn,
          { field: 'ref', hidden: true },
          { field: 'category', hidden: true },
          { field: 'approver_name', hidden: true },
          { field: 'parent_id', hidden: true },
          { field: 'updated_at', hidden: true },
        ]}
        filters={['document_type', 'status', 'owning_department_id', 'owner_id', 'access', 'category', 'review_date']}
        bulkFields={['document_type', 'category', 'owner_id', 'owning_department_id', 'review_date']}
      />
      {creating && <NewDocumentDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

/** Documents of outside origin: standards, regulations, guidance, manuals, with publisher and edition. */
export function ExternalDocuments() {
  const { can } = useAuth();
  const [creating, setCreating] = useNewDialog();
  return (
    <div className="stack">
      <PageHeader
        title="External documents"
        subtitle="Standards, regulations, guidance and manuals from outside the organization: which edition is in use, and where it came from."
        actions={can('policies.create') ? <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New external document</Button> : undefined}
      />
      <DocumentsTabs active="external" />
      <ResourceList
        type="policy"
        baseFilter={{ document_type: 'external' }}
        columns={[
          { field: 'doc_number', label: 'Number', sortable: true, priority: 1, render: (row) => docNumber(row) || <span className="muted">—</span> },
          'title',
          { field: 'publisher', priority: 2 },
          { field: 'edition', priority: 2 },
          { field: 'published_on', priority: 3 },
          { field: 'owner_id', priority: 3 },
          { field: 'review_date', label: 'Next check', sortable: true, priority: 2, render: (row) => <ReviewChip date={row.review_date} status={row.status} /> },
          'status',
          { field: 'source_url', hidden: true },
          { field: 'license_note', hidden: true },
        ]}
        filters={['status', 'owner_id', 'owning_department_id']}
      />
      {creating && <NewDocumentDialog initialType="external" onClose={() => setCreating(false)} />}
    </div>
  );
}

/** Versions waiting for the signed-in approver (policies.approve): their own are shown but cannot be approved by them. */
export function Approvals() {
  const { data, error, reload } = useFetch<ApprovalRow[]>('/api/documents/approvals');
  let body;
  if (error) body = <ErrorState error={error} onRetry={reload} />;
  else if (!data) body = <Loading lines={5} label="Loading versions waiting for approval" />;
  else if (!data.length) body = <EmptyState icon="check-square" title="Nothing is waiting" message="Versions sent for review, and approved versions not yet published, appear here." />;
  else {
    body = (
      <TableWrap label="Versions waiting for approval or publication" fit>
        <table className="table">
          <caption className="sr-only">Versions waiting for approval or publication</caption>
          <thead><tr>
            <th scope="col" data-priority="1">Document</th><th scope="col" data-priority="1">Version</th><th scope="col" data-priority="1">Waiting for</th>
            <th scope="col" data-priority="2">Written by</th><th scope="col" data-priority="3">Last changed</th>
          </tr></thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.version_id}>
                <td><Link to={recordPath(r.policy_id)}>{docNumber(r) ? `${docNumber(r)} ` : ''}{r.title}</Link></td>
                <td>{r.version_label ? `${r.version_label} (${r.version})` : r.version}</td>
                <td>
                  {r.status === 'in_review' ? <StatusChip color="amber" label="Approval" /> : <StatusChip color="blue" label="Publication" />}
                  {r.own && <span className="muted doc-small"> Your own version: someone else approves it</span>}
                </td>
                <td>{r.author_name ?? '—'}</td>
                <td>{formatDate(r.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    );
  }
  return (
    <div className="stack">
      <PageHeader title="Waiting for approval" subtitle="Document versions sent for review, and approved versions waiting to be published." />
      <DocumentsTabs active="approvals" />
      <Card flush>{body}</Card>
    </div>
  );
}
