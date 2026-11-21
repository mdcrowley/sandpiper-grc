import { Link } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, ErrorState, formatDate, Icon, Loading, PageHeader, Stat, useAuth, useFetch } from '../../core';
import type { ColorName } from '../../core';
import type { AppetiteData } from './Appetite';
import { RatedChip } from './scales';

interface ReportRisk {
  id: string;
  ref: string;
  title: string;
  status_label: string;
  status_color: string;
  category_label: string | null;
  treatment_label: string | null;
  owner_name: string | null;
  inherent_label: string | null;
  inherent_color: string;
  residual_label: string | null;
  residual_color: string;
  rating_label: string | null;
  color: string;
  review_on: string | null;
  review_overdue: boolean;
  movement: 'up' | 'down' | 'same' | 'none';
  previous_label: string | null;
  previous_color: string;
  previous_on: string | null;
  actions: { open: number; overdue: number } | null;
}

interface Report {
  generated_on: string;
  window_days: number;
  total: number;
  unscored: number;
  accepted: number;
  reviews_overdue: number;
  levels: { value: string; label: string; color: string; count: number }[];
  top: ReportRisk[];
  increased: ReportRisk[];
  decreased: ReportRisk[];
  unchanged: number;
  not_reviewed: number;
  acceptances: {
    id: string; risk_id: string; ref: string; title: string; rating_label: string | null; color: string;
    approver_name: string; approver_title: string | null; expires_on: string; days_left: number; expired: boolean;
  }[];
}

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

interface Rollup {
  id: string; ref: string; title: string; owner_name: string | null;
  rating: { key: string; label: string; color: string } | null; appetite_breach: boolean | null;
  children: number; open_children: number; breaches: number;
  worst: { id: string; ref: string; title: string; rating: { label: string; color: string } | null } | null;
}

