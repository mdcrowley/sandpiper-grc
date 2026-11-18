// Assets list and asset record with assignment history, check-out, check-in and disposal.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Badge, Button, Card, EditableSummary, EmptyState, ErrorState, formatDate, formatDateTime, Loading, RecordPage,
  ResourceList, StatusChip, useAuth, useFetch,
} from '../../core';
import type { Row } from '../../core';
import { CheckInDialog, CheckOutDialog, DisposeDialog } from './AssetDialogs';

export function AssetList() {
  const { can } = useAuth();
  return (
    <ResourceList
      type="asset"
      title="Assets"
      columns={[
        'tag', 'name', 'asset_type', 'status',
        { field: 'user_id', label: 'Assigned to', render: (row) => row._display?.user_id ?? row.assigned_to_name ?? '—' },
        'site_id', 'warranty_end', 'support_end',
        { field: 'funder_interest', label: 'Funder interest', sortable: true, render: (row) => (row.funder_interest ? <Badge color="amber">Funder{row.funder_interest_pct != null ? ` ${row.funder_interest_pct}%` : ''}</Badge> : '—') },
      ]}
      filters={['status', 'asset_type', 'site_id', 'system_id', 'user_id', 'funding_source', 'funder_interest', 'warranty_end', 'support_end', 'purchase_date']}
      createFields={['name', 'asset_type', 'status', 'make', 'model', 'serial', 'site_id', 'location', 'purchase_date', 'cost', 'funding_source', 'funder_interest', 'funder_interest_pct']}
      actions={(
        <>
          {can('assets.create') && <Link className="btn btn-secondary" to="/assets/import">Import</Link>}
          <Link className="btn btn-secondary" to="/inventory/reports">Reports</Link>
        </>
      )}
    />
  );
}

interface Assignment {
  id: string; assignee: string; department: string | null; location: string | null; site_name: string | null;
  due_back_on: string | null; notes: string | null; checked_out_at: string; checked_out_by_name: string | null;
  checked_in_at: string | null; checked_in_by_name: string | null; check_in_notes: string | null; open: boolean;
}

