// The generic import: any record type registered with defineResource. A table read from a CSV or
// XLSX file is mapped to fields, every value is turned into what the field stores (lookup values
// by value or label, people by user name, email or name, records by reference or title), each
// row is validated exactly as a hand-made record is, duplicates are found by a chosen key, and
// then every valid row is created or updated through the resource engine, so hooks and the
// per-record audit run as they do for records made by hand. The check (dry run) does exactly the
// same inside a transaction that is always rolled back (E13-22), so it refuses what the real import
// would, after-hooks and database constraints included, and keeps nothing.
import type { FastifyRequest } from 'fastify';
import { CURRENCY } from '../config.ts';
import type { Db } from '../db.ts';
import { UUID_RE } from '../errors.ts';
import type { FieldDef, ResourceDef, ResourceRegistry, Row, SessionUser } from '../module.ts';
import { wallToInstant } from '../export/zone.ts';
import type { ImportTable } from './read.ts';
import type { CellValue } from './xlsx.ts';

export type ImportMode = 'create' | 'update' | 'upsert';

export interface ImportField {
  name: string; label: string; type: FieldDef['type']; required: boolean;
  list?: string; to?: string; multiple?: boolean; custom?: boolean;
  /** A required field that may be left unmapped when this other field is mapped (ResourceDef.filledBy). */
  filledBy?: string;
}

export interface ImportDeps {
  db: Db;
  registry: ResourceRegistry;
  lookups: { values(list: string): Promise<{ value: string; label: string }[]> };
  mayAccess: (user: SessionUser | null, def: ResourceDef, action: string) => boolean;
  visibilitySql: (def: ResourceDef, user: SessionUser | null | undefined, alias?: string) => string;
  /** The resource engine's own validation (throws an ApiError with `fields`). */
  validate: (def: ResourceDef, input: Row, mode: 'create' | 'update', system: boolean) => Promise<Row>;
  customDefs: (type: string) => Promise<Record<string, FieldDef>>;
}

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
const squash = (s: unknown) => norm(s).replace(/[^a-z0-9]+/g, '');

/** Fields a person may fill from a file: every built-in and custom field that is not read-only and not JSON. */
export async function importableFields(deps: ImportDeps, def: ResourceDef): Promise<ImportField[]> {
  const custom = await deps.customDefs(def.type);
  return [...Object.entries(def.fields), ...Object.entries(custom)]
    .filter(([, f]) => !f.readOnly && f.type !== 'json')
    .map(([name, f]) => ({
      name, label: f.label, type: f.type, required: Boolean(f.required && f.default === undefined),
      ...(def.filledBy?.[name] ? { filledBy: def.filledBy[name] } : {}),
      ...(f.list ? { list: f.list } : {}), ...(f.to ? { to: f.to } : {}),
      ...(f.multiple ? { multiple: true } : {}), ...(f.custom ? { custom: true } : {}),
    }));
}

/** Fields that can identify an existing record: the id, the reference number and plain text fields. */
export function matchKeys(def: ResourceDef, custom: Record<string, FieldDef> = {}): { name: string; label: string }[] {
  const out = [{ name: 'id', label: 'ID' }];
  if (def.ref) out.push({ name: def.ref.field, label: def.fields[def.ref.field]?.label ?? 'Reference' });
  for (const [name, f] of [...Object.entries(def.fields), ...Object.entries(custom)]) {
    if (f.type === 'text' && !f.multiple && name !== def.ref?.field) out.push({ name, label: f.label });
  }
  return out;
}

/** Suggests a field for each column header, by label, field name or (for the reference) "ref". */
export function suggestMapping(headers: string[], fields: ImportField[], def: ResourceDef): Record<string, string> {
  const out: Record<string, string> = {};
  const taken = new Set<string>();
  const candidates = [...fields.map((f) => ({ name: f.name, keys: [f.label, f.name, f.name.replace(/^cf_/, ''), f.name.replace(/_id$/, '')] }))];
  if (def.ref) candidates.push({ name: def.ref.field, keys: [def.fields[def.ref.field]?.label ?? 'Reference', def.ref.field, 'ref', 'reference'] });
  candidates.push({ name: 'id', keys: ['id'] });
  for (const h of headers) {
    const k = squash(h);
    if (!k) continue;
    const hit = candidates.find((c) => !taken.has(c.name) && c.keys.some((key) => squash(key) === k));
    if (hit) { out[h] = hit.name; taken.add(hit.name); }
  }
  return out;
}

// ---------- values ----------

