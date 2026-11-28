// Governed vehicle retirement (wave 26, E46): the Retire button asks for an approval (the "Vehicle
// retirement" approval workflow, with a funder step when an outside funder keeps an interest), and
// the Retirement tab shows the requests and, once approved, records the retirement.
import { useState } from 'react';
import {
  api, Button, Card, DateField, EditableSummary, EmptyState, errorMessage, ErrorState, formatCurrency, formatDate, formatDateTime, Loading, LookupChip,
  LookupSelect, Modal, Notice, NumberField, StatusChip, Stepper, TextArea, TextField, todayInZone, useAuth, useFetch, useResource, useToast,
} from '../../core';
import type { Row } from '../../core';

interface Request {
  id: string; status: string; reason: string; method: string | null; expected_proceeds: number | null; funder_ref: string | null;
  requested_by_name: string | null; requested_at: string; decided_by_name: string | null; decided_at: string | null; decision_comment: string | null;
  decided_on_behalf_of_name: string | null; own: boolean;
  workflow: { name: string; approvals: number; required: number; waiting_for: string[]; can_decide: boolean } | null;
}
interface Requests { requests: Request[]; useful_life_end: string | null; useful_life_remaining: boolean; can_request: boolean; can_decide: boolean }

const STATE: Record<string, { label: string; color: 'amber' | 'green' | 'red' | 'gray' }> = {
  pending: { label: 'Awaiting approval', color: 'amber' },
  approved: { label: 'Approved', color: 'green' },
  refused: { label: 'Refused', color: 'red' },
  withdrawn: { label: 'Withdrawn', color: 'gray' },
};

const RETIREMENT_FIELDS = ['retirement_request_status', 'retirement_approved_by', 'retirement_approved_on', 'retirement_method', 'retirement_proceeds', 'retirement_funder_ref', 'retired_on'];

/** Whether the funder-interest option is on (the server leaves the field out while it is off). */
function useFunderOn() {
  const field = useResource('vehicle')?.fields.funder_interest;
  return { on: Boolean(field), label: field?.label ?? 'Funder interest' };
}

export function RetireDialog({ vehicle, onClose, onDone }: { vehicle: Row; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const funder = useFunderOn();
  const { data } = useFetch<Requests>(`/api/vehicles/${vehicle.id}/retirement-requests`);
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState('');
  const [proceeds, setProceeds] = useState<number | null>(null);
  const [funderRef, setFunderRef] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setErrors({});
    try {
      const res = await api.post<{ workflow: string | null }>(`/api/vehicles/${vehicle.id}/retirement-requests`, {
        reason, method: method || null, expected_proceeds: proceeds, funder_ref: funderRef || null,
      });
      toast.success(res.workflow ? `Retirement requested: the "${res.workflow}" approval workflow routes it.` : 'Retirement requested: the people who may approve it are told.');
      onDone();
    } catch (err) {
      const fields = (err as { fields?: Record<string, string> }).fields;
      if (fields) setErrors(fields);
      toast.error(errorMessage(err));
    } finally { setBusy(false); }
  };
  return (
    <Modal open title={`Retire vehicle ${vehicle.fleet_number}`} onClose={onClose} dirty={Boolean(reason || method || funderRef)}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!reason.trim()} onClick={submit}>Ask for approval</Button></>}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <p className="muted">Retiring a vehicle needs an approval. Once it is approved, mark the vehicle retired on its Retirement tab.</p>
        {data?.useful_life_remaining && data.useful_life_end && (
          <Notice tone="warning" title="Useful life remains">This vehicle's useful life runs until {formatDate(data.useful_life_end)}. Say in the reason why it should leave the fleet early.</Notice>
        )}
        {funder.on && vehicle.funder_interest && (
          <Notice tone="warning" title={`${funder.label}: the funder must agree`}>
            An outside funder paid for {vehicle.funder_interest_pct != null ? `${vehicle.funder_interest_pct}% of` : 'part of'} this vehicle. The approval has a second step for the funder's
            agreement, and the reference of that agreement is needed before the vehicle is marked retired.
          </Notice>
        )}
        <TextArea label="Why it should be retired" value={reason} onChange={setReason} required error={errors.reason} />
        <div className="form-grid">
          <LookupSelect label="Disposal method" list="vehicle_disposal_method" value={method} onChange={setMethod} error={errors.method} />
          <NumberField label="Expected proceeds" value={proceeds} onChange={setProceeds} min={0} error={errors.expected_proceeds} />
          {funder.on && vehicle.funder_interest && <TextField label="Funder approval reference" value={funderRef} onChange={setFunderRef} hint="If the funder has already agreed." />}
        </div>
      </form>
    </Modal>
  );
}

