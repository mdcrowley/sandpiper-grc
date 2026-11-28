// Administration > File settings > Reading scans (E46-56): which languages scanned PDFs are read in.
// The choice is made from the language files in the folder in use (the bundled English and Spanish, or
// GRC_OCR_LANG_DIR), is stored as the setting `attachments.ocr_languages` (audited by the settings
// store), and applies to the OCR reader from its next run (text.ts). Saving may also put scans back in
// the reading queue: those not read yet, and, when asked, those already read by OCR. Nothing is
// downloaded: a language without its file cannot be chosen.
import type { ModuleContext, Row } from '../../core/module.ts';
import {
  availableOcrLanguages, OCR_MAX_LANGS, OCR_MAX_PAGES, ocrEngineInstalled, ocrLangDir, ocrLanguages, ocrState, ocrSwitchedOff, readOcrLanguages,
  BUNDLED_LANG_DIR, SETTING_OCR_LANGS,
} from './ocr.ts';
import { queueFileTexts } from './text.ts';

/** Scans whose text is waiting for OCR (not read: switched off, engine or language missing, or failed), and scans read by OCR. */
const NOT_READ = `x.detail like 'scanned:%'`;
const READ = `x.detail like 'read by OCR%'`;

export function registerOcrAdmin(ctx: ModuleContext): void {
  const { app, db } = ctx;
  const admin = { preHandler: ctx.requirePerm('admin.administer') };

  async function overview() {
    const chosen = await readOcrLanguages(ctx);
    const { langs, source } = ocrLanguages(process.env, chosen);
    const state = ocrState(process.env, chosen);
    const counts = await db.one<{ waiting: number; read: number }>(
      `select count(*) filter (where ${NOT_READ})::int as waiting, count(*) filter (where ${READ})::int as read
       from attachment_texts x join attachments a on a.id = x.attachment_id and a.deleted_at is null`);
    return {
      switched_off: ocrSwitchedOff(),
      engine_installed: ocrEngineInstalled(),
      ready: state.ready,
      reason: state.ready ? null : state.reason,
      folder: ocrLangDir() === BUNDLED_LANG_DIR ? 'bundled' : 'custom',
      languages: availableOcrLanguages().map((l) => ({ code: l.code, name: l.name })),
      chosen: langs.split('+'),
      source,
      max_languages: OCR_MAX_LANGS,
      max_pages: OCR_MAX_PAGES,
      scans_not_read: counts?.waiting ?? 0,
      scans_read: counts?.read ?? 0,
    };
  }

  app.get('/api/attachments/admin/ocr', admin, overview);
  ctx.describeRoute({
    method: 'GET', path: '/api/attachments/admin/ocr', permission: 'admin.administer',
    summary: 'Reading scans (OCR): the languages that can be chosen (their data is in the language folder), the ones chosen, and whether scans can be read',
    response: '{ switched_off, engine_installed, ready, reason, folder: bundled|custom, languages: [{ code, name }], chosen: [code], source: setting|environment|default, max_languages, max_pages, scans_not_read, scans_read }',
  });

  app.put('/api/attachments/admin/ocr', admin, async (req) => {
    const b = (req.body ?? {}) as Row;
    const available = new Set(availableOcrLanguages().map((l) => l.code));
    const given = Array.isArray(b.languages) ? [...new Set(b.languages.map((v: unknown) => String(v)))] : null;
    if (!given || !given.length) ctx.fail(400, 'validation', 'Choose at least one language.', { languages: 'Choose at least one language.' });
    if (given!.length > OCR_MAX_LANGS) ctx.fail(400, 'validation', `Choose at most ${OCR_MAX_LANGS} languages.`, { languages: `Choose at most ${OCR_MAX_LANGS} languages: each one makes reading a page slower.` });
    const missing = given!.filter((c) => !available.has(c));
    if (missing.length) {
      ctx.fail(400, 'validation', `There is no language data for ${missing.join(', ')} in the language folder.`, { languages: `There is no language data for ${missing.join(', ')}.` });
    }
    // English first when chosen, then in the order given (the engine prefers the first language).
    const languages = [...given!.filter((c) => c === 'eng'), ...given!.filter((c) => c !== 'eng')];
    await ctx.settings.set(SETTING_OCR_LANGS, languages, req);
    // Scans not read yet go back in the queue; with `reread`, scans read before (in other languages) too.
    const where = b.reread === true ? `(${NOT_READ} or ${READ})` : NOT_READ;
    const requeued = (await db.query<Row>(
      `delete from attachment_texts x using attachments a where a.id = x.attachment_id and a.deleted_at is null and ${where} returning x.attachment_id`)).length;
    if (requeued) {
      await ctx.audit(req, {
        action: 'attachments.ocr_requeue', recordType: 'setting', recordId: SETTING_OCR_LANGS,
        summary: `${requeued} scanned ${requeued === 1 ? 'file' : 'files'} put back in the reading queue (OCR in ${languages.join(', ')})`,
        after: { requeued, reread: b.reread === true },
      });
      await queueFileTexts(ctx);
    }
    return { ...(await overview()), requeued };
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/attachments/admin/ocr', permission: 'admin.administer',
    summary: 'Choose the languages scanned PDFs are read in (at most four, each with its data in the language folder); scans not read yet are read again',
    body: '{ languages: [code], reread?: boolean (also read again the scans already read by OCR) }',
    response: 'the same as GET, with requeued (how many scans were put back in the reading queue)',
  });
}
