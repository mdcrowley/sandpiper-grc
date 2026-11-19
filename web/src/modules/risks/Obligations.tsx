import { lazy, Suspense, type ComponentType } from 'react';
import { Card, formatDate, Loading, LookupChip, PageHeader, RecordPage, ResourceList, Stat, todayInZone, useFetch } from '../../core';
import type { ListResult, StatsResult } from '../../core';
import { DueChip } from './scales';

// The attachments module supplies the evidence panel. It is found at build time and loaded on
// first use, so this module still builds and runs when that folder is absent.
const loaders = import.meta.glob<{ AttachmentsPanel: ComponentType<{ recordType: string; recordId: string; evidence?: boolean }> }>(
  '../attachments/AttachmentsPanel.tsx',
);
const load = Object.values(loaders)[0];
const AttachmentsPanel = load ? lazy(() => load().then((m) => ({ default: m.AttachmentsPanel }))) : null;

const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The obligations register: what must be done, whether it is met, and what is due next. */
export function ObligationList() {
  const today = todayInZone();
  const soon = addDays(today, 30);
  const stats = useFetch<StatsResult>('/api/obligations/stats?group=status');
  const overdue = useFetch<ListResult>(`/api/obligations?f.next_due_on.lt=${today}&pageSize=1`);
  const due = useFetch<ListResult>(`/api/obligations?f.next_due_on.gte=${today}&f.next_due_on.lte=${soon}&pageSize=1`);
  const count = (value: string) => stats.data?.groups.find((g) => g.value === value);

  return (
    <div className="stack">
      <PageHeader title="Obligations" subtitle="What the organization is required to do, who owns each requirement, how it is met and when it is next due." />
      <div className="grid-stats">
        <Stat label="Obligations" value={stats.data?.total ?? '–'} color="blue" icon="scale" />
        <Stat label={count('not_met')?.label ?? 'Not met'} value={count('not_met')?.count ?? 0} color={(count('not_met')?.count ?? 0) > 0 ? 'red' : 'green'} to="/obligations?f.status=not_met" />
        <Stat label={count('partly_met')?.label ?? 'Partly met'} value={count('partly_met')?.count ?? 0} color="amber" to="/obligations?f.status=partly_met" />
        <Stat label="Overdue" value={overdue.data?.total ?? '–'} color={(overdue.data?.total ?? 0) > 0 ? 'red' : 'green'} to={`/obligations?f.next_due_on.lt=${today}&sort=next_due_on&dir=asc`} hint="Next due date has passed" />
        <Stat label="Due in 30 days" value={due.data?.total ?? '–'} color="amber" to={`/obligations?f.next_due_on.gt=${addDays(today, -1)}&f.next_due_on.lt=${addDays(soon, 1)}&sort=next_due_on&dir=asc`} hint="Not yet overdue" />
      </div>
      <ResourceList
        type="obligation"
        urlState
        columns={[
          'ref', 'title', 'source', 'status', 'owner_id',
          {
            field: 'next_due_on', label: 'Next due', sortable: true,
            render: (row) => (row.next_due_on
              ? <span className="rk-two-line"><span>{formatDate(row.next_due_on)}</span><DueChip date={row.next_due_on} warnDays={30} /></span>
              : <span className="muted">No date</span>),
          },
          { field: 'how_met', hidden: true }, { field: 'evidence', hidden: true },
        ]}
        filters={['status', 'owner_id', 'next_due_on']}
        bulkFields={['status', 'owner_id', 'next_due_on']}
        defaultSort={{ field: 'next_due_on', dir: 'asc' }}
        createFields={['title', 'source', 'requirement', 'owner_id', 'how_met', 'evidence', 'next_due_on', 'status']}
      />
    </div>
  );
}

export function ObligationDetail() {
  return (
    <RecordPage
      type="obligation"
      subtitle={(row) => row.source}
      banner={({ row }) => (
        <div className="rk-obl-banner">
          <div>
            <span className="rk-step-label">Status</span>
            <LookupChip list="obligation_status" value={row.status} />
          </div>
          <div>
            <span className="rk-step-label">Next due</span>
            <span className="row">
              <strong>{row.next_due_on ? formatDate(row.next_due_on) : 'No date set'}</strong>
              {row.next_due_on && <DueChip date={row.next_due_on} warnDays={30} />}
            </span>
          </div>
          <div>
            <span className="rk-step-label">Owner</span>
            <span>{row._display?.owner_id ?? <span className="muted">No owner</span>}</span>
          </div>
        </div>
      )}
      summaryFields={['title', 'source', 'requirement', 'status', 'owner_id', 'how_met', 'evidence', 'next_due_on']}
      tabs={AttachmentsPanel ? [{
        key: 'attachments', label: 'Evidence',
        content: ({ row }) => (
          <Card title="Evidence files">
            <p className="muted" style={{ margin: 0 }}>Attach the proof that this obligation is met: a signed form, a report, a certificate. Say where else evidence is kept in the Evidence field.</p>
            <Suspense fallback={<Loading lines={3} label="Loading evidence" />}>
              <AttachmentsPanel recordType="obligation" recordId={row.id} evidence />
            </Suspense>
          </Card>
        ),
      }] : []}
    />
  );
}
