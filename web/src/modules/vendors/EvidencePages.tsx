// Evidence: full list, record (with its files), and the expiring-evidence page.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SegmentedControl } from '@mantine/core';
import {
  Card, cx, EditableSummary, EmptyState, ErrorState, formatDate, Loading, PageHeader, RecordPage, ResourceList, Stat, StatusChip,
  toColorName, useFetch,
} from '../../core';
import type { ColorName, Row } from '../../core';
import { EvidenceExpiryCheck } from './EvidenceExpiry';
import { AddEvidence, EvidenceContractCard } from './EvidenceForm';
import { ExpiryChip, FilesPanel, daysPhrase, filesAvailable } from './shared';
import type { ExpiringEvidence } from './shared';

export function EvidenceList() {
  const navigate = useNavigate();
  return (
    <ResourceList
      type="evidence_item"
      title="Evidence"
      columns={[
        'title', 'type', 'vendor_id', 'contract_id', 'received_on',
        { field: 'expires_on', label: 'Expiry', sortable: true, render: (row) => <ExpiryChip date={row.expires_on} /> },
        { field: 'note', hidden: true },
      ]}
      filters={['type', 'vendor_id', 'expires_on', 'received_on']}
      bulkFields={['type', 'expires_on']}
      actions={(
        <>
          <Link className="btn btn-secondary" to="/evidence/expiring">Expiring evidence</Link>
          <AddEvidence watchNew onCreated={(row) => navigate(`/evidence/${row.id}`)} />
        </>
      )}
    />
  );
}

export function EvidenceDetail() {
  // Bumped when files change or a date is copied, so the expiry check reads again.
  const [version, setVersion] = useState(0);
  // Bumped when a date is copied onto the files, so the files list shows the new dates.
  const [filesKey, setFilesKey] = useState(0);
  return (
    <RecordPage
      type="evidence_item"
      banner={filesAvailable ? ({ row, canEdit, reload }) => (
        <EvidenceExpiryCheck itemId={row.id} version={version} canEdit={canEdit} onChanged={() => { reload(); setVersion((v) => v + 1); setFilesKey((k) => k + 1); }} />
      ) : undefined}
      status={(row) => <ExpiryChip date={row.expires_on} />}
      subtitle={(row) => (
        row.vendor_id
          ? <>Vendor: <Link to={`/vendors/${row.vendor_id}?tab=evidence`}>{row._display?.vendor_id ?? 'Open vendor'}</Link></>
          : null
      )}
      summary={({ row, reload, canEdit, save }) => (
        <div className="vnd-contract-cols">
          <EvidenceSummary row={row} reload={reload} />
          <EvidenceContractCard row={row} canEdit={canEdit} save={save} />
        </div>
      )}
      tabs={filesAvailable ? [{
        key: 'files', label: 'Files',
        content: ({ row }) => <FilesPanel key={filesKey} recordType="evidence_item" recordId={row.id} evidence onChange={() => setVersion((v) => v + 1)} />,
      }] : []}
    />
  );
}

function EvidenceSummary({ row, reload }: { row: Row; reload: () => void }) {
  return (
    <EditableSummary
      type="evidence_item" row={row} onSaved={reload}
      fields={['title', 'type', 'received_on', 'expires_on', 'note']}
    />
  );
}

/* ---------- expiring evidence ---------- */

const WINDOWS = [30, 60, 90, 180, 365].map((d) => ({ value: String(d), label: `${d} days` }));

interface Band { key: string; title: string; hint: string; color: ColorName; rows: ExpiringEvidence[] }

