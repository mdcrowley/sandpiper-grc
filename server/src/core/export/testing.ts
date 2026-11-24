// Test helpers for exported files: the text and page count of a PDF (standard fonts, or embedded
// fonts read back through their ToUnicode maps), and the parts of an XLSX package.
import { inflateSync } from 'node:zlib';
import { strFromU8, unzipSync } from 'fflate';
import type { ModuleDef } from '../module.ts';

interface PdfObject { dict: string; stream: string | null }

/** Every numbered object of a PDF: its dictionary and its stream (inflated where compressed). */
function objects(pdf: Buffer): Map<number, PdfObject> {
  const out = new Map<number, PdfObject>();
  const text = pdf.toString('latin1');
  const re = /(\d+) 0 obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    const end = text.indexOf('endobj', start);
    if (end < 0) break;
    const body = text.slice(start, end);
    const s = /stream\r?\n/.exec(body);
    let stream: string | null = null;
    let dict = body;
    if (s) {
      dict = body.slice(0, s.index);
      const from = start + s.index + s[0].length;
      const to = text.indexOf('endstream', from);
      const chunk = pdf.subarray(from, to);
      try { stream = inflateSync(chunk).toString('latin1'); } catch { stream = chunk.toString('latin1'); }
    }
    out.set(Number(m[1]), { dict, stream });
    re.lastIndex = end + 'endobj'.length;
  }
  return out;
}

/** A ToUnicode map as PDFKit writes it: ranges of codes, each with an array of UTF-16 strings. */
function toUnicode(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const r of cmap.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([^\]]*)\]/g)) {
    let code = parseInt(r[1], 16);
    // A ligature maps to several characters: "<0066 0069>".
    for (const h of r[3].matchAll(/<([0-9a-fA-F\s]*)>/g)) {
      const hex = h[1].replace(/\s+/g, '');
      const units: number[] = [];
      for (let i = 0; i + 4 <= hex.length; i += 4) units.push(parseInt(hex.slice(i, i + 4), 16));
      map.set(code++, String.fromCharCode(...units));
    }
  }
  // The other form, one destination for a whole range, on a line of its own.
  for (const r of cmap.matchAll(/^<([0-9a-fA-F]+)>[ \t]*<([0-9a-fA-F]+)>[ \t]*<([0-9a-fA-F]+)>[ \t]*$/gm)) {
    const [a, b, u] = [parseInt(r[1], 16), parseInt(r[2], 16), parseInt(r[3], 16)];
    for (let c = a; c <= b; c++) map.set(c, String.fromCharCode(u + c - a));
  }
  return map;
}

/**
 * The text drawn on the pages, one string per text-showing operation, in order. Text in an
 * embedded font (the application's own font, E41-13) is read back through the font's ToUnicode
 * map; text in a standard font is read as Windows-1252.
 */
export function pdfText(pdf: Buffer): string {
  const objs = objects(pdf);
  // PDFKit names fonts F1, F2... once per document.
  const fonts = new Map<string, Map<number, string> | null>();
  for (const o of objs.values()) {
    const block = /\/Font\s*<<([^>]*)>>/.exec(o.dict);
    if (!block) continue;
    for (const f of block[1].matchAll(/\/([A-Za-z0-9_.-]+)\s+(\d+) 0 R/g)) {
      if (fonts.has(f[1])) continue;
      const ref = /\/ToUnicode\s+(\d+) 0 R/.exec(objs.get(Number(f[2]))?.dict ?? '');
      const cmap = ref ? objs.get(Number(ref[1]))?.stream : null;
      fonts.set(f[1], cmap ? toUnicode(cmap) : null);
    }
  }
  const parts: string[] = [];
  for (const o of objs.values()) {
    const s = o.stream;
    if (!s || /\/Length1|\/Subtype\s*\/(?:CIDFontType0C|OpenType|XML|Image)/.test(o.dict) || s.includes('begincmap')) continue;
    let map: Map<number, string> | null = null;
    const hex = (h: string) => {
      if (!map) return Buffer.from(h, 'hex').toString('latin1');
      let out = '';
      for (let i = 0; i + 4 <= h.length; i += 4) out += map.get(parseInt(h.slice(i, i + 4), 16)) ?? '?';
      return out;
    };
    for (const m of s.matchAll(/\/([A-Za-z0-9_.-]+)\s+[\d.]+\s+Tf|\[([^\]]*)\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj|\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
      if (m[1] !== undefined) map = fonts.get(m[1]) ?? null;
      else if (m[2] !== undefined) {
        let line = '';
        for (const h of m[2].matchAll(/<([0-9a-fA-F]*)>|\(((?:\\.|[^\\)])*)\)/g)) line += h[1] !== undefined ? hex(h[1]) : h[2];
        parts.push(line);
      } else if (m[3] !== undefined) parts.push(hex(m[3]));
      else parts.push(m[4]);
    }
  }
  return parts.join('\n');
}

export const pdfPageCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length;

/** The XML parts of an XLSX file by name. */
export function xlsxParts(file: Uint8Array): Record<string, string> {
  return Object.fromEntries(Object.entries(unzipSync(file)).map(([k, v]) => [k, strFromU8(v)]));
}

// Invented record types for exercising list exports, fact sheets and the import.
export const gizmos: ModuleDef = {
  key: 'testgizmos',
  async seedDefaults(ctx) {
    await ctx.db.exec(`
      create table if not exists test_gizmos (
        id uuid primary key default gen_random_uuid(),
        ref text, name text not null, notes text, status text, owner_id uuid, parent_id uuid,
        due_on date, seen_at timestamptz, cost numeric, units numeric, active boolean, restricted boolean not null default false,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);
      create table if not exists test_vaults (
        id uuid primary key default gen_random_uuid(), title text not null,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
    await ctx.lookups.ensure('gizmo_status', [
      { value: 'open', label: 'Open', color: 'blue' },
      { value: 'in_repair', label: 'In repair', color: 'amber' },
      { value: 'done', label: 'Done', color: 'green' },
    ]);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'gizmo', table: 'test_gizmos', module: 'tickets', label: 'Gizmo', plural: 'Gizmos',
      path: '/api/gizmos', route: '/gizmos', titleField: 'name', ref: { field: 'ref', prefix: 'GZ-' },
      restricted: 'flag', searchable: ['name', 'notes'],
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true },
        name: { label: 'Name', type: 'text', required: true },
        notes: { label: 'Notes', type: 'longtext' },
        status: { label: 'Status', type: 'lookup', list: 'gizmo_status', default: 'open' },
        owner_id: { label: 'Owner', type: 'user' },
        parent_id: { label: 'Parent', type: 'ref', to: 'gizmo' },
        due_on: { label: 'Due', type: 'date' },
        seen_at: { label: 'Last seen', type: 'datetime' },
        cost: { label: 'Cost', type: 'currency' },
        units: { label: 'Units', type: 'number' },
        active: { label: 'In service', type: 'boolean' },
        restricted: { label: 'Restricted', type: 'boolean', default: false },
      },
    });
    ctx.defineResource({
      type: 'vault', table: 'test_vaults', module: 'tickets', label: 'Vault', plural: 'Vaults',
      path: '/api/vaults', route: '/vaults', titleField: 'title', restricted: true,
      fields: { title: { label: 'Title', type: 'text', required: true } },
    });
  },
};
