// The words of a document for search (E43): `policies.search_text` holds the published version's
// plain text, so global search and the library find a document by what it says. Drafts are never
// searchable. The column is searched (ResourceDef.searchable) but never returned by any route
// (ResourceDef.omit). A file version (a PDF) gives the text the attachments text job read from its
// original; developer B's work calls `setSearchTextFromFile` when that text arrives.
import type { ModuleContext } from '../../core/module.ts';

export const MAX_SEARCH_TEXT = 300_000;

/** Markdown to plain text: markup, link targets and image addresses removed, whitespace folded. */
export function plainText(markdown: unknown): string {
  let s = String(markdown ?? '');
  s = s.replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')           // fenced code: keep the text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')                 // images: their description
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')                  // links: their text
    .replace(/<[^>]+>/g, ' ')                                  // raw HTML tags
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')      // headings, quotes, list markers
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/gm, '') // table rules
    .replace(/\|/g, ' ')
    .replace(/(\*\*|__|\*|_|~~|`)/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/^ +| +$/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return s.slice(0, MAX_SEARCH_TEXT);
}

/**
 * Works the document's search text out again from its published version: the Markdown body as
 * plain text, or, for a file version, the text read from its original (or its PDF rendition). A
 * document with no published version (a draft, or one made obsolete) has none.
 */
export async function refreshSearchText(ctx: ModuleContext, policyId: string): Promise<void> {
  const v = await ctx.db.one<{ body: string | null; content_kind: string; source_attachment_id: string | null; rendition_attachment_id: string | null }>(
    `select body, content_kind, source_attachment_id, rendition_attachment_id from policy_versions where policy_id = $1 and status = 'published'`, [policyId]);
  let text: string | null = null;
  if (v) {
    const fromBody = plainText(v.body);
    let fromFile = '';
    const files = [v.source_attachment_id, v.rendition_attachment_id].filter(Boolean);
    if ((v.content_kind === 'file' || !fromBody) && files.length && await hasTable(ctx, 'attachment_texts')) {
      const row = await ctx.db.one<{ content: string | null }>(
        `select content from attachment_texts where attachment_id = any($1::uuid[]) and status = 'indexed' and content is not null
         order by chars desc limit 1`, [files]);
      fromFile = String(row?.content ?? '').slice(0, MAX_SEARCH_TEXT);
    }
    text = [fromBody, fromFile].filter(Boolean).join('\n').slice(0, MAX_SEARCH_TEXT) || null;
  }
  // The search index follows by its trigger on the table.
  await ctx.db.query('update policies set search_text = $2 where id = $1 and search_text is distinct from $2', [policyId, text]);
}

/**
 * For the attachments text job (developer B): the text of `attachmentId` has been read. Refreshes
 * every document whose published version has that file as its original or rendition. Returns how
 * many documents were refreshed.
 */
export async function setSearchTextFromFile(ctx: ModuleContext, attachmentId: string): Promise<number> {
  const rows = await ctx.db.query<{ policy_id: string }>(
    `select distinct policy_id from policy_versions
     where status = 'published' and (source_attachment_id = $1::uuid or rendition_attachment_id = $1::uuid)`, [attachmentId]);
  for (const r of rows) await refreshSearchText(ctx, r.policy_id);
  return rows.length;
}

const tables = new WeakMap<object, Set<string>>();
async function hasTable(ctx: ModuleContext, name: string): Promise<boolean> {
  const known = tables.get(ctx.app) ?? new Set<string>();
  if (known.has(name)) return true;
  const yes = !!(await ctx.db.one(`select 1 from information_schema.tables where table_name = $1`, [name]));
  if (yes) { known.add(name); tables.set(ctx.app, known); }
  return yes;
}

/** An excerpt of `text` around the first place `q` appears, or null. */
export function excerptOf(text: unknown, q: string, width = 160): string | null {
  const s = String(text ?? '');
  if (!s || !q) return null;
  const at = s.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return null;
  const start = Math.max(0, at - Math.floor(width / 2));
  const end = Math.min(s.length, at + q.length + Math.floor(width / 2));
  return `${start > 0 ? '…' : ''}${s.slice(start, end).replace(/\s+/g, ' ').trim()}${end < s.length ? '…' : ''}`;
}
