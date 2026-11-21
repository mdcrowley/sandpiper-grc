// The coverage view: which risks, hazards, framework outcomes, obligations and policies rely on
// controls that are ineffective, overdue for a test, untested or only partly effective. Only the
// records this person may see are listed.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, EmptyState, ErrorState, Loading, LookupChip, MultiSelect, PageHeader, useFetch } from '../../core';
import { ControlsTabs, STATE_INFO, STATE_ORDER, StateChip, type CoverState } from './shared';

interface MatrixControl { id: string; ref: string; title: string; key_control: boolean; state: CoverState }
interface MatrixRow {
  type: string; typeLabel: string; id: string; ref: string | null; title: string; route: string;
  status: string | null; status_list: string | null; state: CoverState; controls: MatrixControl[];
}
interface Matrix { types: { type: string; label: string; plural: string }[]; counts: Record<CoverState, number>; rows: MatrixRow[] }

export function CoveragePage() {
  const { data, error, reload } = useFetch<Matrix>('/api/controls/coverage-matrix');
  const [types, setTypes] = useState<string[]>([]);
  const [states, setStates] = useState<string[]>([]);
  const rows = useMemo(() => (data?.rows ?? []).filter((r) => (!types.length || types.includes(r.type)) && (!states.length || states.includes(r.state))), [data, types, states]);

  const header = (
    <>
      <PageHeader title="Control coverage" subtitle="Which records rely on controls that are failing, overdue or not yet tested." />
      <ControlsTabs active="coverage" />
    </>
  );
  if (error) return <div className="stack">{header}<ErrorState title="Coverage could not be loaded" error={error} onRetry={reload} /></div>;
  if (!data) return <div className="stack">{header}<Loading lines={8} label="Loading control coverage" /></div>;

  return (
    <div className="stack">
      {header}
      <div className="ctl-states" role="group" aria-label="Covered records by their weakest control">
        {STATE_ORDER.map((s) => {
          const on = states.includes(s);
          return (
            <button key={s} type="button" className={`ctl-state${on ? ' is-on' : ''}`} aria-pressed={on}
              onClick={() => setStates(on ? states.filter((x) => x !== s) : [...states, s])}>
              <strong className="num">{data.counts[s] ?? 0}</strong>
              <span><StateChip state={s} /></span>
              <span className="muted ctl-state-hint">{STATE_INFO[s].hint}</span>
            </button>
          );
        })}
      </div>
      <Card title="Covered records" flush
        actions={data.types.length > 1 ? <MultiSelect label="Kinds of record" options={data.types.map((t) => ({ value: t.type, label: t.plural }))} value={types} onChange={setTypes} size="sm" /> : undefined}>
        {rows.length === 0 ? (
          <EmptyState icon="shield" title={data.rows.length ? 'Nothing matches the filters' : 'No covered records you can see'}
            message={data.rows.length ? 'Clear a filter to see more.' : 'Link controls to the risks, hazards, outcomes, obligations and policies they cover, from each control\'s Coverage tab.'} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Covered records, weakest first, with the controls each relies on</caption>
              <thead><tr><th scope="col">Record</th><th scope="col">Kind</th><th scope="col">Status</th><th scope="col">Weakest control</th><th scope="col">Controls</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.type}-${r.id}`}>
                    <td className="ctl-wrap"><Link to={`${r.route}/${r.id}`}>{r.ref && <span className="ref">{r.ref}</span>} {r.title}</Link></td>
                    <td>{r.typeLabel}</td>
                    <td>{r.status && r.status_list ? <LookupChip list={r.status_list} value={r.status} /> : <span className="muted">—</span>}</td>
                    <td><StateChip state={r.state} /></td>
                    <td className="ctl-wrap">
                      <ul className="ctl-inline">
                        {r.controls.map((c) => (
                          <li key={c.id}><Link to={`/controls/${c.id}`} title={`${c.title}: ${STATE_INFO[c.state].label}`}><span className="ref">{c.ref}</span></Link> <span className="muted">{STATE_INFO[c.state].label}</span></li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
