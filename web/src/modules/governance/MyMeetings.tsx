// The member reading view (wave 25): a committee member, chair or secretary reads the agenda, papers,
// board book and published minutes of their committees' meetings. No permission is needed: the server
// answers only for the committees the person sits on.
import { Link, useParams } from 'react-router-dom';
import { Card, EmptyState, ErrorState, formatDateTime, Loading, PageHeader, TableWrap, useFetch } from '../../core';
import { ItemMarks, PaperName, type AgendaItem } from './Board';
import { DeclareOwnInterest } from './Interests';

interface MyMeeting {
  id: string; ref: string; title: string; committee_name: string; scheduled_at: string; location: string | null; status: string;
  book_ready: boolean; minutes_published: boolean; minutes_published_at: string | null;
}

function MeetingTable({ rows, label }: { rows: MyMeeting[]; label: string }) {
  return (
    <TableWrap label={label} fit>
      <table className="table">
        <caption className="sr-only">{label}</caption>
        <thead><tr><th scope="col">Meeting</th><th scope="col">Committee</th><th scope="col">Date and time</th><th scope="col" data-priority="2">Board book</th><th scope="col" data-priority="2">Minutes</th></tr></thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id}>
              <td><Link className="row-title" to={`/governance/my-meetings/${m.id}`}><span className="ref">{m.ref}</span> {m.title}</Link>{m.status === 'canceled' && <span className="muted"> (canceled)</span>}</td>
              <td>{m.committee_name}</td>
              <td>{formatDateTime(m.scheduled_at)}</td>
              <td data-priority="2">{m.book_ready ? 'Ready' : <span className="muted">After the agenda is published</span>}</td>
              <td data-priority="2">{m.minutes_published ? 'Published' : <span className="muted">Not published</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function MyMeetingList() {
  const { data, error, reload } = useFetch<{ upcoming: MyMeeting[]; recent: MyMeeting[] }>('/api/governance/my-meetings');
  return (
    <div className="stack">
      <PageHeader title="My committee meetings" subtitle="The agenda, papers, board book and published minutes of the committees you sit on." />
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loading lines={4} /> : (
        <>
          <Card title="Coming up" flush>
            {data.upcoming.length ? <MeetingTable rows={data.upcoming} label="Meetings coming up" />
              : <EmptyState icon="calendar" title="No meetings coming up" message="Meetings of the committees you sit on appear here." />}
          </Card>
          <Card title="Past year" flush>
            {data.recent.length ? <MeetingTable rows={data.recent} label="Meetings of the past year" />
              : <EmptyState icon="calendar" title="No recent meetings" message="Meetings held in the past year appear here." />}
          </Card>
        </>
      )}
    </div>
  );
}

export function MyMeetingDetail() {
  const { id } = useParams();
  const { data, error, reload } = useFetch<{ meeting: MyMeeting; agenda: AgendaItem[]; agenda_published: boolean }>(`/api/governance/my-meetings/${id}`);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={6} />;
  const { meeting, agenda } = data;
  const base = `/api/governance/my-meetings/${meeting.id}`;
  return (
    <div className="stack">
      <PageHeader title={meeting.title} reference={meeting.ref}
        subtitle={`${meeting.committee_name} · ${formatDateTime(meeting.scheduled_at)}${meeting.location ? ` · ${meeting.location}` : ''}`}
        breadcrumbs={[{ label: 'My committee meetings', to: '/governance/my-meetings' }]} />
      <Card title="Documents">
        <div className="row">
          {meeting.book_ready ? (
            <>
              <a className="btn btn-sm btn-primary" href={`${base}/book`} download>Board book (PDF)</a>
              <a className="btn btn-sm" href={`${base}/book?text=1`} download>Board book, text only</a>
            </>
          ) : <span className="muted">The board book is ready once the agenda is published.</span>}
          {meeting.minutes_published ? <a className="btn btn-sm" href={`${base}/minutes`} download>Minutes (PDF)</a> : <span className="muted">The minutes are not published yet.</span>}
        </div>
      </Card>
      <Card title="Agenda" flush>
        {!data.agenda_published ? <EmptyState icon="clipboard" title="Agenda not published yet" message="The secretary publishes the agenda before the meeting." />
          : agenda.length === 0 ? <EmptyState icon="clipboard" title="No agenda items" message="The agenda has no items." />
          : (
            <ol className="gv-agenda">
              {agenda.map((a, i) => (
                <li key={a.id} className="gv-agenda-item">
                  <div className="gv-agenda-main">
                    <strong>{i + 1}. {a.title}</strong> <ItemMarks item={a} />
                    {a.presenter_label && <span className="muted"> · {a.presenter_label}</span>}
                    {a.notes && <div className="prose muted">{a.notes}</div>}
                    {a.papers.length > 0 && (
                      <ul className="gv-papers" aria-label={`Papers for item ${i + 1}`}>
                        {a.papers.map((p) => <li key={p.id}><PaperName paper={p} href={p.kind === 'file' && !p.missing && !p.link ? `${base}/papers/${p.id}` : undefined} /></li>)}
                      </ul>
                    )}
                    {a.discussion && <div className="gv-discussion"><span className="muted">Minutes: </span>{a.discussion}</div>}
                  </div>
                </li>
              ))}
            </ol>
          )}
      </Card>
      {/* E45-60: declare an interest in an item before the meeting. */}
      {!['canceled', 'minutes_approved'].includes(meeting.status) && <DeclareOwnInterest meetingId={meeting.id} held={meeting.status === 'held'} />}
    </div>
  );
}
