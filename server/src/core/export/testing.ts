// Test helpers for exported files: the text and page count of a PDF made with the standard
// fonts, and the parts of an XLSX package.
import { inflateSync } from 'node:zlib';
import { strFromU8, unzipSync } from 'fflate';
import type { ModuleDef } from '../module.ts';

/** Every content stream of a PDF, inflated where compressed. */
function streams(pdf: Buffer): string[] {
  const out: string[] = [];
  const text = pdf.toString('latin1');
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    const end = text.indexOf('endstream', start);
    if (end < 0) break;
    const chunk = pdf.subarray(start, end);
    try { out.push(inflateSync(chunk).toString('latin1')); } catch { out.push(chunk.toString('latin1')); }
    re.lastIndex = end + 'endstream'.length;
  }
  return out;
}

/** The text drawn on the pages, one string per text-showing operation, in order. */
export function pdfText(pdf: Buffer): string {
  const parts: string[] = [];
  for (const s of streams(pdf)) {
    for (const m of s.matchAll(/\[([^\]]*)\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj|\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
      if (m[1] !== undefined) {
        let line = '';
        for (const h of m[1].matchAll(/<([0-9a-fA-F]*)>|\(((?:\\.|[^\\)])*)\)/g)) line += h[1] !== undefined ? Buffer.from(h[1], 'hex').toString('latin1') : h[2];
        parts.push(line);
      } else if (m[2] !== undefined) parts.push(Buffer.from(m[2], 'hex').toString('latin1'));
      else parts.push(m[3]);
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
