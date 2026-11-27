// The board book side of a meeting (wave 25): the agenda with presenters, time allotted, open or
// closed session, the consent agenda and each item's papers; minutes written per item with the
// motions (mover, seconder, vote, result, resolution number); the minutes approved at a later meeting
// and published; and the board book and minutes as PDFs.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, errorMessage, ErrorState, formatDate, formatDateTime, IconButton, Loading,
  LookupChip, LookupSelect, Modal, Notice, NumberField, RecordPicker, Select, TableWrap, TextArea, TextField, useAuth, useFetch, useMeta,
  UserPicker, useToast, useUnsavedChanges,
} from '../../core';
import type { Row } from '../../core';
import { WaitingApprovals } from './Committees';
import { RecordName, type NamedRecord } from './shared';

const LOCKED = 'minutes_approved';

export interface Paper {
  id: string; kind: 'file' | 'document' | 'record'; attachment_id?: string; file_name?: string; extension?: string; link?: boolean;
  record?: NamedRecord; version?: { label: string; effective_on: string | null } | null; hidden?: boolean; missing?: boolean;
}
export interface AgendaItem {
  id: string; sort: number; title: string; presenter: string | null; presenter_id: string | null; presenter_label: string | null;
  notes: string | null; discussion: string | null; session: 'open' | 'closed'; consent: boolean; minutes_allotted: number | null;
  record_type: string | null; record_id: string | null; record: NamedRecord | null; workflow_kind: string | null;
  workflow: { name: string; status: string; label: string } | null; papers: Paper[]; hidden?: boolean;
}
export interface Motion {
  id: string; ref: string; title: string; outcome: string; agenda_item_id: string | null; motion_text: string | null; notes: string | null;
  resolution_number: string | null; mover_name: string | null; mover_member_id: string | null; seconder_name: string | null; seconder_member_id: string | null;
  vote_mode: 'members' | 'counts' | null; votes_for: number | null; votes_against: number | null; votes_abstain: number | null; votes_absent: number | null;
  vote_summary: string | null; closed_session: boolean; consent_agenda: boolean; record: NamedRecord | null; record_type: string | null; record_id: string | null;
  votes: { member_id: string; name: string; vote: Vote }[]; applied_at: string | null; applied_to_workflow: string | null;
}
type Vote = 'for' | 'against' | 'abstain' | 'absent';
const VOTES: { value: Vote; label: string }[] = [
  { value: 'for', label: 'For' }, { value: 'against', label: 'Against' }, { value: 'abstain', label: 'Abstain' }, { value: 'absent', label: 'Absent' },
];
interface AttendanceRow { member_id: string; name: string; voting: boolean; present: boolean; apology: boolean }

