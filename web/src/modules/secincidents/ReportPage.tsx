import { Link, useParams } from 'react-router-dom';
import {
  ApiError, Button, ErrorState, Forbidden, formatDate, formatDateTime, formatDuration, Loading, NotFound, PageHeader, useAuth, useFetch,
} from '../../core';
import { dayKey, formatDay, formatTime, metText, zoneName } from './shared';
import type { Clock, Report } from './types';
import { deadlineText } from './types';

const between = (from: string | null, to: string | null) =>
  from && to ? formatDuration(Math.max(0, new Date(to).getTime() - new Date(from).getTime())) : null;

function Text({ value, empty = 'Not recorded.' }: { value: string | null | undefined; empty?: string }) {
  return value && value.trim() ? <p className="si-doc-text">{value}</p> : <p className="si-doc-empty">{empty}</p>;
}

function outcome(c: Clock): string {
  if (c.status === 'done') {
    return `${c.notified_who} by ${c.notified_how}, ${formatDateTime(c.notified_at)}${c.reference_received ? `. Reference ${c.reference_received}` : ''}`
      + `${c.completed_by_name ? `. Recorded by ${c.completed_by_name}` : ''}`;
  }
  if (c.status === 'not_required') return 'Not required for this incident (see the decisions).';
  return 'Not yet made.';
}

function result(c: Clock): string {
  if (c.status === 'done') return metText(c);
  if (c.status === 'not_required') return 'Not required';
  return c.state === 'red' ? 'Overdue' : 'Outstanding';
}

