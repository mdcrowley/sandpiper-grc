// File names and file types: what a name is reduced to for display, which types may be
// stored, and whether the first bytes of a file agree with the type its name claims.

/** How much of the start of a file is kept for the content check. */
export const HEAD_BYTES = 4096;

type Family = 'pdf' | 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp' | 'tiff' | 'zip' | 'ole' | 'rtf' | 'text';

interface KnownType { mime: string; family: Family; group: string }

/** Types whose content the server can recognize. `group` drives the icon in the web panel. */
const KNOWN: Record<string, KnownType> = {
  pdf: { mime: 'application/pdf', family: 'pdf', group: 'pdf' },
  png: { mime: 'image/png', family: 'png', group: 'image' },
  jpg: { mime: 'image/jpeg', family: 'jpeg', group: 'image' },
  jpeg: { mime: 'image/jpeg', family: 'jpeg', group: 'image' },
  gif: { mime: 'image/gif', family: 'gif', group: 'image' },
  webp: { mime: 'image/webp', family: 'webp', group: 'image' },
  bmp: { mime: 'image/bmp', family: 'bmp', group: 'image' },
  tif: { mime: 'image/tiff', family: 'tiff', group: 'image' },
  tiff: { mime: 'image/tiff', family: 'tiff', group: 'image' },
  txt: { mime: 'text/plain', family: 'text', group: 'text' },
  log: { mime: 'text/plain', family: 'text', group: 'text' },
  md: { mime: 'text/markdown', family: 'text', group: 'text' },
  csv: { mime: 'text/csv', family: 'text', group: 'sheet' },
  json: { mime: 'application/json', family: 'text', group: 'text' },
  xml: { mime: 'application/xml', family: 'text', group: 'text' },
  eml: { mime: 'message/rfc822', family: 'text', group: 'mail' },
  html: { mime: 'text/html', family: 'text', group: 'text' },
  htm: { mime: 'text/html', family: 'text', group: 'text' },
  svg: { mime: 'image/svg+xml', family: 'text', group: 'image' },
  rtf: { mime: 'application/rtf', family: 'rtf', group: 'document' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', family: 'zip', group: 'document' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', family: 'zip', group: 'sheet' },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', family: 'zip', group: 'slides' },
  odt: { mime: 'application/vnd.oasis.opendocument.text', family: 'zip', group: 'document' },
  ods: { mime: 'application/vnd.oasis.opendocument.spreadsheet', family: 'zip', group: 'sheet' },
  odp: { mime: 'application/vnd.oasis.opendocument.presentation', family: 'zip', group: 'slides' },
  zip: { mime: 'application/zip', family: 'zip', group: 'archive' },
  doc: { mime: 'application/msword', family: 'ole', group: 'document' },
  xls: { mime: 'application/vnd.ms-excel', family: 'ole', group: 'sheet' },
  ppt: { mime: 'application/vnd.ms-powerpoint', family: 'ole', group: 'slides' },
  msg: { mime: 'application/vnd.ms-outlook', family: 'ole', group: 'mail' },
};

/** What a new installation accepts. Administrators change the list in the settings. */
export const DEFAULT_ALLOWED_EXTENSIONS = [
  'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'txt', 'log', 'md', 'csv', 'json', 'xml', 'eml', 'msg', 'rtf',
  'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'doc', 'xls', 'ppt', 'zip',
];

/** Programs and scripts. These can never be added to the allow-list. */
export const BLOCKED_EXTENSIONS = new Set([
  'exe', 'dll', 'com', 'scr', 'pif', 'cpl', 'sys', 'drv', 'ocx', 'msi', 'msp', 'mst', 'msix', 'appx', 'bat', 'cmd',
  'ps1', 'psm1', 'psd1', 'vbs', 'vbe', 'js', 'jse', 'mjs', 'cjs', 'wsf', 'wsh', 'hta', 'jar', 'class', 'sh', 'bash',
  'zsh', 'csh', 'ksh', 'py', 'pyc', 'pl', 'rb', 'php', 'lnk', 'url', 'reg', 'inf', 'scf', 'gadget', 'app', 'apk',
  'ipa', 'deb', 'rpm', 'dmg', 'pkg', 'iso', 'img', 'vhd', 'vhdx', 'bin', 'elf', 'so', 'dylib', 'chm', 'hlp',
  'docm', 'xlsm', 'pptm', 'dotm', 'xltm', 'xlam', 'ppam',
]);

