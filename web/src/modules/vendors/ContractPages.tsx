// Contracts list and the contract record.
import { lazy, Suspense, useState, type ComponentType } from 'react';
import { Link } from 'react-router-dom';
import { Tooltip } from '@mantine/core';
import {
  Countdown, cx, EditableSummary, formatDate, formatDateTime, Icon, Loading, RecordPage, ResourceList, todayInZone, useAuth, useFetch, useResource,
} from '../../core';
import type { Row } from '../../core';
import { Checklist } from './Checklist';
import { StartOffboarding } from './Offboardings';
import { AddEvidence } from './EvidenceForm';
import { PerformanceTab } from './Performance';
import { VendorChecksNotice } from './Intake';
import {
  ActionsTab, ExpiryChip, NoticeChip, daysUntil, ifWeDoNothing, noticeTone, useActionsAvailable,
} from './shared';
import type { ReminderState } from './shared';
import { ValueByYear } from './ValueByYear';
import { ContractSpendTotal } from './SpendTotal';

const DAY = 24 * 3600 * 1000;

// The funding module's "Funder-required clauses" panel (E27-08), only when that module is in the build.
const fundingLoaders = import.meta.glob<{ ContractFundingClauses: ComponentType<{ contractId: string }> }>('../funding/ContractFundingClauses.tsx');
const loadFunding = Object.values(fundingLoaders)[0];
const FundingClauses = loadFunding ? lazy(() => loadFunding().then((m) => ({ default: m.ContractFundingClauses }))) : null;

/** Whether contracts carry an approval number (an option under Administration > Features: E18-28). */
const useApprovalNumber = () => Boolean(useResource('contract')?.fields.resolution_number);

export function ContractList() {
  const missing = useFetch<{ rows: unknown[] }>('/api/contracts/missing-dates');
  const count = missing.data?.rows.length ?? 0;
  const approval = useApprovalNumber();
  return (
    <div className="stack">
      <ResourceList
        type="contract"
        title="Contracts"
        columns={[
          'ref', 'title', 'vendor_id', 'status',
          { field: 'notice_date', label: 'Notice date', sortable: true, render: (row) => <NoticeChip date={row.notice_date} status={row.status} /> },
          'end_date', { field: 'annual_value', label: 'Annual value', sortable: true, priority: 1 }, 'renewal_mechanism', 'owner_id', { field: 'total_value', hidden: true },
          { field: 'document_type', hidden: true }, { field: 'start_date', hidden: true },
          { field: 'notice_days', hidden: true }, ...(approval ? [{ field: 'resolution_number', hidden: true }] : []),
        ]}
        filters={['status', 'vendor_id', 'renewal_mechanism', 'document_type', 'owner_id', 'notice_date', 'end_date']}
        bulkFields={['status', 'owner_id', 'renewal_mechanism', 'document_type']}
        createFields={['title', 'vendor_id', 'document_type', 'status', 'start_date', 'end_date', 'renewal_mechanism', 'notice_days', 'owner_id']}
        actions={(
          <>
            {count > 0 && (
              <Link className="btn btn-secondary" to="/contracts/dates">Complete the dates <span className="tab-count">{count}</span></Link>
            )}
            <Link className="btn btn-secondary" to="/contracts/renewals">Renewal calendar</Link>
          </>
        )}
      />
      <ContractSpendTotal />
    </div>
  );
}

/* ---------- the notice date, front and center ---------- */

const REMINDER_WORD: Record<ReminderState['state'], string> = { fired: 'sent', superseded: 'skipped', due: 'due now', scheduled: 'planned' };

function reminderTitle(r: ReminderState): string {
  if (r.state === 'fired') return `Sent ${formatDateTime(r.fired_at)}`;
  if (r.state === 'superseded') return 'Skipped: a nearer reminder was sent instead';
  if (r.state === 'due') return `Due since ${formatDate(r.due_on)}; it is sent within the hour`;
  return `Planned for ${formatDate(r.due_on)}`;
}

export function ReminderDots({ list }: { list: ReminderState[] }) {
  return (
    <ul className="vnd-reminders" aria-label="Reminders">
      {list.map((r) => (
        <li key={r.threshold_days}>
          <Tooltip label={`${r.threshold_days}-day reminder. ${reminderTitle(r)}`} withArrow>
            <span className={cx('vnd-reminder', `vnd-reminder-${r.state}`)} tabIndex={0}>
              {r.state === 'fired' && <Icon name="check" size={12} />}
              {r.threshold_days}d<span className="sr-only"> {REMINDER_WORD[r.state]}</span>
            </span>
          </Tooltip>
        </li>
      ))}
    </ul>
  );
}

