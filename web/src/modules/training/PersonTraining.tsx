// A roster person's training, certifications and qualification (E29-05, E29-06), shown on their
// record page in the people module, which loads it only when training is in the build.
import { Link } from 'react-router-dom';
import { Badge, Card, EmptyState, ErrorState, formatDate, Loading, LookupChip, useAuth, useFetch } from '../../core';
import { CellChip, QualifiedBadge } from './Qualifications';
import { STATUS } from './shared';

interface PersonTrainingData {
  today: string;
  qualified: boolean;
  requirements: { key: string; label: string; kind: string; mandatory: boolean; state: 'met' | 'expiring' | 'expired' | 'missing'; until: string | null; since: string | null }[];
  records: { id: string; course_id: string; course_title: string; course_ref: string; due_on: string | null; completed_on: string | null; status: keyof typeof STATUS }[];
  certifications: { id: string; ref: string; certification_type: string; number: string | null; expires_on: string | null; status: string }[];
}

/** The badge in the person's header: qualified now or not. */
export function PersonQualifiedBadge({ personId }: { personId: string }) {
  const { can } = useAuth();
  const { data } = useFetch<PersonTrainingData>(can('training.view') ? `/api/training/people/${personId}` : null);
  if (!data || !data.requirements.length) return null;
  return <QualifiedBadge qualified={data.qualified} required={data.requirements.filter((r) => r.mandatory).length} />;
}

export function PersonTraining({ personId }: { personId: string }) {
  const { can } = useAuth();
  const { data, error, reload } = useFetch<PersonTrainingData>(can('training.view') ? `/api/training/people/${personId}` : null);
  if (!can('training.view')) return <Card><p className="muted">Training is not open to you.</p></Card>;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={5} label="Loading training" />;
  return (
    <div className="stack">
      <Card title="Qualification" actions={<QualifiedBadge qualified={data.qualified} required={data.requirements.filter((r) => r.mandatory).length} />} flush={!!data.requirements.length}>
        {data.requirements.length ? (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Requirements of the person's position</caption>
              <thead><tr><th scope="col">Requirement</th><th scope="col">Mandatory</th><th scope="col">State</th><th scope="col">In date until</th></tr></thead>
              <tbody>
                {data.requirements.map((r) => (
                  <tr key={r.key}>
                    <td>{r.label}</td><td>{r.mandatory ? 'Yes' : 'No'}</td><td><CellChip cell={r} /></td>
                    <td>{r.until ? formatDate(r.until) : r.state === 'missing' ? '–' : 'No expiry'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">The person has no position, or their position has no requirements.</p>}
      </Card>
      <Card title="Certifications" flush={!!data.certifications.length}
        actions={can('training.create') && <Link className="btn btn-secondary btn-sm" to={`/training/certifications?new=1`}>Add certification</Link>}>
        {data.certifications.length ? (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Certifications</caption>
              <thead><tr><th scope="col">Reference</th><th scope="col">Certification</th><th scope="col">Expires</th><th scope="col">Status</th></tr></thead>
              <tbody>
                {data.certifications.map((c) => (
                  <tr key={c.id}>
                    <td><Link to={`/training/certifications/${c.id}`}>{c.ref}</Link></td>
                    <td><LookupChip list="certification_type" value={c.certification_type} /></td>
                    <td>{c.expires_on ? formatDate(c.expires_on) : 'No expiry'}{c.expires_on && c.expires_on < data.today && <> <Badge color="red">Expired</Badge></>}</td>
                    <td><LookupChip list="certification_status" value={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState icon="star" title="No certifications" message="Certifications recorded for this person appear here." />}
      </Card>
      <Card title="Training records" flush={!!data.records.length}>
        {data.records.length ? (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Training records</caption>
              <thead><tr><th scope="col">Course</th><th scope="col">Status</th><th scope="col">Due</th><th scope="col">Completed</th></tr></thead>
              <tbody>
                {data.records.map((r) => (
                  <tr key={r.id}>
                    <td><Link to={`/training/courses/${r.course_id}`}>{r.course_ref} {r.course_title}</Link></td>
                    <td><Badge color={STATUS[r.status]?.color ?? 'gray'}>{STATUS[r.status]?.label ?? r.status}</Badge></td>
                    <td>{r.due_on ? formatDate(r.due_on) : '–'}</td>
                    <td>{r.completed_on ? formatDate(r.completed_on) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState icon="graduation" title="No training yet" message="Training assigned by position, recorded or imported appears here." />}
      </Card>
    </div>
  );
}
