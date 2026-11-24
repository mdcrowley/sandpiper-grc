// Meetings: the list, and one meeting with its agenda, frozen pack, attendance, minutes, decisions
// and the actions agreed.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Button, Card, ConfirmDialog, EditableSummary, EmptyState, errorMessage, ErrorState, formatDateTime, IconButton, Loading,
  LookupChip, LookupSelect, Modal, PageHeader, RecordPage, RecordPicker, ResourceList, Select, Stepper, TableWrap, TextArea, TextField, useAuth,
  useFetch, useMeta, useResource, useLookup, useToast,
} from '../../core';
import type { RecordContext, Row } from '../../core';
import { canMoveTo, editableLifecycle } from '../../core/lifecycleMenus';
import { WaitingApprovals } from './Committees';
import { GovernanceTabs, MeetingActions, RecordName, type NamedRecord } from './shared';

export function MeetingList() {
  return (
    <div className="stack">
      <PageHeader title="Meetings" subtitle="Committee meetings: agenda, the pack sent out, who attended, minutes and decisions." />
      <GovernanceTabs active="meetings" />
      <ResourceList
        type="meeting"
        urlState
        columns={['ref', 'title', 'committee_id', 'scheduled_at', 'status', 'quorum_met', { field: 'location', hidden: true }, { field: 'chair_id', hidden: true }]}
        filters={['committee_id', 'status', 'scheduled_at', 'quorum_met']}
        createFields={['committee_id', 'title', 'scheduled_at', 'duration_minutes', 'location']}
      />
    </div>
  );
}

const STEPS = [
  { key: 'planned', label: 'Planned' },
  { key: 'agenda_published', label: 'Agenda published' },
  { key: 'held', label: 'Held' },
  { key: 'minutes_approved', label: 'Minutes approved' },
];
const LOCKED = 'minutes_approved';

