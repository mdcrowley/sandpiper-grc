// The investigation record of a safety event (E25-01 to E25-06): the people involved, the timeline,
// conditions and statements, and the reporting clocks. People involved and statements need
// security.view as well as the safety permission; without it the tab says so and shows nothing.
import { useEffect, useState } from 'react';
import {
  ApiError, api, Badge, Button, Card, Checkbox, ConfirmDialog, DateField, DateTimeField, EditableSummary, EmptyState, ErrorState, errorMessage,
  formatDate, formatDateTime, Loading, LookupChoices, LookupSelect, Modal, StatusChip, TextArea, TextField, Timeline, useAuth, useFetch, useLookup, useToast,
} from '../../core';
import type { ColorName, Row } from '../../core';

const labelOf = (values: { value: string; label: string }[], v: unknown) => values.find((x) => x.value === v)?.label ?? String(v ?? '');

function NeedsSecurity({ what }: { what: string }) {
  return <EmptyState icon="lock" title={`${what} are restricted`} message={`${what} name people and describe injuries, so they are shown only to people who may see restricted records.`} />;
}

// ---------- people involved ----------

interface Person { id: string; role: string; person_id: string | null; name: string | null; injury_severity: string | null; transported: boolean; fatality: boolean; notes: string | null }
const BLANK_PERSON = { role: '', name: '', injury_severity: '', transported: false, fatality: false, notes: '' };

