// Types and small pieces shared by the vendor and contract screens.
import { lazy, Suspense, type ComponentType } from 'react';
import { Tooltip } from '@mantine/core';
import { cx, EmptyState, formatDate, Icon, Loading, StatusChip, todayInZone, useResource } from '../../core';
import type { ColorName, Row } from '../../core';

export type ClauseStatus = 'present' | 'partial' | 'absent';
export type ClauseKey = ClauseStatus | 'none';

export interface ChecklistRow {
  clause_key: string;
  label: string;
  description: string | null;
  status: ClauseStatus | null;
  clause_text: string | null;
  note: string | null;
  updated_at: string | null;
}

export interface MatrixItem {
  contract_id: string;
  contract_ref: string | null;
  contract_title: string;
  status: ClauseStatus | null;
  clause_text: string | null;
  note: string | null;
}

export interface MatrixVendor {
  id: string;
  ref: string | null;
  name: string;
  criticality: string | null;
  criticality_label: string | null;
  criticality_color: string;
  contracts: number;
  cells: Record<string, { status: ClauseStatus | null; items: MatrixItem[] }>;
}

export interface Matrix {
  clauses: { key: string; label: string; description: string | null }[];
  vendors: MatrixVendor[];
}

export interface TermCounts { present: number; partial: number; absent: number; not_assessed: number }

export interface VendorSummary {
  today: string;
  sees_contracts: boolean;
  contracts: number;
  contracts_open: number;
  contracts_undated: number;
  next_notice_date: string | null;
  next_notice_contract: { id: string; ref: string | null; title: string; renewal_mechanism: string | null; end_date: string | null } | null;
  notice_dates_passed: number;
  terms: TermCounts;
  incident_contacts: { name: string; role: string | null; email: string | null; phone: string | null }[];
  evidence: number;
  evidence_current: number;
  evidence_expired: number;
  evidence_expiring: number;
  evidence_latest_received: string | null;
  assessment: { id: string | null; score: number | null; assessed_on: string | null; gaps: number; draft_id: string | null };
  systems: number | null;
}

export interface VendorOverview {
  today: string;
  vendors: Record<string, { contracts: number; notice_date: string | null; terms: TermCounts }>;
}

export interface ReminderState {
  threshold_days: number;
  due_on: string;
  fired_at: string | null;
  superseded: boolean;
  state: 'fired' | 'superseded' | 'due' | 'scheduled';
}

export interface RenewalRow {
  id: string;
  ref: string | null;
  title: string;
  vendor_id: string;
  vendor_name: string | null;
  status: string | null;
  status_label: string | null;
  status_color: string;
  renewal_mechanism: string | null;
  renewal_label: string | null;
  start_date: string | null;
  end_date: string | null;
  notice_days: number | null;
  notice_date: string | null;
  total_value: number | null;
  owner_name: string | null;
  term_and_renewal: string | null;
  days_to_notice?: number;
  window?: string;
  reminders?: ReminderState[];
}

export interface Renewals {
  today: string;
  thresholds: number[];
  contracts: RenewalRow[];
  undated: RenewalRow[];
  can_administer: boolean;
}

export interface ExpiringEvidence {
  id: string;
  title: string;
  type: string | null;
  type_label: string | null;
  type_color: string;
  vendor_id: string;
  vendor_name: string;
  received_on: string | null;
  expires_on: string;
  days_left: number;
  expired: boolean;
}

/** One vocabulary for clause status everywhere: color plus a word and a mark, never color alone. */
export const CLAUSE_STATUS: Record<ClauseKey, { label: string; color: ColorName }> = {
  present: { label: 'Present', color: 'green' },
  partial: { label: 'Partial', color: 'amber' },
  absent: { label: 'Absent', color: 'red' },
  none: { label: 'Not assessed', color: 'gray' },
};
export const CLAUSE_ORDER: ClauseKey[] = ['present', 'partial', 'absent', 'none'];

export function ClauseChip({ status }: { status: ClauseStatus | null | undefined }) {
  const s = CLAUSE_STATUS[status ?? 'none'];
  return <StatusChip color={s.color} label={s.label} />;
}

