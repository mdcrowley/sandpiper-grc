// Asset lifecycle dialogs: check out, check in, where it is, dispose (with routed approval) and decide.
import { useState } from 'react';
import { SegmentedControl } from '@mantine/core';
import {
  api, ApiError, Button, DateField, errorMessage, formatDate, Modal, RecordPicker, Select, Switch, TextArea, TextField, useAuth,
  useFetch, useLookup, UserPicker, useResource, useToast,
} from '../../core';
import type { Row } from '../../core';
import { editableLifecycle, moveBlockedReason } from '../../core/lifecycleMenus';
import { Callout, todayIso, useFunder } from './shared';

interface DialogProps { asset: Row; onClose: (changed: boolean) => void }

/**
 * The asset lifecycle rules (E14-31) for the asset actions: why the asset may not move to a status
 * ('' when it may), so an action can be disabled with the reason.
 */
export function useAssetMoveBlocked(asset: Row): (to: string) => string {
  const rules = editableLifecycle(useResource('asset')?.lifecycle, 'status');
  const statuses = useLookup('asset_status');
  return (to) => moveBlockedReason(rules, asset.status, to, statuses.find((s) => s.value === to)?.label ?? to, statuses.map((s) => s.value));
}

const CHECK_IN = [{ value: 'in_stock', label: 'In stock' }, { value: 'in_repair', label: 'In repair' }, { value: 'retired', label: 'Retired' }];
const fieldErrors = (err: unknown): Record<string, string> =>
  err instanceof ApiError && err.fields && Object.keys(err.fields).length ? { ...err.fields, _form: err.message } : { _form: errorMessage(err) };

/** Department from the organization's departments (E41-01: a reference, People > Departments). */
export function DepartmentInput({ value, display, onChange, error }: { value: string | null; display?: string; onChange: (v: string | null) => void; error?: string }) {
  return <RecordPicker label="Department" type="department" value={value} display={display} onChange={(id) => onChange(id)} error={error} />;
}

