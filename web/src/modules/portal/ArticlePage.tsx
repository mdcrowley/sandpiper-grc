// One help article for all staff, with "Was this helpful?".
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, errorMessage, Icon, Loading, useFetch, useToast } from '../../core';
import { useI18n } from '../../core/i18n';
import { PortalError, usePortal, usePortalTitle } from './parts';

interface ArticleDetail { id: string; ref: string; title: string; body: string | null; updated_at: string; your_vote: boolean | null }

export function ArticlePage() {
  const { id } = useParams();
  const toast = useToast();
  const { t, date } = useI18n();
  const { can_create } = usePortal();
  const { data: a, error, reload } = useFetch<ArticleDetail>(`/api/portal/knowledge/${id}`);
  const [vote, setVote] = useState<boolean | null>(null);
  useEffect(() => { if (a) setVote(a.your_vote); }, [a]);
  usePortalTitle(a ? a.title : error ? t('portal.article.notFound') : null);

  async function send(helpful: boolean) {
    try {
      await api.post(`/api/portal/knowledge/${id}/feedback`, { helpful });
      setVote(helpful);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  if (error) {
    if (error instanceof ApiError && error.status === 404) {
      return <div className="pt-empty-page"><h1>{t('portal.article.notFound')}</h1><p className="muted"><Link to="/portal">{t('portal.back')}</Link></p></div>;
    }
    return <PortalError error={error} onRetry={reload} />;
  }
  if (!a) return <Loading lines={8} label={t('portal.article.loading')} />;
  return (
    <div className="pt-page pt-article">
      <nav className="pt-back"><Link to="/portal"><Icon name="chevron-left" size={18} /> {t('portal.nav.home')}</Link></nav>
      <p className="pt-ref">{t('portal.article.ref', { ref: a.ref, date: date(a.updated_at) })}</p>
      <h1>{a.title}</h1>
      <div className="pt-card prose pt-article-body">{a.body || t('portal.article.noText')}</div>
      <div className="pt-card pt-helpful" aria-live="polite">
        {vote === null ? (
          <>
            <p><strong>{t('portal.article.helpful')}</strong></p>
            <div className="pt-helpful-buttons">
              <button type="button" className="pt-big-btn" onClick={() => void send(true)}><Icon name="check" size={20} /> {t('common.yes')}</button>
              <button type="button" className="pt-big-btn" onClick={() => void send(false)}><Icon name="x" size={20} /> {t('common.no')}</button>
            </div>
          </>
        ) : (
          <p>
            <strong>{vote ? t('portal.article.glad') : t('portal.article.sorry')}</strong>{' '}
            {!vote && can_create && <>{t('portal.article.please')} <Link to={`/portal/report?what=${encodeURIComponent(a.title)}`}>{t('portal.article.reportLink')}</Link> {t('portal.article.itWillHelp')}</>}
            {' '}<button type="button" className="pt-link-btn" onClick={() => setVote(null)}>{t('portal.article.change')}</button>
          </p>
        )}
      </div>
    </div>
  );
}