function EvidenceRow({ r }: { r: ExpiringEvidence }) {
  const [, month, day] = r.expires_on.split('-');
  const monthName = formatDate(r.expires_on).split(' ')[1];
  return (
    <li className="vnd-agenda-item">
      <span className="vnd-datebox" aria-hidden="true">
        <span className="vnd-datebox-day">{Number(day)}</span>
        <span className="vnd-datebox-month">{monthName ?? month} {r.expires_on.slice(0, 4)}</span>
      </span>
      <div className="vnd-agenda-main">
        <Link to={`/evidence/${r.id}`} className="vnd-agenda-title">{r.title}</Link>
        <span className="vnd-agenda-sub">
          <Link to={`/vendors/${r.vendor_id}?tab=evidence`}>{r.vendor_name}</Link>
          {r.received_on && <> · received {formatDate(r.received_on)}</>}
        </span>
      </div>
      <div className="vnd-agenda-meta">
        {r.type && <StatusChip color={toColorName(r.type_color)} label={r.type_label ?? r.type} />}
        <StatusChip
          color={r.expired ? 'red' : r.days_left <= 30 ? 'orange' : 'amber'}
          label={r.expired ? `Expired ${daysPhrase(r.days_left)}` : `Expires ${daysPhrase(r.days_left)}`}
        />
        <span className="sr-only">Expiry date {formatDate(r.expires_on)}</span>
      </div>
    </li>
  );
}

export function EvidenceExpiring() {
  const [days, setDays] = useState('90');
  const { data, error, loading, reload } = useFetch<{ today: string; days: number; rows: ExpiringEvidence[] }>(
    `/api/vendors/evidence-expiring?days=${days}`, { keepPrevious: true },
  );

  let body;
  if (error) body = <ErrorState error={error} onRetry={reload} />;
  else if (!data) body = <Loading lines={6} label="Loading expiring evidence" />;
  else if (!data.rows.length) {
    body = (
      <EmptyState
        icon="check-circle" title="Nothing is expiring"
        message={`No assurance report, certificate, attestation or questionnaire has expired or runs out in the next ${data.days} days.`}
      />
    );
  } else {
    const bands: Band[] = [
      { key: 'expired', title: 'Already expired', hint: 'Ask the vendor for a current copy now.', color: 'red', rows: data.rows.filter((r) => r.expired) },
      { key: 'soon', title: 'Expires within 30 days', hint: 'Ask for the replacement so there is no gap.', color: 'orange', rows: data.rows.filter((r) => !r.expired && r.days_left <= 30) },
      { key: 'later', title: `Expires in 31 to ${data.days} days`, hint: 'Nothing to do yet; a reminder is sent as the date approaches.', color: 'amber', rows: data.rows.filter((r) => !r.expired && r.days_left > 30) },
    ];
    body = (
      <div className={cx('stack', loading && 'table-loading')}>
        <div className="grid-stats">
          {bands.filter((b) => b.key !== 'later' || data.days > 30).map((b) => (
            <Stat key={b.key} label={b.title} value={b.rows.length} color={b.rows.length ? b.color : 'green'} />
          ))}
        </div>
        {bands.filter((b) => b.rows.length).map((b) => (
          <section key={b.key} className={cx('vnd-band', `vnd-band-${b.color}`)} aria-labelledby={`vnd-ev-${b.key}`}>
            <header className="vnd-band-head">
              <h2 id={`vnd-ev-${b.key}`} className="vnd-band-title">{b.title} <span className="tab-count">{b.rows.length}</span></h2>
              <p className="muted">{b.hint}</p>
            </header>
            <ul className="vnd-agenda">{b.rows.map((r) => <EvidenceRow key={r.id} r={r} />)}</ul>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="stack">
      <PageHeader
        title="Expiring evidence"
        subtitle="Vendor assurance evidence that has run out or soon will. When a current copy arrives, record it as a new evidence item."
        breadcrumbs={[{ label: 'Evidence', to: '/evidence' }, { label: 'Expiring' }]}
        actions={(
          <span className="row">
            {filesAvailable && <Link className="btn btn-secondary" to="/attachments/expiring">Expiring evidence files on any record</Link>}
            <Link className="btn btn-secondary" to="/evidence">All evidence</Link>
          </span>
        )}
      />
      <Card>
        <div className="vnd-toolbar">
          <div className="vnd-toolbar-filters">
            <span className="vnd-eyebrow" id="vnd-ev-window">Look ahead</span>
            <SegmentedControl size="xs" aria-labelledby="vnd-ev-window" data={WINDOWS} value={days} onChange={setDays} />
          </div>
        </div>
        {body}
      </Card>
    </div>
  );
}