function AssignmentHistory({ assetId, version }: { assetId: string; version: number }) {
  const { data, error, reload } = useFetch<Assignment[]>(`/api/assets/${assetId}/assignments?v=${version}`);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={3} />;
  if (!data.length) {
    return <EmptyState icon="user" title="Never checked out" message="When this asset is checked out to someone, each assignment is kept here." />;
  }
  return (
    <div className="table-wrap inv-table-wrap">
      <table className="table">
        <caption className="sr-only">Assignment history, newest first</caption>
        <thead>
          <tr><th scope="col">Assigned to</th><th scope="col">Checked out</th><th scope="col">Due back</th><th scope="col">Checked in</th><th scope="col">Notes</th></tr>
        </thead>
        <tbody>
          {data.map((a) => (
            <tr key={a.id}>
              <td>
                <span className="row-title">{a.assignee}</span>
                {[a.department, a.site_name, a.location].filter(Boolean).length > 0 && (
                  <div className="muted">{[a.department, a.site_name, a.location].filter(Boolean).join(' · ')}</div>
                )}
              </td>
              <td>{formatDateTime(a.checked_out_at)}{a.checked_out_by_name && <div className="muted">by {a.checked_out_by_name}</div>}</td>
              <td>{a.due_back_on ? formatDate(a.due_back_on) : '—'}</td>
              <td>
                {a.open ? <StatusChip color="green" label="Out now" /> : formatDateTime(a.checked_in_at)}
                {!a.open && a.checked_in_by_name && <div className="muted">by {a.checked_in_by_name}</div>}
              </td>
              <td>{[a.notes, a.check_in_notes].filter(Boolean).join(' / ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SUMMARY = ['name', 'tag', 'asset_type', 'status', 'make', 'model', 'serial', 'owner_id', 'department', 'site_id', 'location', 'system_id'];
const PURCHASE = ['purchase_date', 'cost', 'funding_source', 'funder_interest', 'funder_interest_pct', 'warranty_end', 'support_end', 'vendor_id', 'contract_id'];
const TECHNICAL = ['os', 'os_version', 'ip_address', 'mac_address', 'notes'];
const DISPOSAL = ['disposal_approved_by', 'disposal_approved_on', 'disposal_approval_ref', 'disposal_method', 'disposed_on'];

function AssetActions({ row, canEdit, onChanged }: { row: Row; canEdit: boolean; onChanged: () => void }) {
  const [dialog, setDialog] = useState<'out' | 'in' | 'dispose' | null>(null);
  if (!canEdit) return null;
  const assigned = !!(row.user_id || row.assigned_to_name);
  const gone = row.status === 'disposed';
  const close = (changed: boolean) => { setDialog(null); if (changed) onChanged(); };
  return (
    <>
      {!gone && !assigned && row.status !== 'retired' && <Button variant="primary" onClick={() => setDialog('out')}>Check out</Button>}
      {!gone && assigned && <Button variant="primary" onClick={() => setDialog('in')}>Check in</Button>}
      {!gone && <Button icon="trash" onClick={() => setDialog('dispose')}>Dispose</Button>}
      {dialog === 'out' && <CheckOutDialog asset={row} onClose={close} />}
      {dialog === 'in' && <CheckInDialog asset={row} onClose={close} />}
      {dialog === 'dispose' && <DisposeDialog asset={row} onClose={close} />}
    </>
  );
}

function AssetBanner({ row }: { row: Row }) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const notes: { tone: string; title: string; text: string }[] = [];
  if (row.status === 'disposed') {
    notes.push({
      tone: '', title: `Disposed${row.disposed_on ? ` on ${formatDate(row.disposed_on)}` : ''}`,
      text: `Approved by ${row.disposal_approved_by ?? 'unknown'}${row.disposal_approved_on ? ` on ${formatDate(row.disposal_approved_on)}` : ''}`
        + (row.disposal_approval_ref ? `, approval reference ${row.disposal_approval_ref}.` : '.'),
    });
  } else if (row.funder_interest) {
    notes.push({
      tone: 'inv-callout-warn', title: `Funder interest${row.funder_interest_pct != null ? `: ${row.funder_interest_pct}%` : ''}`,
      text: 'This asset cannot be disposed of until the disposal approval reference is entered.',
    });
  }
  if (row.status !== 'disposed' && row.status !== 'retired' && row.support_end && row.support_end < todayIso) {
    notes.push({ tone: 'inv-callout-warn', title: 'Past support', text: `Support ended on ${formatDate(row.support_end)}.` });
  }
  if (!notes.length) return null;
  return (
    <div className="stack">
      {notes.map((n) => (
        <div key={n.title} className={`inv-callout ${n.tone}`}><strong>{n.title}</strong><span>{n.text}</span></div>
      ))}
    </div>
  );
}

export function AssetDetail() {
  // Bumped after a lifecycle action so the assignment history reloads with the record.
  const [version, setVersion] = useState(0);
  return (
    <RecordPage
      type="asset"
      subtitle={(row) => [row.make, row.model, row.serial && `Serial ${row.serial}`].filter(Boolean).join(' · ') || undefined}
      actions={({ row, reload, canEdit }) => (
        <AssetActions row={row} canEdit={canEdit} onChanged={() => { setVersion((v) => v + 1); reload(); }} />
      )}
      banner={({ row }) => <AssetBanner row={row} />}
      summaryFields={SUMMARY}
      tabs={[
        {
          key: 'assignment', label: 'Assignment',
          content: ({ row }) => (
            <div className="stack">
              <Card title="Current assignment">
                {row.user_id || row.assigned_to_name ? (
                  <p>
                    With <strong>{row._display?.user_id ?? row.assigned_to_name}</strong>
                    {row.department ? `, ${row.department}` : ''}{row._display?.site_id ? `, at ${row._display.site_id}` : ''}.
                  </p>
                ) : (
                  <p className="muted">{row.status === 'disposed' ? 'Disposed; no longer assigned.' : 'Not assigned to anyone.'}</p>
                )}
              </Card>
              <Card title="Assignment history" flush>
                <AssignmentHistory assetId={row.id} version={version} />
              </Card>
            </div>
          ),
        },
        {
          key: 'details', label: 'Purchase and technical',
          content: ({ row, reload }) => (
            <div className="stack">
              <EditableSummary type="asset" row={row} fields={PURCHASE} title="Purchase, funding and support" onSaved={reload} />
              <EditableSummary type="asset" row={row} fields={TECHNICAL} title="Technical" onSaved={reload} />
            </div>
          ),
        },
        {
          key: 'disposal', label: 'Disposal',
          content: ({ row, reload }) => (
            <div className="stack">
              <div className={`inv-callout ${row.funder_interest && row.status !== 'disposed' ? 'inv-callout-warn' : ''}`}>
                <strong>How disposal works</strong>
                <span>
                  Use the Dispose button to record who approved the disposal and when. Equipment in which an outside funder (such as a grant body) keeps an interest is
                  blocked until the disposal approval reference is entered.
                  {row.funder_interest ? ' A funder interest is recorded for this asset.' : ' No funder interest is recorded for this asset.'}
                </span>
              </div>
              <EditableSummary type="asset" row={row} fields={DISPOSAL} title="Disposal approval" onSaved={reload} editable={row.status !== 'disposed' ? undefined : false} />
            </div>
          ),
        },
      ]}
    />
  );
}
