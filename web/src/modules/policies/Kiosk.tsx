// The acknowledgment kiosk (E29-10): runs on a supervisor's signed-in device (policies.edit). A
// member of staff picks their name, gives their employee number, reads what they are asked to
// acknowledge and confirms. Every acknowledgment records the signed-in supervisor as who recorded it.
// E41-07: each person may choose their language for their turn at the kiosk; a document with a
// translation in that language is shown translated, and the acknowledgment records the language read.
// The next person starts in the device's language again.
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  api, ApiError, Button, Card, Checkbox, EmptyState, ErrorState, errorMessage, Loading, PageHeader, TextField, useFetch,
} from '../../core';
import { I18nProvider, LanguageButtons, languageName, useI18n, useLanguageChoice } from '../../core/i18n';
import { PolicyBody } from './shared';

interface KioskPerson { id: string; name: string; position: string | null }
interface Pending {
  person: { id: string; name: string };
  items: {
    id: string; policy_ref: string; policy_title: string; policy_summary: string | null; version: number; due_on: string | null; body_html: string;
    language: string; original_language: string;
  }[];
}

export function Kiosk() {
  const [deviceLang] = useLanguageChoice();
  const [lang, setLang] = useState<string | null>(null);
  const current = lang ?? deviceLang;
  return (
    <I18nProvider lang={current} document={false}>
      <KioskBody lang={current} setLang={setLang} />
    </I18nProvider>
  );
}

