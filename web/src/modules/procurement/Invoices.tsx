// Vendor invoices against purchase orders (E46-66): the list, one invoice with its lines and their match
// with the order and what was received, approval, payment and voiding; and the order's Invoices tab (the
// three-way view of each order line and "Enter an invoice").
import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import {
  api, Button, Card, ConfirmDialog, DateField, EmptyState, ErrorState, errorMessage, formatDate, Loading, LookupChip, LookupSelect, Modal, Notice, NumberField,
  PageHeader, RecordPage, ResourceList, Select, TableWrap, TextArea, TextField, todayInZone, useAuth, useFetch, useToast, useUnsavedChanges,
} from '../../core';
import type { ColumnDef, Row } from '../../core';
import { money } from './shared';

const COLUMNS: ColumnDef[] = [
  'ref', 'invoice_number', { field: 'vendor_name', priority: 2 }, { field: 'purchase_order_id', priority: 2 }, { field: 'invoice_date', priority: 2 },
  { field: 'amount', priority: 1 }, 'status', { field: 'match_status', priority: 2 }, { field: 'due_on', priority: 3 }, { field: 'paid_on', hidden: true },
  { field: 'payment_reference', hidden: true }, { field: 'department_id', hidden: true },
];
const FILTERS = ['status', 'match_status', 'vendor_id', 'purchase_order_id', 'department_id', 'invoice_date', 'due_on', 'paid_on'];
const SUMMARY = ['invoice_number', 'purchase_order_id', 'vendor_id', 'vendor_name', 'invoice_date', 'received_on', 'due_on', 'amount', 'match_status', 'entered_by',
  'submitted_at', 'approved_by', 'approved_at', 'approval_note', 'rejected_reason', 'paid_on', 'payment_reference', 'payment_method', 'paid_by', 'voided_reason', 'notes'];

const errorFields = (err: unknown) => (err as { fields?: Record<string, string> }).fields ?? {};

export function InvoiceList() {
  return (
    <div className="stack">
      <PageHeader title="Invoices" subtitle="Vendor invoices against purchase orders: matched with the order and what was received, approved, then paid. Paid invoices are what the budget has spent. Enter an invoice from its order's Invoices tab." />
      <ResourceList type="purchase_invoice" urlState columns={COLUMNS} filters={FILTERS} />
    </div>
  );
}

// ---------- the order's Invoices tab ----------

interface OrderLine { id: string; line_no: number; description: string; quantity: number; unit_price: number; amount: number; received_quantity: number; received_value: number; invoiced_quantity: number; invoiced_amount: number; paid: number }
interface OrderInvoices {
  invoices: { id: string; ref: string; invoice_number: string; invoice_date: string; due_on: string | null; amount: number; status: string; match_status: string | null; match_note: string | null; paid_on: string | null; payment_reference: string | null }[];
  lines: OrderLine[];
  totals: { ordered: number; received: number; invoiced: number; paid: number };
  can_invoice: boolean;
}

