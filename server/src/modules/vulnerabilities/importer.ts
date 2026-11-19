import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { CsvError, detectDelimiter, normaliseSeverity, parseBoolean, parseCsv, parseDate, pickCves, severityFromCvss } from './csv.ts';
import { UUID_RE } from '../../core/errors.ts';
import { notifyImportAssigned } from './notify.ts';
import { secured, today } from './policy.ts';
import { findingKey, HostIndex, importRequests, portKey, samePort } from './rules.ts';
import { takeSnapshot } from './summary.ts';

/**
 * Findings import: CSV text plus a column mapping, with a dry run. The plan (what each row
 * would do) is worked out the same way for a dry run and a real run; only a real run
 * writes, through `ctx.resources.create/update`, so every rule and audit event applies.
 */

export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 10000;
const MAX_ROWS_RETURNED = 300;

/** What a file column can be mapped to. */
export const IMPORT_FIELDS: { key: string; label: string }[] = [
  { key: 'host_name', label: 'Host name' },
  { key: 'host_ip', label: 'IP address' },
  { key: 'port', label: 'Port' },
  { key: 'protocol', label: 'Protocol' },
  { key: 'service', label: 'Service' },
  { key: 'plugin_id', label: 'Finding ID' },
  { key: 'title', label: 'Title' },
  { key: 'severity', label: 'Severity' },
  { key: 'cvss', label: 'CVSS score' },
  { key: 'cves', label: 'CVE' },
  { key: 'known_exploited', label: 'Known exploited' },
  { key: 'first_seen', label: 'First seen' },
  { key: 'last_seen', label: 'Last seen' },
  { key: 'description', label: 'Description' },
  { key: 'solution', label: 'Solution' },
];
const FIELD_KEYS = new Set(IMPORT_FIELDS.map((f) => f.key));

type Action = 'create' | 'update' | 'unchanged' | 'reopen' | 'duplicate' | 'error';
interface PlanRow {
  line: number; action: Action; data: Row; errors: Record<string, string>;
  existingId?: string; patch?: Row; changes?: string[]; duplicateOf?: number;
  id?: string; ref?: string;
}

function cleanMapping(ctx: ModuleContext, input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [field, column] of Object.entries(input as Row)) {
    if (typeof column !== 'string' || !column.trim()) continue;
    if (!FIELD_KEYS.has(field)) ctx.fail(400, 'mapping', 'Check the column mapping.', { [field]: `"${field}" is not a field that can be imported.` });
    out[field] = column.trim();
  }
  return out;
}

function describeError(err: unknown): Record<string, string> {
  const e = err as { fields?: Record<string, string>; message?: string };
  return e.fields && Object.keys(e.fields).length ? e.fields : { _row: e.message ?? 'Could not be saved.' };
}

/** Looks hosts up in the asset register (when the inventory module is loaded). */
async function assetMatcher(ctx: ModuleContext) {
  if (!ctx.resources.get('asset')) return null;
  const rows = await ctx.db.query<Row>('select id, name, tag, serial, ip_address, system_id from assets where deleted_at is null');
  const byName = new Map<string, Row>();
  const byIp = new Map<string, Row>();
  const key = (v: unknown) => String(v ?? '').trim().toLowerCase();
  for (const r of rows) {
    for (const k of [r.name, r.tag, r.serial]) if (key(k) && !byName.has(key(k))) byName.set(key(k), r);
    if (key(r.ip_address) && !byIp.has(key(r.ip_address))) byIp.set(key(r.ip_address), r);
  }
  return (hostName: unknown, hostIp: unknown): Row | undefined => {
    const name = key(hostName);
    return (name && (byName.get(name) ?? byName.get(name.split('.')[0]))) || (key(hostIp) && byIp.get(key(hostIp))) || undefined;
  };
}

