// One of my requests: where it is in plain words, what I asked, the conversation with IT
// (public messages only), files, and - once it is done - rating it or reopening it.
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  api, ApiError, Button, errorMessage, ErrorState, formatDate, formatDateTime, Icon, Loading, relativeTime, TextArea, useFetch, useToast,
} from '../../core';
import { FilePicker, formatSize, sendFile, StatusPill, usePortal, type PlainStatus } from './parts';

interface Detail {
  id: string; ref: string; title: string; description: string | null; status: PlainStatus;
  opened_at: string; updated_at: string; resolved_at: string | null; closed_at: string | null;
  item: { id: string; name: string } | null; answers: { label: string; value: string }[]; assignee_name: string | null;
  raised_by?: string | null; raised_for?: string | null;
  resolution: { label: string | null; notes: string | null } | null; approval_note: string | null;
  rating: { score: number; comment: string | null; at: string } | null;
  can_rate: boolean; can_reopen: boolean; reopen_until: string | null; can_reply: boolean;
  messages: { id: string; body: string; author_name: string; mine: boolean; created_at: string }[];
  files: { id: string; file_name: string; size_bytes: number; uploaded_at: string; from_desk?: boolean; shared_by_name?: string | null }[] | null;
}

function Stars({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const words = ['', 'Very poor', 'Poor', 'OK', 'Good', 'Very good'];
  return (
    <div className="pt-stars" role="radiogroup" aria-label="Your rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} out of 5: ${words[n]}`}
          className={n <= value ? 'is-on' : ''} onClick={() => onChange(n)}>
          <Icon name="star" size={30} />
        </button>
      ))}
      <span className="pt-stars-word" aria-hidden="true">{words[value] ?? ''}</span>
    </div>
  );
}

function RateBox({ id, onDone }: { id: string; onDone: () => void }) {
  const toast = useToast();
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try {
      await api.post(`/api/portal/requests/${id}/rating`, { score, comment });
      toast.success('Thank you for your answer.');
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="pt-card pt-rate">
      <h2>How did we do?</h2>
      <p className="muted">One tap is enough. Your answer helps the service desk improve.</p>
      <Stars value={score} onChange={setScore} />
      {score > 0 && (
        <>
          <TextArea label="Anything you would like to add? (optional)" size="md" rows={2} value={comment} onChange={setComment} />
          <Button variant="primary" loading={busy} onClick={() => void send()}>Send my answer</Button>
        </>
      )}
    </div>
  );
}

