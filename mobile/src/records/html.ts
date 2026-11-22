// A policy's text arrives as the HTML the server renders from its Markdown (policies/markdown.ts). The
// app shows it as native text blocks: headings, paragraphs and list items, so it scales with the
// phone's text size and reads well with VoiceOver and TalkBack. Links and images are shown as text.
// Owner: APP-WORK.

export interface TextBlock {
  kind: 'heading' | 'paragraph' | 'item' | 'quote' | 'code';
  text: string;
  /** Headings: 1 to 6. */
  level?: number;
  /** List items: "•" or "3." */
  marker?: string;
  /** List items: nesting depth, from 0. */
  depth?: number;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

const BLOCK = /<(\/?)(h[1-6]|p|li|ul|ol|blockquote|pre|tr|div|table|hr)\b[^>]*>/gi;

function clean(fragment: string, keepLines: boolean): string {
  const text = decodeEntities(fragment.replace(/<br\s*\/?>/gi, '\n').replace(/<\/t[dh]>/gi, '\t').replace(/<[^>]*>/g, ''));
  if (keepLines) return text.replace(/^\n+|\n+$/g, '');
  return text.replace(/[ \t\r\f\v]+/g, ' ').replace(/ *\n */g, '\n').trim();
}

/** HTML to text blocks (no scripts are run and no markup is kept). */
export function htmlToBlocks(html: string): TextBlock[] {
  const source = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
  const blocks: TextBlock[] = [];
  const lists: { ordered: boolean; n: number }[] = [];
  let current: { kind: TextBlock['kind']; level?: number; marker?: string; depth?: number } = { kind: 'paragraph' };
  let quote = 0;
  let last = 0;

  const flush = (upto: number) => {
    const raw = source.slice(last, upto);
    const text = clean(raw, current.kind === 'code');
    if (text) {
      const kind = current.kind === 'paragraph' && quote > 0 ? 'quote' : current.kind;
      blocks.push({ ...current, kind, text });
    }
  };

  for (const m of source.matchAll(BLOCK)) {
    const at = m.index ?? 0;
    flush(at);
    last = at + m[0].length;
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (tag === 'ul' || tag === 'ol') {
      if (closing) lists.pop(); else lists.push({ ordered: tag === 'ol', n: 0 });
      current = { kind: 'paragraph' };
    } else if (tag === 'li') {
      if (closing) { current = { kind: 'paragraph' }; continue; }
      const list = lists[lists.length - 1];
      if (list) list.n += 1;
      current = { kind: 'item', marker: list?.ordered ? `${list.n}.` : '•', depth: Math.max(0, lists.length - 1) };
    } else if (tag === 'blockquote') {
      quote = Math.max(0, quote + (closing ? -1 : 1));
      current = { kind: 'paragraph' };
    } else if (tag === 'pre') {
      current = closing ? { kind: 'paragraph' } : { kind: 'code' };
    } else if (tag[0] === 'h' && tag.length === 2) {
      current = closing ? { kind: 'paragraph' } : { kind: 'heading', level: Number(tag[1]) };
    } else {
      // p, div, tr, table, hr: a new paragraph (inside a list item, more text of the item).
      if (current.kind !== 'item') current = { kind: 'paragraph' };
    }
  }
  flush(source.length);
  return blocks;
}
