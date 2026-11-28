// Claim payments one by one (E46-62): the claim's Payments tab lists each payment and recovery with its
// date, payee, amount and kind; the claim's paid and recovered totals are worked out from them.
import { Card, formatCurrency, KeyValue, RecordPage, ResourceList, useAuth } from '../../core';
import type { RecordContext } from '../../core';

export const PAYMENT_CREATE = ['paid_on', 'kind', 'payee', 'amount', 'reference', 'note'];

export function ClaimPayments({ row, reload }: RecordContext) {
  const { can } = useAuth();
  const paid = Number(row.paid ?? 0);
  const recovered = Number(row.recovered ?? 0);
  const reserve = Number(row.reserve ?? 0);
  return (
    <div className="stack">
      <Card title="Totals">
        <KeyValue items={[
          { label: 'Paid to date', value: formatCurrency(paid) },
          { label: 'Recovered', value: formatCurrency(recovered) },
          { label: 'Net cost', value: formatCurrency(paid - recovered) },
          { label: 'Reserve', value: row.reserve == null ? '—' : formatCurrency(reserve) },
        ]} />
        <p className="muted ins-small">The totals are worked out from the payments and recoveries listed below.</p>
      </Card>
      <ResourceList
        type="insurance_claim_payment"
        baseFilter={{ claim_id: String(row.id) }}
        columns={['paid_on', 'kind', { field: 'payee', priority: 1 }, { field: 'amount', priority: 1 }, { field: 'reference', priority: 3 }, { field: 'recorded_by_name', priority: 3 }]}
        filters={['kind', 'paid_on']}
        defaultSort={{ field: 'paid_on', dir: 'asc' }}
        createFields={can('insurance.create') ? PAYMENT_CREATE : undefined}
        createInitial={{ claim_id: row.id }}
        onCreated={() => reload()}
      />
    </div>
  );
}

export function PaymentDetail() {
  return (
    <RecordPage
      type="insurance_claim_payment"
      summaryFields={['claim_id', 'paid_on', 'kind', 'payee', 'amount', 'reference', 'note', 'recorded_by_name']}
      breadcrumbs={[{ label: 'Insurance claims', to: '/insurance/claims' }, { label: 'Claim payment' }]}
    />
  );
}
