import { Link } from 'react-router-dom';
import { Card, EmptyState, formatDate } from '../../core';
import { daysBetween, todayIso, type PortfolioRow } from './types';

const LABEL_W = 250;
const ROW_H = 36;
const HEAD_H = 30;
const PAD = 16;

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
const nextMonth = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1, 1);
  return d.toISOString().slice(0, 10);
};
const monthLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });

function Diamond({ x, y, className, title }: { x: number; y: number; className: string; title: string }) {
  const r = 7;
  return (
    <path className={className} d={`M${x} ${y - r} L${x + r} ${y} L${x} ${y + r} L${x - r} ${y} Z`}>
      <title>{title}</title>
    </path>
  );
}

/** Milestone-level timeline: one row per project, a bar from start to target, a diamond per milestone. */
export function PortfolioTimeline({ rows }: { rows: PortfolioRow[] }) {
  const today = todayIso();
  const shown = rows.filter((p) => p.status !== 'cancelled' && (p.milestones.length || (p.start_on && p.target_on)));
  const hidden = rows.filter((p) => p.status !== 'cancelled').length - shown.length;

  if (!shown.length) {
    return (
      <Card>
        <EmptyState icon="calendar" title="Nothing to plot yet" message="Give projects a start and target date, or add milestones, to see them here." />
      </Card>
    );
  }

  const dates = shown.flatMap((p) => [p.start_on, p.target_on, ...p.milestones.flatMap((m) => [m.due_on, m.done_on])]).filter((d): d is string => Boolean(d));
  dates.push(today);
  dates.sort();
  const from = monthStart(addDays(dates[0], -5));
  const to = nextMonth(addDays(dates[dates.length - 1], 5));
  const totalDays = Math.max(1, daysBetween(from, to));
  const chartW = Math.max(640, Math.min(2600, Math.round(totalDays * 2.4)));
  const x = (iso: string) => LABEL_W + (daysBetween(from, iso) / totalDays) * chartW;
  const width = LABEL_W + chartW + PAD;
  const height = HEAD_H + shown.length * ROW_H + 8;

  const months: string[] = [];
  for (let m = from; m < to; m = nextMonth(m)) months.push(m);
  const everyNth = Math.max(1, Math.ceil(months.length / Math.floor(chartW / 62)));

  return (
    <Card title="Timeline">
      <div className="prj-tl">
        <svg width={width} height={height} role="img" aria-label={`Timeline of ${shown.length} projects from ${formatDate(from)} to ${formatDate(to)}. The table below lists the same milestones.`}>
          {months.map((m, i) => (
            <g key={m}>
              <line className="prj-tl-grid" x1={x(m)} x2={x(m)} y1={HEAD_H - 6} y2={height} />
              {i % everyNth === 0 && <text className="prj-tl-muted" x={x(m) + 4} y={16}>{monthLabel(m)}</text>}
            </g>
          ))}
          {shown.map((p, i) => {
            const top = HEAD_H + i * ROW_H;
            const mid = top + ROW_H / 2;
            return (
              <g key={p.id}>
                <line className="prj-tl-rowline" x1={0} x2={width} y1={top + ROW_H} y2={top + ROW_H} />
                <Link to={`/projects/${p.id}?tab=milestones`}>
                  <text x={4} y={mid + 4}>
                    <title>{p.ref} {p.name}</title>
                    {p.name.length > 34 ? `${p.name.slice(0, 33)}…` : p.name}
                  </text>
                </Link>
                {p.start_on && p.target_on && (
                  <rect className="prj-tl-bar" x={x(p.start_on)} y={mid - 6} width={Math.max(2, x(p.target_on) - x(p.start_on))} height={12} rx={3}>
                    <title>{p.name}: {formatDate(p.start_on)} to {formatDate(p.target_on)}</title>
                  </rect>
                )}
                {p.milestones.map((m) => {
                  const late = !m.done_on && m.due_on < today;
                  const state = m.done_on ? `done ${formatDate(m.done_on)}` : late ? 'overdue' : 'to do';
                  return (
                    <Diamond
                      key={m.id}
                      x={x(m.done_on ?? m.due_on)}
                      y={mid}
                      className={m.done_on ? 'prj-tl-done' : late ? 'prj-tl-late' : 'prj-tl-due'}
                      title={`${m.name}: due ${formatDate(m.due_on)}, ${state}`}
                    />
                  );
                })}
              </g>
            );
          })}
          <line className="prj-tl-today" x1={x(today)} x2={x(today)} y1={HEAD_H - 10} y2={height} />
          <text className="prj-tl-muted" x={x(today) + 4} y={HEAD_H - 2}>Today</text>
        </svg>
      </div>
      <ul className="prj-legend" aria-label="Key">
        <li><svg width="28" height="14" aria-hidden="true"><rect className="prj-tl-bar" x="1" y="2" width="26" height="10" rx="3" /></svg> Start to target date</li>
        <li><svg width="16" height="16" aria-hidden="true"><path className="prj-tl-done" d="M8 1 L15 8 L8 15 L1 8 Z" /></svg> Milestone done</li>
        <li><svg width="16" height="16" aria-hidden="true"><path className="prj-tl-due" d="M8 2 L14 8 L8 14 L2 8 Z" /></svg> Milestone to do</li>
        <li><svg width="16" height="16" aria-hidden="true"><path className="prj-tl-late" d="M8 1 L15 8 L8 15 L1 8 Z" /></svg> Milestone overdue</li>
      </ul>
      {hidden > 0 && <p className="muted">{hidden} {hidden === 1 ? 'project has' : 'projects have'} no dates or milestones and {hidden === 1 ? 'is' : 'are'} not shown.</p>}

      <details style={{ marginTop: 'var(--s-3)' }}>
        <summary>Show milestones as a table</summary>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">Project</th><th scope="col">Milestone</th><th scope="col">Due</th><th scope="col">Done</th></tr></thead>
            <tbody>
              {shown.flatMap((p) => p.milestones.map((m) => (
                <tr key={m.id}>
                  <td><Link to={`/projects/${p.id}`}>{p.name}</Link></td>
                  <td>{m.name}</td>
                  <td>{formatDate(m.due_on)}</td>
                  <td>{m.done_on ? formatDate(m.done_on) : !m.done_on && m.due_on < today ? 'Overdue' : '—'}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      </details>
    </Card>
  );
}
