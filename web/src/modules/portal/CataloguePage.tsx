// Everything that can be asked for in the portal, grouped by category, with a search box.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorState, Icon, Loading, useFetch } from '../../core';
import { CatalogueTiles } from './Home';
import type { CatalogueItem } from './parts';

export function CataloguePage() {
  const { data, error, reload } = useFetch<CatalogueItem[]>('/api/portal/catalogue');
  const [q, setQ] = useState('');
  useEffect(() => { document.title = 'Ask for something'; }, []);
  const groups = useMemo(() => {
    const words = q.trim().toLowerCase();
    const out = new Map<string, CatalogueItem[]>();
    for (const item of data ?? []) {
      if (words && !`${item.name} ${item.description ?? ''}`.toLowerCase().includes(words)) continue;
      out.set(item.category_label, [...(out.get(item.category_label) ?? []), item]);
    }
    return [...out.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [data, q]);

  return (
    <div className="pt-page">
      <nav className="pt-back"><Link to="/portal"><Icon name="chevron-left" size={18} /> Home</Link></nav>
      <h1>Ask for something</h1>
      <p className="pt-intro">Choose what you need. If it is not listed, <Link to="/portal/report">describe it in your own words</Link>.</p>
      <div className="pt-search-box pt-search-small">
        <Icon name="search" size={20} />
        <input type="search" aria-label="Find a request" placeholder="Find a request" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={5} label="Loading the catalogue" />
          : !groups.length ? <p className="muted pt-none">{q ? 'Nothing matches those words.' : 'Nothing is offered here yet.'} <Link to="/portal/report">Describe what you need instead.</Link></p>
            : groups.map(([group, items]) => (
              <section key={group} className="pt-section" aria-label={group}>
                <h2 className="pt-group">{group}</h2>
                <CatalogueTiles items={items} />
              </section>
            ))}
    </div>
  );
}