/** Accepts YYYY-MM-DD, YYYY/MM/DD, D Mon YYYY and month/day/year; returns YYYY-MM-DD or null. */
export function parseDate(v: string): string | null {
  const p = (n: string) => n.padStart(2, '0');
  const s = v.trim();
  let out: string | null = null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) out = `${m[1]}-${p(m[2])}-${p(m[3])}`;
  // Slashed dates are read month first unless the first number cannot be a month (14/3/2026).
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) out = Number(m[1]) > 12 ? `${m[3]}-${p(m[2])}-${p(m[1])}` : `${m[3]}-${p(m[1])}-${p(m[2])}`;
  m = /^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s-,]+(\d{4})$/.exec(s);
  if (m) {
    const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].slice(0, 3).toLowerCase());
    if (month >= 0) out = `${m[3]}-${p(String(month + 1))}-${p(m[1])}`;
  }
  if (!out) return null;
  const d = new Date(`${out}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === out ? out : null;
}

/** A date and time: an ISO instant, or a date and optional "HH:MM" read in the organization's time zone. */
export function parseDateTime(v: string): string | null {
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const m = /^(.*?)(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  const day = m && parseDate(m[1]);
  if (!day) return null;
  const [y, mo, d] = day.split('-').map(Number);
  return wallToInstant({ y, m: mo, d, h: Number(m![2] ?? 0), mi: Number(m![3] ?? 0), s: Number(m![4] ?? 0) }).toISOString();
}

function currencyMarkers(code: string): string[] {
  const out = new Set<string>([code.toUpperCase()]);
  for (const currencyDisplay of ['symbol', 'narrowSymbol'] as const) {
    try {
      const part = new Intl.NumberFormat('en', { style: 'currency', currency: code, currencyDisplay }).formatToParts(0).find((p) => p.type === 'currency')?.value;
      if (part) out.add(part.toUpperCase());
    } catch { /* unknown code */ }
  }
  return [...out].sort((a, b) => b.length - a.length);
}
const MARKERS = currencyMarkers(CURRENCY);

/** A number, optionally with thousands separators, a percent sign or the organization's currency. */
export function parseNumber(text: string, currency = false): number | null {
  let s = text.trim().toUpperCase();
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (currency) {
    for (const m of MARKERS) {
      if (s.startsWith(m)) { s = s.slice(m.length); break; }
      if (s.endsWith(m)) { s = s.slice(0, -m.length); break; }
    }
  }
  s = s.replace(/[,\s  %]/g, '');
  if (s.startsWith('-')) { negative = !negative; s = s.slice(1); }
  return /^\d+(\.\d+)?$|^\.\d+$/.test(s) ? (negative ? -1 : 1) * Number(s) : null;
}

const cellText = (v: CellValue): string => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));

interface Resolver { byKey: Map<string, string | null> }

/** Turns raw cells into field values, resolving lookups, people and records. */
export async function makeNormalizer(deps: ImportDeps, def: ResourceDef, user: SessionUser | null, valueMap: Record<string, Record<string, unknown>> = {}) {
  const custom = await deps.customDefs(def.type);
  const fields: Record<string, FieldDef> = { ...def.fields, ...custom };
  const lists = new Map<string, { value: string; label: string }[]>();
  let users: Resolver | null = null;
  const records = new Map<string, Resolver | null>();
  const add = (map: Map<string, string | null>, key: unknown, id: string) => {
    const k = norm(key);
    if (!k) return;
    // A name that two records share matches neither: the person must say which.
    if (map.has(k) && map.get(k) !== id) map.set(k, null); else map.set(k, id);
  };
  async function userResolver(): Promise<Resolver> {
    if (users) return users;
    const byKey = new Map<string, string | null>();
    const byName = new Map<string, string | null>();
    const rows = await deps.db.query<{ id: string; username: string; email: string | null; display_name: string }>(
      "select id, username, email, display_name from users where deleted_at is null and status = 'active'");
    for (const r of rows) { add(byKey, r.username, r.id); add(byKey, r.email, r.id); add(byName, r.display_name, r.id); }
    // A user name or email wins over a display name that reads the same.
    for (const [k, id] of byName) if (!byKey.has(k)) byKey.set(k, id);
    for (const r of rows) byKey.set(r.id.toLowerCase(), r.id);
    users = { byKey };
    return users;
  }
  async function recordResolver(type: string): Promise<Resolver | null> {
    if (records.has(type)) return records.get(type)!;
    const target = deps.registry.get(type);
    let out: Resolver | null = null;
    // Only records the person could find by hand: view permission on the type and the restricted-record rule.
    if (target && deps.mayAccess(user, target, 'view')) {
      const byKey = new Map<string, string | null>();
      const rows = await deps.db.query<{ id: string; t: string | null; r: string | null }>(
        `select id, ${target.titleField}::text as t, ${target.ref ? `${target.ref.field}::text` : 'null'} as r from ${target.table}
         where deleted_at is null and ${deps.visibilitySql(target, user)} limit 100000`);
      for (const r of rows) if (r.r) add(byKey, r.r, r.id);
      for (const r of rows) if (r.t && !(r.r && norm(r.r) === norm(r.t))) add(byKey, r.t, r.id);
      for (const r of rows) byKey.set(r.id.toLowerCase(), r.id);
      out = { byKey };
    }
    records.set(type, out);
    return out;
  }

  /** `unmatched` collects values of lookup, person and record columns that matched nothing. */
  async function normalize(raw: Record<string, CellValue>, unmatched: Map<string, Set<string>>): Promise<{ data: Row; errors: Record<string, string> }> {
    const data: Row = {};
    const errors: Record<string, string> = {};
    const miss = (name: string, value: string) => {
      const set = unmatched.get(name) ?? unmatched.set(name, new Set()).get(name)!;
      if (set.size < 100) set.add(value);
    };
    for (const [name, cell] of Object.entries(raw)) {
      const f = fields[name];
      if (!f || f.readOnly || f.type === 'json') continue;
      const text = cellText(cell).trim();
      if (text === '') continue;
      const mapped = valueMap[name]?.[norm(text)];
      switch (f.type) {
        case 'text': case 'longtext':
          data[name] = typeof cell === 'string' ? (f.type === 'longtext' ? cell : cell.trim()) : text;
          break;
        case 'number': case 'currency': {
          const n = typeof cell === 'number' ? cell : parseNumber(text, f.type === 'currency');
          if (n !== null) data[name] = n;
          else errors[name] = f.type === 'currency' ? `${f.label}: "${text}" is not an amount in ${CURRENCY}.` : `${f.label}: "${text}" is not a number.`;
          break;
        }
        case 'date': {
          const d = parseDate(text);
          if (d) data[name] = d; else errors[name] = `${f.label}: "${text}" is not a date (use YYYY-MM-DD).`;
          break;
        }
        case 'datetime': {
          const d = parseDateTime(text);
          if (d) data[name] = d; else errors[name] = `${f.label}: "${text}" is not a date and time.`;
          break;
        }
        case 'boolean':
          if (cell === true || /^(y|yes|true|1|x)$/i.test(text)) data[name] = true;
          else if (cell === false || /^(n|no|false|0)$/i.test(text)) data[name] = false;
          else errors[name] = `${f.label} must be yes or no.`;
          break;
        case 'lookup': {
          if (!lists.has(f.list!)) lists.set(f.list!, await deps.lookups.values(f.list!));
          const list = lists.get(f.list!)!;
          const pick = (s: string) => {
            const m = valueMap[name]?.[norm(s)];
            if (typeof m === 'string' && list.some((x) => x.value === m)) return m;
            return list.find((x) => norm(x.value) === norm(s))?.value ?? list.find((x) => norm(x.label) === norm(s))?.value;
          };
          if (f.multiple) {
            const parts = text.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
            const values = parts.map(pick);
            const bad = parts.filter((_, i) => !values[i]);
            if (bad.length) { errors[name] = `${f.label}: "${bad[0]}" is not an allowed value.`; bad.forEach((b) => miss(name, b)); } else data[name] = values;
          } else {
            const v = pick(text);
            if (v) data[name] = v; else { errors[name] = `${f.label}: "${text}" is not an allowed value.`; miss(name, text); }
          }
          break;
        }
        case 'user': {
          const r = await userResolver();
          const target = typeof mapped === 'string' && UUID_RE.test(mapped) ? mapped : undefined;
          const id = target ?? r.byKey.get(norm(text));
          if (id) data[name] = id;
          else { errors[name] = id === null ? `${f.label}: more than one person matches "${text}".` : `${f.label}: no person matches "${text}".`; miss(name, text); }
          break;
        }
        case 'ref': {
          const r = await recordResolver(f.to!);
          const target = typeof mapped === 'string' && UUID_RE.test(mapped) ? mapped : undefined;
          const id = target ?? r?.byKey.get(norm(text));
          if (id) data[name] = id;
          else {
            const label = deps.registry.get(f.to!)?.label.toLowerCase() ?? 'record';
            errors[name] = id === null ? `${f.label}: more than one ${label} matches "${text}".` : `${f.label}: no ${label} you can see matches "${text}".`;
            miss(name, text);
          }
          break;
        }
        default:
          break;
      }
    }
    return { data, errors };
  }
  return { normalize, fields };
}

// ---------- running an import ----------

export interface ImportRequest {
  table: ImportTable;
  /** Column header -> field name (or 'id' / the reference field, for matching only). */
  mapping: Record<string, string>;
  mode: ImportMode;
  /** Field used to find existing records and repeated rows. */
  matchKey?: string | null;
  dryRun: boolean;
  /** Per field: a file value (lower case) -> the stored value it stands for. */
  valueMap?: Record<string, Record<string, unknown>>;
}

export interface RowResult {
  line: number;
  action: 'create' | 'update' | 'skip' | 'error';
  errors: Record<string, string>;
  /** Why a row was skipped. */
  reason?: string;
  id?: string;
  label?: string;
  key?: string;
}

export interface ImportSummary {
  dryRun: boolean; mode: ImportMode; matchKey: string | null;
  total: number; created: number; updated: number; skipped: number; errors: number; duplicates: number;
  rows: RowResult[];
  unmatched: Record<string, string[]>;
}

export class MappingError extends Error {
  constructor(message: string, readonly fields: Record<string, string>) { super(message); }
}

/** Checks the mapping and returns [header index, field] pairs. */
export function checkMapping(def: ResourceDef, fields: ImportField[], headers: string[], mapping: Record<string, string>, mode: ImportMode, matchKey: string | null): [number, string][] {
  const errors: Record<string, string> = {};
  const usable = new Set([...fields.map((f) => f.name), 'id', ...(def.ref ? [def.ref.field] : [])]);
  const columns: [number, string][] = [];
  const seen = new Map<string, string>();
  for (const [header, field] of Object.entries(mapping ?? {})) {
    if (!field) continue;
    const at = headers.findIndex((h) => norm(h) === norm(header));
    if (at < 0) errors[field] = `The file has no column called "${header}".`;
    else if (!usable.has(field)) errors[field] = `"${field}" is not a field of ${def.plural.toLowerCase()} that can be imported.`;
    else if (seen.has(field)) errors[field] = `Both "${seen.get(field)}" and "${header}" are mapped to the same field.`;
    else { seen.set(field, header); columns.push([at, field]); }
  }
  if (mode !== 'create' && !matchKey) errors._match = 'Choose the field that identifies existing records.';
  if (matchKey && !seen.has(matchKey)) errors._match = 'Map a column to the field chosen to identify existing records.';
  if (mode !== 'update') {
    for (const f of fields) if (f.required && !seen.has(f.name) && !(f.filledBy && seen.has(f.filledBy))) errors[f.name] = `Map a column to ${f.label}; every new ${def.label.toLowerCase()} needs one.`;
  }
  if (!columns.some(([, f]) => f !== 'id' && f !== def.ref?.field)) errors._mapping = errors._mapping ?? 'Map at least one column to a field.';
  if (Object.keys(errors).length) throw new MappingError('Check the column mapping.', errors);
  return columns;
}

/** Existing records the person can see, by the lower-cased value of the match key. */
async function existingByKey(deps: ImportDeps, def: ResourceDef, key: string, user: SessionUser | null): Promise<Map<string, string>> {
  const custom = key.startsWith('cf_');
  const col = key === 'id' ? 'id::text' : custom ? `custom->>'${key.slice(3).replace(/[^a-z0-9_]/g, '')}'` : `${key}::text`;
  const rows = await deps.db.query<{ id: string; k: string | null }>(
    `select id, ${col} as k from ${def.table} where deleted_at is null and ${deps.visibilitySql(def, user)} and ${col} is not null`);
  const map = new Map<string, string>();
  for (const r of rows) if (r.k && !map.has(norm(r.k))) map.set(norm(r.k), r.id);
  return map;
}

const describe = (err: unknown): Record<string, string> => {
  const e = err as { fields?: Record<string, string>; message?: string };
  return e.fields && Object.keys(e.fields).length ? e.fields : { _row: e.message ?? 'Could not be saved.' };
};

/**
 * Runs an import. A real run writes each valid row through the resource engine. The check (dry run)
 * runs the very same writes inside `db.trial`, a transaction that is always rolled back: every row
 * goes through validation, the before- and after-hooks and the database's constraints, each in its
 * own savepoint so one refused row does not spoil the next, and later rows see earlier ones (a
 * repeated key) as they would for real. Nothing is kept, audited, emitted or queued. The request
 * must not hold a transaction of its own.
 */
export async function runImport(deps: ImportDeps, def: ResourceDef, req: FastifyRequest, input: ImportRequest): Promise<ImportSummary> {
  if (!input.dryRun) return importRows(deps, def, req, input, false);
  if (!deps.db.trial) throw new Error('This database handle cannot run an import check.');
  return deps.db.trial(() => importRows(deps, def, req, input, true));
}

async function importRows(deps: ImportDeps, def: ResourceDef, req: FastifyRequest, input: ImportRequest, trial: boolean): Promise<ImportSummary> {
  const user = req.user;
  const fields = await importableFields(deps, def);
  const matchKey = input.matchKey || null;
  const columns = checkMapping(def, fields, input.table.headers, input.mapping, input.mode, matchKey);
  const { normalize } = await makeNormalizer(deps, def, user, input.valueMap);
  const existing = matchKey ? await existingByKey(deps, def, matchKey, user) : new Map<string, string>();
  const seenKeys = new Map<string, number>();
  const unmatched = new Map<string, Set<string>>();
  const out: ImportSummary = {
    dryRun: input.dryRun, mode: input.mode, matchKey,
    total: input.table.rows.length, created: 0, updated: 0, skipped: 0, errors: 0, duplicates: 0, rows: [], unmatched: {},
  };

  for (const [i, cells] of input.table.rows.entries()) {
    const line = input.table.lines[i] ?? i + 2;
    const raw: Record<string, CellValue> = {};
    for (const [at, field] of columns) raw[field] = cells[at] ?? null;
    const keyText = matchKey ? cellText(raw[matchKey]).trim() : '';
    const { data, errors } = await normalize(raw, unmatched);
    const result: RowResult = { line, action: 'create', errors, ...(keyText ? { key: keyText } : {}) };

    // Duplicates: an earlier row of the same file, or an existing record with the same key.
    const k = norm(keyText);
    const earlier = k ? seenKeys.get(k) : undefined;
    const match = k ? existing.get(k) : undefined;
    if (k && earlier === undefined) seenKeys.set(k, line);
    if (matchKey && !k && input.mode !== 'create') errors[matchKey] = 'This row has no value in the column that identifies existing records.';

    if (earlier !== undefined) {
      result.action = 'skip';
      result.reason = `Repeats row ${earlier} (same ${matchKey === 'id' ? 'ID' : fieldLabel(def, fields, matchKey!)}).`;
      out.duplicates++;
    } else if (match && input.mode === 'create') {
      result.action = 'skip';
      result.reason = `Already exists (${keyText}).`;
      result.id = match;
      out.duplicates++;
    } else if (!match && input.mode === 'update' && k) {
      result.action = 'skip';
      result.reason = `No existing ${def.label.toLowerCase()} matches "${keyText}".`;
    } else if (Object.keys(errors).length) {
      result.action = 'error';
    } else {
      result.action = match ? 'update' : 'create';
      if (match) { result.id = match; out.duplicates++; }
    }

    if (result.action === 'create' || result.action === 'update') {
      const action = result.action;
      // The same path as a record made by hand: validation, hooks, constraints, audit.
      const write = () => (action === 'create'
        ? deps.registry.create(def.type, data, req)
        : deps.registry.update(def.type, result.id!, data, req));
      try {
        // In a trial each row is a savepoint (`tx` inside a trial), so a refused row leaves the
        // transaction usable for the next one.
        const saved = trial ? await deps.db.tx(write) : await write();
        // A later row with the same key now matches this record.
        if (k && action === 'create') existing.set(k, saved.id);
        // A check reports no reference or ID for a record it did not keep.
        if (!trial) {
          result.id = saved.id;
          result.label = [def.ref && saved[def.ref.field], saved[def.titleField]].filter(Boolean).join(' ');
        }
      } catch (err) {
        result.action = 'error';
        result.errors = describe(err);
      }
    }
    if (result.action === 'create') out.created++;
    else if (result.action === 'update') out.updated++;
    else if (result.action === 'skip') out.skipped++;
    else out.errors++;
    out.rows.push(result);
  }
  out.unmatched = Object.fromEntries([...unmatched].map(([f, s]) => [f, [...s]]));
  return out;
}

const fieldLabel = (def: ResourceDef, fields: ImportField[], name: string) =>
  (fields.find((f) => f.name === name)?.label ?? def.fields[name]?.label ?? name).toLowerCase();
