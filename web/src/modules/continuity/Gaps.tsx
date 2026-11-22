// The gap report: active processes whose tolerable downtime (or own recovery target) is shorter than
// the recovery time of a system they critically depend on, and those depending on a system whose
// recovery time is not known.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, EmptyState, ErrorState, Loading, LookupChip, PageHeader, Switch, TableWrap, useFetch } from '../../core';
import { ContinuityTabs, hoursText } from './shared';

interface GapSystem { id: string; name: string | null; hidden: boolean; rto_hours: number | null; via: { id: string; label: string | null } | null; exceeds_mtd: boolean; exceeds_target: boolean }
interface GapRow {
  id: string; ref: string; name: string; criticality: string | null; mtd_hours: number | null; rto_target_hours: number | null;
  gap: boolean; target_gap: boolean; unknown: number; worst_rto: number | null; systems: GapSystem[];
}

function Findings({ r }: { r: GapRow }) {
  const parts: string[] = [];
  if (r.gap) parts.push(`A system needs ${hoursText(r.worst_rto)} to recover; the process tolerates ${hoursText(r.mtd_hours)}.`);
  if (r.target_gap) parts.push(`Its recovery target of ${hoursText(r.rto_target_hours)} is shorter than a system's recovery time.`);
  if (r.unknown) parts.push(`${r.unknown} critical system${r.unknown === 1 ? ' has' : 's have'} no recovery time recorded.`);
  if (r.mtd_hours === null) parts.push('The tolerable downtime is not set.');
  return <>{parts.map((p) => <p key={p} className="bc-finding">{p}</p>)}</>;
}

export function GapReport() {
  const [all, setAll] = useState(false);
  const { data, error, reload } = useFetch<{ services_included: boolean; rows: GapRow[] }>(`/api/continuity/gaps${all ? '?all=1' : ''}`, { keepPrevious: true });
  const header = (
    <>
      <PageHeader title="Gap report" subtitle="Processes that cannot be recovered within the downtime they tolerate, because a system they need takes longer to recover." />
      <ContinuityTabs active="gaps" />
    </>
  );
  if (error && !data) return <div className="stack">{header}<ErrorState error={error} onRetry={reload} /></div>;
  if (!data) return <div className="stack">{header}<Loading lines={6} label="Loading the gap report" /></div>;
  return (
    <div className="stack">
      {header}
      <div className="row bc-between">
        <p className="muted">
          Compares each active process's maximum tolerable downtime with the recovery time objective of the systems it critically depends on
          {data.services_included ? ', directly or through a service' : ''}.
        </p>
        <Switch label="Show every active process" checked={all} onChange={setAll} />
      </div>
      {data.rows.length === 0 ? (
        <EmptyState icon="check" title={all ? 'No active processes' : 'No gaps found'}
          message={all ? 'Add business processes and mark them active.' : 'Every active process can be recovered within the downtime it tolerates, as far as the recorded recovery times show.'} />
      ) : data.rows.map((r) => (
        <Card key={r.id} title={`${r.ref} ${r.name}`} className={r.gap ? 'bc-gap bc-gap-red' : r.target_gap || r.unknown ? 'bc-gap bc-gap-amber' : 'bc-gap'}
          actions={<Link className="btn btn-ghost btn-sm" to={`/continuity/processes/${r.id}?tab=dependencies`}>Open process</Link>}>
          <div className="bc-gap-head">
            {r.criticality && <LookupChip list="process_criticality" value={r.criticality} />}
            <span>Tolerates <strong>{hoursText(r.mtd_hours)}</strong></span>
            <span>Recovery target <strong>{hoursText(r.rto_target_hours)}</strong></span>
          </div>
          <Findings r={r} />
          {r.systems.length === 0 ? <p className="muted">No critical system dependencies recorded.</p> : (
            <TableWrap label={`Critical systems of ${r.name}`}>
              <table className="table">
                <caption className="sr-only">Critical systems of {r.name}</caption>
                <thead><tr><th scope="col">System</th><th scope="col">Recovery time</th><th scope="col">Through</th><th scope="col">Finding</th></tr></thead>
                <tbody>
                  {r.systems.map((s) => (
                    <tr key={s.id}>
                      <td>{s.hidden ? <span className="muted">A system you cannot see</span> : <Link to={`/systems/${s.id}`}>{s.name}</Link>}</td>
                      <td>{s.rto_hours === null ? <span className="bc-warn">Not known</span> : hoursText(s.rto_hours)}</td>
                      <td>{s.via ? (s.via.label ?? 'A service you cannot see') : <span className="muted">Direct</span>}</td>
                      <td>{s.exceeds_mtd ? <span className="bc-bad">Longer than tolerated</span> : s.exceeds_target ? <span className="bc-warn">Longer than the target</span> : s.rto_hours === null ? <span className="bc-warn">Unknown</span> : <span className="muted">Within</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      ))}
    </div>
  );
}
