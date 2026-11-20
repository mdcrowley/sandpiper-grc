// The two dashboard widgets that draw on several areas at once: what needs attention, and the
// headline numbers. Each part is left out when the person cannot see the area behind it.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button, Icon, Loading, Stat } from '../../core';
import type { ColorName, IconName } from '../../core';
import { sourceAllowed, useSource, useWidgetCtx } from './sources';
import type { SourceData, SourceKey, WidgetCtx, WidgetDef } from './types';

const ATTENTION_SOURCES: SourceKey[] = ['clocks', 'tickets', 'actions', 'renewals', 'vulnerabilities', 'risks'];
const HEADLINE_SOURCES: SourceKey[] = ['tickets', 'actions', 'risks', 'portfolio', 'renewals', 'changes', 'vulnerabilities', 'training'];

const anyAllowed = (keys: SourceKey[]) => (ctx: WidgetCtx) => keys.some((key) => sourceAllowed(ctx, key));

interface Attention { key: string; count: number; label: string; detail: string; to: string; tone: 'red' | 'amber' }

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Only things that are late or at risk, each a link to the place to deal with it. */
function NeedsAttention() {
  const ctx = useWidgetCtx();
  const clocks = useSource('clocks');
  const tickets = useSource('tickets');
  const actions = useSource('actions');
  const renewals = useSource('renewals');
  const vulnerabilities = useSource('vulnerabilities');
  const risks = useSource('risks');
  const used = [
    { key: 'clocks' as const, state: clocks }, { key: 'tickets' as const, state: tickets }, { key: 'actions' as const, state: actions },
    { key: 'renewals' as const, state: renewals }, { key: 'vulnerabilities' as const, state: vulnerabilities },
    { key: 'risks' as const, state: risks },
  ].filter((s) => sourceAllowed(ctx, s.key)).map((s) => s.state);

  const items: Attention[] = [];
  const lateClocks = clocks.data?.summary.red ?? 0;
  const runningClocks = clocks.data?.summary.open ?? clocks.data?.clocks.length ?? 0;
  if (lateClocks > 0) {
    items.push({ key: 'clocks-late', count: lateClocks, label: plural(lateClocks, 'Notification overdue', 'Notifications overdue'), detail: 'Security incident notification deadlines have passed', to: '/security-incidents', tone: 'red' });
  } else if (runningClocks > 0) {
    items.push({ key: 'clocks', count: runningClocks, label: plural(runningClocks, 'Notification clock running', 'Notification clocks running'), detail: `${clocks.data?.summary.amber ?? 0} close to the deadline`, to: '/security-incidents', tone: 'amber' });
  }
  const breaches = tickets.data?.sla.breaches ?? 0;
  if (breaches > 0) items.push({ key: 'breaches', count: breaches, label: plural(breaches, 'Ticket past its target', 'Tickets past their target'), detail: 'Response or resolution time has been missed', to: '/tickets/dashboard', tone: 'red' });
  const overdue = actions.data?.overdue ?? 0;
  if (overdue > 0) items.push({ key: 'overdue', count: overdue, label: plural(overdue, 'Action overdue', 'Actions overdue'), detail: `${actions.data?.due_this_week ?? 0} more due this week`, to: '/actions', tone: 'red' });
  const lateFixes = vulnerabilities.data?.totals.overdue ?? 0;
  if (lateFixes > 0) items.push({ key: 'vulnerabilities', count: lateFixes, label: plural(lateFixes, 'Vulnerability past its fix-by date', 'Vulnerabilities past their fix-by date'), detail: `${vulnerabilities.data?.totals.open ?? 0} open in all`, to: '/vulnerabilities?f.overdue=true&f.closed=false', tone: 'red' });
  // Risks (only for people who can see them: the source is allowed only with risks.view and security.view).
  const expiredAcceptances = risks.data?.acceptances_expired ?? 0;
  if (expiredAcceptances > 0) items.push({ key: 'risk-acceptances', count: expiredAcceptances, label: plural(expiredAcceptances, 'Risk acceptance expired', 'Risk acceptances expired'), detail: 'Accept the risk again, or treat it', to: '/risks/reviews', tone: 'red' });
  const toReview = risks.data?.needs_review ?? 0;
  if (toReview > 0) items.push({ key: 'risk-review', count: toReview, label: plural(toReview, 'Risk needs review', 'Risks need review'), detail: 'Their status says they must be looked at again', to: '/risks?f.status=needs_review', tone: 'amber' });
  const pastNotice = renewals.data?.contracts.filter((c) => c.days_to_notice < 0).length ?? 0;
  if (pastNotice > 0) items.push({ key: 'notice', count: pastNotice, label: plural(pastNotice, 'Contract past its notice date', 'Contracts past their notice date'), detail: 'The chance to give notice before renewal has gone', to: '/contracts/renewals', tone: 'amber' });
  const unowned = actions.data?.unassigned ?? 0;
  if (unowned > 0) items.push({ key: 'unowned', count: unowned, label: plural(unowned, 'Action with no owner', 'Actions with no owner'), detail: 'Nobody is responsible for these yet', to: '/actions?f.owner_id.null=true', tone: 'amber' });

  const failed = used.filter((s) => s.error);
  const settled = used.every((s) => s.data || s.error);

  return (
    <section aria-label="Needs attention" className="home-attention-wrap">
      {!settled && items.length === 0 ? <Loading lines={2} label="Checking what needs attention" />
        : items.length === 0 && failed.length === 0 ? (
          <p className="home-clear">
            <Icon name="check-circle" size={20} />
            <span><strong>Nothing needs attention.</strong> Nothing in the areas you can see is late or past its deadline.</span>
          </p>
        ) : (
          <ul className="home-attention">
            {items.map((item) => (
              <li key={item.key}>
                <Link to={item.to} className={`attn attn-${item.tone}`}>
                  <span className="attn-count">{item.count}</span>
                  <span className="attn-text">
                    <span className="attn-head">{item.label}</span>
                    <span className="attn-detail">{item.detail}</span>
                  </span>
                  <Icon name="chevron-right" size={18} className="attn-go" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      {failed.length > 0 && (
        <p className="home-partial" role="alert">
          <Icon name="alert-circle" size={16} />
          Some of these checks could not be loaded, so this list may be incomplete.
          <Button size="sm" variant="ghost" icon="refresh" onClick={() => failed.forEach((s) => s.reload())}>Try again</Button>
        </p>
      )}
    </section>
  );
}

/** One headline number from a shared endpoint; nothing at all when the person cannot see that area. */
function Tile<K extends SourceKey>({ source, label, icon, to, color, value, hint }: {
  source: K; label: string; icon: IconName; to: string;
  color: ColorName | ((data: SourceData[K]) => ColorName);
  value: (data: SourceData[K]) => ReactNode;
  hint?: (data: SourceData[K]) => ReactNode;
}) {
  const ctx = useWidgetCtx();
  const { data, error } = useSource(source);
  if (!sourceAllowed(ctx, source)) return null;
  if (error) return <Stat icon={icon} label={label} to={to} color="gray" value="—" hint="Could not be loaded" />;
  if (!data) return <Stat icon={icon} label={label} to={to} color="gray" value={<span aria-label="Loading">…</span>} />;
  return (
    <Stat icon={icon} label={label} to={to} value={value(data)} hint={hint?.(data)}
      color={typeof color === 'function' ? color(data) : color} />
  );
}

function HeadlineNumbers() {
  return (
    <section aria-label="Headline numbers" className="grid-stats home-stats">
      <Tile source="tickets" icon="ticket" label="Open tickets" to="/tickets?f.resolved_at.null=true" color="blue" value={(d) => d.open} />
      <Tile source="tickets" icon="clock" label="Tickets within target" to="/tickets/dashboard"
        color={(d) => ((d.sla.compliance_pct ?? 100) >= 90 ? 'green' : 'amber')}
        value={(d) => (d.sla.compliance_pct === null || d.sla.compliance_pct === undefined ? 'n/a' : `${d.sla.compliance_pct}%`)}
        hint={(d) => (d.sla.breaches ? `${d.sla.breaches} missed` : 'None missed')} />
      <Tile source="actions" icon="check-square" label="Open actions" to="/actions" color="teal"
        value={(d) => d.open} hint={(d) => `${d.due_this_week} due this week`} />
      <Tile source="changes" icon="refresh" label="Changes this week" to="/changes?view=week" color="purple"
        value={(d) => d.this_week} hint={(d) => `${d.in_progress} in progress`} />
      <Tile source="changes" icon="check-circle" label="Changes awaiting approval" to="/changes?view=awaiting"
        color={(d) => (d.awaiting_approval ? 'blue' : 'gray')} value={(d) => d.awaiting_approval} />
      <Tile source="vulnerabilities" icon="bug" label="Open vulnerabilities" to="/vulnerabilities?f.closed=false" color="orange"
        value={(d) => d.totals.open} hint={(d) => `${d.totals.fixedThisMonth} fixed this month`} />
      <Tile source="vulnerabilities" icon="alert" label="Vulnerabilities overdue" to="/vulnerabilities?f.overdue=true&f.closed=false"
        color={(d) => (d.totals.overdue ? 'red' : 'green')} value={(d) => d.totals.overdue} />
      <Tile source="risks" icon="shield" label="Risks on the register" to="/risks" color="purple" value={(d) => d.total} />
      <Tile source="training" icon="graduation" label="Training completed" to="/training"
        color={(d) => (d.totals.overdue ? 'amber' : 'green')}
        value={(d) => (d.totals.rate === null ? 'n/a' : `${d.totals.rate}%`)}
        hint={(d) => (d.totals.overdue ? `${d.totals.overdue} overdue` : 'None overdue')} />
      <Tile source="portfolio" icon="folder" label="Projects" to="/projects" color="gray" value={(d) => d.register.length} />
      <Tile source="renewals" icon="calendar" label="Notice dates in 120 days" to="/contracts/renewals" color="amber"
        value={(d) => d.contracts.filter((c) => c.days_to_notice >= 0 && c.days_to_notice <= 120).length} />
    </section>
  );
}

export const SUMMARY_WIDGETS: WidgetDef[] = [
  {
    id: 'attention', title: 'Needs attention', group: 'dashboard', wide: true, sources: ATTENTION_SOURCES,
    description: 'Things that are late or at risk: overdue actions and every other target, deadline or review date that has passed.',
    visible: anyAllowed(ATTENTION_SOURCES), render: () => <NeedsAttention />,
  },
  {
    id: 'headline', title: 'Headline numbers', group: 'dashboard', wide: true, sources: HEADLINE_SOURCES,
    description: 'One figure for each area you can see, each a link to the list behind it.',
    visible: anyAllowed(HEADLINE_SOURCES), render: () => <HeadlineNumbers />,
  },
];