function KioskBody({ lang, setLang }: { lang: string; setLang: (code: string | null) => void }) {
  const { t, date } = useI18n();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const people = useFetch<KioskPerson[]>(`/api/policies/kiosk/people${query ? `?q=${encodeURIComponent(query)}` : ''}`);
  const [person, setPerson] = useState<KioskPerson | null>(null);
  const [number, setNumber] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [read, setRead] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => { const timer = setTimeout(() => setQuery(q.trim()), 250); return () => clearTimeout(timer); }, [q]);
  // The thank-you screen clears itself, ready for the next person.
  useEffect(() => { if (!done) return; const timer = setTimeout(() => { setDone(null); setLang(null); }, 6000); return () => clearTimeout(timer); }, [done, setLang]);

  const reset = () => { setPerson(null); setNumber(''); setPending(null); setRead({}); setMessage(''); setQ(''); people.reload(); };
  const startAgain = () => { reset(); setLang(null); };

  const load = async (code: string) => {
    if (!person) return;
    setPending(await api.get<Pending>(`/api/policies/kiosk/pending?person_id=${person.id}&employee_number=${encodeURIComponent(number.trim())}&lang=${encodeURIComponent(code)}`));
  };

  async function check(e: FormEvent) {
    e.preventDefault();
    if (!person) return;
    setBusy(true); setMessage('');
    try {
      await load(lang);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // A change of language while reading fetches the texts again in that language.
  async function choose(code: string) {
    setLang(code);
    if (!pending) return;
    try { await load(code); } catch (err) { setMessage(err instanceof ApiError ? err.message : errorMessage(err)); }
  }

  async function acknowledge() {
    if (!person || !pending) return;
    const chosen = pending.items.filter((i) => read[i.id]);
    setBusy(true); setMessage('');
    try {
      const res = await api.post<{ acknowledged: number }>('/api/policies/kiosk/acknowledge', {
        person_id: person.id, employee_number: number.trim(), ack_ids: chosen.map((i) => i.id),
        // What each document was read in: its translation, or the original.
        languages: Object.fromEntries(chosen.map((i) => [i.id, i.language])),
      });
      setDone(t('kiosk.thanks', { name: pending.person.name, count: res.acknowledged }));
      reset();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  let body;
  if (done) {
    body = <Card><div className="pol-kiosk-done" role="status"><p>{done}</p><Button variant="primary" onClick={() => { setDone(null); setLang(null); }}>{t('kiosk.next')}</Button></div></Card>;
  } else if (pending) {
    const chosen = pending.items.filter((i) => read[i.id]).length;
    body = (
      <div className="stack">
        <Card title={t('kiosk.hello', { name: pending.person.name })} actions={<Button onClick={startAgain}>{t('kiosk.notYou')}</Button>}>
          <p>{t('kiosk.instructions')}</p>
        </Card>
        {pending.items.length === 0 && <Card><EmptyState icon="check-circle" title={t('kiosk.nothing')} message={t('kiosk.upToDate')} /></Card>}
        {pending.items.map((i) => (
          <Card key={i.id} title={t('kiosk.document', { ref: i.policy_ref, title: i.policy_title, version: i.version })}>
            <div className="stack" lang={i.language}>
              {i.due_on && <p className="muted">{t('kiosk.dueBy', { date: date(i.due_on) })}</p>}
              {i.language !== i.original_language && <p className="muted">{t('kiosk.translated', { language: languageName(i.language) })}</p>}
              {i.language === i.original_language && lang !== i.original_language && <p className="muted">{t('kiosk.noTranslation', { language: languageName(i.original_language) })}</p>}
              <div className="pol-kiosk-text"><PolicyBody html={i.body_html} /></div>
              <Checkbox label={t('kiosk.readIt')} checked={!!read[i.id]} onChange={(v) => setRead((r) => ({ ...r, [i.id]: v }))} />
            </div>
          </Card>
        ))}
        {message && <div className="form-error" role="alert">{message}</div>}
        {pending.items.length > 0 && (
          <div className="form-actions">
            <Button onClick={startAgain}>{t('common.cancel')}</Button>
            <Button variant="primary" loading={busy} disabled={!chosen} onClick={() => void acknowledge()}>{chosen ? t('kiosk.acknowledgeCount', { count: chosen }) : t('kiosk.acknowledge')}</Button>
          </div>
        )}
      </div>
    );
  } else if (person) {
    body = (
      <Card title={t('kiosk.hello', { name: person.name })}>
        <form className="form" onSubmit={check} noValidate>
          {message && <div className="form-error" role="alert">{message}</div>}
          <TextField label={t('kiosk.number')} value={number} onChange={setNumber} autoComplete="off" required />
          <div className="form-actions">
            <Button onClick={reset}>{t('kiosk.back')}</Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!number.trim()}>{t('kiosk.continue')}</Button>
          </div>
        </form>
      </Card>
    );
  } else {
    let list;
    if (people.error) list = <ErrorState title={t('common.loadFailed')} error={people.error} onRetry={people.reload} />;
    else if (!people.data) list = <Loading lines={4} label={t('kiosk.loadingNames')} />;
    else if (!people.data.length) list = <EmptyState icon="check-circle" title={query ? t('kiosk.noMatch') : t('kiosk.nobody')} message={query ? t('kiosk.noMatchHint') : t('kiosk.nobodyHint')} />;
    else {
      list = (
        <ul className="pol-kiosk-names">
          {people.data.map((p) => (
            <li key={p.id}><button type="button" className="pol-kiosk-name" onClick={() => setPerson(p)}><span>{p.name}</span>{p.position && <span className="muted">{p.position}</span>}</button></li>
          ))}
        </ul>
      );
    }
    body = (
      <Card title={t('kiosk.find')}>
        <div className="stack">
          <TextField label={t('kiosk.yourName')} value={q} onChange={setQ} placeholder={t('kiosk.typeName')} autoComplete="off" />
          {list}
        </div>
      </Card>
    );
  }

  return (
    <div className="stack pol-kiosk" lang={lang}>
      <PageHeader title={t('kiosk.title')} subtitle={t('kiosk.subtitle')} />
      <div className="pol-kiosk-language">
        <span className="muted" id="pol-kiosk-language">{t('common.language.label')}</span>
        <LanguageButtons value={lang} onChange={(code) => void choose(code)} />
      </div>
      {body}
    </div>
  );
}
