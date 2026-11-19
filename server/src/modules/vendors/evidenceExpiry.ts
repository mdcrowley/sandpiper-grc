// One expiry date for an evidence item and its files (E06-20). An evidence item has its own
// "Expires on" date, and each file attached to it as evidence may carry another. Only the
// item's date drives the evidence reminders, so the evidence page compares them and offers to
// copy one onto the other.
import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const day = (v: unknown): string | null => (v ? (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10) : null);

export function registerEvidenceExpiry(ctx: ModuleContext) {
  const { db, app } = ctx;

  /** The attachments table belongs to the attachments module, which may not be loaded. */
  let hasFiles: boolean | null = null;
  async function filesAvailable(): Promise<boolean> {
    if (hasFiles === null) hasFiles = Boolean((await db.one<{ t: string | null }>(`select to_regclass('attachments')::text as t`))?.t);
    return hasFiles;
  }

  async function needItem(req: FastifyRequest): Promise<Row> {
    return (await ctx.resources.find('evidence_item', String((req.params as Row).id ?? ''), req.user))
      ?? ctx.fail(404, 'not_found', 'Evidence item not found.');
  }

  async function filesOf(itemId: string): Promise<Row[]> {
    if (!(await filesAvailable())) return [];
    return db.query<Row>(
      `select id, file_name, expires_on::text as expires_on, collected_on::text as collected_on from attachments
       where record_type = 'evidence_item' and record_id = $1 and kind = 'evidence' and deleted_at is null
       order by created_at desc`, [itemId]);
  }

  async function report(item: Row) {
    const files = await filesOf(item.id);
    const itemDate = day(item.expires_on);
    const rows = files.map((f) => ({ id: f.id, file_name: f.file_name, expires_on: day(f.expires_on), differs: day(f.expires_on) !== itemDate }));
    return {
      item: { id: item.id, expires_on: itemDate },
      files: rows,
      // The dates disagree when any evidence file carries a date other than the item's, or the
      // item has a date and an evidence file has none.
      differs: rows.some((f) => f.differs),
      files_available: await filesAvailable(),
    };
  }

  app.get('/api/evidence/:id/expiry', { preHandler: ctx.requirePerm('vendors.view') }, async (req) => report(await needItem(req)));
  ctx.describeRoute({
    method: 'GET', path: '/api/evidence/:id/expiry', tag: 'Vendors', permission: 'vendors.view',
    summary: "An evidence item's expiry date beside the expiry dates of its evidence files, and whether they differ",
  });

  // Body: { use: 'file', attachment_id } copies that file's date onto the item;
  //       { use: 'item' } copies the item's date onto every evidence file of the item.
  app.post('/api/evidence/:id/expiry/align', { preHandler: ctx.requirePerm('vendors.edit') }, async (req) => {
    const item = await needItem(req);
    const b = (req.body ?? {}) as Row;
    const files = await filesOf(item.id);
    if (b.use === 'file') {
      const id = String(b.attachment_id ?? '');
      const file = UUID.test(id) ? files.find((f) => f.id === id) : undefined;
      if (!file) ctx.fail(400, 'validation', 'Check the highlighted fields.', { attachment_id: 'Choose one of this item\'s evidence files.' });
      // Through the record type, so the change is validated, audited and the reminders follow it.
      await ctx.resources.update('evidence_item', item.id, { expires_on: day(file!.expires_on) }, req);
    } else if (b.use === 'item') {
      if (!files.length) ctx.fail(400, 'validation', 'This item has no evidence files.');
      const date = day(item.expires_on);
      const changed = files.filter((f) => day(f.expires_on) !== date);
      for (const f of changed) {
        await db.query('update attachments set expires_on = $2, updated_at = now(), updated_by = $3 where id = $1', [f.id, date, req.user!.id]);
      }
      if (changed.length) {
        await ctx.audit(req, {
          action: 'evidence_item.file_expiry_align', recordType: 'evidence_item', recordId: item.id,
          summary: `Expiry of ${changed.length} evidence file${changed.length === 1 ? '' : 's'} set to the item's date (${date ?? 'none'})`,
          before: changed.map((f) => ({ attachment_id: f.id, file_name: f.file_name, expires_on: day(f.expires_on) })),
          after: { expires_on: date },
        });
      }
    } else {
      ctx.fail(400, 'validation', 'Say which date to keep: "file" or "item".');
    }
    return report((await ctx.resources.find('evidence_item', item.id, req.user))!);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/evidence/:id/expiry/align', tag: 'Vendors', permission: 'vendors.edit',
    summary: "Make the expiry dates agree: copy a file's date onto the item, or the item's date onto its evidence files",
    body: { type: 'object', required: ['use'], properties: { use: { type: 'string', enum: ['file', 'item'] }, attachment_id: { type: 'string', format: 'uuid' } } },
  });
}
