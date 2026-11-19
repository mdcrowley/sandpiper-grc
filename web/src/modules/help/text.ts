// Pure text helpers for the Help module: heading ids, a light Markdown scan and the search.
// No imports, so this file is cheap to load and can be run by Node on its own.

export interface Heading { depth: number; title: string; id: string }
/** A stretch of a guide page under one heading. The text before the first h2 has id "". */
export interface Section { id: string; title: string; depth: number; text: string }
export interface GuideDoc { title: string; summary: string; headings: Heading[]; sections: Section[] }

/** Inline Markdown to plain text. */
export function plain(md: string): string {
  return md
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[*`]/g, '')
    .replace(/\\([\\_#>|[\]()-])/g, '$1');
}

/**
 * Heading text to an id, the way the common Markdown hosts do it: lower case, punctuation
 * dropped, spaces to hyphens. So a link written as `page.md#some-heading` works there and here.
 */
export function slugify(text: string): string {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
}

/** Gives each heading a unique id: a repeated heading gets -1, -2 ... */
export function uniqueIds(): (title: string) => string {
  const seen = new Map<string, number>();
  return (title) => {
    const base = slugify(title) || 'section';
    const n = seen.get(base);
    seen.set(base, (n ?? 0) + 1);
    return n === undefined ? base : `${base}-${n}`;
  };
}

/** Scans one Markdown file: title, first paragraph, headings in order, text by section. */
export function parseGuide(markdown: string, fallbackTitle = ''): GuideDoc {
  const idFor = uniqueIds();
  const headings: Heading[] = [];
  const sections: Section[] = [{ id: '', title: '', depth: 1, text: '' }];
  const parts: string[][] = [[]];
  let fence: string | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const mark = /^\s{0,3}(```|~~~)/.exec(line)?.[1];
    if (mark) {
      if (!fence) fence = mark;
      else if (fence === mark) fence = null;
      continue;
    }
    const h = fence ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      const title = plain(h[2]).trim();
      const heading = { depth: h[1].length, title, id: idFor(title) };
      headings.push(heading);
      if (heading.depth > 1) {
        sections.push({ ...heading, text: '' });
        parts.push([]);
      }
      continue;
    }
    if (/^\s*\|?\s*:?-{2,}[\s:|-]*$/.test(line)) continue; // table rule or horizontal line
    const text = plain(line.replace(/^\s*>\s?/, '').replace(/^\s*(?:[-+*]|\d+\.)\s+/, '').replace(/\|/g, ' ')).trim();
    if (text) parts[parts.length - 1].push(text);
  }
  sections.forEach((s, i) => { s.text = parts[i].join(' ').replace(/\s+/g, ' '); });
  const title = headings.find((h) => h.depth === 1)?.title ?? fallbackTitle;
  sections[0].title = title;
  const first = markdown.split(/\r?\n\s*\r?\n/).map((p) => p.trim()).find((p) => p && !p.startsWith('#')) ?? '';
  return { title, summary: plain(first).replace(/\s+/g, ' '), headings, sections };
}

export interface SearchEntry { page: string; pageTitle: string; id: string; title: string; text: string }
export interface SearchHit { page: string; pageTitle: string; id: string; title: string; snippet: string; score: number }

/** The words of a search, lower case, without repeats. One-letter words are ignored. */
export function searchWords(query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  return [...new Set(words)];
}

function count(hay: string, word: string, cap: number): number {
  let n = 0;
  for (let at = hay.indexOf(word); at !== -1 && n < cap; at = hay.indexOf(word, at + word.length)) n++;
  return n;
}

function snippet(text: string, words: string[], length = 200): string {
  const lower = text.toLowerCase();
  const found = words.map((w) => lower.indexOf(w)).filter((i) => i !== -1);
  const hit = found.length ? Math.min(...found) : 0;
  let start = Math.max(0, hit - 60);
  if (start > 0) {
    const space = text.indexOf(' ', start);
    if (space !== -1 && space < hit) start = space + 1;
  }
  let end = Math.min(text.length, start + length);
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    if (space > start + 40) end = space;
  }
  return (start > 0 ? '… ' : '') + text.slice(start, end).trim() + (end < text.length ? ' …' : '');
}

/** Sections that contain every word, best first. A word in the heading counts most. */
export function search(entries: SearchEntry[], query: string, limit = 40): SearchHit[] {
  const words = searchWords(query);
  if (!words.length) return [];
  const hits: SearchHit[] = [];
  for (const e of entries) {
    const title = e.title.toLowerCase();
    const pageTitle = e.pageTitle.toLowerCase();
    const text = e.text.toLowerCase();
    let score = 0;
    let all = true;
    for (const w of words) {
      const s = (title.includes(w) ? 10 : 0) + (pageTitle.includes(w) ? 3 : 0) + count(text, w, 5);
      if (!s) { all = false; break; }
      score += s;
    }
    if (all) hits.push({ page: e.page, pageTitle: e.pageTitle, id: e.id, title: e.title, snippet: snippet(e.text, words), score });
  }
  // Array.prototype.sort is stable, so equal scores keep the order of the guide.
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Cuts text into pieces so the matched words can be wrapped in <mark>. */
export function splitMarks(text: string, words: string[]): { text: string; hit: boolean }[] {
  if (!words.length) return [{ text, hit: false }];
  const escaped = [...words].sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const lower = new Set(words);
  return text.split(new RegExp(`(${escaped.join('|')})`, 'gi')).filter(Boolean).map((piece) => ({ text: piece, hit: lower.has(piece.toLowerCase()) }));
}
