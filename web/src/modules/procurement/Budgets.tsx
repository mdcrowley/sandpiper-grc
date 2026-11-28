// Budgets: the list, one budget with its lines against committed and spent, and one budget line with the
// purchase orders charged to it. The figures are the same for everyone.
import { Link } from 'react-router-dom';
import {
  Card, EmptyState, ErrorState, formatDate, Loading, LookupChip, PageHeader, ProgressBar, RecordPage, ResourceList, Stat, TableWrap, useAuth, useFetch,
} from '../../core';
import type { Row } from '../../core';
import { money, pct, usedColor, type Figures } from './shared';

export function BudgetList() {
  return (
    <div className="stack">
      <PageHeader title="Budgets" subtitle="Operating and capital budgets by fiscal year, against what purchase orders have committed and spent." />
      <ResourceList type="budget" urlState columns={['ref', 'name', 'fiscal_year', 'status', 'starts_on', 'ends_on', { field: 'owner_id', priority: 3 }]}
        filters={['status', 'owner_id', 'starts_on']} createFields={['name', 'fiscal_year', 'starts_on', 'ends_on', 'status', 'owner_id', 'notes']} />
    </div>
  );
}

interface BudgetFigures {
  totals: Figures;
  by_kind: (Figures & { kind: string })[];
  lines: (Figures & { id: string; ref: string; title: string; kind: string; account: string | null; department: string | null; project_id: string | null })[];
  hidden_lines: number;
}

function Totals({ f }: { f: Figures }) {
  return (
    <div className="grid-stats">
      <Stat label="Budgeted" value={money(f.amount)} icon="chart" />
      <Stat label="Committed" value={money(f.committed)} icon="clock" hint="Approved and issued orders not yet received" />
      <Stat label="Spent" value={money(f.spent)} icon="check" hint="Received against orders" />
      <Stat label="Remaining" value={money(f.remaining)} icon="target" color={f.remaining < 0 ? 'red' : usedColor(f.used_pct)} hint={`${pct(f.used_pct)} used`} />
    </div>
  );
}

function Lines({ budget }: { budget: Row }) {
  const { can } = useAuth();
  const { data, error, reload } = useFetch<BudgetFigures>(`/api/budgets/${budget.id}/figures`);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={6} />;
  return (
    <div className="stack">
      <Totals f={data.totals} />
      {data.by_kind.length > 1 && (
        <Card title="Operating and capital">
          <div className="stack">{data.by_kind.map((k) => (
            <ProgressBar key={k.kind} label={`${k.kind === 'capital' ? 'Capital' : 'Operating'}: ${money(k.committed + k.spent)} of ${money(k.amount)}`}
              value={Math.max(0, k.committed + k.spent)} max={k.amount || 1} color={k.used_pct !== null && k.used_pct > 100 ? 'red' : 'blue'} valueText={pct(k.used_pct)} />
          ))}</div>
        </Card>
      )}
      <Card title="Budget against committed and spent" flush>
        {data.lines.length === 0 ? <EmptyState icon="chart" title="No lines you can open" message={data.hidden_lines ? `${data.hidden_lines} lines belong to departments you do not see.` : 'Add the budget lines below.'} /> : (
          <TableWrap label="Budget lines against committed and spent" fit><table className="table">
            <thead><tr>
              <th scope="col" data-priority={1}>Line</th><th scope="col" data-priority={3}>Kind</th><th scope="col" data-priority={3}>Department</th>
              <th scope="col" className="num" data-priority={1}>Budgeted</th><th scope="col" className="num" data-priority={2}>Committed</th>
              <th scope="col" className="num" data-priority={2}>Spent</th><th scope="col" className="num" data-priority={1}>Remaining</th><th scope="col" className="num" data-priority={2}>Used</th>
            </tr></thead>
            <tbody>{data.lines.map((l) => (
              <tr key={l.id}>
                <td><Link to={`/procurement/budget-lines/${l.id}`}>{l.account && <span className="ref">{l.account}</span>} {l.title}</Link></td>
                <td><LookupChip list="budget_kind" value={l.kind} /></td><td>{l.department ?? '—'}</td>
                <td className="num">{money(l.amount)}</td><td className="num">{money(l.committed)}</td><td className="num">{money(l.spent)}</td>
                <td className={`num${l.remaining < 0 ? ' prc-over' : ''}`}>{money(l.remaining)}</td><td className="num">{pct(l.used_pct)}</td>
              </tr>
            ))}</tbody>
          </table></TableWrap>
        )}
        {data.hidden_lines > 0 && data.lines.length > 0 && <p className="muted prc-pad prc-small">{data.hidden_lines} more lines belong to departments you do not see; the totals above include them.</p>}
      </Card>
      {can('procurement.create') && (
        <ResourceList type="budget_line" baseFilter={{ budget_id: String(budget.id) }} columns={['ref', 'title', 'kind', 'account', 'department_id', 'amount', { field: 'project_id', priority: 3 }]}
          filters={['kind', 'department_id']} createFields={['title', 'kind', 'department_id', 'account', 'amount', 'project_id', 'funding_award_id', 'notes']}
          createInitial={{ budget_id: budget.id }} onCreated={() => reload()} />
      )}
    </div>
  );
}

