// Raising a request: from a catalog item (its own questions) or "Report a problem" (a short
// form in plain words). Help articles that match are offered before sending.
//
// The administrator's custom fields on tickets are deliberately not asked here (E18-34): they are
// the service desk's own classification, filled in by agents during triage, and may pick people or
// records a requester cannot see. A catalog item's questions are how a request asks requesters
// for more. The server takes only the fields set by the portal route and does not enforce required
// custom fields for portal requests (E15-14).
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  api, ApiError, Button, DateField, errorMessage, Icon, Loading, qs, TextArea, TextField, useDebounced, useFetch, useToast,
} from '../../core';
import { useI18n } from '../../core/i18n';
import { itemIcon } from './Home';
import {
  FilePicker, PortalError, sendFile, Suggestions, useFocusFirstProblem, usePortal, usePortalTitle, useServerText, useSuggestions,
  type CatalogItem, type Choice,
} from './parts';

/** Big tappable choices (radio buttons drawn as cards). */
export function ChoiceCards({ name, label, options, value, onChange, error, required, hint }: {
  name: string; label: string; options: Choice[]; value: string; onChange: (v: string) => void; error?: string; required?: boolean; hint?: string;
}) {
  return (
    // A radio group that is required as a whole: `required` on each radio button made the browser report
    // them as invalid before anything was chosen, and screen readers said so on every one (E16-15).
    <fieldset
      className="pt-choices" role="radiogroup" aria-labelledby={`${name}-legend`} aria-required={required || undefined}
      aria-invalid={error ? true : undefined} aria-describedby={error ? `${name}-err` : undefined}
    >
      <legend id={`${name}-legend`}>{label}{required && <span className="pt-req-mark" aria-hidden="true"> *</span>}</legend>
      {hint && <p className="pt-hint">{hint}</p>}
      <div className="pt-choice-grid">
        {options.map((o) => (
          <label key={o.value} className={`pt-choice ${value === o.value ? 'is-on' : ''}`}>
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      {error && <p id={`${name}-err`} className="field-error">{error}</p>}
    </fieldset>
  );
}

interface Colleague { id: string; label: string; department: string | null }
export interface ForWhomState { mode: 'me' | 'other'; colleague: Colleague | null }

/** E15-12: "Who is this for?": me, or a colleague the portal lets me raise it for. */
function ForWhom({ value, onChange, error }: { value: ForWhomState; onChange: (v: ForWhomState) => void; error?: string }) {
  const { on_behalf: rule } = usePortal();
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim(), 250);
  const [found, setFound] = useState<Colleague[] | null>(null);
  useEffect(() => {
    let live = true;
    if (value.mode !== 'other' || query.length < 2) { setFound(null); return; }
    api.get<{ rows: Colleague[] }>(`/api/portal/colleagues${qs({ q: query })}`)
      .then((r) => { if (live) setFound(r.rows); }).catch(() => { if (live) setFound([]); });
    return () => { live = false; };
  }, [query, value.mode]);
  if (!rule || rule === 'nobody') return null;
  return (
    <div className="pt-for-whom">
      <ChoiceCards name="for_whom" label={t('portal.forWhom.label')} value={value.mode}
        hint={rule === 'department' ? t('portal.forWhom.hintDepartment') : t('portal.forWhom.hint')}
        options={[{ value: 'me', label: t('portal.forWhom.me') }, { value: 'other', label: t('portal.forWhom.colleague') }]}
        onChange={(m) => onChange({ mode: m as ForWhomState['mode'], colleague: m === 'me' ? null : value.colleague })} />
      {value.mode === 'other' && (value.colleague ? (
        <div className="pt-picked">
          <Icon name="user" size={20} />
          <span><strong>{value.colleague.label}</strong>{value.colleague.department && <span className="muted"> · {value.colleague.department}</span>}</span>
          <button type="button" className="pt-link-btn" onClick={() => { onChange({ ...value, colleague: null }); setQ(''); }}>{t('portal.forWhom.change')}</button>
        </div>
      ) : (
        <div className="pt-colleague-search">
          <TextField label={t('portal.forWhom.name')} size="md" value={q} onChange={setQ} error={error} placeholder={t('portal.forWhom.placeholder')} autoComplete="off" />
          <div aria-live="polite">
            {found && (found.length ? (
              <ul className="pt-colleagues">
                {found.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="pt-colleague" onClick={() => onChange({ ...value, colleague: c })}>
                      <Icon name="user" size={18} /><span>{c.label}</span>{c.department && <span className="muted">{c.department}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="muted pt-none">{rule === 'department' ? t('portal.forWhom.nobodyDepartment') : t('portal.forWhom.nobody')}</p>)}
          </div>
        </div>
      ))}
    </div>
  );
}

const forBody = (w: ForWhomState) => (w.mode === 'other' && w.colleague ? { for_user_id: w.colleague.id } : {});
const forMissing = (w: ForWhomState) => w.mode === 'other' && !w.colleague;

function Page({ title, intro, icon, children }: { title: string; intro?: ReactNode; icon: Parameters<typeof Icon>[0]['name']; children: ReactNode }) {
  const { t } = useI18n();
  usePortalTitle(title);
  return (
    <div className="pt-page pt-form-page">
      <nav className="pt-back"><Link to="/portal"><Icon name="chevron-left" size={18} /> {t('portal.nav.home')}</Link></nav>
      <div className="pt-form-head">
        <span className="pt-tile-icon"><Icon name={icon} size={24} /></span>
        <div><h1>{title}</h1>{intro && <p className="pt-intro">{intro}</p>}</div>
      </div>
      {children}
    </div>
  );
}

/** Sends the request, then any files; returns to the new request. */
function useSubmit() {
  const navigate = useNavigate();
  const toast = useToast();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const focusProblem = useFocusFirstProblem();
  async function submit(body: Record<string, unknown>, files: File[]) {
    setBusy(true);
    setErrors({});
    setFormError('');
    try {
      const made = await api.post<{ id: string; ref: string }>('/api/portal/requests', body);
      const failed: string[] = [];
      for (const f of files) {
        try { await sendFile(made.id, f); } catch (err) { failed.push(errorMessage(err)); }
      }
      toast.success(t('portal.form.sent', { ref: made.ref }));
      if (failed.length) toast.error(t('portal.form.filesFailed', { problems: failed.join(' ') }));
      navigate(`/portal/requests/${made.id}`, { state: { created: true } });
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setFormError(errorMessage(err));
      focusProblem();
    } finally {
      setBusy(false);
    }
  }
  return { submit, busy, errors, formError };
}

function FormEnd({ busy, label, files, setFiles }: { busy: boolean; label: string; files: File[]; setFiles: (f: File[]) => void }) {
  const { files: canAttach } = usePortal();
  const { t } = useI18n();
  return (
    <>
      {canAttach && <FilePicker files={files} onChange={setFiles} />}
      <div className="pt-form-actions">
        <Button type="submit" variant="primary" loading={busy} className="pt-submit">{label}</Button>
        <Link to="/portal" className="pt-link-btn">{t('common.cancel')}</Link>
      </div>
    </>
  );
}

export function RequestForm() {
  const { itemId } = useParams();
  const { t } = useI18n();
  const { data: items, error, reload } = useFetch<CatalogItem[]>('/api/portal/catalog');
  const item = items?.find((i) => i.id === itemId);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [details, setDetails] = useState('');
  const [where, setWhere] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [forWhom, setForWhom] = useState<ForWhomState>({ mode: 'me', colleague: null });
  const [forErr, setForErr] = useState('');
  const { submit, busy, errors, formError } = useSubmit();
  const articles = useSuggestions(item ? `${item.name} ${details}`.slice(0, 120) : '');
  // The form's own Page sets the title once it shows; until then, and when the item is not offered, these do.
  usePortalTitle(items && !item ? t('portal.form.notOffered') : null);

  if (error) return <PortalError error={error} onRetry={reload} />;
  if (!items) return <Loading lines={6} label={t('portal.form.loading')} />;
  if (!item) {
    return (
      <div className="pt-empty-page">
        <h1>{t('portal.form.notOffered')}</h1>
        <p className="muted">{t('portal.form.withdrawn')} <Link to="/portal/catalog">{t('portal.form.seeCatalog')}</Link>.</p>
      </div>
    );
  }
  const set = (key: string, v: string) => setAnswers((a) => ({ ...a, [key]: v }));
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (forMissing(forWhom)) { setForErr(t('portal.forWhom.choose')); return; }
    void submit({ catalog_item_id: item.id, answers, details, where, ...forBody(forWhom) }, files);
  };

  return (
    <Page title={item.name} intro={item.description} icon={itemIcon(item)}>
      {item.requires_approval && <p className="pt-callout"><Icon name="info" size={18} /> {t('portal.form.needsApproval')}</p>}
      <form className="pt-form" onSubmit={onSubmit} noValidate>
        {formError && <p className="pt-form-error" role="alert" tabIndex={-1}>{formError}</p>}
        {item.questions.map((q) => {
          const err = errors[`catalog_answers.${q.key}`];
          const common = { label: q.label, required: q.required, error: err, hint: q.hint };
          if (q.type === 'choice') {
            return <ChoiceCards key={q.key} name={q.key} {...common} options={(q.options ?? []).map((o) => ({ value: o, label: o }))} value={answers[q.key] ?? ''} onChange={(v) => set(q.key, v)} />;
          }
          if (q.type === 'yes_no') {
            // The answer is stored in English ("Yes" or "No"), whatever language it was given in.
            return <ChoiceCards key={q.key} name={q.key} {...common} options={[{ value: 'Yes', label: t('common.yes') }, { value: 'No', label: t('common.no') }]} value={answers[q.key] ?? ''} onChange={(v) => set(q.key, v)} />;
          }
          if (q.type === 'date') return <DateField key={q.key} {...common} size="md" value={answers[q.key] ?? ''} onChange={(v) => set(q.key, v)} />;
          if (q.type === 'longtext') return <TextArea key={q.key} {...common} size="md" rows={3} value={answers[q.key] ?? ''} onChange={(v) => set(q.key, v)} />;
          return <TextField key={q.key} {...common} size="md" value={answers[q.key] ?? ''} onChange={(v) => set(q.key, v)} />;
        })}
        <TextArea label={t('portal.form.anythingElse')} size="md" rows={3} value={details} onChange={setDetails} error={errors.details} />
        <TextField label={t('portal.form.whereAreYou')} hint={t('portal.form.whereAreYouHint')} size="md" value={where} onChange={setWhere} />
        <ForWhom value={forWhom} onChange={(v) => { setForWhom(v); setForErr(''); }} error={forErr || errors.for_user_id} />
        <Suggestions articles={articles} title={t('portal.form.beforeSend')} />
        <FormEnd busy={busy} label={t('portal.form.sendRequest')} files={files} setFiles={setFiles} />
      </form>
    </Page>
  );
}

export function ReportProblem() {
  const config = usePortal();
  const { t } = useI18n();
  const text = useServerText();
  const [params] = useSearchParams();
  const [title, setTitle] = useState(params.get('what') ?? '');
  const [details, setDetails] = useState('');
  const [where, setWhere] = useState(params.get('where') ?? '');
  const [affects, setAffects] = useState('');
  const [urgent, setUrgent] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [forWhom, setForWhom] = useState<ForWhomState>({ mode: 'me', colleague: null });
  const [forErr, setForErr] = useState('');
  const { submit, busy, errors, formError } = useSubmit();
  const articles = useSuggestions(`${title} ${details}`.slice(0, 160));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (forMissing(forWhom)) { setForErr(t('portal.forWhom.choose')); return; }
    void submit({ title, details, where, affects, how_urgent: urgent, ...forBody(forWhom) }, files);
  };
  return (
    <Page title={t('portal.report.title')} intro={t('portal.report.intro')} icon="alert">
      <form className="pt-form" onSubmit={onSubmit} noValidate>
        {formError && <p className="pt-form-error" role="alert" tabIndex={-1}>{formError}</p>}
        <TextField label={t('portal.report.what')} required size="md" placeholder={t('portal.report.whatPlaceholder')} value={title} onChange={setTitle} error={errors.title} maxLength={200} />
        <Suggestions articles={articles} title={t('portal.report.mightFix')} />
        <TextArea label={t('portal.report.detail')} hint={t('portal.report.detailHint')} size="md" rows={4} value={details} onChange={setDetails} />
        <TextField label={t('portal.report.where')} hint={t('portal.report.whereHint')} size="md" value={where} onChange={setWhere} />
        <ChoiceCards name="affects" label={t('portal.report.affects')} required options={config.affects.map((o) => ({ value: o.value, label: text(`portal.affects.${o.value}`, o.label) }))} value={affects} onChange={setAffects} error={errors.affects} />
        <ChoiceCards name="how_urgent" label={t('portal.report.urgent')} required options={config.urgency.map((o) => ({ value: o.value, label: text(`portal.urgency.${o.value}`, o.label) }))} value={urgent} onChange={setUrgent} error={errors.how_urgent} />
        <ForWhom value={forWhom} onChange={(v) => { setForWhom(v); setForErr(''); }} error={forErr || errors.for_user_id} />
        <FormEnd busy={busy} label={t('portal.report.send')} files={files} setFiles={setFiles} />
      </form>
    </Page>
  );
}
