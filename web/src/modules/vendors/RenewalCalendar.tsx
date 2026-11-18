// Renewal calendar: contracts grouped by how close their notice date is.
import { Link } from 'react-router-dom';
import {
  Badge, Card, EmptyState, ErrorState, formatDate, formatDateTime, Loading, PageHeader, Stat, StatusChip, toColorName,
  useFetch,
} from '../../core';
import type { ColorName } from '../../core';
import { daysPhrase } from './shared';
import type { ReminderState, RenewalRow, Renewals } from './shared';

const REMINDER: Record<ReminderState['state'], { color: ColorName; word: string }> = {
  fired: { color: 'green', word: 'recorded' },
  superseded: { color: 'gray', word: 'skipped' },
  due: { color: 'amber', word: 'due' },
  scheduled: { color: 'blue', word: 'planned' },
};

function reminderTitle(r: ReminderState): string {
  if (r.state === 'fired') return `Reminder recorded ${formatDateTime(r.fired_at)}`;
  if (r.state === 'superseded') return 'Skipped: a nearer reminder was recorded instead';
  if (r.state === 'due') return `Due since ${formatDate(r.due_on)}; it is recorded within the hour`;
  return `Planned for ${formatDate(r.due_on)}`;
}

function Reminders({ list }: { list: ReminderState[] }) {
  return (
    <span className="row vnd-reminders">
      {list.map((r) => (
        <span key={r.threshold_days} title={reminderTitle(r)}>
          <Badge color={REMINDER[r.state].color}>{r.threshold_days}d {REMINDER[r.state].word}</Badge>
        </span>
      ))}
    </span>
  );
}

function Group({ id, title, hint, rows, dated }: { id: string; title: string; hint: string; rows: RenewalRow[]; dated: boolean }) {
  if (!rows.length) return null;
  return (
    <section aria-labelledby={`vnd-group-${id}`} className="stack vnd-group">
      <div>
        <h2 id={`vnd-group-${id}`} className="vnd-group-title">{title} <span className="tab-count">{rows.length}</span></h2>
        <p className="muted">{hint}</p>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Contract</th>
              <th scope="col">Vendor</th>
              {dated && <th scope="col">Notice date</th>}
              <th scope="col">End date</th>
              <th scope="col">Renewal</th>
              <th scope="col">Owner</th>
              <th scope="col">{dated ? 'Reminders' : 'Term as recorded'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <th scope="row">
                  {c.ref && <span className="ref">{c.ref}</span>}
                  <Link to={`/contracts/${c.id}`} className="row-title">{c.title}</Link>
                </th>
                <td>{c.vendor_name ? <Link to={`/vendors/${c.vendor_id}`}>{c.vendor_name}</Link> : <span className="muted">—</span>}</td>
                {dated && (
                  <td>
                    <strong>{formatDate(c.notice_date)}</strong>{' '}
                    <span className="muted">{daysPhrase(c.days_to_notice ?? 0)}</span>
                  </td>
                )}
                <td>{formatDate(c.end_date)}</td>
                <td>{c.renewal_label ?? <span className="muted">—</span>}</td>
                <td>{c.owner_name ?? <span className="muted">No owner</span>}</td>
                <td className={dated ? undefined : 'vnd-wrap'}>
                  {dated ? <Reminders list={c.reminders ?? []} /> : c.term_and_renewal ?? <span className="muted">—</span>}
                  {!dated && c.status && c.status !== 'active' && (
                    <> <StatusChip color={toColorName(c.status_color)} label={c.status_label ?? c.status} /></>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function RenewalCalendar() {
  const { data, error, reload } = useFetch<Renewals>('/api/contracts/renewals');

  let body;
  if (error) body = <ErrorState error={error} onRetry={reload} />;
  else if (!data) body = <Loading lines={8} label="Loading the renewal calendar" />;
  else if (!data.contracts.length && !data.undated.length) {
    body = (
      <EmptyState
        icon="calendar" title="No contracts to renew"
        message="Contracts appear here once they have an end date. Reminders are recorded before each notice date."
      />
    );
  } else {
    const windows = [...data.thresholds].sort((a, b) => a - b);
    const inWindow = (w: string) => data.contracts.filter((c) => c.window === w);
    const passed = inWindow('passed');
    body = (
      <>
        <div className="grid-stats">
          <Stat label="Notice date passed" value={passed.length} color={passed.length ? 'red' : 'green'} />
          {windows.map((w, i) => (
            <Stat
              key={w} label={i === 0 ? `Within ${w} days` : `${windows[i - 1] + 1} to ${w} days`}
              value={inWindow(String(w)).length} color={i === 0 ? 'orange' : i === 1 ? 'amber' : 'blue'}
            />
          ))}
          <Stat label="No notice date" value={data.undated.length} color="gray" />
        </div>
        {!data.contracts.length && (
          <EmptyState
            icon="calendar" title="No notice dates yet"
            message="None of the contracts has an end date, so there is nothing to put on the calendar. Add end dates and notice periods to the contracts listed below."
          />
        )}
        <Group
          id="passed" dated title="Notice date passed" rows={passed}
          hint="The last day to give notice has gone by. Check whether the contract renewed, and on what terms."
        />
        {windows.map((w, i) => (
          <Group
            key={w} id={String(w)} dated rows={inWindow(String(w))}
            title={i === 0 ? `Notice due within ${w} days` : `Notice due in ${windows[i - 1] + 1} to ${w} days`}
            hint={i === 0 ? 'Decide now: renew, renegotiate or give notice.' : 'Start the renewal decision and gather what is needed.'}
          />
        ))}
        <Group
          id="later" dated title={`More than ${windows[windows.length - 1]} days away`} rows={inWindow('later')}
          hint="No action needed yet."
        />
        <Group
          id="undated" dated={false} title="No notice date" rows={data.undated}
          hint="These contracts have no end date recorded, so no reminder can be raised. Read the term and enter an end date and notice period where the contract gives them."
        />
      </>
    );
  }

  return (
    <div className="stack">
      <PageHeader
        title="Renewal calendar"
        subtitle={data ? `A reminder is recorded in each contract's history ${data.thresholds.join(', ')} days before its notice date.` : 'Contracts by notice date.'}
        breadcrumbs={[{ label: 'Contracts', to: '/contracts' }, { label: 'Renewal calendar' }]}
      />
      {body}
    </div>
  );
}