/** The mark drawn in a matrix cell: tick, half-filled circle, cross, or a dot for not assessed. */
export function ClauseGlyph({ status, size = 16 }: { status: ClauseKey; size?: number }) {
  if (status === 'present') return <Icon name="check" size={size} />;
  if (status === 'absent') return <Icon name="x" size={size} />;
  if (status === 'partial') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 2.75a5.25 5.25 0 0 0 0 10.5z" fill="currentColor" />
      </svg>
    );
  }
  return <span className="vnd-glyph-none" aria-hidden="true" />;
}

const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

/** "in 12 days", "today", "5 days ago". */
export function daysPhrase(left: number): string {
  if (left === 0) return 'today';
  return left > 0 ? `in ${days(left)}` : `${days(-left)} ago`;
}

/** Whole days from today (in the organization's time zone) to a calendar date. */
export function daysUntil(date: string, today: string = todayInZone()): number {
  return Math.round((Date.parse(`${date.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Expiry chip for evidence: red when expired, amber inside 90 days, green beyond, gray with no date. */
export function ExpiryChip({ date }: { date: string | null | undefined }) {
  if (!date) return <StatusChip color="gray" label="No expiry" />;
  const left = daysUntil(date);
  if (left < 0) return <StatusChip color="red" label={`Expired ${daysPhrase(left)}`} />;
  if (left <= 90) return <StatusChip color="amber" label={`Expires ${daysPhrase(left)}`} />;
  return <StatusChip color="green" label={`Valid to ${formatDate(date)}`} />;
}

/** Color of a notice date: red when passed or inside 30 days, amber inside 120, green beyond. */
export function noticeTone(date: string | null | undefined): ColorName {
  if (!date) return 'gray';
  const left = daysUntil(date);
  return left <= 30 ? 'red' : left <= 120 ? 'amber' : 'green';
}

/** Notice-date chip for contracts. */
export function NoticeChip({ date }: { date: string | null | undefined }) {
  if (!date) return <StatusChip color="gray" label="No notice date" />;
  const left = daysUntil(date);
  if (left < 0) return <StatusChip color="red" label={`Notice date passed ${daysPhrase(left)}`} />;
  if (left <= 120) return <StatusChip color={noticeTone(date)} label={`Notice due ${daysPhrase(left)}`} />;
  return <StatusChip color="green" label={`Notice due ${formatDate(date)}`} />;
}

/** What happens to a contract if nobody acts, in one sentence, from its renewal type and dates. */
export function ifWeDoNothing(c: Row | { renewal_mechanism?: string | null; end_date?: string | null; notice_date?: string | null; status?: string | null }): string {
  if (c.status === 'terminated' || c.status === 'expired') return 'Nothing: this contract has ended.';
  const end = c.end_date ? formatDate(c.end_date) : null;
  const passed = c.notice_date ? daysUntil(c.notice_date) < 0 : false;
  switch (c.renewal_mechanism) {
    case 'auto_renew':
      if (!end) return 'It renews automatically, but no end date is recorded, so nobody will be warned before it does.';
      return passed
        ? `It renews automatically on ${end}. The last day to stop that has passed.`
        : `It renews automatically on ${end} for a further term, at whatever price the contract allows.`;
    case 'fixed':
      return end
        ? `It ends on ${end}. The service stops unless a new contract is agreed before then.`
        : 'It ends at the close of its fixed term, but no end date is recorded.';
    case 'option':
      return end
        ? `The option to extend lapses and the contract ends on ${end}.`
        : 'The option to extend lapses at the end of the term, but no end date is recorded.';
    case 'evergreen':
      return 'It carries on, and keeps being charged, until one side gives notice.';
    default:
      return end
        ? `Unclear, because the renewal terms are not recorded. Read the contract before ${end}.`
        : 'Unclear, because neither the renewal terms nor an end date are recorded.';
  }
}

/* ---------- coverage meter ---------- */

const METER_KEYS: { key: keyof TermCounts; status: ClauseKey }[] = [
  { key: 'present', status: 'present' }, { key: 'partial', status: 'partial' },
  { key: 'absent', status: 'absent' }, { key: 'not_assessed', status: 'none' },
];

export function termsSentence(t: TermCounts): string {
  return `${t.present} present, ${t.partial} partial, ${t.absent} absent, ${t.not_assessed} not assessed`;
}

/**
 * Security-terms coverage at a glance: one stacked bar (present, partial, absent, not
 * assessed), with the counts as a legend unless `compact`.
 */
export function CoverageMeter({ terms, compact, label = 'Security terms' }: { terms: TermCounts; compact?: boolean; label?: string }) {
  const total = terms.present + terms.partial + terms.absent + terms.not_assessed;
  const bar = (
    <span className="vnd-meter-bar" role="img" aria-label={`${label}: ${termsSentence(terms)}`}>
      {total === 0 && <span className="vnd-meter-seg vnd-meter-none" style={{ flexGrow: 1 }} />}
      {METER_KEYS.filter((m) => terms[m.key] > 0).map((m) => (
        <span key={m.key} className={`vnd-meter-seg vnd-meter-${m.status}`} style={{ flexGrow: terms[m.key] }} />
      ))}
    </span>
  );
  if (compact) {
    return (
      <Tooltip label={termsSentence(terms)} withArrow>
        <span className="vnd-meter vnd-meter-compact">
          {bar}
          <span className="vnd-meter-count">{terms.present}/{total}</span>
        </span>
      </Tooltip>
    );
  }
  return (
    <div className="vnd-meter">
      {bar}
      <ul className="vnd-meter-legend">
        {METER_KEYS.map((m) => (
          <li key={m.key} className={cx(terms[m.key] === 0 && 'vnd-meter-zero')}>
            <span className={`vnd-swatch vnd-meter-${m.status}`} aria-hidden="true" />
            <strong>{terms[m.key]}</strong> {CLAUSE_STATUS[m.status].label.toLowerCase()}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- panels from other modules, loaded only when those modules are part of the build ---------- */

const actionLoaders = import.meta.glob<{ ActionsPanel: ComponentType<{ sourceType: string; sourceId: string; source?: string }> }>(
  '../risks/ActionsPanel.tsx',
);
const loadActions = Object.values(actionLoaders)[0];
const LazyActions = loadActions ? lazy(() => loadActions().then((m) => ({ default: m.ActionsPanel }))) : null;

/** Whether the shared Actions panel can be shown: the code is in the build and the server has the `action` type. */
export function useActionsAvailable(): boolean {
  return Boolean(useResource('action')) && LazyActions !== null;
}

export function ActionsTab({ sourceType, sourceId }: { sourceType: string; sourceId: string }) {
  if (!LazyActions) return null;
  return (
    <Suspense fallback={<Loading lines={3} label="Loading actions" />}>
      <LazyActions sourceType={sourceType} sourceId={sourceId} />
    </Suspense>
  );
}

const fileLoaders = import.meta.glob<{ AttachmentsPanel: ComponentType<{ recordType: string; recordId: string; evidence?: boolean }> }>(
  '../attachments/AttachmentsPanel.tsx',
);
const loadFiles = Object.values(fileLoaders)[0];
const LazyFiles = loadFiles ? lazy(() => loadFiles().then((m) => ({ default: m.AttachmentsPanel }))) : null;

export const filesAvailable = LazyFiles !== null;

/** The attachments panel for a record; with `evidence`, new files carry a collection and expiry date. */
export function FilesPanel({ recordType, recordId, evidence }: { recordType: string; recordId: string; evidence?: boolean }) {
  if (!LazyFiles) {
    return <EmptyState icon="file-text" title="Files are not available" message="The attachments service is not part of this installation." />;
  }
  return (
    <Suspense fallback={<Loading lines={3} label="Loading files" />}>
      <LazyFiles recordType={recordType} recordId={recordId} evidence={evidence} />
    </Suspense>
  );
}

/** Reference and title of a contract row as one string. */
export const contractName = (c: Row | { ref?: string | null; title?: string }) => [c.ref, c.title].filter(Boolean).join(' ');
