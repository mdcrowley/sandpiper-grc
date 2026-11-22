// E20-13: report a safety event from the portal, in plain words, and follow the reports I made.
// The safety team receives it as a safety event with the status "Reported" and triages it.
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  api, ApiError, Button, Checkbox, DateTimeField, errorMessage, ErrorState, Icon, Loading, NumberField, relativeTime, TextArea, TextField,
  useFetch, useToast,
} from '../../core';
import { ChoiceCards } from './RequestForm';
import { Section, type Choice } from './parts';

interface Options { types: Choice[]; harm: Choice[] }
interface MyReport { id: string; ref: string; title: string; occurred_at: string; reported_at: string; status: { key: string; label: string; tone: string } }

export function MySafetyReports({ compact = false, refresh = 0 }: { compact?: boolean; refresh?: number }) {
  const { data, error, reload } = useFetch<{ rows: MyReport[] }>('/api/portal/safety-reports');
  useEffect(() => { if (refresh) reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [refresh]);
  if (error) return compact ? null : <ErrorState error={error} onRetry={reload} />;
  if (!data) return compact ? null : <Loading lines={2} label="Loading your safety reports" />;
  if (compact && !data.rows.length) return null;
  const rows = compact ? data.rows.slice(0, 3) : data.rows;
  return (
    <Section id="pt-safety-mine" title="My safety reports" action={compact ? <Link to="/portal/safety" className="pt-more">See all</Link> : undefined}>
      {rows.length ? (
        <ul className="pt-mini-list">
          {rows.map((r) => (
            <li key={r.id} className="pt-mini">
              <Icon name="shield" size={20} />
              <span className="pt-mini-text"><strong>{r.title}</strong>
                <span className="muted">{r.ref} · reported {relativeTime(r.reported_at)}</span>
              </span>
              <span className={`pt-pill pt-tone-${r.status.tone}`}>{r.status.label}</span>
            </li>
          ))}
        </ul>
      ) : <p className="muted pt-none">You have not reported anything yet.</p>}
    </Section>
  );
}

export function SafetyReport() {
  const toast = useToast();
  const { data: options, error, reload } = useFetch<Options>('/api/portal/safety/options');
  // An asset tag's card (E37-06) opens this form with ?where= filled in.
  const [params] = useSearchParams();
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState(() => new Date().toISOString());
  const [kind, setKind] = useState('');
  const [harm, setHarm] = useState('');
  const [where, setWhere] = useState(params.get('where') ?? '');
  const [description, setDescription] = useState('');
  const [actions, setActions] = useState('');
  const [injuries, setInjuries] = useState<number | null>(null);
  const [personal, setPersonal] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ ref: string } | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { document.title = 'Report a safety concern'; }, []);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!options) return <Loading lines={6} label="Loading the form" />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError('');
    try {
      const made = await api.post<{ id: string; ref: string }>('/api/portal/safety-reports', {
        title, occurred_at: when, event_type: kind, harm, where, description, immediate_actions: actions, injuries, personal,
      });
      setSent({ ref: made.ref });
      toast.success(`Thank you. Your report is ${made.ref}.`);
      setTitle(''); setKind(''); setHarm(''); setWhere(''); setDescription(''); setActions(''); setInjuries(null); setPersonal(false);
      setWhen(new Date().toISOString());
      setTick((n) => n + 1);
      window.scrollTo(0, 0);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setFormError(errorMessage(err));
      setTimeout(() => document.querySelector<HTMLElement>('[aria-invalid="true"], .pt-form-error')?.focus?.(), 0);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pt-page pt-form-page">
      <nav className="pt-back"><Link to="/portal"><Icon name="chevron-left" size={18} /> Home</Link></nav>
      <div className="pt-form-head">
        <span className="pt-tile-icon pt-tile-icon-safety"><Icon name="shield" size={24} /></span>
        <div>
          <h1>Report a safety concern</h1>
          <p className="pt-intro">An accident, an injury, a near miss or something unsafe. The safety team reads every report.</p>
        </div>
      </div>
      <p className="pt-callout pt-callout-urgent" role="note"><Icon name="alert" size={18} /> If someone is in danger now, call the emergency services and follow your local safety procedure first. Report it here afterwards.</p>
      {sent && (
        <div className="pt-card pt-sent" role="status">
          <Icon name="check-circle" size={22} />
          <div>
            <strong>Report {sent.ref} sent to the safety team.</strong>
            <p className="muted">They may contact you for more detail. You can follow it below.</p>
          </div>
        </div>
      )}
      <form className="pt-form" onSubmit={onSubmit} noValidate>
        {formError && <p className="pt-form-error" role="alert" tabIndex={-1}>{formError}</p>}
        <TextField label="What happened, in a few words?" required size="md" maxLength={200} value={title} onChange={setTitle} error={errors.title}
          placeholder="For example: passenger fell on the platform steps" />
        <DateTimeField label="When did it happen?" required size="md" value={when} onChange={setWhen} error={errors.occurred_at} />
        <ChoiceCards name="event_type" label="What kind of event was it?" required options={options.types} value={kind} onChange={setKind} error={errors.event_type} />
        <ChoiceCards name="harm" label="How bad was it?" required options={options.harm} value={harm} onChange={setHarm} error={errors.harm}
          hint="Your best guess is fine: the safety team checks it." />
        <TextField label="Where?" size="md" value={where} onChange={setWhere} hint="Site, station, stop, depot, or vehicle or route number." />
        <TextArea label="Describe what happened" required size="md" rows={4} value={description} onChange={setDescription} error={errors.description}
          hint="What you saw, in order. Please do not include medical details." />
        <TextArea label="What was done straight away? (optional)" size="md" rows={2} value={actions} onChange={setActions} />
        <NumberField label="How many people were hurt? (optional)" size="md" min={0} max={500} step={1} value={injuries} onChange={setInjuries} error={errors.injuries} />
        <Checkbox label="It involves someone’s health or other personal details" checked={personal} onChange={setPersonal}
          hint="Only the people allowed to see personal information will see the details." />
        <div className="pt-form-actions">
          <Button type="submit" variant="primary" loading={busy} className="pt-submit">Send report</Button>
          <Link to="/portal" className="pt-link-btn">Cancel</Link>
        </div>
      </form>
      <MySafetyReports refresh={tick} />
    </div>
  );
}
