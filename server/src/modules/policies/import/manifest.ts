// The bulk import of a document package (E43-11): a .zip of files with `manifest.csv`, one row per
// version. This file reads the archive's list and the manifest and checks each row on its own; the
// run (index.ts) does the rest through the documents' own routes.
import { unzipSync } from 'fflate';
import { decodeCsvBytes, parseCsv, sniffDelimiter } from '../../../core/import/read.ts';
import { parseDate } from '../../../core/import/service.ts';

export const MANIFEST_NAME = 'manifest.csv';
/** The most rows (versions) one import takes. */
export const IMPORT_MAX_ROWS = 2_000;
/** The archive may unpack to at most this (declared sizes, checked before anything is unpacked). */
export const IMPORT_MAX_UNPACKED = 2 * 1024 * 1024 * 1024;
/** One file in the archive may be at most this. */
export const IMPORT_MAX_FILE = 200 * 1024 * 1024;

export const COLUMNS = [
  'doc_number', 'title', 'document_type', 'department', 'owner', 'parent_number', 'access', 'access_departments', 'access_roles',
  'version', 'version_label', 'status', 'approved_on', 'effective_on', 'superseded_on', 'withdrawn_on', 'approved_by_name',
  'approval_body', 'approval_reference', 'change_summary', 'file',
] as const;
export type Column = typeof COLUMNS[number];
export const DATE_COLUMNS: Column[] = ['approved_on', 'effective_on', 'superseded_on', 'withdrawn_on'];
export const VERSION_STATUSES = ['draft', 'in_review', 'approved', 'published', 'superseded', 'withdrawn'];

/** Accepted header spellings besides the column names. */
const ALIASES: Record<string, Column> = {
  number: 'doc_number', 'document number': 'doc_number', 'doc number': 'doc_number', type: 'document_type', 'document type': 'document_type',
  'owning department': 'department', 'parent': 'parent_number', 'parent number': 'parent_number', revision: 'version_label', label: 'version_label',
  'version label': 'version_label', approved: 'approved_on', effective: 'effective_on', superseded: 'superseded_on', withdrawn: 'withdrawn_on',
  'approved by': 'approved_by_name', 'approval body': 'approval_body', resolution: 'approval_reference', 'approval reference': 'approval_reference',
  summary: 'change_summary', 'change summary': 'change_summary', 'file name': 'file', filename: 'file', path: 'file',
};

/** Office lock files, thumbnail caches and operating-system clutter: never documents. */
export function isClutter(path: string): boolean {
  const parts = path.split('/');
  const name = parts[parts.length - 1] ?? '';
  return !name || name.startsWith('~$') || name.startsWith('._') || /^(thumbs\.db|ehthumbs\.db|desktop\.ini|\.ds_store|icon\r?)$/i.test(name)
    || parts.some((p) => p === '__MACOSX' || p === '.thumbnails' || p === '.git');
}

export interface ManifestRow {
  /** Line in the manifest (2 = the first after the header). */
  row: number;
  values: Partial<Record<Column, string>>;
  /** The archive entry the file column names (matched without case, slashes either way). */
  entry: string | null;
  problems: string[];
}

