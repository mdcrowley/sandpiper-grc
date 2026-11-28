// Budgets: the list, one budget with its lines against committed and spent (paid invoices) and its versions
// (the adopted budget and each amendment, E46-67), one budget version with its line changes, and one budget
// line with the purchase orders charged to it. The figures are the same for everyone.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Button, Card, DateField, EmptyState, ErrorState, errorMessage, formatDate, IconButton, Loading, LookupChip, Modal, Notice, NumberField, PageHeader, ProgressBar,
  RecordPage, RecordPicker, ResourceList, Select, Stat, TableWrap, TextArea, TextField, todayInZone, useAuth, useFetch, useMeta, useToast, useUnsavedChanges,
} from '../../core';
import type { Row } from '../../core';
import { money, pct, usedColor, type Figures } from './shared';

export function BudgetList() {
  return (
    <div className="stack">
      <PageHeader title="Budgets" subtitle="Operating and capital budgets by fiscal year, as adopted and amended, against what purchase orders have committed and paid invoices have spent." />
      <ResourceList type="budget" urlState columns={['ref', 'name', 'fiscal_year', 'status', 'starts_on', 'ends_on', { field: 'owner_id', priority: 3 }]}
        filters={['status', 'owner_id', 'starts_on']} createFields={['name', 'fiscal_year', 'starts_on', 'ends_on', 'owner_id', 'notes']} />
    </div>
  );
}

interface BudgetFigures {
  totals: Figures & { adopted: number | null };
  by_kind: (Figures & { kind: string })[];
  lines: (Figures & { id: string; ref: string; title: string; kind: string; account: string | null; department: string | null; project_id: string | null; adopted: number | null })[];
  hidden_lines: number;
}

function Totals({ f, adopted }: { f: Figures; adopted?: number | null }) {
  const budgetHint = adopted === undefined ? undefined : adopted === null ? 'Not adopted yet' : Math.abs(adopted - f.amount) < 0.005 ? 'As adopted' : `Adopted ${money(adopted)}, amended since`;
  return (
    <div className="grid-stats">
      <Stat label="Budgeted" value={money(f.amount)} icon="chart" hint={budgetHint} />
      <Stat label="Committed" value={money(f.committed)} icon="clock" hint="Approved, issued and received orders not yet paid" />
      <Stat label="Spent" value={money(f.spent)} icon="check" hint="Paid invoices" />
      <Stat label="Remaining" value={money(f.remaining)} icon="target" color={f.remaining < 0 ? 'red' : usedColor(f.used_pct)} hint={`${pct(f.used_pct)} used`} />
    </div>
  );
}

function Lines({ budget }: { budget: Row }) {
  const { can } = useAuth();
  const { data, error, reload } = useFetch<BudgetFigures>(`/api/budgets/${budget.id}/figures`);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={6} />;
  const adopted = data.totals.adopted !== null;
  return (
    <div className="stack">
      <Totals f={data.totals} adopted={data.totals.adopted} />
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
              {adopted && <th scope="col" className="num" data-priority={3}>Adopted</th>}
              <th scope="col" className="num" data-priority={1}>Budgeted</th><th scope="col" className="num" data-priority={2}>Committed</th>
              <th scope="col" className="num" data-priority={2}>Spent</th><th scope="col" className="num" data-priority={1}>Remaining</th><th scope="col" className="num" data-priority={2}>Used</th>
            </tr></thead>
            <tbody>{data.lines.map((l) => (
              <tr key={l.id}>
                <td><Link to={`/procurement/budget-lines/${l.id}`}>{l.account && <span className="ref">{l.account}</span>} {l.title}</Link></td>
                <td><LookupChip list="budget_kind" value={l.kind} /></td><td>{l.department ?? '—'}</td>
                {adopted && <td className="num">{money(l.adopted)}</td>}
                <td className="num">{money(l.amount)}</td><td className="num">{money(l.committed)}</td><td className="num">{money(l.spent)}</td>
                <td className={`num${l.remaining < 0 ? ' prc-over' : ''}`}>{money(l.remaining)}</td><td className="num">{pct(l.used_pct)}</td>
              </tr>
            ))}</tbody>
          </table></TableWrap>
        )}
        {data.hidden_lines > 0 && data.lines.length > 0 && <p className="muted prc-pad prc-small">{data.hidden_lines} more lines belong to departments you do not see; the totals above include them.</p>}
      </Card>
      {adopted
        ? <Notice title="Adopted">The budget is adopted: its amounts change, and lines are added, through an amendment on the <Link to="?tab=versions">Versions</Link> tab, which keeps the earlier amounts.</Notice>
        : can('procurement.create') && (
          <ResourceList type="budget_line" baseFilter={{ budget_id: String(budget.id) }} columns={['ref', 'title', 'kind', 'account', 'department_id', 'amount', { field: 'project_id', priority: 3 }]}
            filters={['kind', 'department_id']} createFields={['title', 'kind', 'department_id', 'account', 'amount', 'project_id', 'funding_award_id', 'notes']}
            createInitial={{ budget_id: budget.id }} onCreated={() => reload()} />
        )}
    </div>
  );
}

