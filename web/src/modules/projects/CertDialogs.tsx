import { useEffect, useState } from 'react';
import {
  api, ApiError, Button, Checkbox, DateField, errorMessage, LookupSelect, Modal, RecordPicker, Select, TextArea, TextField, useAuth,
  UserPicker, useToast,
} from '../../core';
import { todayIso, type Certification, type CertItem, type CertRequirement } from './types';

type Fields = Record<string, string>;

function useSubmit(onDone: () => void, onClose: () => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Fields>({});
  const [formError, setFormError] = useState('');
  const run = async (call: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setFormError('');
    try {
      await call();
      toast.success(done);
      onDone();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return { busy, fields, setFields, formError, setFormError, run };
}

function Footer({ busy, label, onClose, error }: { busy: boolean; label: string; onClose: () => void; error: string }) {
  return (
    <>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy}>{label}</Button>
      </div>
    </>
  );
}

/** Add or edit a certifiable item: a part of the project that must be shown safe and secure. */
export function CertItemDialog({ projectId, item, open, onClose, onSaved }: {
  projectId: string; item: CertItem | null; open: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [required, setRequired] = useState(true);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [ownerName, setOwnerName] = useState<string | undefined>();
  const s = useSubmit(onSaved, onClose);
  useEffect(() => {
    if (!open) return;
    setName(item?.name ?? '');
    setDescription(item?.description ?? '');
    setCategory(item?.category ?? '');
    setRequired(item ? item.required : true);
    setOwnerId(item?.owner_id ?? null);
    setOwnerName(item?.owner_name ?? undefined);
    s.setFields({});
    s.setFormError('');
  }, [open, item]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = open && (name !== (item?.name ?? '') || description !== (item?.description ?? '') || category !== (item?.category ?? '')
    || required !== (item ? item.required : true) || ownerId !== (item?.owner_id ?? null));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { s.setFields({ name: 'Item is required.' }); return; }
    const body = { name, description: description || null, category: category || null, required, owner_id: ownerId };
    void s.run(
      () => (item ? api.patch(`/api/certifiable-items/${item.id}`, body) : api.post('/api/certifiable-items', { ...body, project_id: projectId })),
      item ? 'Saved.' : 'Certifiable item added.',
    );
  };

  return (
    <Modal open={open} title={item ? `Edit ${item.ref}` : 'Add a certifiable item'} onClose={onClose} size="md" dirty={dirty}>
      <form className="form" onSubmit={submit} noValidate>
        <div className="form-grid">
          <TextField className="form-cell-wide" label="Item" required value={name} onChange={setName} error={s.fields.name}
            hint="The part to certify, for example a vehicle type, a signal system or a station." />
          <TextArea className="form-cell-wide" label="What it covers" rows={3} value={description} onChange={setDescription} error={s.fields.description} />
          <LookupSelect label="Category" list="cert_item_category" value={category} onChange={setCategory} error={s.fields.category} />
          <UserPicker label="Owner" value={ownerId} display={ownerName} onChange={(id, o) => { setOwnerId(id); setOwnerName(o?.label); }} error={s.fields.owner_id} />
          <Checkbox className="form-cell-wide" label="Required for the certificate of readiness" checked={required} onChange={setRequired}
            hint="A required item must be verified before the certificate can be issued. An item that is not required may stay open; the certificate lists it." />
        </div>
        <Footer busy={s.busy} label={item ? 'Save changes' : 'Add item'} onClose={onClose} error={s.formError} />
      </form>
    </Modal>
  );
}

const SOURCE_LABEL: Record<string, string> = { hazard: 'A hazard', risk: 'A threat (a risk)' };

/**
 * Add or edit a requirement, or record its verification. `verify` opens it ready to record that the
 * requirement was verified.
 */
export function RequirementDialog({ itemId, requirement, verify, sources, open, onClose, onSaved }: {
  itemId: string; requirement: CertRequirement | null; verify?: boolean; sources: string[]; open: boolean; onClose: () => void; onSaved: () => void;
}) {
  const { can } = useAuth();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [sourceType, setSourceType] = useState('');
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [basis, setBasis] = useState('');
  const [method, setMethod] = useState('');
  const [status, setStatus] = useState('open');
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [ownerName, setOwnerName] = useState<string | undefined>();
  const [dueOn, setDueOn] = useState('');
  const [evidence, setEvidence] = useState('');
  const [notes, setNotes] = useState('');
  const s = useSubmit(onSaved, onClose);
  // Only the kinds of record this person may open and that are switched on here.
  const mayPick = sources.filter((t) => (t === 'hazard' ? can('safety.view') : can('risks.view')));

  const initial = () => ({
    title: requirement?.title ?? '', text: requirement?.requirement ?? '', sourceType: requirement?.source?.type ?? '',
    sourceId: requirement?.source?.id ?? null, basis: requirement?.basis ?? '', method: requirement?.verification_method ?? '',
    status: verify ? 'verified' : requirement?.status ?? 'open', ownerId: requirement?.owner_id ?? null, dueOn: requirement?.due_on ?? '',
    evidence: requirement?.evidence_ref ?? '', notes: requirement?.verification_notes ?? '',
  });
  useEffect(() => {
    if (!open) return;
    const i = initial();
    setTitle(i.title); setText(i.text); setSourceType(i.sourceType); setSourceId(i.sourceId); setBasis(i.basis); setMethod(i.method);
    setStatus(i.status); setOwnerId(i.ownerId); setOwnerName(requirement?.owner_name ?? undefined); setDueOn(i.dueOn);
    setEvidence(i.evidence); setNotes(i.notes);
    s.setFields({});
    s.setFormError('');
  }, [open, requirement, verify]); // eslint-disable-line react-hooks/exhaustive-deps
  const now = { title, text, sourceType, sourceId, basis, method, status, ownerId, dueOn, evidence, notes };
  const dirty = open && JSON.stringify(now) !== JSON.stringify(initial());
  // A source the reader cannot pick here (its area is off, or they may not open it) is kept as it is.
  const keepSource = Boolean(requirement?.source && !mayPick.includes(requirement.source.type));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { s.setFields({ title: 'Requirement is required.' }); return; }
    const body: Record<string, unknown> = {
      title, requirement: text || null, basis: basis || null, verification_method: method || null, status,
      owner_id: ownerId, due_on: dueOn || null, evidence_ref: evidence || null, verification_notes: notes || null,
      ...(keepSource ? {} : { source_type: sourceType || null, source_id: sourceType ? sourceId : null }),
    };
    void s.run(
      () => (requirement?.id ? api.patch(`/api/certification-requirements/${requirement.id}`, body) : api.post('/api/certification-requirements', { ...body, item_id: itemId })),
      verify ? 'Verification recorded.' : requirement ? 'Saved.' : 'Requirement added.',
    );
  };

  const closing = status === 'verified' || status === 'not_applicable';
  return (
    <Modal open={open} title={verify ? `Record verification: ${requirement?.ref ?? ''}` : requirement ? `Edit ${requirement.ref}` : 'Add a requirement'} onClose={onClose} size="lg" dirty={dirty}>
      <form className="form" onSubmit={submit} noValidate>
        <div className="form-grid">
          <TextField className="form-cell-wide" label="Requirement" required value={title} onChange={setTitle} error={s.fields.title}
            hint="A short statement, for example &quot;Doors cannot open away from the platform&quot;." />
          {!verify && <TextArea className="form-cell-wide" label="What must be true" rows={3} value={text} onChange={setText} error={s.fields.requirement} />}
          {!verify && (keepSource ? (
            <TextField className="form-cell-wide" label="Derived from" value={`${requirement!.source!.type_label}: ${requirement!.source!.label}`} onChange={() => undefined} disabled
              hint="Kept as it is: you cannot choose this kind of record here." />
          ) : mayPick.length > 0 && (
            <>
              <Select label="Derived from" value={sourceType} onChange={(v) => { setSourceType(v); setSourceId(null); }} error={s.fields.source_type}
                options={[{ value: '', label: 'Neither (give the basis below)' }, ...mayPick.map((t) => ({ value: t, label: SOURCE_LABEL[t] ?? t }))]} />
              {sourceType
                ? <RecordPicker label={sourceType === 'hazard' ? 'Hazard' : 'Threat'} type={sourceType} required value={sourceId}
                    display={requirement?.source?.type === sourceType ? requirement.source.label : undefined}
                    onChange={(id) => setSourceId(id)} error={s.fields.source_id} />
                : <div />}
            </>
          ))}
          {!verify && <TextField className="form-cell-wide" label="Other basis" value={basis} onChange={setBasis} error={s.fields.basis}
            hint="A standard, design criterion or rule the requirement comes from." />}
          <LookupSelect label="Status" list="cert_requirement_status" value={status} onChange={setStatus} error={s.fields.status} />
          <LookupSelect label="Verification method" list="cert_verification_method" value={method} onChange={setMethod} error={s.fields.verification_method} required={status === 'verified'} />
          {!verify && <UserPicker label="Verifier" value={ownerId} display={ownerName} onChange={(id, o) => { setOwnerId(id); setOwnerName(o?.label); }} error={s.fields.owner_id} />}
          {!verify && <DateField label="Due" value={dueOn} onChange={setDueOn} error={s.fields.due_on} />}
          <TextField className="form-cell-wide" label="Evidence reference" value={evidence} onChange={setEvidence} error={s.fields.evidence_ref}
            hint="The test report, inspection record or drawing that shows it. Files can also be attached on the requirement's page." />
          <TextArea className="form-cell-wide" label={status === 'not_applicable' ? 'Why it does not apply' : 'Verification notes'} rows={3}
            value={notes} onChange={setNotes} error={s.fields.verification_notes} required={status === 'not_applicable'} />
        </div>
        {closing && <p className="muted">Saving records you as the person who {status === 'verified' ? 'verified it' : 'closed it'}, with today's date.</p>}
        <Footer busy={s.busy} label={verify ? 'Record verification' : requirement ? 'Save changes' : 'Add requirement'} onClose={onClose} error={s.formError} />
      </form>
    </Modal>
  );
}

/** Issue the certificate of readiness: what it certifies, conditions, and the open items it accepts. */
export function IssueDialog({ data, projectId, open, onClose, onDone }: {
  data: Certification; projectId: string; open: boolean; onClose: () => void; onDone: () => void;
}) {
  const [scope, setScope] = useState('');
  const [conditions, setConditions] = useState('');
  const [role, setRole] = useState('');
  const [issuedOn, setIssuedOn] = useState(todayIso());
  const s = useSubmit(onDone, onClose);
  useEffect(() => {
    if (!open) return;
    setScope(''); setConditions(''); setRole(''); setIssuedOn(todayIso());
    s.setFields({}); s.setFormError('');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!scope.trim()) { s.setFields({ scope: 'Say what the certificate covers.' }); return; }
    void s.run(() => api.post(`/api/projects/${projectId}/certificates`, {
      scope, conditions: conditions || null, issued_by_role: role || null, issued_on: issuedOn || null,
    }), 'Certificate of readiness issued.');
  };
  return (
    <Modal open={open} title="Issue the certificate of readiness" onClose={onClose} size="md" dirty={open && Boolean(scope || conditions || role)}>
      <form className="form" onSubmit={submit} noValidate>
        <p className="muted">
          You certify that every required item has been verified. The certificate is issued in your name and recorded in the project's history.
        </p>
        <TextArea label="Certifies as ready" required rows={2} value={scope} onChange={setScope} error={s.fields.scope}
          hint="For example: revenue service of the extension between the two new stops." />
        {data.open_items.length > 0 && (
          <div>
            <p className="muted">These items are not required and are still open. The certificate lists them as accepted open items:</p>
            <ul className="prj-plainlist">{data.open_items.map((i) => <li key={i.id}><span className="ref">{i.ref}</span> {i.name}</li>)}</ul>
          </div>
        )}
        <TextArea label="Conditions and restrictions" rows={3} value={conditions} onChange={setConditions} error={s.fields.conditions}
          hint="Any limits on use, and when the open items must be closed." />
        <div className="form-grid">
          <TextField label="Your role" value={role} onChange={setRole} error={s.fields.issued_by_role} hint="For example: Chief Safety Officer" />
          <DateField label="Issued on" value={issuedOn} onChange={setIssuedOn} error={s.fields.issued_on} />
        </div>
        <Footer busy={s.busy} label="Issue certificate" onClose={onClose} error={s.formError} />
      </form>
    </Modal>
  );
}

/** Withdraw the certificate in force, with a reason. */
export function WithdrawDialog({ projectId, certificateId, open, onClose, onDone }: {
  projectId: string; certificateId: string; open: boolean; onClose: () => void; onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const s = useSubmit(onDone, onClose);
  useEffect(() => { if (open) { setReason(''); s.setFields({}); s.setFormError(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) { s.setFields({ reason: 'Say why the certificate is withdrawn.' }); return; }
    void s.run(() => api.post(`/api/projects/${projectId}/certificates/${certificateId}/withdraw`, { reason }), 'Certificate withdrawn.');
  };
  return (
    <Modal open={open} title="Withdraw the certificate of readiness" onClose={onClose} size="sm" dirty={open && Boolean(reason)}>
      <form className="form" onSubmit={submit} noValidate>
        <p className="muted">Gates that require a certificate are blocked again until a new one is issued. The withdrawn certificate is kept.</p>
        <TextArea label="Reason" required rows={3} value={reason} onChange={setReason} error={s.fields.reason} />
        <Footer busy={s.busy} label="Withdraw" onClose={onClose} error={s.formError} />
      </form>
    </Modal>
  );
}