export function CheckOutDialog({ asset, onClose }: DialogProps) {
  const toast = useToast();
  const [who, setWho] = useState<'name' | 'user'>('name');
  const [userId, setUserId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [department, setDepartment] = useState<string | null>(asset.department_id ?? null);
  const [location, setLocation] = useState<string>(asset.location ?? '');
  const [due, setDue] = useState('');
  const [notes, setNotes] = useState('');
  const draft = JSON.stringify([who, userId, name, department, location, due, notes]);
  const [start] = useState(draft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (who === 'user' ? !userId : !name.trim()) {
      setErrors(who === 'user' ? { user_id: 'Choose a user.' } : { assignee_name: 'Enter the name of the person receiving the asset.' });
      return;
    }
    setBusy(true);
    try {
      await api.post(`/api/assets/${asset.id}/check-out`, {
        user_id: who === 'user' ? userId : null, assignee_name: who === 'name' ? name : null,
        department_id: department, location, due_back_on: due || null, notes,
      });
      toast.success('Asset checked out.');
      onClose(true);
    } catch (err) {
      setErrors(fieldErrors(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={`Check out ${asset.tag ?? asset.name}`} onClose={() => onClose(false)} dirty={draft !== start}
      footer={<><Button onClick={() => onClose(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Check out</Button></>}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {errors._form && <p className="form-error" role="alert">{errors._form}</p>}
        <Select label="Assign to" value={who} onChange={(v) => { setWho(v === 'user' ? 'user' : 'name'); setErrors({}); }} required
          options={[{ value: 'name', label: 'A member of staff (by name)' }, { value: 'user', label: 'A user of this application' }]}
          hint="Most staff do not have an account here, so a name is enough." />
        {who === 'user'
          ? <UserPicker label="User" value={userId} onChange={(id) => setUserId(id)} error={errors.user_id} required />
          : <TextField label="Name" value={name} onChange={setName} error={errors.assignee_name} required autoFocus />}
        <div className="form-grid">
          <DepartmentInput value={department} display={asset._display?.department_id} onChange={setDepartment} error={errors.department_id} />
          <TextField label="Location" value={location} onChange={setLocation} />
          <DateField label="Due back" value={due} onChange={setDue} min={todayIso()} error={errors.due_back_on} hint="Leave empty for a permanent assignment." />
        </div>
        <TextArea label="Notes" value={notes} onChange={setNotes} rows={3} />
      </form>
    </Modal>
  );
}

export function CheckInDialog({ asset, onClose }: DialogProps) {
  const toast = useToast();
  // Only the statuses the lifecycle rules allow from the asset's current one (E14-31).
  const blockedTo = useAssetMoveBlocked(asset);
  const options = CHECK_IN.filter((o) => !blockedTo(o.value));
  const [status, setStatus] = useState(options[0]?.value ?? '');
  const [notes, setNotes] = useState('');
  const [startStatus] = useState(status);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api.post(`/api/assets/${asset.id}/check-in`, { status, notes });
      toast.success('Asset checked in.');
      onClose(true);
    } catch (err) {
      setErrors(fieldErrors(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open title={`Check in ${asset.tag ?? asset.name}`} onClose={() => onClose(false)} size="sm" dirty={status !== startStatus || notes.trim() !== ''}
      footer={<><Button onClick={() => onClose(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!status} onClick={submit}>Check in</Button></>}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {errors._form && <p className="form-error" role="alert">{errors._form}</p>}
        <p>Currently with <strong>{asset._display?.user_id ?? asset.assigned_to_name ?? 'someone'}</strong>.</p>
        {options.length > 0 ? (
          <Select label="Status after check-in" value={status} onChange={(v) => setStatus(v || options[0].value)} error={errors.status} required options={options} />
        ) : (
          <p className="form-error" role="alert">No status after check-in is allowed: the lifecycle rules for assets (Administration &gt; Lifecycles) allow none of In stock, In repair or Retired from the current status.</p>
        )}
        <TextArea label="Condition and notes" value={notes} onChange={setNotes} rows={3} />
      </form>
    </Modal>
  );
}

/** Owner, department, site and location in one small form (department comes from the organization's list). */
export function WhereDialog({ asset, onClose }: DialogProps) {
  const toast = useToast();
  const { can } = useAuth();
  const [owner, setOwner] = useState<string | null>(asset.owner_id ?? null);
  const [department, setDepartment] = useState<string | null>(asset.department_id ?? null);
  const [site, setSite] = useState<string | null>(asset.site_id ?? null);
  const [location, setLocation] = useState<string>(asset.location ?? '');
  const draft = JSON.stringify([owner, department, site, location]);
  const [start] = useState(draft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    const patch: Record<string, unknown> = {};
    if (owner !== (asset.owner_id ?? null)) patch.owner_id = owner;
    if (department !== (asset.department_id ?? null)) patch.department_id = department;
    if (site !== (asset.site_id ?? null)) patch.site_id = site;
    if (location !== (asset.location ?? '')) patch.location = location || null;
    if (!Object.keys(patch).length) { onClose(false); return; }
    setBusy(true);
    try {
      await api.patch(`/api/assets/${asset.id}`, patch);
      toast.success('Changes saved.');
      onClose(true);
    } catch (err) {
      setErrors(fieldErrors(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open title="Owner and place" onClose={() => onClose(false)} dirty={draft !== start}
      footer={<><Button onClick={() => onClose(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Save changes</Button></>}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {errors._form && <p className="form-error" role="alert">{errors._form}</p>}
        <div className="form-grid">
          <UserPicker label="Owner" value={owner} display={asset._display?.owner_id} onChange={(id) => setOwner(id)} error={errors.owner_id}
            hint="Answers for the asset and is told when its warranty or support is about to end." />
          <DepartmentInput value={department} display={asset._display?.department_id} onChange={setDepartment} error={errors.department_id} />
          {can('sites.view') && <RecordPicker label="Site" type="site" value={site} display={asset._display?.site_id} onChange={(id) => setSite(id)} error={errors.site_id} />}
          <TextField label="Location" value={location} onChange={setLocation} hint="Room, rack or shelf." />
        </div>
      </form>
    </Modal>
  );
}

/**
 * Disposal. Every disposal needs an approval: asked for here and decided by an approver, or
 * (unless the organization has switched that off) recorded as a name and date given elsewhere.
 * An asset with a funder interest is blocked until the funder's approval reference is entered.
 */
export function DisposeDialog({ asset, onClose }: DialogProps) {
  const toast = useToast();
  const funderOption = useFunder();
  const settings = useFetch<{ disposalRoutedOnly: boolean }>('/api/inventory/settings');
  const routedOnly = settings.data?.disposalRoutedOnly === true;
  const funder = funderOption.on && !!asset.funder_interest;
  const state: string | null = asset.disposal_request_status ?? null;
  const approved = state === 'approved';
  const pending = state === 'pending';
  const [path, setPath] = useState<'ask' | 'typed'>('ask');
  const [reason, setReason] = useState('');
  const [by, setBy] = useState<string>(approved ? '' : asset.disposal_approved_by ?? '');
  const [on, setOn] = useState<string>(approved ? '' : asset.disposal_approved_on ?? '');
  const [ref, setRef] = useState<string>(asset.disposal_approval_ref ?? '');
  const [method, setMethod] = useState<string>(asset.disposal_method ?? '');
  const [disposedOn, setDisposedOn] = useState(todayIso());
  // E41-17: an asset that holds data records its wiping before it is disposed of.
  const wipeMethods = useLookup('data_wipe_method');
  const [holdsData, setHoldsData] = useState<boolean>(!!asset.data_bearing);
  const [wipe, setWipe] = useState({
    data_wipe_method: String(asset.data_wipe_method ?? ''), data_wiped_on: String(asset.data_wiped_on ?? '').slice(0, 10),
    data_wiped_by: String(asset.data_wiped_by ?? ''), data_wipe_certificate: String(asset.data_wipe_certificate ?? ''),
  });
  const setWipeField = (k: keyof typeof wipe, v: string) => { setWipe((w) => ({ ...w, [k]: v })); setErrors((e) => ({ ...e, [k]: '' })); };
  const draft = JSON.stringify([path, reason, by, on, ref, method, disposedOn, holdsData, wipe]);
  const [start] = useState(draft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const asking = !approved && !pending && (routedOnly || path === 'ask');
  const disposing = approved || (!pending && !asking);
  const blocked = disposing && funder && !ref.trim();
  // Marking as disposed follows the lifecycle rules (E14-31); asking for approval changes no status.
  const disposeBlocked = useAssetMoveBlocked(asset)('disposed');

  async function submit() {
    const missing: Record<string, string> = {};
    if (asking && !reason.trim()) missing.reason = 'Say why the asset should be disposed of.';
    if (disposing && !approved) {
      if (!by.trim()) missing.disposal_approved_by = 'Enter the name of the person who approved the disposal.';
      if (!on) missing.disposal_approved_on = 'Enter the date the disposal was approved.';
    }
    if (blocked) missing.disposal_approval_ref = 'Enter the reference of the funder\'s approval to dispose of this equipment.';
    if (disposing && holdsData) {
      if (!wipe.data_wipe_method) missing.data_wipe_method = 'Choose how the data was wiped.';
      if (!wipe.data_wiped_on) missing.data_wiped_on = 'Enter the date the data was wiped.';
      if (!wipe.data_wiped_by.trim()) missing.data_wiped_by = 'Enter who wiped the data (a person or a company).';
      if (!wipe.data_wipe_certificate.trim()) missing.data_wipe_certificate = 'Enter the reference of the wiping certificate.';
    }
    if (Object.keys(missing).length) { setErrors(missing); return; }
    setBusy(true);
    try {
      if (asking) {
        const res = await api.post<{ approvers: number }>(`/api/assets/${asset.id}/disposal-requests`, {
          reason, disposal_method: method || null, disposal_approval_ref: ref || null,
        });
        toast.success(res.approvers ? 'Disposal requested. The approval workflow has told the approvers.' : 'Disposal requested. Nobody else holds the approval permission yet, so tell an administrator.');
      } else {
        await api.post(`/api/assets/${asset.id}/dispose`, {
          ...(approved ? {} : { disposal_approved_by: by, disposal_approved_on: on }),
          disposal_approval_ref: ref || null, disposal_method: method || null, disposed_on: disposedOn || null,
          data_bearing: holdsData, ...(holdsData ? wipe : {}),
        });
        toast.success('Asset marked as disposed.');
      }
      onClose(true);
    } catch (err) {
      setErrors(fieldErrors(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={`Dispose of ${asset.tag ?? asset.name}`} onClose={() => onClose(false)} dirty={draft !== start}
      footer={(
        <>
          <Button onClick={() => onClose(false)}>{pending ? 'Close' : 'Cancel'}</Button>
          {asking && <Button variant="primary" loading={busy} onClick={submit}>Request approval</Button>}
          {disposing && <Button variant="danger" loading={busy} disabled={blocked || Boolean(disposeBlocked)} title={disposeBlocked || undefined} onClick={submit}>Mark as disposed</Button>}
        </>
      )}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); if (!(disposing && disposeBlocked)) void submit(); }}>
        {disposing && disposeBlocked && <p className="form-error" role="alert">{disposeBlocked}</p>}
        {pending && (
          <Callout color="amber" title="Awaiting approval">
            A disposal request for this asset is waiting for an approver. It can be marked as disposed once the request is approved.
            The request can be withdrawn on the Disposal tab.
          </Callout>
        )}
        {approved && (
          <Callout color="green" title={`Approved by ${asset.disposal_approved_by ?? 'an approver'}${asset.disposal_approved_on ? ` on ${formatDate(asset.disposal_approved_on)}` : ''}`}>
            The disposal was approved in the application. Complete the details below and mark the asset as disposed.
          </Callout>
        )}
        {!pending && !approved && !routedOnly && (
          <SegmentedControl fullWidth aria-label="How the disposal is approved" value={path} onChange={(v) => { setPath(v as 'ask' | 'typed'); setErrors({}); }}
            data={[{ value: 'ask', label: 'Ask an approver' }, { value: 'typed', label: 'Approval already given' }]} />
        )}
        {!pending && (funder ? (
          <Callout color={blocked ? 'red' : 'amber'} title={blocked ? 'Blocked: an outside funder keeps an interest in this asset' : 'An outside funder keeps an interest in this asset'}>
            {asset.funder_interest_pct != null ? `${asset.funder_interest_pct}% of this asset was paid for by an outside funder. ` : 'This asset was paid for in part by an outside funder. '}
            The funder's approval is needed before it is disposed of. Enter the reference of that approval (for example the
            letter or email reference){asking ? ' now or when the asset is marked as disposed.' : '; until then the disposal cannot be completed.'}
          </Callout>
        ) : !approved && (
          <Callout color="blue" title={funderOption.on ? `No ${funderOption.label.toLowerCase()} is recorded for this asset` : 'A disposal needs a recorded approval'}>
            {asking ? 'An approver other than you decides the request. You are told the outcome.' : 'A disposal still needs a recorded approval: who approved it and when.'}
          </Callout>
        ))}
        {errors._form && <p className="form-error" role="alert">{errors._form}</p>}
        {!pending && (
          <div className="form-grid">
            {asking && (
              <div className="form-cell-wide">
                <TextArea label="Why it should be disposed of" value={reason} onChange={setReason} rows={2} required error={errors.reason} />
              </div>
            )}
            {disposing && !approved && (
              <>
                <TextField label="Approved by" value={by} onChange={setBy} error={errors.disposal_approved_by} required hint="Name of the approver." />
                <DateField label="Approved on" value={on} onChange={setOn} max={todayIso()} error={errors.disposal_approved_on} required />
              </>
            )}
            <div className="form-cell-wide">
              <TextField label="Disposal approval reference" value={ref} onChange={(v) => { setRef(v); setErrors({}); }}
                error={errors.disposal_approval_ref} required={funder && disposing}
                hint={funder ? 'The funder\'s approval. Required before the asset is marked as disposed.' : 'Optional.'} />
            </div>
            <TextField label="Disposal method" value={method} onChange={setMethod} hint="For example recycled, sold, returned to vendor." />
            {disposing && <DateField label="Disposed on" value={disposedOn} onChange={setDisposedOn} max={todayIso()} error={errors.disposed_on} />}
          </div>
        )}
        {disposing && (
          <fieldset className="rc-form-section stack">
            <legend className="rc-form-legend">Data on the asset</legend>
            <Switch label="This asset holds data (disks, memory cards, phone or recorder storage)" checked={holdsData} onChange={(v) => { setHoldsData(v); setErrors({}); }} />
            {holdsData && (
              <div className="form-grid">
                <Select label="How the data was wiped" required value={wipe.data_wipe_method} error={errors.data_wipe_method}
                  options={wipeMethods.map((m) => ({ value: m.value, label: m.label }))} onChange={(v) => setWipeField('data_wipe_method', v ?? '')} />
                <DateField label="Data wiped on" required value={wipe.data_wiped_on} onChange={(v) => setWipeField('data_wiped_on', v ?? '')} max={todayIso()} error={errors.data_wiped_on} />
                <TextField label="Wiped by" required value={wipe.data_wiped_by} onChange={(v) => setWipeField('data_wiped_by', v)} error={errors.data_wiped_by} hint="The person or the company that wiped it." />
                <TextField label="Wiping certificate reference" required value={wipe.data_wipe_certificate} onChange={(v) => setWipeField('data_wipe_certificate', v)}
                  error={errors.data_wipe_certificate} hint="The wiping company's certificate number, or your own. Attach their certificate to the asset too." />
              </div>
            )}
          </fieldset>
        )}
        {disposing && <p className="muted">The asset is checked in if it is out, and the approval is kept in its history.</p>}
      </form>
    </Modal>
  );
}

export interface DisposalRequest {
  id: string; asset_id: string; status: 'pending' | 'approved' | 'refused' | 'withdrawn'; reason: string | null;
  disposal_method: string | null; approval_ref: string | null; requested_at: string; requested_by_name: string | null;
  decided_at: string | null; decided_by_name: string | null; decision_comment: string | null; own: boolean;
  decided_on_behalf_of_name?: string | null;
  /** The approval workflow deciding it (E04-24), while it waits; null when it is decided the older way. */
  workflow?: { name: string; approvals: number; required: number; waiting_for: string[]; can_decide: boolean } | null;
  asset_tag?: string | null; asset_name?: string; funder_interest?: boolean;
}

/** An approver approves or refuses a disposal request, with a comment. */
export function DecideDialog({ request, label, decision, onClose }: {
  request: DisposalRequest; label: string; decision: 'approve' | 'refuse'; onClose: (changed: boolean) => void;
}) {
  const toast = useToast();
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const approve = decision === 'approve';

  async function submit() {
    if (!approve && !comment.trim()) { setErrors({ comment: 'Say why the disposal is refused.' }); return; }
    setBusy(true);
    try {
      await api.post(`/api/assets/${request.asset_id}/disposal-requests/${request.id}/decision`, { decision, comment });
      toast.success(approve ? 'Disposal approved.' : 'Disposal refused.');
      onClose(true);
    } catch (err) {
      setErrors(fieldErrors(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open size="sm" title={`${approve ? 'Approve' : 'Refuse'} the disposal of ${label}`} onClose={() => onClose(false)} dirty={comment.trim() !== ''}
      footer={(
        <>
          <Button onClick={() => onClose(false)}>Cancel</Button>
          <Button variant={approve ? 'primary' : 'danger'} loading={busy} onClick={submit}>{approve ? 'Approve disposal' : 'Refuse disposal'}</Button>
        </>
      )}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {errors._form && <p className="form-error" role="alert">{errors._form}</p>}
        <p><strong>{request.requested_by_name ?? 'Someone'}</strong> asked on {formatDate(request.requested_at)}: {request.reason}</p>
        <TextArea label="Comment" value={comment} onChange={setComment} rows={3} required={!approve} error={errors.comment}
          hint={approve ? 'Optional. Your name and today\'s date are recorded as the approval.' : 'The requester is told why.'} />
      </form>
    </Modal>
  );
}
