// The papers of an agenda item (wave 25): a file attached to the meeting (a staff report, a
// presentation), a controlled document from the document library (type `policy`, policies module,
// when loaded), or any other record. A paper the reader may not see is not named; a document is read
// with the library's own row rule, so a restricted document stays with its readers.
import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';

export const DOCUMENT_TYPE = 'policy';
export const PAPER_KINDS = ['file', 'document', 'record'] as const;
export type PaperKind = (typeof PAPER_KINDS)[number];
/** Papers on one agenda item. */
export const PAPERS_PER_ITEM = 40;

/** Whether a table exists (a module that is not loaded has none). */
export async function hasTable(ctx: ModuleContext, name: string): Promise<boolean> {
  return Boolean((await ctx.db.one<{ t: string | null }>('select to_regclass($1)::text as t', [name]))?.t);
}

/** A record of another module that a person may see (the document library reads by its own row rule). */
export async function seeRecord(ctx: ModuleContext, user: SessionUser | null | undefined, type: string, id: string): Promise<Row | undefined> {
  const def = ctx.resources.get(type);
  if (!def || !UUID_RE.test(String(id ?? ''))) return undefined;
  if (user && type !== DOCUMENT_TYPE && !ctx.can(user, `${def.module}.view`)) return undefined;
  return ctx.resources.find(def.type, id, user ?? undefined);
}

/** The version of a document in force now (published), or null. */
export async function currentVersion(ctx: ModuleContext, policyId: string): Promise<Row | null> {
  if (!(await hasTable(ctx, 'policy_versions'))) return null;
  return (await ctx.db.one<Row>(
    `select id, version, version_label, status, effective_on::text as effective_on, content_kind, body, source_attachment_id, rendition_attachment_id
     from policy_versions where policy_id = $1 and status = 'published' order by version desc limit 1`, [policyId])) ?? null;
}

export const documentLabel = (p: Row) => [p.doc_number ?? p.ref, p.title].filter(Boolean).join(' ');

/**
 * The papers of some agenda items, by item id, as `user` may see them: files of the meeting with their
 * name, documents with the version in force, records named by the server. `{ hidden: true }` for a
 * paper the person may not see, `{ missing: true }` for a file since removed.
 */
export async function papersOf(ctx: ModuleContext, user: SessionUser | null | undefined, meetingId: string, itemIds: string[]): Promise<Map<string, Row[]>> {
  const out = new Map<string, Row[]>();
  if (!itemIds.length) return out;
  // Without the attachments module there is no attachments table: files are then shown as missing.
  const files = await hasTable(ctx, 'attachments');
  const rows = await ctx.db.query<Row>(files
    ? `select p.id, p.item_id, p.kind, p.attachment_id, p.record_type, p.record_id, p.sort,
              a.file_name, a.extension, a.size_bytes, a.storage_driver
       from agenda_item_papers p
       left join attachments a on p.kind = 'file' and a.id = p.attachment_id and a.record_type = 'meeting' and a.record_id = p.meeting_id and a.deleted_at is null
       where p.meeting_id = $1 and p.item_id = any($2::uuid[]) order by p.sort, p.created_at`
    : `select id, item_id, kind, attachment_id, record_type, record_id, sort from agenda_item_papers
       where meeting_id = $1 and item_id = any($2::uuid[]) order by sort, created_at`, [meetingId, itemIds]);
  for (const r of rows) {
    const paper: Row = { id: r.id, kind: r.kind };
    if (r.kind === 'file') {
      paper.attachment_id = r.attachment_id;
      if (r.file_name) {
        paper.file_name = r.file_name;
        paper.extension = r.extension;
        paper.size_bytes = r.size_bytes === null || r.size_bytes === undefined ? null : Number(r.size_bytes);
        paper.link = r.storage_driver === 'link';
      } else paper.missing = true;
    } else {
      const def = ctx.resources.get(String(r.record_type));
      const found = def ? await seeRecord(ctx, user, def.type, String(r.record_id)) : undefined;
      if (!def || !found) paper.hidden = true;
      else {
        paper.record = {
          type: def.type, typeLabel: def.label, id: found.id, route: def.route, ref: def.ref ? found[def.ref.field] ?? null : null,
          label: def.type === DOCUMENT_TYPE ? documentLabel(found) : await ctx.resources.labelFor(def.type, found.id),
        };
        if (r.kind === 'document') {
          const v = await currentVersion(ctx, found.id);
          paper.version = v ? { id: v.id, label: v.version_label ?? `Version ${v.version}`, effective_on: v.effective_on, content_kind: v.content_kind } : null;
        }
      }
    }
    out.set(r.item_id, [...(out.get(r.item_id) ?? []), paper]);
  }
  return out;
}

/** Checks a paper to add: a file of this meeting, a document the person may read, or a record they may see. */
export async function paperInput(ctx: ModuleContext, req: FastifyRequest, meetingId: string, body: Row): Promise<Row> {
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  const kind = String(body.kind ?? '');
  if (!(PAPER_KINDS as readonly string[]).includes(kind)) invalid({ kind: 'Choose a file of the meeting, a document or a record.' });
  if (kind === 'file') {
    const id = String(body.attachment_id ?? '');
    const ok = UUID_RE.test(id) && await hasTable(ctx, 'attachments') && await ctx.db.one(
      `select 1 as ok from attachments where id = $1 and record_type = 'meeting' and record_id = $2 and deleted_at is null`, [id, meetingId]);
    if (!ok) invalid({ attachment_id: 'Choose a file attached to this meeting (add it under Attachments first).' });
    return { kind, attachment_id: id, record_type: null, record_id: null };
  }
  if (kind === 'document' && !ctx.resources.get(DOCUMENT_TYPE)) invalid({ kind: 'The document library is not part of this installation.' });
  const type = kind === 'document' ? DOCUMENT_TYPE : String(body.record_type ?? '');
  const id = String((kind === 'document' ? body.record_id ?? body.policy_id : body.record_id) ?? '');
  if (kind === 'record' && type === 'meeting' && id === meetingId) invalid({ record_id: 'Choose another record than this meeting.' });
  const found = await seeRecord(ctx, req.user, type, id);
  if (!found) invalid({ record_id: kind === 'document' ? 'Choose a document you can read.' : 'That record was not found.' });
  return { kind, attachment_id: null, record_type: type, record_id: found!.id };
}
