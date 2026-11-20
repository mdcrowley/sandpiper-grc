// The vendor's side of an assessment response link (E06-21): a public page, no account. The
// vendor answers each question, can save and come back while the link lasts, and sends the
// answers once every question has one, with supporting files if the link allows them (E06-22).
// Staff then review them inside the application.
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { SegmentedControl } from '@mantine/core';
import { api, ApiError, Button, EmptyState, errorMessage, formatDate, formatDateTime, Loading, TextArea, TextField } from '../../core';
import { Logo } from '../../core/Logo';
import { VendorFiles, type SentFile, type UploadLimits } from './ResponseFiles';

type Answer = 'yes' | 'partial' | 'no' | 'na';
interface Entry { answer?: Answer | null; note?: string | null }
interface PublicQuestion { key: string; section: string | null; text: string; guidance: string | null }
interface Response {
  organization: string; vendor_name: string; title: string; expires_at: string; submitted_at: string | null;
  responder_name: string | null; questions: PublicQuestion[]; answers: Record<string, Entry>;
  files?: SentFile[]; upload?: UploadLimits;
}

const CHOICES: { value: Answer; label: string }[] = [
  { value: 'yes', label: 'Yes' }, { value: 'partial', label: 'Partly' }, { value: 'no', label: 'No' }, { value: 'na', label: 'Not applicable' },
];

export function VendorResponsePage() {
  const { token = '' } = useParams();
  const [data, setData] = useState<Response | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, Entry>>({});
  const [name, setName] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<'save' | 'send' | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [nameError, setNameError] = useState('');

  useEffect(() => {
    api.get<Response>(`/api/vendor-response/${encodeURIComponent(token)}`).then((r) => {
      setData(r);
      setAnswers(r.answers ?? {});
      setName(r.responder_name ?? '');
    }, (err) => setFailure(errorMessage(err)));
  }, [token]);

  useEffect(() => {
    if (data) document.title = `${data.title} · ${data.vendor_name}`;
  }, [data]);

  const sections = useMemo(() => {
    const out: { title: string; questions: PublicQuestion[] }[] = [];
    for (const q of data?.questions ?? []) {
      const title = q.section ?? 'Questions';
      const last = out[out.length - 1];
      if (last && last.title === title) last.questions.push(q);
      else out.push({ title, questions: [q] });
    }
    return out;
  }, [data?.questions]);

  if (failure) {
    return (
      <main className="vnd-resp" id="main">
        <EmptyState icon="lock" title="This link cannot be opened" message={failure} />
      </main>
    );
  }
  if (!data) return <main className="vnd-resp" id="main"><Loading lines={8} label="Loading the questions" /></main>;

  const sent = Boolean(data.submitted_at);
  const answered = data.questions.filter((q) => answers[q.key]?.answer).length;
  const set = (key: string, patch: Entry) => { setAnswers((a) => ({ ...a, [key]: { ...a[key], ...patch } })); setDirty(true); };

  async function save(submit: boolean) {
    setMessage(null);
    setNameError('');
    if (submit && !name.trim()) { setNameError('Give your name, so we know who answered.'); return; }
    setBusy(submit ? 'send' : 'save');
    try {
      const r = await api.put<Response>(`/api/vendor-response/${encodeURIComponent(token)}`, { answers, responder_name: name, submit });
      setData(r);
      setDirty(false);
      setMessage({ tone: 'ok', text: submit ? 'Thank you. Your answers have been sent.' : `Saved. You can come back to this page until ${formatDate(r.expires_at)}.` });
    } catch (err) {
      if (err instanceof ApiError && err.fields?.responder_name) setNameError(err.fields.responder_name);
      setMessage({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="vnd-resp" id="main">
      <header className="vnd-resp-head">
        {/* The organization's logo and name (Administration > Organization). */}
        <p className="vnd-resp-org"><Logo size={32} /><span>{data.organization}</span></p>
        <h1>{data.title}</h1>
        <p>
          For <strong>{data.vendor_name}</strong>. {sent
            ? `Answers sent ${formatDateTime(data.submitted_at!)}${data.responder_name ? ` by ${data.responder_name}` : ''}. Thank you.`
            : <>Please answer each question. Choose <em>Not applicable</em> where a question does not fit, and add a note where it helps. This link works until {formatDate(data.expires_at)}.</>}
        </p>
      </header>

      {message && <div className={message.tone === 'ok' ? 'notice notice-success' : 'notice notice-warn'} role={message.tone === 'ok' ? 'status' : 'alert'}>{message.text}</div>}

      {sections.map((s) => (
        <fieldset key={s.title} className="vnd-assess-section">
          <legend>{s.title}</legend>
          {s.questions.map((q) => {
            const entry = answers[q.key] ?? {};
            return (
              <div key={q.key} className="vnd-assess-q">
                <div className="vnd-assess-text">
                  <span id={`vr-q-${q.key}`}>{q.text}</span>
                  {q.guidance && <span className="vnd-clause-hint">{q.guidance}</span>}
                </div>
                <SegmentedControl
                  size="xs" aria-labelledby={`vr-q-${q.key}`} data={CHOICES} value={entry.answer ?? ''} disabled={sent}
                  onChange={(v) => set(q.key, { answer: v as Answer })}
                />
                <div className="vnd-assess-note">
                  <TextArea label={`Note on: ${q.text}`} hideLabel rows={1} placeholder="Note (optional)" value={entry.note ?? ''} disabled={sent}
                    onChange={(v) => set(q.key, { note: v })} />
                </div>
              </div>
            );
          })}
        </fieldset>
      ))}

      {data.upload && (
        <VendorFiles token={token} files={data.files ?? []} limits={data.upload} sent={sent}
          onChange={(files) => setData((d) => (d ? { ...d, files } : d))} />
      )}

      {!sent && (
        <>
          <TextField label="Your name and role" required value={name} onChange={(v) => { setName(v); setDirty(true); }} error={nameError}
            hint="So we know who answered. Needed to send the answers." />
          <div className="vnd-resp-bar">
            <Button loading={busy === 'save'} disabled={busy !== null || !dirty} onClick={() => void save(false)}>Save and finish later</Button>
            <Button variant="primary" loading={busy === 'send'} disabled={busy !== null || answered < data.questions.length} onClick={() => void save(true)}>
              {answered < data.questions.length ? `Send answers (${data.questions.length - answered} to answer)` : 'Send answers'}
            </Button>
            <span className="vnd-resp-state" aria-live="polite">{answered} of {data.questions.length} answered{dirty ? ' · not saved yet' : ''}</span>
          </div>
        </>
      )}
    </main>
  );
}
