import type { FastifyRequest } from 'fastify';
import { csvCell } from '../../core/export/csv.ts';
import { ImportFileError, readUpload } from '../../core/import/read.ts';
import type { ModuleContext, ResourceDef, Row } from '../../core/module.ts';
import { COVERS, coverDefs, recordName } from './shared.ts';

/**
 * Importing control coverage from a spreadsheet (E41-12): one row per link, "this control covers that
 * record", read through the generic import's file reader (CSV or Excel, the same size and row limits).
 * Columns are found by their headers: the control (its reference, such as CTL-00012, or its exact
 * title), the kind of record (Risk, Hazard, Framework outcome, Obligation, Policy, OT security zone;
 * optional when the record is given by a reference that only one kind uses) and the record (its
 * reference or exact title). A check runs first and says, row by row, what would be added; the import
 * then adds the links. Coverage is only ever added: a link already there is left as it is, and nothing
 * missing from the file is removed. Only records the person may see can be matched, exactly as on a
 * control's Coverage tab; a record they may not see reads as "not found", so the answer reveals
 * nothing about it.
 */

export const COVERAGE_TEMPLATE_HEADERS = ['Control', 'Kind of record', 'Record'];

const HEADERS: Record<'control' | 'type' | 'record', RegExp> = {
  control: /^(control|control ref(erence)?|control id|control title|ctl)$/i,
  type: /^(kind|kind of record|record type|type|covers kind|record kind)$/i,
  record: /^(record|covers|covered record|record ref(erence)?|reference|ref|record title|title)$/i,
};

export type CoverageOutcome = 'add' | 'exists' | 'error';
export interface CoverageRow {
  line: number; outcome: CoverageOutcome; message: string | null;
  control: { id: string; ref: string; title: string } | null;
  record: { type: string; typeLabel: string; id: string; name: string } | null;
}
export interface CoverageImportResult {
  dryRun: boolean; rows: number; columns: Record<string, string>; added: number; existing: number; errors: number;
  results: CoverageRow[]; warnings: string[];
}

const norm = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ');
const lower = (v: unknown) => norm(v).toLowerCase();

