// Qualifications (E29-03, E29-04, E29-06): the qualification matrix, certifications and those
// expiring. People and positions come from the roster (people module).
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Badge, Card, EmptyState, ErrorState, formatDate, Loading, LookupChip, PageHeader, RecordPage, ResourceList, Select, Stat, TableWrap, todayInZone, useAuth, useFetch,
  type ColorName,
} from '../../core';

type CellState = 'met' | 'expiring' | 'expired' | 'missing';
interface Cell { state: CellState; until: string | null; since: string | null }
interface Matrix {
  today: string;
  columns: { key: string; label: string; kind: 'course' | 'certification' }[];
  counts: { people: number; qualified: number; withRequirements: number };
  rows: { id: string; ref: string; full_name: string; position: string | null; department: string | null; qualified: boolean; required: number; cells: Record<string, Cell> }[];
}

export const CELL: Record<CellState, { label: string; color: ColorName }> = {
  met: { label: 'In date', color: 'green' },
  expiring: { label: 'Expiring', color: 'amber' },
  expired: { label: 'Expired', color: 'red' },
  missing: { label: 'Missing', color: 'gray' },
};

export function CellChip({ cell }: { cell: Cell }) {
  const c = CELL[cell.state];
  const title = cell.until ? `${c.label}: until ${formatDate(cell.until)}` : cell.since ? `${c.label}: since ${formatDate(cell.since)}` : c.label;
  return <span title={title}><Badge color={c.color}>{c.label}</Badge></span>;
}

export function QualifiedBadge({ qualified, required }: { qualified: boolean; required: number }) {
  if (!required) return <Badge color="gray">No requirements</Badge>;
  return qualified ? <Badge color="green">Qualified</Badge> : <Badge color="red">Not qualified</Badge>;
}