function EnterInvoiceDialog({ po, lines, onClose, onSaved }: { po: Row; lines: OrderLine[]; onClose: () => void; onSaved: (id: string) => void }) {
  const toast = useToast();
  const [number, setNumber] = useState('');
  const [date, setDate] = useState(todayInZone());
  const [due, setDue] = useState('');
  const [notes, setNotes] = useState('');
  const [qty, setQty] = useState<Record<string, number | null>>(Object.fromEntries(lines.map((l) => [l.id, Math.max(0, l.received_quantity - l.invoiced_quantity) || null])));
  const [amount, setAmount] = useState<Record<string, number | null>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const dirty = Boolean(number || notes);
  const unsaved = useUnsavedChanges(dirty);
  const lineAmount = (l: OrderLine) => amount[l.id] ?? ((qty[l.id] ?? 0) * l.unit_price);
  const total = lines.reduce((s, l) => s + (qty[l.id] || amount[l.id] ? lineAmount(l) : 0), 0);
  const save = async () => {
    setBusy(true); setErrors({});
    try {
      const inv = await api.post<Row>(`/api/purchase-orders/${po.id}/invoices`, {
        invoice_number: number, invoice_date: date, due_on: due || null, notes,
        lines: lines.filter((l) => qty[l.id] || amount[l.id]).map((l) => ({ line_id: l.id, quantity: qty[l.id] ?? null, amount: amount[l.id] ?? null })),
      });
      unsaved.release();
      toast.success('Invoice entered.');
      onSaved(String(inv.id));
    } catch (err) { setErrors(errorFields(err)); toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal open title="Enter an invoice" size="lg" onClose={onClose} dirty={dirty}
      footer={<><Button onClick={unsaved.guard(onClose)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!number.trim() || !date || total <= 0} onClick={save}>Enter the invoice</Button></>}>
      <div className="stack">
        <div className="prc-two">
          <TextField label="Invoice number" required value={number} error={errors.invoice_number} onChange={setNumber} hint="The vendor's own number, as printed." />
          <DateField label="Invoice date" required value={date} error={errors.invoice_date} onChange={setDate} />
          <DateField label="Payment due" value={due} error={errors.due_on} onChange={setDue} />
        </div>
        <TableWrap label="What the invoice bills"><table className="table">
          <thead><tr>
            <th scope="col">Order line</th><th scope="col" className="num">Received</th><th scope="col" className="num">Already invoiced</th>
            <th scope="col">Quantity invoiced</th><th scope="col">Or an amount</th>
          </tr></thead>
          <tbody>{lines.map((l) => (
            <tr key={l.id}>
              <td>{l.line_no}. {l.description}<div className="muted prc-small">{l.quantity} at {money(l.unit_price)}</div></td>
              <td className="num">{l.received_quantity}</td>
              <td className="num">{l.invoiced_quantity || money(l.invoiced_amount)}</td>
              <td><div className="prc-score"><NumberField label={`Quantity invoiced, line ${l.line_no}`} hideLabel min={0} value={qty[l.id] ?? null} onChange={(v) => setQty((x) => ({ ...x, [l.id]: v }))} /></div></td>
              <td><div className="prc-score"><NumberField label={`Amount invoiced, line ${l.line_no}`} hideLabel min={0} decimals={2} thousands placeholder={qty[l.id] ? money((qty[l.id] ?? 0) * l.unit_price) : ''} value={amount[l.id] ?? null} onChange={(v) => setAmount((x) => ({ ...x, [l.id]: v }))} /></div></td>
            </tr>
          ))}</tbody>
        </table></TableWrap>
        {errors.lines && <Notice tone="error">{errors.lines}</Notice>}
        <p className="muted">Total: <strong>{money(total)}</strong>. Give the quantity billed (at the order's price unless you give the amount), or only an amount for a service billed as a sum. The invoice is matched with the order and what was received when it is entered.</p>
        <TextArea label="Notes" value={notes} rows={2} onChange={setNotes} />
      </div>
    </Modal>
  );
}

export function OrderInvoices({ po }: { po: Row }) {
  const { can } = useAuth();
  const { data, error, reload } = useFetch<OrderInvoices>(`/api/purchase-orders/${po.id}/invoices`);
  const [entering, setEntering] = useState(false);
  const [made, setMade] = useState<string | null>(null);
  if (made) return <Navigate to={`/procurement/invoices/${made}`} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={4} />;
  const t = data.totals;
  return (
    <div className="stack">
      <Card title="Ordered, received, invoiced and paid" flush
        actions={can('procurement.create') && data.can_invoice && data.lines.length > 0 && <Button size="sm" variant="primary" icon="plus" onClick={() => setEntering(true)}>Enter an invoice</Button>}>
        {!data.can_invoice && <div className="prc-pad"><p className="muted">Invoices are entered once the order is issued to the vendor.</p></div>}
        {data.lines.length === 0 ? <EmptyState icon="box" title="No lines yet" /> : (
          <TableWrap label="Ordered, received, invoiced and paid by line" fit><table className="table">
            <thead><tr>
              <th scope="col" data-priority={1}>Line</th><th scope="col" className="num" data-priority={2}>Ordered</th><th scope="col" className="num" data-priority={1}>Received</th>
              <th scope="col" className="num" data-priority={1}>Invoiced</th><th scope="col" className="num" data-priority={1}>Paid</th>
            </tr></thead>
            <tbody>{data.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.line_no}. {l.description}</td>
                <td className="num">{l.quantity} · {money(l.amount)}</td>
                <td className="num">{l.received_quantity} · {money(l.received_value)}</td>
                <td className={`num${l.invoiced_amount > l.received_value + 0.005 ? ' prc-over' : ''}`}>{l.invoiced_quantity ? `${l.invoiced_quantity} · ` : ''}{money(l.invoiced_amount)}</td>
                <td className="num">{money(l.paid)}</td>
              </tr>
            ))}</tbody>
            <tfoot><tr><th scope="row">Total</th><td className="num">{money(t.ordered)}</td><td className="num">{money(t.received)}</td><td className="num">{money(t.invoiced)}</td><td className="num"><strong>{money(t.paid)}</strong></td></tr></tfoot>
          </table></TableWrap>
        )}
        <p className="muted prc-pad prc-small">Invoiced counts invoices sent for approval, approved or paid. What is not yet paid stays committed against the budget until the order is closed.</p>
      </Card>
      <Card title="Invoices" flush>
        {data.invoices.length === 0 ? <EmptyState icon="file-text" title="No invoices yet" message="Enter the vendor's invoice when it arrives: it is matched with this order and what was received." /> : (
          <TableWrap label="Invoices of this order" fit><table className="table">
            <thead><tr>
              <th scope="col" data-priority={1}>Invoice</th><th scope="col" data-priority={2}>Date</th><th scope="col" className="num" data-priority={1}>Amount</th>
              <th scope="col" data-priority={1}>Status</th><th scope="col" data-priority={2}>Match</th><th scope="col" data-priority={3}>Paid</th>
            </tr></thead>
            <tbody>{data.invoices.map((i) => (
              <tr key={i.id}>
                <td><Link to={`/procurement/invoices/${i.id}`}><span className="ref">{i.ref}</span> {i.invoice_number}</Link></td>
                <td>{formatDate(i.invoice_date)}</td><td className="num">{money(i.amount)}</td>
                <td><LookupChip list="invoice_status" value={i.status} /></td>
                <td>{i.match_status ? <LookupChip list="invoice_match" value={i.match_status} /> : '—'}</td>
                <td>{i.paid_on ? `${formatDate(i.paid_on)}${i.payment_reference ? ` · ${i.payment_reference}` : ''}` : '—'}</td>
              </tr>
            ))}</tbody>
          </table></TableWrap>
        )}
      </Card>
      {entering && <EnterInvoiceDialog po={po} lines={data.lines} onClose={() => setEntering(false)} onSaved={(id) => { setEntering(false); setMade(id); }} />}
    </div>
  );
}

