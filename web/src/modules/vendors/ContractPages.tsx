// Contracts list and the contract record.
import { Link } from 'react-router-dom';
import { Card, Countdown, EditableSummary, formatDate, RecordPage, ResourceList } from '../../core';
import type { Row } from '../../core';
import { Checklist } from './Checklist';
import { ExpiryChip, NoticeChip, daysPhrase, daysUntil } from './shared';

const DAY = 24 * 3600 * 1000;

export function ContractList() {
  return (
    <ResourceList
      type="contract"
      title="Contracts"
      columns={[
        'ref', 'title', 'vendor_id', 'status', 'renewal_mechanism', 'end_date',
        { field: 'notice_date', label: 'Notice date', sortable: true, render: (row) => <NoticeChip date={row.notice_date} /> },
        'total_value', 'owner_id',
      ]}
      filters={['status', 'vendor_id', 'renewal_mechanism', 'document_type', 'owner_id', 'notice_date', 'end_date']}
      createFields={['title', 'vendor_id', 'document_type', 'status', 'start_date', 'end_date', 'renewal_mechanism', 'notice_days', 'owner_id']}
      actions={<Link className="btn btn-secondary" to="/contracts/renewals">Renewal calendar</Link>}
    />
  );
}

/** The notice date, large, with a live countdown: the last day to tell the vendor the contract is not being renewed. */
function NoticeBanner({ row }: { row: Row }) {
  const closed = row.status === 'terminated' || row.status === 'expired';
  if (!row.notice_date) {
    return (
      <Card className="vnd-notice">
        <div className="vnd-notice-main">
          <span className="vnd-notice-label">Notice date</span>
          <span className="vnd-notice-date muted">Not set</span>
        </div>
        <p className="muted">
          The notice date is worked out from the end date and the notice period. Enter an end date to put this
          contract on the renewal calendar.
        </p>
      </Card>
    );
  }
  const left = daysUntil(row.notice_date);
  return (
    <Card className={`vnd-notice ${!closed && left < 0 ? 'vnd-notice-passed' : ''}`}>
      <div className="vnd-notice-main">
        <span className="vnd-notice-label">Notice date</span>
        <span className="vnd-notice-date">{formatDate(row.notice_date)}</span>
        <span className="muted">{daysPhrase(left)}</span>
      </div>
      <div className="vnd-notice-side">
        {closed
          ? <span className="muted">This contract has ended, so no reminders are raised.</span>
          : <Countdown label="Time to give notice" deadline={`${row.notice_date}T23:59:59`} warnMs={30 * DAY} />}
        <span className="muted">
          End date {formatDate(row.end_date)} less {row.notice_days ?? 0} days' notice.
          {row.notice_days === null || row.notice_days === undefined ? ' No notice period is recorded, so the end date is used.' : ''}
        </span>
      </div>
    </Card>
  );
}

function ContractEvidence({ row }: { row: Row }) {
  return (
    <ResourceList
      type="evidence_item"
      baseFilter={{ contract_id: row.id }}
      columns={[
        'title', 'type', 'received_on',
        { field: 'expires_on', label: 'Expiry', sortable: true, render: (r) => <ExpiryChip date={r.expires_on} /> },
      ]}
      createFields={['title', 'type', 'received_on', 'expires_on', 'note']}
      createInitial={{ vendor_id: row.vendor_id, contract_id: row.id }}
      onCreated={() => undefined}
    />
  );
}

export function ContractDetail() {
  return (
    <RecordPage
      type="contract"
      subtitle={(row) => (
        row.vendor_id
          ? <>Vendor: <Link to={`/vendors/${row.vendor_id}`}>{row._display?.vendor_id ?? 'Open vendor'}</Link></>
          : null
      )}
      banner={({ row }) => <NoticeBanner row={row} />}
      summary={({ row, reload }) => (
        <div className="stack">
          <EditableSummary
            type="contract" row={row} onSaved={reload}
            fields={[
              'title', 'vendor_id', 'status', 'document_type', 'parties', 'owner_id',
              'start_date', 'end_date', 'term', 'renewal_mechanism', 'notice_days', 'notice_date',
              'total_value', 'value_by_year', 'resolution_number', 'notes',
            ]}
          />
          <EditableSummary
            type="contract" row={row} onSaved={reload} title="As recorded in the contract register"
            fields={['document_on_file', 'date_and_resolution', 'term_and_renewal', 'value_text', 'hosting', 'terms_not_on_file']}
          />
        </div>
      )}
      tabs={[
        { key: 'terms', label: 'Security terms', content: ({ row }) => <Checklist contractId={row.id} /> },
        { key: 'evidence', label: 'Evidence', content: ({ row }) => <ContractEvidence row={row} /> },
      ]}
    />
  );
}
