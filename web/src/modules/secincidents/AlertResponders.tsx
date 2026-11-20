// Notification deadlines > Alerts by email and text (E09-25): the named responders who are told,
// by email and by text message, when an incident is declared and when a notification clock turns
// amber or red. The messages carry the incident's reference and what needs attention, never details.
import { useEffect, useState, type FormEvent } from 'react';
import {
  api, Button, Card, Checkbox, ErrorState, errorMessage, Loading, MultiSelect, StatusChip, useFetch, useToast, withReauth,
} from '../../core';

interface Responder { id: string; label: string; eligible: boolean; hasEmail: boolean; hasText: boolean }
interface AlertState {
  responders: Responder[];
  includeLead: boolean;
  email: boolean;
  text: boolean;
  declared: boolean;
  amber: boolean;
  red: boolean;
  eligible?: { id: string; label: string }[];
  mail_on: boolean;
  text_on: boolean;
  can_administer: boolean;
}
type Options = Pick<AlertState, 'includeLead' | 'email' | 'text' | 'declared' | 'amber' | 'red'>;
const OPTION_KEYS: (keyof Options)[] = ['includeLead', 'email', 'text', 'declared', 'amber', 'red'];

function Reach({ r }: { r: Responder }) {
  if (!r.eligible) return <StatusChip color="red" label="Cannot receive alerts" />;
  return (
    <span className="si-alert-reach">
      <StatusChip color={r.hasEmail ? 'green' : 'gray'} label={r.hasEmail ? 'Email' : 'No email'} />
      <StatusChip color={r.hasText ? 'green' : 'gray'} label={r.hasText ? 'Text' : 'No text details'} />
    </span>
  );
}

export function AlertResponders() {
  const toast = useToast();
  const { data, error, reload } = useFetch<AlertState>('/api/security-incidents/alerts/settings');
  const [saved, setSaved] = useState<AlertState | null>(null);
  const shown = saved ?? data;
  const [people, setPeople] = useState<string[]>([]);
  const [opts, setOpts] = useState<Options | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'' | 'save' | 'test'>('');
  useEffect(() => {
    if (!shown) return;
    setPeople(shown.responders.map((r) => r.id));
    setOpts(Object.fromEntries(OPTION_KEYS.map((k) => [k, shown[k]])) as Options);
  }, [shown]);

  if (error) return <ErrorState title="The alert settings could not be loaded" error={error} onRetry={reload} />;
  if (!shown || !opts) return <Loading lines={5} label="Loading alert settings" />;
  const admin = shown.can_administer;
  const dirty = people.join() !== shown.responders.map((r) => r.id).join() || OPTION_KEYS.some((k) => opts[k] !== shown[k]);
  const options = [
    ...(shown.eligible ?? []).map((p) => ({ value: p.id, label: p.label })),
    ...shown.responders.filter((r) => !r.eligible).map((r) => ({ value: r.id, label: `${r.label} (cannot receive alerts)` })),
  ];
  const set = (k: keyof Options) => (v: boolean) => setOpts({ ...opts, [k]: v });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('save');
    setErrors({});
    try {
      const next = await withReauth(() => api.patch<AlertState>('/api/security-incidents/alerts/settings', { responders: people, ...opts }));
      setSaved(next);
      toast.success('Alert settings saved.');
    } catch (err) {
      const fields = (err as { fields?: Record<string, string> }).fields;
      if (fields && Object.keys(fields).length) setErrors(fields);
      else toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const test = async () => {
    setBusy('test');
    try {
      const r = await api.post<{ people: number; email: number; text: number }>('/api/security-incidents/alerts/test');
      if (r.email || r.text) toast.success(`Test alert queued: ${r.email} by email, ${r.text} by text message.`);
      else toast.error(r.people ? 'Nothing was sent: email and text messages are not set up, or switched off here.' : 'Nothing was sent: no named responder can receive alerts.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  return (
    <Card title="Alerts by email and text message">
      <form className="form" onSubmit={save} noValidate>
        <p className="muted">
          Everyone with access to security incidents sees alerts in the application. The people named here are also told by email and by
          text message when an incident is declared and when a notification deadline is close (amber) or has passed (red): once for each,
          naming only the incident's reference and what needs attention. They must hold security.view when it is sent.
          {!shown.mail_on && ' Email is switched off, so nothing is emailed until an administrator sets it up.'}
          {!shown.text_on && ' Text messages are not set up (Administration > Email > Text messages).'}
        </p>
        {admin ? (
          <>
            <MultiSelect label="Responders" options={options} value={people} onChange={setPeople} error={errors.responders} />
            <p className="muted">Active people with security.view. Each adds a mobile number or email-to-text address under Account security for text messages.</p>
          </>
        ) : shown.responders.length === 0 && <p>No responders are named.</p>}
        {shown.responders.length > 0 && (
          <ul className="si-alert-list" aria-label="Named responders">
            {shown.responders.map((r) => <li key={r.id}><span>{r.label}</span><Reach r={r} /></li>)}
          </ul>
        )}
        <fieldset className="si-alert-options" disabled={!admin}>
          <legend>Send</legend>
          <Checkbox label="By email" checked={opts.email} onChange={set('email')} />
          <Checkbox label="By text message" checked={opts.text} onChange={set('text')} />
          <Checkbox label="Also to the incident's lead" checked={opts.includeLead} onChange={set('includeLead')} />
        </fieldset>
        <fieldset className="si-alert-options" disabled={!admin}>
          <legend>When</legend>
          <Checkbox label="An incident is declared" checked={opts.declared} onChange={set('declared')} />
          <Checkbox label="A deadline is close (amber)" checked={opts.amber} onChange={set('amber')} />
          <Checkbox label="A deadline has passed (red)" checked={opts.red} onChange={set('red')} />
        </fieldset>
        {admin && (
          <div className="form-actions">
            <Button icon="message" loading={busy === 'test'} disabled={dirty || busy !== '' || shown.responders.length === 0} onClick={() => void test()}>
              Send a test alert
            </Button>
            <Button type="submit" variant="primary" loading={busy === 'save'} disabled={!dirty || busy !== ''}>Save alert settings</Button>
          </div>
        )}
      </form>
    </Card>
  );
}
