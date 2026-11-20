// Evidence files, on any record the person may see, that have expired or soon will.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Card, cx, EmptyState, ErrorState, errorMessage, formatDate, Loading, PageHeader, routePaths, Select, Stat, StatusChip, useAuth,
  useFetch, useToast,
} from '../../core';
import { downloadAttachment, expiryState, FileTypeIcon, type Attachment } from './shared';
import './attachments.css';

interface ExpiringRow extends Attachment {
  days_left: number;
  expired: boolean;
  record_label: string;
  record_type_label: string;
  record_route: string;
}

const WINDOWS = [30, 60, 90, 180, 365].map((d) => ({ value: String(d), label: `Next ${d} days` }));

export function ExpiringEvidenceFiles() {
  const toast = useToast();
  const { can, areaOn } = useAuth();
  // Vendor evidence items have a page of their own, with the item's expiry date (E14-18).
  const vendorPage = routePaths.includes('/evidence/expiring') && areaOn('vendors') && can('vendors.view');
  const [days, setDays] = useState('90');
  const { data, error, loading, reload } = useFetch<{ today: string; days: number; rows: ExpiringRow[] }>(
    `/api/attachments/evidence-expiring?days=${days}`,
  );

  const download = (row: ExpiringRow) => { downloadAttachment(row).catch((err) => toast.error(errorMessage(err))); };

  let body;
  if (error) body = <ErrorState title="Expiring evidence could not be loaded" error={error} onRetry={reload} />;
  else if (!data) body = <Loading lines={6} label="Loading expiring evidence files" />;
  else if (!data.rows.length) {
    body = (
      <EmptyState
        icon="check-square"
        title="No evidence files are expiring"
        message={`No evidence file on a record you can see has expired or runs out in the next ${data.days} days. Files appear here when they are attached as evidence with an expiry date.`}
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
            <caption className="sr-only">Evidence files that have expired or are about to, soonest first</caption>
            <thead>
              <tr>
                <th scope="col">File</th>
                <th scope="col">Attached to</th>
                <th scope="col">Collected</th>
                <th scope="col">Expires</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const state = expiryState(r.expires_on, data.today);
                return (
                  <tr key={r.id}>
                    <td>
                      <span className="att-file-cell">
                        <FileTypeIcon group={r.type_group} />
                        <button type="button" className="att-name" onClick={() => download(r)} title={`Download ${r.file_name}`}>{r.file_name}</button>
                      </span>
                    </td>
                    <td>
                      <Link to={`${r.record_route}?tab=attachments`}>{r.record_label}</Link>
                      <div className="muted">{r.record_type_label}</div>
                    </td>
                    <td>{formatDate(r.collected_on)}</td>
                    <td>{formatDate(r.expires_on)}</td>
                    <td>{state && <StatusChip color={state.color} label={state.label} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  return (
    <div className="stack">
      <PageHeader
        title="Expiring evidence files"
        subtitle="Files attached to records as evidence that have passed their expiry date or soon will. Open the record to attach a current copy."
        actions={(vendorPage || can('admin.administer')) ? (
          <span className="row">
            {vendorPage && <Link className="att-settings-link" to="/evidence/expiring">Expiring vendor evidence</Link>}
            {can('admin.administer') && <Link className="att-settings-link" to="/admin/attachments">File settings</Link>}
          </span>
        ) : undefined}
      />
      <Card>
        <div className="att-toolbar">
          <Select label="Show evidence expiring in" required options={WINDOWS} value={days} onChange={(v) => setDays(v || '90')} />
        </div>
        {body}
      </Card>
    </div>
  );
}
