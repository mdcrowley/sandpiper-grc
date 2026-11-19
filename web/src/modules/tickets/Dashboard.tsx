// Service desk dashboard. Top: the desk as it stands now. Then the chosen period: figures and
// charts from /api/tickets/metrics. Every tile, bar and point opens the ticket list behind it.
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SegmentedControl } from '@mantine/core';
import {
  Button, Card, Chart, chartColor, DateField, EmptyState, ErrorState, formatDate, formatDateTime, PageHeader, qs, Stat, timeZone, useFetch,
} from '../../core';
import type { ChartOption, ChartSegment } from '../../core';
import { minutesText, ticketListHref, type Group, type Metrics, type QueueCounts } from './util';

const DAY = 86_400_000;
/** Today's date in the organisation's time zone. */
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: timeZone() }).format(new Date());
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const PRESETS = ['7', '30', '90'];
const OPEN = { 'resolved_at.null': 'true' };

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
    series: [{ type: 'bar', data, ...(horizontal ? { itemStyle: { borderRadius: [0, 4, 4, 0] } } : {}) }],
  };
}

function Section({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="sd-dash-section" aria-label={title}>
      <header><h2>{title}</h2>{note && <span className="muted">{note}</span>}</header>
      {children}
    </section>
  );
}

export function ServiceDeskDashboard() {
  const navigate = useNavigate();
  const [to, setTo] = useState(today);
  const [from, setFrom] = useState(() => shift(today(), -29));
  const [custom, setCustom] = useState(false);
  const valid = !!from && !!to && from <= to;
  const { data, error, loading, reload } = useFetch<Metrics>(valid ? `/api/tickets/metrics${qs({ from, to })}` : null, { keepPrevious: true });
  const now = useFetch<QueueCounts>('/api/tickets/queue-counts');

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
      name, type: 'line', showSymbol: days.length <= 31,
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
      name, type: 'bar', stack: 'targets', itemStyle: { color: chartColor(color), borderColor: 'var(--surface)', borderWidth: 1 },
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

  const preset = (days: number) => { const t = today(); setCustom(false); setTo(t); setFrom(shift(t, -(days - 1))); };
  const period = custom ? 'custom' : PRESETS.find((d) => to === today() && from === shift(to, -(Number(d) - 1))) ?? 'custom';
  const pctText = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n}%`);
  const quiet = Boolean(data && data.total === 0);
  const chartLoading = !data;

  return (
    <div className="sd-dash">
      <PageHeader
        title="Service desk dashboard"
        subtitle={data ? `As of ${formatDateTime(data.as_of)}. Select any tile, bar or point to see the tickets behind it.` : 'Volumes, targets and satisfaction for the service desk.'}
        breadcrumbs={[{ label: 'Tickets', to: '/tickets' }, { label: 'Dashboard' }]}
        actions={<Button icon="refresh" loading={loading || now.loading} onClick={() => { reload(); now.reload(); }}>Refresh</Button>}
      />

      <Section title="Right now" note="Every unresolved ticket, whatever the period">
        {now.error ? <ErrorState error={now.error} onRetry={now.reload} /> : (
          <div className="grid-stats sd-now">
            <Stat label="Open" icon="ticket" value={now.data?.open ?? '–'} color="blue" to={ticketListHref(OPEN)} />
            <Stat label="Unassigned" icon="user" value={now.data?.unassigned ?? '–'} color={now.data?.unassigned ? 'amber' : 'green'} to={ticketListHref({ 'assignee_id.null': 'true', ...OPEN })} />
            <Stat label="At risk" icon="clock" value={now.data?.at_risk ?? '–'} color={now.data?.at_risk ? 'amber' : 'green'} hint="Close to the resolution target"
              to={ticketListHref({ resolve_warned: 'true', resolve_breached: 'false', ...OPEN })} />
            <Stat label="Breaching" icon="alert" value={now.data?.breaching ?? '–'} color={now.data?.breaching ? 'red' : 'green'} hint="Past the resolution target"
              to={ticketListHref({ resolve_breached: 'true', ...OPEN })} />
            <Stat label="With a vendor" icon="building" value={now.data?.with_vendor ?? '–'} color="orange" to={ticketListHref({ with_vendor: 'true', ...OPEN })} />
            <Stat label="To approve" icon="lock" value={now.data?.awaiting_approval ?? '–'} color="purple" to={ticketListHref({ approval_status: 'pending', ...OPEN })} />
          </div>
        )}
      </Section>

      <Section
        title="In the period"
        note={valid ? `Tickets opened ${formatDate(from)} to ${formatDate(to)}` : undefined}
      >
        <div className="sd-range" role="group" aria-label="Period">
          <SegmentedControl
            aria-label="Period"
            size="sm"
            value={period}
            onChange={(v) => (v === 'custom' ? setCustom(true) : preset(Number(v)))}
            data={[...PRESETS.map((d) => ({ value: d, label: `Last ${d} days` })), { value: 'custom', label: 'Custom' }]}
          />
          {period === 'custom' && (
            <>
              <DateField label="From" size="xs" value={from} max={to || undefined} onChange={setFrom} />
              <DateField label="To" size="xs" value={to} min={from || undefined} onChange={setTo} error={!valid ? 'Choose a start date on or before the end date.' : undefined} />
            </>
          )}
        </div>

        {error && !data ? <ErrorState error={error} onRetry={reload} />
          : !valid ? <EmptyState title="Choose a period" message="Pick a start date and an end date to see the figures." icon="calendar" />
          : (
            <div className="stack" aria-busy={loading}>
              <div className="grid-stats sd-period">
                <Stat label="Opened" value={data?.total ?? '–'} to={ticketListHref(range)} hint={data ? `${data.resolved} of them resolved` : undefined} />
                <Stat label="Targets met" value={pctText(data?.sla.compliance_pct)}
                  color={!data || data.sla.compliance_pct === null ? undefined : data.sla.compliance_pct < 90 ? 'amber' : 'green'}
                  hint={data ? `Respond ${pctText(data.sla.response.compliance_pct)} · resolve ${pctText(data.sla.resolve.compliance_pct)}` : undefined} />
                <Stat label="Missed a target" value={data?.sla.breaches ?? '–'} color={data?.sla.breaches ? 'red' : 'green'}
                  to={ticketListHref({ ...range, target_missed: 'true' })} />
                <Stat label="Average first response" value={minutesText(data?.first_response.average_minutes)} hint="Elapsed time, not working time" />
                <Stat label="Average time to resolve" value={minutesText(data?.resolution.average_minutes)} hint="Elapsed time, not working time" />
                <Stat label="Satisfaction (1 to 5)" value={!data || data.satisfaction.average === null ? '—' : data.satisfaction.average.toFixed(1)}
                  hint={data ? `${data.satisfaction.count} answer${data.satisfaction.count === 1 ? '' : 's'}` : undefined}
                  to={ticketListHref({ ...range, 'satisfaction_score.null': 'false' })} />
                <Stat label="Average vendor response" value={minutesText(data?.vendor.average_response_minutes)}
                  hint={data ? `${data.vendor.responses} response${data.vendor.responses === 1 ? '' : 's'}` : undefined}
                  to={ticketListHref({ ...range, 'vendor_responded_at.null': 'false' })} />
              </div>

              {quiet && (
                <p className="notice">Nothing was opened in this period. Try a wider one, or <Link to="/tickets?new=1">log a ticket</Link>.</p>
              )}

              <Card title="Opened and resolved by day">
                <Chart label="Tickets opened and resolved each day" option={volume} height={260} loading={chartLoading} onSegmentClick={onSegment}
                  empty={quiet} emptyMessage="No tickets were opened in this period" />
              </Card>
              <div className="grid-2 sd-dash-charts">
                <Card title="Service-level targets">
                  <Chart label="Tickets that met or missed the respond and resolve targets" option={targets} height={200} loading={chartLoading} onSegmentClick={onSegment}
                    empty={Boolean(data && data.sla.response.measured + data.sla.resolve.measured === 0)} emptyMessage="No ticket in this period has reached a target yet" />
                  {data && (
                    <p className="muted">Respond: {pctText(data.sla.response.compliance_pct)} met of {data.sla.response.measured} measured.
                      Resolve: {pctText(data.sla.resolve.compliance_pct)} met of {data.sla.resolve.measured} measured.</p>
                  )}
                </Card>
                <Card title="Open tickets by age">
                  <Chart label="Open tickets by age" option={backlog} height={200} loading={chartLoading} onSegmentClick={onSegment} emptyMessage="Nothing is open" />
                  <p className="muted">All tickets open now, whenever they were opened.</p>
                </Card>
                <Card title="By category">
                  <Chart label="Tickets by category" option={byCategory} height={Math.max(160, (data?.by_category.length ?? 4) * 34 + 40)} loading={chartLoading} onSegmentClick={onSegment} />
                </Card>
                <Card title="By requester department">
                  <Chart label="Tickets by requester department" option={byDepartment} height={Math.max(160, (data?.by_department.length ?? 4) * 34 + 40)} loading={chartLoading} onSegmentClick={onSegment} />
                </Card>
                <Card title="By priority">
                  <Chart label="Tickets by priority" option={byPriority} height={220} loading={chartLoading} onSegmentClick={onSegment} />
                </Card>
                <Card title="Figures" flush>
                  {!data || quiet ? <EmptyState title="No figures yet" message="The numbers behind the charts are listed here." icon="chart" /> : (
                    <div className="table-wrap sd-figures">
                      <table className="table sd-table">
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
                  )}
                </Card>
              </div>
            </div>
          )}
      </Section>
    </div>
  );
}
