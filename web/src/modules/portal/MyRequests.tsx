// Every request I raised (or that was raised for me), open ones first.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorState, Icon, Loading, qs, useDebounced, useFetch } from '../../core';
import { RequestList, type RequestRow } from './Home';
import { usePortal, usePortalTitle } from './parts';

const TABS = [
  { key: 'open', label: 'Open' },
  { key: 'done', label: 'Finished' },
  { key: '', label: 'All' },
];

export function MyRequests() {
  const { can_create } = usePortal();
  usePortalTitle('My requests');
  const [state, setState] = useState('open');
  const [q, setQ] = useState('');
  const words = useDebounced(q.trim(), 250);
  const { data, error, reload } = useFetch<{ rows: RequestRow[]; open: number; total: number }>(`/api/portal/requests${qs({ state, q: words })}`, { keepPrevious: true });
  return (
    <div className="pt-page">
      <nav className="pt-back"><Link to="/portal"><Icon name="chevron-left" size={18} /> Home</Link></nav>
      <div className="pt-page-head">
        <h1>My requests</h1>
        {can_create && <Link to="/portal/report" className="btn btn-primary pt-head-btn"><Icon name="plus" size={18} /> New</Link>}
      </div>
      <div className="pt-filter-row">
        <div className="pt-segment" role="tablist" aria-label="Which requests">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={state === t.key} className={state === t.key ? 'is-on' : ''} onClick={() => setState(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="pt-search-box pt-search-small">
          <Icon name="search" size={20} />
          <input type="search" aria-label="Find one of my requests" placeholder="Find" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={5} label="Loading your requests" />
          : data.rows.length ? <RequestList rows={data.rows} />
            : (
              <div className="pt-empty">
                <Icon name="ticket" size={28} />
                <p>{words ? 'None of your requests match.' : state === 'open' ? 'You have nothing open.' : state === 'done' ? 'Nothing finished yet.' : 'You have not raised anything yet.'}</p>
                {can_create && !words && <Link to="/portal/report" className="pt-link-btn">Report a problem</Link>}
              </div>
            )}
    </div>
  );
}
