// The log of periodic statistical reports submitted to outside bodies: what is due when, who prepares
// it, when it was submitted, by whom, and the confirmation received; files are kept on each record.
import { PageHeader, RecordPage, ResourceList, Stat, useFetch, type Crumb } from '../../core';
import type { Summary } from './shared';
import './strategy.css';

const CREATE = ['report_name', 'recipient', 'period', 'due_on', 'owner_id', 'status', 'submitted_on', 'submitted_by', 'confirmation', 'notes'];
const CRUMBS: Crumb[] = [{ label: 'Statistical submissions', to: '/strategy/submissions' }];

export function SubmissionsPage() {
  const { data: s } = useFetch<Summary>('/api/strategy/summary');
  return (
    <div className="stack">
      <PageHeader title="Statistical submissions" subtitle="Periodic statistical reports to outside bodies: when each is due, who prepares it, and when it was submitted with its confirmation. The preparer is reminded before the due date." />
      {s && (
        <div className="grid-stats">
          <Stat label="Overdue" icon="alert" value={s.submissions.overdue} color={s.submissions.overdue ? 'red' : 'green'} hint="Past the due date, not submitted" />
          <Stat label="Due soon" icon="clock" value={s.submissions.due_soon} color={s.submissions.due_soon ? 'amber' : undefined} hint={`Within ${s.due_soon_days} days`} />
          <Stat label="Not yet submitted" icon="upload" value={s.submissions.open} />
        </div>
      )}
      <ResourceList
        type="stat_submission"
        urlState
        defaultSort={{ field: 'due_on', dir: 'asc' }}
        columns={['ref', 'report_name', { field: 'recipient', priority: 2 }, 'period', 'due_on', 'status', { field: 'submitted_on', priority: 2 }, { field: 'owner_id', priority: 3 }, { field: 'confirmation', priority: 3 }]}
        filters={['status', 'recipient', 'due_on', 'submitted_on', 'owner_id']}
        createFields={CREATE}
      />
    </div>
  );
}

export function SubmissionDetail() {
  return (
    <RecordPage
      type="stat_submission"
      breadcrumbs={CRUMBS}
      summaryFields={CREATE}
    />
  );
}
