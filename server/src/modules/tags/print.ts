import type { FastifyRequest } from 'fastify';
import type { ModuleContext } from '../../core/module.ts';
import { taggable } from '../../core/asset-tags.ts';
import { slug } from '../../core/export/list.ts';
import { PDF_TYPE } from '../../core/export/pdf.ts';
import { printBranding } from '../../core/organization.ts';
import { dayInZone } from '../../core/timezone.ts';
import { TAG_SETTINGS, type LabelCode, type LabelLayout } from '../../../../shared/asset-tags-api.ts';
import { cleanValue, MAX_TAG_VALUE, sequenceValue, type CheckScheme } from '../../../../shared/tag-format.ts';
import { codeName } from './print-codes.ts';
import { LEGIBILITY, type LabelOptions, type LabelPlan, PlanError, planLabel } from './print-label.ts';
import { checkLayout, labelBoxes, layoutFromRow, pagesFor, perPage, PRESET_LAYOUTS, presetLayout } from './print-layouts.ts';
import { pdfMeasure, renderPdf } from './print-pdf.ts';
import { pngToBitmap, renderZpl, ZPL_DPI, type ZplDpi } from './print-zpl.ts';
import { takeFromSeries } from './store.ts';

// Printing your own tags (E37-08, spec §3.5). Routes (all tags.manage):
//   GET/POST /api/asset-tags/print/layouts, DELETE /api/asset-tags/print/layouts/:id   label stock
//   POST /api/asset-tags/print                                                         PDF or ZPL
// New values come from a series through store.ts `takeFromSeries` (one atomic update, registered as
// printed stock); reprints take a list of values or the current tag values of chosen records. Every
// print (not the alignment test page) is audit-logged as `tag.print` with the values printed, and no
// print makes more than `tags.print_limit` labels.
//
// Files: print-layouts.ts (presets, custom layouts, positions), print-codes.ts (Code 128, QR and
// Data Matrix through bwip-js), print-label.ts (what goes where on a label; legibility rules),
// print-pdf.ts and print-zpl.ts (the two outputs, drawn from the same plan).

