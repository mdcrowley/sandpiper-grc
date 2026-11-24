// The "Outside reviewers" tab of an audit engagement or a funder compliance review (E41-09): who was
// invited, until when, and whether their access runs; invite someone, change an end date, send the
// invitation again, revoke. Other modules load this file with import.meta.glob, so a build without
// this module shows nothing.
import { useState } from 'react';
import {
  api, Badge, Button, Card, DateField, Dialog, EmptyState, errorMessage, ErrorState, formatDate, formatDateTime, Loading, Menu, Notice,
  TableWrap, TextArea, TextField, useFetch, useToast, withReauth,
} from '../../core';
import { STATE_COLOR, STATE_LABEL, type Grant } from './types';
import './outsidereviews.css';

interface ListAnswer { rows: Grant[]; today: string; max_days: number; can_edit: boolean; email_on: boolean }

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export interface ReviewersPanelProps {
  /** The record type's API base: `/api/audits` or `/api/compliance-reviews`. */
  basePath: string;
  recordId: string;
  /** "audit" or "review", for the sentences. */
  noun: string;
  /** A restricted record: say so before inviting. */
  restricted?: boolean;
}

function InviteDialog({ open, onClose, base, answer, noun, restricted, onDone }: {
  open: boolean; onClose: () => void; base: string; answer: ListAnswer; noun: string; restricted?: boolean; onDone: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', email: '', organization: '', expires_on: addDays(answer.today, 30), note: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = Boolean(form.name || form.email || form.organization || form.note);
  const send = async () => {
    setBusy(true);
    setErrors({});
    try {
      await withReauth(() => api.post(base, form));
      toast.success(`Invitation sent to ${form.email}.`);
      onDone();
      onClose();
    } catch (err) {
      const fields = (err as { fields?: Record<string, string> }).fields;
      if (fields && Object.keys(fields).length) setErrors(fields);
      else toast.error(errorMessage(err));
    } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} title="Invite an outside reviewer" onClose={onClose} dirty={dirty}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <p className="muted">
          They get an account of their own, with no roles, that opens this {noun} only: its requests, the evidence and the findings,
          until the end date. The invitation goes to their email address; a new account's set-up link is in it, and nobody here sees it.
        </p>
        {restricted && <Notice tone="warning">This {noun} is restricted. The reviewer will see it, its requests, evidence and findings.</Notice>}
        <TextField label="Name" required value={form.name} onChange={set('name')} error={errors.name} autoFocus />
        <TextField label="Email address" required type="email" inputMode="email" value={form.email} onChange={set('email')} error={errors.email} />
        <TextField label="Organization" hint="Their firm or the funder they work for (optional)." value={form.organization} onChange={set('organization')} />
        <DateField label="Access ends" required value={form.expires_on} onChange={set('expires_on')} min={answer.today}
          max={addDays(answer.today, answer.max_days)} error={errors.expires_on} hint="They can open it until the end of this day." />
        <TextArea label="Note (for your colleagues)" rows={2} value={form.note} onChange={set('note')} />
        <div className="form-actions">
          <Button type="submit" variant="primary" loading={busy}>Send the invitation</Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}

function EndDateDialog({ grant, base, answer, onClose, onDone }: { grant: Grant; base: string; answer: ListAnswer; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [date, setDate] = useState(grant.expires_on < answer.today ? answer.today : grant.expires_on);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`${base}/${grant.id}`, { expires_on: date, updated_at: grant.updated_at });
      toast.success('End date changed.');
      onDone();
      onClose();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Dialog open title={`Change when ${grant.name}'s access ends`} onClose={onClose} size="sm">
      <form className="form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <DateField label="Access ends" required value={date} onChange={setDate} min={answer.today} max={addDays(answer.today, answer.max_days)} />
        <div className="form-actions">
          <Button type="submit" variant="primary" loading={busy}>Save</Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function ReviewersPanel({ basePath, recordId, noun, restricted }: ReviewersPanelProps) {
  const base = `${basePath}/${recordId}/outside-reviewers`;
  const toast = useToast();
  const { data, error, reload } = useFetch<ListAnswer>(base);
  const [inviting, setInviting] = useState(false);
  const [changing, setChanging] = useState<Grant | null>(null);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={3} label="Loading the outside reviewers" />;

  const act = async (what: () => Promise<unknown>, done: string) => {
    try { await what(); toast.success(done); reload(); } catch (err) { toast.error(errorMessage(err)); }
  };
  const invite = data.can_edit && (
    <Button variant="primary" icon="plus" disabled={!data.email_on} onClick={() => setInviting(true)}>Invite a reviewer</Button>
  );
  return (
    <Card title="Outside reviewers" actions={invite || undefined}>
      <div className="stack">
        <p className="muted">
          People outside the organization, such as an external auditor or the funder's reviewer, who may open this {noun} until an end date.
          They see its requests, the evidence and the findings, and nothing else in the application.
        </p>
        {data.can_edit && !data.email_on && (
          <Notice tone="warning">Email is not set up, so invitations cannot be sent. An administrator can set it up under Administration &gt; Email.</Notice>
        )}
        {data.rows.length === 0 ? (
          <EmptyState icon="users" title="No outside reviewers" message={`Nobody outside the organization has been invited to this ${noun}.`} />
        ) : (
          <TableWrap label="Outside reviewers" fit>
            <table className="table">
              <caption className="sr-only">Outside reviewers</caption>
              <thead>
                <tr>
                  <th scope="col" data-priority="1">Reviewer</th>
                  <th scope="col" data-priority="2">Organization</th>
                  <th scope="col" data-priority="1">Access ends</th>
                  <th scope="col" data-priority="1">Status</th>
                  <th scope="col" data-priority="3">Last opened</th>
                  <th scope="col" data-priority="3">Invited by</th>
                  {data.can_edit && <th scope="col" data-priority="1"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((g) => (
                  <tr key={g.id}>
                    <td><strong>{g.name}</strong><div className="muted">{g.email}</div></td>
                    <td>{g.organization ?? '—'}</td>
                    <td>{formatDate(g.expires_on)}</td>
                    <td>
                      <Badge color={STATE_COLOR[g.state]}>{STATE_LABEL[g.state]}</Badge>
                      {g.state === 'active' && g.waiting_for_setup && <div className="muted or-small">Has not set a password yet</div>}
                    </td>
                    <td>{g.last_opened_at ? formatDateTime(g.last_opened_at) : 'Not yet'}</td>
                    <td>{g.invited_by_name ?? '—'}<div className="muted or-small">{formatDate(g.invited_at)}</div></td>
                    {data.can_edit && (
                      <td className="or-actions">
                        {g.state !== 'revoked' && (
                          <Menu label={`Actions for ${g.name}`} icon="more" iconOnly variant="ghost" align="end" items={[
                            { label: 'Change the end date', icon: 'calendar', onSelect: () => setChanging(g) },
                            ...(g.state === 'active' && data.email_on
                              ? [{ label: g.waiting_for_setup ? 'Send the set-up link again' : 'Send the invitation again', icon: 'message' as const,
                                onSelect: () => void act(() => api.post(`${base}/${g.id}/resend`), 'Sent again.') }]
                              : []),
                            { label: 'Revoke access now', icon: 'x', danger: true, separated: true,
                              onSelect: () => void act(() => api.post(`${base}/${g.id}/revoke`), `${g.name} can no longer open it.`) },
                          ]} />
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </div>
      {inviting && <InviteDialog open onClose={() => setInviting(false)} base={base} answer={data} noun={noun} restricted={restricted} onDone={reload} />}
      {changing && <EndDateDialog grant={changing} base={base} answer={data} onClose={() => setChanging(null)} onDone={reload} />}
    </Card>
  );
}
