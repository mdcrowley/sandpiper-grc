import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Group, SegmentedControl, Text, Tooltip } from '@mantine/core';
import { Card, ColorDot, EmptyState, formatDate, Icon, lookupColor, lookupLabel, TableWrap, toColorName, useLookup, useMediaQuery } from '../../core';
import { daysBetween, type Milestone, type PortfolioRow } from './types';

const DAY = 86400000;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
const nextMonth = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1, 1);
  return d.toISOString().slice(0, 10);
};
const monthName = (iso: string, long: boolean) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: long ? 'long' : 'short', timeZone: 'UTC' });
const quarterOf = (iso: string) => `Q${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1} ${iso.slice(0, 4)}`;

type Zoom = 'quarter' | 'year';
const WINDOW_DAYS: Record<Zoom, number> = { quarter: 92, year: 366 };

function milestoneState(m: Milestone, today: string): 'done' | 'late' | 'todo' {
  return m.done_on ? 'done' : m.due_on < today ? 'late' : 'todo';
}
const STATE_TEXT = { done: 'done', late: 'overdue', todo: 'to do' };

function Diamond({ state }: { state: 'done' | 'late' | 'todo' }) {
  return (
    <span className={`prj-ms prj-ms-${state}`} aria-hidden="true">
      {state === 'done' && <Icon name="check" size={9} />}
      {state === 'late' && <span className="prj-ms-bang">!</span>}
    </span>
  );
}

/**
 * Milestone-level Gantt chart: one row per project, a bar from start to target date in the
 * color of the project's stage, a diamond per milestone and a line for today.
 */
