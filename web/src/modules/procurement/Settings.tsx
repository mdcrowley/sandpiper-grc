// Procurement settings: the standard evaluation criteria, and where the area's lists are edited (methods
// with the organization's own limits, statuses, the required clauses template).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Button, Card, ErrorState, errorMessage, formatCurrency, Loading, NumberField, PageHeader, TableWrap, TextField, useAuth, useFetch, useLookup, useToast,
  useUnsavedChanges,
} from '../../core';

interface Criterion { name: string; description: string | null; weight: number; max_score: number }

const LISTS: [string, string, string][] = [
  ['procurement_method', 'Procurement method', 'Procurement methods, the largest amount each may be used for under your rules, how offers are evaluated, and which need a written justification'],
  ['procurement_clause', 'Procurement required clause', 'The required clauses every solicitation and resulting contract is checked against'],
  ['procurement_status', 'Solicitation status', 'Solicitation statuses'],
  ['solicitation_type', 'Solicitation type', 'Kinds of solicitation'],
  ['offer_status', 'Offer status', 'Offer statuses'],
  ['evaluator_role', 'Evaluation committee role', 'Roles on an evaluation committee'],
  ['protest_status', 'Procurement protest status', 'Protest statuses'],
  ['po_status', 'Purchase order status', 'Purchase order statuses (their names and colors; the steps are fixed)'],
  ['budget_status', 'Budget status', 'Budget statuses'],
  ['budget_kind', 'Budget line kind', 'Kinds of budget line'],
];

function Methods() {
  const { can } = useAuth();
  const methods = useLookup('procurement_method');
  return (
    <Card title="Methods and their limits" flush actions={can('admin.administer') && <Link to="/admin/lists?list=procurement_method">Edit in Lists</Link>}>
      <TableWrap label="Procurement methods"><table className="table">
        <thead><tr><th scope="col">Method</th><th scope="col" className="num">Up to</th><th scope="col">Evaluation</th><th scope="col">Justification</th></tr></thead>
        <tbody>{methods.map((m) => {
          const meta = (m as { meta?: Record<string, unknown> }).meta ?? {};
          const max = meta.max_value === undefined || meta.max_value === null || meta.max_value === '' ? null : Number(meta.max_value);
          return (
            <tr key={m.value}>
              <td>{m.label}</td>
              <td className="num">{max === null ? 'No limit set' : formatCurrency(max)}</td>
              <td>{meta.evaluation === 'price' ? 'Lowest responsive price' : meta.evaluation === 'none' ? 'None' : 'Weighted scores'}</td>
              <td>{meta.justification === 'yes' ? 'Required' : 'Not required'}</td>
            </tr>
          );
        })}</tbody>
      </table></TableWrap>
    </Card>
  );
}

function CriteriaTemplate() {
  const toast = useToast();
  const { can } = useAuth();
  const { data, error, reload } = useFetch<{ criteria_template: Criterion[] }>('/api/procurement/settings');
  const [rows, setRows] = useState<Criterion[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const unsaved = useUnsavedChanges(dirty);
  useEffect(() => { if (data) { setRows(data.criteria_template); setDirty(false); } }, [data]);
  const set = (i: number, patch: Partial<Criterion>) => { setDirty(true); setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x))); };
  const save = async () => {
    setBusy(true);
    try { await api.put('/api/procurement/settings', { criteria_template: rows }); unsaved.release(); toast.success('Standard criteria saved.'); reload(); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const editable = can('procurement.administer');
  const total = rows.reduce((s, r) => s + (Number(r.weight) || 0), 0);
  return (
    <Card title="Standard evaluation criteria">
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loading lines={4} /> : (
        <div className="stack">
          <p className="muted">A new evaluation can start from these criteria; each solicitation can then change its own until scoring starts. Weights add up to {total}.</p>
          {rows.map((r, i) => (
            <div key={i} className="prc-criterion">
              <TextField label="Criterion" required value={r.name} disabled={!editable} onChange={(v) => set(i, { name: v })} />
              <NumberField label="Weight" required min={0} value={r.weight} disabled={!editable} onChange={(v) => set(i, { weight: v ?? 0 })} />
              <NumberField label="Top score" required min={1} value={r.max_score} disabled={!editable} onChange={(v) => set(i, { max_score: v ?? 10 })} />
              {editable && <Button variant="ghost" size="sm" icon="trash" aria-label={`Remove criterion ${r.name || i + 1}`} onClick={() => { setDirty(true); setRows((x) => x.filter((_, j) => j !== i)); }} />}
            </div>
          ))}
          {editable && (
            <div className="prc-buttons">
              <Button size="sm" icon="plus" onClick={() => { setDirty(true); setRows((r) => [...r, { name: '', description: null, weight: 10, max_score: 10 }]); }}>Add a criterion</Button>
              <Button variant="primary" loading={busy} disabled={!dirty || !rows.length} onClick={save}>Save the standard criteria</Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export function ProcurementSettings() {
  const { can } = useAuth();
  return (
    <div className="stack">
      <PageHeader title="Procurement settings" subtitle="Methods and their limits, the required clauses and the standard evaluation criteria. No jurisdiction's thresholds are built in: enter your own." />
      <Methods />
      <CriteriaTemplate />
      <Card title="Lists" flush>
        <TableWrap label="Procurement lists"><table className="table prc-wrap">
          <thead><tr><th scope="col">List</th><th scope="col">What it holds</th></tr></thead>
          <tbody>{LISTS.map(([key, name, what]) => (
            <tr key={key}><td>{can('admin.administer') ? <Link to={`/admin/lists?list=${key}`}>{name}</Link> : name}</td><td>{what}</td></tr>
          ))}</tbody>
        </table></TableWrap>
      </Card>
    </div>
  );
}
