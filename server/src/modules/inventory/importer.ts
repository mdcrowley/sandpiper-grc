import type { FastifyRequest } from 'fastify';
import { CURRENCY } from '../../core/config.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { disposalProblem, funderRuleOn } from './lifecycle.ts';

/**
 * Asset import (CSV text + column mapping, with a dry run) and the generic JSON ingest
 * endpoint. Values are normalized here so a dry run can report every problem without
 * writing anything; a real run still goes through `ctx.resources.create/update`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ROWS = 5000;

/** RFC 4180-style parser: quoted cells, doubled quotes, commas and line breaks inside quotes. */
export function parseCsv(input: string, delimiter = ','): string[][] {
  const text = input.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delimiter) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

/** Accepts YYYY-MM-DD, YYYY/MM/DD and month/day/year; returns YYYY-MM-DD or null. */
export function parseDate(v: string): string | null {
  const p = (n: string) => n.padStart(2, '0');
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ].*)?$/.exec(v);
  let out: string | null = null;
  if (m) out = `${m[1]}-${p(m[2])}-${p(m[3])}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (m) out = `${m[3]}-${p(m[1])}-${p(m[2])}`;
  if (!out) return null;
  const d = new Date(`${out}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === out ? out : null;
}

/** The ways the organization's currency (GRC_CURRENCY) is written beside an amount: its code and symbols. */
function currencyMarkers(code: string): string[] {
  const out = new Set<string>([code.toUpperCase()]);
  for (const currencyDisplay of ['symbol', 'narrowSymbol'] as const) {
    try {
      const part = new Intl.NumberFormat('en', { style: 'currency', currency: code, currencyDisplay })
        .formatToParts(0).find((p) => p.type === 'currency')?.value;
      if (part) out.add(part.toUpperCase());
    } catch { /* unknown code: the code itself still works */ }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/**
 * An amount in the organization's currency: a number, optionally with that currency's code or
 * symbol and comma thousands separators ("1,200.50", "$1,200.50" when the currency is USD).
 * Another currency's symbol is not accepted. Returns null when the text is not such an amount.
 */
export function parseAmount(text: string, code: string = CURRENCY): number | null {
  let s = text.trim().toUpperCase();
  for (const m of currencyMarkers(code)) {
    if (s.startsWith(m)) { s = s.slice(m.length); break; }
    if (s.endsWith(m)) { s = s.slice(0, -m.length); break; }
  }
  s = s.replace(/[,\s  ]/g, '');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

interface Normalizer { normalize(raw: Row): Promise<{ data: Row; errors: Record<string, string> }> }

/** Builds a normalizer for asset input with lookups, sites, systems and users loaded once. */
async function assetNormalizer(ctx: ModuleContext): Promise<Normalizer> {
  const def = ctx.resources.get('asset')!;
  const lists = new Map<string, { value: string; label: string }[]>();
  for (const f of Object.values(def.fields)) {
    if (f.type === 'lookup' && !lists.has(f.list!)) lists.set(f.list!, await ctx.lookups.values(f.list!));
  }
  const key = (s: unknown) => String(s ?? '').trim().toLowerCase();
  const byName = async (sql: string) => {
    const map = new Map<string, string>();
    for (const r of await ctx.db.query<{ id: string; k: string | null }>(sql)) if (r.k && !map.has(key(r.k))) map.set(key(r.k), r.id);
    return map;
  };
  const names: Record<string, Map<string, string>> = {
    site: await byName('select id, name as k from sites where deleted_at is null'),
    system: await byName(
      `select id, name as k from systems where deleted_at is null union all select id, ref as k from systems where deleted_at is null`,
    ),
  };
  const funderRule = await funderRuleOn(ctx);
  const users = await byName(
    `select id, username as k from users where deleted_at is null union all
     select id, email as k from users where deleted_at is null union all
     select id, display_name as k from users where deleted_at is null`,
  );

  return {
    async normalize(raw) {
      const data: Row = {};
      const errors: Record<string, string> = {};
      for (const [name, f] of Object.entries(def.fields)) {
        if (f.readOnly) continue;
        let v = raw[name];
        if (v === undefined || v === null) continue;
        if (typeof v === 'string') v = v.trim();
        if (v === '') continue;
        const s = String(v);
        switch (f.type) {
          case 'number': {
            const n = typeof v === 'number' ? v : Number(s.replace(/[,%\s]/g, ''));
            if (Number.isFinite(n)) data[name] = n; else errors[name] = `${f.label} must be a number.`;
            break;
          }
          case 'currency': {
            const n = typeof v === 'number' ? v : parseAmount(s);
            if (n !== null) data[name] = n; else errors[name] = `${f.label} must be an amount in ${CURRENCY}.`;
            break;
          }
          case 'date': {
            const d = parseDate(s);
            if (d) data[name] = d; else errors[name] = `${f.label}: "${s}" is not a date (use YYYY-MM-DD or month/day/year).`;
            break;
          }
          case 'boolean': {
            if (typeof v === 'boolean') data[name] = v;
            else if (/^(y|yes|true|1)$/i.test(s)) data[name] = true;
            else if (/^(n|no|false|0)$/i.test(s)) data[name] = false;
            else errors[name] = `${f.label} must be yes or no.`;
            break;
          }
          case 'lookup': {
            const hit = lists.get(f.list!)!.find((x) => key(x.value) === key(s) || key(x.label) === key(s));
            if (hit) data[name] = hit.value; else errors[name] = `${f.label}: "${s}" is not an allowed value.`;
            break;
          }
          case 'user': {
            const id = UUID.test(s) ? s : users.get(key(s));
            if (id) data[name] = id; else errors[name] = `${f.label}: no user matches "${s}".`;
            break;
          }
          case 'ref': {
            const id = UUID.test(s) ? s : names[f.to!]?.get(key(s));
            if (id) data[name] = id; else errors[name] = `${f.label}: nothing matches "${s}".`;
            break;
          }
          default:
            data[name] = s;
        }
      }
      if (!data.name) errors.name = 'Name is required.';
      const pct = data.funder_interest_pct;
      if (pct !== undefined && (pct < 0 || pct > 100)) errors.funder_interest_pct = 'Enter a percentage between 0 and 100.';
      if (data.status === 'disposed') {
        const problem = disposalProblem(data, false, funderRule);
        if (problem) Object.assign(errors, problem.fields ?? { status: problem.message });
      }
      return { data, errors };
    },
  };
}

interface Existing { id: string; tag: string | null; serial: string | null }

async function existingIndex(ctx: ModuleContext) {
  const rows = await ctx.db.query<Existing>('select id, tag, serial from assets where deleted_at is null');
  const byTag = new Map<string, string>();
  const bySerial = new Map<string, string>();
  for (const r of rows) {
    if (r.tag) byTag.set(r.tag.toLowerCase(), r.id);
    if (r.serial) bySerial.set(r.serial.toLowerCase(), r.id);
  }
  return { byTag, bySerial };
}

function describeError(err: unknown): Record<string, string> {
  const e = err as { fields?: Record<string, string>; message?: string };
  return e.fields && Object.keys(e.fields).length ? e.fields : { _row: e.message ?? 'Could not be saved.' };
}

export function registerImport(ctx: ModuleContext) {
  const { app } = ctx;

  /**
   * Body: { csv, mapping: { <asset field>: <CSV column header> }, dryRun (default true),
   * delimiter (default ","), onDuplicate: 'skip' (default) | 'update' }.
   * Rows with errors are never written. A duplicate is a row whose tag or serial matches
   * an existing asset or an earlier row in the same file.
   */
  app.post('/api/assets/import', { preHandler: ctx.requirePerm('assets.create') }, async (req: FastifyRequest) => {
    const body = (req.body ?? {}) as Row;
    const dryRun = body.dryRun !== false;
    const onDuplicate = body.onDuplicate === 'update' ? 'update' : 'skip';
    if (typeof body.csv !== 'string' || !body.csv.trim()) ctx.fail(400, 'validation', 'Paste or upload a CSV file first.', { csv: 'The CSV text is empty.' });
    if (onDuplicate === 'update' && !ctx.can(req.user, 'assets.edit')) ctx.fail(403, 'forbidden', 'You do not have permission to update existing assets.');
    const delimiter = typeof body.delimiter === 'string' && body.delimiter.length === 1 ? body.delimiter : ',';
    const [header, ...lines] = parseCsv(body.csv, delimiter);
    const headers = (header ?? []).map((h) => h.trim());
    if (!lines.length) ctx.fail(400, 'validation', 'The file has a header row but no data rows.', { csv: 'No data rows found.' });
    if (lines.length > MAX_ROWS) ctx.fail(400, 'validation', `Import at most ${MAX_ROWS} rows at a time.`, { csv: `The file has ${lines.length} rows.` });

    const def = ctx.resources.get('asset')!;
    const mapping = (body.mapping && typeof body.mapping === 'object' ? body.mapping : {}) as Record<string, string>;
    const mapErrors: Record<string, string> = {};
    const columns: [string, number][] = [];
    for (const [field, column] of Object.entries(mapping)) {
      if (!column) continue;
      const at = headers.findIndex((h) => h.toLowerCase() === String(column).trim().toLowerCase());
      if (!def.fields[field] || def.fields[field].readOnly) mapErrors[field] = `"${field}" is not an asset field that can be imported.`;
      else if (at < 0) mapErrors[field] = `The file has no column called "${column}".`;
      else columns.push([field, at]);
    }
    if (!columns.some(([f]) => f === 'name') && !mapErrors.name) mapErrors.name = 'Map a column to Name; every asset needs one.';
    if (Object.keys(mapErrors).length) ctx.fail(400, 'mapping', 'Check the column mapping.', mapErrors);

    const normalizer = await assetNormalizer(ctx);
    const existing = await existingIndex(ctx);
    const seenTag = new Map<string, number>();
    const seenSerial = new Map<string, number>();
    const rows: Row[] = [];
    const summary = { total: lines.length, valid: 0, errors: 0, duplicates: 0, created: 0, updated: 0, skipped: 0 };

    for (const [i, cells] of lines.entries()) {
      const line = i + 2; // line 1 is the header
      const raw: Row = {};
      for (const [field, at] of columns) raw[field] = cells[at] ?? '';
      const { data, errors } = await normalizer.normalize(raw);
      const tag = data.tag ? String(data.tag).toLowerCase() : null;
      const serial = data.serial ? String(data.serial).toLowerCase() : null;

      let duplicate: Row | null = null;
      if (tag && seenTag.has(tag)) duplicate = { by: 'tag', of: 'file', line: seenTag.get(tag), value: data.tag };
      else if (serial && seenSerial.has(serial)) duplicate = { by: 'serial', of: 'file', line: seenSerial.get(serial), value: data.serial };
      else if (tag && existing.byTag.has(tag)) duplicate = { by: 'tag', of: 'existing', id: existing.byTag.get(tag), value: data.tag };
      else if (serial && existing.bySerial.has(serial)) duplicate = { by: 'serial', of: 'existing', id: existing.bySerial.get(serial), value: data.serial };
      if (tag && !seenTag.has(tag)) seenTag.set(tag, line);
      if (serial && !seenSerial.has(serial)) seenSerial.set(serial, line);

      const hasErrors = Object.keys(errors).length > 0;
      let action: 'create' | 'update' | 'skip' | 'error' = hasErrors ? 'error'
        : !duplicate ? 'create'
        : duplicate.of === 'existing' && onDuplicate === 'update' ? 'update' : 'skip';
      const out: Row = { line, data, errors, duplicate, action };

      if (!dryRun && (action === 'create' || action === 'update')) {
        try {
          const saved = action === 'create'
            ? await ctx.resources.create('asset', data, req)
            : await ctx.resources.update('asset', duplicate!.id, data, req);
          out.id = saved.id;
          out.tag = saved.tag;
        } catch (err) {
          out.errors = describeError(err);
          action = out.action = 'error';
        }
      }
      if (action === 'error') summary.errors++;
      else {
        summary.valid++;
        if (action === 'create') summary.created++;
        if (action === 'update') summary.updated++;
        if (action === 'skip') summary.skipped++;
      }
      if (duplicate) summary.duplicates++;
      rows.push(out);
    }

    if (dryRun) {
      // Nothing was written: report what a real run would do.
      return { dryRun, ...summary, wouldCreate: summary.created, wouldUpdate: summary.updated, created: 0, updated: 0, rows };
    }
    await ctx.audit(req, {
      action: 'asset.import', recordType: 'asset',
      summary: `Asset import: ${summary.created} created, ${summary.updated} updated, ${summary.skipped} duplicates skipped, ${summary.errors} with errors (of ${summary.total} rows)`,
      after: { ...summary, onDuplicate, mapping },
    });
    return { dryRun, ...summary, rows };
  });

  /**
   * Generic inventory push. Body: an array of asset objects, or { assets: [...] }. Each is
   * matched to an existing asset by serial number, then by tag, and created when neither
   * matches. Lookup values may be given by value or label; site and system by name.
   */
  app.post('/api/assets/ingest', { preHandler: ctx.requirePerm('assets.create') }, async (req: FastifyRequest) => {
    if (!ctx.can(req.user, 'assets.edit')) ctx.fail(403, 'forbidden', 'You do not have permission to do that.');
    const body = req.body as unknown;
    const items = Array.isArray(body) ? body : (body as Row | null)?.assets;
    if (!Array.isArray(items)) ctx.fail(400, 'validation', 'Send an array of assets, or an object with an "assets" array.');
    if (items.length > MAX_ROWS) ctx.fail(400, 'validation', `Send at most ${MAX_ROWS} assets at a time.`);

    const normalizer = await assetNormalizer(ctx);
    const existing = await existingIndex(ctx);
    const result = { received: items.length, created: 0, updated: 0, unchanged: 0, errors: [] as Row[] };
    for (const [index, item] of items.entries()) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        result.errors.push({ index, errors: { _row: 'Each asset must be an object.' } });
        continue;
      }
      const { data, errors } = await normalizer.normalize(item as Row);
      const serial = data.serial ? String(data.serial).toLowerCase() : null;
      const tag = data.tag ? String(data.tag).toLowerCase() : null;
      const id = (serial && existing.bySerial.get(serial)) || (tag && existing.byTag.get(tag)) || null;
      if (id) delete errors.name; // an update need not repeat the name
      if (Object.keys(errors).length) {
        result.errors.push({ index, serial: data.serial ?? null, tag: data.tag ?? null, errors });
        continue;
      }
      try {
        if (id) {
          const before = await ctx.resources.find('asset', id, req.user);
          // Matching ignores letter case; do not rewrite the stored serial or tag over a case difference.
          for (const k of ['serial', 'tag']) {
            if (before && data[k] && String(before[k] ?? '').toLowerCase() === String(data[k]).toLowerCase()) delete data[k];
          }
          const after = await ctx.resources.update('asset', id, data, req);
          const stamp = (r: Row | undefined) => new Date(r?.updated_at).getTime();
          if (stamp(before) === stamp(after)) result.unchanged++; else result.updated++;
        } else {
          const made = await ctx.resources.create('asset', data, req);
          if (made.serial) existing.bySerial.set(String(made.serial).toLowerCase(), made.id);
          if (made.tag) existing.byTag.set(String(made.tag).toLowerCase(), made.id);
          result.created++;
        }
      } catch (err) {
        result.errors.push({ index, serial: data.serial ?? null, tag: data.tag ?? null, errors: describeError(err) });
      }
    }
    const { errors, ...counts } = result;
    await ctx.audit(req, {
      action: 'asset.ingest', recordType: 'asset',
      summary: `Asset ingest: ${counts.created} created, ${counts.updated} updated, ${counts.unchanged} unchanged, ${errors.length} rejected (of ${counts.received})`,
      after: { ...counts, rejected: errors.length },
    });
    return result;
  });
}
