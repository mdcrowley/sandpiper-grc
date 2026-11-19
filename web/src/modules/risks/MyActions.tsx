import { Link } from 'react-router-dom';
import { Card, EmptyState, ErrorState, formatDate, Loading, PageHeader, Stat, useAuth, useFetch } from '../../core';
import type { ListResult, Row } from '../../core';
import { ActionRows, QuickAdd } from './ActionRows';
import type { ActionSummary } from './ActionTracker';

/**
 * One person's actions: what is overdue, what is due this week, what comes later, and any
 * restricted action that has been shared with them by name.
 */
export function MyActions() {
  const { user, can } = useAuth();
  const summary = useFetch<ActionSummary>('/api/actions/summary');
  const s = summary.data;
  const mine = useFetch<ListResult>(s ? `/api/actions?f.owner_id=me&f.status=${s.open_statuses.join(',')}&sort=due_on&dir=asc&pageSize=500` : null);
  const shared = useFetch<Row[]>('/api/actions/shared-with-me');
  const done = useFetch<ListResult>('/api/actions?f.owner_id=me&f.completed_on.null=false&sort=completed_on&dir=desc&pageSize=5');
  const reload = () => { summary.reload(); mine.reload(); shared.reload(); done.reload(); };

  if (summary.error) return <><PageHeader title="My actions" /><ErrorState error={summary.error} onRetry={summary.reload} /></>;
  if (!s || !mine.data) return <><PageHeader title="My actions" />{mine.error ? <ErrorState error={mine.error} onRetry={mine.reload} /> : <Loading />}</>;

  const rows = mine.data.rows;
  const overdue = rows.filter((r) => r.due_on && r.due_on < s.today);
  const week = rows.filter((r) => r.due_on && r.due_on >= s.today && r.due_on <= s.week_end);
  const later = rows.filter((r) => r.due_on && r.due_on > s.week_end);
  const undated = rows.filter((r) => !r.due_on);
  const sharedOpen = (shared.data ?? []).filter((r) => s.open_statuses.includes(r.status));
  const section = (title: string, list: Row[], tone?: string) => list.length > 0 && (
    <Card flush className={tone ? `rk-group rk-group-${tone}` : 'rk-group'} title={<>{title}<span className="tab-count rk-panel-count">{list.length}</span></>}>
      <ActionRows rows={list} today={s.today} openStatuses={s.open_statuses} onChanged={reload} caption={title} show={{ owner: false, priority: true, source: true }} />
    </Card>
  );

  return (
    <div className="stack rk-tracker">
      <PageHeader
        title="My actions"
        subtitle="Open actions you own, most urgent first."
        breadcrumbs={[{ label: 'Action tracker', to: '/actions' }, { label: 'My actions' }]}
        actions={<Link className="btn btn-secondary" to="/actions">All actions</Link>}
      />
      <div className="grid-stats">
        <Stat label="Open" value={s.mine.open} color="blue" hint="Yours, not done or canceled" />
        <Stat label="Overdue" value={s.mine.overdue} color={s.mine.overdue > 0 ? 'red' : 'green'} hint="Past the due date" />
        <Stat label="Due this week" value={s.mine.due_this_week} color="amber" hint={`By ${formatDate(s.week_end)}`} />
      </div>

      {can('actions.create') && user && (
        <div className="rk-tracker-quick">
          <QuickAdd initial={{ owner_id: user.id }} onAdded={reload} placeholder="Add an action for yourself and press Enter" />
        </div>
      )}

      {rows.length === 0 && sharedOpen.length === 0 && (
        <Card><EmptyState icon="check-circle" title="Nothing open" message="You have no open actions. Anything assigned to you will appear here." /></Card>
      )}
      {section('Overdue', overdue, 'red')}
      {section('Due this week', week)}
      {section('Later', later)}
      {section('No due date', undated)}

      {shared.data && shared.data.length > 0 && (
        <Card flush className="rk-group" title={<>Shared with you<span className="tab-count rk-panel-count">{shared.data.length}</span></>}>
          <p className="muted rk-panel-pad">
            Restricted actions that someone has shared with you by name. You can change the status here; the record each one arose from stays hidden.
          </p>
          <ActionRows rows={shared.data} today={s.today} openStatuses={s.open_statuses} onChanged={reload} caption="Shared with you" show={{ owner: true, priority: true }} />
        </Card>
      )}

      {done.data && done.data.rows.length > 0 && (
        <Card flush className="rk-group" title="Recently finished">
          <ActionRows rows={done.data.rows} today={s.today} openStatuses={s.open_statuses} onChanged={reload} caption="Recently finished" show={{ owner: false }} />
        </Card>
      )}
    </div>
  );
}
