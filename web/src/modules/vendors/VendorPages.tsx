// Vendors list and the vendor record.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Card, EmptyState, ErrorState, formatDate, Loading, LookupChip, RecordPage, ResourceList, Stat, useAuth,
  useFetch, useResource,
} from '../../core';
import type { ListResult, Row } from '../../core';
import { Checklist } from './Checklist';
import { Contacts } from './Contacts';
import { AddEvidence } from './EvidenceForm';
import { ExpiryChip, NoticeChip, daysPhrase, daysUntil } from './shared';
import type { VendorSummary } from './shared';

export function VendorList() {
  return (
    <ResourceList
      type="vendor"
      title="Vendors"
      columns={['ref', 'name', 'criticality', 'services', 'remote_access_method', 'status']}
      filters={['criticality', 'status']}
      createFields={['name', 'services', 'criticality', 'remote_access_method', 'notes']}
      actions={<Link className="btn btn-secondary" to="/vendors/terms">Security terms matrix</Link>}
    />
  );
}

function SummaryTiles({ vendorId }: { vendorId: string }) {
  const { data, error, reload } = useFetch<VendorSummary>(`/api/vendors/${vendorId}/summary`);
  if (error) return <ErrorState title="The summary could not be loaded" error={error} onRetry={reload} />;
  if (!data) return <Loading lines={2} label="Loading summary" />;
  const next = data.next_notice_date;
  return (
    <div className="grid-stats">
      <Stat label="Contracts" value={data.contracts} to={`/vendors/${vendorId}?tab=contracts`} />
      <Stat
        label="Next notice date"
        value={next ? formatDate(next) : data.notice_dates_passed ? 'Passed' : 'None'}
        color={data.notice_dates_passed ? 'red' : next && daysUntil(next) <= 120 ? 'amber' : undefined}
        trend={next
          ? { direction: 'flat', label: daysPhrase(daysUntil(next)), tone: 'neutral' }
          : data.notice_dates_passed ? { direction: 'flat', label: `${data.notice_dates_passed} passed`, tone: 'bad' } : undefined}
        to="/contracts/renewals"
      />
      <Stat
        label="Security terms absent" value={data.terms.absent} color={data.terms.absent ? 'red' : 'green'}
        trend={{ direction: 'flat', label: `${data.terms.partial} partial, ${data.terms.not_assessed} not assessed`, tone: 'neutral' }}
        to={`/vendors/${vendorId}?tab=terms`}
      />
      <Stat
        label="Evidence expiring" value={data.evidence_expiring + data.evidence_expired}
        color={data.evidence_expired ? 'red' : data.evidence_expiring ? 'amber' : undefined}
        trend={{ direction: 'flat', label: `${data.evidence_expired} expired, ${data.evidence} on file`, tone: 'neutral' }}
        to={`/vendors/${vendorId}?tab=evidence`}
      />
      {data.systems !== null && <Stat label="Systems supplied" value={data.systems} to={`/vendors/${vendorId}?tab=systems`} />}
    </div>
  );
}

function ContractsTab({ vendorId }: { vendorId: string }) {
  return (
    <ResourceList
      type="contract"
      baseFilter={{ vendor_id: vendorId }}
      columns={[
        'ref', 'title', 'status', 'renewal_mechanism', 'end_date',
        { field: 'notice_date', label: 'Notice date', sortable: true, render: (row) => <NoticeChip date={row.notice_date} /> },
        'total_value',
      ]}
      filters={['status', 'renewal_mechanism']}
      createFields={['title', 'document_type', 'status', 'start_date', 'end_date', 'renewal_mechanism', 'notice_days', 'owner_id']}
      createInitial={{ vendor_id: vendorId }}
    />
  );
}

function TermsTab({ vendorId }: { vendorId: string }) {
  const { can } = useAuth();
  const allowed = can('contracts.view');
  const { data, error, reload } = useFetch<ListResult<Row>>(
    allowed ? `/api/contracts?f.vendor_id=${vendorId}&sort=title&pageSize=100` : null,
  );
  if (!allowed) return <EmptyState icon="lock" title="No access to contracts" message="Security terms are recorded on contracts, which you cannot view." />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={6} label="Loading security terms" />;
  if (!data.rows.length) {
    return (
      <EmptyState
        icon="shield" title="No contracts to check"
        message="Security terms are checked contract by contract. Add a contract on the Contracts tab first."
      />
    );
  }
  return (
    <div className="stack">
      <p className="muted">
        One row per clause of the contract security addendum. Mark each as present, partial or absent, and keep the
        wording the contract uses. Every change is recorded in the contract's history.
      </p>
      {data.rows.map((c) => (
        <Card
          key={c.id} flush
          title={`${c.ref ? `${c.ref} ` : ''}${c.title}`}
          actions={<Link className="btn btn-ghost btn-sm" to={`/contracts/${c.id}`}>Open contract</Link>}
        >
          <Checklist contractId={c.id} />
        </Card>
      ))}
    </div>
  );
}

function EvidenceTab({ vendorId }: { vendorId: string }) {
  const [version, setVersion] = useState(0); // remounts the list after an item is added
  return (
    <ResourceList
      key={version}
      type="evidence_item"
      baseFilter={{ vendor_id: vendorId }}
      columns={[
        'title', 'type', 'contract_id', 'received_on',
        { field: 'expires_on', label: 'Expiry', sortable: true, render: (row) => <ExpiryChip date={row.expires_on} /> },
      ]}
      filters={['type', 'expires_on']}
      actions={<AddEvidence vendorId={vendorId} onCreated={() => setVersion((n) => n + 1)} />}
    />
  );
}

const SYSTEM_COLUMNS = ['ref', 'name', 'function', 'criticality', 'criticality_tier', 'hosting', 'status'];

function SystemsTab({ vendorId }: { vendorId: string }) {
  const system = useResource('system');
  if (!system || !system.fields.vendor_id) {
    return (
      <EmptyState
        icon="server" title="Systems are not available"
        message="The systems inventory is not switched on, or you do not have access to it."
      />
    );
  }
  const columns = SYSTEM_COLUMNS.filter((f) => f === system.refField || f === system.titleField || system.fields[f]);
  return <ResourceList type="system" baseFilter={{ vendor_id: vendorId }} columns={columns.length ? columns : [system.titleField]} />;
}

export function VendorDetail() {
  return (
    <RecordPage
      type="vendor"
      status={(row) => (
        <span className="row">
          {row.criticality && <LookupChip list="vendor_criticality" value={row.criticality} />}
          <LookupChip list="vendor_status" value={row.status} />
        </span>
      )}
      subtitle={(row) => row.services}
      actions={() => <Link className="btn btn-secondary" to="/vendors/terms">Terms matrix</Link>}
      banner={({ row }) => <SummaryTiles vendorId={row.id} />}
      summaryFields={[
        'name', 'services', 'criticality', 'status', 'remote_access_method',
        'incident_contact_name', 'incident_contact_email', 'incident_contact_phone', 'notes',
      ]}
      tabs={[
        { key: 'contracts', label: 'Contracts', content: ({ row }) => <ContractsTab vendorId={row.id} /> },
        { key: 'terms', label: 'Security terms', content: ({ row }) => <TermsTab vendorId={row.id} /> },
        { key: 'evidence', label: 'Evidence', content: ({ row }) => <EvidenceTab vendorId={row.id} /> },
        { key: 'contacts', label: 'Contacts', content: ({ row }) => <Contacts vendorId={row.id} /> },
        { key: 'systems', label: 'Systems supplied', content: ({ row }) => <SystemsTab vendorId={row.id} /> },
      ]}
    />
  );
}
