// E45-43: the total under the contract and vendor lists. It is a figure, so it counts every active
// contract (or vendor), whoever is looking and whatever the list is filtered to; the line says so.
import { formatCurrency, useFetch } from '../../core';

interface ContractSpend { year: string; active: number; withValue: number; annualValue: number }
interface VendorSpend { year: string; withSpend: number; annualSpend: number }

export function ContractSpendTotal() {
  const { data } = useFetch<ContractSpend>('/api/contracts/spend-summary');
  if (!data) return null;
  const missing = data.active - data.withValue;
  return (
    <p className="vnd-spend-total" aria-live="polite">
      <span>Annual value of all active contracts ({data.year}):</span> <strong>{formatCurrency(data.annualValue)}</strong>
      <span className="muted"> · {data.active} active{missing > 0 ? `, ${missing} with no value recorded` : ''}</span>
    </p>
  );
}

export function VendorSpendTotal() {
  const { data } = useFetch<VendorSpend>('/api/vendors/spend-summary');
  if (!data) return null;
  return (
    <p className="vnd-spend-total" aria-live="polite">
      <span>Annual spend with all vendors ({data.year}, active contracts):</span> <strong>{formatCurrency(data.annualSpend)}</strong>
      <span className="muted"> · {data.withSpend} vendor{data.withSpend === 1 ? '' : 's'} with spend</span>
    </p>
  );
}