function RequestCard({ vehicleId, request, onChanged }: { vehicleId: string; request: Request; onChanged: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const [deciding, setDeciding] = useState<'approve' | 'refuse' | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const state = STATE[request.status] ?? { label: request.status, color: 'gray' as const };
  const pending = request.status === 'pending';
  const wf = request.workflow;
  const act = async (path: string, body: Record<string, unknown>, message: string) => {
    setBusy(true);
    try {
      await api.post(`/api/vehicles/${vehicleId}/retirement-requests/${request.id}/${path}`, body);
      toast.success(message);
      setDeciding(null);
      onChanged();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Card title={<>{request.requested_by_name ?? 'Someone'} asked on {formatDateTime(request.requested_at)}</>}
      actions={<StatusChip color={state.color} label={state.label} />}>
      <div className="stack">
        <p className="prose">{request.reason}</p>
        {(request.method || request.expected_proceeds !== null || request.funder_ref) && (
          <p className="muted">
            {[request.method && <span key="m">Method: <LookupChip list="vehicle_disposal_method" value={request.method} /></span>,
              request.expected_proceeds !== null && <span key="p"> Expected proceeds: {formatCurrency(request.expected_proceeds)}</span>,
              request.funder_ref && <span key="f"> Funder approval reference: {request.funder_ref}</span>]}
          </p>
        )}
        {request.decided_at && request.status !== 'withdrawn' && (
          <p>{state.label} by <strong>{request.decided_by_name ?? 'an approver'}</strong>
            {request.decided_on_behalf_of_name ? <> on behalf of <strong>{request.decided_on_behalf_of_name}</strong></> : null} on {formatDateTime(request.decided_at)}
            {request.decision_comment ? `: ${request.decision_comment}` : '.'}</p>
        )}
        {pending && wf && (
          <p className="muted">Approval workflow "{wf.name}": {wf.approvals} of {wf.required} {wf.required === 1 ? 'approval' : 'approvals'}
            {wf.waiting_for.length ? `, waiting for ${wf.waiting_for.join(', ')}.` : '.'}
            {wf.can_decide ? ' Decide it in the approval panel at the top of this page.' : ''}</p>
        )}
        {pending && (
          <div className="fl-retire-actions">
            {!wf && can('fleet.approve') && !request.own && <>
              <Button variant="primary" size="sm" onClick={() => setDeciding('approve')}>Approve</Button>
              <Button size="sm" onClick={() => setDeciding('refuse')}>Refuse</Button>
            </>}
            {can('fleet.edit') && <Button size="sm" variant="ghost" loading={busy} onClick={() => act('withdraw', {}, 'Request withdrawn.')}>Withdraw</Button>}
          </div>
        )}
      </div>
      {deciding && (
        <Modal open title={deciding === 'approve' ? 'Approve the retirement' : 'Refuse the retirement'} onClose={() => setDeciding(null)}
          footer={<><Button onClick={() => setDeciding(null)}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={deciding === 'refuse' && !comment.trim()}
              onClick={() => act('decision', { decision: deciding, comment: comment || null }, deciding === 'approve' ? 'Retirement approved.' : 'Retirement refused.')}>
              {deciding === 'approve' ? 'Approve' : 'Refuse'}</Button></>}>
          <TextArea label={deciding === 'approve' ? 'Comment' : 'Why it is refused'} value={comment} onChange={setComment} required={deciding === 'refuse'} />
        </Modal>
      )}
    </Card>
  );
}

function MarkRetired({ vehicle, onDone, onClose }: { vehicle: Row; onDone: () => void; onClose: () => void }) {
  const toast = useToast();
  const funder = useFunderOn();
  const [on, setOn] = useState(todayInZone());
  const [method, setMethod] = useState(String(vehicle.retirement_method ?? ''));
  const [proceeds, setProceeds] = useState<number | null>(vehicle.retirement_proceeds === null || vehicle.retirement_proceeds === undefined ? null : Number(vehicle.retirement_proceeds));
  const [funderRef, setFunderRef] = useState(String(vehicle.retirement_funder_ref ?? ''));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setErrors({});
    try {
      await api.patch(`/api/vehicles/${vehicle.id}`, {
        status: 'retired', retired_on: on || null, retirement_method: method || null, retirement_proceeds: proceeds,
        ...(funder.on ? { retirement_funder_ref: funderRef || null } : {}),
      });
      toast.success(`Vehicle ${vehicle.fleet_number} is retired.`);
      onDone();
    } catch (err) {
      const fields = (err as { fields?: Record<string, string> }).fields;
      if (fields) setErrors(fields);
      toast.error(errorMessage(err));
    } finally { setBusy(false); }
  };
  return (
    <Modal open title={`Mark vehicle ${vehicle.fleet_number} retired`} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Mark retired</Button></>}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {errors.status && <Notice tone="error">{errors.status}</Notice>}
        <div className="form-grid">
          <DateField label="Retired on" value={on} onChange={setOn} required error={errors.retired_on} />
          <LookupSelect label="Disposal method" list="vehicle_disposal_method" value={method} onChange={setMethod} />
          <NumberField label="Disposal proceeds" value={proceeds} onChange={setProceeds} min={0} />
          {funder.on && vehicle.funder_interest && <TextField label="Funder approval reference" value={funderRef} onChange={setFunderRef} required error={errors.retirement_funder_ref} />}
        </div>
      </form>
    </Modal>
  );
}

