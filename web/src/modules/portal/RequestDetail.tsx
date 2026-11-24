// One of my requests: where it is in plain words, what I asked, the conversation with IT
// (public messages only), files, and - once it is done - rating it or reopening it.
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  api, ApiError, Button, errorMessage, Icon, Loading, TextArea, useFetch, useToast,
} from '../../core';
import { useI18n } from '../../core/i18n';
import { FilePicker, formatSize, PortalError, sendFile, StatusPill, usePortal, usePortalTitle, useServerText, type PlainStatus } from './parts';

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
  const { t } = useI18n();
  const word = (n: number) => (n >= 1 && n <= 5 ? t(`portal.rate.word${n}`) : '');
  return (
    <div className="pt-stars" role="radiogroup" aria-label={t('portal.rate.label')}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={t('portal.rate.star', { n, word: word(n) })}
          className={n <= value ? 'is-on' : ''} onClick={() => onChange(n)}>
          <Icon name="star" size={30} />
        </button>
      ))}
      <span className="pt-stars-word" aria-hidden="true">{word(value)}</span>
    </div>
  );
}

function RateBox({ id, onDone }: { id: string; onDone: () => void }) {
  const toast = useToast();
  const { t } = useI18n();
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try {
      await api.post(`/api/portal/requests/${id}/rating`, { score, comment });
      toast.success(t('portal.rate.thanks'));
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="pt-card pt-rate">
      <h2>{t('portal.rate.title')}</h2>
      <p className="muted">{t('portal.rate.intro')}</p>
      <Stars value={score} onChange={setScore} />
      {score > 0 && (
        <>
          <TextArea label={t('portal.rate.comment')} size="md" rows={2} value={comment} onChange={setComment} />
          <Button variant="primary" loading={busy} onClick={() => void send()}>{t('portal.rate.send')}</Button>
        </>
      )}
    </div>
  );
}

function ReopenBox({ d, onDone }: { d: Detail; onDone: () => void }) {
  const toast = useToast();
  const { t, date } = useI18n();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function send() {
    if (!reason.trim()) { setError(t('portal.reopen.sayWhat')); return; }
    setBusy(true);
    try {
      await api.post(`/api/portal/requests/${d.id}/reopen`, { reason });
      toast.success(t('portal.reopen.done'));
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
          <p><strong>{t('portal.reopen.still')}</strong> <span className="muted">{t('portal.reopen.until', { date: date(d.reopen_until) })}</span></p>
          <Button variant="secondary" icon="refresh" onClick={() => setOpen(true)}>{t('portal.reopen.button')}</Button>
        </div>
      ) : (
        <>
          <TextArea label={t('portal.reopen.what')} required size="md" rows={3} value={reason} onChange={(v) => { setReason(v); setError(''); }} error={error} />
          <div className="pt-form-actions">
            <Button variant="primary" loading={busy} onClick={() => void send()}>{t('portal.reopen.send')}</Button>
            <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
          </div>
        </>
      )}
    </div>
  );
}

function Reply({ d, onDone }: { d: Detail; onDone: () => void }) {
  const toast = useToast();
  const { t } = useI18n();
  const { files: canAttach } = usePortal();
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!body.trim() && !files.length) { setError(t('portal.reply.empty')); return; }
    setBusy(true);
    try {
      if (body.trim()) await api.post(`/api/portal/requests/${d.id}/messages`, { body });
      const failed: string[] = [];
      for (const f of files) {
        try { await sendFile(d.id, f); } catch (err) { failed.push(errorMessage(err)); }
      }
      if (failed.length) toast.error(failed.join(' '));
      else toast.success(body.trim() ? t('portal.reply.sent') : t('portal.reply.fileAdded'));
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
      <TextArea label={d.status.waiting_on_you ? t('portal.reply.yours') : t('portal.reply.add')} size="md" rows={3} value={body}
        onChange={(v) => { setBody(v); setError(''); }} error={error}
        hint={d.status.waiting_on_you ? t('portal.reply.waiting') : undefined} />
      {canAttach && <FilePicker files={files} onChange={setFiles} />}
      <div className="pt-form-actions">
        <Button type="submit" variant="primary" icon="message" loading={busy}>{t('portal.reply.send')}</Button>
      </div>
    </form>
  );
}