/** Types that a browser would run as a page if they were ever served under their own type. */
const NEVER_SERVED_AS_IS = new Set(['text/html', 'image/svg+xml', 'application/xml', 'application/xhtml+xml']);

const EXTENSION_RE = /^[a-z0-9]{1,10}$/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

/**
 * Reduces whatever the browser sent as the file name to something safe to show and to put
 * in a download header: the last path segment only, no control or direction-changing
 * characters, no characters that are special in a path, at most 180 characters.
 * The result is for display. It is never used to decide where the file is stored.
 */
export function sanitizeFileName(raw: unknown): string {
  let name = String(raw ?? '').normalize('NFC');
  name = name.split(/[\\/]/).pop() ?? '';
  name = name
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+/, '')
    .replace(/[\s.]+$/, '');
  if (WINDOWS_RESERVED.test(name)) name = `_${name}`;
  if (name.length > 180) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= 11 ? name.slice(dot) : '';
    name = name.slice(0, 180 - ext.length).trimEnd() + ext;
  }
  return name || 'file';
}

/** Lower-case extension of a sanitized name, or '' when it has none worth the name. */
export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return '';
  const ext = fileName.slice(dot + 1).toLowerCase();
  return EXTENSION_RE.test(ext) ? ext : '';
}

/** Cleans a list of extensions from a setting or a request: lower case, no dots, no repeats. */
export function normalizeExtensions(input: unknown): string[] {
  const parts = Array.isArray(input) ? input : String(input ?? '').split(/[\s,;]+/);
  const out = new Set<string>();
  for (const p of parts) {
    const ext = String(p ?? '').trim().toLowerCase().replace(/^\*?\./, '');
    if (ext) out.add(ext);
  }
  return [...out].sort();
}

export const isValidExtension = (ext: string) => EXTENSION_RE.test(ext);

/** The content type recorded for an extension. Unknown types are plain bytes. */
export function contentTypeFor(ext: string): string {
  return KNOWN[ext]?.mime ?? 'application/octet-stream';
}

/** The content type sent on download: never one a browser could render as a page. */
export function downloadContentType(stored: string): string {
  const type = stored.split(';')[0].trim().toLowerCase();
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(type) || NEVER_SERVED_AS_IS.has(type)) return 'application/octet-stream';
  return type.startsWith('text/') ? 'text/plain; charset=utf-8' : type;
}

/** Icon group for the web panel: pdf, image, text, sheet, slides, document, archive, mail or file. */
export function typeGroup(ext: string): string {
  return KNOWN[ext]?.group ?? 'file';
}

const starts = (head: Buffer, bytes: number[], at = 0) =>
  head.length >= at + bytes.length && bytes.every((b, i) => head[at + i] === b);
const startsText = (head: Buffer, text: string, at = 0) => starts(head, [...Buffer.from(text, 'latin1')], at);