/** A generated report on one incident, laid out as a document: read it on screen, print it, or save it as a PDF from the browser. */
export function ReportPage() {
  const { id = '' } = useParams();
  const { appName } = useAuth();
  const { data, error, reload } = useFetch<Report>(`/api/security-incidents/${id}/report`);

  if (error) {
    if (error instanceof ApiError && error.status === 404) return <NotFound />;
    if (error instanceof ApiError && error.status === 403) return <Forbidden />;
  }
  const i = data?.incident;
  const header = (
    <div className="si-no-print">
      <PageHeader title="Incident report" reference={i?.ref}
        subtitle="Generated from the incident record as it stands now. Use your browser's print window to print it or save it as a PDF"
        breadcrumbs={[{ label: 'Security incidents', to: '/security-incidents' }, { label: i?.ref ?? 'Incident', to: `/security-incidents/${id}` }, { label: 'Report' }]}
        actions={(
          <>
            <Link className="btn btn-secondary" to={`/security-incidents/${id}`}>Back to the incident</Link>
            <Button variant="primary" icon="download" disabled={!data} onClick={() => window.print()}>Print or save as PDF</Button>
          </>
        )} />
    </div>
  );
  if (error) return <div className="stack">{header}<ErrorState title="The report could not be produced" error={error} onRetry={reload} /></div>;
  if (!data || !i) return <div className="stack">{header}<Loading lines={10} label="Producing the report" /></div>;

  const made = data.notifications.filter((n) => n.status === 'done').length;
  const outstanding = data.notifications.filter((n) => n.status === 'pending').length;
  const days: { key: string; entries: Report['timeline'] }[] = [];
  for (const e of data.timeline) {
    const key = dayKey(e.at);
    const last = days[days.length - 1];
    if (last && last.key === key) last.entries.push(e); else days.push({ key, entries: [e] });
  }
  const facts: [string, string | null][] = [
    ['Severity', i.severity_label ?? 'Not set'], ['Status', i.status_label], ['Scenario', i.scenario_label ?? 'Not chosen'],
    ['Incident lead', i.lead ?? 'Not assigned'],
    ['Discovered', formatDateTime(i.discovered_at)],
    ['Declared', i.declared_at ? `${formatDateTime(i.declared_at)} (${between(i.discovered_at, i.declared_at)} after discovery)` : null],
    ['Contained', i.contained_at ? `${formatDateTime(i.contained_at)} (${between(i.discovered_at, i.contained_at)} after discovery)` : null],
    ['Closed', i.closed_at ? `${formatDateTime(i.closed_at)} (${between(i.discovered_at, i.closed_at)} after discovery)` : null],
  ];
  const yes = i.answers.filter((a) => a.yes);

  return (
    <div className="stack">
      {header}
      <article className="si-doc si-report">
        <header className="si-doc-head">
          <p className="si-doc-mark">Restricted · security incident record</p>
          <p className="si-doc-kicker">{appName} · Security incident report</p>
          <h2 className="si-doc-title"><span className="ref">{i.ref}</span> {i.title}</h2>
          <p className="si-doc-meta">
            Produced {formatDateTime(data.generated_at)} by {data.generated_by}. Times are shown in the organization's time zone ({zoneName()}).
          </p>
        </header>

        <section>
          <h3>1. Summary</h3>
          <dl className="si-doc-facts">
            {facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v ?? 'Not yet'}</dd></div>)}
          </dl>
          <Text value={i.summary} empty="No summary was recorded." />
        </section>

        <section>
          <h3>2. What was involved</h3>
          {yes.length ? <ul className="si-doc-list">{yes.map((a) => <li key={a.question}>{a.question} <strong>Yes</strong></li>)}</ul>
            : <p className="si-doc-empty">None of the questions that decide who must be told was answered yes.</p>}
          <h4>Affected systems</h4>
          <Text value={i.affected_systems} />
          <h4>Affected data</h4>
          <Text value={i.affected_data} />
        </section>

        <section>
          <h3>3. Notifications</h3>
          {!data.notifications.length ? (
            <p className="si-doc-empty">{i.declared_at ? 'No notification rule applied to this incident.' : 'The incident has not been declared, so no notification clocks were started.'}</p>
          ) : (
            <>
              <p className="si-doc-text">{made} made, {outstanding} outstanding, {data.notifications.length - made - outstanding} not required. Deadlines are counted from the discovery time.</p>
              <table className="si-doc-table si-doc-notifs">
                <thead><tr><th scope="col">Party</th><th scope="col">Deadline</th><th scope="col">What was done</th><th scope="col">Result</th></tr></thead>
                <tbody>
                  {data.notifications.map((n) => (
                    <tr key={n.task_id}>
                      <td><strong>{n.party}</strong><br />{n.required ? 'Required' : 'Recommended'}</td>
                      <td>{formatDateTime(n.due_at)}<br />{deadlineText(n.deadline_hours)}{Number(n.deadline_hours) === 0 ? '' : ' from discovery'}</td>
                      <td>{outcome(n)}</td>
                      <td>{result(n)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>

        <section>
          <h3>4. Decisions</h3>
          {!data.decisions.length ? <p className="si-doc-empty">No decisions were recorded in the log.</p> : (
            <table className="si-doc-table">
              <thead><tr><th scope="col">When</th><th scope="col">Decision</th><th scope="col">Recorded by</th></tr></thead>
              <tbody>
                {data.decisions.map((d) => (
                  <tr key={d.id}><td className="si-doc-nowrap">{formatDateTime(d.at)}</td><td>{d.entry}</td><td>{d.author_name ?? 'System'}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          {i.ransom_applies && (
            <p className="si-doc-text">
              <strong>Ransom payment:</strong> {i.ransom_status_label}{i.board_resolution_ref ? `. Governing body approval reference: ${i.board_resolution_ref}` : ''}.
            </p>
          )}
        </section>

        <section>
          <h3>5. Timeline</h3>
          <p className="si-doc-text">The incident log, oldest first. Entries cannot be changed after they are made.</p>
          {days.map((d) => (
            <div key={d.key} className="si-doc-day">
              <h4>{formatDay(d.entries[0].at)}</h4>
              <table className="si-doc-table si-doc-timeline">
                <tbody>
                  {d.entries.map((e) => (
                    <tr key={e.id}>
                      <td className="si-doc-nowrap">{formatTime(e.at)}</td>
                      <td className="si-doc-nowrap">{e.kind_label}</td>
                      <td>{e.entry}</td>
                      <td>{e.author_name ?? 'System'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>

        <section>
          <h3>6. Response</h3>
          {data.checklist.map((p) => (
            <div key={p.phase}>
              <h4>{p.label}: {p.items.filter((x) => x.done).length} of {p.items.length} steps done</h4>
              <ul className="si-doc-checks">
                {p.items.map((x, n) => (
                  <li key={n} className={x.done ? 'is-done' : undefined}>
                    <span className="si-box" aria-hidden="true">{x.done ? '✓' : ''}</span>
                    <span>{x.step}{x.done ? <em> ({x.done_by_name ?? 'unknown'}, {formatDateTime(x.done_at)})</em> : <em> (not done)</em>}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {!data.checklist.length && <p className="si-doc-empty">No checklist was used.</p>}
          <h4>Roles</h4>
          {data.roles.length ? (
            <table className="si-doc-table">
              <thead><tr><th scope="col">Role</th><th scope="col">Person</th><th scope="col">Contact</th></tr></thead>
              <tbody>{data.roles.map((r, n) => <tr key={n}><td>{r.role}</td><td>{r.person_name ?? '—'}</td><td>{r.contact ?? '—'}</td></tr>)}</tbody>
            </table>
          ) : <p className="si-doc-empty">No roles were recorded.</p>}
          <h4>Evidence register</h4>
          {data.evidence.length ? (
            <table className="si-doc-table">
              <thead><tr><th scope="col">Item</th><th scope="col">Where held</th><th scope="col">Collected</th><th scope="col">Hash or reference</th></tr></thead>
              <tbody>
                {data.evidence.map((e, n) => (
                  <tr key={n}>
                    <td>{e.item}</td><td>{e.where_held ?? '—'}</td>
                    <td>{[e.collected_by, e.collected_at ? formatDateTime(e.collected_at) : null].filter(Boolean).join(', ') || '—'}</td>
                    <td className="si-doc-break">{e.hash_ref ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="si-doc-empty">No evidence was registered.</p>}
        </section>

        <section>
          <h3>7. Lessons learned</h3>
          <p className="si-doc-text">
            <strong>Post-incident review:</strong> {data.review.status_label ?? 'Not started'}
            {data.review.stage === 'completed' ? `, completed ${formatDateTime(data.review.completed_at)}${data.review.completed_by ? ` by ${data.review.completed_by}` : ''}` : ''}
            {data.review.stage === 'open' && data.review.due_on ? `, due ${formatDate(data.review.due_on)}` : ''}
            {data.review.stage === 'not_required' && data.review.skip_reason ? `. Reason: ${data.review.skip_reason}` : ''}
            {data.review.lead ? `. Review lead: ${data.review.lead}` : ''}
            {data.review.held_at ? `. Review meeting: ${formatDateTime(data.review.held_at)}` : ''}.
          </p>
          {data.review.attendees && <p className="si-doc-text"><strong>Who took part:</strong> {data.review.attendees}</p>}
          {data.review.stage !== 'not_required' && (
            <>
              <h4>What happened</h4><Text value={data.review.what_happened} />
              <h4>Root cause</h4><Text value={data.review.root_cause} />
              <h4>What went well</h4><Text value={data.review.went_well} />
              <h4>What to improve</h4><Text value={data.review.to_improve} />
            </>
          )}
          {data.actions && (
            <>
              <h4>Follow-up actions</h4>
              {data.actions.length ? (
                <table className="si-doc-table">
                  <thead><tr><th scope="col">Reference</th><th scope="col">Action</th><th scope="col">Owner</th><th scope="col">Due</th><th scope="col">Status</th></tr></thead>
                  <tbody>
                    {data.actions.map((a) => (
                      <tr key={a.ref}><td className="si-doc-nowrap">{a.ref}</td><td>{a.title}</td><td>{a.owner ?? 'Unassigned'}</td><td className="si-doc-nowrap">{formatDate(a.due_on)}</td><td>{a.status_label}</td></tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="si-doc-empty">No follow-up actions have been raised.</p>}
            </>
          )}
        </section>

        <section className="si-doc-sign">
          <h3>Sign-off</h3>
          <div className="si-doc-signs">
            <div><span className="si-doc-line" /><span>Prepared by (name, date)</span></div>
            <div><span className="si-doc-line" /><span>Reviewed by (name, date)</span></div>
          </div>
        </section>
      </article>
    </div>
  );
}