export function QualificationMatrix() {
  const { can } = useAuth();
  const [position, setPosition] = useState('');
  const [department, setDepartment] = useState('');
  const [qualified, setQualified] = useState('');
  const positions = useFetch<{ rows: { id: string; name: string }[] }>(can('people.view') ? '/api/positions?pageSize=500&sort=name' : null);
  const departments = useFetch<{ id: string; name: string }[]>(can('people.view') ? '/api/people/departments' : null);
  const qs = new URLSearchParams(Object.entries({ position, department, qualified }).filter(([, v]) => v)).toString();
  const { data, error, reload } = useFetch<Matrix>(can('people.view') ? `/api/training/qualifications${qs ? `?${qs}` : ''}` : null);
  const expiring = useFetch<{ counts: { expired: number; within30: number; within90: number } }>(can('people.view') ? '/api/training/certifications/expiring?days=90' : null);

  let body;
  if (!can('people.view')) body = <EmptyState icon="lock" title="The roster is not open to you" message="The matrix names people on the roster, so it needs permission to view people as well as training." />;
  else if (error) body = <ErrorState error={error} onRetry={reload} />;
  else if (!data) body = <Loading lines={6} label="Loading the qualification matrix" />;
  else if (!data.rows.length) {
    body = <EmptyState icon="users" title="Nobody to show" message="No one on the roster matches, or their positions have no requirements yet. Add requirements on each position." />;
  } else {
    body = (
      <TableWrap label="Each person against the requirements of their position" className="trn-matrix">
        <table className="table">
          <caption className="sr-only">Each person against the requirements of their position</caption>
          <thead>
            <tr>
              <th scope="col">Person</th><th scope="col">Position</th><th scope="col">Qualified now</th>
              {data.columns.map((c) => <th key={c.key} scope="col">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id}>
                <td className="trn-person"><Link to={`/people/${r.id}`}>{r.full_name}</Link></td>
                <td>{r.position ?? <span className="muted">None</span>}</td>
                <td><QualifiedBadge qualified={r.qualified} required={r.required} /></td>
                {data.columns.map((c) => (
                  <td key={c.key}>{r.cells[c.key] ? <CellChip cell={r.cells[c.key]} /> : <span className="muted" title="Not required for this position">–</span>}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    );
  }

  return (
    <div className="stack">
      <PageHeader
        title="Qualifications"
        subtitle="Who is qualified now: every mandatory course and certification of their position complete and in date."
        actions={<Link className="btn btn-secondary" to="/training/certifications">Certifications</Link>}
      />
      {data && (
        <div className="grid-stats">
          <Stat label="Qualified" icon="check-circle" color="green" value={data.counts.qualified} hint={`of ${data.counts.withRequirements} people whose position has requirements`} />
          <Stat label="Not qualified" icon="alert" color={data.counts.withRequirements - data.counts.qualified ? 'red' : undefined} value={data.counts.withRequirements - data.counts.qualified} />
          <Stat label="Certifications expired" icon="clock" color={expiring.data?.counts.expired ? 'red' : undefined} value={expiring.data?.counts.expired ?? '–'} to="/training/certifications?view=expiring" />
          <Stat label="Expiring within 90 days" icon="calendar" color={expiring.data?.counts.within90 ? 'amber' : undefined} value={expiring.data?.counts.within90 ?? '–'} to="/training/certifications?view=expiring" />
        </div>
      )}
      <Card>
        <div className="trn-filters">
          <Select label="Position" value={position} onChange={setPosition} placeholder="Every position"
            options={[{ value: '', label: 'Every position' }, ...(positions.data?.rows ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
          <Select label="Department" value={department} onChange={setDepartment} placeholder="Every department"
            options={[{ value: '', label: 'Every department' }, ...(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))]} />
          <Select label="Show" value={qualified} onChange={setQualified}
            options={[{ value: '', label: 'Everyone' }, { value: 'false', label: 'Not qualified only' }, { value: 'true', label: 'Qualified only' }]} />
        </div>
      </Card>
      <Card flush>{body}</Card>
      <p className="muted">
        In date: complete, and for a repeating course or a certification not past its date plus the requirement's grace days. Expiring: in
        date but running out within 30 days. Hover a cell for the date.
      </p>
    </div>
  );
}

interface Expiring {
  today: string; days: number;
  counts: { expired: number; within30: number; within60: number; within90: number };
  rows: { id: string; ref: string; person_id: string; person: string | null; position: string | null; department: string | null; certification_type: string; expires_on: string; days_left: number }[];
}

function ExpiringCard() {
  const [days, setDays] = useState('90');
  // E46-72: by the holder's position or department on the roster.
  const [position, setPosition] = useState('');
  const [department, setDepartment] = useState('');
  const positions = useFetch<{ rows: { id: string; name: string }[] }>('/api/positions?pageSize=500&sort=name');
  const departments = useFetch<{ id: string; name: string }[]>('/api/people/departments');
  const qs = new URLSearchParams(Object.entries({ days, position, department }).filter(([, v]) => v)).toString();
  const { data, error, reload } = useFetch<Expiring>(`/api/training/certifications/expiring?${qs}`, { keepPrevious: true });
  const filters = (
    <Card>
      <div className="trn-filters">
        <Select label="Within" value={days} onChange={(v) => setDays(v || '90')}
          options={[{ value: '30', label: '30 days' }, { value: '60', label: '60 days' }, { value: '90', label: '90 days' }, { value: '180', label: '180 days' }]} />
        <Select label="Position" value={position} onChange={setPosition} placeholder="Every position"
          options={[{ value: '', label: 'Every position' }, ...(positions.data?.rows ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
        <Select label="Department" value={department} onChange={setDepartment} placeholder="Every department"
          options={[{ value: '', label: 'Every department' }, ...(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))]} />
      </div>
    </Card>
  );
  let body;
  if (error) body = <ErrorState error={error} onRetry={reload} />;
  else if (!data) body = <Loading lines={3} />;
  else if (!data.rows.length) body = <EmptyState icon="check-circle" title="Nothing expiring" message={`No certification has expired or expires within ${days} days without a renewal.`} />;
  else {
    body = (
      <TableWrap label="Certifications expired or expiring" fit>
        <table className="table">
          <caption className="sr-only">Certifications expired or expiring</caption>
          <thead><tr><th scope="col">Certification</th><th scope="col" data-priority="1">Person</th><th scope="col" data-priority="2">Position</th><th scope="col" data-priority="3">Department</th><th scope="col" data-priority="1">Expires</th><th scope="col" className="num" data-priority="1">Days left</th></tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id}>
                <td><Link to={`/training/certifications/${r.id}`}>{r.ref}</Link> <LookupChip list="certification_type" value={r.certification_type} /></td>
                <td>{r.person ? <Link to={`/people/${r.person_id}`}>{r.person}</Link> : '–'}</td>
                <td>{r.position ?? '–'}</td>
                <td>{r.department ?? '–'}</td>
                <td>{formatDate(r.expires_on)}</td>
                <td className="num">{r.days_left < 0 ? <span className="trn-late">Expired {-r.days_left} days ago</span> : r.days_left}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    );
  }
  return (
    <>
      {filters}
      <Card title="Expired or expiring, not renewed" flush={!!data?.rows.length}>
        {data && (
          <p className="muted trn-more">
            {data.counts.expired} expired, {data.counts.within30} within 30 days, {data.counts.within60} within 60 days, {data.counts.within90} within 90 days.
          </p>
        )}
        {body}
      </Card>
    </>
  );
}

/** The expiry date with the days left: red once expired, amber within 60 days (wave 26). */
function ExpiryCell({ date }: { date: string | null | undefined }) {
  if (!date) return <span className="muted">Does not expire</span>;
  const today = todayInZone();
  const days = Math.round((Date.parse(`${String(date).slice(0, 10)}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  if (days < 0) return <span>{formatDate(date)} <Badge color="red">Expired {-days} {-days === 1 ? 'day' : 'days'} ago</Badge></span>;
  if (days <= 60) return <span>{formatDate(date)} <Badge color="amber">{days === 0 ? 'Expires today' : `${days} ${days === 1 ? 'day' : 'days'} left`}</Badge></span>;
  return <span>{formatDate(date)} <span className="muted">{days} days left</span></span>;
}

export function CertificationList() {
  const { can } = useAuth();
  const [params] = useSearchParams();
  // The expiring view names people, so it needs people.view as well.
  if (params.get('view') === 'expiring' && can('people.view')) {
    return (
      <div className="stack">
        <PageHeader
          title="Expiring certifications" breadcrumbs={[{ label: 'Certifications', to: '/training/certifications' }, { label: 'Expiring' }]}
          subtitle="Certifications that have expired or expire soon, with no later certification of the same type for the same person."
          actions={<Link className="btn btn-secondary" to="/training/certifications">All certifications</Link>}
        />
        <ExpiringCard />
      </div>
    );
  }
  return (
    <ResourceList
      type="certification"
      title="Certifications"
      // Wave 26: who, what and when it expires come first, soonest expiry first; expired and expiring ones stand out.
      columns={['person_id', 'certification_type',
        { field: 'expires_on', label: 'Expires', sortable: true, priority: 1, render: (r) => <ExpiryCell date={r.expires_on} /> },
        'status', { field: 'position_id', priority: 3 }, { field: 'department_id', priority: 3 },
        { field: 'ref', hidden: true }, { field: 'number', hidden: true }, { field: 'issuing_body', hidden: true }, { field: 'issued_on', hidden: true }]}
      defaultSort={{ field: 'expires_on', dir: 'asc' }}
      // E46-72: by the holder's position or department on the roster.
      filters={['certification_type', 'status', 'person_id', 'position_id', 'department_id', 'expires_on']}
      createFields={['person_id', 'certification_type', 'number', 'issuing_body', 'issued_on', 'expires_on', 'status', 'notes']}
      bulkFields={['status']}
      actions={can('people.view') ? <Link className="btn btn-secondary" to="/training/certifications?view=expiring">Expiring</Link> : undefined}
    />
  );
}

export function CertificationDetail() {
  return (
    <RecordPage
      type="certification"
      title={(row) => `${row._display?.certification_type ?? 'Certification'} of ${row._display?.person_id ?? 'a person'}`}
      evidence
      summaryFields={['person_id', 'certification_type', 'number', 'issuing_body', 'issued_on', 'expires_on', 'status', 'position_id', 'department_id', 'notes']}
    />
  );
}