export function PortfolioTimeline({ rows, today }: { rows: PortfolioRow[]; today: string }) {
  const stages = useLookup('project_stage');
  const narrow = useMediaQuery('(max-width: 900px)');
  const [zoom, setZoom] = useState<Zoom>('year');
  const scroller = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState(900);
  const labelW = narrow ? 150 : 240;

  const live = rows.filter((p) => p.status !== 'cancelled');
  const shown = live.filter((p) => p.milestones.length || (p.start_on && p.target_on));
  const hidden = live.length - shown.length;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    const measure = () => setViewport(Math.max(320, el.clientWidth - labelW));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [labelW, shown.length === 0]);

  const scale = useMemo(() => {
    const dates = shown.flatMap((p) => [p.start_on, p.target_on, ...p.milestones.flatMap((m) => [m.due_on, m.done_on])]).filter((d): d is string => Boolean(d));
    dates.push(addDays(today, -30), addDays(today, WINDOW_DAYS[zoom]));
    dates.sort();
    const from = monthStart(dates[0]);
    const to = nextMonth(dates[dates.length - 1]);
    const days = Math.max(1, daysBetween(from, to));
    const pxPerDay = viewport / WINDOW_DAYS[zoom];
    const months: string[] = [];
    for (let m = from; m < to; m = nextMonth(m)) months.push(m);
    return { from, to, days, pxPerDay, months, width: Math.round(days * pxPerDay) };
  }, [shown, today, zoom, viewport]);

  const x = (iso: string) => daysBetween(scale.from, iso) * scale.pxPerDay;

  // Start with today a little in from the left edge.
  useEffect(() => {
    scroller.current?.scrollTo({ left: Math.max(0, x(today) - viewport * 0.2) });
  }, [zoom, viewport, scale.from]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!shown.length) {
    return (
      <Card>
        <EmptyState icon="calendar" title="Nothing to plot yet" message="Give projects a start and target date, or add milestones, to see them here." />
      </Card>
    );
  }

  // Top band: quarters when zoomed to a quarter, years when zoomed to a year.
  const bands: { label: string; from: string; to: string }[] = [];
  for (const m of scale.months) {
    const label = zoom === 'quarter' ? quarterOf(m) : m.slice(0, 4);
    const last = bands[bands.length - 1];
    if (last && last.label === label) last.to = nextMonth(m); else bands.push({ label, from: m, to: nextMonth(m) });
  }
  const usedStages = stages.filter((s) => shown.some((p) => p.stage === s.value));

  return (
    <Card
      title="Timeline"
      actions={(
        <SegmentedControl
          size="xs"
          aria-label="Zoom"
          value={zoom}
          onChange={(v) => setZoom(v as Zoom)}
          data={[{ value: 'quarter', label: 'Quarter' }, { value: 'year', label: 'Year' }]}
        />
      )}
    >
      <div
        className="prj-gantt"
        ref={scroller}
        tabIndex={0}
        role="group"
        aria-label={`Timeline of ${shown.length} projects from ${formatDate(scale.from)} to ${formatDate(scale.to)}. Scroll sideways to move through time. The table below lists the same milestones.`}
        style={{ '--label-w': `${labelW}px` } as React.CSSProperties}
      >
        <div className="prj-gantt-inner" style={{ width: labelW + scale.width }}>
          <div className="prj-gantt-head">
            <div className="prj-gantt-name prj-gantt-corner">Project</div>
            <div className="prj-gantt-scale" style={{ width: scale.width }}>
              {bands.map((b) => (
                <span key={b.from} className="prj-gantt-band" style={{ left: x(b.from), width: x(b.to) - x(b.from) }}><span>{b.label}</span></span>
              ))}
              {scale.months.map((m) => (
                <span key={m} className="prj-gantt-month" style={{ left: x(m), width: x(nextMonth(m)) - x(m) }}>
                  {monthName(m, zoom === 'quarter')}
                </span>
              ))}
              <span className="prj-gantt-todaytag" style={{ left: x(today) }}>Today</span>
            </div>
          </div>
          <div className="prj-gantt-body">
            <div className="prj-gantt-lines" style={{ left: labelW, width: scale.width }} aria-hidden="true">
              {scale.months.map((m) => <span key={m} className={`prj-gantt-line${m.slice(5, 7) === '01' ? ' prj-gantt-line-year' : ''}`} style={{ left: x(m) }} />)}
              <span className="prj-gantt-today" style={{ left: x(today) }} />
            </div>
            {shown.map((p) => {
              const color = toColorName(lookupColor('project_stage', p.stage));
              const first = p.milestones[0];
              const lastM = p.milestones[p.milestones.length - 1];
              const hasBar = Boolean(p.start_on && p.target_on);
              const late = p.target_on && p.target_on < today && p.status === 'active' && p.stage !== 'close';
              return (
                <div key={p.id} className={`prj-gantt-row${p.status !== 'active' ? ' prj-gantt-row-held' : ''}`}>
                  <div className="prj-gantt-name">
                    <Link to={`/projects/${p.id}?tab=milestones`} className="truncate" title={p.name}>{p.name}</Link>
                    <span className="prj-gantt-meta truncate">
                      <ColorDot color={color} /> {lookupLabel('project_stage', p.stage)}
                      {p.status !== 'active' ? ` · ${lookupLabel('project_status', p.status)}` : ''}
                    </span>
                  </div>
                  <div className="prj-gantt-track" style={{ width: scale.width }}>
                    {hasBar ? (
                      <Tooltip label={`${p.name}: ${formatDate(p.start_on)} to ${formatDate(p.target_on)}${late ? ' (past its target date)' : ''}`}>
                        <span
                          className="prj-gantt-bar"
                          style={{ left: x(p.start_on!), width: Math.max(6, x(p.target_on!) - x(p.start_on!)), background: `var(--c-${color}-solid)` }}
                        />
                      </Tooltip>
                    ) : first && lastM && first !== lastM && (
                      <span className="prj-gantt-span" style={{ left: x(first.due_on), width: Math.max(2, x(lastM.due_on) - x(first.due_on)) }} />
                    )}
                    {p.milestones.map((m) => {
                      const state = milestoneState(m, today);
                      const text = `${m.name}: due ${formatDate(m.due_on)}, ${state === 'done' ? `done ${formatDate(m.done_on)}` : STATE_TEXT[state]}`;
                      return (
                        <Tooltip key={m.id} label={text}>
                          <span className="prj-ms-hit" style={{ left: x(m.done_on ?? m.due_on) }} tabIndex={0} role="img" aria-label={text}>
                            <Diamond state={state} />
                          </span>
                        </Tooltip>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <Group gap="md" mt="sm" className="prj-legend" role="list" aria-label="Key">
        {usedStages.map((s) => (
          <Text key={s.value} size="xs" c="dimmed" role="listitem"><span className="prj-legend-bar" style={{ background: `var(--c-${toColorName(s.color)}-solid)` }} /> {s.label}</Text>
        ))}
        <Text size="xs" c="dimmed" role="listitem"><Diamond state="done" /> Milestone done</Text>
        <Text size="xs" c="dimmed" role="listitem"><Diamond state="todo" /> To do</Text>
        <Text size="xs" c="dimmed" role="listitem"><Diamond state="late" /> Overdue</Text>
      </Group>
      {hidden > 0 && (
        <Text size="sm" c="dimmed" mt="xs">
          {hidden} {hidden === 1 ? 'project has' : 'projects have'} no dates or milestones and {hidden === 1 ? 'is' : 'are'} not shown.
        </Text>
      )}

      <details className="prj-details">
        <summary>Show milestones as a table</summary>
        <TableWrap label="Timeline">
          <table className="table">
            <thead><tr><th scope="col">Project</th><th scope="col">Milestone</th><th scope="col">Due</th><th scope="col">State</th></tr></thead>
            <tbody>
              {shown.flatMap((p) => p.milestones.map((m) => {
                const state = milestoneState(m, today);
                return (
                  <tr key={m.id}>
                    <td><Link to={`/projects/${p.id}?tab=milestones`}>{p.name}</Link></td>
                    <td>{m.name}</td>
                    <td>{formatDate(m.due_on)}</td>
                    <td>{state === 'done' ? `Done ${formatDate(m.done_on)}` : state === 'late' ? 'Overdue' : 'To do'}</td>
                  </tr>
                );
              }))}
            </tbody>
          </table>
        </TableWrap>
      </details>
    </Card>
  );
}
