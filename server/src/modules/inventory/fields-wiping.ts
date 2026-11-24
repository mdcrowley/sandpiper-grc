import type { FastifyRequest } from 'fastify';
import { PDF_TYPE, PdfBuilder } from '../../core/export/pdf.ts';
import type { FieldDef, ModuleContext, Row } from '../../core/module.ts';
import { printBranding } from '../../core/organization.ts';
import { dayInZone } from '../../core/timezone.ts';

/**
 * Proof of data wiping at disposal (E41-17). An asset that holds data (`data_bearing`: a laptop, a
 * server's disks, a phone, a fare-collection unit, a camera recorder) cannot be marked disposed until
 * its wiping is recorded: the method, the date, who did it, and the reference of the wiping
 * certificate (the vendor's certificate, or the organization's own). The rule is checked in
 * `disposalProblem` (lifecycle.ts), so it holds for the dispose step, an edit, a bulk change and an
 * import alike. `GET /api/assets/:id/data-wiping-certificate.pdf` prints the record as a
 * certificate; the vendor's own certificate can be attached to the asset as well.
 * Columns: `inventory/migrations/010_data_wiping.sql`.
 */
export const DATA_WIPE_ASSET_FIELDS: Record<string, FieldDef> = {
  data_bearing: { label: 'Holds data', type: 'boolean', default: false },
  data_wipe_method: { label: 'Data wiping method', type: 'lookup', list: 'data_wipe_method' },
  data_wiped_on: { label: 'Data wiped on', type: 'date' },
  data_wiped_by: { label: 'Data wiped by', type: 'text' },
  data_wipe_certificate: { label: 'Wiping certificate reference', type: 'text' },
};

/** The methods, by the three usual levels of media sanitization: clear, purge and destroy. */
export async function seedWipeMethods(ctx: ModuleContext): Promise<void> {
  await ctx.lookups.ensure('data_wipe_method', [
    { value: 'clear', label: 'Cleared (overwritten)', color: 'blue', sort: 10, meta: { description: 'Every place that holds data overwritten with software, for media that stay in use or are resold.' } },
    { value: 'purge', label: 'Purged (secure or cryptographic erase)', color: 'teal', sort: 20, meta: { description: 'The device\'s own secure erase, a cryptographic erase or degaussing: the data cannot be recovered even in a laboratory.' } },
    { value: 'destroy', label: 'Destroyed (shredded, crushed or burned)', color: 'purple', sort: 30, meta: { description: 'The media physically destroyed.' } },
  ], { module: 'assets' });
}

/** Field problems with the wiping record of a data-bearing asset being disposed of (empty: none). */
export function wipeProblems(asset: Row): Record<string, string> {
  const fields: Record<string, string> = {};
  if (!asset.data_bearing) return fields;
  const blank = (v: unknown) => !String(v ?? '').trim();
  if (blank(asset.data_wipe_method)) fields.data_wipe_method = 'Choose how the data was wiped.';
  if (!asset.data_wiped_on) fields.data_wiped_on = 'Enter the date the data was wiped.';
  if (blank(asset.data_wiped_by)) fields.data_wiped_by = 'Enter who wiped the data (a person or a company).';
  if (blank(asset.data_wipe_certificate)) fields.data_wipe_certificate = 'Enter the reference of the wiping certificate.';
  return fields;
}

export function registerWipeCertificate(ctx: ModuleContext): void {
  ctx.app.get('/api/assets/:id/data-wiping-certificate.pdf', { preHandler: ctx.requirePerm('assets.view') }, async (req: FastifyRequest, reply) => {
    const asset = (await ctx.resources.find('asset', (req.params as { id: string }).id, req.user)) ?? ctx.fail(404, 'not_found', 'Asset not found.');
    if (!asset.data_bearing || !asset.data_wiped_on) ctx.fail(409, 'not_wiped', 'No data wiping is recorded for this asset.');
    const method = (await ctx.lookups.values('data_wipe_method')).find((m) => m.value === asset.data_wipe_method);
    const recorded = await ctx.db.one<{ at: string | Date; actor_name: string | null }>(
      `select at, actor_name from audit_events where record_type = 'asset' and record_id = $1 and action in ('asset.dispose', 'asset.data_wiped')
       order by id desc limit 1`, [asset.id]);
    const name = asset.tag ? `${asset.tag} ${asset.name ?? ''}`.trim() : String(asset.name ?? asset.id);
    const pdf = new PdfBuilder({
      title: 'Data wiping certificate', subtitle: name, lang: 'en-US', author: req.user?.displayName,
      meta: [`Printed ${dayInZone()} by ${req.user?.displayName ?? 'the application'}`],
      branding: await printBranding(ctx.db),
    });
    pdf.keyValues([
      { label: 'Asset', value: name },
      { label: 'Serial number', value: String(asset.serial ?? '') || 'Not recorded' },
      { label: 'Method', value: method?.label ?? String(asset.data_wipe_method ?? '') },
      { label: 'Wiped on', value: String(asset.data_wiped_on).slice(0, 10) },
      { label: 'Wiped by', value: String(asset.data_wiped_by ?? '') },
      { label: 'Certificate reference', value: String(asset.data_wipe_certificate ?? '') },
      { label: 'Disposed on', value: asset.disposed_on ? String(asset.disposed_on).slice(0, 10) : 'Not yet disposed' },
      { label: 'Disposal approved by', value: String(asset.disposal_approved_by ?? '') || 'Not recorded' },
      { label: 'Recorded in the application', value: recorded ? `${(recorded.at instanceof Date ? recorded.at.toISOString() : String(recorded.at)).slice(0, 10)} by ${recorded.actor_name ?? 'the system'}` : 'See the asset\'s history' },
    ]);
    if (method?.meta?.description) pdf.paragraph(String(method.meta.description), { muted: true });
    pdf.paragraph('This certificate restates what is recorded on the asset. Keep the wiping company\'s own certificate, if there is one, as an attachment of the asset.', { muted: true });
    const body = await pdf.finish();
    await ctx.audit(req, { action: 'asset.wipe_certificate', recordType: 'asset', recordId: asset.id, summary: `Data wiping certificate of ${name} printed` });
    reply.header('content-type', PDF_TYPE);
    reply.header('content-disposition', `attachment; filename="data-wiping-certificate-${String(asset.tag ?? asset.id).replace(/[^A-Za-z0-9._-]/g, '_')}.pdf"`);
    reply.header('cache-control', 'no-store');
    return reply.send(body);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/assets/:id/data-wiping-certificate.pdf', tag: 'Inventory', permission: 'assets.view',
    summary: 'The data wiping certificate of an asset that holds data (PDF): method, date, who wiped it and the certificate reference',
  });
}
