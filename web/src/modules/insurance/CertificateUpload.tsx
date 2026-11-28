// The vendor's side of a certificate request (E46-65): a public page, no account. The link's secret is
// in the address's fragment (`/certificate-upload#<secret>`), which browsers never send to a server; the
// page sends it in the X-Upload-Token header. The vendor sends each certificate (the file and its
// details), sees what was sent, and says when they are done. Staff review each certificate inside the
// application.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, Button, Checkbox, DateField, EmptyState, errorMessage, formatDate, Loading, NumberField, Select, TextField } from '../../core';
import { Logo } from '../../core/Logo';
import './insurance.css';

interface Line { line: string; label: string; min_per_occurrence: number | null; min_aggregate: number | null; additional_insured: boolean; waiver_of_subrogation: boolean }
interface View {
  organization: string; vendor_name: string | null; contract_title: string | null; lines: Line[]; all_lines: { value: string; label: string }[];
  needed_by: string | null; expires_at: string; submitted_at: string | null; responder_name: string | null;
  certificates: { ref: string; line: string; line_label: string; expires_on: string | null; sent_at: string }[];
  files: { id: string; file_name: string; size_bytes: number }[];
  upload: { available: boolean; max_files: number; max_bytes: number; max_file_bytes: number; file_types: string[] };
  done?: boolean;
}
interface Draft {
  line: string; insurer_name: string; policy_number: string; effective_on: string; expires_on: string;
  limit_per_occurrence: number | null; limit_aggregate: number | null; additional_insured: boolean; waiver_of_subrogation: boolean;
}
const EMPTY: Draft = { line: '', insurer_name: '', policy_number: '', effective_on: '', expires_on: '', limit_per_occurrence: null, limit_aggregate: null, additional_insured: false, waiver_of_subrogation: false };
const money = (n: number | null) => (n == null ? null : new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n));

/** A call to the upload routes: the secret in a header, the same security header as every other change. */
async function call<T>(token: string, method: string, path: string, body?: unknown, file?: File): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Upload-Token': token };
  if (method !== 'GET') headers['X-GRC-CSRF'] = '1';
  if (file) headers['Content-Type'] = 'application/octet-stream';
  else if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`/api/insurance/certificate-upload${path}`, { method, headers, credentials: 'same-origin', body: file ?? (body === undefined ? undefined : JSON.stringify(body)) });
  } catch {
    throw new ApiError(0, 'network', 'The page could not reach the server. Check your connection and try again.');
  }
  const data = await res.json().catch(() => ({})) as { error?: { code?: string; message?: string; fields?: Record<string, string> } };
  if (!res.ok) throw new ApiError(res.status, data.error?.code ?? `http_${res.status}`, data.error?.message ?? `Something went wrong (${res.status}).`, data.error?.fields);
  return data as T;
}

