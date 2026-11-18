// Evidence: full list, record, and the expiring-evidence page.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Card, cx, EmptyState, ErrorState, formatDate, Loading, PageHeader, RecordPage, ResourceList, Select, Stat, StatusChip,
  toColorName, useFetch,
} from '../../core';
import { ExpiryChip, daysPhrase } from './shared';
import type { ExpiringEvidence } from './shared';

export function EvidenceList() {
  return (
    <ResourceList
      type="evidence_item"
      title="Evidence"
      columns={[
        'title', 'type', 'vendor_id', 'contract_id', 'received_on',
        { field: 'expires_on', label: 'Expiry', sortable: true, render: (row) => <ExpiryChip date={row.expires_on} /> },
      ]}
      filters={['type', 'vendor_id', 'expires_on', 'received_on']}
      createFields={['title', 'vendor_id', 'contract_id', 'type', 'received_on', 'expires_on', 'note']}
      actions={<Link className="btn btn-secondary" to="/evidence/expiring">Expiring evidence</Link>}
    />
  );
}

export function EvidenceDetail() {
  return (
    <RecordPage
      type="evidence_item"
      status={(row) => <ExpiryChip date={row.expires_on} />}
      subtitle={(row) => (
        row.vendor_id
          ? <>Vendor: <Link to={`/vendors/${row.vendor_id}?tab=evidence`}>{row._display?.vendor_id ?? 'Open vendor'}</Link></>
          : null
      )}
      summaryFields={['title', 'type', 'vendor_id', 'contract_id', 'received_on', 'expires_on', 'note']}
    />
  );
}

const WINDOWS = [30, 60, 90, 180, 365].map((d) => ({ value: String(d), label: `Next ${d} days` }));

export function EvidenceExpiring() {
  const [days, setDays] = useState('90');
  const { data, error, loading, reload } = useFetch<{ today: string; days: number; rows: ExpiringEvidence[] }>(
    `/api/vendors/evidence-expiring?days=${days}`,
  );

  let body;
  if (error) body = <ErrorState error={error} onRetry={reload} />;
  else if (!data) body = <Loading lines={6} label="Loading expiring evidence" />;
  else if (!data.rows.length) {
    body = (
      <EmptyState
        icon="check-square" title="Nothing is expiring"
        message={`No assurance report, certificate, attestation or questionnaire has expired or runs out in the next ${data.days} days.`}
      />
    );
  } else {
    const expired = data.rows.filter((r) => r.expired).length;
    body = (
      <>
        <div className="grid-stats">
          <Stat label="Already expired" value={expired} color={expired ? 'red' : 'green'} />
          <Stat label={`Expiring in ${data.days} days`} value={data.rows.length - expired} color="amber" />
        </div>
        <div className={cx('table-wrap', loading && 'table-loading')}>
          <table className="table">
            <caption className="sr-only">Evidence that has expired or is about to, soonest first</caption>
            <thead>
              <tr>
                <th scope="col">Evidence</th><th scope="col">Type</th><th scope="col">Vendor</th>
                <th scope="col">Received</th><th scope="col">Expires</th><th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <th scope="row"><Link to={`/evidence/${r.id}`} className="row-title">{r.title}</Link></th>
                  <td>{r.type ? <StatusChip color={toColorName(r.type_color)} label={r.type_label ?? r.type} /> : <span className="muted">—</span>}</td>
                  <td><Link to={`/vendors/${r.vendor_id}?tab=evidence`}>{r.vendor_name}</Link></td>
                  <td>{formatDate(r.received_on)}</td>
                  <td>{formatDate(r.expires_on)}</td>
                  <td>
                    <StatusChip
                      color={r.expired ? 'red' : r.days_left <= 30 ? 'orange' : 'amber'}
                      label={r.expired ? `Expired ${daysPhrase(r.days_left)}` : `Expires ${daysPhrase(r.days_left)}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  return (
    <div className="stack">
      <PageHeader
        title="Expiring evidence"
        subtitle="Vendor assurance evidence that has run out or soon will. Ask the vendor for a current copy."
        breadcrumbs={[{ label: 'Evidence', to: '/evidence' }, { label: 'Expiring' }]}
      />
      <Card>
        <div className="row">
          <Select label="Show evidence expiring in" options={WINDOWS} value={days} onChange={(v) => setDays(v || '90')} />
        </div>
        {body}
      </Card>
    </div>
  );
}
