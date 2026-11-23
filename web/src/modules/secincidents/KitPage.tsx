import { Link } from 'react-router-dom';
import { Button, ErrorState, formatDateTime, Loading, PageHeader, useAuth, useFetch, useResource } from '../../core';
import { Logo } from '../../core/Logo';
import { KitCopies } from './KitCopies';
import { zoneName } from './shared';
import type { Kit } from './types';
import { deadlineText } from './types';

const Box = () => <span className="si-box" aria-hidden="true" />;
const Blank = ({ wide }: { wide?: boolean }) => <span className={wide ? 'si-blank si-blank-wide' : 'si-blank'}>&nbsp;</span>;

/** One printed page. On screen it is drawn as a sheet, so the page is its own print preview. */
function Sheet({ title, n, children, className }: { title?: string; n?: number; children: React.ReactNode; className?: string }) {
  return (
    <section className={`si-sheet ${className ?? ''}`}>
      {title && <h3 className="si-sheet-title">{n !== undefined && <span className="si-sheet-n">{n}</span>}{title}</h3>}
      {children}
    </section>
  );
}

function LogSheet({ page, n }: { page: number; n: number }) {
  return (
    <Sheet title={`Incident log sheet ${page}`} n={n} className="si-sheet-form">
      <p className="si-kit-note">One line per event or decision. Copy the entries into the system when it is available; keep this sheet as evidence.</p>
      <p className="si-kit-fill">Incident: <Blank wide /> &nbsp; Kept by: <Blank /> &nbsp; Date: <Blank /></p>
      <table className="si-doc-table si-kit-ruled">
        <thead><tr><th scope="col" style={{ width: '13%' }}>Time</th><th scope="col">What happened, what was decided or done</th><th scope="col" style={{ width: '20%' }}>Who</th></tr></thead>
        <tbody>{Array.from({ length: 22 }, (_, i) => <tr key={i}><td>&nbsp;</td><td /><td /></tr>)}</tbody>
      </table>
    </Sheet>
  );
}

