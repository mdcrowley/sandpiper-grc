// The Overview's procurement panel (E46): open solicitations, purchase orders awaiting approval and the
// budget used, the same figures for everyone. The home module lists it (registry.ts); it is shown only to
// people who may view procurement, and so never while the area is switched off.
import { Link } from 'react-router-dom';
import { Card, ErrorState, Icon, Loading, useFetch } from '../../core';
import type { WidgetDef } from '../home/types';
import { money, pct, type Summary } from './shared';

function Figure({ value, label, to, tone }: { value: number | string; label: string; to: string; tone?: string }) {
  return (
    <Link to={to} className={`home-figure${tone ? ` home-figure-${tone}` : ''}`}>
      <span className="home-figure-value">{value}</span>
      <span className="home-figure-label">{label}</span>
    </Link>
  );
}

function ProcurementPanel() {
  const { data: s, error, reload } = useFetch<Summary>('/api/procurement/summary');
  return (
    <Card title="Procurement" className="home-panel"
      actions={<Link className="home-more" to="/procurement" aria-label="Open procurement">Procurement<Icon name="arrow-right" size={14} /></Link>}>
      {error ? <ErrorState error={error} onRetry={reload} /> : !s ? <Loading lines={3} /> : (
        <div className="stack">
          <div className="home-figures">
            <Figure value={s.solicitations.open} label="Open solicitations" to="/procurement?f.status=planning,issued,evaluation" />
            <Figure value={s.solicitations.due_soon} label="Offers due in 14 days" to="/procurement?f.status=issued" />
            <Figure value={s.orders.awaiting_approval} label="Orders awaiting approval" to="/procurement/purchase-orders?f.status=pending_approval" tone={s.orders.awaiting_approval ? 'amber' : undefined} />
            <Figure value={pct(s.budget.used_pct)} label="Budget used" to="/procurement/budgets" tone={s.budget.used_pct !== null && s.budget.used_pct > 100 ? 'red' : undefined} />
          </div>
          <p className="muted">{s.budget.amount ? `${money(s.budget.remaining)} left of ${money(s.budget.amount)} in the budgets in force.` : 'No budget is in force today.'}</p>
        </div>
      )}
    </Card>
  );
}

export const PROCUREMENT_WIDGETS: WidgetDef[] = [
  {
    id: 'procurement', title: 'Procurement', group: 'dashboard',
    description: 'Open solicitations, purchase orders awaiting approval and how much of the budget is used.',
    visible: (ctx) => ctx.hasModule('procurement') && ctx.sees('procurement') && ctx.can('procurement.view'),
    render: () => <ProcurementPanel />,
  },
];
