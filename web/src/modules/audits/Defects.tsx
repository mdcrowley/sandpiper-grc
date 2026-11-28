// Defects (wave 26, E46): something wrong found on a vehicle, site or asset, raised by hand or from a
// checklist item not met. Open, then deferred or its repair ordered, then repaired, and verified by
// someone other than the person who repaired it. The vehicle, site and asset pages show them in their
// "Inspections and defects" panel (InventoryPanel.tsx).
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  api, Button, Checkbox, DateField, errorMessage, LookupSelect, Modal, Notice, PageHeader, RecordPage, ResourceList, TextArea, TextField,
  todayInZone, useAuth, UserPicker, useToast,
} from '../../core';
import type { RecordContext, Row } from '../../core';
import { InspectionTabs, TargetPicker } from './shared';

const VIEWS = [
  { key: 'open', label: 'Open', filter: { status: 'open,deferred,repair_ordered' } },
  { key: 'verify', label: 'Repaired, to verify', filter: { status: 'repaired' } },
  { key: 'out', label: 'Out of service', filter: { status: 'open,deferred,repair_ordered', out_of_service: 'true' } },
  { key: 'all', label: 'All defects', filter: {} as Record<string, string> },
];

/** A new defect on a vehicle, site or asset (`initial` fills the record it is on). */
export function NewDefectDialog({ open, onClose, initial, onCreated }: {
  open: boolean; onClose: () => void; initial?: { target_type: string; target_id: string; inspection_id?: string }; onCreated?: (row: Row) => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const { areaOn } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [target, setTarget] = useState<{ type: string; id: string | null }>({ type: initial?.target_type ?? '', id: initial?.target_id ?? null });
  const [severity, setSeverity] = useState('minor');
  const [out, setOut] = useState(false);
  const [owner, setOwner] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setErrors({});
    try {
      const row = await api.post<Row>('/api/defects', {
        title, description: description || null, target_type: target.type || null, target_id: target.id, severity,
        out_of_service: severity === 'safety_critical' ? true : out, owner_id: owner, inspection_id: initial?.inspection_id ?? null,
      });
      toast.success(row.out_of_service ? 'Defect raised. It keeps the record out of service until it is repaired.' : 'Defect raised.');
      onClose();
      if (onCreated) onCreated(row); else navigate(`/inspections/defects/${row.id}`);
    } catch (err) {
      const fields = (err as { fields?: Record<string, string> }).fields;
      if (fields) setErrors(fields);
      toast.error(errorMessage(err));
    } finally { setBusy(false); }
  };
  return (
    <Modal open={open} title="New defect" onClose={onClose} dirty={Boolean(title || description)}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!title.trim()} onClick={submit}>Raise defect</Button></>}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="form-grid">
          <div className="form-cell-wide"><TextField label="Defect" value={title} onChange={setTitle} required error={errors.title} /></div>
          {!initial && <TargetPicker type={target.type} id={target.id} kinds={['vehicle', 'site', 'asset']} kindLabel="On" onChange={(type, id) => setTarget({ type, id })} />}
          {(errors.target_type || errors.target_id) && <p className="field-error form-cell-wide">{errors.target_type ?? errors.target_id}</p>}
          <LookupSelect label="Severity" list="defect_severity" value={severity} onChange={setSeverity} required />
          <UserPicker label="Owner" value={owner} onChange={(id) => setOwner(id)} />
          <div className="form-cell-wide">
            <Checkbox label="Takes it out of service until repaired" checked={severity === 'safety_critical' || out} disabled={severity === 'safety_critical'} onChange={setOut}
              hint={`A critical defect always does.${areaOn('fleet') ? ' On a vehicle, the vehicle is marked out of service.' : ''}`} />
          </div>
          <div className="form-cell-wide"><TextArea label="Description" value={description} onChange={setDescription} /></div>
        </div>
      </form>
    </Modal>
  );
}

export function DefectList() {
  const { can, areaOn } = useAuth();
  const [params, setParams] = useSearchParams();
  const view = VIEWS.find((v) => v.key === params.get('view')) ?? VIEWS[0];
  const [adding, setAdding] = useState(params.get('new') === '1');
  const close = () => { setAdding(false); if (params.get('new')) { params.delete('new'); setParams(params, { replace: true }); } };
  return (
    <div className="stack">
      <PageHeader title="Defects" subtitle={`Defects found on ${areaOn('fleet') ? 'vehicles, sites and equipment' : 'sites and equipment'}, by hand or at an inspection, until their repair is verified.`}
        actions={can('audits.create') ? <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>New defect</Button> : undefined} />
      <InspectionTabs active="defects" />
      <nav className="au-views" aria-label="Which defects to show">
        {VIEWS.map((v) => (
          <Link key={v.key} className={`btn btn-sm ${v.key === view.key ? 'btn-primary' : 'btn-secondary'}`} aria-current={v.key === view.key ? 'page' : undefined}
            to={v.key === 'open' ? '/inspections/defects' : `/inspections/defects?view=${v.key}`}>{v.label}</Link>
        ))}
      </nav>
      <ResourceList key={view.key} type="defect" urlState baseFilter={view.filter}
        defaultSort={view.key === 'all' ? undefined : { field: 'found_on', dir: 'asc' }}
        columns={['ref', 'title', { field: 'target_label', priority: 1 }, 'severity', 'out_of_service', 'status', 'found_on', 'deferred_until', 'owner_id',
          { field: 'work_order_ref', hidden: true }, { field: 'inspection_id', hidden: true }, { field: 'repaired_on', hidden: true }, { field: 'verified_on', hidden: true }]}
        filters={['status', 'severity', 'out_of_service', 'target_type', 'owner_id', 'found_on', 'deferred_until']} />
      {adding && <NewDefectDialog open onClose={close} />}
    </div>
  );
}

