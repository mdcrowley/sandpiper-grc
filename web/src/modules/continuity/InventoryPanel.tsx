// Inventory extension (wave 11 contract C2): the business processes that depend on a system or a
// site, with how long each can be down. A system also lists the processes that depend on a service
// built on it.
import { Link } from 'react-router-dom';
import { Card, EmptyState, ErrorState, Loading, LookupChip, useAuth, useFetch } from '../../core';
import type { InventoryPanelDef, InventoryPanelProps } from '../inventory/Extensions';
import { hoursText } from './shared';

interface Dependent { id: string; ref: string; name: string; criticality: string | null; status: string; mtd_hours: number | null; critical: boolean; via: { id: string; label: string | null } | null }

function DependentProcesses({ recordType, recordId, row }: InventoryPanelProps) {
  const { can } = useAuth();
  const allowed = can('continuity.view');
  const { data, error, reload } = useFetch<Dependent[]>(allowed ? `/api/continuity/dependents?type=${recordType}&id=${recordId}` : null);
  if (!allowed) return null;
  const rto = recordType === 'system' && row.rto_hours !== null && row.rto_hours !== undefined ? Number(row.rto_hours) : null;
  return (
    <Card title="Business processes that depend on this" flush>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <div className="bc-pad"><Loading lines={2} /></div>
        : data.length === 0 ? <EmptyState icon="shield" title="No business process depends on this" message="Dependencies are recorded on each business process." />
        : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Business processes that depend on this record</caption>
              <thead><tr><th scope="col">Process</th><th scope="col">Criticality</th><th scope="col">Tolerable downtime</th><th scope="col">Through</th></tr></thead>
              <tbody>
                {data.map((d) => (
                  <tr key={`${d.id}-${d.via?.id ?? ''}`}>
                    <td><Link className="row-title" to={`/continuity/processes/${d.id}`}><span className="ref">{d.ref}</span> {d.name}</Link>{!d.critical && <span className="muted"> (not critical)</span>}</td>
                    <td>{d.criticality ? <LookupChip list="process_criticality" value={d.criticality} /> : <span className="muted">Not set</span>}</td>
                    <td className={rto !== null && d.mtd_hours !== null && d.critical && rto > d.mtd_hours ? 'bc-bad' : undefined}>
                      {hoursText(d.mtd_hours)}{rto !== null && d.mtd_hours !== null && d.critical && rto > d.mtd_hours ? ' (shorter than this system\'s recovery time)' : ''}
                    </td>
                    <td>{d.via ? (d.via.label ?? 'A service you cannot see') : <span className="muted">Direct</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </Card>
  );
}

export const panels: InventoryPanelDef[] = [
  { key: 'continuity', label: 'Business processes', area: 'continuity', appliesTo: ['system', 'site'], Panel: DependentProcesses },
];
