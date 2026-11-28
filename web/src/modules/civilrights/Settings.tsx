// Civil rights settings: the complaint time limits (the organization's own; no jurisdiction's deadline
// is built in) and the people named to handle confidential complaints.
import { useEffect, useState, type FormEvent } from 'react';
import {
  api, Button, Card, ErrorState, errorMessage, Loading, MultiSelect, NumberField, PageHeader, Select, StatusChip, useAuth, useFetch, useToast, withReauth,
} from '../../core';
import './civilrights.css';

interface Limits {
  ackDays: number; investigationDays: number; appealDays: number; reminderDays: number;
  ackWorking: boolean; investigationWorking: boolean; appealWorking: boolean;
  /** The working calendar working days are counted on, and its number of holidays (read only). */
  workingCalendar?: string | null; holidays?: number;
}
type DaysKey = 'ackDays' | 'investigationDays' | 'appealDays' | 'reminderDays';
type CountKey = 'ackWorking' | 'investigationWorking' | 'appealWorking';
const COUNTING = [{ value: 'calendar', label: 'Calendar days' }, { value: 'working', label: 'Working days' }];
interface Handlers {
  handlers: { id: string; label: string; eligible: boolean }[];
  named: boolean;
  eligible?: { id: string; label: string }[];
  can_administer: boolean;
}

function TimeLimits() {
  const toast = useToast();
  const { can, areaOn } = useAuth();
  const { data, error, reload } = useFetch<Limits>('/api/civil-rights/settings');
  const [form, setForm] = useState<Limits | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const current = form ?? data;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!current) return <Loading lines={4} />;
  const admin = can('civilrights.administer');
  const set = (patch: Partial<Limits>) => setForm({ ...current, ...patch });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErrors({});
    try {
      const { workingCalendar: _c, holidays: _h, ...body } = current;
      await api.put('/api/civil-rights/settings', body);
      toast.success('Time limits saved. Complaints received from now on use them.'); setForm(null); reload();
    } catch (err) { setErrors((err as { fields?: Record<string, string> }).fields ?? {}); toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  const field = (key: DaysKey, label: string, hint: string, max: number) => (
    <NumberField label={label} min={key === 'reminderDays' ? 0 : 1} max={max} value={current[key]} error={errors[key]} hint={hint} disabled={!admin}
      onChange={(v) => set({ [key]: v ?? 0 } as Partial<Limits>)} />
  );
  const counting = (key: CountKey, label: string) => (
    <Select label={label} required options={COUNTING} value={current[key] ? 'working' : 'calendar'} error={errors[key]} disabled={!admin}
      onChange={(v) => set({ [key]: v === 'working' } as Partial<Limits>)} />
  );
  const calendar = `${current.workingCalendar ?? 'Monday to Friday'}${current.holidays ? `, ${current.holidays} holiday${current.holidays === 1 ? '' : 's'}` : ', no holidays'}`;
  return (
    <Card title="Complaint time limits">
      <form className="form" onSubmit={save} noValidate>
        <p className="muted">
          Set the limits your own procedure gives, each in calendar days or in working days. A change applies to complaints received from then on; dates already worked out stay.
        </p>
        <p className="muted">
          Working days are the open weekdays of the organization&apos;s business-hours calendar, less its holidays ({calendar}){areaOn('records') ? ', the same calendar records requests are counted on' : ''}.
          {areaOn('tickets') ? ' It is kept with the service desk settings, under Calendars.' : ''}
        </p>
        <div className="form-grid">
          {field('ackDays', 'Acknowledge within', 'Counted from the day the complaint is received.', 365)}
          {counting('ackWorking', 'Acknowledgment counted in')}
          {field('investigationDays', 'Finish the investigation within', 'Counted from the day received.', 730)}
          {counting('investigationWorking', 'Investigation counted in')}
          {field('appealDays', 'Decide an appeal within', 'Counted from the day the appeal arrives.', 365)}
          {counting('appealWorking', 'Appeal counted in')}
          {field('reminderDays', 'Remind this many days before', 'Calendar days. The investigator (or the handlers) and report owners are reminded once.', 90)}
        </div>
        {admin && <div className="form-actions"><Button type="submit" variant="primary" loading={busy} disabled={form === null}>Save time limits</Button></div>}
      </form>
    </Card>
  );
}

function ComplaintHandlers() {
  const toast = useToast();
  const { data, error, reload } = useFetch<Handlers>('/api/civil-rights/complaint-handlers');
  const [saved, setSaved] = useState<Handlers | null>(null);
  const shown = saved ?? data;
  const [people, setPeople] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (shown) setPeople(shown.handlers.map((v) => v.id)); }, [shown]);
  if (error) return <ErrorState title="The complaint handlers could not be loaded" error={error} onRetry={reload} />;
  if (!shown) return <Loading lines={3} />;
  const admin = shown.can_administer;
  const dirty = people.join() !== shown.handlers.map((v) => v.id).join();
  const options = [
    ...(shown.eligible ?? []).map((p) => ({ value: p.id, label: p.label })),
    ...shown.handlers.filter((v) => !v.eligible).map((v) => ({ value: v.id, label: `${v.label} (cannot see civil rights)` })),
  ];
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErrors({});
    try {
      setSaved(await withReauth(() => api.put<Handlers>('/api/civil-rights/complaint-handlers', { handlers: people })));
      toast.success('Complaint handlers saved.');
    } catch (err) {
      const fields = (err as { fields?: Record<string, string> }).fields;
      if (fields && Object.keys(fields).length) setErrors(fields); else toast.error(errorMessage(err));
    } finally { setBusy(false); }
  };
  return (
    <Card title="Complaint handlers">
      <form className="form" onSubmit={save} noValidate>
        <p className="muted">
          Complaints are confidential unless marked otherwise. A confidential complaint is seen only by the people named here, its
          investigator and the person who entered it; everyone else who may see civil rights sees the counts only. Name as few people as you can.
        </p>
        {admin && <MultiSelect label="Named handlers" options={options} value={people} onChange={setPeople} error={errors.handlers} />}
        {shown.handlers.length === 0 ? <p>Nobody is named yet.</p> : (
          <ul className="cr-stack" aria-label="Named handlers">
            {shown.handlers.map((v) => <li key={v.id}>{v.label} {!v.eligible && <StatusChip size="sm" color="red" label="Cannot see civil rights" />}</li>)}
          </ul>
        )}
        {admin && <div className="form-actions"><Button type="submit" variant="primary" loading={busy} disabled={!dirty || busy}>Save handlers</Button></div>}
      </form>
    </Card>
  );
}

export function CivilRightsSettings() {
  return (
    <div className="stack">
      <PageHeader title="Civil rights settings" subtitle="Complaint time limits and who handles confidential complaints." />
      <TimeLimits />
      <ComplaintHandlers />
    </div>
  );
}