// ---------- one invoice ----------

interface InvoiceLine { id: string; po_line_id: string; line_no: number; description: string; quantity: number | null; unit_price: number | null; amount: number; ordered: number; order_price: number; received_quantity: number; match_status: string | null; match_note: string | null }
interface PoLine { id: string; line_no: number; description: string; quantity: number; unit_price: number; received_quantity: number }

function AddLineDialog({ inv, onClose, onSaved }: { inv: Row; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { data } = useFetch<PoLine[]>(`/api/purchase-orders/${inv.purchase_order_id}/lines`);
  const [line, setLine] = useState('');
  const [qty, setQty] = useState<number | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErrors({});
    try {
      await api.post('/api/purchase-invoice-lines', { invoice_id: inv.id, po_line_id: line, quantity: qty, unit_price: price, amount });
      toast.success('Line added.'); onSaved();
    } catch (err) { setErrors(errorFields(err)); toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal open title="Add a line" onClose={onClose} dirty={Boolean(line)}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!line || (!qty && !amount)} onClick={save}>Add the line</Button></>}>
      <div className="stack">
        <Select label="Order line" required value={line} error={errors.po_line_id} onChange={setLine}
          options={(data ?? []).map((l) => ({ value: l.id, label: `${l.line_no}. ${l.description} (${l.received_quantity} of ${l.quantity} received, ${money(l.unit_price)} each)` }))} />
        <div className="prc-two">
          <NumberField label="Quantity invoiced" min={0} value={qty} error={errors.quantity} onChange={setQty} hint="Empty for an amount only." />
          <NumberField label="Unit price" min={0} decimals={2} thousands value={price} error={errors.unit_price} onChange={setPrice} hint="The order's price when empty." />
          <NumberField label="Amount" min={0} decimals={2} thousands value={amount} error={errors.amount} onChange={setAmount} hint="Quantity times price when empty." />
        </div>
      </div>
    </Modal>
  );
}