const extensionOf = (name: string) => (name.lastIndexOf('.') > 0 ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');

export function CertificateUploadPage() {
  const token = useMemo(() => decodeURIComponent(window.location.hash.replace(/^#/, '')), []);
  const [view, setView] = useState<View | null>(null);
  const [failure, setFailure] = useState<string | null>(token ? null : 'This page needs the link from the email you received. Open the link from the email again.');
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [file, setFile] = useState<File | null>(null);
  const [heldId, setHeldId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'send' | 'done' | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!token) return;
    call<View>(token, 'GET', '').then((v) => { setView(v); setName(v.responder_name ?? ''); }, (err) => setFailure(errorMessage(err)));
  }, [token]);
  useEffect(() => { if (view) document.title = `Certificates of insurance · ${view.organization}`; }, [view]);

  if (failure) {
    return (
      <main className="ins-up" id="main">
        <header className="ins-up-head"><h1>Certificates of insurance</h1></header>
        <EmptyState icon="lock" title="This link cannot be opened" message={failure} />
      </main>
    );
  }
  if (!view) return <main className="ins-up" id="main"><Loading lines={8} label="Loading the request" /></main>;

  const finished = Boolean(view.submitted_at || view.done);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const lineOptions = [
    ...view.lines.map((l) => ({ value: l.line, label: l.label })),
    ...view.all_lines.filter((l) => !view.lines.some((x) => x.line === l.value)),
  ];

  async function send() {
    setMessage(null); setErrors({});
    const local: Record<string, string> = {};
    if (view!.upload.available && !file && !heldId) local.file = 'Choose the certificate file (a PDF or a picture).';
    if (file && !view!.upload.file_types.includes(extensionOf(file.name))) local.file = `Files of this type cannot be sent. Allowed: ${view!.upload.file_types.join(', ')}.`;
    else if (file && file.size > view!.upload.max_file_bytes) local.file = 'The file is too large.';
    if (Object.keys(local).length) { setErrors(local); return; }
    setBusy('send');
    try {
      let fileId = heldId;
      if (file && !fileId) {
        const sent = await call<{ id: string }>(token, 'PUT', `/files?name=${encodeURIComponent(file.name)}`, undefined, file);
        fileId = sent.id;
        setHeldId(sent.id);
      }
      const v = await call<View>(token, 'POST', '/certificates', { ...draft, file_id: fileId, responder_name: name });
      setView(v);
      setDraft(EMPTY); setFile(null); setHeldId(null);
      if (input.current) input.current.value = '';
      setMessage({ tone: 'ok', text: 'Thank you. The certificate has been sent. Send the next one, or say you are done below.' });
    } catch (err) {
      const fields = err instanceof ApiError ? err.fields : undefined;
      if (fields && Object.keys(fields).length) setErrors(fields.file_id ? { ...fields, file: fields.file_id } : fields);
      setMessage({ tone: 'error', text: errorMessage(err) });
    } finally { setBusy(null); }
  }

  async function done() {
    setMessage(null); setErrors({});
    setBusy('done');
    try {
      setView(await call<View>(token, 'POST', '/done', { responder_name: name }));
      setMessage({ tone: 'ok', text: 'Thank you. Your certificates have been sent for review. You can close this page.' });
    } catch (err) {
      const fields = err instanceof ApiError ? err.fields : undefined;
      if (fields) setErrors(fields);
      setMessage({ tone: 'error', text: errorMessage(err) });
    } finally { setBusy(null); }
  }

  return (
    <main className="ins-up" id="main">
      <header className="ins-up-head">
        <p className="ins-up-org"><Logo size={32} /><span>{view.organization}</span></p>
        <h1>Certificates of insurance</h1>
        <p>
          {view.vendor_name ? <>For <strong>{view.vendor_name}</strong>{view.contract_title ? <>, contract <strong>{view.contract_title}</strong></> : null}. </> : null}
          {finished
            ? 'Your certificates have been sent. Thank you.'
            : <>Send a current certificate of insurance for each line of coverage below{view.needed_by ? <>, by {formatDate(view.needed_by)}</> : null}. This link works until {formatDate(view.expires_at)}.</>}
        </p>
      </header>

      {message && <div className={message.tone === 'ok' ? 'notice notice-success' : 'notice notice-warn'} role={message.tone === 'ok' ? 'status' : 'alert'}>{message.text}</div>}

      {view.lines.length > 0 && (
        <section className="ins-up-card" aria-labelledby="ins-up-asked">
          <h2 id="ins-up-asked">What is asked for</h2>
          <ul className="ins-up-list">
            {view.lines.map((l) => {
              const parts = [
                l.min_per_occurrence != null ? `at least ${money(l.min_per_occurrence)} per occurrence` : null,
                l.min_aggregate != null ? `${money(l.min_aggregate)} aggregate` : null,
                l.additional_insured ? `${view.organization} named as additional insured` : null,
                l.waiver_of_subrogation ? 'a waiver of subrogation' : null,
              ].filter(Boolean);
              const sent = view.certificates.some((c) => c.line === l.line);
              return <li key={l.line}><strong>{l.label}</strong>{parts.length ? `: ${parts.join(', ')}` : ''}{sent ? ' (sent)' : ''}</li>;
            })}
          </ul>
        </section>
      )}

      {view.certificates.length > 0 && (
        <section className="ins-up-card" aria-labelledby="ins-up-sent">
          <h2 id="ins-up-sent">Sent so far</h2>
          <ul className="ins-up-list">
            {view.certificates.map((c) => <li key={c.ref}>{c.line_label}{c.expires_on ? `, coverage until ${formatDate(c.expires_on)}` : ''} ({c.ref})</li>)}
          </ul>
        </section>
      )}

      {!finished && (
        <form className="ins-up-card form" noValidate onSubmit={(e) => { e.preventDefault(); void send(); }} aria-labelledby="ins-up-form">
          <h2 id="ins-up-form">Send a certificate</h2>
          {view.upload.available && (
            <div className="ins-up-file">
              <label htmlFor="ins-up-file-input">Certificate file (required)</label>
              <input id="ins-up-file-input" ref={input} type="file" accept={view.upload.file_types.map((x) => `.${x}`).join(',')}
                aria-describedby="ins-up-file-hint" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setHeldId(null); }} />
              <span id="ins-up-file-hint" className="muted ins-small">{`${view.upload.file_types.join(', ').toUpperCase()}; one certificate per send.`}</span>
              {errors.file && <span className="ins-bad ins-small" role="alert">{errors.file}</span>}
            </div>
          )}
          <div className="form-grid">
            <Select label="Line of coverage" required value={draft.line} options={[{ value: '', label: 'Choose…' }, ...lineOptions]} onChange={(v) => set({ line: v })} error={errors.line} />
            <TextField label="Insurer" required value={draft.insurer_name} onChange={(v) => set({ insurer_name: v })} error={errors.insurer_name} />
            <TextField label="Policy number" value={draft.policy_number} onChange={(v) => set({ policy_number: v })} error={errors.policy_number} />
            <DateField label="Coverage from" value={draft.effective_on} onChange={(v) => set({ effective_on: v })} error={errors.effective_on} />
            <DateField label="Coverage until" required value={draft.expires_on} onChange={(v) => set({ expires_on: v })} error={errors.expires_on} />
            <NumberField label="Limit per occurrence" min={0} thousands value={draft.limit_per_occurrence} onChange={(v) => set({ limit_per_occurrence: v })} error={errors.limit_per_occurrence} />
            <NumberField label="Aggregate limit" min={0} thousands value={draft.limit_aggregate} onChange={(v) => set({ limit_aggregate: v })} error={errors.limit_aggregate} />
          </div>
          <Checkbox label={`${view.organization} is named as additional insured`} checked={draft.additional_insured} onChange={(v) => set({ additional_insured: v })} />
          <Checkbox label="The certificate shows a waiver of subrogation" checked={draft.waiver_of_subrogation} onChange={(v) => set({ waiver_of_subrogation: v })} />
          <TextField label="Your name and role" required value={name} onChange={setName} error={errors.responder_name} hint="So we know who sent the certificates." />
          <div className="ins-up-bar">
            <Button type="submit" variant="primary" loading={busy === 'send'} disabled={busy !== null}>Send certificate</Button>
            <Button loading={busy === 'done'} disabled={busy !== null || view.certificates.length === 0} onClick={() => void done()}>I have sent them all</Button>
          </div>
        </form>
      )}
    </main>
  );
}
