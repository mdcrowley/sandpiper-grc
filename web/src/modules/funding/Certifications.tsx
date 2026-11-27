// Yearly certifications: the list, and one certification with its checklist and sign-off.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  api, Button, Card, Checkbox, ConfirmDialog, EmptyState, ErrorState, errorMessage, formatDate, Loading, LookupChip, LookupSelect, Modal,
  PageHeader, ProgressBar, RecordPage, ResourceList, Select, Stepper, TableWrap, TextArea, useAuth, useFetch, UserPicker, useToast, useUnsavedChanges,
} from '../../core';
import type { RecordContext, Row } from '../../core';
import { FundingTabs, ofText } from './shared';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The month from which next year's drafts are made (funding.administer). */
function DraftMonth() {
  const toast = useToast();
  const { data, reload } = useFetch<{ certification_month: number }>('/api/funding/settings');
  const [month, setMonth] = useState('');
  const [busy, setBusy] = useState(false);
  const current = data ? String(data.certification_month) : '';
  const save = async () => {
    setBusy(true);
    try {
      await api.put('/api/funding/settings', { certification_month: Number(month) });
      toast.success('Saved.'); setMonth(''); reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  if (!data) return null;
  return (
    <Card title="Next year's drafts">
      <div className="fd-inline">
        <Select label="Made each year from" required value={month || current} options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
          onChange={setMonth} hint="Every day from this month on, each certification without a draft for the coming year gets one, copied from the newest." />
        <Button variant="primary" loading={busy} disabled={!month || month === current} onClick={save}>Save</Button>
      </div>
    </Card>
  );
}

export function CertificationList() {
  const { can } = useAuth();
  return (
    <div className="stack">
      <PageHeader title="Yearly certifications" subtitle="The statements the organization certifies to a funder each year, each confirmed by its owner before the authorized official signs." />
      <FundingTabs active="certifications" />
      <ResourceList
        type="funding_certification"
        urlState
        columns={['ref', 'year', 'title', 'funder_name', 'status', 'due_on', 'signer_id', 'signed_on']}
        filters={['status', 'signer_id', 'due_on']}
        createFields={['year', 'title', 'funder_name', 'due_on', 'signer_id', 'notes']}
        createInitial={{ year: String(new Date().getFullYear()) }}
        bulkFields={[]}
      />
      {can('funding.administer') && <DraftMonth />}
    </div>
  );
}

const STEPS = [
  { key: 'draft', label: 'Checklist' },
  { key: 'in_review', label: 'Waiting for signature' },
  { key: 'signed', label: 'Signed' },
  { key: 'submitted', label: 'Submitted' },
];

interface Item {
  id: string; category: string | null; statement: string; applies: boolean; responsible_id: string | null; responsible_name: string | null;
  confirmed_by: string | null; confirmed_by_name: string | null; confirmed_on: string | null; note: string | null; sort: number;
}
interface Items { items: Item[]; applicable: number; confirmed: number }

function ItemDialog({ certId, item, onClose, onSaved }: { certId: string; item: Item | 'new'; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const start = item === 'new' ? null : item;
  const [statement, setStatement] = useState(start?.statement ?? '');
  const [category, setCategory] = useState(start?.category ?? '');
  const [responsible, setResponsible] = useState<string | null>(start?.responsible_id ?? null);
  const [applies, setApplies] = useState(start?.applies ?? true);
  const [note, setNote] = useState(start?.note ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const dirty = statement !== (start?.statement ?? '') || category !== (start?.category ?? '') || responsible !== (start?.responsible_id ?? null)
    || applies !== (start?.applies ?? true) || note !== (start?.note ?? '');
  const unsaved = useUnsavedChanges(dirty);
  const save = async () => {
    setBusy(true); setErrors({});
    const body = { statement, category: category || null, responsible_id: responsible, applies, note };
    try {
      if (start) await api.patch(`/api/funding-certifications/${certId}/items/${start.id}`, body);
      else await api.post(`/api/funding-certifications/${certId}/items`, body);
      unsaved.release();
      toast.success(start ? 'Item saved.' : 'Item added.');
      onSaved();
    } catch (err) {
      setErrors((err as { fields?: Record<string, string> }).fields ?? {});
      toast.error(errorMessage(err));
    } finally { setBusy(false); }
  };
  return (
    <Modal open title={start ? 'Edit item' : 'Add an item'} onClose={onClose} dirty={dirty}
      footer={<><Button onClick={unsaved.guard(onClose)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!statement.trim()} onClick={save}>{start ? 'Save' : 'Add'}</Button></>}>
      <div className="stack">
        <TextArea label="Statement" required value={statement} onChange={setStatement} error={errors.statement} rows={3}
          hint="What the organization certifies, in the funder's words or your own." />
        <div className="form-grid">
          <LookupSelect label="Category" list="funding_certification_category" value={category} onChange={setCategory} error={errors.category} />
          <UserPicker label="Responsible" value={responsible} display={start?.responsible_name ?? undefined} onChange={(id) => setResponsible(id)} error={errors.responsible_id}
            hint="Confirms the item before signing." />
        </div>
        <Checkbox label="Applies to the organization this year" checked={applies} onChange={setApplies}
          hint="An item that does not apply needs no confirmation." />
        <TextArea label="Note" value={note} onChange={setNote} rows={2} />
      </div>
    </Modal>
  );
}

function Checklist({ row, canEdit, reloadRecord }: { row: Row; canEdit: boolean; reloadRecord: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<Items>(`/api/funding-certifications/${row.id}/items`);
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const [removing, setRemoving] = useState<Item | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const draft = row.status === 'draft';

  const confirm = async (item: Item, confirmed: boolean) => {
    setBusy(item.id);
    try {
      await api.post(`/api/funding-certifications/${row.id}/items/${item.id}/confirm`, { confirmed });
      toast.success(confirmed ? 'Confirmed.' : 'Confirmation withdrawn.');
      reload(); reloadRecord();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(null); }
  };
  const remove = async () => {
    if (!removing) return;
    setBusy(removing.id);
    try {
      await api.del(`/api/funding-certifications/${row.id}/items/${removing.id}`);
      toast.success('Item removed.'); setRemoving(null); reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(null); }
  };

  return (
    <Card title="Checklist" flush actions={canEdit && draft && <Button size="sm" icon="plus" onClick={() => setEditing('new')}>Add an item</Button>}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <div className="fd-pad"><Loading lines={5} /></div>
        : data.items.length === 0 ? (
          <EmptyState icon="check" title="No statements yet" message="Add the statements the authorized official certifies, and who confirms each one."
            action={canEdit && draft ? <Button variant="primary" onClick={() => setEditing('new')}>Add an item</Button> : undefined} />
        ) : (
          <>
            <div className="fd-pad">
              <ProgressBar label="Applicable items confirmed" value={data.confirmed} max={Math.max(data.applicable, 1)}
                color={data.confirmed === data.applicable ? 'green' : 'blue'} valueText={ofText(data.confirmed, data.applicable)} />
            </div>
            <TableWrap label="Statements of this certification">
              <table className="table fd-checklist">
                <caption className="sr-only">Statements of this certification</caption>
                <thead><tr><th scope="col">Statement</th><th scope="col">Category</th><th scope="col">Responsible</th><th scope="col">Confirmation</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {data.items.map((i) => {
                    const mine = i.responsible_id === user?.id;
                    const mayConfirm = draft && i.applies && (mine || canEdit);
                    return (
                      <tr key={i.id} className={i.applies ? undefined : 'fd-na'}>
                        <td>
                          <span className="fd-statement">{i.statement}</span>
                          {i.note && <span className="muted fd-small fd-block">{i.note}</span>}
                        </td>
                        <td>{i.category ? <LookupChip list="funding_certification_category" value={i.category} /> : '—'}</td>
                        <td>{i.responsible_name ?? <span className="muted">No one</span>}</td>
                        <td>
                          {!i.applies ? <span className="muted">Does not apply</span>
                            : i.confirmed_on ? <span>{i.confirmed_by_name ? `Confirmed by ${i.confirmed_by_name}` : 'Confirmed (imported, no user recorded)'}, {formatDate(i.confirmed_on)}</span>
                            : <span className="fd-todo">Not confirmed</span>}
                        </td>
                        <td className="fd-actions">
                          {mayConfirm && !i.confirmed_on && <Button size="sm" variant="primary" aria-label={`Confirm: ${i.statement}`} loading={busy === i.id} onClick={() => confirm(i, true)}>Confirm</Button>}
                          {mayConfirm && i.confirmed_on && <Button size="sm" variant="ghost" aria-label={`Withdraw: ${i.statement}`} loading={busy === i.id} onClick={() => confirm(i, false)}>Withdraw</Button>}
                          {canEdit && draft && <Button size="sm" variant="ghost" aria-label={`Edit: ${i.statement}`} onClick={() => setEditing(i)}>Edit</Button>}
                          {canEdit && draft && <Button size="sm" variant="ghost" aria-label={`Remove: ${i.statement}`} onClick={() => setRemoving(i)}>Remove</Button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          </>
        )}
      {editing && <ItemDialog certId={row.id} item={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); reloadRecord(); }} />}
      <ConfirmDialog open={!!removing} title="Remove this item?" message="The statement is taken off this year's checklist."
        confirmLabel="Remove" danger busy={!!busy} onConfirm={remove} onCancel={() => setRemoving(null)} />
    </Card>
  );
}

function Actions({ row, canEdit, reload, save }: RecordContext) {
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const sign = async () => {
    setBusy(true);
    try {
      await api.post(`/api/funding-certifications/${row.id}/sign-request`, { note });
      toast.success('Sent to the authorized official for signing.');
      setAsking(false); setNote(''); reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const copy = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ id: string; created: boolean }>(`/api/funding-certifications/${row.id}/copy-forward`);
      toast.success(r.created ? 'Next year\'s draft made.' : 'Next year\'s certification is already there.');
      navigate(`/funding/certifications/${r.id}`);
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const submitted = async () => {
    setBusy(true);
    try { await save({ status: 'submitted' }); toast.success('Marked as submitted to the funder.'); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <>
      {can('funding.create') && <Button loading={busy && !asking} onClick={copy}>Copy to next year</Button>}
      {canEdit && row.status === 'signed' && <Button loading={busy} onClick={submitted}>Mark as submitted</Button>}
      {canEdit && row.status === 'draft' && <Button variant="primary" onClick={() => setAsking(true)}>Send for signing</Button>}
      <Modal open={asking} title="Send for signing" size="sm" onClose={() => setAsking(false)} dirty={asking && note.trim() !== ''}
        footer={<><Button onClick={() => setAsking(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={sign}>Send</Button></>}>
        <div className="stack">
          <p>{row._display?.signer_id ?? 'The authorized official'} is asked to sign. Every applicable item must be confirmed first.</p>
          <TextArea label="Note to the signer" value={note} onChange={setNote} rows={3} />
        </div>
      </Modal>
    </>
  );
}

export function CertificationDetail() {
  return (
    <RecordPage
      type="funding_certification"
      breadcrumbs={[{ label: 'Funding', to: '/funding' }, { label: 'Certifications', to: '/funding/certifications' }]}
      subtitle={(row) => `${row.year}${row.funder_name ? ` · ${row.funder_name}` : ''}${row.due_on ? ` · due ${formatDate(row.due_on)}` : ''}`}
      banner={({ row }) => <Stepper label="Progress" current={row.status} steps={STEPS} />}
      actions={(rec) => <Actions {...rec} />}
      summaryFields={['year', 'title', 'funder_name', 'due_on', 'signer_id', 'signed_on', 'notes']}
      tabs={[{ key: 'checklist', label: 'Checklist', content: ({ row, canEdit, reload }) => <Checklist row={row} canEdit={canEdit} reloadRecord={reload} /> }]}
    />
  );
}
