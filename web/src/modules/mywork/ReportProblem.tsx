// "Report a problem" on My work (wave 26): every signed-in person can report a safety hazard or concern, and
// ask for help with something broken, whatever their role and whether or not the self-service portal is on.
// Each kind is offered only while its area is on (GET /api/work/report/options answers null for the others).
// The safety report asks the portal's plain questions and keeps its confidential-reporting rules (the
// server's takeSafetyReport); a request for help becomes a ticket with the person as requester.
// "My reports" lists what the person reported, in plain statuses.
import { useState } from 'react';
import {
  api, ApiError, Button, Card, Checkbox, DateTimeField, EmptyState, ErrorState, Icon, Loading, Modal, NumberField, Select, StatusChip,
  TextArea, TextField, errorMessage, formatDate, timeZoneLabel, useFetch, useToast,
} from '../../core';
import type { ColorName } from '../../core';

interface Choice { value: string; label: string }
export interface ReportOptions {
  safety: { types: Choice[]; harm: Choice[] } | null;
  help: { affects: Choice[]; urgency: Choice[] } | null;
}
type Kind = 'safety' | 'help';

const TONES: Record<string, ColorName> = { blue: 'blue', amber: 'amber', gray: 'gray', green: 'green', red: 'red', purple: 'purple' };

