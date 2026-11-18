// Service desk dashboard: figures from /api/tickets/metrics. Every tile and chart segment opens the filtered ticket list.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Button, Card, Chart, chartColor, DateField, EmptyState, ErrorState, formatDate, formatDateTime, Loading, PageHeader, qs, Stat, timeZone, useFetch,
} from '../../core';
import type { ChartOption, ChartSegment } from '../../core';
import { minutesText, ticketListHref, type Group, type Metrics } from './util';

const DAY = 86_400_000;
/** Today's date in the organisation's time zone. */
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: timeZone() }).format(new Date());
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const PRESETS = [7, 30, 90];

type Key = { key?: string | null; filters?: Record<string, string | null> };

function barOption(groups: { label: string; count: number; filters: Record<string, string | null>; color?: string }[], horizontal: boolean): ChartOption {
  const data = groups.map((g) => ({ name: g.label, value: g.count, filters: g.filters, ...(g.color ? { itemStyle: { color: chartColor(g.color) } } : {}) }));
  const category = { type: 'category', data: groups.map((g) => g.label), ...(horizontal ? { inverse: true } : {}) };
  const value = { type: 'value', minInterval: 1 };
  return {
    tooltip: { trigger: 'item' },
    grid: horizontal ? { top: 8, right: 24, bottom: 24, left: 150 } : undefined,
    xAxis: horizontal ? value : category,
    yAxis: horizontal ? category : value,
    series: [{ type: 'bar', data, barMaxWidth: 28, ...(horizontal ? { itemStyle: { borderRadius: [0, 4, 4, 0] } } : {}) }],
  };
}

