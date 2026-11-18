import { formatCurrency, formatDate, Icon, LookupChip, StatusChip } from '../../core';
import { RAG_COLOR, RAG_LABEL, type RagTrend, type TrendPoint } from './types';

/** Red / amber / green chip. The word is always shown, so colour is never the only signal. */
export function RagChip({ value, label }: { value: string | null | undefined; label?: string }) {
  if (!value) return <span className="muted">No report</span>;
  const text = RAG_LABEL[value] ?? value;
  return <StatusChip color={RAG_COLOR[value] ?? 'gray'} label={label ? `${label}: ${text}` : text} />;
}

const TREND_TEXT: Record<RagTrend, string> = {
  improving: 'Improving since the last report',
  steady: 'No change since the last report',
  worsening: 'Worse than the last report',
};

export function TrendArrow({ trend }: { trend: RagTrend | null | undefined }) {
  if (!trend) return null;
  const icon = trend === 'improving' ? 'arrow-up' : trend === 'worsening' ? 'arrow-down' : 'minus';
  return (
    <span className={`prj-trend prj-trend-${trend}`} title={TREND_TEXT[trend]}>
      <Icon name={icon} size={14} label={TREND_TEXT[trend]} />
    </span>
  );
}

export function RagWithTrend({ value, trend }: { value: string | null | undefined; trend: RagTrend | null | undefined }) {
  return (
    <span className="prj-rag">
      <RagChip value={value} />
      <TrendArrow trend={trend} />
    </span>
  );
}

export function TierChip({ tier }: { tier: string | null | undefined }) {
  return tier ? <LookupChip list="project_tier" value={tier} /> : <span className="muted">—</span>;
}

/** Spend against budget as a bar; turns red when spend passes the budget. */
export function BudgetBar({ budget, spend }: { budget: number | null | undefined; spend: number | null | undefined }) {
  const b = Number(budget) || 0;
  const s = Number(spend) || 0;
  if (!b && !s) return <span className="muted">—</span>;
  const pct = b ? Math.round((s / b) * 100) : null;
  const over = b > 0 && s > b;
  const text = b
    ? `${formatCurrency(s)} of ${formatCurrency(b)} spent (${pct}%)${over ? ', over budget' : ''}`
    : `${formatCurrency(s)} spent, no budget set`;
  return (
    <span className="prj-budget" title={text}>
      <span className="prj-budget-track" role="img" aria-label={text}>
        <span
          className="prj-budget-fill"
          style={{ width: `${Math.min(100, pct ?? 100)}%`, background: `var(--c-${over || !b ? 'red' : 'blue'}-solid)` }}
        />
      </span>
      <span className="prj-budget-text">
        {b ? `${pct}%` : '—'}
        {over && <span className="prj-over"> over</span>}
      </span>
    </span>
  );
}

/** The overall rating of the last few status reports, oldest first, as a row of squares. */
export function RagHistory({ points }: { points: TrendPoint[] }) {
  if (!points.length) return <span className="muted">No reports yet</span>;
  const text = points.map((p) => `${formatDate(p.period_end)}: ${RAG_LABEL[p.overall] ?? p.overall}`).join('; ');
  return (
    <span className="prj-history" role="img" aria-label={`Overall rating over time. ${text}`} title={text}>
      {points.map((p, i) => (
        <span key={i} className="prj-history-dot" style={{ background: `var(--c-${RAG_COLOR[p.overall] ?? 'gray'}-solid)` }}>
          {(RAG_LABEL[p.overall] ?? '?').charAt(0)}
        </span>
      ))}
    </span>
  );
}