type Step = 'defer' | 'order' | 'repaired' | 'verify' | 'reopen' | 'cancel';
const STEP_TITLE: Record<Step, string> = {
  defer: 'Defer the repair', order: 'Order the repair', repaired: 'Mark as repaired', verify: 'Verify the repair', reopen: 'Reopen the defect', cancel: 'Cancel the defect',
};

function StepDialog({ step, rec, onClose }: { step: Step; rec: RecordContext; onClose: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState(rec.row.deferral_reason ?? '');
  const [until, setUntil] = useState(rec.row.deferred_until ?? '');
  const [order, setOrder] = useState(rec.row.work_order_ref ?? '');
  const [on, setOn] = useState(todayInZone());
  const [notes, setNotes] = useState(rec.row.repair_notes ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const patch = (): Record<string, unknown> => {
    switch (step) {
      case 'defer': return { status: 'deferred', deferral_reason: reason, deferred_until: until || null };
      case 'order': return { status: 'repair_ordered', work_order_ref: order || null };
      case 'repaired': return { status: 'repaired', repaired_on: on || null, repair_notes: notes || null, ...(order ? { work_order_ref: order } : {}) };
      case 'verify': return { status: 'verified' };
      case 'reopen': return { status: 'open' };
      default: return { status: 'canceled' };
    }
  };
  const submit = async () => {
    setBusy(true);
    setErrors({});
    try {
      await rec.save(patch());
      toast.success(`${STEP_TITLE[step]}: done.`);
      onClose();
    } catch (err) {
      const fields = (err as { fields?: Record<string, string> }).fields;
      if (fields) setErrors(fields);
      toast.error(errorMessage(err));
    } finally { setBusy(false); }
  };
  return (
    <Modal open title={STEP_TITLE[step]} onClose={onClose}
      footer={<><Button onClick={onClose}>Back</Button><Button variant="primary" loading={busy} onClick={submit}>{STEP_TITLE[step]}</Button></>}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {errors.status && <Notice tone="error">{errors.status}</Notice>}
        {step === 'defer' && <>
          <TextArea label="Why the repair can wait" value={reason} onChange={setReason} required error={errors.deferral_reason} />
          <DateField label="Repair by" value={until} onChange={setUntil} required error={errors.deferred_until} />
        </>}
        {(step === 'order' || step === 'repaired') && <TextField label="Work order" value={order} onChange={setOrder} hint="The work order number in the maintenance system." />}
        {step === 'repaired' && <>
          <DateField label="Repaired on" value={on} onChange={setOn} error={errors.repaired_on} />
          <TextArea label="Repair notes" value={notes} onChange={setNotes} />
        </>}
        {step === 'verify' && <p>Confirm that you checked the repair and it holds. Someone other than the person who repaired it verifies it.</p>}
        {step === 'reopen' && <p>The defect becomes open again{rec.row.status === 'repaired' ? ' and the repair is cleared' : ''}.</p>}
        {step === 'cancel' && <p>Cancel a defect raised by mistake. It stays in the history.</p>}
      </form>
    </Modal>
  );
}

function DefectActions(rec: RecordContext) {
  const [step, setStep] = useState<Step | null>(null);
  if (!rec.canEdit) return null;
  const s = String(rec.row.status ?? 'open');
  const moves: { step: Step; primary?: boolean }[] = [];
  if (['open', 'deferred', 'repair_ordered'].includes(s)) moves.push({ step: 'repaired', primary: true });
  if (['open', 'deferred'].includes(s)) moves.push({ step: 'order' });
  if (['open', 'repair_ordered'].includes(s) && !rec.row.out_of_service) moves.push({ step: 'defer' });
  if (s === 'repaired') moves.push({ step: 'verify', primary: true }, { step: 'reopen' });
  if (s === 'canceled' || s === 'deferred') moves.push({ step: 'reopen' });
  if (['open', 'deferred', 'repair_ordered'].includes(s)) moves.push({ step: 'cancel' });
  return (
    <>
      {moves.map((m) => <Button key={m.step} variant={m.primary ? 'primary' : undefined} onClick={() => setStep(m.step)}>{STEP_TITLE[m.step]}</Button>)}
      {step && <StepDialog step={step} rec={rec} onClose={() => { setStep(null); rec.reload(); }} />}
    </>
  );
}

const targetRoute = (type: string, id: string) => (type === 'vehicle' ? `/vehicles/${id}` : type === 'site' ? `/sites/${id}` : `/assets/${id}`);

export function DefectDetail() {
  return (
    <RecordPage
      type="defect"
      actions={(rec) => <DefectActions {...rec} />}
      banner={({ row }) => (
        <>
          {row.out_of_service && ['open', 'deferred', 'repair_ordered'].includes(String(row.status)) && (
            <Notice tone="warning" title="Out of service">
              This defect keeps <Link to={targetRoute(String(row.target_type), String(row.target_id))}>{row.target_label ?? 'the record'}</Link> out of service until it is repaired.
            </Notice>
          )}
          {row.status === 'repaired' && <Notice title="Waiting for verification">Someone other than the person who repaired it checks the repair and verifies it.</Notice>}
        </>
      )}
      summaryFields={['title', 'description', 'target_label', 'inspection_id', 'severity', 'out_of_service', 'status', 'found_on', 'owner_id',
        'deferred_until', 'deferral_reason', 'work_order_ref', 'repaired_on', 'repaired_by', 'repair_notes', 'verified_on', 'verified_by']}
    />
  );
}
