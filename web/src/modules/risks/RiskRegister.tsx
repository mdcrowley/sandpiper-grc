import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SegmentedControl } from '@mantine/core';
import {
  Button, Card, EmptyState, ErrorState, Loading, LookupChip, PageHeader, ResourceList, Select, Stat, Switch, useAuth, useFetch,
} from '../../core';
import type { ColorName, Row } from '../../core';
import { cellKey, HeatMap, type HeatCell, type HeatMapData } from './HeatMap';
import { RatingChip, useScales } from './scales';

interface Summary {
  total: number;
  unscored: number;
  needs_review: number;
  reviews_due: number;
  acceptances_expiring: number;
  acceptances_expired: number;
  levels: { value: string; label: string; color: string; count: number }[];
}

const RANKED = 8;

/**
 * The risk register: a summary strip, the heat map with the ranked risks beside it, and the full
 * list. What the heat map shows (scale, basis, chosen cell, movement, closed risks) lives in the
 * page address, so a view can be bookmarked, sent to a colleague or printed for a board pack.
 */
export function RiskRegister() {
  const { can } = useAuth();
  const { data: scales, error, reload } = useScales();
  const summary = useFetch<Summary>('/api/risks/summary');
  const [params, setParams] = useSearchParams();

  const scaleKey = scales?.find((s) => s.key === params.get('scale'))?.key ?? scales?.[0]?.key ?? '';
  const basis = params.get('basis') === 'inherent' ? 'inherent' : 'residual';
  const movement = params.get('movement') === '1';
  const closed = params.get('closed') === '1';
  const cell = params.get('cell');

  const heat = useFetch<HeatMapData>(
    scaleKey ? `/api/risks/heatmap?scale=${encodeURIComponent(scaleKey)}&basis=${basis}${closed ? '&include_closed=true' : ''}` : null,
    { keepPrevious: true },
  );
  const set = (patch: Record<string, string | null>) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    for (const [k, v] of Object.entries(patch)) { if (v === null) next.delete(k); else next.set(k, v); }
    next.delete('page');
    return next;
  });

  const scale = scales?.find((s) => s.key === scaleKey);
  const chosen: HeatCell | undefined = heat.data?.scale.key === scaleKey ? heat.data.cells.find((c) => cellKey(c) === cell && c.count > 0) : undefined;
  // Drill-down: the list shows exactly the risks counted in the chosen cell.
  const baseFilter = useMemo(() => (chosen ? { id: chosen.risk_ids.join(',') } : undefined), [chosen]);

  if (error) return <><PageHeader title="Risk register" /><ErrorState error={error} onRetry={reload} /></>;
  if (!scales) return <><PageHeader title="Risk register" /><Loading /></>;

  const scaleOf = (row: Row) => scales.find((s) => s.key === row.scale_key);
  const levelName = (levels: { value: number; label: string }[] | undefined, v: number) => levels?.find((l) => l.value === v)?.label ?? String(v);
  const chosenName = chosen && scale ? `${levelName(scale.likelihood_levels, chosen.likelihood)} by ${levelName(scale.impact_levels, chosen.impact)}` : '';
  const ranked = heat.data ? (chosen ? heat.data.risks.filter((r) => chosen.risk_ids.includes(r.id)) : heat.data.risks.filter((r) => r.score !== null)) : [];
  const s = summary.data;
  const level = (v: string) => s?.levels.find((l) => l.value === v);

  return (
    <div className="stack rk-register">
      <PageHeader
        title="Risk register"
        subtitle="Restricted: visible only to people with access to security records."
        actions={(
          <>
            <Link className="btn btn-secondary" to="/risks/reviews">Reviews and acceptances</Link>
            <Link className="btn btn-secondary" to="/risks/report">Risk report</Link>
            {can('risks.administer') && <Link className="btn btn-secondary" to="/risks/scales">Risk scales</Link>}
            <Button icon="download" onClick={() => window.print()}>Print</Button>
          </>
        )}
      />

      {summary.error ? <ErrorState error={summary.error} onRetry={summary.reload} /> : (
        <div className="grid-stats rk-strip" aria-busy={!s}>
          <Stat label="Open risks" value={s?.total ?? '–'} color="blue" icon="alert" hint={s && s.unscored > 0 ? `${s.unscored} not yet scored` : 'All scales'} />
          <Stat label={level('critical')?.label ?? 'Critical'} value={level('critical')?.count ?? '–'} color={(level('critical')?.color ?? 'red') as ColorName} to="/risks?f.summary_level=critical" hint="Common level" />
          <Stat label={level('high')?.label ?? 'High'} value={level('high')?.count ?? '–'} color={(level('high')?.color ?? 'orange') as ColorName} to="/risks?f.summary_level=high" hint="Common level" />
          <Stat label="Reviews due" value={s?.reviews_due ?? '–'} color={s && s.reviews_due > 0 ? 'amber' : 'green'} icon="calendar" to="/risks/reviews" hint="Review date reached" />
          <Stat
            label="Acceptances to renew" value={s ? s.acceptances_expired + s.acceptances_expiring : '–'}
            color={s && s.acceptances_expired > 0 ? 'red' : s && s.acceptances_expiring > 0 ? 'amber' : 'green'} icon="clock" to="/risks/reviews"
            hint={s ? `${s.acceptances_expired} expired, ${s.acceptances_expiring} within 60 days` : undefined}
          />
        </div>
      )}

      <Card
        title="Heat map"
        className="rk-heat-card"
        actions={(
          <div className="rk-heat-tools">
            {scales.length <= 3 ? (
              <SegmentedControl
                size="xs" aria-label="Scale" value={scaleKey}
                data={scales.map((x) => ({ value: x.key, label: x.name.replace(/\s*\(.*\)$/, '') }))}
                onChange={(v) => set({ scale: v, cell: null })}
              />
            ) : (
              <Select hideLabel label="Scale" size="xs" required value={scaleKey} options={scales.map((x) => ({ value: x.key, label: x.name }))} onChange={(v) => set({ scale: v || null, cell: null })} />
            )}
            <SegmentedControl
              size="xs" aria-label="Show" value={basis}
              data={[{ value: 'residual', label: 'Residual' }, { value: 'inherent', label: 'Inherent' }]}
              onChange={(v) => set({ basis: v === 'inherent' ? 'inherent' : null, cell: null })}
            />
            <Switch label="Show movement" checked={movement} onChange={(on) => set({ movement: on ? '1' : null })} />
            <Switch label="Include closed risks" checked={closed} onChange={(on) => set({ closed: on ? '1' : null, cell: null })} />
          </div>
        )}
      >
        {heat.error ? <ErrorState error={heat.error} onRetry={heat.reload} />
          : !heat.data || !scale ? <Loading lines={8} label="Loading heat map" />
          : (
            <div className="rk-heat-layout">
              <div>
                <p className="rk-heat-lede">
                  <strong>{basis === 'residual' ? 'Residual risk' : 'Inherent risk'}</strong>{' '}
                  <span className="muted">
                    {basis === 'residual' ? 'with existing controls in place' : 'before existing controls'} · {scale.name}
                    {closed ? ' · closed risks included' : ''}
                  </span>
                  {scale.description && <span className="rk-heat-desc muted">{scale.description}</span>}
                </p>
                <HeatMap data={heat.data} selected={chosen ? cellKey(chosen) : null} showMovement={movement} onSelect={(c) => set({ cell: c ? cellKey(c) : null })} />
              </div>
              <div className="rk-ranked">
                <div className="rk-ranked-head">
                  <h3>{chosen ? chosenName : `Highest ${basis} risks`}</h3>
                  {chosen
                    ? <Button size="sm" variant="ghost" icon="x" onClick={() => set({ cell: null })}>Show all risks</Button>
                    : <span className="muted">{heat.data.total} on this scale</span>}
                </div>
                {ranked.length === 0 ? (
                  <EmptyState icon="shield" title={heat.data.total === 0 ? 'No open risks on this scale' : 'Nothing scored yet'} message="Risks appear here once they are scored." />
                ) : (
                  <ol className="rk-ranked-list">
                    {ranked.slice(0, chosen ? 50 : RANKED).map((r, index) => (
                      <li key={r.id}>
                        <span className="rk-rank" aria-hidden="true">{index + 1}</span>
                        <div className="rk-ranked-body">
                          <Link to={`/risks/${r.id}`} className="rk-ranked-title"><span className="ref">{r.ref}</span> {r.title}</Link>
                          <div className="rk-ranked-meta">
                            <RatingChip scale={scale} rating={r.inherent?.rating} />
                            <span className="risk-arrow" aria-hidden="true">→</span>
                            <span className="sr-only">inherent, reduced by controls to</span>
                            <RatingChip scale={scale} rating={r.residual?.rating} />
                            {r.closed && <LookupChip list="risk_status" value={r.status} />}
                            <span className="muted truncate">{r.owner_name ?? 'No owner'}</span>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
                {!chosen && ranked.length > RANKED && <p className="muted rk-ranked-more">And {ranked.length - RANKED} more in the list below.</p>}
              </div>
            </div>
          )}
      </Card>

      {chosen && (
        <div className="rk-drill" role="status">
          <span>
            Showing {chosen.count} {chosen.count === 1 ? 'risk' : 'risks'} at <strong>{chosenName}</strong> ({basis}, {scale?.name}).
          </span>
          <Button size="sm" onClick={() => set({ cell: null })}>Show all risks</Button>
        </div>
      )}

      <div className="rk-list-card">
        <ResourceList
          key={chosen ? `${scaleKey}-${basis}-${cellKey(chosen)}-${closed}` : 'all'}
          type="risk"
          urlState
          columns={[
            'ref', 'title', 'category',
            { field: 'inherent_score', label: 'Inherent', sortable: true, render: (row) => <RatingChip scale={scaleOf(row)} rating={row.inherent_rating} /> },
            { field: 'residual_score', label: 'Residual', sortable: true, render: (row) => <RatingChip scale={scaleOf(row)} rating={row.residual_rating} /> },
            'treatment', 'status', 'owner_id', 'due_on', 'review_on',
            { field: 'last_reviewed_on', hidden: true },
          ]}
          filters={['category', 'summary_level', 'status', 'treatment', 'owner_id', 'due_on', 'review_on']}
          bulkFields={['owner_id', 'treatment', 'category', 'review_on', 'due_on']}
          baseFilter={baseFilter}
          createFields={['title', 'category', 'description', 'cause', 'consequence', 'affected', 'existing_controls', 'treatment', 'owner_id', 'due_on', 'review_on']}
        />
      </div>
    </div>
  );
}
