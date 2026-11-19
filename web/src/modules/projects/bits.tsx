import { Avatar, Group, Progress, Text, Tooltip } from '@mantine/core';
import { currency, formatCurrency, Icon, LookupChip, StatusChip } from '../../core';
import type { ColorName } from '../../core';
import { RAG_COLOR, RAG_LABEL, type RagTrend } from './types';

/** The symbol of the configured currency (GRC_CURRENCY), for money inputs. */
export function currencySymbol(): string {
  const parts = new Intl.NumberFormat(undefined, { style: 'currency', currency: currency() }).formatToParts(0);
  return parts.find((p) => p.type === 'currency')?.value ?? currency();
}

/** A short amount in the configured currency for chart axes and tiles, for example "€12K". */
export function compactCurrency(value: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency(), notation: 'compact', maximumSignificantDigits: 3 }).format(value);
}

/** Red / amber / green chip. The word is always shown, so colour is never the only signal. */
export function RagChip({ value, label }: { value: string | null | undefined; label?: string }) {
  if (!value) return label ? <StatusChip color="gray" label={`${label}: no report`} /> : <span className="muted">No report</span>;
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
    <Tooltip label={TREND_TEXT[trend]}>
      <span className={`prj-trend prj-trend-${trend}`}>
        <Icon name={icon} size={14} label={TREND_TEXT[trend]} />
      </span>
    </Tooltip>
  );
}

export function RagWithTrend({ value, trend }: { value: string | null | undefined; trend: RagTrend | null | undefined }) {
  return (
    <Group gap={4} wrap="nowrap" component="span" display="inline-flex">
      <RagChip value={value} />
      <TrendArrow trend={trend} />
    </Group>
  );
}

export function TierChip({ tier }: { tier: string | null | undefined }) {
  return tier ? <LookupChip list="project_tier" value={tier} /> : <span className="muted">—</span>;
}

/** Initials avatar and name, or a quiet placeholder when nobody is named. */
export function Person({ name, placeholder = 'Unassigned' }: { name: string | null | undefined; placeholder?: string }) {
  if (!name) return <Text span size="sm" c="dimmed">{placeholder}</Text>;
  return (
    <Group gap={6} wrap="nowrap" component="span" display="inline-flex" maw="100%">
      <Avatar size={22} radius="xl" name={name} color="initials" aria-hidden="true" />
      <Text span size="sm" truncate>{name}</Text>
    </Group>
  );
}

export function budgetText(budget: number | null | undefined, spend: number | null | undefined): string {
  const b = Number(budget) || 0;
  const s = Number(spend) || 0;
  if (!b && !s) return 'No budget or spend recorded';
  if (!b) return `${formatCurrency(s)} spent, no budget set`;
  return `${formatCurrency(s)} of ${formatCurrency(b)} spent (${Math.round((s / b) * 100)}%)${s > b ? ', over budget' : ''}`;
}

/**
 * Spend against budget as a bar; turns red and says "over" when spend passes the budget.
 * `detail` adds the amounts under the bar (for cards); without it the bar sits on one table line.
 */
export function BudgetBar({ budget, spend, detail }: { budget: number | null | undefined; spend: number | null | undefined; detail?: boolean }) {
  const b = Number(budget) || 0;
  const s = Number(spend) || 0;
  if (!b && !s) return <span className="muted">{detail ? 'No budget yet' : '—'}</span>;
  const pct = b ? Math.round((s / b) * 100) : null;
  const over = b > 0 && s > b;
  const color: ColorName = over || !b ? 'red' : 'blue';
  const text = budgetText(b, s);
  const bar = <Progress value={Math.min(100, pct ?? 100)} color={color} size="sm" radius="xl" aria-label={text} style={{ flex: 1, minWidth: 48 }} />;
  if (detail) {
    return (
      <div>
        <Group justify="space-between" gap="xs" mb={4} wrap="nowrap">
          <Text size="xs" c="dimmed" truncate>{b ? `${compactCurrency(s)} of ${compactCurrency(b)}` : `${compactCurrency(s)} spent`}</Text>
          <Text size="xs" fw={600} c={over ? 'var(--danger-text)' : undefined} style={{ whiteSpace: 'nowrap' }}>
            {b ? `${pct}%` : 'No budget'}{over ? ' over' : ''}
          </Text>
        </Group>
        {bar}
      </div>
    );
  }
  return (
    <Tooltip label={text}>
      <Group gap={8} wrap="nowrap" miw={120}>
        {bar}
        <Text span size="xs" className="num" c={over ? 'var(--danger-text)' : 'dimmed'} fw={over ? 600 : 400} style={{ whiteSpace: 'nowrap' }}>
          {b ? `${pct}%` : '—'}{over ? ' over' : ''}
        </Text>
      </Group>
    </Tooltip>
  );
}
