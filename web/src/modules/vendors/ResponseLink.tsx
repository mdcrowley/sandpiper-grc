// Staff side of vendors answering an assessment themselves (E06-21): create, copy, email (E06-23)
// and revoke the link for a draft assessment, then review what the vendor answered and the files
// they sent (E06-22), and take over what you accept. Taken-over answers can still be changed
// before the assessment is completed.
import { useState } from 'react';
import type { FormEvent } from 'react';
import {
  api, ApiError, Button, ConfirmDialog, errorMessage, formatDate, formatDateTime, Modal, NumberField, StatusChip, Switch, TextField,
  useAuth, useFetch, useToast, withReauth,
} from '../../core';
import type { ColorName } from '../../core';
import type { Question } from './Assessment';
import { formatSize, HeldFiles, type HeldFile } from './ResponseFiles';

type Answer = 'yes' | 'partial' | 'no' | 'na';
interface Entry { answer?: Answer | null; note?: string | null }
interface Link {
  id: string; recipient: string | null; expires_at: string; created_at: string; created_by_name: string | null;
  opened_at: string | null; saved_at: string | null; submitted_at: string | null; revoked_at: string | null;
  responder_name: string | null; state: 'active' | 'submitted' | 'expired' | 'revoked' | 'closed'; answered: number;
  answers: Record<string, Entry>; emailed_to: string | null; emailed_at: string | null; reminded_at: string | null; files: HeldFile[];
}
interface LinkSettings {
  enabled: boolean; default_days: number; max_days: number; max_files: number; max_mb: number; file_types: string[];
  reminder_days: number; discard_days: number; files_available: boolean; email_available: boolean;
}
interface Links extends LinkSettings { rows: Link[] }

const LABEL: Record<Answer, string> = { yes: 'Yes', partial: 'Partly', no: 'No', na: 'Not applicable' };
const STATE: Record<Link['state'], { label: string; color: ColorName }> = {
  active: { label: 'Open', color: 'blue' }, submitted: { label: 'Answers sent', color: 'green' },
  expired: { label: 'Expired', color: 'gray' }, revoked: { label: 'Withdrawn', color: 'gray' }, closed: { label: 'Closed', color: 'gray' },
};