/** E30-06: each category's appetite against its open risks, and how many are above it. */
function AppetiteSection() {
  const { data, error, reload } = useFetch<AppetiteData>('/api/risks/appetite');
  if (error) return <Card title="Risk appetite"><ErrorState error={error} onRetry={reload} /></Card>;
  if (!data) return <Card title="Risk appetite"><Loading lines={3} label="Loading the risk appetite" /></Card>;
  const set = data.categories.filter((c) => c.statement || c.max_rating || c.max_score !== null);
  return (
    <Card title="Risk appetite" flush={set.length > 0}>
      {set.length === 0 ? <p className="muted">No risk appetite has been set. An administrator sets it under Administration, Risk appetite.</p> : (
        <div className="table-wrap">
          <table className="table rk-report-table">
            <thead><tr><th scope="col">Category</th><th scope="col">Appetite</th><th scope="col">Highest acceptable</th><th scope="col" className="num">Open</th><th scope="col" className="num">Above appetite</th></tr></thead>
            <tbody>
              {set.map((c) => {
                const max = c.ratings.find((r) => r.key === c.max_rating);
                return (
                  <tr key={c.category}>
                    <td>{c.label}</td>
                    <td>{c.statement ?? <span className="muted">No statement</span>}{c.approved_by_name && <span className="muted rk-action-sub">Approved by {c.approved_by_name}{c.approved_on ? `, ${formatDate(c.approved_on)}` : ''}</span>}</td>
                    <td>{max ? <RatedChip label={max.label} color={max.color} /> : <span className="muted">No limit</span>}{c.max_score !== null && <span className="muted"> score {c.max_score}</span>}</td>
                    <td className="num">{c.open}</td>
                    <td className="num">{c.breaches > 0 ? <Link className="is-overdue" to={`/risks?f.category=${encodeURIComponent(c.category)}&f.appetite_breach=true`}>{c.breaches}</Link> : 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** E30-08: enterprise risks with the department risks under them. */
function RollupSection() {
  const { data, error, reload } = useFetch<Rollup[]>('/api/risks/rollup');
  if (error) return <Card title="Enterprise risks and the risks under them"><ErrorState error={error} onRetry={reload} /></Card>;
  if (!data) return <Card title="Enterprise risks and the risks under them"><Loading lines={3} label="Loading the roll-up" /></Card>;
  if (data.length === 0) return null;
  return (
    <Card title="Enterprise risks and the risks under them" flush>
      <div className="table-wrap">
        <table className="table rk-report-table">
          <thead><tr><th scope="col">Enterprise risk</th><th scope="col">Rating</th><th scope="col" className="num">Open under it</th><th scope="col">Worst open risk under it</th><th scope="col" className="num">Above appetite</th></tr></thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.id}>
                <td><Link to={`/risks/${p.id}`}><span className="ref">{p.ref}</span> {p.title}</Link>{p.appetite_breach && <> <Badge color="red">Above appetite</Badge></>}</td>
                <td><RatedChip label={p.rating?.label ?? null} color={p.rating?.color ?? 'gray'} /></td>
                <td className="num">{p.open_children} <span className="muted">of {p.children}</span></td>
                <td>{p.worst ? <span className="rk-two-line"><Link to={`/risks/${p.worst.id}`}><span className="ref">{p.worst.ref}</span> {p.worst.title}</Link><RatedChip label={p.worst.rating?.label ?? null} color={p.worst.rating?.color ?? 'gray'} /></span> : <span className="muted">None scored</span>}</td>
                <td className="num">{p.breaches}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Movement in words and a symbol, so it reads in black and white as well as in color. */
function Movement({ r }: { r: ReportRisk }) {
  if (r.movement === 'up') return <span className="rk-move rk-move-up"><Icon name="arrow-up" size={14} /> Up from {r.previous_label}</span>;
  if (r.movement === 'down') return <span className="rk-move rk-move-down"><Icon name="arrow-down" size={14} /> Down from {r.previous_label}</span>;
  if (r.movement === 'same') return <span className="rk-move"><Icon name="minus" size={14} /> No change</span>;
  return <span className="muted">Not yet reviewed</span>;
}

function MoveList({ title, rows, empty }: { title: string; rows: ReportRisk[]; empty: string }) {
  return (
    <div>
      <h3 className="rk-report-h3">{title} <span className="tab-count">{rows.length}</span></h3>
      {rows.length === 0 ? <p className="muted">{empty}</p> : (
        <ul className="rk-move-list">
          {rows.map((r) => (
            <li key={r.id}>
              <Link to={`/risks/${r.id}`}><span className="ref">{r.ref}</span> {r.title}</Link>
              <span className="rk-move-chips">
                <RatedChip label={r.previous_label} color={r.previous_color} />
                <span className="risk-arrow" aria-hidden="true">→</span>
                <span className="sr-only">to</span>
                <RatedChip label={r.rating_label} color={r.color} />
                {r.previous_on && <span className="muted">since {formatDate(r.previous_on)}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A risk report laid out for a board pack: one page of findings that prints cleanly. */
export function RiskReport() {
  const { appName } = useAuth();
  const { data, error, reload } = useFetch<Report>('/api/risks/report');

  if (error) return <><PageHeader title="Risk report" /><ErrorState error={error} onRetry={reload} /></>;
  if (!data) return <><PageHeader title="Risk report" /><Loading lines={8} /></>;

  const scored = data.levels.reduce((n, l) => n + l.count, 0);
  const expired = data.acceptances.filter((a) => a.expired).length;
  const worst = [...data.levels].reverse().find((l) => l.count > 0);

  return (
    <div className="stack rk-report">
      <PageHeader
        title="Risk report"
        subtitle={`${appName} · Open risks as at ${formatDate(data.generated_on)}. Restricted: for people with access to security records.`}
        breadcrumbs={[{ label: 'Risk register', to: '/risks' }, { label: 'Risk report' }]}
        actions={<Button variant="primary" icon="download" onClick={() => window.print()}>Print or save as PDF</Button>}
      />

      {data.total === 0 ? <Card><EmptyState icon="shield" title="No open risks" message="There is nothing to report until a risk is added to the register." /></Card> : (
        <>
          <div className="grid-stats">
            <Stat label="Open risks" value={data.total} color="blue" hint={data.unscored > 0 ? `${data.unscored} not yet scored` : 'All scored'} />
            <Stat label={worst ? `Rated ${worst.label}` : 'Rated'} value={worst?.count ?? 0} color={(worst?.color ?? 'gray') as ColorName} hint="Highest common level in use" />
            <Stat label="Increased" value={data.increased.length} color={data.increased.length > 0 ? 'red' : 'green'} hint="Since the last review" />
            <Stat label="Accepted" value={data.accepted} color="purple" hint={`${data.acceptances.length} to renew within ${data.window_days} days`} />
            <Stat label="Reviews overdue" value={data.reviews_overdue} color={data.reviews_overdue > 0 ? 'amber' : 'green'} hint="Review date has passed" />
          </div>

          <Card title="Open risks by level">
            {scored === 0 ? <p className="muted">No open risk has been scored yet.</p> : (
              <>
                <div className="rk-levelbar" role="img" aria-label={`Open risks by common level: ${data.levels.map((l) => `${l.label} ${l.count}`).join(', ')}`}>
                  {data.levels.filter((l) => l.count > 0).map((l) => (
                    <span key={l.value} style={{ flexGrow: l.count, background: `var(--c-${l.color}-solid)` }} title={`${l.label}: ${l.count}`} />
                  ))}
                </div>
                <ul className="rk-legend">
                  {data.levels.map((l) => (
                    <li key={l.value}>
                      <span className="rk-swatch" style={{ background: `var(--c-${l.color}-solid)`, borderColor: `var(--c-${l.color}-solid)` }} aria-hidden="true" />
                      {l.label} <strong className="num">{l.count}</strong>
                    </li>
                  ))}
                  {data.unscored > 0 && <li className="muted">Not yet scored <strong className="num">{data.unscored}</strong></li>}
                </ul>
              </>
            )}
            <p className="muted rk-report-note">
              Risks are scored on different scales; each rating maps to one of these common levels so they can be counted together. The level
              is the residual rating, or the inherent rating where the residual risk has not been scored.
            </p>
          </Card>

          <Card title={`Top ${data.top.length} risks`} flush>
            <div className="table-wrap">
              <table className="table rk-report-table">
                <thead>
                  <tr>
                    <th scope="col" className="num">#</th><th scope="col">Risk</th><th scope="col">Owner</th><th scope="col">Inherent</th>
                    <th scope="col">Residual</th><th scope="col">Since last review</th><th scope="col">Treatment</th><th scope="col">Open actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top.map((r, i) => (
                    <tr key={r.id}>
                      <td className="num">{i + 1}</td>
                      <td>
                        <Link to={`/risks/${r.id}`}><span className="ref">{r.ref}</span> {r.title}</Link>
                        <span className="rk-action-sub"><span className="muted">{r.category_label}</span><Badge color={r.status_color as ColorName}>{r.status_label}</Badge></span>
                      </td>
                      <td>{r.owner_name ?? <span className="muted">No owner</span>}</td>
                      <td><RatedChip label={r.inherent_label} color={r.inherent_color} /></td>
                      <td><RatedChip label={r.residual_label} color={r.residual_color} /></td>
                      <td><Movement r={r} /></td>
                      <td>{r.treatment_label ?? '—'}</td>
                      <td>{r.actions === null ? '—' : r.actions.open === 0 ? <span className="muted">None</span> : (
                        <>{r.actions.open}{r.actions.overdue > 0 && <span className="is-overdue"> ({r.actions.overdue} overdue)</span>}</>
                      )}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Movement since the last review">
            <div className="grid-2">
              <MoveList title="Increased" rows={data.increased} empty="No risk is rated higher than at its last review." />
              <MoveList title="Reduced" rows={data.decreased} empty="No risk is rated lower than at its last review." />
            </div>
            <p className="muted rk-report-note">
              {data.unchanged} unchanged, {data.not_reviewed} not yet reviewed. Each risk's rating now is compared with the rating recorded at
              its last review; where nothing has changed since that review, with the review before it.
            </p>
          </Card>

          <AppetiteSection />
          <RollupSection />

          <Card title="Acceptances expiring" flush={data.acceptances.length > 0}>
            {data.acceptances.length === 0 ? <p className="muted">No acceptance has expired or expires within {data.window_days} days.</p> : (
              <div className="table-wrap">
                <table className="table rk-report-table">
                  <thead><tr><th scope="col">Risk</th><th scope="col">Rating</th><th scope="col">Approved by</th><th scope="col">Expires</th><th scope="col">Time left</th></tr></thead>
                  <tbody>
                    {data.acceptances.map((a) => (
                      <tr key={a.id}>
                        <td><Link to={`/risks/${a.risk_id}`}><span className="ref">{a.ref}</span> {a.title}</Link></td>
                        <td><RatedChip label={a.rating_label} color={a.color} /></td>
                        <td>{[a.approver_name, a.approver_title].filter(Boolean).join(', ')}</td>
                        <td>{formatDate(a.expires_on)}</td>
                        <td>{a.expired ? <Badge color="red">Expired {days(-a.days_left)} ago</Badge> : <Badge color="amber">{days(a.days_left)} left</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {expired > 0 && <p className="muted rk-report-note rk-panel-pad">{expired === 1 ? 'One acceptance has' : `${expired} acceptances have`} expired: those risks are no longer accepted and need review.</p>}
          </Card>
        </>
      )}
    </div>
  );
}