/** A bar from the start of the term to its end, showing today, the notice date and the closed window after it. */
function TermTrack({ row }: { row: Row }) {
  const today = todayInZone();
  const t = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
  const end = t(row.end_date);
  const notice = t(row.notice_date);
  const now = t(today);
  const from = Math.min(row.start_date ? t(row.start_date) : notice - 365 * DAY, now - 14 * DAY, notice - 30 * DAY);
  const to = Math.max(end, now + 14 * DAY);
  const pct = (x: number) => `${Math.min(100, Math.max(0, ((x - from) / (to - from)) * 100))}%`;
  return (
    <div className="vnd-track" role="img" aria-label={`Term from ${row.start_date ? formatDate(row.start_date) : 'an unrecorded start'} to ${formatDate(row.end_date)}; notice by ${formatDate(row.notice_date)}`}>
      <div className="vnd-track-line">
        <span className="vnd-track-open" style={{ left: 0, width: pct(notice) }} />
        <span className="vnd-track-closed" style={{ left: pct(notice), width: `calc(${pct(end)} - ${pct(notice)})` }} />
        <span className="vnd-track-mark vnd-track-notice" style={{ left: pct(notice) }} />
        <span className="vnd-track-mark vnd-track-end" style={{ left: pct(end) }} />
        <span className="vnd-track-today" style={{ left: pct(now) }}><span>Today</span></span>
      </div>
      <div className="vnd-track-labels">
        <span>{row.start_date ? <>Started {formatDate(row.start_date)}</> : 'Start not recorded'}</span>
        <span>Notice by <strong>{formatDate(row.notice_date)}</strong> · ends <strong>{formatDate(row.end_date)}</strong></span>
      </div>
    </div>
  );
}

function NoticeHero({ row }: { row: Row }) {
  const closed = row.status === 'terminated' || row.status === 'expired';
  const reminders = useFetch<{ reminders: ReminderState[]; thresholds: number[] }>(
    row.notice_date && !closed ? `/api/contracts/${row.id}/reminders` : null,
  );
  const nothing = (
    <p className="vnd-hero-nothing">
      <span className="vnd-eyebrow">If we do nothing</span>
      {ifWeDoNothing(row)}
    </p>
  );

  if (!row.notice_date) {
    return (
      <section className="vnd-hero vnd-hero-gray" aria-label="Notice date">
        <div className="vnd-hero-date">
          <span className="vnd-eyebrow">Last day to give notice</span>
          <span className="vnd-hero-big muted">Not set</span>
          <span className="vnd-hero-sub">No reminders can be sent</span>
        </div>
        <div className="vnd-hero-body">
          {nothing}
          <p className="muted">
            The notice date is worked out from the end date and the notice period. Enter an <strong>End date</strong> in
            the Details card below to put this contract on the renewal calendar
            {closed ? '.' : <>, or work through <Link to="/contracts/dates">Complete the dates</Link>.</>}
          </p>
        </div>
      </section>
    );
  }

  const left = daysUntil(row.notice_date);
  const tone = closed ? 'gray' : noticeTone(row.notice_date);
  const noPeriod = row.notice_days === null || row.notice_days === undefined;
  return (
    <section className={cx('vnd-hero', `vnd-hero-${tone}`)} aria-label="Notice date">
      <div className="vnd-hero-date">
        <span className="vnd-eyebrow">Last day to give notice</span>
        <span className="vnd-hero-big">{formatDate(row.notice_date)}</span>
        {closed ? <span className="vnd-hero-sub">Contract ended</span> : (
          <span className="vnd-hero-count">
            <strong>{Math.abs(left)}</strong> {Math.abs(left) === 1 ? 'day' : 'days'} {left >= 0 ? 'left' : 'ago'}
          </span>
        )}
      </div>
      <div className="vnd-hero-body">
        {nothing}
        <TermTrack row={row} />
        <div className="vnd-hero-foot">
          {!closed && <Countdown label="Time to give notice" deadline={`${row.notice_date}T23:59:59`} warnMs={30 * DAY} />}
          <span className="muted">
            End date {formatDate(row.end_date)} less {row.notice_days ?? 0} days' notice.
            {noPeriod ? ' No notice period is recorded, so the end date is used.' : ''}
          </span>
          {closed
            ? <span className="muted">No reminders are sent for a contract that has ended.</span>
            : reminders.data && reminders.data.reminders.length > 0 && (
              <span className="vnd-hero-reminders"><span className="muted">Reminders</span> <ReminderDots list={reminders.data.reminders} /></span>
            )}
        </div>
      </div>
    </section>
  );
}

