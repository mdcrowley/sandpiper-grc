// Read a policy I have been asked to acknowledge, and acknowledge it. When the version has a
// translation in my language it is shown, with a way to read the original; the acknowledgment records
// the language I read it in (E41-07).
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, Button, errorMessage, Icon, Loading, useFetch, useToast } from '../../core';
import { languageName, useI18n } from '../../core/i18n';
import { PortalError, usePortalTitle } from './parts';

interface Ack {
  id: string; policy_title: string; policy_ref: string; version: number; effective_on: string | null; due_on: string;
  acknowledged_at: string | null; acknowledged_language: string | null; state: string; change_summary: string | null; body_html: string;
  /** The language of the text given: a translation's, or the original's. */
  language: string; original_language: string; translations: string[];
}

export function PolicyPage() {
  const { ackId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { t, lang, date, dateTime } = useI18n();
  // The person may switch to the original text (or back) on this page only.
  const [reading, setReading] = useState<string | null>(null);
  const want = reading ?? lang;
  const { data: a, error, reload } = useFetch<Ack>(`/api/policies/acknowledgments/${ackId}?lang=${encodeURIComponent(want)}`, { keepPrevious: true });
  const [busy, setBusy] = useState(false);
  usePortalTitle(a ? a.policy_title : error ? t('portal.policy.nothing') : null);

  async function acknowledge() {
    if (!a) return;
    setBusy(true);
    try {
      await api.post(`/api/policies/acknowledgments/${ackId}/acknowledge`, { language: a.language });
      toast.success(t('portal.policy.thanks'));
      navigate('/portal');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    if (error instanceof ApiError && error.status === 404) {
      return <div className="pt-empty-page"><h1>{t('portal.policy.nothing')}</h1><p className="muted"><Link to="/portal">{t('portal.back')}</Link></p></div>;
    }
    return <PortalError error={error} onRetry={reload} />;
  }
  if (!a) return <Loading lines={8} label={t('portal.policy.loading')} />;
  const translated = a.language !== a.original_language;
  const offered = lang !== a.original_language && a.translations.includes(lang);
  return (
    <div className="pt-page pt-article">
      <nav className="pt-back"><Link to="/portal"><Icon name="chevron-left" size={18} /> {t('portal.nav.home')}</Link></nav>
      <p className="pt-ref">{a.policy_ref} · {t('portal.policy.version', { version: a.version })}{a.effective_on ? ` · ${t('portal.policy.inForce', { date: date(a.effective_on) })}` : ''}</p>
      <h1 lang={a.language}>{a.policy_title}</h1>
      {(translated || offered) && (
        <p className="pt-callout pt-policy-language">
          <Icon name="info" size={18} />
          <span>
            {translated ? t('portal.policy.translated', { language: languageName(a.language) }) : t('portal.policy.original', { language: languageName(a.original_language) })}{' '}
            <button type="button" className="pt-link-btn" onClick={() => setReading(translated ? a.original_language : lang)}>
              {translated ? t('portal.policy.readOriginal', { language: languageName(a.original_language) }) : t('portal.policy.readTranslation', { language: languageName(lang) })}
            </button>
          </span>
        </p>
      )}
      {!translated && !offered && lang !== a.original_language && <p className="muted">{t('portal.policy.noTranslation', { language: languageName(a.original_language) })}</p>}
      {a.change_summary && <p className="pt-callout"><Icon name="info" size={18} /> {t('portal.policy.changed', { summary: a.change_summary })}</p>}
      {/* The policies module renders the text to safe HTML on the server. */}
      <div className="pt-card pt-policy-body" lang={a.language} dangerouslySetInnerHTML={{ __html: a.body_html }} />
      <div className="pt-card pt-ack">
        {a.acknowledged_at ? (
          <p className="pt-ack-done"><Icon name="check-circle" size={20} /> {a.acknowledged_language
            ? t('portal.policy.doneIn', { when: dateTime(a.acknowledged_at), language: languageName(a.acknowledged_language) })
            : t('portal.policy.done', { when: dateTime(a.acknowledged_at) })}</p>
        ) : (
          <>
            <p><strong>{t('portal.policy.confirm')}</strong>{a.due_on ? ` ${t('portal.policy.by', { date: date(a.due_on) })}` : ''}.</p>
            {translated && <p className="muted">{t('portal.policy.recordsLanguage', { language: languageName(a.language) })}</p>}
            <Button variant="primary" icon="check" loading={busy} className="pt-submit" onClick={() => void acknowledge()}>{t('portal.policy.button')}</Button>
          </>
        )}
      </div>
    </div>
  );
}
