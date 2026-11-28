// Civil rights complaints: the list (confidential complaints are counted for everyone and listed only
// for the named handlers, the investigator and who entered them), and one complaint with its intake,
// time limits, investigation steps and letters, findings, outcome and appeal.
import {
  Card, EditableSummary, ErrorState, formatDate, KeyValue, Loading, Notice, PageHeader, RecordPage, ResourceList, StatusChip, useAuth, useFetch,
} from '../../core';
import type { ColorName, Row } from '../../core';
import { ChildTable, type ChildField } from './ChildTable';
import { DueChip, Figure, useSummary } from './shared';
import './civilrights.css';

const CREATE = [
  'subject', 'received_on', 'channel', 'anonymous', 'complainant_name', 'complainant_contact', 'language_needed', 'basis', 'program_id',
  'service_id', 'vehicle_id', 'site_id', 'employee_id', 'occurred_on', 'description', 'investigator_id', 'confidential',
];

function ComplaintFigures() {
  const { data, error, reload } = useSummary();
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={1} />;
  const c = data.complaints;
  return (
    <div className="cr-figures" role="group" aria-label="Complaint figures">
      <Figure value={c.open} label="Open" />
      <Figure value={c.ack_overdue} label="Not acknowledged in time" tone={c.ack_overdue ? 'red' : undefined} />
      <Figure value={c.overdue} label="Past a time limit" tone={c.overdue ? 'red' : undefined} />
      <Figure value={c.received_this_year} label="Received this year" />
    </div>
  );
}

function HandlersNotice() {
  const { data } = useFetch<{ named: boolean; handlers: unknown[] }>('/api/civil-rights/complaint-handlers');
  if (!data || data.named) return null;
  return (
    <Notice tone="info">
      Confidential complaints are counted above but listed only for the named complaint handlers, each complaint's investigator and the
      person who entered it. {data.handlers.length ? '' : 'Nobody is named yet: an administrator names the handlers under Settings.'}
    </Notice>
  );
}

export function ComplaintList() {
  return (
    <div className="stack">
      <PageHeader title="Civil rights complaints" subtitle="Complaints of discrimination or inaccessible service, each with its time limits, investigation and outcome." />
      <ComplaintFigures />
      <HandlersNotice />
      <ResourceList
        type="civil_rights_complaint"
        urlState
        columns={[
          'ref', 'subject', 'received_on', 'basis', 'status',
          { field: 'next_due_on', label: 'Next due', priority: 1, sortable: true, render: (r) => (r.next_due_on ? <DueChip date={r.next_due_on} /> : <span className="muted">None</span>) },
          'investigator_id', { field: 'confidential', priority: 3 },
        ]}
        filters={['status', 'basis', 'channel', 'program_id', 'investigator_id', 'received_on', 'next_due_on', 'confidential']}
        createFields={CREATE}
      />
    </div>
  );
}

interface Clock {
  limits: { key: string; label: string; due_on: string; done_on: string | null; state: string; days_left: number | null }[];
  next_due_on: string | null; overdue: boolean; steps: { open: number; overdue: number };
}

const LIMIT: Record<string, { color: ColorName; label: string }> = {
  open: { color: 'gray', label: 'Open' }, soon: { color: 'amber', label: 'Due soon' }, overdue: { color: 'red', label: 'Overdue' },
  met: { color: 'green', label: 'Met' }, late: { color: 'amber', label: 'Met late' }, stopped: { color: 'gray', label: 'Stopped' },
};

function LimitsTab({ complaint }: { complaint: Row }) {
  const { data, error, reload } = useFetch<Clock>(`/api/civil-rights/complaints/${complaint.id}/clock?v=${complaint.updated_at}`);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={3} />;
  return (
    <Card title="Time limits">
      <div className="cr-stack">
        <KeyValue items={data.limits.map((l) => ({
          label: l.label,
          value: (
            <span>
              <StatusChip size="sm" color={LIMIT[l.state]?.color ?? 'gray'} label={LIMIT[l.state]?.label ?? l.state} />{' '}
              Due {formatDate(l.due_on)}{l.done_on ? `, done ${formatDate(l.done_on)}` : l.days_left != null && l.days_left >= 0 ? `, ${l.days_left} day${l.days_left === 1 ? '' : 's'} left` : ''}
            </span>
          ),
        }))} />
        <p className="muted">
          {data.steps.open} open investigation step{data.steps.open === 1 ? '' : 's'}{data.steps.overdue ? `, ${data.steps.overdue} overdue` : ''}.
          The limits are counted from the day received (and the day an appeal arrived) by the days set under Civil rights, Settings.
        </p>
      </div>
    </Card>
  );
}

