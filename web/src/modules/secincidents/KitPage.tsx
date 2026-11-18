import { Button, EmptyState, ErrorState, formatDateTime, Loading, PageHeader, useAuth, useFetch } from '../../core';
import type { Kit } from './types';
import { deadlineText } from './types';

/** Printable offline incident kit: notification rules, contacts and scenario checklists. */
export function KitPage() {
  const { appName } = useAuth();
  const { data, error, reload } = useFetch<Kit>('/api/security-incidents/kit');

  const header = (
    <div className="si-no-print">
      <PageHeader title="Offline incident kit"
        subtitle="Print this and keep copies where they can be reached if the network and this system are down"
        breadcrumbs={[{ label: 'Security incidents', to: '/security-incidents' }, { label: 'Offline incident kit' }]}
        actions={<Button variant="primary" icon="download" disabled={!data} onClick={() => window.print()}>Print or save as PDF</Button>} />
    </div>
  );

  if (error) return <div className="stack">{header}<ErrorState title="The kit could not be loaded" error={error} onRetry={reload} /></div>;
  if (!data) return <div className="stack">{header}<Loading lines={8} label="Loading kit" /></div>;

  const active = data.rules.filter((r) => r.active && r.deadline_hours !== null);
  const other = data.rules.filter((r) => !(r.active && r.deadline_hours !== null));

  return (
    <div className="stack">
      {header}
      <article className="si-kit">
        <header>
          <h2>{appName}: security incident kit</h2>
          <p>
            Produced {formatDateTime(data.generated_at)} by {data.generated_by}. Restricted: handle as a security record.
            Reprint after any change to the rules, contacts or checklists.
          </p>
        </header>

        <section>
          <h2>First hour</h2>
          <ol>
            <li>Write down the time the organisation first became aware. Every notification deadline counts from that discovery time.</li>
            <li>Call the incident lead. If they cannot be reached, call the next person on the contact list.</li>
            <li>Start a paper log: time, what happened, what was decided, who did it. Copy it into the system when it is available.</li>
            <li>Answer the four questions below, then work the checklist for the scenario.</li>
          </ol>
          <h3>Four questions that decide who must be told</h3>
          <p><span className="si-kit-box" />Is this a cybersecurity or ransomware incident?</p>
          <p><span className="si-kit-box" />Could health information be involved?</p>
          <p><span className="si-kit-box" />Could payment card data be involved?</p>
          <p><span className="si-kit-box" />Could personal information be involved?</p>
          <p>Discovered (date and time): <span className="si-kit-blank">&nbsp;</span></p>
        </section>

        <section>
          <h2>Who must be told, and by when</h2>
          {!data.rules.length ? <EmptyState icon="clock" title="No notification rules are set up" /> : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">When</th><th scope="col">Notify</th><th scope="col">Deadline from discovery</th>
                    <th scope="col">Kind</th><th scope="col">Guidance</th><th scope="col">Done (time, who, reference)</th>
                  </tr>
                </thead>
                <tbody>
                  {[...active, ...other].map((r) => (
                    <tr key={r.id}>
                      <td>{r.trigger_label}</td>
                      <td><strong>{r.party}</strong></td>
                      <td>{r.deadline_hours === null ? 'No fixed deadline set' : deadlineText(r.deadline_hours)}</td>
                      <td>{r.required ? 'Required' : 'Recommended'}</td>
                      <td>{r.guidance}</td>
                      <td>&nbsp;</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <h2>Incident roles and contacts</h2>
          {!data.contacts.length ? <EmptyState icon="users" title="No contacts are set up" message="Add them under Rules and checklists." /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th scope="col">Role</th><th scope="col">Person</th><th scope="col">Contact</th><th scope="col">What the role does</th></tr></thead>
                <tbody>
                  {data.contacts.map((c) => (
                    <tr key={c.id}>
                      <td><strong>{c.role}</strong></td>
                      <td>{c.person_name || <span className="si-kit-blank">&nbsp;</span>}</td>
                      <td>{c.contact || <span className="si-kit-blank">&nbsp;</span>}</td>
                      <td>{c.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <h2>Severity guide</h2>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Severity</th><th scope="col">Use when</th></tr></thead>
              <tbody>
                {data.severities.map((s) => <tr key={s.value}><td><strong>{s.label}</strong></td><td>{s.meta?.guide ?? ''}</td></tr>)}
              </tbody>
            </table>
          </div>
          <p><strong>Ransom:</strong> do not negotiate or pay without formal approval. A payment cannot be recorded as approved without a governing body approval reference.</p>
        </section>

        <section className="si-kit-page">
          <h2>Scenario checklists</h2>
          {!data.checklists.length && <EmptyState icon="check-square" title="No checklist templates are set up" />}
          {data.checklists.map((c) => (
            <div key={c.scenario} className="si-kit-scenario">
              <h3>{c.label}</h3>
              {([['Containment', c.containment], ['Recovery', c.recovery]] as const).map(([name, steps]) => steps.length > 0 && (
                <div key={name}>
                  <h4>{name}</h4>
                  <ol>{steps.map((s, i) => <li key={i}><span className="si-kit-box" />{s}</li>)}</ol>
                </div>
              ))}
            </div>
          ))}
        </section>
      </article>
    </div>
  );
}
