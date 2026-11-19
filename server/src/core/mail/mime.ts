// Reading an incoming email (RFC 5322 message with MIME parts), without any dependency.
//
// Enough for email-to-ticket (E15-06): headers (folded lines joined, encoded words decoded),
// addresses, multipart bodies of any depth, base64 and quoted-printable, character sets the
// runtime knows (TextDecoder), a plain-text body (or one made from the HTML part), and the
// attachments with their file names (RFC 2231 names too). Anything malformed is read as far
// as possible rather than refused: a message from a person should still become a ticket.

export interface ParsedAddress { address: string; name: string }

export interface ParsedAttachment {
  fileName: string;
  contentType: string;
  content: Buffer;
  /** Inline images referenced from HTML (signatures, logos) are marked so callers may skip them. */
  inline: boolean;
}

export interface ParsedMessage {
  /** Header names in lower case; a header that appears more than once keeps every value. */
  headers: Map<string, string[]>;
  /** First value of a header (decoded), or ''. */
  header(name: string): string;
  from: ParsedAddress | null;
  to: ParsedAddress[];
  cc: ParsedAddress[];
  subject: string;
  messageId: string;
  inReplyTo: string[];
  references: string[];
  date: Date | null;
  /** The message text: the text/plain part, else text made from the HTML part. */
  text: string;
  html: string | null;
  attachments: ParsedAttachment[];
  /** The top-level content type, for example "multipart/mixed" or "multipart/report". */
  contentType: string;
}

const MAX_DEPTH = 12;

function decoderFor(charset: string): TextDecoder {
  const name = (charset || 'utf-8').trim().toLowerCase().replace(/^"|"$/g, '');
  try {
    return new TextDecoder(name === 'us-ascii' || name === 'ascii' ? 'utf-8' : name, { fatal: false });
  } catch {
    return new TextDecoder('utf-8', { fatal: false });
  }
}

export function decodeQuotedPrintableBytes(s: string): Buffer {
  const text = s.replace(/=\r?\n/g, '');
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c === 61 /* = */ && /^[0-9A-F]{2}$/i.test(text.slice(i + 1, i + 3))) {
      out.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (c < 128) {
      out.push(c);
    } else {
      for (const b of Buffer.from(text[i], 'utf8')) out.push(b);
    }
  }
  return Buffer.from(out);
}

/** Decodes RFC 2047 encoded words ("=?utf-8?Q?Caf=C3=A9?="); whitespace between two encoded words is dropped. */
export function decodeWords(value: string): string {
  return value
    .replace(/(=\?[^?\s]+\?[QqBb]\?[^?\s]*\?=)\s+(?==\?[^?\s]+\?[QqBb]\?)/g, '$1')
    .replace(/=\?([^?\s]+)\?([QqBb])\?([^?\s]*)\?=/g, (_m, charset: string, enc: string, data: string) => {
      const cs = charset.split('*')[0];
      try {
        const bytes = enc.toUpperCase() === 'B' ? Buffer.from(data, 'base64') : decodeQuotedPrintableBytes(data.replace(/_/g, ' '));
        return decoderFor(cs).decode(bytes);
      } catch {
        return data;
      }
    });
}

/** Splits a raw message into its header block and body at the first empty line. */
function splitHead(raw: Buffer): { head: string; body: Buffer } {
  const s = raw.toString('latin1');
  // A part that starts with an empty line has no headers.
  const lead = /^\r?\n/.exec(s);
  if (lead) return { head: '', body: raw.subarray(lead[0].length) };
  const m = /\r?\n\r?\n/.exec(s);
  if (!m) return { head: s, body: Buffer.alloc(0) };
  return { head: s.slice(0, m.index), body: raw.subarray(m.index + m[0].length) };
}

/** Headers of one part. Values are kept as raw bytes read as latin1, then turned into text. */
function parseHeaders(head: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const unfolded = head.replace(/\r?\n[ \t]+/g, ' ');
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const name = line.slice(0, i).trim().toLowerCase();
    // Header bytes are usually ASCII; raw UTF-8 (RFC 6532) is read as UTF-8.
    const value = Buffer.from(line.slice(i + 1).trim(), 'latin1').toString('utf8');
    (map.get(name) ?? map.set(name, []).get(name)!).push(value);
  }
  return map;
}