/** Printable offline incident kit: cover, first hour, contacts, who must be told, checklists and blank log sheets. */
export function KitPage() {
  const { appName } = useAuth();
  const { data, error, reload } = useFetch<Kit>('/api/security-incidents/kit');
  // The ransom rule follows the "recorded approval of a ransom payment" option and its name (Administration > Features).
  const approval = useResource('security_incident')?.fields.board_resolution_ref;

  const header = (
    <div className="si-no-print">
      <PageHeader title="Offline incident kit"
        subtitle="Print this and keep copies where they can be reached if the network and this system are down. What you see below is how it prints."
        breadcrumbs={[{ label: 'Security incidents', to: '/security-incidents' }, { label: 'Offline incident kit' }]}
        actions={(
          <>
            <Link className="btn btn-secondary" to="/security-incidents/rules">Rules and checklists</Link>
            <Button variant="primary" icon="download" disabled={!data} onClick={() => window.print()}>Print or save as PDF</Button>
          </>
        )} />
    </div>
  );

  if (error) return <div className="stack">{header}<KitCopies /><ErrorState title="The kit could not be loaded" error={error} onRetry={reload} /></div>;
  if (!data) return <div className="stack">{header}<Loading lines={8} label="Loading kit" /></div>;

  const o = data.organization;
  const own = (o ? [
    ['Organization', o.name], ['Address', o.address], ['Main phone', o.phone],
    ['Security contact phone', o.security_phone], ['Security contact email', o.security_email],
  ] : []).filter(([, v]) => v) as [string, string][];
  const isOn = (r: Kit['rules'][number]) => r.active && r.deadline_hours !== null;
  const active = data.rules.filter(isOn);
  const other = data.rules.filter((r) => !isOn(r));
  const contents = [
    'First hour', 'Incident roles and contacts', 'Who must be told, and by when', 'Severity guide and ransom rule',
    ...data.checklists.map((c) => `Checklist: ${c.label}`), 'Notification record sheet', 'Incident log sheets',
  ];

  return (
    <div className="stack">
      {header}
      <KitCopies />
      <p className="si-preview-label si-no-print">Print preview · {contents.length} sections · A4 or Letter, portrait</p>
      <article className="si-doc si-kit">
        <Sheet className="si-cover">
          <p className="si-doc-mark">Restricted · handle as a security record</p>
          <div className="si-cover-main">
            {data.organization?.name && <p className="si-doc-kicker si-kit-org"><Logo size={36} /><span>{data.organization.name}</span></p>}
            <p className="si-doc-kicker">{appName}</p>
            <h2 className="si-cover-title">Security incident kit</h2>
            <p className="si-cover-sub">What to do, who to call and who must be told when the network or this system is down.</p>
          </div>
          <dl className="si-cover-facts">
            <div><dt>Produced</dt><dd>{formatDateTime(data.generated_at)} ({zoneName()})</dd></div>
            <div><dt>Produced by</dt><dd>{data.generated_by}</dd></div>
            <div><dt>This copy is kept by</dt><dd><Blank wide /></dd></div>
          </dl>
          <div className="si-cover-contents">
            <h3>In this kit</h3>
            <ol>{contents.map((c) => <li key={c}>{c}</li>)}</ol>
          </div>
          <p className="si-kit-note">
            Reprint after any change to the notification rules, the contacts or the checklists, and destroy the old copies.
            Keep one copy in a locked cabinet and one with each member of the incident team.
          </p>
        </Sheet>

        <Sheet title="First hour" n={1}>
          <ol className="si-kit-steps">
            <li><strong>Write down the time</strong> the organization first became aware. Every notification deadline counts from that discovery time.</li>
            <li><strong>Call the incident lead.</strong> If they cannot be reached, call the next person on the contact list.</li>
            <li><strong>Start a paper log</strong> on the sheets at the back: time, what happened, what was decided, who did it.</li>
            <li><strong>Answer the questions</strong> below, then work the checklist for the scenario.</li>
            <li><strong>Check who must be told</strong> in section 3 and note each deadline against the discovery time.</li>
          </ol>
          <div className="si-kit-panel">
            <p className="si-kit-fill"><strong>Discovered</strong> (date and time): <Blank wide /></p>
            <p className="si-kit-fill"><strong>Reported by:</strong> <Blank wide /> &nbsp; <strong>Incident lead told at:</strong> <Blank /></p>
          </div>
          <h4>Questions that decide who must be told</h4>
          <p className="si-kit-note">If unsure, answer yes.</p>
          <table className="si-doc-table si-kit-questions">
            <thead><tr><th scope="col">Question</th><th scope="col">Yes</th><th scope="col">No</th></tr></thead>
            <tbody>
              {data.questions.map((q) => (
                <tr key={q.key}><td><strong>{q.question}</strong>{q.hint && <><br /><span className="si-kit-small">{q.hint}</span></>}</td><td><Box /></td><td><Box /></td></tr>
              ))}
            </tbody>
          </table>
        </Sheet>

        <Sheet title="Incident roles and contacts" n={2}>
          {/* The organization's own numbers (Administration > Organization). */}
          {own.length > 1 && (
            <dl className="si-cover-facts si-kit-own">
              {own.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
            </dl>
          )}
          {!data.contacts.length ? <p className="si-doc-empty">No contacts are set up. Add them under Rules and checklists, then reprint.</p> : (
            <table className="si-doc-table">
              <thead><tr><th scope="col" style={{ width: '22%' }}>Role</th><th scope="col" style={{ width: '22%' }}>Person</th><th scope="col" style={{ width: '22%' }}>Contact</th><th scope="col">What the role does</th></tr></thead>
              <tbody>
                {data.contacts.map((c) => (
                  <tr key={c.id}>
                    <td><strong>{c.role}</strong></td>
                    <td>{c.person_name || <Blank />}</td>
                    <td>{c.contact || <Blank />}</td>
                    <td>{c.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="si-kit-note">Give phone numbers that work when email is down. Fill any blank by hand and correct the standing contact list afterwards.</p>
        </Sheet>

        <Sheet title="Who must be told, and by when" n={3}>
          {!data.rules.length ? <p className="si-doc-empty">No notification rules are set up.</p> : (
            <>
              {!active.length && (
                <p className="si-kit-warning"><strong>No rule has a deadline yet.</strong> Until an administrator sets the deadlines, take advice on who must be told and how quickly.</p>
              )}
              <table className="si-doc-table">
                <thead>
                  <tr>
                    <th scope="col" style={{ width: '20%' }}>Notify</th><th scope="col" style={{ width: '18%' }}>When</th>
                    <th scope="col" style={{ width: '15%' }}>Deadline from discovery</th><th scope="col">Guidance</th>
                  </tr>
                </thead>
                <tbody>
                  {[...active, ...other].map((r) => (
                    <tr key={r.id}>
                      <td><strong>{r.party}</strong><br />{r.required ? 'Required' : 'Recommended'}</td>
                      <td>{r.trigger_label}</td>
                      <td>{r.deadline_hours === null ? <em>No deadline set</em> : <strong>{deadlineText(r.deadline_hours)}</strong>}</td>
                      <td>{r.guidance}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Sheet>

        <Sheet title="Severity guide and ransom rule" n={4}>
          <table className="si-doc-table">
            <thead><tr><th scope="col" style={{ width: '22%' }}>Severity</th><th scope="col">Use when</th></tr></thead>
            <tbody>
              {data.severities.map((s) => <tr key={s.value}><td><strong>{s.label}</strong></td><td>{s.meta?.guide ?? ''}</td></tr>)}
            </tbody>
          </table>
          <div className="si-kit-panel">
            <p>
              <strong>Ransom.</strong> Do not negotiate or pay without formal approval.
              {approval ? ` A payment cannot be recorded as approved without the ${/^[A-Z][a-z]/.test(approval.label) ? approval.label.charAt(0).toLowerCase() + approval.label.slice(1) : approval.label}.` : ''}
            </p>
          </div>
        </Sheet>

        {!data.checklists.length && (
          <Sheet title="Scenario checklists" n={5}><p className="si-doc-empty">No checklist templates are set up.</p></Sheet>
        )}
        {data.checklists.map((c, i) => (
          <Sheet key={c.scenario} title={`Checklist: ${c.label}`} n={5 + i}>
            {([['Containment: stop it getting worse', c.containment], ['Recovery: get back to normal', c.recovery]] as const).map(([name, steps]) => steps.length > 0 && (
              <div key={name} className="si-kit-phase">
                <h4>{name}</h4>
                <ul className="si-doc-checks">
                  {steps.map((s, k) => <li key={k}><Box /><span>{s}</span><span className="si-kit-time">Time</span></li>)}
                </ul>
              </div>
            ))}
          </Sheet>
        ))}

        <Sheet title="Notification record sheet" n={5 + Math.max(1, data.checklists.length)} className="si-sheet-form">
          <p className="si-kit-note">Record every notification as it is made: the deadline you worked out, who took the report, how, when, and any reference they gave.</p>
          <table className="si-doc-table si-kit-ruled si-kit-tall">
            <thead>
              <tr><th scope="col" style={{ width: '22%' }}>Party</th><th scope="col" style={{ width: '16%' }}>Deadline</th><th scope="col">Who was notified, and how</th><th scope="col" style={{ width: '16%' }}>When</th><th scope="col" style={{ width: '16%' }}>Reference</th></tr>
            </thead>
            <tbody>
              {[...active, ...Array.from({ length: Math.max(4, 10 - active.length) }, () => null)].map((r, i) => (
                <tr key={i}><td>{r ? <strong>{r.party}</strong> : ' '}</td><td /><td /><td /><td /></tr>
              ))}
            </tbody>
          </table>
        </Sheet>

        <LogSheet page={1} n={6 + Math.max(1, data.checklists.length)} />
        <LogSheet page={2} n={6 + Math.max(1, data.checklists.length)} />
      </article>
    </div>
  );
}
