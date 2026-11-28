// Purchase orders: the list, and one order with its lines, approval, issue, receiving, its invoices
// (Invoices.tsx) and the budget lines it is charged to.
import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import {
  api, Button, Card, ConfirmDialog, DateField, EmptyState, ErrorState, errorMessage, formatDate, Loading, Modal, Notice, NumberField,
  PageHeader, RecordPage, RecordPicker, ResourceList, TableWrap, TextArea, TextField, todayInZone, useAuth, useFetch, useToast, useUnsavedChanges,
} from '../../core';
import type { ColumnDef, Row } from '../../core';
import { OrderInvoices } from './Invoices';
import { money } from './shared';

const COLUMNS: ColumnDef[] = [
  'ref', 'title', { field: 'vendor_name', priority: 2 }, { field: 'order_date', priority: 2 }, 'status', { field: 'total', priority: 1 },
  { field: 'department_id', priority: 3 }, { field: 'requested_by', priority: 3 }, { field: 'budget_line_id', hidden: true }, { field: 'procurement_id', hidden: true },
  { field: 'contract_id', hidden: true }, { field: 'approved_at', hidden: true },
];
const FILTERS = ['status', 'vendor_id', 'department_id', 'requested_by', 'budget_line_id', 'procurement_id', 'contract_id', 'order_date'];
const CREATE = ['title', 'vendor_id', 'vendor_name', 'order_date', 'department_id', 'requested_by', 'procurement_id', 'contract_id', 'budget_line_id', 'needed_by', 'notes'];
const SUMMARY = ['title', 'vendor_id', 'vendor_name', 'order_date', 'total', 'department_id', 'requested_by', 'procurement_id', 'contract_id', 'budget_line_id', 'needed_by',
  'submitted_at', 'approved_by', 'approved_at', 'issued_on', 'received_on', 'closed_on', 'canceled_reason', 'notes'];

export function OrderList() {
  return (
    <div className="stack">
      <PageHeader title="Purchase orders" subtitle="Orders to vendors, from draft through approval, issue, receiving and invoices. Approved orders commit their budget lines until their invoices are paid." />
      <ResourceList type="purchase_order" urlState columns={COLUMNS} filters={FILTERS} createFields={CREATE} />
    </div>
  );
}

interface Line { id: string; line_no: number; description: string; quantity: number; unit_price: number; amount: number; budget_line_id: string | null; budget_line: string | null; asset_id: string | null; received_quantity: number; notes: string | null }
interface Receipt { id: string; line_no: number; description: string; quantity: number; received_on: string; received_by_name: string | null; note: string | null }
interface BudgetCheck { id: string; ref: string; title: string; account: string | null; amount: number; committed: number; spent: number; remaining: number; this_order: number; remaining_after: number; over: boolean }

