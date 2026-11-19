// Exercise calendar: what is overdue, what is coming up month by month, and when each kind was last run.
import { Link, useNavigate } from 'react-router-dom';
import {
  Badge, Button, Card, EmptyState, ErrorState, formatDate, Loading, LookupChip, PageHeader, Stat, StatusChip, toColorName,
  useAuth, useFetch,
} from '../../core';
import { daysPhrase } from './shared';

interface Entry {
  id: string; ref: string | null; title: string; type: string | null; type_label: string; kind: 'planned' | 'repeat';
  date: string | null; last_run: string | null; owner_name: string | null; facilitator: string | null;
}
interface TypeRow {
  type: string; label: string; color: string; completed: number; last_run: string | null; last_id: string | null;
  last_result: string | null; next_due: string | null; next_id: string | null; overdue: boolean;
  /** How the steps of the last run went (E10-17), when it had steps. */
  last_steps: StepTally | null;
}
interface StepTally { total: number; went_well: number; with_issues: number; not_done: number; not_tested: number; unrecorded: number }

const STEP_PARTS: { key: keyof Omit<StepTally, 'total'>; label: string; color: string }[] = [
  { key: 'went_well', label: 'went well', color: 'green' }, { key: 'with_issues', label: 'with issues', color: 'amber' },
  { key: 'not_done', label: 'not done', color: 'red' }, { key: 'not_tested', label: 'not tested', color: 'gray' },
  { key: 'unrecorded', label: 'not recorded', color: 'gray' },
];

/** A thin bar of how the steps went, with the counts in words beside it. */
function StepsBar({ steps }: { steps: StepTally }) {
  const words = STEP_PARTS.filter((p) => steps[p.key] > 0).map((p) => `${steps[p.key]} ${p.label}`).join(', ');
  return (
    <span className="trn-stepsbar-wrap">
      <span className="trn-stepsbar" aria-hidden="true">
        {STEP_PARTS.filter((p) => steps[p.key] > 0).map((p) => (
          <span key={p.key} className={p.key === 'unrecorded' ? 'trn-stepsbar-none' : undefined}
            style={{ width: `${(steps[p.key] / steps.total) * 100}%`, background: p.key === 'unrecorded' ? undefined : `var(--c-${p.color}-solid)` }} />
        ))}
      </span>
      <span className="trn-stepsbar-text">{steps.total} steps: {words}</span>
    </span>
  );
}
interface Calendar { today: string; overdue: Entry[]; upcoming: Entry[]; undated: Entry[]; by_type: TypeRow[] }