export function registerImport(ctx: ModuleContext) {
  const { app, db } = ctx;
  const view = secured(ctx, 'vulnerabilities.view');
  const create = secured(ctx, 'vulnerabilities.create');

  /**
   * Body: { csv, mapping: { <field>: <column header> }, source, fileName?, presetName?,
   * delimiter? (detected when left out), dayFirst? (default true), dryRun (default true),
   * closeMissing (default false), ownerId? (owner given to findings this import adds) }.
   *
   * A finding is the same finding when host, port (with protocol) and finding identifier
   * match. Host name and address are reconciled first (see HostIndex), so a host reported
   * by address in one file and by name in the next is one host.
   */
  app.post('/api/vulnerabilities/import', { preHandler: create }, async (req: FastifyRequest) => {
    if (!ctx.can(req.user, 'vulnerabilities.edit')) ctx.fail(403, 'forbidden', 'You do not have permission to update existing findings.');
    const body = (req.body ?? {}) as Row;
    const dryRun = body.dryRun !== false;
    const closeMissing = body.closeMissing === true;
    const dayFirst = body.dayFirst !== false;
    const source = String(body.source ?? '').trim().slice(0, 120);
    if (typeof body.csv !== 'string' || !body.csv.trim()) ctx.fail(400, 'validation', 'Choose or paste a CSV file first.', { csv: 'The file is empty.' });
    if (Buffer.byteLength(body.csv, 'utf8') > MAX_BYTES) {
      ctx.fail(413, 'too_large', `The file is larger than ${MAX_BYTES / 1024 / 1024} MB. Split it into smaller files and import them one after another.`, { csv: 'The file is too large.' });
    }
    if (!source) ctx.fail(400, 'validation', 'Name the source of these findings, for example the scanner or assessment they came from.', { source: 'Source is required.' });
    const ownerId = body.ownerId === undefined || body.ownerId === null || body.ownerId === '' ? null : String(body.ownerId);
    if (ownerId !== null) {
      const known = UUID_RE.test(ownerId)
        ? await db.one(`select 1 from users where id = $1 and status = 'active' and deleted_at is null`, [ownerId])
        : undefined;
      if (!known) ctx.fail(400, 'validation', 'Choose an active user as the owner for new findings.', { ownerId: 'That user was not found.' });
    }

    const delimiter = typeof body.delimiter === 'string' && body.delimiter.length === 1 ? body.delimiter : detectDelimiter(body.csv);
    let parsed: { line: number; cells: string[] }[] = [];
    try {
      parsed = parseCsv(body.csv, delimiter);
    } catch (err) {
      if (err instanceof CsvError) ctx.fail(400, 'malformed', err.message, { csv: err.message });
      throw err;
    }
    const [header, ...lines] = parsed;
    const headers = (header?.cells ?? []).map((h) => h.trim());
    if (!headers.some(Boolean)) ctx.fail(400, 'malformed', 'The file has no header row. The first line must hold the column names.', { csv: 'No header row found.' });
    const lower = headers.map((h) => h.toLowerCase());
    const repeated = [...new Set(lower.filter((h, i) => h && lower.indexOf(h) !== i))];
    if (repeated.length) ctx.fail(400, 'malformed', `The header row repeats a column name (${repeated.join(', ')}). Rename or remove the extra columns.`, { csv: 'Column names must be unique.' });
    if (!lines.length) ctx.fail(400, 'malformed', 'The file has a header row but no findings below it.', { csv: 'No data rows found.' });
    if (lines.length > MAX_ROWS) ctx.fail(400, 'too_large', `Import at most ${MAX_ROWS} rows at a time. This file has ${lines.length}.`, { csv: 'Too many rows.' });

    const mapping = cleanMapping(ctx, body.mapping);
    const mapErrors: Record<string, string> = {};
    const columns: [string, number][] = [];
    for (const [field, column] of Object.entries(mapping)) {
      const at = lower.indexOf(column.toLowerCase());
      if (at < 0) mapErrors[field] = `The file has no column called "${column}".`;
      else columns.push([field, at]);
    }
    const mapped = (f: string) => columns.some(([k]) => k === f);
    if (!mapped('host_name') && !mapped('host_ip')) mapErrors.host_name = mapErrors.host_name ?? 'Map a column to Host name or IP address.';
    if (!mapped('plugin_id') && !mapped('cves') && !mapped('title')) mapErrors.plugin_id = mapErrors.plugin_id ?? 'Map a column to Finding ID, CVE or Title so findings can be told apart.';
    if (!mapped('severity') && !mapped('cvss')) mapErrors.severity = mapErrors.severity ?? 'Map a column to Severity or CVSS score.';
    if (Object.keys(mapErrors).length) ctx.fail(400, 'mapping', 'Check the column mapping.', mapErrors);

    const severities = (await ctx.lookups.values('vulnerability_severity')).map((s) => ({ value: s.value, label: s.label }));
    const statuses = await ctx.lookups.values('vulnerability_status');
    const fixedStatus = statuses.find((s) => (s.meta as Row | undefined)?.fixed === true)?.value ?? 'fixed';
    const fixedValues = new Set(statuses.filter((s) => (s.meta as Row | undefined)?.fixed === true).map((s) => s.value));
    const openStatus = statuses.find((s) => (s.meta as Row | undefined)?.closed !== true)?.value ?? 'open';
    const now = today();

    // Oldest first, so the host most recently seen at an address is the one the address names.
    const recorded = await db.query<Row>(
      `select id, ref, host_key, finding_key, port_key, title, description, host_name, host_ip, port, protocol, service, plugin_id, cves, severity, cvss,
              known_exploited, first_seen, last_seen, status, closed, solution, source, import_batch_id, asset_id, system_id
       from vulnerabilities where deleted_at is null and ${ctx.resources.visibleWhere('vulnerability', req.user)}
       order by last_seen asc nulls first, created_at asc`,
    );
    const hosts = new HostIndex();
    const byHostAndFinding = new Map<string, Row[]>();
    for (const r of recorded) {
      hosts.learn(r.host_name, r.host_ip, r.host_key);
      const group = `${r.host_key}|${r.finding_key}`;
      byHostAndFinding.set(group, [...(byHostAndFinding.get(group) ?? []), r]);
    }
    /** The recorded finding with this host, finding identifier and port: an open one first, then the oldest. */
    const findRecorded = (group: string, port: string): Row | undefined => {
      const list = byHostAndFinding.get(group) ?? [];
      const exact = list.filter((r) => r.port_key === port);
      const candidates = exact.length ? exact : list.filter((r) => samePort(r.port_key, port));
      return candidates.find((r) => !r.closed) ?? candidates[0];
    };
    const matchAsset = await assetMatcher(ctx);
    const unmatched = new Set<string>();

    // ---------- plan ----------
    const plan: PlanRow[] = [];
    const seen = new Map<string, { port: string; line: number }[]>();
    const claimed = new Map<string, number>();
    const inFile = new Set<string>();
    for (const { line, cells } of lines) {
      const raw: Record<string, string> = {};
      for (const [field, at] of columns) raw[field] = (cells[at] ?? '').trim();
      const errors: Record<string, string> = {};
      const data: Row = {};
      if (cells.length > headers.length && cells.slice(headers.length).some((c) => c.trim() !== '')) {
        errors._row = `This line has ${cells.length} cells but the header has ${headers.length}. A value probably contains an unquoted "${delimiter === '\t' ? 'tab' : delimiter}".`;
      }
      for (const f of ['host_name', 'host_ip', 'port', 'protocol', 'service', 'plugin_id', 'title', 'description', 'solution']) if (raw[f]) data[f] = raw[f];
      if (raw.cves) { const c = pickCves(raw.cves); if (c) data.cves = c; }
      if (!data.host_name && !data.host_ip) errors.host_name = 'No host name or IP address.';
      if (raw.cvss) {
        const n = Number(raw.cvss.replace(',', '.'));
        if (Number.isFinite(n) && n >= 0 && n <= 10) data.cvss = n; else errors.cvss = `CVSS score: "${raw.cvss}" is not a number between 0 and 10.`;
      }
      if (raw.severity) {
        const s = normaliseSeverity(raw.severity, severities);
        if (s) data.severity = s; else errors.severity = `Severity: "${raw.severity}" is not understood.`;
      } else if (data.cvss !== undefined && severities.some((s) => s.value === severityFromCvss(data.cvss))) {
        data.severity = severityFromCvss(data.cvss);
      } else if (!errors.cvss) errors.severity = 'No severity or CVSS score.';
      for (const f of ['first_seen', 'last_seen']) {
        if (!raw[f]) continue;
        const d = parseDate(raw[f], dayFirst);
        if (!d) errors[f] = `${f === 'first_seen' ? 'First seen' : 'Last seen'}: "${raw[f]}" is not a date.`;
        else if (d > now) errors[f] = `${f === 'first_seen' ? 'First seen' : 'Last seen'}: ${d} is in the future.`;
        else data[f] = d;
      }
      if (raw.known_exploited) {
        const b = parseBoolean(raw.known_exploited);
        if (b === null) errors.known_exploited = `Known exploited: "${raw.known_exploited}" is not yes or no.`; else data.known_exploited = b;
      }
      if (!data.title) data.title = data.plugin_id ? `Finding ${data.plugin_id}` : data.cves ?? '';
      if (!data.title) errors.title = 'No finding ID, CVE or title.';

      const row: PlanRow = { line, action: 'error', data, errors };
      plan.push(row);
      // The duplicate key. A row with an error is still looked up, so its finding is not taken as missing from the file.
      const computable = !errors.host_name && !errors.title;
      const group = computable ? `${hosts.resolve(data.host_name, data.host_ip)}|${findingKey(data)}` : '';
      const port = portKey(data.port, data.protocol);
      const was = computable ? findRecorded(group, port) : undefined;
      if (was) inFile.add(was.id);
      if (Object.keys(errors).length) continue;
      const earlier = seen.get(group)?.find((s) => samePort(s.port, port))?.line ?? (was ? claimed.get(was.id) : undefined);
      if (earlier !== undefined) { row.action = 'duplicate'; row.duplicateOf = earlier; continue; }
      seen.set(group, [...(seen.get(group) ?? []), { port, line }]);
      if (was) claimed.set(was.id, line);

      const asset = matchAsset?.(data.host_name, data.host_ip);
      if (matchAsset && !asset) unmatched.add(String(data.host_name ?? data.host_ip));
      if (!was) {
        row.action = 'create';
        data.first_seen = data.first_seen ?? data.last_seen ?? now;
        data.last_seen = data.last_seen ?? now;
        if (data.last_seen < data.first_seen) data.last_seen = data.first_seen;
        data.source = source;
        if (ownerId) data.owner_id = ownerId;
        if (asset) { data.asset_id = asset.id; if (asset.system_id && ctx.resources.get('system')) data.system_id = asset.system_id; }
        continue;
      }
      const patch: Row = {};
      const changes: string[] = [];
      const lastSeen = data.last_seen ?? now;
      if (!was.last_seen || lastSeen > was.last_seen) { patch.last_seen = lastSeen; changes.push('Last seen'); }
      if (data.first_seen && data.first_seen < was.first_seen) { patch.first_seen = data.first_seen; changes.push('First seen'); }
      if (data.severity !== was.severity) { patch.severity = data.severity; changes.push(`Severity ${was.severity} to ${data.severity}`); }
      if (data.cvss !== undefined && data.cvss !== was.cvss) { patch.cvss = data.cvss; changes.push('CVSS score'); }
      if (data.known_exploited !== undefined && data.known_exploited !== was.known_exploited) { patch.known_exploited = data.known_exploited; changes.push('Known exploited'); }
      for (const [f, label] of [['title', 'Title'], ['description', 'Description'], ['solution', 'Solution'], ['port', 'Port'], ['protocol', 'Protocol'], ['service', 'Service'], ['cves', 'CVE'], ['host_ip', 'IP address'], ['host_name', 'Host name']]) {
        // Host names match whatever their letter case; do not rewrite the stored one over a case difference.
        // A port written without its protocol ("443" for a recorded "443/tcp") is the same port, not a change.
        const same = f === 'host_name' ? String(data[f] ?? '').toLowerCase() === String(was[f] ?? '').toLowerCase()
          : f === 'port' ? data[f] === (was[f] ?? undefined) || port === was.port_key || (samePort(port, was.port_key) && !port.includes('/'))
          : data[f] === (was[f] ?? undefined);
        if (raw[f] && data[f] !== undefined && !same) { patch[f] = data[f]; changes.push(label); }
      }
      if (asset && !was.asset_id) { patch.asset_id = asset.id; changes.push('Asset'); }
      const reopen = was.closed && fixedValues.has(was.status);
      if (reopen) { patch.status = openStatus; changes.unshift('Reopened: seen again after being marked fixed'); }
      row.existingId = was.id;
      row.ref = was.ref;
      row.id = was.id;
      row.patch = patch;
      row.changes = changes;
      row.action = reopen ? 'reopen' : Object.keys(patch).length ? 'update' : 'unchanged';
    }

    // Findings from an earlier import of this source that this file no longer reports.
    const missing = recorded
      .filter((f) => !f.closed && f.import_batch_id && String(f.source ?? '').toLowerCase() === source.toLowerCase() && !inFile.has(f.id));

    const count = (a: Action) => plan.filter((r) => r.action === a).length;
    const result = {
      dryRun, source, closeMissing, delimiter, total: plan.length,
      created: count('create'), updated: count('update'), unchanged: count('unchanged'), reopened: count('reopen'),
      duplicates: count('duplicate'), errors: count('error'),
      missing: missing.length, closed: closeMissing ? missing.length : 0,
      unmatchedHosts: [...unmatched].sort().slice(0, 200),
      /** New findings given to the chosen owner. */
      assigned: ownerId ? count('create') : 0,
      batchId: null as string | null,
    };

    // ---------- apply ----------
    if (!dryRun) {
      const batch = (await db.one<{ id: string }>(
        `insert into vulnerability_import_batches (source, file_name, preset_name, close_missing, mapping, imported_by, imported_by_name)
         values ($1,$2,$3,$4,$5::jsonb,$6,$7) returning id`,
        [source, String(body.fileName ?? '').trim().slice(0, 200) || null, String(body.presetName ?? '').trim().slice(0, 80) || null,
          closeMissing, JSON.stringify(mapping), req.user!.id, req.user!.displayName],
      ))!;
      result.batchId = batch.id;
      const touched: string[] = [];
      const given: Row[] = [];
      // The owner is told once at the end, not once per finding.
      importRequests.add(req);
      for (const row of plan) {
        try {
          if (row.action === 'create') {
            const saved = await ctx.resources.create('vulnerability', row.data, req);
            row.id = saved.id;
            row.ref = saved.ref;
            touched.push(saved.id);
            if (saved.owner_id) given.push(saved);
          } else if (row.action === 'update' || row.action === 'reopen') {
            await ctx.resources.update('vulnerability', row.existingId!, row.patch!, req);
            touched.push(row.existingId!);
          } else if (row.action === 'unchanged') touched.push(row.existingId!);
        } catch (err) {
          result[row.action === 'create' ? 'created' : row.action === 'reopen' ? 'reopened' : 'updated']--;
          result.errors++;
          row.errors = describeError(err);
          row.action = 'error';
        }
      }
      if (touched.length) await db.query('update vulnerabilities set import_batch_id = $1 where id = any($2::uuid[])', [batch.id, touched]);
      let closed = 0;
      if (closeMissing) {
        for (const f of missing) {
          try {
            await ctx.resources.update('vulnerability', f.id, { status: fixedStatus, fixed_on: now }, req);
            closed++;
          } catch { /* left open; the count below says how many were closed */ }
        }
      }
      result.closed = closed;
      result.assigned = given.length;
      if (ownerId) await notifyImportAssigned(ctx, { ownerId, actorId: req.user!.id, findings: given, source, batchId: batch.id });
      await db.query(
        `update vulnerability_import_batches set total_rows = $2, created_count = $3, updated_count = $4, unchanged_count = $5,
           reopened_count = $6, closed_count = $7, duplicate_count = $8, error_count = $9, unmatched_hosts = $10::jsonb where id = $1`,
        [batch.id, result.total, result.created, result.updated, result.unchanged, result.reopened, result.closed, result.duplicates,
          result.errors, JSON.stringify(result.unmatchedHosts)],
      );
      await takeSnapshot(ctx);
      await ctx.audit(req, {
        action: 'vulnerability.import', recordType: 'vulnerability',
        // The import each reported finding was last reported by before this one (null for new findings).
        before: { reportedBy: Object.fromEntries(touched.map((id) => [id, recorded.find((r) => r.id === id)?.import_batch_id ?? null])) },
        summary: `Findings import from ${source}: ${result.created} new, ${result.updated} updated, ${result.reopened} reopened, ${result.closed} closed as fixed, ${result.errors} with errors (of ${result.total} rows)`,
        after: { batchId: batch.id, fileName: body.fileName ?? null, source, closeMissing, mapping, total: result.total, created: result.created,
          updated: result.updated, unchanged: result.unchanged, reopened: result.reopened, closed: result.closed, duplicates: result.duplicates, errors: result.errors,
          // Every finding this import reported, whose "last reported by" moved to this import (written in one statement above).
          reportedIds: touched },
      });
    }

    // Problems first, then the rest, so a long file still shows what needs attention.
    const order: Action[] = ['error', 'duplicate', 'reopen', 'create', 'update', 'unchanged'];
    const rows = [...plan].sort((a, b) => order.indexOf(a.action) - order.indexOf(b.action) || a.line - b.line).slice(0, MAX_ROWS_RETURNED)
      .map((r) => ({
        line: r.line, action: r.action, id: r.id ?? null, ref: r.ref ?? null,
        host: r.data.host_name ?? r.data.host_ip ?? null, port: portKey(r.data.port, r.data.protocol) || null,
        title: r.data.title || null, severity: r.data.severity ?? null,
        finding: r.data.plugin_id ?? r.data.cves ?? null, errors: r.errors, changes: r.changes ?? [], duplicateOf: r.duplicateOf ?? null,
      }));
    return {
      ...result, rows, rowsShown: rows.length,
      missingFindings: missing.slice(0, 100).map((f) => ({ id: f.id, ref: f.ref, title: f.title, host: f.host_name ?? f.host_ip, severity: f.severity })),
    };
  });

  // ---------- import history ----------

  app.get('/api/vulnerabilities/imports', { preHandler: view }, async () =>
    db.query('select * from vulnerability_import_batches order by imported_at desc limit 200'));

  app.get('/api/vulnerabilities/imports/:id', { preHandler: view }, async (req) => {
    const id = (req.params as Row).id;
    const row = /^[0-9a-f-]{36}$/i.test(id) ? await db.one('select * from vulnerability_import_batches where id = $1', [id]) : undefined;
    return row ?? ctx.fail(404, 'not_found', 'Import not found.');
  });

  // ---------- saved column mappings ----------

  app.get('/api/vulnerabilities/import/fields', { preHandler: view }, async () => ({ fields: IMPORT_FIELDS, maxBytes: MAX_BYTES, maxRows: MAX_ROWS }));

  app.get('/api/vulnerabilities/import/presets', { preHandler: view }, async () =>
    db.query('select id, name, source, delimiter, mapping, updated_at from vulnerability_mapping_presets where deleted_at is null order by lower(name)'));

  /** Saves a mapping under a name; saving an existing name replaces it. */
  app.post('/api/vulnerabilities/import/presets', { preHandler: create }, async (req, reply) => {
    const body = (req.body ?? {}) as Row;
    const name = String(body.name ?? '').trim();
    if (!name || name.length > 80) ctx.fail(400, 'validation', 'Check the highlighted fields.', { name: name ? 'Use at most 80 characters.' : 'Give the mapping a name.' });
    const mapping = cleanMapping(ctx, body.mapping);
    if (!Object.keys(mapping).length) ctx.fail(400, 'validation', 'Map at least one column before saving.', { mapping: 'The mapping is empty.' });
    const delimiter = typeof body.delimiter === 'string' && body.delimiter.length === 1 ? body.delimiter : ',';
    const source = String(body.source ?? '').trim().slice(0, 120) || null;
    const before = await db.one<Row>('select * from vulnerability_mapping_presets where lower(name) = lower($1) and deleted_at is null', [name]);
    const row = before
      ? await db.one<Row>(
        `update vulnerability_mapping_presets set name = $2, source = $3, delimiter = $4, mapping = $5::jsonb, updated_at = now(), updated_by = $6
         where id = $1 returning id, name, source, delimiter, mapping, updated_at`,
        [before.id, name, source, delimiter, JSON.stringify(mapping), req.user!.id])
      : await db.one<Row>(
        `insert into vulnerability_mapping_presets (name, source, delimiter, mapping, created_by, updated_by) values ($1,$2,$3,$4::jsonb,$5,$5)
         returning id, name, source, delimiter, mapping, updated_at`,
        [name, source, delimiter, JSON.stringify(mapping), req.user!.id]);
    await ctx.audit(req, {
      action: before ? 'vulnerability.mapping.update' : 'vulnerability.mapping.create', recordType: 'vulnerability',
      summary: `Import column mapping "${name}" ${before ? 'replaced' : 'saved'}`,
      before: before ? { source: before.source, delimiter: before.delimiter, mapping: before.mapping } : undefined,
      after: { presetId: row!.id, name, source, delimiter, mapping },
    });
    reply.code(before ? 200 : 201);
    return row;
  });

  app.delete('/api/vulnerabilities/import/presets/:id', { preHandler: create }, async (req) => {
    const id = (req.params as Row).id;
    const row = /^[0-9a-f-]{36}$/i.test(id)
      ? await db.one<Row>('update vulnerability_mapping_presets set deleted_at = now(), updated_by = $2 where id = $1 and deleted_at is null returning name, mapping', [id, req.user!.id])
      : undefined;
    if (!row) ctx.fail(404, 'not_found', 'Mapping not found.');
    await ctx.audit(req, {
      action: 'vulnerability.mapping.delete', recordType: 'vulnerability',
      summary: `Import column mapping "${row!.name}" deleted`, before: { presetId: id, ...row },
    });
    return { ok: true };
  });
}
