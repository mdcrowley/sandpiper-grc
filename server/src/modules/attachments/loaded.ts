// Files added in data load mode (E45-52): an attachment created by a load may keep the date it was
// first added (`created_at`, a date or an ISO time), and is listed in data_load_records under the
// record type `attachment`, so Administration > Data loads shows it and undoing that load's files
// removes them (admin/dataload.ts). Outside a load a given date is refused.
import type { FastifyRequest } from 'fastify';
import { dataLoadFor, noteLoaded } from '../../core/dataload.ts';
import type { ModuleContext, Row } from '../../core/module.ts';

/** The record type under which loaded files are listed in data_load_records. */
export const LOADED_FILE_TYPE = 'attachment';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface FileLoad { loading: boolean; createdAt: string | null }

/**
 * Before a file is stored: whether this request is a load, and the date the file was added, if one
 * is given (a date or an ISO time, not in the future). A date outside a load is refused (400).
 */
export async function fileLoad(ctx: ModuleContext, req: FastifyRequest, value: unknown): Promise<FileLoad> {
  const loading = await dataLoadFor(ctx.db, req, ctx.audit);
  if (value === undefined || value === null || value === '') return { loading, createdAt: null };
  const s = typeof value === 'string' ? value.trim() : '';
  const t = Date.parse(DATE_RE.test(s) ? `${s}T12:00:00Z` : s);
  if (!s || Number.isNaN(t)) ctx.fail(400, 'validation', 'The date the file was added is not a date.', { created_at: 'Give a date (YYYY-MM-DD) or an ISO time.' });
  if (t > Date.now() + 60_000) ctx.fail(400, 'validation', 'The date the file was added is in the future.', { created_at: 'The date cannot be in the future.' });
  if (!loading) ctx.fail(400, 'validation', 'Only a data load may give the date a file was added.', { created_at: 'Only in data load mode (Administration > Settings), by an administrator.' });
  return { loading, createdAt: new Date(t).toISOString() };
}

/** After the attachment row is inserted: in a load, keeps the given date and lists the file for undo. */
export async function noteLoadedFile(ctx: ModuleContext, req: FastifyRequest, row: Row, load: FileLoad): Promise<Row> {
  if (!load.loading) return row;
  let stored = row;
  if (load.createdAt) {
    stored = (await ctx.db.one<Row>('update attachments set created_at = $2, updated_at = $2 where id = $1 returning *', [row.id, load.createdAt])) ?? row;
  }
  await noteLoaded(ctx.db, LOADED_FILE_TYPE, String(row.id), req);
  return stored;
}
