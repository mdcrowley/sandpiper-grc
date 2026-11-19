// Contract value year by year: a small table with add and remove, a total in the
// organization's currency, and a comparison with the contract's recorded total value.
import { useState } from 'react';
import {
  Button, Card, currency, errorMessage, formatCurrency, IconButton, NumberField, useToast,
} from '../../core';
import type { Row } from '../../core';

interface Line { id: number; year: number | null; amount: number | null }

let nextId = 1;
const toLines = (value: unknown): Line[] => Object.entries((value ?? {}) as Record<string, number>)
  .map(([year, amount]) => ({ id: nextId++, year: Number(year), amount: Number(amount) }))
  .sort((a, b) => (a.year ?? 0) - (b.year ?? 0));

const sum = (lines: { amount: number | null }[]) => Math.round(lines.reduce((n, l) => n + (l.amount ?? 0), 0) * 100) / 100;

/** "Matches", or how far the yearly figures are from the recorded total. */
function Comparison({ byYear, total }: { byYear: number; total: number | null }) {
  if (total === null || total === undefined) return <span className="muted">No total value is recorded to compare with.</span>;
  const diff = Math.round((byYear - Number(total)) * 100) / 100;
  if (diff === 0) return <span className="vnd-vby-ok">Matches the total value.</span>;
  return (
    <span className="vnd-vby-diff">
      {formatCurrency(Math.abs(diff))} {diff > 0 ? 'more' : 'less'} than the total value of {formatCurrency(total)}.
    </span>
  );
}

export function ValueByYear({ row, canEdit, save }: { row: Row; canEdit: boolean; save: (patch: Record<string, unknown>) => Promise<unknown> }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const saved = toLines(row.value_by_year);
  const total = row.total_value === null || row.total_value === undefined ? null : Number(row.total_value);

  function start() {
    const startYear = row.start_date ? Number(String(row.start_date).slice(0, 4)) : new Date().getFullYear();
    setLines(saved.length ? saved : [{ id: nextId++, year: startYear, amount: null }]);
    setErrors({});
    setEditing(true);
  }

  function addYear() {
    const years = lines.map((l) => l.year).filter((y): y is number => y !== null);
    const year = years.length ? Math.max(...years) + 1 : new Date().getFullYear();
    setLines([...lines, { id: nextId++, year, amount: null }]);
  }

  async function submit(alsoTotal: boolean) {
    const found: Record<number, string> = {};
    const seen = new Set<number>();
    for (const l of lines) {
      if (l.year === null || !Number.isInteger(l.year) || l.year < 1900 || l.year > 2200) found[l.id] = 'Enter a four-digit year.';
      else if (seen.has(l.year)) found[l.id] = `${l.year} is listed twice.`;
      else if (l.amount === null || !Number.isFinite(l.amount)) found[l.id] = 'Enter an amount.';
      if (l.year !== null) seen.add(l.year);
    }
    setErrors(found);
    if (Object.keys(found).length) return;
    const map: Record<string, number> = {};
    for (const l of lines) map[String(l.year)] = l.amount as number;
    setBusy(true);
    try {
      await save({ value_by_year: lines.length ? map : null, ...(alsoTotal ? { total_value: sum(lines) } : {}) });
      toast.success('Value by year saved.');
      setEditing(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    const max = Math.max(1, ...saved.map((l) => Math.abs(l.amount ?? 0)));
    return (
      <Card
        title="Value by year" className="vnd-vby"
        actions={canEdit && <Button size="sm" icon="edit" onClick={start}>{saved.length ? 'Edit' : 'Add years'}</Button>}
      >
        {saved.length === 0 ? (
          <p className="muted">
            No yearly figures yet.{total !== null ? ` The total value is ${formatCurrency(total)}.` : ''}
          </p>
        ) : (
          <>
            <table className="vnd-vby-table">
              <caption className="sr-only">Contract value by year, in {currency()}</caption>
              <thead><tr><th scope="col">Year</th><th scope="col" className="num">Amount</th><th scope="col"><span className="sr-only">Share</span></th></tr></thead>
              <tbody>
                {saved.map((l) => (
                  <tr key={l.id}>
                    <th scope="row">{l.year}</th>
                    <td className="num">{formatCurrency(l.amount)}</td>
                    <td className="vnd-vby-barcell" aria-hidden="true">
                      <span className="vnd-vby-bar" style={{ width: `${(Math.abs(l.amount ?? 0) / max) * 100}%` }} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><th scope="row">Total of the years</th><td className="num">{formatCurrency(sum(saved))}</td><td /></tr>
              </tfoot>
            </table>
            <p className="vnd-vby-compare"><Comparison byYear={sum(saved)} total={total} /></p>
          </>
        )}
      </Card>
    );
  }

  const byYear = sum(lines);
  const differs = total === null || Math.round((byYear - total) * 100) !== 0;
  return (
    <Card title="Value by year" className="vnd-vby">
      <div className="vnd-vby-edit">
        {lines.map((l, i) => (
          <div key={l.id} className="vnd-vby-line">
            <NumberField
              label="Year" hideLabel={i > 0} value={l.year} min={1900} max={2200} step={1} decimals={0} placeholder="Year"
              error={errors[l.id]?.includes('year') || errors[l.id]?.includes('twice') ? errors[l.id] : undefined}
              onChange={(year) => setLines(lines.map((x) => (x.id === l.id ? { ...x, year } : x)))}
            />
            <NumberField
              label={`Amount (${currency()})`} hideLabel={i > 0} value={l.amount} prefix={`${currency()} `} thousands decimals={2}
              placeholder="0.00" error={errors[l.id]?.includes('amount') ? errors[l.id] : undefined}
              onChange={(amount) => setLines(lines.map((x) => (x.id === l.id ? { ...x, amount } : x)))}
            />
            <IconButton
              icon="trash" label={`Remove ${l.year ?? 'this year'}`} className={i === 0 ? 'vnd-vby-first' : undefined}
              onClick={() => setLines(lines.filter((x) => x.id !== l.id))}
            />
          </div>
        ))}
        {lines.length === 0 && <p className="muted">No years. Saving now clears the yearly figures.</p>}
        <div><Button size="sm" icon="plus" onClick={addYear}>Add year</Button></div>
        <div className="vnd-vby-total" aria-live="polite">
          <span>Total of the years</span>
          <strong>{formatCurrency(byYear)}</strong>
          <Comparison byYear={byYear} total={total} />
        </div>
      </div>
      <div className="form-actions">
        <Button onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
        {differs && lines.length > 0 && byYear > 0 && (
          <Button loading={busy} onClick={() => void submit(true)}>Save and set total value to {formatCurrency(byYear)}</Button>
        )}
        <Button variant="primary" loading={busy} onClick={() => void submit(false)}>Save years</Button>
      </div>
    </Card>
  );
}
