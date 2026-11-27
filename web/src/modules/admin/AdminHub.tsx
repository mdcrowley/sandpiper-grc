// Administration (/admin, E44-03): one page instead of a menu entry per setting. Its cards are the
// menu entries of every module marked with a `hub` section (core/module.ts), so a card follows its
// page's permission and its area's switch: a card the person may not open, or of a switched-off area,
// is not there. A search box filters the cards as you type.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, Icon, PageHeader, TextField, allowedNav, hubCards, moduleOn, modules, useAuth } from '../../core';

export function AdminHubPage() {
  const { can, areaOn, features } = useAuth();
  const [query, setQuery] = useState('');
  const sections = useMemo(
    () => hubCards(allowedNav(modules.filter((m) => moduleOn(m.key, areaOn)).flatMap((m) => m.nav ?? []), can)),
    [can, areaOn],
  );
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const shown = sections
    .map((s) => ({
      ...s,
      cards: s.cards.filter((c) => words.every((w) => `${c.label} ${c.hint ?? ''} ${s.section}`.toLocaleLowerCase().includes(w))),
    }))
    .filter((s) => s.cards.length > 0);
  const total = sections.reduce((n, s) => n + s.cards.length, 0);
  const count = shown.reduce((n, s) => n + s.cards.length, 0);
  const switches = Object.values(features ?? {});
  const off = switches.filter((on) => !on).length;
  const status = (path: string) => (path === '/admin/features' && switches.length > 0 ? `${off} of ${switches.length} switched off` : null);

  return (
    <div className="stack admin-hub">
      <PageHeader title="Administration" subtitle="Set up the application for your organization: people and access, records, each area's settings, connections to other systems, and data." />
      {total === 0 ? (
        <EmptyState icon="lock" title="Nothing to administer" message="Your role does not include any administration pages." />
      ) : (
        <>
          <div className="admin-hub-search">
            <TextField label="Find a setting" hideLabel type="search" placeholder="Find a setting…" value={query} onChange={setQuery}
              leftSection={<Icon name="search" size={16} />} />
            <p className="muted admin-hub-count" role="status">{words.length ? `${count} of ${total} pages match` : ''}</p>
          </div>
          {shown.length === 0 && <EmptyState icon="search" title="No setting matches" message="Try another word, such as email, users or backups." />}
          {shown.map((s) => (
            <section key={s.section} className="admin-hub-section" aria-labelledby={`hub-${s.section.replace(/\W+/g, '-')}`}>
              <h2 className="admin-hub-title" id={`hub-${s.section.replace(/\W+/g, '-')}`}>{s.section}</h2>
              <ul className="admin-hub-grid">
                {s.cards.map((c) => (
                  <li key={c.path}>
                    <Link to={c.path} className="admin-hub-card">
                      <span className="admin-hub-icon"><Icon name={c.icon} size={18} /></span>
                      <span className="admin-hub-text">
                        <span className="admin-hub-name">{c.label}</span>
                        {c.hint && <span className="admin-hub-hint">{c.hint}</span>}
                        {status(c.path) && <span className="admin-hub-status">{status(c.path)}</span>}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
