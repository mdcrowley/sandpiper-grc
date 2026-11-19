// Dialogs shared by the report, dashboard and pack pages: share, schedule, add to a dashboard.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button, IconButton, Modal, MultiSelect, NumberField, Select, Switch, TextField, UserPicker,
  api, errorMessage, formatDateTime, timeZone, useAuth, useFetch, useToast,
} from '../../core';
import type { ListResult } from '../../core';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
import { ShareFields } from './BuilderParts';
import type { Dashboard, Shared, Sharing, Widget } from './types';

/** May the signed-in person change this shared item? (The server decides; this only hides buttons.) */
export function useCanChange(item: Shared | undefined, module: 'reports' | 'dashboards'): boolean {
  const { user, can } = useAuth();
  if (!item || !can(`${module}.edit`)) return false;
  return item.owner_id === null || item.owner_id === user?.id || can('admin.administer');
}

export function ShareDialog({ open, onClose, path, item, what, onSaved }: {
  open: boolean; onClose: () => void; path: string; item: Shared & { id: string }; what: string; onSaved: () => void;
}) {
  const toast = useToast();
  const [sharing, setSharing] = useState<Sharing>(item.sharing);
  const [roles, setRoles] = useState<string[]>(item.shared_roles ?? []);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setSharing(item.sharing); setRoles(item.shared_roles ?? []); } }, [open, item]);
  async function save() {
    if (sharing === 'roles' && roles.length === 0) return toast.error('Choose at least one role, or pick another option.');
    setBusy(true);
    try {
      await api.patch(`${path}/${item.id}`, { sharing, shared_roles: roles });
      toast.success(sharing === 'private' ? `Only you can see this ${what} now.` : `This ${what} is shared.`);
      onSaved();
      onClose();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} title={`Share this ${what}`} onClose={onClose} size="sm"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save sharing</Button></>}>
      <ShareFields what={what} sharing={sharing} roles={roles} onChange={(s, r) => { setSharing(s); setRoles(r); }} />
    </Modal>
  );
}