export function registerCoverageImport(ctx: ModuleContext) {
  const { app, db } = ctx;

  /** The column of each part, from the mapping sent or by the headers. */
  function columnsOf(headers: string[], mapping: Row): Partial<Record<'control' | 'type' | 'record', number>> {
    const out: Partial<Record<'control' | 'type' | 'record', number>> = {};
    for (const key of ['control', 'type', 'record'] as const) {
      const wanted = typeof mapping[key] === 'string' ? headers.findIndex((h) => h === mapping[key]) : -1;
      const found = wanted >= 0 ? wanted : headers.findIndex((h) => HEADERS[key].test(norm(h)));
      if (found >= 0 && !Object.values(out).includes(found)) out[key] = found;
    }
    return out;
  }

  /** Finds a kind of record by its key, label or plural. */
  const typeOf = (defs: ResourceDef[], text: string) => {
    const t = lower(text).replace(/_/g, ' ');
    return defs.find((d) => [d.type.replace(/_/g, ' '), d.label.toLowerCase(), d.plural.toLowerCase()].includes(t));
  };

  /** Rows of one type matching a reference or exact title that `req`'s person may see (at most two). */
  async function matchRecord(req: FastifyRequest, def: ResourceDef, text: string): Promise<Row[]> {
    const cols = [def.ref?.field, def.titleField].filter((c): c is string => !!c);
    const where = cols.map((c) => `lower(btrim(t.${c}::text)) = $1`).join(' or ');
    return db.query<Row>(
      `select t.* from ${def.table} t where t.deleted_at is null and (${where}) and ${ctx.resources.visibleWhere(def.type, req.user, 't')}
       order by ${def.ref ? `(lower(btrim(t.${def.ref.field}::text)) = $1) desc,` : ''} t.created_at limit 2`, [lower(text)]);
  }

  async function matchControl(req: FastifyRequest, text: string): Promise<{ row?: Row; message?: string }> {
    const rows = await db.query<Row>(
      `select t.id, t.ref, t.title from controls t where t.deleted_at is null and (lower(btrim(t.ref)) = $1 or lower(btrim(t.title)) = $1)
         and ${ctx.resources.visibleWhere('control', req.user, 't')}
       order by (lower(btrim(t.ref)) = $1) desc, t.created_at limit 2`, [lower(text)]);
    if (!rows.length) return { message: `No control "${text}" was found. Give its reference, such as CTL-00012, or its exact title.` };
    if (rows.length > 1 && lower(rows[0].ref) !== lower(text)) return { message: `More than one control is called "${text}". Give its reference instead.` };
    return { row: rows[0] };
  }

  async function run(req: FastifyRequest, body: Row): Promise<CoverageImportResult> {
    let table;
    try { table = readUpload(body); } catch (err) {
      if (err instanceof ImportFileError) ctx.fail(400, 'bad_file', err.message, { file: err.message });
      throw err;
    }
    const cols = columnsOf(table.headers, body.mapping && typeof body.mapping === 'object' ? body.mapping as Row : {});
    const shown = table.headers.slice(0, 12).join(', ');
    if (cols.control === undefined) ctx.fail(400, 'bad_file', `No column names the control. Head one "Control" (the file's columns: ${shown}).`);
    if (cols.record === undefined) ctx.fail(400, 'bad_file', `No column names the covered record. Head one "Record" (the file's columns: ${shown}).`);
    const dryRun = body.dryRun !== false && body.dry_run !== false;
    const defs = coverDefs(ctx, req);
    if (!defs.length) ctx.fail(403, 'forbidden', 'None of the kinds of record a control can cover are open to you.');

    const results: CoverageRow[] = [];
    const seen = new Set<string>();
    const controls = new Map<string, { row?: Row; message?: string }>();
    for (const [n, cells] of table.rows.entries()) {
      const line = table.lines[n];
      const cell = (i: number | undefined) => (i === undefined ? '' : norm(cells[i]));
      const controlText = cell(cols.control);
      const typeText = cell(cols.type);
      const recordText = cell(cols.record);
      if (!controlText && !typeText && !recordText) continue;
      const out: CoverageRow = { line, outcome: 'error', message: null, control: null, record: null };
      results.push(out);
      if (!controlText) { out.message = 'No control on this row.'; continue; }
      if (!recordText) { out.message = 'No record on this row.'; continue; }
      const key = lower(controlText);
      if (!controls.has(key)) controls.set(key, await matchControl(req, controlText));
      const control = controls.get(key)!;
      if (!control.row) { out.message = control.message!; continue; }
      out.control = { id: control.row.id, ref: control.row.ref, title: control.row.title };

      let candidates: { def: ResourceDef; rows: Row[] }[];
      if (typeText) {
        const def = typeOf(defs, typeText);
        if (!def) {
          out.message = `"${typeText}" is not a kind of record a control can cover that is open to you (${defs.map((d) => d.label).join(', ')}).`;
          continue;
        }
        candidates = [{ def, rows: await matchRecord(req, def, recordText) }];
      } else {
        candidates = [];
        for (const def of defs.filter((d) => d.ref)) {
          const rows = (await matchRecord(req, def, recordText)).filter((r) => lower(r[def.ref!.field]) === lower(recordText));
          if (rows.length) candidates.push({ def, rows });
        }
      }
      const found = candidates.filter((c) => c.rows.length);
      if (!found.length) {
        out.message = typeText
          ? `No ${typeOf(defs, typeText)!.label.toLowerCase()} "${recordText}" was found among the records you may see.`
          : `No record with the reference "${recordText}" was found among the records you may see. Give its reference, or add the kind of record and use its title.`;
        continue;
      }
      if (found.length > 1 || found[0].rows.length > 1) {
        const ref = found[0].def.ref?.field;
        if (found.length > 1 || !ref || lower(found[0].rows[0][ref]) !== lower(recordText)) {
          out.message = `More than one record matches "${recordText}". Give its reference${typeText ? '' : ' and the kind of record'}.`;
          continue;
        }
      }
      const { def } = found[0];
      const row = found[0].rows[0];
      out.record = { type: def.type, typeLabel: def.label, id: row.id, name: recordName(def, row) };
      const pair = `${control.row.id}:${def.type}:${row.id}`;
      if (seen.has(pair)) { out.outcome = 'exists'; out.message = 'Repeated in the file.'; continue; }
      seen.add(pair);
      const linked = await db.one(
        `select 1 from record_links where from_type = 'control' and from_id = $1 and to_type = $2 and to_id = $3 and relation = $4`,
        [control.row.id, def.type, row.id, COVERS]);
      out.outcome = linked ? 'exists' : 'add';
    }

    const result: CoverageImportResult = {
      dryRun, rows: results.length,
      columns: Object.fromEntries(Object.entries(cols).map(([k, i]) => [k, table.headers[i!]])),
      added: results.filter((r) => r.outcome === 'add').length,
      existing: results.filter((r) => r.outcome === 'exists').length,
      errors: results.filter((r) => r.outcome === 'error').length,
      results, warnings: table.warnings,
    };
    if (dryRun) return result;

    for (const r of results.filter((x) => x.outcome === 'add')) {
      const made = await db.one(
        `insert into record_links (from_type, from_id, to_type, to_id, relation, created_by) values ('control', $1, $2, $3, $4, $5)
         on conflict (from_type, from_id, to_type, to_id, relation) do nothing returning id`,
        [r.control!.id, r.record!.type, r.record!.id, COVERS, req.user!.id]);
      if (!made) { r.outcome = 'exists'; continue; }
      const def = ctx.resources.get(r.record!.type)!;
      const restricted = def.restricted === true || (await ctx.resources.find(def.type, r.record!.id))?.restricted === true;
      // As on the Coverage tab: a restricted record's coverage is written to its own history, not the control's.
      await ctx.audit(req, restricted
        ? { action: 'control.coverage_add', recordType: def.type, recordId: r.record!.id, summary: `Now covered by control ${r.control!.ref} ${r.control!.title} (import)`, after: { from_type: 'control', from_id: r.control!.id, relation: COVERS } }
        : { action: 'control.coverage_add', recordType: 'control', recordId: r.control!.id, summary: `Covers ${def.label.toLowerCase()} ${r.record!.name} (import)`, after: { to_type: def.type, to_id: r.record!.id, relation: COVERS } });
    }
    result.added = results.filter((r) => r.outcome === 'add').length;
    result.existing = results.filter((r) => r.outcome === 'exists').length;
    const fileName = typeof body.fileName === 'string' ? body.fileName.slice(0, 200) : 'pasted text';
    await ctx.audit(req, {
      action: 'control.coverage_import', recordType: 'control',
      summary: `Control coverage import from ${fileName}: ${result.added} added, ${result.existing} already there, ${result.errors} with errors (of ${result.rows} rows)`,
      after: { file: fileName, kind: table.kind, sheet: table.sheet, added: result.added, existing: result.existing, errors: result.errors, rows: result.rows },
    });
    return result;
  }

  app.post('/api/controls/coverage/import', { preHandler: ctx.requirePerm('controls.edit') }, async (req) => run(req, (req.body ?? {}) as Row));
  ctx.describeRoute({
    method: 'POST', path: '/api/controls/coverage/import', permission: 'controls.edit',
    summary: 'Check (the default) or import control coverage from a spreadsheet: one row per control and covered record',
    description: 'The file is a CSV or Excel (.xlsx) file sent as base64 in `content` (or CSV text in `text`), with the generic import\'s limits. Columns are found by their headers: Control (reference or exact title), Kind of record (optional when the record is given by its reference) and Record (reference or exact title); `mapping` may name the header of each instead. Only records the caller may see are matched. Coverage is only added, never removed. `dryRun: false` imports.',
    body: {
      type: 'object',
      properties: {
        fileName: { type: 'string' }, content: { type: 'string', description: 'The file, base64' }, text: { type: 'string', description: 'CSV text, instead of a file' },
        sheet: { type: 'string' }, dryRun: { type: 'boolean', description: 'true (default): check only' },
        mapping: { type: 'object', properties: { control: { type: 'string' }, type: { type: 'string' }, record: { type: 'string' } }, description: 'The header of each column, when the headers are not recognized' },
      },
    },
    response: '{ dryRun, rows, columns, added, existing, errors, results: [{ line, outcome: add | exists | error, message, control, record }], warnings }',
  });

  app.get('/api/controls/coverage/import-template', { preHandler: ctx.requirePerm('controls.view') }, async (_req, reply) => {
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="control-coverage-template.csv"');
    return `﻿${COVERAGE_TEMPLATE_HEADERS.map(csvCell).join(',')}\r\nCTL-00001,Risk,RSK-00001\r\n`;
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/controls/coverage/import-template', permission: 'controls.view',
    summary: 'A CSV to fill in for the coverage import (Control, Kind of record, Record)', response: 'text/csv',
  });
}
