// Working calendars: opening hours per weekday, a 24 by 7 switch, holidays, and adding or
// retiring a calendar.
import { useEffect, useState } from 'react';
import {
  api, Badge, Button, Card, ConfirmDialog, DateField, EmptyState, ErrorState, errorMessage, formatDate, IconButton, Loading, lookupLabel, Modal, Select, Switch, TextField,
  useFetch, useToast,
} from '../../core';
import { DAYS, fieldErrors, put, type Calendar, type Policy } from './util';

type Hours = Record<string, [string, string] | null>;
interface Draft { name: string; timezone: string; always_open: boolean; hours: Hours }

const draftOf = (c: Calendar): Draft => ({
  name: c.name, timezone: c.timezone, always_open: c.always_open,
  hours: Object.fromEntries(DAYS.map(([key]) => [key, c.hours?.[key] ?? null])),
});

function Editor({ calendar, usedBy, canEdit, onChanged, onRetired }: {
  calendar: Calendar; usedBy: string[]; canEdit: boolean; onChanged: () => void; onRetired: () => void;
}) {
  const toast = useToast();
  const [d, setD] = useState<Draft>(() => draftOf(calendar));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [day, setDay] = useState('');
  const [dayName, setDayName] = useState('');
  const [dayError, setDayError] = useState('');
  const [retiring, setRetiring] = useState(false);
  useEffect(() => { setD(draftOf(calendar)); setErrors({}); }, [calendar]);

  const dirty = JSON.stringify(d) !== JSON.stringify(draftOf(calendar));
  const setHours = (key: string, value: [string, string] | null) => setD((old) => ({ ...old, hours: { ...old.hours, [key]: value } }));

  async function save() {
    setBusy(true);
    setErrors({});
    try {
      await put(`/api/tickets/sla/calendars/${calendar.id}`, d);
      toast.success('Calendar saved.');
      onChanged();
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function addHoliday() {
    if (!day) { setDayError('Choose a date.'); return; }
    setDayError('');
    try {
      await api.post(`/api/tickets/sla/calendars/${calendar.id}/holidays`, { day, name: dayName.trim() });
      setDay('');
      setDayName('');
      toast.success('Holiday added.');
      onChanged();
    } catch (err) {
      setDayError(fieldErrors(err).day ?? errorMessage(err));
    }
  }

  async function removeHoliday(id: string) {
    try {
      await api.del(`/api/tickets/sla/holidays/${id}`);
      toast.success('Holiday removed.');
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function retire() {
    setBusy(true);
    try {
      await api.del(`/api/tickets/sla/calendars/${calendar.id}`);
      toast.success(`Calendar “${calendar.name}” retired.`);
      setRetiring(false);
      onRetired();
    } catch (err) {
      setRetiring(false);
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sd-calendar">
      <Card title="Opening hours" actions={usedBy.length ? <span className="muted">Used by {usedBy.join(', ')}</span> : <Badge color="gray">Not used by any target</Badge>}>
        <div className="form-grid">
          <TextField label="Name" required value={d.name} disabled={!canEdit} error={errors.name} onChange={(v) => setD({ ...d, name: v })} />
          <TextField label="Time zone" value={d.timezone} disabled={!canEdit} error={errors.timezone} onChange={(v) => setD({ ...d, timezone: v })}
            hint="An IANA time zone name, in the form Region/City. Opening hours are read in this zone." />
        </div>
        <Switch label="Open 24 hours, 7 days" checked={d.always_open} disabled={!canEdit} onChange={(v) => setD({ ...d, always_open: v })}
          hint="Every minute counts and holidays are ignored." />
        {!d.always_open && (
          <div className="sd-hours" role="group" aria-label="Opening hours by weekday">
            {DAYS.map(([key, label]) => {
              const h = d.hours[key];
              return (
                <div key={key} className="sd-hours-row">
                  <Switch label={label} checked={!!h} disabled={!canEdit} onChange={(on) => setHours(key, on ? ['08:00', '17:00'] : null)} />
                  {h ? (
                    <span className="sd-hours-times">
                      <input type="time" className="input" aria-label={`${label} opens`} value={h[0]} disabled={!canEdit} onChange={(e) => setHours(key, [e.target.value, h[1]])} />
                      <span className="muted">to</span>
                      <input type="time" className="input" aria-label={`${label} closes`} value={h[1]} disabled={!canEdit} onChange={(e) => setHours(key, [h[0], e.target.value])} />
                    </span>
                  ) : <span className="muted">Closed</span>}
                </div>
              );
            })}
            {errors.hours && <p className="field-error" role="alert">{errors.hours}</p>}
          </div>
        )}
        {canEdit && (
          <div className="form-actions">
            <Button variant="ghost" icon="trash" disabled={busy} onClick={() => setRetiring(true)}>Retire calendar</Button>
            <span className="sd-grow" />
            <Button disabled={!dirty || busy} onClick={() => { setD(draftOf(calendar)); setErrors({}); }}>Undo changes</Button>
            <Button variant="primary" disabled={!dirty} loading={busy} onClick={save}>Save calendar</Button>
          </div>
        )}
      </Card>

      <Card title="Holidays" actions={<span className="muted">{calendar.holidays.length} day{calendar.holidays.length === 1 ? '' : 's'}</span>}>
        {d.always_open && calendar.holidays.length === 0 ? <p className="muted">This calendar is open 24 hours, 7 days, so holidays are not used.</p>
          : calendar.holidays.length === 0
          ? <EmptyState icon="calendar" title="No holidays entered" message="On a holiday the clock does not run for targets counted on this calendar." />
          : (
            <ul className="sd-holidays">
              {calendar.holidays.map((h) => (
                <li key={h.id}>
                  <span><strong>{formatDate(String(h.day).slice(0, 10))}</strong>{h.name ? <span className="muted"> · {h.name}</span> : null}</span>
                  {canEdit && <IconButton icon="trash" variant="ghost" size="sm" label={`Remove holiday ${formatDate(String(h.day).slice(0, 10))}`} onClick={() => removeHoliday(h.id)} />}
                </li>
              ))}
            </ul>
          )}
        {canEdit && !d.always_open && (
          <form className="sd-inline-form" onSubmit={(e) => { e.preventDefault(); void addHoliday(); }}>
            <DateField label="Date" value={day} onChange={setDay} error={dayError || undefined} />
            <TextField label="Name (optional)" value={dayName} onChange={setDayName} placeholder="For example Spring holiday" />
            <Button type="submit" icon="plus">Add holiday</Button>
          </form>
        )}
      </Card>

      <ConfirmDialog open={retiring} danger busy={busy} title="Retire this calendar?"
        message={`“${calendar.name}” will no longer be offered for targets. A calendar that a target still uses cannot be retired.`}
        confirmLabel="Retire calendar" onConfirm={retire} onCancel={() => setRetiring(false)} />
    </div>
  );
}

export function CalendarSettings({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const { data, error, loading, reload } = useFetch<Calendar[]>('/api/tickets/sla/calendars');
  const policies = useFetch<Policy[]>('/api/tickets/sla/policies');
  const [id, setId] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [always, setAlways] = useState(false);
  const [nameError, setNameError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Not while a reload is under way: a calendar just added is not in the old list yet.
    if (data && !loading && !data.some((c) => c.id === id)) setId(data[0]?.id ?? '');
  }, [data, id, loading]);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={6} label="Loading the calendars" />;
  const current = data.find((c) => c.id === id);
  const usedBy = (policies.data ?? []).filter((p) => p.calendar_id === id).map((p) => lookupLabel('ticket_priority', p.priority));

  async function create() {
    setBusy(true);
    setNameError('');
    try {
      const made = await api.post<Calendar>('/api/tickets/sla/calendars', { name, always_open: always });
      toast.success(`Calendar “${made.name}” added.`);
      setAdding(false);
      setId(made.id);
      reload();
    } catch (err) {
      setNameError(fieldErrors(err).name ?? errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="sd-inline-form">
        <Select label="Calendar" required value={id} onChange={setId} options={data.map((c) => ({ value: c.id, label: c.name }))} />
        {canEdit && <Button icon="plus" onClick={() => { setName(''); setAlways(false); setNameError(''); setAdding(true); }}>New calendar</Button>}
      </div>
      {current
        ? <Editor calendar={current} usedBy={usedBy} canEdit={canEdit} onChanged={reload} onRetired={() => { reload(); policies.reload(); }} />
        : <EmptyState icon="calendar" title="No calendars" message="Add a calendar to say when the clock runs." />}
      <Modal open={adding} title="New calendar" size="sm" onClose={() => setAdding(false)} dirty={!!name || always}
        footer={<><Button onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!name.trim()} onClick={create}>Add calendar</Button></>}>
        <div className="stack">
          <TextField label="Name" required autoFocus value={name} onChange={setName} error={nameError || undefined} placeholder="For example Out-of-hours rota" />
          <Switch label="Open 24 hours, 7 days" checked={always} onChange={setAlways} hint="Otherwise it starts as Monday to Friday, 08:00 to 17:00, for you to change." />
        </div>
      </Modal>
    </div>
  );
}