const isFile = (format: unknown) => format === 'pdf' || format === 'xlsx' || format === 'csv';
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, '0')}:00` }));

export function ScheduleDialog({ open, onClose, target, existing, onSaved }: {
  open: boolean; onClose: () => void;
  target?: { type: 'report' | 'dashboard'; id: string; name: string };
  existing?: Row;
  onSaved?: (row: Row) => void;
}) {
  const toast = useToast();
  const roles = useFetch<{ key: string; name: string }[]>(open ? '/api/reports/roles' : null);
  const mail = useFetch<{ enabled: boolean }>(open ? '/api/reports/email-status' : null);
  const [f, setF] = useState<Row>({});
  const [people, setPeople] = useState<{ id: string; label: string }[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const { user } = useAuth();
  const isDash = (existing?.target_type ?? target?.type) === 'dashboard';

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (existing) {
      setF({ ...existing });
      setPeople(((existing.recipient_users as string[]) ?? []).map((id) => ({ id, label: id === user?.id ? user.displayName : 'A chosen person' })));
    } else {
      setF({ name: target ? `${target.name}: weekly` : '', cadence: 'weekly', weekday: 1, month_day: 1, hour: 7, format: 'html', email: 'link', recipient_roles: [], active: true });
      setPeople(user ? [{ id: user.id, label: `${user.displayName} (me)` }] : []);
    }
  }, [open, existing, target, user]);

  const set = (patch: Row) => setF((prev) => ({ ...prev, ...patch }));
  async function save() {
    setBusy(true);
    setErrors({});
    const body = {
      name: String(f.name ?? '').trim(), cadence: f.cadence, weekday: f.weekday, month_day: f.month_day, hour: Number(f.hour), format: isDash && f.format === 'csv' ? 'html' : f.format,
      email: f.email === 'attach' && !isFile(f.format) ? 'link' : f.email ?? 'link',
      recipient_users: people.map((p) => p.id), recipient_roles: f.recipient_roles ?? [], active: f.active !== false,
      ...(existing ? {} : { target_type: target!.type, target_id: target!.id }),
    };
    try {
      const row = existing ? await api.patch<Row>(`/api/report-schedules/${existing.id}`, body) : await api.post<Row>('/api/report-schedules', body);
      toast.success(row.next_run_at ? `Scheduled. Next delivery ${formatDateTime(row.next_run_at)}.` : 'Schedule saved. It is switched off.');
      onSaved?.(row);
      onClose();
    } catch (err) {
      const fields = (err as { fields?: Record<string, string> }).fields ?? {};
      setErrors(fields);
      if (!Object.keys(fields).length) toast.error(errorMessage(err));
    } finally { setBusy(false); }
  }

  return (
    <Modal open={open} title={existing ? 'Edit schedule' : `Schedule this ${isDash ? 'dashboard' : 'report'}`} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>{existing ? 'Save changes' : 'Schedule'}</Button></>}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <p className="notice">Each person receives a notification in the application with a link to a copy frozen at that moment. Figures are the same for everyone; lists of records show each person only what their own role allows.</p>
        <TextField label="Name" required value={String(f.name ?? '')} error={errors.name} onChange={(name) => set({ name })} />
        <div className="form-grid">
          <Select label="How often" required value={String(f.cadence ?? 'weekly')} onChange={(cadence) => set({ cadence })}
            options={[{ value: 'daily', label: 'Every day' }, { value: 'weekly', label: 'Every week' }, { value: 'monthly', label: 'Every month' }]} />
          {f.cadence === 'weekly' && <Select label="On" required value={String(f.weekday ?? 1)} onChange={(v) => set({ weekday: Number(v) })} options={WEEKDAYS.map((d, i) => ({ value: String(i + 1), label: d }))} />}
          {f.cadence === 'monthly' && <NumberField label="Day of the month" min={1} max={31} value={Number(f.month_day ?? 1)} onChange={(v) => set({ month_day: v ?? 1 })} hint="In shorter months, the last day." />}
          <Select label="At" required value={String(f.hour ?? 7)} onChange={(hour) => set({ hour: Number(hour) })} options={HOURS} hint={`Time zone: ${timeZone()}`} />
          <Select label="As" required value={String(f.format ?? 'html')} onChange={(format) => set({ format })} error={errors.format}
            hint="People who may not export receive the document instead of a file."
            options={[
              { value: 'html', label: 'Document (print or save as PDF)' },
              { value: 'pdf', label: 'PDF file' },
              { value: 'xlsx', label: 'Excel file (XLSX)' },
              ...(isDash ? [] : [{ value: 'csv', label: 'Spreadsheet file (CSV)' }]),
            ]} />
        </div>
        <Select label="Email" required value={String(f.email ?? 'link')} onChange={(email) => set({ email })} error={errors.email}
          hint={mail.data && !mail.data.enabled
            ? 'Email is not switched on here, so deliveries stay in the application until an administrator sets it up.'
            : f.email === 'attach'
              ? 'The file goes only to people whose role allows exporting, and never when it holds restricted records: they get a link instead.'
              : 'The email names the schedule and links to the copy; the figures stay in the application.'}
          options={[
            { value: 'link', label: 'Email a link' },
            ...(isFile(f.format) ? [{ value: 'attach', label: 'Email the file attached' }] : []),
            { value: 'off', label: 'No email: in the application only' },
          ]} />
        <fieldset className="rp-recipients">
          <legend className="field-label">Send to</legend>
          {errors.recipient_users && <p className="field-error">{errors.recipient_users}</p>}
          <ul className="rp-people">
            {people.map((p) => (
              <li key={p.id}><span>{p.label}</span><IconButton icon="x" label={`Remove ${p.label}`} variant="ghost" size="sm" onClick={() => setPeople(people.filter((x) => x.id !== p.id))} /></li>
            ))}
          </ul>
          <UserPicker label="Add a person" hideLabel value={null} placeholder="Add a person…" onChange={(id, opt) => { if (id && !people.some((p) => p.id === id)) setPeople([...people, { id, label: opt?.label ?? 'Person' }]); }} />
          <div className="row">
            <MultiSelect label={(f.recipient_roles ?? []).length ? `${f.recipient_roles.length} roles` : 'Everyone in a role…'} value={f.recipient_roles ?? []} onChange={(recipient_roles) => set({ recipient_roles })}
              options={(roles.data ?? []).map((r) => ({ value: r.key, label: r.name }))} />
            <span className="muted">{((f.recipient_roles ?? []) as string[]).map((k) => roles.data?.find((r) => r.key === k)?.name ?? k).join(', ')}</span>
          </div>
          {errors.recipient_roles && <p className="field-error">{errors.recipient_roles}</p>}
        </fieldset>
        <Switch label="Switched on" checked={f.active !== false} onChange={(active) => set({ active })} />
      </form>
    </Modal>
  );
}

/** Puts a saved report on a dashboard the person can change, or on a new one. */
export function AddToDashboardDialog({ open, onClose, report }: { open: boolean; onClose: () => void; report: { id: string; name: string } }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { user, can } = useAuth();
  const list = useFetch<ListResult<Dashboard>>(open ? '/api/dashboards?pageSize=200' : null);
  const mine = (list.data?.rows ?? []).filter((d) => can('dashboards.edit') && (d.owner_id === null || d.owner_id === user?.id || can('admin.administer')));
  const [choice, setChoice] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setChoice(''); setName(''); } }, [open]);
  const creating = choice === 'new' || (list.data !== undefined && mine.length === 0);

  async function add() {
    setBusy(true);
    try {
      const widget = (widgets: Widget[]): Widget => ({
        id: `r${Date.now().toString(36)}`, kind: 'report', title: report.name, x: 0, y: widgets.reduce((n, w) => Math.max(n, w.y + w.h), 0), w: 6, h: 5, config: { reportId: report.id },
      });
      let dash: Dashboard;
      if (creating) {
        if (!name.trim()) { toast.error('Give the new dashboard a name.'); return; }
        dash = await api.post<Dashboard>('/api/dashboards', { name: name.trim(), widgets: [widget([])], filters: [{ kind: 'date', label: 'Dates' }] });
      } else {
        const current = mine.find((d) => d.id === choice);
        if (!current) { toast.error('Choose a dashboard.'); return; }
        dash = await api.patch<Dashboard>(`/api/dashboards/${current.id}`, { widgets: [...current.widgets, widget(current.widgets)] });
      }
      toast.success(`Added to "${dash.name}".`);
      onClose();
      navigate(`/dashboards/${dash.id}`);
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} title="Add to a dashboard" onClose={onClose} size="sm"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={add}>Add to dashboard</Button></>}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        {mine.length > 0 && (
          <Select label="Dashboard" required value={choice} placeholder="Choose a dashboard…" onChange={setChoice}
            options={[...mine.map((d) => ({ value: d.id, label: d.name })), ...(can('dashboards.create') ? [{ value: 'new', label: 'A new dashboard…' }] : [])]} />
        )}
        {creating && can('dashboards.create') && <TextField label="Name of the new dashboard" required value={name} onChange={setName} />}
        {list.data !== undefined && mine.length === 0 && !can('dashboards.create') && <p className="notice">Your role does not allow changing dashboards.</p>}
        <p className="muted">The report appears as a widget. You can move and resize it on the dashboard.</p>
      </form>
    </Modal>
  );
}
