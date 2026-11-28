// Wave 26 for committees: declarations of interest at a meeting and the recused votes they lead to
// (E45-60), the agenda posting deadline and the standing items of the annual work plan due at a meeting,
// and the committee's work plan itself (E45-62).
import { useState } from 'react';
import {
  api, Badge, Button, Card, ChoicesField, ConfirmDialog, EmptyState, errorMessage, ErrorState, formatDate, IconButton, Loading, Modal, Notice,
  Select, TableWrap, TextArea, TextField, useAuth, useFetch, useToast,
} from '../../core';
import type { Row } from '../../core';

const LOCKED = 'minutes_approved';
const ACTIONS = [
  { value: 'recused', label: 'Took no part (recused)' },
  { value: 'left_room', label: 'Left the room' },
  { value: 'stayed', label: 'Stayed, with the chair\'s agreement' },
];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export interface Declaration {
  id: string; agenda_item_id: string | null; item_title: string | null; member_id: string | null; name: string;
  interest: string | null; action: string; action_label: string; declared_at: string; recorded_by_name: string | null; hidden: boolean;
}

/** The form for one declaration; `member` hides the person picker (a member declaring their own). */
function DeclarationDialog({ meetingId, url, own, onClose, onSaved }: { meetingId: string; url: string; own?: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const agenda = useFetch<Row[] | { items?: Row[] }>(own ? `/api/governance/my-meetings/${meetingId}` : `/api/meetings/${meetingId}/agenda`);
  const attendance = useFetch<{ members: { member_id: string; name: string }[] }>(own ? null : `/api/meetings/${meetingId}/attendance`);
  const [form, setForm] = useState({ member: '', agenda_item_id: '', interest: '', action: 'recused' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const items = (Array.isArray(agenda.data) ? agenda.data : (agenda.data as { agenda?: Row[] } | undefined)?.agenda ?? []).filter((a) => !a.hidden);
  const save = async () => {
    setBusy(true); setErrors({});
    try {
      await api.post(url, { ...(own ? {} : { member_id: form.member || undefined }), agenda_item_id: form.agenda_item_id || undefined, interest: form.interest, action: form.action });
      toast.success('Declaration recorded.');
      onSaved();
    } catch (err) { setErrors((err as { fields?: Record<string, string> }).fields ?? {}); toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  return (
    <Modal open title={own ? 'Declare an interest' : 'Record a declaration of interest'} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>{own ? 'Declare' : 'Record'}</Button></>}>
      <div className="stack">
        {!own && (
          <Select label="Member" required value={form.member} error={errors.member ?? errors.member_id}
            options={(attendance.data?.members ?? []).map((m) => ({ value: m.member_id, label: m.name }))} onChange={(v) => setForm((f) => ({ ...f, member: v }))} />
        )}
        <Select label="Agenda item" value={form.agenda_item_id} error={errors.agenda_item_id} placeholder="The whole meeting"
          options={[{ value: '', label: 'The whole meeting' }, ...items.map((a, i) => ({ value: String(a.id), label: `${i + 1}. ${a.title}` }))]}
          onChange={(v) => setForm((f) => ({ ...f, agenda_item_id: v }))} />
        <TextArea label="Interest" required value={form.interest} error={errors.interest} rows={3}
          hint="For example: a relative works for one of the bidders; owns shares in a supplier." onChange={(v) => setForm((f) => ({ ...f, interest: v }))} />
        <Select label="What they did" value={form.action} options={ACTIONS} error={errors.action} onChange={(v) => setForm((f) => ({ ...f, action: v || 'recused' }))}
          hint="A member who took no part or left the room is recorded as recused in the vote on that item." />
      </div>
    </Modal>
  );
}

/** Declarations of interest at a meeting, on its Agenda tab. */
export function DeclarationsCard({ meeting }: { meeting: Row }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<Declaration[]>(`/api/meetings/${meeting.id}/declarations`);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Declaration | null>(null);
  const canEdit = can('governance.edit') && meeting.status !== LOCKED && meeting.status !== 'canceled';
  return (
    <Card title="Declarations of interest" flush actions={canEdit && <Button size="sm" icon="plus" onClick={() => setAdding(true)}>Record a declaration</Button>}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <div className="gv-pad"><Loading lines={2} /></div>
        : data.length === 0 ? <EmptyState icon="user" title="No declarations" message="Record a member's interest in an item (or the whole meeting). A member who takes no part is recorded as recused when the item is voted on; members can declare their own interest from My committee meetings." />
        : (
          <TableWrap label="Declarations of interest">
            <table className="table">
              <thead><tr><th scope="col">Member</th><th scope="col">Item</th><th scope="col">Interest</th><th scope="col">What they did</th>{canEdit && <th scope="col"><span className="sr-only">Actions</span></th>}</tr></thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.id}>
                    <td>{d.name}</td>
                    <td>{d.item_title ?? <span className="muted">The whole meeting</span>}</td>
                    <td>{d.hidden ? <span className="muted">Closed session</span> : d.interest}</td>
                    <td><Badge color={d.action === 'stayed' ? 'gray' : 'amber'}>{d.action_label}</Badge></td>
                    {canEdit && <td><IconButton icon="x" size="sm" variant="ghost" label={`Remove the declaration of ${d.name}`} onClick={() => setRemoving(d)} /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      {adding && <DeclarationDialog meetingId={meeting.id} url={`/api/meetings/${meeting.id}/declarations`} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
      <ConfirmDialog open={!!removing} title="Remove this declaration?" message="Remove it only when it was recorded by mistake." danger confirmLabel="Remove"
        onConfirm={() => void (async () => {
          try { await api.del(`/api/meetings/${meeting.id}/declarations/${removing!.id}`); toast.success('Declaration removed.'); reload(); } catch (err) { toast.error(errorMessage(err)); }
          setRemoving(null);
        })()} onCancel={() => setRemoving(null)} />
    </Card>
  );
}

/** A member declares their own interest, from their member view of a meeting. */
export function DeclareOwnInterest({ meetingId, held }: { meetingId: string; held: boolean }) {
  const { data, error, reload } = useFetch<Declaration[]>(`/api/governance/my-meetings/${meetingId}/declarations`);
  const [open, setOpen] = useState(false);
  return (
    <Card title="Declarations of interest" actions={!held && <Button size="sm" onClick={() => setOpen(true)}>Declare an interest</Button>}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={2} />
        : data.length === 0 ? <p className="muted">No interests declared. If you have an interest in an item (a relative, a shareholding, a former employer), declare it before the meeting.</p>
        : <ul className="gv-papers">{data.map((d) => <li key={d.id}>{d.name}: {d.item_title ?? 'the whole meeting'}. {d.interest} <span className="muted">({d.action_label})</span></li>)}</ul>}
      {open && <DeclarationDialog meetingId={meetingId} own url={`/api/governance/my-meetings/${meetingId}/declarations`} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); reload(); }} />}
    </Card>
  );
}

interface StandingItem { id: string; title: string; months: number[]; presenter: string | null; session: string; on_agenda?: boolean; description?: string | null; taken?: { meeting_id: string; ref: string; month: number }[] }

/** The posting deadline and the work plan's standing items due at a meeting, above its agenda. */
export function StandingItems({ meeting, onAdded }: { meeting: Row; onAdded?: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<{ agenda_due_on: string | null; agenda_posting_days: number | null; agenda_late: boolean; standing_items: StandingItem[] }>(`/api/meetings/${meeting.id}/work-plan`);
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;
  const missing = data.standing_items.filter((s) => !s.on_agenda);
  const canEdit = can('governance.edit') && meeting.status !== LOCKED && meeting.status !== 'canceled';
  if (!data.agenda_due_on && !data.standing_items.length) return null;
  const add = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ added: number }>(`/api/meetings/${meeting.id}/agenda/from-work-plan`, {});
      toast.success(`${r.added} standing ${r.added === 1 ? 'item' : 'items'} added to the agenda.`);
      reload(); onAdded?.();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <div className="stack">
      {data.agenda_due_on && meeting.status === 'planned' && (
        <Notice tone={data.agenda_late ? 'warning' : 'info'} title={data.agenda_late ? `The agenda posting deadline passed on ${formatDate(data.agenda_due_on)}` : `Post the agenda by ${formatDate(data.agenda_due_on)}`}>
          The committee posts its agenda at least {data.agenda_posting_days} {data.agenda_posting_days === 1 ? 'day' : 'days'} before a meeting. Publish the agenda when it is ready.
        </Notice>
      )}
      {missing.length > 0 && (
        <Notice tone="info" title={`${missing.length} standing ${missing.length === 1 ? 'item' : 'items'} of the work plan due at this meeting`}>
          <p>{missing.map((s) => s.title).join('; ')}.</p>
          {canEdit && <Button size="sm" loading={busy} onClick={() => void add()}>Add them to the agenda</Button>}
        </Notice>
      )}
    </div>
  );
}

function PlanItemDialog({ committeeId, item, onClose, onSaved }: { committeeId: string; item: StandingItem | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ title: item?.title ?? '', description: item?.description ?? '', presenter: item?.presenter ?? '', months: (item?.months ?? []).map(String), session: item?.session ?? 'open' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErrors({});
    const body = { ...form, months: form.months.map(Number) };
    try {
      if (item) await api.patch(`/api/committees/${committeeId}/work-plan/${item.id}`, body); else await api.post(`/api/committees/${committeeId}/work-plan`, body);
      toast.success('Work plan saved.');
      onSaved();
    } catch (err) { setErrors((err as { fields?: Record<string, string> }).fields ?? {}); toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  return (
    <Modal open title={item ? 'Change a standing item' : 'Add a standing item'} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Save</Button></>}>
      <div className="stack">
        <TextField label="Title" required value={form.title} error={errors.title} onChange={(v) => setForm((f) => ({ ...f, title: v }))} />
        <ChoicesField label="Months" value={form.months} error={errors.months} hint="None: at every meeting."
          options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} onChange={(v) => setForm((f) => ({ ...f, months: v }))} />
        <TextField label="Presenter" value={form.presenter} onChange={(v) => setForm((f) => ({ ...f, presenter: v }))} />
        <Select label="Session" value={form.session} options={[{ value: 'open', label: 'Open session' }, { value: 'closed', label: 'Closed session' }]} onChange={(v) => setForm((f) => ({ ...f, session: v || 'open' }))} />
        <TextArea label="Notes for the agenda" value={form.description} onChange={(v) => setForm((f) => ({ ...f, description: v }))} />
      </div>
    </Modal>
  );
}

/** A committee's annual work plan, on its page: standing items by month and which meetings took them. */
export function WorkPlanCard({ committee }: { committee: Row }) {
  const { can } = useAuth();
  const toast = useToast();
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, error, reload } = useFetch<{ items: StandingItem[]; meetings: { id: string; ref: string; month: number }[]; agenda_posting_days: number | null; can_edit: boolean }>(`/api/committees/${committee.id}/work-plan?year=${year}`);
  const [editing, setEditing] = useState<StandingItem | 'new' | null>(null);
  const canEdit = can('governance.edit');
  const remove = async (s: StandingItem) => {
    try { await api.del(`/api/committees/${committee.id}/work-plan/${s.id}`); toast.success('Standing item removed.'); reload(); } catch (err) { toast.error(errorMessage(err)); }
  };
  return (
    <Card title="Annual work plan" flush actions={(
      <div className="row">
        <Select label="Year" hideLabel value={String(year)} options={[-1, 0, 1].map((d) => ({ value: String(new Date().getFullYear() + d), label: String(new Date().getFullYear() + d) }))}
          onChange={(v) => setYear(Number(v) || year)} />
        {canEdit && <Button size="sm" icon="plus" onClick={() => setEditing('new')}>Add a standing item</Button>}
      </div>
    )}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <div className="gv-pad"><Loading lines={3} /></div>
        : (
          <>
            <p className="gv-pad muted">
              {data.agenda_posting_days === null ? 'No agenda posting deadline is set for this committee (change the committee to set one).'
                : `Agendas are posted at least ${data.agenda_posting_days} days before each meeting; the secretary is reminded.`}
            </p>
            {data.items.length === 0 ? <EmptyState icon="calendar" title="No standing items" message="Add what the committee takes every year, such as the budget, the audit plan or the risk register review, with the months it is due." />
              : (
                <TableWrap label="Annual work plan">
                  <table className="table">
                    <thead><tr><th scope="col">Standing item</th><th scope="col">Due</th><th scope="col">Taken in {year}</th>{canEdit && <th scope="col"><span className="sr-only">Actions</span></th>}</tr></thead>
                    <tbody>
                      {data.items.map((s) => (
                        <tr key={s.id}>
                          <td>{s.title}{s.presenter && <span className="muted"> · {s.presenter}</span>}</td>
                          <td>{s.months.length ? s.months.map((m) => MONTHS[m - 1].slice(0, 3)).join(', ') : 'Every meeting'}</td>
                          <td>{s.taken?.length ? s.taken.map((x) => x.ref).join(', ') : <span className="muted">Not yet</span>}</td>
                          {canEdit && (
                            <td className="gv-actions">
                              <Button size="sm" variant="ghost" aria-label={`Change: ${s.title}`} onClick={() => setEditing(s)}>Change</Button>
                              <Button size="sm" variant="ghost" aria-label={`Remove: ${s.title}`} onClick={() => void remove(s)}>Remove</Button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}
          </>
        )}
      {editing && <PlanItemDialog committeeId={committee.id} item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </Card>
  );
}