function InvoiceLines({ inv, reloadRecord }: { inv: Row; reloadRecord: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<InvoiceLine[]>(`/api/purchase-invoices/${inv.id}/lines`);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<InvoiceLine | null>(null);
  const draft = inv.status === 'draft' && can('procurement.edit');
  const all = () => { reload(); reloadRecord(); };
  const remove = async () => {
    const l = removing!; setRemoving(null);
    try { await api.del(`/api/purchase-invoice-lines/${l.id}`); toast.success('Line removed.'); all(); } catch (err) { toast.error(errorMessage(err)); }
  };
  return (
    <Card title="Lines and their match" flush actions={draft && <Button size="sm" icon="plus" onClick={() => setAdding(true)}>Add a line</Button>}>
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <div className="prc-pad"><Loading lines={3} /></div>
        : data.length === 0 ? <EmptyState icon="file-text" title="No lines yet" message="Add what the invoice bills against the order's lines." /> : (
          <TableWrap label="Invoice lines" fit><table className="table prc-wrap">
            <thead><tr>
              <th scope="col" data-priority={1}>Order line</th><th scope="col" className="num" data-priority={2}>Ordered</th><th scope="col" className="num" data-priority={2}>Received</th>
              <th scope="col" className="num" data-priority={1}>Invoiced</th><th scope="col" className="num" data-priority={1}>Amount</th><th scope="col" data-priority={1}>Match</th>
              {draft && <th scope="col" data-priority={1}><span className="sr-only">Actions</span></th>}
            </tr></thead>
            <tbody>{data.map((l) => (
              <tr key={l.id}>
                <td>{l.line_no}. {l.description}</td>
                <td className="num">{l.ordered} at {money(l.order_price)}</td>
                <td className="num">{l.received_quantity}</td>
                <td className="num">{l.quantity === null ? 'Amount only' : `${l.quantity} at ${money(l.unit_price)}`}</td>
                <td className="num">{money(l.amount)}</td>
                <td>{l.match_status ? <LookupChip list="invoice_match" value={l.match_status} /> : '—'}{l.match_note && <div className="muted prc-small">{l.match_note}</div>}</td>
                {draft && <td className="prc-actions"><Button size="sm" variant="ghost" aria-label={`Remove line ${l.line_no}`} onClick={() => setRemoving(l)}>Remove</Button></td>}
              </tr>
            ))}</tbody>
            <tfoot><tr><th scope="row" colSpan={4}>Total</th><td className="num"><strong>{money(inv.amount)}</strong></td><td colSpan={draft ? 2 : 1} /></tr></tfoot>
          </table></TableWrap>
        )}
      {adding && <AddLineDialog inv={inv} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); all(); }} />}
      <ConfirmDialog open={!!removing} title="Remove this line?" message={`Line ${removing?.line_no}: ${removing?.description ?? ''}`} confirmLabel="Remove" danger onConfirm={remove} onCancel={() => setRemoving(null)} />
    </Card>
  );
}

interface Approval { status: string; match_status: string | null; workflow: { name: string; status: string } | null; can_decide: boolean }

