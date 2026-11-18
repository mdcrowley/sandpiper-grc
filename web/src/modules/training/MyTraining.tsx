// The signed-in user's own training: what is to do, and what has been completed.
import { Card, EmptyState, ErrorState, formatDate, Loading, PageHeader, Stat, useFetch } from '../../core';
import { RecordStatusChip, ResultCell, WhenCell } from './shared';
import type { TrainingRecord } from './shared';

interface Mine { today: string; rows: TrainingRecord[] }

function Table({ caption, rows, today, done }: { caption: string; rows: TrainingRecord[]; today: string; done: boolean }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Course</th><th scope="col">Status</th>
            <th scope="col">{done ? 'Completed' : 'Due'}</th><th scope="col">{done ? 'Result' : 'Assigned'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.course_ref && <span className="ref">{r.course_ref}</span>}<span className="row-title">{r.course_title}</span></td>
              <td><RecordStatusChip record={r} today={today} /></td>
              <td><WhenCell record={r} today={today} /></td>
              <td>{done ? <ResultCell record={r} /> : formatDate(r.assigned_on)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MyTraining() {
  const { data, error, reload } = useFetch<Mine>('/api/training/mine');
  const header = <PageHeader title="My training" subtitle="Courses you have been given and the ones you have completed." />;
  if (error) return <div className="stack">{header}<ErrorState error={error} onRetry={reload} /></div>;
  if (!data) return <div className="stack">{header}<Loading lines={6} label="Loading your training" /></div>;
  if (!data.rows.length) {
    return (
      <div className="stack">
        {header}
        <EmptyState icon="graduation" title="You have no training to do" message="When a course is assigned to you it appears here with its due date." />
      </div>
    );
  }
  const todo = data.rows.filter((r) => r.status !== 'complete');
  const done = data.rows.filter((r) => r.status === 'complete');
  const overdue = todo.filter((r) => r.status === 'overdue').length;
  return (
    <div className="stack">
      {header}
      <div className="grid-stats">
        <Stat label="To do" value={todo.length} color={todo.length ? 'blue' : 'green'} />
        <Stat label="Overdue" value={overdue} color={overdue ? 'red' : 'green'} />
        <Stat label="Completed" value={done.length} color="green" />
      </div>
      <Card title="To do" flush={todo.length > 0}>
        {todo.length
          ? <Table caption="Training you still have to complete" rows={todo} today={data.today} done={false} />
          : <EmptyState icon="check" title="You are up to date" message="There is nothing for you to complete at the moment." />}
        {todo.length > 0 && (
          <p className="muted trn-more">When you have finished a course, tell the course owner or your manager so that it can be recorded.</p>
        )}
      </Card>
      {done.length > 0 && (
        <Card title="Completed" flush><Table caption="Training you have completed" rows={done} today={data.today} done /></Card>
      )}
    </div>
  );
}
