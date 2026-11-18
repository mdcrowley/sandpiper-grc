// Header buttons for a policy: write, send for review, approve, publish, retire. Each step that
// other people will notice asks for confirmation first.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, ApiError, Button, ConfirmDialog, DateField, errorMessage, Menu, Modal, TextField, useAuth, useFetch, useToast,
} from '../../core';
import type { RecordContext } from '../../core';
import { isoDay, type PolicyVersion } from './shared';

interface Props {
  rec: RecordContext;
  versions: PolicyVersion[] | undefined;
  onChanged: () => void;
}

type Step = 'submit' | 'approve' | 'publish' | 'retire' | null;

export function PolicyActions({ rec, versions, onChanged }: Props) {
  const { row } = rec;
  const { can } = useAuth();
  const toast = useToast();
  const [step, setStep] = useState<Step>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ approved_by_name: '', approved_on: '', effective_on: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const audience = useFetch<{ count: number; ack_days: number }>(step === 'publish' ? `/api/policies/${row.id}/audience` : null);

  const canEdit = can('policies.edit');
  const canApprove = can('policies.approve');
  const retired = row.status === 'retired';
  if (!versions || retired || (!canEdit && !canApprove)) return null;

  const latest = versions[0];
  const base = `/api/policies/${row.id}`;
  const open = (next: Step) => {
    setErrors({});
    if (next === 'approve') setForm({ approved_by_name: row.approver_name ?? '', approved_on: isoDay(), effective_on: '' });
    setStep(next);
  };

  const run = async (call: () => Promise<unknown>, done: (result: any) => string) => {
    setBusy(true);
    try {
      const result = await call();
      toast.success(done(result));
      setStep(null);
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const writeLabel = !latest ? 'Write the first version' : latest.status === 'draft' ? 'Edit draft' : 'New version';
  const canWrite = canEdit && (!latest || ['draft', 'published', 'superseded'].includes(latest.status));
  const people = audience.data?.count;

  return (
    <>
      {canWrite && <Link className={`btn ${latest?.status === 'draft' ? 'btn-secondary' : 'btn-primary'}`} to={`/policies/${row.id}/edit`}>{writeLabel}</Link>}
      {latest?.status === 'draft' && canEdit && <Button variant={canApprove ? 'secondary' : 'primary'} onClick={() => open('submit')}>Send for review</Button>}
      {latest && ['draft', 'in_review'].includes(latest.status) && canApprove && (
        <Button variant={latest.status === 'in_review' ? 'primary' : 'secondary'} onClick={() => open('approve')}>Approve</Button>
      )}
      {latest?.status === 'approved' && canApprove && <Button variant="primary" onClick={() => open('publish')}>Publish</Button>}
      {canApprove && (
        <Menu label="More actions" icon="more" iconOnly align="end" items={[{ label: 'Retire policy', icon: 'trash', danger: true, onSelect: () => open('retire') }]} />
      )}

      <ConfirmDialog
        open={step === 'submit'} busy={busy} title="Send for review?"
        message={`Version ${latest?.version} will be marked as in review and can no longer be edited. The approver can then approve it.`}
        confirmLabel="Send for review" onCancel={() => setStep(null)}
        onConfirm={() => run(() => api.post(`${base}/versions/${latest!.id}/submit`), () => 'Sent for review.')}
      />

      <Modal
        open={step === 'approve'} title={`Approve version ${latest?.version}`} onClose={() => setStep(null)} size="sm"
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
          <p className="muted">Approving fixes the text of this version. It is not shown to readers until it is published.</p>
          <TextField label="Approved by" value={form.approved_by_name} error={errors.approved_by_name} hint="Leave empty to record your own name." onChange={(v) => setForm((f) => ({ ...f, approved_by_name: v }))} />
          <DateField label="Approval date" value={form.approved_on} error={errors.approved_on} onChange={(v) => setForm((f) => ({ ...f, approved_on: v }))} />
          <DateField label="Effective date" value={form.effective_on} error={errors.effective_on} hint="Leave empty to use the day it is published." onChange={(v) => setForm((f) => ({ ...f, effective_on: v }))} />
        </div>
      </Modal>

      <ConfirmDialog
        open={step === 'publish'} busy={busy} title={`Publish version ${latest?.version}?`}
        message={
          `Readers will see version ${latest?.version} from now on; earlier versions are kept in the history. `
          + (people === undefined
            ? 'Everyone in the audience will be asked to acknowledge it.'
            : people === 0
              ? 'Nobody is in the audience, so no acknowledgements will be requested.'
              : `${people} ${people === 1 ? 'person' : 'people'} will be asked to acknowledge it within ${audience.data!.ack_days} days, including anyone who acknowledged an earlier version.`)
        }
        confirmLabel="Publish" onCancel={() => setStep(null)}
        onConfirm={() => run(
          () => api.post(`${base}/versions/${latest!.id}/publish`),
          (r) => `Version ${latest!.version} published. ${r.requested} acknowledgement ${r.requested === 1 ? 'request' : 'requests'} sent.`,
        )}
      />

      <ConfirmDialog
        open={step === 'retire'} busy={busy} danger title="Retire this policy?"
        message="The policy will be marked as retired and any outstanding acknowledgement requests will be closed. Its text and history are kept. This cannot be undone here."
        confirmLabel="Retire policy" onCancel={() => setStep(null)}
        onConfirm={() => run(() => api.post(`${base}/retire`), () => 'Policy retired.')}
      />
    </>
  );
}