/** A structured header value: "text/plain; charset=utf-8; name=\"a b.pdf\"" with RFC 2231 parameters joined and decoded. */
export function parseParams(value: string): { value: string; params: Record<string, string> } {
  const parts: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === '"' && value[i - 1] !== '\\') quoted = !quoted;
    if (ch === ';' && !quoted) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  const params: Record<string, string> = {};
  const continued: Record<string, { n: number; v: string; enc: boolean }[]> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    const key = p.slice(0, eq).trim().toLowerCase();
    let v = p.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) v = v.slice(1, -1).replace(/\\(.)/g, '$1');
    const m = /^([^*]+)\*(\d+)?(\*)?$/.exec(key);
    if (m) {
      (continued[m[1]] ??= []).push({ n: Number(m[2] ?? 0), v, enc: Boolean(m[3]) || (m[2] === undefined) });
    } else {
      params[key] = decodeWords(v);
    }
  }
  for (const [key, pieces] of Object.entries(continued)) {
    pieces.sort((a, b) => a.n - b.n);
    let charset = 'utf-8';
    let bytes: number[] = [];
    pieces.forEach((piece, idx) => {
      let v = piece.v;
      if (piece.enc) {
        if (idx === 0) {
          const q = /^([^']*)'[^']*'(.*)$/.exec(v);
          if (q) { charset = q[1] || 'utf-8'; v = q[2]; }
        }
        bytes = bytes.concat([...Buffer.from(v.replace(/%([0-9A-Fa-f]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1')]);
      } else {
        bytes = bytes.concat([...Buffer.from(v, 'utf8')]);
      }
    });
    params[key] = decoderFor(charset).decode(Buffer.from(bytes));
  }
  return { value: parts[0].trim().toLowerCase(), params };
}

/** "Name <a@b>, c@d" into addresses. Groups and comments are tolerated. */
export function parseAddresses(value: string): ParsedAddress[] {
  const out: ParsedAddress[] = [];
  const text = decodeWords(value).replace(/\([^)]*\)/g, ' ');
  const pieces: string[] = [];
  let cur = '';
  let quoted = false;
  let angle = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === '<') angle = true;
    if (!quoted && ch === '>') angle = false;
    if ((ch === ',' || ch === ';') && !quoted && !angle) { pieces.push(cur); cur = ''; } else cur += ch;
  }
  pieces.push(cur);
  for (let piece of pieces) {
    piece = piece.replace(/^[^:<"]*:\s*/, (m) => (m.includes('@') ? m : '')).trim();
    if (!piece) continue;
    const angled = /^(.*)<([^<>]+)>\s*$/.exec(piece);
    const address = (angled ? angled[2] : piece).trim().replace(/^mailto:/i, '');
    if (!/^[^\s@]+@[^\s@]+$/.test(address)) continue;
    const name = angled ? angled[1].trim().replace(/^"|"$/g, '').replace(/\\(.)/g, '$1').trim() : '';
    out.push({ address: address.toLowerCase(), name });
  }
  return out;
}

const ids = (value: string) => (value.match(/<[^<>\s]+>/g) ?? []).map((x) => x.toLowerCase());

/** Turns simple HTML into readable text: line breaks for blocks, links kept, tags and scripts removed. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head|title)[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table)\s*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<a\s[^>]*href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
      const t = label.replace(/<[^>]+>/g, '').trim();
      return t && !href.startsWith('mailto:') && t !== href ? `${t} (${href})` : t || href;
    })
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeBody(body: Buffer, encoding: string): Buffer {
  const enc = encoding.trim().toLowerCase();
  if (enc === 'base64') return Buffer.from(body.toString('latin1').replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
  if (enc === 'quoted-printable') return decodeQuotedPrintableBytes(body.toString('latin1'));
  return body;
}

interface Collected { texts: string[]; htmls: string[]; attachments: ParsedAttachment[] }

function walk(raw: Buffer, collected: Collected, depth: number): void {
  const { head, body } = splitHead(raw);
  const headers = parseHeaders(head);
  const first = (n: string) => headers.get(n)?.[0] ?? '';
  const ct = parseParams(first('content-type') || 'text/plain; charset=us-ascii');
  const disposition = parseParams(first('content-disposition'));
  const encoding = first('content-transfer-encoding') || '7bit';
  const type = ct.value || 'text/plain';

  if (type.startsWith('multipart/') && ct.params.boundary && depth < MAX_DEPTH) {
    const boundary = `--${ct.params.boundary}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const all = body.toString('latin1');
    // Everything after the closing boundary is the epilogue, which is ignored.
    const close = all.search(new RegExp(`(^|\\n)${boundary}--`));
    const text = close >= 0 ? all.slice(0, close).replace(/\r$/, '') : all;
    const pieces = text.split(new RegExp(`(?:^|\\r?\\n)${boundary}[ \\t]*\\r?\\n`));
    // The first piece is the preamble.
    for (const piece of pieces.slice(1)) {
      if (!piece.trim()) continue;
      walk(Buffer.from(piece, 'latin1'), collected, depth + 1);
    }
    return;
  }
  if (type === 'message/rfc822' && depth < MAX_DEPTH) {
    // A forwarded message: kept whole as an attachment, so nothing in it is lost.
    const inner = decodeBody(body, encoding);
    const subject = decodeWords(parseHeaders(splitHead(inner).head).get('subject')?.[0] ?? '');
    collected.attachments.push({ fileName: `${(subject || 'forwarded message').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80)}.eml`, contentType: 'message/rfc822', content: inner, inline: false });
    return;
  }
  const content = decodeBody(body, encoding);
  const fileName = disposition.params.filename || ct.params.name || '';
  const isAttachment = disposition.value === 'attachment' || (Boolean(fileName) && !type.startsWith('text/'))
    || (Boolean(fileName) && disposition.value !== 'inline');
  if (!isAttachment && type === 'text/plain') { collected.texts.push(decoderFor(ct.params.charset).decode(content)); return; }
  if (!isAttachment && type === 'text/html') { collected.htmls.push(decoderFor(ct.params.charset).decode(content)); return; }
  if (!content.length) return;
  const name = fileName || `attachment.${type.split('/')[1]?.replace(/[^a-z0-9]/g, '') || 'bin'}`;
  collected.attachments.push({
    fileName: name, contentType: type, content,
    inline: disposition.value === 'inline' || (!disposition.value && Boolean(first('content-id'))),
  });
}

export function parseMessage(input: Buffer | string): ParsedMessage {
  const raw = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  const { head } = splitHead(raw);
  const headers = parseHeaders(head);
  const header = (name: string) => decodeWords(headers.get(name.toLowerCase())?.[0] ?? '');
  const collected: Collected = { texts: [], htmls: [], attachments: [] };
  walk(raw, collected, 0);
  const html = collected.htmls.length ? collected.htmls.join('\n') : null;
  const text = (collected.texts.length ? collected.texts.join('\n\n') : html ? htmlToText(html) : '').replace(/\r\n/g, '\n');
  const dateRaw = header('date');
  const date = dateRaw && !Number.isNaN(Date.parse(dateRaw)) ? new Date(dateRaw) : null;
  return {
    headers, header,
    from: parseAddresses(header('from'))[0] ?? null,
    to: parseAddresses((headers.get('to') ?? []).join(', ')),
    cc: parseAddresses((headers.get('cc') ?? []).join(', ')),
    subject: header('subject').replace(/\s+/g, ' ').trim(),
    messageId: ids(header('message-id'))[0] ?? '',
    inReplyTo: ids(header('in-reply-to')),
    references: ids((headers.get('references') ?? []).join(' ')),
    date,
    text, html, attachments: collected.attachments,
    contentType: parseParams(header('content-type') || 'text/plain').value,
  };
}

/**
 * The new part of a reply: the lines above the quoted earlier message ("On ... wrote:",
 * "-----Original Message-----", "From: ..." blocks and lines starting with ">").
 */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const next = `${line} ${lines[i + 1] ?? ''}`;
    if (/^\s*-{2,}\s*(original message|forwarded message)\s*-{2,}/i.test(line)) break;
    if (/^\s*On\b.{0,200}\bwrote:\s*$/i.test(line) || /^\s*On\b.{0,200}\bwrote:\s*$/i.test(next.trim())) break;
    if (/^\s*From:\s.+/i.test(line) && /^\s*(Sent|Date|To):\s/i.test(lines[i + 1] ?? '')) break;
    if (/^\s*>/.test(line)) continue;
    out.push(line);
  }
  const result = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return result || text.trim();
}
