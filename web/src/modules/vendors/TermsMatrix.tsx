// Security-terms matrix: a heat grid with vendors down, clauses across, each cell the weakest
// position across that vendor's contracts, a coverage column per vendor and a coverage row per clause.
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SegmentedControl, Tooltip } from '@mantine/core';
import {
  Card, cx, EmptyState, ErrorState, Loading, MultiSelect, PageHeader, Stat, StatusChip, TextField, toColorName, useFetch,
  useLookup,
} from '../../core';
import { CLAUSE_ORDER, CLAUSE_STATUS, ClauseGlyph, CoverageMeter } from './shared';
import type { ClauseKey, Matrix, MatrixItem, MatrixVendor, TermCounts } from './shared';

type Show = 'all' | 'gaps' | 'unassessed';
const SHOW: { value: Show; label: string }[] = [
  { value: 'all', label: 'All vendors' },
  { value: 'gaps', label: 'With gaps' },
  { value: 'unassessed', label: 'Not fully assessed' },
];

const blank = (): TermCounts => ({ present: 0, partial: 0, absent: 0, not_assessed: 0 });
const bump = (t: TermCounts, status: ClauseKey) => { t[status === 'none' ? 'not_assessed' : status] += 1; };

function vendorTerms(v: MatrixVendor, clauses: Matrix['clauses']): TermCounts {
  const t = blank();
  for (const c of clauses) bump(t, v.cells[c.key]?.status ?? 'none');
  return t;
}

function Legend() {
  return (
    <ul className="vnd-legend" aria-label="Legend">
      {CLAUSE_ORDER.map((s) => (
        <li key={s}>
          <span className={cx('vnd-cell', `vnd-cell-${s}`)} aria-hidden="true"><ClauseGlyph status={s} size={14} /></span>
          {CLAUSE_STATUS[s].label}
        </li>
      ))}
    </ul>
  );
}

function CellTip({ vendor, clause, status, items }: { vendor: MatrixVendor; clause: Matrix['clauses'][number]; status: ClauseKey; items: MatrixItem[] }) {
  return (
    <div className="vnd-tip">
      <div className="vnd-tip-head">{vendor.name} · {clause.label}</div>
      <div className="vnd-tip-status">{CLAUSE_STATUS[status].label}{items.length > 1 ? ' (the weakest of its contracts)' : ''}</div>
      {vendor.contracts === 0 && <p>No contract recorded.</p>}
      {vendor.contracts > 0 && items.length === 0 && <p>Not assessed on any contract.</p>}
      {items.map((i) => (
        <p key={i.contract_id}>
          {items.length > 1 && <span className="vnd-tip-ref">{i.contract_ref ?? i.contract_title}: </span>}
          {i.clause_text || 'No clause text recorded.'}
          {i.note ? ` (${i.note})` : ''}
        </p>
      ))}
    </div>
  );
}

const cellWords = (items: MatrixItem[]) => items.map((i) => i.clause_text).filter(Boolean).join(' / ') || 'No clause text recorded';

