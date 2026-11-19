// The guide's pages: the Markdown files in docs/user, each fetched only when it is needed
// (one small file per page, nothing in the application's first load).
import { useEffect, useState } from 'react';
import { parseGuide, type GuideDoc, type SearchEntry } from './text';

const loaders = import.meta.glob('../../../../docs/user/*.md', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;

export interface PageRef {
  /** Address of the page: "/help/service-desk". */
  slug: string;
  /** File name without ".md": "02-service-desk". Also accepted in the address. */
  stem: string;
  /** A title worked out from the file name, shown until the page itself has loaded. */
  roughTitle: string;
  load: () => Promise<string>;
}
export interface LoadedPage extends GuideDoc { ref: PageRef; markdown: string }

/** "02-service-desk" -> "service-desk" */
export const stemSlug = (stem: string) => stem.replace(/^\d+-/, '');

export const pageRefs: PageRef[] = Object.entries(loaders)
  .map(([path, load]) => {
    const stem = path.split('/').pop()!.replace(/\.md$/, '');
    const slug = stemSlug(stem);
    const words = slug.replace(/-/g, ' ');
    return { slug, stem, roughTitle: words.charAt(0).toUpperCase() + words.slice(1), load };
  })
  .sort((a, b) => a.stem.localeCompare(b.stem));

export const findPage = (name: string | undefined): PageRef | undefined => pageRefs.find((p) => p.slug === name || p.stem === name);

const loaded = new Map<string, Promise<LoadedPage>>();

export function loadPage(ref: PageRef): Promise<LoadedPage> {
  let promise = loaded.get(ref.stem);
  if (!promise) {
    promise = ref.load().then((markdown) => ({ ref, markdown, ...parseGuide(markdown, ref.roughTitle) }));
    // A failed download is not remembered, so "Try again" really tries again.
    promise.catch(() => loaded.delete(ref.stem));
    loaded.set(ref.stem, promise);
  }
  return promise;
}

export const loadGuide = (): Promise<LoadedPage[]> => Promise.all(pageRefs.map(loadPage));

/** One search entry per section of every page. */
export function searchEntries(pages: LoadedPage[]): SearchEntry[] {
  return pages.flatMap((p) => p.sections
    .filter((s) => s.text || s.id)
    .map((s) => ({ page: p.ref.slug, pageTitle: p.title, id: s.id, title: s.id ? s.title : p.title, text: s.text })));
}

function useAsync<T>(key: string, run: (() => Promise<T>) | null) {
  const [state, setState] = useState<{ key: string; data?: T; error?: unknown }>({ key });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!run) return;
    let live = true;
    run().then(
      (data) => { if (live) setState({ key, data }); },
      (error: unknown) => { if (live) setState({ key, error: error ?? new Error('The guide could not be loaded.') }); },
    );
    return () => { live = false; };
    // `run` is a new function on every render; the key says when the work changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);
  const current = state.key === key ? state : { key };
  return { data: current.data, error: current.error, retry: () => { setState({ key }); setAttempt((n) => n + 1); } };
}

/** One page of the guide. `data` is undefined while it loads. */
export const usePage = (ref: PageRef | undefined) => useAsync<LoadedPage>(ref?.stem ?? '', ref ? () => loadPage(ref) : null);

/** Every page (titles, summaries and the text to search). `data` is undefined while it loads. */
export const useGuide = () => useAsync<LoadedPage[]>('*', loadGuide);
