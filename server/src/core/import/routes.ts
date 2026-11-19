// Routes of the generic import (any record type). The file travels with each request (base64 in
// JSON, at most IMPORT_LIMITS.bytes), so nothing is kept on the server between the steps of the
// wizard. Creating needs `<module>.create`, updating `<module>.edit`, and a restricted type also
// `security.view`, exactly as by hand. A real run is audited per record (by the resource engine)
// and once as a whole; past imports are read back from that audit event.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { fail } from '../errors.ts';
import type { AuditInput, ResourceDef, Row } from '../module.ts';
import { IMPORT_LIMITS, ImportFileError, readUpload } from './read.ts';
import { importableFields, matchKeys, MappingError, runImport, suggestMapping, type ImportDeps, type ImportMode } from './service.ts';

export interface ImportRouteDeps extends ImportDeps {
  app: FastifyInstance;
  audit: (req: FastifyRequest | null, ev: AuditInput) => Promise<void>;
}

const MODES: ImportMode[] = ['create', 'update', 'upsert'];
const csvCell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function registerImportRoutes(deps: ImportRouteDeps) {
  const { app } = deps;

  /** The record type, if the caller may import into it in this mode (any mode when `mode` is null). */
  function target(req: FastifyRequest, mode: ImportMode | null, type = (req.params as { type?: string }).type ?? ''): ResourceDef {
    const def = deps.registry.get(type);
    if (!def || !deps.mayAccess(req.user, def, 'view')) fail(404, 'not_found', 'Unknown record type.');
    const create = deps.mayAccess(req.user, def!, 'create');
    const edit = deps.mayAccess(req.user, def!, 'edit');
    const ok = mode === null ? create || edit : mode === 'create' ? create : mode === 'update' ? edit : create && edit;
    if (!ok) {
      fail(403, 'forbidden', mode === 'update' ? `Your role does not allow changing ${def!.plural.toLowerCase()}.`
        : mode === 'upsert' ? `Updating or creating needs permission both to create and to change ${def!.plural.toLowerCase()}.`
        : `Your role does not allow importing ${def!.plural.toLowerCase()}.`);
    }
    return def!;
  }

  const read = (body: Row) => {
    try { return readUpload(body); } catch (err) {
      if (err instanceof ImportFileError) fail(400, 'bad_file', err.message, { file: err.message });
      throw err;
    }
  };

  async function describeType(req: FastifyRequest, def: ResourceDef) {
    const custom = await deps.customDefs(def.type);
    return {
      type: def.type, label: def.label, plural: def.plural, route: def.route,
      fields: await importableFields(deps, def),
      matchKeys: matchKeys(def, custom),
      modes: MODES.filter((m) => (m === 'create' ? deps.mayAccess(req.user, def, 'create') : m === 'update' ? deps.mayAccess(req.user, def, 'edit')
        : deps.mayAccess(req.user, def, 'create') && deps.mayAccess(req.user, def, 'edit'))),
      limits: IMPORT_LIMITS,
    };
  }

  app.get('/api/import/:type/fields', async (req) => describeType(req, target(req, null)));

  /** A CSV with one header per importable field, to fill in. */
  app.get('/api/import/:type/template', async (req, reply) => {
    const def = target(req, null);
    const fields = await importableFields(deps, def);
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="${def.type}-import-template.csv"`);
    return `﻿${fields.map((f) => csvCell(f.label)).join(',')}\r\n`;
  });

  /** Reads the file: its sheets, headers, a sample of rows and a suggested mapping. */
  app.post('/api/import/:type/read', async (req) => {
    const def = target(req, null);
    const table = read((req.body ?? {}) as Row);
    const info = await describeType(req, def);
    const text = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));
    return {
      ...info,
      kind: table.kind, sheets: table.sheets, sheet: table.sheet,
      headers: table.headers,
      sample: table.rows.slice(0, 5).map((r) => table.headers.map((_, i) => text(r[i]).slice(0, 200))),
      rowCount: table.rows.length,
      suggested: suggestMapping(table.headers, info.fields, def),
    };
  });

  /** Checks (dryRun: true, the default) or imports the file. */
  app.post('/api/import/:type', async (req) => {
    const body = (req.body ?? {}) as Row;
    const mode = (MODES.includes(body.mode) ? body.mode : 'create') as ImportMode;
    const def = target(req, mode);
    const table = read(body);
    const dryRun = body.dryRun !== false;
    const valueMap: Record<string, Record<string, unknown>> = {};
    if (body.valueMap && typeof body.valueMap === 'object') {
      for (const [field, map] of Object.entries(body.valueMap as Row)) {
        if (!map || typeof map !== 'object') continue;
        valueMap[field] = Object.fromEntries(Object.entries(map as Row).map(([k, v]) => [k.trim().toLowerCase(), v]));
      }
    }
    let summary;
    try {
      summary = await runImport(deps, def, req, {
        table, mode, dryRun, valueMap,
        mapping: body.mapping && typeof body.mapping === 'object' ? body.mapping : {},
        matchKey: typeof body.matchKey === 'string' && body.matchKey ? body.matchKey : null,
      });
    } catch (err) {
      if (err instanceof MappingError) fail(400, 'mapping', err.message, err.fields);
      throw err;
    }
    if (!dryRun) {
      const fileName = typeof body.fileName === 'string' ? body.fileName.slice(0, 200) : 'pasted text';
      await deps.audit(req, {
        action: `${def.type}.import`, recordType: def.type,
        summary: `${def.label} import from ${fileName}: ${summary.created} created, ${summary.updated} updated, ${summary.skipped} skipped, ${summary.errors} with errors (of ${summary.total} rows)`,
        after: {
          file: fileName, kind: table.kind, sheet: table.sheet, mode, match_key: summary.matchKey,
          total: summary.total, created: summary.created, updated: summary.updated, skipped: summary.skipped,
          errors: summary.errors, duplicates: summary.duplicates, mapping: body.mapping,
        },
      });
    }
    return { ...summary, fileName: body.fileName ?? null, kind: table.kind, sheet: table.sheet };
  });

  /** Past imports of a record type, newest first. */
  app.get('/api/import/history', async (req) => {
    const def = target(req, null, String((req.query as Row).type ?? ''));
    const rows = await deps.db.query<Row>(
      `select id, at, actor_name, summary, after from audit_events where action = $1 and record_type = $2 order by at desc, id desc limit 50`,
      [`${def.type}.import`, def.type]);
    return rows.map((r) => ({
      id: String(r.id), at: r.at, by: r.actor_name, summary: r.summary,
      file: r.after?.file ?? null, mode: r.after?.mode ?? null, total: r.after?.total ?? null,
      created: r.after?.created ?? 0, updated: r.after?.updated ?? 0, skipped: r.after?.skipped ?? 0, errors: r.after?.errors ?? 0,
    }));
  });
}
