// E20-13: report a safety event from the portal, in plain words, and follow the reports I made.
// The safety team receives it as a safety event with the status "Reported" and triages it.
// E41-05: the reporter may ask for their name to be kept confidential, and reads what was done once
// the report is closed.
// E41-07: the texts are in the person's language (web/src/core/i18n/locales). The kinds of event and
// harm are the organization's own lists and are shown as written.
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  api, ApiError, Button, Checkbox, DateTimeField, errorMessage, Icon, Loading, NumberField, TextArea, TextField,
  timeZoneLabel, useFetch, useToast,
} from '../../core';
import { useI18n } from '../../core/i18n';
import { ChoiceCards } from './RequestForm';
import { PortalError, Section, useFocusFirstProblem, usePortalTitle, type Choice } from './parts';

interface Options { types: Choice[]; harm: Choice[] }
interface MyReport {
  id: string; ref: string; title: string; occurred_at: string; reported_at: string; confidential?: boolean; outcome?: string | null;
  status: { key: string; label: string; tone: string };
}

export function MySafetyReports({ compact = false, refresh = 0 }: { compact?: boolean; refresh?: number }) {
  const { t, ago } = useI18n();
  const { data, error, reload } = useFetch<{ rows: MyReport[] }>('/api/portal/safety-reports');
  useEffect(() => { if (refresh) reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [refresh]);
  if (error) return compact ? null : <PortalError error={error} onRetry={reload} />;
  if (!data) return compact ? null : <Loading lines={2} label={t('portal.safety.loadingMine')} />;
  if (compact && !data.rows.length) return null;
  const rows = compact ? data.rows.slice(0, 3) : data.rows;
  return (
    <Section id="pt-safety-mine" title={t('portal.safety.mine')} action={compact ? <Link to="/portal/safety" className="pt-more">{t('portal.seeAll')}</Link> : undefined}>
      {rows.length ? (
        <ul className="pt-mini-list">
          {rows.map((r) => (
            <li key={r.id} className="pt-mini">
              <Icon name="shield" size={20} />
              <span className="pt-mini-text"><strong>{r.title}</strong>
                <span className="muted">{t('portal.safety.reported', { ref: r.ref, when: ago(r.reported_at) })}{r.confidential ? ` · ${t('portal.safety.keptConfidential')}` : ''}</span>
                {r.outcome && !compact && <span className="pt-outcome"><strong>{t('portal.safety.whatWasDone')}</strong> {r.outcome}</span>}
              </span>
              <span className={`pt-pill pt-tone-${r.status.tone}`}>{r.status.label}</span>
            </li>
          ))}
        </ul>
      ) : <p className="muted pt-none">{t('portal.safety.noneYet')}</p>}
    </Section>
  );
}

export function SafetyReport() {
  const toast = useToast();
  const { t } = useI18n();
  const { data: options, error, reload } = useFetch<Options>('/api/portal/safety/options');
  usePortalTitle(t('portal.safety.title'));
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
  const [confidential, setConfidential] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const focusProblem = useFocusFirstProblem();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ ref: string } | null>(null);
  const [tick, setTick] = useState(0);

  if (error) return <PortalError error={error} onRetry={reload} />;
  if (!options) return <Loading lines={6} label={t('portal.form.loading')} />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError('');
    try {
      const made = await api.post<{ id: string; ref: string }>('/api/portal/safety-reports', {
        title, occurred_at: when, event_type: kind, harm, where, description, immediate_actions: actions, injuries, personal, confidential,
      });
      setSent({ ref: made.ref });
      toast.success(t('portal.safety.thanks', { ref: made.ref }));
      setTitle(''); setKind(''); setHarm(''); setWhere(''); setDescription(''); setActions(''); setInjuries(null); setPersonal(false); setConfidential(false);
      setWhen(new Date().toISOString());
      setTick((n) => n + 1);
      window.scrollTo(0, 0);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setFormError(errorMessage(err));
      focusProblem();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pt-page pt-form-page">
      <nav className="pt-back"><Link to="/portal"><Icon name="chevron-left" size={18} /> {t('portal.nav.home')}</Link></nav>
      <div className="pt-form-head">
        <span className="pt-tile-icon pt-tile-icon-safety"><Icon name="shield" size={24} /></span>
        <div>
          <h1>{t('portal.safety.title')}</h1>
          <p className="pt-intro">{t('portal.safety.intro')}</p>
        </div>
      </div>
      <p className="pt-callout pt-callout-urgent" role="note"><Icon name="alert" size={18} /> {t('portal.safety.danger')}</p>
      {sent && (
        <div className="pt-card pt-sent" role="status">
          <Icon name="check-circle" size={22} />
          <div>
            <strong>{t('portal.safety.sent', { ref: sent.ref })}</strong>
            <p className="muted">{t('portal.safety.sentHint')}</p>
          </div>
        </div>
      )}
      <form className="pt-form" onSubmit={onSubmit} noValidate>
        {formError && <p className="pt-form-error" role="alert" tabIndex={-1}>{formError}</p>}
        <TextField label={t('portal.safety.what')} required size="md" maxLength={200} value={title} onChange={setTitle} error={errors.title}
          hint={t('portal.safety.whatHint')} />
        <DateTimeField label={t('portal.safety.when')} required size="md" value={when} onChange={setWhen} error={errors.occurred_at}
          hint={t('portal.safety.zone', { zone: timeZoneLabel() })} />
        <ChoiceCards name="event_type" label={t('portal.safety.kind')} required options={options.types} value={kind} onChange={setKind} error={errors.event_type} />
        <ChoiceCards name="harm" label={t('portal.safety.harm')} required options={options.harm} value={harm} onChange={setHarm} error={errors.harm}
          hint={t('portal.safety.harmHint')} />
        <TextField label={t('portal.report.where')} size="md" value={where} onChange={setWhere} hint={t('portal.safety.whereHint')} />
        <TextArea label={t('portal.safety.describe')} required size="md" rows={4} value={description} onChange={setDescription} error={errors.description}
          hint={t('portal.safety.describeHint')} />
        <TextArea label={t('portal.safety.actions')} size="md" rows={2} value={actions} onChange={setActions} />
        <NumberField label={t('portal.safety.injuries')} size="md" min={0} max={500} step={1} value={injuries} onChange={setInjuries} error={errors.injuries} />
        <Checkbox label={t('portal.safety.personal')} checked={personal} onChange={setPersonal}
          hint={t('portal.safety.personalHint')} />
        <Checkbox label={t('portal.safety.confidential')} checked={confidential} onChange={setConfidential}
          hint={t('portal.safety.confidentialHint')} />
        <div className="pt-form-actions">
          <Button type="submit" variant="primary" loading={busy} className="pt-submit">{t('portal.safety.send')}</Button>
          <Link to="/portal" className="pt-link-btn">{t('common.cancel')}</Link>
        </div>
      </form>
      <MySafetyReports refresh={tick} />
    </div>
  );
}