export function TermsMatrix() {
  const levels = useLookup('vendor_criticality');
  const [params, setParams] = useSearchParams();
  const wanted = (params.get('criticality') ?? '').split(',').filter(Boolean);
  const show = (SHOW.some((s) => s.value === params.get('show')) ? params.get('show') : 'all') as Show;
  const q = params.get('q') ?? '';
  const set = (key: string, value: string) => setParams((p) => {
    if (value) p.set(key, value); else p.delete(key);
    return p;
  }, { replace: true });

  const { data, error, loading, reload } = useFetch<Matrix>(
    `/api/vendors/terms-matrix${wanted.length ? `?criticality=${wanted.join(',')}` : ''}`, { keepPrevious: true },
  );

  const view = useMemo(() => {
    if (!data) return null;
    const rows = data.vendors.map((v) => ({ v, terms: vendorTerms(v, data.clauses) }));
    const needle = q.trim().toLowerCase();
    const shown = rows.filter(({ v, terms }) => {
      if (needle && !v.name.toLowerCase().includes(needle)) return false;
      if (show === 'gaps') return terms.absent + terms.partial > 0;
      if (show === 'unassessed') return terms.not_assessed > 0;
      return true;
    });
    const byClause = data.clauses.map((c) => {
      const t = blank();
      for (const { v } of shown) bump(t, v.cells[c.key]?.status ?? 'none');
      return t;
    });
    const overall = blank();
    for (const t of byClause) for (const k of Object.keys(t) as (keyof TermCounts)[]) overall[k] += t[k];
    return { rows, shown, byClause, overall };
  }, [data, q, show]);

  let body;
  if (error) body = <ErrorState error={error} onRetry={reload} />;
  else if (!data || !view) body = <Loading lines={8} label="Loading the matrix" />;
  else if (!data.vendors.length) {
    body = wanted.length
      ? <EmptyState icon="filter" title="No vendors match" message="No vendor has the criticality you chose. Clear the filter to see them all." />
      : <EmptyState icon="shield" title="No vendors yet" message="Add vendors and their contracts, then record the security terms on each contract." />;
  } else if (!view.shown.length) {
    body = <EmptyState icon="filter" title="No vendors match" message="No vendor matches the search and filters. Clear them to see every vendor." />;
  } else {
    const cells = view.overall.present + view.overall.partial + view.overall.absent + view.overall.not_assessed;
    body = (
      <>
        <div className="grid-stats">
          <Stat label="Vendors shown" value={view.shown.length} hint={`of ${data.vendors.length}`} icon="building" />
          <Stat label="Terms present" value={cells ? `${Math.round((view.overall.present / cells) * 100)}%` : '—'} color="green" hint={`${view.overall.present} of ${cells} cells`} />
          <Stat label="Absent" value={view.overall.absent} color={view.overall.absent ? 'red' : 'green'} hint={`${view.overall.partial} partial`} />
          <Stat label="Not assessed" value={view.overall.not_assessed} color={view.overall.not_assessed ? 'gray' : 'green'} hint="cells still to check" />
        </div>
        <div className={cx('vnd-grid-wrap', loading && 'table-loading')} tabIndex={0} role="region" aria-label="Security terms by vendor">
          <table className="vnd-grid">
            <caption className="sr-only">
              Security terms by vendor. Each cell gives the status of one clause: present, partial, absent or not assessed.
            </caption>
            <thead>
              <tr>
                <th scope="col" className="vnd-grid-corner">Vendor</th>
                {data.clauses.map((c) => (
                  <th key={c.key} scope="col" className="vnd-grid-clause">
                    <Tooltip label={c.description ?? c.label} multiline w={260} withArrow events={{ hover: true, focus: true, touch: true }}>
                      <span tabIndex={0} lang="en-US">{c.label}</span>
                    </Tooltip>
                  </th>
                ))}
                <th scope="col" className="vnd-grid-sum">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {view.shown.map(({ v, terms }) => (
                <tr key={v.id} className={cx(v.contracts === 0 && 'vnd-grid-empty')}>
                  <th scope="row" className="vnd-grid-vendor">
                    <Link to={`/vendors/${v.id}`} className="vnd-grid-name">{v.name}</Link>
                    <span className="vnd-grid-sub">
                      {v.criticality
                        ? <StatusChip color={toColorName(v.criticality_color)} label={v.criticality_label ?? v.criticality} />
                        : null}
                      {v.contracts === 0 && <span className="muted">No contract recorded</span>}
                    </span>
                  </th>
                  {data.clauses.map((c) => {
                    const cell = v.cells[c.key] ?? { status: null, items: [] };
                    const key: ClauseKey = cell.status ?? 'none';
                    return (
                      <td key={c.key}>
                        <Tooltip
                          label={<CellTip vendor={v} clause={c} status={key} items={cell.items} />}
                          multiline w={320} withArrow openDelay={80} events={{ hover: true, focus: true, touch: true }}
                        >
                          <Link to={`/vendors/${v.id}?tab=terms`} className={cx('vnd-cell', `vnd-cell-${key}`)}>
                            <ClauseGlyph status={key} />
                            <span className="sr-only">{CLAUSE_STATUS[key].label}. {cellWords(cell.items)}. Open {v.name}.</span>
                          </Link>
                        </Tooltip>
                      </td>
                    );
                  })}
                  <td className="vnd-grid-sum"><CoverageMeter terms={terms} compact label={`Coverage for ${v.name}`} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="vnd-grid-vendor">Vendors with the term</th>
                {data.clauses.map((c, i) => {
                  const t = view.byClause[i];
                  return (
                    <td key={c.key}>
                      <span className="vnd-grid-foot">
                        <strong>{t.present}</strong><span className="muted">/{view.shown.length}</span>
                        <CoverageMeter terms={t} compact label={c.label} />
                      </span>
                    </td>
                  );
                })}
                <td className="vnd-grid-sum"><CoverageMeter terms={view.overall} compact label="All cells shown" /></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="muted vnd-grid-note">
          Point at a cell, or move to it with the Tab key, to read the clause text; select it to open that vendor's checklist.
          With several contracts a cell shows the weakest position. Contracts that have ended are left out.
        </p>
      </>
    );
  }

  return (
    <div className="stack">
      <PageHeader
        title="Security terms matrix"
        subtitle="Which security terms each vendor's contracts contain, and where the gaps are."
        breadcrumbs={[{ label: 'Vendors', to: '/vendors' }, { label: 'Security terms matrix' }]}
      />
      <Card>
        <div className="vnd-toolbar">
          <div className="vnd-toolbar-filters">
            <TextField label="Search vendors" hideLabel type="search" placeholder="Search vendors" value={q} onChange={(v) => set('q', v)} />
            <MultiSelect
              label="Criticality" value={wanted} onChange={(next) => set('criticality', next.join(','))}
              options={levels.map((l) => ({ value: l.value, label: l.label }))}
            />
            <SegmentedControl size="xs" aria-label="Which vendors to show" data={SHOW} value={show} onChange={(v) => set('show', v === 'all' ? '' : v)} />
          </div>
          <Legend />
        </div>
        {body}
      </Card>
    </div>
  );
}