function InvoiceActions({ row, reload }: { row: Row; reload: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const approval = useFetch<Approval>(`/api/purchase-invoices/${row.id}/approval`);
  const [dialog, setDialog] = useState<'approve' | 'reject' | 'void' | 'pay' | null>(null);
  const [text, setText] = useState('');
  const [paidOn, setPaidOn] = useState(todayInZone());
  const [reference, setReference] = useState('');
  const [method, setMethod] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { approval.reload(); }, [row.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (url: string, payload: Record<string, unknown>, done: string) => {
    setBusy(true); setErrors({});
    try { await api.post(url, payload); toast.success(done); setDialog(null); setText(''); reload(); approval.reload(); }
    catch (err) { setErrors(errorFields(err)); toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const status = String(row.status);
  const edit = can('procurement.edit');
  const exception = row.match_status === 'exception';
  const close = () => { setDialog(null); setErrors({}); };
  return (
    <>
      {edit && status === 'draft' && <Button variant="primary" loading={busy} onClick={() => run(`/api/purchase-invoices/${row.id}/submit`, {}, 'Sent for approval.')}>Send for approval</Button>}
      {status === 'pending_approval' && approval.data?.can_decide && <>
        <Button variant="primary" loading={busy} onClick={() => (exception ? setDialog('approve') : run(`/api/purchase-invoices/${row.id}/decision`, { decision: 'approved' }, 'Approved for payment.'))}>Approve for payment</Button>
        <Button loading={busy} onClick={() => setDialog('reject')}>Return</Button>
      </>}
      {edit && status === 'approved' && <Button variant="primary" loading={busy} onClick={() => setDialog('pay')}>Record the payment</Button>}
      {edit && ['draft', 'pending_approval', 'approved'].includes(status) && <Button loading={busy} onClick={() => setDialog('void')}>Void</Button>}
      <Modal open={dialog === 'approve' || dialog === 'reject' || dialog === 'void'} size="sm" onClose={close} dirty={Boolean(text)}
        title={dialog === 'approve' ? 'Approve an invoice that does not match' : dialog === 'reject' ? 'Return this invoice' : 'Void this invoice'}
        footer={<><Button onClick={close}>Back</Button>
          <Button variant="primary" loading={busy} disabled={!text.trim()}
            onClick={() => (dialog === 'void' ? run(`/api/purchase-invoices/${row.id}/void`, { reason: text }, 'Invoice voided.')
              : run(`/api/purchase-invoices/${row.id}/decision`, { decision: dialog === 'approve' ? 'approved' : 'rejected', comment: text }, dialog === 'approve' ? 'Approved for payment.' : 'Returned.'))}>
            {dialog === 'approve' ? 'Approve for payment' : dialog === 'reject' ? 'Return' : 'Void'}
          </Button></>}>
        <div className="stack">
          {dialog === 'approve' && <Notice tone="warning">{String(row.match_note ?? 'The invoice bills more than was received, or above the order\'s price.')}</Notice>}
          <TextArea label={dialog === 'approve' ? 'Why it is approved anyway' : dialog === 'reject' ? 'Why it is returned' : 'Why it is voided'} required value={text} rows={3}
            error={errors.comment ?? errors.reason} onChange={setText} hint={dialog === 'void' ? 'For example a duplicate, or replaced by a corrected invoice.' : undefined} />
        </div>
      </Modal>
      <Modal open={dialog === 'pay'} title="Record the payment" size="sm" onClose={close} dirty={Boolean(reference)}
        footer={<><Button onClick={close}>Back</Button>
          <Button variant="primary" loading={busy} disabled={!reference.trim() || !paidOn}
            onClick={() => run(`/api/purchase-invoices/${row.id}/payment`, { paid_on: paidOn, payment_reference: reference, payment_method: method || null }, 'Payment recorded.')}>Record the payment</Button></>}>
        <div className="stack">
          <DateField label="Paid on" required value={paidOn} error={errors.paid_on} onChange={setPaidOn} />
          <TextField label="Payment reference" required value={reference} error={errors.payment_reference} onChange={setReference} hint="The check number, transfer or payment batch reference." />
          <LookupSelect label="Paid by" list="payment_method" value={method} error={errors.payment_method} placeholder="Choose how it was paid" onChange={setMethod} />
          <p className="muted">{money(row.amount)} counts as spent on the budget lines of the order's lines.</p>
        </div>
      </Modal>
    </>
  );
}

function InvoiceBanner({ row }: { row: Row }) {
  const { data } = useFetch<Approval>(`/api/purchase-invoices/${row.id}/approval`);
  return (
    <>
      {row.match_status === 'exception' && ['draft', 'pending_approval'].includes(String(row.status)) && (
        <Notice tone="warning" title="Does not match the order and what was received">{String(row.match_note ?? '')}</Notice>
      )}
      {row.status === 'pending_approval' && data && (
        <Notice title="Waiting for approval">
          {data.workflow?.status === 'running' ? `The approval workflow "${data.workflow.name}" decides it.` : 'Someone who may approve in procurement, and did not enter this invoice, decides it.'}
          {data.can_decide ? ' You may decide it now.' : ''}
        </Notice>
      )}
    </>
  );
}

export function InvoiceDetail() {
  return (
    <RecordPage
      type="purchase_invoice"
      title={(row) => `Invoice ${row.invoice_number ?? ''}`}
      actions={({ row, reload }) => <InvoiceActions row={row} reload={reload} />}
      banner={({ row }) => <InvoiceBanner row={row} />}
      summaryFields={SUMMARY}
      tabs={[{ key: 'lines', label: 'Lines', content: ({ row, reload }) => <InvoiceLines inv={row} reloadRecord={reload} /> }]}
    />
  );
}

/** An invoice line's own address (search, links) opens its invoice. */
export function InvoiceLineRedirect() {
  const { id = '' } = useParams();
  const { data, error } = useFetch<Row>(`/api/purchase-invoice-lines/${id}`);
  if (error) return <div className="stack"><PageHeader title="Invoice line" /><ErrorState error={error} /></div>;
  if (!data) return <Loading lines={3} />;
  return <Navigate replace to={`/procurement/invoices/${data.invoice_id}?tab=lines`} />;
}
