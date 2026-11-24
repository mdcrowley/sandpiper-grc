// Everything that can be asked for in the portal, grouped by category, with a search box.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon, Loading, useFetch } from '../../core';
import { useI18n } from '../../core/i18n';
import { CatalogTiles } from './Home';
import { PortalError, usePortalTitle, type CatalogItem } from './parts';

export function CatalogPage() {
  const { t, lang } = useI18n();
  const { data, error, reload } = useFetch<CatalogItem[]>('/api/portal/catalog');
  const [q, setQ] = useState('');
  usePortalTitle(t('portal.catalog.title'));
  const groups = useMemo(() => {
    const words = q.trim().toLowerCase();
    const out = new Map<string, CatalogItem[]>();
    for (const item of data ?? []) {
      if (words && !`${item.name} ${item.description ?? ''}`.toLowerCase().includes(words)) continue;
      out.set(item.category_label, [...(out.get(item.category_label) ?? []), item]);
    }
    return [...out.entries()].sort(([a], [b]) => a.localeCompare(b, lang));
  }, [data, q, lang]);

  return (
    <div className="pt-page">
      <nav className="pt-back"><Link to="/portal"><Icon name="chevron-left" size={18} /> {t('portal.nav.home')}</Link></nav>
      <h1>{t('portal.catalog.title')}</h1>
      <p className="pt-intro">{t('portal.catalog.intro')} <Link to="/portal/report">{t('portal.catalog.introLink')}</Link>.</p>
      <div className="pt-search-box pt-search-small">
        <Icon name="search" size={20} />
        <input type="search" aria-label={t('portal.catalog.find')} placeholder={t('portal.catalog.find')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error ? <PortalError error={error} onRetry={reload} />
        : !data ? <Loading lines={5} label={t('portal.catalog.loading')} />
          : !groups.length ? <p className="muted pt-none">{q ? t('portal.catalog.noMatch') : t('portal.catalog.empty')} <Link to="/portal/report">{t('portal.catalog.describe')}</Link></p>
            : groups.map(([group, items]) => (
              <section key={group} className="pt-section" aria-label={group}>
                <h2 className="pt-group">{group}</h2>
                <CatalogTiles items={items} />
              </section>
            ))}
    </div>
  );
}
