// Header buttons for a document: write or upload a version, send for review, approve (with the
// adoption record), publish (now or on a future effective date, as a minor change if chosen), give a
// number, and make obsolete. Each step that other people will notice asks for confirmation first.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  api, ApiError, Button, Checkbox, ConfirmDialog, DateField, errorMessage, Menu, Modal, Notice, RecordPicker, TextArea, TextField, useAuth, useFetch, useToast,
} from '../../core';
import type { RecordContext } from '../../core';
import { isoDay } from './shared';
import { docNumber, recordPath, type FullVersion } from './documents/types';

interface Props {
  rec: RecordContext;
  versions: FullVersion[] | undefined;
  onChanged: () => void;
}

type Step = 'submit' | 'approve' | 'publish' | 'retire' | 'discard' | 'number' | null;

interface RetireResult { closed?: number; children?: { id: string; doc_number: string | null; title: string; status: string }[]; hidden_children?: number }

export function PolicyActions({ rec, versions, onChanged }: Props) {
  const { row } = rec;
  const { can, user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ approved_by_name: '', approved_on: '', effective_on: '', version_label: '', approval_body: '', approval_reference: '' });
  const [publish, setPublish] = useState({ effective_on: '', minor: false });
  const [retire, setRetire] = useState({ reason: '', replaced_by_id: null as string | null, retired_on: '' });
  const [start, setStart] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [left, setLeft] = useState<RetireResult | null>(null);
  const audience = useFetch<{ count: number; ack_days: number }>(step === 'publish' ? `/api/policies/${row.id}/audience` : null);
  const hierarchy = useFetch<{ children: { id: string }[]; hidden_children: number }>(step === 'retire' ? `/api/policies/${row.id}/hierarchy` : null);

  const canEdit = can('policies.edit');
  const canApprove = can('policies.approve');
  const retired = row.status === 'retired';
  if (!versions || (!canEdit && !canApprove && !can('policies.administer'))) return null;

  const latest = versions[0];
  const published = versions.find((v) => v.status === 'published');
  const base = `/api/policies/${row.id}`;
  const open = (next: Step) => {
    setErrors({});
    if (next === 'approve') {
      const first = {
        approved_by_name: row.approver_name ?? '', approved_on: isoDay(), effective_on: latest?.effective_on ?? '',
        version_label: latest?.version_label ?? '', approval_body: latest?.approval_body ?? '', approval_reference: latest?.approval_reference ?? '',
      };
      setForm(first);
      setStart(JSON.stringify(first));
    }
    if (next === 'publish') setPublish({ effective_on: latest?.effective_on ?? '', minor: false });
    if (next === 'retire') { setRetire({ reason: '', replaced_by_id: null, retired_on: isoDay() }); setStart(''); }
    setStep(next);
  };

  const run = async (call: () => Promise<unknown>, done: (result: any) => string) => {
    setBusy(true);
    try {
      const result = await call();
      toast.success(done(result));
      setStep(null);
      onChanged();
      return result;
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields ?? {}).length) setErrors(err.fields);
      else toast.error(errorMessage(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  const writeLabel = !latest ? 'Write the first version' : latest.status === 'draft' ? 'Edit draft' : 'Write a new version';
  const canWrite = !retired && canEdit && (!latest || ['draft', 'published', 'superseded'].includes(latest.status));
  const canUpload = !retired && canEdit && (!latest || ['published', 'superseded'].includes(latest.status));
  const people = audience.data?.count;
  // Someone else must approve what a person wrote.
  const ownLatest = Boolean(latest?.created_by && latest.created_by === user?.id);
  const scheduledLater = publish.effective_on && publish.effective_on > isoDay();
  const children = hierarchy.data?.children.length ?? 0;
  const hiddenChildren = hierarchy.data?.hidden_children ?? 0;

  const menu = [
    ...(canUpload ? [{ label: 'Upload a version (Word or PDF)', icon: 'upload' as const, onSelect: () => navigate(`${recordPath(row.id)}/upload`) }] : []),
    ...(can('policies.administer') && !row.doc_number && !retired ? [{ label: 'Give it a number', icon: 'tag' as const, onSelect: () => open('number') }] : []),
    ...(latest && ['draft', 'in_review'].includes(latest.status) && canEdit && !retired
      ? [{ label: `Discard version ${latest.version}…`, icon: 'x' as const, onSelect: () => open('discard') }] : []),
    ...(canApprove && !retired ? [{ label: 'Make obsolete…', icon: 'trash' as const, danger: true, separated: true, onSelect: () => open('retire') }] : []),
  ];

  return (
    <>
      {canWrite && <Link className={`btn ${latest?.status === 'draft' ? 'btn-secondary' : 'btn-primary'}`} to={`${recordPath(row.id)}/edit`}>{writeLabel}</Link>}
      {!retired && latest?.status === 'draft' && canEdit && <Button variant={canApprove ? 'secondary' : 'primary'} onClick={() => open('submit')}>Send for review</Button>}
      {!retired && latest && ['draft', 'in_review'].includes(latest.status) && canApprove && !ownLatest && (
        <Button variant={latest.status === 'in_review' ? 'primary' : 'secondary'} onClick={() => open('approve')}>Approve</Button>
      )}
      {!retired && latest?.status === 'approved' && canApprove && <Button variant="primary" onClick={() => open('publish')}>{latest.scheduled ? 'Publish now' : 'Publish'}</Button>}
      {menu.length > 0 && <Menu label="More actions" icon="more" iconOnly align="end" items={menu} />}

      <ConfirmDialog
        open={step === 'discard'} busy={busy} danger title={`Discard version ${latest?.version}?`}
        message={`The ${latest?.status === 'in_review' ? 'in-review' : 'draft'} text of version ${latest?.version} will be removed. Readers keep seeing the version in force, if there is one. The discarded text is kept in the history.`}
        confirmLabel="Discard version" onCancel={() => setStep(null)}
        onConfirm={() => run(() => api.del(`${base}/versions/${latest!.id}`), () => `Version ${latest!.version} discarded.`)}
      />

      <ConfirmDialog
        open={step === 'submit'} busy={busy} title="Send for review?"
        message={`Version ${latest?.version} will be marked as in review and can no longer be edited. The approver can then approve it.`}
        confirmLabel="Send for review" onCancel={() => setStep(null)}
        onConfirm={() => run(() => api.post(`${base}/versions/${latest!.id}/submit`), () => 'Sent for review.')}
      />

      <ConfirmDialog
        open={step === 'number'} busy={busy} title="Give this document a number?"
        message="The next number is made from the numbering pattern, the document type and the owning department. A number is never reused."
        confirmLabel="Give number" onCancel={() => setStep(null)}
        onConfirm={() => run(() => api.post<{ doc_number: string }>(`${base}/number`, {}), (r) => `Numbered ${r.doc_number}.`)}
      />

      <Modal
        open={step === 'approve'} title={`Approve version ${latest?.version}`} onClose={() => setStep(null)} size="md"
        dirty={step === 'approve' && JSON.stringify(form) !== start}
        footer={(
          <>
            <Button onClick={() => setStep(null)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={() => run(() => api.post(`${base}/versions/${latest!.id}/approve`, form), () => 'Version approved. It can now be published.')}>
              Approve version
            </Button>
          </>
        )}
      >
        <div className="stack">
          <p className="muted">Approving fixes the text of this version. Readers do not see it until it is published.</p>
          <div className="grid-2">
            <TextField label="Approved by" value={form.approved_by_name} error={errors.approved_by_name} hint="Leave empty to record your own name." onChange={(v) => setForm((f) => ({ ...f, approved_by_name: v }))} />
            <DateField label="Approval date" value={form.approved_on} error={errors.approved_on} onChange={(v) => setForm((f) => ({ ...f, approved_on: v }))} />
            <TextField label="Adopted by" value={form.approval_body} error={errors.approval_body} hint="For example the board of trustees, when a body adopted it." onChange={(v) => setForm((f) => ({ ...f, approval_body: v }))} />
            <TextField label="Approval record" value={form.approval_reference} error={errors.approval_reference} hint="For example a resolution number." onChange={(v) => setForm((f) => ({ ...f, approval_reference: v }))} />
            <TextField label="Revision label" value={form.version_label} error={errors.version_label} hint="Optional, for example Rev. C." onChange={(v) => setForm((f) => ({ ...f, version_label: v }))} />
            <DateField label="Effective date" value={form.effective_on} error={errors.effective_on} hint="Leave empty to use the day it is published." onChange={(v) => setForm((f) => ({ ...f, effective_on: v }))} />
          </div>
        </div>
      </Modal>

      <Modal
        open={step === 'publish'} title={`Publish version ${latest?.version}`} onClose={() => setStep(null)} size="md"
        footer={(
          <>
            <Button onClick={() => setStep(null)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={() => run(
              () => api.post(`${base}/versions/${latest!.id}/publish`, { effective_on: publish.effective_on || undefined, minor: publish.minor || undefined }),
              (r) => (r.scheduled
                ? `Version ${latest!.version} becomes effective on ${publish.effective_on}. The version in force stays until then.`
                : `Version ${latest!.version} is in force. ${r.requested} acknowledgment ${r.requested === 1 ? 'request' : 'requests'} sent.`),
            )}>
              {scheduledLater ? 'Schedule' : 'Publish'}
            </Button>
          </>
        )}
      >
        <div className="stack">
          <DateField label="Effective date" value={publish.effective_on} error={errors.effective_on}
            hint="Today or empty: in force at once. A later date: the version in force stays until then, and the switch happens that morning."
            onChange={(v) => setPublish((p) => ({ ...p, effective_on: v }))} />
          {published && (
            <Checkbox label="Minor change (typing or layout only)" checked={publish.minor} onChange={(v) => setPublish((p) => ({ ...p, minor: v }))}
              hint="Nobody is asked to acknowledge again: open requests move to the new version. The choice is recorded in the history." />
          )}
          <p className="muted">
            {`Readers see version ${latest?.version} once it is in force; earlier versions are kept, marked as superseded. `}
            {row.ack_required === false ? 'Readers are not asked to acknowledge this document.'
              : publish.minor ? 'No new acknowledgment requests are sent.'
              : people === undefined ? 'Everyone in the acknowledgment audience who can read it will be asked to acknowledge it.'
              : people === 0 ? 'Nobody is in the acknowledgment audience, so no acknowledgments will be requested.'
              : `${people} ${people === 1 ? 'person' : 'people'} will be asked to acknowledge it within ${audience.data!.ack_days} days, including anyone who acknowledged an earlier version.`}
          </p>
        </div>
      </Modal>

      <Modal
        open={step === 'retire'} title="Make this document obsolete" onClose={() => setStep(null)} size="md" dirty={step === 'retire' && Boolean(retire.reason)}
        footer={(
          <>
            <Button onClick={() => setStep(null)}>Cancel</Button>
            <Button variant="danger" loading={busy} onClick={async () => {
              if (!retire.reason.trim()) { setErrors({ reason: 'Say why the document is no longer needed.' }); return; }
              const r = await run(
                () => api.post<RetireResult>(`${base}/retire`, { reason: retire.reason.trim(), replaced_by_id: retire.replaced_by_id || undefined, retired_on: retire.retired_on || undefined }),
                (x: RetireResult) => `${docNumber(row) || 'The document'} is obsolete.${x.closed ? ` ${x.closed} open acknowledgment ${x.closed === 1 ? 'request was' : 'requests were'} closed.` : ''}`,
              ) as RetireResult | undefined;
              if (r && ((r.children?.length ?? 0) > 0 || (r.hidden_children ?? 0) > 0)) setLeft(r);
            }}>Make obsolete</Button>
          </>
        )}
      >
        <div className="stack">
          <p className="muted">
            The version in force is withdrawn and kept for the record, marked obsolete on every print. The document leaves the library, and open acknowledgment
            requests are closed. This cannot be undone here.
          </p>
          {(children > 0 || hiddenChildren > 0) && (
            <Notice tone="warning">
              {children + hiddenChildren} {children + hiddenChildren === 1 ? 'document points' : 'documents point'} to this one as their parent
              {hiddenChildren ? ` (${hiddenChildren} you cannot open)` : ''}. Move them under another document or make them obsolete too.
            </Notice>
          )}
          <TextArea label="Why it is no longer needed" required rows={2} value={retire.reason} error={errors.reason} onChange={(v) => setRetire((r) => ({ ...r, reason: v }))} />
          <RecordPicker type="policy" label="Replaced by (optional)" value={retire.replaced_by_id} error={errors.replaced_by_id} onChange={(id) => setRetire((r) => ({ ...r, replaced_by_id: id }))} />
          <DateField label="Obsolete from" value={retire.retired_on} error={errors.retired_on} onChange={(v) => setRetire((r) => ({ ...r, retired_on: v }))} />
        </div>
      </Modal>

      <Modal open={Boolean(left)} title="Documents still under this one" onClose={() => setLeft(null)} size="sm" footer={<Button variant="primary" onClick={() => setLeft(null)}>Close</Button>}>
        <div className="stack">
          <p>These documents still point to the obsolete one. Move them under another document or make them obsolete too.</p>
          <ul>
            {(left?.children ?? []).map((c) => <li key={c.id}><Link to={recordPath(c.id)} onClick={() => setLeft(null)}>{docNumber(c)} {c.title}</Link></li>)}
            {(left?.hidden_children ?? 0) > 0 && <li className="muted">{left!.hidden_children} you cannot open</li>}
          </ul>
        </div>
      </Modal>
    </>
  );
}