export interface Archive {
  /** Every entry that is a file, clutter left out. */
  entries: { name: string; size: number }[];
  skipped: string[];
  rows: ManifestRow[];
  /** Problems with the archive or manifest as a whole. */
  problems: string[];
  unknownColumns: string[];
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase();

/** Reads the archive's list and its manifest. Nothing but the manifest is unpacked here. */
export function readArchive(zip: Uint8Array): Archive {
  const out: Archive = { entries: [], skipped: [], rows: [], problems: [], unknownColumns: [] };
  let total = 0;
  try {
    unzipSync(zip, {
      filter: (f) => {
        total += f.originalSize;
        if (f.name.endsWith('/')) return false;
        if (isClutter(f.name)) out.skipped.push(f.name);
        else out.entries.push({ name: f.name, size: f.originalSize });
        return false;
      },
    });
  } catch {
    out.problems.push('The file is not a readable .zip archive.');
    return out;
  }
  if (total > IMPORT_MAX_UNPACKED) {
    out.problems.push(`The archive would unpack to more than ${IMPORT_MAX_UNPACKED / 1024 / 1024 / 1024} GB.`);
    return out;
  }
  const manifestEntry = out.entries.find((e) => norm(e.name) === MANIFEST_NAME) ?? out.entries.find((e) => norm(e.name).endsWith(`/${MANIFEST_NAME}`));
  if (!manifestEntry) {
    out.problems.push(`The archive has no ${MANIFEST_NAME}. Put one at its top level, with one row per version.`);
    return out;
  }
  if (manifestEntry.size > 10 * 1024 * 1024) {
    out.problems.push(`${MANIFEST_NAME} is larger than 10 MB.`);
    return out;
  }
  const bytes = unzipSync(zip, { filter: (f) => f.name === manifestEntry.name })[manifestEntry.name];
  const { text } = decodeCsvBytes(bytes);
  const table = parseCsv(text, sniffDelimiter(text));
  if (table.length < 2) {
    out.problems.push(`${MANIFEST_NAME} has no rows under its header.`);
    return out;
  }
  const header = table[0].map((h) => h.trim().toLowerCase().replace(/[_\s]+/g, ' '));
  const columns = header.map((h) => (COLUMNS as readonly string[]).includes(h.replace(/ /g, '_')) ? h.replace(/ /g, '_') as Column : ALIASES[h] ?? null);
  out.unknownColumns = table[0].filter((_, i) => !columns[i] && table[0][i].trim());
  if (!columns.includes('file')) out.problems.push(`${MANIFEST_NAME} needs a "file" column naming each version's file in the archive.`);
  if (!columns.includes('doc_number') && !columns.includes('title')) out.problems.push(`${MANIFEST_NAME} needs a "doc_number" or a "title" column.`);
  if (table.length - 1 > IMPORT_MAX_ROWS) out.problems.push(`${MANIFEST_NAME} has more than ${IMPORT_MAX_ROWS} rows; split the package.`);
  if (out.problems.length) return out;

  // Files are found by their path in the archive, or by name alone when that is unique.
  const prefix = manifestEntry.name.includes('/') ? manifestEntry.name.slice(0, manifestEntry.name.lastIndexOf('/') + 1) : '';
  const byPath = new Map(out.entries.map((e) => [norm(e.name), e.name]));
  const byName = new Map<string, string[]>();
  for (const e of out.entries) {
    const n = norm(e.name).split('/').pop()!;
    byName.set(n, [...(byName.get(n) ?? []), e.name]);
  }

  table.slice(1).forEach((cells, i) => {
    const values: ManifestRow['values'] = {};
    columns.forEach((c, j) => { if (c && cells[j] !== undefined && cells[j].trim() !== '') values[c] = cells[j].trim(); });
    const problems: string[] = [];
    if (!values.doc_number && !values.title) problems.push('Give a document number or a title.');
    if (values.version !== undefined && !/^\d{1,4}$/.test(values.version)) problems.push('The version is a whole number (1, 2, 3); put labels such as "Rev. C" in version_label.');
    if (values.status !== undefined) {
      const s = values.status.toLowerCase().replace(/[\s-]+/g, '_');
      const status = s === 'effective' || s === 'current' ? 'published' : s === 'obsolete' || s === 'retired' ? 'withdrawn' : s;
      if (!VERSION_STATUSES.includes(status)) problems.push(`Unknown status "${values.status}". Use draft, in_review, approved, published (effective), superseded or withdrawn.`);
      else values.status = status;
    }
    for (const d of DATE_COLUMNS) {
      if (values[d] === undefined) continue;
      const parsed = parseDate(values[d]!);
      if (!parsed) problems.push(`${d} "${values[d]}" is not a date (use YYYY-MM-DD).`);
      else values[d] = parsed;
    }
    if (values.access !== undefined) {
      const a = values.access.toLowerCase();
      values.access = ['organization', 'everyone', 'all', 'public'].includes(a) ? 'organization' : ['restricted', 'named', 'limited'].includes(a) ? 'restricted' : values.access;
      if (!['organization', 'restricted'].includes(values.access)) problems.push('Access is "organization" (everyone) or "restricted".');
    }
    let entry: string | null = null;
    if (!values.file) problems.push('Name the file of this version (the "file" column).');
    else if (isClutter(norm(values.file))) problems.push(`"${values.file}" is an Office lock file or a thumbnail cache, not a document.`);
    else {
      const wanted = norm(values.file);
      entry = byPath.get(wanted) ?? byPath.get(norm(prefix) + wanted) ?? null;
      if (!entry) {
        const same = byName.get(wanted.split('/').pop()!) ?? [];
        if (same.length === 1) entry = same[0];
        else if (same.length > 1) problems.push(`"${values.file}" matches ${same.length} files in the archive; give its folder too.`);
        else problems.push(`"${values.file}" is not in the archive.`);
      }
      if (entry && (out.entries.find((e) => e.name === entry)?.size ?? 0) > IMPORT_MAX_FILE) problems.push(`"${values.file}" is larger than ${IMPORT_MAX_FILE / 1024 / 1024} MB.`);
    }
    out.rows.push({ row: i + 2, values, entry, problems });
  });
  return out;
}

/** The bytes of one archive entry. */
export function entryBytes(zip: Uint8Array, name: string): Buffer {
  const got = unzipSync(zip, { filter: (f) => f.name === name && f.originalSize <= IMPORT_MAX_FILE })[name];
  if (!got) throw new Error(`"${name}" could not be read from the archive.`);
  return Buffer.from(got.buffer, got.byteOffset, got.byteLength);
}

/** The key that groups the rows of one document: its number, or its title when it has none. */
export const documentKey = (r: ManifestRow) => (r.values.doc_number ? `n:${r.values.doc_number.toLowerCase()}` : `t:${(r.values.title ?? '').toLowerCase()}`);

/**
 * The rows in load order: documents in their manifest order (a parent before the documents under it
 * when both are in the package), each document's versions oldest first (version number, else the
 * effective or approval date, else the manifest order).
 */
export function loadOrder(rows: ManifestRow[]): ManifestRow[] {
  const groups = new Map<string, ManifestRow[]>();
  for (const r of rows) groups.set(documentKey(r), [...(groups.get(documentKey(r)) ?? []), r]);
  const keys = [...groups.keys()];
  const numberOf = new Map(keys.map((k) => [k, groups.get(k)!.find((r) => r.values.doc_number)?.values.doc_number?.toLowerCase() ?? null]));
  const parentOf = (k: string) => groups.get(k)!.find((r) => r.values.parent_number)?.values.parent_number?.toLowerCase() ?? null;
  const ordered: string[] = [];
  const visiting = new Set<string>();
  const visit = (k: string) => {
    if (ordered.includes(k) || visiting.has(k)) return;
    visiting.add(k);
    const p = parentOf(k);
    const parentKey = p ? keys.find((x) => numberOf.get(x) === p) : undefined;
    if (parentKey && parentKey !== k) visit(parentKey);
    ordered.push(k);
  };
  keys.forEach(visit);
  const sortKey = (r: ManifestRow) => [
    r.values.version ? Number(r.values.version) : Number.MAX_SAFE_INTEGER,
    r.values.effective_on ?? r.values.approved_on ?? '9999-99-99',
    r.row,
  ] as const;
  return ordered.flatMap((k) => [...groups.get(k)!].sort((a, b) => {
    const x = sortKey(a); const y = sortKey(b);
    return x[0] - y[0] || x[1].localeCompare(y[1]) || x[2] - y[2];
  }));
}