export function PeopleTab({ eventId, onChanged }: { eventId: string; onChanged: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const allowed = can('security.view');
  const { data, error, reload } = useFetch<Person[]>(allowed ? `/api/safety-events/${eventId}/people` : null);
  const roles = useLookup('safety_person_role');
  const injuries = useLookup('safety_injury_severity');
  const [editing, setEditing] = useState<Person | 'new' | null>(null);
  const [form, setForm] = useState(BLANK_PERSON);
  const [start, setStart] = useState(BLANK_PERSON);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Person | null>(null);
  const mayEdit = can('safety.edit');
  if (!allowed) return <Card title="People involved"><NeedsSecurity what="People involved" /></Card>;

  const open = (p: Person | 'new') => {
    setErrors({});
    const initial = p === 'new' ? BLANK_PERSON : { role: p.role, name: p.name ?? '', injury_severity: p.injury_severity ?? '', transported: p.transported, fatality: p.fatality, notes: p.notes ?? '' };
    setForm(initial); setStart(initial);
    setEditing(p);
  };
  const save = async () => {
    if (!form.role) { setErrors({ role: 'Choose the person\'s role.' }); return; }
    setBusy(true);
    try {
      if (editing === 'new') await api.post(`/api/safety-events/${eventId}/people`, form);
      else if (editing) await api.patch(`/api/safety-events/${eventId}/people/${editing.id}`, form);
      toast.success('Saved.');
      setEditing(null); reload(); onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields); else toast.error(errorMessage(err));
    } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try { await api.del(`/api/safety-events/${eventId}/people/${removing.id}`); toast.success('Removed.'); setRemoving(null); reload(); onChanged(); }
    catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Card title="People involved" flush actions={mayEdit && <Button size="sm" icon="plus" onClick={() => open('new')}>Add a person</Button>}>
      <p className="muted sf-pad sf-hint">Once people are recorded here, the event's fatalities and people taken for medical treatment are counted from them.</p>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <div className="sf-pad"><Loading lines={3} /></div>
        : data.length === 0 ? <EmptyState icon="users" title="No people recorded" message="Record each person involved: passengers, employees, contractors, members of the public and trespassers." />
        : (
          <div className="table-wrap">
            <table className="table sf-wrap">
              <caption className="sr-only">People involved in this event</caption>
              <thead><tr><th scope="col">Role</th><th scope="col">Name</th><th scope="col">Injury</th><th scope="col">Taken for treatment</th><th scope="col">Fatality</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {data.map((p) => {
                  const inj = injuries.find((x) => x.value === p.injury_severity);
                  return (
                    <tr key={p.id}>
                      <td>{labelOf(roles, p.role)}</td>
                      <td>{p.name || <span className="muted">Not recorded</span>}</td>
                      <td>{inj ? <StatusChip color={(inj.color ?? 'gray') as ColorName} label={inj.label} /> : <span className="muted">—</span>}</td>
                      <td>{p.transported ? 'Yes' : 'No'}</td>
                      <td>{p.fatality ? <StatusChip color="red" label="Fatality" /> : 'No'}</td>
                      <td className="sf-actions">{mayEdit && <>
                        <Button size="sm" variant="ghost" onClick={() => open(p)}>Edit</Button>
                        <Button size="sm" variant="ghost" onClick={() => setRemoving(p)}>Remove</Button>
                      </>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      <Modal open={!!editing} title={editing === 'new' ? 'Add a person involved' : 'Edit person involved'} onClose={() => setEditing(null)}
        dirty={JSON.stringify(form) !== JSON.stringify(start)}
        footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
        <div className="form">
          <div className="form-grid">
            <LookupSelect label="Role" list="safety_person_role" required value={form.role} onChange={(v) => set('role', v ?? '')} error={errors.role} />
            <TextField label="Name" value={form.name} onChange={(v) => set('name', v)} error={errors.name} hint="Leave empty when the person is not known or should not be named." />
            <LookupSelect label="Injury" list="safety_injury_severity" value={form.injury_severity} onChange={(v) => set('injury_severity', v ?? '')} error={errors.injury_severity} />
            <div className="stack">
              <Checkbox label="Taken for medical treatment" checked={form.transported} onChange={(v) => set('transported', v)} />
              <Checkbox label="Fatality" checked={form.fatality} onChange={(v) => set('fatality', v)} />
            </div>
            <div className="form-cell-wide"><TextArea label="Notes" value={form.notes} onChange={(v) => set('notes', v)} rows={3} /></div>
          </div>
        </div>
      </Modal>
      <ConfirmDialog open={!!removing} title="Remove this person?" message="The person will no longer be listed on this event." confirmLabel="Remove" danger busy={busy}
        onConfirm={remove} onCancel={() => setRemoving(null)} />
    </Card>
  );
}

// ---------- investigation: conditions, factors, timeline and statements ----------

interface TimelineEntry { id: string; at: string; entry: string; by_id: string | null; by_name: string | null }
interface Statement { id: string; statement_type: string; given_by: string | null; given_on: string | null; text: string }

function Factors({ row, onSaved }: { row: Row; onSaved: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const factors = useLookup('safety_contributing_factor');
  const [value, setValue] = useState<string[]>(row.contributing_factors ?? []);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setValue(row.contributing_factors ?? []); }, [row.contributing_factors]);
  const dirty = JSON.stringify(value) !== JSON.stringify(row.contributing_factors ?? []);
  const save = async () => {
    setBusy(true);
    try { await api.patch(`/api/safety-events/${row.id}`, { contributing_factors: value }); toast.success('Contributing factors saved.'); onSaved(); }
    catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  if (!can('safety.edit')) {
    return (
      <Card title="Contributing factors">
        {(row.contributing_factors ?? []).length ? <div className="sf-chips">{(row.contributing_factors as string[]).map((f) => <Badge key={f}>{labelOf(factors, f)}</Badge>)}</div> : <p className="muted">None recorded.</p>}
      </Card>
    );
  }
  return (
    <Card title="Contributing factors" actions={dirty && <Button size="sm" variant="primary" loading={busy} onClick={save}>Save</Button>}>
      <LookupChoices label="Contributing factors" hideLabel list="safety_contributing_factor" value={value} onChange={setValue} hint="Everything that played a part: human, equipment, environment, organizational." />
    </Card>
  );
}

function TimelineCard({ eventId }: { eventId: string }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<TimelineEntry[]>(`/api/safety-events/${eventId}/timeline`);
  const [adding, setAdding] = useState(false);
  const [at, setAt] = useState('');
  const [entry, setEntry] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try {
      await api.post(`/api/safety-events/${eventId}/timeline`, { at, entry });
      toast.success('Entry added.'); setAdding(false); setEntry(''); reload();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields); else toast.error(errorMessage(err));
    } finally { setBusy(false); }
  };
  return (
    <Card title="Timeline" actions={can('safety.edit') && <Button size="sm" icon="plus" onClick={() => { setErrors({}); setAt(new Date().toISOString()); setAdding(true); }}>Add an entry</Button>}>
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loading lines={3} /> : (
        <Timeline label="Investigation timeline" compact empty="Nothing recorded yet. Add what happened, in order, from the first report."
          items={data.map((e) => ({
            key: e.id, title: e.entry, time: e.at, icon: e.by_id ? undefined : 'clock',
            meta: e.by_id ? e.by_name : `Recorded by the application${e.by_name ? ` (${e.by_name})` : ''}`,
          }))} />
      )}
      <Modal open={adding} title="Add a timeline entry" onClose={() => setAdding(false)} dirty={!!entry}
        footer={<><Button onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={add}>Add</Button></>}>
        <div className="form">
          <DateTimeField label="When" required value={at} onChange={setAt} error={errors.at} />
          <TextArea label="What happened" required value={entry} onChange={setEntry} rows={3} error={errors.entry} />
        </div>
      </Modal>
    </Card>
  );
}

const BLANK_STATEMENT = { statement_type: 'witness', given_by: '', given_on: '', text: '' };

function Statements({ eventId }: { eventId: string }) {
  const { can } = useAuth();
  const toast = useToast();
  const allowed = can('security.view');
  const types = useLookup('safety_statement_type');
  const { data, error, reload } = useFetch<Statement[]>(allowed ? `/api/safety-events/${eventId}/statements` : null);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState(BLANK_STATEMENT);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  if (!allowed) return <Card title="Statements"><NeedsSecurity what="Statements" /></Card>;
  const add = async () => {
    setBusy(true);
    try {
      await api.post(`/api/safety-events/${eventId}/statements`, f);
      toast.success('Statement added.'); setAdding(false); reload();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields); else toast.error(errorMessage(err));
    } finally { setBusy(false); }
  };
  return (
    <Card title="Statements" actions={can('safety.edit') && <Button size="sm" icon="plus" onClick={() => { setErrors({}); setF(BLANK_STATEMENT); setAdding(true); }}>Add a statement</Button>}>
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loading lines={3} />
        : data.length === 0 ? <p className="muted">No statements recorded. Keep signed copies as files on the event; they are restricted with it.</p>
        : (
          <ul className="sf-statements">
            {data.map((s) => (
              <li key={s.id}>
                <div className="sf-statement-head"><strong>{labelOf(types, s.statement_type)}</strong><span className="muted">{[s.given_by, s.given_on && formatDate(s.given_on)].filter(Boolean).join(', ')}</span></div>
                <p className="sf-statement-text">{s.text}</p>
              </li>
            ))}
          </ul>
        )}
      <Modal open={adding} title="Add a statement" size="lg" onClose={() => setAdding(false)}
        dirty={JSON.stringify(f) !== JSON.stringify(BLANK_STATEMENT)}
        footer={<><Button onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={add}>Add</Button></>}>
        <div className="form">
          <div className="form-grid">
            <LookupSelect label="Kind of statement" list="safety_statement_type" required value={f.statement_type} onChange={(v) => setF((x) => ({ ...x, statement_type: v ?? '' }))} error={errors.statement_type} />
            <TextField label="Given by" value={f.given_by} onChange={(v) => setF((x) => ({ ...x, given_by: v }))} error={errors.given_by} />
            <DateField label="Given on" value={f.given_on} onChange={(v) => setF((x) => ({ ...x, given_on: v }))} error={errors.given_on} />
            <div className="form-cell-wide"><TextArea label="Statement" required value={f.text} onChange={(v) => setF((x) => ({ ...x, text: v }))} rows={6} error={errors.text} /></div>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

export function InvestigationTab({ row, reload }: { row: Row; reload: () => void }) {
  return (
    <div className="sf-investigation">
      <EditableSummary type="safety_event" row={row} onSaved={reload} title="Conditions"
        fields={['weather', 'lighting', 'surface', 'latitude', 'longitude', 'post_event_testing_required']} />
      <Factors row={row} onSaved={reload} />
      <TimelineCard eventId={row.id} />
      <Statements eventId={row.id} />
      <p className="muted sf-hint">Post-event testing is recorded as required or not only: test results belong in the testing program's own system.</p>
    </div>
  );
}

// ---------- reporting clocks ----------

interface Clock {
  id: string; party: string; required: boolean; guidance: string | null; due_at: string | null; status: string; state: string; late: boolean;
  seconds_remaining: number | null; notified_who: string | null; notified_how: string | null; notified_at: string | null; reference_received: string | null;
  note: string | null; completed_by_name: string | null;
}
interface ClocksResult { reportable: boolean; reasons: { rule_id: string; name: string; party: string; deadline_hours: number; required: boolean }[]; clocks: Clock[] }

export const CLOCK_STATE: Record<string, { label: string; color: ColorName }> = {
  red: { label: 'Overdue', color: 'red' }, amber: { label: 'Due soon', color: 'amber' }, green: { label: 'Running', color: 'green' },
  met: { label: 'Made', color: 'blue' }, not_required: { label: 'Not required', color: 'gray' },
};

export function remaining(seconds: number | null): string {
  if (seconds === null) return '';
  const m = Math.round(Math.abs(seconds) / 60);
  const d = Math.floor(m / 1440); const h = Math.floor((m % 1440) / 60); const min = m % 60;
  const text = d ? `${d}d ${h}h` : h ? `${h}h ${min}m` : `${min}m`;
  return seconds < 0 ? `${text} overdue` : `${text} left`;
}

export function ReportingTab({ eventId }: { eventId: string }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<ClocksResult>(`/api/safety-events/${eventId}/clocks`);
  const [recording, setRecording] = useState<{ clock: Clock; mode: 'done' | 'not_required' } | null>(null);
  const [f, setF] = useState({ notified_who: '', notified_how: '', notified_at: '', reference_received: '', note: '' });
  const [start, setStart] = useState(f);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const open = (clock: Clock, mode: 'done' | 'not_required') => {
    const initial = { notified_who: '', notified_how: '', notified_at: new Date().toISOString(), reference_received: '', note: '' };
    setErrors({}); setF(initial); setStart(initial); setRecording({ clock, mode });
  };
  const save = async () => {
    if (!recording) return;
    setBusy(true);
    try {
      await api.post(`/api/safety-notifications/${recording.clock.id}/complete`, recording.mode === 'done'
        ? { notified_who: f.notified_who, notified_how: f.notified_how, notified_at: f.notified_at, reference_received: f.reference_received }
        : { status: 'not_required', note: f.note });
      toast.success(recording.mode === 'done' ? 'Notification recorded.' : 'Marked not required.');
      setRecording(null); reload();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields); else toast.error(errorMessage(err));
    } finally { setBusy(false); }
  };
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={4} />;
  return (
    <div className="stack">
      <Card title="Reportability">
        {data.reportable
          ? <p><StatusChip color="red" label="Reportable" /> These reporting rules apply: {data.reasons.map((r) => `${r.name} (notify ${r.party} within ${r.deadline_hours} hours)`).join('; ')}.</p>
          : <p><StatusChip color="gray" label="Not reportable" /> None of the organization's reporting rules applies to this event's figures. It is worked out again every time the event is saved.</p>}
      </Card>
      <Card title="Notification clocks" flush>
        {data.clocks.length === 0 ? <EmptyState icon="clock" title="No clocks" message="A clock starts when a reporting rule applies to the event. Administrators write the rules under Safety reporting rules." /> : (
          <div className="table-wrap">
            <table className="table sf-wrap">
              <caption className="sr-only">Notification clocks of this event</caption>
              <thead><tr><th scope="col">Notify</th><th scope="col">Due</th><th scope="col">State</th><th scope="col">Record</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {data.clocks.map((c) => {
                  const st = CLOCK_STATE[c.state] ?? CLOCK_STATE.green;
                  return (
                    <tr key={c.id}>
                      <td><strong>{c.party}</strong> <Badge color={c.required ? 'blue' : 'gray'}>{c.required ? 'Required' : 'Recommended'}</Badge>{c.guidance && <div className="muted sf-hint">{c.guidance}</div>}</td>
                      <td>{c.due_at ? formatDateTime(c.due_at) : '—'}</td>
                      <td><StatusChip color={st.color} label={st.label} />{c.status === 'pending' && <div className="muted sf-hint">{remaining(c.seconds_remaining)}</div>}</td>
                      <td>
                        {c.status === 'done' && <span>{c.notified_who} by {c.notified_how}, {formatDateTime(c.notified_at)}{c.reference_received ? `; reference ${c.reference_received}` : ''}{c.late ? ' (late)' : ''}</span>}
                        {c.status === 'not_required' && <span className="muted">{c.note}</span>}
                      </td>
                      <td className="sf-actions">{c.status === 'pending' && can('safety.edit') && <>
                        <Button size="sm" onClick={() => open(c, 'done')}>Record notification</Button>
                        <Button size="sm" variant="ghost" onClick={() => open(c, 'not_required')}>Not required</Button>
                      </>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Modal open={!!recording} title={recording ? `${recording.mode === 'done' ? 'Record notification' : 'Not required'}: ${recording.clock.party}` : ''} onClose={() => setRecording(null)}
        dirty={JSON.stringify(f) !== JSON.stringify(start)}
        footer={<><Button onClick={() => setRecording(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
        {recording?.mode === 'done' ? (
          <div className="form">
            <TextField label="Who was told" required value={f.notified_who} onChange={(v) => setF((x) => ({ ...x, notified_who: v }))} error={errors.notified_who} />
            <TextField label="How" required value={f.notified_how} onChange={(v) => setF((x) => ({ ...x, notified_how: v }))} error={errors.notified_how} hint="Phone, email, web form, letter or in person." />
            <DateTimeField label="When" required value={f.notified_at} onChange={(v) => setF((x) => ({ ...x, notified_at: v }))} error={errors.notified_at} />
            <TextField label="Reference received" value={f.reference_received} onChange={(v) => setF((x) => ({ ...x, reference_received: v }))} />
          </div>
        ) : (
          <div className="form">
            <TextArea label="Why it is not required" required value={f.note} onChange={(v) => setF((x) => ({ ...x, note: v }))} rows={3} error={errors.note} />
          </div>
        )}
      </Modal>
    </div>
  );
}
