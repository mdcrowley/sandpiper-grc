// Every request I raised (or that was raised for me), open ones first.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon, Loading, qs, useDebounced, useFetch } from '../../core';
import { useI18n } from '../../core/i18n';
import { RequestList, type RequestRow } from './Home';
import { PortalError, usePortal, usePortalTitle } from './parts';

const TABS = [
  { key: 'open', label: 'portal.requests.tab.open' },
  { key: 'done', label: 'portal.requests.tab.done' },
  { key: '', label: 'portal.requests.tab.all' },
];

export function MyRequests() {
  const { can_create } = usePortal();
  const { t } = useI18n();
  usePortalTitle(t('portal.requests.title'));
  const [state, setState] = useState('open');
  const [q, setQ] = useState('');
  const words = useDebounced(q.trim(), 250);
  const { data, error, reload } = useFetch<{ rows: RequestRow[]; open: number; total: number }>(`/api/portal/requests${qs({ state, q: words })}`, { keepPrevious: true });
  return (
    <div className="pt-page">
      <nav className="pt-back"><Link to="/portal"><Icon name="chevron-left" size={18} /> {t('portal.nav.home')}</Link></nav>
      <div className="pt-page-head">
        <h1>{t('portal.requests.title')}</h1>
        {can_create && <Link to="/portal/report" className="btn btn-primary pt-head-btn"><Icon name="plus" size={18} /> {t('portal.requests.new')}</Link>}
      </div>
      <div className="pt-filter-row">
        <div className="pt-segment" role="tablist" aria-label={t('portal.requests.which')}>
          {TABS.map((tab) => (
            <button key={tab.key} type="button" role="tab" aria-selected={state === tab.key} className={state === tab.key ? 'is-on' : ''} onClick={() => setState(tab.key)}>
              {t(tab.label)}
            </button>
          ))}
        </div>
        <div className="pt-search-box pt-search-small">
          <Icon name="search" size={20} />
          <input type="search" aria-label={t('portal.requests.findLabel')} placeholder={t('portal.requests.find')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {error ? <PortalError error={error} onRetry={reload} />
        : !data ? <Loading lines={5} label={t('portal.requests.loading')} />
          : data.rows.length ? <RequestList rows={data.rows} />
            : (
              <div className="pt-empty">
                <Icon name="ticket" size={28} />
                <p>{words ? t('portal.requests.noMatch') : state === 'open' ? t('portal.requests.noneOpen') : state === 'done' ? t('portal.requests.noneDone') : t('portal.requests.noneAtAll')}</p>
                {can_create && !words && <Link to="/portal/report" className="pt-link-btn">{t('portal.home.report')}</Link>}
              </div>
            )}
    </div>
  );
}