async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export function ResponseLinkPanel({ assessmentId, questions, answers, onAccepted }: {
  assessmentId: string; questions: Question[]; answers: Record<string, Entry>; onAccepted: () => void;
}) {
  const toast = useToast();
  const { can } = useAuth();
  const editable = can('vendors.edit');
  const { data, reload } = useFetch<Links>(`/api/vendor-assessments/${assessmentId}/links`);
  const [creating, setCreating] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [email, setEmail] = useState('');
  const [emailed, setEmailed] = useState<string | null>(null);
  const [days, setDays] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [made, setMade] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<Link | null>(null);
  if (!data) return null;
  const latest = data.rows[0];
  if (!data.enabled && !latest) return null;

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy('create');
    setErrors({});
    try {
      if (data?.email_available && email.trim()) {
        // The application emails the link; nobody here sees it.
        const res = await api.post<{ emailed_to: string }>(`/api/vendor-assessments/${assessmentId}/links/email`, { email, recipient: recipient || undefined, days: days ?? undefined });
        setEmailed(res.emailed_to);
      } else {
        const res = await api.post<{ path: string }>(`/api/vendor-assessments/${assessmentId}/links`, { recipient, days: days ?? undefined });
        setMade(`${window.location.origin}${res.path}`);
      }
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function revoke() {
    if (!revoking) return;
    setBusy('revoke');
    try {
      await api.del(`/api/vendor-assessments/${assessmentId}/links/${revoking.id}`);
      toast.success('The link no longer works. Answers already given stay here for review.');
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
      setRevoking(null);
    }
  }

  async function accept(keys?: string[]) {
    if (!latest) return;
    setBusy(keys?.[0] ?? 'all');
    try {
      const res = await api.post<{ accepted: string[] }>(`/api/vendor-assessments/${assessmentId}/links/${latest.id}/accept`, keys ? { keys } : {});
      toast.success(`${res.accepted.length} answer${res.accepted.length === 1 ? '' : 's'} taken over. You can still change any of them.`);
      onAccepted();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  // Questions where the vendor said something other than what the assessment holds now.
  const differing = latest ? questions.filter((q) => {
    const theirs = latest.answers[q.key];
    if (!theirs?.answer) return false;
    const ours = answers[q.key];
    return theirs.answer !== ours?.answer || (theirs.note ?? null) !== (ours?.note ?? null);
  }) : [];
  const state = latest ? STATE[latest.state] : null;
  const open = latest?.state === 'active';
  // Files wait on whichever link they came through, including a link that has since been replaced.
  const held = data.rows.flatMap((l) => (l.files ?? []).map((f) => ({ ...f, link_id: l.id })));
  const startNew = () => {
    setMade(null); setEmailed(null); setRecipient(latest?.recipient ?? ''); setEmail(latest?.emailed_to ?? '');
    setDays(data.default_days); setErrors({}); setCreating(true);
  };

  return (
    <section className="vnd-link" aria-labelledby="vnd-link-title">
      <div className="vnd-link-head">
        <div>
          <h3 id="vnd-link-title" className="vnd-link-title">Vendor’s own answers</h3>
          {!latest ? (
            <p className="muted">Send the vendor a link to answer these questions themselves, without an account. Nothing they answer counts until you take it over here.</p>
          ) : (
            <p className="muted">
              {state && <StatusChip color={state.color} label={state.label} size="sm" />}{' '}
              {latest.recipient ? `For ${latest.recipient}. ` : ''}
              {latest.submitted_at ? `Sent ${formatDateTime(latest.submitted_at)}${latest.responder_name ? ` by ${latest.responder_name}` : ''}. `
                : latest.opened_at ? `Opened ${formatDateTime(latest.opened_at)}; ${latest.answered} of ${questions.length} answered so far. ` : 'Not opened yet. '}
              {open && `Works until ${formatDate(latest.expires_at)}.`}
              {latest.emailed_to && ` Emailed to ${latest.emailed_to} ${formatDateTime(latest.emailed_at!)}${latest.reminded_at ? `; reminder sent ${formatDateTime(latest.reminded_at)}` : ''}.`}
            </p>
          )}
        </div>
        {editable && (
          <div className="row">
            {open && <Button size="sm" variant="ghost" onClick={() => setRevoking(latest!)}>Withdraw link</Button>}
            {data.enabled && (
              <Button size="sm" icon="link" onClick={startNew}>
                {latest ? (data.email_available && latest.emailed_to ? 'Send a new link' : 'New link') : 'Create link'}
              </Button>
            )}
          </div>
        )}
      </div>

      {latest && differing.length > 0 && (
        <div className="vnd-link-review">
          <div className="vnd-link-review-head">
            <strong>{differing.length} answer{differing.length === 1 ? '' : 's'} from the vendor to review</strong>
            {editable && <Button size="sm" variant="primary" loading={busy === 'all'} disabled={busy !== null} onClick={() => void accept(differing.map((q) => q.key))}>Take over all</Button>}
          </div>
          <ul className="vnd-link-list">
            {differing.map((q) => {
              const theirs = latest.answers[q.key]!;
              const ours = answers[q.key];
              return (
                <li key={q.key}>
                  <span className="vnd-link-q">{q.text}</span>
                  <span className="vnd-link-a">
                    Vendor: <strong>{LABEL[theirs.answer as Answer]}</strong>{theirs.note ? ` (“${theirs.note}”)` : ''}
                    {ours?.answer && <span className="muted"> · here now: {LABEL[ours.answer]}</span>}
                  </span>
                  {editable && (
                    <Button size="sm" variant="ghost" loading={busy === q.key} disabled={busy !== null} onClick={() => void accept([q.key])}>
                      Take over<span className="sr-only">: {q.text}</span>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <HeldFiles assessmentId={assessmentId} files={held} editable={editable} onChange={reload} />

      <Modal
        open={creating} title={emailed ? 'Link sent' : made ? 'Link ready' : 'Create a link for the vendor'} size="md" onClose={() => setCreating(false)}
        dirty={!made && !emailed && (recipient.trim() !== '' || email.trim() !== '')}
      >
        {emailed ? (
          <div className="form">
            <p>A new link is on its way to <strong>{emailed}</strong>. Nobody else sees it: if it is lost, send a new one (the old one then stops working).</p>
            <div className="form-actions"><Button variant="primary" onClick={() => setCreating(false)}>Done</Button></div>
          </div>
        ) : made ? (
          <div className="form">
            <p>Send this address to the vendor. It is shown <strong>only now</strong>; if it is lost, create a new link (the old one then stops working).</p>
            <TextField label="Link for the vendor" value={made} onChange={() => undefined} />
            <div className="form-actions">
              <Button onClick={() => setCreating(false)}>Done</Button>
              <Button variant="primary" icon="link" onClick={() => void copy(made).then((ok) => (ok ? toast.success('Link copied.') : toast.error('Copy it from the box above.')))}>Copy link</Button>
            </div>
          </div>
        ) : (
          <form className="form" onSubmit={create} noValidate>
            <p className="muted">
              Anyone with the link can see these questions and answer them until it expires, without signing in. Their answers wait here for your review.
              {latest && latest.state === 'active' ? ' The link sent earlier stops working.' : ''}
            </p>
            <TextField label="Who it is for" value={recipient} onChange={setRecipient} error={errors.recipient} hint="Optional: a name or team at the vendor, for your own reference." />
            {data.email_available && (
              <TextField label="Email it to" type="email" value={email} onChange={setEmail} error={errors.email} autoComplete="off"
                hint="Optional: the application emails the link to this address, and you never see it. Leave empty to copy the link and send it yourself." />
            )}
            <NumberField label="Days it works" required min={1} max={data.max_days} step={1} decimals={0} value={days} onChange={setDays} error={errors.days} />
            <div className="form-actions">
              <Button onClick={() => setCreating(false)}>Cancel</Button>
              <Button type="submit" variant="primary" loading={busy === 'create'}>{data.email_available && email.trim() ? 'Create and email link' : 'Create link'}</Button>
            </div>
          </form>
        )}
      </Modal>
      <ConfirmDialog
        open={revoking !== null} title="Withdraw this link?" danger confirmLabel="Withdraw link" busy={busy === 'revoke'}
        message="The vendor can no longer open it. Answers they have already saved stay here for review."
        onCancel={() => setRevoking(null)} onConfirm={() => void revoke()}
      />
    </section>
  );
}

/** Administrators switch vendor response links on or off and set how long a new link lasts. */
export function ResponseLinkSettings() {
  const toast = useToast();
  const { data, reload } = useFetch<LinkSettings & { can_administer: boolean }>('/api/vendors/response-links/settings');
  const [days, setDays] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<{ max_files: number | null; max_mb: number | null; file_types: string; reminder_days: number | null; discard_days: number | null } | null>(null);
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
  if (!data) return null;
  const value = days ?? data.default_days;
  const form = files ?? { max_files: data.max_files, max_mb: data.max_mb, file_types: data.file_types.join(', '), reminder_days: data.reminder_days, discard_days: data.discard_days };

  async function saveFiles() {
    setBusy(true);
    setFileErrors({});
    try {
      await api.put('/api/vendors/response-links/settings', {
        max_files: form.max_files, max_mb: form.max_mb, file_types: form.file_types, reminder_days: form.reminder_days, discard_days: form.discard_days,
      });
      toast.success('Saved.');
      setFiles(null);
      reload();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields ?? {}).length) setFileErrors(err.fields!);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function put(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setError('');
    try {
      await withReauth(() => api.put('/api/vendors/response-links/settings', body));
      toast.success(done);
      setDays(null);
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.fields?.default_days) setError(err.fields.default_days);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <Switch
        label="Let vendors answer through a link" checked={data.enabled} disabled={!data.can_administer || busy}
        onChange={(on) => void put({ enabled: on }, on ? 'Vendors can now be sent a link to answer.' : 'Vendor links are off. Every open link has stopped working.')}
        hint="Staff can then create a link on a draft assessment. The vendor answers without an account; nothing counts until staff take the answers over. Switching this off stops every open link."
      />
      <div className="row vnd-link-days">
        <NumberField label="Days a new link works" min={1} max={data.max_days} step={1} decimals={0} value={value} onChange={setDays}
          disabled={!data.can_administer} error={error} hint={`From 1 to ${data.max_days}. Staff can choose another length for each link.`} />
        {data.can_administer && days !== null && days !== data.default_days && (
          <Button loading={busy} onClick={() => void put({ default_days: days }, 'Saved.')}>Save</Button>
        )}
      </div>
      <div className="vnd-link-files">
        <NumberField label="Files a vendor may send per link" min={0} max={50} step={1} decimals={0} value={form.max_files}
          onChange={(v) => setFiles({ ...form, max_files: v })} disabled={!data.can_administer} error={fileErrors.max_files}
          hint={data.files_available ? '0 = no files. Each file is checked like any upload, then waits for staff review.' : 'Files cannot be received here: file attachments are not installed.'} />
        <NumberField label="Total size per link (MB)" min={1} max={500} step={1} decimals={0} value={form.max_mb}
          onChange={(v) => setFiles({ ...form, max_mb: v })} disabled={!data.can_administer} error={fileErrors.max_mb}
          hint="Each file is also held to the upload limit under File settings." />
        <TextField label="File types vendors may send" value={form.file_types} onChange={(v) => setFiles({ ...form, file_types: v })}
          disabled={!data.can_administer} error={fileErrors.file_types} hint="Separated by commas. Only types also allowed under File settings are accepted." />
        <NumberField label="Reminder before an emailed link expires (days)" min={0} max={30} step={1} decimals={0} value={form.reminder_days}
          onChange={(v) => setFiles({ ...form, reminder_days: v })} disabled={!data.can_administer} error={fileErrors.reminder_days}
          hint={data.email_available ? '0 = no reminder. The reminder does not repeat the link.' : 'Applies once email is set up (Administration > Email).'} />
        <NumberField label="Discard unreviewed files after the link closes (days)" min={0} max={365} step={1} decimals={0} value={form.discard_days}
          onChange={(v) => setFiles({ ...form, discard_days: v })} disabled={!data.can_administer} error={fileErrors.discard_days}
          hint="0 = never. Files still waiting this long after the answers are sent or the link expires or is revoked are discarded; the person who created the link is told 3 days before." />
      </div>
      {data.can_administer && files !== null && (
        <div className="row"><Button loading={busy} onClick={() => void saveFiles()}>Save file and reminder settings</Button></div>
      )}
      {data.max_files > 0 && <p className="muted vnd-link-limits">Now: up to {data.max_files} files and {formatSize(data.max_mb * 1024 * 1024)} per link.</p>}
    </div>
  );
}