export function BudgetDetail() {
  return (
    <RecordPage
      type="budget"
      summaryFields={['name', 'fiscal_year', 'starts_on', 'ends_on', 'owner_id', 'notes']}
      tabs={[{ key: 'lines', label: 'Lines', content: ({ row }) => <Lines budget={row} /> }]}
    />
  );
}

interface LineFigures extends Figures { orders: { id: string; ref: string; title: string; status: string; vendor_name: string | null; order_date: string | null; amount: number; received: number }[] }

function LineOrders({ line }: { line: Row }) {
  const { data, error, reload } = useFetch<LineFigures>(`/api/budget-lines/${line.id}/figures`);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={4} />;
  return (
    <div className="stack">
      <Totals f={data} />
      <Card title="Purchase orders charged" flush>
        {data.orders.length === 0 ? <EmptyState icon="box" title="No purchase orders charged to this line" /> : (
          <TableWrap label="Purchase orders charged to this line" fit><table className="table">
            <thead><tr><th scope="col" data-priority={1}>Order</th><th scope="col" data-priority={3}>Vendor</th><th scope="col" data-priority={2}>Date</th><th scope="col" data-priority={1}>Status</th>
              <th scope="col" className="num" data-priority={1}>On this line</th><th scope="col" className="num" data-priority={2}>Received</th></tr></thead>
            <tbody>{data.orders.map((o) => (
              <tr key={o.id}>
                <td><Link to={`/procurement/purchase-orders/${o.id}`}><span className="ref">{o.ref}</span> {o.title}</Link></td>
                <td>{o.vendor_name ?? '—'}</td><td>{o.order_date ? formatDate(o.order_date) : '—'}</td><td><LookupChip list="po_status" value={o.status} /></td>
                <td className="num">{money(o.amount)}</td><td className="num">{money(o.received)}</td>
              </tr>
            ))}</tbody>
          </table></TableWrap>
        )}
      </Card>
    </div>
  );
}

export function BudgetLineDetail() {
  return (
    <RecordPage
      type="budget_line"
      summaryFields={['budget_id', 'title', 'kind', 'department_id', 'account', 'amount', 'project_id', 'funding_award_id', 'notes']}
      tabs={[{ key: 'orders', label: 'Committed and spent', content: ({ row }) => <LineOrders line={row} /> }]}
    />
  );
}

export function BudgetLineList() {
  return (
    <div className="stack">
      <PageHeader title="Budget lines" subtitle="Every line of every budget." />
      <ResourceList type="budget_line" urlState columns={['ref', 'title', 'budget_id', 'kind', 'account', 'department_id', 'amount']} filters={['budget_id', 'kind', 'department_id', 'project_id']} />
    </div>
  );
}