function Actions({ row, save, canEdit, reload }: RecordContext) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const lifecycle = editableLifecycle(useResource('meeting')?.lifecycle, 'status');
  const values = useLookup('meeting_status').map((v) => v.value);
  const may = (to: string) => canMoveTo(lifecycle, row.status, to, values);
  if (!canEdit || row.status === LOCKED || row.status === 'canceled') return null;
  const move = async (status: string, done: string) => {
    setBusy(true);
    try { await save({ status }); toast.success(done); } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const submit = async () => {
    setBusy(true);
    try { await api.post(`/api/meetings/${row.id}/minutes/submit`); toast.success('Minutes sent to the chair for approval.'); reload(); }
    catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  const before = row.status === 'planned' || row.status === 'agenda_published';
  return (
    <>
      {row.status === 'planned' && may('agenda_published') && <Button loading={busy} onClick={() => move('agenda_published', 'Agenda published.')}>Publish agenda</Button>}
      {before && may('held') && <Button loading={busy} onClick={() => move('held', 'Meeting marked as held.')}>Mark as held</Button>}
      {row.status === 'held' && <Button variant="primary" loading={busy} onClick={submit}>Submit minutes for approval</Button>}
      {before && may('canceled') && <Button variant="ghost" onClick={() => setCanceling(true)}>Cancel meeting</Button>}
      <ConfirmDialog open={canceling} title="Cancel this meeting?" message="The meeting will be marked as canceled. Its agenda and pack are kept." confirmLabel="Cancel meeting" danger busy={busy}
        onConfirm={async () => { await move('canceled', 'Meeting canceled.'); setCanceling(false); }} onCancel={() => setCanceling(false)} />
    </>
  );
}

// ---------- invitations (E41-17) ----------

interface InvitationsView { invited_at: string | null; sequence: number; mail: boolean; invitees: { name: string; reachable: boolean; how: 'account' | 'roster' | null }[] }

/** Who the calendar invitation goes to, and sending it (again after a change, or a cancellation). */
function Invitations({ meeting, onChanged }: { meeting: Row; onChanged: () => void }) {
  const toast = useToast();
  const { can } = useAuth();
  const { data, error, reload } = useFetch<InvitationsView>(`/api/meetings/${meeting.id}/invitations`);
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={4} />;
  const canceled = meeting.status === 'canceled';
  const past = new Date(meeting.scheduled_at).getTime() < Date.now();
  const reachable = data.invitees.filter((i) => i.reachable).length;
  const mayEmail = can('governance.edit') && data.mail && reachable > 0 && meeting.status !== LOCKED
    && (canceled ? Boolean(data.invited_at) : !past);
  const label = canceled ? 'Email the cancellation' : data.invited_at ? 'Email the updated invitation' : 'Email invitations';
  const send = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ invited: number }>(`/api/meetings/${meeting.id}/invitations`, {});
      toast.success(`${canceled ? 'Cancellation' : 'Invitation'} emailed to ${r.invited} ${r.invited === 1 ? 'member' : 'members'}.`);
      reload(); onChanged();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Card
      title="Invitations"
      flush
      actions={(
        <>
          <a className="btn btn-sm" href={`/api/meetings/${meeting.id}/invitation.ics`} download>Download calendar file</a>
          {mayEmail && <Button size="sm" variant="primary" loading={busy} onClick={() => void send()}>{label}</Button>}
        </>
      )}
    >
      <div className="gv-pad stack">
        <p className="muted">
          Members in office on the day of the meeting are emailed the meeting as a calendar file that adds it to their calendar.
          After a change of time or place, email it again: their calendars update the same event. Once the meeting is canceled, email the
          cancellation to take it off their calendars. {data.invited_at ? `Last emailed ${formatDateTime(data.invited_at)}.` : 'Not emailed yet.'}
        </p>
        {!data.mail && <p className="notice notice-warn">Email is not set up, so invitations cannot be emailed. Download the calendar file and send it yourself.</p>}
      </div>
      <TableWrap label="Who is invited">
        <table className="table">
          <thead><tr><th scope="col">Member</th><th scope="col">Invitation</th></tr></thead>
          <tbody>
            {data.invitees.length === 0 && <tr><td colSpan={2} className="muted">The committee has no members in office on the day.</td></tr>}
            {data.invitees.map((i, n) => (
              <tr key={`${i.name}-${n}`}>
                <td>{i.name}</td>
                <td>{i.reachable ? (i.how === 'roster' ? 'By email (staff roster address)' : 'By email') : <span className="muted">No email address: tell them yourself</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  );
}

// ---------- agenda ----------

interface AgendaItem { id: string; sort: number; title: string; presenter: string | null; notes: string | null; record_type: string | null; record_id: string | null; record: NamedRecord | null; workflow_kind: string | null; workflow: { name: string; status: string; label: string } | null }

/** Record types the person may pick from: those with a page, sorted by name. */
function useRecordTypes(): { value: string; label: string }[] {
  const { resources } = useMeta();
  const { can } = useAuth();
  return Object.entries(resources).filter(([, r]) => r.route && can(`${r.module}.view`)).map(([type, r]) => ({ value: type, label: r.label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function AgendaDialog({ meetingId, item, onClose, onSaved }: { meetingId: string; item: AgendaItem | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const types = useRecordTypes();
  const [form, setForm] = useState({ title: item?.title ?? '', presenter: item?.presenter ?? '', notes: item?.notes ?? '', record_type: item?.record_type ?? '', record_id: item?.record_id ?? null as string | null });
  const [start] = useState(form);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));
  const save = async () => {
    setBusy(true); setErrors({});
    const body: Record<string, unknown> = { title: form.title, presenter: form.presenter, notes: form.notes };
    if (!item || form.record_type !== (item.record_type ?? '') || form.record_id !== item.record_id) {
      body.record_type = form.record_type && form.record_id ? form.record_type : null;
      body.record_id = form.record_type && form.record_id ? form.record_id : null;
    }
    try {
      if (item) await api.patch(`/api/meetings/${meetingId}/agenda/${item.id}`, body); else await api.post(`/api/meetings/${meetingId}/agenda`, body);
      toast.success(item ? 'Agenda item saved.' : 'Agenda item added.');
      onSaved();
    } catch (err) { setErrors((err as { fields?: Record<string, string> }).fields ?? {}); toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  return (
    <Modal open title={item ? 'Change agenda item' : 'Add an agenda item'} onClose={onClose} dirty={JSON.stringify(form) !== JSON.stringify(start)}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>{item ? 'Save' : 'Add'}</Button></>}>
      <div className="form-grid">
        <TextField className="form-cell-wide" label="Title" required value={form.title} error={errors.title} onChange={(v) => set({ title: v })} />
        <TextField label="Presenter" value={form.presenter} onChange={(v) => set({ presenter: v })} />
        <Select label="About a record of type" value={form.record_type} options={types} onChange={(v) => set({ record_type: v, record_id: null })} />
        {form.record_type && <RecordPicker className="form-cell-wide" label="Record" type={form.record_type} value={form.record_id} error={errors.record_id} onChange={(id) => set({ record_id: id })} />}
        <TextArea className="form-cell-wide" label="Notes" value={form.notes} onChange={(v) => set({ notes: v })} />
      </div>
    </Modal>
  );
}

function Agenda({ meeting }: { meeting: Row }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<AgendaItem[]>(`/api/meetings/${meeting.id}/agenda`);
  const [editing, setEditing] = useState<AgendaItem | 'new' | null>(null);
  const [picking, setPicking] = useState(false);
  const [removing, setRemoving] = useState<AgendaItem | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = can('governance.edit') && meeting.status !== LOCKED && meeting.status !== 'canceled';
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await fn(); toast.success(done); reload(); } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const move = (i: number, by: number) => {
    if (!data) return;
    const ids = data.map((x) => x.id);
    [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
    void run(() => api.put(`/api/meetings/${meeting.id}/agenda/order`, { ids }), 'Agenda reordered.');
  };
  return (
    <Card title="Agenda" flush actions={canEdit && (
      <div className="row">
        <Button size="sm" onClick={() => setPicking(true)}>Add a waiting approval</Button>
        <Button size="sm" icon="plus" onClick={() => setEditing('new')}>Add an item</Button>
      </div>
    )}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <div className="gv-pad"><Loading lines={3} /></div>
        : data.length === 0 ? <EmptyState icon="clipboard" title="No agenda yet" message="Add the items to discuss, and the approvals waiting for the chair's decision." />
        : (
          <ol className="gv-agenda">
            {data.map((a, i) => (
              <li key={a.id} className="gv-agenda-item">
                <div className="gv-agenda-main">
                  <strong>{i + 1}. {a.title}</strong>
                  {a.presenter && <span className="muted"> · {a.presenter}</span>}
                  {a.record && <div><RecordName record={a.record} /></div>}
                  {a.workflow && <div className="muted">Waiting approval: {a.workflow.label} ({a.workflow.status === 'running' ? 'waiting' : a.workflow.status})</div>}
                  {a.notes && <div className="prose muted">{a.notes}</div>}
                </div>
                {canEdit && (
                  <div className="gv-actions">
                    <IconButton icon="arrow-up" label={`Move "${a.title}" up`} size="sm" variant="ghost" disabled={i === 0 || busy} onClick={() => move(i, -1)} />
                    <IconButton icon="arrow-down" label={`Move "${a.title}" down`} size="sm" variant="ghost" disabled={i === data.length - 1 || busy} onClick={() => move(i, 1)} />
                    <Button size="sm" variant="ghost" aria-label={`Change: ${a.title}`} onClick={() => setEditing(a)}>Change</Button>
                    <Button size="sm" variant="ghost" aria-label={`Remove: ${a.title}`} onClick={() => setRemoving(a)}>Remove</Button>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      {editing && <AgendaDialog meetingId={meeting.id} item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      <Modal open={picking} title="Approvals waiting for the chair" size="lg" onClose={() => setPicking(false)} footer={<Button onClick={() => setPicking(false)}>Close</Button>}>
        <WaitingApprovals committeeId={meeting.committee_id} picking={busy} onPick={(w) => void run(async () => {
          await api.post(`/api/meetings/${meeting.id}/agenda`, { title: `${w.kind_label}: ${w.ref ? `${w.ref} ` : ''}${w.label}`, record_type: w.record_type, record_id: w.record_id, workflow_kind: w.kind });
          setPicking(false);
        }, 'Added to the agenda.')} />
      </Modal>
      <ConfirmDialog open={!!removing} title="Remove this agenda item?" message={`"${removing?.title ?? ''}" will be removed from the agenda.`} danger busy={busy} confirmLabel="Remove"
        onConfirm={() => void run(async () => { await api.del(`/api/meetings/${meeting.id}/agenda/${removing!.id}`); setRemoving(null); }, 'Agenda item removed.')}
        onCancel={() => setRemoving(null)} />
    </Card>
  );
}

// ---------- pack ----------

interface PackState { snapshot: { id: string; title: string; created_at: string; restricted: boolean } | null; frozen_at: string | null }

function Pack({ meeting }: { meeting: Row }) {
  const { can, areaOn } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<PackState>(`/api/meetings/${meeting.id}/pack`);
  const reports = areaOn('reports') && can('reports.view');
  const packs = useFetch<{ rows: Row[] }>(reports && can('reports.export') ? '/api/report-packs?pageSize=200&sort=name' : null);
  const [packId, setPackId] = useState('');
  const [busy, setBusy] = useState(false);
  const canFreeze = reports && can('reports.export') && can('governance.edit') && meeting.status !== LOCKED && meeting.status !== 'canceled';
  const freeze = async () => {
    setBusy(true);
    try { await api.post(`/api/meetings/${meeting.id}/freeze-pack`, { pack_id: packId }); toast.success('Pack frozen for this meeting.'); reload(); }
    catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={3} />;
  return (
    <div className="stack">
      <Card title="Meeting pack">
        {data.snapshot ? (
          <p>
            {reports ? <Link to={`/reports/snapshots/${data.snapshot.id}`}>{data.snapshot.title}</Link> : data.snapshot.title}
            <span className="muted"> · frozen {formatDateTime(data.frozen_at ?? data.snapshot.created_at)}{data.snapshot.restricted ? ' · includes restricted records' : ''}</span>
          </p>
        ) : <p className="muted">No pack has been frozen for this meeting yet. Freezing keeps the figures exactly as they were sent to the members.</p>}
      </Card>
      {canFreeze && (
        <Card title={data.snapshot ? 'Freeze again' : 'Freeze a pack'}>
          <div className="form-grid">
            <Select label="Report pack" value={packId} onChange={setPackId}
              options={(packs.data?.rows ?? []).map((p) => ({ value: String(p.id), label: String(p.name) }))} hint="The pack is produced now, with your permissions, and kept with the meeting." />
          </div>
          <div className="form-actions"><Button variant="primary" loading={busy} disabled={!packId} onClick={freeze}>Freeze pack</Button></div>
        </Card>
      )}
    </div>
  );
}

// ---------- attendance ----------

interface Attendance { members: { member_id: string; name: string; side: string | null; role: string; voting: boolean; present: boolean; apology: boolean }[]; quorum: { voting: number; present: number; needed: number; met: boolean | null } }

function AttendanceTab({ meeting, onChanged }: { meeting: Row; onChanged: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<Attendance>(`/api/meetings/${meeting.id}/attendance`);
  const [marks, setMarks] = useState<Record<string, { present: boolean; apology: boolean }>>({});
  const [busy, setBusy] = useState(false);
  const canEdit = can('governance.edit') && meeting.status !== LOCKED && meeting.status !== 'canceled';
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={3} />;
  const value = (id: string) => marks[id] ?? data.members.find((m) => m.member_id === id)!;
  const dirty = Object.keys(marks).length > 0;
  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/api/meetings/${meeting.id}/attendance`, { attendance: Object.entries(marks).map(([member_id, v]) => ({ member_id, ...v })) });
      toast.success('Attendance saved.'); setMarks({}); reload(); onChanged();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const q = data.quorum;
  return (
    <Card title="Attendance" flush actions={canEdit && <Button size="sm" variant="primary" loading={busy} disabled={!dirty} onClick={save}>Save attendance</Button>}>
      <p className={`gv-pad notice ${q.met === false ? 'notice-warn' : q.met ? 'notice-success' : ''}`}>
        {q.met === null ? `Quorum: ${q.needed} of ${q.voting} voting members must be present. No attendance recorded yet.`
          : `${q.present} of ${q.voting} voting members present; ${q.needed} needed. Quorum ${q.met ? 'met' : 'not met'}.`}
      </p>
      {data.members.length === 0 ? <EmptyState icon="users" title="No members in office" message="Add members to the committee first." /> : (
        <TableWrap label="Attendance">
          <table className="table">
            <caption className="sr-only">Attendance</caption>
            <thead><tr><th scope="col">Member</th><th scope="col">Side</th><th scope="col">Votes</th><th scope="col">Present</th><th scope="col">Apologies</th></tr></thead>
            <tbody>
              {data.members.map((m) => {
                const v = value(m.member_id);
                return (
                  <tr key={m.member_id}>
                    <td>{m.name}</td>
                    <td>{m.side ? <LookupChip list="committee_side" value={m.side} /> : <span className="muted">None</span>}</td>
                    <td>{m.voting ? 'Yes' : 'No'}</td>
                    <td><input type="checkbox" className="gv-check" aria-label={`${m.name} present`} checked={v.present} disabled={!canEdit}
                      onChange={(e) => { const c = e.target.checked; setMarks((s) => ({ ...s, [m.member_id]: { present: c, apology: c ? false : v.apology } })); }} /></td>
                    <td><input type="checkbox" className="gv-check" aria-label={`${m.name} sent apologies`} checked={v.apology} disabled={!canEdit || v.present}
                      onChange={(e) => { const c = e.target.checked; setMarks((s) => ({ ...s, [m.member_id]: { present: v.present, apology: c } })); }} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}

// ---------- decisions ----------

interface Decision { id: string; ref: string; title: string; outcome: string; record_type: string | null; record_id: string | null; agenda_item_id: string | null; applied_to_workflow: string | null; applied_at: string | null; record: NamedRecord | null }

function DecisionDialog({ meeting, onClose, onSaved }: { meeting: Row; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const types = useRecordTypes();
  const agenda = useFetch<AgendaItem[]>(`/api/meetings/${meeting.id}/agenda`);
  const [form, setForm] = useState({ title: '', outcome: 'approved', notes: '', agenda_item_id: '', record_type: '', record_id: null as string | null });
  const [start] = useState(form);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));
  const pickItem = (id: string) => {
    const item = agenda.data?.find((a) => a.id === id);
    set({ agenda_item_id: id, ...(item?.record_type && !item.record?.hidden ? { record_type: item.record_type, record_id: item.record_id } : {}), ...(form.title ? {} : { title: item?.title ?? '' }) });
  };
  const save = async () => {
    setBusy(true); setErrors({});
    try {
      await api.post('/api/meeting-decisions', {
        meeting_id: meeting.id, title: form.title, outcome: form.outcome, notes: form.notes || null, agenda_item_id: form.agenda_item_id || null,
        record_type: form.record_type && form.record_id ? form.record_type : null, record_id: form.record_type && form.record_id ? form.record_id : null,
      });
      toast.success('Decision recorded.');
      onSaved();
    } catch (err) { setErrors((err as { fields?: Record<string, string> }).fields ?? {}); toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  return (
    <Modal open title="Record a decision" onClose={onClose} dirty={JSON.stringify(form) !== JSON.stringify(start)}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Record</Button></>}>
      <div className="form-grid">
        <Select className="form-cell-wide" label="Agenda item" value={form.agenda_item_id} onChange={pickItem}
          options={(agenda.data ?? []).map((a, i) => ({ value: a.id, label: `${i + 1}. ${a.title}` }))} />
        <TextField className="form-cell-wide" label="Decision" required value={form.title} error={errors.title} onChange={(v) => set({ title: v })} />
        <LookupSelect label="Outcome" list="decision_outcome" required value={form.outcome} onChange={(v) => set({ outcome: v || 'approved' })} />
        <Select label="About a record of type" value={form.record_type} options={types} onChange={(v) => set({ record_type: v, record_id: null })} />
        {form.record_type && <RecordPicker className="form-cell-wide" label="Record decided" type={form.record_type} value={form.record_id} error={errors.record_id} onChange={(id) => set({ record_id: id })} />}
        <TextArea className="form-cell-wide" label="Notes" value={form.notes} onChange={(v) => set({ notes: v })} />
      </div>
    </Modal>
  );
}

/** Who may apply a decision to a waiting approval: the chair, or the secretary once the minutes are approved. */
export function mayApply(meeting: Row | undefined, userId: string | undefined, canEdit: boolean): boolean {
  if (!meeting || !userId) return false;
  if (meeting.chair_id === userId) return meeting.status === 'held' || meeting.status === LOCKED;
  return meeting.secretary_id === userId && canEdit && meeting.status === LOCKED;
}

export function ApplyButton({ decisionId, onApplied }: { decisionId: string; onApplied: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const apply = async () => {
    setBusy(true);
    try { await api.post(`/api/meeting-decisions/${decisionId}/apply`); toast.success('Applied to the waiting approval.'); setOpen(false); onApplied(); }
    catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>Apply to approval</Button>
      <ConfirmDialog open={open} title="Apply this decision?" confirmLabel="Apply" busy={busy} onConfirm={apply} onCancel={() => setOpen(false)}
        message="The step waiting on the record will be decided as the chair's own decision, as recorded at this meeting. This cannot be undone." />
    </>
  );
}

function Decisions({ meeting }: { meeting: Row }) {
  const { can, user } = useAuth();
  const { data, error, reload } = useFetch<Decision[]>(`/api/meetings/${meeting.id}/decisions`);
  const [adding, setAdding] = useState(false);
  const canAdd = can('governance.create') && meeting.status !== LOCKED && meeting.status !== 'canceled';
  const applies = mayApply(meeting, user?.id, can('governance.edit'));
  return (
    <Card title="Decisions" flush actions={canAdd && <Button size="sm" icon="plus" onClick={() => setAdding(true)}>Record a decision</Button>}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <div className="gv-pad"><Loading lines={3} /></div>
        : data.length === 0 ? <EmptyState icon="check-square" title="No decisions recorded" message="Record each decision the committee takes, and the record it is about." />
        : (
          <TableWrap label="Decisions taken at this meeting">
            <table className="table">
              <caption className="sr-only">Decisions taken at this meeting</caption>
              <thead><tr><th scope="col">Decision</th><th scope="col">Outcome</th><th scope="col">Record</th><th scope="col">Approval</th></tr></thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.id}>
                    <td><Link className="row-title" to={`/governance/decisions/${d.id}`}><span className="ref">{d.ref}</span> {d.title}</Link></td>
                    <td><LookupChip list="decision_outcome" value={d.outcome} /></td>
                    <td><RecordName record={d.record} /></td>
                    <td>
                      {d.applied_at ? <span>{d.applied_to_workflow}</span>
                        : applies && d.record && !d.record.hidden && (d.outcome === 'approved' || d.outcome === 'rejected')
                          ? <ApplyButton decisionId={d.id} onApplied={reload} /> : <span className="muted">Not applied</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      {adding && <DecisionDialog meeting={meeting} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </Card>
  );
}

export function MeetingDetail() {
  return (
    <RecordPage
      type="meeting"
      banner={({ row }) => (
        <div className="stack">
          {row.status === 'canceled' && <p className="notice notice-warn">This meeting was canceled.</p>}
          {row.status === LOCKED && <p className="notice notice-success">The chair approved the minutes: the meeting is locked.</p>}
          {row.status !== 'canceled' && <Stepper label="Progress" current={row.status} steps={STEPS} />}
        </div>
      )}
      actions={(rec) => <Actions {...rec} />}
      summary={({ row, reload }) => (
        <EditableSummary type="meeting" row={row} onSaved={reload} title="Meeting" editable={row.status === LOCKED ? false : undefined}
          fields={['title', 'committee_id', 'scheduled_at', 'duration_minutes', 'location', 'chair_id', 'secretary_id', 'quorum_met', 'invited_at']} />
      )}
      tabs={[
        { key: 'agenda', label: 'Agenda', content: ({ row }) => <Agenda meeting={row} /> },
        { key: 'pack', label: 'Pack', content: ({ row }) => <Pack meeting={row} /> },
        { key: 'invitations', label: 'Invitations', content: ({ row, reload }) => <Invitations meeting={row} onChanged={reload} /> },
        { key: 'attendance', label: 'Attendance', content: ({ row, reload }) => <AttendanceTab meeting={row} onChanged={reload} /> },
        {
          key: 'minutes', label: 'Minutes', content: ({ row, reload }) => (
            <EditableSummary type="meeting" row={row} onSaved={reload} title="Minutes" fields={['minutes']} editable={row.status === LOCKED ? false : undefined} />
          ),
        },
        { key: 'decisions', label: 'Decisions', content: ({ row }) => <Decisions meeting={row} /> },
        { key: 'actions', label: 'Actions', content: ({ row }) => <MeetingActions meetingId={row.id} /> },
      ]}
    />
  );
}
