// Portal home: the service banner, search, the two main actions, the catalog, my requests,
// and whatever else is waiting for me (approvals, policies, training, equipment).
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon, Loading, useAuth, useFetch, type IconName } from '../../core';
import { useI18n } from '../../core/i18n';
import { Approvals } from './Approvals';
import { MySafetyReports } from './SafetyReport';
import { PortalError, ServiceBanner, Section, StatusPill, usePortal, usePortalTitle, useServerText, useSuggestions, type CatalogItem, type PlainStatus } from './parts';

const CAT_ICON: Record<string, IconName> = { people: 'users', access: 'key', equipment: 'box', software: 'file-text', vendors: 'building' };
export const itemIcon = (item: CatalogItem): IconName => (item.type === 'incident' ? 'alert' : CAT_ICON[item.category ?? ''] ?? 'folder');

export interface RequestRow {
  id: string; ref: string; title: string; item_name: string | null; opened_at: string; updated_at: string;
  last_message_at: string | null; status: PlainStatus;
}

function Search() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const found = useSuggestions(q);
  return (
    <div className="pt-search" role="search">
      <label htmlFor="pt-search-box" className="pt-search-label">{t('portal.search.label')}</label>
      <div className="pt-search-box">
        <Icon name="search" size={22} />
        <input id="pt-search-box" type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off"
          placeholder={t('portal.search.placeholder')} aria-describedby="pt-search-hint"
          onKeyDown={(e) => { if (e.key === 'Enter' && found[0]) navigate(`/portal/knowledge/${found[0].id}`); }} />
      </div>
      <p id="pt-search-hint" className="sr-only">{t('portal.search.hint')}</p>
      {q.trim().length >= 3 && (
        <div className="pt-search-results" aria-live="polite">
          {found.length ? (
            <ul>
              {found.slice(0, 5).map((a) => (
                <li key={a.id}>
                  <Link to={`/portal/knowledge/${a.id}`}>
                    <Icon name="book" size={18} />
                    <span><strong>{a.title}</strong><span className="muted">{a.excerpt}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="muted pt-search-none">{t('portal.search.none')}</p>}
          <Link className="pt-search-report" to={`/portal/report?what=${encodeURIComponent(q.trim())}`}>
            <Icon name="alert" size={18} /> {t('portal.search.report', { what: q.trim() })}
          </Link>
        </div>
      )}
    </div>
  );
}

export function CatalogTiles({ items }: { items: CatalogItem[] }) {
  return (
    <ul className="pt-tiles">
      {items.map((item) => (
        <li key={item.id}>
          <Link to={`/portal/new/${item.id}`} className="pt-tile">
            <span className={`pt-tile-icon ${item.type === 'incident' ? 'pt-tile-icon-fault' : ''}`}><Icon name={itemIcon(item)} size={22} /></span>
            <span className="pt-tile-text">
              <span className="pt-tile-name">{item.name}</span>
              {item.description && <span className="pt-tile-desc">{item.description}</span>}
            </span>
            <Icon name="chevron-right" size={20} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function RequestList({ rows }: { rows: RequestRow[] }) {
  const { t, ago } = useI18n();
  return (
    <ul className="pt-req-list">
      {rows.map((r) => (
        <li key={r.id}>
          <Link to={`/portal/requests/${r.id}`} className={`pt-req ${r.status.waiting_on_you ? 'pt-req-you' : ''}`}>
            <span className="pt-req-main">
              <span className="pt-req-title">{r.title}</span>
              <span className="pt-req-meta muted">{t('portal.requests.updated', { ref: r.ref, when: ago(r.updated_at) })}</span>
            </span>
            <StatusPill status={r.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function MyRequestsCard() {
  const { t } = useI18n();
  const { data, error, reload } = useFetch<{ rows: RequestRow[]; open: number; waiting_on_you: number; total: number }>('/api/portal/requests?state=open');
  if (error) return <PortalError error={error} onRetry={reload} />;
  if (!data) return <Loading lines={3} label={t('portal.requests.loading')} />;
  return (
    <Section id="pt-mine" title={t('portal.requests.title')} action={<Link to="/portal/requests" className="pt-more">{data.total ? t('portal.seeAllCount', { count: data.total }) : t('portal.seeAll')}</Link>}>
      {data.waiting_on_you > 0 && (
        <p className="pt-callout"><Icon name="message" size={18} /> {t('portal.requests.waiting', { count: data.waiting_on_you })}</p>
      )}
      {data.rows.length ? <RequestList rows={data.rows.slice(0, 5)} /> : <p className="muted pt-none">{t('portal.requests.noneOpenHome')}</p>}
    </Section>
  );
}

interface Ack { id: string; policy_title: string; policy_ref: string; due_on: string; state: string; days_left: number }
function PoliciesCard() {
  const { t, lang, date } = useI18n();
  const { data, error } = useFetch<{ awaiting: Ack[] }>(`/api/policies/acknowledgments/mine?lang=${lang}`);
  if (error || !data) return null;
  return (
    <Section id="pt-policies" title={t('portal.policies.title')}>
      {data.awaiting.length ? (
        <ul className="pt-mini-list">
          {data.awaiting.map((a) => (
            <li key={a.id}>
              <Link to={`/portal/policies/${a.id}`} className="pt-mini">
                <Icon name="file-text" size={20} />
                <span className="pt-mini-text"><strong>{a.policy_title}</strong>
                  <span className={a.state === 'overdue' ? 'pt-overdue' : 'muted'}>{a.state === 'overdue' ? t('portal.policies.overdue', { date: date(a.due_on) }) : t('portal.policies.readBy', { date: date(a.due_on) })}</span>
                </span>
                <Icon name="chevron-right" size={18} />
              </Link>
            </li>
          ))}
        </ul>
      ) : <p className="muted pt-none">{t('portal.policies.none')}</p>}
    </Section>
  );
}

interface Training { id: string; course_title: string; due_on: string | null; completed_on: string | null; status: string }
function TrainingCard() {
  const { t, date } = useI18n();
  const { data, error } = useFetch<{ rows: Training[] }>('/api/training/mine');
  if (error || !data) return null;
  const todo = data.rows.filter((r) => r.status === 'due' || r.status === 'overdue');
  const done = data.rows.filter((r) => r.status === 'complete').length;
  return (
    <Section id="pt-training" title={t('portal.training.title')}>
      {todo.length ? (
        <ul className="pt-mini-list">
          {todo.map((r) => (
            <li key={r.id} className="pt-mini">
              <Icon name="graduation" size={20} />
              <span className="pt-mini-text"><strong>{r.course_title}</strong>
                <span className={r.status === 'overdue' ? 'pt-overdue' : 'muted'}>{r.status === 'overdue' ? t('portal.training.overdue', { date: date(r.due_on) }) : r.due_on ? t('portal.training.dueBy', { date: date(r.due_on) }) : t('portal.training.toDo')}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="muted pt-none">{t('portal.training.none')}</p>}
      {done > 0 && <p className="muted pt-note">{t('portal.training.completed', { count: done })}</p>}
    </Section>
  );
}

interface Asset { id: string; tag: string | null; name: string; asset_type_label: string | null; make: string | null; model: string | null; serial: string | null }
function AssetsCard() {
  const { t } = useI18n();
  const { data } = useFetch<{ available: boolean; rows: Asset[] }>('/api/portal/assets');
  if (!data?.available || !data.rows.length) return null;
  return (
    <Section id="pt-assets" title={t('portal.assets.title')}>
      <ul className="pt-mini-list">
        {data.rows.map((a) => (
          <li key={a.id} className="pt-mini">
            <Icon name="box" size={20} />
            <span className="pt-mini-text"><strong>{a.name}</strong>
              <span className="muted">{[a.tag, a.asset_type_label, [a.make, a.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}</span>
            </span>
            <Link className="pt-link-btn" to={`/portal/report?what=${encodeURIComponent(t('portal.assets.problemWith', { name: `${a.name}${a.tag ? ` (${a.tag})` : ''}` }))}`}>{t('portal.assets.report')}</Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function PortalHome() {
  const config = usePortal();
  const { user } = useAuth();
  const { t } = useI18n();
  const { data: items, error, reload } = useFetch<CatalogItem[]>('/api/portal/catalog');
  const text = useServerText();
  usePortalTitle(text('portal.title', config.title));
  const first = (user?.displayName ?? '').split(/\s+/)[0];
  const shown = (items ?? []).slice(0, 6);
  // "Ask for something" leads to the catalog: not offered while nothing is in it (E18-64).
  const offersItems = !items || items.length > 0;
  return (
    <div className="pt-home">
      <ServiceBanner />
      <div className="pt-hero">
        <h1>{first ? t('portal.home.helloName', { name: first }) : t('portal.home.hello')}</h1>
        {config.intro && <p className="pt-intro">{text('portal.intro', config.intro)}</p>}
        <Search />
        {config.can_create && (
          <div className={`pt-actions${config.has.safety && offersItems ? ' pt-actions-3' : ''}`}>
            <Link to="/portal/report" className="pt-action pt-action-primary">
              <Icon name="alert" size={26} />
              <span><strong>{t('portal.home.report')}</strong><span>{t('portal.home.reportHint')}</span></span>
            </Link>
            {offersItems && (
              <Link to="/portal/catalog" className="pt-action">
                <Icon name="plus" size={26} />
                <span><strong>{t('portal.home.ask')}</strong><span>{t('portal.home.askHint')}</span></span>
              </Link>
            )}
            {config.has.safety && (
              <Link to="/portal/safety" className="pt-action pt-action-safety">
                <Icon name="shield" size={26} />
                <span><strong>{t('portal.home.safety')}</strong><span>{t('portal.home.safetyHint')}</span></span>
              </Link>
            )}
          </div>
        )}
      </div>

      <div className="pt-columns">
        <div className="pt-col-main">
          <MyRequestsCard />
          {config.can_create && (
            <Section id="pt-cat" title={t('portal.home.popular')} action={items && items.length > shown.length ? <Link to="/portal/catalog" className="pt-more">{t('portal.seeAllCount', { count: items.length })}</Link> : undefined}>
              {error ? <PortalError error={error} onRetry={reload} />
                : !items ? <Loading lines={3} label={t('portal.catalog.loading')} />
                  : shown.length ? <CatalogTiles items={shown} />
                    : <p className="muted pt-none">{t('portal.home.nothingOffered')}</p>}
            </Section>
          )}
        </div>
        <div className="pt-col-side">
          {(config.has.ticket_approvals || config.has.changes) && <Approvals />}
          {config.has.safety && <MySafetyReports compact />}
          {config.has.policies && <PoliciesCard />}
          {config.has.training && <TrainingCard />}
          {config.has.assets && <AssetsCard />}
        </div>
      </div>
    </div>
  );
}