function SafetyForm({ options, onDone, onDirty }: { options: NonNullable<ReportOptions['safety']>; onDone: (ref: string) => void; onDirty: (dirty: boolean) => void }) {
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState(() => new Date().toISOString());
  const [kind, setKind] = useState('');
  const [harm, setHarm] = useState('');
  const [where, setWhere] = useState('');
  const [description, setDescription] = useState('');
  const [actions, setActions] = useState('');
  const [injuries, setInjuries] = useState<number | null>(null);
  const [personal, setPersonal] = useState(false);
  const [confidential, setConfidential] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const touch = <T,>(set: (v: T) => void) => (v: T) => { set(v); onDirty(true); };

  async function send() {
    setBusy(true);
    setErrors({});
    setFormError('');
    try {
      const made = await api.post<{ id: string; ref: string }>('/api/work/report/safety', {
        title, occurred_at: when, event_type: kind, harm, where, description, immediate_actions: actions, injuries, personal, confidential,
      });
      onDone(made.ref);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack mywork-report-form">
      <p className="mywork-urgent" role="note"><Icon name="alert" size={16} /> If someone is in danger now, call your emergency number or your control center first, then report it here.</p>
      {formError && <p className="form-error" role="alert">{formError}</p>}
      <TextField label="What happened, or what is the hazard?" required maxLength={200} value={title} onChange={touch(setTitle)} error={errors.title}
        hint="A few words, for example: loose handrail on platform 2." />
      <DateTimeField label="When did it happen or when did you notice it?" required value={when} onChange={touch(setWhen)} error={errors.occurred_at}
        hint={`Time zone: ${timeZoneLabel()}.`} />
      <Select label="What kind of event is it?" required options={options.types} value={kind} onChange={touch(setKind)} error={errors.event_type} />
      <Select label="How bad was it?" required options={options.harm} value={harm} onChange={touch(setHarm)} error={errors.harm}
        hint="As far as you know. The safety team checks it." />
      <TextField label="Where?" value={where} onChange={touch(setWhere)} hint="A station, depot, route, vehicle number or place." />
      <TextArea label="Describe what happened" required rows={4} value={description} onChange={touch(setDescription)} error={errors.description} />
      <TextArea label="What was done straight away?" rows={2} value={actions} onChange={touch(setActions)} />
      <NumberField label="How many people were hurt?" min={0} max={500} step={1} value={injuries} onChange={touch(setInjuries)} error={errors.injuries} />
      <Checkbox label="It includes personal or medical details" checked={personal} onChange={touch(setPersonal)}
        hint="Only the safety team will be able to read it." />
      <Checkbox label="Keep my name confidential" checked={confidential} onChange={touch(setConfidential)}
        hint="The report is kept without your name. Only the people your organization names can see who made it, and each look is recorded." />
      <div className="row">
        <Button variant="primary" loading={busy} onClick={() => void send()}>Send the safety report</Button>
      </div>
    </div>
  );
}

function HelpForm({ options, onDone, onDirty }: { options: NonNullable<ReportOptions['help']>; onDone: (ref: string) => void; onDirty: (dirty: boolean) => void }) {
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [where, setWhere] = useState('');
  const [affects, setAffects] = useState('');
  const [urgency, setUrgency] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const touch = <T,>(set: (v: T) => void) => (v: T) => { set(v); onDirty(true); };

  async function send() {
    setBusy(true);
    setErrors({});
    setFormError('');
    try {
      const made = await api.post<{ id: string; ref: string }>('/api/work/report/help', { title, details, where, affects, how_urgent: urgency });
      onDone(made.ref);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack mywork-report-form">
      {formError && <p className="form-error" role="alert">{formError}</p>}
      <TextField label="What is wrong, or what do you need?" required maxLength={200} value={title} onChange={touch(setTitle)} error={errors.title}
        hint="A few words, for example: the depot printer will not print." />
      <TextArea label="Details" rows={4} value={details} onChange={touch(setDetails)} />
      <TextField label="Where?" value={where} onChange={touch(setWhere)} hint="A building, room, vehicle or system." />
      <Select label="Who is affected?" required options={options.affects} value={affects} onChange={touch(setAffects)} error={errors.affects} />
      <Select label="How urgent is it?" required options={options.urgency} value={urgency} onChange={touch(setUrgency)} error={errors.how_urgent} />
      <div className="row">
        <Button variant="primary" loading={busy} onClick={() => void send()}>Send the request</Button>
      </div>
    </div>
  );
}

/** The "Report a problem" button and its dialog. Renders nothing while no kind of report is on. */
export function ReportProblem({ options, onSent }: { options: ReportOptions | undefined; onSent: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind | ''>('');
  const [dirty, setDirty] = useState(false);
  const kinds: { value: Kind; label: string }[] = [
    ...(options?.safety ? [{ value: 'safety' as const, label: 'A safety hazard, concern or event' }] : []),
    ...(options?.help ? [{ value: 'help' as const, label: 'Something is broken, or I need help' }] : []),
  ];
  if (!kinds.length) return null;
  const chosen: Kind | '' = kind || (kinds.length === 1 ? kinds[0].value : '');
  const close = () => { setOpen(false); setKind(''); setDirty(false); };
  const done = (what: string) => (ref: string) => {
    toast.success(`Thank you. Your ${what} is ${ref}. You can follow it under My reports.`);
    close();
    onSent();
  };
  return (
    <>
      <Button variant="primary" icon="alert" onClick={() => setOpen(true)}>Report a problem</Button>
      {open && (
        <Modal open title="Report a problem" onClose={close} dirty={dirty}>
          <div className="stack">
            {kinds.length > 1 && (
              <Select label="What would you like to report?" required options={kinds} value={chosen} onChange={(v) => { setKind(v as Kind); setDirty(false); }} />
            )}
            {chosen === 'safety' && options?.safety && <SafetyForm key="safety" options={options.safety} onDirty={setDirty} onDone={done('safety report')} />}
            {chosen === 'help' && options?.help && <HelpForm key="help" options={options.help} onDirty={setDirty} onDone={done('request')} />}
          </div>
        </Modal>
      )}
    </>
  );
}

interface Mine {
  safety: { id: string; ref: string; title: string; reported_at: string; confidential: boolean; outcome: string | null; status: { label: string; tone: string } }[] | null;
  help: { id: string; ref: string; title: string; opened_at: string; status: { label: string; tone: string } }[] | null;
}

/** What the person reported from My work or the portal: safety reports and requests for help, newest first. */
export function MyReports({ version }: { version: number }) {
  const { data, error, reload } = useFetch<Mine>(`/api/work/report/mine?v=${version}`);
  if (error) return <Card title="My reports"><ErrorState error={error} onRetry={reload} /></Card>;
  if (!data) return <Card title="My reports"><Loading lines={2} /></Card>;
  const rows = [
    ...(data.safety ?? []).map((r) => ({ key: `s-${r.id}`, ref: r.ref, title: r.title, when: r.reported_at, kind: 'Safety report', status: r.status, note: r.outcome ? `What was done: ${r.outcome}` : r.confidential ? 'Your name is kept confidential.' : null })),
    ...(data.help ?? []).map((r) => ({ key: `h-${r.id}`, ref: r.ref, title: r.title, when: r.opened_at, kind: 'Request for help', status: r.status, note: null })),
  ].sort((a, b) => String(b.when).localeCompare(String(a.when))).slice(0, 8);
  return (
    <Card title="My reports" className="mywork-reports">
      {rows.length === 0 ? (
        <EmptyState icon="check-circle" title="Nothing reported yet" message="What you report with Report a problem is listed here, with what is happening to it." />
      ) : (
        <ul className="mywork-report-list">
          {rows.map((r) => (
            <li key={r.key}>
              <span className="mywork-report-text">
                <strong>{r.title}</strong>
                <span className="muted">{r.kind} {r.ref}, {formatDate(r.when)}</span>
                {r.note && <span className="muted">{r.note}</span>}
              </span>
              <StatusChip color={TONES[r.status.tone] ?? 'gray'} label={r.status.label} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