/** Record types the person may pick from: those with a page, sorted by name. */
export function useRecordTypes(): { value: string; label: string }[] {
  const { resources } = useMeta();
  const { can } = useAuth();
  return Object.entries(resources).filter(([, r]) => r.route && can(`${r.module}.view`)).map(([type, r]) => ({ value: type, label: r.label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** A paper as a line: the file's name, the document with its version, or the record. */
export function PaperName({ paper, href }: { paper: Paper; href?: string }) {
  if (paper.hidden) return <span className="muted">A paper you cannot see</span>;
  if (paper.missing) return <span className="muted">A file since removed from the meeting</span>;
  if (paper.kind === 'file') {
    return href ? <a href={href} download>{paper.file_name}</a> : <span>{paper.file_name}{paper.link ? <span className="muted"> (link)</span> : null}</span>;
  }
  return (
    <span>
      <RecordName record={paper.record} />
      {paper.kind === 'document' && <span className="muted"> · {paper.version ? `${paper.version.label}${paper.version.effective_on ? `, effective ${formatDate(paper.version.effective_on)}` : ''}` : 'no version in force'}</span>}
    </span>
  );
}

/** The session and consent marks of an item. */
export function ItemMarks({ item }: { item: Pick<AgendaItem, 'session' | 'consent' | 'minutes_allotted'> }) {
  return (
    <>
      {item.session === 'closed' && <Badge color="purple">Closed session</Badge>}
      {item.consent && <Badge color="teal">Consent agenda</Badge>}
      {item.minutes_allotted ? <span className="muted gv-time">{item.minutes_allotted} min</span> : null}
    </>
  );
}

// ---------- agenda ----------

function AgendaDialog({ meetingId, item, onClose, onSaved }: { meetingId: string; item: AgendaItem | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const types = useRecordTypes();
  const [form, setForm] = useState({
    title: item?.title ?? '', presenter: item?.presenter ?? '', presenter_id: item?.presenter_id ?? null as string | null, notes: item?.notes ?? '',
    session: item?.session ?? 'open', consent: item?.consent ?? false, minutes_allotted: item?.minutes_allotted ?? null as number | null,
    record_type: item?.record_type ?? '', record_id: item?.record_id ?? null as string | null,
  });
  const [start] = useState(form);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));
  const save = async () => {
    setBusy(true); setErrors({});
    const body: Record<string, unknown> = {
      title: form.title, presenter: form.presenter, presenter_id: form.presenter_id, notes: form.notes,
      session: form.session, consent: form.consent, minutes_allotted: form.minutes_allotted,
    };
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
        <UserPicker label="Presenter (account)" value={form.presenter_id} display={item?.presenter_id ? item.presenter_label ?? undefined : undefined} error={errors.presenter_id}
          onChange={(id) => set({ presenter_id: id })} />
        <TextField label="Presenter (name)" value={form.presenter} hint="For a presenter with no account." onChange={(v) => set({ presenter: v })} />
        <NumberField label="Time allotted (minutes)" value={form.minutes_allotted} min={1} max={600} step={1} error={errors.minutes_allotted} onChange={(v) => set({ minutes_allotted: v })} />
        <Select label="Session" value={form.session} error={errors.session}
          options={[{ value: 'open', label: 'Open session' }, { value: 'closed', label: 'Closed (executive) session' }]}
          hint="Closed-session items are read only by the committee's members and the people who prepare its meetings."
          onChange={(v) => set({ session: (v || 'open') as 'open' | 'closed', ...(v === 'closed' ? { consent: false } : {}) })} />
        <Checkbox className="form-cell-wide" label="On the consent agenda (adopted together, without discussion)" checked={form.consent} error={errors.consent}
          disabled={form.session === 'closed'} onChange={(v) => set({ consent: v })} />
        <Select label="About a record of type" value={form.record_type} options={types} onChange={(v) => set({ record_type: v, record_id: null })} />
        {form.record_type && <RecordPicker className="form-cell-wide" label="Record" type={form.record_type} value={form.record_id} error={errors.record_id} onChange={(id) => set({ record_id: id })} />}
        <TextArea className="form-cell-wide" label="Notes for the members" value={form.notes} onChange={(v) => set({ notes: v })} />
      </div>
    </Modal>
  );
}

function PaperDialog({ meetingId, item, onClose, onSaved }: { meetingId: string; item: AgendaItem; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { resources } = useMeta();
  const types = useRecordTypes();
  const files = useFetch<{ rows: Row[] }>(`/api/attachments?record_type=meeting&record_id=${meetingId}`);
  const library = Boolean(resources.policy);
  const [kind, setKind] = useState<'file' | 'document' | 'record'>('file');
  const [attachmentId, setAttachmentId] = useState('');
  const [recordType, setRecordType] = useState('');
  const [recordId, setRecordId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErrors({});
    try {
      await api.post(`/api/meetings/${meetingId}/agenda/${item.id}/papers`,
        kind === 'file' ? { kind, attachment_id: attachmentId } : kind === 'document' ? { kind, record_id: recordId } : { kind, record_type: recordType, record_id: recordId });
      toast.success('Paper added.');
      onSaved();
    } catch (err) { setErrors((err as { fields?: Record<string, string> }).fields ?? {}); toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  const kinds = [{ value: 'file', label: 'A file attached to this meeting' }, ...(library ? [{ value: 'document', label: 'A controlled document from the library' }] : []), { value: 'record', label: 'Another record' }];
  return (
    <Modal open title={`Add a paper to "${item.title}"`} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Add</Button></>}>
      <div className="form-grid">
        <Select className="form-cell-wide" label="Paper" value={kind} options={kinds} onChange={(v) => { setKind((v || 'file') as typeof kind); setRecordId(null); }} />
        {kind === 'file' && (
          <Select className="form-cell-wide" label="File" value={attachmentId} error={errors.attachment_id} onChange={setAttachmentId}
            hint="Upload staff reports and presentations under the meeting's Attachments tab first. PDF papers are appended to the board book; Word, Markdown and text papers are printed in it."
            options={(files.data?.rows ?? []).map((f) => ({ value: String(f.id), label: String(f.file_name) }))} />
        )}
        {kind === 'document' && <RecordPicker className="form-cell-wide" label="Document" type="policy" value={recordId} error={errors.record_id} onChange={(id) => setRecordId(id)} />}
        {kind === 'record' && (
          <>
            <Select label="Type of record" value={recordType} options={types.filter((t) => t.value !== 'policy')} onChange={(v) => { setRecordType(v); setRecordId(null); }} />
            {recordType && <RecordPicker className="form-cell-wide" label="Record" type={recordType} value={recordId} error={errors.record_id} onChange={(id) => setRecordId(id)} />}
          </>
        )}
      </div>
    </Modal>
  );
}

export function Agenda({ meeting }: { meeting: Row }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<AgendaItem[]>(`/api/meetings/${meeting.id}/agenda`);
  const [editing, setEditing] = useState<AgendaItem | 'new' | null>(null);
  const [papering, setPapering] = useState<AgendaItem | null>(null);
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
  const total = (data ?? []).reduce((n, a) => n + (a.minutes_allotted ?? 0), 0);
  return (
    <Card title="Agenda" flush actions={canEdit && (
      <div className="row">
        <Button size="sm" onClick={() => setPicking(true)}>Add a waiting approval</Button>
        <Button size="sm" icon="plus" onClick={() => setEditing('new')}>Add an item</Button>
      </div>
    )}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <div className="gv-pad"><Loading lines={3} /></div>
        : data.length === 0 ? <EmptyState icon="clipboard" title="No agenda yet" message="Add the items to discuss, with their papers, and the approvals waiting for the chair's decision." />
        : (
          <>
            {total > 0 && <p className="gv-pad muted">Time allotted: {total} minutes in all.</p>}
            <ol className="gv-agenda">
              {data.map((a, i) => (
                <li key={a.id} className="gv-agenda-item">
                  <div className="gv-agenda-main">
                    {a.hidden ? <strong className="muted">{i + 1}. {a.title}</strong> : <strong>{i + 1}. {a.title}</strong>}
                    {' '}<ItemMarks item={a} />
                    {a.presenter_label && <span className="muted"> · {a.presenter_label}</span>}
                    {a.record && <div><RecordName record={a.record} /></div>}
                    {a.workflow && <div className="muted">Waiting approval: {a.workflow.label} ({a.workflow.status === 'running' ? 'waiting' : a.workflow.status})</div>}
                    {a.notes && <div className="prose muted">{a.notes}</div>}
                    {a.papers?.length > 0 && (
                      <ul className="gv-papers" aria-label={`Papers for item ${i + 1}`}>
                        {a.papers.map((p) => (
                          <li key={p.id}>
                            <PaperName paper={p} />
                            {canEdit && (
                              <IconButton icon="x" size="sm" variant="ghost" label={`Take this paper off "${a.title}"`} disabled={busy}
                                onClick={() => void run(() => api.del(`/api/meetings/${meeting.id}/agenda/${a.id}/papers/${p.id}`), 'Paper taken off the item.')} />
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {canEdit && !a.hidden && (
                    <div className="gv-actions">
                      <IconButton icon="arrow-up" label={`Move "${a.title}" up`} size="sm" variant="ghost" disabled={i === 0 || busy} onClick={() => move(i, -1)} />
                      <IconButton icon="arrow-down" label={`Move "${a.title}" down`} size="sm" variant="ghost" disabled={i === data.length - 1 || busy} onClick={() => move(i, 1)} />
                      <Button size="sm" variant="ghost" aria-label={`Add a paper to: ${a.title}`} onClick={() => setPapering(a)}>Add paper</Button>
                      <Button size="sm" variant="ghost" aria-label={`Change: ${a.title}`} onClick={() => setEditing(a)}>Change</Button>
                      <Button size="sm" variant="ghost" aria-label={`Remove: ${a.title}`} onClick={() => setRemoving(a)}>Remove</Button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
      {editing && <AgendaDialog meetingId={meeting.id} item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {papering && <PaperDialog meetingId={meeting.id} item={papering} onClose={() => setPapering(null)} onSaved={() => { setPapering(null); reload(); }} />}
      <Modal open={picking} title="Approvals waiting for the chair" size="lg" onClose={() => setPicking(false)} footer={<Button onClick={() => setPicking(false)}>Close</Button>}>
        <WaitingApprovals committeeId={meeting.committee_id} picking={busy} onPick={(w) => void run(async () => {
          await api.post(`/api/meetings/${meeting.id}/agenda`, { title: `${w.kind_label}: ${w.ref ? `${w.ref} ` : ''}${w.label}`, record_type: w.record_type, record_id: w.record_id, workflow_kind: w.kind });
          setPicking(false);
        }, 'Added to the agenda.')} />
      </Modal>
      <ConfirmDialog open={!!removing} title="Remove this agenda item?" message={`"${removing?.title ?? ''}" will be removed from the agenda. Its files stay on the meeting.`} danger busy={busy} confirmLabel="Remove"
        onConfirm={() => void run(async () => { await api.del(`/api/meetings/${meeting.id}/agenda/${removing!.id}`); setRemoving(null); }, 'Agenda item removed.')}
        onCancel={() => setRemoving(null)} />
    </Card>
  );
}

// ---------- motions ----------

/** Who sits on the committee, for the mover, seconder and votes, from the meeting's attendance. */
function useAttendance(meetingId: string) {
  return useFetch<{ members: AttendanceRow[]; quorum: { voting: number; present: number; needed: number; met: boolean | null } }>(`/api/meetings/${meetingId}/attendance`);
}

export function MotionDialog({ meeting, motion, itemId, consentAgenda, onClose, onSaved }: {
  meeting: Row; motion: Motion | null; itemId: string | null; consentAgenda?: boolean; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const attendance = useAttendance(meeting.id);
  const types = useRecordTypes();
  const members = attendance.data?.members ?? [];
  const voters = members.filter((m) => m.voting);
  const initialVotes = (): Record<string, Vote> => {
    if (motion?.votes.length) return Object.fromEntries(motion.votes.map((v) => [v.member_id, v.vote]));
    return Object.fromEntries(voters.map((m) => [m.member_id, m.present ? 'for' : 'absent']));
  };
  const [form, setForm] = useState({
    motion_text: motion?.motion_text ?? '', notes: motion?.notes ?? '', outcome: motion?.outcome ?? '',
    mover: motion?.mover_member_id ?? (motion?.mover_name ? 'other' : ''), mover_other: motion?.mover_member_id ? '' : motion?.mover_name ?? '',
    seconder: motion?.seconder_member_id ?? (motion?.seconder_name ? 'other' : ''), seconder_other: motion?.seconder_member_id ? '' : motion?.seconder_name ?? '',
    mode: (motion?.vote_mode ?? 'members') as 'members' | 'counts' | 'none',
    counts: { for: motion?.votes_for ?? 0, against: motion?.votes_against ?? 0, abstain: motion?.votes_abstain ?? 0, absent: motion?.votes_absent ?? 0 },
    resolution_number: motion?.resolution_number ?? '', assign: false,
    record_type: motion?.record_type ?? '', record_id: motion?.record_id ?? null as string | null,
  });
  const [votes, setVotes] = useState<Record<string, Vote> | null>(null);
  const [start] = useState(form);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));
  const shown = votes ?? (attendance.data ? initialVotes() : {});
  const tally = useMemo(() => {
    const c = { for: 0, against: 0, abstain: 0, absent: 0 };
    if (form.mode === 'counts') return form.counts;
    for (const v of Object.values(shown)) c[v] += 1;
    return c;
  }, [shown, form.mode, form.counts]);
  const person = (pick: string, other: string) => (pick === 'other' ? (other.trim() ? `name:${other.trim()}` : null) : pick ? { member_id: pick } : null);
  const save = async () => {
    setBusy(true); setErrors({});
    const body: Record<string, unknown> = {
      motion_text: form.motion_text, notes: form.notes || null, mover: person(form.mover, form.mover_other), seconder: person(form.seconder, form.seconder_other),
      vote: form.mode === 'none' ? null : form.mode === 'counts' ? { mode: 'counts', ...form.counts } : { mode: 'members', votes: Object.entries(shown).map(([member_id, vote]) => ({ member_id, vote })) },
      record_type: form.record_type && form.record_id ? form.record_type : null, record_id: form.record_type && form.record_id ? form.record_id : null,
    };
    if (form.outcome) body.outcome = form.outcome;
    if (form.resolution_number.trim() || motion?.resolution_number) body.resolution_number = form.resolution_number.trim();
    if (!motion) {
      body.agenda_item_id = itemId;
      body.consent_agenda = Boolean(consentAgenda);
      if (form.assign && !form.resolution_number.trim()) body.assign_resolution = true;
      if (form.mode === 'none') delete body.vote;
    }
    try {
      if (motion) await api.patch(`/api/meetings/${meeting.id}/motions/${motion.id}`, body); else await api.post(`/api/meetings/${meeting.id}/motions`, body);
      toast.success(motion ? 'Motion saved.' : 'Motion recorded.');
      onSaved();
    } catch (err) { setErrors((err as { fields?: Record<string, string> }).fields ?? {}); toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  const memberOptions = [...members.map((m) => ({ value: m.member_id, label: m.name })), { value: 'other', label: 'Someone else (type the name)' }];
  const q = attendance.data?.quorum;
  return (
    <Modal open size="lg" title={motion ? `Change motion ${motion.ref}` : consentAgenda ? 'Motion to adopt the consent agenda' : 'Record a motion'} onClose={onClose}
      dirty={JSON.stringify(form) !== JSON.stringify(start) || votes !== null}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>{motion ? 'Save' : 'Record'}</Button></>}>
      {attendance.error ? <ErrorState error={attendance.error} onRetry={attendance.reload} /> : !attendance.data ? <Loading lines={4} /> : (
        <div className="stack">
          {q && q.met === false && <Notice tone="warning">The quorum was not met: {q.present} of {q.voting} voting members present, {q.needed} needed.</Notice>}
          {q && q.met === null && <Notice tone="neutral">No attendance is recorded yet, so the quorum is not known. Record attendance on the Attendance tab.</Notice>}
          <div className="form-grid">
            <TextArea className="form-cell-wide" label="Motion" required value={form.motion_text} error={errors.motion_text} rows={3}
              hint={'Write it as moved, for example "That the board adopt the revised fare policy."'} onChange={(v) => set({ motion_text: v })} />
            <Select label="Moved by" value={form.mover} options={memberOptions} error={errors.mover} onChange={(v) => set({ mover: v })} />
            <Select label="Seconded by" value={form.seconder} options={memberOptions} error={errors.seconder} onChange={(v) => set({ seconder: v })} />
            {form.mover === 'other' && <TextField label="Mover's name" value={form.mover_other} onChange={(v) => set({ mover_other: v })} />}
            {form.seconder === 'other' && <TextField label="Seconder's name" value={form.seconder_other} onChange={(v) => set({ seconder_other: v })} />}
            <Select label="Vote" value={form.mode} error={errors.vote}
              options={[{ value: 'members', label: 'Each member\'s vote' }, { value: 'counts', label: 'Counts only' }, { value: 'none', label: 'No vote recorded' }]}
              onChange={(v) => set({ mode: (v || 'members') as typeof form.mode })} />
            <LookupSelect label="Result" list="decision_outcome" value={form.outcome} onChange={(v) => set({ outcome: v })}
              hint={motion ? undefined : 'Leave empty to decide on a simple majority of the votes cast. Apply your committee\'s own rules (two-thirds, casting vote) by choosing the result.'} />
          </div>
          {form.mode === 'members' && (
            voters.length === 0 ? <p className="muted">The committee has no voting members in office on the day of the meeting.</p> : (
              <TableWrap label="Each member's vote">
                <table className="table">
                  <caption className="sr-only">Each member's vote</caption>
                  <thead><tr><th scope="col">Member</th>{VOTES.map((v) => <th scope="col" key={v.value}>{v.label}</th>)}</tr></thead>
                  <tbody>
                    {voters.map((m) => (
                      <tr key={m.member_id}>
                        <td>{m.name}{!m.present && <span className="muted"> (not present)</span>}</td>
                        {VOTES.map((v) => (
                          <td key={v.value}>
                            <input type="radio" className="gv-check" name={`vote-${m.member_id}`} aria-label={`${m.name}: ${v.label}`} checked={shown[m.member_id] === v.value}
                              onChange={() => setVotes({ ...shown, [m.member_id]: v.value })} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )
          )}
          {form.mode === 'counts' && (
            <div className="form-grid">
              {VOTES.map((v) => (
                <NumberField key={v.value} label={v.label} value={form.counts[v.value]} min={0} max={500} step={1} error={errors[`vote.${v.value}`]}
                  onChange={(n) => set({ counts: { ...form.counts, [v.value]: n ?? 0 } })} />
              ))}
            </div>
          )}
          {form.mode !== 'none' && <p className="muted" aria-live="polite">For {tally.for}, against {tally.against}, abstaining {tally.abstain}, absent {tally.absent}.</p>}
          <div className="form-grid">
            <TextField label="Resolution number" value={form.resolution_number} error={errors.resolution_number} onChange={(v) => set({ resolution_number: v })} />
            {!motion && <Checkbox label="Give it the committee's next resolution number" checked={form.assign} disabled={Boolean(form.resolution_number.trim())} onChange={(v) => set({ assign: v })} />}
            <Select label="About a record of type" value={form.record_type} options={[{ value: 'meeting', label: 'Meeting (minutes approval)' }, ...types.filter((t) => t.value !== 'meeting')]}
              onChange={(v) => set({ record_type: v, record_id: null })} />
            {form.record_type && <RecordPicker className="form-cell-wide" label="Record" type={form.record_type} value={form.record_id} error={errors.record_id} onChange={(id) => set({ record_id: id })} />}
            <TextArea className="form-cell-wide" label="Notes" value={form.notes} onChange={(v) => set({ notes: v })} />
          </div>
        </div>
      )}
    </Modal>
  );
}

function MotionLine({ motion, canEdit, onEdit }: { motion: Motion; canEdit: boolean; onEdit: () => void }) {
  return (
    <div className="gv-motion">
      <div className="gv-agenda-main">
        <Link to={`/governance/decisions/${motion.id}`}><span className="ref">{motion.ref}</span></Link>{' '}
        {motion.resolution_number && <Badge color="blue">Resolution {motion.resolution_number}</Badge>}{' '}
        <LookupChip list="decision_outcome" value={motion.outcome} />
        <div>{motion.motion_text ?? motion.title}</div>
        <div className="muted">
          {[motion.mover_name && `Moved by ${motion.mover_name}`, motion.seconder_name && `seconded by ${motion.seconder_name}`, motion.vote_summary].filter(Boolean).join('; ') || 'No mover or vote recorded.'}
        </div>
      </div>
      {canEdit && <Button size="sm" variant="ghost" aria-label={`Change motion ${motion.ref}`} onClick={onEdit}>Change</Button>}
    </div>
  );
}

function Discussion({ meeting, item, canEdit, onSaved }: { meeting: Row; item: AgendaItem; canEdit: boolean; onSaved: () => void }) {
  const toast = useToast();
  const [text, setText] = useState(item.discussion ?? '');
  const [busy, setBusy] = useState(false);
  const dirty = text !== (item.discussion ?? '');
  const { release } = useUnsavedChanges(dirty);
  const save = async () => {
    setBusy(true);
    try { await api.patch(`/api/meetings/${meeting.id}/agenda/${item.id}`, { discussion: text }); release(); toast.success('Minutes saved.'); onSaved(); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  if (!canEdit) return item.discussion ? <div className="prose gv-discussion">{item.discussion}</div> : <p className="muted">No discussion recorded.</p>;
  return (
    <div className="stack">
      <TextArea label={`Discussion: ${item.title}`} hideLabel value={text} rows={3} placeholder="Summary of the discussion" onChange={setText} />
      <div><Button size="sm" variant={dirty ? 'primary' : 'secondary'} disabled={!dirty} loading={busy} onClick={save}>Save minutes of this item</Button></div>
    </div>
  );
}

function ApproveDialog({ meeting, onClose, onDone }: { meeting: Row; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { data, error, reload } = useFetch<Row[]>(`/api/meetings/${meeting.id}/minutes/approvals`);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await api.post(`/api/meetings/${meeting.id}/minutes/approve`, { decision_id: pick }); toast.success('Approval of the minutes recorded.'); onDone(); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal open title="Minutes approved at a later meeting" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!pick} loading={busy} onClick={save}>Record approval</Button></>}>
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loading lines={3} /> : data.length === 0 ? (
        <p className="muted">No approved decision at a later meeting of this committee is about these minutes yet. At the next meeting, record a motion to approve them, about this meeting.</p>
      ) : (
        <div className="stack">
          <p>The approval takes the date of the meeting at which the motion was carried, and locks this meeting.</p>
          <Select label="Decision" value={pick} onChange={setPick}
            options={data.map((d) => ({ value: String(d.id), label: `${d.meeting_ref} (${formatDate(String(d.scheduled_at))}): ${d.ref} ${d.title}${d.resolution_number ? `, resolution ${d.resolution_number}` : ''}` }))} />
        </div>
      )}
    </Modal>
  );
}

export function MinutesTab({ meeting, reload: reloadMeeting, generalMinutes }: { meeting: Row; reload: () => void; generalMinutes: React.ReactNode }) {
  const { can } = useAuth();
  const toast = useToast();
  const agenda = useFetch<AgendaItem[]>(`/api/meetings/${meeting.id}/agenda`);
  const motions = useFetch<Motion[]>(`/api/meetings/${meeting.id}/decisions`);
  const [motion, setMotion] = useState<{ motion: Motion | null; itemId: string | null; consent?: boolean } | null>(null);
  const [approving, setApproving] = useState(false);
  const [busy, setBusy] = useState(false);
  const locked = meeting.status === LOCKED;
  const canEdit = can('governance.edit') && !locked && meeting.status !== 'canceled';
  const canMove = can('governance.create') && !locked && meeting.status !== 'canceled';
  const reload = () => { agenda.reload(); motions.reload(); };
  const publish = async () => {
    setBusy(true);
    try { await api.post(`/api/meetings/${meeting.id}/minutes/publish`); toast.success('Minutes published to the members.'); reloadMeeting(); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const items = agenda.data ?? [];
  const byItem = (id: string | null) => (motions.data ?? []).filter((m) => (id === null ? m.consent_agenda : m.agenda_item_id === id && !m.consent_agenda));
  const consent = items.filter((i) => i.consent && !i.hidden);
  const loose = (motions.data ?? []).filter((m) => !m.consent_agenda && (!m.agenda_item_id || !items.some((i) => i.id === m.agenda_item_id)));
  const state = locked
    ? `Approved${meeting.minutes_approved_on ? ` on ${formatDate(meeting.minutes_approved_on)}` : ''}${meeting._display?.minutes_approved_meeting_id ? ` at ${meeting._display.minutes_approved_meeting_id}` : ''}.`
    : meeting.status === 'held' ? 'Draft: approved by the chair through the workflow, or at a later meeting by a motion.' : 'The minutes are written once the meeting is held.';
  return (
    <div className="stack">
      <Card title="Minutes" actions={(
        <div className="row">
          <a className="btn btn-sm" href={`/api/meetings/${meeting.id}/minutes/pdf`} download>Minutes PDF (public)</a>
          <a className="btn btn-sm" href={`/api/meetings/${meeting.id}/minutes/pdf?version=members`} download>Minutes PDF (members)</a>
        </div>
      )}>
        <div className="stack">
          <p>
            <strong>{state}</strong>
            {meeting.minutes_published_at ? <span className="muted"> Published {formatDateTime(meeting.minutes_published_at)}{meeting.minutes_published_by_name ? ` by ${meeting.minutes_published_by_name}` : ''}.</span> : null}
          </p>
          <div className="row">
            {meeting.status === 'held' && can('governance.edit') && <Button onClick={() => setApproving(true)}>Record approval at a later meeting</Button>}
            {locked && !meeting.minutes_published_at && can('governance.edit') && <Button variant="primary" loading={busy} onClick={publish}>Publish minutes</Button>}
          </div>
        </div>
      </Card>
      {generalMinutes}
      {agenda.error ? <ErrorState error={agenda.error} onRetry={agenda.reload} /> : !agenda.data || !motions.data ? <Loading lines={4} /> : (
        <>
          {(consent.length > 0 || byItem(null).length > 0) && (
            <Card title="Consent agenda" actions={canMove && <Button size="sm" icon="plus" onClick={() => setMotion({ motion: null, itemId: null, consent: true })}>Motion to adopt</Button>}>
              <div className="stack">
                <p className="muted">{consent.map((i) => `${items.indexOf(i) + 1}. ${i.title}`).join('; ') || 'No item is on the consent agenda.'}</p>
                {byItem(null).map((m) => <MotionLine key={m.id} motion={m} canEdit={canEdit} onEdit={() => setMotion({ motion: m, itemId: null })} />)}
              </div>
            </Card>
          )}
          {items.length === 0 && <EmptyState icon="clipboard" title="No agenda" message="The minutes follow the agenda. Add the agenda first." />}
          {items.map((item, i) => (
            <Card key={item.id} title={`${i + 1}. ${item.title}`} actions={canMove && !item.hidden && (
              <Button size="sm" icon="plus" aria-label={`Record a motion on: ${item.title}`} onClick={() => setMotion({ motion: null, itemId: item.id })}>Motion</Button>
            )}>
              {item.hidden ? <p className="muted">Closed-session items are read only by the committee's members.</p> : (
                <div className="stack">
                  <div><ItemMarks item={item} /></div>
                  <Discussion key={`${item.id}-${item.discussion ?? ''}`} meeting={meeting} item={item} canEdit={canEdit} onSaved={reload} />
                  {byItem(item.id).map((m) => <MotionLine key={m.id} motion={m} canEdit={canEdit} onEdit={() => setMotion({ motion: m, itemId: item.id })} />)}
                </div>
              )}
            </Card>
          ))}
          {loose.length > 0 && (
            <Card title="Other decisions">
              <div className="stack">{loose.map((m) => <MotionLine key={m.id} motion={m} canEdit={canEdit} onEdit={() => setMotion({ motion: m, itemId: m.agenda_item_id })} />)}</div>
            </Card>
          )}
        </>
      )}
      {motion && <MotionDialog meeting={meeting} motion={motion.motion} itemId={motion.itemId} consentAgenda={motion.consent} onClose={() => setMotion(null)} onSaved={() => { setMotion(null); reload(); }} />}
      {approving && <ApproveDialog meeting={meeting} onClose={() => setApproving(false)} onDone={() => { setApproving(false); reloadMeeting(); }} />}
    </div>
  );
}

// ---------- the board book ----------

export function BookCard({ meeting }: { meeting: Row }) {
  const { can, user } = useAuth();
  const members = can('governance.edit') || [meeting.chair_id, meeting.secretary_id].includes(user?.id);
  const base = `/api/meetings/${meeting.id}/book`;
  return (
    <Card title="Board book">
      <div className="stack">
        <p className="muted">
          One PDF with a cover, the agenda and each item's papers: documents, Word, Markdown and text papers are printed in it; PDF papers are appended at the end.
          The public version leaves closed-session items out. The text-only version prints the text of PDF papers instead of appending their pages, for screen readers.
        </p>
        <div className="row">
          <a className="btn btn-sm btn-primary" href={base} download>Public version</a>
          {members && <a className="btn btn-sm" href={`${base}?version=members`} download>Members' version</a>}
          <a className="btn btn-sm" href={`${base}?text=1`} download>Text only</a>
        </div>
      </div>
    </Card>
  );
}