const SIGNATURES: Record<Exclude<Family, 'text'>, (head: Buffer) => boolean> = {
  pdf: (h) => startsText(h, '%PDF-'),
  png: (h) => starts(h, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpeg: (h) => starts(h, [0xff, 0xd8, 0xff]),
  gif: (h) => startsText(h, 'GIF87a') || startsText(h, 'GIF89a'),
  webp: (h) => startsText(h, 'RIFF') && startsText(h, 'WEBP', 8),
  bmp: (h) => startsText(h, 'BM') && h.length >= 14,
  tiff: (h) => starts(h, [0x49, 0x49, 0x2a, 0x00]) || starts(h, [0x4d, 0x4d, 0x00, 0x2a]),
  zip: (h) => starts(h, [0x50, 0x4b, 0x03, 0x04]) || starts(h, [0x50, 0x4b, 0x05, 0x06]) || starts(h, [0x50, 0x4b, 0x07, 0x08]),
  ole: (h) => starts(h, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  rtf: (h) => startsText(h, '{\\rtf'),
};

/** Signatures that plain text never begins with (a renamed binary is refused as text). */
const STRONG: (keyof typeof SIGNATURES)[] = ['pdf', 'png', 'jpeg', 'gif', 'zip', 'ole'];

/** Native programs and scripts with an interpreter line, whatever they are called. */
export function looksExecutable(head: Buffer): boolean {
  if (starts(head, [0x7f, 0x45, 0x4c, 0x46])) return true; // ELF
  if (starts(head, [0x4d, 0x5a]) && head.subarray(0, 64).includes(0)) return true; // Windows program
  for (const magic of [[0xfe, 0xed, 0xfa, 0xce], [0xfe, 0xed, 0xfa, 0xcf], [0xce, 0xfa, 0xed, 0xfe], [0xcf, 0xfa, 0xed, 0xfe], [0xca, 0xfe, 0xba, 0xbe]]) {
    if (starts(head, magic)) return true; // Mach-O, universal binary, Java class
  }
  const afterBom = starts(head, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  return startsText(head, '#!', afterBom); // script with an interpreter line
}

function looksLikeText(head: Buffer): boolean {
  const utf16 = starts(head, [0xff, 0xfe]) || starts(head, [0xfe, 0xff]);
  if (!utf16 && head.includes(0)) return false;
  return !STRONG.some((family) => SIGNATURES[family](head));
}

export type ContentVerdict =
  | { ok: true }
  | { ok: false; code: 'executable' | 'type_mismatch'; message: string };

/**
 * Compares the first bytes of a file with the type its extension claims.
 * Extensions the server has no signature for (ones an administrator added) pass unless
 * the content is a program.
 */
export function checkContent(ext: string, head: Buffer): ContentVerdict {
  if (looksExecutable(head)) {
    return { ok: false, code: 'executable', message: 'This file is a program or script. Programs cannot be attached.' };
  }
  const known = KNOWN[ext];
  if (!known) return { ok: true };
  const matches = known.family === 'text' ? looksLikeText(head) : SIGNATURES[known.family](head);
  if (matches) return { ok: true };
  return {
    ok: false, code: 'type_mismatch',
    message: `The content of this file is not what its name says (.${ext}). Check the file and try again.`,
  };
}

/**
 * `Content-Disposition` for a download: an attachment, with a plain and a UTF-8 name. `inline` only
 * for a preview of a type that `previewKind` accepts (E41-16); every other file is always an attachment.
 */
export function contentDisposition(fileName: string, inline = false): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\;%]/g, '_');
  const utf8 = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

/**
 * The types a browser may show in place (E41-16): raster images it draws itself and PDFs, which the
 * web application draws with pdf.js (no scripts, no plugin). Never SVG, HTML or anything a browser
 * could run as a page. The stored content type must agree with the extension (both set by the
 * server at upload, and the content was checked against the extension then).
 */
const PREVIEW: Record<string, { kind: 'image' | 'pdf'; mime: string }> = {
  png: { kind: 'image', mime: 'image/png' },
  jpg: { kind: 'image', mime: 'image/jpeg' },
  jpeg: { kind: 'image', mime: 'image/jpeg' },
  gif: { kind: 'image', mime: 'image/gif' },
  webp: { kind: 'image', mime: 'image/webp' },
  bmp: { kind: 'image', mime: 'image/bmp' },
  pdf: { kind: 'pdf', mime: 'application/pdf' },
};

/** 'image' or 'pdf' when a file of this extension and stored type may be previewed, else null. */
export function previewKind(ext: string, storedType: string): 'image' | 'pdf' | null {
  const p = PREVIEW[String(ext ?? '').toLowerCase()];
  return p && String(storedType ?? '').split(';')[0].trim().toLowerCase() === p.mime ? p.kind : null;
}

/** The content type a preview is served with (the fixed type for its extension), or null when it may not be. */
export function previewContentType(ext: string, storedType: string): string | null {
  return previewKind(ext, storedType) ? PREVIEW[ext.toLowerCase()].mime : null;
}
