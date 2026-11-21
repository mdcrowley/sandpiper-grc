import { describe, expect, it } from 'vitest';
import { parseGuide } from './text';

// Every link in the user guide must lead somewhere: a guide page and a heading that exist, a
// heading on the same page, another document in docs/ (and a heading in it), or a web address.
// The same files are read on GitHub and in Help, so both depend on this.
const GUIDE = import.meta.glob<string>('../../../../docs/user/*.md', { query: '?raw', import: 'default', eager: true });
const DOCS = import.meta.glob<string>('../../../../docs/*.md', { query: '?raw', import: 'default', eager: true });

const name = (path: string) => path.split('/').pop()!;
const guide = new Map(Object.entries(GUIDE).map(([p, md]) => [name(p), md]));
const docs = new Map(Object.entries(DOCS).map(([p, md]) => [name(p), md]));

const anchors = new Map<string, Set<string>>();
function idsOf(markdown: string): Set<string> {
  let ids = anchors.get(markdown);
  if (!ids) {
    ids = new Set(parseGuide(markdown).headings.map((h) => h.id));
    // An explicit anchor (<a id="..."></a>) kept for old links.
    for (const m of markdown.matchAll(/<a id="([^"]+)"><\/a>/g)) ids.add(m[1]);
    anchors.set(markdown, ids);
  }
  return ids;
}

/** Links outside code: [text](target), with any "title" dropped. */
function links(markdown: string): { line: number; href: string }[] {
  const out: { line: number; href: string }[] = [];
  let fence: string | null = null;
  markdown.split(/\r?\n/).forEach((line, i) => {
    const mark = /^\s{0,3}(```|~~~)/.exec(line)?.[1];
    if (mark) { fence = fence ? (fence === mark ? null : fence) : mark; return; }
    if (fence) return;
    for (const m of line.replace(/`[^`]*`/g, '').matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) out.push({ line: i + 1, href: m[1] });
  });
  return out;
}

describe('Links in the user guide', () => {
  it('has the pages', () => {
    expect(guide.size).toBeGreaterThan(10);
  });

  it('lead to pages, documents and headings that exist', () => {
    const broken: string[] = [];
    for (const [page, markdown] of guide) {
      for (const { line, href } of links(markdown)) {
        if (/^(https?:|mailto:)/.test(href)) continue;
        const [path, hash] = href.split('#');
        let target: string | undefined;
        if (!path) target = markdown;
        else if (/^(\.\/)?[\w-]+\.md$/.test(path)) target = guide.get(path.replace(/^\.\//, ''));
        else if (/^\.\.\/[\w-]+\.md$/.test(path)) target = docs.get(path.slice(3));
        else { broken.push(`${page}:${line} ${href} (not a guide page or a document in docs/)`); continue; }
        if (target === undefined) broken.push(`${page}:${line} ${href} (no such file)`);
        else if (hash && !idsOf(target).has(decodeURIComponent(hash))) broken.push(`${page}:${line} ${href} (no such heading)`);
      }
    }
    expect(broken).toEqual([]);
  });
});