const BASE = '/api/asset-tags/print';
const CODES: LabelCode[] = ['none', 'code128', 'qr', 'datamatrix'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The sample on an alignment test page when there is no value to show. */
export const SAMPLE_VALUE = 'TA-000000';
/** The line above is short: it is printed small, on one line. */
const TOP_LINE_MAX = 80;

/** A print request as the route reads it (PrintRequest plus the printer resolution for ZPL). */
interface PrintBody {
  from?: { kind?: string; seriesId?: string; count?: number; values?: unknown[]; recordType?: string; recordIds?: unknown[] };
  layoutId?: string; startAt?: number; code?: string; topLine?: string | null; logo?: boolean;
  textHeightMm?: number; output?: string; test?: boolean;
  /** Printer resolution for ZPL, in dots per inch: 203 (default), 300 or 600. */
  dpi?: number;
}

interface SeriesRow { id: string; name: string; prefix: string; digits: number; next_number: string | number; active: boolean; check_character: CheckScheme | null }

export async function registerPrint(ctx: ModuleContext): Promise<void> {
  const { app, db } = ctx;
  const manage = ctx.requirePerm('tags.manage');

  async function savedLayouts(): Promise<LabelLayout[]> {
    const rows = await db.query<Record<string, unknown>>('select * from tag_label_layouts where deleted_at is null order by lower(name)');
    return rows.map(layoutFromRow);
  }

  async function findLayout(id: unknown): Promise<LabelLayout | undefined> {
    if (typeof id !== 'string' || !id) return undefined;
    const preset = presetLayout(id);
    if (preset) return preset;
    if (!UUID.test(id)) return undefined;
    const row = await db.one<Record<string, unknown>>('select * from tag_label_layouts where id = $1 and deleted_at is null', [id]);
    return row ? layoutFromRow(row) : undefined;
  }

  app.get(`${BASE}/layouts`, { preHandler: manage }, async () => [...PRESET_LAYOUTS, ...(await savedLayouts())]);
  ctx.describeRoute({
    method: 'GET', path: `${BASE}/layouts`, tag: 'Asset tags', permission: 'tags.manage',
    summary: 'Label layouts for printing tags: the presets (named by their dimensions) and saved custom layouts',
    response: 'LabelLayout[] { id, name, kind: sheet | roll, pageWidthMm, pageHeightMm, labelWidthMm, labelHeightMm, columns, rows, marginTopMm, marginLeftMm, gapXMm, gapYMm, preset }',
  });

  app.post(`${BASE}/layouts`, { preHandler: manage }, async (req, reply) => {
    const checked = checkLayout((req.body ?? {}) as Record<string, unknown>);
    if (!checked.ok) return ctx.fail(400, 'validation', 'Check the layout.', checked.fields);
    const l = checked.layout;
    const row = await db.one<Record<string, unknown>>(
      `insert into tag_label_layouts (name, kind, page_width_mm, page_height_mm, label_width_mm, label_height_mm, columns, rows,
         margin_top_mm, margin_left_mm, gap_x_mm, gap_y_mm, created_by, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) returning *`,
      [l.name, l.kind, l.pageWidthMm, l.pageHeightMm, l.labelWidthMm, l.labelHeightMm, l.columns, l.rows, l.marginTopMm, l.marginLeftMm, l.gapXMm, l.gapYMm, req.user?.id ?? null]);
    const layout = layoutFromRow(row!);
    await ctx.audit(req, { action: 'tag.layout.create', recordType: 'tag_label_layout', recordId: layout.id, summary: `Label layout "${layout.name}" added`, after: layout });
    reply.code(201);
    return layout;
  });
  ctx.describeRoute({
    method: 'POST', path: `${BASE}/layouts`, tag: 'Asset tags', permission: 'tags.manage',
    summary: 'Save a custom label layout',
    description: 'A sheet layout names the page size, the label size, columns, rows, the top and left margins and the gaps between labels; every label must fit on the page. A roll layout is one label per page, so only the label size counts. Sizes in millimeters. 400 `validation` with a message per field.',
    body: '{ name, kind: sheet | roll, pageWidthMm, pageHeightMm, labelWidthMm, labelHeightMm, columns, rows, marginTopMm, marginLeftMm, gapXMm, gapYMm }',
    response: 'LabelLayout (201)',
  });

  app.delete(`${BASE}/layouts/:id`, { preHandler: manage }, async (req) => {
    const { id } = req.params as { id: string };
    if (presetLayout(id)) return ctx.fail(400, 'preset', 'A preset layout cannot be deleted.');
    const layout = await findLayout(id);
    if (!layout) return ctx.fail(404, 'not_found', 'There is no such label layout.');
    await db.query('update tag_label_layouts set deleted_at = now(), updated_at = now(), updated_by = $2 where id = $1', [id, req.user?.id ?? null]);
    await ctx.audit(req, { action: 'tag.layout.delete', recordType: 'tag_label_layout', recordId: id, summary: `Label layout "${layout.name}" deleted`, before: layout });
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'DELETE', path: `${BASE}/layouts/:id`, tag: 'Asset tags', permission: 'tags.manage',
    summary: 'Delete a saved label layout (presets cannot be deleted)', response: '{ ok: true }',
  });

  /** The series, and the value its next number makes (without taking it). */
  async function seriesOf(id: unknown): Promise<SeriesRow> {
    if (typeof id !== 'string' || !UUID.test(id)) return ctx.fail(400, 'validation', 'Choose a series.', { seriesId: 'Choose a series.' });
    const s = await db.one<SeriesRow>(
      `select s.id, s.name, s.prefix, s.digits, s.next_number, s.active, f.check_character
         from tag_series s left join tag_formats f on f.id = s.format_id and f.deleted_at is null
        where s.id = $1 and s.deleted_at is null`, [id]);
    if (!s) return ctx.fail(404, 'not_found', 'There is no such series.');
    if (!s.active) return ctx.fail(409, 'inactive', `The series "${s.name}" is not active.`);
    return s;
  }
  const seriesValue = (s: SeriesRow, n: number) => sequenceValue(n, { prefix: s.prefix, digits: s.digits, checkCharacter: s.check_character ?? 'none' });

  /** The current tag values of chosen records, in the order asked, as the person may see them. */
  async function recordValues(req: FastifyRequest, recordType: unknown, ids: unknown[]): Promise<{ values: string[]; skipped: number }> {
    const def = typeof recordType === 'string' ? taggable(app, ctx.resources, recordType) : undefined;
    const res = def ? ctx.resources.get(def.type) : undefined;
    if (!def || !res) return ctx.fail(400, 'validation', 'These records cannot carry a tag.', { recordType: 'Choose assets, sites, systems or vehicles.' });
    const clean = ids.filter((v): v is string => typeof v === 'string' && UUID.test(v));
    const rows = clean.length ? await db.query<{ id: string; v: string | null }>(
      `select id, ${def.field} as v from ${res.table} where id = any($1::uuid[]) and deleted_at is null and ${ctx.resources.visibleWhere(def.type, req.user ?? null)}`,
      [clean]) : [];
    const byId = new Map(rows.map((r) => [r.id, cleanValue(r.v)]));
    const values = clean.map((id) => byId.get(id) ?? '').filter(Boolean);
    return { values, skipped: ids.length - values.length };
  }

  /** The print settings of a request, checked (400 `validation` with a message per field). */
  async function settingsOf(body: PrintBody) {
    const fields: Record<string, string> = {};
    const layout = await findLayout(body.layoutId);
    if (!layout) fields.layoutId = 'Choose a label layout.';
    const code = (body.code ?? 'code128') as LabelCode;
    if (!CODES.includes(code)) fields.code = 'Choose text only, Code 128, QR or Data Matrix.';
    const output = body.output ?? 'pdf';
    if (output !== 'pdf' && output !== 'zpl') fields.output = 'Choose PDF or ZPL.';
    else if (output === 'zpl' && layout && layout.kind !== 'roll') fields.output = 'ZPL is for label printers: choose a roll layout, or PDF for a sheet.';
    const dpi = (body.dpi ?? 203) as ZplDpi;
    if (output === 'zpl' && !ZPL_DPI.includes(dpi)) fields.dpi = 'Choose 203, 300 or 600 dots per inch.';
    const textHeightMm = body.textHeightMm === undefined || body.textHeightMm === null ? LEGIBILITY.textHeightMm : Number(body.textHeightMm);
    if (!Number.isFinite(textHeightMm) || textHeightMm < LEGIBILITY.textHeightMinMm || textHeightMm > LEGIBILITY.textHeightMaxMm) {
      fields.textHeightMm = `The minimum text height must be between ${LEGIBILITY.textHeightMinMm} and ${LEGIBILITY.textHeightMaxMm} mm.`;
    }
    const topLine = typeof body.topLine === 'string' ? cleanValue(body.topLine) : '';
    if (topLine.length > TOP_LINE_MAX) fields.topLine = `Keep the line above under ${TOP_LINE_MAX} characters.`;
    const startAt = body.startAt === undefined || body.startAt === null ? 1 : Number(body.startAt);
    if (layout && (!Number.isInteger(startAt) || startAt < 1 || startAt > perPage(layout))) fields.startAt = `Start at a label from 1 to ${layout ? perPage(layout) : 1}.`;
    if (Object.keys(fields).length) return ctx.fail(400, 'validation', 'Check the print settings.', fields);
    const L = layout!;
    const branding = await printBranding(db);
    const wantLogo = body.logo === true && Boolean(branding.logo);
    const opts: LabelOptions = { code, topLine: topLine || null, logo: wantLogo, textHeightMm };
    const measure = pdfMeasure();
    const plan = (value: string): LabelPlan => {
      try {
        return planLabel(L.labelWidthMm, L.labelHeightMm, value, opts, measure);
      } catch (err) {
        if (err instanceof PlanError) return ctx.fail(400, 'not_legible', err.message, { value });
        throw err;
      }
    };
    return { L, code, output, dpi, startAt, branding, wantLogo, opts, measure, plan };
  }

  /** The value a sample label shows: the series' next value, the first value or record value given, or SAMPLE_VALUE. */
  async function sampleOf(req: FastifyRequest, from: PrintBody['from']): Promise<string> {
    if (from?.kind === 'series' && from.seriesId) { const s = await seriesOf(from.seriesId); return seriesValue(s, Number(s.next_number)); }
    if (from?.kind === 'values' && Array.isArray(from.values)) return cleanValue(from.values.find((v) => cleanValue(v))) || SAMPLE_VALUE;
    if (from?.kind === 'records' && Array.isArray(from.recordIds) && from.recordIds.length) {
      return (await recordValues(req, from.recordType, from.recordIds.slice(0, 20))).values[0] ?? SAMPLE_VALUE;
    }
    return SAMPLE_VALUE;
  }

  app.post(`${BASE}/preview`, { preHandler: manage }, async (req) => {
    const body = (req.body ?? {}) as PrintBody;
    const s = await settingsOf(body);
    const sample = await sampleOf(req, body.from);
    let plan: LabelPlan | null = null;
    let error: string | null = null;
    try { plan = planLabel(s.L.labelWidthMm, s.L.labelHeightMm, sample, s.opts, s.measure); } catch (err) {
      if (!(err instanceof PlanError)) throw err;
      error = err.message;
    }
    const limit = Number(await ctx.settings.get(TAG_SETTINGS.printLimit.key, TAG_SETTINGS.printLimit.fallback)) || TAG_SETTINGS.printLimit.fallback;
    return { sample, plan, error, layout: s.L, perPage: perPage(s.L), logoAvailable: Boolean(s.branding.logo), printLimit: limit };
  });
  ctx.describeRoute({
    method: 'POST', path: `${BASE}/preview`, tag: 'Asset tags', permission: 'tags.manage',
    summary: 'Preview one tag: where each part goes on the label, without taking any numbers',
    description: 'Takes the same body as POST /api/asset-tags/print and plans one label for a sample value (the series\' next value, the first value or record value given). `error` says why the value would not print legibly; nothing is taken from a series and nothing is logged.',
    body: 'Same as POST /api/asset-tags/print',
    response: '{ sample, plan: { width, height, logo, topLine, value, code: { symbol, x, y, module, height } } | null, error: string | null, layout: LabelLayout, perPage, logoAvailable, printLimit }',
  });

  app.post(BASE, { preHandler: manage }, async (req, reply) => {
    const body = (req.body ?? {}) as PrintBody;
    const { L, code, output, dpi, startAt, branding, wantLogo, plan } = await settingsOf(body);
    const logoBitmap = () => (wantLogo && output === 'zpl' && branding.logo ? pngToBitmap(branding.logo) : null);
    const date = dayInZone(0);
    const send = (data: Buffer | string, name: string) => {
      reply.header('content-type', output === 'pdf' ? PDF_TYPE : 'text/plain; charset=utf-8');
      reply.header('content-disposition', `attachment; filename="${name}.${output}"`);
      reply.header('cache-control', 'no-store');
      return data;
    };

    // The alignment test page: no values are taken or printed, so nothing is logged.
    if (body.test === true) {
      const p = plan(await sampleOf(req, body.from));
      if (output === 'zpl') return send(renderZpl({ plans: [p], dpi, logo: logoBitmap(), test: true }), 'tag-alignment-test');
      return send(await renderPdf({ layout: L, labels: [], logo: branding.logo, title: 'Tag alignment test', author: req.user?.displayName ?? '', test: { startAt, sample: p } }), 'tag-alignment-test');
    }

    const limit = Math.max(1, Number(await ctx.settings.get(TAG_SETTINGS.printLimit.key, TAG_SETTINGS.printLimit.fallback)) || TAG_SETTINGS.printLimit.fallback);
    const tooMany = (n: number) => ctx.fail(400, 'too_many', `One print makes at most ${limit} labels (asked for ${n}). Print in smaller batches, or raise the limit under Administration > Asset tags > Settings.`, { count: `At most ${limit}.` });
    const from = body.from;
    let values: string[] = [];
    let skipped = 0;
    let source = '';
    let audit: Record<string, unknown> = {};
    if (from?.kind === 'series') {
      const count = Number(from.count);
      if (!Number.isInteger(count) || count < 1) return ctx.fail(400, 'validation', 'Check the print settings.', { count: 'Print at least one new tag.' });
      if (count > limit) return tooMany(count);
      // Check that the values will print legibly before taking any numbers from the series.
      const s = await seriesOf(from.seriesId);
      const next = Number(s.next_number);
      plan(seriesValue(s, next));
      plan(seriesValue(s, next + count - 1));
      const taken = await takeFromSeries(ctx, s.id, count, req);
      values = taken.values;
      source = `new from series "${s.name}"`;
      audit = { seriesId: s.id, rangeId: taken.rangeId };
    } else if (from?.kind === 'values') {
      const list = Array.isArray(from.values) ? from.values.map(cleanValue).filter(Boolean) : [];
      if (!list.length) return ctx.fail(400, 'validation', 'Check the print settings.', { values: 'Enter at least one tag value.' });
      if (list.length > limit) return tooMany(list.length);
      const long = list.find((v) => v.length > MAX_TAG_VALUE);
      if (long) return ctx.fail(400, 'validation', 'Check the print settings.', { values: `A tag value has at most ${MAX_TAG_VALUE} characters.` });
      values = list;
      source = 'reprint';
    } else if (from?.kind === 'records') {
      const ids = Array.isArray(from.recordIds) ? from.recordIds : [];
      if (!ids.length) return ctx.fail(400, 'validation', 'Check the print settings.', { recordIds: 'Choose at least one record.' });
      if (ids.length > limit) return tooMany(ids.length);
      const got = await recordValues(req, from.recordType, ids);
      if (!got.values.length) return ctx.fail(400, 'nothing_to_print', 'None of the chosen records has a tag value to print.');
      values = got.values;
      skipped = got.skipped;
      source = `reprint for ${values.length} chosen ${ctx.resources.get(String(from.recordType))?.plural.toLowerCase() ?? 'records'}`;
      audit = { recordType: from.recordType, recordIds: ids.slice(0, limit) };
    } else {
      return ctx.fail(400, 'validation', 'Check the print settings.', { from: 'Choose new tags from a series, values to reprint, or records.' });
    }

    const plans = values.map(plan);
    const fmt = output === 'pdf' ? 'PDF' : 'ZPL';
    const range = values.length === 1 ? values[0] : `${values[0]} to ${values[values.length - 1]}`;
    await ctx.audit(req, {
      action: 'tag.print',
      ...(from.kind === 'series' ? { recordType: 'tag_series', recordId: String(audit.seriesId) } : {}),
      summary: `Printed ${values.length} tag${values.length === 1 ? '' : 's'} (${range}), ${source}, as ${fmt} on "${L.name}"`,
      after: { from: from.kind, values, count: values.length, skipped, output, layoutId: L.id, layout: L.name, code, startAt: L.kind === 'sheet' ? startAt : 1, ...audit },
    });
    reply.header('x-tags-count', String(values.length));
    reply.header('x-tags-skipped', String(skipped));
    reply.header('x-tags-pages', String(output === 'pdf' ? pagesFor(L, values.length, startAt) : values.length));
    const name = slug(`tags-${date}-${values.length}`);
    if (output === 'zpl') return send(renderZpl({ plans, dpi, logo: logoBitmap() }), name);
    const boxes = labelBoxes(L, values.length, startAt);
    const pdf = await renderPdf({
      layout: L, labels: plans.map((p, i) => ({ box: boxes[i], plan: p })), logo: branding.logo,
      title: `Tags ${range}`, author: req.user?.displayName ?? '',
    });
    return send(pdf, name);
  });
  ctx.describeRoute({
    method: 'POST', path: BASE, tag: 'Asset tags', permission: 'tags.manage',
    summary: 'Print tags: new values from a series, or reprints, as a PDF for the label stock or ZPL for a label printer',
    description: `Each tag carries its value in large type and, unless code is \`none\`, a code holding the same value and nothing else (${CODES.filter((c) => c !== 'none').map(codeName).join(', ')}); a value that looks like an address is refused for a code. Optional line above (topLine) and the organization's logo (logo). The value's capitals are at least textHeightMm tall (default ${LEGIBILITY.textHeightMm}); a value that cannot print legibly on the label answers 400 \`not_legible\` with the reason. ZPL (output: zpl) is for roll layouts; dpi 203 (default), 300 or 600. New values (from.kind series) are taken from the series in one atomic step and registered as printed stock; a print makes at most \`tags.print_limit\` labels (400 \`too_many\`). Audit-logged as \`tag.print\`, except the alignment test page (test: true), which prints every label outline with a sample label and takes no numbers. Response headers: x-tags-count, x-tags-skipped (chosen records with no tag value), x-tags-pages.`,
    body: '{ from: { kind: series, seriesId, count } | { kind: values, values: string[] } | { kind: records, recordType, recordIds }, layoutId, startAt?, code: none | code128 | qr | datamatrix, topLine?, logo?, textHeightMm?, output: pdf | zpl, dpi?: 203 | 300 | 600, test? }',
    response: 'application/pdf or text/plain (ZPL)',
  });
}
