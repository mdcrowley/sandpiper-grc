import { Link } from 'react-router-dom';
import { formatDate, PageHeader, ResourceList, Stat, todayInZone, useFetch, useMeta } from '../../core';
import type { Row } from '../../core';
import './risks.css';
import './caps.css';

// The corrective action plan register across sources (E23-06, /caps): every plan from risks,
// audits, control tests, funder reviews and safety events, with saved views and export from the
// shared list. The tiles are figures, the same for everyone; the list shows what the reader may see.

interface Summary {
  open: number; overdue: number; awaiting_approval: number; verifying: number; restricted: number;
  actions_awaiting_verification: number; verification_overdue: number;
}

export function CapRegister() {
  const { resources } = useMeta();
  const today = todayInZone();
  const summary = useFetch<Summary>('/api/caps/summary');
  const s = summary.data;
  const sourceLink = (row: Row) => {
    const target = row.source_type ? resources[row.source_type] : undefined;
    return target && row.source_id
      ? <Link to={`${target.route}/${row.source_id}`} onClick={(e) => e.stopPropagation()}>{target.label}</Link>
      : <span className="muted">None</span>;
  };
  const late = (row: Row) => Boolean(row.due_on) && row.due_on < today && !row.closed_on && row.status !== 'rejected';

  return (
    <div className="stack">
      <PageHeader
        title="Corrective action plans"
        subtitle="Plans that fix the root cause of a finding, event, failed test or deficiency, from every part of the application."
        actions={<Link className="btn btn-secondary" to="/actions?show=verify">Actions awaiting verification</Link>}
      />
      <div className="grid-stats">
        <Stat label="Open plans" value={s?.open ?? '–'} color="blue" icon="clipboard" hint="Not closed or rejected" to="/caps?f.closed_on.null=true" />
        <Stat label="Overdue" value={s?.overdue ?? '–'} color={(s?.overdue ?? 0) > 0 ? 'red' : 'green'} hint="Past the plan's due date" to={`/caps?f.due_on.lt=${today}&f.closed_on.null=true`} />
        <Stat label="Awaiting approval" value={s?.awaiting_approval ?? '–'} color="amber" to="/caps?f.status=submitted" />
        <Stat
          label="Actions to verify" value={s?.actions_awaiting_verification ?? '–'} color="purple"
          hint={s && s.verification_overdue > 0 ? `${s.verification_overdue} past the verification date` : 'Finished, not yet checked'}
          to="/caps?f.actions_awaiting.gt=0"
        />
      </div>
      <ResourceList
        type="cap"
        urlState
        columns={[
          'ref', 'title', 'status',
          { field: 'source_type', label: 'Raised on', render: sourceLink },
          'responsible_id',
          {
            field: 'due_on', label: 'Due', sortable: true,
            render: (row) => <span className={late(row) ? 'is-overdue' : undefined}>{formatDate(row.due_on)}{late(row) ? ' (overdue)' : ''}</span>,
          },
          {
            field: 'actions_done', label: 'Actions', sortable: true,
            render: (row) => (
              <span className="cap-count">
                {row.actions_done ?? 0} of {row.actions_total ?? 0} done
                {row.actions_awaiting > 0 && <span className="chip chip-purple">{row.actions_awaiting} to verify</span>}
              </span>
            ),
          },
          { field: 'source', hidden: true }, { field: 'root_cause_category', hidden: true }, { field: 'approved_on', hidden: true },
          { field: 'closed_on', hidden: true },
        ]}
        filters={['status', 'source', 'responsible_id', 'root_cause_category', 'due_on', 'actions_awaiting']}
        bulkFields={['responsible_id', 'due_on']}
        defaultSort={{ field: 'due_on', dir: 'asc' }}
        createFields={['title', 'problem_statement', 'root_cause', 'root_cause_category', 'source', 'responsible_id', 'due_on']}
      />
    </div>
  );
}