function StepsTab({ complaint }: { complaint: Row }) {
  const { can } = useAuth();
  const editable = can('civilrights.edit');
  const stepFields: ChildField[] = [
    { name: 'title', label: 'Step', kind: 'text', required: true },
    { name: 'due_on', label: 'Due on', kind: 'date' },
    { name: 'done_on', label: 'Done on', kind: 'date' },
    { name: 'note', label: 'Note', kind: 'longtext' },
  ];
  const letterFields: ChildField[] = [
    { name: 'title', label: 'Letter', kind: 'text', required: true, hint: 'For example "Acknowledgment letter" or "Findings letter".' },
    { name: 'done_on', label: 'Sent on', kind: 'date' },
    { name: 'note', label: 'Note', kind: 'longtext', hint: 'Attach the letter itself under Files.' },
  ];
  const done = (r: Row) => (r.done_on ? `${formatDate(r.done_on)}${r.done_by_name ? ` by ${r.done_by_name}` : ''}` : '');
  return (
    <div className="cr-stack">
      <ChildTable url={`/api/civil-rights/complaints/${complaint.id}/steps`} kind="step" title="Investigation steps" noun="step" fields={stepFields}
        canEdit={editable} emptyTitle="No investigation steps yet" emptyMessage="Plan the interviews, records to review and site visits, each with a due date."
        columns={[
          { label: 'Step', priority: 1, render: (r) => r.title },
          { label: 'Due', render: (r) => (r.due_on ? <DueChip date={r.due_on} done={Boolean(r.done_on)} /> : '') },
          { label: 'Done', priority: 1, render: (r) => done(r) || <span className="muted">Not yet</span> },
          { label: 'Note', priority: 3, render: (r) => r.note ?? '' },
        ]} />
      <ChildTable url={`/api/civil-rights/complaints/${complaint.id}/steps`} kind="letter" title="Letters sent" noun="letter" fields={letterFields}
        canEdit={editable} emptyTitle="No letters recorded yet" emptyMessage="Record each letter sent to the complainant; attach its copy under Files."
        columns={[
          { label: 'Letter', priority: 1, render: (r) => r.title },
          { label: 'Sent', priority: 1, render: (r) => done(r) || <span className="muted">Not sent</span> },
          { label: 'Note', priority: 3, render: (r) => r.note ?? '' },
        ]} />
    </div>
  );
}

export function ComplaintDetail() {
  return (
    <RecordPage
      type="civil_rights_complaint"
      banner={({ row }) => (row.confidential ? <Notice tone="info">Confidential: only the named complaint handlers, the investigator and the person who entered it can see this complaint.</Notice> : null)}
      summary={({ row, reload }) => (
        <div className="cr-summary">
          <EditableSummary type="civil_rights_complaint" row={row} onSaved={reload} title="Complaint"
            fields={['subject', 'status', 'received_on', 'channel', 'basis', 'program_id', 'investigator_id', 'confidential']} />
          <EditableSummary type="civil_rights_complaint" row={row} onSaved={reload} title="Complainant"
            fields={['anonymous', 'complainant_name', 'complainant_contact', 'language_needed']} />
          <EditableSummary type="civil_rights_complaint" row={row} onSaved={reload} title="What happened"
            fields={['occurred_on', 'service_id', 'vehicle_id', 'site_id', 'employee_id', 'description']} />
        </div>
      )}
      tabs={[
        { key: 'limits', label: 'Time limits', content: ({ row }) => <LimitsTab complaint={row} /> },
        { key: 'steps', label: 'Steps and letters', content: ({ row }) => <StepsTab complaint={row} /> },
        {
          key: 'outcome', label: 'Findings and outcome',
          content: ({ row, reload }) => (
            <div className="cr-summary">
              <EditableSummary type="civil_rights_complaint" row={row} onSaved={reload} title="Findings and outcome"
                fields={['acknowledged_on', 'findings', 'findings_on', 'outcome', 'closed_on']} />
              <EditableSummary type="civil_rights_complaint" row={row} onSaved={reload} title="Appeal"
                fields={['appeal_received_on', 'appeal_due_on', 'appeal_decision', 'appeal_decided_on']} />
            </div>
          ),
        },
      ]}
    />
  );
}
