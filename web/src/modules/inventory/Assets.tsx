// Assets list, the asset record, and the disposal approvals queue.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SegmentedControl, Text } from '@mantine/core';
import {
  api, Badge, Button, EditableSummary, EmptyState, ErrorState, errorMessage, Loading, LookupChip, PageHeader, RecordPage,
  ResourceList, Switch, useAuth, useFetch, useToast,
} from '../../core';
import type { Row } from '../../core';
import { CheckInDialog, CheckOutDialog, DisposeDialog, useAssetMoveBlocked } from './AssetDialogs';
import type { DisposalRequest } from './AssetDialogs';
import { AssignmentTab, DisposalTab, LifecycleBand, RequestCard, WhereCard } from './AssetLifecycle';
import { ExtensionSections, ListExtensionActions, useBulkExtensions } from './Extensions';
import { MODEL_KINDS, modelAnnotate, useFromModel } from './models';
import { funderFields, RelatedWork, useFunder } from './shared';

const annotateAsset = modelAnnotate(MODEL_KINDS.asset);

export function AssetList() {
  const funder = useFunder();
  const bulkActions = useBulkExtensions('asset');
  // "New asset from this model" (E39-05): the New form opens filled with the model's values.
  const fromModel = useFromModel(MODEL_KINDS.asset);
  if (fromModel.pending) return <Loading lines={6} label="Loading the asset model" />;
  return (
    <ResourceList
      type="asset"
      title="Assets"
      columns={[
        'tag', 'name', 'asset_type', 'status',
        { field: 'user_id', label: 'Assigned to', render: (row) => row._display?.user_id ?? row.assigned_to_name ?? '—' },
        'site_id', 'warranty_end', 'support_end',
        ...(funder.on ? [{ field: 'funder_interest', label: funder.label, sortable: true, render: (row: Row) => (row.funder_interest ? <Badge color="amber">{funder.label}{row.funder_interest_pct != null ? ` ${row.funder_interest_pct}%` : ''}</Badge> : '—') }] : []),
        { field: 'disposal_request_status', hidden: true },
        { field: 'department', hidden: true },
        { field: 'owner_id', hidden: true },
        { field: 'system_id', hidden: true },
        { field: 'serial', hidden: true },
        { field: 'cost', hidden: true },
        { field: 'purchase_date', hidden: true },
        { field: 'model_id', hidden: true },
      ]}
      filters={funderFields(['status', 'asset_type', 'model_id', 'site_id', 'system_id', 'user_id', 'owner_id', 'funding_source', 'funder_interest', 'disposal_request_status', 'warranty_end', 'support_end', 'purchase_date'], funder.on)}
      bulkFields={['status', 'asset_type', 'site_id', 'owner_id', 'system_id', 'funding_source', 'warranty_end', 'support_end']}
      createInitial={fromModel.initial}
      createFields={funderFields(['name', 'model_id', 'asset_type', 'status', 'make', 'model', 'serial', 'site_id', 'location', 'purchase_date', 'cost', 'funding_source', 'funder_interest', 'funder_interest_pct', 'warranty_end', 'support_end'], funder.on)}
      // Import is the list's own (the generic import wizard, E13-21).
      actions={<><ListExtensionActions recordType="asset" /><Link className="btn btn-secondary" to="/assets/disposals">Disposal approvals</Link></>}
      bulkActions={bulkActions}
    />
  );
}

const DETAILS = ['name', 'tag', 'model_id', 'asset_type', 'status', 'make', 'model', 'serial', 'system_id'];
const PURCHASE = ['purchase_date', 'cost', 'funding_source', 'funder_interest', 'funder_interest_pct', 'warranty_end', 'support_end', 'vendor_id', 'contract_id'];
const TECHNICAL = ['os', 'os_version', 'ip_address', 'mac_address', 'notes'];

function AssetActions({ row, canEdit, onChanged }: { row: Row; canEdit: boolean; onChanged: () => void }) {
  const [dialog, setDialog] = useState<'out' | 'in' | 'dispose' | null>(null);
  // Checking out sets In use: offered only when the lifecycle rules allow it (E14-31).
  const outBlocked = useAssetMoveBlocked(row)('in_use');
  if (!canEdit) return null;
  const assigned = !!(row.user_id || row.assigned_to_name);
  const gone = row.status === 'disposed';
  const close = (changed: boolean) => { setDialog(null); if (changed) onChanged(); };
  return (
    <>
      {!gone && !assigned && row.status !== 'retired' && <Button variant="primary" disabled={Boolean(outBlocked)} title={outBlocked || undefined} onClick={() => setDialog('out')}>Check out</Button>}
      {!gone && assigned && <Button variant="primary" onClick={() => setDialog('in')}>Check in</Button>}
      {!gone && <Button icon="trash" onClick={() => setDialog('dispose')}>Dispose</Button>}
      {dialog === 'out' && <CheckOutDialog asset={row} onClose={close} />}
      {dialog === 'in' && <CheckInDialog asset={row} onClose={close} />}
      {dialog === 'dispose' && <DisposeDialog asset={row} onClose={close} />}
    </>
  );
}

