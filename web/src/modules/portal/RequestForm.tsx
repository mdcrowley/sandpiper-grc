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
  api, ApiError, Button, DateField, errorMessage, ErrorState, Icon, Loading, qs, TextArea, TextField, useDebounced, useFetch, useToast,
} from '../../core';
import { itemIcon } from './Home';
import { FilePicker, sendFile, Suggestions, useFocusFirstProblem, usePortal, usePortalTitle, useSuggestions, type CatalogItem, type Choice } from './parts';

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
      <ChoiceCards name="for_whom" label="Who is this for?" value={value.mode}
        hint={rule === 'department' ? 'You can raise it for a colleague in your own department. They will be told, and can follow it too.' : 'They will be told, and can follow it too.'}
        options={[{ value: 'me', label: 'Me' }, { value: 'other', label: 'A colleague' }]}
        onChange={(m) => onChange({ mode: m as ForWhomState['mode'], colleague: m === 'me' ? null : value.colleague })} />
      {value.mode === 'other' && (value.colleague ? (
        <div className="pt-picked">
          <Icon name="user" size={20} />
          <span><strong>{value.colleague.label}</strong>{value.colleague.department && <span className="muted"> · {value.colleague.department}</span>}</span>
          <button type="button" className="pt-link-btn" onClick={() => { onChange({ ...value, colleague: null }); setQ(''); }}>Change</button>
        </div>
      ) : (
        <div className="pt-colleague-search">
          <TextField label="Colleague’s name" size="md" value={q} onChange={setQ} error={error} placeholder="Type at least two letters" autoComplete="off" />
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
            ) : <p className="muted pt-none">Nobody found{rule === 'department' ? ' in your department' : ''} with that name.</p>)}
          </div>
        </div>
      ))}
    </div>
  );
}

const forBody = (w: ForWhomState) => (w.mode === 'other' && w.colleague ? { for_user_id: w.colleague.id } : {});
const forMissing = (w: ForWhomState) => w.mode === 'other' && !w.colleague;

function Page({ title, intro, icon, children }: { title: string; intro?: ReactNode; icon: Parameters<typeof Icon>[0]['name']; children: ReactNode }) {
  usePortalTitle(title);
  return (
    <div className="pt-page pt-form-page">
      <nav className="pt-back"><Link to="/portal"><Icon name="chevron-left" size={18} /> Home</Link></nav>
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
      toast.success(`Sent. Your reference is ${made.ref}.`);
      if (failed.length) toast.error(`Some files were not added: ${failed.join(' ')}`);
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
  return (
    <>
      {canAttach && <FilePicker files={files} onChange={setFiles} />}
      <div className="pt-form-actions">
        <Button type="submit" variant="primary" loading={busy} className="pt-submit">{label}</Button>
        <Link to="/portal" className="pt-link-btn">Cancel</Link>
      </div>
    </>
  );
}

export function RequestForm() {
  const { itemId } = useParams();
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
  usePortalTitle(items && !item ? 'That request is not offered here' : null);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!items) return <Loading lines={6} label="Loading the form" />;
  if (!item) {
    return (
      <div className="pt-empty-page">
        <h1>That request is not offered here</h1>
        <p className="muted">It may have been withdrawn. <Link to="/portal/catalog">See what you can ask for</Link>.</p>
      </div>
    );
  }
  const set = (key: string, v: string) => setAnswers((a) => ({ ...a, [key]: v }));
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (forMissing(forWhom)) { setForErr('Choose the colleague this is for.'); return; }
    void submit({ catalog_item_id: item.id, answers, details, where, ...forBody(forWhom) }, files);
  };

  return (
    <Page title={item.name} intro={item.description} icon={itemIcon(item)}>
      {item.requires_approval && <p className="pt-callout"><Icon name="info" size={18} /> This needs a manager’s approval before work starts. We will ask them for you.</p>}
      <form className="pt-form" onSubmit={onSubmit} noValidate>
        {formError && <p className="pt-form-error" role="alert" tabIndex={-1}>{formError}</p>}
        {item.questions.map((q) => {
          const err = errors[`catalog_answers.${q.key}`];
          const common = { label: q.label, required: q.required, error: err, hint: q.hint };
          if (q.type === 'choice') {
            return <ChoiceCards key={q.key} name={q.key} {...common} options={(q.options ?? []).map((o) => ({ value: o, label: o }))} value={answers[q.key] ?? ''} onChange={(v) => set(q.key, v)} />;
          }
          if (q.type === 'yes_no') {
            return <ChoiceCards key={q.key} name={q.key} {...common} options={[{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }]} value={answers[q.key] ?? ''} onChange={(v) => set(q.key, v)} />;
          }
          if (q.type === 'date') return <DateField key={q.key} {...common} size="md" value={answers[q.key] ?? ''} onChange={(v) => set(q.key, v)} />;
          if (q.type === 'longtext') return <TextArea key={q.key} {...common} size="md" rows={3} value={answers[q.key] ?? ''} onChange={(v) => set(q.key, v)} />;
          return <TextField key={q.key} {...common} size="md" value={answers[q.key] ?? ''} onChange={(v) => set(q.key, v)} />;
        })}
        <TextArea label="Anything else we should know?" size="md" rows={3} value={details} onChange={setDetails} error={errors.details} />
        <TextField label="Where are you?" hint="Site, depot, station or vehicle number, if it matters." size="md" value={where} onChange={setWhere} />
        <ForWhom value={forWhom} onChange={(v) => { setForWhom(v); setForErr(''); }} error={forErr || errors.for_user_id} />
        <Suggestions articles={articles} title="Before you send: these might help" />
        <FormEnd busy={busy} label="Send request" files={files} setFiles={setFiles} />
      </form>
    </Page>
  );
}

export function ReportProblem() {
  const config = usePortal();
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
    if (forMissing(forWhom)) { setForErr('Choose the colleague this is for.'); return; }
    void submit({ title, details, where, affects, how_urgent: urgent, ...forBody(forWhom) }, files);
  };
  return (
    <Page title="Report a problem" intro="Tell us what is wrong in your own words. A few lines is plenty." icon="alert">
      <form className="pt-form" onSubmit={onSubmit} noValidate>
        {formError && <p className="pt-form-error" role="alert" tabIndex={-1}>{formError}</p>}
        <TextField label="What is wrong?" required size="md" placeholder="For example: bus 3310 validator error" value={title} onChange={setTitle} error={errors.title} maxLength={200} />
        <Suggestions articles={articles} title="These might fix it straight away" />
        <TextArea label="More detail" hint="What happened, any error message, and what you have tried." size="md" rows={4} value={details} onChange={setDetails} />
        <TextField label="Where?" hint="Site, depot, station, or vehicle or fleet number." size="md" value={where} onChange={setWhere} />
        <ChoiceCards name="affects" label="Who is affected?" required options={config.affects} value={affects} onChange={setAffects} error={errors.affects} />
        <ChoiceCards name="how_urgent" label="How urgent is it?" required options={config.urgency} value={urgent} onChange={setUrgent} error={errors.how_urgent} />
        <ForWhom value={forWhom} onChange={(v) => { setForWhom(v); setForErr(''); }} error={forErr || errors.for_user_id} />
        <FormEnd busy={busy} label="Send" files={files} setFiles={setFiles} />
      </form>
    </Page>
  );
}