function ReopenBox({ d, onDone }: { d: Detail; onDone: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function send() {
    if (!reason.trim()) { setError('Say what is still wrong.'); return; }
    setBusy(true);
    try {
      await api.post(`/api/portal/requests/${d.id}/reopen`, { reason });
      toast.success('Reopened. IT have been told.');
      onDone();
    } catch (err) {
      setError(err instanceof ApiError && err.fields?.reason ? err.fields.reason : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="pt-card pt-reopen">
      {!open ? (
        <div className="pt-reopen-row">
          <p><strong>Still not right?</strong> <span className="muted">You can reopen this until {formatDate(d.reopen_until)}.</span></p>
          <Button variant="secondary" icon="refresh" onClick={() => setOpen(true)}>Reopen</Button>
        </div>
      ) : (
        <>
          <TextArea label="What is still wrong?" required size="md" rows={3} value={reason} onChange={(v) => { setReason(v); setError(''); }} error={error} />
          <div className="pt-form-actions">
            <Button variant="primary" loading={busy} onClick={() => void send()}>Reopen request</Button>
            <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </>
      )}
    </div>
  );
}

function Reply({ d, onDone }: { d: Detail; onDone: () => void }) {
  const toast = useToast();
  const { files: canAttach } = usePortal();
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!body.trim() && !files.length) { setError('Write your message, or add a file.'); return; }
    setBusy(true);
    try {
      if (body.trim()) await api.post(`/api/portal/requests/${d.id}/messages`, { body });
      const failed: string[] = [];
      for (const f of files) {
        try { await sendFile(d.id, f); } catch (err) { failed.push(errorMessage(err)); }
      }
      if (failed.length) toast.error(failed.join(' '));
      else toast.success(body.trim() ? 'Message sent.' : 'File added.');
      setBody('');
      setFiles([]);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="pt-reply" onSubmit={send}>
      <TextArea label={d.status.waiting_on_you ? 'Your reply' : 'Add a message'} size="md" rows={3} value={body}
        onChange={(v) => { setBody(v); setError(''); }} error={error}
        hint={d.status.waiting_on_you ? 'IT are waiting for your answer.' : undefined} />
      {canAttach && <FilePicker files={files} onChange={setFiles} label="Add a photo or file" />}
      <div className="pt-form-actions">
        <Button type="submit" variant="primary" icon="message" loading={busy}>Send</Button>
      </div>
    </form>
  );
}

export function RequestDetail() {
  const { id } = useParams();
  const { data: d, error, reload } = useFetch<Detail>(`/api/portal/requests/${id}`);
  useEffect(() => { if (d) document.title = `${d.ref} ${d.title}`; }, [d]);
  if (error) {
    if (error instanceof ApiError && error.status === 404) {
      return (
        <div className="pt-empty-page">
          <h1>Request not found</h1>
          <p className="muted">It may not be yours, or the link is wrong. <Link to="/portal/requests">See my requests</Link>.</p>
        </div>
      );
    }
    return <ErrorState error={error} onRetry={reload} />;
  }
  if (!d) return <Loading lines={8} label="Loading the request" />;

  return (
    <div className="pt-page pt-detail">
      <nav className="pt-back"><Link to="/portal/requests"><Icon name="chevron-left" size={18} /> My requests</Link></nav>
      <header className="pt-detail-head">
        <p className="pt-ref">{d.ref}{d.item ? ` · ${d.item.name}` : ''}</p>
        <h1>{d.title}</h1>
        {d.raised_by && <p className="pt-raised"><Icon name="user" size={16} /> Raised for you by {d.raised_by}</p>}
        {d.raised_for && <p className="pt-raised"><Icon name="users" size={16} /> You raised this for {d.raised_for}</p>}
        <div className={`pt-status-box pt-tone-box-${d.status.tone}`}>
          <StatusPill status={d.status} />
          <p>{d.status.hint}{d.assignee_name && !d.status.done ? ` ${d.assignee_name} is looking after it.` : ''}</p>
        </div>
        {d.approval_note && <p className="pt-callout"><Icon name="info" size={18} /> Reason given: {d.approval_note}</p>}
      </header>

      {d.can_rate && <RateBox id={d.id} onDone={reload} />}
      {d.rating && (
        <p className="pt-rated"><Icon name="star" size={18} /> You rated this {d.rating.score} out of 5{d.rating.comment ? `: “${d.rating.comment}”` : '.'}</p>
      )}
      {d.can_reopen && <ReopenBox d={d} onDone={reload} />}

      {d.resolution && (d.resolution.notes || d.resolution.label) && (
        <div className="pt-card pt-resolution">
          <h2>What was done</h2>
          {d.resolution.label && <p><strong>{d.resolution.label}</strong></p>}
          {d.resolution.notes && <p className="prose">{d.resolution.notes}</p>}
        </div>
      )}

      <section className="pt-card" aria-labelledby="pt-asked">
        <h2 id="pt-asked">What you told us</h2>
        <dl className="pt-facts">
          {d.answers.map((a) => (
            <div key={a.label}><dt>{a.label}</dt><dd>{a.value}</dd></div>
          ))}
          {d.description && <div className="pt-facts-wide"><dt>Details</dt><dd className="prose">{d.description}</dd></div>}
          <div><dt>Sent</dt><dd>{formatDateTime(d.opened_at)}</dd></div>
        </dl>
        {d.files && d.files.some((f) => !f.from_desk) && (
          <>
            <h3 className="pt-sub">Your files</h3>
            <ul className="pt-file-list">
              {d.files.filter((f) => !f.from_desk).map((f) => (
                <li key={f.id}>
                  <Icon name="file-text" size={18} />
                  <a className="truncate" href={`/api/attachments/${f.id}/download`}>{f.file_name}</a>
                  <span className="muted">{formatSize(Number(f.size_bytes))}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {d.files && d.files.some((f) => f.from_desk) && (
        <section className="pt-card" aria-labelledby="pt-desk-files">
          <h2 id="pt-desk-files">Files from the service desk</h2>
          <ul className="pt-file-list">
            {d.files.filter((f) => f.from_desk).map((f) => (
              <li key={f.id}>
                <Icon name="download" size={18} />
                <a className="truncate" href={`/api/attachments/${f.id}/download`}>{f.file_name}</a>
                <span className="muted">{formatSize(Number(f.size_bytes))}{f.shared_by_name ? ` · from ${f.shared_by_name}` : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="pt-card" aria-labelledby="pt-conv">
        <h2 id="pt-conv">Messages</h2>
        {d.messages.length ? (
          <ol className="pt-thread">
            {d.messages.map((m) => (
              <li key={m.id} className={m.mine ? 'pt-msg pt-msg-mine' : 'pt-msg'}>
                <div className="pt-msg-meta">
                  <strong>{m.mine ? 'You' : m.author_name}</strong>
                  <time dateTime={m.created_at} title={formatDateTime(m.created_at)}>{relativeTime(m.created_at)}</time>
                </div>
                <p className="prose">{m.body}</p>
              </li>
            ))}
          </ol>
        ) : <p className="muted pt-none">No messages yet. IT will write here if they need anything.</p>}
        {d.can_reply && <Reply d={d} onDone={reload} />}
      </section>
    </div>
  );
}