export function ServiceDeskDashboard() {
  const navigate = useNavigate();
  const [to, setTo] = useState(today);
  const [from, setFrom] = useState(() => shift(today(), -29));
  const valid = !!from && !!to && from <= to;
  const { data, error, loading, reload } = useFetch<Metrics>(valid ? `/api/tickets/metrics${qs({ from, to })}` : null);

  // Filters that restrict the ticket list to the same range as the figures.
  const range = useMemo(() => ({ 'opened_at.gte': from, 'opened_at.lt': to ? shift(to, 1) : '' }), [from, to]);
  const drill = (filters: Record<string, string | null | undefined>) => navigate(ticketListHref(filters));
  const onSegment = (seg: ChartSegment) => {
    const f = (seg.data as Key | undefined)?.filters;
    if (f) drill(f);
  };
  const groupFilters = (field: string, g: Group) => ({ ...range, ...(g.value === null || g.value === '' ? { [`${field}.null`]: 'true' } : { [field]: g.value }) });

  const volume = useMemo<ChartOption>(() => {
    const days = data?.volume_by_day ?? [];
    const series = (name: string, field: 'opened' | 'resolved', column: string) => ({
      name, type: 'line', symbolSize: 8, lineStyle: { width: 2 },
      data: days.map((d) => ({ value: d[field], filters: { [`${column}.gte`]: d.day, [`${column}.lt`]: shift(d.day, 1) } })),
    });
    return {
      tooltip: { trigger: 'axis' },
      legend: {},
      grid: { top: 40, right: 16, bottom: 32, left: 40 },
      xAxis: { type: 'category', data: days.map((d) => formatDate(d.day).replace(/ \d{4}$/, '')) },
      yAxis: { type: 'value', minInterval: 1 },
      series: [series('Opened', 'opened', 'opened_at'), series('Resolved', 'resolved', 'resolved_at')],
    };
  }, [data]);

  const byCategory = useMemo(() => barOption((data?.by_category ?? []).map((g) => ({ label: g.label, count: g.count, filters: groupFilters('category', g) })), true),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, range]);
  const byDepartment = useMemo(() => barOption((data?.by_department ?? []).map((g) => ({ label: g.label, count: g.count, filters: groupFilters('requester_department', g) })), true),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, range]);
  const byPriority = useMemo(() => barOption([...(data?.by_priority ?? [])].sort((a, b) => String(a.value).localeCompare(String(b.value)))
    .map((g) => ({ label: g.label, count: g.count, color: g.color, filters: groupFilters('priority', g) })), false),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, range]);
  const backlog = useMemo(() => barOption((data?.backlog.buckets ?? []).map((b) => ({
    label: b.label, count: b.count,
    filters: { 'resolved_at.null': 'true', 'opened_at.lte': b.opened_before, 'opened_at.gt': b.opened_after },
  })), false), [data]);

  const targets = useMemo<ChartOption>(() => {
    const s = data?.sla;
    const rows = [
      { label: 'Respond', met: (s?.response.measured ?? 0) - (s?.response.breached ?? 0), missed: s?.response.breached ?? 0,
        metF: { ...range, response_breached: 'false', 'first_responded_at.null': 'false' }, missedF: { ...range, response_breached: 'true' } },
      { label: 'Resolve', met: (s?.resolve.measured ?? 0) - (s?.resolve.breached ?? 0), missed: s?.resolve.breached ?? 0,
        metF: { ...range, resolve_breached: 'false', 'resolved_at.null': 'false' }, missedF: { ...range, resolve_breached: 'true' } },
    ];
    const bar = (name: string, color: string, pick: (r: (typeof rows)[number]) => { value: number; filters: Record<string, string> }) => ({
      name, type: 'bar', stack: 'targets', barMaxWidth: 28, itemStyle: { color: chartColor(color), borderColor: 'var(--surface)', borderWidth: 1 },
      label: { show: true, formatter: (p: { value: number }) => (p.value ? String(p.value) : '') },
      data: rows.map(pick),
    });
    return {
      tooltip: { trigger: 'item' },
      legend: {},
      grid: { top: 40, right: 24, bottom: 24, left: 70 },
      xAxis: { type: 'value', minInterval: 1 },
      yAxis: { type: 'category', inverse: true, data: rows.map((r) => r.label) },
      series: [
        bar('Target met', 'green', (r) => ({ value: r.met, filters: r.metF })),
        bar('Target missed', 'red', (r) => ({ value: r.missed, filters: r.missedF })),
      ],
    };
  }, [data, range]);

  const preset = (days: number) => { const t = today(); setTo(t); setFrom(shift(t, -(days - 1))); };
  const pctText = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n}%`);

  return (
    <>
      <PageHeader
        title="Service desk dashboard"
        subtitle={data ? `Tickets opened ${formatDate(from)} to ${formatDate(to)} · as of ${formatDateTime(data.as_of)}` : 'Volumes, targets and satisfaction for the service desk.'}
        breadcrumbs={[{ label: 'Tickets', to: '/tickets' }, { label: 'Dashboard' }]}
        actions={<Button icon="refresh" loading={loading} onClick={reload}>Refresh</Button>}
      />
      <div className="sd-range" role="group" aria-label="Date range">
        {PRESETS.map((d) => (
          <Button key={d} size="sm" variant={to === today() && from === shift(to, -(d - 1)) ? 'primary' : 'secondary'} onClick={() => preset(d)}>Last {d} days</Button>
        ))}
        <DateField label="From" value={from} max={to || undefined} onChange={setFrom} />
        <DateField label="To" value={to} min={from || undefined} onChange={setTo} error={!valid ? 'Choose a start date on or before the end date.' : undefined} />
      </div>

      {error ? <ErrorState error={error} onRetry={reload} />
        : !valid ? <EmptyState title="Choose a date range" message="Pick a start and end date to see the figures." icon="calendar" />
        : !data ? <Loading lines={8} label="Loading the dashboard" />
        : data.total === 0 && data.backlog.total === 0 ? (
          <EmptyState title="No tickets in this period" message="Nothing was opened between these dates and nothing is open now. Try a wider range."
            icon="chart" action={<Link className="sd-link" to="/tickets?new=1">Log a ticket</Link>} />
        ) : (
          <div className="stack">
            <div className="grid-stats">
              <Stat label="Opened in period" value={data.total} to={ticketListHref(range)} />
              <Stat label="Open now" value={data.backlog.total} color="blue" to={ticketListHref({ 'resolved_at.null': 'true' })} />
              <Stat label="Targets met" value={pctText(data.sla.compliance_pct)} color={data.sla.compliance_pct !== null && data.sla.compliance_pct < 90 ? 'amber' : 'green'} />
              <Stat label="Tickets with a missed target" value={data.sla.breaches} color={data.sla.breaches ? 'red' : 'green'}
                to={ticketListHref({ ...range, target_missed: 'true' })} />
              <Stat label="Average first response" value={minutesText(data.first_response.average_minutes)} />
              <Stat label="Average time to resolve" value={minutesText(data.resolution.average_minutes)} />
              <Stat label="Satisfaction (1 to 5)" value={data.satisfaction.average === null ? '—' : data.satisfaction.average.toFixed(1)}
                to={ticketListHref({ ...range, 'satisfaction_score.null': 'false' })} />
              <Stat label="With a vendor now" value={data.vendor.held} color="orange" to={ticketListHref({ with_vendor: 'true', 'resolved_at.null': 'true' })} />
              <Stat label="Average vendor response" value={minutesText(data.vendor.average_response_minutes)}
                to={ticketListHref({ ...range, 'vendor_responded_at.null': 'false' })} />
            </div>
            <p className="muted sd-note">
              Times are elapsed clock time. Satisfaction is from {data.satisfaction.count} answer{data.satisfaction.count === 1 ? '' : 's'};
              vendor response from {data.vendor.responses}. “Open now” and “With a vendor now” ignore the date range. Select any tile, bar or point to see the tickets behind it.
            </p>

            <Card title="Tickets opened and resolved by day">
              <Chart label="Tickets opened and resolved each day" option={volume} height={260} onSegmentClick={onSegment} />
            </Card>
            <div className="grid-2">
              <Card title="Service-level targets">
                <Chart label="Tickets that met or missed the respond and resolve targets" option={targets} height={200} onSegmentClick={onSegment} />
                <p className="muted">Respond: {pctText(data.sla.response.compliance_pct)} met of {data.sla.response.measured} measured.
                  Resolve: {pctText(data.sla.resolve.compliance_pct)} met of {data.sla.resolve.measured} measured.</p>
              </Card>
              <Card title="Open tickets by age">
                <Chart label="Open tickets by age" option={backlog} height={200} onSegmentClick={onSegment} />
                <p className="muted">All tickets open now, whenever they were opened.</p>
              </Card>
              <Card title="By category">
                <Chart label="Tickets by category" option={byCategory} height={Math.max(160, data.by_category.length * 34 + 40)} onSegmentClick={onSegment} />
              </Card>
              <Card title="By requester department">
                <Chart label="Tickets by requester department" option={byDepartment} height={Math.max(160, data.by_department.length * 34 + 40)} onSegmentClick={onSegment} />
              </Card>
              <Card title="By priority">
                <Chart label="Tickets by priority" option={byPriority} height={220} onSegmentClick={onSegment} />
              </Card>
              <Card title="Figures" flush>
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th scope="col">Group</th><th scope="col" className="num">Tickets</th><th scope="col" className="num">Missed a target</th></tr></thead>
                    <tbody>
                      {([['Category', 'category', data.by_category], ['Department', 'requester_department', data.by_department], ['Priority', 'priority', data.by_priority]] as const)
                        .flatMap(([name, field, groups]) => groups.map((g) => (
                          <tr key={`${field}:${g.value}`}>
                            <th scope="row"><span className="muted">{name}: </span><Link to={ticketListHref(groupFilters(field, g))}>{g.label}</Link></th>
                            <td className="num">{g.count}</td>
                            <td className="num">{g.breached}</td>
                          </tr>
                        )))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          </div>
        )}
    </>
  );
}
