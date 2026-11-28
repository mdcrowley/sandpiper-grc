// The action-item matrix of a plan: each objective and its initiatives by quarter, with the status of
// that quarter's update. An empty cell opens a new update for that quarter.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorState, Loading, LookupChip, Select, TableWrap, useAuth, useFetch } from '../../core';
import { UpdateDialog } from './UpdateDialog';
import { periodLabel, type MatrixData } from './shared';

export function Matrix({ planId, start, end }: { planId: string; start?: string | null; end?: string | null }) {
  const { can } = useAuth();
  const [year, setYear] = useState('');
  const [adding, setAdding] = useState<{ objective_id?: string; initiative_id?: string; label: string; period: string } | null>(null);
  const query = year ? `?from=${year}-Q1&to=${year}-Q4` : '';
  const { data, error, reload } = useFetch<MatrixData>(`/api/strategy/plans/${planId}/matrix${query}`);
  const first = Number((start ?? '').slice(0, 4)) || new Date().getFullYear() - 2;
  const last = Number((end ?? '').slice(0, 4)) || new Date().getFullYear() + 1;
  const years = Array.from({ length: Math.min(12, Math.max(1, last - first + 1)) }, (_, i) => String(first + i));
  const mayAdd = can('strategy.create');
  return (
    <div className="stack">
      <div className="stg-toolbar">
        <Select label="Quarters shown" value={year} onChange={setYear}
          options={[{ value: '', label: 'The plan so far (latest 12)' }, ...years.map((y) => ({ value: y, label: y }))]} />
      </div>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={6} />
        : data.rows.length === 0 ? <EmptyState icon="target" title="No objectives yet" message="Add goals and objectives to the plan; their quarterly updates appear here." />
        : (
          <TableWrap label="Status of each objective and initiative by quarter" fit>
            <table className="table stg-matrix">
              <thead>
                <tr>
                  <th scope="col" data-priority="1">Objective or initiative</th>
                  {data.quarters.map((q, i) => <th key={q} scope="col" data-priority={i >= data.quarters.length - 4 ? 1 : 2}>{periodLabel(q)}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} className={r.kind === 'initiative' ? 'stg-sub' : undefined}>
                    <td data-priority="1" className="stg-row">
                      <Link to={`/strategy/${r.kind === 'objective' ? 'objectives' : 'initiatives'}/${r.id}`}>{[r.kind === 'objective' ? r.code : r.ref, r.title].filter(Boolean).join(' ')}</Link>
                      {r.kind === 'objective' && <div className="muted stg-small">{r.goal}</div>}
                    </td>
                    {data.quarters.map((q, i) => {
                      const c = r.cells[q];
                      return (
                        <td key={q} data-priority={i >= data.quarters.length - 4 ? 1 : 2} title={c?.narrative ?? undefined}>
                          {c ? <LookupChip list="strategy_rag" value={c.status} />
                            : mayAdd ? (
                              <button type="button" className="stg-add" aria-label={`Add the ${periodLabel(q)} update of ${r.title}`}
                                onClick={() => setAdding({ ...(r.kind === 'objective' ? { objective_id: r.id } : { initiative_id: r.id }), label: r.title, period: q })}>+</button>
                            ) : <span className="muted">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      {adding && <UpdateDialog subject={adding} onClose={() => setAdding(null)} onSaved={() => { setAdding(null); reload(); }} />}
    </div>
  );
}
