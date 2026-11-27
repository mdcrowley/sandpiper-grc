// Safe Markdown for policy text. Policy bodies are written by users, so the result must never
// carry script, raw HTML, event handlers or links that run code. Two independent layers:
//   1. while rendering, raw HTML in the source is escaped to text, images become their
//      description (no outside requests) unless it is one of the document's own files (`attachment:<id>`),
//      shown through the preview route; links keep only safe addresses;
//   2. afterwards, every tag is rebuilt from an allow-list with an allow-list of attributes,
//      so anything layer 1 missed still cannot reach the page as markup.
import { Marked, type Tokens } from 'marked';

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const decodeEntities = (s: string): string =>
  s.replace(/&#x([0-9a-f]+);?/gi, (_m, h: string) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff)))
    .replace(/&#(\d+);?/g, (_m, d: string) => String.fromCodePoint(Math.min(Number(d), 0x10ffff)))
    .replace(/&(colon|tab|newline);/gi, (_m, n: string) => ({ colon: ':', tab: '\t', newline: '\n' })[n.toLowerCase()] ?? '')
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Whitespace, control and invisible formatting characters. */
const isIgnorable = (c: number): boolean =>
  c <= 0x20 || (c >= 0x7f && c <= 0x9f) || (c >= 0x200b && c <= 0x200f) || c === 0x2028 || c === 0x2029 || c === 0xfeff;

/** True for http(s), mailto, in-page and same-site addresses; false for javascript:, data: and the rest. */
export function isSafeHref(href: string): boolean {
  // Browsers ignore whitespace and control characters inside a scheme, so remove them before testing.
  const h = [...decodeEntities(String(href ?? ''))].filter((ch) => !isIgnorable(ch.codePointAt(0)!)).join('').toLowerCase();
  if (!h) return false;
  if (/^(https?:\/\/|mailto:)/.test(h)) return true;
  if (h.startsWith('#')) return true;
  if (h.startsWith('/') && !h.startsWith('//') && !h.startsWith('/\\')) return true;
  return false;
}

const md = new Marked({ gfm: true, breaks: false, async: false });
md.use({
  renderer: {
    html({ text }: Tokens.HTML | Tokens.Tag): string {
      return escapeHtml(text);
    },
    image({ href, text }: Tokens.Image): string {
      // A picture stored on the document itself (Word conversion, E43-06): shown through the file
      // preview route, which checks the reader may read the document. Any other image stays text.
      const id = ATTACHMENT_IMAGE.exec(String(href ?? '').trim())?.[1];
      if (id) return `<img src="/api/attachments/${id.toLowerCase()}/preview" alt="${escapeHtml(text ?? '')}" loading="lazy">`;
      return text ? escapeHtml(`[Image: ${text}]`) : '';
    },
    link(this: any, { href, title, tokens }: Tokens.Link): string {
      const inner: string = this.parser.parseInline(tokens);
      if (!isSafeHref(href)) return inner;
      const t = title ? ` title="${escapeHtml(title)}"` : '';
      return `<a href="${escapeHtml(href)}"${t}>${inner}</a>`;
    },
  },
});

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ATTACHMENT_IMAGE = new RegExp(`^attachment:(${UUID})$`, 'i');
const PREVIEW_SRC = new RegExp(`^/api/attachments/${UUID}/preview$`);

const ALLOWED = new Set([
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'del', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'input', 'img',
]);
const VOID = new Set(['br', 'hr', 'input', 'img']);

const attr = (attrs: string, name: string): string | null =>
  new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`, 'i').exec(attrs)?.[1] ?? null;

function rebuildTag(close: string, rawName: string, attrs: string): string | null {
  const name = rawName.toLowerCase();
  if (!ALLOWED.has(name)) return null;
  if (close) return VOID.has(name) ? '' : `</${name}>`;
  switch (name) {
    case 'a': {
      const href = attr(attrs, 'href');
      if (href === null || !isSafeHref(href)) return '<a>';
      const title = attr(attrs, 'title');
      const external = /^(https?:|mailto:)/i.test(decodeEntities(href).trim());
      return `<a href="${href}"${title ? ` title="${title}"` : ''}${external ? ' target="_blank" rel="noreferrer noopener"' : ''}>`;
    }
    case 'th': case 'td': {
      const align = attr(attrs, 'align');
      return align && /^(left|right|center)$/i.test(align) ? `<${name} align="${align.toLowerCase()}">` : `<${name}>`;
    }
    case 'ol': {
      const start = attr(attrs, 'start');
      return start && /^\d{1,6}$/.test(start) ? `<ol start="${start}">` : '<ol>';
    }
    case 'img': {
      // Only a picture of the document's own files, through the preview route.
      const src = attr(attrs, 'src');
      if (src === null || !PREVIEW_SRC.test(src)) return null;
      return `<img src="${src}" alt="${attr(attrs, 'alt') ?? ''}" loading="lazy">`;
    }
    case 'input':
      // Only the tick box of a task list; always inert.
      return /type\s*=\s*"checkbox"/i.test(attrs) ? `<input type="checkbox" disabled${/\schecked/i.test(attrs) ? ' checked' : ''}>` : null;
    default:
      return `<${name}>`;
  }
}

/** Layer 2: keeps allow-listed tags (rebuilt with allow-listed attributes); everything else becomes text. */
export function sanitizeHtml(html: string): string {
  return html.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|[^<>"])*)>|</g, (m, close?: string, name?: string, attrs?: string) => {
    if (name === undefined) return '&lt;';
    return rebuildTag(close ?? '', name, attrs ?? '') ?? escapeHtml(m);
  });
}

/** Policy Markdown to HTML that is safe to place in the page. */
export function renderPolicyMarkdown(source: unknown): string {
  const text = typeof source === 'string' ? source : '';
  if (!text.trim()) return '';
  return sanitizeHtml(md.parse(text, { async: false }) as string);
}
