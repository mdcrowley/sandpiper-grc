// Inventory extension (wave 26): the insurance policies that cover an asset, vehicle, site or system.
import { Link } from 'react-router-dom';
import { Card, EmptyState, ErrorState, formatCurrency, formatDate, Loading, LookupChip, TableWrap, useAuth, useFetch } from '../../core';
import type { InventoryPanelDef, InventoryPanelProps } from '../inventory/Extensions';

interface Covering { id: string; ref: string; title: string; line: string | null; status: string | null; expires_on: string | null; limit_per_occurrence: number | null; deductible: number | null }

function CoveringPolicies({ recordType, recordId }: InventoryPanelProps) {
  const { can } = useAuth();
  const allowed = can('insurance.view');
  const { data, error, reload } = useFetch<{ rows: Covering[]; hidden: number }>(allowed ? `/api/insurance/covering?record_type=${recordType}&record_id=${recordId}` : null);
  if (!allowed) return null;
  return (
    <Card title="Insurance" flush>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <div className="ins-pad"><Loading lines={2} /></div>
        : data.rows.length === 0 && !data.hidden ? <EmptyState icon="shield" title="No policy lists this as covered" message="Covered records are listed on each insurance policy." />
        : (
          <>
            {data.rows.length > 0 && (
              <TableWrap label="Policies that cover this record" fit>
                <table className="table">
                  <caption className="sr-only">Policies that cover this record</caption>
                  <thead><tr><th scope="col">Policy</th><th scope="col">Line</th><th scope="col">Status</th><th scope="col" data-priority="2">Expires</th><th scope="col" data-priority="3">Deductible</th></tr></thead>
                  <tbody>
                    {data.rows.map((p) => (
                      <tr key={p.id}>
                        <td><Link className="row-title" to={`/insurance/${p.id}`}><span className="ref">{p.ref}</span> {p.title}</Link></td>
                        <td>{p.line ? <LookupChip list="insurance_line" value={p.line} /> : '—'}</td>
                        <td>{p.status ? <LookupChip list="insurance_policy_status" value={p.status} /> : '—'}</td>
                        <td data-priority="2">{p.expires_on ? formatDate(p.expires_on) : '—'}</td>
                        <td data-priority="3">{formatCurrency(p.deductible)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
            {data.hidden > 0 && <p className="muted ins-pad ins-small">Also covered by {data.hidden} {data.hidden === 1 ? 'policy' : 'policies'} you cannot open.</p>}
          </>
        )}
    </Card>
  );
}

export const panels: InventoryPanelDef[] = [
  { key: 'insurance', label: 'Insurance', area: 'insurance', appliesTo: ['asset', 'vehicle', 'site', 'system'], Panel: CoveringPolicies },
];