export function RetirementTab({ vehicle, onChanged }: { vehicle: Row; onChanged: () => void }) {
  const { can } = useAuth();
  const { data, error, reload } = useFetch<Requests>(`/api/vehicles/${vehicle.id}/retirement-requests?v=${vehicle.updated_at}`);
  const [asking, setAsking] = useState(false);
  const [marking, setMarking] = useState(false);
  const state = vehicle.retirement_request_status ?? null;
  const retired = vehicle.status === 'retired';
  const current = retired ? 'done' : state === 'approved' ? 'retire' : state === 'pending' ? 'decide' : 'ask';
  const changed = () => { reload(); onChanged(); };
  return (
    <div className="stack">
      <Card title="How retirement works">
        <Stepper label="Retirement steps" current={current} steps={[
          { key: 'ask', label: 'Request approval', hint: 'Select Retire and say why' },
          { key: 'decide', label: 'Approver decides', hint: 'Someone other than the requester', state: state === 'refused' && !retired ? 'blocked' : undefined },
          { key: 'retire', label: 'Mark as retired', hint: 'Date, method and proceeds are recorded' },
          { key: 'done', label: 'Retired' },
        ]} />
        <p className="muted">Every retirement needs an approval. The "Vehicle retirement" approval workflow tells the people who may approve it, with a second step when an outside funder keeps an interest; the one who asked cannot approve it.</p>
        <div className="fl-retire-actions">
          {!retired && state !== 'pending' && state !== 'approved' && can('fleet.edit') && <Button onClick={() => setAsking(true)}>Retire</Button>}
          {!retired && state === 'approved' && can('fleet.edit') && <Button variant="primary" onClick={() => setMarking(true)}>Mark as retired</Button>}
        </div>
      </Card>
      <Card title="Approval requests">
        {error ? <ErrorState error={error} onRetry={reload} />
          : !data ? <Loading lines={3} />
          : data.requests.length === 0 ? <EmptyState icon="check-square" title="No approval has been requested" message="A request made with the Retire button, and the approver's decision, are kept here." />
          : <div className="stack">{data.requests.map((r) => <RequestCard key={r.id} vehicleId={String(vehicle.id)} request={r} onChanged={changed} />)}</div>}
      </Card>
      <EditableSummary type="vehicle" row={vehicle} fields={RETIREMENT_FIELDS} title="Retirement record" editable={false} />
      {asking && <RetireDialog vehicle={vehicle} onClose={() => setAsking(false)} onDone={() => { setAsking(false); changed(); }} />}
      {marking && <MarkRetired vehicle={vehicle} onClose={() => setMarking(false)} onDone={() => { setMarking(false); changed(); }} />}
    </div>
  );
}
