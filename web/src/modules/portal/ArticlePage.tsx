// One help article for all staff, with "Was this helpful?".
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, errorMessage, ErrorState, formatDate, Icon, Loading, useFetch, useToast } from '../../core';
import { usePortal, usePortalTitle } from './parts';

interface ArticleDetail { id: string; ref: string; title: string; body: string | null; updated_at: string; your_vote: boolean | null }

export function ArticlePage() {
  const { id } = useParams();
  const toast = useToast();
  const { can_create } = usePortal();
  const { data: a, error, reload } = useFetch<ArticleDetail>(`/api/portal/knowledge/${id}`);
  const [vote, setVote] = useState<boolean | null>(null);
  useEffect(() => { if (a) setVote(a.your_vote); }, [a]);
  usePortalTitle(a ? a.title : error ? 'Article not found' : null);

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
      return <div className="pt-empty-page"><h1>Article not found</h1><p className="muted"><Link to="/portal">Back to the portal</Link></p></div>;
    }
    return <ErrorState error={error} onRetry={reload} />;
  }
  if (!a) return <Loading lines={8} label="Loading the article" />;
  return (
    <div className="pt-page pt-article">
      <nav className="pt-back"><Link to="/portal"><Icon name="chevron-left" size={18} /> Home</Link></nav>
      <p className="pt-ref">{a.ref} · Updated {formatDate(a.updated_at)}</p>
      <h1>{a.title}</h1>
      <div className="pt-card prose pt-article-body">{a.body || 'This article has no text yet.'}</div>
      <div className="pt-card pt-helpful" aria-live="polite">
        {vote === null ? (
          <>
            <p><strong>Was this helpful?</strong></p>
            <div className="pt-helpful-buttons">
              <button type="button" className="pt-big-btn" onClick={() => void send(true)}><Icon name="check" size={20} /> Yes</button>
              <button type="button" className="pt-big-btn" onClick={() => void send(false)}><Icon name="x" size={20} /> No</button>
            </div>
          </>
        ) : (
          <p>
            <strong>{vote ? 'Glad it helped.' : 'Sorry it did not help.'}</strong>{' '}
            {!vote && can_create && <>Please <Link to={`/portal/report?what=${encodeURIComponent(a.title)}`}>report the problem</Link> and IT will help.</>}
            {' '}<button type="button" className="pt-link-btn" onClick={() => setVote(null)}>Change my answer</button>
          </p>
        )}
      </div>
    </div>
  );
}
