// One page of the guide. This file (with the Markdown renderer) is fetched when a guide page
// is first opened; the page's text is fetched on its own.
import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { marked } from 'marked';
import { ErrorState, Loading, NotFound, PageHeader, TextField, cx } from '../../core';
import { findPage, pageRefs, stemSlug, useGuide, usePage, type LoadedPage, type PageRef } from './guide';
import { slugify } from './text';
import './help.css';

const rendered = new Map<string, string>();

/** Markdown to HTML, with heading ids, in-app links between pages and framed tables. */
function render(page: LoadedPage): string {
  const cached = rendered.get(page.ref.stem);
  if (cached !== undefined) return cached;
  let html = marked.parse(page.markdown, { async: false, gfm: true }) as string;
  // Headings take the ids worked out from the Markdown (the same ids search and the
  // "help for this page" map use), in order. tabindex lets a linked heading take focus.
  let n = 0;
  html = html.replace(/<h([1-6])(?:\s[^>]*)?>([\s\S]*?)<\/h\1>/g, (_m, depth: string, inner: string) => {
    const id = page.headings[n++]?.id ?? slugify(inner.replace(/<[^>]+>/g, '').replace(/&[#\w]+;/g, ''));
    // h2 and h3 carry a link to themselves, so a section can be shared ("#" appears on hover and focus).
    const self = depth === '2' || depth === '3' ? `<a class="help-anchor" href="#${id}" aria-label="Link to this section">#</a>` : '';
    return `<h${depth} id="${id}" tabindex="-1">${inner}${self}</h${depth}>`;
  });
  // Links between guide pages become in-app addresses; links to other sites open in a new tab.
  html = html.replace(/href="(?:\.\/)?(\d+-[a-z0-9-]+)\.md(#[^"]*)?"/g, (_m, stem: string, hash = '') => `href="/help/${stemSlug(stem)}${hash}"`);
  html = html.replace(/<a href="(https?:[^"]+)"/g, '<a href="$1" target="_blank" rel="noreferrer noopener"');
  // A table scrolls inside its own frame (focusable, so the keyboard can scroll it too).
  html = html.replace(/<table>/g, '<div class="help-table-wrap" tabindex="0" role="group" aria-label="Table"><table>').replace(/<\/table>/g, '</table></div>');
  // The page header shows the title, so drop the document's own h1.
  html = html.replace(/<h1[^>]*>[\s\S]*?<\/h1>/, '');
  rendered.set(page.ref.stem, html);
  return html;
}

function Contents({ current, titles }: { current: string; titles: Map<string, string> }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) navigate(`/help?q=${encodeURIComponent(q.trim())}`);
  };
  return (
    <div className="help-contents">
      <form className="help-contents-search" role="search" onSubmit={submit}>
        <TextField label="Search the guide" hideLabel type="search" value={q} onChange={setQ} placeholder="Search the guide" />
      </form>
      <nav aria-label="User guide contents">
        <p className="help-contents-title">User guide</p>
        <ul>
          {pageRefs.map((p) => (
            <li key={p.slug}>
              <Link to={`/help/${p.slug}`} className={cx(p.slug === current && 'is-current')} aria-current={p.slug === current ? 'page' : undefined}>
                {titles.get(p.slug) ?? p.roughTitle}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

export default function HelpPage() {
  const { slug } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const body = useRef<HTMLDivElement>(null);
  const ref = findPage(slug);
  const { data: page, error, retry } = usePage(ref);
  const guide = useGuide();
  const html = useMemo(() => (page ? render(page) : ''), [page]);
  const titles = useMemo(() => new Map((guide.data ?? (page ? [page] : [])).map((p) => [p.ref.slug, p.title])), [guide.data, page]);

  // Open at the linked section, or at the top. The scrolling element is <main id="main">,
  // not the window; scrollIntoView finds it either way.
  useEffect(() => {
    if (!html) return;
    const id = location.hash ? decodeURIComponent(location.hash.slice(1)) : '';
    const target = id ? document.getElementById(id) : null;
    if (target && body.current?.contains(target)) {
      target.scrollIntoView({ block: 'start' });
      target.focus({ preventScroll: true });
    } else {
      (body.current?.closest('#main, .content') ?? document.scrollingElement)?.scrollTo(0, 0);
    }
  }, [html, location.key, location.hash]);

  if (!ref) return <NotFound />;
  // The file name ("02-service-desk") also works as an address; show the short one.
  if (slug !== ref.slug) return <Navigate replace to={{ pathname: `/help/${ref.slug}`, hash: location.hash }} />;

  const title = page?.title ?? titles.get(ref.slug) ?? ref.roughTitle;
  const index = pageRefs.indexOf(ref);
  const prev = pageRefs[index - 1];
  const next = pageRefs[index + 1];
  const name = (p: PageRef) => titles.get(p.slug) ?? p.roughTitle;
  const sections = page ? page.headings.filter((h) => h.depth === 2) : [];

  // Keep links between guide pages, and links to a section, inside the single-page app.
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const a = (e.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href');
    if (!href || a?.getAttribute('target')) return;
    if (href.startsWith('#')) {
      e.preventDefault();
      navigate({ hash: href });
    } else if (href.startsWith('/')) {
      e.preventDefault();
      navigate(href);
    }
  };

  return (
    <>
      <PageHeader title={title} breadcrumbs={[{ label: 'Help', to: '/help' }, { label: title }]} />
      <div className="help-layout">
        <Contents current={ref.slug} titles={titles} />
        <article className="help-article">
          {error ? <ErrorState title="This page of the guide could not be loaded" error={error} onRetry={retry} />
            : !page ? <Loading lines={8} label="Loading the guide" />
              : (
                <>
                  {sections.length > 1 && (
                    <nav className="help-onpage" aria-label="On this page">
                      <p className="help-onpage-title">On this page</p>
                      <ul>
                        {sections.map((s) => (
                          <li key={s.id}><Link to={{ hash: `#${s.id}` }}>{s.title}</Link></li>
                        ))}
                      </ul>
                    </nav>
                  )}
                  {/* The HTML comes from this repository's own Markdown files. */}
                  <div className="help-body" ref={body} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
                </>
              )}
          <nav className="help-pager" aria-label="Other pages of the guide">
            {prev ? <Link to={`/help/${prev.slug}`} rel="prev"><span className="help-pager-label">Previous</span>{name(prev)}</Link> : <span />}
            {next ? <Link to={`/help/${next.slug}`} rel="next" className="help-pager-next"><span className="help-pager-label">Next</span>{name(next)}</Link> : <span />}
          </nav>
        </article>
      </div>
    </>
  );
}
