// The Help home page: search across the whole guide, or pick a page.
// Also answers "Help for this page": /help?for=<pathname> goes straight to the right section.
import { useMemo } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { Card, EmptyState, ErrorState, Loading, PageHeader, TextField, useFetch } from '../../core';
import { findPage, pageRefs, searchEntries, useGuide } from './guide';
import { usePageOn } from './areas';
import { helpFor } from './routeMap';
import { search, searchWords, splitMarks } from './text';
import './help.css';

function Marked({ text, words }: { text: string; words: string[] }) {
  return <>{splitMarks(text, words).map((piece, i) => (piece.hit ? <mark key={i}>{piece.text}</mark> : piece.text))}</>;
}

export default function HelpHome() {
  const [params, setParams] = useSearchParams();
  const guide = useGuide();
  const q = params.get('q') ?? '';
  const words = useMemo(() => searchWords(q), [q]);
  const entries = useMemo(() => (guide.data ? searchEntries(guide.data) : []), [guide.data]);
  // Pages of switched-off parts of the application (Administration > Features) are left out.
  const pageOn = usePageOn();
  const hits = useMemo(() => search(entries, q), [entries, q]).filter((h) => pageOn(h.page));

  const wanted = params.get('for');
  if (wanted !== null) {
    const entry = helpFor(wanted);
    const page = entry && findPage(entry.page);
    return <Navigate replace to={page ? { pathname: `/help/${page.slug}`, hash: entry.section ? `#${entry.section}` : '' } : '/help'} />;
  }

  const setQ = (value: string) => setParams(value ? { q: value } : {}, { replace: true });

  let body;
  if (pageRefs.length === 0) {
    body = <EmptyState icon="book" title="The user guide is not included in this build" message="The guide lives in docs/user in the repository." />;
  } else if (guide.error) {
    body = <ErrorState title="The guide could not be loaded" error={guide.error} onRetry={guide.retry} />;
  } else if (!guide.data) {
    body = <Loading label="Loading the guide" />;
  } else if (!words.length) {
    body = (
      <div className="help-cards">
        {guide.data.filter((p) => pageOn(p.ref.slug)).map((p) => (
          <Card key={p.ref.slug} title={<Link to={`/help/${p.ref.slug}`}>{p.title}</Link>}>
            <p className="muted help-card-summary">{p.summary}</p>
          </Card>
        ))}
      </div>
    );
  } else if (hits.length === 0) {
    body = <EmptyState icon="search" title="Nothing in the guide matches that" message="Try fewer words, or a different word." />;
  } else {
    body = (
      <ol className="help-results" aria-label="Search results">
        {hits.map((hit) => (
          <li key={`${hit.page}#${hit.id}`} className="help-result">
            <Link to={{ pathname: `/help/${hit.page}`, hash: hit.id ? `#${hit.id}` : '' }} className="help-result-link">
              <span className="help-result-page">{hit.pageTitle}</span>
              <span className="help-result-title"><Marked text={hit.title} words={words} /></span>
            </Link>
            <p className="help-result-snippet"><Marked text={hit.snippet} words={words} /></p>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <>
      <PageHeader title="Help" subtitle="How to use each part of the application." />
      <div className="stack">
        {pageRefs.length > 0 && (
          <div className="help-search" role="search">
            <TextField label="Search the guide" type="search" value={q} onChange={setQ} placeholder="For example: notice date, recovery code, heat map" />
          </div>
        )}
        <p className="sr-only" role="status">
          {guide.data && words.length ? `${hits.length} ${hits.length === 1 ? 'section matches' : 'sections match'}` : ''}
        </p>
        {body}
        <AboutVersion />
      </div>
    </>
  );
}

/** The installed version (E16-19): what to quote when reporting a problem. */
function AboutVersion() {
  const v = useFetch<{ version: string; commit: string | null }>('/api/version');
  if (!v.data) return null;
  return (
    <p className="muted help-version">
      Sandpiper GRC version {v.data.version}{v.data.commit ? ` (commit ${v.data.commit.slice(0, 12)})` : ''}. Give this when you report a problem.
    </p>
  );
}
