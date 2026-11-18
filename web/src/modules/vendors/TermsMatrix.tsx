// Security-terms matrix: vendors down, clauses across, each cell the worst status across that vendor's contracts.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Card, cx, EmptyState, ErrorState, Loading, MultiSelect, PageHeader, StatusChip, toColorName, useFetch, useLookup,
} from '../../core';
import { ClauseChip, CLAUSE_STATUS } from './shared';
import type { ClauseStatus, Matrix, MatrixItem, MatrixVendor } from './shared';

const LETTER: Record<ClauseStatus | 'none', string> = { present: 'P', partial: 'Pt', absent: 'A', none: '–' };
const ORDER: (ClauseStatus | 'none')[] = ['present', 'partial', 'absent', 'none'];

interface Focus { vendor: MatrixVendor; clause: Matrix['clauses'][number]; status: ClauseStatus | null; items: MatrixItem[] }

function cellSummary(items: MatrixItem[]): string {
  const texts = items.map((i) => i.clause_text).filter(Boolean);
  return texts.length ? texts.join(' / ') : 'No clause text recorded';
}

function Legend() {
  return (
    <ul className="vnd-legend" aria-label="Legend">
      {ORDER.map((s) => (
        <li key={s}>
          <span className={cx('vnd-cell', `vnd-cell-${s}`)} aria-hidden="true">{LETTER[s]}</span>
          {CLAUSE_STATUS[s].label}
        </li>
      ))}
      <li className="muted">With several contracts, a cell shows the weakest position.</li>
    </ul>
  );
}

function Detail({ focus }: { focus: Focus | null }) {
  if (!focus) {
    return <p className="vnd-detail muted">Point at a cell, or move to it with the Tab key, to read the clause text. Select it to open the vendor.</p>;
  }
  return (
    <div className="vnd-detail">
      <div className="row">
        <strong>{focus.vendor.name}</strong>
        <span className="muted">{focus.clause.label}</span>
        <ClauseChip status={focus.status} />
      </div>
      {focus.items.length === 0 && <p className="muted">Not assessed on any contract.</p>}
      {focus.items.map((i) => (
        <p key={i.contract_id} className="vnd-detail-item">
          {focus.items.length > 1 && <span className="muted">{i.contract_ref ?? i.contract_title}: </span>}
          {i.clause_text || <span className="muted">No clause text recorded.</span>}
          {i.note && <span className="muted"> ({i.note})</span>}
        </p>
      ))}
    </div>
  );
}

export function TermsMatrix() {
  const levels = useLookup('vendor_criticality');
  const [wanted, setWanted] = useState<string[]>([]);
  const [focus, setFocus] = useState<Focus | null>(null);
  const { data, error, loading, reload } = useFetch<Matrix>(
    `/api/vendors/terms-matrix${wanted.length ? `?criticality=${wanted.join(',')}` : ''}`,
  );

  let body;
  if (error) body = <ErrorState error={error} onRetry={reload} />;
  else if (!data) body = <Loading lines={8} label="Loading the matrix" />;
  else if (!data.vendors.length) {
    body = wanted.length
      ? <EmptyState icon="filter" title="No vendors match" message="No vendor has the criticality you chose. Clear the filter to see them all." />
      : <EmptyState icon="shield" title="No vendors yet" message="Add vendors and their contracts, then record the security terms on each contract." />;
  } else {
    body = (
      <>
        <Detail focus={focus} />
        <div className={cx('table-wrap', loading && 'table-loading')}>
          <table className="table vnd-matrix">
            <caption className="sr-only">
              Security terms by vendor. Each cell gives the status of one clause: present, partial, absent or not assessed.
            </caption>
            <thead>
              <tr>
                <th scope="col">Vendor</th>
                <th scope="col">Criticality</th>
                {data.clauses.map((c) => (
                  <th key={c.key} scope="col" className="vnd-matrix-clause" title={c.description ?? undefined}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.vendors.map((v) => (
                <tr key={v.id}>
                  <th scope="row">
                    <Link to={`/vendors/${v.id}`} className="row-title">{v.name}</Link>
                    {v.contracts === 0 && <span className="vnd-clause-hint">No contract recorded</span>}
                  </th>
                  <td>
                    {v.criticality
                      ? <StatusChip color={toColorName(v.criticality_color)} label={v.criticality_label ?? v.criticality} />
                      : <span className="muted">—</span>}
                  </td>
                  {data.clauses.map((c) => {
                    const cell = v.cells[c.key] ?? { status: null, items: [] };
                    const key = cell.status ?? 'none';
                    const show = () => setFocus({ vendor: v, clause: c, status: cell.status, items: cell.items });
                    return (
                      <td key={c.key} className="vnd-matrix-cell">
                        <Link
                          to={`/vendors/${v.id}?tab=terms`}
                          className={cx('vnd-cell', `vnd-cell-${key}`)}
                          title={`${CLAUSE_STATUS[key].label}: ${cellSummary(cell.items)}`}
                          onMouseEnter={show} onFocus={show}
                        >
                          <span aria-hidden="true">{LETTER[key]}</span>
                          <span className="sr-only">
                            {CLAUSE_STATUS[key].label}. {cellSummary(cell.items)}. Open {v.name}.
                          </span>
                        </Link>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  return (
    <div className="stack">
      <PageHeader
        title="Security terms matrix"
        subtitle="Which security terms each vendor's contracts contain."
        breadcrumbs={[{ label: 'Vendors', to: '/vendors' }, { label: 'Security terms matrix' }]}
      />
      <Card>
        <div className="row vnd-matrix-bar">
          <MultiSelect
            label="Criticality" value={wanted} onChange={(next) => { setWanted(next); setFocus(null); }}
            options={levels.map((l) => ({ value: l.value, label: l.label }))}
          />
          <Legend />
        </div>
        {body}
      </Card>
    </div>
  );
}