function LineDialog({ po, line, onClose, onSaved }: { po: Row; line: Line | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [description, setDescription] = useState(line?.description ?? '');
  const [quantity, setQuantity] = useState<number | null>(line?.quantity ?? 1);
  const [price, setPrice] = useState<number | null>(line?.unit_price ?? null);
  const [budget, setBudget] = useState<string | null>(line?.budget_line_id ?? (po.budget_line_id as string | null) ?? null);
  const [asset, setAsset] = useState<string | null>(line?.asset_id ?? null);
  const [busy, setBusy] = useState(false);
  const dirty = description !== (line?.description ?? '') || quantity !== (line?.quantity ?? 1) || price !== (line?.unit_price ?? null);
  const unsaved = useUnsavedChanges(dirty);
  const { can } = useAuth();
  const save = async () => {
    setBusy(true);
    try {
      const data = { description, quantity, unit_price: price ?? 0, budget_line_id: budget, ...(can('assets.view') ? { asset_id: asset } : {}) };
      if (line) await api.patch(`/api/purchase-order-lines/${line.id}`, data);
      else await api.post('/api/purchase-order-lines', { ...data, purchase_order_id: po.id });
      unsaved.release();
      toast.success('Line saved.');
      onSaved();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal open title={line ? `Line ${line.line_no}` : 'Add a line'} onClose={onClose} dirty={dirty}
      footer={<><Button onClick={unsaved.guard(onClose)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!description.trim() || !quantity} onClick={save}>Save line</Button></>}>
      <div className="stack">
        <TextField label="Description" required value={description} onChange={setDescription} />
        <div className="prc-two">
          <NumberField label="Quantity" required min={0} value={quantity} onChange={setQuantity} />
          <NumberField label="Unit price" required min={0} decimals={2} thousands value={price} onChange={setPrice} />
        </div>
        <p className="muted">Amount: {money((quantity ?? 0) * (price ?? 0))}</p>
        <RecordPicker label="Budget line" type="budget_line" value={budget} display={line?.budget_line ?? undefined} onChange={(id) => setBudget(id)} />
        {can('assets.view') && <RecordPicker label="Asset (optional)" type="asset" value={asset} onChange={(id) => setAsset(id)} />}
      </div>
    </Modal>
  );
}

function ReceiveDialog({ po, lines, onClose, onSaved }: { po: Row; lines: Line[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const open = lines.filter((l) => l.received_quantity < l.quantity);
  const [qty, setQty] = useState<Record<string, number | null>>(Object.fromEntries(open.map((l) => [l.id, l.quantity - l.received_quantity])));
  const [on, setOn] = useState(todayInZone());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/api/purchase-orders/${po.id}/receipts`, { received_on: on, note, lines: open.filter((l) => (qty[l.id] ?? 0) > 0).map((l) => ({ line_id: l.id, quantity: qty[l.id] })) });
      toast.success('Receipt recorded.'); onSaved();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal open title="Record what was received" size="lg" onClose={onClose} dirty={Boolean(note)}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Record</Button></>}>
      <div className="stack">
        <DateField label="Received on" required value={on} onChange={setOn} />
        <TableWrap label="Quantities received"><table className="table">
          <thead><tr><th scope="col">Line</th><th scope="col" className="num">Still to receive</th><th scope="col">Received now</th></tr></thead>
          <tbody>{open.map((l) => (
            <tr key={l.id}>
              <td>{l.line_no}. {l.description}</td>
              <td className="num">{l.quantity - l.received_quantity}</td>
              <td className="prc-score"><NumberField label={`Received now, line ${l.line_no}`} hideLabel min={0} max={l.quantity - l.received_quantity} value={qty[l.id] ?? null} onChange={(v) => setQty((x) => ({ ...x, [l.id]: v }))} /></td>
            </tr>
          ))}</tbody>
        </table></TableWrap>
        <TextArea label="Note" value={note} rows={2} onChange={setNote} hint="For example the delivery slip number. The vendor's invoice is entered on the Invoices tab." />
      </div>
    </Modal>
  );
}

function Lines({ po, reloadRecord }: { po: Row; reloadRecord: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<Line[]>(`/api/purchase-orders/${po.id}/lines`);
  const receipts = useFetch<Receipt[]>(`/api/purchase-orders/${po.id}/receipts`);
  const [editing, setEditing] = useState<Line | 'new' | null>(null);
  const [removing, setRemoving] = useState<Line | null>(null);
  const [receiving, setReceiving] = useState(false);
  const draft = po.status === 'draft';
  const edit = can('procurement.edit');
  const all = () => { reload(); receipts.reload(); reloadRecord(); };
  const remove = async () => {
    const l = removing!; setRemoving(null);
    try { await api.del(`/api/purchase-order-lines/${l.id}`); toast.success('Line removed.'); all(); } catch (err) { toast.error(errorMessage(err)); }
  };
  return (
    <div className="stack">
      <Card title="Lines" flush actions={<>
        {edit && draft && <Button size="sm" icon="plus" onClick={() => setEditing('new')}>Add a line</Button>}
        {edit && ['issued', 'partially_received'].includes(String(po.status)) && data && data.length > 0 && <Button size="sm" variant="primary" onClick={() => setReceiving(true)}>Record what was received</Button>}
      </>}>
        {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <div className="prc-pad"><Loading lines={3} /></div>
          : data.length === 0 ? <EmptyState icon="box" title="No lines yet" message="Add what is ordered: description, quantity, unit price and the budget line it is charged to." /> : (
            <TableWrap label="Purchase order lines" fit><table className="table">
              <thead><tr>
                <th scope="col" data-priority={1}>Line</th><th scope="col" data-priority={1}>Description</th><th scope="col" className="num" data-priority={1}>Quantity</th>
                <th scope="col" className="num" data-priority={2}>Unit price</th><th scope="col" className="num" data-priority={1}>Amount</th>
                <th scope="col" data-priority={3}>Budget line</th><th scope="col" className="num" data-priority={2}>Received</th><th scope="col" data-priority={1}><span className="sr-only">Actions</span></th>
              </tr></thead>
              <tbody>{data.map((l) => (
                <tr key={l.id}>
                  <td>{l.line_no}</td><td>{l.description}</td><td className="num">{l.quantity}</td><td className="num">{money(l.unit_price)}</td>
                  <td className="num">{money(l.amount)}</td><td>{l.budget_line ?? '—'}</td><td className="num">{l.received_quantity}</td>
                  <td className="prc-actions">{edit && draft && <>
                    <Button size="sm" variant="ghost" aria-label={`Change line ${l.line_no}`} onClick={() => setEditing(l)}>Change</Button>
                    <Button size="sm" variant="ghost" aria-label={`Remove line ${l.line_no}`} onClick={() => setRemoving(l)}>Remove</Button>
                  </>}</td>
                </tr>
              ))}</tbody>
              <tfoot><tr><th scope="row" colSpan={4}>Total</th><td className="num"><strong>{money(po.total)}</strong></td><td colSpan={3} /></tr></tfoot>
            </table></TableWrap>
          )}
      </Card>
      {receipts.data && receipts.data.length > 0 && (
        <Card title="Received" flush>
          <TableWrap label="Receipts"><table className="table">
            <thead><tr><th scope="col">Received on</th><th scope="col">Line</th><th scope="col" className="num">Quantity</th><th scope="col">By</th><th scope="col">Note</th></tr></thead>
            <tbody>{receipts.data.map((r) => (
              <tr key={r.id}><td>{formatDate(r.received_on)}</td><td>{r.line_no}. {r.description}</td><td className="num">{Number(r.quantity)}</td><td>{r.received_by_name ?? '—'}</td><td>{r.note ?? '—'}</td></tr>
            ))}</tbody>
          </table></TableWrap>
        </Card>
      )}
      {editing && <LineDialog po={po} line={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); all(); }} />}
      {receiving && data && <ReceiveDialog po={po} lines={data} onClose={() => setReceiving(false)} onSaved={() => { setReceiving(false); all(); }} />}
      <ConfirmDialog open={!!removing} title="Remove this line?" message={`Line ${removing?.line_no}: ${removing?.description ?? ''}`} confirmLabel="Remove" danger onConfirm={remove} onCancel={() => setRemoving(null)} />
    </div>
  );
}

function BudgetTab({ po }: { po: Row }) {
  const { data, error, reload } = useFetch<BudgetCheck[]>(`/api/purchase-orders/${po.id}/budget-check`);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={3} />;
  if (!data.length) return <EmptyState icon="chart" title="Not charged to a budget line" message="Give the order or its lines a budget line to see what is left." />;
  return (
    <Card title="Budget lines charged" flush>
      {data.some((b) => b.over) && <div className="prc-pad"><Notice tone="warning" title="Over budget">Once this order counts, at least one budget line has less than nothing left.</Notice></div>}
      <TableWrap label="Budget lines charged" fit><table className="table">
        <thead><tr>
          <th scope="col" data-priority={1}>Budget line</th><th scope="col" className="num" data-priority={2}>Budgeted</th><th scope="col" className="num" data-priority={2}>Committed</th>
          <th scope="col" className="num" data-priority={2}>Spent (paid)</th><th scope="col" className="num" data-priority={1}>This order</th><th scope="col" className="num" data-priority={1}>Left after it</th>
        </tr></thead>
        <tbody>{data.map((b) => (
          <tr key={b.id}>
            <td><Link to={`/procurement/budget-lines/${b.id}`}>{b.account ? `${b.account} ` : ''}{b.title}</Link></td>
            <td className="num">{money(b.amount)}</td><td className="num">{money(b.committed)}</td><td className="num">{money(b.spent)}</td>
            <td className="num">{money(b.this_order)}</td><td className={`num${b.over ? ' prc-over' : ''}`}>{money(b.remaining_after)}</td>
          </tr>
        ))}</tbody>
      </table></TableWrap>
    </Card>
  );
}

interface Approval { status: string; workflow: { name: string; status: string } | null; can_decide: boolean }

function OrderActions({ row, reload }: { row: Row; reload: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const approval = useFetch<Approval>(`/api/purchase-orders/${row.id}/approval`);
  const [dialog, setDialog] = useState<'reject' | 'cancel' | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { approval.reload(); }, [row.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (url: string, payload: Record<string, unknown>, done: string) => {
    setBusy(true);
    try { await api.post(url, payload); toast.success(done); setDialog(null); setText(''); reload(); approval.reload(); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const status = String(row.status);
  const edit = can('procurement.edit');
  return (
    <>
      {edit && status === 'draft' && <Button variant="primary" loading={busy} onClick={() => run(`/api/purchase-orders/${row.id}/submit`, {}, 'Sent for approval.')}>Send for approval</Button>}
      {status === 'pending_approval' && approval.data?.can_decide && <>
        <Button variant="primary" loading={busy} onClick={() => run(`/api/purchase-orders/${row.id}/decision`, { decision: 'approved' }, 'Approved.')}>Approve</Button>
        <Button loading={busy} onClick={() => setDialog('reject')}>Reject</Button>
      </>}
      {edit && status === 'approved' && <Button variant="primary" loading={busy} onClick={() => run(`/api/purchase-orders/${row.id}/issue`, {}, 'Issued to the vendor.')}>Issue to the vendor</Button>}
      {edit && ['issued', 'partially_received', 'received'].includes(status) && <Button loading={busy} onClick={() => run(`/api/purchase-orders/${row.id}/close`, {}, 'Order closed.')}>Close the order</Button>}
      {edit && ['draft', 'pending_approval', 'approved', 'issued'].includes(status) && <Button loading={busy} onClick={() => setDialog('cancel')}>Cancel the order</Button>}
      <Modal open={dialog !== null} title={dialog === 'reject' ? 'Reject this order' : 'Cancel this order'} size="sm" onClose={() => setDialog(null)} dirty={Boolean(text)}
        footer={<><Button onClick={() => setDialog(null)}>Back</Button>
          <Button variant="primary" loading={busy} disabled={!text.trim()}
            onClick={() => (dialog === 'reject' ? run(`/api/purchase-orders/${row.id}/decision`, { decision: 'rejected', comment: text }, 'Returned to draft.') : run(`/api/purchase-orders/${row.id}/cancel`, { reason: text }, 'Order canceled.'))}>
            {dialog === 'reject' ? 'Reject' : 'Cancel the order'}
          </Button></>}>
        <TextArea label={dialog === 'reject' ? 'Why it is rejected' : 'Why it is canceled'} required value={text} rows={3} onChange={setText} />
      </Modal>
    </>
  );
}

function ApprovalBanner({ row }: { row: Row }) {
  const { data } = useFetch<Approval>(`/api/purchase-orders/${row.id}/approval`);
  if (row.status !== 'pending_approval' || !data) return null;
  return (
    <Notice title="Waiting for approval">
      {data.workflow?.status === 'running' ? `The approval workflow "${data.workflow.name}" decides it.` : 'Someone who may approve purchase orders, and did not ask for this one, decides it.'}
      {data.can_decide ? ' You may decide it now.' : ''}
    </Notice>
  );
}

export function OrderDetail() {
  return (
    <RecordPage
      type="purchase_order"
      actions={({ row, reload }) => <OrderActions row={row} reload={reload} />}
      banner={({ row }) => <ApprovalBanner row={row} />}
      summaryFields={SUMMARY}
      tabs={[
        { key: 'lines', label: 'Lines', content: ({ row, reload }) => <Lines po={row} reloadRecord={reload} /> },
        { key: 'invoices', label: 'Invoices', content: ({ row }) => <OrderInvoices po={row} /> },
        { key: 'budget', label: 'Budget', content: ({ row }) => <BudgetTab po={row} /> },
      ]}
    />
  );
}

/** A line's own address (search, links) opens its order. */
export function OrderLineRedirect() {
  const { id = '' } = useParams();
  const { data, error } = useFetch<Row>(`/api/purchase-order-lines/${id}`);
  if (error) return <div className="stack"><PageHeader title="Purchase order line" /><ErrorState error={error} /></div>;
  if (!data) return <Loading lines={3} />;
  return <Navigate replace to={`/procurement/purchase-orders/${data.purchase_order_id}?tab=lines`} />;
}
