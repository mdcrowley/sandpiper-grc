import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The user guide (docs/user/*.md), for the sandpiper://guide/<page> resources and the read_guide
// tool (E18-97), which give the same text to clients that cannot read resources.

const GUIDE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../docs/user');

export interface GuidePage { slug: string; title: string; file: string }

/** The user guide pages, read once: { slug, title, file }. */
let guide: GuidePage[] | null = null;
export function guidePages(): GuidePage[] {
  if (guide) return guide;
  guide = existsSync(GUIDE_DIR)
    ? readdirSync(GUIDE_DIR).filter((f) => /^\d+-.+\.md$/.test(f)).sort().map((f) => {
      const text = readFileSync(join(GUIDE_DIR, f), 'utf8');
      return { slug: f.replace(/\.md$/, ''), title: /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? f, file: join(GUIDE_DIR, f) };
    })
    : [];
  return guide;
}

/** One page's Markdown, read fresh (the same text as its resource). */
export const guideText = (page: GuidePage): string => readFileSync(page.file, 'utf8');

/**
 * A page by its slug ("21-ai-assistants-and-mcp"), its slug without the number ("ai-assistants-and-mcp"),
 * its number ("21") or its title, in any case. Undefined when none matches.
 */
export function findGuidePage(wanted: string): GuidePage | undefined {
  const w = wanted.trim().toLowerCase().replace(/^sandpiper:\/\/guide\//, '').replace(/\.md$/, '');
  if (!w) return undefined;
  const pages = guidePages();
  return pages.find((p) => p.slug.toLowerCase() === w)
    ?? pages.find((p) => p.slug.toLowerCase().replace(/^\d+-/, '') === w)
    ?? pages.find((p) => /^\d+$/.test(w) && Number(p.slug.split('-')[0]) === Number(w))
    ?? pages.find((p) => p.title.toLowerCase() === w);
}
