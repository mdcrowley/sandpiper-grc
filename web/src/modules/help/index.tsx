// In-app Help. The pages are the Markdown files in docs/user/ - the same files people read
// on GitHub - bundled at build time, so the user guide has exactly one source.
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { marked } from 'marked';
import { Card, EmptyState, NotFound, PageHeader, TextField, cx } from '../../core';
import type { ModuleDef } from '../../core';
import './help.css';

const sources = import.meta.glob('../../../../docs/user/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

interface Page { slug: string; file: string; title: string; summary: string; html: string; text: string; sections: { id: string; title: string }[] }

const slugify = (s: string) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** "02-service-desk.md" -> "service-desk" */
const fileSlug = (file: string) => file.replace(/\.md$/, '').replace(/^\d+-/, '');

function build(): Page[] {
  return Object.entries(sources)
    .map(([path, markdown]) => ({ file: path.split('/').pop()!, markdown }))
    .sort((a, b) => a.file.localeCompare(b.file))
    .map(({ file, markdown }) => {
      const sections: Page['sections'] = [];
      let html = marked.parse(markdown, { async: false, gfm: true }) as string;
      // Headings get ids so sections can be linked; h2s feed the "On this page" list.
      html = html.replace(/<h([1-4])>(.*?)<\/h\1>/g, (_m, depth: string, inner: string) => {
        const id = slugify(inner);
        if (depth === '2') sections.push({ id, title: inner.replace(/<[^>]+>/g, '') });
        return `<h${depth} id="${id}">${inner}</h${depth}>`;
      });
      // Links between guide pages become in-app routes; anything else opens in a new tab.
      html = html.replace(/href="(?:\.\/)?(\d+-[a-z0-9-]+)\.md(#[^"]*)?"/g, (_m, name: string, hash = '') => `href="/help/${fileSlug(`${name}.md`)}${hash}"`);
      html = html.replace(/<a href="(https?:[^"]+)"/g, '<a href="$1" target="_blank" rel="noreferrer noopener"');
      html = html.replace(/<table>/g, '<div class="help-table-wrap"><table>').replace(/<\/table>/g, '</table></div>');
      const title = /^#\s+(.+)$/m.exec(markdown)?.[1].trim() ?? fileSlug(file);
      const summary = markdown.split(/\r?\n\r?\n/).map((p) => p.trim()).find((p) => p && !p.startsWith('#')) ?? '';
      // The page header shows the title, so drop the document's own h1.
      html = html.replace(/<h1[^>]*>.*?<\/h1>/, '');
      return { slug: fileSlug(file), file, title, summary: summary.replace(/[*`]/g, ''), html, text: markdown.toLowerCase(), sections };
    });
}

const pages = build();

function Contents({ current }: { current?: string }) {
  return (
    <nav className="help-contents" aria-label="User guide contents">
      <p className="help-contents-title">User guide</p>
      <ul>
        {pages.map((p) => (
          <li key={p.slug}>
            <Link to={`/help/${p.slug}`} className={cx(p.slug === current && 'is-current')} aria-current={p.slug === current ? 'page' : undefined}>
              {p.title}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function HelpHome() {
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const found = useMemo(() => (term.length < 2 ? pages : pages.filter((p) => p.text.includes(term))), [term]);
  return (
    <>
      <PageHeader title="Help" subtitle="How to use each part of the application." />
      {pages.length === 0 ? (
        <EmptyState icon="book" title="The user guide is not included in this build" message="The guide lives in docs/user in the repository." />
      ) : (
        <div className="stack">
          <div className="help-search">
            <TextField label="Search the guide" type="search" value={q} onChange={setQ} placeholder="For example: notice date, recovery code, heat map" />
          </div>
          {found.length === 0 ? <EmptyState icon="search" title="No pages mention that" message="Try a different word." /> : (
            <div className="help-cards">
              {found.map((p) => (
                <Card key={p.slug} title={<Link to={`/help/${p.slug}`}>{p.title}</Link>}>
                  <p className="muted">{p.summary}</p>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function HelpPage() {
  const { slug } = useParams();
  const { hash } = useLocation();
  const navigate = useNavigate();
  const body = useRef<HTMLDivElement>(null);
  const page = pages.find((p) => p.slug === slug);

  useEffect(() => {
    const target = hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
    if (target) target.scrollIntoView();
    else body.current?.closest('.content')?.scrollTo(0, 0);
  }, [slug, hash]);

  if (!page) return <NotFound />;
  const index = pages.indexOf(page);
  const prev = pages[index - 1];
  const next = pages[index + 1];

  // Keep links between guide pages inside the single-page app.
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href');
    if (href?.startsWith('/') && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      navigate(href);
    }
  };

  return (
    <>
      <PageHeader title={page.title} breadcrumbs={[{ label: 'Help', to: '/help' }, { label: page.title }]} />
      <div className="help-layout">
        <Contents current={page.slug} />
        <article className="help-article">
          {page.sections.length > 1 && (
            <nav className="help-onpage" aria-label="On this page">
              <span className="muted">On this page:</span>
              {page.sections.map((s) => <a key={s.id} href={`#${s.id}`} onClick={(e) => { e.preventDefault(); navigate(`#${s.id}`); }}>{s.title}</a>)}
            </nav>
          )}
          {/* The HTML comes from this repository's own Markdown files, bundled at build time. */}
          <div className="help-body" ref={body} onClick={onClick} dangerouslySetInnerHTML={{ __html: page.html }} />
          <div className="help-pager">
            {prev ? <Link to={`/help/${prev.slug}`}>← {prev.title}</Link> : <span />}
            {next ? <Link to={`/help/${next.slug}`}>{next.title} →</Link> : <span />}
          </div>
        </article>
      </div>
    </>
  );
}

const mod: ModuleDef = {
  key: 'help',
  nav: [{ group: 'Help', label: 'User guide', path: '/help', icon: 'book', order: 10 }],
  routes: [
    { path: '/help', element: <HelpHome /> },
    { path: '/help/:slug', element: <HelpPage /> },
  ],
};
export default mod;
