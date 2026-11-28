// Shapes and small pieces shared by the procurement pages.
import { formatCurrency, Stat, useAuth } from '../../core';

export interface Figures { amount: number; committed: number; spent: number; remaining: number; used_pct: number | null }

export interface Summary {
  today: string;
  solicitations: { open: number; due_soon: number; awaiting_award: number };
  orders: { awaiting_approval: number; open: number; drafts: number };
  invoices: { awaiting_approval: number; exceptions: number; to_pay: number; overdue: number };
  budget: Figures;
}

/** Money with no cents on whole amounts; a dash when there is none. */
export const money = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : formatCurrency(Number(v)));

export const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`);

/** The color of how much of a budget is used. */
export const usedColor = (used: number | null) => (used === null ? undefined : used > 100 ? 'red' as const : used >= 90 ? 'amber' as const : undefined);

/** The area's figures, the same for everyone. */
export function SummaryTiles({ s }: { s: Summary }) {
  const { can } = useAuth();
  return (
    <div className="grid-stats">
      <Stat label="Open solicitations" value={s.solicitations.open} icon="clipboard" to="/procurement?f.status=planning,issued,evaluation"
        hint={s.solicitations.due_soon ? `Offers due on ${s.solicitations.due_soon} in the next 14 days` : 'None with offers due in the next 14 days'} />
      <Stat label="Waiting for an award" value={s.solicitations.awaiting_award} icon="scale" color={s.solicitations.awaiting_award ? 'blue' : undefined}
        hint="Offers in, no award yet" to="/procurement?f.status=issued,evaluation" />
      <Stat label="Orders awaiting approval" value={s.orders.awaiting_approval} icon="clock" color={s.orders.awaiting_approval ? 'amber' : undefined}
        hint={`${s.orders.open} approved or issued orders open`} to="/procurement/purchase-orders?f.status=pending_approval" />
      <Stat label="Invoices awaiting approval" value={s.invoices.awaiting_approval} icon="file-text" color={s.invoices.exceptions ? 'amber' : undefined}
        to="/procurement/invoices?f.status=pending_approval"
        hint={`${s.invoices.exceptions ? `${s.invoices.exceptions} not matching · ` : ''}${s.invoices.to_pay} to pay${s.invoices.overdue ? `, ${s.invoices.overdue} overdue` : ''}`} />
      {can('procurement.view') && (
        <Stat label="Budget used" value={pct(s.budget.used_pct)} icon="chart" color={usedColor(s.budget.used_pct)} to="/procurement/budgets"
          hint={s.budget.amount ? `${money(s.budget.remaining)} of ${money(s.budget.amount)} left` : 'No budget in force'} />
      )}
    </div>
  );
}