export function AssetDetail() {
  // Bumped after a lifecycle action so the assignment and disposal lists reload with the record.
  const [version, setVersion] = useState(0);
  const purchase = funderFields(PURCHASE, useFunder().on);
  return (
    <RecordPage
      type="asset"
      subtitle={(row) => [row.make, row.model, row.serial && `Serial ${row.serial}`].filter(Boolean).join(' · ') || undefined}
      status={(row) => (
        <span className="row">
          {row.status && <LookupChip list="asset_status" value={row.status} />}
          {row.disposal_request_status && row.status !== 'disposed' && <LookupChip list="disposal_request_status" value={row.disposal_request_status} />}
        </span>
      )}
      actions={({ row, reload, canEdit }) => (
        <AssetActions row={row} canEdit={canEdit} onChanged={() => { setVersion((v) => v + 1); reload(); }} />
      )}
      banner={({ row }) => <LifecycleBand row={row} />}
      summary={({ row, reload, canEdit }) => (
        <>
          <div className="inv-asset-summary">
            <EditableSummary type="asset" row={row} fields={DETAILS} onSaved={reload} sections={[{ title: 'What it is', fields: DETAILS }]} annotate={(f) => annotateAsset(row, f)} />
            <WhereCard row={row} canEdit={canEdit} onChanged={reload} />
          </div>
          <ExtensionSections recordType="asset" row={row} />
        </>
      )}
      tabs={[
        { key: 'assignment', label: 'Assignment', content: ({ row }) => <AssignmentTab row={row} version={version} /> },
        {
          key: 'details', label: 'Purchase and support',
          content: ({ row, reload }) => (
            <div className="stack">
              <EditableSummary type="asset" row={row} fields={purchase} title="Purchase, funding and support" onSaved={reload} annotate={(f) => annotateAsset(row, f)} />
              <EditableSummary type="asset" row={row} fields={TECHNICAL} title="Technical" onSaved={reload} />
            </div>
          ),
        },
        { key: 'disposal', label: 'Disposal', content: ({ row, reload }) => <DisposalTab row={row} version={version} onChanged={reload} /> },
        { key: 'work', label: 'Changes and issues', content: ({ row }) => <RelatedWork field="asset_id" id={row.id} noun="asset" /> },
      ]}
    />
  );
}

/** Disposal requests waiting for a decision, and those already decided. */
export function DisposalApprovalsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState('pending');
  const { data, error, reload } = useFetch<DisposalRequest[]>(`/api/assets/disposal-requests?status=${status}`, { keepPrevious: true });
  const settings = useFetch<{ disposalRoutedOnly: boolean }>('/api/inventory/settings');

  async function setRoutedOnly(on: boolean) {
    try {
      await api.patch('/api/inventory/settings', { disposalRoutedOnly: on });
      settings.reload();
      toast.success(on ? 'Disposals now need an approval decided here.' : 'An approval given elsewhere can be recorded again.');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }
  return (
    <div className="stack">
      <PageHeader
        title="Disposal approvals"
        subtitle="Requests to dispose of assets. Each runs on the Asset disposal approval workflow; someone other than the requester approves or refuses it."
        breadcrumbs={[{ label: 'Assets', to: '/assets' }, { label: 'Disposal approvals' }]}
        actions={<Button icon="refresh" onClick={reload}>Refresh</Button>}
      />
      <SegmentedControl aria-label="Which requests to show" value={status} onChange={setStatus} className="inv-narrow-control"
        data={[{ value: 'pending', label: 'Awaiting approval' }, { value: 'approved', label: 'Approved' }, { value: 'refused', label: 'Refused' }, { value: 'all', label: 'All' }]} />
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={5} />
        : data.length === 0 ? (
          <EmptyState icon="check-square" title={status === 'pending' ? 'Nothing is waiting for approval' : 'No requests to show'}
            message="A request is made from an asset with the Dispose button." action={<Link className="btn btn-secondary" to="/assets">Go to assets</Link>} />
        ) : (
          <div className="stack">
            {data.map((r) => (
              <RequestCard key={r.id} request={r} showAsset label={[r.asset_tag, r.asset_name].filter(Boolean).join(' ')} onChanged={reload} />
            ))}
          </div>
        )}
      {can('admin.administer') && settings.data && (
        <div className="inv-setting">
          <Switch label="Only accept approvals decided here" checked={settings.data.disposalRoutedOnly} onChange={(on) => void setRoutedOnly(on)}
            hint="When on, a disposal cannot be completed with a typed-in approver name: a request must be approved in the application first." />
        </div>
      )}
      {!can('assets.approve') && <Text size="sm" c="dimmed">You can see the requests but not decide them: that needs the approval permission for assets.</Text>}
    </div>
  );
}