export function RequestDetail() {
  const { id } = useParams();
  const { t, dateTime, ago } = useI18n();
  const text = useServerText();
  const { data: d, error, reload } = useFetch<Detail>(`/api/portal/requests/${id}`);
  usePortalTitle(d ? `${d.ref} ${d.title}` : error ? t('portal.detail.notFound') : null);
  if (error) {
    if (error instanceof ApiError && error.status === 404) {
      return (
        <div className="pt-empty-page">
          <h1>{t('portal.detail.notFound')}</h1>
          <p className="muted">{t('portal.detail.notYours')} <Link to="/portal/requests">{t('portal.detail.seeMine')}</Link>.</p>
        </div>
      );
    }
    return <PortalError error={error} onRetry={reload} />;
  }
  if (!d) return <Loading lines={8} label={t('portal.detail.loading')} />;

  return (
    <div className="pt-page pt-detail">
      <nav className="pt-back"><Link to="/portal/requests"><Icon name="chevron-left" size={18} /> {t('portal.requests.title')}</Link></nav>
      <header className="pt-detail-head">
        <p className="pt-ref">{d.ref}{d.item ? ` · ${d.item.name}` : ''}</p>
        <h1>{d.title}</h1>
        {d.raised_by && <p className="pt-raised"><Icon name="user" size={16} /> {t('portal.detail.raisedBy', { name: d.raised_by })}</p>}
        {d.raised_for && <p className="pt-raised"><Icon name="users" size={16} /> {t('portal.detail.raisedFor', { name: d.raised_for })}</p>}
        <div className={`pt-status-box pt-tone-box-${d.status.tone}`}>
          <StatusPill status={d.status} />
          <p>{text(`portal.status.${d.status.key}.hint`, d.status.hint)}{d.assignee_name && !d.status.done ? ` ${t('portal.detail.lookingAfter', { name: d.assignee_name })}` : ''}</p>
        </div>
        {d.approval_note && <p className="pt-callout"><Icon name="info" size={18} /> {t('portal.detail.reason', { reason: d.approval_note })}</p>}
      </header>

      {d.can_rate && <RateBox id={d.id} onDone={reload} />}
      {d.rating && (
        <p className="pt-rated"><Icon name="star" size={18} /> {d.rating.comment ? t('portal.detail.ratedWith', { score: d.rating.score, comment: d.rating.comment }) : t('portal.detail.rated', { score: d.rating.score })}</p>
      )}
      {d.can_reopen && <ReopenBox d={d} onDone={reload} />}

      {d.resolution && (d.resolution.notes || d.resolution.label) && (
        <div className="pt-card pt-resolution">
          <h2>{t('portal.detail.done')}</h2>
          {d.resolution.label && <p><strong>{d.resolution.label}</strong></p>}
          {d.resolution.notes && <p className="prose">{d.resolution.notes}</p>}
        </div>
      )}

      <section className="pt-card" aria-labelledby="pt-asked">
        <h2 id="pt-asked">{t('portal.detail.told')}</h2>
        <dl className="pt-facts">
          {d.answers.map((a) => (
            <div key={a.label}><dt>{a.label}</dt><dd>{a.value}</dd></div>
          ))}
          {d.description && <div className="pt-facts-wide"><dt>{t('portal.detail.details')}</dt><dd className="prose">{d.description}</dd></div>}
          <div><dt>{t('portal.detail.sentAt')}</dt><dd>{dateTime(d.opened_at)}</dd></div>
        </dl>
        {d.files && d.files.some((f) => !f.from_desk) && (
          <>
            <h3 className="pt-sub">{t('portal.detail.yourFiles')}</h3>
            <ul className="pt-file-list">
              {d.files.filter((f) => !f.from_desk).map((f) => (
                <li key={f.id}>
                  <Icon name="file-text" size={18} />
                  <a className="truncate" href={`/api/attachments/${f.id}/download`}>{f.file_name}</a>
                  <span className="muted">{formatSize(Number(f.size_bytes), t)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {d.files && d.files.some((f) => f.from_desk) && (
        <section className="pt-card" aria-labelledby="pt-desk-files">
          <h2 id="pt-desk-files">{t('portal.detail.deskFiles')}</h2>
          <ul className="pt-file-list">
            {d.files.filter((f) => f.from_desk).map((f) => (
              <li key={f.id}>
                <Icon name="download" size={18} />
                <a className="truncate" href={`/api/attachments/${f.id}/download`}>{f.file_name}</a>
                <span className="muted">{formatSize(Number(f.size_bytes), t)}{f.shared_by_name ? ` · ${t('portal.detail.from', { name: f.shared_by_name })}` : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="pt-card" aria-labelledby="pt-conv">
        <h2 id="pt-conv">{t('portal.detail.messages')}</h2>
        {d.messages.length ? (
          <ol className="pt-thread">
            {d.messages.map((m) => (
              <li key={m.id} className={m.mine ? 'pt-msg pt-msg-mine' : 'pt-msg'}>
                <div className="pt-msg-meta">
                  <strong>{m.mine ? t('portal.detail.you') : m.author_name}</strong>
                  <time dateTime={m.created_at} title={dateTime(m.created_at)}>{ago(m.created_at)}</time>
                </div>
                <p className="prose">{m.body}</p>
              </li>
            ))}
          </ol>
        ) : <p className="muted pt-none">{t('portal.detail.noMessages')}</p>}
        {d.can_reply && <Reply d={d} onDone={reload} />}
      </section>
    </div>
  );
}