function ContractEvidence({ row }: { row: Row }) {
  const [version, setVersion] = useState(0);
  return (
    <ResourceList
      key={version}
      type="evidence_item"
      baseFilter={{ contract_id: row.id }}
      columns={[
        'title', 'type', 'received_on',
        { field: 'expires_on', label: 'Expiry', sortable: true, render: (r) => <ExpiryChip date={r.expires_on} /> },
      ]}
      bulkFields={[]}
      actions={<AddEvidence vendorId={row.vendor_id} contractId={row.id} onCreated={() => setVersion((n) => n + 1)} />}
    />
  );
}

export function ContractDetail() {
  const actions = useActionsAvailable();
  const { can, areaOn } = useAuth();
  const funding = Boolean(FundingClauses) && areaOn('funding') && can('funding.view');
  const approval = useApprovalNumber();
  const valueFields = ['total_value', ...(approval ? ['resolution_number'] : []), 'notes'];
  return (
    <RecordPage
      type="contract"
      subtitle={(row) => (
        <>
          {row.vendor_id && <>Vendor: <Link to={`/vendors/${row.vendor_id}`}>{row._display?.vendor_id ?? 'Open vendor'}</Link></>}
          {row._display?.owner_id ? ` · Owner: ${row._display.owner_id}` : ' · No owner'}
        </>
      )}
      actions={({ row }) => (
        <>
          <StartOffboarding contract={row} />
          <Link className="btn btn-secondary" to="/contracts/renewals">Renewal calendar</Link>
        </>
      )}
      banner={({ row }) => <><VendorChecksNotice contract={row} /><NoticeHero row={row} /></>}
      summary={({ row, reload, save, canEdit }) => (
        <div className="vnd-contract-cols">
          <EditableSummary
            type="contract" row={row} onSaved={reload}
            fields={[
              'title', 'vendor_id', 'status', 'document_type', 'parties', 'owner_id',
              'start_date', 'end_date', 'term', 'renewal_mechanism', 'notice_days',
              ...valueFields,
            ]}
            sections={[
              { title: 'Agreement', fields: ['title', 'vendor_id', 'status', 'document_type', 'parties', 'owner_id'] },
              {
                title: 'Dates and renewal',
                description: 'The notice date is worked out for you: the end date less the notice period.',
                fields: ['start_date', 'end_date', 'term', 'renewal_mechanism', 'notice_days'],
              },
              { title: approval ? 'Value and approval' : 'Value', fields: valueFields },
            ]}
          />
          <div className="stack">
            <ValueByYear row={row} canEdit={canEdit} save={save} />
            <EditableSummary
              type="contract" row={row} onSaved={reload} title="As recorded in the contract register"
              fields={['document_on_file', 'date_and_resolution', 'term_and_renewal', 'value_text', 'hosting', 'terms_not_on_file']}
            />
          </div>
        </div>
      )}
      tabs={[
        { key: 'terms', label: 'Security terms', content: ({ row }) => <Checklist contractId={row.id} /> },
        { key: 'evidence', label: 'Evidence', content: ({ row }) => <ContractEvidence row={row} /> },
        { key: 'performance', label: 'Performance', content: ({ row }) => <PerformanceTab contractId={row.id} /> },
        ...(actions ? [{ key: 'actions', label: 'Actions', content: ({ row }: { row: Row }) => <ActionsTab sourceType="contract" sourceId={row.id} /> }] : []),
        ...(funding && FundingClauses ? [{
          key: 'funder-clauses', label: 'Funder clauses',
          content: ({ row }: { row: Row }) => <Suspense fallback={<Loading lines={4} />}><FundingClauses contractId={row.id} /></Suspense>,
        }] : []),
      ]}
    />
  );
}