const monthName = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function EntryList({ entries, today, late }: { entries: Entry[]; today: string; late?: boolean }) {
  return (
    <ul className="trn-cal">
      {entries.map((e) => (
        <li key={`${e.kind}-${e.id}`} className={late ? 'trn-cal-late' : undefined}>
          <div className="trn-cal-date">
            {e.date ? (
              <>
                <span className="trn-cal-day">{formatDate(e.date)}</span>
                <span className={late ? 'trn-late' : 'muted'}>{daysPhrase(today, e.date)}</span>
              </>
            ) : <span className="muted">No date</span>}
          </div>
          <div className="trn-cal-main">
            <div className="row">
              <Badge color={e.kind === 'planned' ? 'blue' : 'purple'}>{e.kind === 'planned' ? 'Planned' : 'Next run due'}</Badge>
              <span className="muted">{e.type_label}</span>
            </div>
            <Link className="row-title" to={`/exercises/${e.id}`}>{e.ref ? `${e.ref} ` : ''}{e.title}</Link>
            <span className="muted">
              {e.kind === 'repeat' ? `Last run ${formatDate(e.last_run)}. Plan the next one.` : [e.facilitator && `Facilitator: ${e.facilitator}`, e.owner_name && `Owner: ${e.owner_name}`].filter(Boolean).join(' · ') || 'Planned exercise'}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ExerciseCalendar() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { data, error, reload } = useFetch<Calendar>('/api/exercises/calendar');
  const header = (
    <PageHeader
      title="Exercise calendar" breadcrumbs={[{ label: 'Exercises', to: '/exercises' }, { label: 'Calendar' }]}
      subtitle="Planned exercises by date, and the next run of each completed exercise that has a next due date."
      actions={can('exercises.create') ? <Button variant="primary" icon="plus" onClick={() => navigate('/exercises?new=1')}>New exercise</Button> : undefined}
    />
  );
  if (error) return <div className="stack">{header}<ErrorState error={error} onRetry={reload} /></div>;
  if (!data) return <div className="stack">{header}<Loading lines={8} label="Loading the exercise calendar" /></div>;

  const months = new Map<string, Entry[]>();
  for (const e of data.upcoming) {
    const key = String(e.date).slice(0, 7);
    if (!months.has(key)) months.set(key, []);
    months.get(key)!.push(e);
  }
  const nothing = !data.overdue.length && !data.upcoming.length && !data.undated.length;
  const next = data.upcoming[0];

  return (
    <div className="stack">
      {header}
      <div className="grid-stats">
        <Stat label="Overdue" value={data.overdue.length} color={data.overdue.length ? 'red' : 'green'} />
        <Stat label="Coming up" value={data.upcoming.length} color="blue" />
        <Stat label="Next" value={next?.date ? formatDate(next.date) : 'None'}
          trend={next?.date ? { direction: 'flat', label: daysPhrase(data.today, next.date), tone: 'neutral' } : undefined}
          to={next ? `/exercises/${next.id}` : undefined} />
      </div>

      <Card title="When each kind was last run" flush>
        <div className="table-wrap trn-tw">
          <table className="table">
            <caption className="sr-only">Exercise types with the last run and the next one due</caption>
            <thead>
              <tr><th scope="col">Kind</th><th scope="col" className="num">Completed</th><th scope="col">Last run</th><th scope="col">Result</th><th scope="col">How the steps went</th><th scope="col">Next</th></tr>
            </thead>
            <tbody>
              {data.by_type.map((t) => (
                <tr key={t.type}>
                  <td><StatusChip color={toColorName(t.color)} label={t.label} /></td>
                  <td className="num"><Link to={`/exercises?f.type=${t.type}&f.status=completed`}>{t.completed}</Link></td>
                  <td>{t.last_run && t.last_id ? <Link to={`/exercises/${t.last_id}`}>{formatDate(t.last_run)}</Link> : <span className="muted">Never</span>}</td>
                  <td>{t.last_result ? <LookupChip list="exercise_result" value={t.last_result} /> : <span className="muted">—</span>}</td>
                  <td>{t.last_steps ? <StepsBar steps={t.last_steps} /> : <span className="muted">No steps recorded</span>}</td>
                  <td>
                    {t.next_due && t.next_id
                      ? <><Link to={`/exercises/${t.next_id}`}>{formatDate(t.next_due)}</Link> <span className={t.overdue ? 'trn-late' : 'muted'}>{daysPhrase(data.today, t.next_due)}</span></>
                      : <span className="muted">Nothing planned</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {nothing && (
        <EmptyState icon="calendar" title="Nothing on the calendar"
          message="Add an exercise with a date, or give a completed exercise a next due date, and it appears here." />
      )}
      {data.overdue.length > 0 && (
        <Card title={`Overdue (${data.overdue.length})`}>
          <EntryList entries={data.overdue} today={data.today} late />
        </Card>
      )}
      {[...months.entries()].map(([month, entries]) => (
        <Card key={month} title={monthName(month)}>
          <EntryList entries={entries} today={data.today} />
        </Card>
      ))}
      {data.undated.length > 0 && (
        <Card title="Planned, no date yet">
          <EntryList entries={data.undated} today={data.today} />
        </Card>
      )}
    </div>
  );
}
