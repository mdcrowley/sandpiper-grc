// The funding dashboard: awards by status, reports and close-outs due, open deficiencies,
// certification progress and the reviews under way.
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AgendaList, Button, Card, Chart, chartColor, EmptyState, ErrorState, formatCurrency, formatDate, Loading, LookupChip, PageHeader,
  ProgressBar, Stat, useAuth, useFetch,
} from '../../core';
import type { ChartOption, ColorName } from '../../core';
import { FundingTabs, ofText } from './shared';

interface Summary {
  today: string;
  awards: { by_status: { value: string; label: string; color: string; count: number; amount: number }[]; open: number; open_amount: number; open_local_share: number };
  reports: { overdue: number; due_soon: number; list: { id: string; ref: string; title: string; funder_name: string | null; due_on: string; kind: 'report' | 'closeout' }[] };
  deficiencies: { open: number; overdue: number; without_plan: number };
  certifications: { id: string; ref: string; title: string; year: number; status: string; due_on: string | null; applicable: number; confirmed: number }[];
  reviews: { id: string; ref: string; title: string; status: string; site_visit_on: string | null; areas: number; assessed: number; deficient: number; open_deficiencies: number }[];
}

export function FundingDashboard() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { data: s, error, loading, reload } = useFetch<Summary>('/api/funding/summary');

  const byStatus = useMemo<ChartOption>(() => {
    const rows = s?.awards.by_status ?? [];
    return {
      tooltip: { trigger: 'item' },
      xAxis: { type: 'category', data: rows.map((r) => r.label), axisLabel: { interval: 0 } },
      yAxis: { type: 'value', minInterval: 1 },
      series: [{
        name: 'Awards', type: 'bar', barMaxWidth: 40, label: { show: true, position: 'top', color: 'var(--text-muted)' },
        data: rows.map((r) => ({ value: r.count, key: r.value, name: r.label, itemStyle: { color: chartColor(r.color as ColorName) } })),
      }],
    };
  }, [s]);

  const header = (
    <>
      <PageHeader title="Funding and grants" subtitle="Funding awards and what they pay for, the reports they require, yearly certifications and funder compliance reviews."
        actions={<>
          <Button icon="refresh" loading={loading && !!s} onClick={reload}>Refresh</Button>
          {can('funding.create') && <Link className="btn btn-primary" to="/funding/awards?new=1">New award</Link>}
        </>} />
      <FundingTabs active="dashboard" />
    </>
  );
  if (error && !s) return <div className="stack">{header}<ErrorState title="The dashboard could not be loaded" error={error} onRetry={reload} /></div>;
  if (!s) return <div className="stack">{header}<Loading lines={10} label="Loading the funding dashboard" /></div>;
  const totalAwards = s.awards.by_status.reduce((n, r) => n + r.count, 0);

  return (
    <div className="stack">
      {header}
      <div className="grid-stats">
        <Stat label="Open awards" value={s.awards.open} icon="chart" hint={`${formatCurrency(s.awards.open_amount)} awarded`} to="/funding/awards?f.status=applied,awarded,active" />
        <Stat label="Reports due" value={s.reports.due_soon + s.reports.overdue} icon="calendar" color={s.reports.overdue ? 'red' : undefined}
          hint={s.reports.overdue ? `${s.reports.overdue} overdue` : 'Within 30 days, none overdue'} />
        <Stat label="Open deficiencies" value={s.deficiencies.open} icon="alert" color={s.deficiencies.overdue ? 'red' : s.deficiencies.open ? 'amber' : undefined}
          hint={s.deficiencies.overdue ? `${s.deficiencies.overdue} past due` : s.deficiencies.without_plan ? `${s.deficiencies.without_plan} without a corrective action plan` : 'None past due'}
          to="/funding/deficiencies?f.status=open,in_progress,submitted" />
        <Stat label="Reviews under way" value={s.reviews.length} icon="clipboard" to="/funding/reviews" />
      </div>

      <div className="fd-grid">
        <Card title="Awards by status">
          <Chart label="Funding awards by status" option={byStatus} height={240} empty={totalAwards === 0} emptyMessage="No funding awards yet"
            onSegmentClick={(seg) => navigate(`/funding/awards?f.status=${(seg.data as { key: string }).key}`)} />
        </Card>
        <Card title="Reports and close-outs due" actions={<Link className="btn btn-ghost btn-sm" to="/funding/awards">All awards</Link>}>
          <AgendaList label="Reports and close-outs due within 30 days"
            empty="Nothing due in the next 30 days."
            items={s.reports.list.map((r) => ({
              key: `${r.kind}-${r.id}`, date: r.due_on, title: `${r.kind === 'closeout' ? 'Close-out' : 'Report'}: ${r.title}`, reference: r.ref,
              to: `/funding/awards/${r.id}`, meta: r.funder_name ?? undefined, color: (r.due_on < s.today ? 'red' : 'amber') as ColorName,
            }))} />
        </Card>
      </div>

      <div className="fd-grid">
        <Card title="Yearly certifications" actions={<Link className="btn btn-ghost btn-sm" to="/funding/certifications">All certifications</Link>}>
          {s.certifications.length === 0 ? <EmptyState icon="check" title="No certifications for this year" message="Add this year's certification with the statements the authorized official signs." /> : (
            <ul className="fd-list">
              {s.certifications.map((c) => (
                <li key={c.id}>
                  <div className="fd-list-head">
                    <Link className="row-title" to={`/funding/certifications/${c.id}`}><span className="ref">{c.ref}</span> {c.title} ({c.year})</Link>
                    <LookupChip list="funding_certification_status" value={c.status} />
                  </div>
                  <ProgressBar label={`${c.ref} items confirmed`} hideLabel value={c.confirmed} max={Math.max(c.applicable, 1)} color={c.confirmed === c.applicable ? 'green' : 'blue'}
                    valueText={`${ofText(c.confirmed, c.applicable)} applicable items confirmed`} />
                  <span className="muted fd-small">{ofText(c.confirmed, c.applicable)} applicable items confirmed{c.due_on ? ` · due ${formatDate(c.due_on)}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Compliance reviews under way" actions={<Link className="btn btn-ghost btn-sm" to="/funding/reviews">All reviews</Link>}>
          {s.reviews.length === 0 ? <EmptyState icon="clipboard" title="No reviews under way" message="When a funder announces a review, add it and load its review areas." /> : (
            <ul className="fd-list">
              {s.reviews.map((r) => (
                <li key={r.id}>
                  <div className="fd-list-head">
                    <Link className="row-title" to={`/funding/reviews/${r.id}`}><span className="ref">{r.ref}</span> {r.title}</Link>
                    <LookupChip list="compliance_review_status" value={r.status} />
                  </div>
                  <ProgressBar label={`${r.ref} areas assessed`} hideLabel value={r.assessed} max={Math.max(r.areas, 1)} color="blue" valueText={`${ofText(r.assessed, r.areas)} areas assessed`} />
                  <span className="muted fd-small">
                    {ofText(r.assessed, r.areas)} areas assessed · {r.deficient} deficient · {r.open_deficiencies} open deficienc{r.open_deficiencies === 1 ? 'y' : 'ies'}
                    {r.site_visit_on ? ` · site visit ${formatDate(r.site_visit_on)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
