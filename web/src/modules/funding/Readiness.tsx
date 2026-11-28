// A funder review's readiness and its evidence package (E45-58): per area whether it is owned,
// self-assessed, answered, has evidence and no open deficiency; the requests answered or overdue; and
// a download of the package (an index PDF and the evidence files you may see) for the funder. E46-55:
// the previous review's deficiencies still open and the awards' overdue obligations count too.
import { Link } from 'react-router-dom';
import { Badge, Card, ErrorState, Loading, ProgressBar, TableWrap, useAuth, useFetch } from '../../core';

interface Readiness {
  areas: { area_code: string; title: string; ready: boolean; gaps: string[]; evidence: number; answered: number; questions: number; open_deficiencies: number }[];
  requests: { total: number; answered: number; open: number; overdue: number };
  previous?: { id: string; ref: string | null; title: string; open_deficiencies: number; elsewhere: number } | null;
  obligations?: { awards: number; total: number; overdue: number } | null;
  checks: { met: number; total: number }; ready_pct: number | null;
}

export function ReviewReadiness({ reviewId }: { reviewId: string }) {
  const { can } = useAuth();
  const { data, error, reload } = useFetch<Readiness>(`/api/compliance-reviews/${reviewId}/readiness`);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={4} label="Loading the readiness" />;
  const ready = data.areas.filter((a) => a.ready).length;
  return (
    <div className="stack">
      <Card title="Readiness" actions={can('funding.export') && (
        <a className="btn btn-sm btn-primary" href={`/api/compliance-reviews/${reviewId}/package`} download>Download the evidence package</a>
      )}>
        <ProgressBar label="Checks met" value={data.ready_pct ?? 0} valueText={data.ready_pct === null ? 'Nothing to check yet' : `${data.ready_pct}% (${data.checks.met} of ${data.checks.total})`}
          color={(data.ready_pct ?? 0) >= 90 ? 'green' : (data.ready_pct ?? 0) >= 60 ? 'blue' : 'orange'} />
        <p className="muted" style={{ marginBottom: 0 }}>
          {ready} of {data.areas.length} areas ready · requests: {data.requests.answered} of {data.requests.total} answered{data.requests.overdue ? `, ${data.requests.overdue} overdue` : ''}.
          The package is a ZIP with an index PDF and the evidence files you may see; restricted evidence is counted, not included.
        </p>
        {(data.previous || (data.obligations && data.obligations.total > 0)) && (
          <p className="muted" style={{ margin: 'var(--s-2) 0 0' }}>
            {data.previous && (
              <span style={{ display: 'block' }}>
                Previous review <Link to={`/funding/reviews/${data.previous.id}`}>{data.previous.ref ?? data.previous.title}</Link>:{' '}
                {data.previous.open_deficiencies === 0 ? 'every deficiency is closed' : `${data.previous.open_deficiencies} ${data.previous.open_deficiencies === 1 ? 'deficiency is' : 'deficiencies are'} still open`}
                {data.previous.elsewhere > 0 ? ` (${data.previous.elsewhere} in areas this review does not have)` : ''}.
              </span>
            )}
            {data.obligations && data.obligations.total > 0 && (
              <span style={{ display: 'block' }}>
                Obligations of the {data.obligations.awards === 1 ? 'award' : `${data.obligations.awards} awards`} under review: {data.obligations.overdue === 0 ? `none of ${data.obligations.total} overdue` : `${data.obligations.overdue} of ${data.obligations.total} overdue`}.
              </span>
            )}
          </p>
        )}
      </Card>
      <Card title="Areas" flush>
        <TableWrap label="Readiness of each area">
          <table className="table">
            <thead><tr><th scope="col">Area</th><th scope="col">Ready</th><th scope="col" className="num">Answered</th><th scope="col" className="num">Evidence</th><th scope="col">What is missing</th></tr></thead>
            <tbody>
              {data.areas.map((a) => (
                <tr key={a.area_code}>
                  <td><strong>{a.area_code}</strong> {a.title}</td>
                  <td>{a.ready ? <Badge color="green">Ready</Badge> : <Badge color="orange">Not yet</Badge>}</td>
                  <td className="num">{a.answered} of {a.questions}</td>
                  <td className="num">{a.evidence}</td>
                  <td>{a.gaps.length ? a.gaps.join('; ') : <span className="muted">Nothing</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </div>
  );
}