// ---------- versions ----------

interface Version {
  id: string; version_no: number; kind: string; title: string; effective_on: string; approved_on: string | null; decision: string | null;
  reason: string | null; total_before: number; total_after: number; change: number; recorded_by_name: string | null;
}
interface History {
  current_version: number | null;
  versions: Version[];
  lines: { id: string; ref: string; title: string; account: string | null; kind: string; current: number; amounts: (number | null)[] }[];
  hidden_lines: number;
}
interface NewLine { title: string; kind: string; account: string; amount: number | null }

const signed = (n: number) => (n > 0 ? `+${money(n)}` : n < 0 ? `−${money(-n)}` : money(0));

function VersionDialog({ budget, history, onClose, onSaved }: { budget: Row; history: History; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { resources } = useMeta();
  const adoption = history.versions.length === 0;
  const [approvedOn, setApprovedOn] = useState(todayInZone());
  const [effectiveOn, setEffectiveOn] = useState('');
  const [decision, setDecision] = useState('');
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [amounts, setAmounts] = useState<Record<string, number | null>>(Object.fromEntries(history.lines.map((l) => [l.id, l.current])));
  const [added, setAdded] = useState<NewLine[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const changed = history.lines.filter((l) => amounts[l.id] !== null && amounts[l.id] !== undefined && Math.abs(Number(amounts[l.id]) - l.current) >= 0.005);
  const dirty = Boolean(decision || reason || changed.length || added.length);
  const unsaved = useUnsavedChanges(dirty);
  const before = history.lines.reduce((s, l) => s + l.current, 0);
  const after = before + changed.reduce((s, l) => s + Number(amounts[l.id]) - l.current, 0) + added.reduce((s, a) => s + (a.amount ?? 0), 0);
  const setNew = (i: number, patch: Partial<NewLine>) => setAdded((x) => x.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const save = async () => {
    setBusy(true); setErrors({});
    try {
      await api.post('/api/budget-versions', {
        budget_id: budget.id, kind: adoption ? 'adopted' : 'amendment', approved_on: approvedOn || null, effective_on: effectiveOn || null,
        decision: decision || null, decision_id: decisionId, document_id: documentId, reason: reason || null,
        changes: [
          ...changed.map((l) => ({ budget_line_id: l.id, amount: amounts[l.id] })),
          ...added.filter((a) => a.title.trim()).map((a) => ({ title: a.title, kind: a.kind, account: a.account || null, amount: a.amount ?? 0 })),
        ],
      });
      unsaved.release();
      toast.success(adoption ? 'Adoption recorded.' : 'Amendment recorded.');
      onSaved();
    } catch (err) { setErrors((err as { fields?: Record<string, string> }).fields ?? {}); toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal open size="lg" title={adoption ? 'Record the adoption' : `Record amendment ${(history.current_version ?? 0) + 1}`} onClose={onClose} dirty={dirty}
      footer={<><Button onClick={unsaved.guard(onClose)}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={(!decision.trim() && !decisionId) || (!adoption && (!reason.trim() || (!changed.length && !added.some((a) => a.title.trim()))))} onClick={save}>
          {adoption ? 'Record the adoption' : 'Record the amendment'}
        </Button></>}>
      <div className="stack">
        <p className="muted">{adoption
          ? 'The budget as it is now becomes the adopted version (you may still correct an amount below). From then on, amounts change only through amendments.'
          : 'Give the new amount of each line that changes, or add a line. The earlier amounts are kept as the previous version.'}</p>
        <div className="prc-two">
          <DateField label="Approved on" value={approvedOn} error={errors.approved_on} onChange={setApprovedOn} />
          <DateField label="Takes effect" value={effectiveOn} error={errors.effective_on} onChange={setEffectiveOn} hint="The approval date when empty." />
        </div>
        <TextField label="Approval or board decision" required={!decisionId} value={decision} error={errors.decision} onChange={setDecision}
          hint='For example "Board resolution 2027-14".' />
        {resources.meeting_decision && (
          <RecordPicker label="Committee decision (optional)" type="meeting_decision" value={decisionId} error={errors.decision_id} onChange={(id) => setDecisionId(id)}
            hint="A carried decision of a committee meeting; its date and reference are used when you leave them empty." />
        )}
        {resources.policy && <RecordPicker label="Document (optional)" type="policy" value={documentId} onChange={(id) => setDocumentId(id)} hint="The controlled document holding the budget or the amendment." />}
        <TextArea label="Reason" required={!adoption} value={reason} error={errors.reason} rows={2} onChange={setReason} />
        <TableWrap label="Line amounts"><table className="table">
          <thead><tr><th scope="col">Line</th><th scope="col" className="num">Now</th><th scope="col">New amount</th></tr></thead>
          <tbody>
            {history.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.account && <span className="ref">{l.account}</span>} {l.title}</td>
                <td className="num">{money(l.current)}</td>
                <td><div className="prc-score"><NumberField label={`New amount, ${l.title}`} hideLabel min={0} decimals={2} thousands value={amounts[l.id] ?? null} onChange={(v) => setAmounts((x) => ({ ...x, [l.id]: v }))} /></div></td>
              </tr>
            ))}
            {added.map((a, i) => (
              <tr key={`new-${i}`}>
                <td>
                  <div className="prc-newline">
                    <TextField label={`New line ${i + 1}`} hideLabel placeholder="What the money is for" value={a.title} onChange={(v) => setNew(i, { title: v })} />
                    <Select label={`Kind of new line ${i + 1}`} hideLabel value={a.kind} onChange={(v) => setNew(i, { kind: v })} options={[{ value: 'operating', label: 'Operating' }, { value: 'capital', label: 'Capital' }]} />
                    <TextField label={`Account of new line ${i + 1}`} hideLabel placeholder="Account" value={a.account} onChange={(v) => setNew(i, { account: v })} />
                  </div>
                </td>
                <td className="num">New</td>
                <td><div className="prc-score">
                  <NumberField label={`Amount of new line ${i + 1}`} hideLabel min={0} decimals={2} thousands value={a.amount} onChange={(v) => setNew(i, { amount: v })} />
                  <IconButton icon="x" label={`Remove new line ${i + 1}`} onClick={() => setAdded((x) => x.filter((_, j) => j !== i))} />
                </div></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><th scope="row">Total</th><td className="num">{money(before)}</td><td className="num"><strong>{money(after)}</strong> ({signed(after - before)})</td></tr></tfoot>
        </table></TableWrap>
        {errors.changes && <Notice tone="error">{errors.changes}</Notice>}
        <div><Button size="sm" icon="plus" onClick={() => setAdded((x) => [...x, { title: '', kind: 'operating', account: '', amount: null }])}>Add a new line</Button></div>
      </div>
    </Modal>
  );
}

function Versions({ budget, reloadRecord }: { budget: Row; reloadRecord: () => void }) {
  const { can } = useAuth();
  const { data, error, reload } = useFetch<History>(`/api/budgets/${budget.id}/versions`);
  const [recording, setRecording] = useState(false);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={5} />;
  const may = can('procurement.create') && can('procurement.approve') && budget.status !== 'closed';
  const adoption = data.versions.length === 0;
  return (
    <div className="stack">
      <Card title="Adopted budget and amendments" flush
        actions={may && <Button size="sm" variant="primary" icon="plus" onClick={() => setRecording(true)}>{adoption ? 'Record the adoption' : 'Record an amendment'}</Button>}>
        {adoption ? <EmptyState icon="history" title="Not adopted yet" message="When the budget is approved, record its adoption: the amounts as adopted are kept, and later changes are recorded as amendments." /> : (
          <TableWrap label="Budget versions" fit><table className="table prc-wrap">
            <thead><tr>
              <th scope="col" data-priority={1}>Version</th><th scope="col" data-priority={2}>Takes effect</th><th scope="col" data-priority={2}>Approval</th>
              <th scope="col" data-priority={3}>Reason</th><th scope="col" className="num" data-priority={1}>Total</th><th scope="col" className="num" data-priority={1}>Change</th>
            </tr></thead>
            <tbody>{data.versions.map((v) => (
              <tr key={v.id}>
                <td><Link to={`/procurement/budget-versions/${v.id}`}>{v.title}</Link>{v.version_no === data.current_version && <span className="muted"> (current)</span>}</td>
                <td>{formatDate(v.effective_on)}</td>
                <td>{v.decision ?? '—'}{v.approved_on && <div className="muted prc-small">{formatDate(v.approved_on)}</div>}</td>
                <td>{v.reason ?? '—'}</td>
                <td className="num">{money(v.total_after)}</td><td className="num">{v.version_no === 0 ? '—' : signed(v.change)}</td>
              </tr>
            ))}</tbody>
          </table></TableWrap>
        )}
      </Card>
      {!adoption && data.lines.length > 0 && (
        <Card title="Each line in every version" flush>
          <TableWrap label="Line amounts in every version"><table className="table">
            <thead><tr>
              <th scope="col">Line</th>
              {data.versions.map((v) => <th key={v.id} scope="col" className="num">{v.version_no === 0 ? 'Adopted' : `Amendment ${v.version_no}`}</th>)}
            </tr></thead>
            <tbody>{data.lines.map((l) => (
              <tr key={l.id}>
                <td><Link to={`/procurement/budget-lines/${l.id}`}>{l.account && <span className="ref">{l.account}</span>} {l.title}</Link></td>
                {l.amounts.map((a, i) => {
                  const prev = i > 0 ? l.amounts[i - 1] : a;
                  return <td key={data.versions[i].id} className={`num${i > 0 && a !== prev ? ' prc-changed' : ''}`}>{a === null ? '—' : money(a)}</td>;
                })}
              </tr>
            ))}</tbody>
            <tfoot><tr><th scope="row">Total</th>{data.versions.map((v) => <td key={v.id} className="num"><strong>{money(v.total_after)}</strong></td>)}</tr></tfoot>
          </table></TableWrap>
          {data.hidden_lines > 0 && <p className="muted prc-pad prc-small">{data.hidden_lines} more lines belong to departments you do not see; the totals include them.</p>}
        </Card>
      )}
      {recording && <VersionDialog budget={budget} history={data} onClose={() => setRecording(false)} onSaved={() => { setRecording(false); reload(); reloadRecord(); }} />}
    </div>
  );
}

export function BudgetDetail() {
  return (
    <RecordPage
      type="budget"
      summaryFields={['name', 'fiscal_year', 'starts_on', 'ends_on', 'owner_id', 'notes']}
      tabs={[
        { key: 'lines', label: 'Lines', content: ({ row }) => <Lines budget={row} /> },
        { key: 'versions', label: 'Versions', content: ({ row, reload }) => <Versions budget={row} reloadRecord={reload} /> },
      ]}
    />
  );
}

interface VersionLines {
  total_before: number; total_after: number; hidden_lines: number;
  lines: { budget_line_id: string; ref: string; title: string; account: string | null; kind: string; amount_before: number | null; amount_after: number; change: number; added: boolean }[];
}

function VersionChanges({ version }: { version: Row }) {
  const { data, error, reload } = useFetch<VersionLines>(`/api/budget-versions/${version.id}/lines`);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={4} />;
  const changed = data.lines.filter((l) => l.added || Math.abs(l.change) >= 0.005);
  return (
    <div className="stack">
      <div className="grid-stats">
        <Stat label="Total before" value={money(data.total_before)} icon="history" />
        <Stat label="Total after" value={money(data.total_after)} icon="chart" />
        <Stat label="Change" value={signed(data.total_after - data.total_before)} icon="target" />
      </div>
      <Card title={version.kind === 'adopted' ? 'Lines as adopted' : 'Lines changed'} flush>
        {(version.kind === 'adopted' ? data.lines : changed).length === 0 ? <EmptyState icon="chart" title="No line changes you can open" /> : (
          <TableWrap label="Line changes" fit><table className="table">
            <thead><tr>
              <th scope="col" data-priority={1}>Line</th><th scope="col" data-priority={3}>Kind</th>
              <th scope="col" className="num" data-priority={2}>Before</th><th scope="col" className="num" data-priority={1}>After</th><th scope="col" className="num" data-priority={1}>Change</th>
            </tr></thead>
            <tbody>{(version.kind === 'adopted' ? data.lines : changed).map((l) => (
              <tr key={l.budget_line_id}>
                <td><Link to={`/procurement/budget-lines/${l.budget_line_id}`}>{l.account && <span className="ref">{l.account}</span>} {l.title}</Link>{l.added && <span className="muted"> (new line)</span>}</td>
                <td><LookupChip list="budget_kind" value={l.kind} /></td>
                <td className="num">{l.amount_before === null ? '—' : money(l.amount_before)}</td><td className="num">{money(l.amount_after)}</td>
                <td className="num">{signed(l.change)}</td>
              </tr>
            ))}</tbody>
          </table></TableWrap>
        )}
        {data.hidden_lines > 0 && <p className="muted prc-pad prc-small">{data.hidden_lines} lines belong to departments you do not see; the totals include them.</p>}
      </Card>
    </div>
  );
}

export function BudgetVersionList() {
  return (
    <div className="stack">
      <PageHeader title="Budget versions" subtitle="The adoption and every amendment of every budget, with their approval and reason. Record them from a budget's Versions tab." />
      <ResourceList type="budget_version" urlState columns={['title', 'budget_id', 'kind', 'effective_on', 'decision', { field: 'total_after', priority: 2 }, { field: 'approved_on', priority: 3 }]}
        filters={['budget_id', 'kind', 'effective_on']} />
    </div>
  );
}

export function BudgetVersionDetail() {
  return (
    <RecordPage
      type="budget_version"
      title={(row) => String(row.title ?? 'Budget version')}
      summaryFields={['budget_id', 'kind', 'effective_on', 'approved_on', 'decision', 'decision_id', 'document_id', 'reason', 'recorded_by_name', 'notes']}
      tabs={[{ key: 'changes', label: 'Line changes', content: ({ row }) => <VersionChanges version={row} /> }]}
    />
  );
}

interface LineFigures extends Figures { orders: { id: string; ref: string; title: string; status: string; vendor_name: string | null; order_date: string | null; amount: number; received: number; paid: number }[] }

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
            <thead><tr><th scope="col" data-priority={1}>Order</th><th scope="col" data-priority={3}>Vendor</th><th scope="col" data-priority={3}>Date</th><th scope="col" data-priority={1}>Status</th>
              <th scope="col" className="num" data-priority={1}>On this line</th><th scope="col" className="num" data-priority={2}>Received</th><th scope="col" className="num" data-priority={2}>Paid</th></tr></thead>
            <tbody>{data.orders.map((o) => (
              <tr key={o.id}>
                <td><Link to={`/procurement/purchase-orders/${o.id}`}><span className="ref">{o.ref}</span> {o.title}</Link></td>
                <td>{o.vendor_name ?? '—'}</td><td>{o.order_date ? formatDate(o.order_date) : '—'}</td><td><LookupChip list="po_status" value={o.status} /></td>
                <td className="num">{money(o.amount)}</td><td className="num">{money(o.received)}</td><td className="num">{money(o.paid)}</td>
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
